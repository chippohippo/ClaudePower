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
//  8. Foley is animation-driven. Footsteps, cloth and body impacts play only from the rig's
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
const IMPACT_RADIUS = { diveLand: 30, slide: 24, proneDrop: 16, body: 30, land: 28, hands: 14 };

export class AudioDirector {
  /**
   * @param {object} backend   { play(cue, opts) -> handle, stop(handle), setBusGain(bus, db, rampSec), setListener(pos, yaw) }
   * @param {object} opts      { listenerId, getEntity(id) -> { team, position }, abilityIndex: Map(abilityId -> def), uiArrow(fn) }
   */
  constructor(backend, { listenerId, getEntity, abilityIndex = new Map(), onSuperWarning = () => {} } = {}) {
    this.backend = backend;
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
  play(cue, { tier = Tier.COMBAT, pos = null, gainDb = 0, sig = null, loopKey = null, radius = 45, family, intensity } = {}) {
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
    const h = this.backend.play(cue, { pos, gainDb, sig, loop: !!loopKey, radius, family, tier, intensity });
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
    on('weapon:fire', (e) => this.play(`${e.audio ?? 'gun'}.fire${this.relation(e.id) === 'self' ? '_1p' : ''}`, { tier: Tier.WEAPON, pos: e.id === this.listenerId ? null : this.posOf(e.id), radius: e.suppressed ? 15 : 90, gainDb: e.lowAmmo && e.id === this.listenerId ? 0 : -1 }));
    on('weapon:empty', (e) => e.id === this.listenerId && this.play('ui.mag_empty_click', { tier: Tier.COMBAT, gainDb: -4 }));
    on('weapon:overheat', (e) => this.play('weapon.overheat_vent', { tier: Tier.COMBAT, pos: e.id === this.listenerId ? null : this.posOf(e.id) }));
    on('weapon:perfectVent', (e) => e.id === this.listenerId && this.play('ui.perfect_vent', { tier: Tier.COMBAT }));
    on('weapon:hit', (e) => {
      if (e.attacker === this.listenerId) this.play(e.zone === 'head' ? 'ui.hit_head' : e.shieldBroke ? 'ui.hit_shieldbreak' : `ui.hit_${e.armor}`, { tier: Tier.COMBAT, gainDb: -2 });
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

    // Melee: parries are the loudest and most satisfying sound in the game. Don't let anything mask them.
    on('melee:parry', (e) => this.play('melee.parry_burst', { tier: Tier.THREAT, pos: this.posOf(e.defender), gainDb: 2 }));
    on('melee:windup', (e) => this.relation(e.id) === 'enemy' && this.play(e.unblockable ? 'melee.windup_unblockable' : 'melee.windup', { tier: Tier.THREAT, pos: this.posOf(e.id) }));
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
    if (!pos || !l.positionX) return;
    l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
    l.forwardX.value = -Math.sin(yaw); l.forwardZ.value = -Math.cos(yaw);
  }
  play(cue, { pos, gainDb = 0, sig, loop, radius = 45, tier, intensity = 1 }) {
    const kind = cue.slice(0, cue.indexOf('.'));
    if (kind === 'foot' || kind === 'impact' || kind === 'cloth' || kind === 'gear') return this.#foley(kind, cue, { pos, gainDb, radius, intensity });
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
