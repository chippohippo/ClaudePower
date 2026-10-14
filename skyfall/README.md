# SKYFALL

A browser battle royale built to feel like Apex Legends: momentum movement, punchy recoil-pattern
gunplay, legends with tactical and ultimate abilities, and 100-player matches in Trios or Sixes. Bots
fill every empty slot.

```
npm install
npm run dev            # client on http://localhost:5173 (solo vs bots + firing range work offline)
npm run server         # authoritative multiplayer server on :3000 (parties, matchmaking)
npm start              # production: build the client, then serve it and the game server on :3000
npm run desktop        # desktop app (Electron) from source; npm run desktop:host = dedicated server
npm run dist:win       # Windows installer → release/SKYFALL-Setup-<version>.exe (docs/DESKTOP.md)
node tools/desktop/upnptest.cjs # UPnP port mapping against a mock router
npm run sim-test       # headless 100-bot match: performance and outcome report
node tools/movetest.js # checks that every movement tech works in the shared movement code
node tools/nettest.js  # two socket clients form a party, queue up and stream a match
node tools/deathtest.js # knockdown → elimination → spectate → squad-out → end-of-match flow
node tools/bottest.js   # bot quality: stuck events, A* usage, slides, wall bounces
node tools/loottest.js  # drop kit, floor loot, evo armor, mags, respawn loadout, Fallback Shields
node tools/guntest.js   # ADS precision, ADS strafe speeds, projectile speeds, TTK table
npm run assets:fetch    # download the reachable CC0 packs (GitHub sources + official sites) into assets-src/
npm run assets:import   # unzip + inspect + map packs → public/assets/manifest.json (docs/ASSETS.md)
npm run assets:test     # end-to-end imported-asset pipeline test with generated stand-ins (needs npm run dev)
node tools/audio/capture.mjs <dir> && python3 tools/audio/analyze.py <dir>
                       # render every sound in Chromium (needs `npm run dev`), print loudness /
                       # transient / band metrics and write a spectrogram contact sheet
```

Open the menu, pick a legend and press **PLAY**. When connected to a server, PLAY uses online
matchmaking; otherwise it starts an offline match against 99 bots. **ONLINE** joins any SKYFALL server
by `IP:PORT`. The desktop app adds **HOST SERVER**: it runs a server on your PC, tries UPnP on the
router, and shows the LAN and internet addresses friends join with. **FIRING RANGE** gives you every
weapon and some strafing target dummies (**B** shows hitboxes). **CREATE PARTY** / **JOIN** puts friends in the same squad,
and bots fill the rest of the lobby.

