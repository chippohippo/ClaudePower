# 5.8 Diplomacy Core: War, Peace, Borders, Grievances, Attitude

**Code:** [`DiplomacySystem.cs`](../../src/UnbrokenAges.Sim/Systems/DiplomacySystem.cs) · [`DiplomacyCommands.cs`](../../src/UnbrokenAges.Sim/Commands/DiplomacyCommands.cs) ·
state [`Diplomacy.cs`](../../src/UnbrokenAges.Sim/State/Diplomacy.cs) · tests [`DiplomacyTests.cs`](../../tests/UnbrokenAges.Tests/DiplomacyTests.cs)

## Rules
| Action | Rule | Consequence |
|---|---|---|
| **Denounce** | Anyone except a teammate | Target holds a 5-point grievance; it counts as formal notice of war for 5–30 turns |
| **Declare war** | Not at war, not allied, not a teammate, no peace treaty from the last 10 turns. Option **No surprise wars**: requires a denunciation ≥ 5 turns earlier | **Formal** (denounced 5–30 turns before): 15 grievance to the target, 4 to every witness. **Surprise**: 40 and 10. +10 world Strife. Open borders cancelled |
| **Propose / accept peace** | After ≥ 10 turns of war; the other side must accept | Peace treaty (no new war for 10 turns); **armies inside the other's land walk home**; −8 Strife |
| **Open borders** | One-way grant, revocable, not during war | Grantee's military may cross the grantor's land; revoking evicts them |
| **Teams / alliances** | Teammates can never fight; Free Cities are hostile to everyone | |

**Closed borders:** military units cannot enter foreign land without war, an alliance or open borders (`Movement.EnterCost`).
**Supply:** attrition now applies only on the ground of civs you are **at war** with, so peacetime passage under open borders is safe.

## Grievances (fair, visible, fading)
Each grievance is an entry: holder, against, amount, turn and **reason** ("Surprise war", "Took Abydos through cultural pressure", "The Bloom spreads
into our land", "Warmongering against Venice"). Every entry loses 1 point per turn. Sources so far: war declarations (target and witnesses), denunciation,
**cultural annexation** (loyalty flips, 10), **Bloom encroachment** (2 per tile, against the responsible Symbiont civ).

## Attitude = a visible sum of named lines
```
At war                              −20     Allies +20 · Teammates +30
Denounced us (within 30 turns)       −8
Grievances                          −Σ/5
Ideology (Divergence)            +6 / −8    same future / rival future (doc 08)
Agenda likes (each)                  +6     e.g. Taizu "Civil Over Martial": HighScience, Peaceful
Agenda dislikes (each)               −8     e.g. Warmonger (declared a war in the last 50 turns)
```
Agenda tags the engine evaluates today: `HighScience`, `Peaceful`, `Warmonger`, `HighLoyalty`, `CitiesInRevolt`. Unknown tags (e.g. `TradePartner`, which waits
for the trade system) count as neutral, so data can name them early.

Goodwill mirrors grievances: an itemized, fading list of what a people remembers in your favour (a fair deal, a city liberated, an
ally who answered its call to arms, refugees taken in). New attitude lines:
```
Goodwill                           +Σ/5 (at most +20)
Trading partners                     +3     a trade route runs between you
A common foe                         +6     both at war with the same great power
```

## Deals (GDD §8.3)
**Code:** [`DealSystem.cs`](../../src/UnbrokenAges.Sim/Systems/DealSystem.cs) · `ProposeDealCommand`, `RespondDealCommand` · tests [`DealTests.cs`](../../tests/UnbrokenAges.Tests/DealTests.cs)

One civilization puts an offer on the table; the other accepts or rejects it within five turns. Everything is checked again on
acceptance and applied at once.

| Item | Given by | Effect |
|---|---|---|
| Gold | one side | paid now |
| Gold per turn | one side | paid every turn for 30 turns; a payer who cannot pay breaks it (a grievance) |
| Favor | one side | Diplomatic Favor (trade your votes) |
| Strategic resource | one side | from the stockpile |
| City | one side | ceded (never a capital, never the last city) |
| Open borders | one side | passage for the other's armies |
| Peace | both | ends the war (after the minimum war length) |
| Alliance | both | passage both ways, no war between them, and a **call to arms**: when either is attacked, the other may answer with a *defensive war*, which needs no denunciation and earns no warmonger's reputation. At most two alliances each; leaving one is a grievance (`LeaveAllianceCommand`) |
| Research agreement | both | each pays 60 + 40 × era gold; after 20 turns each gains 60% of the cost of the cheapest technology it could research |

**How a leader weighs a deal** (`DealSystem.Value`, in gold): what it receives minus what it gives. Resources are dear when its own
stock is low and cheap at the cap; a city is worth 60 + 30 per citizen + 40 per district (+200 for an original capital), and giving
one costs double unless it goes back to its founders; peace is worth 60+ when losing or weary and −150 or less when clearly winning a
young war; an alliance is refused below attitude +10; a research agreement is refused below attitude 0. It accepts when the value
reaches **−2 × attitude** (friends forgive a small loss, the resentful want a premium). `DealSystem.GoldToBalance` is the
"what would make this work" answer: the gold that would tip the scales, or −1 if none would. The deal screen and the AI read
the same functions, so the verdict a player previews is the one the AI reaches.

## Liberation
`LiberateCityCommand` returns a city to the people who founded it (alive, and not at war with you): their grievances against you
are wiped, they hold 50 goodwill, every other great power 5, and the first liberation of a city earns a **diplomatic victory point**
and 3 era score. A liberated original capital becomes its people's capital again.

## AI
Peace: see [05/13](13-ai.md). Diplomacy beyond war and peace ([05/13 §Diplomacy](13-ai.md#diplomacy)): it answers offers with the
deal screen's verdict, makes one offer a turn, answers calls to arms, opens borders to friends, denounces those it resents
(attitude −20 or lower), leaves soured alliances and liberates cities for friends. It no longer starts wars on friends, and it
counts a rival's free allies (half their strength) before attacking.

## Next
Vassals, tile swaps, joint wars and vote trading in deals; the client's deal table (the sim API is complete).
