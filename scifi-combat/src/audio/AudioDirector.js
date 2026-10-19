// AudioDirector: turns sim events into sound (SoundEngine plays them, SoundBank designs them).
// Presentation only.
//
// What it's for: a battle you can hear, and that scares you.
//  * Every gun its own voice (SoundBank.weaponDesign: kinetic slug throwers, Solari hard-light
//    lasers, Void plasma), its near and far versions blended by distance, arriving late from far
//    away (343 m/s), muffled behind walls. Your own gun is the loudest and closest thing you hear.
//  * Fear: rounds that pass you crack (supersonic) or buzz by (bolts), rounds landing around you
//    chip concrete and ping off metal, hits on you slam into your armor or ring off your shield,
//    a blast close by leaves the world dull and your ears ringing (SoundEngine.shock), low health
//    dulls it and your heart thumps.
//  * Readability: enemy shots sit a little louder than your side's; an enemy super announces
//    itself; an enemy's unblockable swing growls; the other side's whistle is rougher than yours.
//  * Foley from the animation rig (footsteps by surface, snow crunching in the city, gear rattling
//    at a sprint, bodies hitting the ground), weapon handling (mags, bolts, pumps, vents), engines
//    by vehicle and speed, wrecks burning, melee, call-ins, abilities by signature and army.

import { bus } from '../core/EventBus.js';
import { weaponDesign, abilityId, catalogue } from './SoundBank.js';
import { Ambience } from './Ambience.js';

const _p = { x: 0, y: 0, z: 0 };
const vec = (a) => (a ? (Array.isArray(a) ? { x: a[0], y: a[1], z: a[2] } : a) : null);
/** The surface a footstep or a round meets, as the bank names them. */
const SURFACE = { metal: 'metal', vehicle: 'vehicle', wood: 'wood', timber: 'wood', dirt: 'dirt', mud: 'dirt', sandbag: 'dirt', sand: 'dirt', concrete: 'concrete', stone: 'concrete', asphalt: 'concrete', glass: 'concrete', snow: 'snow', flesh: 'flesh', hardlight: 'energy', dome: 'energy' };

export class AudioDirector {
  /**
   * @param {SoundEngine} engine
   * @param {object} o { listenerId, getEntity(id) -> { team, position, perks, weapon (spec), shield, hpFrac, speed },
   *                     abilityIndex, guns (FieldGuns: rounds in the air), strats (StratagemSystem: beacons),
   *                     snow (the ground is snow: the city at dusk), environment (the map's atmosphere:
   *                     'trench' | 'city' | 'night'; Ambience), onSuperWarning, onNearMiss(k) }
   */
  constructor(engine, { listenerId, getEntity, abilityIndex = new Map(), guns = null, strats = null, snow = false, environment = 'city', onSuperWarning = () => {}, onNearMiss = () => {} } = {}) {
    this.engine = engine;
    this.listenerId = listenerId;
    this.getEntity = getEntity;
    this.abilityIndex = abilityIndex;
    this.guns = guns; this.strats = strats;
    this.snow = snow; this.environment = environment;
    this.onSuperWarning = onSuperWarning; this.onNearMiss = onNearMiss;
    this.time = 0;
    this.head = { x: 0, y: 0, z: 0 };
    this.lastShot = new Map();          // shooter -> time (far rapid fire thinned)
    this.lastBrass = -1;                // the last casing that rang (an SMG drops fifteen a second)
    this.projectiles = new Set();       // bolts in flight (a near pass buzzes)
    this.beeps = new WeakMap(); this.whistled = new WeakSet();
    this.charging = new Map();
    this.salvo = new Map();             // a rocket battery -> rockets it's fired (one roar in three)
    this.vehicles = new Map();          // vehicle id -> its engine loop's model
    this.ambience = new Ambience(engine, environment);
    this.off = [];
    this.#wire();
    // The sounds: your own guns first, then every gun's near and far voice, then the rest.
    const own = (getEntity(listenerId)?.loadout ?? []).map((s) => weaponDesign(s)).filter(([k]) => k !== 'beam').map(([k, p]) => `${k}:${p}:1p`);
    const all = catalogue();
    engine.prefetch([...own, ...all.filter((id) => /:(near|far)$/.test(id)), ...all]);
  }

  dispose() { this.off.forEach((f) => f()); this.ambience.dispose(); for (const k of [...this.engine.loops.keys()]) this.engine.stopLoop(k, 0.05); }

  relation(id) {
    if (id === this.listenerId) return 'self';
    const me = this.getEntity(this.listenerId), them = this.getEntity(id);
    return me && them && me.team === them.team ? 'ally' : 'enemy';
  }
  posOf(id) { return this.getEntity(id)?.position ?? null; }
  #army(id) { return this.getEntity(id)?.team === 1 ? 'void' : 'sol'; }
  #dist(p) { return p ? Math.hypot(p.x - this.head.x, p.y - this.head.y, p.z - this.head.z) : 0; }