**0.6.0 additions (characters, animation, map):**
- All 9 legends are now built on Quaternius' Universal Base Characters (male and female bodies on the
  Universal Animation Library skeleton, so every clip plays natively). Each legend is dressed in code
  (`src/client/outfits.js`): a per-pixel suit shader (panels, seams, collars, stripes, gloves, boots)
  plus bone-attached gear (plate carriers, chest plates, shoulder armour, helmets with visors, a gas
  mask with filters, medic / recon / gas-tank packs, Spectre's jetpack) and UBC hairstyles.
- Animation: sprint, crouch idle and crouch walk, jump take-off and landing, ledge climb for mantles,
  kneeling revives, an ability throw, pistol stance, skydive dive, getting up after a revive and
  upper-body hit / knock-down reactions that play over the legs. Walk / jog / sprint are speed-matched
  and keep their foot phase when blending. Gun-hold IK now also works on Sketchfab rigs.
- First-person arms are cut from your own legend's body: the same sleeves, gloves and bracers, with
  IK onto the grip and handguard, curled fingers and a support hand that goes to the mag on reloads.
- Third-person guns are real size for their class and sit in the hand at the grip.
- Map: buildings use the Modular SciFi MegaKit trim sheets with real normal / roughness relief,
  interiors have desks, shelves, lockers and ceiling lights, roofs have AC units and dishes as cover,
  corner columns frame every building (all with matching colliders), crates / barrels come from the
  Sci-Fi Essentials Kit, and the wilderness gets the Stylized Nature MegaKit trees, bushes, rocks and
  instanced grass, flowers and pebbles around the camera (dead trees near deserts).
- Also since 0.5.1: Universal Animation Library clips for every character, floor loot shows the real gun
  models with labels and rarity beams, bots time their ring rotations and avoid walls earlier.
- Dev pages (`npx vite`): `tools/dev/lineup.html`, `avatarcheck.html`, `gearcheck.html`,
  `vmcheck.html`, `mapview.html`, `kitview.html`. Pack import: `node tools/assets/import-drive.mjs`.

**0.5.0 additions (real models):**
- All 10 guns are now real 3D models assembled from the Firearms Kit parts: an M4-style carbine, a SCAR-style battle rifle, an MP5-style SMG, a bullpup, a belt-fed LMG, a pump shotgun, a DMR, a scoped bolt-action sniper and two pistols. Each one sits with its pistol grip in the hand and the support hand on its handguard. The sniper uses its own scope.
- New character model: the Vanguard "Futuristic Soldier" (Mixamo rig) for Halo, Bastion and Spectre.
- Credits are in `public/assets/CREDITS.md` (both packs are CC-BY-4.0). The assembler is in `tools/assets/gunkit/`.

**0.4.0 additions (graphics pass):**
- New default "Realistic" art style (comic ink/halftone is now optional in Settings): natural sky with clouds and sun disk, retuned sun/hemisphere lighting, 4096 shadows, screen-space ambient occlusion and a subtle vignette.
- Detailed procedural gun models per class (receivers, vented handguards, curved mags/drums, rails, pumps, bolts, stocks, energy coils), muted gunmetal paint with weapon-colour inlays and rarity stripes, and a live ammo counter on the receiver.
- New first-person arms: gloved hands with fingers, sleeves, and a support hand that sits on each gun's foregrip.

**0.3.0 additions:**
- **Death recap and kill cam.** You see who downed you, with what and from how far, their health
  left, the damage traded and any assists. On elimination the camera zooms onto your killer.
- **Contextual pings with spoken callouts:**
  - **X** pings an enemy, an item ("Talon AR over here"), a supply drop or a death box, otherwise a
    location.
  - Double-tap **X** for "enemy was here".
  - Knocks and downs are called out too, in a per-legend voice. Turn this off in Settings with
    "Voice callouts".
- **Landmarks.** The Spire is a 34 m stepped tower with ziplines and gold loot. Crash Site is a
  downed dropship with a walk-through hull.
- **Redeploy balloons.** Hold **E** at the tether to launch into a skydive. There's one on the
  Spire, one at each landmark and six on hilltops.
- **Map events.** Supply drops with gold loot arrive at every ring and are announced and marked on
  the map. The Kill Leader's position is revealed every 30 s.
- **Second Chance.** Eliminated during the first two rings while a squadmate lives? You redeploy
  next to them after 45 s, once per match.
- **Progression** (stored locally):
  - XP and account level, plus legend mastery;
  - 3 daily and 4 weekly challenges;
  - **RANKED**: RP with Rookie → Predator tiers, an entry cost, and placement and kill points;
  - an XP and RP breakdown on the results screen.
- **Tutorial.** A guided checklist in the Firing Range, worth 2000 XP the first time you finish it.
- **Bots:**
  - Difficulty follows your level, or your tier in ranked.
  - They have human-looking gamer tags.
  - They hold buildings when the zone is safe.
  - They stop short of other squads' fights and hold an angle instead of charging in.
  - They use redeploy balloons on long rotations.

**Windows:** run `SKYFALL-Setup-<version>.exe`. It's a per-user installer with Start-menu and desktop
shortcuts, a "SKYFALL Dedicated Server" shortcut and an uninstaller. CI builds it on every push
(`.github/workflows/skyfall-desktop.yml`, artifact **SKYFALL-Setup-windows**). Hosting, port
forwarding, dedicated servers and building are covered in `docs/DESKTOP.md`.

---

## 1. Tech stack and why

| Layer | Choice | Why |
|---|---|---|
| Rendering | **Three.js** (WebGL2) | Small, fast and easy to control. The map is instanced box geometry with a world-space panel shader, so a full 1.4 km map draws in a handful of calls. Babylon.js would also work, but Three.js costs less per frame and lets us control the render loop and the separate viewmodel pass ourselves. |
| Netcode | **Socket.io** (WebSocket + permessage-deflate) on **Node.js** | Works in any browser with no install. The simulation code is plain ES modules shared by the client, the server and a Web Worker. WebRTC unreliable channels would lower worst-case latency but add NAT/TURN complexity. The transport layer is abstract, so that swap would not touch game code. |
| Offline host | **Web Worker** running the same `Match` | Solo play and the firing range need no server. The 99 bots run off the main thread. |
| Audio | **Web Audio API**, every sound synthesised procedurally at load | No asset pipeline is needed. Each gun has its own profile (transient crack, band-passed body, sub thump, mechanical clicks, tail and distant version). Playback uses HRTF panning, distance filtering, a speed-of-sound delay, a convolution reverb and a bus compressor. |
| Build | **Vite** | Instant dev server and ES-module workers. |

**Why not Unity or Unreal:** both would give better visuals, but the brief asks for browser play, fast
iteration and a modular codebase that can grow. Writing the gameplay core once in JavaScript and
sharing it between client and server makes client-side prediction exact. Both sides run the same
`stepMovement`.

## 2. Architecture

```
src/
  shared/                 runs on client, server and worker (pure, deterministic)
    constants.js          tick rates and every movement-tuning number
    movement.js           ★ the movement model: slide, slide-hop, bhop grace, air strafe, wall jump, climb, mantle, superglide, skydive, jetpack, jump pads
    physics.js            AABB world in a spatial hash: sweep/resolve, step-up, raycasts, dome blockers
    map.js                seeded procedural map: POIs, multi-floor buildings (rooms, doors, windows, stairs, balconies), cover, container yards, rock formations, bins, beacons, ziplines, loot points
    terrain.js            seeded heightfield (flattened POI pads), normals, ray marching
    weapons.js            data-driven guns: damage, RPM, mag, ballistics, spread model, recoil patterns, ADS, audio profile
    items.js              loot tables, consumables, grenades, attachments, rarity
    legends.js            8 legends: passive / tactical / ultimate tuning
    mods.js               status-effect speed modifiers, shared so prediction matches the server
  sim/                    authoritative game simulation (server or worker)
    match.js              match lifecycle, drop ship, ring, squads, damage/shields/evo, knockdowns, banners/respawn, loot, snapshots
    inventory.js          pickup/swap rules, auto-attach, stacking
    abilities.js          ability implementations built from shared primitives (status, zones, projectiles, explosions, reveals)
    bot.js                bot AI: drop, loot, rotate, third-party, fight (strafe, cover, heal, push, wall-bounce), slide-hop travel, revive, banners, abilities
    nav.js                1 m navigation grid + windowed A* with string pulling
  client/
    main.js               app shell, menu, parties, settings, main loop
    game.js               ★ prediction and reconciliation, interpolation, client-side hit detection, recoil/spread/ADS, camera feel, events → audio/VFX
    audio.js              procedural sound synthesis plus positional engine
    world.js              sky, IBL lighting, heightfield terrain, instanced map, trees, ziplines, bins, beacons, ring wall, drop ship, ring atmosphere
    tuning.js             FEEL: camera shake / FOV punch / hit feedback / audio mix tuning
    avatars.js            third-person character models and procedural animation, reveal highlight, phase ghosting
    viewmodel.js          first-person weapon: ADS, sway, bob, recoil springs, reload, sprint/slide poses, muzzle flash
    fx.js                 tracers, sparks, shield-coloured hit bursts, explosions, damage numbers, ability visuals
    lootview.js           pooled ground-loot rendering with rarity glows
    hud.js                crosshair, hit and kill markers, damage arcs, armor bar, squad cards, ability cooldowns, minimap and big map, kill feed, inventory and death-box panels
    input.js              pointer-lock raw mouse, bindings, settings
    net.js / worker.js    transports (Socket.io / Web Worker)
server/server.js          startServer(): parties, Trios/Sixes queues, bot fill, a 30 Hz tick per match, bot takeover on disconnect, protocol version check
server/index.js           command-line dedicated server
desktop/                  Electron app: main.cjs (window, hosting, dedicated mode), host.mjs (server process), upnp.cjs, preload.cjs, server.html
build/                    icon, afterPack.cjs (exe icon + version info), installer.nsi (NSIS installer)
```

### Netcode model
- **Inputs, not positions.** The client samples input at a fixed 60 Hz. It sends `{seq, move axes, yaw, pitch, buttons}` and predicts the step immediately with the shared movement code.
- **Reconciliation.** Each 20 Hz snapshot carries the full authoritative movement state and the last input it processed (`ack`). The client resets to that state, replays the commands the server has not acknowledged yet, and smooths out any small leftover error over about 80 ms.
- **Interpolation.** Other players are drawn 100 ms in the past, between buffered snapshots, so they move smoothly.
- **Favour the shooter.** Bullets are real projectiles with travel time and drop. The client simulates its own bullets against the interpolated players it sees and sends hit claims. The server validates each claim: the shot id/pellet exists and is unused, the target was within tolerance of the claimed point in its recent position history (lag compensation), there is line of sight, and fire rate and ammo are within limits. Then it applies damage. Bot bullets are simulated on the server.
- **Interest management.** Each snapshot includes players within about 420 m plus squadmates and revealed enemies, and nearby entities. A snapshot averages about 6.7 KB before WebSocket compression.

### Gameplay systems
- **Movement** (`shared/movement.js`)
  - Source-style acceleration and friction, with sprint at 7.4 m/s.
  - Sliding adds a speed boost with a 2 s cooldown and has low friction.
  - Slide-hopping: land while holding crouch to chain slides without losing momentum.
  - Bunny hops: a 50 ms window after landing skips friction, and jump input is buffered.
  - Air control uses a low wish-speed cap with high acceleration, so tap-strafe redirects work (about 90° in 0.5 s).
  - Wall bounce, wall climb (about 4 m), mantle, mantle-jump and superglide (jump + crouch in the last frames of a mantle).
  - Skydiving: look down to dive, look level to glide.
  - Jetpack hover and jump pads are part of the predicted movement.
- **Gunplay (Apex rules)**
  - Recoil patterns are deterministic and learnable, plus a small random jitter. The view stays
    where the kick leaves it (you pull down yourself); the pattern resets after a pause in firing.
    Barrel attachments scale the kick.
  - **ADS is pixel-accurate**: no spread, no bloom, no jump penalty — bullets land exactly where the
    recoil-displaced sight points. Hipfire is a cone that grows when moving, airborne and with
    sustained fire, and tightens when sliding or crouched.
  - ADS strafe speed by class (Apex config values): AR ×0.5, SMG ×0.75, LMG ×0.4, marksman ×0.425,
    sniper ×0.35, pistol ×1.0, shotgun ×0.9 (`ADS_MOVE` in `shared/weapons.js`).
  - Sprint-out: the gun needs 0.12–0.3 s (by class, `SPRINT_OUT`) to come up after sprinting;
    holding fire drops sprint.
  - Projectile speeds come from Apex's units-per-second values × 0.0254 (R-301-like Talon 737 m/s,
    SMGs 533–597 m/s, snipers 775–790 m/s), with drop.
  - Time to kill a purple-armored target with body shots is about 1.0–1.2 s for the automatics
    (`node tools/guntest.js` prints the table).
  - ADS time comes from the weapon and is modified by stocks. Optics change zoom; aim sensitivity
    scales with zoom and has an ADS multiplier setting.
  - Shotguns use a fixed pellet pattern and damage falls off with range. Headshot multipliers are
    reduced by helmets.
