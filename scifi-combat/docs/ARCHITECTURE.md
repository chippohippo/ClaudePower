# EMBERFALL — Architecture & Implementation Plan

Browser sci-fi combat game: Battlefront-scale battles, TLOU2-weight melee, Helldivers-fluid locomotion,
flame swords as the signature fantasy. Three.js r160+ / WebGL2 / Rapier / Colyseus / Howler.

Factions: **Solari Directorate** (radiant, ordered, gold/white, hard-light tech) vs
**Void Collective** (asymmetric, violet/black, gravitic + psionic tech).

---

## 1. High-level architecture

```
                        ┌─────────────────────────────────────────────┐
                        │                 CLIENT (browser)            │
 ┌──────────┐  actions  │  ┌────────────┐   ┌──────────────────────┐  │
 │ Keyboard │──────────▶│  │InputManager│──▶│ Command buffer (tick)│  │
 │ Mouse    │           │  └────────────┘   └─────────┬────────────┘  │
 │ Gamepad  │           │                             │               │
 └──────────┘           │        FIXED SIM STEP (60 Hz, deterministic-ish)
                        │  ┌──────────────────────────▼────────────┐  │
                        │  │ Simulation (shared code w/ server)    │  │
                        │  │  MovementController  MeleeSystem      │  │
                        │  │  WeaponSystem  StaminaHeat  Abilities │  │
                        │  │  Rapier world (KinematicCharacterCtl) │  │
                        │  └───┬───────────────┬─────────────▲─────┘  │
                        │      │ events        │ state       │ reconcile
                        │  ┌───▼──────┐  ┌─────▼──────┐  ┌───┴──────┐ │
                        │  │ EventBus │  │ Presentation│  │NetManager│◀┼──▶ Colyseus
                        │  └───┬──────┘  │ AnimController│ │ predict/ │ │    room (server
                        │      │         │ WeaponVisuals │ │ interp   │ │    runs same
                        │  ┌───▼──────┐  │ CameraRig     │ └──────────┘ │    Simulation)
                        │  │ Juice    │  │ VFX / Decals  │              │
                        │  │ hitstop, │  └─────┬────────┘               │
                        │  │ shake,   │        │ VARIABLE RENDER STEP    │
                        │  │ audio,UI │  ┌─────▼────────┐               │
                        │  └──────────┘  │ Renderer/LOD │               │
                        │                └──────────────┘               │
                        └─────────────────────────────────────────────┘
```

**Golden rule:** *Simulation* never touches Three.js objects, DOM or audio. It reads commands,
mutates plain state, and emits events. *Presentation* reads state + events. This lets the
exact same `src/movement` and `src/combat` code run on the authoritative server (Node) and in
the client for prediction, and lets bots drive the same controllers with synthetic commands.

### Folder structure

