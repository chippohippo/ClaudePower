# 04 — Implementation Plan

The plan is built around **playable checkpoints**. Each milestone ends with a build that people outside the team play,
and gate criteria that can be measured. Durations assume the core team in §3 and are estimates to revisit after M1.

```
M0 Foundations ──► M1 Prototype ──► M2 Vertical Slice ──► M3 Multiplayer Beta ──► M4 Content Complete ──► M5 Polish & Launch ──► M6 Live
   (done here)       (~3 mo)           (~5 mo)                (~4 mo)                  (~7 mo)                   (~4 mo)          (ongoing)
```

---

## M0 — Foundations *(this repository: complete)*

**Goal:** prove the hard technical bets before any art exists: determinism, data-driven content, the key rules, and Direct IP multiplayer.

| Deliverable | Status |
|---|---|
| Deterministic core: `Fx`, `Pcg32` streams, `StableHash`, hex and vertex topology with wrap | ✔ |
| Mod-layer data pipeline with patches, strict validation, linking, content hash; JSON Schemas | ✔ |
| Map generator with Great River channels and edge rivers, lakes, floodplains, lowlands, resources, starts | ✔ |
| District adjacency, placement, planner | ✔ |
| Production queue (reservations, progress ledger, overflow, repeat, ETA, purchase) | ✔ |
| Loyalty and Free Cities; 8 governors with promotions | ✔ |
| Power grids, merit-order dispatch; climate model; sea level; disasters | ✔ |
| Command pipeline, snapshots, state hash, turn processor, baseline AI | ✔ |
| Direct IP host/client, desync heal, reconnect, spectators, LAN beacons | ✔ |
| `ua` CLI (mapgen, validate, simulate, host, join); Godot client skeleton that compiles | ✔ |
| **The Divergence** Future-era fork: locks, leanings, three futures, terraforming spread, Ascension; `ua future` demo | ✔ |
| Depth from Millennia & Shadow Empire: World Currents & Ages, Supply lens and attrition, Industries and goods, the Chronicle | ✔ |
| 111 automated tests | ✔ |

**Exit criteria met:** two independent simulations stay hash-identical for 60 AI turns; three real TCP peers stay in lockstep with zero desyncs;
an injected desync heals within one turn; a 200-turn, 4-player headless game runs at about 3 ms per turn.

---

## M1 — Greybox Prototype (~3 months)

**Goal:** a complete single-player loop on a Small map with greybox art. *Is the city-planning puzzle fun?*

* **Sim:** citizen management (locks, focus); border growth and tile purchase; roads and trade routes (land and river); combat v1
  (melee, ranged, ZOC, fortify, walls, city strike); builder actions (chop, harvest, repair); great people v1; boosts; policy cards and governments v1;
  religion v0 (pantheon + founding); era score with Golden and Dark Ages.
* **Client:** chunked terrain, unit models as placeholders, selection and movement UI with path preview and ETA, city screen with production queue,
  placement lens hover tooltips, notification stack, turn summary, tech and civic trees (read-only graph plus queue), save and load.
* **AI:** expansion planner, district master-plans, basic military defence.
* **Tooling:** float-ban analyzer in the sim, cross-platform golden-hash CI job, Huge-map turn benchmark.
* **Exit:** 10 internal playtesters finish 150-turn games; 70% or more rate "city planning" ≥ 4/5; no determinism failures across Windows, macOS and Linux CI.

## M2 — Vertical Slice (~5 months)

**Goal:** one era band (Ancient → Medieval) at **shippable quality**, plus a late-game "slice" scenario (Industrial power and climate) to prove the arc.

* **Art:** final art direction for 3 civs, 12 districts and their buildings, terrain biomes, Great River water, strategic view, UI skin v1.
* **Systems to final quality:** districts and adjacency, production queue and **queue templates**, loyalty and governors, Great Rivers,
  power and climate (in the late slice scenario), disasters with VFX.
* **QoL:** map tacks (shared), report screens v1 (Empire Overview, City List, Unit List), UI density toggle, colourblind palettes, UI scaling,
  rebinding, **One More Turn**, hotseat.
* **Audio:** music themes with era arrangements for 3 civs.
* **Exit:** external closed playtest (200 players); median session 2+ hours; performance on Steam Deck (40 fps 3D, 60 fps strategic view);
  crash-free sessions ≥ 99%.

## M3 — Multiplayer Beta (~4 months)

**Goal:** Direct IP, LAN and relay multiplayer good enough for weekly community games of 8–12 players.

* Turn modes: simultaneous, **dynamic**, sequential, hybrid timers; pause voting; AI takeover of dropped players; teams with shared vision and tacks.
* NAT: UPnP/PCP port mapping, connection doctor ("your port is closed", reachability test), **relay service** with room codes (open-source server).
* Chaos-test transport (latency, loss, reorder) in CI; reconnect at any phase; spectators with optional delay; in-game chat and pings.
* Late-game management: **provinces**, puppets, empire-wide queue templates, **Outposts**, **Private Enterprise**.
* **Living Governors** (traits from service), **Unit Variants**, **Battle Reports**, **Fog of Strength**; the supply combat penalty (Grand dial).
* Combat v2: naval classes, supply, blockades; air missions and superiority overlay; corps and armies; combined-arms support units.
* **Exit:** 50 community-run 8-player games to turn 150+ with ≥ 98% completing without a stall; median desync heal under 2 s; 0 unrecovered desyncs.