- **Hitboxes (Apex style, `src/shared/hitbox.js`)**
  - A realistic 1.8 m body: 25 cm head sphere; body capsules for neck, chest, shoulders, pelvis and
    arms; leg capsules.
  - Posed for standing, crouch, slide, downed, air and zipline, and turned with the player.
  - Width follows the legend's size class: tanks ×1.12, support ×1, DPS ×0.92.
  - The server, the client and the bots all use the same shapes.
  - In the Firing Range, **B** shows them.
- **Hit feedback (Apex style)**
  - Damage numbers: gold on headshots, the target's armor colour while shields hold, red on health.
    Hits within 0.7 s stack into one number that follows the target.
  - Hitmarker X plus a shield icon in the target armor's colour; red X on knocks and kills.
  - After you damage someone, their segmented shield bar and health bar float above them for 3 s.
  - Per-class hipfire reticles: four lines, a shotgun ring sized to the real pellet spread, a
    sniper dot and an open-top pistol reticle.
- **Friend / foe clarity**
  - Characters carry a fresnel rim light in the friend/foe colour (red-orange enemies, cyan allies),
    stronger at range where silhouettes shrink. It is depth-tested, so it never shows through walls.
  - Squadmates have an ally-coloured diamond and name above them, at a constant screen size,
    visible through walls.
  - Settings → **Colour vision** (default / protanopia / deuteranopia / tritanopia) recolours rims,
    markers, health damage numbers, headshots and reveal highlights live; **Enemy highlight**
    sets the rim strength (on / subtle / off). All colours live in `client/palette.js`.
