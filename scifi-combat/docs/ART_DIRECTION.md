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

## Planet preset: Neon Night (the night city)

`palette.json` `planets.nightcity`: the city warfront (`index.html?map=city`, [FRONTLINE.md](FRONTLINE.md)). It
is a futuristic city at night, still lit in the windows that aren't blown out, under a purple
aurora. The rule is the same as by day: light is drama. Most of the light comes from the city
itself, in pools.

| Element | Spec |
|---|---|
| Sky | Near-black blue zenith (`#04050d`) to a violet horizon (`#3a2650`) under a violet haze (`#6a4890`); a twinkling star field; the ringed planet small and low (8°, 15° up) and half in haze |
| Aurora | Curtains all round the sky, brightest and highest to the north (azimuth 350°, raised 16° there). Their lower edge sits about 10° up so it shows down the avenues over the skyline. It folds and drifts, with rays streaming up it, magenta at the hot lower edge (`#ff4ad6`) through violet (`#9a46ff`) to deep blue (`#2f22c4`). It is patchy along its length and baked into the environment light, so the city is tinted by it |
| Moon | The "sun" of the preset: cool (`#a9b6ff`, intensity 1.25), high (52°) so the streets aren't all in building shadow. Its disk is dimmed (`gain` 0.32) |
| Fill | A blue night sky fill (`#3a4676`, intensity 2.0) over a dark ground, so shade reads |
| Fog | Thin violet (`#221b3a`, density 0.0029): the skyline melts into it |
| Ground | Asphalt (`#37383f`) with paving on the sidewalk slabs, park grass (`#243322`), paths (`#4c4940`), rubble (`#4a443d`). The city's `paint(x, z)` picks the colour per ground sample |
| Street lights | Cool LED (`#cfe2ff`) and some warm sodium (`#ffb35c`) heads on dark posts. Each casts a soft pool on the ground, drawn right after the ground and the sidewalks (and before everything else), so it lights those and never a boot under it. The eight lamps nearest the action get real spot lights shining down, so soldiers under a lamp are lit by it (and a facade beside one isn't lit above it), and the fires nearest it real point lights. Some lamps are out, some flicker |
| Windows | A grid worked out in the facade shader from each building's own size: bays from the corners, storeys from the foot. The glass is dark; 8–45% of windows are lit warm (`#ffcf8a`) or cool (`#9ac8ff`). Shelled buildings have blown-out holes. Some ground floors have lit shopfronts |
| Neon | Signs on the facades (horizontal and vertical boards: a noodle bar, a hotel, a cross, 24/7, arrows, chevrons, glyphs), in cyan, magenta, amber, violet and green. Some are dead, some flicker |
| Landmarks | Red beacons blinking on the tall roofs and the skyline beyond the map's edge; searchlights sweeping the sky behind both lines |
| War | Wrecks in old paint or burned out, a few still on fire (particles and a real light); rubble heaps; jersey barriers, containers and tank traps |
| Markers | The point beacons and the line's curtain at 40% (`markerGlow`): at night they'd be all that glows |
| Post | Exposure 1.3; bloom at a low threshold (0.72), so the lamps, windows and neon glow; faint cool god rays; lifted blue shadows; a strong vignette |

## Planet preset: Snowfall at Dusk (the city, default)

`palette.json` `planets.duskcity`: the city warfront's default sky (`index.html?map=city`; `&planet=nightcity`
for the aurora night). It is the stylized look of the reference clips: blue hour over a snowed-in
city, flat-lit low-poly forms with ink outlines, lavender light and shadow, warm lamps.

