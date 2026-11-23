# 06 — UI/UX Wireframes

## 0. Principles
* **Every number explains itself.** Hovering any yield, loyalty, housing, power or combat value shows its sources. The simulation already produces
  breakdowns (`CityYieldReport`, `LoyaltyBreakdown`, `AdjacencyResult.Contributions`, `CityEffects.Applied`).
* **Density is a setting.** *Compact* (CQUI-like, more rows, smaller icons) and *Comfortable* (larger touch targets, Steam Deck default), with UI scale 75–200%.
* **Two clicks to anything.** Global hotkeys open every report (F1–F12). The search box (Ctrl+F) finds cities, units, wonders and Civilopedia entries.
* **Colourblind-safe by construction:** lens colours come from three palettes, and every lens also has a *pattern* channel (hatching, dots).
* **Keyboard first:** every action is bindable. Tab cycles "units needing orders", and Enter ends the turn when nothing is blocking.

Legend: `▣` building · `⬡` district · `♞` unit · `✪` project · `📍` reserved tile · `≡` drag handle · `⚠` warning · `▸` expandable

---

## 1. City View
```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◀ Prev  WASET  (Capital · Metropolis 21)  ▶ Next           Province: Delta ▾   Governor: The Steward ✔ (Urban Planner) │
├───────────────────────────────┬─────────────────────────────────────────────────────────────┬──────────────────────────┤
│ YIELDS            ▸ per source│                                                             │ PRODUCTION QUEUE  8 max  │
│ 🌾 24 (+6 surplus)  ⚙ 31      │                       [ 3D city view ]                       │ 1 ⬡ River Port 📍 3t T88≡│
│ ◉ 19   ⚗ 27   ♪ 12   ✦ 6     │       districts shown with their adjacency badges:           │ 2 ▣ Research Lab  6t T94≡│
│ GROWTH ███████░░░ 4 turns     │          ⬡Academy +5⚗   ⬡Market +4◉   ⬡Foundry +3⚙          │ 3 ♞ Builder ↻     2t T96≡│
│ HOUSING 21/24  ▸              │       (hover a badge → contribution list + "1 more for +1") │ [▲][▼][✖][Buy 640◉]      │
│ AMENITIES 12/11 Happy (+5%) ▸ │                                                             │ ┌ Add ────────────────┐  │
│ LOYALTY ██████████ 100 (+14)▸ │   Tile lens toggles: [Yields] [Appeal] [Loyalty] [Power]    │ │⬡ Districts (3 free) │  │
│ POWER ✔ 9/12 (grid: Delta)  ▸ │                      [Flood risk] [Religion]               │ │▣ Buildings          │  │
│ DISTRICTS 6/7 (+1 Metropolis) │                                                             │ │♞ Units   ✪ Projects │  │
│ CITIZENS: Focus [Balanced ▾]  │   Citizens: click tile to lock/unlock; specialists below    │ └─────────────────────┘  │
│ 🔒 3 locked tiles              │                                                             │ Templates ▾  Save as…    │
├───────────────────────────────┴─────────────────────────────────────────────────────────────┴──────────────────────────┤
│ BUILDINGS by district  ⬡ City Center: Monument, Granary, Flood Barrier · ⬡ Academy: Library, University · …             │
│ GREAT WORKS 4/6 slots ▸   TRADE ROUTES in 3 / out 2 ▸   RELIGION: Path of Rivers 18/21 citizens ▸   DEFENCE 48 / 200 HP │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
**Loyalty breakdown** (▸) shows each term from §5.2 of the systems docs, the per-civ foreign pressure list, and *"flips in N turns"* in red.
**Implemented skeleton:** `godot/scripts/UI/CityPanel.cs` (yields, housing, amenities, district capacity, power, loyalty breakdown, queue with ETA, add/reorder/remove/buy).

## 2. District Placement Lens
```
            ⬢ ⬢ ⬢ ⬢               ⬢ green (darker = better score)   ⬢ red = illegal
          ⬢ +4⚗ ⬢ ⬢ ⬢             floating labels on the top 6 spots
         ⬢ ⬢ (city) +3⚗ ⬢
          ⬢ ✖ ⬢ ⬢ ⬢               ┌ Hover tooltip ─────────────────────────────────────────┐
            ⬢ ⬢ ⬢ ⬢               │ Academy here: +4 Science                               │
                                  │   +1 Science per adjacent Mountain  (+2)               │
                                  │   +2 Science per adjacent Geothermal Fissure (+2)      │
                                  │   +1 per 2 adjacent any district: 1/2 — 1 more for +1  │
                                  │ Neighbouring districts: +1 Gold (Market)               │
                                  │ Replaces tile yields: 2 Food                           │
                                  │ [Click] queue at end · [Ctrl+Click] queue first ·      │
                                  │ [Alt+Click] place map tack                             │
                                  └────────────────────────────────────────────────────────┘
  On red tiles: "Cannot place here: • Needs an adjacent water source • Already planned for another queued district"