- **Downed (Apex rules)**
  - Fallback Shield (knockdown shield) Lv1–4 with 100 / 250 / 750 / 750 HP. Hold aim while downed
    to raise it: it blocks bullets from the front 130° and you back-crawl at half speed.
  - Bleed-out is 90 / 60 / 30 / 15 s for repeated knocks in one life; revives return 20 HP.
  - Downed bots turn their shield toward whoever shot them and crawl back to the squad.
- **Kill Leader**: the living player with the most kills (3+) holds the title. Everyone hears when
  it changes hands or the Kill Leader is eliminated, and the kill feed marks them with a crown.
- **Adapt Armor (Evo-style)**
  - Everyone drops in white armor with full shields; there is no body armor on the floor.
  - Evo points level it white (50) → blue (75) → purple (100) → red (125) and refill shields each
    time: 1 point per damage dealt and per HP healed on a squadmate, ½ point per HP/shield restored
    on yourself, +25 per knock, +50 per revive, +75 per respawn. Thresholds 200 / 400 / 700
    (`EVO_THRESHOLDS`, `EVO_POINTS` in `shared/constants.js`).
  - Death boxes still hold the victim's armor (with its evo progress), so box swaps work.
  - Players are knocked down before they are eliminated, and can be revived.
  - Eliminated players drop a death box carrying their banner for 90 s. A squadmate can take the
    banner to a respawn beacon. **Respawned legends keep their guns (with attachments) and their
    armor level**, with one loaded mag and one spare mag per gun.
