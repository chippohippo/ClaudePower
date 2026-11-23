# 02 — Technical Architecture

## 1. Engine choice: Godot 4.x (.NET) + an engine-agnostic C# simulation

**Decision:** the game is built in **Godot 4.3+ (.NET edition)**. All game rules live in a **separate, pure C#/.NET 8 simulation
assembly** with zero engine references. Godot is the presentation layer: rendering, audio, input and UI.

| Criterion | Godot 4 (.NET) | Unity 6 | Why it matters for this game |
|---|---|---|---|
| Licence and cost | MIT, no royalties or runtime fees, full source | Proprietary; pricing changes in 2023 shook trust | A long-lived, mod-heavy game needs a stable licence; studios can patch the engine themselves |
| Modding | Open engine, `.pck` loading, readable scenes (`.tscn`), GDScript for UI mods | Possible, but asset bundles and IL2CPP make it harder | Mod support from day one is a pillar (P5) |
| 2D/3D hybrid UI | Excellent Control/UI system, theming, MSDF fonts, built-in scaling | Strong (UI Toolkit/uGUI) | 4X games are mostly UI; Godot's container layout suits dense report screens |
| Rendering at scale | Forward+ / Mobile renderers, MultiMesh, compute; less mature large-world tooling | More mature (DOTS, HDRP/URP) | We need hex terrain plus thousands of instances, not open-world streaming; MultiMesh and chunking suffice (§9) |
| Consoles | Via W4 Games / third parties | First-party | Consoles are post-launch; the engine-agnostic sim keeps porting risk to the presentation layer only |
| C# | First-class (.NET 8) | First-class (Mono/IL2CPP) | Same language for sim, tools, servers and client |
| Headless/server | `--headless` builds; our sim does not even need Godot | Server builds | Dedicated servers, CI soak tests and AI training run the sim without any engine |

**Why separate the sim from the engine?** It gives (1) determinism we control (no engine float math in rules), (2) dedicated servers and CI that
run with no renderer (`ua host`, `ua simulate`), (3) unit tests for every rule (83 today), and (4) an engine swap that costs only a presentation
rewrite. Unity remains a viable fallback for exactly that reason.

