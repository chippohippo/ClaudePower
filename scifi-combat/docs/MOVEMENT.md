# Movement: Helldivers 2 fidelity spec

Code: `src/movement/MovementController.js` (simulation), `src/movement/Hitboxes.js` (stance-aware
hit spheres), `src/camera/CameraRig.js` (camera), `src/combat/weapons/WeaponSystem.js`
(ergonomics aim drag). Tuning: `data/movement.json`. Contract tests: `tests/movement-feel.test.mjs`.

**Reference mandate:** the target is how Helldivers 2 feels the moment you start moving.
Any change that makes movement lighter, floatier, slower to respond or less weighty than HD2 is
rejected. The feel tests encode that as tolerance bands, so CI fails on it.

## Where the numbers come from (read this first)

There is no public spec of HD2's movement code. The values in `data/movement.json` come from
HD2's observable behavior, plus its known armor ratings (Speed 550/500/450 and Stamina Regen
125/100/50 for light/medium/heavy), and are tuned until the motion has the same shape: instant
response, a long sprint ramp, carved sprint turns, a skidding stop, a low committed dive with a
belly slide, and slow prone turning. Treat every number as a **calibration baseline**, not a
measured fact. The procedure for locking them to the real game is in the next section.

## Calibration procedure (to match HD2 frame-for-frame)

1. Capture HD2 at 120 fps (or 60) on flat ground with a measurable reference: ground decals,
   a grid map area, or a known prop spacing. Use medium armor (Speed 500) with no boosters.
2. For each row in the table below, step through frames and record the value.
3. Put the values into `data/movement.json` and tighten the matching band in
   `tests/movement-feel.test.mjs` to about ±10% of the measurement.
4. Record a matching run in the browser with the telemetry hooks (`move:*` events and
   `movement.state`), overlay both curves, and iterate until the shapes line up (start curve, ramp,
   skid, dive arc).