- **No fall damage**, from any height.
- **Drop and freefall** (Apex-style, no parachute)
  - Everyone drops empty-handed from the drop ship.
  - Third-person camera while skydiving, contrails behind every diver (squadmates in legend
    colours), altitude and speed readout.
  - Hold forward at the horizon for the longest glide (~30 m/s forward, ~18 m/s down); look down
    to dive (~58 m/s). Sideways input is half as strong and holding back air-brakes. Pulling out
    of a dive turns the extra fall speed into a forward surge.
  - Landing jets fire about 22 m up; you touch down keeping ¾ of your speed.
- **Ring**: 7 phases, ring damage ignores shields, and a care package drops on rounds 2–5.
- **Loot** (Apex layout, unique names)
  | Apex | SKYFALL | Effect |
  |---|---|---|
  | Syringe | Quick Patch | +25 HP, 5 s |
  | Med Kit | Trauma Kit | +100 HP, 8 s |
  | Shield Cell | Aegis Cell | +25 shield, 3 s |
  | Shield Battery | Aegis Battery | +100 shield, 5 s |
  | Phoenix Kit | Ember Kit | full HP + shield, 10 s |
  | Evo Shield | Adapt Armor | levels with evo points |
  | Arc Star | Spark Disc | sticky, slows |
  | Knockdown Shield | Fallback Shield | Lv1–4, raise while downed |
  | Extended mags | Extended Light / Heavy / Energy / Sniper Mag | ammo-specific, Lv1–3 |
  | Barrel Stabilizer / Standard Stock | Recoil Compensator / Tactical Stock | Lv1–3 |
  | HCOG / Ranger | 1x/2x Holo Sight, 3x Longsight | optics |
  - Ground loot is tiered by POI and sits on building floors, balconies, rooftops (one tier
    higher), landmark platforms and mesa tops. Floor guns usually spawn with a stack of their ammo.
  - Supply bins are spread around POIs, inside buildings, on rooftops and on landmark tops
    (giant tree, spire, crane boom, mesas). Care packages and death boxes complete the set.
  - Attachments auto-attach. The inventory has backpack slots and drop support.
- **Raptor Magnum** (Wingman-style): sniper ammo, 45 body / ~97 head / 45 legs, 156 RPM, 6-round
  cylinder (7/8/9 with sniper mags), 2.1 s reload, takes mags and optics but no barrel.

### Legends (all 9 playable) and hero roles
Every legend belongs to a role (`cls` in `shared/legends.js`).

| Legend | Role | Passive | Tactical | Ultimate |
|---|---|---|---|---|
| BASTION | Tank | −15% damage, slow immune | Dome of Protection (blocks bullets) | Bombardment (telegraphed mortar) |
| MIASMA | Tank | Sees enemies in gas | Gas Trap | Nox Grenade |
| KODIAK | Tank | Juggernaut: shields regen 4/s after 5 s, slow immune | Riot Wall (6 m bullet-blocking wall, 10 s) | Breaching Charge (24 m/s dash, 35 dmg + knockback + slow) |
| JOLT | DPS | Health regen out of combat | Stim (+40% speed, −10 HP) | Launch Pad |
| PHANTOM | DPS | Warned when aimed at | Phase Walk (2 s invulnerable) | Dimensional Rift (two-way portal) |
| SPECTRE | DPS | Jetpack hover | Missile Swarm (damage + slow) | Skyward Dive (squad relaunch) |
| HALO | Support | 2× revive, faster heals | Heal Drone | Care Package |
| ECHO | Support | Heartbeat sensor while ADS | Sonar Pulse (reveals through walls) | Exhibit (reveals movers/shooters) |
| VOLTA | Support | Speed burst when shot | Smoke Launcher (blocks bot vision) | Rolling Thunder (creeping artillery + slow) |

**Sixes = 2 Tank / 2 DPS / 2 Support, soft lock.**
- Anyone can pick anything. The lobby shows a role bar with filled/open pips per role, and when you
  are in a party it tags the most-needed role's legends **NEEDED** and full roles **ROLE FILLED**.
