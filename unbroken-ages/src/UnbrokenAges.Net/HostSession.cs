using System.Security.Cryptography;
using System.Text;
using UnbrokenAges.Sim.AI;
using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Net;

public sealed class HostOptions
{
    public string GameName { get; set; } = "Unbroken Ages game";
    public string? Password { get; set; }
    public bool AllowSpectators { get; set; } = true;
    /// <summary>Disconnected players are auto-ended each turn so the game never stalls (they can reconnect).</summary>
    public bool AutoEndDisconnectedPlayers { get; set; } = true;
    /// <summary>Slot the host itself plays (-1 for a dedicated server).</summary>
    public int LocalSlot { get; set; } = 0;
}

/// <summary>
/// Authoritative host for Direct IP / LAN / relay games ("listen server" or dedicated).
///
/// Model: deterministic command replication with an authoritative sequencer.
///  1. Clients send intents (SubmitMsg). The host validates against ITS state, rewrites the
///     issuer to the connection's slot (anti-spoofing), applies, stamps a global sequence number
///     and broadcasts. Every peer applies the identical ordered command stream.
///  2. The host alone decides when a turn ends and issues AdvanceTurn; AI runs only here. It enforces the turn
///     phases (simultaneous, sequential, or dynamic: enemies never move at once) and runs each AI when its phase opens.
///  3. After each AdvanceTurn every client reports a state hash. On mismatch the host sends a
///     full snapshot (ResyncMsg) — the game heals itself instead of ending in "desync".
///  4. Reconnect tokens let a dropped player rejoin the same slot mid-game.
/// </summary>
public sealed class HostSession : IDisposable
{
    private sealed class Peer
    {
        public int PeerId;
        public int Slot = -1;
        public bool Spectator;
        public string Name = "";
        public bool Handshaken;
    }

    private readonly GameDatabase _db;
    private readonly IServerTransport _transport;
    private readonly HostOptions _options;
    private readonly Dictionary<int, Peer> _peers = new();
    private readonly Dictionary<int, string> _slotTokens = new();
    private readonly SortedDictionary<long, ulong> _hashBySeq = new();
    private readonly Dictionary<int, IAiController> _ai = new();

    public GameSetup Setup { get; }
    public GameState? State { get; private set; }
    public long Seq { get; private set; }
    public bool Paused { get; private set; }
    public int DesyncsDetected { get; private set; }
    public List<string> Log { get; } = new();
    public List<ChatMsg> Chat { get; } = new();
    public event Action<IReadOnlyList<GameEvent>>? EventsRaised;
    private bool _driving;

    /// <summary>Players allowed to act right now (the current turn phase).</summary>
    public IReadOnlyList<int> ActivePlayers
    {
        get
        {
            int current = State == null ? -1 : TurnPhases.Current(State);
            return current < 0 ? Array.Empty<int>() : State!.TurnPhases[current];
        }
    }

    public HostSession(GameDatabase db, IServerTransport transport, GameSetup setup, HostOptions? options = null)
    {
        _db = db;
        _transport = transport;
        Setup = setup;
        _options = options ?? new HostOptions();
        for (int i = 0; i < setup.Players.Count; i++)
            if (!setup.Players[i].IsHuman) _ai[i] = new SimpleAi();
    }

    public void Start() => _transport.Start();

    public int Port => _transport.Port;

    public bool IsSlotConnected(int slot) =>
        slot == _options.LocalSlot || _peers.Values.Any(p => p.Handshaken && p.Slot == slot);

    // ----- Lifecycle -----------------------------------------------------------------------------

    public void StartGame()
    {
        if (State != null) throw new InvalidOperationException("Game already started.");
        State = GameFactory.Create(_db, Setup);
        var start = new StartGameMsg { Setup = GameSetupCodec.Serialize(Setup), InitialHash = GameStateSerializer.Hash(State) };
        BroadcastToAll(start);
        Log.Add($"Game started: {Setup.Players.Count} players, seed {Setup.Seed}.");
        CheckTurnEnd();
    }

    public void Poll()
    {
        while (_transport.TryReceive(out var e))
        {
            switch (e.Kind)
            {
                case NetEventKind.Connected:
                    _peers[e.PeerId] = new Peer { PeerId = e.PeerId };
                    break;
                case NetEventKind.Disconnected:
                    if (_peers.Remove(e.PeerId, out var gone) && gone.Handshaken)
                    {
                        Log.Add($"{gone.Name} disconnected ({e.Reason}).");
                        BroadcastLobby();
                        CheckTurnEnd();
                    }
                    break;
                case NetEventKind.Data:
                    if (!_peers.TryGetValue(e.PeerId, out var peer)) break;
                    NetMessage msg;
                    try { msg = Protocol.Decode(e.Data!); }
                    catch (Exception ex) when (ex is InvalidDataException or EndOfStreamException or IOException)
                    {
                        _transport.Disconnect(e.PeerId, "Malformed message.");
                        break;
                    }
                    Handle(peer, msg);
                    break;
            }
        }
    }

