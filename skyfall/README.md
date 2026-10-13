# SKYFALL

A browser battle royale built to feel like Apex Legends: momentum movement, punchy recoil-pattern
gunplay, legends with tactical and ultimate abilities, and 100-player matches in Trios or Sixes. Bots
fill every empty slot.

```
npm install
npm run dev            # client on http://localhost:5173 (solo vs bots + firing range work offline)
npm run server         # authoritative multiplayer server on :3000 (parties, matchmaking)
npm start              # production: build the client, then serve it and the game server on :3000
npm run sim-test       # headless 100-bot match: performance and outcome report
node tools/movetest.js # checks that every movement tech works in the shared movement code
node tools/nettest.js  # two socket clients form a party, queue up and stream a match
node tools/deathtest.js # knockdown → elimination → spectate → squad-out → end-of-match flow
node tools/bottest.js   # bot quality: stuck events, A* usage, slides, wall bounces
node tools/audio/capture.mjs <dir> && python3 tools/audio/analyze.py <dir>
                       # render every sound in Chromium (needs `npm run dev`), print loudness /
                       # transient / band metrics and write a spectrogram contact sheet
```

Open the menu, pick a legend and press **PLAY**. If the server is reachable, PLAY uses online
matchmaking; otherwise it starts an offline match against 99 bots. **FIRING RANGE** gives you every
weapon and some strafing target dummies. **CREATE PARTY** / **JOIN** puts friends in the same squad,
and bots fill the rest of the lobby.

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
    hud.js                crosshair, hit and kill markers, damage arcs, evo shield bar, squad cards, ability cooldowns, minimap and big map, kill feed, inventory and death-box panels
    input.js              pointer-lock raw mouse, bindings, settings
    net.js / worker.js    transports (Socket.io / Web Worker)
server/index.js           parties, Trios/Sixes queues, bot fill, a 30 Hz tick per match, bot takeover on disconnect
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
- **Gunplay**
  - Recoil patterns are deterministic and learnable, plus a small random jitter. Barrel attachments scale the kick.
  - Hipfire spread grows when moving or airborne and tightens when sliding or crouched. Firing adds bloom.
  - ADS time comes from the weapon and is modified by stocks. Optics change the zoom.
  - Shotguns use a fixed pellet pattern and damage falls off with range. Headshot multipliers are reduced by helmets.
- **Survivability**
  - Evo shields level up white → blue → purple → red from damage you deal, and refill when they level up.
  - Players are knocked down before they are eliminated, and can be revived.
  - Eliminated players drop a death box carrying their banner for 90 s. A squadmate can take the banner to a respawn beacon.
- **Ring**: 7 phases, ring damage ignores shields, and a care package drops on rounds 2–5.
- **Loot**
  - Ground loot is tiered by POI; two hot zones carry top-tier loot.
  - Supply bins, care packages and death boxes.
  - Attachments auto-attach. The inventory has backpack slots and drop support.

### Legends (all 8 playable)
| Legend | Role | Passive | Tactical | Ultimate |
|---|---|---|---|---|
| JOLT | Assault | Health regen out of combat | Stim (+40% speed, −10 HP) | Launch Pad |
| PHANTOM | Skirmisher | Warned when aimed at | Phase Walk (2 s invulnerable) | Dimensional Rift (two-way portal) |
| HALO | Support | 2× revive, faster heals | Heal Drone | Care Package |
| BASTION | Defender | −15% damage, slow immune | Dome of Protection (blocks bullets) | Bombardment |
| ECHO | Recon | Heartbeat sensor while ADS | Sonar Pulse (reveals through walls) | Exhibit (reveals movers/shooters) |
| MIASMA | Controller | Sees enemies in gas | Gas Trap | Nox Grenade |
| VOLTA | Controller | Speed burst when shot | Smoke Launcher (blocks bot vision) | Rolling Thunder (creeping artillery + slow) |
| SPECTRE | Skirmisher | Jetpack hover | Missile Swarm (damage + slow) | Skyward Dive (squad relaunch) |

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
- Ziplines come in three kinds: vertical lines up buildings, roof-to-roof lines, and long hilltop lines. Riding is predicted, and a zip-jump keeps the cable momentum.
- Buildings have interior partition rooms, interior windows you can mantle through, balconies and low cover walls.
- The minimap is hill-shaded with contours and shows ziplines.

**Art style: comic / pop-art (default; switch to "Clean" in Settings)**
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

**Bots**
- Pathfinding uses a 1 m nav grid with A*. Bots request a path only when direct steering is blocked, which cut stuck events about 15×.
- Bots chain slide-hops while travelling, wall-bounce in fights, and push toward gunfire up to 220 m away.

See `docs/JUICE.md` for the measured audit this pass was based on.

## 4. Vertical slice (what ships now) → expansion plan

**Vertical slice (done):**
- One procedurally generated map (seeded) with 12 POIs.
- All 8 legends.
- 10 weapons: 2 ARs, 2 SMGs, an LMG, a shotgun, a marksman rifle, a sniper and 2 pistols.
- Full movement tech, ring, loot, bots, squads, respawn banners, spectating, Trios/Sixes, parties, firing range, procedural audio.

**Next steps:**
1. **Feel**: tune recoil and TTK against playtest data, add per-surface footstep and impact sounds, add a recoil-learning overlay to the firing range.
2. **Content**: hand-authored landmark terrain (cliffs, canyons), more weapons (energy LMG, auto-shotgun, burst AR), hop-ups, and red armor from care packages.
3. **Netcode**: a binary snapshot protocol with delta compression, WebTransport/WebRTC unreliable datagrams, server-side rewind for explosive damage, and horizontal sharding (one match per worker thread).
4. **Bots**: multi-floor navigation (stairs/upper floors), team-level coordination (focus fire, flanks, rotate timing).
5. **Meta**: accounts, ranked queue, cosmetics and the replay/kill-cam system (snapshot logs make this cheap).
