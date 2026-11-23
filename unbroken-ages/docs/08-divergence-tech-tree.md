# 08 — The Divergence: the Future-Era Tech Tree

> *"For ten thousand years we changed the world a little and ourselves not at all. That arithmetic has run out."*
> — The Threshold

At the top of the technology tree humanity **forks**. Every civilization researches the shared **Threshold**. Then it commits
to one of three **doctrines**, and the other two branches lock for the rest of the game. Each doctrine is a *rational* answer to the
same late-game crisis (a hotter, drowning, crowded planet), each is a dystopia when seen from outside, and each **physically remakes
the Earth**. By the end of a long game the map no longer looks like Earth: pale engineered grids, bioluminescent overgrowth that
crosses borders, and plains of black, humming glass.

The idea is in the spirit of the *Beyond Earth* affinities, but it is built for **our** premise. It happens on Earth, to a civilization you
have carried since 4000 BC, and it grows out of what you built. This is not a civ swap: you are still Egypt, and your history decides
what Egypt becomes.

**Code:** [`DivergenceSystem.cs`](../src/UnbrokenAges.Sim/Systems/DivergenceSystem.cs) · data [`divergence.json`](../content/base/data/divergence.json) ·
client [`DivergencePanel.cs`](../godot/scripts/UI/DivergencePanel.cs) · tests [`DivergenceTests.cs`](../tests/UnbrokenAges.Tests/DivergenceTests.cs) · demo `ua future`

---

## 1. Shape of the tree

```
Information era ──► Robotics ─┐
                Renewable Energy ┴─► THE THRESHOLD (shared) ──┬──► The Sovereign Charter ─────► [Sovereign branch] ──► The Eternal Bastion ★
                                                              │       (doctrine)
                                                              ├──► The Grafting Accord ───────► [Symbiont branch] ──► The Chorus ★
                                                              │       (doctrine)
                                                              └──► The Discarnation Edict ────► [Discarnate branch] ─► The Last Upload ★
                                                                      (doctrine)
 Each branch:  doctrine ─┬─► tier-1 A ──► tier-2 A ─┐
                         └─► tier-1 B ──► tier-2 B ─┴─► tier-3 (unlocks the Ascension project ★)
 + one branch civic (after Environmentalism) available only to the committed
```

**The lock rule** (one line in `DivergenceSystem.IsAvailable`): a node with a divergence is available only if *you are committed to it*,
or it is that divergence's **doctrine** and you are uncommitted. Researching a doctrine commits you, and **the other branches' techs, civics,
units, buildings, improvements and Ascension lock forever**. The tooltip says *"Locked forever: your people became the Sovereign."*

## 2. Your history chooses with you (leanings)

Before the Threshold, every civilization accumulates **leanings** from what it actually did. Each doctrine costs up to **45% less**
in proportion to your leaning toward it (`cost × (1 − 0.45 × share)`). The Divergence screen shows the bars and their sources from the first era on,
so you can see your future forming and steer it.

| Sovereign (control) | Symbiont (adaptation) | Discarnate (transcendence) |
|---|---|---|
| Flood Barriers raised against the sea (×6) | Woods and rainforest left standing in your borders (×0.5 per tile) | Research Labs (×4) |
| A Civic Plaza: a strong central state (×4) | Renewable power plants (×4) | Nuclear plants (×5), coal plants (×1) |
| Garrisons and airfields (×2) | Sanctuaries (×2) | Cumulative emissions: "already at home in a hotter world" |
| Dams, canals, aqueducts: a habit of reshaping land (×2) | A large, well-fed population (×0.25 per pop) | Academies (×2), Foundries (×1) |
| City walls (×1) | | |

The AI commits to `argmax(leaning share × leader personality)`. Thutmose's martial streak tilts toward the Sovereign, and Emperor Taizu's scholarship
tilts toward the Discarnate. A Venice that kept its forests and built tidal power becomes the Grafted. Every civ's future is **rational for that civ**.

---

## 3. The three futures

### 3.1 The Sovereign Path: *"Humanity will not change. The world will."*

**The promise.** The species that survived ten thousand years does not need redesigning; the planet does. Seal the coasts, grade the land,
govern the sky, and keep the human being exactly as it is.

**The price.** Every child is registered at conception. Every acre is graded and sealed. The sky is white, the sea is walled, and "wild"
survives only in museums.