```
**Implemented:** `godot/scripts/Map/PlacementLens.cs` (tint, top-6 labels, full explain text, failure list).

## 3. Empire Overview (report hub)
```
┌ EMPIRE ─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [Cities] [Production] [Provinces] [Units] [Trade] [Great Works] [Religion] [Power & Climate] [Espionage] [Victory]   │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ CITIES  (sortable, filterable, multi-select → bulk actions)                    Filter: [Province ▾][Needs attention ☑] │
│ ☐ City       Pop  🌾+  ⚙   ◉   ⚗   ♪   Hous   Amen  Loyal   Power  Producing            ETA   Gov   ⚠               │
│ ☐ Waset      21   +6   31  19  27  12  21/24  +1    100▲14  ✔      River Port 📍        3     Stw                     │
│ ☐ Abydos      9   +2   12   6   8   3   9/10   0     71▼2   ✖ −3   Factory              7     —     Brownout        │
│ ☐ Khmun       4   −1    5   2   2   1   4/6   −1     38▼7   —      (empty)              —     —     Starving · Flip 6t│
│ Bulk: [Apply queue template ▾] [Set focus ▾] [Assign to province ▾] [Buy cheapest ▾]                                │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ POWER & CLIMATE: grids table (capacity / demand / dispatched / fuel use / CO₂), emissions by civ graph, sea-level      │
│ forecast: "At current emissions, phase 4 in ~38 turns: 6 of your tiles flood, 2 submerge (Abydos Harbor!)"          │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
Other tabs: **Units** (grouped by type, with upgrade-all, sleep and alert toggles), **Trade** (routes with yields and expiry, the "best available routes" finder,
auto-renew), **Great Works** (slots, theming hints, swap suggestions), **Victory** (every rival × every victory with progress and confidence).

