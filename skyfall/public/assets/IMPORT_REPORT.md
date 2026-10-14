# SKYFALL asset import

source: assets-src — 1823 files, 0 zips extracted, 285 models

rig kaykit-adventurers/Barbarian.glb: head 43% of height, build 0.451  — stylised, skipped (realistic rigs available; --stylized keeps them)
rig kaykit-adventurers/Knight.glb: head 46% of height, build 0.439  — stylised, skipped (realistic rigs available; --stylized keeps them)
rig kaykit-adventurers/Mage.glb: head 44% of height, build 0.575  — stylised, skipped (realistic rigs available; --stylized keeps them)
rig kaykit-adventurers/Rogue.glb: head 43% of height, build 0.464  — stylised, skipped (realistic rigs available; --stylized keeps them)
rig kaykit-adventurers/Rogue_Hooded.glb: head 45% of height, build 0.514  — stylised, skipped (realistic rigs available; --stylized keeps them)
rig kaykit-skeletons/Skeleton_Mage.glb: head 43% of height, build 0.421  — stylised, skipped (realistic rigs available; --stylized keeps them)
rig kaykit-skeletons/Skeleton_Minion.glb: head 43% of height, build 0.421  — stylised, skipped (realistic rigs available; --stylized keeps them)
rig kaykit-skeletons/Skeleton_Rogue.glb: head 43% of height, build 0.421  — stylised, skipped (realistic rigs available; --stylized keeps them)
rig kaykit-skeletons/Skeleton_Warrior.glb: head 43% of height, build 0.421  — stylised, skipped (realistic rigs available; --stylized keeps them)
rig threejs-mixamo/Michelle.glb: head 21% of height, build 0.233
rig threejs-mixamo/Soldier.glb: head 16% of height, build 0.242
rig threejs-mixamo/Xbot.glb: head 17% of height, build 0.177
characters.default   ← threejs-mixamo/Soldier.glb (4 clips)
characters.jolt     ← threejs-mixamo/Xbot.glb  [DPS]
characters.phantom  ← threejs-mixamo/Michelle.glb  [DPS]
characters.halo     ← threejs-mixamo/Michelle.glb  [SUPPORT]
characters.bastion  ← threejs-mixamo/Soldier.glb  [TANK]
characters.echo     ← threejs-mixamo/Soldier.glb  [SUPPORT, model reads as tank]
characters.miasma   ← threejs-mixamo/Michelle.glb  [TANK]
characters.volt     ← threejs-mixamo/Xbot.glb  [SUPPORT]
characters.spectre  ← threejs-mixamo/Soldier.glb  [DPS, model reads as tank]
characters.kodiak   ← threejs-mixamo/Xbot.glb  [TANK]
  shared animation library animations/rig0_threejs_mixamo_anims.glb: 3 clips for 4 characters
  shared animation library animations/rig1_threejs_mixamo_anims.glb: 4 clips for 3 characters
  phantom: borrows 4 clips from threejs-mixamo/Xbot.glb (retargeted in game)
  halo: borrows 4 clips from threejs-mixamo/Xbot.glb (retargeted in game)
  miasma: borrows 4 clips from threejs-mixamo/Xbot.glb (retargeted in game)
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

optimised models: 122.1 MB → 2.2 MB (meshopt + quantize, unused clips and held props removed)