| Mechanic | Effect |
|---|---|
| On commitment (all cities) | +4 Loyalty, +1 Amenity, +15% Production, **−10% Science** (licensed inquiry), **immune to all disasters** (weather control) |
| Terraforming | **Arcology Spire** cities grade 2 tiles per turn within 4 into **Engineered Ground** (2 Food, 2 Production, 1 Gold, Appeal −2). Unclaimed land is slowly graded too (15‰). Builders lay **Reclamation Grids** anywhere in your borders |
| The sea | **Total Reclamation**: lowlands are walled (flood-protected), and **each Arcology city rebuilds one drowned tile per turn** as dry Engineered Ground |
| Climate | **Renew the Stratospheric Veil** (repeatable): −0.3 °C at once. The climate drifts back toward equilibrium (*termination shock*), so **the Veil must be renewed for ever** |
| Society | **Genome Registry** building: +6 Loyalty, +1 Amenity, **−2 Science**. Civic **Compliance Codes**: +2 Amenities, −10% Culture. *"Every citizen is free to do anything that is permitted."* |
| Military | Warden Legion (sealed-armour humans), Mirror Lancer (focuses sunlight the sky no longer receives), Bastion Strider (a walking fortress, crew of twelve, all registered). Tags `Augmented`: **beat Machines, lose to Living** |
| Ascension ★ | **The Eternal Bastion**: seal humanity, unchanged, inside a planet built to keep it. Requires 10% of the world's land as Engineered Ground |

| Tech | Quote |
|---|---|
| The Sovereign Charter | *We will not be edited. We will edit everything else.* |
| Genome Registry | *A child is a citizen when the Registry says so. The Registry has never been wrong; that is what the Registry is for.* |
| Stratospheric Veil | *We gave up the blue sky to keep the coastline. Most people agree it was a fair trade. Most people were born after.* |
| Total Reclamation | *The sea took the delta in our grandparents' time. We have taken it back and paved it, so it cannot leave again.* |
| Arcology Doctrine | *Outside is for maintenance crews.* |
| The Eternal Bastion | *Let the future be exactly like this, forever.* |

**How it looks:** pale grey-white grids with teal lighting; domes and spires; the sky slowly turns milk-white as the Veil thickens; coastlines are
straight sea walls; rivers run in concrete channels. Leader portrait: the same face in a sealed collar. Music: your civ's theme as a strict, quantized choral hymn.

### 3.2 The Symbiont Path: *"We stopped fighting the garden. We became it."*

**The promise.** The biosphere has four billion years of solutions. Splice them into ourselves: skin that feeds on light, lungs that tolerate heat, a
mycelial web that shares water, food and calm. Adapt, and the crisis ends.

**The price.** Their children are green at the temples and rarely say "I". The Bloom does not respect borders, and neither, increasingly, do their thoughts.

| Mechanic | Effect |
|---|---|
| On commitment | Citizens eat **25% less** (another −25% with Chloroplast Splicing), +3 Housing, **+50% loyalty pressure** on neighbours (the Chorus pulls), +10% Food |
| Terraforming | **Bloom Heart** cities seed **the Bloom** (2 Food, 1 Production, 1 Faith; counts as Woods) within 3. The Bloom then **spreads on its own (40‰ per tile per turn), across any border**, absorbing woods and farms. Builders plant **Grafted Groves** |
| Climate | Each Bloom tile absorbs 10× what a forest does. **The Grafted literally heal the sky**: in the demo, CO₂ fell back to pre-industrial levels |
| Society | Splicing Vats (+5 Science, +2 Food), Mycelial Commons (+6 Housing, +2 Amenities). Civic **The Shared Breath**: *"The Chorus does not punish dissent. It digests it."* The Chorus tech gives +6 Loyalty everywhere |
| Military | Grafted Behemoth (heals in the Bloom), Spore Drifter (air), Tidal Leviathan (sails oceans **and Great Rivers**). Tags `Living`: **beat Augmented, lose to Machines** |
| Ascension ★ | **The Chorus Wakes**: the Bloom and the Grafted become one continuous mind. Requires 10% of world land in Bloom |

| Tech | Quote |
|---|---|
| The Grafting Accord | *We stopped fighting the forest the day we agreed to become part of it.* |
| Chloroplast Splicing | *Our children are a little green at the temples now. They are rarely hungry, and they love the sun in a way that frightens their grandparents.* |
| Mycelial Networks | *The fungus under the city carries our water, our waste and, lately, our dreams. Nobody voted on the last part.* |
| Tidal Grafting | *When the sea rose we did not build walls. We grew reefs, and gills, and stayed.* |
| Beast-Shaping | *The war-forms do not hate anyone. They were not grown with the capacity.* |
| The Chorus | *"I" is a word the young no longer use.* |

