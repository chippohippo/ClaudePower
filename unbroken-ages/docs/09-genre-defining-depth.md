# 09 — Genre-Defining Depth, Civ-Level Ease

*What we take from **Millennia** and **Shadow Empire**, and how we keep the joy and ease of Civilization.*

Millennia's strength is **alternate history**: global ages that bend toward crisis or glory depending on what everyone does, plus economic
production chains. Shadow Empire's strength is **simulation honesty**: logistics that decide wars, leaders who are people, worlds with a geology
and a past. Both games are loved, and both have steep learning curves. Our job is to take the *stories and decisions* those systems create
and leave the *paperwork* behind.

Everything here follows the GDD pillars (P3: depth with clarity; P5: your game, your rules) and the rule against Civ VII-style resets:
**no feature in this document swaps your civilization, resets your progress, or replaces your tech tree.**

---

## 1. The Ease Charter (every borrowed feature must pass)

1. **Automatic by default, editable on demand.** If the system can run itself well, it does. Players override; they are never required to babysit it.
2. **Surfaces, not screens.** A new system appears as a **lens**, a **tooltip line**, a **HUD line** or a row in an existing report. A new mandatory screen is a failure.
3. **At most one new number to watch per system**, and only if it changes a decision.
4. **One-sentence rule, numbers on hover, preview before commit.** If a designer can't explain it in one sentence, it isn't ready.
5. **Decisions, not chores.** If the right action is always the same, automate it (no trucks, no manual routing, no per-pop sliders).
6. **Shortages stall; they never delete.** A unit waiting on Steel holds at 100%; it doesn't vanish from the queue.
7. **Stories on the map.** Every system leaves visible traces: a lens, terrain, a Chronicle line, a leader quote.
8. **The AI plays it, or it ships off by default.**
9. **Late-game turn budget.** Each system may add at most ~10 seconds of average decision time per turn at turn 300 (playtest metric, below).
10. **The Depth Dial decides granularity**, not the designer's enthusiasm.

### The Depth Dial (setup option, three presets, every toggle individually overridable)

| System | **Classic** | **Enhanced** (default) | **Grand Strategy** |
|---|---|---|---|
| World Currents & Ages | Off (ordinary eras) | On | On + crisis-age events with choices |
| Supply | Lens only (informational) | Heal in supply, attrition when cut off in enemy land | + combat penalty out of supply, rail/road depots |
| Industries & goods | Advanced units cost strategic resources directly | Production chains (Steel, Plastics, Electronics) | + regional markets along trade routes |
| The Chronicle | On | On | On + leader biographies |
| Unit variants | Fixed upgrades | Pick 1 of 2–3 variants at upgrade | Light model designer (chassis + 1 module) |
| Living Governors | Fixed governors | Traits from experience | + ageing, retirement, succession |
| Private Enterprise | Off | Opt-in per province | Default on |

*Implementation note:* the systems built so far run at the **Enhanced** preset. The dial's per-system toggles arrive with the setup screen in M2,
as `GameOptions` flags checked at each system's entry point, the same way `ClimateEnabled` and `LoyaltyEnabled` work today.

---

## 2. From Millennia