- Bots fill whatever roles the humans left open (`roleTargets(size)`, priority tank → support → dps),
  so a squad of three human DPS gets two tank bots and a support bot.
- Role perks apply in Sixes only (`ROLES` in `shared/legends.js`, read through `match.rolePerk`):
  Tank takes 10% less damage, DPS reloads and swaps 15% faster, Support heals 25% faster and revives 30% faster.
- On landing the HUD announces your role and the squad's composition; squad cards show role icons
  and switch to a compact two-column grid for five mates.
- Trios is free pick with no perks.

**Bots play their role** (`sim/bot.js`): tanks lead the formation toward the ring, peel for
squadmates under fire and drop dome / riot wall when mates are hurt; DPS prefer broken-shield targets
and take flank offsets; supports hang back, heal earlier and use drone / smoke / pulse for the squad.

### Map zones and landmarks
`shared/themes.js` defines six zone themes, each used twice across the 12 POIs, with their own names,
palettes, roof/trim colours, ground tint, building density, ruin chance and a landmark generator:

| Theme | Example names | Landmark |
|---|---|---|
| Industrial | Kiln Works, The Forge | Smokestacks with a catwalk ring, vertical zipline, live smoke |
| Overgrown | Hollow Market, Mossgate | Giant tree with spiral platforms, canopy, fallen pillars |
| High-tech | Cinder Labs, Signal Peak | Spire with spiral ramp, static jump pad, glowing pylons |
| Desert | Glass Basin, Sunscar | Stepped mesas, rock arch, jump pads |
| Flooded | Harbor 9, Tidewater | Docks on stilts, crane boom with zipline, animated water |
| Military | Fort Rook, Skyrail | Perimeter wall, watchtowers with ziplines, spinning radar dish |

- Buildings take the theme's palette, partly collapse according to its ruin chance, and get trim lines
  on rooflines. Climbable mesas dot the wilderness between POIs for high-ground fights on rotations.
- Static jump pads have chevron telegraphs; ziplines carry travelling light dashes and spark under riders.
- Entering a POI shows a themed zone call-out with a stinger; the minimap tints zones by accent colour.
- Gunfire draws bots from up to 220 m, so loud fights attract third parties.

### Bots
- Bots produce the same input commands humans do, so they move with the same slides, jumps and mantles.
- Each bot runs a layered state machine: drop with the squad (following a human jumpmaster) → loot (items, bins, boxes) → rotate with the ring or follow the squad leader → move toward gunfire to third-party.
- In a fight they strafe ADAD, crouch-spam, push enemies whose shields are broken or who are knocked down, fall back to cover to heal, and use their abilities.
- They also revive squadmates and run banners to respawn beacons.
- Bot aim has a reaction delay, imperfect leading and an error that tightens the longer they track a target.
- Skill rises as the lobby shrinks.
- A full 100-bot match costs about 0.6–1.1 ms per server tick.

### Controls
WASD · Space jump · Shift sprint · Ctrl/C crouch-slide · LMB fire · RMB ADS · R reload · E interact
(tap = pick up, hold = revive/respawn) · Q tactical · Z ultimate · G grenade · 1/2/wheel weapons ·
H heal · 4 shields · 5 health · Tab inventory · M map · X/MMB ping · V spectate next.

## 3. Feel & juice systems (tuning reference)

All feel numbers are data, not code. Change them and reload.

| File | What it tunes |
|---|---|
| `src/shared/constants.js` → `MOVE` | Movement: speeds, slide boost/friction/slope, bhop grace, wall bounce, climb/mantle, superglide window, zipline speeds, skydive |
| `src/shared/weapons.js` → `WEAPONS[*]` | Per-gun stats, recoil pattern and **audio profile** (`sound: {cls, crack, snapHz, bodyHz, subHz, sub, subDecay, tail, …}`) |
| `src/shared/weapons.js` → `GUNPLAY` | Slide hipfire multiplier (0.42), crouch, bloom, air ADS penalty, bullet gravity |
| `src/shared/terrain.js` → `TERRAIN` | Hill/ridge amplitude and scale, POI pad blend |
| `src/client/tuning.js` → `FEEL` | Camera trauma and FOV punch per weapon class, per hit taken/dealt, shield break, kill, explosion radius; hit-marker timings; the whole audio mix (gun, tail, hits, footsteps, tension, occlusion, low-HP/knocked muffle) |
| Settings menu | Mouse/ADS sensitivity, FOV, volume, **camera shake 0–200%**, toggle ADS, graphics quality |