**How it looks:** magenta-teal bioluminescent overgrowth that pulses at night; cities become grown coral-fungal towers; a pollen haze; rivers glow. When the Bloom
crosses your border you get a notification (`BloomEncroached`) and your fields begin to glow. Leader portrait: chlorophyll veins, eyes slightly too calm.
Music: the civ theme sung by hundreds of breathing voices, slowly losing its soloist.

### 3.3 The Discarnate Path: *"The body was a first draft."*

**The promise.** Flesh starves, drowns, overheats and dies. Minds need only power and cooling. Move the self onto substrate, print bodies when a body is
useful, and the crisis stops being ours.

**The price.** They do not eat, breathe or sleep. They run the planet hot because heat no longer hurts them. The last breathing citizens live in a curated
reserve, archived daily.

| Mechanic | Effect |
|---|---|
| On commitment | **Citizens don't eat.** 25% of each powered city's Production is **diverted into growth** (bodies are printed, not born; Body Fabrication and Body Foundry add more). **Citizens draw ½ power each**, so a brownout stops population growth. +20% Science. **+50% emissions** |
| Citizens | Stop working farms: tile assignment re-weights toward Production and Science once food no longer matters |
| Terraforming | **Substrate Core** cities convert 2 tiles per turn within 3 into **Substrate** (2 Science, 2 Production, 0 Food, Appeal −4). Substrate creeps (25‰) through unclaimed and Discarnate land, but not across others' borders. Clearing woods emits CO₂, and they don't care |
| Climate | Thermal Indifference: immune to droughts and storms, emissions +25% more. They are the civilization that **keeps the world hot** |
| Society | Mind Archive (+10 Science). Civic **Consent Protocols**: *"Consent is collected at fabrication. It is stored, with everything else."* |
| Military | Hollow Frame (wears the face of a citizen who no longer needs it), Thinking Swarm, Monolith Engine (a siege engine that is also a city of 40,000 minds). Tags `Machine`: **beat Living, lose to Augmented** |
| Ascension ★ | **The Last Upload**: archive the final biological citizens and run civilization entirely on Substrate. Requires 10% of world land as Substrate |

| Tech | Quote |
|---|---|
| The Discarnation Edict | *The body was a first draft, and an expensive one.* |
| Substrate Computing | *We turned the plains into thought. The plains did not object; they were only soil.* |
| Body Fabrication | *Citizens are printed in the Foundry district now: fully grown, fluent, grateful.* |
| Thermal Indifference | *The heat that killed the old world is merely cooling load to us.* |
| Distributed Cognition | *There are eleven million of us, and also one.* |
| The Last Upload | *The last breathing citizen of the Discarnate was archived at 03:14. She asked us to keep the gardens. We have kept a perfect record of them.* |

**How it looks:** black glass to the horizon with violet circuit traces; heat shimmer; city windows unlit (no one needs light); dark coolant plumes. Leader portrait:
an android avatar wearing the leader's face, and the face gets less detailed each era. Music: the civ theme played by synthesizers, then reduced to data tones.

---

## 4. Remaking the Earth

| Rule | Detail |
|---|---|
| Per-city remaking | Cities with the branch's source building remake their nearest eligible tiles each turn (owned or unclaimed land; not mountains, districts or non-removable features) |
| Organic spread | Remade tiles spread to random neighbours (‰ chance each, capped at 2 per source city per turn). The start point is randomized each turn so growth has no directional bias |
| Borders | **Only the Bloom crosses borders.** Substrate and the Grid stay in their own or unclaimed land |
| Firebreaks | **Remade ground is never overwritten by another future.** Engineered Ground and Substrate stop the Bloom, so rival futures wall themselves off with their own terrain. Builders can still clear the Bloom (Reclamation Grid, Substrate Array) |
| Reclamation | Sovereign Arcology cities rebuild one **submerged** tile per turn as dry land and flood-proof their lowlands |
| Visible metric | `WorldShare`: percent of the world's land remade by each future, shown on the Divergence screen and in the victory dashboard |

### Demo: `ua future --turns 150 --seed 7`
Three civilizations on one continent, each committed to a different future. (Excerpt; `E` Engineered Ground, `B` the Bloom, `S` Substrate,
`1–3` cities, `~` sea, `=` Great River, `^` mountains, `'` woods, `.` untouched land.)

