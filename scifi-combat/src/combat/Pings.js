// Pings: marking things for your side without a word (Apex Legends' ping, Battlefield's spotting;
// docs/FRONTLINE.md, "Pings"). Sim only, one per world (world.pings).
//
//  * A soldier pings a kind of thing at a place: `enemy` (a soldier, vehicle or gun of theirs),
//    `move` (go there), `attack` or `defend` (a capture point), `danger`, `regroup` (on me), `medic`
//    or `ammo` (I need one).
//  * What each does:
//      - enemy: he's revealed to the whole side for 6 s (a spotter's mark: on everyone's HUD and
//        minimap, the pinger paid for the spot if someone else takes him down), the side's intel
//        has him (the commander, the guns), and the pinger's squad turns on him.
//      - move, attack, defend: the squad a person leads goes there and takes cover round it,
//        facing the enemy (on a point, inside its circle), for 45 s or until regroup. A new one
//        replaces his last.
//      - regroup: his squad back on him.
//      - medic, ammo: the nearest medic (or engineer, for ammo) of the side within 60 m comes over
//        and uses his stim (or drops a pack) on him.
//      - danger: a warning for the side, nothing more.
//  * Each lasts a while (PING) and nobody can spam: three in 1.5 s at most.
//  * Bots ping too: a squad's "Contact!" marks that enemy for its side (one a squad every 6 s),
//    so a person sees what his side's soldiers see.
// Events: ping:add { id, team, by, kind, at: [x, y, z], target, label, until }, ping:remove { id }.

import { bus } from '../core/EventBus.js';

/** Each kind: how long it stays up, its label. */
export const PING = {
  enemy:   { life: 8,  label: 'ENEMY' },
  move:    { life: 20, label: 'MOVE HERE' },
  attack:  { life: 20, label: 'ATTACK' },
  defend:  { life: 20, label: 'DEFEND' },
  danger:  { life: 12, label: 'DANGER' },
  regroup: { life: 6,  label: 'REGROUP ON ME' },
  medic:   { life: 12, label: 'NEED A MEDIC' },
  ammo:    { life: 12, label: 'NEED AMMO' },
};
const ORDERS = new Set(['move', 'attack', 'defend']);
const REVEAL = 6;            // s an enemy ping reveals him
const BURST = 3, WINDOW = 1.5;
const CALLOUT_GAP = 6;       // s between a squad's callout pings
const HELP_RANGE = 60;       // m a medic or engineer comes from
const HELP_FOR = 15;         // s he keeps coming

export class Pings {
  /** @param {object} world CombatWorld (entities, fighters, intel, status) */
  constructor(world) {
    this.world = world;
    this.list = [];
    this.time = 0; this.seq = 1;
    this.sent = new Map();       // soldier id -> recent ping times
    this.callouts = new Map();   // squad -> last callout ping time
    this.off = [bus.on('squad:bark', (e) => this.#callout(e))];
  }

  dispose() { this.off.forEach((f) => f()); }

  update(dt) {
    this.time += dt;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      const gone = this.time >= p.until || (p.target && (p.target.health?.dead || p.target.removed));
      if (gone) { this.list.splice(i, 1); bus.emit('ping:remove', { id: p.id }); }
    }
  }

  /** The pings up for `team`. */
  of(team) { return this.list.filter((p) => p.team === team); }

  /**
   * `by` pings `kind` at `at` ({ x, y, z }) or on `target` (an entity), or on capture point `point`.
   * Returns the ping, or null (too many too fast, or nothing there to ping).
   */
  ping(by, kind, { at = null, target = null, point = null } = {}) {
    const K = PING[kind];
    if (!K || !by || by.health?.dead) return null;
    const recent = (this.sent.get(by.id) ?? []).filter((t) => this.time - t < WINDOW);
    if (recent.length >= BURST) return null;
    recent.push(this.time); this.sent.set(by.id, recent);
    const team = by.team, me = by.movement?.state.position;
    if (kind === 'enemy') {
      if (!target || target.team === team || target.health?.dead || !(target.team === 0 || target.team === 1)) return null;
      target.status?.apply('revealed', { duration: REVEAL, source: by });
      this.world.intel?.[team]?.spot(target, by.id);
      by.squad?.tactics?.mark?.(target);
    }
    const pos = target?.movement?.state.position ?? point?.pos ?? at ?? me;
    if (!pos) return null;
    if (ORDERS.has(kind) || kind === 'regroup') {
      // A new order replaces his last one.
      for (const q of this.list) if (q.by === by.id && (ORDERS.has(q.kind) || q.kind === 'regroup')) q.until = this.time;
      if (!by.brain) by.squad?.tactics?.send?.(kind === 'regroup' ? null : { kind, pos: { x: pos.x, z: pos.z }, point: point?.id ?? null, radius: point?.radius ?? 0 });
    }
    if (kind === 'medic' || kind === 'ammo') this.#help(by, kind);
    const p = {
      id: this.seq++, team, by: by.id, kind, at: [pos.x, pos.y ?? 0, pos.z], target: target ?? null, point: point?.id ?? null,
      label: kind === 'enemy' ? (target.isVehicle ? target.def?.name ?? 'VEHICLE' : target.name ?? 'ENEMY') : point && ORDERS.has(kind) ? `${K.label} ${point.name}` : K.label,
      t: this.time, until: this.time + K.life,
    };
    this.list.push(p);
    bus.emit('ping:add', { id: p.id, team, by: p.by, kind, at: p.at, target: target?.id ?? null, point: p.point, label: p.label, until: p.until });
    return p;
  }

  /** "Need a medic" / "need ammo": the nearest bot of the side who has the item comes over. */
  #help(by, kind) {
    const role = kind === 'medic' ? 'stim' : 'ammo', me = by.movement.state.position;
    let best = null, bd = HELP_RANGE;
    this.world.fightersNear(me, HELP_RANGE, (f) => {
      if (f === by || f.team !== by.team || !f.brain || !f.health?.up || f.vehicle || f.items?.kind !== role || f.items.left <= 0) return;
      const d = f.movement.state.position.distanceTo(me);
      if (d < bd) { bd = d; best = f; }
    });
    if (!best) return null;
    best.helpFor = { who: by, kind, until: this.time + HELP_FOR };
    this.world.barks?.say(best, 'ack');
    return best;
  }

  /** A squad's contact callout marks the enemy it saw (bots' pings). */
  #callout(e) {
    if (e.kind !== 'contact' || e.id == null) return;
    const f = this.world.entity(e.id), sq = f?.squad;
    if (!f || !sq || this.time - (this.callouts.get(sq) ?? -1e9) < CALLOUT_GAP) return;
    const t = f.brain?.target;
    if (!t || t.health?.dead || t.team === f.team || !(t.team === 0 || t.team === 1)) return;
    this.callouts.set(sq, this.time);
    this.ping(f, 'enemy', { target: t });
  }
}
