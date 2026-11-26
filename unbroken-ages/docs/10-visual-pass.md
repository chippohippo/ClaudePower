# 10 — Visual pass: audit, priorities, folder structure

The target is a **stylized 3D look built on KayKit, Kenney and Quaternius** (CC0), lit with Poly Haven / ambientCG (CC0),
that stays **readable from the zoomed-out strategic view**. Most of the foundation already exists; this document audits the
asset list against the client, ranks the gaps, and fixes the folder and pipeline conventions new art must follow.

## 1. Audit against the asset list

Legend: ✅ in the game · 🟡 partial · ❌ missing · **P0–P3** priority of the remaining work (P0 first).

| Area | Item | Status | Where it lives / what is missing |
|---|---|---|---|
| **Terrain** | Grassland, plains, desert, tundra, snow, hills, mountains, coast, ocean, lake | ✅ | `TerrainMesh.cs`, `terrain.gdshader` (Poly Haven aerial PBR layers, per-tile variation), `water.gdshader` |
| | Forest, rainforest (jungle), marsh, floodplains, oasis, ice, cliffs, reef, volcano | ✅ | `HexMapView.cs` scatters KayKit trees / Kenney plants; floodplain, marsh, oasis are painted by the shader |
| | Resources (bonus, luxury, strategic) | ✅ | `models/resources` + resource lens (R) |
| | Farms, mines, pastures, plantations, camps, fishing boats, roads, rivers | ✅ | `HexMapView.cs`, `LifeLayer.cs` (roads by era, boats, livestock), `river.gdshader` |
| | Railroads | ✅ | `road.gdshader`: rails on sleepers beside the road from Industrialization (or a Railroad tech) |
| | Bridges | ✅ | `LifeLayer.cs` `BridgeMesh`, `bridge.gdshader`: timber → stone arch → steel truss → concrete |
| | Borders, war borders | ✅ | `HexMapView.cs` |
| | Yield icons on tiles | ✅ | yield lens (Y), `MapOverlay.cs` |
| | City banners | ✅ | compact pill at strategic zoom (`MapOverlay.cs`) |
| | Fog: parchment, hatched, hand-drawn grid, burn-in reveal | ✅ | `terrain.gdshader` `chart()` / `hatch()` / `sepia_drawing()` |
| | Fog: sea monsters, compass roses, ships | ✅ | `hexmap.gdshaderinc` `chart_sea()`, seeded per map |
| | Mini-map | ✅ | `MiniMapAndTurn.cs` |
| **Cities** | Grow with population and era, architectural styles, sprawl over hexes | ✅ | `CityLayout.cs`, `TechLook.cs`, `models/era`, `models/landmarks` |
| | Districts, buildings, 14 + 9 wonder models | ✅ | `models/buildings`, `models/wonders` |
| **Units** | Ancient → Information (and the futures), unique units | ✅ | `UnitLayer.cs` `UnitLook` table, `models/units` |
| | Idle, move, embark | ✅ | KayKit rigs carry 132 clips; embark swaps to a boat |
| | Attack, hit, death animations | ✅ | `UnitLayer.cs` combat region: lunge/shoot/recoil, flinch, death clip or wreck, then sink |
| | Readable silhouettes when zoomed out | ✅ | one bold flag per tile with a count at strategic zoom |
| **Leaders** | Portraits (animated) | ✅ | `LeaderPortrait.cs`: live 3D figure in nation colours (lobby, diplomacy) |
| | Diplomacy backgrounds | ✅ | nation landmark, banner and sky palette behind each portrait |
| **UI** | Yield, resource, district icons; tech and civic trees; city, unit panels; tooltips; fonts (Cinzel, EB Garamond, Inter-style) | ✅ | `UiTheme.cs`, `ResearchPanel.cs`, `assets/ui` |
| | Per-tech / per-unit icons | 🟡 P2 | trees use era and category icons; a Kenney icon per unit class would help |
| **Polish** | Water shader, particles (smoke, fire, dust), soft shadows, selection rings, border glow, clouds, bloom, SSAO/SSIL | ✅ | `water.gdshader`, `smoke.gdshader`, `BattleFx.cs`, `MapFx.cs`, `CloudLayer.cs` |
| | Day/night cycle + dynamic lighting | ✅ | `DayNight.cs`, toggle in the Esc menu |
| | Smooth zoom with LOD | ✅ | strategic mode above distance 26 (exit below 22): banners, flags, clutter |

## 2. Prioritised plan