  // ---------------------------------------------------------------- per frame
  update(dt, listenerPos, listenerYaw) {
    this.time += dt;
    const E = this.engine;
    if (listenerPos) { this.head.x = listenerPos.x; this.head.y = listenerPos.y + 1.6; this.head.z = listenerPos.z; }
    E.setListener(this.head, listenerYaw);
    if (!E.running) return;
    this.ambience.update(dt);
    // Incoming: a round about to land near you whistles down to it.
    const G = this.guns, L = this.head;
    if (G?.incoming.length) {
      for (const r of G.incoming) {
        if (r.kind === 'pod') continue;
        const left = r.at - G.time;
        if (left > 2.8 || left < 0.25 || this.whistled.has(r) || Math.hypot(r.x - L.x, r.z - L.z) > 75) continue;
        this.whistled.add(r);
        E.play('incoming', { pos: { x: r.x, y: r.y + 8, z: r.z }, kind: 'incoming', offset: 3 - left, gain: 0.8, delay: false, jitter: 0, hero: true });
      }
    }
    // A planted beacon near you beeps, faster as its payload nears.
    const SB = this.strats;
    if (SB?.beacons.length) {
      for (const b of SB.beacons) {
        if (!b.planted || (b.pos.x - L.x) ** 2 + (b.pos.z - L.z) ** 2 > 45 * 45) continue;
        const delay = b.def.delay ?? 0, eta = delay - (SB.time - b.at);
        if (eta <= 0 || this.time < (this.beeps.get(b) ?? 0)) continue;
        this.beeps.set(b, this.time + 0.16 + (0.6 * eta) / Math.max(1, delay));
        E.play('ui:beep', { pos: { x: b.pos.x, y: b.pos.y + 0.3, z: b.pos.z }, kind: 'impact', gain: 0.45 });
      }
    }
    // Bolts in flight: one passing close buzzes by (and makes you flinch).
    for (const p of this.projectiles) {
      if (!p.alive || p.removed) { this.projectiles.delete(p); continue; }
      const d = Math.hypot(p.pos.x - L.x, p.pos.y - L.y, p.pos.z - L.z);
      if (d < (p.audioMin ?? Infinity)) p.audioMin = d;
      else if (p.audioMin < 3.2 && !p.audioPassed) {
        p.audioPassed = true;
        E.play(`whizz:${p.team === 1 ? 'void' : 'sol'}`, { pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z }, kind: 'near', gain: 0.7 * (1 - p.audioMin / 4), delay: false, hero: true });
        this.onNearMiss(1 - p.audioMin / 3.2); E.suppress?.(1 - p.audioMin / 3.2);
      }
    }
    // Engines: each vehicle's loop follows it, its pitch with its speed.
    for (const [id, model] of this.vehicles) {
      const v = this.getEntity(id);
      if (!v) { E.stopLoop(`veh:${id}`); this.vehicles.delete(id); continue; }
      const sp = Math.min(1, (v.speed ?? 0) / 18);
      E.updateLoop(`veh:${id}`, { pos: v.position, rate: (model === 'flyer' ? 0.85 : 0.75) + sp * 0.55, gain: (0.35 + sp * 0.4) * 0.4 });
    }
    for (const [key] of E.loops) if (key.startsWith('beam:')) { const p = this.posOf(+key.slice(5)); if (p) E.updateLoop(key, { pos: p }); }
    // Hurt: the world dulls and your heart thumps.
    const me = this.getEntity(this.listenerId);
    const hp = me?.hpFrac ?? 1, low = me && hp < 0.3 && hp > 0;
    E.setMuffle(low ? (0.3 - hp) / 0.3 * 0.6 : 0);
    if (low && !E.hasLoop('heart')) E.loop('heart', 'heartbeat', { ui: true, gain: 0.5 });
    else if (!low && E.hasLoop('heart') && !this.downed) E.stopLoop('heart');
  }

  // ---------------------------------------------------------------- events
  #wire() {
    const on = (t, fn) => this.off.push(bus.on(t, fn));
    const E = this.engine, mine = (e) => e.id === this.listenerId;
    const at = (a) => vec(a);

    // ---- guns
    on('weapon:fire', (e) => {
      const ent = this.getEntity(e.id), spec = ent?.weapon;
      let [kind, profile] = weaponDesign(spec ?? { id: e.weaponId });
      if (kind === 'gun' && e.suppressed && E.recordedId?.('gun:supp')) profile = 'supp';   // a suppressor: the silenced shot
      if (kind === 'beam') return;
      if (this.charging.has(e.id)) { E.stop(this.charging.get(e.id), 0.04); this.charging.delete(e.id); }
      if (e.id === this.listenerId) { E.play(`${kind}:${profile}:1p`, { gain: kind === 'laser' ? 0.75 : 0.85, jitter: 0.015 }); return; }
      const pos = ent?.position;
      if (!pos) return;
      const d = this.#dist(pos);
      // Far off and firing fast: every other round is enough (they blur together at range anyway).
      const last = this.lastShot.get(e.id) ?? -1;
      if (d > 70 && this.time - last < 0.09) return;
      this.lastShot.set(e.id, this.time);
      const rel = this.relation(e.id), quiet = (e.audioRadius ?? 1) < 1;
      _p.x = pos.x; _p.y = pos.y + 1.5; _p.z = pos.z;
      E.play(`${kind}:${profile}:near`, { pos: { ..._p }, far: `${kind}:${profile}:far`, kind: 'gun', gain: (rel === 'enemy' ? 0.85 : 0.7) * (quiet ? 0.35 : 1) * (kind === 'laser' ? 0.75 : 1), rate: 1 + ((e.id * 37) % 9 - 4) * 0.006, occlude: d < 150 });
    });
    // A round that passes close: a crack (kinetic) or a bolt buzzing by.
    on('weapon:tracer', (e) => {
      if (e.id === this.listenerId) return;
      const o = e.from, dv = e.dir, H = this.head;
      const tx = H.x - o[0], ty = H.y - o[1], tz = H.z - o[2];
      const t = tx * dv[0] + ty * dv[1] + tz * dv[2];
      if (t < 2 || t > (e.dist ?? 120) + 1) return;                  // not yet at you, or stopped short
      const cx = o[0] + dv[0] * t, cy = o[1] + dv[1] * t, cz = o[2] + dv[2] * t, miss = Math.hypot(H.x - cx, H.y - cy, H.z - cz);
      if (miss > 4) return;
      const spec = this.getEntity(e.id)?.weapon, [kind] = weaponDesign(spec);
      const k = 1 - miss / 4;
      E.play(kind === 'laser' ? `whizz:${this.#army(e.id)}` : 'crack', { pos: { x: cx, y: cy, z: cz }, kind: 'near', gain: (kind === 'laser' ? 0.65 : 0.8) * (0.4 + 0.6 * k), delay: false, hero: true });
      this.onNearMiss(k); E.suppress?.(k);
    });
    on('projectile:spawn', (e) => { if (e.ref && e.ref.ownerId !== this.listenerId && !e.ref.spec?.splash) this.projectiles.add(e.ref); });
    // Rounds landing round you: chips off concrete, pings off metal, thuds in the snow; bolts sizzle.
    on('weapon:impact', (e) => {
      const p = at(e.point);
      if (!p || this.#dist(p) > 45) return;
      const energy = /bolt|laser|plasma|energy|beam/.test(e.style ?? '') || e.surface === 'hardlight' || e.surface === 'dome';
      const s = energy ? 'energy' : this.snow && (e.surface === 'dirt' || !e.surface) ? 'snow' : SURFACE[e.surface] ?? 'concrete';
      E.play(`impact:${s}`, { pos: p, kind: 'impact', gain: 0.45, jitter: 0.06 });
    });
    on('weapon:hit', (e) => {
      if (e.attacker === this.listenerId) E.play(e.friendly ? 'ui:hit_friendly' : e.killed ? 'ui:hit_kill' : e.zone === 'head' ? 'ui:hit_head' : (e.armorMul ?? 1) < 0.5 ? 'ui:hit_plink' : e.shieldBroke ? 'ui:hit_shieldbreak' : 'ui:hit', { ui: true, gain: 0.32, jitter: 0 });
      if (e.victim === this.listenerId) E.play(this.getEntity(this.listenerId)?.shield > 0 && !e.shieldBroke ? 'hit:shield' : 'hit:armor', { ui: true, gain: 0.75, jitter: 0.04 });
      else if (e.point && e.attacker !== this.listenerId && this.#dist(at(e.point)) < 25) E.play('impact:flesh', { pos: at(e.point), kind: 'impact', gain: 0.35 });
    });
    on('health:shieldBreak', (e) => { if (e.id === this.listenerId) E.play('hit:shieldbreak', { ui: true, gain: 0.7 }); });
    // Handling your gun (and the soldier next to you handling his).
    const handle = (id, cue, g = 0.5) => { if (id === this.listenerId) E.play(cue, { ui: true, gain: g, jitter: 0.03 }); else { const p = this.posOf(id); if (p && this.#dist(p) < 14) E.play(cue, { pos: p, kind: 'foley', gain: g * 0.8 }); } };
    on('weapon:magOut', (e) => handle(e.id, 'mech:magout'));
    on('weapon:reloadEnd', (e) => handle(e.id, 'mech:magin', 0.55));
    on('weapon:shellIn', (e) => handle(e.id, 'mech:magin', 0.3));
    on('weapon:chamber', (e) => { const a = this.getEntity(e.id)?.weapon?.archetype; if (a === 'shotgun' || a === 'sniper') handle(e.id, a === 'shotgun' ? 'mech:pump' : 'mech:bolt', 0.55); });
    on('weapon:swap', (e) => handle(e.id, 'mech:swap', 0.45));
    on('weapon:dryFire', (e) => handle(e.id, 'mech:dry', 0.5));
    on('weapon:empty', (e) => mine(e) && E.play('ui:empty', { ui: true, gain: 0.35 }));
    on('weapon:ventStart', (e) => handle(e.id, 'mech:vent', 0.4));
    on('weapon:overheat', (e) => handle(e.id, 'mech:overheat', 0.5));
    on('weapon:perfectVent', (e) => mine(e) && E.play('ui:ready', { ui: true, gain: 0.4 }));
    // Spent brass landing round you (GunFx throws the casings): a tink, dull on dirt, muffled in snow.
    on('fx:brass', (e) => {
      if (this.time - this.lastBrass < 0.09 || this.#dist(e) > 12) return;     // (an SMG's fifteen a second: a few of them are enough)
      this.lastBrass = this.time;
      const s = SURFACE[e.surface] ?? 'concrete', soft = s === 'dirt' || s === 'snow' || s === 'flesh';
      E.play(`brass:${this.snow && soft ? 'snow' : soft ? 'dirt' : 'hard'}`, { pos: { x: e.x, y: e.y, z: e.z }, kind: 'foley', gain: 0.2, jitter: 0.08 });
    });
    on('weapon:chargeStart', (e) => {
      const v = e.id === this.listenerId ? E.play(`charge:${this.#army(e.id)}`, { gain: 0.45 }) : E.play(`charge:${this.#army(e.id)}`, { pos: this.posOf(e.id), kind: 'ability', gain: 0.5 });
      if (v) this.charging.set(e.id, v);
    });
    on('weapon:chargeCancel', (e) => { E.stop(this.charging.get(e.id), 0.08); this.charging.delete(e.id); });
    on('weapon:beamStart', (e) => E.loop(`beam:${e.id}`, `beam:${this.#army(e.id)}`, { pos: e.id === this.listenerId ? null : this.posOf(e.id), kind: 'ability', gain: e.id === this.listenerId ? 0.3 : 0.35 }));
    on('weapon:beamEnd', (e) => E.stopLoop(`beam:${e.id}`, 0.12));
    on('projectile:deflect', (e) => E.play('melee:deflect', { pos: at(e.point), kind: 'impact', gain: 0.6 }));

    // ---- explosions: the bigger and nearer, the harder they hit you
    const blast = (p, radius, id, element = null) => {
      if (!p) return;
      const d = this.#dist(p), size = radius >= 7 ? 'bomb' : radius >= 4.5 ? 'shell' : radius >= 3 ? 'vehicle' : 'grenade';
      // Far off, a barrage is one long thunder: a blast landing right on another's heels adds nothing
      // but mush (past 80 m, one every third of a second; past 200, one a half second).
      const gap = d > 200 ? 0.5 : d > 80 ? 0.3 : 0;
      if (gap && this.time - (this.lastFarBlast ?? -1) < gap) return;
      if (gap) this.lastFarBlast = this.time;
      E.play(`boom:${size}:near`, { pos: p, far: `boom:${size}:far`, kind: 'boom', gain: 1, jitter: 0.04 });
      // Void and plasma blasts crackle as they go off.
      if (element === 'void' || element === 'plasma') E.play('boom:emp', { pos: p, kind: 'boom', gain: 0.55, jitter: 0.05 });
      const reach = Math.max(6, radius * 3.2);
      if (d < reach) E.shock(Math.min(1, (1 - d / reach) * (0.6 + radius / 10)));
      if (id === this.listenerId) return;
      this.onNearMiss(Math.max(0, 1 - d / (reach * 1.5)));
    };
    on('projectile:explode', (e) => { if (!e.artillery) blast(at(e.point), e.radius ?? 3, e.ownerId, e.element); });   // (a shell's boom is artillery:impact's)
    on('artillery:impact', (e) => blast(at(e.point), Math.max(5, e.radius ?? 6)));
    on('deployable:triggered', (e) => { if (/mine|charge|trip/.test(e.kind ?? '')) blast(at(e.point), e.radius ?? 3); });
    on('vehicle:destroyed', (e) => blast(at(e.at), 4));
    on('gun:fire', (e) => {
      // A rocket battery's salvo: its rockets leave a few tenths apart, one roar for every three of them.
      if (e.kind === 'rockets') { const n = (this.salvo.get(e.id) ?? 0) + 1; this.salvo.set(e.id, n); if (n % 3 !== 1) return; }
      E.play(`report:${e.kind === 'at' ? 'at' : e.kind === 'rockets' ? 'rocket' : 'howitzer'}`, { pos: at(e.from), kind: 'report', gain: e.kind === 'rockets' ? 0.7 : 0.95 });
    });

    // ---- vehicles
    const MODEL = { tracked: 'tracked', car: 'car', hover: 'hover', flyer: 'flyer' };
    on('vehicle:spawn', (e) => {
      const m = MODEL[e.model];
      if (!m) return;
      this.vehicles.set(e.id, m);
      E.loop(`veh:${e.id}`, `engine:${m}`, { pos: at(e.at), kind: 'vehicle', gain: 0.4 });
    });
    on('vehicle:removed', (e) => { E.stopLoop(`veh:${e.id}`); E.stopLoop(`burn:${e.id}`); this.vehicles.delete(e.id); });
    on('vehicle:burning', (e) => { this.vehicles.delete(e.id); E.stopLoop(`veh:${e.id}`, 0.6); E.loop(`burn:${e.id}`, 'fire', { pos: at(e.at), kind: 'impact', gain: 0.6 }); });
    on('vehicle:ram', (e) => { const p = this.posOf(e.victim); E.play('impact:vehicle', { pos: p, kind: 'impact', gain: 0.9 }); E.play('body:heavy', { pos: p, kind: 'foley', gain: 0.8 }); });
    on('vehicle:crash', (e) => { E.play('impact:vehicle', { pos: at(e.at), kind: 'boom', gain: 0.8 }); E.play('boom:grenade:near', { pos: at(e.at), kind: 'boom', gain: 0.25 }); });
    on('vehicle:enter', (e) => e.entity === this.listenerId && E.play('mech:swap', { ui: true, gain: 0.5 }));
    on('vehicle:exit', (e) => e.entity === this.listenerId && E.play(e.eject ? 'body:heavy' : 'mech:swap', { ui: true, gain: 0.5 }));
    on('vehicle:boost', (e) => E.play('sky:jet', { pos: this.posOf(e.id), kind: 'vehicle', gain: 0.35, offset: 1.4 }));

    // ---- downs and revives
    on('entity:downed', (e) => {
      if (e.id === this.listenerId) { this.downed = true; E.play('ui:down', { ui: true, gain: 0.8 }); E.shock(0.5); if (!E.hasLoop('heart')) E.loop('heart', 'heartbeat', { ui: true, gain: 0.6 }); }
      else { const p = this.posOf(e.id); if (p && this.#dist(p) < 30) E.play('body:heavy', { pos: p, kind: 'foley', gain: 0.7 }); }
    });
    const up = (e) => { if (e.id === this.listenerId) { this.downed = false; E.stopLoop('heart'); } };
    on('entity:revived', up);
    on('entity:death', (e) => { up(e); if (e.id === this.listenerId) E.shock(0.8); });
    on('revive:start', (e) => (e.id === this.listenerId || e.patient === this.listenerId) && E.play('ui:revive', { ui: true, gain: 0.4 }));
    on('revive:done', (e) => (e.id === this.listenerId || e.patient === this.listenerId) && E.play('ui:revived', { ui: true, gain: 0.45 }));

    // ---- bodies: two men running into each other (BodyContacts): the thud and the kit rattling
    on('body:bump', (e) => {
      const g = Math.min(1, e.speed / 7), y = (this.posOf(e.a)?.y ?? 0) + 1.1;
      if (e.a === this.listenerId || e.b === this.listenerId) { E.play('body:heavy', { ui: true, gain: 0.3 + 0.4 * g, jitter: 0.06 }); E.play('rattle', { ui: true, gain: 0.4 * g, jitter: 0.08 }); return; }
      const p = { x: e.x, y, z: e.z };
      if (this.#dist(p) < 25) { E.play('body:heavy', { pos: p, kind: 'foley', gain: 0.25 + 0.4 * g }); E.play('rattle', { pos: p, kind: 'foley', gain: 0.3 * g, jitter: 0.08 }); }
    });

    // ---- foley, from the rig
    on('anim:footstep', (e) => {
      const quiet = this.getEntity(e.id)?.perks?.silent;
      if ((quiet === 'crouch' && (e.stance === 'crouch' || e.stance === 'prone')) || (quiet === 'sprint' && e.gait === 'sprint')) return;
      const self = e.id === this.listenerId;
      const s = SURFACE[e.surface] ?? 'concrete', surface = this.snow && (s === 'dirt' || s === 'concrete') ? 'snow' : s === 'vehicle' ? 'metal' : s;
      const k = e.intensity ?? 1, g = (e.gait === 'sprint' ? 0.55 : e.gait === 'land' ? 0.7 : e.gait === 'crouch' || e.gait === 'shuffle' ? 0.22 : 0.4) * Math.min(1.3, k) * (self ? 0.45 : 1);
      E.play(`foot:${surface}`, self ? { gain: g, jitter: 0.06 } : { pos: { x: e.x, y: e.y, z: e.z }, kind: 'foley', gain: g, jitter: 0.06 });
      if (e.gait === 'sprint' || e.gait === 'land') E.play('rattle', self ? { gain: g * 0.35, jitter: 0.08 } : { pos: { x: e.x, y: e.y + 1, z: e.z }, kind: 'foley', gain: g * 0.5, jitter: 0.08 });
    });
    on('anim:impact', (e) => {
      const self = e.id === this.listenerId, cue = e.kind === 'slide' ? 'body:slide' : e.kind === 'hands' ? 'body:hands' : 'body:heavy';
      const g = Math.min(1, e.intensity ?? 1) * (self ? 0.45 : 0.75);
      E.play(cue, self ? { gain: g } : { pos: { x: e.x, y: e.y, z: e.z }, kind: 'foley', gain: g });
    });
    on('anim:cloth', (e) => { if (e.id === this.listenerId) E.play('cloth', { gain: 0.12 * Math.min(1, e.intensity ?? 1), jitter: 0.1 }); });

    // ---- melee
    const meleePos = (id) => (id === this.listenerId ? null : this.posOf(id));
    on('melee:windup', (e) => {
      const rel = this.relation(e.id), p = meleePos(e.id);
      // The swing's whoosh lands as the blade comes through (the end of the windup).
      setTimeout(() => E.play(this.getEntity(e.id)?.flame ? 'melee:swing_flame' : 'melee:swing', p ? { pos: p, kind: 'foley', gain: 0.6 } : { gain: 0.45 }), Math.max(0, (e.windup ?? 0.2) * 1000 - 60));
      if (rel === 'enemy') E.play(e.unblockable ? 'melee:windup_unblockable' : 'melee:windup', { pos: p, kind: 'ability', gain: e.unblockable ? 0.8 : 0.45 });
    });
    on('melee:hit', (e) => E.play('melee:hit', { pos: meleePos(e.defender), kind: 'impact', gain: 0.8 }));
    on('melee:block', (e) => E.play('melee:block', { pos: meleePos(e.defender), kind: 'impact', gain: 0.75 }));
    on('melee:perfectBlock', (e) => E.play('melee:block', { pos: meleePos(e.defender), kind: 'impact', gain: 0.9, rate: 1.15 }));
    on('melee:parry', (e) => E.play('melee:parry', { pos: meleePos(e.defender), kind: 'near', gain: 1 }));
    on('melee:guardBreak', (e) => E.play('melee:guardbreak', { pos: meleePos(e.defender), kind: 'impact', gain: 0.9 }));

    // ---- abilities, by their signature and their army
    // Abilities: yours in your head; anyone else's only near you (a battle's worth of them from all
    // over the field is noise, not information), an enemy's a little louder than a friend's.
    const ab = (e, kind, gain = 0.5, extra = {}) => {
      const def = this.abilityIndex.get(e.ability), sig = e.audio?.sig ?? def?.audio?.sig;
      const p = e.id === this.listenerId ? null : extra.pos ?? this.posOf(e.id);
      if (p && this.#dist(p) > (e.isSuper ? 120 : 45)) return null;
      return E.play(abilityId(sig, this.#army(e.id ?? e.owner), kind), { pos: p, kind: 'ability', gain, ...extra, ...(p ? {} : { pos: null }) });
    };
    on('ability:cast', (e) => {
      const rel = this.relation(e.id);
      if (rel === 'enemy') { ab(e, 'threat', 0.55); if (e.isSuper) this.#announceSuper(e); }
      else ab(e, 'cast', rel === 'self' ? 0.45 : 0.35);
    });
    on('ability:activate', (e) => {
      const def = this.abilityIndex.get(e.ability), p = e.id === this.listenerId ? null : this.posOf(e.id);
      if (def?.duration > 1 && (!p || this.#dist(p) < 30)) E.loop(`abil:${e.id}:${e.slot}`, abilityId(def.audio?.sig ?? e.audio?.sig, this.#army(e.id), 'loop'), { pos: p, kind: 'ability', gain: 0.18 });
    });
    on('ability:end', (e) => { E.stopLoop(`abil:${e.id}:${e.slot}`); ab(e, 'end', 0.25); });
    on('ability:hit', (e) => {
      if (e.victim === this.listenerId) E.play(abilityId(this.abilityIndex.get(e.ability)?.audio?.sig, this.#army(e.attacker), 'impact'), { gain: 0.7 });
      else if (e.attacker === this.listenerId) E.play('ui:ability_hit', { ui: true, gain: 0.3 });
    });
    on('ability:interrupted', (e) => E.play('ui:denied', { pos: this.posOf(e.id), kind: 'ability', gain: 0.4 }));
    on('ability:ready', (e) => mine(e) && E.play('ui:ready', { ui: true, gain: 0.3 }));
    on('ability:superReady', (e) => mine(e) && E.play('ui:super_ready', { ui: true, gain: 0.45 }));
    on('ability:blocked', (e) => mine(e) && E.play('ui:denied', { ui: true, gain: 0.35 }));
    on('ability:fizzle', (e) => mine(e) && E.play('ui:denied', { ui: true, gain: 0.35 }));
    on('ability:dash', (e) => E.play('melee:windup', { pos: meleePos(e.id), kind: 'foley', gain: 0.5, rate: 1.4 }));
    on('ability:blink', (e) => E.play('melee:windup', { pos: meleePos(e.id), kind: 'foley', gain: 0.5, rate: 2 }));
    on('status:applied', (e) => { if (e.id === this.listenerId) E.play('hit:shield', { ui: true, gain: 0.35, rate: 0.7 }); });

    // ---- zones and deployables
    const teamArmy = (team) => (team === 1 ? 'void' : 'sol');
    const sigOf = (ability) => this.abilityIndex.get(ability)?.audio?.sig;
    on('zone:arming', (e) => E.play(abilityId(sigOf(e.ability), teamArmy(e.team), 'arming'), { pos: at(e.center), kind: 'ability', gain: 0.6 }));
    on('zone:start', (e) => {
      E.play(abilityId(sigOf(e.ability), teamArmy(e.team), 'cast'), { pos: at(e.center), kind: 'ability', gain: 0.55 });
      if (e.lifetime > 1.5 && this.#dist(at(e.center)) < 60) E.loop(`zone:${e.id}`, abilityId(sigOf(e.ability), teamArmy(e.team), 'zone'), { pos: at(e.center), kind: 'ability', gain: 0.14 });
    });
    on('zone:end', (e) => E.stopLoop(`zone:${e.id}`));
    on('zone:blocked', (e) => E.play('impact:energy', { pos: at(e.point), kind: 'impact', gain: 0.4 }));
    on('deployable:spawn', (e) => E.play('mech:magin', { pos: at(e.at), kind: 'foley', gain: 0.6, rate: 0.7 }));
    on('deployable:proximity', (e) => e.listeners?.includes(this.listenerId) && E.play('ui:beep', { pos: at(e.at), kind: 'near', gain: 0.5 }));
    on('deployable:fire', (e) => E.play('gun:smg_sol:near', { pos: at(e.from), far: 'gun:smg_sol:far', kind: 'gun', gain: 0.5 }));
    on('deployable:pulse', (e) => E.play('impact:energy', { pos: at(e.center), kind: 'ability', gain: 0.5, rate: 0.6 }));
    on('deployable:removed', (e) => e.reason === 'destroyed' && E.play('impact:metal', { pos: at(e.at), kind: 'impact', gain: 0.6 }));
    on('world:coverDestroyed', (e) => { if (!e.structural) E.play('boom:grenade:near', { pos: at(e.center), kind: 'boom', gain: 0.5, rate: 0.8 }); });   // (a building's pieces have their own sounds, below)

    // ---- buildings coming apart (Structures.js): a groan before it goes, walls breaking, pieces tearing loose and landing
    on('structure:creak', (e) => E.play('struct:creak', { pos: at(e.at), kind: 'impact', gain: Math.min(1, 0.55 + e.n * 0.02), rate: 0.9 + Math.random() * 0.2 }));
    // A tower going: a long groan from deep in it, a rumble under it, and the groan again as it starts to lean.
    on('structure:tower', (e) => {
      E.play('struct:creak', { pos: at(e.at), kind: 'boom', gain: 1, rate: 0.5 });
      E.play('boom:shell:far', { pos: at(e.at), kind: 'boom', gain: 0.7, rate: 0.45 });
      setTimeout(() => E.play('struct:creak', { pos: at(e.at), kind: 'boom', gain: 1, rate: 0.4 }), Math.max(0, (e.warn ?? 3) - 1) * 1000);
    });
    on('structure:break', (e) => {
      if (this.time - (this.lastBreak ?? -1) < 0.06) return;   // a blast breaks a dozen pieces at once: one crumble
      this.lastBreak = this.time;
      E.play('struct:crumble', { pos: at(e.at), kind: 'impact', gain: e.fragments?.length ? 0.6 : 0.8 });
    });
    on('structure:tear', (e) => {
      if (this.time - (this.lastTear ?? -1) < 0.09) return;   // a piece tearing off along its edge: one snap
      this.lastTear = this.time;
      E.play('struct:snap', { pos: at(e.at), kind: 'impact', gain: 0.7, rate: 0.85 + Math.random() * 0.3 });
    });
    on('structure:land', (e) => {
      // A wall coming down is a stream of pieces landing: one crash every 80 ms at most, as loud as the biggest of them.
      this.landE = Math.max(this.landE ?? 0, e.energy);
      if (this.time - (this.lastLand ?? -1) < 0.08) return;
      this.lastLand = this.time;
      const k = Math.min(1, Math.sqrt(this.landE) / 25);
      this.landE = 0;
      E.play('struct:crash', { pos: at(e.at), kind: 'boom', gain: 0.35 + 0.65 * k, rate: 1.15 - 0.35 * k });
      if (k > 0.6) E.play('boom:shell:far', { pos: at(e.at), kind: 'boom', gain: 0.3 * k, rate: 0.7 });   // a big one rumbles
    });

    // ---- the front: whistles, spades, sandbags
    on('squad:whistle', (e) => {
      const ours = this.getEntity(this.listenerId)?.team === e.team;
      E.play(ours ? 'whistle:ours' : 'whistle:enemy', { pos: { x: e.x, y: 2, z: e.z }, kind: 'report', gain: ours ? 0.45 : 0.55 });
    });
    const digging = new Map();
    on('fort:dig', (e) => {
      if (this.time - (digging.get(e.id) ?? -1) < 0.55) return;
      digging.set(e.id, this.time);
      E.play('dig', e.id === this.listenerId ? { gain: 0.45 } : { pos: this.posOf(e.id), kind: 'foley', gain: 0.5 });
    });
    on('fort:built', (e) => e.kind === 'sandbags' && E.play('body:heavy', { pos: { x: e.x, y: 0, z: e.z }, kind: 'foley', gain: 0.6 }));

    // ---- call-ins
    on('stratagem:open', (e) => mine(e) && E.play('ui:open', { ui: true, gain: 0.35 }));
    on('stratagem:arrow', (e) => mine(e) && E.play(`arrow:${Math.min(10, Math.max(1, e.code?.length ?? 1))}`, { ui: true, gain: 0.35, jitter: 0 }));
    on('stratagem:error', (e) => mine(e) && E.play('ui:error', { ui: true, gain: 0.4 }));
    on('stratagem:armed', (e) => mine(e) && E.play('ui:armed', { ui: true, gain: 0.45 }));
    on('stratagem:rearmed', (e) => mine(e) && E.play('ui:armed', { ui: true, gain: 0.15 }));
    on('stratagem:thrown', (e) => E.play('ui:throw', e.id === this.listenerId ? { gain: 0.4 } : { pos: this.posOf(e.id), kind: 'foley', gain: 0.5 }));
    on('stratagem:beacon', (e) => E.play('ui:beacon', { pos: at(e.at), kind: 'ability', gain: 0.5 }));
    on('stratagem:pod', (e) => E.play('sky:pod', { pos: at(e.at), kind: 'report', gain: 0.9, offset: Math.max(0, 4 - (e.eta ?? 2)), delay: false }));
    on('stratagem:land', (e) => { blast(at(e.at), 4.5); E.play('pod:open', { pos: at(e.at), kind: 'impact', gain: 0.8, wait: 0.6 }); });   // the pod's doors coming open
    on('stratagem:incoming', (e) => e.first && e.dir && E.play('sky:jet', { pos: at(e.from), kind: 'report', gain: 0.9, delay: false }));
    on('stratagem:smoke', (e) => E.play('ui:smoke', { pos: at(e.at), kind: 'ability', gain: 0.6 }));
    on('stratagem:grab', (e) => mine(e) && E.play('ui:grab', { ui: true, gain: 0.45 }));
    // The end of the match: brass for a win, a falling line for a loss.
    on('mode:victory', (e) => E.play(e.team === this.getEntity(this.listenerId)?.team ? 'music:victory' : 'music:defeat', { ui: true, gain: 0.5, jitter: 0 }));
    // Pings (Pings, PingView): your side's, a blip (yours louder; an enemy's two notes falling; danger three).
    on('ping:add', (e) => {
      if (e.team !== this.getEntity(this.listenerId)?.team) return;
      E.play(e.kind === 'enemy' ? 'ui:ping_enemy' : e.kind === 'danger' ? 'ui:ping_danger' : 'ui:ping', { ui: true, gain: e.by === this.listenerId ? 0.5 : 0.22, jitter: 0 });
    });
    on('bp:earn', (e) => mine(e) && e.amount >= 25 && E.play('ui:bp', { ui: true, gain: 0.2 }));
    on('bp:spend', (e) => mine(e) && E.play('ui:buy', { ui: true, gain: 0.4 }));
    on('stratagem:instant', (e) => mine(e) && E.play('ui:hero', { ui: true, gain: 0.45 }));
    on('support:stim', (e) => E.play('ui:stim', mine(e) ? { gain: 0.45 } : { pos: this.posOf(e.id), kind: 'foley', gain: 0.5 }));
    on('support:pack', (e) => E.play('ui:grab', e.owner === this.listenerId ? { gain: 0.4 } : { pos: at(e.at), kind: 'foley', gain: 0.5 }));
    on('support:repair', (e) => E.play('ui:repair', mine(e) ? { gain: 0.35 } : { pos: this.posOf(e.id), kind: 'foley', gain: 0.4 }));
    on('support:empty', (e) => mine(e) && E.play('ui:error', { ui: true, gain: 0.3 }));
  }

  #announceSuper(e) {
    const me = this.getEntity(this.listenerId), src = this.getEntity(e.id);
    if (!me || !src) return;
    const dx = src.position.x - me.position.x, dz = src.position.z - me.position.z;
    if (Math.hypot(dx, dz) > (e.audio?.radius ?? 120)) return;
    this.engine.play('ui:stinger', { ui: true, gain: 0.6 });
    this.onSuperWarning({ ability: e.ability, angle: Math.atan2(-dx, -dz) });
  }
}