| Quantity | Current value | Test band | How to measure in HD2 |
|---|---|---|---|
| Jog speed | 4.5 m/s | — | Distance per second between markers, stick fully forward |
| 0 → 90% jog | ~0.12 s (accel 34 m/s²) | ≤ 0.15 s | Frames from input to steady-speed footfalls |
| Stop from jog | ~0.12 s (38 m/s²) | ≤ 0.15 s | Frames from release to rest |
| Sprint speed | 7.2 m/s | — | As jog, holding sprint |
| Jog → 95% sprint | ~0.6 s (4.8 m/s²) | 0.45–0.75 s | Frames from sprint press to top speed |
| Sprint-release skid | ~1.1 m | 0.8–1.6 m | Overrun distance after letting go of everything |
| Sprint turn rate | 270°/s, carving | 0.28–0.45 s for 90° | Arc radius on a hard camera turn |
| Sprint reversal | plant-and-pivot (26 m/s² skid, 720°/s swing) | speed dips < 50% | Frames of the reversal |
| Jog strafe switch | ≤ 0.2 s to 90% lateral speed | ≤ 0.2 s | Frames from strafe input to steady strafe |
| Sprint duration | ~14 s (7/s drain) | ≤ 15 s | Stopwatch from full stamina |
| Stamina back to sprint | ~1.75 s | 1–2.5 s | Exhaustion until sprint resumes |
| Dive airtime | ~0.5 s from sprint, 0.46 m up (HD2's ~0.41 s raised on request) | 0.45–0.6 s | Takeoff to belly impact |
| Dive travel (from sprint) | ~7.5 m incl. belly slide (4.7 m in the air) | 6.5–8.5 m | Takeoff point to rest |
| Dive i-frames | 0.04–0.36 s | ≥ 0.2 s | *Unverified*: HD2 may rely on its low profile rather than true i-frames (see deviations) |
| Dive direction | forward out of a sprint; side past 55°, back past 125° from the aim | — | Dive sideways/backward while aiming: body orientation and landing side (we land on the back after a back dive and keep aiming) |
| Drop to prone | 0.50 s | ±0.05 s | Frames of the drop |
| Prone → stand | 0.62 s (0.45 s within 1.5 s of a dive) | fast < normal | Frames of the get-up |
| Crawl speed | 0.95 m/s | ±0.1 | As jog, prone |
| Prone turn | 110°/s | 0.7–1.0 s for 90° | Frames to rotate prone |
| Climb 2 m | 0.62 s | ±0.05 s | Frames of a chest-high climb |
| Heavy landing / knockdown | 9.5 m/s (~2 m) / 15 m/s (~5 m) | — | Drop heights that cause a stumble / a knockdown with fall damage |
| Ragdoll recovery | ~1.2–1.8 s total | 1–3.5 s | Impact to control (the throw, coming to rest, the get-up) |

## State machine

```
            ┌─────────────── hold climb at a ledge ──────────────┐
            │                                                      ▼
 ┌────────────────────┐  dive key   ┌──────┐ belly lands ┌──────────────┐ slows   ┌────────────────┐
 │ GROUND             │────────────▶│ DIVE │────────────▶│ SLIDE: belly │────────▶│ GROUND (prone) │
 │ idle·walk·jog      │             └──────┘             └──────────────┘         └────────────────┘
 │ sprint (flag)      │  sprint+crouch  ┌──────────────┐  ≥0.45 s & slow  ▲ jump/sprint = get up
 │ stance: stand/     │────────────────▶│ SLIDE: feet  │──────────────────┘ (fast get-up)
 │ crouch/prone       │◀────────────────│ (committed)  │── jump = slide-hop (85% momentum)
 │ + timed stance     │  exit: crouch   └──────────────┘── dive = dive out of the slide
 │   transitions      │                          └──────── prone / 2nd crouch = drop flat: SLIDE: belly (90% speed)
 │                    │  Space (no ledge ahead)  ┌─────┐  lands: <9.5 m/s normal │ ≥9.5 LAND (stumble) │ ≥15 KNOCKDOWN
 │                    │─────────────────────────▶│ AIR │──────────────────────────────────────────────────────▶
 │                    │                          └─────┘
 │                    │  ≥15 m/s landing (above)                           ┌───────────────────────────────┐
 │                    │───────────────────────────────────────────────────▶│ KNOCKDOWN: slam → get up      │
 │                    │                                                    └───────────────────────────────┘
 │                    │  blast · critical hit · ram · shove ≥ 6 m/s        ┌───────────────────────────────┐
 │                    │  (prone ×1.8) · down · death                       │ RAGDOLL: limp, no control     │
 │                    │───────────────────────────────────────────────────▶│ at rest: get up (front/back), │
 └────────────────────┘                                                    │ downed crawl, or corpse       │
                                                                           └───────────────────────────────┘
   MANTLE (vault keeps momentum / climb ends standing) · DODGE (class evades) · VEHICLE
   STAGGER (rocked by a hit or a 2.5–6 m/s shove: stumble along it; a leg hit buckles you onto
   that knee; rocked again while stumbling → RAGDOLL; a dying or downed stumble ends in the RAGDOLL)
```

Other systems read per-tick flags the controller sets first in every tick:
- **`diveStarted` / `knockStarted`:** these cancel melee swings and guards, ability casts (half the
  cooldown refunded) and ADS. "Dive interrupts most other actions."
- **`weaponReady`:** false while mantling, knocked down, limp, downed, getting up or down from prone,
  sprinting, or in the first 60% of a stumble (all of one that ends in a fall).
  The gun is lowered and comes back up after `sprintToFire`.
- **`busy`:** no ability casts mid-dive, mid-climb, while stumbling, while down or during prone transitions.
- **Downed:** push toward where you look and you roll onto your belly and crawl; pull back and you
  roll onto your back and scoot away, facing it (`downed.rollTime` to roll over).
- **`aimYaw`:** the look yaw, except prone and belly slides clamp the gun to ±40° around the body.

## Facing model (the core of the weight)

- **`yaw`** is the camera or look direction, **`bodyYaw`** is where the body faces, and **velocity** is separate from both.
- **Jog, walk and crouch:** movement is camera-relative (strafe), and the body turns to your aim at
  720°/s (crouch 600). That's the third-person-shooter response.
- **Sprint:** the body turns toward your input at **270°/s** and the velocity follows the body, so
  sprint turns carve arcs. Tight carves bleed speed (0.25 per radian). Inputs past 115° start a
  **plant-and-pivot**: skid along the old line at 26 m/s² while the body swings at 720°/s, then
  accelerate the new way.
- **Prone:** the body turns at **110°/s**, and the gun is clamped to an arc around it (`aimYaw`). Turning while
  prone is slow and deliberate. The ergonomics reticle shows where the gun really points.
- **Dive and slide:** the body snaps (dive, 1440°/s) or turns (slide, 90°/s) toward the motion.
  Side and back dives are the exception: the body stays on the aim. A side dive lands on the side and
  rolls to the belly over `dive.belly.rollTime`. A back dive lands **supine** (`state.supine`), still
  aiming over the feet, until you stand up.

## Speed curve

Accelerating toward jog speed is near-instant (34 m/s²). From jog to sprint is a long, heavy ramp
(4.8 m/s²). Slowing from above jog speed is the sprint skid (18 m/s²); slowing below it is a crisp
stop (38 m/s²). Armor scales every speed (light ×1.1, heavy ×0.9) and stamina regen (light ×1.25,
heavy ×0.5). Slopes slow you uphill (−35% at 45°) and speed you up a little downhill (+12%).
Ground steeper than 48° makes you lose footing.

## Slides

- **Feet-first combat slide (sprint + crouch):**
  - Entry is ×1.12 sprint speed, capped at 8.6 m/s.
  - It's committed for 0.45 s and lasts at most 1.35 s.
  - Friction ramps from 4.5 to 9.5 m/s² over 0.9 s: it carries far, then stops decisively.
  - Steering turns the velocity at 80°/s, and slope gravity adds speed downhill.
  - Exits: jump = slide-hop keeping 85% momentum; the dive key = dive out of the slide. It ends crouched if you're holding crouch, standing otherwise.
  - **Slide into prone:** the prone key, or a second crouch tap from 0.12 s into the slide
    (`slide.dropAfter`), drops you flat mid-slide. You go into a belly slide carrying 90% of the speed
    (`slide.dropCarry`) that ends prone, gun still up: from a sprint straight into a crater or behind
    a parapet. Event `move:slideDrop`; the rig plays the prone drop and its thump.
- **Belly slide (after a dive lands):** 75% of the landing speed, 9 m/s² friction, 35°/s steering.
  It ends prone. Sprint or jump while it slows = fast get-up (0.45 s).
- **Off a ledge mid-slide (`roll`):** the slide becomes a fall, and the landing decides what follows.
  - A step down (landing under 6 m/s, about 0.8 m): the same slide goes on, no second entry boost.
  - A real drop: a forward roll (a parachute landing fall), mode `roll`, 0.62 s. The body goes down
    onto a shoulder, over its back and up crouched, carrying 80% of its speed plus 12% of the fall's
    (up to 7.5 m/s), easing to 2.6 m/s. No stumble, no knockdown; the roll takes 3 m/s off the
    landing, so fall damage only starts past about 7 m. The gun is down and nothing is cast while
    rolling; in first person the view dips with the body instead of going round with the head.
  - Too high to roll out of (21 m/s, about 10 m): the legs fold and the body goes down as a ragdoll,
    taking the whole fall.
  - Events `move:landRoll`, `move:landRollEnd`; the rig's roll sends a foot plant, the shoulder's
    `roll` impact (dust, thud) and the feet coming back under.

## Falls

- **Diving off a drop:** once what's below would land at 9 m/s or harder (a drop of about 2.5 m),
  the dive goes limp into a ragdoll braced for it (`startRagdoll(…, { brace: true })`): the arms go
  out ahead and down, the trunk is held out the way it's going with its nose dipping as it falls, the
  legs hold together, and both hands reach the ground first. The landing costs 75% of what it would
  on your feet, and a braced man gets up as soon as his trunk stops (well under a second), not
  after lying winded.
- **Any living ragdoll landing hard** takes fall damage as a soldier on his feet would from the same
  height (its lighter ragdoll gravity is allowed for): a body thrown off a roof by a blast is hurt
  by the landing too.
- **A landing that downs or kills** (its fall damage the last of the health): the body goes limp
  where it lands, as with any hit that downs, whether it came down from a knockdown, on its feet
  or in a roll; it doesn't get up again or roll on.

## Collision and steps (`FlatGroundBody`)

- **Round where it counts:** the body collides as a square, one axis at a time (so it slides along
  walls), but pushed into a box's face within its own width of a corner (0.1 m past its radius) it
  slips round the corner, as a capsule would, keeping its speed (3% scraped off a tick) instead of
  stopping dead on a lamp post, a wreck's bumper or a doorframe. A seam between two boxes of one wall
  isn't a corner: that stops you like the wall.
- **Steps without the pop:** kerbs, stairs and box tops up to 0.35 m are stepped in one tick (the
  sim stays exact), but what's seen eases over the step in ~70 ms (`state.stepOff`, read by the
  animation's root and so by the camera): the legs take the step instead of the whole body jumping
  16 cm in one frame, up or down. Slopes don't count as steps (only height beyond the ground's lie).