```
scifi-combat/
├─ docs/ARCHITECTURE.md          ← this file (+ MOVEMENT, ANIMATION, ABILITIES, AI, VEHICLES, FRONTLINE)
├─ index.html                     Frontline battle, 4v4 to 200v200 (src/frontline.js)
├─ arena.html  rig-lab.html       4v4 feel lab (src/arena.js) · animation lab
├─ data/                          ← ALL tuning lives here (hot-reloadable JSON)
│  ├─ movement.json               base locomotion tuning (+ ragdoll)
│  ├─ down.json                   down but not out: bleed-out, revive, finish-off
│  ├─ rules.json  stratagems.json friendly fire shares; call-ins (codes, payloads, loadouts) → docs/FRONTLINE.md
│  ├─ weapons/                    one file per category, ~80 weapons total
│  │  ├─ ballistic.json  energy.json  heavy.json  exotic.json
│  │  ├─ melee.json               flame swords, vibroblades, fists, spears
│  │  └─ attachments.json
│  ├─ classes/solari.json  void.json
│  ├─ damage-matrix.json          ammo type × armor type multipliers
│  └─ ai/personalities.json
├─ src/
│  ├─ frontline.js  arena.js      client bootstraps: input → fixed-step sim → anim → render → HUD
│  ├─ core/   EventBus.js  FixedLoop.js  Registry.js  math.js
│  ├─ input/  InputManager.js  bindings.json (rebindable)
│  ├─ camera/ CameraRig.js        1P/3P blend, shoulder swap, shake, FOV kick
│  ├─ movement/ MovementController.js  states/  GroundProbe.js  Mantle.js
│  ├─ combat/
│  │  ├─ melee/ MeleeSystem.js (swept blades, the rifle butt)  MeleeWeapons.js (the arsenal: base + overrides)
│  │  ├─ weapons/ WeaponSystem.js  RecoilPattern.js  Ballistics.js  Attachments.js
│  │  ├─ Damage.js  StaminaHeat.js  Armor.js
│  │  ├─ Stratagems.js          call-ins: codes on the wrist pad, beacons, strikes, jets, pods, smoke
│  │  ├─ SupportItems.js  Passives.js   stims, ammo packs, repairs; the 20 class passives
│  │  ├─ HitReactions.js  ReviveSystem.js   ragdoll triggers; downs and revives
│  ├─ classes/ ClassSystem.js  abilities/*.js
│  ├─ ai/ AIController.js  UtilityBrain.js  SquadDirector.js  Perception.js  CoverGraph.js
│  │      FrontlineCommander.js  squads of 4, attack/defend orders per team, whistle waves
│  │      SupportCommand.js  CrewPilot.js   gun crews and drivers: posts, fire missions, convoys
│  │      CallInPlanner.js  ItemPlanner.js  stratagems; stims, ammo packs and repairs
│  │      Barks.js                 names and callouts (squad:bark events)
│  │      tactics/ SquadTactics.js  TacticalMap.js  Suppression.js   squad phases, cover spots → docs/AI.md
│  ├─ game/ FighterFactory.js  FrontlineSession.js (match loop, think and pipeline LOD, waves)
│  │        BattlePoints.js (earned for team play, spent on the call-in panel)
│  │        frontline/ MapSizes.js (4v4–200v200)  FrontlineMap.js (a seeded map per size)  Trenches.js
│  │                   Ruins.js  Fortify.js (digging in)  FrontlineMode.js (rules)
│  │                   Logistics.js (supply war) → docs/FRONTLINE.md
│  ├─ vehicles/ VehicleSystem.js  FieldGuns.js (howitzers, rockets, AT guns, towing) → docs/VEHICLES.md
│  ├─ world/ CoverIndex.js  EntityGrid.js  Terrain.js  NavGrid.js  WireField.js  Structures.js
│  │         spatial indexes, diggable heightfield, self-repairing flow fields and A*, barbed wire,
│  │         what holds the city's buildings up and what comes down when it's shot away
│  ├─ physics/ Ragdoll.js       deterministic particle ragdolls (blasts, criticals, downs, deaths)
│  ├─ anim/ ProceduralHumanoid.js  FootPlanter.js  MotionEvents.js  AnimationSystem.js
│  │        ClipAnimationController.js (GLB)  ik.js        → docs/ANIMATION.md
│  ├─ render/ CrowdRenderer.js    the crowd in the trooper kit (bone texture, ~25 instanced draws, impostors)
│  │          TrooperKit.js  VehicleKit.js  StratagemKit.js  ModelKit.js (assets modeled in code)  TrooperMaterial.js (paint by channel)
│  │          Atmosphere.js (sky, sun, height fog, sky light, ash)  PostFX.js (god rays, bloom, grade)
│  │          BattlefieldRenderer.js  TerrainChunks.js  ArtTextures.js  CoverTextures.js  ScorchField.js
│  │          SandbagTops.js  TracerPool.js
│  │          chunked terrain, triplanar cover, trenches, wire, objectives; pooled tracers
│  ├─ audio/ AudioManager.js  MusicDirector.js
│  ├─ net/  NetworkManager.js  Prediction.js  Interpolation.js  protocol.js
│  ├─ vfx/  VehicleViews.js  ZoneDeployableViews.js  BattleFx.js (shell bursts, smoke, trails)
│  │        StratagemViews.js (beacons and their beams, danger fences, strike streaks, the jet, pods, the sentry)
│  │        GunFx.js (muzzle flashes at the rig's barrel, impacts by surface, bullet holes, spent brass)
│  │        CollapseViews.js (walls toppling and floors dropping as buildings come apart)
│  │        Particles.js  Decals.js  Tracers.js (InstancedMesh pools)
│  └─ ui/   FrontlineHud.js  FireControl.js (artillery view)  StratagemPanel.js (call-in panel, beacon markers)
│           HitFeedback.js (hit markers, damage direction, the camera's hit flinch)
│           VisorDamage.js (red edges, cracks, corner streaks and blood when you're hurt)
│           BattlePointsHud.js ("+100 TAKEDOWN" lines under the crosshair)  MeleeTells.js (windup chevrons)
│           BarkVoices.js (callouts spoken and subtitled)
│           OptionsMenu.js  Settings.js (graphics presets, render scale, toggles, camera, audio; saved in the browser)
│           HUD.js  store.js (zustand/vanilla)  menus/
└─ server/
   ├─ index.js  rooms/BattleRoom.js  LagCompensation.js  Validation.js
```