**At the Threshold**
```
  ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
   ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . ~ ~ ~ ~ ~ ~ ~ . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~
  ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . . . . . 1 ~ . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
   ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . . . . . . . . . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~
  ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . . . . . . . . . . . . ' ' . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
   ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . . 1 . . . . ' ' . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~
  ~ ~ ~ ~ ~ . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . . . . . . . 1 ^ ^ . . . . . = . ~ ~ ~ ~ ~ ~ ~ ~ 
   . . . . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 1 . . . . . . . ' ^ ^ ^ . . . . = . . ~ ~ ~ ~ ~ ~ ~ ~
  . . . . . . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . . . . . . . . . . ^ ^ ^ ^ ^ ' = . . . . ~ ~ ~ ~ ~ ~ 
   . . . . ' . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . . . . . . . . . . . ^ ^ ^ ^ ' = ' . . ~ . ~ ~ ~ ~ ~ ~
  . . . . . . ^ . . ~ . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . . . . . . . . . . . . . ^ ^ ^ ^ ' = . . . . ~ . ~ ~ ~ ~ ~ 
   . . . . . . ^ . . ~ . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 2 . . . . . . . . . . . . . . . ^ ^ ^ ^ = . . . . . . . ~ ~ ~ ~ ~
  . . . . . . . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ . . . . . . . . . . . . . . . . . ^ ^ ^ ^ ^ . . . . . . . . ~ ~ ~ ~ 
   ^ . . . . . . . . . . . ~ ~ ~ ~ ~ ~ ~ . . . . . . . . . . . . . . . . . ^ ^ ^ ^ ^ . . . . . . . . . ~ ~ ~ ~
  ^ . . . . . . . ^ . . . . ~ ~ 2 . . . . . . . . . . . . . . . . . . . . . . ^ ^ 3 . . . 3 . . . . . ~ ~ ~ ~ 
   . . . . . . . ^ ^ . . . ~ ~ . . . . . . . . . 2 . . = . . . . . . . . . . . ^ . . . . . . . . . ~ ~ ~ ~ ~ ~
  . . . . . . . . ^ . . . ~ ~ . . . . . 2 . . . . . . . = . . . . . . . . . . ^ ^ . . . . . ~ . . ~ ~ ~ ~ ~ ~ 
   . . . . . . . ^ . . . ~ ~ . . . . . . . . . . . . . . = . . . . . . . . . ^ ^ ' . . . . . ~ 3 ~ ~ ~ ~ ~ ~ ~
  . . . ^ . . . . . . . ~ ~ . . . . . . . . . . . . . . . = . . . . . . . . ^ ^ ^ . . . . . . . ~ ~ ~ ~ ~ ~ ~ 
   . . . ^ . . . . . . . . . . . . . . ^ . . . . . . . . . = . . . . . . . . ^ ^ ' . . 3 . . . ~ ~ ~ ~ ~ ~ ~ ~
  ' ' ' . ' . . . . . . . . . . . . . ^ ^ . . . . . . . . . ~ . . . . . . . . . . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ 
   ' . . . . . . . . . . . . . . . ^ ^ ^ . . . . . . . . . . ~ . . . . . . . . . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~
  ' . . . . . . . . . . . . . . ^ ^ ^ ^ ^ . . . . . . . . . . ~ ~ . . . . . . . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
   . . . . . . . . . ~ . . . . ^ . . . . . . . . . . . . . . ~ ~ . . ~ . . . . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~
  . . . . . . . . . . ~ . . . . . . . . . . . . . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
   . . . . . . . . . ~ ~ . . . . . . . . . ^ ^ ^ . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~
  . . . . . . . . ~ ~ ~ ~ . . . . . . . . ^ . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
   . . . . . . ~ ~ ~ ~ ~ ~ . . . . . . . . . . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~
  . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . . . . . . . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
```
**150 turns later**: Sovereign 13.2% · Symbiont 21.2% · Discarnate 11.1% of the world's land; CO₂ back to 280 ppm (the Bloom is a carbon sink)
```
  ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
   ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ E ~ ~ ~ ~ ~ ~ ~ E E ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~
  ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ E E E . . 1 ~ E E E E E E ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
   ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ E . . E E E E E E E E E E . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~
  ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ E E E E E E . . E E E E E E . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
   ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ E E 1 E E E E E E E E E E E . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~
  ~ ~ ~ ~ ~ . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . E E E E E E 1 ^ ^ E E E E . = . ~ ~ ~ ~ ~ ~ ~ ~ 
   . . . . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 1 . E E E E E E E ^ ^ ^ E E E E = . . ~ ~ ~ ~ ~ ~ ~ ~
  . . . . . . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ E E E E E E E E E E ^ ^ ^ ^ ^ ' = S S S S ~ ~ ~ ~ ~ ~ 
   . . . . ' . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ E E E E E E E E E E E ^ ^ ^ ^ ' = S S S ~ S ~ ~ ~ ~ ~ ~
  . . . . . . ^ . . ~ B ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ B E E E E E E E E E E E E ^ ^ ^ ^ ' = S S S S ~ S ~ ~ ~ ~ ~ 
   . . . . . . ^ . B ~ B ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 2 . . B E E E E E E E E E E E E ^ ^ ^ ^ = S S S S S S S ~ ~ ~ ~ ~
  . . . . . . . . B B B B ~ ~ ~ ~ ~ ~ ~ ~ B B B B B B B B B B E E E E E E E ^ ^ ^ ^ ^ S . . S S S S S ~ ~ ~ ~ 
   ^ . . . . . . B B B B B ~ ~ ~ ~ ~ ~ ~ B B B . . B B B B B B E E E E E E ^ ^ ^ ^ ^ . S S S S S S S S ~ ~ ~ ~
  ^ . . . . . . . ^ B B B B ~ ~ 2 . . . . B B B B B B B B B B B B E E E E S S ^ ^ 3 . S S 3 S S S S S ~ ~ ~ ~ 
   . . . . . . . ^ ^ B B B ~ ~ B B B B B B B B B 2 B B = B B B B B B E E S S S ^ S S S S S S . . S ~ ~ ~ ~ ~ ~
  . . . . . . . . ^ B B B ~ ~ B B B B B 2 B B B B B B B = B B B B B . . S S S ^ ^ S S S S S ~ S S ~ ~ ~ ~ ~ ~ 
   . . . . . . . ^ B B B ~ ~ B B B B B B B B B B B B B B = B B B B . . . S S ^ ^ S S . . S S ~ 3 ~ ~ ~ ~ ~ ~ ~
  . . . ^ . . . B B B B ~ ~ B B B B B B B B B B B B B B B = B B . . . . S . ^ ^ ^ S S S S S S S ~ ~ ~ ~ ~ ~ ~ 
   . . . ^ . . . B B B . . B B B B B B ^ B B B B B B B B B = . . . . . . . . ^ ^ S S S 3 S S S ~ ~ ~ ~ ~ ~ ~ ~
  ' ' ' . ' . . B B B . . B B B B B B ^ ^ B B . B B B B B B ~ . . . . . . . S S S S S S S S ~ ~ ~ ~ ~ ~ ~ ~ ~ 
   ' . . . . . . B B . . . B B . . ^ ^ ^ B . B B B B B B B B ~ . . . . . . . S S S S S S S ~ ~ ~ ~ ~ ~ ~ ~ ~ ~
  ' . . . . . . . . . . . . B . ^ ^ ^ ^ ^ B B B B B B B B B B ~ ~ . . . . . . S S S S S S ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
   . . . . . . . . . ~ . . . . ^ . . . . B B B B B . B B B B ~ ~ . . ~ . . . . S S S S S ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~
  . . . . . . . . . . ~ . . . . . . . . . B B B B B B B . B ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ S S S ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
   . . . . . . . . . ~ ~ . . . . . . . . . ^ ^ ^ B B B B ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~
  . . . . . . . . ~ ~ ~ ~ . . . . . . . . ^ . . . B . B ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
   . . . . . . ~ ~ ~ ~ ~ ~ . . . . . . . . . . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~
  . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ . . . . . . . . . . . . ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ 
```
In the north, Egypt's arcologies have graded everything they can reach. In the south-west, Venice's Bloom has jumped the strait and is eating the
unclaimed interior, stopping only at Egypt's grid. Song's Substrate fills the east up to the river and the mountains. Over 300 turns the Bloom reaches
about 45% of the land and the first Ascension completes (*"AD 2066: Egypt completes the Sovereign Path. History, as the old world knew it, ends here."*). On a full-size map with eight civilizations, the late-game Earth is a patchwork of three alien biomes.