## Presentation timing

The sim is a fixed 60 Hz; everything shown (camera springs, bob, animation blends, effects) steps
by the real time since the last frame (`FixedLoop.frameDt`, capped at 50 ms). It used to step a
fixed 1/60 s per drawn frame, which ran presentation 2.4× fast on a 144 Hz screen (a buzzing bob,
stiff camera, poses snapping) and in slow motion when the frame rate dipped (a floaty camera).

## Deliberate deviations from HD2 (genre requirements)

| Deviation | Why | Toggle |
|---|---|---|
| Space hops when no ledge is ahead | Battlefront genre needs a hop. It's short and heavy (5 m/s up, 22 m/s² gravity), with **no** coyote time or jump buffer | `jump.enabled` |
| Feet-first slide from sprint + crouch | Requested slide fantasy. It uses the same committed-slide model as HD2's belly slide | — |
| Dive i-frames (0.04–0.36 s) | Requested. HD2's dive protection may come mostly from its low profile, which we also have (prone/dive hitboxes) | `dive.iframeStart/End` |
| A higher, longer dive (0.5 s, 0.46 m up) | Requested: more air and a little more distance | `dive.upVelocity`, `dive.gravity` |
| Slides roll off ledges; dives off drops brace as ragdolls | Requested | `roll`, `dive.braceAt`, `ragdoll.drive.brace` |
| Melee-class evades (`flameStep`, `ashStep`, `shoulderBash`) | A dive to prone would end every sword duel | class `movement.dodgeStyle` |
| Wall-running | Disabled (HD2 has none) | `wallRun.enabled` |

