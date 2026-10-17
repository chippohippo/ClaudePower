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
- **Ragdoll (simulation side):** `src/physics/Ragdoll.js`, tuning in `data/movement.json` `ragdoll`.
- **Inspection tool:** `rig-lab.html`.

**Reference mandate:** the animation has to read like Helldivers 2: slightly exaggerated, highly
readable, heavy, with anticipation and follow-through on every big action, and never floaty or
lagging the input. Any pose, timing or blend that looks lighter, floatier or slower than HD2 gets
reworked. The rules below are enforced by tests wherever they can be measured.

## Ground rules

1. **The sim owns time.** Every timing that matters is read from the simulation, never from a free-running
   animation clock:
   - stance transitions (`stanceT`), dive (`dive.t`), slide (`slide.t`) and mantle progress;
   - get-up phases (`knock.t`), and a thrown body's pose, which is the ragdoll's own particles;
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
| get-up (after a ragdoll comes to rest) | lying (front/back) → push-up or sit-up → kneel → stand | rustle |

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
| **Thrown** | Blasts, critical hits, downs and deaths throw the body as a physics ragdoll (see [Ragdolls and downs](#ragdolls-and-downs)). Where it lands is where you are: it gets up front or back from however it came to rest, starts the downed crawl, or stays as a corpse. |
| **Evades** | Melee classes' flameStep/ashStep: a low leap along the dash with the chest on the aim. Shoulder bash: running steps with the shoulder leading. |
| **Seated** | Bike riders: hands on the bars for drivers; gunners and passengers aim. |
| **Death** | A ragdoll collapse, pushed gently the way the killing shot went. (A body without a ragdoll falls back on an authored collapse to the lying pose.) |

**Crossfades:** each state fades in over `[seconds, curve]` from `blend.fade`:
- `out` (ease-out) for commits that must read instantly: dive, mantle, evades.
- `smooth` for drops, get-ups, the downed crawl and recoveries, so nothing front-loads a pop.
- `in` for the authored death collapse.

Ragdolls blend separately (`blend.ragdollIn`, `blend.ragdollOut`, below).

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

## Ragdolls and downs

HD2 rule: an explosion throws a soldier as a full ragdoll, and where the body lands is where you
are. The ragdoll is **simulation** code (`src/physics/Ragdoll.js`), so the server and every client
throw the same body the same way. The rig only draws it.

**The body:**
- **Particles:** 16 particles sit at the rig's own joints: pelvis, chest, neck, head, hips, knees,
  ankles, shoulders, elbows and hands. Each has its own mass and collision radius.
- **Integration:** each tick is verlet integration followed by 12 position-based constraint passes.
  - **Bones** are rigid: spine, neck, hips, shoulders, thighs, shins, upper arms and forearms.
  - **Braces** are soft: the trunk's sides and diagonals, and the head on the shoulders. The trunk can
    twist a little but never folds flat.
  - **Limits** are one-sided:
    - knees and elbows hinge one way only;
    - hips don't hyperextend or cross;
    - limbs don't fold through each other or the trunk;
    - the head stays above the neck.
- **Collision:** the terrain heightfield and the cover boxes, with friction and no bounce. A body
  thrown into a wall stays against it, and one thrown into a trench lands on the floor.
- **Sleep:** it sleeps once every particle is slow and touching something for `sleepTime`, or after
  `maxTime`. Impulses wake it, so a later blast throws a body that's already lying there.
- **Cost and netcode:** an awake body costs a few µs per tick. A body serializes and restores
  exactly, which is what netcode needs.
- **Whole bodies:** no limb or body loss, by design. A soldier who survives the throw is downed or
  gets up with every limb attached.
- **Starting pose:** a body starts limp in exactly the shape it was animated in. The rig's joints
  for each stance (stand, crouch, prone, supine) are stored body-local in
  `data/movement.json` `ragdoll.poses`, and a test keeps them in sync with the rig.

**Muscles** (`src/physics/RagdollDrive.js`, tuning `ragdoll.drive`; NaturalMotion's Euphoria and
Red Dead Redemption 2 are the model): a body that goes limp isn't a sack. Each tick, before the
constraint passes, muscles pull joints toward targets set in the body's own frames. Every pull
acts between a joint and the joint it hangs from, so muscles bend the body but never fly it.
- **Dying** (Euphoria's shotRelax): the body keeps its shape for a moment and lets go legs first
  (`relax.lower` 0.3 s, `relax.upper` 0.75 s), one knee before the other. A shot man folds at the
  knees, drops and topples instead of falling like a plank. A killing head shot or a mangling hit
  is lights-out: no muscle at all, limp at once.
- **Going down alive** (catchFall): both hands reach for the ground ahead of the fall with the
  elbows braced, so the arms take the chest's weight, and the chin comes up. Going over backward,
  the hands go down low and wide beside the hips.
- **Thrown alive:** the arms windmill and the legs pedal while it's in the air.
- **On the ground, alive** (writhe): on the back, the knees draw up in turn. Then the muscles let go
  (`settle`) so the downed crawl or the get-up can take over.
- **Clutch:** the hand on the wound's side (the other hand for a wounded arm) goes to the wound at
  the hit, and back to it on the ground. A wound in the back, or one the body is lying on, is out
  of reach, so the hand doesn't try.
- The drive is plain deterministic arithmetic and serializes with the body.

**What throws a body** (all tuning in `data/movement.json` `ragdoll`):

| Trigger | Rule | Throw |
|---|---|---|
| Blast | Inside `blastRadiusFrac` (75%) of the radius; outside it you're only shoved. Prone soldiers resist. Mines too. | Away from the blast, with lift. |
| Critical hit | One hit taking `criticalFraction` (45%) of the pool (shield included), a headshot taking `headFraction` (40%), a clean heavy melee blow, or a vehicle ram. | Along the shot at `criticalSpeed` (3.5–8 m/s), harder the more of the pool it took. |
| Down or death | Any hit that downs or kills without a throw. | First a stumble along the shot (`stagger.die`: 0.3–0.6 s), then the knees go: the stumble carries into the fall, and the muscles fold a dying body or catch a downed one on its hands. A killing head shot or a mangling hit skips the stumble: limp at once, pushed along the shot (`collapseSpeed` 0.8–2.2 m/s). Burns, falls and crashes collapse the body without a push. |

**At rest** the movement controller (ragdoll mode: no control, the root rides the pelvis) reads
how the body lies:
- face down or face up, from the trunk's frame;
- a living soldier gets up front or back (the HD2 get-up, `knockdown.getUpTime`);
- a downed one starts crawling where it lies;
- a dead one stays as a corpse.

The hitboxes sit on the particles the whole time, so you shoot the body where it's drawn.

**The rig side** (`ProceduralHumanoid`):
- **Drawing:** a limp body is drawn straight from the particles, interpolated between ticks.
- **Blending in:** from the animated pose over `blend.ragdollIn` (0.1 s), carried with the body.
- **Blending out:** from where the body lay into whatever comes next (get-up, downed crawl) over
  `blend.ragdollOut` (0.35 s). Nothing pops in either direction.
- **Thuds:** a body hitting the ground hard emits `anim:impact` `ragdoll`, scaled by speed.

**Hit reactions** (`src/combat/HitReactions.js`, the movement controller's `stagger` mode, tuning
`data/movement.json` `stagger`):
- **Where it landed:** every hit is booked to a wound site: head, chest, gut, an arm or a leg, by
  side. It comes from the hit sphere and how far across the body the shot went in.
- **Rocked:** a hit taking a fifth of your pool, or a shove that doesn't throw you, stumbles you
  along it. The trunk is thrown with the push and the arms are flung out for balance, while the
  feet step after it. The gun is off target for the first 60%, and steering comes back over the
  last third. Rocked again before you've found your feet, you go over as a ragdoll.
- **Buckled:** a leg hit taking 15% drops you onto that knee for a moment. The hitboxes drop with
  you.
- **Injured** (revived, until a stim):
  - hunched, with the free hand pressed to a trunk wound while the gun's down;
  - a limp: the hips dip and the trunk swings off the wounded leg while it carries the weight.

**Downed** (`data/down.json`; rules in [FRONTLINE.md](FRONTLINE.md)):
- The soldier lies where the body came to rest, one hand pressed to the wound and the rifle slung.
- **Crawl or scoot:**
  - push toward where you look and you roll onto your belly and crawl that way, head first (0.45 m/s);
  - pull back and you roll onto your back and scoot away on your heels, feet still toward the
    threat (60% as fast).

  Rolling over takes `downed.rollTime` (0.6 s). The head stays where it lay while the body swings
  round.
- Breathing is heavy. No aim, no gun.
- A **reviver** kneels over the patient with both hands on their chest. The revive ends in the
  normal get-up, injured.

**Corpses** stay where they fell after the soldier redeploys: up to 96 bodies, for 90 s each.

## Event contract

| Event | Payload | Fired | Consumers |
|---|---|---|---|
| `anim:footstep` | `id, foot (0 L / 1 R), gait (walk/jog/sprint/crouch/crawl/shuffle/land), stance, intensity, surface, x, y, z, speed` | Heel strike (planted on that frame), crawl contacts, landings, transition plants | CameraRig bob (local player), AudioDirector foley, VFX dust |
| `anim:impact` | `id, kind (diveLand / slide / proneDrop / body / land / hands / ragdoll), intensity, surface, x, y, z` | When the body or hands visibly hit | Audio thud, camera (via `move:*`), VFX |
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
- **Ragdoll and down stations:**
  - `knock`: thrown by blasts from behind, then from the front.
  - `critical`: a heavy round from the side throws you, and you get up.
  - `downed`: collapse, wounded crawl, revived, get up.
  - `revive`: kneel over a downed squadmate until they get up.
  - `corpse`: killed by a blast, and the body stays where it fell.
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

The ragdoll has its own tests (`tests/ragdoll.test.mjs`):
- **Whole bodies:** blasts from any side keep the body whole and it comes to rest.
- **Throw direction:** thrown from behind it lands face down, from the front face up, and bigger
  blasts throw further.
- **Cover:** bodies collide with it.
- **Determinism:** a serialized body continues exactly.
- **Poses:** they match the rig's joints in each stance.
- **Hitboxes:** they stay on the body.
- **Trigger rules:** the blast radius rule, critical hits, collapses, corpses, and later blasts
  throwing bodies already lying there.

Downs and revives are covered in `tests/down.test.mjs`.

## Known gaps

- Feet align to the terrain's height (the `groundY` hook) but not to its slope angle yet.
- Ragdolls collide with the terrain and cover boxes, but not with each other or with vehicle hulls.
- Strafing is side-stepping with shorter strides, not a full 8-way blend.
- Graybox geometry: the CrowdRenderer draws boxes and limbs. Real characters go through ClipAnimationController.