### Module contracts (summary)

| Module | Owns | Reads | Emits |
|---|---|---|---|
| InputManager | device polling, bindings, buffering | DOM / Gamepad API | `Command{tick, move, look, buttons}` |
| MovementController | locomotion FSM, velocity, stance, stamina spend | Command, Rapier, class mods | `move:*` (land, slide, vault, dodge) |
| MeleeSystem | attack/guard FSM, hit sweeps, parry windows, heat | Command, opponent state | `melee:*` (hit, block, parry, stagger, counter) |
| WeaponSystem | fire modes, ammo/heat, recoil, spread, ADS | Command, weapon data | `weapon:*` (fire, reload, overheat) |
| ClassSystem | loadout, passives, ability cooldowns | class data | `ability:*` |
| AIController | produces **Commands** like a player | Perception, Squad, blackboard | — |
| NetworkManager | prediction, reconciliation, interpolation | sim snapshots | — |
| AnimationSystem + rigs | pose solve per fighter (procedural or clip), foot planting, LOD | sim state (read-only), combat events | `anim:footstep`, `anim:impact`, `anim:cloth` |
| CameraRig | 1P/3P blend, collision, shake, FOV | movement state, events | — |
| AudioManager / Juice | spatial SFX, hit-stop, rumble | events | — |

AI produces the same `Command` struct as humans → bots get identical movement & melee feel,
and bots can run server-side for free.

---

## 2. Simulation timing

- Fixed **60 Hz** sim step (`FixedLoop`), render interpolates between last two sim states; presentation (camera, animation, effects) steps by the real frame time (`loop.frameDt`, capped at 50 ms), so it keeps its timing at any refresh rate.
- Server sim 60 Hz, snapshot send 20–30 Hz, input send every tick (bundled with last 3 for loss).
- **Hit-stop** is a *presentation* time-scale on the attacker/victim's animation + camera, plus a
  tiny sim pause for the two combatants only (≤ 6 ticks). Never freezes the global sim online.

---

## 3. Movement system (the soul, part 1)

Implementation: `src/movement/MovementController.js`. Rapier `KinematicCharacterController`
handles collide-and-slide, autostep (stairs ≤ 0.35 m), slope limits (≤ 50°), snap-to-ground.

### State machine

```
           ┌────────── jump (coyote/buffer) ──────────┐
           ▼                                          │
 ┌──────┐ sprint ┌────────┐ crouch@speed ┌───────┐    │
 │Ground│──────▶ │ Sprint │────────────▶ │ Slide │──┐ │
 │(walk/│◀────── └────────┘              └───┬───┘  │ │
 │crouch│  crouch hold/ prone hold           │ melee/fire allowed in slide
 │prone)│◀─────────────────────────────────── ┘     │
 └─┬──┬─┘                                          │
   │  └── dodge ──▶ ┌───────┐ (i-frames 0.08–0.30s)│
   │               │ Dodge │──▶ Ground             │
   │               └───────┘                       │
   └── fall ──▶ ┌──────┐ ledge ahead ──▶ ┌────────┐│
               │ Air  │────────────────▶│ Mantle ││
               └──┬───┘  wall + speed   └────────┘│
                  └─────────────────▶ ┌─────────┐ │
                                      │ WallRun │─┘ (max 1.1s, 1 per airtime)
                                      └─────────┘
```

### Feel principles (non-negotiable)
1. **Acceleration curves, not instant velocity.** Ground accel ~ 55 m/s², decel ~ 70 m/s²,
   "turn-around boost" ×1.6 accel when input opposes velocity (kills the ice-skate feel).
2. **Weight via anticipation, not latency.** Input is honored on the *same tick*; weight comes
   from animation (lean, plant), camera lag, and accel curves — never from input delay.
3. **Coyote time 120 ms, jump buffer 150 ms**, variable jump height (release early → gravity ×2.2).
4. **Slide = momentum conservation.** Entering slide gives +15 % speed burst, friction low,
   gravity projected onto slope (downhill slides accelerate). Slide → jump keeps 90 % horizontal.
   Slide cancels into melee (slide-slash) or ADS fire at reduced spread penalty.
