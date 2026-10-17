# Emberfall: sci-fi flame-sword combat starter (Three.js)

- **Abilities, firing and sound clarity:** [`docs/ABILITIES.md`](docs/ABILITIES.md) has all 80 abilities for both factions, with counterplay.
- **Design and plan:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) covers the architecture diagram, folder layout, module contracts, movement and melee deep dives, weapon and class data model, AI, netcode, performance and roadmap.
- **Frontline battle:** serve this folder statically (`npx serve .`) and open `index.html`. It's a Battlefront-style 64-player battle (`?players=128` for 128) on a seeded 1 km map: 13 capture points across 5 sectors, a front line that moves when a sector falls, tickets, squads, and reinforcement waves. You fight alongside full-kit bots in squads ([docs/FRONTLINE.md](docs/FRONTLINE.md)).
- **Arena (feel lab):** `arena.html` is the 4v4 skirmish against full-kit bots (`?difficulty=recruit|veteran|elite`). Press **K** to cycle through all 20 class kits, and **X** to enter the bike, tank or dropship near spawn. It sets up a duel as the Solari Dawnblade (sword, two guns and a full ability kit) against a Void Ashsworn bot with vault and climb boxes and a wall-run wall.

| Path | What |
|---|---|
| `src/movement/MovementController.js`, `Hitboxes.js` | Helldivers 2 locomotion: instant response with weight from curves, carved sprint and plant-and-pivot, timed stances, committed slide and directional dive (belly, side and back/supine landings), hold-to-climb, heavy landings, ragdoll-lite knockdowns. Hit spheres fitted to the animation rig ([docs/MOVEMENT.md](docs/MOVEMENT.md)) |
| `src/anim/` | HD2-style procedural rig: world-space foot planting (no sliding), sim-timed stance/dive/slide/mantle/knockdown poses, rifle and flame-sword upper body, recoil/flinch layers, animation-synced footstep/impact/cloth events, LOD scheduling for 128 fighters; `ClipAnimationController` for GLB clips with the same contract ([docs/ANIMATION.md](docs/ANIMATION.md)) |
| `src/render/CrowdRenderer.js` | The whole crowd in five instanced draw calls: team colors, status glow, far impostors, per-fighter culling |
| `src/game/frontline/`, `src/game/FrontlineSession.js` | Frontline: seeded 1 km maps (sectors, lanes, fortified points, trench lines, terrain, spawns), the rules (capture by headcount, sector capture moves the front, tickets, breakthrough), and the 64–128 fighter match loop with bot think LOD and reinforcement waves ([docs/FRONTLINE.md](docs/FRONTLINE.md)) |
| `src/ai/FrontlineCommander.js` | One commander per team: squads of 4 sent to attack and defend points by need, respawns on the squad leader |
| `src/world/` | Scale foundations: `CoverIndex` (grid raycasts over thousands of boxes), `EntityGrid` (per-tick fighter hash), `Terrain` (seeded heightfield), `NavGrid` (shared flow fields per objective, time-sliced rebuilds when cover breaks) |
| `src/render/BattlefieldRenderer.js`, `TracerPool.js` | The battlefield in a few draw calls: terrain mesh with detail texture, instanced cover, capture rings, beacons and front-line curtains; pooled instanced tracers and projectiles |
| `src/ui/FrontlineHud.js` | Tickets and sector strip, squad orders, point markers, minimap with spotted enemies, HD2 gun reticle, killfeed, banners, reinforcement countdown |
| `rig-lab.html` | Every move side by side in slow motion with planted-foot and hit-sphere overlays and an event log (`?station=dive&view=side&speed=0.25&at=1.7`) |
| `src/combat/melee/MeleeSystem.js` | Attack FSM (windup/active/recovery), chains, charge specials, guard/perfect block/parry/whiff, counters, heat, poise, guard break, feints |
| `src/ai/CombatBotBrain.js`, `AbilityPlanner.js`, `VehiclePilot.js` | Full-kit bots: data-inferred ability use for all 80 abilities, interrupts and dodges, gunplay with recoil comp, sword duels, vehicle boarding, driving, gunning and bailing out ([docs/AI.md](docs/AI.md)) |
| `src/ai/MeleeDuelistBrain.js` | Utility AI that sends commands the way a player would, reacts to windups, and learns how often you parry |
| `src/camera/CameraRig.js` | HD2 third-person camera: zero-latency look, stiff spring follow, footfall-driven bob, carve sway, sprint/slide/dive FOV, collision, trauma shake |
| `src/input/InputManager.js` | Keyboard/mouse plus gamepad mapped into one per-tick command, with response curves and rumble |
| `src/net/Prediction.js` | Client prediction and reconciliation with visual error smoothing, and snapshot interpolation |
| `src/combat/weapons/WeaponDefs.js` | Archetype → weapon → attachment stat composition, and damage-matrix math |
| `src/combat/weapons/WeaponSystem.js` | Firing: auto/semi/burst/pump/bolt/charge/spool/beam, magazine/heat/battery ammo, active vent, learnable recoil patterns, deterministic spread, pooled swept projectiles, sticky/fuse grenades, sword deflects |
| `src/combat/AbilitySystem.js` | Class kits (ability1/ability2/grenade/super): cast tells, charges, cooldown trading, interrupts with refund, super energy, Flux upgrades, data-driven effect primitives |
| `src/combat/StatusSystem.js`, `Health.js` | Scorch→Ignite, Weaken, Suppress, Volatile, Slow→Stun and more; shield, leech armor and overshield layers |
| `src/combat/CombatWorld.js`, `ZoneSystem.js`, `DeployableSystem.js` | One world query surface (raycast over fighters, deployables, cover and domes); arming/ticking/pulling/tether zones; turrets, walls, mines, tripwires, charges with recast and defuse, beacons, launch pads, engines, decoys, vehicle drops; destructible cover |
| `src/combat/TransformSystem.js`, `data/supers.json` | 8 transform supers: temporary super weapons (piercing, beams, singularity slugs, siege cannon), greatsword/dagger movesets with real melee projectiles, mech frame; exact revert; early end on depletion |
| `src/vehicles/VehicleSystem.js`, `data/vehicles.json` | Hover bikes, light tanks and dropships: hover/tracked/flyer physics, seats with their own weapons, snappy enter/exit/eject, ramming and crashes, rear weak spots, EMP statuses, respawning pads, called vehicles ([docs/VEHICLES.md](docs/VEHICLES.md)) |
| `src/vfx/VehicleViews.js` | Vehicle graybox views: team trim, lagging turrets, glowing weak-spot vents, enemy HP bars, boost flames, damage smoke |
| `src/vfx/ZoneDeployableViews.js` | Readable graybox visuals: team-relative colors, arming fill countdowns, dome shells, rotating spokes, tether beams, turret laser sights, blinking mines |
| `tests/` | Headless `node --test` suite (`npm install && npm test`) |
| `src/audio/AudioDirector.js` | Clarity-first audio: friend/foe cue variants, faction sound families, threat priority and ducking, super warnings, animation-synced foley (footsteps, gear, cloth, body impacts) with distance culling, WebAudio synth fallback |
| `data/` | All tuning: movement, melee, ballistic and energy weapons, attachments, damage matrix, classes |