| Element | Spec |
|---|---|
| Sky | Deep indigo zenith (`#24223a`) to a dusty rose horizon (`#8e8296`), a warm glow (`#d9a58a`) toward the low sun; a few stars; no aurora |
| Sun | Low and warm (`#ffbf96`, 8° up, azimuth 236°): long shadows down the cross streets, a peach glow in the fog toward it |
| Fill | A grey-lavender sky fill (`#9c97b8`, 1.1) and bounce, so shade is lavender, never black |
| Fog | Grey-lavender (`#67637e`, density 0.0045): the skyline fades into it |
| Ground | Snow on the streets (`#bdb8c8`), the park (`#d0ccd8`) and its paths; the ground's detail tile turned down (`terrain`: relief 0.3, grain 0.35), so fresh snow lies smooth |
| Snow lying | On every top (`snow`, `src/render/SnowCover.js`): roofs, sidewalk slabs, barriers, wrecks, sandbags, tree crowns go white (`#d6d2e0`) where the world normal points up (full above 0.8, none under 0.55); walls keep their colour |
| Snow falling | Big soft flakes (`ash`: 4000 in a 30 m box round the camera, size 0.1, alpha 0.85), coming as close as 0.35 m to the lens, the same size on any screen |
| Troopers | The planet's own paint (`factions`): Solari in winter whites (`#d8dae0`) with red markings and capes and cyan lamps; the Void Legion in night black (`#34323b`) with red visors. Snow, not ochre dust, on their boots (`vfx.dust`) |
| Smoke | Chunky faceted puffs (`fx.smoke: 'puffs'`): instanced low-poly balls in the scene's own light, bleached toward cream (`#efe2d2`, 70%); they pop out, swell and shrink away, tumbling, and the ink outlines them. Fire and flashes stay glowing |
| Gunfire | Laser bolts (`fx.bolts`): ribbons 22 cm wide and 3.2 m long at 240 m/s, a paler core in a coloured glow, blue (`#4aa8ff`) for your side and red (`#ff3b2e`) for the enemy's, leaving the rifle's muzzle |
| City | Fewer windows lit (`city.windows` 0.45), warm lamps (`#ffa95a`), cyan, coral, amber and green neon |
| Ink | `post.outline`: dark indigo lines (`#2a2444`) 2 px wide where the depth breaks: silhouettes, contact edges, creases. Found as a kink in 1/depth, which is zero on any flat surface, so the ground draws none. On the near side of the edge, fading out by 90 m |
| Frame | `post.letterbox` 0.065: cinematic bars top and bottom. Exposure 1.15, contrast 1.16, saturation 0.82, lifted lavender shadows, a light vignette and grain |

**The future** (`city.future`, `src/render/CityFuture.js`): what makes it read as the Cyberpunk
city it is, not a snowed-in 2020s one.

| Element | Spec |
|---|---|
| Megatowers | 34 beyond the map, 130–450 m, one to three sections each stepping back as it rises; dark glass and steel, more windows lit than the old blocks |
| Neon trim | In the facade shader, in the planet's five neon colours (cyan `#2ef2ff`, magenta `#ff3fb4`, violet `#a65cff`, amber `#ffb030`, red `#ff4a3a`): corner strips up the edges, thin vertical lines, bands every few storeys, a lit crown and roof edge. 85% of the megatowers, 30% of the city's own buildings (never the shelled ones) |
| Ad screens | Giant animated screens on the megatowers' faces toward the city (65%) and on the tall buildings' street fronts (35%): sixteen made-up brands (KAIRO, VOLT, NIMBUS 9, RAMEN 24, PULSE, SOMA, ORBIT, HALO, TETRA, DRIFT, SYNTH, VANTA, NOVA, ECHO, LUXE, ZERO-G) drawn into one atlas, shown through LED rows and scanlines; some scroll, now and then one glitches or flickers. Emissive (they bloom), fogged (the far ones melt into the haze) |
| Street neon | Blade signs and boards low on the street faces of 60% of the buildings, on top of the city's own signs |
| Shopfronts | Lit glass with mullions, brightest up under the fascia, some in the neon's colours |
| Flying traffic | 50 cars on sky lanes over the avenues and cross streets (48–118 m) and a ring road beyond the edge (120–190 m), each with a white headlight bar, red tail lights and a neon underglow |
| Cables | Power and data lines slung across the streets between facades (never over open ground), sagging |
| Outskirts | Snow ground beyond the map's edge for the skyline to stand on |

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

**Rim light.** Every fighter has a fresnel glow round its silhouette in its army's colour,
gold (`#ffb43a`) for Solari and violet (`#b07cff`) for the Void Legion, so you read who is who at a
glance in any light (`factions.*.rim`; `ui.rim`: strength 1.1, power 5, tight to the edge).
Civilians have a neutral one (`#e6e2da`) that turns red (`#ff3a2a`) while they fight you.

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

Stratagem hardware (`src/render/StratagemKit.js`, drawn by `src/vfx/StratagemViews.js`), in the
same language:

| Piece | Model |
|---|---|
| Beacon | A palm-sized black canister: a spike to stick it in, a hazard band, grip rings, an antenna, the lamp lit in the payload's color |
| Drop pod | Octagonal: four faction-painted doors with hazard bands and the pod's number, black ribs at the corners, shade panels between, a buried spike, a cap with stubby thrusters and a lamp ring. The doors fold down like petals on four ammo crates whose ready lights are the grabs left |
| Sentry | Rises out of its pod when the cap pops: a boxy sensor head on a yoke, the optic glowing, twin barrels with brakes, an ammo drum, a hazard band, an antenna |
| Strike jet | A heavy cranked-delta attack plane: armored fuselage and nose, a bubble canopy, hazard-edged wings with bombs on pylons, canted twin tails with the number, two big engines with glowing nozzles |

Props: sandbags (`#a68e66`) in wandering courses of stuffed bags, with real bags along every
parapet top (`src/render/SandbagTops.js`: 64 m cells, a 36-triangle bag past 60 m, none past
150 m); timber revetments and duckboards (`#6c4f32`); concrete (`#8a8478`); corrugated metal with
rust (`#7b3f22`); barbed wire. Cover textures carry heights, and triplanar mapping lights them
from their normal maps.
## Effects

