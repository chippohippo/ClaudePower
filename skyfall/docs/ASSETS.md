# Imported art (CC0 packs) in SKYFALL

SKYFALL can replace its procedural characters, guns, trees, rocks, props, sky lighting, surface
detail and sounds with free asset packs. Everything stays optional and per-item: anything without an
asset keeps the procedural version. With no `public/assets/manifest.json` at all, the game runs
entirely on procedural art, exactly as before.

## Workflow

```
npm run assets:fetch       # 1. download what can be fetched automatically into assets-src/
#                            2. download the manual packs (assets-src/README.md), drop the zips in assets-src/
npm run assets:import      # 3. unzip, inspect, assign roles, optimise, write public/assets/
                           #    (manifest.json, IMPORT_REPORT.md, CREDITS.md)
npm run dev
open http://localhost:5173/tools/assets/viewer.html   # 4. check facing, scale, clips
#                            5. fix wrong guesses in tools/assets/overrides.json, import again
open http://localhost:5173/                            # 6. play (Settings → Art style: Comic / Clean)
npm run assets:test        # regression test (needs npm run dev; backs up and restores the real manifest)
```

`assets-src/` is git-ignored except its README, which lists the manual packs and where to put them.
`public/assets/` is committed (about 5 MB), so a fresh clone plays with the imported art without
fetching anything.

Importer flags and environment variables:

| | |
|---|---|
| `--dry` | report the mapping, write nothing |
| `--fresh` | ignore hand edits in the existing manifest (`overrides.json` still applies) |
| `--no-reuse` | never use one gun model for two weapons |
| `--no-optimize` | copy models as they are (skips glTF-Transform) |
| `ASSETS_SRC`, `ASSETS_OUT` | other source / output folders (the fixture test uses these) |

The importer prints every choice and writes it to `public/assets/IMPORT_REPORT.md`. That includes role
coverage, guns marked `CHECK IN VIEWER`, and the size before and after optimisation.

### Network access

`fetch.mjs` gets its packs in three ways:

1. **GitHub.** It makes sparse, blobless clones of the authors' own repos: KayKit characters and Space
   Base, and Kenney Starter Kit FPS. It also takes the Poly Haven HDRIs mirrored in the three.js repo.
2. **A release mirror.** The Quaternius MegaKits come from the jgengine GitHub release. Every zip must
   contain Quaternius' own `License_Standard.txt`, or it is rejected.
3. **The official sites,** when they can be reached: Poly Haven API, ambientCG, kenney.nl.

These all appear in `tools/assets/sources.json`. Packs behind a download button
(quaternius.com, itch.io) always need a browser.

To let the cloud sandbox reach the official sites directly, add these under the environment's
**Network access → Allowed domains**:

- `quaternius.com`
- `kenney.nl`
- `itch.io` and its CDN
- `polyhaven.com`, `api.polyhaven.com`, `dl.polyhaven.org`
- `ambientcg.com`
- `freesound.org`

`fetch.mjs` uses `curl`, so it honours `HTTPS_PROXY`.

## What is imported now

| Slot | Model | Pack |
|---|---|---|
| Tank: Kodiak / Bastion / Miasma | Knight / Barbarian / Skeleton Warrior | KayKit Adventurers, Skeletons |
| DPS: Jolt / Phantom / Spectre | Rogue / Rogue (hooded) / Skeleton Rogue | KayKit |
| Support: Halo / Echo / Volt | Mage / Skeleton Mage / Skeleton Minion | KayKit |
| Volt SMG, Hornet | blaster-repeater | Kenney Starter Kit FPS |
| Viper, P2020 | blaster | Kenney Starter Kit FPS |
| other 6 guns | procedural | until a gun pack is dropped in |
| trees / rocks / bushes | Common Tree, Pine; Rock Medium ×3; Bush, Fern | Quaternius Stylized Nature MegaKit |
| crates / containers / barrels | cargo crates, stacked cargo; Prop Barrel | KayKit Space Base; Quaternius Modular Sci-Fi |
| HDRI | `quarry_01` (1k) | Poly Haven |
| textures | Grass004, Concrete015, PavingStones012, MetalPlates006, Planks012, Rock023, RoofingTiles006 | ambientCG |
| sound | `draw` ← weapon change | Kenney Starter Kit FPS |

Every role has 3 distinct characters, so Sixes always gets 2 Tank / 2 DPS / 2 Support with no
repeated model.

## Role rules (tools/assets/import.mjs)

**Characters**

- A rigged model is any skinned glTF/GLB, any Mixamo character, or an FBX whose path says
  character/human/soldier/male/female.