| Millennia feature | Verdict | Our version (Civ-ease) | Status |
|---|---|---|---|
| **Global ages with variants** (the world bends toward crisis or golden ages) | **Adapt** | **World Ages**: when the first civ enters a new era, the *whole world* enters an age chosen from the currents (An Age of Iron, Ash, Lanterns, Titans or Concord), or an ordinary one. It is world weather: shared modifiers for that era. **Never** a civ swap, a tech-tree swap, or a reset. | ✔ Built |
| **Innovation and Chaos meters** | **Adapt** | **World Currents**: Progress, Strife and Calamity (0–100), pushed by everyone's actions and decaying 3%/turn. One HUD line shows the currents **and a forecast**: "if a new era began now: An Age of Iron". Players can steer history together (make peace, research, build flood defences). | ✔ Built |
| **Production chains and goods** | **Adapt** | **Industries**: Iron + Coal → Steel, Oil → Plastics, Steel + Plastics → Electronics. They run automatically from one empire stockpile with no routing. Advanced units cost goods; a shortage **stalls** rather than deletes. Bottlenecks are named ("Electronics Plant idle: needs Plastics"). | ✔ Built |
| Domains with domain powers to spend | **Adapt (narrowly)** | Six spendable currencies fail Charter rule 3. Instead: **Initiatives**, one pool fed by Era Score, spent on 3–4 *contextual* one-click actions your governors propose ("Emergency Levees", "Forced March", "Grand Survey") | M4 |
| Regions, outposts, vassal towns | **Adapt** | **Outposts**: a cheap claim that holds land, extends supply and harvests one resource, with no city screen. It can be promoted to a city later. Plus **puppets** for captured cities (GDD §4.5). We do *not* split settlements into towns and cities (that would weaken the city-planning heart). | M3 |
| National Spirits (identity picks at milestones) | **Already covered** | Era **dedications** (GDD §6), the **Divergence** (doc 08) and the **National Character** compass (§3) | ✔ / M4 |
| Crisis ages (war, plague) | **Adopt** | An Age of Iron (Strife), An Age of Ash (Calamity, +50% disasters); the Contagion mode adds plague-driven ages | ✔ / post-launch |
| Victory ages (late-game transcendence) | **Already built** | The Divergence and Ascension (doc 08) | ✔ |
| Stacked armies with auto-resolved battles and replays | **Split** | Keep one military unit per tile plus corps (tactical joy). **Adopt the battle replay and report** (§3, Battle Reports) | M3 |
| A separate tech tree per age | **Reject** | Continuous trees plus Era Pacing preserve the unbroken fantasy | — |

## 3. From Shadow Empire

| Shadow Empire feature | Verdict | Our version (Civ-ease) | Status |
|---|---|---|---|
| **Logistics network** (supply points, trucks, roads, rail, HQs) | **Adapt** | **Supply lens**: supply flows from cities (and Garrisons) over land, and from Harbors and River Ports over water. Own territory is cheap, foreign land expensive, and **Great Rivers are highways**. Supplied units heal; units cut off in enemy land suffer attrition. **No trucks, no routing.** Grand dial adds a combat penalty and rail depots. | ✔ Built |
| Procedural planets with real geology and climate | **Adopt** | Our generator already does hydrology, rain shadows and lowlands (doc 05-6). Add **World Genesis**: setup sliders (world age, tectonics, climate) with a live mini-map preview, plus **Deep Prehistory**: ruins of lost civilizations seeded with lore that scouts and archaeologists uncover | M2 / M4 |
| Model and formation designer | **Adapt** | **Unit Variants**: at each upgrade, pick 1 of 2–3 variants with one honest trade-off ("Amphibious: no river-crossing penalty, −10% strength"; "Heavy: +15% strength, −1 move"). Grand dial: a light designer (chassis + one module). The AI uses presets. | M3/M4 |
| Leaders with skills, traits and loyalty; a council | **Adapt** | **Living Governors**: governors earn traits from where they serve ("River-wise" after 15 turns on a Great River, "Levee-builder" after surviving floods, "Borderer" on a contested frontier). Grand dial: they age, retire and are succeeded, with biographies in the Chronicle. No cabinet politics minigame. | ✔ Built (experience, ranks, 9 traits) · ageing M3 |
| Stratagem cards and political points | **Merge** | Into existing policy cards plus **Initiatives** (§2). No second card hand. | M4 |
| Regime profile (ideology axes) | **Adapt** | **National Character** compass: Order↔Liberty, Tradition↔Progress, Martial↔Mercantile. It **drifts from your actions** (no sliders) and feeds Divergence leanings, AI agendas, events and dedications. "Your people have become Martial and Orderly; a Sovereign future would suit them." | M4 |
| Zones with local stockpiles, private economy | **Split** | **Reject** local stockpiles (empire pool, Charter 5). **Adopt Private Enterprise**: idle production and surplus gold attract investors who build cheap commercial buildings automatically, opt-in per province. *Less* micromanagement for wide empires. | M3 |
| Recon and uncertain intelligence | **Adapt** | **Fog of Strength**: unscouted enemy strength shows as a range, and the combat preview shows its confidence ("62–78% win, low confidence") | M3 |
| Detailed combat reports | **Adopt** | **Battle Reports**: every modifier (terrain, river crossing, flanking, supply, counters), a one-line summary, and Chronicle entries for decisive battles | M3 |
| Feats, biographies, the story of a regime | **Adopt** | **The Chronicle**: a dated, auto-written history ("2340 BC: Egypt founds Abydos."). Ages, eras, divergences, drowned coasts, armies lost to attrition | ✔ Built |