## 2. Layering

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Presentation (Godot 4, C#)          godot/                                              │
│  HexMapView · PlacementLens · CityPanel · LobbyScreen · StrategyCamera · VFX · Audio    │
│  Reads GameState (read-only), renders on version change, sends GameCommands            │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ Session (C#)                        src/UnbrokenAges.Net                                │
│  LocalSession* · HostSession · ClientSession · transports (TCP / LAN / relay* / Steam*) │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ Simulation (pure C#, deterministic) src/UnbrokenAges.Sim                                │
│  Commands → Systems (Adjacency, Production, Loyalty, Governors, Power, Climate, …)      │
│  State (SoA map + entity lists) · Serializer/Hash · Events (outputs only)               │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ Data (C#)                           src/UnbrokenAges.Sim/Data + content/ + mods/        │
│  ModLoader (layers, $op patches) → GameDatabase (indexed, linked, content-hashed)       │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ AI (C#, host-only)                  src/UnbrokenAges.Sim/AI  (→ UnbrokenAges.AI later)   │
│  Emits ordinary commands; never mutates state directly                                 │
└──────────────────────────────────────────────────────────────────────────────────────┘
* = planned
```

**Dependency rules (enforced by project references):** Presentation → Session → Sim → Data. The Sim never references Net or Godot.
The AI depends on the Sim but is never referenced *by* it. UI mods depend only on a read-only *view* API and the command API.

## 3. Determinism contract

Every peer runs the same simulation from the same `GameSetup` and the same ordered command stream, so the rules must produce
bit-identical results everywhere.

| Rule | Enforcement in this repo |
|---|---|
| No `float`/`double` in rules; use `Fx` (Q47.16, 128-bit intermediates, deterministic `Sqrt`/`Log2`) | `Core/Fx.cs`; mapgen uses `Fx` noise; CI grep plus an analyzer (M1) bans float types in `UnbrokenAges.Sim` |
| Seeded, per-subsystem RNG streams (`gameplay`, `disasters`, `mapgen`, …) | `Core/Pcg32.cs`; adding a roll to one stream never shifts another |
| No iteration over `Dictionary`/`HashSet` for logic; lists are kept sorted by id; sorts use total orders | `GameState.AddCity` re-sorts; every `Sort` has an id tie-break; `SortedDictionary` for ledgers |
| No wall-clock, threads or `string.GetHashCode` in rules | `StableHash.Fnv1a64` for content and state hashes |
| Order-independent phases | Loyalty reads a **snapshot** of populations; power dispatch is per grid in a fixed order |
| Same content on every peer | `GameDatabase.ContentHash` checked at `Hello`; mismatches are rejected with a reason |
| Verification | `DeterminismTests` (two independent games stay hash-identical for 60 AI turns); snapshot round-trip continues identically; network tests compare host and client hashes every turn |

When a determinism bug slips through anyway, the network layer **detects and heals it** (state hash per turn → snapshot resync) instead of ending the game.

## 4. Simulation model & tick structure

The game is turn-based with real-time input inside a turn. There is no fixed-rate tick; the "tick" is the **command**.

```
during a turn (any order, any time)            end of turn (AdvanceTurnCommand, host-issued)
──────────────────────────────────            ─────────────────────────────────────────────
Client UI ─► GameCommand ─► Session            1. PowerSystem.Process      grids, dispatch, fuel
             Validate(state) / Apply(state)     2. per player (id order), per city (id order):
             → GameEvents (UI, log, audio)         CityYields → Grow → ProductionSystem.Process
                                                   treasury, ResearchSystem (+ EraEntered), strategic stockpiles
EndTurnCommand per player ──► when all         3. IndustrySystem             production chains on the empire stockpile
humans have ended (or timers expire),          4. GovernorSystem.ProcessTurn  establishment
the host issues AdvanceTurnCommand             5. LoyaltySystem.ProcessTurn   (snapshot-based)
                                                6. DivergenceSystem            the remade world spreads
                                                7. ClimateSystem.ProcessTurn   CO₂ → T → phase → seas → disasters
                                                8. SupplySystem                heal in supply / attrition when cut off
                                                9. units refresh and continue multi-turn paths
                                               10. WorldSystem                 currents decay; a new world era picks its age; Turn++
 after EVERY command (any phase): WorldSystem.Push (currents) and ChronicleSystem.Record (history), identically on every peer
```

* **Commands** (`Commands/GameCommand.cs`) are small, serializable and validated against current state. They are the only way state changes,
  which gives replays, autosave-by-log, single-player undo (rewind to the last snapshot and re-apply minus N commands) and multiplayer.
* **Events** (`State/GameEvent.cs`) are outputs only: notifications, animation triggers and timeline entries. They never feed back into rules.
* **State** (`State/GameState.cs`): the map is structure-of-arrays (`MapGrid`: `byte[] Terrain`, `short[] District`, `byte[] RiverEdges`…),
  and entities are id-sorted lists. A full Small-map late-game snapshot is about 80 KB uncompressed (measured: 79 KiB after 200 turns, 4 players).
* **Performance budget:** end-of-turn processing ≤ 50 ms on a Huge map with 12 players, excluding AI. Measured today: 2.7 ms/turn on Small with 4 players (`ua simulate`).
  The plan includes a Huge-map benchmark in CI (M2) and incremental caches (per-city yield cache invalidated by events) when profiling demands them.

## 5. Save games, replays, timelapse

* **Save** = header (version, content hash, mod list, thumbnail) + `GameStateSerializer` snapshot + the command log since the last snapshot.
  Versioned (`Version` field) with forward migrations.
* **Autosaves** every turn (snapshot) plus continuous command-log append, so crash recovery is exact.
* **Replay** = initial setup + command log. **Timelapse** = per-turn ownership deltas (tile→player) captured at `TurnAdvanced`, about 0.2 KB per turn.

## 6. Networking model (summary — full design in [05-key-systems/04](05-key-systems/04-multiplayer-networking.md))

**Model:** *deterministic command replication with an authoritative sequencer*. It is a hybrid of lockstep (small bandwidth, every peer
simulates) and client–server authority (one machine validates, orders and decides turn ends).

| Concern | Design | Implemented |
|---|---|---|
| Topology | Host (listen server or dedicated) ↔ clients, star | ✔ `HostSession`, `ClientSession` |
| Transport | Length-prefixed TCP frames for Direct IP/LAN; pluggable `IServerTransport`/`IClientTransport` for relay, Steam and EOS | ✔ TCP, LAN UDP beacons |
| Ordering | Host stamps a global `Seq`; clients apply strictly in order; gaps trigger resync | ✔ |
| Anti-spoof | Host overwrites `cmd.Player` with the connection's slot | ✔ test `Host_RewritesTheIssuer…` |
| Desync | Clients hash state after every turn; on mismatch the host sends a snapshot | ✔ test `Desync_IsDetected_AndHealed…` |
| Reconnect / late join | Token → same slot → `StartGame` + snapshot | ✔ test `Reconnect_RestoresTheSameSlot…` |
| Spectators | Receive the stream, cannot submit | ✔ |
| AI | Runs only on the host; emits commands | ✔ |
| Hidden information | Default: full state on all peers (fine for friends and LAN). **Secure mode** (ranked/relay): server-authoritative with fog-filtered snapshots | Planned M5 |
| NAT | Direct IP needs a forwarded port (UPnP/PCP auto-open, M3); relay fallback (room codes) | Planned |
| Bandwidth | Commands are 10–40 bytes; a busy 12-player turn is under 30 KB; a snapshot resync is ~80–600 KB | Measured snapshot sizes |

## 7. Data pipeline

```
content/base/mod.json + data/*.json ─┐
mods/<id>/mod.json + data/*.json ────┼─► ModLoader.ResolveLoadOrder (deps, loadAfter; id tie-break)
                                     │   ─► parse JSONC ─► apply $op: add | replace | patch | delete
                                     │       (patch: deep merge, $append/$prepend/$removeWhere/$remove)
                                     │   ─► deserialize strict (unknown fields = errors, catches typos)
                                     │   ─► Link(): string ids → int indices, cross-reference validation
                                     │   ─► WellKnownIds, prerequisite-cycle check
                                     └─► GameDatabase (indexed tables) + ContentHash (FNV over merged JSON)
```

* **Authoring format:** JSON with comments and trailing commas, plus **JSON Schema** (`content/schemas/`) for VS Code autocomplete and inline errors.
  The C# loader is authoritative (it also validates references, which the schema cannot).
* **Errors** carry the mod, file, category, id and field: `[testmod] Building 'BUILDING_X': 'district' references unknown districts id 'DISTRICT_NOPE'.`
* **Localization:** `localization/<lang>.json` key→string tables (ICU MessageFormat for plurals). Game data uses ids, and the UI resolves names
  through `LOC_*` keys with a fallback to `name`.
* **Assets:** referenced by logical keys (`art.district.academy.lod0`), resolved by the client from `res://` or mod `.pck` packs, so the sim never sees asset paths.
* **Hot reload (single player and dev):** a file watcher rebuilds the `GameDatabase`; if indices are unchanged (balance tweaks), the running game
  swaps the database and recomputes caches. Structural changes prompt a reload from the last autosave.
* **Packaging:** `ua validate` in CI for every mod; the workshop uploader runs the same validation.

## 8. AI architecture

AI runs **only on the host** (or locally in single player) and acts through commands. It can therefore use threads, wall-clock budgets
and floats, and can be patched without breaking multiplayer compatibility.

```
Strategic Director (every 5 turns, ~200 ms budget)
  victory-path utilities (personality × situation), grand strategy, war/peace intent, era goals
     │
     ├─► Empire Planner   expansion sites (start-position scorer), city roles, province setup, district master-plan per city
     │                     (DistrictPlanner.Rank with personality-weighted YieldSet — the same scorer as the player lens)
     ├─► Economy Planner  research and civic paths (goal-driven beelines), policies, trade routes, power-grid build-out
     ├─► Diplomacy Planner agendas, deal evaluation (utility of every item, explainable), Congress votes, alliances
     └─► Military Planner threat and influence maps (land, sea and air layers), target selection, force-ratio estimates,
                           staging areas, naval transport and invasion plans, air superiority missions
     │
Operational layer (per turn): army groups, formations, supply, retreats, siege orchestration
Tactical layer (per unit move): utility scoring plus a shallow search on the combat-preview function, ZOC-aware pathing
```

* **Shared planners** guarantee the AI "sees" adjacency the way players do. `SimpleAi` (in the repo) already places districts with `DistrictPlanner`.
* **Budgets and threading:** AI planning runs on a worker thread over a *read-only snapshot* and returns a command list. The host applies
  the commands in order, so determinism is unaffected.
* **Difficulty:** higher levels add planning depth, coordination and better opening builds. Flat yield bonuses are an explicit setup option.
* **Testing:** headless AI-vs-AI soaks (`ua simulate`) in CI track win rates per leader, average district adjacency, wars started and won,
  and naval and air usage, with regressions flagged per commit.

## 9. Rendering & performance

* **Terrain:** chunked hex meshes (16×16 tiles per chunk) with baked vertex colours, splat masks for features, and edge-river decals on hex edges.
  Great Rivers use a flow-map water shader. Chunks rebuild only when their tiles change (driven by events).
* **Instances:** district and building models, forests and units via **MultiMesh** per model and LOD. The prototype (`HexMapView`) already
  renders the whole map with one MultiMesh per shape.
* **LOD tiers:** close (full models), mid (impostor cards), strategic view (2D painted icons, which is also the low-spec mode).
* **Fog of war:** an R8 texture per player, updated on visibility events and sampled in terrain and instance shaders.
* **Frame budget (Steam Deck, Small map):** 60 fps strategic view, 40+ fps 3D; **turn processing never blocks the render thread** (the sim runs on a worker
  thread; presentation interpolates and plays event animations).
* **Memory:** Huge map state is under 2 MB; render data is under 1.5 GB VRAM on the Rich tier.

## 10. Tooling

| Tool | Status |
|---|---|
| `ua mapgen` — ASCII terrain and hydrology preview, stats, timing | ✔ |
| `ua validate` — load base + mods, print errors and content hash | ✔ |
| `ua simulate` — AI-only headless games, perf, event tallies, final hash | ✔ |
| `ua host` / `ua join` — dedicated server with LAN beacon / headless bot client | ✔ |
| World Builder (in-game, edits via "editor commands") | M4 |
| Replay viewer and timelapse exporter (GIF/MP4) | M5 |
| Balance dashboard (soak-test telemetry) | M3 |

## 11. Testing & CI

* **Unit/system tests** per rule (adjacency, placement, queue, loyalty, governors, power, climate, mapgen invariants).
* **Determinism:** same-process twin games; snapshot round-trip continuation; **cross-platform golden hashes**. CI runs the same seeded 100-turn game
  on Windows, macOS (ARM) and Linux and compares final hashes.
* **Network:** real sockets on loopback (lockstep, desync heal, reconnect, spectators, spoofing, mod mismatch) plus **chaos tests** (M3): latency,
  drops and reorder via a fault-injecting transport.
* **Performance:** Huge-map turn benchmark with a regression gate.
* **Content:** every PR runs `ua validate` and JSON Schema checks.

## 12. Platforms & distribution

Windows, Linux and macOS (Universal), Steam Deck verified. Distribution on Steam, GOG and itch. **The game never requires an account for
single player, hotseat, LAN or Direct IP.** Steam, Epic and GOG integrations (achievements, workshop, invites) are optional adapters
behind interfaces. Consoles are post-launch via a third-party Godot console port, which affects only the presentation layer.
