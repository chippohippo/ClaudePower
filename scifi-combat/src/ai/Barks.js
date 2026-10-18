// Barks: soldiers talking (docs/GAMEPLAY_PLAN.md §6; The Last of Us Part II: you hear their plan).
// Sim only, one per world (world.barks): callouts as events the client voices and subtitles.
//
//  * Every soldier has a name from his army's list (data/ai/barks.json `names`), and his squad
//    uses it: "Man down! Kael's down!", "Watch your fire, Vex!".
//  * Lines are data (per kind, per army, a few variants with {name}, {dir}, {place} slots), picked
//    with a seeded roll so a replay says the same things.
//  * Bots speak; people don't (the player has a voice of his own). A soldier waits `gap` s
//    between any two lines and `same` s before repeating a kind; a squad doesn't repeat a kind
//    within `squad` s: one "Contact!" for the four of them, not four.
//  * What makes them talk: here, the sim's own events (reloading under fire, a squadmate down,
//    a revive starting, a teammate's rounds in you, a kill, a call-in thrown); elsewhere, the
//    brain (contact and its direction, a grenade or strike coming, searching, contact lost) and
//    the squad leader (moving and covering, flanking and suppressing, falling back) call say().
// Event: squad:bark { id, team, squad, kind, text, name, at: [x, y, z] }.

import { CIVILIAN } from '../combat/Teams.js';
import { bus } from '../core/EventBus.js';

const ARMY = ['solari', 'void'];
const SLOTS = { name: 'him', dir: 'front', place: 'the objective', why: 'engaged', n: 'no' };
/** A line with its slots filled ({name}, {dir}, {place}, {why}, {n}). */
const fill = (line, vars) => line.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? SLOTS[k] ?? ''));

export class Barks {
  /** @param {object} world CombatWorld @param {object} data data/ai/barks.json */
  constructor(world, data = null, { seed = 1 } = {}) {
    this.world = world; this.data = data;
    this.time = 0;
    this.seed = (seed * 2654435761) >>> 0 || 1;
    this.mine = new Map();        // soldier id -> { at, kinds: Map(kind -> t) }
    this.squads = new Map();      // squad -> Map(kind -> t)
    this.named = [0, 0, 0, 0];    // names handed out per team (the armies, civilians, bandits)
    if (!data) { this.off = []; return; }
    this.off = [
      bus.on('weapon:reloadStart', (e) => { const f = this.#bot(e.id); if (f && (f.brain.nbr?.enemiesNear > 0 || f.health.sinceDamage < 3)) this.say(f, 'reloading'); }),
      bus.on('entity:downed', (e) => this.#downed(e)),
      bus.on('revive:start', (e) => { const f = this.#bot(e.id), p = this.world.entity(e.patient); if (f && p) this.say(f, 'revive', { name: p.name }); }),
      bus.on('weapon:hit', (e) => { if (!e.friendly) return; const f = this.#bot(e.victim), by = this.world.entity(e.attacker); if (f && by && by !== f) this.say(f, 'checkfire', { name: by.name }); }),
      bus.on('entity:death', (e) => { const f = this.#bot(e.by), v = this.world.entity(e.id); if (f && v && v.team !== f.team && v.team !== CIVILIAN && !v.isVehicle && !v.isDeployable && this.#roll() < 0.35) this.say(f, 'kill'); }),
      bus.on('stratagem:thrown', (e) => { const f = this.#bot(e.id), def = this.world.stratagems?.defs[e.stratagem]; if (f && def) { if (def.kind === 'strike') this.say(f, 'strike'); else if (def.kind === 'supply') this.say(f, 'supply'); } }),
    ];
  }

  dispose() { this.off.forEach((f) => f()); }
  update(dt) { this.time += dt; }

  /** A name for a soldier from his army's list (the second time round a list, numbered). */
  name(e) {
    const list = this.data?.names?.[e.faction ?? ARMY[e.team]] ?? [];
    if (!list.length) return null;
    const i = this.named[e.team]++, n = list.length;
    return list[i % n] + (i >= n ? ` ${Math.floor(i / n) + 1}` : '');
  }

  /**
   * A soldier says a line of `kind` if his cooldowns and his squad's allow it. `vars`: { name, dir }.
   * Returns the line said, or null.
   */
  say(e, kind, vars = {}) {
    const D = this.data;
    if (!D || !e?.brain || e.health?.dead || !e.health?.up && kind !== 'medic') return null;
    const lines = D.lines[kind]?.[e.faction ?? ARMY[e.team]];
    if (!lines?.length) return null;
    const me = this.mine.get(e.id) ?? { at: -1e9, kinds: new Map() };
    if (this.time - me.at < D.gap || this.time - (me.kinds.get(kind) ?? -1e9) < D.same) return null;
    const sq = e.squad, ks = sq ? this.squads.get(sq) ?? new Map() : null;
    if (ks && this.time - (ks.get(kind) ?? -1e9) < D.squad) return null;
    me.at = this.time; me.kinds.set(kind, this.time); this.mine.set(e.id, me);
    if (ks) { ks.set(kind, this.time); this.squads.set(sq, ks); }
    const text = fill(lines[Math.floor(this.#roll() * lines.length)], vars);
    const p = e.movement.state.position;
    bus.emit('squad:bark', { id: e.id, team: e.team, squad: sq?.id ?? null, kind, text, name: e.name ?? null, at: [p.x, p.y + 1.6, p.z] });
    return text;
  }

  /** A line of `kind` as soldier e would say it, cooldowns or not (the commander's radio log); null if there's none. */
  line(e, kind, vars = {}) {
    const lines = this.data?.lines[kind]?.[e?.faction ?? ARMY[e?.team]];
    if (!lines?.length) return null;
    return fill(lines[Math.floor(this.#roll() * lines.length)], vars);
  }

  /** "Contact left!": where `target` is from `e`, by his facing. */
  contact(e, target) {
    const p = e.movement.state.position, q = target.movement?.state.position ?? target.pos;
    if (!q) return null;
    return this.say(e, 'contact', { dir: this.dir(e, q.x - p.x, q.z - p.z) });
  }

  /** front, left, right or behind, for a vector on the ground from a soldier. */
  dir(e, dx, dz) {
    const y = e.movement.state.yaw, f = -Math.sin(y) * dx - Math.cos(y) * dz, r = Math.cos(y) * dx - Math.sin(y) * dz;
    return f >= Math.abs(r) ? 'front' : -f >= Math.abs(r) ? 'behind' : r > 0 ? 'right' : 'left';
  }

  /** A soldier down: he calls for a medic, the nearest squadmate calls it out. */
  #downed(ev) {
    const v = this.world.entity(ev.id);
    if (!v || v.isVehicle || v.isDeployable) return;
    if (v.brain) this.say(v, 'medic');
    const p = v.movement.state.position;
    let best = null, bd = 30;
    for (const m of v.squad?.members ?? []) {
      if (m === v || !m.brain || !m.health.up) continue;
      const d = m.movement.state.position.distanceTo(p);
      if (d < bd) { bd = d; best = m; }
    }
    if (best) this.say(best, 'down', { name: v.name });
  }

  #bot(id) { if (id == null) return null; const e = this.world.entity(id); return e?.brain ? e : null; }

  #roll() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
}
