# Animation: Helldivers 2 language, procedural rig, clip pipeline

Code:
- **Rigs:**
  - `src/anim/ProceduralHumanoid.js`: the rig every fighter uses today.
  - `src/anim/FootPlanter.js`: world-space foot planting.
  - `src/anim/MotionEvents.js`: sim moments that animation syncs to.
  - `src/anim/ClipAnimationController.js`: the same contract for skinned GLB characters.
  - `src/anim/ik.js`: body frames and 2-bone IK.
- **Scale:** `src/anim/AnimationSystem.js` (interpolation, LOD, event routing) and `src/render/CrowdRenderer.js` (instanced drawing).
- **Data:** `data/animation/humanoid.json`.
- **Tests:** `tests/animation.test.mjs`.
- **Inspection tool:** `rig-lab.html`.

**Reference mandate:** the animation has to read like Helldivers 2: slightly exaggerated, highly
readable, heavy, with anticipation and follow-through on every big action, and never floaty or
lagging the input. Any pose, timing or blend that looks lighter, floatier or slower than HD2 gets
reworked. The rules below are enforced by tests wherever they can be measured.

## Ground rules

1. **The sim owns time.** Every timing that matters is read from the simulation, never from a free-running
   animation clock:
   - stance transitions (`stanceT`), dive (`dive.t`), slide (`slide.t`) and mantle progress;
   - knockdown phases (`knock.t`);
   - weapon phases (sprint-to-fire, reload, vent, swap) and melee phases (windup/active/recovery).
   
   Gameplay and picture can't drift apart. The gun is visibly up on the tick it can fire.
2. **No input lag.** Anticipation overlaps motion that has already started. For example, the dive's
   spring-off key plays for 90 ms while the body is already travelling. Nothing waits for an animation.
3. **Feet never slide.** A planted foot is fixed in world space, and steps are timed by distance travelled.
   Cadence always equals speed / stride, at any speed, frame rate or blend.
4. **What you see is what you hit.** The hit spheres (`Hitboxes.js`) are fitted to this rig in every pose,
   and a test keeps them there.
5. **Sound and camera hang off animation events.** Footsteps, cloth, body impacts and camera bob come only
   from `anim:*` events emitted on the render frame the contact is drawn.

## Locomotion