---

## 4. What we built in this iteration

### 4.1 World Currents & World Ages: `Systems/WorldSystem.cs`, data `world.json`
* **Currents** (0–100) are pushed by events, all data-driven (`worldRules.pushes`):

| Current | Pushed by |
|---|---|
| Progress | tech +1.5, civic +1, entering an era +3, a Divergence chosen +5 |
| Strife | military unit trained +1, city flips +5, independence +6, Bloom encroachment +1, army lost to attrition +2 (wars and peace treaties join in M3) |
| Calamity | disaster +4, drowned tile +1.5, starvation +2, climate phase +12 |

  They decay 3% per turn, so the world forgets slowly.
* **Ages**: when the *first* civ enters a new era, the highest-priority age whose conditions match becomes that era's age for everyone:

| Age | Condition | Effect (all cities) |
|---|---|---|
| An Age of Ash | Calamity ≥ 60 | +20% production toward buildings (rebuilding), −10% food, **+50% disaster chance** |
| An Age of Titans | Progress ≥ 70 and Calamity ≥ 35 (Industrial+) | +20% production, **+50% emissions** (it feeds the climate crisis) |
| An Age of Iron | Strife ≥ 60 | +25% unit production, −2 loyalty, −1 amenity |
| An Age of Lanterns | Progress ≥ 55, Strife ≤ 40 | +10% science, +10% culture |
| An Age of Concord | Strife ≤ 15, Progress ≥ 25 | +1 amenity, +15% gold |

* **Ease surface:** one HUD line, `An Age of Lanterns   Progress 61 · Strife 22 · Calamity 9   → if a new era began now: An Age of Lanterns`.
  A full-screen card with the narration appears once per era. Everything goes through the shared modifier pipeline, so tooltips show "+10% Science — An Age of Lanterns (world)".
* **Why it's fun:** history differs every game, players share a weather they can push (an arms race *causes* an Age of Iron), and it plugs into existing systems (disasters, emissions, loyalty).

### 4.2 Supply: `Systems/SupplySystem.cs`
* Land supply budget at each city is **10** (+4 per Garrison or Airfield). Each tile costs **2** in own or team land, **3** neutral, **5** foreign, +1 rough (hills, woods). **Great River tiles cost 1.**
* Sea supply from Harbors and River Ports has budget **12** over coast, lake and river (+1 on ocean). Land next to water with ≥ 2 supply left counts as a **beachhead**.
* Each turn: supplied military units heal **+10 HP**. Units **cut off in foreign territory or at sea** lose **10 HP**, and a unit at 0 is lost (`UnitLostToAttrition`, a Chronicle line, +2 Strife). Cut off at home or in the wilds: no healing, no loss.
* **Ease surface:** the **L** key toggles the supply lens (green depth shading, red markers on cut-off units). No new screen, no new currency.
* **Why it's fun:** geography matters in war. River civilizations project force inland, deep invasions need Garrisons and ports, and raiding a supply hub is a real tactic.

### 4.3 Industries & goods: `Systems/IndustrySystem.cs`, data `industry.json`
* **Steel Mill** (Industrialization): 1 Iron + 1 Coal → 2 Steel (coal-fired, no power needed, +1 CO₂). **Refinery** (Refining): 1 Oil → 2 Plastics.
  **Electronics Plant** (Rocketry, needs power): 1 Steel + 1 Plastics → 2 Electronics.
* Goods live in the empire stockpile (cap 100). **Tanks need Steel. Drones, EW platoons and Exoframes need Electronics.** Divergence units do too, except the Symbiont's, which are *grown*, not built (asymmetry for free).
* Enqueueing a unit checks you can afford it ("Needs 10 Iron (have 4)"). If the stockpile drops before completion, the item **holds at 100%** (`ProductionStalled`) and completes as soon as goods arrive.
* **Ease surface:** the Industry tab in the Empire Overview lists each chain with ✔/✖ and the plain-language reason (`IndustrySystem.ProcessTurn(s, commit: false)` is the dry run that feeds it).

