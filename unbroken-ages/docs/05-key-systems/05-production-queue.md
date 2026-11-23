# 5.5 Production Queue + UI

**Code:** [`ProductionSystem.cs`](../../src/UnbrokenAges.Sim/Systems/ProductionSystem.cs) · [`ProductionQueue.cs`](../../src/UnbrokenAges.Sim/State/ProductionQueue.cs) ·
commands in [`Commands.cs`](../../src/UnbrokenAges.Sim/Commands/Commands.cs) · client [`CityPanel.cs`](../../godot/scripts/UI/CityPanel.cs)

## Rules
| Rule | Detail |
|---|---|
| Capacity | `Options.MaxQueueLength` (default 8) items per city |
| Items | Unit · Building · District (with target tile) · Project; Wonders join in M2 |
| **Reservation** | A queued district reserves its tile (`MapGrid.Reservation`). Other cities and other items cannot plan on it, and capacity counts queued districts |
| **Progress ledger** | Partial progress is stored per item key `(kind, def, tile)`, so reordering, switching or removing never wastes production; re-adding the item resumes it |
| Completion | At most **one completion per city per turn**. Leftover production becomes `OverflowProduction` (capped at the finished item's cost) for next turn |
| Bonuses | `CityProductionPercent` by category (District, Unit…) plus `Any` |
| Invalidation | Each turn the front item is re-validated (tech, tile still legal, building still allowed…). Invalid items are removed with `QueueItemInvalidated` and the reason, and the next item gets the production |
| Repeat | `Repeat` items re-enqueue at the back after completing (builder and trader loops) |
| Idle | An empty queue banks production as overflow, capped at `2 × production + 10` |
| Purchase | Units and buildings for gold: `cost × 4 − progress × 4`, minus purchase discounts; completes immediately and removes the queued copy |
| Cost | Base × game speed. Districts: × (1 + 0.25 × era index reached) |

## Turn processing (pseudocode of `Process`)
```
available = production + overflow;  overflow = 0
loop:
    if queue empty: overflow = min(available, 2·production + 10); return
    item = queue[0]
    if Validate(item) fails: emit Invalidated(reason); remove; continue
    progress = ledger[item.key] + available × (1 + bonus%(item.category))
    if progress < cost(item): ledger[item.key] = progress; return
    overflow = min(progress − cost, cost); ledger.remove(item.key); remove(item); Complete(item)
    if item.repeat and still valid: enqueue(item) at back
    return                                   # one completion per turn
```

## ETA estimation (drives the UI)
`Estimate(state, city, productionPerTurn)` walks the queue, simulating carry-over between items and applying category bonuses. It returns
`(turnsToComplete, completesOnTurn)` per item, or `-1` when production is 0. The panel shows `Library   34/90   6 t (T47)`.

## Commands
`Enqueue{city, kind, def, tile, position(-1 = end, 0 = front), repeat}` · `RemoveQueueItem{city, index}` · `MoveQueueItem{city, from, to}` ·
`Purchase{city, kind, def}`. All are validated on the host in multiplayer. The client greys out pending entries until the echo arrives.

## UI (implemented skeleton + target design)
```
┌ Waset · pop 7 ─────────────────────────────────┐
│ 14 Food, 11 Production, 9 Gold, 6 Science …    │
│ Housing 7/10  Amenities 4/4 (Content)          │
│ Districts 2/3   Power ✔ (4 needed)             │
│ Loyalty 88/100 (+6/turn) ▸ breakdown           │
├ PRODUCTION QUEUE ──────────────────────────────┤
│ 1 ⬡ Academy 📍        30/54     3 t (T41)  ≡   │  ← drag handle; 📍 = reserved tile (click to fly camera)
│ 2 ▣ Library            0/90     8 t (T49)  ≡   │
│ 3 ♞ Builder ↻          0/50     4 t (T53)  ≡   │  ← ↻ repeat
│ [▲] [▼] [Remove] [Buy 216◉]                    │
│ [ Add: ⬡ Market Quarter (54)        ▾][Repeat][Add] │
│ Ctrl+Add = insert at front · Shift+click item = buy  │
└────────────────────────────────────────────────┘
```
* Choosing a district from **Add** opens the **placement lens**. Clicking a green tile enqueues it with that tile, and Ctrl inserts it at the front.
* **Queue templates** (M2): save a queue as a template; apply it to selected cities from the City List; templates skip items that are invalid per city.
* **Empire-wide production view** (M2): every city's queue in one sortable table, with drag between cities for units.

## Tests
`Completes_WithOverflow_OneItemPerTurn`, `Reordering_KeepsPartialProgress`, `InvalidatedItems_AreSkippedWithANotification`,
`DistrictCompletion_PlacesTheDistrict`, `RepeatItems_RequeueThemselves`, `Estimates_AccountForCarryover`, `QueueLength_IsCapped`,
`Purchase_SpendsGold_AndCompletesImmediately`, plus placement tests for reservation and capacity.
