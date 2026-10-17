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

The Automaton-front mood: a world already on fire. Every value lives in
`palette.json` `planets.scorched`; `?planet=` picks another preset.

| Element | Spec |
|---|---|
| Sky | Burnt-orange horizon (`#cf7438`) rising through rust (`#6d3f2b`) to a smoky umber zenith (`#2e221e`); a haze glow (`#e8a066`) that is zero at the horizon (so the fogged ground never shows a seam); wind-torn smoke streaks (`#8a5236`); five smoke columns from burning things beyond the horizon; a huge pale ringed moon half lost in the haze |
| Sun | Low (13° up, azimuth 152°), hard and warm (`#ffd8ad`, intensity 3.2), a white-hot HDR disk (`#fff2d8`) and a wide orange halo (`#ff9a52`). It sits off to the side of the battle line, so neither army fights straight into it |
| Fill | The sky itself as image-based light (a PMREM bake of the dome, gain 0.75): metal reflects the burning sky and shade is lit by it. A hemisphere fill (sky `#b8916c`, earth `#4d3c2d`) and a soft bounce from the camera side (`#caa27c`), so shaded faces never go black |
| Fog | Exponential height fog, rust-tan (`#b8875a`), brighter and yellower toward the sun (`#ffc283`), density 0.0021 at the ground thinning by e per 36 m of height: the far ground melts into the horizon band, which is the same function |
| Ground | Ochre dust (`#b39265`) on earth (`#8a6a48`), rock on slopes (`#5d4e45`), dark wet mud on trench floors and in craters (`#46382c`); grey ash (`#7a726a`) and black scorch (`#463a31`) round every crater and blast. Detail: an 8 m tile of drifted dust, wind ripples where it lies deep, pale stones in their own contact shadow, and dried-mud plates in patches (fine, macro and crack normal maps) |
| Air | Ash falling all the time (small grey flakes, never in your face), a few glowing embers, dust kicked up by every blast |
| Post | God rays toward the sun (depth-masked: soldiers and ridges cut dark shafts), bloom on fire, visors and muzzle flashes, ACES filmic, cool lifted shadows against warm highlights, saturation 0.88, contrast 1.12, a strong vignette, film grain, a touch of chromatic aberration at the edges |

Further presets (same data shape): a fog-and-mud creek, a frozen front.

## The two trooper armies

