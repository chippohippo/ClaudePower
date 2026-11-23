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

## 8. Accessibility checklist (applies to every screen)
Text ≥ 14 px at 100% scale; contrast ≥ 4.5:1; no information carried by colour alone; full keyboard and controller navigation (Steam Deck);
reduced-motion mode; subtitles and audio cues for notifications; screen-reader labels on every Control (Godot AccessKit); remappable everything.
