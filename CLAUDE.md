# Iron & Empire — Working Memory
## Current milestone: M0 — Foundations   Status: done (tag m0). Next: M1 — Map & World
## Next task: M1 — read brief §2, §3.6, §4, §13.1; write scripts/build-map.ts (Natural Earth → ~250 provinces)
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
## Stack & commands: npm run dev | test | bench | lint:content | typecheck | headless -- --years N --seed S
## Architecture pointers
- modifiers: src/sim/modifiers.ts · commands: src/sim/commands.ts · tick order: src/sim/tick.ts
- world tables (SoA typed arrays): src/sim/world.ts · rng (sfc32): src/sim/rng.ts · calendar (int days from 1936-01-01): src/sim/date.ts
- schemas: src/sim/schemas.ts (register each data file in DATA_SCHEMAS) · saves: src/sim/save.ts (msgpack+gzip, MIGRATIONS)
- worker: src/worker/{sim.worker,bridge,protocol}.ts · UI: src/ui (React + Zustand)
## Key constants: STAT_CLAMPS in src/sim/modifiers.ts; WORLD_VERSION in src/sim/world.ts
## Known issues / tuning notes
- Systems in tick.ts are noops; fill in by milestone.
- Worker snapshot is minimal (date, treasury); expand to changed-tables diff in M1.
- Undo (re-sim from snapshot) not yet implemented.
## Decisions: see docs/decisions.md
## Brief: IRON_AND_EMPIRE_BRIEF_v2.md (text extract of the PDF)