## 4. Diplomacy
```
┌ DIPLOMACY ── Enrico Dandolo of Venice ─────────────────────────────────────────────────────────────────────────────┐
│ [Portrait]  Attitude: Friendly (+18)  ▸ why                     Agenda: Merchant Prince (public)                       │
│             Hidden agenda: ??? (embassy for 12 more turns, or a spy reveals it)                                        │
│ WHY (+18): +12 trade partners (4 routes) · +6 declared friends · +4 shared enemy Song · −4 your Harbor near Torcello   │
│            (decays 1/turn)                                                                                             │
│ GRIEVANCES  you → them 0 · them → you 14  ▸ itemized: "Settled near Torcello (T63) 14, −1/turn, witnessed by: Song"    │
│ RELATIONSHIP  ●──●──◉──○──○  Acquainted · Friendly · Declared Friends · Ally (Economic/Research/Military…)              │
├──────────────────────────────────────────────┬──────────────────────────────────────────────────────────────────────┤
│ DEAL                                         │ YOU OFFER                    │ THEY OFFER                                │
│ [Gold] [Per-turn] [Resources] [Monopoly]     │ 5 ◉/turn × 30                │ Open Borders                              │
│ [Tiles] [Cities] [Open borders] [Research    │ Tile (12,40) border swap     │ Silk ×1                                   │
│  agreement] [Defensive pact] [Joint war]     │                              │                                           │
│ [Vassalage] [Liberation] [Vote in Congress]  │ AI verdict: ✔ "Acceptable" (+6 margin) · [What would make this work?] │
├──────────────────────────────────────────────┴──────────────────────────────────────────────────────────────────────┤
│ [Denounce] [Declare war ▾ (casus belli: Fabricated claim — grievance cost shown)] [Propose alliance] [Embassy]        │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
**World Congress** screen: proposals for next session (yours and others'), live vote tallies before lock, favor trade buttons, victory points table.

**Implemented (skeleton, key P):** `godot/scripts/UI/DiplomacyPanel.cs`. One row per known civilization: status (`DiplomacySystem.StatusName`),
score, attitude toward you with every named line, grievances both ways, and the buttons Declare war · Propose peace · Accept peace · Denounce ·
Open/Close borders. A disabled button's tooltip is the host's own validation message ("A peace treaty binds you for 6 more turns."). The deal
table, portraits and the Congress follow in M4. (D pans the camera, so diplomacy is on P.)

## 5. Tech / Civic Tree
```
┌ TECHNOLOGY ─ [Tech] [Civics] ─ Search: "power"              Filter: [Unlocks districts] [Boostable now] [On path to: Exodus] │
│ ERA:  Ancient ─────── Classical ───────── Medieval ──────── Renaissance ───── Industrial ─────── Modern …                │
│  ┌Pottery✔┐──┬─►┌Writing✔┐──►┌Currency◐┐──►┌Apprenticeship┐──►┌Education┐                                          │
│  └────────┘  │   └────────┘   │ 82/120   │   │ ⬡Foundry      │   │▣University│                                         │
│              │                │ Boost ✔  │   └──────────────┘   └──────────┘                                          │
│  ┌Sailing✔┐──┴─►┌Celestial Nav.┐  ← unlocks ⬡Harbor; boost: "Found a city on a coast or Great River" (40%)            │
│                                                                                                                          │
│ Research queue: 1 Currency (2t) → 2 Apprenticeship (9t) → 3 Education (8t)   [Shift+click to append, drag to reorder]     │
│ Hover node: unlocks (with icons), boost progress, era, turns at current science, AI civs known to have it                │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
Era columns are proportional to Era Pacing. "Path to" highlights every node required for a selected target, as a beeline view.

## 5b. The Divergence (Threshold screen, key V)
```
┌ THE THRESHOLD — choose what humanity becomes. Two of these futures will close to you forever. ─────────────────────────────┐
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ │ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ │ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ │
│ SOVEREIGN PATH                    │ SYMBIONT PATH                    │ DISCARNATE PATH                  │
│ "Humanity will not change.        │ "We stopped fighting the garden. │ "The body was a first draft."    │
│  The world will."                 │  We became it."                  │                                  │
│ THE PROMISE  Seal the coasts,     │ THE PROMISE  Splice four billion │ THE PROMISE  Minds need only     │
│ grade the land, govern the sky…   │ years of solutions into us…      │ power and cooling…               │
│ THE PRICE (red)  Every child is   │ THE PRICE  Their children rarely │ THE PRICE  The last breathing    │
│ registered at conception…         │ say "I"…                         │ citizens live in a reserve…      │
│ Your history leans 52% this way   │ Your history leans 31%           │ Your history leans 17%           │
│ ██████████░░░░░░░░                │ ██████░░░░░░░░░░                 │ ███░░░░░░░░░░░░                  │
│  • Flood Barriers raised (+12)    │  • Woods left standing (+9)      │  • Research Labs (+8)            │
│  • A strong central state (+4)    │  • Renewable power (+8)          │  • Academies (+6)                │
│ [Research The Sovereign Charter   │ [Research The Grafting Accord    │ [Research The Discarnation Edict │
│   (1,840 ⚗, −23% from history)]   │   (2,060 ⚗)]                     │   (2,220 ⚗)]                     │
│ ○ Genome Registry  (hover: quote) │ ○ Chloroplast Splicing           │ ○ Substrate Computing            │
│ ○ Stratospheric Veil              │ ○ Mycelial Networks              │ ○ Body Fabrication               │
│ ○ Total Reclamation               │ ○ Tidal Grafting                 │ ○ Thermal Indifference           │
│ ○ Arcology Doctrine               │ ○ Beast-Shaping                  │ ○ Distributed Cognition          │
│ ○ The Eternal Bastion ★           │ ○ The Chorus ★                   │ ○ The Last Upload ★              │
│ World remade: 0%                  │ World remade: 4.1% (Song)        │ World remade: 0%                 │
└───────────────────────────────────┴──────────────────────────────────┴──────────────────────────────────┘
 Point of no return: "Commit to the Sovereign Path? We will not be edited. We will edit everything else.
                      The other two branches will lock forever."   [Cancel] [Commit forever]
```
After commitment the two other columns are greyed with **LOCKED FOREVER**. The tech tree shows the Future era as three lanes with the locked lanes dimmed,
and each node's hover shows its quote. The HUD shows your people's name (e.g. *the Grafted*). Leader portraits in diplomacy switch to their future variant.
**Implemented:** `godot/scripts/UI/DivergencePanel.cs`. Design: [08-divergence-tech-tree.md](08-divergence-tech-tree.md).