## Hitboxes

Hit spheres come from the movement state (`Hitboxes.js`) and are fitted to the animation rig in every
pose (tested), so what you see is what you hit:
- **Profiles:** stand head 1.65 m, crouch 1.15 m, prone 0.40 m (raised to aim), supine 0.46 m, dive
  0.72 m above the airborne root. Feet-first slide leans back; bike riders use a seated layout.
- **Body axis:** the head leads in the dive direction; supine bodies and backward knockdowns have the
  head behind; side landings roll toward the facing on the same timer as the animation.
- **Transitions:** stance changes blend between layouts.
- **Scale:** transform supers scale the spheres with their silhouette.

## Camera (HD2 third person, optional first person)

- **Look:** zero latency. The camera reads the latest mouse or stick yaw and pitch every render frame; only position lags.
- **Follow:** critically damped springs, ω = 24 horizontal (~40 ms) and 14 vertical (~70 ms).
  Slight lag that reads as weight, never float.
- **Framing (right, up, back):** close over the right shoulder, as in the reference clips (the
  soldier's head just left of and below the crosshair, the body filling the lower middle).
  - Stand: 0.48, 0.16, 2.0 m. Crouch: 0.45, 0.2, 1.85 m. Prone: 0.42, 0.38, 1.9 m.
  - Sprint pulls back 0.3 m. ADS: 0.42, 0.12, 1.2 m.
  - Collision pulls in instantly and eases out. Thin things standing free (lamp posts, sign poles,
    tree trunks: under 0.8 m across) don't count (`cameraSolid`): passing through one for a moment
    beats a snap in on every post. A building's pieces always count, however narrow.
- **Bob:** event-driven. Each `anim:footstep` (planted by the animation rig) kicks a stiff spring
  down (ω 26, ζ 0.45, so a thud with a small rebound) plus an alternating roll. Footstep intensity scales
  with gait and stance (sprint thuds, prone barely moves). It never wanders like a sine wave.
- **Sway:** the camera banks into sprint carves (body turn rate × speed).
- **FOV:** base 70, +6 at full sprint, +8 sliding, +10 diving. The dive start punches +5;
  heavy landings dip −4 and knockdowns punch +6. ADS goes to the weapon's ADS FOV.
- **Scopes** (`ScopeView`): a gun whose sights narrow the view to 30° or less (the snipers, a 4x
  optic) is looked through. As it comes up, the eye goes to the sight whatever the view (third person
  too), your gun and arms aren't drawn, and the screen becomes the sight picture: a round field of view
  magnified to the gun's ADS FOV (the Longwatch's 18°, about 4x), black round it, a reticle (posts, a
  fine cross with stadia dots, a lit centre dot) and the lens darkening at its edge. The rounds left
  and the score stay on screen over the black.
- **Reduced motion:** bob is ×0.25, with no roll, sway or FOV effects, and a quarter of the shake.
- **First person ([V], pad View):** the camera blends (ω 14) into the animated head's eyes, so
  stance changes, dives and slides move it as the body moves. Stiff springs on where the eyes sit
  on the body (ω 40 across, 22 up and down) take out the footfall thud without lagging the body's
  travel. Aiming down sights puts the eye inside the optic on the gun's sight line (the housing's
  walls vanish from in there): the gun still trails a fast turn (ergonomics drag), so the sight
  picture drifts and settles. Your own head, helmet and cape aren't drawn, nor is the rim light on
  your arms; the rest of the body is, so you see your arms, gun and legs. Vehicles, ragdolls and
  death are always third person.