**Sound (v2, `src/client/audio.js`)**
- Every gun is assembled from layers, then shaped so the attack stays dominant: a one-sample click plus a 2 ms crack, a mechanical snap, a band-passed body and a sub-bass punch. The sniper adds an N-wave supersonic crack. Shotguns add pellet scatter, LMGs a feed rattle, the energy SMG a square-wave zap, and the revolver a cylinder ring.
- Each gun has three buffers: near, **tail** and far. Automatic guns play the tail once, when the burst ends, so sprays stay articulate. Remote fire uses distance tiers with a speed-of-sound delay and air absorption, and stays audible to about 600 m. That far audio is paired with red compass chevrons as a third-party cue.
- Gunshots, footsteps and explosions are low-passed when geometry blocks them (occlusion).
- **Hit feedback sounds:**
  - Shield hits are pitched by armor tier.
  - An *armor crack* plays when a 25-point shield segment shatters.
  - Shield break is a layered glass burst plus a chime.
  - The knockdown "thunk" and the elimination chime are distinct.
  - Headshots have their own ring.
- **Movement and ability sounds:**
  - Footsteps and slide scrapes change with the surface: dirt, concrete or metal.
  - Mantle, wall-kick and hard landings have formant-synthesised effort grunts.
  - Abilities loop while active: dome hum, gas hiss, portal hum, drone, missiles, arc-star buzz, frag ticks, artillery whistle.
- **Ambience and mix:**
  - The ring wall hums from its nearest point.
  - A tension bed swells with ring stage, lobby size and recent combat.
  - The master mix is muffled when you are low on HP or knocked, and close explosions add tinnitus.
  - A glue compressor and a limiter sit on the master bus.

**Visual feedback**
- **Camera:** trauma-based shake and FOV punch on every shot, hit, explosion, slide and superglide.
- **Hits:**
  - Screen-edge flashes are tinted by shield colour.
  - Hit markers pop, with distinct versions for headshot, shield break and kill.
  - Damage numbers are coloured by shield tier and merged per target.
  - Kill confirms show streak callouts.
- **Shield break:** a ring of shards, a light pop and FOV punch.
- **Gunfire:** layered star muzzle flashes, ejected brass, bullet-hole decals, ricochet streaks and world muzzle flashes for other players.
- **Knockdowns and deaths:** a stagger into a crawl on knockdown; on death, the body is thrown along the killing blow, tumbles, settles and sinks.
- **Abilities:**
  - Portals get a vortex shader.
  - Gas gets toxic motes and smoke is layered and thicker.
  - Artillery is telegraphed by falling streaks onto flashing rings.
  - Jump pads burst, the jetpack and stim leave trails, and care packages leave a re-entry trail.
- **World:** beacons flare when you carry banners and bin lids swing open. Fog and light warm up as the ring closes and turn orange outside it.

**World**
- Seeded heightfield hills reach 0–46 m with slopes up to about 33°. Slides speed up downhill to 17 m/s and die out uphill in about 1 s.
- Grounded, Helldivers-2-style weight (`MOVE` in `src/shared/constants.js`):
  - Gravity is 24 m/s² and a jump is a 0.6 m hop.
  - Acceleration from a standstill builds over about half a second, and stops are firm.
  - Landings faster than 9 m/s stagger you for up to 0.45 s. You move at half speed, can't jump,
    and lose up to 35% of your speed.
  - Landing with crouch held goes straight into a slide instead. Every Apex trick is kept: slide-hops,
    air strafing, wall jumps, superglides, mantles and ziplines.
- Ziplines come in three kinds: vertical lines up buildings, roof-to-roof lines, and long hilltop lines. Riding is predicted, and a zip-jump keeps the cable momentum.
- Buildings have interior partition rooms, interior windows you can mantle through, balconies and low cover walls.
- The minimap is hill-shaded with contours and shows ziplines.

**Imported art (CC0 packs + Mixamo characters, optional)**
- Shipped in `public/assets/` (about 5 MB, meshopt + WebP):
  - realistic-proportion Mixamo characters (Soldier, X Bot, Michelle from the three.js examples) for
    all 9 legends, cycled per role and tinted per legend
  - a procedural pose layer on those characters: two-handed gun hold by arm IK, strafing hip twist,
    crouch / slide / downed matching the hitboxes, skydive and zipline arms
  - retargeting, so one rig's clips drive another
  - Kenney blasters for 4 gun slots
  - Quaternius trees, rocks and bushes
  - KayKit and Quaternius cargo crates, containers and barrels, draped over the map colliders
  - a Poly Haven HDRI, ambientCG detail textures and a Kenney sound
- They are adapted to the cel/ink look in Comic and kept PBR in Clean. Without the manifest,
  everything falls back to the procedural art, whose characters use the same realistic proportions.