    /// <summary>Commands from the host's own UI go through the same path as remote ones.</summary>
    public CommandResult SubmitLocal(GameCommand cmd)
    {
        if (_options.LocalSlot < 0) return CommandResult.Fail("Dedicated server has no local player.");
        cmd.Player = _options.LocalSlot;
        return Process(cmd, _options.LocalSlot, 0);
    }

    public void SetPaused(bool paused, int bySlot)
    {
        Paused = paused;
        BroadcastToAll(new PauseMsg { Paused = paused, BySlot = bySlot });
    }

    // ----- Message handling ----------------------------------------------------------------------

    private void Handle(Peer peer, NetMessage msg)
    {
        if (!peer.Handshaken && msg is not HelloMsg)
        {
            _transport.Disconnect(peer.PeerId, "Expected Hello.");
            return;
        }
        switch (msg)
        {
            case HelloMsg hello: HandleHello(peer, hello); break;
            case SubmitMsg submit: HandleSubmit(peer, submit); break;
            case StateHashMsg hash: HandleHash(peer, hash); break;
            case ChatMsg chat:
                chat.From = peer.Slot;
                Chat.Add(chat);
                BroadcastToAll(chat);
                break;
            case PauseMsg pause when !peer.Spectator:
                SetPaused(pause.Paused, peer.Slot);
                break;
            case PingMsg ping:
                Send(peer.PeerId, new PongMsg { Timestamp = ping.Timestamp });
                break;
        }
    }

    private void HandleHello(Peer peer, HelloMsg hello)
    {
        string? reject =
            hello.ProtocolVersion != Protocol.Version ? $"Version mismatch (host {Protocol.Version}, you {hello.ProtocolVersion})." :
            hello.ContentHash != _db.ContentHash ? "Your enabled gameplay mods differ from the host's." :
            _options.Password != null && hello.PasswordHash != HashPassword(_options.Password) ? "Wrong password." : null;
        if (reject != null)
        {
            Send(peer.PeerId, new RejectMsg { Reason = reject });
            _transport.Disconnect(peer.PeerId, reject);
            return;
        }

        int slot = -1;
        if (hello.ReconnectToken.Length > 0)
            foreach (var (s, token) in _slotTokens)
                if (token == hello.ReconnectToken && !IsSlotConnected(s)) slot = s;

        if (slot < 0 && !hello.Spectator)
        {
            for (int i = 0; i < Setup.Players.Count; i++)
                if (Setup.Players[i].IsHuman && i != _options.LocalSlot && !_slotTokens.ContainsKey(i)) { slot = i; break; }
        }
        bool spectator = slot < 0;
        if (spectator && !_options.AllowSpectators)
        {
            Send(peer.PeerId, new RejectMsg { Reason = "Game is full." });
            _transport.Disconnect(peer.PeerId, "Game is full.");
            return;
        }

        peer.Slot = slot;
        peer.Spectator = spectator;
        peer.Name = hello.PlayerName;
        peer.Handshaken = true;
        string newToken = spectator ? "" : NewToken();
        if (!spectator) _slotTokens[slot] = newToken;

        Send(peer.PeerId, new WelcomeMsg { Slot = slot, ReconnectToken = newToken, Spectator = spectator });
        Log.Add($"{hello.PlayerName} joined as {(spectator ? "spectator" : $"slot {slot}")} from {_transport.RemoteAddress(peer.PeerId)}.");
        if (State != null)
        {
            // Late join / reconnect: setup, then the authoritative snapshot at the current sequence.
            Send(peer.PeerId, new StartGameMsg { Setup = GameSetupCodec.Serialize(Setup), InitialHash = 0 });
            Send(peer.PeerId, new ResyncMsg { Seq = Seq, Snapshot = GameStateSerializer.Serialize(State) });
            if (Paused) Send(peer.PeerId, new PauseMsg { Paused = true, BySlot = -1 });
        }
        BroadcastLobby();
    }

    private void HandleSubmit(Peer peer, SubmitMsg submit)
    {
        if (peer.Spectator || State == null)
        {
            Send(peer.PeerId, new RejectedMsg { ClientSeq = submit.ClientSeq, Reason = "Not a player in a running game." });
            return;
        }
        GameCommand cmd;
        try { cmd = GameCommand.Deserialize(submit.Command); }
        catch (Exception ex) when (ex is InvalidDataException or EndOfStreamException or IOException)
        {
            Send(peer.PeerId, new RejectedMsg { ClientSeq = submit.ClientSeq, Reason = "Malformed command." });
            return;
        }
        cmd.Player = peer.Slot; // never trust the claimed issuer
        var result = Process(cmd, peer.Slot, submit.ClientSeq);
        if (!result.Ok) Send(peer.PeerId, new RejectedMsg { ClientSeq = submit.ClientSeq, Reason = result.Error ?? "Rejected." });
    }