## M4 — Content Complete (~7 months)

**Goal:** every era, system and victory, with 18 civilizations and 20 leaders at launch.

* Religion overhaul (charges, upkeep, state religion, schisms, reformation); diplomacy (agendas, itemized grievances, research agreements, tile and city trades,
  **vassals**, liberation); **World Congress** redesign with player proposals; **espionage** across all eras; Trade Empires; Legends; Hidden Orders; Cataclysm.
* **Initiatives**, **National Character** compass, **World Genesis** preview, **Deep Prehistory** ruins; the Depth Dial in setup (from M2).
* Divergence production: three biome art sets (Engineered Ground, the Bloom, Substrate), per-future city skins, leader portrait evolutions,
  music transformations, Divergence World Congress resolutions, apostate-city events.
* All victory types plus the Victory Dashboard; wonders (about 45) and natural wonders (about 20); minor nations; barbarians and Tribal Clans.
* World Builder; TSL Earth maps (Huge, Giant).
* **Scripting sandbox (Lua)** and workshop integration; modding documentation site generated from schemas.
* AI: full strategic director, diplomacy planner, naval invasions, air campaigns, Congress behaviour; AI soak dashboard.
* **Exit:** all features present; balance soak (1,000 AI games) without degenerate strategies above 35% win rate; every civ wins at least 4% of AI-vs-AI games.

## M5 — Polish & Launch (~4 months)

* Balance passes from closed and open betas; accessibility certification pass (contrast, screen reader, motion).
* **Timelapse replay**, statistics screens, event-sourced replay viewer; achievements; cloud saves (optional).
* Secure multiplayer mode (fog-filtered server-authoritative) for public matchmaking.
* Performance: Huge-map late-game turn under 1.5 s including AI on minimum spec; memory and loading budgets.
* Localization (10 languages); launch on Steam, GOG and itch; Steam Deck verified.

## M6 — Live

Seasonal content (civ packs, scenarios), the Contagion mode, community map and mod spotlights, a balance patch cadence (6 weeks), AI improvements
driven by telemetry, and console ports.

---

## 3. Team (core, scaling at M2)

| Discipline | M1 | M2–M4 | Notes |
|---|---|---|---|
| Design (systems, content, balance) | 2 | 4 | One owns the "explainability" standard for every number |
| Gameplay / sim engineers | 3 | 5 | Determinism owners rotate weekly |
| AI engineers | 1 | 3 | |
| Client / UI engineers | 2 | 4 | |
| Network / tools | 1 | 2 | Relay, CI, World Builder |
| Tech art / art | 2 | 8 | Plus outsourcing for civ and leader packages |
| Audio | 0.5 | 1.5 | |
| QA | 1 | 4 | Automated soak owners plus multiplayer test squads |
| Production / community | 1 | 2 | Community councils for MP, modding and accessibility |

## 4. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cross-platform nondeterminism (compiler, BCL differences) | Medium | High | Fixed-point everywhere, float-ban analyzer, golden-hash CI on 3 OSes, **self-healing resync** so remaining bugs are survivable |
| Godot large-scale rendering limits | Medium | Medium | Chunked terrain, MultiMesh, strategic-view fallback; sim separation keeps an engine swap feasible |
| Late-game turn times balloon | Medium | High | Turn benchmark in CI; incremental caches; AI on worker threads with budgets |
| Scope creep (every requested feature) | High | High | Traceability matrix ([GDD Appendix A](01-game-design-document.md#appendix-a--community-request-traceability)) with milestone tags; modes are optional and ship staged |
| AI quality perceived as weak | High | High | Shared planners, soak dashboards, dedicated AI engineers from M1, public AI tuning data |
| Direct IP NAT friction | High | Medium | UPnP/PCP, connection doctor, relay fallback, LAN beacons |
| Mods break on patches | Medium | Medium | Patch semantics (not file overrides), stable ids, schema versioning, deprecation warnings for one release |
| IP similarity concerns | Low | High | Original names, text and art; legal review of content packs; naming guide (GDD Appendix B) |

## 5. Definition of Done (every feature)

1. Rules in the simulation with unit tests; deterministic by construction.
2. Data-driven where content is involved; schema updated; base data validates.
3. Every number visible in the UI with a source breakdown.
4. AI uses it (or the feature is explicitly marked as unsupported by the AI).
5. Works in hotseat and multiplayer (command-based, no local-only state).
6. Accessible: keyboard path, colourblind-safe, scalable text.
7. Documented in-game (Civilopedia entry generated from data plus a designer blurb).
