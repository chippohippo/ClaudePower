# Autonomous Roadmap (continuation queue)

This file is the hand-off point for autonomous work sessions. Each session takes the **first unchecked item**, implements it in
the simulation with tests, updates the docs (GDD traceability, plan, README test count), runs the full verification below,
commits, pushes to the session branch, and checks the item off here with the commit's one-line summary.

**Verification before every commit:** `dotnet build UnbrokenAges.sln` · `dotnet test UnbrokenAges.sln` (all green) ·
content schema check (`content/schemas`) · `ua validate mods/example-river-trade` · `ua simulate --turns 200` (no crash; note ms/turn) ·
`dotnet build godot/UnbrokenAges.Client.csproj` (then delete `godot/.godot`, `godot/bin`, `godot/obj`).

Rules: keep the Ease Charter (docs/09 §1); no Civ VII-style resets; original names only; deterministic sim (Fx, seeded RNG streams, id-ordered iteration).

## Queue

- [x] **1. Diplomacy core**: war / peace / alliance states, denounce, declare war (with "no surprise wars" option), peace after a minimum war length,
      open borders, itemized decaying grievances, attitude (agenda placeholder + Divergence ideology + grievances + war), Strife pushes from war and peace,
      closed borders for military units at peace, supply attrition only on enemy ground.
- [ ] **2. Combat v1**: melee and ranged attacks, deterministic damage with a `combat` RNG stream, terrain and river modifiers, fortify, flanking and support,
      counters (`strongAgainst`/`weakAgainst`), the out-of-supply penalty, cities with HP and ranged strike, capture → `ChangeOwner`; a combat preview with a full
      breakdown; battle reports in events and the Chronicle.
- [ ] **3. Border growth**: culture-driven tile claims (best adjacent tile up to radius 5) and gold tile purchase.
- [ ] **4. Victory system**: Ascension, Hegemony (all original capitals), Score at the turn limit; victory toggles; game-over event; One More Turn.
- [ ] **5. Living Governors**: experience and data-driven traits earned from where they serve.
- [ ] **6. Outposts**: cheap claims (radius 1, supply source, one resource), with no city screen; promotable to a city.
- [ ] **7. Unit variants**: choose 1 of 2–3 variants at upgrade; `UpgradeUnitCommand` with gold and resource costs.
- [ ] **8. Dynamic turn mode**: phase ordering by war graph in `HostSession`, with tests over sockets.
- [ ] **9. AI v2**: expansion (settlers), builders, war planning (declare war on weak neighbours, attack with odds > 60%, retreat when out of supply), peace.
- [ ] **10. Client**: combat preview tooltip, diplomacy screen skeleton, victory screen, border and war colours.

## Done
- 1. Diplomacy core: `DiplomacySystem`, 5 commands, snapshot v4, closed borders, war-only attrition, 9 tests (120 total).

(see git log for full detail)