Both armies are human shock troopers (HD2's soldier archetype) told apart by paint. Same kit
language, two liveries:

| | Solari Shock Troopers | Void Legion |
|---|---|---|
| Armor plates | Hazard yellow `#d6a01e` (shade `#9c720f`) | Royal purple `#5a3591` (shade `#3b2263`) |
| Secondary | Black `#232327`: forearm bracers, abdomen guard, jaw guard, helmet band | Black `#211f26` |
| Under-suit, gear, webbing | Charcoal-olive `#3a3934`, gear `#4d4839`, webbing `#38352c` | Charcoal-violet `#35333b`, gear `#433f4b`, webbing `#34313a` |
| Stencils, stripes | Bone white `#efe7d2` numbers, black (`#141416`) hazard stripes on the pauldrons | Lilac `#d2bff3` numbers, black stripes |
| Cape | Oxblood `#7a1c14` with a yellow trim band and a sun-over-chevron emblem | Black-violet `#1f1629` with a lilac trim band (`#9a76de`) and a split-ring emblem |
| Visor | Smoked glass (`#1d1712`) with an amber glow line (`#ffba3f`) | Glass `#140f1d`, violet glow `#b98cff` |

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

## How the troopers are built

`src/render/ModelKit.js` models in code: superellipsoids (`rbox`: rounded box to pebble),
curved bevelled armor plates on a grid (`shell`, bent round a torso or over a shoulder),
bevelled extruded profiles (`prism`, for hulls and cabs), lathes, tubes, tori and decal quads.
Every vertex carries a paint channel, edge wear, dirt and the rig bone it follows.

`src/render/TrooperKit.js` is the kit, `data/art/troopers.json` maps each class role to it:

| Mesh | Variants | Near / mid triangles |
|---|---|---|
| Body (14 bones: chest plate with pouches, straps, lamp and number; abdomen guard; belt, pouches and groin plate; pauldrons with stripes; bracers, gloves, the left wrist's call-in pad; thigh plates; knee pads and shin guards; boots) | light, medium, heavy | ~14-18k / ~2.1-2.8k |
| Helmet | medium (dome, slit visor, jaw guard with vents, comms, ridge, band), heavy (angular, face plate, T-visor, cheek plates, chin), crest (heavy with the flame knight's fin), light (cap, wide visor, breather), hood (light under a cowl), pilot (wraparound visor) | ~0.8-2.4k / ~0.25-0.7k |
| Role gear | standard pack, radio (whip), antenna (two whips), tools (pick and shovel), medic (white pouches and armband), bandolier (charges across the chest) | ~0.8-1.4k / ~0.1-0.3k |
| Weapons | smg, assault rifle, shotgun, sniper, pulse rifle, beam, super launcher | ~1.9-2.4k / ~0.4-0.5k |
| Cape | three folded panels to the knees, torn hem, trim band, emblem | ~1.6k / 0.2k |

`src/render/TrooperMaterial.js` paints it: the faction palette by channel (one mesh serves both
armies), edge chips to bare metal and fine scratches on painted channels, dust climbing the
boots, shins and cape hem, glowing visors and lamps, a stencilled two-digit number per trooper
and each army's cape emblem (drawn from decal UVs and cut out), hazard stripes. Wear is seeded
per trooper.

`src/render/CrowdRenderer.js` poses it: every drawn rig gets a row of a float texture holding
its 18 bone matrices, and the vertex shader follows them (rigid skinning). One body mesh of a
weight draws every trooper wearing it in a single instanced call; about 25 draws cover the
whole crowd at both detail levels. Near kit within 20 m of the camera, the mid kit out to the
animation's mid range, a ~480-triangle trooper impostor beyond.

## Vehicles, guns and props

Chunky, boxy, utilitarian, made by people in a hurry. Faction paint on the big plates, black or
gunmetal on everything mechanical, hazard stripes on anything that moves or hits, stencilled
numbers, dust on the lower hulls, bright work lights. Solari builds rounder, Void sharper, with
fins. `src/render/VehicleKit.js` (painted by `paintMaterial`, the trooper shader without bones):

| Vehicle | Model |
|---|---|
| Light tanks | Hull from a bevelled side profile (sloped glacis, engine deck), tracks with road wheels, sprocket and idler under armored skirts, a pointed or bustled turret, mantlet, long barrel with fume extractor and muzzle brake, smoke launchers, stowage, work lights |
| Hoverbikes | Armored spine, fairing and windscreen, seat, handlebars, two hover pods glowing underneath, a rear thruster |
| Dropships | Fuselage, cockpit glass, wings with engine pods glowing aft, tail fin, skids |
| Field and AT guns | Tyred wheels, a painted shield with a hazard band and the gun's number, a tapering barrel, recoil cylinders, breech, sight, spaded trail legs that spread when set up |
| Rocket batteries, supply haulers | Half-tracks with an angular cab (raked windscreen, grille, bumper, light bar), a rack of tubes or a bed of crates and hazard-striped drums you can count |

Props: sandbags (`#a68e66`) in wandering courses of stuffed bags, with real bags along every
parapet top (`src/render/SandbagTops.js`: 64 m cells, a 36-triangle bag past 60 m, none past
150 m); timber revetments and duckboards (`#6c4f32`); concrete (`#8a8478`); corrugated metal with
rust (`#7b3f22`); barbed wire. Cover textures carry heights, and triplanar mapping lights them
from their normal maps.
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

## The art lab

`art-lab.html?station=...&view=...` builds every piece in isolation under the planet's real
sky and light, to model against and to screenshot:

| Station | Views |
|---|---|
| `palette` | the swatch sheet |
| `sky` | `sun` (halo, god rays through posts), `away`, `moon`, `wide` (craters and fog to 900 m), `trench`, `ground`, `up` |
| `troopers` | `lineup` and `void` (every role), `weights`, `helmets` and `helmets2`, `close`, `back` (capes into the sun), `squad` (combat poses), `mid` (`&lod=mid` forces the mid kit) |
| `vehicles` | `solari`, `void`, `tank`, `guns`, `trucks` |
| `scene` | a composed front-line moment: `hero` (the fire step, into the sun), `over`, `across` (from no-man's-land), `side` (down the trench) |

`node scripts/art-shots.mjs <outdir> station:view[:query] ...` captures them headless (serve the folder on :8765 first).

## Screenshots

`screenshots/art/` holds the lab captures from building this pass (palette, sky, troopers,
vehicles); `screenshots/game/` the same look in a match.