    private void HandleHash(Peer peer, StateHashMsg msg)
    {
        if (State == null) return;
        if (_hashBySeq.TryGetValue(msg.Seq, out ulong expected) && expected == msg.Hash) return;
        if (msg.Seq > Seq) return;
        DesyncsDetected++;
        Log.Add($"Desync detected for {peer.Name} at seq {msg.Seq} (turn {msg.Turn}); sending snapshot.");
        Send(peer.PeerId, new ResyncMsg { Seq = Seq, Snapshot = GameStateSerializer.Serialize(State) });
    }

    // ----- Command pipeline ----------------------------------------------------------------------

    private CommandResult Process(GameCommand cmd, int fromSlot, int clientSeq)
    {
        if (State == null) return CommandResult.Fail("Game not started.");
        if (Paused && cmd.Type != CommandType.AdvanceTurn) return CommandResult.Fail("Game is paused.");
        if (cmd.Type != CommandType.OneMoreTurn && !TurnPhases.MayAct(State, cmd.Player))
            return CommandResult.Fail($"Not your phase yet. {TurnPhases.Describe(State)}.");
        var events = new List<GameEvent>();
        var result = CommandProcessor.Execute(State, cmd, events);
        if (!result.Ok) return result;

        Seq++;
        BroadcastToAll(new BroadcastMsg { Seq = Seq, FromSlot = fromSlot, ClientSeq = clientSeq, Command = cmd.Serialize() });
        if (events.Count > 0) EventsRaised?.Invoke(events);

        if (cmd.Type == CommandType.AdvanceTurn)
        {
            _hashBySeq[Seq] = GameStateSerializer.Hash(State);
            while (_hashBySeq.Count > 64) _hashBySeq.Remove(_hashBySeq.Keys.First());
        }
        else if (cmd.Type == CommandType.EndTurn)
        {
            CheckTurnEnd();
        }
        return result;
    }

    /// <summary>
    /// Drives the turn forward: runs the AI of the phase that is moving, auto-ends disconnected players there, opens the next
    /// phase when everyone in this one has ended, and advances the turn after the last phase. Stops to wait for humans.
    /// </summary>
    private void CheckTurnEnd()
    {
        if (State == null || Paused || _driving) return;
        if (!State.Players.Any(p => !p.IsFreeCities && p.IsAlive && Setup.Players[p.Id].IsHuman)) return; // the host never plays alone
        _driving = true;
        try
        {
            for (int guard = 0; guard < 256; guard++)
            {
                if (State.Victory.AwaitingChoice) return;
                int phase = TurnPhases.Current(State);
                if (phase < 0)
                {
                    if (!Process(new AdvanceTurnCommand { Player = GameCommand.SystemPlayer, ExpectedTurn = State.Turn }, -1, 0).Ok) return;
                    continue;
                }
                foreach (int slot in State.TurnPhases[phase])
                {
                    var p = State.Players[slot];
                    if (!p.IsAlive || p.HasEndedTurn) continue;
                    if (_ai.TryGetValue(slot, out var ai))
                    {
                        foreach (var cmd in ai.TakeTurn(State, slot).ToList())
                        {
                            cmd.Player = slot;
                            Process(cmd, slot, 0);
                        }
                        if (!p.HasEndedTurn) Process(new EndTurnCommand { Player = slot }, slot, 0);
                    }
                    else if (_options.AutoEndDisconnectedPlayers && !IsSlotConnected(slot) && _slotTokens.ContainsKey(slot))
                    {
                        Process(new EndTurnCommand { Player = slot }, -1, 0);
                    }
                }
                if (TurnPhases.Current(State) == phase) return; // waiting for the humans of this phase
            }
        }
        finally { _driving = false; }
    }

    // ----- Helpers -------------------------------------------------------------------------------

    private void Send(int peerId, NetMessage m) => _transport.Send(peerId, Protocol.Encode(m));

    private void BroadcastToAll(NetMessage m)
    {
        var frame = Protocol.Encode(m);
        foreach (var p in _peers.Values)
            if (p.Handshaken) _transport.Send(p.PeerId, frame);
    }

    private void BroadcastLobby()
    {
        var lobby = new LobbyMsg { Spectators = _peers.Values.Count(p => p.Handshaken && p.Spectator) };
        for (int i = 0; i < Setup.Players.Count; i++)
        {
            var ps = Setup.Players[i];
            var peer = _peers.Values.FirstOrDefault(p => p.Handshaken && p.Slot == i);
            lobby.Slots.Add(new LobbySlot
            {
                Slot = i, Name = peer?.Name ?? ps.Name, Leader = ps.Leader ?? "", Team = ps.Team, IsAi = !ps.IsHuman,
                Connected = !ps.IsHuman || IsSlotConnected(i), Ready = true,
            });
        }
        BroadcastToAll(lobby);
    }

    public static string HashPassword(string password) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("unbroken-ages:" + password)));

    private static string NewToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(16));

    public void Dispose() => _transport.Dispose();
}
