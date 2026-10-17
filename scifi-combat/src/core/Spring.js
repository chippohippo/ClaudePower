// Damped spring, integrated semi-implicitly with sub-steps so stiff springs stay stable through
// frame hitches. Used for every "weight" curve in presentation: camera follow, bob, pose blends.
export class Spring {
  constructor(omega, zeta = 1, value = 0) { this.w = omega; this.z = zeta; this.x = value; this.v = 0; }
  step(target, dt) {
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = this.w * this.w * (target - this.x) - 2 * this.z * this.w * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  /** Add velocity (an impulse): footfall thuds, recoil kicks, landing compression. */
  kick(dv) { this.v += dv; return this; }
  set(x) { this.x = x; this.v = 0; return this; }
}
