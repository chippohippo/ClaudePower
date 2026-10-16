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
//
// The backend is pluggable: HowlerBackend for real assets, SynthBackend (WebAudio oscillators
// from each ability's signature) so the prototype is fully audible before any assets exist.

import { bus } from '../core/EventBus.js';

export const Tier = Object.freeze({ THREAT: 0, COMBAT: 1, WEAPON: 2, AMBIENT: 3 });
const VOICE_LIMITS = { 0: 16, 1: 24, 2: 24, 3: 12 };

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
    this.voices = { 0: [], 1: [], 2: [], 3: [] };
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
  play(cue, { tier = Tier.COMBAT, pos = null, gainDb = 0, sig = null, loopKey = null, radius = 45, family } = {}) {
    // Voice management: steal the oldest voice in the same tier, except in THREAT, where the
    // limit is generous and nothing is ever stolen.
    const list = this.voices[tier];
    if (list.length >= VOICE_LIMITS[tier]) {
      if (tier === Tier.THREAT) return null;
      this.backend.stop(list.shift());
    }
    const h = this.backend.play(cue, { pos, gainDb, sig, loop: !!loopKey, radius, family, tier });
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
  play(cue, { pos, gainDb = 0, sig, loop, radius = 45, tier }) {
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