5. **Dodge** is directional relative to camera, costs 25 stamina, i-frames are a sub-window
   so it rewards *timing*, not spam (stamina regen delay 0.8 s after use).
6. **Mantle/vault** is context detected by 3 ray probes (knee, chest, head) + top-down probe:
   - obstacle height ≤ 1.1 m & thin → **vault** (keep momentum),
   - ≤ 2.2 m → **climb/mantle** (root-motion curve, 0.45 s, interruptible by being hit),
   - auto in sprint, button-press otherwise (prevents accidental mantles in fights).
7. **Class modifiers** multiply speed/accel/stamina (Juggernaut ×0.82 speed, no wall-run, dodge
   becomes a shoulder-bash; Scout ×1.12 speed, double wall-run).

### Camera
`CameraRig` keeps a single camera; blends between first person (the animated head's eyes, or the
gun's sight line when aiming; [V]) and third person (shoulder offset, swap with [B]). Spring-damped follow, sphere-cast
collision pull-in, FOV kick on sprint (+6°) / slide (+10°). Head-bob is **procedural and
small** (amplitude ∝ speed, capped at 1.5 cm in FP, 0 in reduced-motion mode); camera shake
uses trauma² Perlin noise (Squirrel Eiserloh model) clamped per-source.

---

## 4. Flame-sword melee (the soul, part 2)

Implementation: `src/combat/melee/MeleeSystem.js`.

### Attack anatomy (data-driven per attack)
```
| windup (readable tell) | active (hitbox sweeps) | recovery (punishable) |
  ^ feint-cancelable        ^ hit-stop on contact     ^ cancel-able into dodge after X%
```
Each attack defines frames, damage, poise damage, guard damage, hit arc, sweep sockets,
chain targets, and whether it's **parryable**, **blockable**, or **unblockable** (glowing red tell).

### Defense
| Input | Window | Result vs. incoming hit |
|---|---|---|
| Tap guard at hit time | **Perfect Parry** first 150 ms (scales 120–180 by sword) | Attacker staggered 0.9 s, flame burst VFX, 4-tick hit-stop, **Counter** window 0.6 s opens, +heat vent |
| Press guard just before (150–260 ms) | **Perfect Block** | 0 HP damage, small guard damage, builds Guard Meter +15 |
| Hold guard | Block | 70–85 % HP reduction, guard damage → Guard Break at 0 (stun 1.2 s) |
| None | Hit | full damage + poise damage → flinch/stagger |

- **Parry spam protection:** missing a parry (pressing with no hit) puts you in a 350 ms
  "whiff" during which parry window is disabled — readable, tight, but fair.
- **Guard Meter** (0–100): fills from perfect blocks/parries; at 100 unlock **Ember Riposte**
  (cinematic counter, slow-mo kill cam if lethal).
- **Directional indicator:** incoming melee shows a HUD chevron on the attack side starting at
  windup; color = parryable (amber) / unblockable (red).

### Heat
Every swing adds heat; flame special adds lots. Heat > 70 % = bonus burn damage (risk/reward);
100 % = **Overheat**: sword sputters, 2 s no specials, block reduction halved. Perfect parries vent heat.
Durability is optional per variant (e.g. "Cinder Edge" degrades, others don't).

### Flame special
Hold heavy 0.6 s → **Flame Wave** projectile arc (costs 35 heat + 20 stamina), or while sprinting
→ **Sweeping Arc** 270° close range. Both are parryable (reflect on perfect parry!).

### Gun interplay
- Melee hit on a reloading/ADS target = **"Interrupt"** (bonus poise dmg, cancels reload).
- Shotguns/heavy pistols at point-blank cause flinch that interrupts attack windups.
- Flame swords can **deflect energy bolts** while blocking (not ballistics) — heat cost per bolt.

### AI vs. guard
AI melee brain reads `target.melee.guarding`, `target.melee.parryWhiffTimer`, and keeps a short
memory of the player's parry timing. Responses: delayed swings (timing mix-ups), **feints**
(cancel windup at 60 %), guard-break heavies, grabs (unblockable), and backing off to shoot.
Difficulty scales feint probability and reaction time (Recruit 450 ms → Legend 180 ms).

---

## 5. Ranged combat & data model

Weapons are pure data (`data/weapons/*.json`) composed from **archetype + overrides**.
Behaviour pieces are small strategy objects selected by key:
`fireMode: auto|semi|burst|charge|beam|spool`, `projectile: hitscan|ballistic|arc|beam`,
`ammo: magazine|heat|battery`, `recoil: pattern id`, `reload: mag|shell|vent|cell`.

Damage = `base × falloff(dist) × hitzone × matrix[ammoType][armorType] × attachmentMods`.

| ammo \ armor | Flesh | Plate | Shield | Energy Barrier |
|---|---|---|---|---|
| Kinetic | 1.0 | 0.7 | 0.6 | 1.2 |
| Plasma | 1.1 | 1.3 | 0.8 | 0.7 |
| Ion | 0.6 | 0.8 | 2.0 | 1.8 |
| Flame | 1.3 + burn | 0.8 | 0.9 | 0.5 |
| Cryo | 0.8 + slow | 1.0 (brittle ×1.5 next hit) | 0.9 | 0.9 |

Roster target (~80): Ballistic 24, Energy 18, Heavy/Explosive 10, Exotic 10, Melee 10,
Throwables/Gadgets 10. Full table seeds in `data/weapons/`.

Attachments: slots `optic, barrel, magazine, underbarrel, stock, core` (core = energy only).
Each attachment is a list of stat ops `{stat, op: mul|add|set, value}` applied in slot order,
plus visual mesh + socket name. Trade-offs are mandatory (every positive has a negative).

**Reloads that cost** (`WeaponComponent`, [GAMEPLAY_PLAN.md](GAMEPLAY_PLAN.md) §1). For magazine-fed guns:
- The reserve is whole magazines; the HUD shows a pip per mag.
- Reloading with rounds still in the mag throws that mag away, rounds and all. You top up only
  when it's worth it.
- A reload is two stages: the old mag out, then the new one in. From empty, the bolt is worked
  too. The data can set `reload.stages` and `reload.chamber`; otherwise they're split from
  `tactical` and `empty`. The AR is 0.9 + 1.0 s, plus 0.6 s from empty.
- Interrupted in stage 1, a reload starts over with the old mag still in. Once the old mag is
  out, the next reload picks up stage 2 where it stopped.
- Sprinting holds a reload with its progress kept. A hit holds it 0.2 s rather than cancelling
  it. You walk at 85% while you reload.

Shell-fed guns load shell by shell, and firing stops them. Heat guns vent. Every hit also knocks
the victim's aim (`flinch`): half of what their camera takes, recovered by the ergonomics chase.

---

## 6. Classes (summary — full data in data/classes)

Solari Directorate: Lancer (assault), Bastion (juggernaut), Veil (infiltrator), Artificer
(engineer), Lumen (medic), Seraph Marksman, **Dawnblade** (flame knight), Skyrider (pilot),
Prism Adept (tech), Breacher (demo).

Void Collective: Reaver (assault), Monolith (juggernaut), Wraith (infiltrator), Rigger
(engineer), Mender (medic), Hollow-Eye (marksman), **Ashsworn** (flame knight, black flame),
Driftcaller (pilot), Psion (psionic), Riftbreaker (demo).

Mirror roles but **asymmetric mechanics** (Solari shields regenerate, Void armor leeches on hit).

---

## 7. AI

- **Utility AI** per agent: considerations (health, ammo, distance, cover score, squad order,
  threat, objective pressure) → scored actions (Shoot, Advance, TakeCover, Flank, Melee,
  Suppress, Heal, UseAbility, Objective, Retreat). Hysteresis prevents dithering.
- **SquadDirector** (blackboard per squad of 3–5): assigns roles each 1 s — *anchor* suppresses,
  *flanker* follows CoverGraph path off the threat's view cone, *pusher* advances on suppression.
  Emits **callouts** (voice line + tell) before coordinated moves, so players can read them.
- **Perception**: view cone + hearing (gunshots, sprinting) + memory decay; lag-free on server.
- **Difficulty director**: tracks player performance (K/D trend, health lost/min) and adjusts
  accuracy, reaction, feint rate, squad coordination within a designer-bounded range.
- Personalities from data: aggression, patience, preferredRange, feintRate, coverBias.

> Implemented ([AI.md](AI.md)): `CombatBotBrain` runs every bot with full kits. In Frontline,
> `SquadTactics` gives each squad a phase twice a second: advance, man the jump-off trench, contact
> (bounding overwatch), assault, clear a building room by room, hold the line (and dig in),
> regroup, or charge. It issues orders to each member, and each member carries its order out
> through the brain. The rest of the Frontline AI:
> - `TacticalMap` indexes cover spots and rooms;
> - `Suppression` turns near misses into suppression that pins soldiers down;
> - the commander blows the whistle for whole waves to go over the top together.

---

## 8. Multiplayer

- **Colyseus** BattleRoom, server runs shared sim at 60 Hz, schema-encoded snapshots.
- **Client prediction** of own movement + melee + weapon fire; keep ring buffer of
  `{tick, command, state}`. On snapshot: if `|server - predicted| > ε`, rewind to server state and
  re-simulate pending commands (movement is cheap → full replay OK). Visual error smoothed over 100 ms.
- **Remote entities**: interpolate 100 ms behind (2 snapshots), extrapolate ≤ 150 ms on loss.
- **Lag compensation**: server keeps 1 s history of hitbox capsules; hitscan rewinds to
  `clientTick - interpDelay`; capped at 200 ms rewind. Projectiles spawn forward-simulated by half RTT.
  Melee: server validates parry with the defender's *own* timeline (favor-the-defender for parries,
  favor-the-shooter for hitscan — documented trade-off).
- **Validation**: speed/teleport checks vs. max movement envelope, fire-rate checks, ammo authority,
  LOS check on hits, rate-limited input. Never trust client damage.
- Voice: WebRTC hooks (`net/voice.js`) via SFU optional. Spectator = interpolated read-only client.
- Playlists: casual/ranked (Glicko-2), custom lobbies with rule JSON.

---

## 9. Modes

> Implemented: **Frontline** ([FRONTLINE.md](FRONTLINE.md)), the flagship mode, in five sizes
> (4v4, 12v12, 32v32, 64v64, and the 200v200 Extreme Warfront). Each size has a seeded map built
> for it: from 3 sectors and 3 points on a 260 m outpost, up to 11 line sectors and 42 points on
> a 2600 × 880 m front. The sectors are separated by WW1 trench lines with wire, dugouts and
> communication trenches. Taking every point of the sector in front of your line moves the front,
> and the match ends on a breakthrough, on tickets, or at the time limit. Behind the lines,
> artillery and a supply chain (12v12 and up) fight their own war.
> Bots fill the armies in squads under a commander per team, with gun crews and truck drivers
> under a support command. `FrontlineMode` is simulation-only (`update`, `onDeath`,
> `spawnPosition`, `snapshot`) and is the template for the other modes.

Planned: TDM, Domination, Payload/Escort, Extraction/Survival, Horde (waves from data), and Campaign
(scripted `MissionScript` with triggers, AI spawn groups and dialogue cues). A mode is a class with
`update, onDeath, spawnPosition, snapshot` emitting `mode:*` events.

---

## 10. Asset pipeline & animation

> Implemented: [ANIMATION.md](ANIMATION.md). Every fighter currently uses the procedural HD2-style rig
> (world-space foot planting, sim-timed transitions, additive layers) drawn by the instanced
> CrowdRenderer. `ClipAnimationController` takes over per fighter when GLB art exists, with the same
> inputs and events. The plan below is the GLB pipeline it implements.

- Mixamo-compatible skeleton (`mixamorig:` names stripped to canonical) shared by all humanoids.
- `CharacterFactory`: loads GLB once (GLTFLoader + DRACOLoader + KTX2Loader + Meshopt),
  `SkeletonUtils.clone` per instance, attaches weapons to sockets defined in data
  (`socket_hand_r`, `socket_back`, `socket_flame_tip`, `socket_flame_base`).
- `AnimationController` layers:
  1. **Base locomotion** — 2D blend space (speed × direction) per stance.
  2. **Upper-body override** — weapon pose / melee attacks (bone mask from spine_01 up).
  3. **Additive** — aim offset (pitch/yaw 9-pose grid), recoil kick, breathing, hit reactions
     (`AnimationUtils.makeClipAdditive`).
  4. **Procedural** — foot IK on slopes, look-at, hand IK to weapon grip.
- Clips referenced by **logical names** in data (`"attack.light1": "Sword_Slash_L1"`), so new rigs
  just remap. All combat clips preloaded and `mixer.clipAction()` warmed at load (zero hitch).
- First person: separate FP arms GLB rendered in a second scene pass with its own FOV (68°),
  same weapon data, so weapons never clip into walls.

---

## 11. Performance guidelines
- Budget: ≤ 100k tris characters on screen, ≤ 300 draw calls, ≤ 2 shadow cascades (CSM), 1 shadowed light.
- LOD (implemented, `data/animation/humanoid.json` `lod`): full rig with events < 70 m, reduced rig at
  half rate < 220 m, single instanced capsule impostor beyond. The whole crowd is five instanced draw calls.
- Animation LOD: the followed fighter always solves every frame; mid rigs every 2nd frame; far fighters
  don't solve at all.
- Simulation at 400 (implemented, [FRONTLINE.md](FRONTLINE.md#scale)):
  - grid-indexed cover raycasts, and a per-tick entity grid as a flat array over the map;
  - combat rays that test cover and ground first;
  - shared flow fields per objective that repair only what a change cut off;
  - bot think LOD (every tick, then the 2nd, 4th or 6th by distance to a human camera), with the
    whole per-soldier pipeline at 30 Hz past 160 m;
  - about 1.3 MB of garbage a tick at 400 fighters.

  Measured per 60 Hz tick: 6.7 ms for 400 fighters, 2.9 ms for 128, 1.4 ms for 64, with
  artillery and supply runs.
- Pools for everything (tracers, decals, particles, audio voices). Zero allocations in hot loops
  (reuse `Vector3` scratch objects — see code).
- KTX2/Basis textures, atlases per faction, shared materials, `frustumCulled`, BVH (three-mesh-bvh)
  for raycasts against static geometry; Rapier for dynamic.
- Physics: kinematic character controllers only for players/bots; simplified convex proxies.
- Profile with `renderer.info`, Spector.js, Chrome perf. Ship a dynamic resolution scaler.

---

## 12. Essential extra systems
- **Stamina** (sprint, dodge, heavy, block drain) with regen delay; **Heat** per melee/energy weapon.
- **Poise** (stagger resistance) — the hidden stat that makes melee readable.
- **Armor types** + shields (see matrix). Shields pop with audible/visual "break" event.
- **Juice bus**: hit-stop, trauma shake, controller rumble, chromatic pulse, hitmarker variants,
  killfeed icons, slow-mo kill cam (toggle).
- **Dynamic music**: MusicDirector with intensity 0–3 stems crossfaded by combat score.
- **Destructible cover**: pre-fractured chunks, health per piece, swap to instanced debris.
- **Progression**: class XP → unlocks (sidegrades, never pure power), weapon mastery → attachments,
  cosmetics (skins, flame colors, emotes, finisher animations). No pay-to-win.
- **Accessibility**: colorblind palettes (faction colors + shape coding), reduced motion (no bob,
  ¼ shake), aim assist levels (off/low/standard for gamepad), parry window assist (+40 ms,
  disabled in ranked), hold/toggle for every hold input, subtitle callouts.
- **Replay/killcam**: record server snapshots ring buffer, reuse interpolation for playback.

---

## 13. Roadmap

| Phase | Duration | Goal | Exit criteria |
|---|---|---|---|
| **0 Prototype** | 3–4 wks | Graybox arena, MovementController, CameraRig, Input (KB+pad) | Movement playtest "feels great" vote ≥ 4/5 |
| **1 Melee core** | 4 wks | MeleeSystem + 1 flame sword, parry/block, hit-stop, 1 melee bot | Parry duel is fun for 10 min vs bot |
| **2 MVP** | 6 wks | 6 guns, 2 classes/faction, TDM offline bots, basic HUD/audio | 4v4 bot match playable at 60 FPS |
| **3 Net slice** | 6 wks | Colyseus, prediction/reconciliation, lag comp, 8v8 TDM online | Playable at 150 ms RTT |
| **4 Vertical slice** | 8 wks | Final-quality art for 1 map, 4 classes/faction, 20 weapons, Domination, squads AI, music | Showcase-ready trailer capture |
| **5 Content** | 4–6 mo | 80 weapons, 10 classes/faction, vehicles, all modes, campaign 3 missions | Feature complete |
| **6 Polish/Live** | ongoing | Ranked, progression, cosmetics, anti-cheat hardening, perf | Beta |

Vehicles (hover bike → light tank → dropship) land in Phase 5, reusing `Command` and an
`EnterVehicle` interaction (0.35 s snap animation, camera blends to vehicle rig).