- Each model is classified by its name (`ROLE_WORDS`):

  | Role | Name words |
  |---|---|
  | Tank | knight, warrior, barbarian, golem, robot, soldier… |
  | DPS | rogue, ninja, hunter, scout, pirate, hooded… |
  | Support | mage, medic, druid, engineer, minion, shaman… |

- **Legend assignment.** Within each role, legends of that role first take the model that matches
  their theme (`LEGEND_THEME`, for example knight→Kodiak, barbarian→Bastion, hood→Phantom,
  medic/mage→Halo). Then they take the rest of that role's models, then unclassified models, then
  leftovers from other roles. Each entry gets `"role"`.
- **Coverage check.** The log prints the coverage, for example `3 tank / 3 dps / 3 support (Sixes
  needs 2/2/2 distinct)`, and flags a model that reads as a different role from its legend.
- **Base model.** `characters.default` is a model named base/UBC/universal/superhero/mannequin, or
  the first animated one.
- **Shared animation libraries.**
  - A rigged GLB with ≥8 clips named anim/UAL/library becomes the default's shared library when it
    shares ≥60% of the base's bone names. A mesh-less GLB counts too.
  - Characters that share one rig (all KayKit models, Quaternius UBC) get one library written once
    (`animations/rig0_*.glb`), and their own copies of the clips are stripped.
- **Held props are hidden.** Equipment meshes (sword, shield, axe, staff, crossbow, mug…) are
  removed from character files and listed in `hide`.
- **Tint.** `tintAmount` is 0.22 for multi-part models with one colour atlas (KayKit, Kenney), so they
  keep their own colours. Otherwise it is 0.6.

**Weapons**

- **Archetype by name** (`ARCH`): sniper, DMR/marksman, shotgun, LMG/minigun, SMG/uzi/repeater,
  revolver/magnum, pistol/blaster, AR/AK/M4/rifle. Ammo, scopes, grenades, crates and cases are
  ignored (`NOT_GUN`).
- **Weapon slots** (`WANT`):

  | Archetype | Weapon |
  |---|---|
  | AR | Talon, Mauler |
  | SMG | Hornet, Volt |
  | LMG | Bulwark |
  | Shotgun | Breacher |
  | DMR | Scout |
  | Sniper | Sentinel |
  | Revolver | Viper |
  | Pistol | P2020 |

  - If an archetype is missing, `FALLBACK` borrows a near one (revolver→pistol, DMR→AR/sniper…).
  - Volt prefers sci-fi models; the others prefer realistic ones.
  - A model can fill two slots unless `--no-reuse` is set.
- **Facing** (`src/shared/gunfacing.js`, also used at runtime when `rotY` is missing).
  - The longest horizontal axis is the barrel.
  - The grip is the end where the low geometry hangs (the centroid of the bottom 35% of vertices).
    The muzzle is the opposite end, and the thinner cross-section confirms it.
  - The result is `rotY`, which turns the muzzle to −Z, plus a confidence.
  - Below 0.3 confidence, the gun is marked `CHECK IN VIEWER`. Fix it in `overrides.json`, for
    example `"rotY": 0` or `+ 3.1416`.

**Nature and props**

- Trees use tree/pine/oak/birch names, excluding twisted/dead/autumn/red ones (red is the enemy
  highlight colour). Variants are picked across families.
- Rocks use rock/boulder/stone; bushes use bush/shrub/fern/grass.
- Props: crate/cargo → `props.crate`, stacked/container → `props.container`, barrel → `props.barrel`,
  column/pillar → `props.pillar`.
- Up to 4 variants each.

**HDRI, textures and sounds**

- HDRI: `quarry` is preferred, otherwise the first `.hdr`.
- Textures: the colour map in a folder named after its role, resized to 512 px JPEG.
- Sounds: click→`ui`, rollover→`ui_hover`, pickup→`pickup`, open→`bin_open`, weapon change→`draw`.

**Manual overrides.** `tools/assets/overrides.json` is deep-merged over the result on every import,
with `null` deleting a key. Earlier hand edits to `manifest.json` are also kept unless `--fresh` is
set.

### Bones and clips

**Bone matching.** Bones are found by exact name, then by three.js-sanitised name
(`Hand.R` → `HandR`, `mixamorig:RightHand` → `mixamorigRightHand`), then by pattern:

- right hand: `right hand / hand.r / hand_r / handr / mixamorig:RightHand`
- spine: `spine2 / chest / upperchest / spine1 / spine`

`handBone` / `spineBone` in the manifest win over all of these.

**Clip mapping** (`src/shared/clips.js`, used by both the importer and the game). Each state has an
ordered list of patterns that cover KayKit, Quaternius, Kenney and Mixamo names:

| State | Example clip names |
|---|---|
| idle | `Idle_Gun`, `Rifle Aiming Idle`, `2H_Ranged_Aiming` |
| walk / walkBack | `Walking_A`, `Walking_Backwards` |
| run | `Running_A`, `Rifle Run` |
| strafeL / strafeR | `Running_Strafe_Left` |
| crouch | `Crouch_Walk` |
| slide | `Slide`, `Sit_Floor_Idle` |
| jump | `Jump_Idle` |
| skydive | `Falling`, `Jump_Idle` |
| zip | `Hang` |
| downed | `Crawl`, `Lie_Idle` |
| death | `Death_A` |
| shoot | `2H_Ranged_Shoot`, `Rifle Shoot` |
| reload | `2H_Ranged_Reload` |
| hit | `Hit_A` |
| heal | `Use_Item` |

The importer keeps only clips that some state can use. A manifest `clips` map overrides any state.

### Mixamo

Put Mixamo files here:

- characters, downloaded "With Skin": `assets-src/mixamo/characters/*.fbx`
- clips, downloaded "Without Skin": `assets-src/mixamo/animations/*.fbx`

Every Mixamo clip is called `mixamo.com`, so the loader renames each one after its file. Name the
files after the action ("Rifle Run.fbx", "Rifle Aiming Idle.fbx", "Reloading.fbx", "Falling
Idle.fbx", "Dying.fbx") and the patterns above pick them up.

**Retargeting.** Clips bind to bones by name, so Mixamo clips only drive `mixamorig` skeletons. To
animate a non-Mixamo character with them, upload it to Mixamo, auto-rig it, and download it With Skin.
It then shares the `mixamorig` names. Use "In Place" downloads: the game moves the character, so
root motion would double it. Mixamo is under Adobe's terms, not CC0, so keep it out of anything
redistributed as CC0.

## Optimisation (tools/assets/optimize.mjs)

glTF-Transform is a devDependency. Each model is processed as follows:

1. Held props and unused clips are removed, along with their keyframe data.
2. Normal, occlusion and metal/roughness maps are dropped. The cel look uses only base colour.
3. The model is pruned, deduped and welded. Characters are not welded.
4. Animation is resampled.
5. Vertices are quantized.
6. Colour textures are re-encoded to WebP at ≤512 px.
7. Meshopt compression is applied. The browser decodes it with three's bundled `MeshoptDecoder`, with
   no CDN or WASM download.

Rocks are simplified to 80% and bushes to 60%. Together this took the imported set from 154 MB to
about 3 MB of models.

At runtime, each character's skinned parts that share a material are merged into one SkinnedMesh on a
union skeleton (`mergeSkinnedParts`). This takes a KayKit character from about 8 draw calls to 3.

## How assets are adapted to the comic / cel look

- **Materials.** FBX Phong/Lambert and glTF materials become `MeshStandardMaterial`, with colour
  maps in sRGB.
  - In Comic style every copy goes through the same `toonify()` as the procedural world: 3-band cel
    lighting that keeps maps, vertex colours, emissive and alpha-tested leaves. The ink pass then
    outlines them like everything else.
  - Clean keeps PBR, lit by the HDRI.
- **Characters**
  - Normalised to 1.8 m, feet on the ground, facing −Z.
  - Outfit materials are tinted toward the legend colour (by `tintAmount`).
  - Friend/foe rim, colour-vision presets, reveal highlight, phase ghost and squad markers all work on
    imported rigs.
- **Animation**
  - One `AnimationMixer` per character; states crossfade.
  - Strafe plays when sideways speed is more than 1.2× forward speed. `walkBack` plays when moving
    backwards, or a reversed walk if the rig has no backwards clip.
  - When standing still, firing and reloading play the rig's shoot and reload clips. Heal plays
    `Use_Item`.
  - Playback speed follows ground speed against each clip's nominal speed: run 6.5, walk 3, crouch
    2.2, strafe 5.5, walkBack 2.6 m/s.
  - The spine bends with aim pitch and kicks when firing.
  - Skydivers pitch forward 60–86°, depending on how steeply they dive.
  - On death, the ragdoll copy plays the rig's death clip instead of the tumbling procedural collapse.
- **Guns**
  - Sized per class (pistol 0.3 m … sniper 1.2 m) and seated with the rear at the grip, barrel along
    −Z.
  - Muzzle flash and ADS sight height come from the model bounds, or from `muzzle` / `sightY` in the
    manifest.
  - Third-person guns sit in the right hand.
- **First-person arms** are skinned and get skinned ink hulls.
- **Trees and bushes** become `InstancedMesh`es.
- **Rocks and props are draped** over the existing collision boxes, so what you see is exactly what
  you climb and take cover behind.
  - Each model is stretched to its box and turned 90° if that fits the box's long axis better.
  - Each instance is tinted toward the box's palette colour, which keeps zone colours and the comic
    palette.
- **Textures** add surface detail only. Each texture is divided by its own average brightness, so it
  adds grain without overriding zone palettes or cel bands.
- **HDRI** replaces image-based lighting. Comic keeps its cel sky. Clean can show the HDRI as the
  background (`"background": true`).
- **Samples** replace the synthesized sound of the same name. Everything else stays procedural.

## Tuning knobs

| Knob | Where | Default | Effect |
|---|---|---|---|
| `tintAmount` | manifest, per character | 0.22 atlas / 0.6 | how strongly outfit takes the legend colour |
| `tint` | manifest, per character | outfit-named materials | which materials get the legend tint |
| `hide` | manifest, per character | held props found by importer | node names hidden at load |
| `clips` | manifest, per character | pattern match | state → clip name |
| `rotY`, `length`, `muzzle`, `sightY` | manifest, per weapon | facing heuristic, class length | gun orientation / size / flash / ADS height |
| `hdri.intensity`, `hdri.background` | manifest | 0.6, false | IBL strength (Clean multiplies it by 0.6) |
| `textures.<role>.scale / strength` | manifest | 4 / 0.6 | detail texture repeat and contrast |
| tree LOD radius | `world.js` `_updateTreeLod` | 160 m trees, 140 m bushes | imported models inside, procedural cones / nothing outside; re-evaluated every 0.4 s |
| drape padding / tint | `world.js` `_boxes` | rocks `[1.12,1.06]` / 0.45, props `[1.04,1.02]` / 0.7 | model overhang past the box; how far each instance shifts to the box colour |
| animation LOD | `modelavatar.js` | every frame <35 m, 30 Hz <80 m, 15 Hz <160 m, 7 Hz <300 m, 4 Hz beyond | CPU per remote character |
| clip speeds | `modelavatar.js` `nominal` | see above | foot sliding vs. playback rate |
| rim power | `palette.js` | 3.2 | friend/foe rim width (higher is thinner; stops red washing over characters) |
| `SIMPLIFY` | `import.mjs` | rock 0.8, bush 0.6 | triangle ratio kept by the importer |
| `maxTex` | `optimize.mjs` | 512 | longest texture side |
| `ROLE_WORDS`, `LEGEND_THEME`, `ARCH`, `WANT`, `FALLBACK` | `import.mjs` | see above | automatic assignment |

## manifest.json reference

```jsonc
{
  "characters": {
    "default": {
      "file": "characters/UBC_Superhero_Male.glb",
      "animations": ["animations/UAL1.glb"],      // shared clip libraries (same bone names)
      "height": 1.8, "rotY": 3.1416,              // facing fix (default π: packs face +Z)
      "tint": ["Main", "Shirt"], "tintAmount": 0.6,
      "hide": ["1H_Sword", "Round_Shield"],       // held props
      "handBone": "Hand.R", "spineBone": "Spine2",// sanitised names ("HandR") also match
      "clips": { "run": "CharacterArmature|Run" } // per-state overrides
    },
    "kodiak": { "file": "characters/Knight.glb", "role": "tank" }
  },
  "weapons": { "viper": { "file": "weapons/Revolver.glb", "rotY": 1.5708, "archetype": "Revolver", "length": 0.32, "muzzle": [0, 0.04, -0.3], "sightY": 0.09 } },
  "arms": { "file": "arms/WRAD_Arms.fbx", "scale": 0.01, "pos": [0, -0.2, 0], "rot": [0, 3.1416, 0] },
  "nature": { "tree": ["nature/CommonTree_1.glb"], "rock": [ … ], "bush": [ … ] },
  "props": { "crate": ["props/cargo_A.glb"], "container": [ … ], "barrel": [ … ] },
  "hdri": { "file": "hdri/quarry_01_1k.hdr", "intensity": 0.6, "background": false },
  "textures": { "ground": { "map": "textures/ground.jpg", "scale": 4, "strength": 0.6 } },
  "sounds": { "ui": "audio/click1.ogg" }
}
```

Meshopt-compressed GLBs load out of the box. Draco is not enabled, so export without Draco.

## Still missing

Only two real gun models exist so far, the Kenney blasters, and they fill four slots. Talon, Mauler,
Bulwark, Breacher, Scout and Sentinel stay procedural until a gun pack is added. The first three
packs in `assets-src/README.md` are all CC0, and dropping in any of them fills every archetype:

- Quaternius Ultimate Guns
- 3dmodelscc0 Guns
- Kenney Blaster Kit

First-person arms also stay procedural until WRAD ARMS or a Mixamo rig is added.
