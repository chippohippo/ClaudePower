// AudioDirector: turns sim events into readable sound. Presentation only.
//
// Clarity rules (Deadlock / Destiny 2 lessons). Every rule here exists so a player can hear a fight:
//  1. Relation variants. Each ability cue has a self/ally variant and an enemy "threat" variant.
//     The threat variant is harsher, +3 dB, has a sharper transient, and is never voice-stolen.
//  2. Faction sound families. Solari = bright brass, choir and bells in major intervals; Void =
//     sub drones, reversed swells and tritones. You can tell who cast something with your eyes shut.
//  3. Sonic signature per ability. Each ability has a root note and timbre (data `audio.sig`), so
//     two abilities in the same kit never sound alike.
//  4. Priority and ducking. Tier 0 (threats aimed at you, enemy supers) side-chains music and
//     ambience down; tier 3 ambience is always the first to be culled.
//  5. Telegraph sync. Cast cues start on the first tick of the cast, so they lead the visual
//     telegraph by the network delay at most and never trail it.
//  6. Supers are announced. When an enemy super starts within its radius you get a 2D stinger, a
//     VO line and a HUD direction arrow.
//  7. Self-state cues stay 2D and quiet: ability ready, low ammo, overheat, low HP heartbeat.
//  8. Call-ins. The wrist pad's beeps are yours alone and 2D: each arrow a whole tone above the
//     last, a buzz on a wrong one, a chime when the beacon's in your hand. Out in the world a
//     planted beacon pings and then beeps faster as its payload nears (you hear the clock), a
//     pod roars down, the strike jet tears past, smoke pops and hisses.
//  9. Foley is animation-driven. Footsteps, cloth and body impacts play only from the rig's
//     anim:footstep / anim:cloth / anim:impact events, so every thud lands on the frame the foot
//     or body visibly hits. Their own tier is distance-culled before any node is created, so a
//     128-player battle never spends voices on footsteps nobody can hear.
//
// The backend is pluggable: HowlerBackend for real assets, SynthBackend (WebAudio oscillators
// from each ability's signature) so the prototype is fully audible before any assets exist.

import { bus } from '../core/EventBus.js';

export const Tier = Object.freeze({ THREAT: 0, COMBAT: 1, WEAPON: 2, AMBIENT: 3, FOLEY: 4 });
const VOICE_LIMITS = { 0: 16, 1: 24, 2: 24, 3: 12, 4: 20 };
// Audible radius of other soldiers' foley by gait (m). Sprinting armor is heard well before it's seen.
const FOOT_RADIUS = { sprint: 32, jog: 24, walk: 14, land: 30, crouch: 9, shuffle: 6, crawl: 6 };
const IMPACT_RADIUS = { diveLand: 30, slide: 24, proneDrop: 16, body: 30, land: 28, hands: 14, ragdoll: 34 };

export class AudioDirector {
  /**
   * @param {object} backend   { play(cue, opts) -> handle, stop(handle), setBusGain(bus, db, rampSec), setListener(pos, yaw) }
   * @param {object} opts      { listenerId, getEntity(id) -> { team, position }, abilityIndex: Map(abilityId -> def), uiArrow(fn) }
   */
  constructor(backend, { listenerId, getEntity, abilityIndex = new Map(), onSuperWarning = () => {}, guns = null, strats = null } = {}) {
    this.backend = backend;
    this.guns = guns;                // FieldGuns: rounds in the air (incoming whistles)
    this.strats = strats;            // StratagemSystem: planted beacons (their beeping)
    this.beeps = new WeakMap();      // beacon -> when it beeps next
    this.whistled = new WeakSet();
    this.listenerId = listenerId;
    this.getEntity = getEntity;
    this.abilityIndex = abilityIndex;
    this.onSuperWarning = onSuperWarning;
    this.voices = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    this.listenerPos = null;
    this.loops = new Map();          // key -> handle (beams, channels, status loops)
    this.duckUntil = 0;
    this.time = 0;
    this.#wire();
  }

  // ---------------------------------------------------------------- relation helpers
  relation(entityId) {
    if (entityId === this.listenerId) return 'self';
    const me = this.getEntity(this.listenerId), them = this.getEntity(entityId);
    return me && them && me.team === them.team ? 'ally' : 'enemy';
  }
  posOf(id) { return this.getEntity(id)?.position; }

  /**
   * Plays a cue. Missing assets fall back to the ability signature synth.
   * @param {string} cue    e.g. "solar_charge.cast_threat"
   */
  play(cue, { tier = Tier.COMBAT, pos = null, gainDb = 0, sig = null, loopKey = null, radius = 45, family, intensity, duration } = {}) {
    // Distance cull before allocating anything (positional cues past their radius are inaudible).
    const L = this.listenerPos;
    if (pos && L && !loopKey && (pos.x - L.x) ** 2 + (pos.y - L.y) ** 2 + (pos.z - L.z) ** 2 > radius * radius) return null;
    // Voice management: steal the oldest voice in the same tier, except in THREAT, where the
    // limit is generous and nothing is ever stolen.
    const list = this.voices[tier];
    if (list.length >= VOICE_LIMITS[tier]) {
      if (tier === Tier.THREAT) return null;
      this.backend.stop(list.shift());
    }
    const h = this.backend.play(cue, { pos, gainDb, sig, loop: !!loopKey, radius, family, tier, intensity, duration });
    if (!h) return null;
    list.push(h);
    if (loopKey) this.loops.set(loopKey, h);
    if (tier === Tier.THREAT) this.#duck();
    return h;
  }
  stopLoop(key) { const h = this.loops.get(key); if (h) { this.backend.stop(h); this.loops.delete(key); } }

