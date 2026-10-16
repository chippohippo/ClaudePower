// Client-side prediction + server reconciliation for the local player.
//
// Every tick: sample Command → apply locally → store {tick, cmd} → send to server.
// On authoritative snapshot {ackTick, state}: restore state, drop acked commands,
// replay the rest. Visual error is smoothed so corrections never "snap" the camera.

export class Prediction {
  constructor(controller, { bufferSize = 128, epsilon = 0.05 } = {}) {
    this.ctl = controller;          // anything with update(cmd, dt), serialize(), restore()
    this.pending = [];              // unacknowledged commands, oldest first
    this.bufferSize = bufferSize;
    this.epsilon = epsilon;
    this.visualError = { x: 0, y: 0, z: 0 }; // added to render position, decays to 0
  }

  applyLocal(cmd, dt) {
    this.ctl.update(cmd, dt);
    this.pending.push({ cmd, dt, predicted: this.ctl.state.position.clone() });
    if (this.pending.length > this.bufferSize) this.pending.shift();
  }

  onServerState(ackTick, snap) {
    // Drop everything the server has already processed.
    let predictedAtAck = null;
    while (this.pending.length && this.pending[0].cmd.tick <= ackTick) predictedAtAck = this.pending.shift().predicted;
    if (!predictedAtAck) return;

    const [sx, sy, sz] = snap.p;
    const err = Math.hypot(sx - predictedAtAck.x, sy - predictedAtAck.y, sz - predictedAtAck.z);
    if (err < this.epsilon) return; // prediction was right; nothing to do

    const before = this.ctl.state.position.clone();
    this.ctl.restore(snap);
    for (const p of this.pending) { this.ctl.update(p.cmd, p.dt); p.predicted = this.ctl.state.position.clone(); }
    const after = this.ctl.state.position;
    // Keep the *rendered* position where it was, then bleed the difference out over ~100 ms.
    this.visualError.x += before.x - after.x;
    this.visualError.y += before.y - after.y;
    this.visualError.z += before.z - after.z;
  }

  decayVisualError(dt) {
    const k = Math.exp(-dt * 20);
    this.visualError.x *= k; this.visualError.y *= k; this.visualError.z *= k;
  }
}

/** Snapshot interpolation for remote entities: render ~100 ms in the past. */
export class Interpolator {
  constructor(delay = 0.1) { this.delay = delay; this.buf = []; }
  push(time, state) { this.buf.push({ time, state }); if (this.buf.length > 32) this.buf.shift(); }
  sample(now, out) {
    const t = now - this.delay;
    const b = this.buf;
    for (let i = b.length - 1; i > 0; i--) {
      if (b[i - 1].time <= t) {
        const a = b[i - 1], c = b[i];
        const u = Math.min(1, (t - a.time) / Math.max(1e-6, c.time - a.time));
        for (let k = 0; k < 3; k++) out.p[k] = a.state.p[k] + (c.state.p[k] - a.state.p[k]) * u;
        out.yaw = lerpAngle(a.state.yaw, c.state.yaw, u);
        return out;
      }
    }
    return b.length ? Object.assign(out, b[b.length - 1].state) : out;
  }
}

const lerpAngle = (a, b, t) => a + ((((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) * t;