*Status: P0 and P1 shipped in the first visual pass. Open follow-ups: lit windows at night, a cape or uniform tint for
20th-century leader portraits, trains on railways, and a melee attacker's flinch from counter-damage.*

**P0 — readable at strategic zoom (this pass).**
1. *Strategic LOD.* Beyond a camera distance threshold: city banners collapse to a compact pill (population + name),
   townsfolk/animals/traffic are hidden, unit figures are replaced or overlaid by bold nation-coloured badges, and stacked
   badges fan out instead of overlapping. Hysteresis so it does not flicker at the threshold.
2. *Yield lens (Y).* Food / production / gold / science / culture / faith icons with numbers on every visible tile.
3. *Combat animations.* Attacker plays an attack clip and lunges toward the target, the defender flinches (hit clip), and a
   unit that dies plays its death clip and sinks before it is removed. Vehicles without rigs recoil and burn instead.

**P1 — atmosphere and character (this pass).**
4. *Railroads and bridges.* Rails with sleepers on roads once the owner has Railroad; a bridge wherever a road crosses a river.
5. *Fog-of-war cartography.* Ink compass roses, sea serpents and sailing ships drawn on unexplored ocean, placed
   deterministically from the map seed, fading out as the sea is explored.
6. *Animated leader portraits.* Each leader is a rigged KayKit/Quaternius figure in nation colours playing an idle clip, rendered
   live in a `SubViewport`, in front of a **nation diplomacy background** (the nation's landmark model, sky and palette). Shown
   in the lobby dossier and the diplomacy screen.
7. *Day/night cycle.* A slow sun arc (morning → dusk) with warmer light at low sun, night kept readable (moonlight floor, lit
   windows); on by default, toggle in the Esc menu.

**P2 — next.** Per-unit-class icons (Kenney Game Icons), tech/civic icons, Quaternius animated animals and ships, a second
terrain variant set from ambientCG for tundra/snow.
**P3 — later.** Hand-painted leader art if a CC0 source appears; seasonal palettes.

## 3. Folder structure and pipeline

```
godot/
  assets/
    models/            glTF/GLB, one folder per role (pivot at bottom centre, metres, credit in the file)
      buildings/ era/ future/ landmarks/ life/ nature/ props/ resources/ units/ wonders/
    terrain/           PBR layers  <name>_{baseColor,normal,roughness}.jpg   (Poly Haven / ambientCG)
    sky/               HDRI
    ui/icons/ ui/fonts/ ui/resources/
    audio/music/ audio/sfx/
    CREDITS.md         generated: every third-party file, author, licence, changes
  shaders/             terrain, water, river, road, clouds, smoke, model_tint, paper_grade, hexmap.gdshaderinc
  scripts/
    Map/               HexLayout (axial/offset maths after Red Blob Games), HexMapView, PlacementLens
    Visuals/           TerrainMesh, ModelLibrary, UnitLayer, CityLayout, LifeLayer, BattleFx, MapFx, CloudLayer, TechLook,
                       LeaderPortrait (new), DayNight (new)
    Hud/  UI/          interface
tools/assets/
  assets.json          the manifest: {name, type, id: "<source>:<path>", dest, roles?}
  fetch_assets.py      downloads, re-packs, rescales, credits; writes assets.lock.json and CREDITS.md
```

**Adding art:** add an entry to `tools/assets/assets.json` (`kaykit:`, `kenney:`, `quaternius:`/`polyfork:`, `polyhaven:`,
`ambientcg:`), run `python3 tools/assets/fetch_assets.py`, then reference it by `"<dest>/<name>"` through
`ModelLibrary.Instance(...)` (models are tinted with `model_tint.gdshader`, so team colour is free).

**Licences.** CC0 only by default (KayKit, Kenney, Quaternius, Poly Haven, ambientCG). CC-BY is allowed when credited in
`CREDITS.md`. *Vinish, VinkGames Essentials 4X, RatByteBoss and individual OpenGameArt items must have their licence checked
per file before they enter the manifest.* Red Blob Games and the LexDev fog-of-war study are technique references; OpenCiv,
MostlyCivilizedHexEngine and civ-clone are design references only (no code or art copied).

**Readability rules.** Every gameplay-relevant thing has a silhouette or icon that reads at the farthest zoom: nation colour
on units and borders, one badge per tile stack, banners never larger than ~2 hexes on screen, decoration hidden before
information. Strategic view is tested with `--do=zoom:3.0` screenshots in `tools/client-smoke.sh`.