  #duck() {
    // Side-chain: music -8 dB and ambience -6 dB, restored after 0.6s without new threats.
    this.backend.setBusGain('music', -8, 0.05);
    this.backend.setBusGain('ambient', -6, 0.05);
    this.duckUntil = this.time + 0.6;
  }
  update(dt, listenerPos, listenerYaw) {
    this.time += dt;
    this.listenerPos = listenerPos ?? this.listenerPos;
    this.backend.setListener?.(listenerPos, listenerYaw);
    if (this.duckUntil && this.time > this.duckUntil) {
      this.backend.setBusGain('music', 0, 0.8); this.backend.setBusGain('ambient', 0, 0.8);
      this.duckUntil = 0;
    }
    for (const t of Object.keys(this.voices)) this.voices[t] = this.voices[t].filter((h) => !h.ended);
    // Incoming: a round about to land within earshot whistles down to its impact. Near you, that
    // whistle is the cue to get down (the bots react to the same thing).
    const G = this.guns, L = this.listenerPos;
    if (G?.incoming.length && L) {
      for (const r of G.incoming) {
        if (r.kind === 'pod') continue;                  // a pod roars down on its own (callin.pod)
        const left = r.at - G.time;
        if (left > 2.6 || left < 0.3 || this.whistled.has(r)) continue;
        if (Math.hypot(r.x - L.x, r.z - L.z) > 70) continue;
        this.whistled.add(r);
        this.play('artillery.whistle', { tier: Tier.THREAT, pos: { x: r.x, y: r.y + 6, z: r.z }, radius: 120, duration: left, gainDb: r.team === this.getEntity(this.listenerId)?.team ? -4 : 0 });
      }
    }
    // A planted beacon near you beeps, faster as its payload nears.
    const SB = this.strats;
    if (SB?.beacons.length && L) {
      for (const b of SB.beacons) {
        if (!b.planted || (b.pos.x - L.x) ** 2 + (b.pos.z - L.z) ** 2 > 45 * 45) continue;
        const delay = b.def.delay ?? 0, eta = delay - (SB.time - b.at);
        if (eta <= 0 || this.time < (this.beeps.get(b) ?? 0)) continue;
        this.beeps.set(b, this.time + 0.16 + (0.6 * eta) / Math.max(1, delay));
        this.play('callin.beep', { tier: Tier.COMBAT, pos: { x: b.pos.x, y: b.pos.y + 0.3, z: b.pos.z }, radius: 45, gainDb: -6 });
      }
    }
  }

  // ---------------------------------------------------------------- event wiring
  #wire() {
    const on = (t, fn) => bus.on(t, fn);

    // Abilities
    on('ability:cast', (e) => {
      const rel = this.relation(e.id);
      const sig = e.audio?.sig, radius = e.audio?.radius ?? 45;
      const def = this.abilityIndex.get(e.ability);
      const family = def?.family;
      if (rel === 'enemy') {
        this.play(`${e.ability}.cast_threat`, { tier: Tier.THREAT, pos: this.posOf(e.id), gainDb: 3, sig, radius, family });
        if (e.isSuper) this.#announceSuper(e);
      } else {
        this.play(`${e.ability}.cast`, { tier: e.isSuper ? Tier.THREAT : Tier.COMBAT, pos: rel === 'self' ? null : this.posOf(e.id), sig, radius, family, gainDb: rel === 'self' ? -2 : 0 });
      }
    });
    on('ability:activate', (e) => {
      const def = this.abilityIndex.get(e.ability);
      if (def?.duration > 1) this.play(`${e.ability}.loop`, { tier: Tier.COMBAT, pos: this.posOf(e.id), sig: e.audio?.sig, loopKey: `abil:${e.id}:${e.slot}`, gainDb: -6 });
    });
    on('ability:end', (e) => { this.stopLoop(`abil:${e.id}:${e.slot}`); this.play(`${e.ability}.end`, { tier: Tier.COMBAT, pos: this.posOf(e.id), sig: e.audio?.sig, gainDb: -4 }); });
    on('ability:hit', (e) => {
      // Being hit by an ability is a THREAT cue for the victim; dealing a hit gives a confirm "tick".
      if (e.victim === this.listenerId) this.play(`${e.ability}.impact`, { tier: Tier.THREAT, gainDb: 2 });
      else if (e.attacker === this.listenerId) this.play('ui.ability_hitconfirm', { tier: Tier.COMBAT, gainDb: -3 });
    });
    on('ability:interrupted', (e) => this.play('ability.interrupted', { tier: Tier.COMBAT, pos: this.posOf(e.id) }));
    on('ability:ready', (e) => e.id === this.listenerId && this.play(`ui.ready_${e.slot}`, { tier: Tier.COMBAT, gainDb: -8 }));
    on('ability:superReady', (e) => e.id === this.listenerId && this.play('ui.super_ready', { tier: Tier.COMBAT, gainDb: -2 }));
    on('ability:blocked', (e) => e.id === this.listenerId && this.play(`ui.denied_${e.reason}`, { tier: Tier.COMBAT, gainDb: -6 }));

    // Statuses: a status applied to you is always a THREAT cue in 2D with its own sound.
    on('status:applied', (e) => {
      if (e.id === this.listenerId) this.play(`status.${e.status}.apply`, { tier: Tier.THREAT });
      else if (e.source === this.listenerId) this.play(`status.${e.status}.confirm`, { tier: Tier.COMBAT, gainDb: -4 });
    });
    on('status:threshold', (e) => this.play(`status.${e.to}.trigger`, { tier: Tier.THREAT, pos: this.posOf(e.id), gainDb: 2 }));
    on('status:burst', (e) => this.play(`status.${e.cause}.burst`, { tier: Tier.COMBAT, pos: e.center }));

    // Weapons
    on('weapon:fire', (e) => this.play(`${e.audio ?? 'gun'}.fire${this.relation(e.id) === 'self' ? '_1p' : ''}`, { tier: Tier.WEAPON, pos: e.id === this.listenerId ? null : this.posOf(e.id), radius: 90 * (e.audioRadius ?? 1), gainDb: e.lowAmmo && e.id === this.listenerId ? 0 : -1 }));   // a suppressor carries a third as far
    on('weapon:empty', (e) => e.id === this.listenerId && this.play('ui.mag_empty_click', { tier: Tier.COMBAT, gainDb: -4 }));
    // The reload's two stages, heard: the old mag out (with a rattle if it still had rounds), the new one in.
    on('weapon:magOut', (e) => e.id === this.listenerId && this.play('gear.mag_out', { tier: Tier.FOLEY, intensity: e.lost > 0 ? 1 : 0.6, gainDb: -4 }));
    on('weapon:reloadEnd', (e) => e.id === this.listenerId && this.play('gear.mag_in', { tier: Tier.FOLEY, intensity: 1, gainDb: -2 }));
    on('weapon:overheat', (e) => this.play('weapon.overheat_vent', { tier: Tier.COMBAT, pos: e.id === this.listenerId ? null : this.posOf(e.id) }));
    on('weapon:perfectVent', (e) => e.id === this.listenerId && this.play('ui.perfect_vent', { tier: Tier.COMBAT }));
    on('weapon:hit', (e) => {
      // Your hits, by what they did: a kill, a headshot, a round the armor shrugs off (a dull plink: switch or aim elsewhere), a shield broken, a hit.
      if (e.attacker === this.listenerId) this.play(e.friendly ? 'ui.hit_friendly' : e.killed ? 'ui.hit_kill' : e.zone === 'head' ? 'ui.hit_head' : (e.armorMul ?? 1) < 0.5 ? 'ui.hit_plink' : e.shieldBroke ? 'ui.hit_shieldbreak' : `ui.hit_${e.armor}`, { tier: Tier.COMBAT, gainDb: -2 });
      if (e.victim === this.listenerId && e.shieldBroke) this.play('ui.my_shield_broke', { tier: Tier.THREAT });
    });
    on('weapon:beamStart', (e) => this.play('beam.loop', { tier: Tier.WEAPON, pos: this.posOf(e.id), loopKey: `beam:${e.id}` }));
    on('weapon:beamEnd', (e) => this.stopLoop(`beam:${e.id}`));
    on('projectile:deflect', (e) => this.play('melee.deflect', { tier: Tier.COMBAT, pos: e.point }));

    // Zones and deployables. Arming hostile zones are THREAT: the sound starts with the telegraph.
    const rel = (team) => (team === this.getEntity(this.listenerId)?.team ? 'ally' : 'enemy');
    const at = (arr) => arr && { x: arr[0], y: arr[1], z: arr[2] };
    on('zone:arming', (e) => this.play(`${e.ability}.arming${rel(e.team) === 'enemy' ? '_threat' : ''}`, { tier: rel(e.team) === 'enemy' ? Tier.THREAT : Tier.COMBAT, pos: at(e.center), radius: 80, sig: this.abilityIndex.get(e.ability)?.audio?.sig, gainDb: 2 }));
    on('zone:start', (e) => {
      const def = this.abilityIndex.get(e.ability);
      this.play(`${e.ability}.zone_start`, { tier: e.hostile && rel(e.team) === 'enemy' ? Tier.THREAT : Tier.COMBAT, pos: at(e.center), sig: def?.audio?.sig });
      if (e.lifetime > 1.5) this.play(`${e.ability}.zone_loop`, { tier: Tier.AMBIENT, pos: at(e.center), sig: def?.audio?.sig, loopKey: `zone:${e.id}`, gainDb: -10 });
    });
    on('zone:end', (e) => this.stopLoop(`zone:${e.id}`));
    on('zone:tetherBreak', (e) => (e.owner === this.listenerId || e.target === this.listenerId) && this.play('ui.tether_break', { tier: Tier.COMBAT }));
    on('zone:blocked', (e) => this.play('dome.deflect', { tier: Tier.WEAPON, pos: at(e.point), gainDb: -4 }));
    on('deployable:spawn', (e) => this.play(`deploy.${e.kind}.place${rel(e.team) === 'enemy' ? '_threat' : ''}`, { tier: rel(e.team) === 'enemy' ? Tier.THREAT : Tier.COMBAT, pos: at(e.at), gainDb: -2 }));
    // Proximity ticks are played only for the enemies who are near. That is the leaked information.
    on('deployable:proximity', (e) => e.listeners.includes(this.listenerId) && this.play(`deploy.${e.kind}.tick`, { tier: Tier.THREAT, pos: at(e.at), radius: 10, gainDb: -3 }));
    on('deployable:triggered', (e) => this.play(`deploy.${e.kind}.trigger`, { tier: Tier.THREAT, pos: at(e.point) }));
    on('deployable:charging', () => this.play('deploy.engine.charge', { tier: Tier.THREAT, gainDb: 0 }));
    on('deployable:pulse', (e) => this.play('deploy.engine.pulse', { tier: Tier.COMBAT, pos: at(e.center) }));
    on('deployable:fire', (e) => this.play('deploy.turret.fire', { tier: Tier.WEAPON, pos: at(e.from), gainDb: -6 }));
    on('deployable:removed', (e) => e.reason === 'destroyed' && this.play('deploy.destroyed', { tier: Tier.COMBAT, gainDb: -2 }));
    on('deployable:launch', (e) => this.play('deploy.launchpad.launch', { tier: Tier.COMBAT, pos: this.posOf(e.entity) }));
    on('deployable:vehicleArrived', (e) => this.play('deploy.vehicle.arrive', { tier: Tier.COMBAT, pos: at(e.at) }));
    on('deployable:vehicleDenied', (e) => e.owner === this.listenerId && this.play('ui.vehicle_denied', { tier: Tier.COMBAT }));
    on('world:coverDestroyed', (e) => this.play('world.cover_break', { tier: Tier.COMBAT, pos: at(e.center), gainDb: 2 }));
    on('ability:fizzle', (e) => e.id === this.listenerId && this.play('ui.denied_fizzle', { tier: Tier.COMBAT, gainDb: -4 }));

    // Vehicles: an engine loop per vehicle is the main tell (you hear a tank before you see it).
    // Enemy vehicle spawns and boosts are THREAT; rams and crashes are loud COMBAT hits.
    on('vehicle:spawn', (e) => {
      this.play(`vehicle.${e.model}.engine`, { tier: Tier.AMBIENT, pos: at(e.at), loopKey: `veh:${e.id}`, radius: e.model === 'flyer' ? 150 : e.model === 'tracked' ? 90 : 60, gainDb: -8 });
    });
    on('vehicle:removed', (e) => this.stopLoop(`veh:${e.id}`));
    on('vehicle:enter', (e) => e.entity === this.listenerId && this.play('vehicle.enter_snap', { tier: Tier.COMBAT, gainDb: -2 }));
    on('vehicle:exit', (e) => e.entity === this.listenerId && this.play(e.eject ? 'vehicle.eject' : 'vehicle.exit', { tier: Tier.COMBAT, gainDb: -2 }));
    on('vehicle:boost', (e) => this.play(`vehicle.boost${e.phase ? '_phase' : ''}${rel(e.team) === 'enemy' ? '_threat' : ''}`, { tier: rel(e.team) === 'enemy' ? Tier.THREAT : Tier.COMBAT, pos: this.posOf(e.id) }));
    on('vehicle:ram', (e) => this.play('vehicle.ram_impact', { tier: e.victim === this.listenerId ? Tier.THREAT : Tier.COMBAT, pos: this.posOf(e.victim), gainDb: 3 }));
    on('vehicle:crash', (e) => this.play('vehicle.crash', { tier: Tier.COMBAT, pos: at(e.at), gainDb: 2 }));
    on('vehicle:destroyed', (e) => this.play('vehicle.explode', { tier: Tier.THREAT, pos: at(e.at), radius: 150, gainDb: 4 }));

    // Downs and revives: going down is a heavy, low hit (your own a THREAT cue with a heartbeat
    // loop until you're up or dead); a revive starting and landing are bright, rising pings, so a
    // downed player hears help arrive and a medic hears the job finish.
    const DOWN_SIG = { root: 'A2', timbre: 'sub thud' }, REVIVE_SIG = { root: 'E5', timbre: 'chime' }, UP_SIG = { root: 'A5', timbre: 'bell' };
    on('entity:downed', (e) => {
      const self = e.id === this.listenerId;
      this.play('down.hit', { tier: self ? Tier.THREAT : Tier.COMBAT, pos: self ? null : this.posOf(e.id), sig: DOWN_SIG, gainDb: self ? 2 : -2 });
      if (self) this.play('down.heartbeat', { tier: Tier.THREAT, sig: { root: 'A1', timbre: 'sub drone' }, loopKey: 'down:self', gainDb: -8 });
    });
    const up = (e) => { if (e.id === this.listenerId) this.stopLoop('down:self'); };
    on('entity:revived', up);
    on('entity:death', up);
    on('revive:start', (e) => (e.id === this.listenerId || e.patient === this.listenerId) && this.play('revive.start', { tier: Tier.COMBAT, sig: REVIVE_SIG, gainDb: -4 }));
    on('revive:done', (e) => (e.id === this.listenerId || e.patient === this.listenerId) && this.play('revive.done', { tier: Tier.COMBAT, sig: UP_SIG, gainDb: -2 }));

    // Foley, driven by the animation rig (rule 8). Your own steps are 2D; heavy sprint steps add
    // a gear clank. Others are positional, with an audible radius that grows with gait.
    const db = (x) => 20 * Math.log10(Math.max(0.05, x));
    on('anim:footstep', (e) => {
      const self = e.id === this.listenerId;
      const pos = self ? null : { x: e.x, y: e.y, z: e.z };
      const radius = FOOT_RADIUS[e.gait] ?? 18;
      this.play(`foot.${e.surface}.${e.gait}`, { tier: Tier.FOLEY, pos, radius, intensity: e.intensity, gainDb: db(e.intensity) + (self ? -4 : 0) });
      if (e.gait === 'sprint' || e.gait === 'land') this.play('gear.rattle', { tier: Tier.FOLEY, pos, radius: radius * 0.6, intensity: e.intensity, gainDb: db(e.intensity) - (self ? 12 : 9) });
    });
    on('anim:impact', (e) => {
      const self = e.id === this.listenerId;
      this.play(`impact.${e.kind}`, { tier: Tier.FOLEY, pos: self ? null : { x: e.x, y: e.y, z: e.z }, radius: IMPACT_RADIUS[e.kind] ?? 24, intensity: e.intensity, gainDb: db(e.intensity) + (self ? -2 : 0) });
    });
    on('anim:cloth', (e) => {
      const self = e.id === this.listenerId;
      this.play(`cloth.${e.kind}`, { tier: Tier.FOLEY, pos: self ? null : { x: e.x, y: e.y, z: e.z }, radius: 12, intensity: e.intensity, gainDb: db(e.intensity) - (self ? 10 : 8) });
    });

    // The front: the officers' whistles before a wave goes over the top (yours carry across the
    // line, the enemy's are a warning), shovels where men are digging in, sandbags thumping down.
    on('squad:whistle', (e) => {
      const mine = this.getEntity(this.listenerId)?.team === e.team;
      const pos = { x: e.x, y: 0, z: e.z };
      if (mine) this.play('squad.whistle', { tier: Tier.COMBAT, pos, radius: 220, gainDb: 0 });
      else this.play('squad.whistle_threat', { tier: Tier.THREAT, pos, radius: 160, gainDb: -2 });
    });
    const digging = new Map();
    on('fort:dig', (e) => {
      const last = digging.get(e.id) ?? -1;
      if (this.time - last < 0.55) return;   // a spadeful every ~0.6 s
      digging.set(e.id, this.time);
      this.play('dig.spade', { tier: Tier.FOLEY, pos: e.id === this.listenerId ? null : this.posOf(e.id), radius: 22, gainDb: e.id === this.listenerId ? -4 : -6 });
    });
    on('fort:built', (e) => e.kind === 'sandbags' && this.play('impact.body', { tier: Tier.FOLEY, pos: { x: e.x, y: 0, z: e.z }, radius: 26, intensity: 1, gainDb: -3 }));

    // Artillery: a gun's report carries across the map (a field gun's deep thump, an AT gun's
    // crack, a rocket salvo's ripple of whooshes); impacts rumble from far away, duller the
    // further off they are.
    on('gun:fire', (e) => {
      const pos = { x: e.from[0], y: e.from[1], z: e.from[2] };
      const cue = e.kind === 'at' ? 'artillery.at' : e.kind === 'rockets' ? 'artillery.rocket' : 'artillery.boom';
      this.play(cue, { tier: Tier.WEAPON, pos, radius: e.kind === 'at' ? 420 : 1500, gainDb: e.kind === 'rockets' ? -4 : 0 });
    });
    on('artillery:impact', (e) => this.play('artillery.impact', { tier: Tier.COMBAT, pos: { x: e.point[0], y: e.point[1], z: e.point[2] }, radius: 1500, intensity: Math.min(1.4, (e.radius || 4) / 9) }));

    // Melee: parries are the loudest and most satisfying sound in the game. Don't let anything mask them.
    on('melee:parry', (e) => this.play('melee.parry_burst', { tier: Tier.THREAT, pos: this.posOf(e.defender), gainDb: 2 }));
    on('melee:windup', (e) => this.relation(e.id) === 'enemy' && this.play(e.unblockable ? 'melee.windup_unblockable' : 'melee.windup', { tier: Tier.THREAT, pos: this.posOf(e.id) }));

    // Stratagems: the wrist pad is yours alone (2D); beacons, pods, jets and smoke are out there.
    const mine = (e) => e.id === this.listenerId;
    on('stratagem:open', (e) => mine(e) && this.play('callin.open', { tier: Tier.COMBAT, gainDb: -6 }));
    on('stratagem:arrow', (e) => mine(e) && this.play('callin.arrow', { tier: Tier.COMBAT, intensity: e.code.length, gainDb: -4 }));
    on('stratagem:error', (e) => mine(e) && this.play('callin.error', { tier: Tier.COMBAT, gainDb: -4 }));
    on('stratagem:armed', (e) => mine(e) && this.play('callin.armed', { tier: Tier.COMBAT, gainDb: -2 }));
    on('stratagem:rearmed', (e) => mine(e) && this.play('callin.armed', { tier: Tier.COMBAT, gainDb: -12 }));
    on('stratagem:thrown', (e) => this.play('callin.throw', { tier: Tier.FOLEY, pos: mine(e) ? null : this.posOf(e.id), radius: 18, gainDb: -4 }));
    on('stratagem:beacon', (e) => this.play('callin.beacon', { tier: Tier.COMBAT, pos: at(e.at), radius: 70, gainDb: -2 }));
    on('stratagem:pod', (e) => this.play('callin.pod', { tier: Tier.COMBAT, pos: at(e.at), radius: 500, duration: e.eta }));
    on('stratagem:land', (e) => this.play('artillery.impact', { tier: Tier.COMBAT, pos: at(e.at), radius: 700, intensity: 0.5 }));
    on('stratagem:incoming', (e) => e.first && e.dir && this.play('callin.flyby', { tier: Tier.COMBAT, pos: at(e.from), radius: 1100, duration: 3.6 }));
    on('stratagem:smoke', (e) => this.play('callin.smoke', { tier: Tier.COMBAT, pos: at(e.at), radius: 80, gainDb: -3 }));
    on('stratagem:grab', (e) => mine(e) && this.play('callin.grab', { tier: Tier.COMBAT, gainDb: -2 }));
    // Battle points: a small chime for each thing worth a line on the HUD (not each second on a point),
    // a register for spending them, a swell for the hero.
    on('bp:earn', (e) => mine(e) && e.amount >= 25 && this.play('callin.bp', { tier: Tier.COMBAT, intensity: Math.min(2, e.amount / 100), gainDb: -10 }));
    on('bp:spend', (e) => mine(e) && this.play('callin.buy', { tier: Tier.COMBAT, gainDb: -4 }));
    on('stratagem:instant', (e) => mine(e) && this.play('callin.hero', { tier: Tier.COMBAT, gainDb: -2 }));
  }

  #announceSuper(e) {
    const me = this.getEntity(this.listenerId), src = this.getEntity(e.id);
    if (!me || !src) return;
    const dx = src.position.x - me.position.x, dz = src.position.z - me.position.z;
    if (Math.hypot(dx, dz) > (e.audio?.radius ?? 120)) return;
    this.play('ui.enemy_super_stinger', { tier: Tier.THREAT, gainDb: 1 });
    this.play(`vo.${e.audio?.voEnemy ?? 'super_incoming'}`, { tier: Tier.THREAT });
    this.onSuperWarning({ ability: e.ability, angle: Math.atan2(-dx, -dz) });
  }
}