### Foot planting (FootPlanter)
- **Gait tables:** per stance, by speed. `stride` is metres per full cycle (two steps). `duty` is the
  fraction of the cycle a foot is planted. Running duties are below 0.5, which gives a real flight
  phase (HD2's heavy sprint bound); walking and crouching have double support.
- **Step clock:** advances by distance / half a stride. Each step lifts whichever planted foot trails
  furthest behind, so alternation can't fall out of phase after landings, mantles or re-plants.
- **Landing prediction:** while a foot swings, the landing point is re-predicted every frame from the
  velocity, so turns, strafes and speed changes steer it. A swing lasts (1 − duty) of a stride of
  body travel (distance-based too).
- **Asymmetric stance:** a foot lands `land` (38%) of its stance ahead of the hip and pushes off the
  rest behind it, as real runners do.
- **Foot roll:**
  - Forward: heel strike pivots on the heel, the foot goes flat, then the heel rises and it pivots on the toe.
  - Backpedalling: mirrored (toe strike, heel push-off).
  - Side-steps: flat.
  - Strafes and backpedals take shorter, quicker steps.
- **Stretch guard:** a planted ankle that gets past its reach (pelvis would drop more than 15%) steps
  immediately. This covers hard accelerations, reversals and landing at a sprint.
- **Idle:** settle steps put the feet back under the hips one at a time (turning in place, after a stop).

### Body
- **Pelvis reach:**
  - The pelvis drops whenever a planted foot would overstretch, so the IK always reaches a planted foot.
  - A swinging foot starts to count late in its swing, measured from where the hip will be at
    touchdown, so the drop ramps in before the plant.
  - It eases out after lift-off. No pops.
- **Bob:** locked to the step clock: lowest at mid-stance when running, highest when walking. It fades in and out with the gait.
- **Thud:** every heel strike kicks a slightly underdamped compression spring (pelvis and chest),
  scaled by footfall intensity. Sprint steps land much heavier than jog steps, and landings kick it hard.
- **Lean:** the body leans into acceleration like an inverted pendulum: a punchy lean into a start, a
  braced lean back in a skid, banking into sprint carves. Running posture leans more with speed.
- **Hips and chest:** the hips turn partly toward a strafe (or its reverse when backpedalling) while the chest stays on the aim.

## Stances and transitions

Key poses: stand, crouch, prone, supine (on the back), plus kneel, push-up and sit-up for
transitions. Each transition is a path of keys with progress breakpoints that follows `stanceT`
exactly. The data can also mark the frame the body hits the ground (`impact`) and the frame the foot plants (`plant`).

| Transition | Path | Events |
|---|---|---|
| stand → prone | stand → kneel → push-up → prone | rustle at start; `proneDrop` impact at 78% |
| crouch → prone | crouch → push-up → prone | `proneDrop` at 70% |
| prone → stand | prone → push-up → kneel → stand (**chest rises before the hips**) | foot plant at 95% |
| supine → stand | supine → sit-up → kneel → stand | foot plant at 95% |
| knockdown get-up | lying (front/back) → push-up or sit-up → kneel → stand | rustle |

## Committed moves

| Move | Pose language |
|---|---|
| **Dive (forward)** | 90 ms crouched spring-off, then a horizontal superman with the gun forward (hip fire stays live), legs trailing with a little flutter, nose dropping late. The belly lands with a compression kick and a `diveLand` impact. |
| **Dive (side)** | The body stays on the aim and leans into the dive. It lands on the side and rolls onto the belly over `dive.belly.rollTime`, the same timer the hitboxes use. |
| **Dive (back)** | Falls back onto the shoulders, lands on the back (**supine**) and keeps aiming between the feet. Supine crawling scoots on the heels; the back get-up sits up first. |
| **Slide** | The hip drops (`slide` impact on contact), the torso leans back, the lead leg extends and the other folds under. It steers with a lean, the ground rattles the body, and the weapon stays up (combat slide). |
| **Hop / fall** | Push-off going up, tuck at the peak, legs reaching for the ground coming down. Landings plant both feet with a compression kick; heavy landings stumble (`land` impact). |
| **Vault** | One hand plants on the obstacle (world-fixed, `hands` impact), the legs swing over to the side, and forward momentum never stops. |
| **Climb** | Both hands plant on the lip (world-fixed), then a pull-up with the chest over the edge and a knee coming up. Feet plant on top with footsteps at 72% and 90%. |
| **Knockdown** | Thrown: tumble and flail around the airborne body. The body settles toward the lying pose over the last quarter second before the slam (ballistic time to impact). Then a `body` impact, lying front or back (from the throw direction), and a front or back get-up. |
| **Evades** | Melee classes' flameStep/ashStep: a low leap along the dash with the chest on the aim. Shoulder bash: running steps with the shoulder leading. |
| **Seated** | Bike riders: hands on the bars for drivers; gunners and passengers aim. |
| **Death** | Collapses (ease-in) to the lying pose, falling back if shot from the front. |

**Crossfades:** each state fades in over `[seconds, curve]` from `blend.fade`:
- `out` (ease-out) for commits that must read instantly: dive, mantle, knockdown, evades.
- `smooth` for drops and recoveries, so nothing front-loads a pop.
- `in` for collapses.

A state that is fading out replays its last pose, carried rigidly with the body. It can't snap when
its sim data disappears (a finished dive, a cleared mantle).

## Upper body

- **Rifle:**
  - Shouldered whenever it can fire (HD2 holds it up). Port arms while sprinting, climbing or getting up,
    with an arm pump locked to the steps.
  - The raise follows the weapon's own sprint-to-fire timer. ADS brings it to a cheek weld and tilts the head.
  - The muzzle points along the **weapon's** aim, which includes ergonomics drag and recoil. The gun
    visibly trails a fast camera turn: HD2's second reticle, shown on the body.
  - Reload rolls the gun and runs the left hand to the mag well, the pouch and back, on the reload timer.
    Vent tips the muzzle up; swap dips and re-raises.
- **Flame sword:** chest-frame keyframes per attack (data `sword.attacks`):
  - The windup eases out into a **held tell**: the blade cocked where the swing will come from,
    readable by an opponent.
  - The strike accelerates through the arc, then follows through (commitment) and eases home.
  - Heavy, flame wave and guard break are two-handed. Guard, stagger and guard-broken have their own poses.
  - Unknown moveset attacks map by name (heavy, thrust, sweep).

## Additive layers (never touch the legs)

- **Recoil** (`weapon:recoil`): the muzzle climbs, the stock drives back, the chest rocks.
- **Hit flinch** (`weapon:hit`, `melee:hit`, `ability:hit`): the chest and head snap away from the hit direction, scaled by damage.
- **Breathing:** slow at rest, heavy and fast when stamina is low or exhausted.
- **Secondary motion:** a 3-link verlet cape streams behind sprints, dives and slides.

## Event contract

| Event | Payload | Fired | Consumers |
|---|---|---|---|
| `anim:footstep` | `id, foot (0 L / 1 R), gait (walk/jog/sprint/crouch/crawl/shuffle/land), stance, intensity, surface, x, y, z, speed` | Heel strike (planted on that frame), crawl contacts, landings, transition plants | CameraRig bob (local player), AudioDirector foley, VFX dust |
| `anim:impact` | `id, kind (diveLand / slide / proneDrop / body / land / hands), intensity, surface, x, y, z` | When the body or hands visibly hit | Audio thud, camera (via `move:*`), VFX |
| `anim:cloth` | `id, kind (dive / slide / stance / mantle / knockdown / getup / sprint / raise / swing), intensity, x, y, z` | Start of big motions | Audio rustle and gear |

- **Intensity** comes from the gait table × stance (stand 1, crouch 0.45, prone 0.3) × armor (light 0.85, heavy 1.25) × size.
- **Surface** comes from `CombatWorld.surfaceAt` (cover tops report their material).
- **LOD:** only near rigs emit events.
- **Audio:** foley has its own voice tier, distance-culled before any node is created.

## Scale: 64–128 fighters

- **AnimationSystem:**
  - Interpolation: `snapshot()` before each sim tick, then `update(dt, alpha, camPos)` per frame.
    Sim timers get the matching lag, so timed poses line up with interpolated positions.
  - Detail levels by distance:
    - near (< 70 m): every frame, with events and cape;
    - mid (< 220 m): every 2nd frame, no events;
    - far: no pose at all.
  - The followed fighter is always near.
  - Event routing is one listener per event type with an O(1) lookup.
- **CrowdRenderer:**
  - Five instanced draw calls for the whole crowd (armor boxes, tapered limbs, helmets, glow parts,
    impostors), plus shadows.
  - Team palette per instance and a status glow per instance (i-frames blue, vulnerable red, Scorch
    orange, transform auras) through a small shader patch.
  - Far fighters are one capsule, upright or lying.
  - Frustum culling per fighter on the CPU.
  - Every basis is right-handed (instancing can't flip winding per instance). A test checks this.
- **Budget:** the 128-fighter test runs sim plus animation in a few ms per frame headless.

## GLB characters (ClipAnimationController)

Drop-in replacement per fighter with the same inputs and events. Mapping lives in `humanoid.json` `clips`.

- **Locomotion:**
  - A 1D speed blend space per stance (idle, walk, jog, sprint; crouch; crawl).
  - Clips are **phase-synced**: one shared phase advances by distance / blended stride, and each clip's
    time is set from it, aligned on its left heel strike. Blends never drift and never foot-slide.
  - Footsteps come from the clips' `steps` markers.
- **States:** sim-timed states (stance transitions, mantles, get-ups, dive, landing, dash) are
  **scrubbed** by their sim timer. Loops crossfade with data fades. The weights of the base layer
  always sum to 1 through crossfades.
- **Upper body:** each base clip is split into lower- and upper-body actions (track filtering from
  `upperBodyRoot`; three.js has no masks). The raised/ADS/reload layer takes the upper body on the
  sprint-to-fire timer.
- **Additive:** aim pitch, recoil and directional hit reactions (`makeClipAdditive`).

**Authoring rules:**
1. Clips are in place: no root motion; the sim moves the root.
2. Measure each locomotion clip's in-place speed (stride / duration) and enter it as `speed`.
3. Mark left/right heel strikes as normalized times in `steps`.
4. One-shots that follow a sim timer must cover their whole motion in the clip; they're scrubbed.
5. Mixamo: export "in place", strip the `mixamorig` prefix or keep it (names are normalized), and
   clone per instance with `SkeletonUtils.clone`.

## Rig lab and calibration

`rig-lab.html` plays every move from `src/tools/rigLabStations.js` side by side and looping.
- **Views:** side, front, back, top and orbit.
- **Playback:** 0.05–1× slow motion, pause and step.
- **Overlays:** planted feet and hit spheres.
- **Event log:** shows each footstep, impact and cloth event with its timestamp.
- **URL:** `rig-lab.html?station=slide&view=side&speed=0.25`. Add `&at=1.9` to freeze at that loop
  time (deterministic, used for screenshots).

**To match HD2 frame for frame** (with the movement calibration in MOVEMENT.md):
1. Capture HD2 at 120 fps from the side on flat ground (medium armor).
2. Freeze the lab at the same move and time (`&at=`) and overlay the two.
3. Tune the poses, gait tables and transition breakpoints in `humanoid.json` (no code changes), and re-run `npm test`.
4. Priority order:
   1. sprint cadence and stride;
   2. dive arc and belly impact frame;
   3. prone drop and get-up timing;
   4. slide drop;
   5. heavy landing compression.

## Tests (`tests/animation.test.mjs`)

- **No foot sliding:** checked at 60 and 144 Hz render rates across jog, sprint, carve, skid, strafe,
  backpedal and crouch walk. The heel or toe pivot moves less than 3 mm per frame, and the IK always
  reaches a planted foot.
- **Cadence:** matches speed within 10%. Footfall weight orders sprint > jog > crouch > crawl, and heavy armor stomps.
- **Footstep timing:** each footstep fires on the plant frame at the plant point, and the camera bob reacts to it.
- **Hit spheres:** sit on the drawn head and chest in every pose.
- **Gun:** up on the sprint-to-fire tick; it follows the weapon aim, not the camera.
- **Prone transitions:** the drop impact fires on its cue, and the chest leads the get-up.
- **Directional dives:** forward lands face down, back lands face up and still aims forward, side leans into the dive.
- **Additive layers:** recoil and flinch never change the legs.
- **Clip controller:** blended clips don't slide at 1.9–6 m/s, footsteps hit their markers, and crossfades sum to 1 with no single-frame snap.
- **128 fighters:** LOD counts, mid-rate scheduling, events only from near rigs, frame time.
- **Crowd renderer:** instance counts per LOD, all matrices finite and right-handed.
- **Every rig-lab move:** finite joints, planted feet always reached, the body never jumps more than 13 cm relative to the root in one frame.

## Known gaps

- Ragdoll-lite: knockdowns are authored tumbles, not physics ragdolls.
- Feet align to height (the `groundY` hook) but not to slope angle yet. Terrain arrives with the large maps.
- Strafing is side-stepping with shorter strides, not a full 8-way blend.
- Graybox geometry: the CrowdRenderer draws boxes and limbs. Real characters go through ClipAnimationController.
