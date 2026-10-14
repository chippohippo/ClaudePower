# SKYFALL asset import

source: assets-src — 1820 files, 0 zips extracted, 282 models

characters.default   ← kaykit-adventurers/Barbarian.glb (76 clips)
characters.jolt     ← kaykit-adventurers/Rogue.glb  [DPS]  hides 5 held props
characters.phantom  ← kaykit-adventurers/Rogue_Hooded.glb  [DPS]  hides 5 held props
characters.halo     ← kaykit-adventurers/Mage.glb  [SUPPORT]  hides 4 held props
characters.bastion  ← kaykit-adventurers/Barbarian.glb  [TANK]  hides 5 held props
characters.echo     ← kaykit-skeletons/Skeleton_Mage.glb  [SUPPORT]
characters.miasma   ← kaykit-skeletons/Skeleton_Warrior.glb  [TANK]
characters.volt     ← kaykit-skeletons/Skeleton_Minion.glb  [SUPPORT]
characters.spectre  ← kaykit-skeletons/Skeleton_Rogue.glb  [DPS]
characters.kodiak   ← kaykit-adventurers/Knight.glb  [TANK]  hides 7 held props
  shared animation library animations/rig0_kaykit_adventurers_anims.glb: 14 clips for 10 characters
  role coverage: 3 dps / 3 support / 3 tank (Sixes needs 2/2/2 distinct)
weapons.volt     ← kenney-starter-kit-fps/models/blaster-repeater.glb  [SMG for SMG; muzzle +z, confidence 0.89]
weapons.hornet   ← kenney-starter-kit-fps/models/blaster-repeater.glb  [SMG for SMG; muzzle +z, confidence 0.89]
weapons.viper    ← kenney-starter-kit-fps/models/blaster.glb  [Pistol for Pistol; muzzle +z, confidence 0.20 — CHECK IN VIEWER]
weapons.p20      ← kenney-starter-kit-fps/models/blaster.glb  [Pistol for Pistol; muzzle +z, confidence 0.20 — CHECK IN VIEWER]
  procedural guns kept for: talon, mauler, bulwark, breacher, scout, sentinel
nature.tree          ← quaternius/quaternius-stylized-nature/glTF/CommonTree_1.gltf, quaternius/quaternius-stylized-nature/glTF/Pine_1.gltf, quaternius/quaternius-stylized-nature/glTF/CommonTree_2.gltf, quaternius/quaternius-stylized-nature/glTF/Pine_2.gltf
nature.rock          ← quaternius/quaternius-stylized-nature/glTF/Rock_Medium_1.gltf, quaternius/quaternius-stylized-nature/glTF/Rock_Medium_2.gltf, quaternius/quaternius-stylized-nature/glTF/Rock_Medium_3.gltf
nature.bush          ← quaternius/quaternius-stylized-nature/glTF/Bush_Common.gltf, quaternius/quaternius-stylized-nature/glTF/Fern_1.gltf
props.crate          ← kaykit-space-base/cargo_A.gltf, kaykit-space-base/cargo_A_packed.gltf, kaykit-space-base/cargo_B.gltf, kaykit-space-base/cargo_B_packed.gltf
props.container      ← kaykit-space-base/cargo_A_stacked.gltf, kaykit-space-base/cargo_B_stacked.gltf
props.barrel         ← quaternius/quaternius-modular-scifi/Modular SciFi MegaKit[Standard]/glTF/Props/Prop_Barrel_Large.gltf
props.pillar         ← quaternius/quaternius-modular-scifi/Modular SciFi MegaKit[Standard]/glTF/Columns/Column_Astra.gltf, quaternius/quaternius-modular-scifi/Modular SciFi MegaKit[Standard]/glTF/Columns/Column_Hollow.gltf, quaternius/quaternius-modular-scifi/Modular SciFi MegaKit[Standard]/glTF/Columns/Column_Large_Straight.gltf, quaternius/quaternius-modular-scifi/Modular SciFi MegaKit[Standard]/glTF/Columns/Column_MetalSupport.gltf
hdri                 ← polyhaven/hdri/quarry_01_1k.hdr
textures.ground      ← ambientcg/ground/ambientcg-grass004/Grass004_1K-JPG_Color.jpg
textures.wall        ← ambientcg/wall/ambientcg-concrete015/Concrete015_1K-JPG_Color.jpg
textures.floor       ← ambientcg/floor/ambientcg-pavingstones012/PavingStones012_1K-JPG_Color.jpg
textures.metal       ← ambientcg/metal/ambientcg-metalplates006/MetalPlates006_1K-JPG_Color.jpg
textures.wood        ← ambientcg/wood/ambientcg-planks012/Planks012_1K-JPG_Color.jpg
textures.rock        ← ambientcg/rock/ambientcg-rock023/Rock023_1K-JPG_Color.jpg
textures.roof        ← ambientcg/roof/ambientcg-roofingtiles006/RoofingTiles006_1K-JPG_Color.jpg
sounds.draw          ← kenney-starter-kit-fps/sounds/weapon_change.ogg

overrides: applied tools/assets/overrides.json

optimised models: 151.1 MB → 2.8 MB (meshopt + quantize, unused clips and held props removed)
removed 4 stale files from earlier imports