// ---------------------------------------------------------------- SynthBackend
// WebAudio placeholder. It generates a recognizable sound from the ability signature, so
// designers can play-test readability before the sound team delivers assets.
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const noteHz = (n) => { const m = /^([A-G]#?)(-?\d)$/.exec(n ?? 'A4'); return m ? 440 * 2 ** ((NOTE[m[1]] + (+m[2] - 4) * 12 - 9) / 12) : 440; };

export class SynthBackend {
  constructor(ctx = new AudioContext()) {
    this.ctx = ctx;
    this.buses = {};
    for (const b of ['master', 'music', 'ambient', 'sfx']) {
      this.buses[b] = ctx.createGain();
      this.buses[b].connect(b === 'master' ? ctx.destination : this.buses.master);
    }
  }
  setBusGain(bus, db, ramp) { const g = this.buses[bus]?.gain; g?.setTargetAtTime(10 ** (db / 20), this.ctx.currentTime, ramp / 3); }
  setListener(pos, yaw) {
    const l = this.ctx.listener;
    if (pos) this.lp = { x: pos.x, y: pos.y, z: pos.z };
    if (!pos || !l.positionX) return;
    l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
    l.forwardX.value = -Math.sin(yaw); l.forwardZ.value = -Math.cos(yaw);
  }
  play(cue, { pos, gainDb = 0, sig, loop, radius = 45, tier, intensity = 1, duration }) {
    const kind = cue.slice(0, cue.indexOf('.'));
    if (kind === 'foot' || kind === 'impact' || kind === 'cloth' || kind === 'gear' || kind === 'dig') return this.#foley(kind, cue, { pos, gainDb, radius, intensity });
    if (cue.startsWith('squad.whistle')) return this.#whistle({ pos, gainDb, radius, threat: cue.endsWith('_threat') });
    if (kind === 'artillery') return this.#artillery(cue.slice(10), { pos, gainDb, radius, intensity, duration });
    if (kind === 'callin') return this.#callin(cue.slice(7), { pos, gainDb, radius, intensity, duration });
    if (cue.startsWith('ui.hit_')) return this.#hitConfirm(cue.slice(7), gainDb);
    const ctx = this.ctx, t = ctx.currentTime;
    const threat = cue.includes('_threat') || tier === 0;
    const freq = noteHz(sig?.root) * (threat ? 1 : 2);   // threats sit an octave lower, so they're heavier
    const osc = ctx.createOscillator();
    osc.type = /brass|roar|saw|grind|jet|buzz/.test(sig?.timbre ?? '') ? 'sawtooth' : /bell|chime|harp|crystal|glass|ping/.test(sig?.timbre ?? '') ? 'sine' : /drone|sub|thrum|quake|black|implosion/.test(sig?.timbre ?? '') ? 'triangle' : 'square';
    osc.frequency.setValueAtTime(freq, t);
    // Void cues sweep down and Solari cues sweep up: the faction can be read from pitch direction alone.
    const voidish = /dark|rev|void|tritone|minor|abyss|psi|grav|sub/.test(sig?.timbre ?? '');
    osc.frequency.exponentialRampToValueAtTime(freq * (voidish ? 0.7 : 1.5), t + 0.25);
    const g = ctx.createGain();
    const peak = 10 ** ((gainDb - (threat ? 6 : 12)) / 20);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + (threat ? 0.005 : 0.02)); // threat = sharper transient
    if (!loop) g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    let node = g;
    if (pos) {
      const p = ctx.createPanner();
      Object.assign(p, { panningModel: 'HRTF', distanceModel: 'linear', refDistance: 2, maxDistance: radius, rolloffFactor: 1 });
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      g.connect(p); node = p;
    }
    osc.connect(g);
    node.connect(this.buses.sfx);
    osc.start(t);
    const h = { osc, ended: false };
    if (!loop) { osc.stop(t + 0.4); osc.onended = () => (h.ended = true); }
    return h;
  }
  stop(h) { try { h.osc.stop(); } catch { /* already stopped */ } h.ended = true; }

  /**
   * Artillery from noise and oscillators:
   *  * boom: a field gun's report, a low-passed noise burst and a sub thump, long tail;
   *  * at: an AT gun's sharp crack over a short boom;
   *  * rocket: a band-passed whoosh rising as the rocket leaves;
   *  * whistle: an incoming round, falling from 1.7 kHz to 600 Hz over the time to impact, louder
   *    as it comes;
   *  * impact: the burst and its rumble. Far away it's only a dull thud (the high end is filtered
   *    off with distance).
   */
  #artillery(kind, { pos, gainDb = 0, radius = 1500, intensity = 1, duration = 2 }) {
    const ctx = this.ctx, t = ctx.currentTime;
    this.noise ??= (() => {
      const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return b;
    })();
    const dist = pos && this.lp ? Math.hypot(pos.x - this.lp.x, pos.y - this.lp.y, pos.z - this.lp.z) : 0;
    const near = Math.max(0, 1 - dist / radius);
    const out = ctx.createGain();
    out.gain.value = 10 ** ((gainDb - 8) / 20) * (0.25 + 0.75 * near) * intensity;
    let node = out;
    if (pos) {
      const p = ctx.createPanner();
      Object.assign(p, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 12, maxDistance: radius, rolloffFactor: 0.6 });
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      out.connect(p); node = p;
    }
    node.connect(this.buses.sfx);
    const src = (len) => { const n = ctx.createBufferSource(); n.buffer = this.noise; n.loop = true; n.start(t, Math.random()); n.stop(t + len); return n; };
    const env = (g, a, peak, len) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + len); };
    let end = 1;
    if (kind === 'whistle') {
      end = Math.max(0.4, duration);
      const o = ctx.createOscillator(), lfo = ctx.createOscillator(), depth = ctx.createGain(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(1700, t); o.frequency.exponentialRampToValueAtTime(600, t + end);
      lfo.frequency.value = 7; depth.gain.value = 18; lfo.connect(depth); depth.connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + end * 0.95); g.gain.linearRampToValueAtTime(0, t + end);
      o.connect(g); g.connect(out); o.start(t); lfo.start(t); o.stop(t + end); lfo.stop(t + end);
    } else if (kind === 'rocket') {
      end = 0.8;
      const n = src(end), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = 'bandpass'; bp.Q.value = 1.2; bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(2600, t + end);
      env(g, 0.04, 0.9, end);
      n.connect(bp); bp.connect(g); g.connect(out);
    } else {
      // boom / at / impact: a filtered noise burst plus a falling sub thump.
      const crack = kind === 'at', burst = kind === 'impact';
      end = burst ? 2.2 : crack ? 0.8 : 1.6;
      const n = src(end), lp = ctx.createBiquadFilter(), g = ctx.createGain();
      lp.type = 'lowpass';
      const top = (burst ? 1400 : crack ? 3200 : 700) * (0.3 + 0.7 * near) + 120;
      lp.frequency.setValueAtTime(top, t); lp.frequency.exponentialRampToValueAtTime(burst ? 140 : 180, t + end);
      env(g, crack ? 0.002 : 0.006, crack ? 1 : 0.9, end);
      n.connect(lp); lp.connect(g); g.connect(out);
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(burst ? 62 : 55, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.5);
      env(og, 0.004, burst ? 1 : 0.8, 0.6);
      o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.65);
    }
    const h = { osc: null, ended: false };
    setTimeout(() => { h.ended = true; out.disconnect(); }, (end + 0.2) * 1000);
    h.osc = { stop: () => { try { out.disconnect(); } catch { /* gone */ } } };
    return h;
  }

  /**
   * Call-ins, from oscillators and noise: the wrist pad (open: a rising blip; arrow: a short
   * square beep a whole tone higher per key typed; error: a double buzz; armed: a three-note
   * chime), the beacon (a bright ping as it plants, then short beeps), a drop pod's roar rising
   * to the impact, the strike jet (a roaring, falling band of noise over a turbine whine and a
   * sub rumble), the smoke canister (a pop, then a hiss), a supply grab (two clacks: two mags).
   */
  #callin(kind, { pos, gainDb = 0, radius = 60, intensity = 1, duration = 1.3 }) {
    const ctx = this.ctx, t = ctx.currentTime;
    this.noise ??= (() => {
      const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return b;
    })();
    const out = ctx.createGain();
    out.gain.value = 10 ** ((gainDb - 10) / 20);
    let node = out;
    if (pos) {
      const far = kind === 'pod' || kind === 'flyby', p = ctx.createPanner();
      Object.assign(p, { panningModel: far ? 'equalpower' : 'HRTF', distanceModel: far ? 'inverse' : 'linear', refDistance: far ? (kind === 'flyby' ? 40 : 15) : 2, maxDistance: radius, rolloffFactor: far ? 0.8 : 1 });
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      out.connect(p); node = p;
    }
    node.connect(this.buses.sfx);
    const env = (g, at, a, peak, len) => { g.gain.setValueAtTime(0.0001, t + at); g.gain.exponentialRampToValueAtTime(peak, t + at + a); g.gain.exponentialRampToValueAtTime(0.0001, t + at + len); };
    const tone = (type, f0, f1, at, len, peak = 1, attack = 0.004) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t + at);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + at + len);
      env(g, at, attack, peak, len);
      o.connect(g); g.connect(out); o.start(t + at); o.stop(t + at + len + 0.02);
      return g;
    };
    const hiss = (type, f0, f1, at, len, q = 1) => {
      const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      n.buffer = this.noise; n.loop = true;
      f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t + at); f.frequency.exponentialRampToValueAtTime(f1, t + at + len);
      n.connect(f); f.connect(g); g.connect(out); n.start(t + at, Math.random()); n.stop(t + at + len + 0.02);
      return g;
    };
    let end = 0.3;
    if (kind === 'open') { tone('sine', 660, 990, 0, 0.07, 0.6); end = 0.1; }
    else if (kind === 'arrow') { const f = 520 * 2 ** ((Math.max(1, intensity) - 1) / 6); tone('square', f, f, 0, 0.05, 0.3); tone('sine', f * 2, f * 2, 0, 0.04, 0.2); end = 0.08; }
    else if (kind === 'error') { tone('sawtooth', 150, 140, 0, 0.09, 0.6); tone('sawtooth', 150, 132, 0.12, 0.13, 0.6); end = 0.27; }
    else if (kind === 'armed') { [880, 1175, 1568].forEach((f, i) => tone('sine', f, f, i * 0.055, 0.14, 0.5)); end = 0.32; }
    else if (kind === 'throw') { env(hiss('bandpass', 1800, 420, 0, 0.22, 1.4), 0, 0.03, 0.5, 0.22); end = 0.25; }
    else if (kind === 'beacon') { tone('sine', 2093, 2093, 0, 0.35, 0.6); tone('sine', 3136, 3136, 0, 0.18, 0.25); end = 0.4; }
    else if (kind === 'beep') { tone('sine', 1760, 1760, 0, 0.05, 0.45); end = 0.07; }
    else if (kind === 'pod') {
      // The roar climbs to the impact and stops dead on it.
      end = Math.max(0.6, duration);
      const g = hiss('lowpass', 280, 2600, 0, end, 0.9);
      g.gain.setValueAtTime(0.02, t); g.gain.exponentialRampToValueAtTime(1, t + end * 0.97); g.gain.linearRampToValueAtTime(0, t + end);
      tone('triangle', 55, 85, 0, end, 0.7, end * 0.95);
    } else if (kind === 'flyby') {
      end = Math.max(1.5, duration);
      const g = hiss('bandpass', 2600, 480, 0, end, 0.8);
      g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(1, t + end * 0.18); g.gain.exponentialRampToValueAtTime(0.0001, t + end);
      tone('sawtooth', 920, 410, 0, end, 0.12, end * 0.18);
      tone('sine', 48, 34, 0, end * 0.8, 0.8, end * 0.15);
    } else if (kind === 'smoke') {
      env(hiss('lowpass', 900, 300, 0, 0.08), 0, 0.002, 1, 0.08);
      env(hiss('highpass', 2600, 4200, 0.03, 1.6), 0.03, 0.08, 0.35, 1.6);
      end = 1.7;
    } else if (kind === 'grab') {
      for (const at of [0, 0.13]) { env(hiss('highpass', 2200, 1800, at, 0.05), at, 0.001, 0.8, 0.05); tone('sine', 180, 110, at, 0.1, 0.6); }
      end = 0.3;
    } else if (kind === 'bp') {
      // Up a fifth; a bigger award rings a little longer.
      tone('sine', 1318, 1318, 0, 0.08, 0.35); tone('sine', 1975, 1975, 0.055, 0.1 + 0.06 * intensity, 0.28);
      end = 0.3;
    } else if (kind === 'buy') {
      tone('triangle', 784, 784, 0, 0.06, 0.5); tone('triangle', 1175, 1175, 0.05, 0.11, 0.45); tone('sine', 98, 70, 0, 0.2, 0.6);
      end = 0.25;
    } else if (kind === 'hero') {
      env(hiss('bandpass', 400, 3200, 0, 0.9, 1.2), 0, 0.3, 0.6, 0.9);
      [523, 659, 784, 1046].forEach((f, i) => tone('sawtooth', f, f, i * 0.08, 0.5, 0.16));
      tone('sine', 65, 98, 0, 0.9, 0.7, 0.25);
      end = 1.0;
    }
    const h = { osc: null, ended: false };
    setTimeout(() => { h.ended = true; try { out.disconnect(); } catch { /* gone */ } }, (end + 0.2) * 1000);
    h.osc = { stop: () => { try { out.disconnect(); } catch { /* gone */ } } };
    return h;
  }

  /**
   * Hit confirms, each its own shape so you can tell them apart without looking: a hit is a
   * crisp tick, a headshot a bright double ping, a kill a thump under a ring, armor that shrugs a
   * round off a dull low plink, a shield breaking a glassy crack, a teammate a sour two-tone.
   */
  #hitConfirm(kind, gainDb) {
    const ctx = this.ctx, t = ctx.currentTime;
    this.noise ??= (() => { const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; })();
    const out = ctx.createGain();
    out.gain.value = 10 ** ((gainDb - 12) / 20);
    out.connect(this.buses.sfx);
    const tone = (type, f0, f1, at, len, peak) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t + at); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + at + len);
      g.gain.setValueAtTime(0.0001, t + at); g.gain.exponentialRampToValueAtTime(peak, t + at + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + at + len);
      o.connect(g); g.connect(out); o.start(t + at); o.stop(t + at + len + 0.02);
    };
    const click = (type, f, at, len, peak) => {
      const n = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
      n.buffer = this.noise; fl.type = type; fl.frequency.value = f;
      g.gain.setValueAtTime(peak, t + at); g.gain.exponentialRampToValueAtTime(0.0001, t + at + len);
      n.connect(fl); fl.connect(g); g.connect(out); n.start(t + at, Math.random() * 0.5, len + 0.02);
    };
    let end = 0.12;
    if (kind === 'kill') { tone('sine', 170, 90, 0, 0.16, 1); tone('triangle', 1320, 1320, 0.01, 0.22, 0.4); click('highpass', 2500, 0, 0.03, 0.8); end = 0.26; }
    else if (kind === 'head') { tone('sine', 2400, 2400, 0, 0.06, 0.6); tone('sine', 3200, 3200, 0.05, 0.08, 0.5); end = 0.15; }
    else if (kind === 'plink') { tone('triangle', 420, 300, 0, 0.07, 0.6); click('lowpass', 600, 0, 0.04, 0.6); end = 0.1; }
    else if (kind === 'shieldbreak') { click('bandpass', 3800, 0, 0.12, 1); tone('sine', 1900, 950, 0, 0.14, 0.4); end = 0.18; }
    else if (kind === 'friendly') { tone('square', 520, 520, 0, 0.07, 0.35); tone('square', 390, 390, 0.08, 0.1, 0.35); end = 0.2; }
    else { click('highpass', 3200, 0, 0.025, 1); tone('sine', 1500, 1300, 0, 0.03, 0.35); end = 0.06; }
    const h = { osc: { stop: () => { try { out.disconnect(); } catch { /* gone */ } } }, ended: false };
    setTimeout(() => { h.ended = true; try { out.disconnect(); } catch { /* gone */ } }, (end + 0.15) * 1000);
    return h;
  }

  /**
   * A pea whistle: a shrill tone around 2.8 kHz warbled ~28 times a second by the pea, two long
   * blasts. The enemy's is pitched lower and rougher, so you know whose wave is coming.
   */
  #whistle({ pos, gainDb, radius, threat }) {
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 10 ** ((gainDb - 14) / 20);
    let node = out;
    if (pos) {
      const p = ctx.createPanner();
      Object.assign(p, { panningModel: 'HRTF', distanceModel: 'linear', refDistance: 6, maxDistance: radius, rolloffFactor: 1 });
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      out.connect(p); node = p;
    }
    node.connect(this.buses.sfx);
    const osc = ctx.createOscillator(), trill = ctx.createOscillator(), depth = ctx.createGain(), env = ctx.createGain();
    osc.type = threat ? 'sawtooth' : 'sine';
    osc.frequency.value = threat ? 2300 : 2800;
    trill.frequency.value = 28; depth.gain.value = threat ? 260 : 180;
    trill.connect(depth); depth.connect(osc.frequency);
    env.gain.setValueAtTime(0, t);
    for (const [a, b] of [[0, 0.55], [0.75, 1.6]]) {      // two blasts: the second one long
      env.gain.linearRampToValueAtTime(1, t + a + 0.02);
      env.gain.setValueAtTime(1, t + b - 0.04);
      env.gain.linearRampToValueAtTime(0, t + b);
    }
    osc.connect(env); env.connect(out);
    osc.start(t); trill.start(t); osc.stop(t + 1.7); trill.stop(t + 1.7);
    const h = { osc, ended: false };
    osc.onended = () => { h.ended = true; out.disconnect(); };
    return h;
  }

  /**
   * Noise-based foley: footsteps are a filtered noise transient plus a low pitch-dropping thump
   * (the weight), impacts are longer and darker, cloth is a band-passed rustle, gear is a short
   * bright clank. Surface sets the filter: dirt dull, wood mid, metal bright.
   */
  #foley(kind, cue, { pos, gainDb, radius, intensity }) {
    const ctx = this.ctx, t = ctx.currentTime;
    this.noise ??= (() => {
      const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return b;
    })();
    const surface = cue.split('.')[1];
    const bright = { metal: 3200, wood: 1600, concrete: 2000, dirt: 900 }[surface] ?? 1200;
    const spec = kind === 'foot' ? { type: 'lowpass', f: bright, q: 0.8, attack: 0.002, decay: 0.07 + 0.06 * intensity, thump: 70 + 30 * intensity, thumpGain: 0.9 * intensity }
      : kind === 'impact' ? { type: 'lowpass', f: 700, q: 0.7, attack: 0.003, decay: 0.28, thump: 52, thumpGain: 1.1 }
      : kind === 'cloth' ? { type: 'bandpass', f: 1900, q: 0.9, attack: 0.025, decay: 0.12 + 0.2 * intensity, thump: 0, thumpGain: 0 }
      : kind === 'dig' ? { type: 'bandpass', f: 1300, q: 1.1, attack: 0.012, decay: 0.24, thump: 95, thumpGain: 0.45 }   // spade bites, earth thrown
      : { type: 'highpass', f: 3500, q: 1.5, attack: 0.001, decay: 0.05, thump: 0, thumpGain: 0 };
    const out = ctx.createGain();
    out.gain.value = 10 ** ((gainDb - 8) / 20);
    let node = out;
    if (pos) {
      const p = ctx.createPanner();
      Object.assign(p, { panningModel: 'HRTF', distanceModel: 'linear', refDistance: 1.5, maxDistance: radius, rolloffFactor: 1 });
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      out.connect(p); node = p;
    }
    node.connect(this.buses.sfx);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filt = ctx.createBiquadFilter();
    filt.type = spec.type; filt.frequency.value = spec.f; filt.Q.value = spec.q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + spec.attack);
    env.gain.exponentialRampToValueAtTime(0.001, t + spec.attack + spec.decay);
    src.connect(filt); filt.connect(env); env.connect(out);
    src.start(t, Math.random() * 0.5, spec.attack + spec.decay + 0.05);
    const h = { osc: src, ended: false };
    src.onended = () => { h.ended = true; out.disconnect(); };
    if (spec.thump) {
      // The weight: a sine that drops in pitch, so heavy steps land as a felt thud.
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(spec.thump, t);
      o.frequency.exponentialRampToValueAtTime(spec.thump * 0.55, t + 0.09);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(spec.thumpGain, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12 + (kind === 'impact' ? 0.12 : 0));
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.3);
    }
    return h;
  }
}

/** Howler backend sketch: cue id -> sprite in a faction atlas. Falls back to synth if a cue is missing. */
export class HowlerBackend {
  constructor(Howl, manifest, fallback) { this.Howl = Howl; this.manifest = manifest; this.fallback = fallback; this.sounds = new Map(); }
  play(cue, opts) {
    const m = this.manifest[cue];
    if (!m) return this.fallback?.play(cue, opts) ?? null;
    let s = this.sounds.get(m.src);
    if (!s) { s = new this.Howl({ src: [m.src], sprite: m.sprite }); this.sounds.set(m.src, s); }
    const id = s.play(m.spriteKey);
    s.volume(10 ** ((opts.gainDb ?? 0) / 20), id);
    s.loop(!!opts.loop, id);
    if (opts.pos) { s.pos(opts.pos.x, opts.pos.y, opts.pos.z, id); s.pannerAttr({ panningModel: 'HRTF', maxDistance: opts.radius, distanceModel: 'linear' }, id); }
    const h = { s, id, ended: false };
    s.once('end', () => (h.ended = true), id);
    return h;
  }
  stop(h) { h.s?.stop(h.id); h.ended = true; }
  setBusGain() { /* Howler has no buses; route through Howler.ctx gain nodes in production */ }
}
