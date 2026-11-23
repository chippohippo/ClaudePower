# 5.4 Direct IP Multiplayer Networking Layer

**Code:** [`Protocol.cs`](../../src/UnbrokenAges.Net/Protocol.cs) · [`Transport.cs`](../../src/UnbrokenAges.Net/Transport.cs) ·
[`HostSession.cs`](../../src/UnbrokenAges.Net/HostSession.cs) · [`ClientSession.cs`](../../src/UnbrokenAges.Net/ClientSession.cs) ·
[`LanDiscovery.cs`](../../src/UnbrokenAges.Net/LanDiscovery.cs) · CLI `ua host` / `ua join`

## Requirements
1. **Direct IP with no account or online service.** Type an address, play.
2. LAN discovery; optional relay and matchmaking later through the same session code.
3. Desync **resistance and recovery**; reconnect; pause; spectators; 12+ players.
4. Cross-platform: Windows, macOS and Linux peers in one game.

## Model: deterministic command replication with an authoritative sequencer

```
 Client A                     Host (authoritative)                         Client B / Spectator
 ────────                     ────────────────────                         ────────────────────
 intent ──SubmitMsg(cseq,cmd)──►  decode → cmd.Player := slot(A)   (anti-spoof)
                                  Validate(hostState) ── fail ──► RejectedMsg(cseq, reason) ──► A
                                  Apply(hostState); Seq++
 ◄──────────────── BroadcastMsg(Seq, fromSlot, cseq, cmd) ────────────────────────────────────► apply in Seq order
 apply in Seq order
                                  all humans EndTurn ⇒ AdvanceTurnCommand (system issuer) → broadcast
 hash(state) ──StateHashMsg(Seq, turn, h)──► compare with host hash at Seq ◄── StateHashMsg ── hash(state)
                                  mismatch ⇒ ResyncMsg(Seq, snapshot) ─────► replace state, continue at Seq+1
```

Why this rather than pure lockstep or pure server-authority:

| | Pure lockstep | Server-authoritative state sync | **Ours** |
|---|---|---|---|
| Bandwidth | tiny | large (state deltas) | tiny (commands, plus a rare snapshot) |
| Who decides legality and turn ends | everyone (needs consensus) | server | host |
| Desync outcome | game over | n/a | **detected per turn, healed by snapshot** |
| AI cost | every peer runs AI deterministically | server | **host only**; AI need not be deterministic |
| Hidden information | full state everywhere | can filter | full state by default; *secure mode* (M5) switches to filtered snapshots |

Turn-based play tolerates latency, so client prediction is limited to the UI (ghost paths, greyed "pending" queue items). The LAN and Direct IP
echo arrives in milliseconds, which beats speculative execution with rollback in both simplicity and robustness.

## Wire protocol
Frames: `[u32 LE length][u8 MsgType][body]`, maximum 32 MiB. TCP with `NoDelay`, one writer task per peer (queued sends), and a reader task that
enqueues events for the game thread (`TryReceive` pumps on the main thread, with no callbacks into game state off-thread).

| Msg | Direction | Body |
|---|---|---|
| `Hello` | C→H | protocol version, **content hash** (all gameplay mods), name, password hash, reconnect token, spectator flag |
| `Welcome` / `Reject` | H→C | slot, new reconnect token / human-readable reason |
| `Lobby` | H→all | slots (name, leader, team, AI, connected, ready), spectator count |
| `StartGame` | H→all | serialized `GameSetup` and initial state hash (early detection of mismatched content) |
| `Submit` | C→H | client seq + command bytes |
| `Broadcast` | H→all | global seq, from slot, client seq, command bytes |
| `Rejected` | H→C | client seq + reason (UI un-greys the pending item and shows why) |
| `StateHash` | C→H | seq, turn, FNV-1a of the full snapshot (hash 0 = "please resync me") |
| `Resync` | H→C | seq + full snapshot (desync heal, reconnect, late join) |
| `Pause`, `Chat`, `Ping/Pong`, `Kick` | | |

**Sizes:** commands are 10–40 bytes; a full turn for 12 players is typically under 30 KB of commands; a snapshot is ~80 KB (Small) to ~600 KB (Huge late game).

## Session behaviour (implemented)
* **Slots:** human slots are filled in order; AI slots stay on the host, which runs `IAiController` after each turn advance and submits its commands like any player.
* **Turn end:** when every connected human has `EndTurn`, the host issues `AdvanceTurnCommand{ExpectedTurn}`. **Disconnected** players who previously
  joined are auto-ended (`AutoEndDisconnectedPlayers`) so a drop never stalls the table.
* **Desync heal:** the host stores its hash at every turn-advance `Seq` (last 64). A client reporting a different hash, or reporting 0 because it
  failed to apply a command or saw a sequence gap, gets a `Resync` snapshot immediately.
