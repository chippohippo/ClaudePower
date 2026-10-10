# Iron & Empire — Working Memory
## Current milestone: M6 — Diplomacy & War   Status: done (tag m6). Next: M7 — Tech, Ideas & Eras
## Next task: M7 — read §11, §4, §8.1 and the M7 entry in §15. User may merge other projects / restructure: see docs/ARCHITECTURE.md, adapt freely
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
## Stack & commands: npm run dev | test | bench | lint:content | typecheck | headless -- --years N --seed S | build-map -- <ne_10m_admin_1_states_provinces.geojson> | build-pops | build-content (after editing data/focuses|events|flags|ambitions|headlines)
## Architecture pointers
- modifiers: src/sim/modifiers.ts · commands: src/sim/commands.ts · tick order: src/sim/tick.ts
- world tables (SoA typed arrays): src/sim/world.ts · rng (sfc32): src/sim/rng.ts · calendar (int days from 1936-01-01): src/sim/date.ts
- schemas: src/sim/schemas.ts (register each data file in DATA_SCHEMAS) · saves: src/sim/save.ts (msgpack+gzip, MIGRATIONS)
- worker: src/worker/{sim.worker,bridge,protocol}.ts (owns clock; setup msg once, snapshots ≤10/s) · UI: src/ui (React + Zustand)
- map: scripts/build-map.ts + scripts/map-rules.ts → data/generated/{provinces,map-geometry}.json; 1936 ownership in data/map_1936.json
- pops: src/sim/pops.ts (SoA table, transferPop/merge) · money: src/sim/money.ts (integer cents, Escrow, ledger, budgetLine)
- economy month (src/sim/systems/economy.ts): labour → production orders → pop/state/construction orders → market clear (national, then world residual) → wages/dividends → SoL → budget/monetary → construction → demography/mobility
- core loop: src/sim/systems/core.ts (points, PP, stability, unrest, manpower, auto-develop) · laws: src/sim/laws.ts + data/laws.json
- player commands (validate/apply/preview): src/sim/commands/player.ts, commands/politics.ts · alerts: src/sim/alerts.ts
- characters: src/sim/characters.ts (roles, traits→modifiers "char:*", mortality) · IGs: src/sim/igs.ts (+ data/igs.json), systems/igs.ts (clout/approval/radicalism/strikes)
- politics: systems/politics.ts (deaths, succession, elections, coups, ideology drift) · seeding: src/sim/politics-setup.ts · UI: People.tsx, Igs.tsx, Portrait.tsx
- content scripting: src/sim/script/{schema,eval,content,bundle}.ts (conditions/effects, describe*) · engines: systems/{focus,events,ambitions,era}.ts · commands/content.ts
- content: data/focuses/*.json (1 per tree; generic_* combine into tree "generic"), data/events/*.json, flags.json, ambitions.json, headlines.json → data/generated/content.json
- linter: scripts/lint-consistency.ts (in lint:content) · harness: tests/content/focus-harness.test.ts · architecture/merge map: docs/ARCHITECTURE.md
- diplomacy: src/sim/diplomacy.ts (pair table, CB, power) · wars: systems/{armies,combat,wars,diplo-ai,war-ai}.ts · commands/war.ts · UI Diplomacy.tsx (F6), Military.tsx (F7)
- automation flags live in src/sim/automation.ts (leaf module — import cycles made setup re-exports undefined at runtime)
- tech & ideas: src/sim/techs.ts (+ data/techs.json, data/ideas.json; relYear drives productivity/medicine/schooling/PM unlocks) · UI Tech.tsx (F8)
- session (player, undo, previews, snapshot): src/worker/session.ts · scripted UI playtest: scripts/playtest-germany.mjs
- inspect (UI reports + breakdowns): src/sim/inspect.ts · calibration: tests/calibration/century.test.ts (~45 s)
- world from content: src/sim/setup.ts (createWorld, scope world|europe, CSR adjacency) · renderer: src/map/MapRenderer.ts (render on demand)
## Key constants: STAT_CLAMPS in src/sim/modifiers.ts; WORLD_VERSION in src/sim/world.ts; SPEED_DAYS_PER_SEC in src/sim/speed.ts; TARGET_PROVINCES/EUROPE_WEIGHT/MAJOR_HOME_MIN in scripts/build-map.ts; demography (TFR_*, BIRTH_FACTOR, medicine/schooling curves), mobility/migration rates, LABOUR_SHARE, SPEND_RATE, MONETARY_*, ERA_GROWTH — each at the top of its system file
## Known issues / tuning notes
- Systems in tick.ts not yet built are noops. Demography runs monthly (rates/12) in slot demography_smoothed.
- Tech (M7) drives ERA_GROWTH productivity, medicine()/schooling() and PM unlocks via relYear; tune START_LAG/DIFFUSION/AHEAD_HALF in techs.ts.
- Cultures/religions are spread uniformly across a country's provinces (no regional distribution yet).
- Calibration is one deterministic run (no randomness in sim yet), so "10% of runs" inflation check = this run.
- Points: base 3 + head stats + ¼ minister stats + traits; PP base 2 + stability + loyal IGs. Sinks: dev, stability, heirs, appointments, laws.
- Historical leaders can die early by chance (seed 1: Hitler dies May 1936). Consider a grace period for historical heads.
- Focus trees are 1930s-first: 10–25 focuses per major (brief target 40–80) + era stubs; generic modules combined. Add depth in later passes.
- Army quality uses GDP/capita (militaryQuality) until M7 tech; equipment often low (arms undersupplied) — balance in M8.
- War AI: WAR_CHANCE/WAR_RELATIONS/WAR_POWER_EDGE in diplo-ai.ts; China's huge army wins too often.
- State construction is cheap vs treasury (30 levels ≈ $70–120M vs $5–9B); consider bigger levels or presets.
- Hot loops alias imported consts locally (tsx live-binding getters were 40% of tick time).
- Snapshots send full owner/dev arrays (cheap at 250); switch to changed-table diffs if it grows.
- Colonies owned directly by metropole (no subjects yet). Small 1936 border details ignored (Saar, Danzig, Hatay, Karelia).
- Terrain is lat/lon-box heuristic; ~20 island provinces lack land neighbours (need sea links).
- Map fps checked only in headless software GL (render submit ~1–2 ms); re-check on a real GPU.
## Decisions: see docs/decisions.md
## Brief: IRON_AND_EMPIRE_BRIEF_v2.md (text extract of the PDF)
