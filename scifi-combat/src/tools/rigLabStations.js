// Rig lab stations: scripted, looping input sequences, one per move. The rig lab page plays them
// side by side in slow motion (for calibrating against HD2 footage), and the animation tests run
// every station headless to check the contract (no foot sliding, IK always reaches).
//
// script(t, c, e, buddy) runs every sim tick with the loop time t. c.move(x, y), c.look(yaw, pitch),
// c.hold(key, on) and c.press(key) build the command. `boxes` are in station-local coordinates
// (x right, z forward = -z world), `start` is where the fighter spawns. A station can bring a
// `buddy` (a second fighter with its own start and script), e.g. the patient for the revive.

const between = (t, a, b) => t >= a && t < b;
/** The lab stubs damage out, so a scripted down sets Health's downed state directly (with time to show it). */
const labDown = (e) => Object.assign(e.health, { downed: true, hp: 0, bleed: 999, downHp: 999 });

export const STATIONS = [
  { id: 'idle', name: 'Idle, turn in place', length: 6, script(t, c) { c.look(t > 1.5 ? Math.sin((t - 1.5) * 1.1) * 1.7 : 0); } },
  {
    id: 'jog', name: 'Jog, stop, strafe, backpedal', length: 6.5,
    script(t, c) {
      if (between(t, 0.3, 1.9)) c.move(0, 1);
      else if (between(t, 2.5, 3.7)) c.move(1, 0);
      else if (between(t, 4.2, 5.6)) c.move(0, -1);
    },
  },
  {
    id: 'sprint', name: 'Sprint ramp, carve, skid', length: 6.5,
    script(t, c) {
      if (t < 4.6) { c.move(0, 1); c.hold('sprint', t > 0.3); }
      c.look(t < 2.6 ? 0 : Math.min(1.3, (t - 2.6) * 1.6));
    },
  },
  {
    id: 'pivot', name: 'Sprint reversal: plant and pivot', length: 5,
    script(t, c) {
      c.hold('sprint', t > 0.2 && t < 3.6);
      if (t < 2) c.move(0, 1); else if (t < 3.6) c.move(0, -1);
    },
  },
  {
    id: 'crouch', name: 'Crouch, crouch walk, stand', length: 5,
    script(t, c) {
      if (between(t, 0.3, 0.35)) c.press('crouch');
      if (between(t, 0.8, 2.8)) c.move(0, 1);
      if (between(t, 3.3, 3.35)) c.press('crouch');
    },
  },
  {
    id: 'prone', name: 'Stand → prone (hold crouch) → crawl → get up', length: 6.5,
    script(t, c) {
      c.hold('crouch', between(t, 0.2, 0.75));
      if (between(t, 1.6, 3.4)) c.move(0, 1);
      if (between(t, 3.4, 4.2)) c.look((t - 3.4) * 0.9);
      if (between(t, 4.6, 4.65)) c.press('jump');
    },
  },
  {
    id: 'slide', name: 'Sprint into the committed slide', length: 5,
    script(t, c) {
      if (t < 2.4) c.move(0, 1);
      c.hold('sprint', t > 0.2 && t < 2.0);
      if (between(t, 1.8, 1.85)) c.press('crouch');
      if (between(t, 2.0, 2.2)) c.move(-0.6, 1);
    },
  },
  {
    id: 'dive', name: 'Sprint dive → belly slide → fast get-up', length: 5,
    script(t, c) {
      if (t < 1.7) { c.move(0, 1); c.hold('sprint', t > 0.2); }
      if (between(t, 1.6, 1.65)) c.press('dodge');
      if (between(t, 3.3, 3.35)) c.press('jump');
    },
  },
  {
    id: 'diveBack', name: 'Back dive, shoot from the back', length: 5.5, mode: 'gun',
    script(t, c) {
      if (between(t, 0.6, 0.7)) { c.move(0, -1); c.press('dodge'); }
      c.hold('light', between(t, 1.4, 2.6));
      if (between(t, 3.4, 3.45)) c.press('jump');
    },
  },
  {
    id: 'diveSide', name: 'Side dive → roll to the belly', length: 5,
    script(t, c) {
      if (between(t, 0.6, 0.7)) { c.move(-1, 0); c.press('dodge'); }
      if (between(t, 3.0, 3.05)) c.press('jump');
    },
  },
  {
    id: 'vault', name: 'Vault at a run (momentum kept)', length: 4,
    boxes: [{ min: [-1.5, 0, -5.4], max: [1.5, 0.9, -5.0] }],
    script(t, c) { if (t < 2.8) { c.move(0, 1); c.hold('sprint', t > 0.2); c.hold('jump', t > 0.8); } },
  },
  {
    id: 'climb', name: 'Hold to climb a 1.9 m ledge', length: 4,
    boxes: [{ min: [-1.5, 0, -6], max: [1.5, 1.9, -2.2] }],
    script(t, c) { if (t < 2.6) { c.move(0, 1); c.hold('jump', t > 0.4); } },
  },
  {
    id: 'drop', name: 'Hop, then a 3 m drop (heavy landing)', length: 5,
    start: [0, 3, 0], boxes: [{ min: [-1.5, 0, -2.5], max: [1.5, 3, 1.5] }],
    script(t, c) {
      if (between(t, 0.5, 0.55)) c.press('jump');
      if (between(t, 1.5, 3.2)) c.move(0, 1);
    },
  },
  {
    id: 'knock', name: 'Explosions: thrown as a ragdoll from behind, then from the front', length: 7,
    script(t, c, e) {
      if (between(t, 0.8, 0.82) && !e._k1) { e._k1 = true; e.movement.impulse(0, 3.5, 9, { cause: 'explosion' }); }
      if (between(t, 4.0, 4.02) && !e._k2) { e._k2 = true; e.movement.impulse(0, 3.5, -9, { cause: 'explosion' }); }
    },
  },
  {
    id: 'critical', name: 'Critical hit: a heavy round from the side throws you, you get up', length: 5.5, mode: 'gun',
    script(t, c, e) {
      if (between(t, 0.8, 0.82) && !e._k1) {
        e._k1 = true;
        const p = e.movement.state.position;
        e.movement.startRagdoll(-6.5, 1.2, 0, { at: { x: p.x + 0.2, y: p.y + 1.35, z: p.z }, focus: 0.6, cause: 'critical' });
      }
    },
  },
  {
    id: 'downed', name: 'Downed: collapse, wounded crawl, revived, get up', length: 9, mode: 'gun',
    script(t, c, e) {
      if (between(t, 0.6, 0.62) && !e._k1) { e._k1 = true; labDown(e); e.movement.startRagdoll(0, 0.3, 1.8, { cause: 'downed' }); }
      if (between(t, 3.4, 6.2)) { c.move(0, 1); c.look(0.5 * Math.sin(t * 0.8)); }
      if (between(t, 7.0, 7.02) && !e._k2) { e._k2 = true; e.health.downed = false; e.movement.getUpFromDown(); }
    },
  },
  {
    id: 'revive', name: 'Revive: kneel over a downed squadmate until they get up', length: 8.5, mode: 'gun',
    buddy: {
      start: [0.4, 0, -3.4],
      script(t, c, b) { if (between(t, 0.3, 0.32) && !b._k1) { b._k1 = true; labDown(b); b.movement.startRagdoll(0.4, 0.2, -1.4, { cause: 'downed' }); } },
    },
    script(t, c, e, buddy) {
      const bp = buddy.movement.state.position, p = e.movement.state.position;
      const d = Math.hypot(bp.x - p.x, bp.z - p.z);
      if (t > 1.6) c.look(Math.atan2(-(bp.x - p.x), -(bp.z - p.z)));
      if (!between(t, 1.8, 8)) return;
      if (d > 1.15 && !e.reviveJob) { c.move(0, 1); return; }
      if (!buddy.health.downed) return;
      e.reviveJob ??= { patient: buddy, t: 0, need: 3 };
      e.movement.kneel();
      if ((e.reviveJob.t += 1 / 60) >= e.reviveJob.need) { e.reviveJob = null; buddy.health.downed = false; buddy.movement.getUpFromDown(); }
    },
  },
  {
    id: 'corpse', name: 'Killed by a blast: the body stays where it fell', length: 5,
    script(t, c, e) {
      if (between(t, 0.8, 0.82) && !e._k1) {
        e._k1 = true; e.health.dead = true;
        const p = e.movement.state.position;
        e.movement.impulse(-7, 4, 3, { cause: 'explosion', ragdoll: true, at: { x: p.x + 1, y: p.y, z: p.z - 0.5 } });
      }
    },
  },
  {
    id: 'rifle', name: 'Rifle: ADS, fire, reload, sprint-to-fire', length: 7, mode: 'gun',
    script(t, c) {
      c.hold('guard', between(t, 0.6, 2.4));
      c.hold('light', between(t, 1.0, 2.2) || between(t, 5.6, 6.4));
      if (between(t, 2.8, 2.85)) c.press('reload');
      if (between(t, 4.2, 5.5)) { c.move(0, 1); c.hold('sprint', true); }
      c.look(0, between(t, 0.6, 2.4) ? 0.15 : 0);
    },
  },
  {
    id: 'sword', name: 'Flame sword: combo, heavy, guard', length: 6, mode: 'sword', classId: 'dawnblade',
    script(t, c) {
      for (const at of [0.4, 0.75, 1.15]) if (between(t, at, at + 0.05)) c.press('light');
      c.hold('heavy', between(t, 2.4, 2.5));
      c.hold('guard', between(t, 4.0, 5.2));
    },
  },
];

/** Builds commands for a station from its script, with clean button edges. */
export class StationDriver {
  constructor(station) { this.station = station; this.t = 0; this.prev = new Set(); }
  command(e, dt, buddy = null) {
    const held = new Set(), pressed = new Set();
    const cmd = { moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: {} };
    const c = {
      move: (x, y) => { cmd.moveX = x; cmd.moveY = y; },
      look: (yaw, pitch = 0) => { cmd.yaw = yaw; cmd.pitch = pitch; },
      hold: (k, on = true) => { if (on) held.add(k); },
      press: (k) => pressed.add(k),
    };
    this.station.script(this.t, c, e, buddy);
    this.t += dt;
    const down = new Set([...held, ...pressed]);
    for (const k of new Set([...down, ...this.prev])) cmd.buttons[k] = { down: down.has(k), pressed: down.has(k) && !this.prev.has(k), released: !down.has(k) && this.prev.has(k) };
    this.prev = down; // a press window of a few ticks is one press (rising edge) and a short hold
    return cmd;
  }
  get done() { return this.t >= this.station.length; }
}

/** The buddy's own driver (same loop length as its station). */
export function buddyDriver(station) { return station.buddy ? new StationDriver({ length: station.length, script: station.buddy.script }) : null; }