* **Reconnect:** the `Welcome` token identifies the slot. A returning client sends it in `Hello` and receives `StartGame` plus a snapshot at the current `Seq`.
* **Spectators** receive every broadcast and snapshot but cannot submit. *Delay* (anti-ghosting) is planned: the host buffers spectator traffic by N turns.
* **Mismatched mods** are rejected at the door with "Your enabled gameplay mods differ from the host's." UI-only mods set `affectsGameplay: false`
  and do not count toward the content hash.
* **Graceful close:** rejection frames are flushed before the socket closes (`TcpPeer.CloseAfterFlush`).

## Turn modes (simultaneous, dynamic and sequential are implemented)
Code: [`TurnPhases.cs`](../../src/UnbrokenAges.Sim/Systems/TurnPhases.cs) (sim) and `HostSession.CheckTurnEnd` (host) · tests `TurnPhaseTests.cs`.

* **Phases are part of the game state.** When a turn begins (`TurnProcessor.Advance`, `GameFactory.Create`), `TurnPhases.Begin` stores the
  phase list in `GameState.TurnPhases`. Every peer computes the same list and it is in snapshots, so clients know whose phase it is
  without extra messages. A war declared mid-turn changes the order **from the next turn**, so nobody is frozen mid-move.
* **Simultaneous:** one phase with everyone.
* **Dynamic** (default): greedy colouring of the war graph in player order. Each civilization joins the first phase that holds none of its
  enemies, so civilizations at peace move together and enemies never move at the same time. Teammates are never at war, so they share a phase.
  Example: 0 and 1 at war with 2, 1 at war with 3 → `[[0, 1], [2, 3]]`.
* **Sequential:** one phase per civilization, in player order.
* **Current phase** = the first phase with a living member that has not ended its turn. The host rejects every command from players
  outside it ("Not your phase yet. Phase 1 of 2: Host, Alice."), except One More Turn.
* **The host drives the turn** (`CheckTurnEnd`, re-entrancy guarded): it runs each AI when **its** phase opens, auto-ends disconnected players
  in the open phase, opens the next phase when everyone in this one has ended, and issues `AdvanceTurn` after the last. It stops whenever it is
  waiting for a human, and also when a victory awaits the One More Turn choice.
* The HUD shows "Phase 2 of 2: Bob" whenever there is more than one phase.
* **Timers:** the host owns the clock (`base + perCity·cities + perUnit·units`, extended in war). On expiry it issues `EndTurn` for remaining players. Clients render
  the countdown from `TurnTimerMsg` (M3).

## Direct IP UX and NAT
* The address field accepts `1.2.3.4`, `1.2.3.4:5000`, `[2001:db8::1]:5000`, `host.example:5000` (`DirectIpEndpoint.TryParse`). The default port is **47620/TCP**.
  The host binds dual-stack IPv6 when available.
* **Connection doctor** (M3): the host attempts UPnP-IGD/PCP port mapping, shows the external IP, and runs a reachability test through an optional echo
  service. If it fails, the dialog explains port forwarding and offers **relay**.
* **Relay** (M3): an open-source relay server that pipes frames between room members. It sees only opaque frames, the host stays authoritative, and
  the same `IServerTransport` interface is used.
* **LAN:** the host broadcasts a `LanBeacon` (UDP 47621) every second with name, players, password flag, protocol version and content hash. The browser
  greys out incompatible games.

## Security notes
* Issuer rewriting stops players acting for others; every command is validated on the host.
* Default mode trusts peers with full state (a map-hack is possible), which is fine for friends. **Secure mode** for public matchmaking sends
  fog-filtered snapshots and validates visibility for every command.
* The password is sent salted and hashed. Over the internet, use relay/matchmaking (TLS) for strangers. Direct IP is intended for people you trust.

## Tests (real sockets on loopback)
`DirectIp_DynamicTurns_EnemiesMoveOneAfterTheOther`: the host declares war on Bob in turn 1; in turn 2 Bob's end-turn is refused until the
host's phase ends, every peer reports the same current phase, and all three end turn 3 hash-identical.
`DirectIp_HostAndTwoClients_StayInLockstep` (8 turns, hashes equal every turn, AI on host), `Desync_IsDetected_AndHealedWithASnapshot`,
`Host_RewritesTheIssuer_SoClientsCannotActForOthers`, `MismatchedMods_AreRejectedAtTheDoor`, `Reconnect_RestoresTheSameSlot_WithAFreshSnapshot`,
`Spectators_ReceiveTheStream_ButCannotAct`, `DirectIpEndpoint_ParsesWhatPlayersType`, `LanBeacon_RoundTripsOverUdp`; plus
`DeterminismTests` for the simulation side.
