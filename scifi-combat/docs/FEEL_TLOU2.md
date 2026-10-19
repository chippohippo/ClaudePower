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
| Hit reactions | `src/combat/HitReactions.js`; `data/movement.json` `stagger.melee` | Blades and fists reel men by the blow's poise instead of throwing them; a ragdoll only on a knockdown blow |
| Movement | `src/movement/MovementController.js` | `stagger(..., { kind: 'reel', fold })`; the `meleeThreat` hook; the dodge near a swing is the `sidestep` |
| Hit spheres | `src/movement/Hitboxes.js` | The `folded` layout blended on `reelCurve` (the reel); the sidestep's lean on `evadeCurve` (`SIDESTEP` offsets); the head and chest along a high or low aim (`AIM`): the spheres go where the rig draws the body |
| Rig: stagger layer | `src/anim/ProceduralHumanoid.js` `#staggerLayer` | The reel: a short jolt along the blow, then doubled over, the knees giving, a hand to the gut, the other reaching low |
| Rig: sword layer | `ProceduralHumanoid.js` `#swordState`, `#layersAndFrames`, `#hipLead`; `data/animation/humanoid.json` `sword.attacks.*.{wind,follow}.body`, `sword.guardBody` | Whole-body strikes: the hips lead the blade (an acceleration-capped spring), the trunk leans and sinks into the blow and holds through the hit |
| Rig: sidestep | `ProceduralHumanoid.js` `#sidestepPose`; `humanoid.json` `poses.sidestep`, `blend.fade.sidestep`, `blend.after` | The duck out of a blow: a step out and a push-off on world-planted feet, the trunk leaning 44-47° away, the free hand out, the gun kept near the aim |
| Rig: recoil, aim, cape | `ProceduralHumanoid.js`; `humanoid.json` `layers.recoil`, `body.aimBend`, `cape` | A visible kick in the hands; the upper back bending with the aim's pitch; cape damping per second and a cape that can't fly up |
| Melee sim | `src/combat/melee/MeleeSystem.js`; `data/weapons/melee.json` | A step into the strike (`step`, m over the active frames); hit-stop per attack (`hitStop`); hyper armor timed from the start of the attack; `bladeAt` sweeps the blade with the body's lean and drop; `threatTo` |
| Weapons | `src/combat/weapons/WeaponSystem.js` | Aim sway while aiming (breathing drift; a scope's wander from `ads.sway`; hold breath from `ads.holdBreath`) |
| Camera | `src/camera/CameraRig.js` | The aim framing and FOV ride the gun's own aim blend; a per-shot camera kick; trauma when you're hit |
| Animation system | `src/anim/AnimationSystem.js` | Blasts flinch every rig near them, like a hit |
| Clients | `src/frontline.js`, `src/arena.js` | Hit-stop cap 9 ticks; the aim sway added to the look |
| Rig lab | `src/tools/rigLabStations.js`, `src/tools/rigLab.js` | Stations `exchange` (the strike and the reel) and `duck` (the sidestep); blows rock the lab's fighters through `reactToHit` |
| Tests | `tests/feel-tlou2.test.mjs`; `tests/animation.test.mjs` | The clip's numbers as tests; the headless station runner now drives a station's buddy fully (team, mode, melee) |

## 3. Timing, pose and blend adjustments

Every number below is a data value (or one constant named in the code), measured headless at 60 Hz
and held by `tests/feel-tlou2.test.mjs` unless it says otherwise.

### 3.1 Melee: the man hit (priority 1)
- Any blow of poise ≥ 15 reels (`stagger.melee`): stumble speed lerp(1.2, 2.6) m/s and time
  lerp(0.5, 1.0) s over poise 15 → 90: a light slash 0.52 s, a heavy 0.75-0.9 s (the clip: 0.9 s).
- Poise ≥ 90 (the riposte) or an attack marked `knockdown`: a knockdown ragdoll, as before. Kills
  and downs: as before.
- The reel's pose: the jolt along the blow over the first 18% (the head and chest snap with it,
  `snap` 0.35), then the trunk folds by lerp(0.55, 0.95) rad (31-54°) on `reelCurve` (in over
  10-32%, out over the last 30%), the knees giving (pelvis down 13 cm at full), one hand pulled to
  the gut, the other reaching low ahead; the gun forgotten while folded. The head drops > 30 cm.
