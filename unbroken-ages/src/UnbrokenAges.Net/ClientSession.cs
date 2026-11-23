using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Net;

public sealed class ClientOptions
{
    public string PlayerName { get; set; } = "Player";
    public string? Password { get; set; }
    public string? ReconnectToken { get; set; }
    public bool Spectator { get; set; }
}

/// <summary>
/// Client side of the command-replication model. Holds a full local copy of the simulation,
/// applies the host's ordered command stream, reports state hashes after each turn and accepts
/// authoritative snapshots when told it has drifted.
///
/// Responsiveness: the UI shows "pending" intents immediately (ghost move paths, queued items
/// greyed until confirmed). On LAN/Direct IP the echo arrives in a few ms; for a turn-based game
/// this beats speculative execution + rollback in both simplicity and robustness.
/// </summary>
public sealed class ClientSession : IDisposable
{
    private readonly GameDatabase _db;
    private readonly IClientTransport _transport;
    private readonly ClientOptions _options;
    private readonly Dictionary<int, GameCommand> _pending = new();
    private int _clientSeq;

    public int Slot { get; private set; } = -1;
    public bool IsSpectator { get; private set; }
    public string? ReconnectToken { get; private set; }
    public GameState? State { get; private set; }
    public long LastSeq { get; private set; }
    public bool Paused { get; private set; }
    public string? RejectReason { get; private set; }
    public string? LastCommandError { get; private set; }
    public int ResyncsApplied { get; private set; }
    public LobbyMsg? Lobby { get; private set; }
    public List<ChatMsg> Chat { get; } = new();
    public IReadOnlyCollection<GameCommand> PendingCommands => _pending.Values;
    public event Action<IReadOnlyList<GameEvent>>? EventsRaised;

    /// <summary>Test hook: pretend to have different content to exercise the mismatch path.</summary>
    public ulong? ContentHashOverride { get; set; }

    public ClientSession(GameDatabase db, IClientTransport transport, ClientOptions? options = null)
    {
        _db = db;
        _transport = transport;
        _options = options ?? new ClientOptions();
    }

    public void Connect()
    {
        _transport.Connect();
        Send(new HelloMsg
        {
            ContentHash = ContentHashOverride ?? _db.ContentHash,
            PlayerName = _options.PlayerName,
            PasswordHash = _options.Password != null ? HostSession.HashPassword(_options.Password) : "",
            ReconnectToken = _options.ReconnectToken ?? "",
            Spectator = _options.Spectator,
        });
    }

    public bool IsConnected => _transport.IsConnected;

    public int Submit(GameCommand cmd)
    {
        if (Slot < 0) throw new InvalidOperationException("Not seated in a game.");
        cmd.Player = Slot;
        int seq = ++_clientSeq;
        _pending[seq] = cmd;
        Send(new SubmitMsg { ClientSeq = seq, Command = cmd.Serialize() });
        return seq;
    }

    public void SendChat(string text, int to = ChatMsg.ToAll) => Send(new ChatMsg { From = Slot, To = to, Text = text });
    public void RequestPause(bool paused) => Send(new PauseMsg { Paused = paused, BySlot = Slot });

    public void Poll()
    {
        while (_transport.TryReceive(out var e))
        {
            if (e.Kind != NetEventKind.Data) continue;
            Handle(Protocol.Decode(e.Data!));
        }
    }

    private void Handle(NetMessage msg)
    {
        switch (msg)
        {
            case WelcomeMsg w:
                Slot = w.Slot;
                IsSpectator = w.Spectator;
                ReconnectToken = w.ReconnectToken;
                break;
            case RejectMsg r:
                RejectReason = r.Reason;
                break;
            case LobbyMsg l:
                Lobby = l;
                break;
            case StartGameMsg start:
            {
                var setup = GameSetupCodec.Deserialize(start.Setup);
                State = GameFactory.Create(_db, setup);
                LastSeq = 0;
                if (start.InitialHash != 0 && GameStateSerializer.Hash(State) != start.InitialHash)
                    Send(new StateHashMsg { Seq = 0, Turn = State.Turn, Hash = 0 }); // ask for a snapshot immediately
                break;
            }
            case BroadcastMsg b:
                ApplyBroadcast(b);
                break;
            case RejectedMsg rej:
                _pending.Remove(rej.ClientSeq);
                LastCommandError = rej.Reason;
                break;
            case ResyncMsg rs:
                State = GameStateSerializer.Deserialize(rs.Snapshot, _db);
                LastSeq = rs.Seq;
                ResyncsApplied++;
                break;
            case PauseMsg p:
                Paused = p.Paused;
                break;
            case ChatMsg c:
                Chat.Add(c);
                break;
        }
    }

    private void ApplyBroadcast(BroadcastMsg b)
    {
        if (State == null || b.Seq <= LastSeq) return; // duplicate or pre-snapshot traffic
        if (b.FromSlot == Slot) _pending.Remove(b.ClientSeq);
        if (b.Seq != LastSeq + 1)
        {
            ReportHash(force: true); // gap: let the host resync us
            return;
        }
        var cmd = GameCommand.Deserialize(b.Command);
        var events = new List<GameEvent>();
        var result = CommandProcessor.Execute(State, cmd, events);
        LastSeq = b.Seq;
        if (!result.Ok)
        {
            ReportHash(force: true); // the host accepted something we can't: we have drifted
            return;
        }
        if (events.Count > 0) EventsRaised?.Invoke(events);
        if (cmd.Type == CommandType.AdvanceTurn) ReportHash(force: false);
    }

    private void ReportHash(bool force) =>
        Send(new StateHashMsg { Seq = LastSeq, Turn = State?.Turn ?? 0, Hash = force ? 0 : GameStateSerializer.Hash(State!) });

    private void Send(NetMessage m) => _transport.Send(Protocol.Encode(m));

    public void Dispose() => _transport.Dispose();
}
