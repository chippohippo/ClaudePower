# assets-src — raw asset packs (not committed)

Everything in this folder except this README is ignored by git. `tools/assets/import.mjs` reads
it and writes the optimised, game-ready result to `public/assets/` (which **is** committed, ~5 MB).

## 1. Get what can be fetched automatically

```
npm run assets:fetch          # = node tools/assets/fetch.mjs
```

From a machine that can only reach GitHub (like the SKYFALL cloud sandbox) this already gets:

| Folder | Source | License |
|---|---|---|
| `kaykit-adventurers/` | github.com/KayKit-Game-Assets — Knight, Barbarian, Mage, Rogue, Rogue (hooded); 76 clips incl. 2-handed aim/shoot/reload, strafes, dodges | CC0 |
| `kaykit-skeletons/` | github.com/KayKit-Game-Assets — Skeleton Warrior, Mage, Rogue, Minion (same rig) | CC0 |
| `kaykit-space-base/` | github.com/KayKit-Game-Assets — cargo crates + stacked cargo (crate / container props) | CC0 |
| `kenney-starter-kit-fps/` | github.com/KenneyNL/Starter-Kit-FPS — blaster + blaster-repeater, sounds | CC0 assets |
| `polyhaven/hdri/` | Poly Haven `quarry_01`, `spruit_sunrise` (1k, mirrored in the three.js repo) | CC0 |
| `quaternius/*.zip` | Quaternius Stylized Nature MegaKit + Modular Sci-Fi MegaKit (GitHub release mirror; each zip is checked for Quaternius' license file) | CC0 |
| `ambientcg/<role>/` | ambientCG Grass004, Concrete015, PavingStones012, MetalPlates006, Planks012, Rock023, RoofingTiles006 | CC0 |

With full internet access it also tries Poly Haven's API, ambientCG directly and kenney.nl.

## 2. Download these by hand (they need a browser click)

Drop each **zip as downloaded** (or its unzipped folder) anywhere in this folder. The folder name
should keep the pack name, because the importer reads names to assign roles.

| Pack | Where | Put it at | What it adds |
|---|---|---|---|
| **Quaternius — Ultimate Guns Pack** (glTF) | quaternius.com → Packs | `assets-src/quaternius-ultimate-guns.zip` | **the missing gun archetypes**: AR, SMG, LMG, shotgun, DMR, sniper, revolver, pistol |
| **3dmodelscc0 — Free CC0 Guns & Explosives Pack** | 3dmodelscc0.itch.io/free-cc0-guns-explosives-pack | `assets-src/3dmodelscc0-guns.zip` | more guns (fills archetypes Quaternius lacks) |
| **Kenney — Blaster Kit** | kenney.nl/assets/blaster-kit | `assets-src/kenney-blaster-kit.zip` | sci-fi guns (energy SMG, etc.) |
| Quaternius — Universal Base Characters + Universal Animation Library | quaternius.com → Packs | `assets-src/quaternius-ubc.zip`, `assets-src/quaternius-ual.zip` | a realistic-proportion base rig + big shared clip library |
| Quaternius — Ultimate Animated Character Pack | quaternius.com → Packs | `assets-src/quaternius-ultimate-characters.zip` | more per-legend characters |
| WRAD ARMS (wriks) | wriks.itch.io/wrad-arms (check its license) | `assets-src/wrad-arms/` | first-person arms |
| Kenney — Nature Kit | kenney.nl/assets/nature-kit | `assets-src/kenney-nature-kit.zip` | more trees / rocks |
| Kenney — UI Audio / Interface / Impact Sounds | kenney.nl/assets | `assets-src/kenney-ui-audio.zip` … | recorded UI sounds |

Prefer the **glTF / GLB** download when a pack offers several formats (FBX also works).

### Mixamo (optional, not CC0)

Mixamo (Adobe) animations are royalty-free under Adobe's terms, not CC0:

```
assets-src/mixamo/characters/<Name>.fbx     # characters, "With Skin"
assets-src/mixamo/animations/<Clip>.fbx     # animations for those characters, "Without Skin"
```

Every Mixamo character gets every Mixamo animation; clips are named after their file ("Rifle Run",
"Rifle Aiming Idle" …), because Mixamo names every clip `mixamo.com`. The game binds clips to bones by
name, so Mixamo animations only drive Mixamo-rigged characters. To use them on another rig, upload
that character to Mixamo first so it gets the `mixamorig` skeleton.

## 3. Import, check, play

```
npm run assets:import         # = node tools/assets/import.mjs   (--fresh to ignore earlier hand edits)
npm run dev
open http://localhost:5173/tools/assets/viewer.html
```

Fix anything the heuristics got wrong in `tools/assets/overrides.json` (see its `_doc`), then
import again. See `docs/ASSETS.md` for the role rules and every tuning knob.