## 6. Multiplayer Lobby
```
┌ UNBROKEN AGES ──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Name [ Ankhesen        ]                                                                                              │
│ [New Game] [Host (Direct IP)] [Join (Direct IP)] [LAN] [Relay / Matchmaking] [Load]                                   │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ JOIN (DIRECT IP)                                                                                                       │
│ Host address [ 203.0.113.7:47620                ]   ✔ valid   Password [••••]   [Join]                                │
│ Recent: 203.0.113.7:47620 (Friday Night Civ) · 192.168.1.20                                                              │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ LOBBY "Friday Night Civ"   Mods: base 0.1.0, example-river-trade 1.0.0  ✔ match   Turn mode: Dynamic · Timer: 90+5/city │
│ Slot  Player        Civ / Leader          Team  Ready  Ping                                                             │
│ 0     Host (you)    Egypt / Thutmose III   1     ✔      —                                                               │
│ 1     Alice         Venice / Dandolo       1     ✔      23 ms                                                           │
│ 2     Bob           Song / Taizu           2     ☐      61 ms                                                           │
│ 3     [AI ▾]        Random                 2     ✔      —                                                               │
│ Spectators: 1 (delay 2 turns)                                                                                            │
│ Settings ▸ map Continents · Standard · seed 381 · Era pacing 150% · Disasters Standard · Congress Light · victories ☑☑☑☑☐ │
│ Connection doctor ▸ "Port 47620 open ✔ — external IP 203.0.113.7"        [Chat ...........................] [Launch]    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
Mismatch messages are explicit: *"Your enabled gameplay mods differ from the host's: missing example-river-trade 1.0.0 [Subscribe]"*.
**Implemented skeleton:** `godot/scripts/UI/LobbyScreen.cs` (New Game setup, Host with port and password, Join with address validation, LAN list with compatibility flag).

## 7. HUD, notifications, turn flow
```
┌ ◉ 412 (+38)  ⚗ 88  ♪ 61  ✦ 140  ★ Favor 37   Era: Medieval (Golden, 31/40 score)   CO₂ 312 ppm  +0.6°C  phase 1   T 87 ┐
│                                                                                                   ┌ Notifications ───┐ │
│                                    [ map ]                                                        │ ⚠ Khmun flips 6t ▸│ │
│                                                                                                   │ ⬡ Academy done   │ │
│ [Minimap ⧉ lens switch]                                                                           │ ♞ 3 units idle   │ │
│                                                                    [ NEXT: 3 units need orders ⏎ ]└──────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
The **turn summary** (Ctrl+T) lists everything that changed last turn, grouped and clickable.

**World line** (second HUD row; implemented in `GameRoot.WorldLine`):
```
An Age of Lanterns   Progress 61 · Strife 22 · Calamity 9   → if a new era began now: An Age of Lanterns   [L] supply  [C] chronicle  [V] divergence
```
**Supply lens (L)**: green hexes shaded by supply depth (rivers glow as long green ribbons); cut-off units get a red hex and an "out of supply: −10 HP/turn" badge.

## 7b. The Chronicle (C)
```
┌ THE CHRONICLE ─────────────────────────── ☐ Include other civilizations (as far as you know) ┐
│ AD 1840: The sea claims the first of Egypt's lowlands.                                         │
│ AD 1790: The world enters An Age of Titans. Engines everywhere, smoke everywhere…              │
│ AD 1385: Egypt's first governor, The Steward, takes office in Abydos.                          │
│ 475 BC: The world enters An Age of Lanterns. Ideas cross borders faster than armies…           │
│ 4000 BC: Egypt founds Waset.                                                                    │
│ [Export with timelapse]                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```
Your entries are bold and the world's are italic. **Implemented:** `godot/scripts/UI/ChroniclePanel.cs`.

