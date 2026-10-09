# Iron & Empire — Working Memory
## Current milestone: M1 — Map & World   Status: done (tag m1). Next: M2 — Population & Economy
## Next task: M2 — read brief §6, §8; write scripts/build-pops.ts and the 1936 country table
## Golden rules
1. One milestone at a time; never leave the build broken.
2. Everything is a Modifier (getStat for tooltips/explain/AI).
3. Everything the player/AI does is a Command (validate → apply).
4. Content is data (validated JSON in data/), logic is code; never hard-code tags.
5. Generate bulk data with scripts; commit output to data/generated.
6. Small files, one system each (src/sim/systems/<name>.ts < ~400 lines + test).
7. Tests are the spec; tune constants, never calibration assertions.
8. Log decisions in docs/decisions.md, short.
9. Quiet output; minimal reporters.
10. When in doubt, simpler mechanic; note it.
11. Original names only; no Paradox names/assets/text.
## Stack & commands: npm run dev | test | bench | lint:content | typecheck | headless -- --years N --seed S | build-map -- <ne_10m_admin_1_states_provinces.geojson>
## Architecture pointers
- modifiers: src/sim/modifiers.ts · commands: src/sim/commands.ts · tick order: src/sim/tick.ts
- world tables (SoA typed arrays): src/sim/world.ts · rng (sfc32): src/sim/rng.ts · calendar (int days from 1936-01-01): src/sim/date.ts
- schemas: src/sim/schemas.ts (register each data file in DATA_SCHEMAS) · saves: src/sim/save.ts (msgpack+gzip, MIGRATIONS)
- worker: src/worker/{sim.worker,bridge,protocol}.ts (owns clock; setup msg once, snapshots ≤10/s) · UI: src/ui (React + Zustand)
- map: scripts/build-map.ts + scripts/map-rules.ts → data/generated/{provinces,map-geometry}.json; 1936 ownership in data/map_1936.json
- world from content: src/sim/setup.ts (createWorld, scope world|europe, CSR adjacency) · renderer: src/map/MapRenderer.ts (render on demand)
## Key constants: STAT_CLAMPS in src/sim/modifiers.ts; WORLD_VERSION in src/sim/world.ts; SPEED_DAYS_PER_SEC in src/sim/speed.ts; TARGET_PROVINCES/EUROPE_WEIGHT/MAJOR_HOME_MIN in scripts/build-map.ts
## Known issues / tuning notes
- Systems in tick.ts are noops; fill in by milestone.
- Snapshots send full owner/dev arrays (cheap at 250); switch to changed-table diffs if it grows.
- Colonies owned directly by metropole (no subjects yet). Small 1936 border details ignored (Saar, Danzig, Hatay, Karelia).
- Terrain is lat/lon-box heuristic; ~20 island provinces lack land neighbours (need sea links).
- Map fps checked only in headless software GL (render submit ~1–2 ms); re-check on a real GPU.
- Undo (re-sim from snapshot) not yet implemented.
## Decisions: see docs/decisions.md
## Brief: IRON_AND_EMPIRE_BRIEF_v2.md (text extract of the PDF)