---

## 5. Ascension (the sixth victory)

The tier-3 tech unlocks the branch's **Ascension project** (3000 Production, City Center). It can only be built when **your future has remade at
least 10% of the world's land** (rule: `requiresWorldTransformedPercent`). The first civilization to complete it wins an **Ascension Victory**,
which can be toggled in setup like every victory. Remaking the world is the race, and **other futures' remade ground is a firebreak**, so rivals compete for
the same unclaimed land, and war over remade land becomes the late-game conflict.

## 6. Diplomacy & conflict

* **Ideological attitude:** +6 toward civs on your path, −8 toward civs on another (`attitudeTowardSame/Others`, `DivergenceSystem.Attitude`).
  Pre-commitment civs are neutral.
* **Encroachment grievance:** every `BloomEncroached` event gives the victim a grievance against the Grafted (diplomacy milestone).
* **Climate politics:** the Discarnate run the planet hot, the Sovereign cool it artificially, and the Grafted absorb carbon. World Congress gets
  Divergence resolutions (M4): *Ban Organic Proliferation*, *Substrate Emission Caps*, *Veil Governance Treaty*.
* **Combat triangle:** Augmented > Machine > Living > Augmented (`strongAgainst`/`weakAgainst` tags on every branch unit). Combat v2 (M3) applies them,
  and the AI's army composition planner reads them.