## 7c. Combat preview tooltip (hover an enemy with a unit selected; right-click to attack)
```
┌──────────────────────────────────────────────────────────────┐
│ Favourable (78%): Swordsman (Heavy) 40 vs Warrior 24         │
│ Deal 31–47 of 100 HP, take 12–18 of 100 HP                   │
│   + Strength +35                                             │
│   + Heavy variant +5                                         │
│   − Strength +20                                             │
│   − Terrain +3                                               │
│   − Fortified +4                                             │
└──────────────────────────────────────────────────────────────┘
```
The verdict (Decisive ≥ 85 · Favourable ≥ 60 · Even ≥ 40 · Costly ≥ 20 · Disastrous) uses the same odds the AI attacks on, and the
panel is tinted green, amber or red with the verdict word always written out, so colour is never the only signal. Warnings: "Certain kill.",
"The city will fall.", "⚠ Your unit may die." Illegal targets show the reason ("You are not at war with them."). **Implemented:**
`godot/scripts/UI/CombatTooltip.cs` over `CombatSystem.Describe`. Right-click attacks when the preview is legal, otherwise moves.

## 7d. Victory screen
```
┌ VICTORY ─────────────────────────────────────────────────────┐
│ Egypt wins a Hegemony victory on turn 212.                   │
│ AD 1710: Egypt wins a Hegemony victory: every old capital    │
│ answers to it.                                               │
│                                                              │
│ Egypt 412 (Citizens 96, Cities 60, Districts 44, …)          │
│ Venice 301 (…)                                               │
│                        [ One More Turn ]                     │
└──────────────────────────────────────────────────────────────┘
```
Opens by itself when the game is won (the game then accepts only One More Turn). "VICTORY" or "DEFEAT" depends on your team. Every
civilization's score is itemized. An eliminated player sees "Your civilization has fallen." **Implemented:** `godot/scripts/UI/VictoryPanel.cs`.

## 7f. First-playable HUD (implemented)
* **Unit panel** (bottom-left, `UnitPanel.cs`): name with variant, strength, HP, moves, charges, and every action available here. Impossible
  actions stay visible and disabled, with the host's reason as the tooltip.
* **Research and civics** (T, `ResearchPanel.cs`): the current choices with progress and rates, and every available node with cost and turns.
* **Notification feed** (left, `NotificationFeed.cs` over `EventText`): your news in the second person, the world's news by name, warnings.
* **Turn bar** (bottom-centre, `TurnBar.cs`): what still needs you ("Choose research (T)", "1 city needs production"), End Turn, Save, Load.
* Fog of war: unexplored tiles are not drawn, explored ones are dimmed when out of sight, and foreign units show only in sight.
* Full-screen overlays (research, diplomacy, Chronicle, Divergence) are exclusive, and Esc closes them.

## 7e. Borders and fronts
Borders are drawn in the owner's colour, your own brighter. A civilization **at war with you** gets a **red double line**: the doubling
carries the meaning for colourblind players, and the red is a reinforcement. **Implemented:** `HexMapView.DrawBorders`.

## 8. Accessibility checklist (applies to every screen)
Text ≥ 14 px at 100% scale; contrast ≥ 4.5:1; no information carried by colour alone; full keyboard and controller navigation (Steam Deck);
reduced-motion mode; subtitles and audio cues for notifications; screen-reader labels on every Control (Godot AccessKit); remappable everything.

## 9. Art direction: a painted world on an old chart

Civ VI's warm, painted look, laid over the idea that the game *is* a map being drawn as you explore.