- The hit spheres fold with him (`folded` layout × the same curve): the head sphere within 13 cm
  of the drawn head while folded, 18 cm at worst.

### 3.2 Melee: the man striking (priority 1)
- A step into the strike (`step`, metres over the active frames, as forced motion): light 0.22,
  finisher 0.3, heavy 0.32, riposte 0.3, kick 0.15; the thrust, slide slash, flame wave and sweep
  carry their own motion. Measured 0.15-0.35 m.
- The body keys (`body: { hip, lean, drop }`: rad, rad, m) on each attack's `wind` and `follow`:

  | Attack | wind (hip, lean, drop) | follow (hip, lean, drop) |
  |---|---|---|
  | light1 (light2 mirrored) | −0.22, −0.04, 0.04 | 0.3, 0.24, 0.09 |
  | light3 | −0.28, −0.08, 0.05 | 0.4, 0.32, 0.12 |
  | heavy1 | −0.12, −0.12, 0.02 | 0.1, 0.36, 0.14 |
  | thrust | −0.18, −0.06, 0.06 | 0.22, 0.3, 0.1 |
  | counter | −0.18, −0.04, 0.05 | 0.32, 0.3, 0.11 |
  | sweepArc | −0.4, 0.02, 0.08 | 0.6, 0.18, 0.12 |

  (slideSlash, flameWave, guardBreak and the guard in the data likewise.) The hips start
  unwinding in the last 25% of the wind-up and reach their follow twist early in the active
  frames (35% at once, the rest by 40%), on a spring (ω 40, acceleration capped at 300 rad/s²) so
  the turn never pops; measured: the hips at 80% before the chest. The trunk leans and sinks with
  the blade (the same interpolation the sim sweeps); the follow is held for the first 35% of the
  recovery, then eased home. Measured drop at contact > 6 cm.
- The blade the sim sweeps (`bladeAt`) carries the same lean and drop: the drawn tip is within
  15 cm of the swept one through every strike.
- Hit-stop (`hitStop`, ticks at 60 Hz): light 3, finisher 4, thrust 4, slide slash 4, flame wave 4,
  sweep 5, heavy 6, kick 6, riposte 7; +2 on a staggered man. Client cap 9 ticks.
- Hyper armor counts from the start of the attack (wind-up included), so heavy1's [0.2, 0.62]
  covers its active frames (it was timed per phase and missed them).
- The strike's own lean replaces the accel lean while a blade is swinging (the step-in would
  otherwise tip the trunk the wrong way).

