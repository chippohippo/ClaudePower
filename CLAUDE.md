# Iron & Empire — Working Memory
## Current milestone: M3 — The Core Loop   Status: done (tag m3) — awaiting human playtest feedback. Next: M4 — Characters & Interest Groups
## Next task: act on the user's playtest feedback, then M4 (read §7, §9 and the M4 entry in §15)
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
## Stack & commands: npm run dev | test | bench | lint:content | typecheck | headless -- --years N --seed S | build-map -- <ne_10m_admin_1_states_provinces.geojson> | build-pops
## Architecture pointers
- modifiers: src/sim/modifiers.ts · commands: src/sim/commands.ts · tick order: src/sim/tick.ts
- world tables (SoA typed arrays): src/sim/world.ts · rng (sfc32): src/sim/rng.ts · calendar (int days from 1936-01-01): src/sim/date.ts
- schemas: src/sim/schemas.ts (register each data file in DATA_SCHEMAS) · saves: src/sim/save.ts (msgpack+gzip, MIGRATIONS)
- worker: src/worker/{sim.worker,bridge,protocol}.ts (owns clock; setup msg once, snapshots ≤10/s) · UI: src/ui (React + Zustand)
- map: scripts/build-map.ts + scripts/map-rules.ts → data/generated/{provinces,map-geometry}.json; 1936 ownership in data/map_1936.json
- pops: src/sim/pops.ts (SoA table, transferPop/merge) · money: src/sim/money.ts (integer cents, Escrow, ledger, budgetLine)
- economy month (src/sim/systems/economy.ts): labour → production orders → pop/state/construction orders → market clear (national, then world residual) → wages/dividends → SoL → budget/monetary → construction → demography/mobility
- core loop: src/sim/systems/core.ts (points, PP, stability, unrest, manpower, auto-develop) · laws: src/sim/laws.ts + data/laws.json
- player commands (validate/apply/preview): src/sim/commands/player.ts · alerts: src/sim/alerts.ts
- session (player, undo, previews, snapshot): src/worker/session.ts · scripted UI playtest: scripts/playtest-germany.mjs
- inspect (UI reports + breakdowns): src/sim/inspect.ts · calibration: tests/calibration/century.test.ts (~45 s)
- world from content: src/sim/setup.ts (createWorld, scope world|europe, CSR adjacency) · renderer: src/map/MapRenderer.ts (render on demand)
## Key constants: STAT_CLAMPS in src/sim/modifiers.ts; WORLD_VERSION in src/sim/world.ts; SPEED_DAYS_PER_SEC in src/sim/speed.ts; TARGET_PROVINCES/EUROPE_WEIGHT/MAJOR_HOME_MIN in scripts/build-map.ts; demography (TFR_*, BIRTH_FACTOR, medicine/schooling curves), mobility/migration rates, LABOUR_SHARE, SPEND_RATE, MONETARY_*, ERA_GROWTH — each at the top of its system file
## Known issues / tuning notes
- Systems in tick.ts not yet built are noops. Demography runs monthly (rates/12) in slot demography_smoothed.
- Tech placeholders until M7: ERA_GROWTH productivity, medicine()/schooling() curves, PMs unlock by year (chosen by profit).
- Cultures/religions are spread uniformly across a country's provinces (no regional distribution yet).
- Calibration is one deterministic run (no randomness in sim yet), so "10% of runs" inflation check = this run.
- Point/PP gains are interim (+5/+4) until leaders/advisors (M4). Points pile up by ~1944: few sinks yet.
- State construction is cheap vs treasury (30 levels ≈ $70–120M vs $5–9B); consider bigger levels or presets.
- Hot loops alias imported consts locally (tsx live-binding getters were 40% of tick time).
- Snapshots send full owner/dev arrays (cheap at 250); switch to changed-table diffs if it grows.
- Colonies owned directly by metropole (no subjects yet). Small 1936 border details ignored (Saar, Danzig, Hatay, Karelia).
- Terrain is lat/lon-box heuristic; ~20 island provinces lack land neighbours (need sea links).
- Map fps checked only in headless software GL (render submit ~1–2 ms); re-check on a real GPU.
- Undo (re-sim from snapshot) not yet implemented.
## Decisions: see docs/decisions.md
## Brief: IRON_AND_EMPIRE_BRIEF_v2.md (text extract of the PDF)
