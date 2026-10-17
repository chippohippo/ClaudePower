# Art direction: the Helldivers 2 look, our own designs

Data: `data/art/palette.json` (every color and look setting below) · lab: `art-lab.html` (each
asset in isolation, for building and screenshotting) · code: `src/render/Atmosphere.js` (sky, sun,
fog, ash), `src/render/PostFX.js` (god rays, bloom, grade), `src/render/ArtTextures.js`,
`src/render/TrooperKit.js` (armor kits), `src/render/CrowdRenderer.js`, `src/vfx/`.

We follow Helldivers 2 as closely as the law allows. That means its *look*: a used-future military
war, propaganda-poster boldness, chunky silhouettes, heavy atmosphere, weather and light as drama,
and violent, physical effects. Its *property* is out of bounds: the Super Earth eagle and every
other logo, insignia, faction names, the exact armor sets, helmets, capes, ships, the UI font. All
of those are redrawn as our own (Solari and Void, our helmets, our ships, our stencils).

## Pillars

1. **War is the environment.** The sky, the dust, the smoke columns on the horizon and the shell
   holes all say *front line*. No clean surface anywhere: everything is chipped, dusted, scorched.
2. **Light is drama.** A low, hard sun through haze; god rays when you look toward it; silhouettes
   against a burning horizon; explosions that out-shine the sun for a frame and leave smoke for
   ten seconds.
3. **Read the soldier, then the detail.** Silhouette first (helmet, shoulders, cape), faction
   paint second, class detail third. At 200 m a trooper is a shape and a color; at 5 m it's
   pouches, scratches and a stencilled number.
4. **Propaganda boldness.** Saturated faction colors (hazard yellow, royal purple) against a
   desaturated, dusty world. Hazard stripes, stencils and chevrons are the graphic language.
5. **Physical, overdone effects.** Muzzle blasts, dirt columns, sparks, smoke that hangs: loud and
   readable, never mush.

## Planet preset: Scorched Ash Front (default)

The Automaton-front mood: a world already on fire.

| Element | Spec |
|---|---|
| Sky | Burnt-orange horizon (`#cf7438`) rising through rust (`#6d3f2b`) to a smoky umber zenith (`#2e221e`). Bands of haze and wind-torn smoke streaks. A huge pale moon with a ring, half lost in the haze. Smoke columns from burning things on the horizon in every direction |
| Sun | Low (13° up), hard and warm (`#ffc993`), a white-hot disk with a wide orange halo. It sits off to the side of the battle line, so neither army fights straight into it |
| Fill | Warm sky light from above (`#c8865a`), dark earth bounce from below (`#4a3426`), and a soft orange bounce from the camera side so shaded faces stay readable (HD2 never lets a back go black) |
| Fog | Exponential, rust-orange (`#b5703f`), brighter and yellower toward the sun (`#ffb36e`), thickest in the low ground and thinning with height |
| Ground | Ochre dust (`#a98458`) on cracked earth (`#7c5a3c`), rock on slopes, black scorch (`#2b231e`) and grey ash around every crater, wet dark mud (`#3b2d23`) on trench floors, a few tufts of dead grass |
| Air | Ash falling all the time, a few glowing embers, dust kicked up by every blast |
| Post | God rays toward the sun, bloom on fire and muzzle flashes, ACES filmic, cool lifted shadows against warm highlights, slight desaturation, strong vignette, film grain, a touch of chromatic aberration at the edges |

Further presets (same data shape): a fog-and-mud creek, a frozen front.

## The two trooper armies

Both armies are human shock troopers (HD2's soldier archetype) told apart by paint. Same kit
language, two liveries:

| | Solari Shock Troopers | Void Legion |
|---|---|---|
| Armor plates | Hazard yellow `#d6a01e` (shade `#9c720f`) | Royal purple `#5a3591` (shade `#3b2263`) |
| Secondary | Black `#1b1b1e`: lower legs, forearms, helmet band | Black `#19171d` |
| Under-suit, webbing | Charcoal `#232326`, olive-black webbing | Charcoal `#211f26`, violet-black webbing |
| Stencils, stripes | Bone white `#efe7d2` numbers, black hazard stripes on the pauldrons | Lilac `#d2bff3` numbers, black stripes |
| Cape | Oxblood `#7a1c14` with a yellow trim band and a sun-chevron emblem | Black-violet `#1f1629` with a lilac trim band and a split-ring emblem |
| Visor | Amber glow `#ffba3f` behind smoked glass | Violet glow `#b98cff` |

**Silhouette rules** (the HD2 read): a compact helmet with a narrow dark visor, broad armored
shoulders, a chest plate over webbing, a belt of pouches, a pack on the back, and a cape to the
calves that moves. Heads stay small, shoulders and boots stay big.

**Armor weight by role** (HD2 light, medium, heavy):

| Weight | Roles | What changes |
|---|---|---|
| Light | infiltrator, marksman, pilot, tech | Low-profile helmet with a wide visor, a vest instead of a chest plate, small pauldrons, no thigh plates, a short cape (a hood for infiltrators) |
| Medium | assault, engineer, medic | The standard kit: domed helmet with a slit visor and side comms, chest plate, pauldrons, knee pads |
| Heavy | juggernaut, flame knight, demolitionist | An angular helmet with a face plate and a T-visor, layered chest plate with a gorget, big stepped pauldrons, thigh plates, shin guards, a long cape |

**Role detail** (third read): a medic's white armband and big med pouches (no red cross: that
emblem is protected), an engineer's tool pack, a marksman's scope antenna, a pilot's full visor
and no pack, a tech's antenna pack, a demolitionist's grenade bandolier, a flame knight's crest.

**Wear:** paint chipped to bare metal on every edge, scratches on the plates, ochre dust climbing
the boots and shins, scorch on the cape hem, a stencilled squad number on the chest and helmet.

## Vehicles, guns and props

Chunky, boxy, utilitarian, made by people in a hurry. Faction paint on the big plates, black or
gunmetal on everything mechanical, hazard stripes on anything that moves or hits, stencilled
numbers, dust on the lower hulls, bright work lights. Field guns: olive-black steel, faction paint
on the shield. Supply trucks carry crates and drums you can count.

Props: sandbags (`#a68e66`), timber revetments and duckboards (`#6c4f32`), concrete (`#8a8478`),
corrugated metal with rust (`#7b3f22`), barbed wire.

## Effects

| Effect | Look |
|---|---|
| Muzzle blast | A white-gold flash (`#ffe0a0`) for one or two frames, a smoke puff that lingers |
| Shell burst | A flash brighter than the sun, a fireball (`#fff2c8` → `#ff8a2a` → `#d9440f`), a column of dirt (`#6b5236`) thrown up and falling back, a dark plume (`#2a2420`) that drifts for ten seconds, a scorch mark left on the ground |
| Bullet impacts | Dust puffs (`#b9976a`) on dirt, sparks (`#ffc56b`) on metal, splinters on wood |
| Tracers | Faction-tinted: gold for Solari, violet for Void |

## UI

HD2's language: yellow (`#ffe14d`) and white on dark translucent panels with clipped corners,
condensed uppercase type, thin rules, red for danger. Diegetic where we can (the gun panel and
fire control read as equipment). Our own type and frames, not HD2's.

## Screenshots

`screenshots/art/` holds the lab and in-game captures from building this pass (palette, sky,
materials, troopers, vehicles, before and after).
