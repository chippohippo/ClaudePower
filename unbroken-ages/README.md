# Unbroken Ages

*One people. Every age.* An original turn-based 4X game that keeps the systems Civilization VI players
love (districts and adjacency, separate tech and civic trees, loyalty, governors, climate and power,
builders with charges), adds the features players have asked for over the years, and does not adopt
Civilization VII's age resets or civ-swapping.

> **Working title.** Every name, civilization ability, governor, district name and asset in this
> project is original. Civilization VI is cited only as the design reference point the brief calls
> for. See the IP note in [the GDD appendix](docs/01-game-design-document.md#appendix-b--naming--ip-hygiene).

## What's in this repository

| Path | What it is |
|---|---|
| [`docs/`](docs/) | The seven design deliverables (vision → architecture → schemas → plan → systems → UI → modding) |
| [`src/UnbrokenAges.Sim`](src/UnbrokenAges.Sim) | **Deterministic simulation core** (pure C#/.NET 8, no engine types, no floats) |
| [`src/UnbrokenAges.Net`](src/UnbrokenAges.Net) | **Multiplayer layer**: Direct IP TCP transport, LAN discovery, authoritative host and client sessions |
| [`content/base`](content/base) | The base game, written as a mod in JSON (districts, adjacency, governors, power plants, climate…) |
| [`content/schemas`](content/schemas) | JSON Schemas for content files and `mod.json` (editor autocomplete and validation) |
| [`mods/example-river-trade`](mods/example-river-trade) | Example mod showing add / patch / `$append` against the base game |
| [`godot/`](godot) | Godot 4.3 (.NET) presentation client: hex map renderer, placement lens, city panel and production queue, lobby |
| [`tools/UnbrokenAges.Tools`](tools/UnbrokenAges.Tools) | `ua` CLI: map preview, mod validator, headless soak sim, dedicated server, bot client |
| [`tests/`](tests) | 155 tests: systems, determinism, snapshots, mods, real-socket multiplayer, the Divergence, world ages, supply, industry, chronicle |

## Implemented and tested so far (milestone M0, "foundations")

* **District adjacency and placement**: data-driven rules, unique-district inheritance, provided adjacency
  (e.g. the Civic Plaza), "N more for +1" hints, neighbour deltas, a planner shared by the AI and the placement lens.
* **Production queue**: tile reservations for queued districts, partial progress kept when reordering, overflow,
  repeat items, invalid items skipped with a notification, per-item completion-turn estimates, gold purchase.
* **Loyalty and governors**: the documented pressure formula with a breakdown and turns-to-flip, Free Cities,
  a settling-in grace period; 8 original governors with promotion trees and establishment time.
* **Power and climate**: union-find power grids, merit-order dispatch (renewables first), fuel stockpiles,
  CO₂ → temperature with thermal lag → 7 phases → sea-level bands, flood barriers, disasters, forest carbon sinks.
* **Map generation with navigable rivers**: Great River channel tiles that boats can sail inland, plus classic
  edge rivers traced on the hex-corner graph, floodplains, lakes, lowlands, resources, start positions.
* **The Divergence (Future-era tech fork)**: after *the Threshold*, commit to **Sovereign**, **Symbiont** or **Discarnate**, and the other branches lock forever.
  Your history makes one doctrine cheaper. Each future remakes the Earth (engineered grids, a bioluminescent Bloom that crosses borders, black Substrate) and ends in
  an Ascension victory. See [08-divergence-tech-tree.md](docs/08-divergence-tech-tree.md) and run `ua future`.
* **Depth from Millennia & Shadow Empire, with Civ's ease** ([09](docs/09-genre-defining-depth.md)): **World Currents & Ages**
  (Progress, Strife and Calamity steer each era into an Age of Iron, Ash, Lanterns, Titans or Concord for the whole world; no civ swaps), a **supply lens** (rivers are
  highways; cut-off armies suffer attrition), **industries** (Steel, Plastics, Electronics, fully automatic), and **the Chronicle**, an auto-written dated history.
* **Diplomacy core**: war, peace, denunciation, open borders, closed borders for armies, itemized decaying grievances, and attitudes shown as named lines
  ([05/08](docs/05-key-systems/08-diplomacy.md)).
* **Combat v1**: melee and ranged attacks, terrain, rivers, fortification, flanking, unit counters, besieging and capturing cities, and a preview
  that lists every modifier ([05/09](docs/05-key-systems/09-combat.md)).
* **Border growth**: culture claims the most valuable adjacent tile (up to 5 out), or buy one with gold; the next tile is always previewed
  ([05/10](docs/05-key-systems/10-borders.md)).
* **Living Governors**: governors gain experience and earn up to three traits from where they serve ("River-wise", "Borderer",
  "Levee-builder"…), which travel with them ([05/02](docs/05-key-systems/02-loyalty-governors.md#living-governors-experience-and-traits)).
* **Victory**: Ascension, Hegemony (every original capital, or 60% of the world's people and land) and an itemized Score at the turn limit;
  each can be toggled; elimination; One More Turn ([05/11](docs/05-key-systems/11-victory.md)).
* **Direct IP multiplayer**: authoritative sequencing, issuer rewriting (anti-spoofing), per-turn state hashes,
  automatic desync healing with snapshots, reconnect tokens, spectators, content-hash checks for mod mismatches, LAN beacons.

## Quick start

```bash
# .NET 8 SDK required
dotnet test                                        # 155 tests, ~2 s
dotnet run --project tools/UnbrokenAges.Tools -- mapgen --seed 7 --size MAPSIZE_STANDARD
dotnet run --project tools/UnbrokenAges.Tools -- simulate --turns 200 --players 4
dotnet run --project tools/UnbrokenAges.Tools -- validate mods/example-river-trade
dotnet run --project tools/UnbrokenAges.Tools -- future --turns 150     # three futures remake one continent

# Direct IP: a dedicated server and a headless bot client in two terminals
dotnet run --project tools/UnbrokenAges.Tools -- host --port 47620 --humans 1 --ai 2
dotnet run --project tools/UnbrokenAges.Tools -- join 127.0.0.1:47620 --name Bot

# Client: open godot/project.godot in Godot 4.3+ (.NET edition) and press Play.
```

## Documentation map

1. [Game Design Document](docs/01-game-design-document.md): vision, pillars, every system, community-request traceability
2. [Technical Architecture](docs/02-technical-architecture.md): engine choice, layering, determinism, networking, data, AI, performance
3. [Data Schemas](docs/03-data-schemas.md): every content type, with real examples and planned schemas
4. [Implementation Plan](docs/04-implementation-plan.md): milestones M0–M6, exit criteria, team, risks
5. [Key Systems](docs/05-key-systems/README.md): adjacency, loyalty and governors, climate and power, networking, production queue, map generation
6. [UI/UX Wireframes](docs/06-ui-ux-wireframes.md): city view, empire overview, diplomacy, tech tree, lobby, placement lens
7. [Modding](docs/07-modding.md): philosophy, layering, example mod, scripting sandbox, workshop
8. [The Divergence](docs/08-divergence-tech-tree.md): the Future-era tech fork (Sovereign / Symbiont / Discarnate) and the remade Earth
9. [Genre-Defining Depth](docs/09-genre-defining-depth.md): what we take from Millennia and Shadow Empire, held to Civ's ease (Ease Charter, Depth Dial)
