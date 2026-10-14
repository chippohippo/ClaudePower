# Imported art (CC0 packs) in SKYFALL

SKYFALL can replace its procedural characters, guns, trees, rocks, sky lighting, surface detail
and sounds with free asset packs. Everything stays optional and per-item: anything without an asset
keeps the procedural version, so the game always runs.

## Workflow

```
node tools/assets/fetch.mjs            # 1. auto-download Poly Haven, ambientCG and Kenney packs
                                       #    (prints the packs that need a browser click)
#                                        2. download the manual packs, drop zips under assets-src/
node tools/assets/import.mjs           # 3. unzip, inspect, assign roles, copy to public/assets,
                                       #    write manifest.json + IMPORT_REPORT.md + CREDITS.md
npm run dev
open http://localhost:5173/tools/assets/viewer.html   # 4. check facing, scale, clips; tweak manifest
open http://localhost:5173/                            # 5. play
```

`node tools/assets/fixturetest.mjs [--import]` runs the whole pipeline end to end with generated
stand-in models that follow Quaternius / Kenney conventions. It uses a skinned rig with
`CharacterArmature|Run`-style clips, guns lying along +X and a two-material tree. It is the
regression test for this system; `--import` also exercises zip extraction and role assignment.

### Network access

The downloads need these hosts reachable: `quaternius.com`, `kenney.nl`, `itch.io` (and its CDN),
`polyhaven.com`, `api.polyhaven.com`, `dl.polyhaven.org`, `ambientcg.com`, `www.mixamo.com`,
`freesound.org`. In a sandboxed cloud environment, add them under the environment's
**Network access → Allowed domains**. `fetch.mjs` uses `curl`, so it honours `HTTPS_PROXY`.

## Packs and the roles they fill

| Pack | License | Role | How it's picked up |
|---|---|---|---|
| Quaternius Universal Base Characters | CC0 | `characters.default` (every legend, tinted) | rigged model named base/UBC/superhero/… |
| Quaternius Universal Animation Library | CC0 | `characters.default.animations` | rigged GLB with ≥8 clips sharing ≥60% of the base's bone names |
| Quaternius Ultimate Animated Character Pack, KayKit | CC0 | `characters.<legend>` | rigged models with their own clips, matched by theme words (soldier→Kodiak, medic→Halo, ninja→Phantom…), the rest round-robin |
| Quaternius Ultimate Guns, 3dmodelscc0 Guns, Kenney Blaster Kit | CC0 | `weapons.<id>` | name rules: AK/assault→Talon & Mauler, SMG/Uzi→Hornet, blaster/plasma→Surge, LMG/minigun→Bulwark, shotgun→Breacher, DMR→Marshal, sniper→Harrier, revolver/magnum→Raptor, pistol→Stinger |
| WRAD ARMS | see its itch.io page | `arms` (first person) | path/name contains wrad / arms |
| Kenney Nature Kit, Quaternius Nature MegaKit | CC0 | `nature.tree / rock / bush` (≤4 variants each) | tree/pine/oak…, rock/boulder…, bush/shrub… |
| Poly Haven HDRIs | CC0 | `hdri` | first `.hdr` |
| Poly Haven / ambientCG textures | CC0 | `textures.ground / wall / floor / metal / wood / rock / roof` | colour map in a folder named after the role |
| Kenney UI Audio / Impact / Interface Sounds, freesound CC0 | CC0 | `sounds.<recipe>` | click→`ui`, rollover→`ui_hover`, pickup→`pickup`, open→`bin_open`… |
| Mixamo | Adobe terms (not CC0) | optional extra clips | export FBX "without skin" on the same rig and add to `animations` |

## How assets are adapted to the comic / cel look

- **Materials**: FBX Phong/Lambert and glTF materials become `MeshStandardMaterial`, with colour maps
  in sRGB. In Comic style every copy handed to the game goes through the same `toonify()` as the
  procedural world: 3-band cel lighting, keeping maps, vertex colours and emissive. The post pass then
  inks silhouettes and creases, so imported models get the same outlines. Clean style keeps PBR.
- **Characters** are normalised to 1.8 m, feet on the ground, facing −Z. Outfit materials (named
  main/body/cloth/shirt/suit/armor… or listed in `tint`) are tinted toward the legend colour so every
  legend stays readable. The friend/foe rim light, colour-vision presets, reveal highlight, phase
  ghost, Fallback Shield and squad marker all work on imported rigs.
- **Animation**: one `AnimationMixer` per character. Movement flags pick a state that crossfades to the
  matching clip:
  - States: idle, walk, run, crouch, slide, jump, skydive, zip, downed, heal.
  - Clip names are matched for Quaternius, Mixamo and Kenney naming (`CLIP_PATTERNS` in
    `client/assets.js`); manifest `clips` overrides them.
  - Walk/run playback follows ground speed and plays in reverse when back-pedalling.
  - The spine bends with aim pitch and kicks when firing.
  - Distant characters update their animation at 10–20 Hz.
- **Guns** are sized per class (pistol 0.3 m … sniper 1.2 m) and seated with the rear at the grip,
  barrel along −Z. The muzzle flash and ADS sight height come from the model bounds (or `muzzle` /
  `sightY` in the manifest). Holo and scope attachments still mount on top. Third-person guns follow
  the character's right-hand bone.
- **First-person arms** are skinned and get skinned ink hulls (pushed out along the animated
  normals) so they outline like the procedural viewmodel.
- **Trees and bushes** become `InstancedMesh` per part with random rotation and scale. **Rocks** are
  stretched over the existing rock collision boxes, so what you see is exactly what you climb and take
  cover behind.
- **Textures** add surface detail only. Each texture's brightness is divided by its own average (its
  smallest mip), so a Poly Haven concrete adds grain without overriding the zone palettes or the cel
  bands.
- **HDRI** replaces the image-based lighting. Comic keeps its cel sky; Clean can show the HDRI as the
  background (`"background": true`).
- **Samples** replace the synthesized sound of the same name; everything else stays procedural.

## manifest.json reference

```jsonc
{
  "characters": {
    "default": {
      "file": "characters/UBC_Superhero_Male.glb",
      "animations": ["animations/UAL1.glb"],      // shared clip libraries (same bone names)
      "height": 1.8, "rotY": 3.1416,              // facing fix (default π: packs face +Z)
      "tint": ["Main", "Shirt"], "tintAmount": 0.7,
      "handBone": "Hand.R", "spineBone": "Spine2",// loader-renamed names ("HandR") also match
      "clips": { "run": "CharacterArmature|Run" } // per-state overrides
    },
    "kodiak": { "file": "characters/Soldier.glb" }
  },
  "weapons": { "viper": { "file": "weapons/Revolver.glb", "rotY": 1.5708, "length": 0.32, "muzzle": [0, 0.04, -0.3], "sightY": 0.09 } },
  "arms": { "file": "arms/WRAD_Arms.fbx", "scale": 0.01, "pos": [0, -0.2, 0], "rot": [0, 3.1416, 0] },
  "nature": { "tree": ["nature/tree_pineRoundA.glb"], "rock": [ … ], "bush": [ … ] },
  "hdri": { "file": "hdri/kloofendal_2k.hdr", "intensity": 0.6, "background": false },
  "textures": { "ground": { "map": "textures/ground_aerial_grass_rock_diff_1k.jpg", "scale": 4, "strength": 0.6 } },
  "sounds": { "ui": "audio/click1.ogg" }
}
```

Draco-compressed glTF is not enabled: export uncompressed, or add `DRACOLoader` with local
decoder files.
