# Architecture & integration map

Written so other designs/projects can be merged in, or the tree re-engineered, without losing the plot.
Everything below is a seam: swap one side without touching the other.

## Layers (dependencies point down only)
| Layer | Where | Depends on | Notes |
|---|---|---|---|
| Content (data) | `data/**/*.json` | — | Zod-validated. Add content here, not in code. |
| Content build | `scripts/build-*.ts` | data, sim schemas | Generates `data/generated/*` (committed). |
| Sim core | `src/sim/**` | data, generated | Pure TS, no DOM/React. Deterministic (sfc32 RNG in `world.rng`). Runs in a Worker, Node, tests. |
| Session | `src/worker/session.ts` | sim | Player country, undo, previews, snapshot shaping. Pure → testable. |
| Transport | `src/worker/{sim.worker,bridge,protocol}.ts` | session | postMessage protocol (`ToWorker` / `FromWorker`). Replace for netcode/desktop. |
| UI | `src/ui/**`, `src/map/**` | protocol types, sim *data* (defs, laws, igs) | React + Zustand + Pixi. Never mutates the world; only sends Commands. |

## Extension points
- **New system**: `src/sim/systems/<name>.ts`, register in the fixed order in `src/sim/tick.ts`.
- **New player/AI action**: `registerCommand(type, { validate, apply, preview })` (see `src/sim/commands/*`). UI gets greyed reasons + previews for free via `ActionButton`.
- **New tunable number**: a stat read with `countryStat()`/`getStat()`; defaults in `STAT_DEFAULTS` (`src/sim/modifiers.ts`). Laws, traits, privileges, focuses, events all add modifiers to it.
- **New content kinds**: conditions/effects language in `src/sim/script/{schema,eval}.ts` (add a variant to both + `describe*`). Focus trees `data/focuses/*.json`, events `data/events/*.json`, then `npm run build-content`.
- **New world table / field**: add to `src/sim/world.ts`, bump `WORLD_VERSION`, add a migration in `src/sim/save.ts`.
- **New map mode**: colour function in `src/map/colors.ts` + case in `src/ui/MapView.tsx`.

## Merging another project
1. Put it beside this one (`/other/...`) and map its concepts to the table above (data vs sim vs UI).
2. Port **data** first (convert to our JSON schemas or add new schemas in `src/sim/schemas.ts` / `script/content.ts`).
3. Port **rules** as systems/commands; keep money integer-cents through `src/sim/money.ts` and pops through `src/sim/pops.ts`.
4. Port **visuals** into `src/ui`/`src/map`; assets go under `public/` (original or properly licensed only).
5. Run `npm run lint:content && npm test` — calibration and economy sanity tests guard the simulation.

## Invariants (tests enforce)
Determinism per seed · save/load round-trip · money changes only via ledger · budgets balance to the cent ·
population conserved except births/deaths · prices in clamp · §6.4 calibration · content lint clean ·
every focus reachable.
