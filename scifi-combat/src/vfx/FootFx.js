// FootFx: what feet and bodies kick up off the ground. Presentation only: it reads the animation
// rig's foley events (anim:footstep, anim:impact) and puts soft puffs in BattleFx's dust pool.
//  * Footsteps: a little dust where a foot comes down, more the harder it lands: a puff walking, two
//    running, three sprinting thrown back behind the runner (his own speed), next to none crouched.
//  * A body meeting the ground: a ring of dirt rolling out from it, its size by how hard it hit (a
//    heavy landing off a height, a dive coming down on its belly, a drop to prone, a knockdown, a
//    ragdoll's trunk thumping down, a dead man falling), a smaller kick off the hands on a vault.
//  * By surface: snow powder (white, where the planet has snow), dust on dirt and sand, grey grit on
//    concrete and asphalt; nothing off metal, wood or water.
// Near the camera only (the rig only emits foley up close anyway), and kept light: a few particles
// a step.

import { bus } from '../core/EventBus.js';

const SNOW = [0.9, 0.91, 0.96, 0.5], SNOW_END = [0.95, 0.96, 1, 0];
const DIRT = [0.5, 0.43, 0.33, 0.42], DIRT_END = [0.58, 0.52, 0.44, 0];
const GRIT = [0.56, 0.55, 0.53, 0.34], GRIT_END = [0.64, 0.63, 0.61, 0];
const FAR = 60;                 // m from the camera past which nothing is kicked up
const NONE = new Set(['metal', 'vehicle', 'wood', 'timber', 'glass', 'water', 'flesh', 'hardlight', 'dome']);   // (surfaces as CombatWorld.surfaceAt names them)
/** The rig's impacts: how big a ring each throws (× its intensity). */
const RING = { land: 1, diveLand: 1.15, proneDrop: 0.7, body: 1.1, ragdoll: 0.9, slide: 0.55, hands: 0.3 };

export class FootFx {
  /**
   * @param {object} o { fx: BattleFx, world (velocities), camera: () => THREE.Camera, snow: the planet has snow }
   */
  constructor({ fx, world, camera, snow = false }) {
    this.fx = fx; this.world = world; this.camera = camera; this.snow = snow;
    let s = 0x2545f491;
    this.rand = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
    this.off = [
      bus.on('anim:footstep', (e) => this.step(e)),
      bus.on('anim:impact', (e) => this.impact(e)),
    ];
  }

  dispose() { this.off.forEach((f) => f()); }

  /** The colour a surface puts up (null: nothing). */
  #look(surface) {
    if (NONE.has(surface)) return null;
    if (surface === 'snow' || (this.snow && surface !== 'mud')) return [SNOW, SNOW_END];
    if (surface === 'concrete' || surface === 'asphalt' || surface === 'stone' || surface === 'rubble') return [GRIT, GRIT_END];
    return [DIRT, DIRT_END];
  }

  #near(x, z) { const c = this.camera?.()?.position; return !c || Math.hypot(c.x - x, c.z - z) < FAR; }

  step(e) {
    const look = this.#look(e.surface);
    if (!look || !this.#near(e.x, e.z)) return;
    const R = this.rand, D = this.fx.dust;
    const g = e.gait, k = Math.min(1.4, e.intensity ?? 1);
    const n = g === 'sprint' ? 3 : g === 'land' ? 6 : g === 'run' ? 2 : g === 'crouch' || g === 'shuffle' ? (R() < 0.35 ? 1 : 0) : 1;
    const size = (g === 'sprint' ? 1.15 : g === 'land' ? 1.4 : g === 'run' ? 0.9 : 0.65) * (0.7 + 0.3 * k);
    // Thrown back behind a runner: his own velocity, reversed.
    const v = this.world?.entity?.(e.id)?.movement?.state.velocity;
    const bx = v ? -v.x * 0.12 : 0, bz = v ? -v.z * 0.12 : 0;
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, out = g === 'land' ? 1.2 + R() * 0.8 : 0.25 + R() * 0.35;
      D.add(e.x + (R() - 0.5) * 0.25, e.y + 0.06, e.z + (R() - 0.5) * 0.25,
        bx + Math.cos(a) * out, 0.25 + R() * 0.45 * k, bz + Math.sin(a) * out,
        0.55 + R() * 0.5 + (g === 'land' ? 0.4 : 0), 0.12 * size, (0.55 + R() * 0.35) * size, look[0], look[1], 2.2, -0.05);
    }
  }

  impact(e) {
    const ring = RING[e.kind];
    if (!ring || !this.#near(e.x, e.z)) return;
    const look = this.#look(e.surface);
    if (!look) return;
    const R = this.rand, D = this.fx.dust, k = ring * Math.min(1.3, Math.max(0.3, e.intensity ?? 1));
    const n = Math.round(4 + 8 * k);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + R() * 0.5, sp = (1.2 + R() * 1.6) * (0.6 + 0.6 * k);
      D.add(e.x + Math.cos(a) * 0.35, e.y + 0.08 + R() * 0.15, e.z + Math.sin(a) * 0.35,
        Math.cos(a) * sp, 0.3 + R() * 0.7 * k, Math.sin(a) * sp,
        0.8 + R() * 0.7 * (0.5 + k), 0.2 * (0.6 + k), (0.9 + R() * 0.6) * (0.6 + k), look[0], look[1], 2.8, -0.08);
    }
    // A hard landing also throws a little up in the middle.
    if (k > 0.7) for (let i = 0; i < 3; i++) D.add(e.x + (R() - 0.5) * 0.4, e.y + 0.2, e.z + (R() - 0.5) * 0.4, (R() - 0.5) * 0.6, 0.9 + R() * 0.8, (R() - 0.5) * 0.6, 1 + R() * 0.6, 0.3, 1.4 * k, look[0], look[1], 1.6, -0.1);
  }
}
