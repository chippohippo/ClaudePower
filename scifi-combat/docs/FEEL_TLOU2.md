# Feel pass: The Last of Us Part II

The target: animation, movement, aiming and combat that read like The Last of Us Part II's in
weight, timing and physicality, on Emberfall's existing systems (the procedural rig, world-space
foot planting, sim-owned timing, the hit-sphere contract, ragdoll and muscles, CameraRig,
CrowdRenderer) and on top of its Helldivers 2 locomotion. Nothing is replaced; numbers move and a
few layers are added. The sim stays the authority for timing and hitboxes; the rig only shows it.

Sources: the user's reference clip "What 2000 Hours of The Last Of Us 2 looks like" (617 s, 24 fps,
measured frame by frame; times below are seconds into it), with the Helldivers 2 and Fulldrop clips
for what must stay. Reference frames are not kept in the repository. Current values come from the
code at d482136, measured headless at 60 Hz.

## 1. What the reference does, against what Emberfall does

| Moment | TLOU2 (clip time) | Emberfall before this pass |
|---|---|---|
| Enemy melee tell | Plank raised behind the head 48.01–48.05, swung 48.17–48.30: ~0.25 s readable wind-up | Data wind-ups 0.16–0.6 s with a held tell (fine) |
| Dodge | 48.09 → 48.34: **0.25 s**, torso leaning 40–50° away, arms flung out, ducking under; the camera doesn't chase it | Melee classes only (flameStep 0.24 s, 1.23 m: the right timing); gunners dive to prone; the `dash` pose leans 0.3 rad (17°) |
| Strike | Steps in, hips lead the shoulders, the body sinks into it; contact 1–2 frames after the arm starts on a counter | Arms, blade and chest twist only: no step, no hip lead, no drop (the rig's sword keys are chest-frame) |
| Being hit by a blow | Folds at the waist 60–70°, arms reaching for the floor, stumbling: **~0.9 s** helpless (48.92 → 49.80) | Light blows: a flinch only. Poise 25–49: a 0.35–0.7 s straight-backed stumble. Poise ≥ 50: thrown as a ragdoll (control back at ~2.2 s) |
| Get-up after going down | 49.34 → 49.5: **~0.2 s** to rise, moving at once | 0.85 s get-up after the ragdoll rests |
| Hit-stop | A few frames on contact | 3 ticks (50 ms), 5 vs a staggered target (fine; heavies want more) |
| Pistol shot | Wrists flip up hard, peak within **1 frame (~40 ms)**, back on target by **~125 ms**; the camera jolts | Rig kick peaks at 33 ms (right) but the muzzle moves **0.3°** (AR) to 1.3° (capped); own-fire camera shake ~0.003° |
| Hip → aim | **0.25 s**, the camera pushes in with the arms in the same 0.25 s | Gun 0.24 s (right); the camera reaches the aim framing at **0.67–0.73 s** |
| Held aim | Near-still, a slow breathing drift; scopes wander more | No sway at all; the sniper's `sway`/`holdBreath` data is never read |
| Shot point-blank (shotgun) | Flash 3–4 frames, the victim thrown back ~0.3 s, the camera kicks | Thrown as a ragdoll if the hit takes 45% of the pool (fine) |
| Sprint → prone | 97.40 → 97.875: **~0.45 s** to flat on the belly | Dive 0.5 s air + belly slide (fine: HD2's, kept) |
| Running vault (waist wall) | 83.9 → 84.5: **~0.5 s**, no speed lost | 0.40 s, 85% kept (fine) |
| 180° pivot at a run | **~0.35 s**, the slung weapon swinging out | Plant-and-pivot: dips to 1.57 m/s at 0.22 s (fine) |
| Crouch-walk | Hips at ~55–60% of standing, torso 20–30° forward, hands low in front, short steps | Hips 55% (0.52/0.94), chest pitch 0.62 rad (36°), long strides (1.55 m at 2.4 m/s) |
| Aiming up/down | The whole upper back bends with the aim | The spine ignores aim pitch: the arms and head take it all |
| Secondary motion | Packs, slung weapons and clothes swing with every turn and stop | The cape only (its damping is per rendered frame: stiffer at 144 Hz); everything else rigid |
| Hit by gunfire (you) | A flinch, a short camera jolt | A camera flinch of up to 3° (fine); no trauma from bullets; blasts give the rig no flinch |

What stays (the Helldivers 2 foundation, kept by `tests/movement-feel.test.mjs`): 0.13 s to jog,
0.13 s to stop, the 720°/s body turn, the sprint ramp and skid, the dive and belly slide, the
slide. The Last of Us Part II is as immediate as that (it starts moving on the press); its weight
is in the body, which is where this pass puts it.

## 2. Systems and files that change

| System | Files | What changes |
|---|---|---|
| Hit reactions | `src/combat/HitReactions.js`, `data/movement.json` `stagger.melee` | Blades and fists reel men instead of throwing them; knockdown only on knockdown blows |
| Movement (stagger) | `src/movement/MovementController.js` | `stagger(..., { kind: 'reel', fold })` carried to the rig |
| Rig: stagger layer | `src/anim/ProceduralHumanoid.js` `#staggerLayer` | The reel: jolted along the blow, then folded over, knees giving, a hand to the wound, the other out |
| Rig: sword layer | `ProceduralHumanoid.js` `#swordState`, `#layersAndFrames`; `data/animation/humanoid.json` `sword.attacks.*.{wind,follow}.body` | Whole-body strikes: hips lead (pelvis yaw), the trunk drops and leans into the blow, held through the impact |
| Melee sim | `src/combat/melee/MeleeSystem.js`; `data/weapons/melee.json` | A step into every strike (`lunge`); hit-stop per attack (`hitStop`); hyper armor timed from the start of the attack (it skipped the active frames) |
| Clients | `src/frontline.js`, `src/arena.js` | Hit-stop cap 5 → 8 ticks |
| Rig: recoil layer | `humanoid.json` `layers.recoil` | A visible kick in the hands: muzzle, stock and shoulder |
| Camera | `src/camera/CameraRig.js` | The aim framing and FOV move with the gun (0.25 s); a per-shot camera kick; a jolt when you're hit |
| Weapons | `src/combat/weapons/WeaponSystem.js`; `data/weapons/ballistic.json` | Aim sway while aiming (breathing drift, a scope's wander, hold breath) |
| Rig: aim | `ProceduralHumanoid.js` `#layersAndFrames` | The upper back bends with the aim's pitch |
| Rig: dodge pose | `humanoid.json` `poses.dash` | Lean away and duck under, arms out |
| Evade | `MovementController.js` `#startEvade`; `data/movement.json` `evade.sidestep` | Close to a man swinging at you, the dodge button sidesteps instead of diving (everyone) |
| Rig: crouch | `humanoid.json` `poses.crouch` | The sneak: a little higher, the trunk less pitched |
| Cape | `ProceduralHumanoid.js` cape | Damping per second, not per frame |
| Rig lab | `src/tools/rigLabStations.js` | Stations for the exchange: strike, reel, dodge, shot |

## 3. Timing, pose and blend adjustments

Every number below is a data value (or one constant named in the code) and is checked by a test.

### 3.1 Melee: the man hit (priority 1)
- Any blow of poise ≥ 15 reels: stumble speed lerp(1.2, 2.6) m/s and time lerp(0.5, 1.0) s over
  poise 15 → 90 (light slash 18: 1.25 m/s, 0.52 s; light3 35: 0.63 s; heavy 60: 2.0 m/s, 0.8 s;
  guard-break kick 80: 0.93 s). Measured against 0.9 s for a heavy blow in the clip.
- Poise ≥ 90 (the riposte, a fist's slam) or an attack marked `knockdown`: a knockdown ragdoll, as
  before. Kills and downs: as before (a stumble, then the knees go).
- The reel's pose: the first 15% is the jolt along the blow (head and chest snap with it); then
  the trunk folds over by lerp(0.55, 0.95) rad (31–54°) with the knees bending (pelvis down 12 cm
  at full), head down, one hand pulled to the gut, the other thrown out for balance; it eases back
  over the last 30%. Steering returns at 65% (unchanged); the gun is off target for 60%.

### 3.2 Melee: the man striking (priority 1)
- A step into every strike: `lunge` on entering the active frames, light 1.6 m/s (≈ 0.2 m),
  light3 2.0, heavy 2.4, counter 2.8, slide slash and sweep 0 (they carry their own motion),
  thrust keeps 4.5. The feet step after the root as for any motion.
- The body keys (`body: { hip, lean, drop }`, radians and metres, on each attack's `wind` and
  `follow` keys; the strike interpolates between them with the blade):
  - wind: the hips coil with the shoulders (hip ≈ 45% of the chest's wind twist), the trunk
    rises slightly (lean −0.05), the knees gather (drop 0.04 m).
  - strike: the hips lead: they reach their follow twist by 40% of the active frames while the
    chest arrives at 100%; the trunk leans into the blow (lean +0.22 to +0.35) and sinks (drop
    0.08–0.12 m) on contact.
  - follow: held for the first 35% of the recovery (the commitment you can read), then home.
- Hit-stop (`hitStop`, ticks at 60 Hz, data): light 3, light3 4, thrust 4, heavy 6, sweep 5,
  counter 7, guard break 6; a staggered target +2. Client cap 8 ticks.
- Hyper armor counts from the start of the attack (wind-up included), so heavy1's [0.2, 0.62]
  covers the active frames.

### 3.3 Guns (priority 2)
- Recoil in the hands (`layers.recoil`): ω 34 (peak ~35 ms, as the clip), ζ 0.5 → 0.6 (back within
  5% at ~150 ms, the clip's 125 ms), muzzle climb 0.09 → 1.3 rad per unit, stock back 0.06 → 0.7 m
  per unit, shoulder rock (chest) 0.035 → 0.22, head 0.02 → 0.1. Peaks: rifle ≈ 3.5° and 3.5 cm,
  pistol/sniper/shotgun up to ≈ 10°.
- Aim camera: framing and FOV springs go to ω 20 while the aim value is changing (95% in 0.24 s,
  with the gun), staying at ω 8–10 for stance and sprint framing.
- Own-fire camera kick: a pitch spring (ω 40, ζ 0.55) kicked by `visualKick` × 0.012 rad (rifle
  0.4°, pistol 0.7°, shotgun/sniper 1.7°); it's presentation (the aim offset is unchanged).
- Aim sway (people only, while aiming): a slow breathing figure-eight, 0.0012 rad at 0.25 Hz for
  rifles; scoped weapons (`ads.sway`) multiply it (sniper 0.6 → about 0.007 rad at full ADS);
  holding sprint while aiming a scope holds the breath (`ads.holdBreath` s) and stills it, then it
  comes back doubled for a second.

### 3.4 Hit reactions to gunfire (priority 3)
- Your camera jolts when you're hit: trauma 0.06 + damage/300 (a rifle round ≈ 0.14 → ~0.05° peak
  plus the existing flinch). Blasts flinch the rig like a hit (they emitted no `weapon:hit`).

### 3.5 The dodge (priority 3)
- `evade.sidestep` (anyone): within 4 m of an enemy who is winding up or swinging at you, the dodge
  button sidesteps instead of diving: 9.5 m/s × 1.4 peak, 0.26 s (≈ 1.15 m), i-frames 0.02–0.2 s,
  14 stamina, away from the swing unless you steer it.
- The `dash` pose: pelvis 0.72 → 0.62 m (ducking), chest pitch 0.3 → 0.42 rad, the trunk leaning
  away from the dodge's way by 0.75 rad (43°: the clip's 40–50°), arms out wide.

### 3.6 The body (priority 4)
- Aim pitch bends the upper back: 35% of the aim's pitch goes into the chest (clamped ±0.45 rad),
  so the shoulders and head follow a high or low aim.
- Crouch (the sneak): pelvis height 0.52 → 0.55, chest pitch 0.62 → 0.5 rad, pelvis pitch 0.35 →
  0.3 (keeping the hit spheres within their tests).
- Cape damping per second (0.93 per 60 Hz frame → 0.93^(60 dt)): the same at 144 Hz as at 60.

### 3.7 Rejected (lighter, slower or less physical than the reference)
- Slower starts and stops for "weight" (TLOU2 moves on the press; slowing the sim would read as
  lag). The weight goes into the lean, the step-in and the fold instead.
- A full ragdoll for heavy blows (it reads as a physics glitch next to the clip's fold; control
  came back at 2.2 s against the clip's 0.9 s).
- Camera shake for melee impacts larger than the hit-stop (the clip's camera barely moves on a
  blow; the body sells it).
- A longer hit-stop on light hits (beyond 3 ticks the combo stutters).

## 4. Priority order

1. **Melee impact** (3.1, 3.2): the reel, the whole-body strike, the step-in, hit-stop per attack,
   the hyper-armor fix. The biggest single gap: TLOU2's combat is close, and every exchange ends in
   a body.
2. **Guns** (3.3): the kick in the hands, the aim camera with the gun, the camera kick, aim sway.
3. **Hits and the dodge** (3.4, 3.5).
4. **The body** (3.6): the aim-bent back, the sneak crouch, the cape.

## 5. New data (existing style)

`data/movement.json`:
```json
"stagger": { ...,
  "melee": { "poise": [15, 90], "time": [0.5, 1.0], "speed": [1.2, 2.6], "fold": [0.55, 0.95], "knockdown": 90 } },
"evade": { ...,
  "sidestep": { "speed": 9.5, "duration": 0.26, "iframeStart": 0.02, "iframeEnd": 0.2, "staminaCost": 14,
                "cancelableAfter": 0.2, "threatRange": 4 } }
```

`data/weapons/melee.json` (per attack): `"lunge": 1.6`, `"hitStop": 3`.

`data/animation/humanoid.json`:
```json
"sword": { "attacks": { "light1": {
  "wind":   { "h": [...], "b": [...], "tw": -0.45, "body": { "hip": -0.2,  "lean": -0.05, "drop": 0.04 } },
  "follow": { "h": [...], "b": [...], "tw": 0.4,   "body": { "hip": 0.32,  "lean": 0.24,  "drop": 0.08 } } } } },
"layers": { "recoil": { "omega": 34, "zeta": 0.6, "kick": 7, "pitch": 1.3, "back": 0.7, "chest": 0.22, "head": 0.1 } },
"poses": { "dash": { "pelvisH": 0.62, "pitchP": 0.25, "pitchC": 0.42, "lean": 0.75, ... } }
```

## 6. How it's checked
- `tests/feel-tlou2.test.mjs`: the reel's duration and fold by poise; no ragdoll from a heavy
  blow, one from a riposte; the strike's hips leading the chest and the drop at contact; the
  step-in distance; hit-stop per attack; hyper armor through heavy1's active frames; the rifle's
  visible kick (≥ 2.5°) and recovery (< 0.2 s); the aim camera within 0.3 s; the sidestep near a
  swing and the dive elsewhere; the cape's damping at 60 and 144 Hz.
- The existing feel contracts (movement, animation, reactions, ragdoll, hit feedback) all pass.
- Rig-lab stations `exchange` (strike, reel, step-in) and `shot`, screenshots in
  `screenshots/tlou2/`.

## 7. Status
Implemented in this pass: see the commit log and the checks above. Later work (not yet in): bespoke
finisher and takedown animations, enemy-specific hit reactions per body part for melee, slung
weapons and pouches as secondary motion, environmental melee (walls, tables).