- `npm run assets:fetch` / `assets:import` / `assets:test` handle the pipeline:
  - `assets-src/README.md` lists the packs to download by hand (the gun packs that fill the other 6
    weapons).
  - `docs/ASSETS.md` has the role rules, the tuning knobs and the manifest reference.
  - The asset viewer is at `/tools/assets/viewer.html`.

**Art style: comic / pop-art (default; switch to "Clean" in Settings)**
- "Clean" is the Apex-leaning look: PBR materials with the same post pass running as a pure colour
  grade (`CLEAN_GRADE`: saturation 1.16, contrast 1.07, warm highlights, cool shadows, no ink) and a
  lighter friend/foe rim.
- `src/client/comic.js` turns every PBR material into 3-band cel shading (`toonify`). It keeps colours, vertex colours, emissive accents and the world-space panel shader.
- A full-screen **ink pass** draws the outlines:
  - thick silhouettes wherever depth jumps
  - crease lines where 1/z bends (the Laplacian is zero on flat planes, so flat walls get no stray lines)
  - creases only within ~90 m, and silhouettes that thin out with distance
  - halftone dots in the shadows and a saturation/contrast grade
- The first-person gun and arms get **inverted-hull outlines**.
- The sky becomes a banded gradient with cel-shaded, ink-rimmed clouds.
- In comic mode the HUD text gets inked strokes and offset drop shadows.
- All values (bands, line thresholds, thickness, distance fade, halftone, grade) are in `COMIC` and can be tuned there.
- External asset packs (for example CC0 packs on itch.io or kenney.nl) can be dropped in later. They go through the same `toonify` + ink pipeline, so they pick up the unified look automatically.

**Characters & weapons**
- Each legend has a distinct silhouette kit: fins, hood, halo and med-pack, pauldrons, sensor dish, gas tanks, beret, jetpack. Visors are emissive and squadmates wear accent belts.
- Characters are animated procedurally, and the scene uses image-based lighting.
- Viewmodel guns are assembled from parts:
  - Sights are iron sights or optics (holo reticles or a tube scope).
  - Attachments are visible: mags, stocks and muzzle brakes.
  - ADS puts the sight line exactly at screen centre, using an eased curve with a fixed time per gun.
  - The gun sways with inertia and reacts to movement: it rolls when strafing, lifts in jumps and dips on landing.

**Comic impact words** (Comic style only, `FEEL.hit.comicWords`)
- Pop-art starbursts pop at the impact point: CRACK! on shield break, KNOCKED!, K.O.!/WIPED!/BLAM!/POW!
  on kills, KA-BOOM! for nearby explosions and HEADSHOT (throttled to one per 0.6 s).
- Shading uses deeper cel bands, a cool-shadow / warm-highlight split tone, and outlines that thin out
  with distance instead of turning to noise.
- Remote characters kick back when they fire and leave muzzle smoke.

**Bots**
- Pathfinding uses a 1 m nav grid with A*. Bots request a path only when direct steering is blocked, which cut stuck events about 15×.
- Bots chain slide-hops while travelling, wall-bounce in fights, and push toward gunfire up to 220 m away.

See `docs/JUICE.md` for the measured audit this pass was based on.

## 4. Vertical slice (what ships now) → expansion plan

**Vertical slice (done):**
- One procedurally generated map (seeded) with 12 POIs.
- All 9 legends with Tank / DPS / Support roles (2/2/2 in Sixes).
- Six zone themes with landmarks, ziplines, jump pads and climbable mesas.
- 10 weapons: 2 ARs (Talon, Mauler), 2 SMGs (Hornet, Surge), an LMG (Bulwark), a shotgun (Breacher), a marksman rifle (Marshal), a sniper (Harrier), the Raptor Magnum and a pistol (Stinger).
- Full movement tech, ring, loot, bots, squads, respawn banners, spectating, Trios/Sixes, parties, firing range, procedural audio.

**Next steps:**
1. **Feel**: tune recoil and TTK against playtest data, add per-surface footstep and impact sounds, add a recoil-learning overlay to the firing range.
2. **Content**: hand-authored landmark terrain (cliffs, canyons), more weapons (energy LMG, auto-shotgun, burst AR), hop-ups, and red armor from care packages.
3. **Netcode**: a binary snapshot protocol with delta compression, WebTransport/WebRTC unreliable datagrams, server-side rewind for explosive damage, and horizontal sharding (one match per worker thread).
4. **Bots**: multi-floor navigation (stairs/upper floors), team-level coordination (focus fire, flanks, rotate timing).
5. **Meta**: accounts, ranked queue, cosmetics and the replay/kill-cam system (snapshot logs make this cheap).
