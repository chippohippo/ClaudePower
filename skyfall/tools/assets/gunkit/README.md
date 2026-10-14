# Gun assembler (Firearms Kit 1.0)

Builds the 10 game guns (`public/assets/weapons/fk-<id>.glb`) from the part library
"Firearms_Kit _1.0 (CC0)" by britdawgmasterfunk (Sketchfab, CC-BY-4.0).

- `recipes.js`: one recipe per weapon. Parts are snapped by bounding box (kit axes: +X muzzle, +Y up) and get a shared material set.
- `asm.html` + `asm.mjs`: render previews (`view=side|persp`), then export GLBs with `export=1`. The script prints grip, fore and scopeY fractions for `tools/assets/overrides.json`.
- `opt.mjs`: meshopt / quantize into `public/assets/weapons`.

Paths in `asm.mjs` and `opt.mjs` are the ones used when the guns were built. Point them at a folder holding
`scene.gltf` + `scene.bin` from the kit, plus copies of three's build and `examples/jsm` loaders and exporters.