| Layer | How it is made | Code |
|---|---|---|
| Landscape | A continuous, chunked height-mapped mesh (~4 vertices per hex edge) instead of hex columns. Tile heights blend with gaussian weights so coastlines curve and valleys run between hills; hills add rolling bumps, mountains ridged peaks. Unexplored tiles are flat paper at land height, so their shape never leaks. Chunks rebuild only when a tile that shapes them changes. | `Visuals/HeightField.cs`, `Visuals/TerrainMesh.cs` |
| Painted terrain | One texel per tile in a map-wide data texture (terrain, fog, water, feature). Each pixel finds its tile and the neighbour across the nearest edge and blends them over a wobbly, noise-displaced border, so terrains meet like brush strokes. Aerial PBR textures (Poly Haven) are softened toward their blurred mip and tinted per terrain; broad colour variation hides tiling. Rock on steep slopes, snow on summits, sand where land meets the sea, a wet seabed under the shallows, drifting cloud shadows, a faint pencil hex grid. | `shaders/terrain.gdshader`, `shaders/hexmap.gdshaderinc` |
| Water | A transparent surface at sea level that reads the depth buffer: shallows show the sand beneath and turn turquoise, deep water goes navy, foam and rolling surf form wherever water meets land; drifting swell, sky reflections | `shaders/water.gdshader` |
| Rivers | Edge rivers as flowing ribbons draped on the ground with soft muddy banks; Great Rivers are real channels in the landscape | `shaders/river.gdshader` |
| The unknown | Aged parchment (fibres, grain, tea stains) with a firm inked hex grid; unexplored water is paper too, so coastlines never leak | `paper()` in `hexmap.gdshaderinc` |
| Memory | Remembered land is a watercolour wash of its last-seen colours on the paper, inked in the shadows; remembered props are sepia with cross-hatching | `sepia_drawing()`, `shaders/model_tint.gdshader` |
| Frontier | Where the known meets the unknown, a ragged burnt-ink edge and scorched paper | `terrain.gdshader` |
| Scenery | Forests of a dozen-plus scattered trees of two kinds and many sizes, swaying in the wind; boulders on hills and mountain flanks; marsh plants; team-coloured castles, towers and houses that grow with population; district and improvement buildings; scaffolding for queued districts. The kit's pastel greens are shifted toward the terrain's natural greens; palette-textured kits sample their top mip so swatches never bleed | `Map/HexMapView.cs`, `Visuals/ModelLibrary.cs` |
| Worked land | Farms are painted into the ground as a patchwork of crop plots (ripe grain, green and young crops, ploughed earth) with furrows and hedgerows, and a farmstead with haystacks; plantations are rows of trees, pastures fenced paddocks, wild wheat a golden haze | `fields()` in `terrain.gdshader` |
| Resources | Every revealed resource stands on its tile, in a corner so it never hides the improvement: vines and a barrel for wine, pepper plants for spices, rose-tinted mulberries and a sack for silk, quarry stone, rusty iron and black coal heaps, glowing uranium crystals, oil drums, clams; livestock and game are alive (below). Strategic resources appear once their reveal tech is known | `HexMapView.DressResource` |
| Living world | Roads join each civilization's cities (a spanning tree of A* land paths that keeps to the valleys), the nearest cities of neighbouring civilizations (trade roads), plus spur tracks to improved resources: rutted dirt tracks until the industrial era, then asphalt with a dashed centre line; remembered roads are inked sepia. Horse-drawn wagons and carts, later cars and lorries, shuttle along them; tractors plough industrial farms. Fishing boats work the fish, canoes the pearl beds, sailboats tack off coastal cities, merchantmen sail sea lanes between nearby ports. Townsfolk stroll between the houses. Cattle, deer and horses wander and graze on their tiles, sheep at pastures. Flocks of birds wheel overhead; every house smokes (coal-dark stacks in the industrial age). Life is only drawn on tiles you can see now | `Visuals/LifeLayer.cs`, `shaders/road.gdshader`, `smoke.gdshader`, `bird.gdshader` |
| Units | Animated squads of four (two or three for settlers, builders, cavalry, mechs) on rings in the owner's colour, facing the camera: idle, walk, attack (archers loose their bows) | `Visuals/UnitLayer.cs` |
| Resource icons and lens | A small icon on every known resource when zoomed in; the resource lens (R, or the top-bar button) turns them into badges with name, yields and a ✔ (improved) or ⚒ (needs an improvement, named in the tooltip), rimmed green for bonus, purple for luxury, orange for strategic | `Hud/MapOverlay.cs` |
| Finish | HDRI sky light, a low golden sun for long shadows over the relief, ACES, SSAO, light bloom, aerial perspective, tilt-shift depth of field; a paper grain, warm grade and aged vignette applied after the whole 3D frame and under the UI | `GameRoot.BuildEnvironment`, `shaders/paper_grade.gdshader` |

Screenshots: [`docs/screenshots/`](screenshots) (`village-fields`, `resource-lens`, `living-world`, …). The client smoke test (`tools/client-smoke.sh`) renders these views on every run.