### 3.3 Guns (priority 2)
- Recoil in the hands (`layers.recoil`): ω 34, ζ 0.6, muzzle climb 1.3 rad per unit, stock back
  0.35 m, shoulder rock 0.22, head 0.1. Measured: the rifle aimed kicks 2.5° (3.9° from the hip;
  it was 0.3°), peaks at 33 ms and is within 5% by 117 ms (the clip's pistol: ~40 ms and ~125 ms).
- Aim camera: the aim framing and FOV ride the gun's own aim blend (eased), over the stance
  framing's springs: 95% in at 217 ms against the gun's 240 ms (it was 0.67-0.73 s).
- Your own shot kicks the camera (a pitch spring, ω 40, ζ 0.55, kicked by the shot's `visualKick`):
  aimed, the rifle 0.22°, a pistol 0.37°, a shotgun 0.92°, a sniper 1.1°, peaking at 33 ms. It's
  presentation: the aim's own climb is the recoil offset, unchanged. Reduced motion: 30%.
- Aim sway (people, while aiming; `WeaponSystem` SWAY): a slow figure-eight, 1.2 mrad at 0.25 Hz,
  plus 11 mrad × the weapon's `ads.sway` (a scoped rifle wanders > 8 mrad); holding sprint while
  aimed holds the breath (`ads.holdBreath` s): under 30% of the wander; letting go (or running
  out), it comes back stronger for about a second. Never while sprinting. Bots don't sway.

### 3.4 Hit reactions to gunfire and blasts (priority 3)
- Your camera jolts when you're hit: trauma min(0.3, 0.1 + damage/150) on top of the flinch.
- A blast flinches every body within 1.6× its radius away from it, like a hit (it gave the rig
  nothing before).

### 3.5 The dodge (priority 3)
- `evade.sidestep` (anyone whose dodge is the dive): within 4 m of an enemy winding up or swinging
  at you (facing you), the dodge is a quarter-second duck instead: 5.5 m/s × 1.4 peak easing out,
  0.26 s (about 0.6 m), i-frames 0.02-0.2 s, 14 stamina; backward unless you steer it. Elsewhere a
  gunner still dives. (The melee classes keep their flameStep and ashStep leaps.)
- The `sidestep` pose (`#sidestepPose`): the trunk leans `away` 1.05 rad after the step, on
  `evadeCurve` (out by 45% with an ease-out so it reads at once, held, up again by the end): the
  pelvis-to-head line measured 44° backward, 46° to the side (the clip: 40-50°), out at 0.12 s
  (the clip: 0.13 s), upright by 0.26 s (the clip: 0.21-0.25 s). The hips take half the lean and
  stay 6 cm back over the push foot; the knees give (pelvis 0.94 → 0.86 m: 64-85° at the knee
  against 45° standing: a dip, not a squat); the head goes 65% of the way with the trunk, the
  rest on the look; the free hand flung out; the gun 25% off the aim (the muzzle rises < 15°).
- The feet are planted in world space: the far foot lifts at once and lands by 45%, 0.15 m past
  its place in the stance; the near foot pushes off at 22% and comes in under him by 75%. Each
  commits to where it'll land as it comes down. No foot slides (< 1.5 cm in a frame on touchdown).
- The hit spheres lean with him (`SIDESTEP` offsets × `evadeCurve`): head and chest within 12 cm
  of the drawn ones through the whole duck.
- Blends: in over 0.03 s and out over 0.05 s (`blend.after`), since the pose starts and ends
  stood over the planted feet (a longer fade dragged them with the body); the hips keep the
  stance's swivel; the accel-lean springs don't take the evade's burst (it left a lean after it).
- The melee classes' `dash` keeps its leap (pelvis 0.72, chest 0.3) with a 0.35 rad lean after
  the dash.

### 3.6 The body (priority 4)
- Aim pitch bends the upper back (`body.aimBend` 0.35, ±`aimBendMax` 0.45 rad): measured 0.21 rad
  of chest for a 0.6 rad aim, up or down; the head stays on the look. The head then travels about
  0.25 m along the aim per radian, so the hit spheres go with it (`Hitboxes` `AIM`, measured on the
  rig standing and crouched, gun up and down): within 4 cm of the drawn head and chest at any aim
  (it was 9-12 cm off at steep aims before this pass, 17-22 cm with the bend alone).
- Crouch: measured first. The pelvis-to-head line leans 26° and the hips are at 55% of standing
  (the clip: 20-30°, 55-60%): already the clip's sneak, so the pose is unchanged (its 0.62 rad is
  the chest alone; the pelvis's pitch takes part of the line).
- Cape: damping per second (0.93 per 60 Hz frame → 0.93^(60 dt)): the tip's path through a turn
  is within 7 cm at 144 Hz and 60 (22 cm before; it was stiffer at high frame rates). Each link
  hangs at least `droop` 0.5 of its length below the one above it, measured halfway between the
  back's up and the world's: a sideways burst swings the cape out, not up over the shoulders.

### 3.7 Rejected (lighter, slower or less physical than the reference)
- Slower starts and stops for "weight" (TLOU2 moves on the press; slowing the sim would read as
  lag). The weight goes into the lean, the step-in and the fold instead; the HD2 timings stay.
- A full ragdoll for heavy blows (it reads as a physics glitch next to the clip's fold; control
  came back at 2.2 s against the clip's 0.9 s).
- Camera shake for melee impacts beyond the hit-stop (the clip's camera barely moves on a blow).
- A longer hit-stop on light hits (beyond 3 ticks the combo stutters).
- The planned 9.5 m/s sidestep (1.15 m): the push foot can't stay planted that far (the leg's
  reach ran out at 0.58 m), so it slid. 5.5 m/s keeps both feet planted; the lean carries the head
  out of the blow (about 1 m in all).
- A deeper duck (pelvis 0.8 m): 85-93° at the knee read as a squat; and a duck with the gun off
  the aim: the muzzle swung 44-60° to the sky as the trunk went back. The clip keeps the weapon in.
- A higher, straighter sneak crouch (pelvis 0.55, chest 0.5): measured, the crouch already sits in
  the clip's range; raising it would have read lighter.

## 4. Priority order

1. **Melee impact** (3.1, 3.2): the reel, the whole-body strike, the step-in, hit-stop per attack,
   the hyper-armor fix. The biggest single gap: TLOU2's combat is close, and every exchange ends in
   a body.
2. **Guns** (3.3): the kick in the hands, the aim camera with the gun, the camera kick, aim sway.
3. **Hits and the dodge** (3.4, 3.5): the jolt, the blast flinch, the duck.
4. **The body** (3.6): the aim-bent back, the crouch (measured, kept), the cape.

## 5. New data (existing style)

`data/movement.json`:
```json
"stagger": { ...,
  "melee": { "poise": [15, 90], "time": [0.5, 1.0], "speed": [1.2, 2.6], "fold": [0.55, 0.95], "knockdown": 90 } },
"evade": { ...,
  "sidestep": { "speed": 5.5, "duration": 0.26, "iframeStart": 0.02, "iframeEnd": 0.2, "staminaCost": 14,
                "cancelableAfter": 0.2, "threatRange": 4 } }
```

`data/weapons/melee.json` (per attack, inherited through `base`): `"step": 0.22`, `"hitStop": 3`.

`data/animation/humanoid.json`:
```json
"sword": { "guardBody": { "hip": 0, "lean": 0.06, "drop": 0.04 },
  "attacks": { "light1": {
    "wind":   { ..., "body": { "hip": -0.22, "lean": -0.04, "drop": 0.04 } },
    "follow": { ..., "body": { "hip": 0.3,   "lean": 0.24,  "drop": 0.09 } } } } },
"layers": { "recoil": { "omega": 34, "zeta": 0.6, "kick": 7, "pitch": 1.3, "back": 0.35, "chest": 0.22, "head": 0.1 } },
"body": { ..., "aimBend": 0.35, "aimBendMax": 0.45 },
"poses": {
  "dash": { "pelvisH": 0.72, "pitchP": 0.2, "pitchC": 0.3, "away": 0.35, ... },
  "sidestep": { "pelvisH": 0.86, "away": 1.05, "hips": 0.5, "hipsBack": 0.06,
                "step": [0, 0.45, 0.15], "push": [0.22, 0.75, 0], "lift": 0.07,
                "arm": [0.55, 0.62, 0.12], "armW": 0.9, "offAim": 0.25, "headWith": 0.65 } },
"blend": { "fade": { ..., "sidestep": [0.03, "out"] }, "after": { "sidestep": [0.05, "smooth"] } },
"cape": { ..., "damping": 0.93, "droop": 0.5 }
```

## 6. How it's checked
- `tests/feel-tlou2.test.mjs` (13): the reel's duration and fold by poise, no ragdoll from a heavy
  blow, one from a riposte; the reel as drawn, with the spheres on it; the strike's hips leading
  the chest, the drop and the step-in; the drawn blade against the swept one; hit-stop by attack
  and hyper armor through heavy1's active frames; the rifle's kick (≥ 2.5°, ≤ 60 ms, back by
  0.2 s); the aim camera within 0.3 s; aim sway and the held breath; the duck (40-50°, out by
  0.08-0.17 s, up by the end, spheres within 12 cm, no sliding, a dip not a squat, the gun near the
  aim, backward and to the side) and the dive elsewhere; the blast flinch; the aim-bent back and
  the spheres going with it; the cape at 60 and 144 Hz.
- The existing contracts all pass (movement feel, animation, reactions, ragdoll, hit feedback,
  bodies): the full suite, 399 tests. Every rig-lab station, `exchange` and `duck` included, runs
  headless through the pop and foot-reach checks.
- Rig-lab stations `exchange` and `duck`; screenshots in `screenshots/tlou2/`.

## 7. Status
Done: all four priorities, as above. Known gaps, not in this pass: bespoke finisher and takedown
animations; melee hit reactions by body part; slung weapons and pouches as secondary motion;
environmental melee (walls, tables). Outside this pass's scope but seen while measuring: running
and strafing, the drawn head can be up to 0.2 m from its hit sphere (the run's lean isn't in the
stance layouts), as before this pass.