### 4.4 The Chronicle: `Systems/ChronicleSystem.cs`, templates in `world.json`
* Data templates turn events into dated lines; `oncePerPlayer` keeps it to firsts ("The sea claims the first of Egypt's lowlands") and `requiresPlayer` skips storms in empty wilderness.
  The calendar runs 4000 BC → AD 2000 with shrinking years per turn, scaled by game speed.
* Recorded **inside the command pipeline**, so every multiplayer peer writes the same book. It is stored in saves (snapshot v3).
* **Ease surface:** the **C** key opens the Chronicle (yours in bold, the world's in italics). It is exported with the timelapse at game end.
* Real output from `ua simulate`:
  ```
  4000 BC: Egypt founds Waset.
  475 BC: Venice enters the Classical Era.
  475 BC: The world enters the Classical Era in an ordinary age.
  AD 1380: The world enters the Medieval Era in an ordinary age.
  ```

### 4.5 Living Governors: `Systems/GovernorSystem.cs`, data `governors.json` → `governorTraits`
Governors gain experience and earn up to three traits from where they serve (see [05/02](05-key-systems/02-loyalty-governors.md#living-governors-experience-and-traits)).
It is fully automatic, in keeping with the Ease Charter: nothing to click, and the city panel names the next trait and its progress.

### 4.6 Tests (14 new, 111 total)
`Currents_ArePushedByEvents_AndDecay`, `ANewEra_BeginsTheAgeTheCurrentsPointTo_ForEveryone`, `AnAgeOfAsh_MakesDisastersLikelier`,
`Supply_FlowsFarther_AlongGreatRivers`, `Garrisons_ExtendSupply`, `Ports_SupplyTheSea_AndLandBeachheads`, `CutOffArmies_SufferAttrition_WhileSuppliedOnesHeal`,
`Industries_TurnStockpilesIntoGoods_Automatically`, `DryRun_DoesNotTouchTheStockpile`, `Units_ThatNeedGoods_WaitAtFullProgress_InsteadOfVanishing`,
`Calendar_FollowsTheDocumentedSchedule`, `FoundingACity_WritesHistory_OnceEvenWhenTheEventListIsReused`, `OncePerPlayerEntries_RecordOnlyTheFirstTime`,
`WorldAndChronicle_SurviveSnapshots`.

---

## 5. How it all interlocks

```
 Great Rivers ──► supply highways ──► where wars can be fought ──► attrition ──► Strife ─┐
 Power grids ───► Electronics Plants ──► drones / exoframes ─────► military buildup ─────┤
 Emissions ─────► climate phases ─────► drowned coasts, disasters ──► Calamity ──────────┼─► World Age of the next era
 Research ──────────────────────────────────────────────────────────► Progress ─────────┘        │
                                                                                                 ├─► shared modifiers, disaster odds, emissions
 Everything ──► the Chronicle (your history)                                                     └─► the Chronicle (the world's history)
 Your history ──► Divergence leanings (+ National Character, M4) ──► which future you become (doc 08)
```

## 6. Ease metrics (playtest gates per milestone)

| Metric | Target |
|---|---|
| Median decision time per turn at T300 (Enhanced) | ≤ Civ VI baseline + 15% |
| Share of notifications that need action | ≥ 60% (the rest batched into the turn summary) |
| "I understood why that happened" (post-game survey per system) | ≥ 80% |
| Tooltip coverage of every number on screen | 100% (automated UI audit) |
| New-player completion of the first 100 turns without a guide | ≥ 85% |
| AI competence per system (soak telemetry) | AI uses supply, industries and ages within 10% of expert-bot baselines |

## 7. Explicitly rejected (and why)

| Idea | Why not |
|---|---|
| Logistics trucks and manual supply points | Chore, not decision (Charter 5) |
| Per-zone stockpiles and resource hauling | Turns the economy into accounting; empire pool plus named bottlenecks keeps the decision |
| Six spendable domain currencies | Too many numbers (Charter 3); folded into Initiatives |
| Age transitions that change your civ or tech tree | Violates the core promise (no Civ VII resets) |
| Stack-of-doom armies | Loses the tactical map puzzle; corps plus battle reports give the readability |
| Cabinet politics minigame | Loyalty, governors and National Character already carry internal politics |
| Mandatory unit designer | Spreadsheet time; variants deliver the identity in one click |