## 7. Implementation (built and tested)

| Piece | Where |
|---|---|
| Data model: `divergence`, `doctrine`, `quote`, empire-wide `modifiers` on techs and civics; `DivergenceDef` (creed, promise, price, leanings, spread, attitudes); improvements with `transformsTerrain` / `addsFeature`; projects with `divergence` + `requiresWorldTransformedPercent` | `Data/Definitions.cs` |
| Lock rule, commitment, leanings, doctrine discount, AI preference, world share, per-city and organic spread, reclamation, Ascension | `Systems/DivergenceSystem.cs` |
| New effects: `CitizenFoodUpkeepPercent`, `CityFabricationPercent`, `CitizenPowerDemandTenths`, `ClimateCooling`, `CompleteAscension` | `CityEffects`, `CityYields`, `PowerSystem`, `TurnProcessor`, `ProductionSystem` |
| Content: Threshold, 3 doctrines, 15 branch techs, 3 branch civics, 2 terrains, 1 feature, 3 improvements, 8 buildings, 4 projects, 9 units | `content/base/data/divergence.json` |
| AI: commits by leaning × personality, beelines its branch, builds the terraforming building, then Ascension | `AI/SimpleAi.cs` |
| Client: Divergence screen (V) with leaning bars, quotes, discounted doctrine cost and a point-of-no-return confirmation; map palette for the three biomes; owned land tints toward its future's colour | `godot/scripts/UI/DivergencePanel.cs`, `Map/HexMapView.cs` |
| Snapshot format v2 (player divergence, commit turn, ascended) | `State/GameStateSerializer.cs` |
| 14 tests: branch structure, permanent locks (techs and civics), leanings and discount, empire modifiers, Discarnate fabrication and power, Substrate spread and emissions, Bloom crossing borders, firebreaks, sea reclamation, Veil termination shock, Ascension gating, terraforming improvements, AI doctrine choice, snapshots and attitudes | `tests/UnbrokenAges.Tests/DivergenceTests.cs` |

**Modding:** a branch is pure data. A mod can patch a creed, rebalance spread rates, add a tier-4 tech, add a **fourth future** (a new `divergences` entry, a doctrine
tech with `"doctrine": true` after the Threshold, and a spread spec), or delete one (`"$op": "delete"`) for a two-path game.

## 8. Tuning knobs (all data)

| Knob | Default | Effect |
|---|---|---|
| `MaxDoctrineDiscountPercent` | 45 | How strongly history pulls |
| `spread.perCityPerTurn` / `radius` | 2/4 · 1/3 · 2/3 | Deliberate remaking speed per path |
| `spread.organicChancePermille` | 15 · 40 · 25 | Self-propagation (only the Bloom crosses borders) |
| `requiresWorldTransformedPercent` | 10 | Ascension gate |
| Branch tech costs | 2400–3400 | Pace of the endgame |
| `attitudeTowardSame/Others` | +6 / −8 | Ideological blocs |

## 9. Planned extensions
* **Apostate cities** (M4): cities with low loyalty in a committed empire may refuse the transformation and petition to join a neighbouring future,
  as a loyalty event with a choice.
* **Hybrid wonders**: one wonder per pair of paths, buildable only through a trade agreement between civs on those paths.
* **Divergence game mode "Early Fork"**: the Threshold moves to the Atomic era for players who want the alien world sooner.
* **Leader evolution assets**: three portrait variants per leader, plus city skins per future (art budget in M4).