| Effect | Look |
|---|---|
| Muzzle blast | A white-gold flash (`#ffe0a0`) for two frames at the animated gun's barrel, a small puff that hangs 0.6 s; your own shots light the scene for those frames (`src/vfx/GunFx.js`) |
| Shell burst | A flash brighter than the sun, a fireball (`#fff2c8` → `#ff8a2a` → `#d9440f`), a column of dirt (`#6b5236`) thrown up and falling back, a dark plume (`#2a2420`) that drifts for ten seconds, a scorch mark left on the ground |
| Bullet impacts | A flash where each round lands, then by surface: dirt clods and a soft spray of dust (`#b9976a`), sand off sandbags, splinters off timber, grey chips off concrete, sparks (`#ffc56b`) off metal, vehicles and armor plate, a flash of blue off a shield, a dark mist (`#5e1410`) off flesh. 256 bullet holes, dark-centred with a scorched edge, on whatever was hit (never people) |
| Tracers | Faction-tinted: gold for Solari, violet for Void: camera-facing ribbons, a hot core in a coloured glow, fading toward the tail, leaving the muzzle (a planet can make them laser bolts: Snowfall at Dusk) |
| Call-in beams | A pillar of light from the beacon up into the sky in the payload's color (palette `stratagem`: strike `#ff5a3c`, supply `#4db3ff`, sentry `#5dff8f`, smoke `#ece7db`). It has a hot center and saturated edges, gets wider with distance so it reads across the map, and its pulses run up faster as the payload nears. Drawn opaque-ish, never additive: added to the scorched sky it would only turn white |
| Danger outline | A strike's blast area draped over the ground: a band, and a low fence of light fading upward so it reads from eye height |
| Strike rounds | A white-hot streak behind each round coming down |
| Drop pods | A trail of fire and dark smoke on the way down, then a flash, clods and a ring of dust racing out, which settles fast |
| Smoke screen | Grey-to-white puffs billowing for as long as the sim blocks sight through them, thinning out as it stops |

## UI

HD2's language: yellow (`#ffe14d`) and white on dark translucent panels with clipped corners,
condensed uppercase type, thin rules, red for danger. Diegetic where we can (the gun panel and
fire control read as equipment). Our own type and frames, not HD2's. The call-in panel lists
codes as ▲▼◀▶, with each stratagem's color as a tab; typed arrows light yellow.

## The art lab

`art-lab.html?station=...&view=...` builds every piece in isolation under the planet's real
sky and light, to model against and to screenshot:

| Station | Views |
|---|---|
| `palette` | the swatch sheet |
| `sky` | `sun` (halo, god rays through posts), `away`, `moon`, `wide` (craters and fog to 900 m), `trench`, `ground`, `up` |
| `troopers` | `lineup` and `void` (every role), `weights`, `helmets` and `helmets2`, `close`, `back` (capes into the sun), `squad` (combat poses), `mid` (`&lod=mid` forces the mid kit) |
| `vehicles` | `solari`, `void`, `tank`, `guns`, `trucks` |
| `cars` | the recon cars (the real sim run to each moment): `parked`, `kestrel`, `jackal`, `rear`, `drift`, `roll`, `over`, `thrown`, `burning` |
| `city` | the city (a 32v32 city map, `duskcity` sky; `&planet=nightcity` for the aurora night): `street` (down an avenue), `squad` (under a street lamp), `fire` (a burning wreck), `barricade`, `crossing`, `park` (the fountain), `aurora`, `above` |
| `scene` | a composed front-line moment: `hero` (the fire step, into the sun), `over`, `across` (from no-man's-land), `side` (down the trench) |
| `gunfx` | `impacts` (rounds landing on sandbags, timber, metal, concrete and dirt), `muzzle` (a trooper firing) |
| `melee` | `blades`, `duel`, `spear`, `bash`, `finisher` |
| `stratagems` | the real sim run to each moment: `callin` (typing on the wrist pad, the panel up, a beacon cocked), `strike` (the red beam and danger fence on the enemy line), `inbound` (the round streaking down), `boom`, `strafe` (the jet), `supply` (the pod open on its crates), `sentry`, `smoke`, `barrage`, `beams` (every kind at once) |

`node scripts/art-shots.mjs <outdir> station:view[:query] ...` captures them headless (serve the folder on :8765 first).

## Screenshots

`screenshots/` (index in its README): `art/` holds the lab captures from building this pass
(palette, sky, troopers, vehicles); `game/` the same look in a match, next to `before-art/` from
before it; `stratagems/` the call-ins; `feedback/` hit feedback and reloads; `cars/` the recon
cars; `city/` the night city.