## Cover

Not in HD2 (added on request; `cover` in the data, `src/movement/CoverFaces.js`).
- **Taking it ([T]):** your back to the nearest face within 2.2 m of a wall, barrier, wreck, sandbag
  parapet or parked car (whole, on its wheels, standing still) that's at least 0.85 m tall, the one
  you're facing first. You get there quickly (up to 6 m/s), not in a jump. Under 1.45 m it's low
  cover and you crouch behind it; taller, high cover and you stand at it, turned a little toward the
  end you're facing with a shoulder to it. A car is low cover (its bodywork), whatever its roof.
- **In it:** [A]/[D] shuffle along it (2.2 m/s), stopping at its ends; within 0.5 m of an end you're
  at its corner. The gun is down; the camera goes over the shoulder on the side you're turned to.
- **Peek, aim and shoot:** aiming ([RMB]) or firing brings you out over 0.16 s: up over low cover,
  or out 0.55 m past a high corner (halfway along a wall there's nothing to come out to). The gun is
  up once you're most of the way out; let go and you're back in. Out, you're exposed: the body's
  really there, over the top or round the corner.
- **Leaving it:** [T] again, a dive, sprinting or pushing away from it for 0.15 s, a hop over low cover
  (it vaults it), or the cover going: blown away, come down as rubble, or the car driven off or
  burning.
- **HUD:** up against something you can take cover behind, "T TAKE COVER"; in it, how to come out.

## Weapon handling tied to movement

- **Ergonomics drag (HD2's second reticle):** the gun's aim chases the camera aim with a rate of
  `4 + 0.22 × ergonomics` per second (×1.35 when aiming down sights). SMG 85 is snappy; sniper 35 drags;
  vehicle guns are 100. Shots go where the gun points, not where the camera points.
- **Sprint:** aiming or firing cancels the sprint; the gun comes up after `sprintToFire`.
- **Dive:** ADS drops, hip fire stays available through the whole dive and from prone.
- **Stance and motion change the cone** (`WeaponComponent`): spread × `moveMul` (default 1.5,
  scaled up to it by speed up to 7 m/s) on the move, × `slideMul` (1.4) in a slide, × `airMul` (2)
  in the air; × 0.8 crouched and × 0.6 prone. Recoil kicks 15% less crouched and 40% less prone.
  So fire on the move to suppress, and go down to hit.
- **Shaky hands after a mag dump (tremor):** every round a person fires close on the last (within
  0.3 s) adds 1.6 ÷ the magazine to a tremor on the gun (a quarter of that spaced out), so a burst
  barely registers and holding the trigger through most of a magazine brings it to full. Once the
  trigger has rested 0.35 s it settles over 3.5 s, reloading or aiming alike. The aim shakes with it,
  up to about 0.4° up and down and 0.3° across, scaled by the tremor squared (a little hardly shows),
  and down the sights the view trembles too. Persons only: a bot's aim under strain is its difficulty's.
- **Flinch under fire:** a round cracking past within the suppression radius makes the body flinch
  away from it and duck (every soldier; see [ANIMATION.md](ANIMATION.md)), and a person's aim jumps a
  little, as from a light hit, the closer the round the more. Hits flinch harder than they used to.

## Animation sync contract

Movement emits state; the animation rig ([ANIMATION.md](ANIMATION.md)) reads it and never writes
back. It plants feet in world space and emits:
- `anim:footstep {id, foot, gait, stance, intensity, surface, x, y, z}` on every heel strike;
- `anim:impact {kind}` when the body or hands hit (dive landing, slide, prone drop, knockdown slam,
  ragdoll thud, heavy landing, ledge hands);
- `anim:cloth {kind}` at the start of big motions.

Camera bob, foot dust and footstep, gear, cloth and impact audio are driven only by those events. They're
frame-synced to the visible contact by construction. Timed animations (stance transitions, dive,
slide, mantle, get-ups, sprint-to-fire, reloads) read the sim's own timers.

**Dust (`FootFx`):** each footfall kicks up a little: a puff walking, two running, three sprinting
thrown back behind the runner, next to none crouched. A body meeting the ground throws a ring of dirt
rolling out from it, as big as the hit was hard: a heavy landing, a dive coming down on its belly, a
drop to prone, a knockdown, a ragdoll's trunk thumping down; a vault kicks a little off the hands. The
colour is the ground's: snow powder on a snowy planet, the planet's own dust on dirt and sand, grey
grit on concrete and rubble; nothing off metal, wood or water. Only within 60 m of the camera.
