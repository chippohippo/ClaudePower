// WeaponSystem: ranged weapons in the simulation.
//
// Like Movement and Melee it is pure simulation. It reads Commands, mutates plain state and
// emits `weapon:*` events. The world is injected so the same code runs on the server, in
// client prediction and for bots:
//   world.raycast(origin, dir, maxDist, ignoreId) -> { entity?, point, normal, distance, zone, surface } | null
//   world.spawnProjectile(spec)                  (ProjectileSystem below implements this)
//
// Determinism: all randomness (spread, recoil jitter, pellets) comes from a seeded RNG keyed by
// (entityId, shotIndex). The server can re-create the exact spread a client predicted.
//
// Aim: aimYaw/aimPitch = command look angles + recoil offset. The offset is part of the sim
// state, recovers over time and is what the camera renders.

import { Vector3 } from 'three';
import { bus } from '../../core/EventBus.js';
import { computeDamage } from './WeaponDefs.js';
import { angleDelta, hyp } from '../../core/geom.js';

const DEG = Math.PI / 180;
const HIGH = 45;               // m above the tallest ground: nothing up there for a shell to hit (flyers stay below 35 m)
const _dir = new Vector3();
const _origin = new Vector3();
const _right = new Vector3();
const _up = new Vector3();

/** mulberry32 seeded from (a, b). Small, fast and identical on every JS engine. */
export function rng(a, b) {
  let t = (a * 2654435761) ^ (b * 1597334677);
  return () => {
    t |= 0; t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export const WeaponPhase = Object.freeze({
  READY: 'ready', SWAPPING: 'swapping', RELOADING: 'reloading', VENTING: 'venting',
  OVERHEATED: 'overheated', CHARGING: 'charging', SPRINT_RECOVER: 'sprintRecover',
});

/** Runtime state for one equipped weapon instance. */
export class WeaponInstance {
  constructor(stats, recoilDefs) {
    this.s = stats;
    this.recoil = recoilDefs[stats.recoil] ?? { pattern: [[0.5, 0]], loopFrom: 0, jitter: [0, 0], recovery: 10, firstShotMul: 1, visualKick: 0.5 };
    this.mag = stats.mag ?? 0;
    this.reserve = stats.reserve ?? 0;
    this.heat = 0;                     // heat-ammo weapons
    this.battery = stats.ammo?.max ?? 0;
    this.chambered = true;             // pump/bolt cycling
  }
  get usesHeat() { return this.s.ammo?.kind === 'heat'; }
  get usesBattery() { return this.s.ammo?.kind === 'battery'; }
}

export class WeaponComponent {
  /**
   * @param {object} owner { id, team, movement, melee?, health }
   * @param {WeaponInstance[]} loadout
   */
  constructor(owner, loadout, world) {
    this.owner = owner;
    this.world = world;
    this.loadout = loadout;
    this.index = 0;
    this.phase = WeaponPhase.READY;
    this.phaseTime = 0;
    this.phaseDuration = 0;
    this.cooldown = 0;           // time until next shot allowed
    this.shotIndex = 0;          // global, for deterministic RNG
    this.burstLeft = 0;
    this.consecutive = 0;        // shots in current spray (recoil pattern index)
    this.sinceShot = 99;
    this.bloom = 0;              // extra spread (deg) from sustained fire
    this.ads = 0;                // 0..1 blend
    this.charge = 0;             // charge/spool
    this.spool = 0;
    this.recoilPitch = 0;        // current aim offset (rad)
    this.recoilYaw = 0;
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.weaponYaw = null;       // HD2 ergonomics: where the gun points (lags the camera aim)
    this.weaponPitch = 0;
    this.activeReloadWindow = null; // { start, end } fraction of vent/reload for perfect timing
    this.buffs = { damageMul: 1, rpmMul: 1, reloadMul: 1, spreadMul: 1, until: 0 };
    this.time = 0;
    this.prevFire = false;
    this.beamTarget = null;
    this.beamTime = 0;
  }

  get current() { return this.loadout[this.index]; }

  update(cmd, dt) {
    const w = this.current;
    if (!w) return;
    const s = w.s;
    const b = cmd.buttons;
    const mv = this.owner.movement.state;
    this.time += dt;
    this.phaseTime += dt;
    // Allow a slightly negative cooldown so leftover time carries into the next shot. Without it,
    // a 60 Hz tick would quantize 720 rpm down to 600.
    this.cooldown = Math.max(-dt, this.cooldown - dt);
    this.sinceShot += dt;
    if (this.buffs.until && this.time > this.buffs.until) this.buffs = { damageMul: 1, rpmMul: 1, reloadMul: 1, spreadMul: 1, until: 0 };

    // ADS blends with weapon-specific timing. Guarding with a sword reuses the same button,
    // so ADS only applies while a gun is the active weapon (the class/loadout layer decides that).
    // HD2: aiming or firing out of a sprint cancels the sprint (the gun comes up after sprintToFire).
    if (mv.sprinting && (b.light?.down || b.guard?.down)) mv.locks.sprint = Math.max(mv.locks.sprint, 0.35);
    if (mv.diveStarted) this.ads = 0; // diving drops ADS; hip fire stays available through the dive
    const wantAds = !!b.guard?.down && !mv.sprinting && mv.mode !== 'dive' && mv.mode !== 'knockdown' && mv.mode !== 'ragdoll' && !mv.downed && this.phase !== WeaponPhase.SWAPPING;
    const adsRate = 1 / Math.max(0.05, s.ads?.time ?? 0.25);
    this.ads = Math.max(0, Math.min(1, this.ads + (wantAds ? adsRate : -adsRate * 1.3) * dt));
    mv.speedScale = Math.min(mv.speedScale, 1 - (1 - (s.ads?.moveMul ?? 0.7)) * this.ads);

    this.#recoverRecoil(w, dt, !!b.light?.down);
    this.#passiveHeat(w, dt);
    // HD2 ergonomics: the weapon's aim chases the camera's aim with a time constant set by the gun's
    // ergonomics (light guns snap, heavy guns drag), so the second reticle trails fast turns. Prone
    // clamps the gun to an arc around the body (mv.aimYaw).
    const targetYaw = mv.aimYaw ?? cmd.yaw;
    if (this.weaponYaw === null) { this.weaponYaw = targetYaw; this.weaponPitch = cmd.pitch; }
    const ergo = s.handling?.ergonomics ?? 60;
    const follow = 1 - Math.exp(-(4 + ergo * 0.22) * (1 + this.ads * 0.35) * dt);
    this.weaponYaw += angleDelta(this.weaponYaw, targetYaw) * follow;
    this.weaponPitch += (cmd.pitch - this.weaponPitch) * follow;
    this.aimYaw = this.weaponYaw + this.recoilYaw;
    this.aimPitch = Math.max(-1.5, Math.min(1.5, this.weaponPitch + this.recoilPitch));

    // Sprinting lowers the weapon. Firing out of a sprint costs a short "sprint-to-fire" delay.
    // Reloads keep progressing while sprinting, as in most modern shooters.
    // Weapon lowered: sprinting, climbing, knocked down, getting up or down from prone.
    if (mv.sprinting || mv.weaponReady === false) {
      this.#endBeam();
      if (this.phase === WeaponPhase.RELOADING) return this.#tickReload(w, cmd);
      if (this.phase === WeaponPhase.READY) this.#setPhase(WeaponPhase.SPRINT_RECOVER, s.handling?.sprintToFire ?? 0.2);
      if (this.phase === WeaponPhase.SPRINT_RECOVER) this.phaseTime = 0; // the timer starts once you stop sprinting
      return;
    }

    if (b.swapWeapon?.pressed && this.loadout.length > 1) return this.#swap((this.index + 1) % this.loadout.length);

    switch (this.phase) {
      case WeaponPhase.SWAPPING:
      case WeaponPhase.SPRINT_RECOVER:
        if (this.phaseTime >= this.phaseDuration) this.#setPhase(WeaponPhase.READY);
        return;

      case WeaponPhase.RELOADING:
        return this.#tickReload(w, cmd);

      case WeaponPhase.VENTING:
      case WeaponPhase.OVERHEATED:
        // Active vent: pressing reload inside the sweet spot finishes instantly and buffs damage
        // (Gears-style active reload). Missing it while venting manually jams the vent briefly.
        if (this.phase === WeaponPhase.VENTING && b.reload?.pressed && this.activeReloadWindow) {
          const u = this.phaseTime / this.phaseDuration;
          if (u >= this.activeReloadWindow.start && u <= this.activeReloadWindow.end) {
            w.heat = 0;
            this.buffs = { ...this.buffs, damageMul: 1.15, until: this.time + 4 };
            bus.emit('weapon:perfectVent', { id: this.owner.id });
            return this.#setPhase(WeaponPhase.READY);
          }
          this.phaseDuration += 0.4;
          this.activeReloadWindow = null;
          bus.emit('weapon:ventJam', { id: this.owner.id });
        }
        w.heat = Math.max(0, w.heat * (1 - this.phaseTime / this.phaseDuration));
        if (this.phaseTime >= this.phaseDuration) { w.heat = 0; this.#setPhase(WeaponPhase.READY); bus.emit('weapon:vented', { id: this.owner.id }); }
        return;

      case WeaponPhase.CHARGING:
        this.charge = Math.min(1, this.charge + dt / (s.chargeTime ?? 0.8));
        if (!b.light?.down) {
          if (this.charge >= 1) this.#fire(w, cmd, { chargeMul: 1 });
          else bus.emit('weapon:chargeCancel', { id: this.owner.id });
          this.charge = 0;
          this.#setPhase(WeaponPhase.READY);
        }
        return;

      case WeaponPhase.READY:
      default:
        if (b.reload?.pressed) return this.#startReload(w, false);
        return this.#tickTrigger(w, cmd, dt);
    }
  }

  // ----------------------------------------------------------------- trigger logic per fire mode
  #tickTrigger(w, cmd, dt) {
    const s = w.s;
    const trig = cmd.buttons.light;
    const pressed = !!trig?.pressed, down = !!trig?.down;
    if (!down) { this.consecutive = this.sinceShot > 0.25 ? 0 : this.consecutive; this.spool = Math.max(0, this.spool - dt * 2); }
    if (this.#isEmpty(w)) {
      if (pressed) { bus.emit('weapon:dryFire', { id: this.owner.id }); this.#startReload(w, true); }
      return this.#endBeam();
    }

    switch (s.fireMode) {
      case 'auto':
        if (down && this.cooldown <= 0) this.#fire(w, cmd);
        break;
      case 'semi':
        if (pressed && this.cooldown <= 0) this.#fire(w, cmd);
        break;
      case 'burst':
        if (pressed && this.cooldown <= 0 && this.burstLeft === 0) this.burstLeft = s.burst ?? 3;
        if (this.burstLeft > 0 && this.cooldown <= 0) {
          this.#fire(w, cmd);
          if (--this.burstLeft === 0) this.cooldown = s.burstDelay ?? 0.3;
        }
        break;
      case 'pump':
      case 'bolt':
        // Separate chamber step: the pump/bolt sound and animation play between shots.
        if (pressed && this.cooldown <= 0 && w.chambered) { this.#fire(w, cmd); w.chambered = false; }
        if (!w.chambered && this.cooldown <= 0) { w.chambered = true; bus.emit('weapon:chamber', { id: this.owner.id, style: s.fireMode }); }
        break;
      case 'charge':
        if (pressed && this.cooldown <= 0) { this.charge = 0; this.#setPhase(WeaponPhase.CHARGING); bus.emit('weapon:chargeStart', { id: this.owner.id, time: s.chargeTime }); }
        break;
      case 'spool':
        // Miniguns/LMGs: rpm ramps up while held. Spin-up has its own audio loop.
        if (down) {
          this.spool = Math.min(1, this.spool + dt / (s.spoolTime ?? 0.6));
          if (this.spool > 0.25 && this.cooldown <= 0) this.#fire(w, cmd, { rpmMul: 0.4 + this.spool * 0.6 });
        }
        break;
      case 'beam':
        if (down) this.#tickBeam(w, cmd, dt); else this.#endBeam();
        break;
    }
    this.prevFire = down;
  }

  // ----------------------------------------------------------------- firing
  #fire(w, cmd, { chargeMul = 1, rpmMul = 1 } = {}) {
    const s = w.s;
    const mv = this.owner.movement.state;
    this.shotIndex++;
    const rand = rng(this.owner.id, this.shotIndex);

    // Ammo
    if (w.usesHeat) {
      w.heat += s.ammo.perShot;
      if (w.heat >= s.ammo.max) this.#overheat(w);
    } else if (!w.usesBattery) {
      w.mag--;
    }

    // Spread: base (hip↔ADS) × movement state × bloom. Degrees, converted to a cone.
    const sp = s.spread ?? { hip: 2, ads: 0.3 };
    let spread = sp.hip + (sp.ads - sp.hip) * this.ads;
    const speed = hyp(mv.velocity.x, mv.velocity.z);
    if (!mv.grounded) spread *= sp.airMul ?? 2;
    else if (mv.mode === 'slide') spread *= sp.slideMul ?? 1.4;
    else if (speed > 0.5) spread *= 1 + ((sp.moveMul ?? 1.5) - 1) * Math.min(1, speed / 7);
    if (mv.stance === 'crouch') spread *= 0.8;
    if (mv.stance === 'prone') spread *= 0.6;
    if (w.usesHeat) spread *= 1 + ((sp.heatMul ?? 1) - 1) * (w.heat / s.ammo.max);
    spread = (spread + this.bloom) * this.buffs.spreadMul;
    this.bloom = Math.min(sp.hip, this.bloom + (sp.bloomPerShot ?? 0.12));

    // Muzzle: eye position and aim direction. Third-person converges to the camera's aim point.
    _origin.copy(mv.position); _origin.y += this.owner.muzzleHeight ?? (mv.stance === 'crouch' ? 1.05 : mv.stance === 'prone' ? 0.4 : 1.6); // vehicles set muzzleHeight
    const pellets = s.pellets ?? 1;
    const hits = [];
    for (let i = 0; i < pellets; i++) {
      this.#aimDir(_dir, spread, rand);
      if (s.projectile === 'hitscan' || s.projectile === 'pellets') {
        const hit = this.world.raycast(_origin, _dir, s.range ?? 300, this.owner.id, { ignoreCover: !!s.pierceCover });
        if (hit) hits.push(hit);
        bus.emit('weapon:tracer', { id: this.owner.id, from: _origin.toArray(), dir: _dir.toArray(), dist: hit?.distance ?? 120, style: s.vfx?.tracer, pelletIdx: i });
        if (hit) this.#applyHit(w, hit, chargeMul);
      } else {
        this.world.spawnProjectile({
          ownerId: this.owner.id, team: this.owner.team, weapon: s,
          origin: _origin.clone(), dir: _dir.clone(), speed: s.velocity ?? 120, drop: s.drop ?? 0,
          damageMul: chargeMul * this.buffs.damageMul, deflectable: !!s.deflectable, splash: s.damage?.splash ?? 0, onHit: s.onHit,
        });
      }
    }

    // Fire-rate timing
    const rpm = (s.rpm ?? 600) * rpmMul * this.buffs.rpmMul;
    this.cooldown = Math.min(0, this.cooldown) + 60 / rpm;
    this.#kick(w, rand);
    this.sinceShot = 0;
    this.consecutive++;

    bus.emit('weapon:fire', {
      id: this.owner.id, weaponId: s.id, audio: s.audio, muzzle: s.vfx?.muzzle,
      ads: this.ads, heat: w.usesHeat ? w.heat / s.ammo.max : 0, lowAmmo: !w.usesHeat && w.mag <= Math.ceil((s.mag ?? 1) * 0.2),
      shake: (w.recoil.visualKick ?? 0.5) * 0.06 * (1 - this.ads * 0.5),
      suppressed: s.minimapOnFire === false,
    });
    // Point-blank flinch on melee wind-ups (shotguns are the counter to flame knights).
    for (const h of hits) if (h.entity?.melee && h.distance < 6 && s.damage?.poise) h.entity.melee.interruptByGun(s.damage.poise / pellets);
    if (!w.usesHeat && !w.usesBattery && w.mag <= 0) bus.emit('weapon:empty', { id: this.owner.id });
  }

  #applyHit(w, hit, chargeMul) {
    const e = hit.entity;
    if (!e) { bus.emit('weapon:impact', { point: hit.point, normal: hit.normal, surface: hit.surface, style: w.s.vfx?.impact }); return; }
    if (e.team === this.owner.team) return;
    if (e.movement?.state.invulnerable) { bus.emit('weapon:iframeWhiff', { victim: e.id }); return; }
    const armor = e.health.armorFor?.(hit.zone) ?? 'flesh';
    const dmg = computeDamage(w.s, hit.distance, hit.zone, armor, this.world.damageMatrix ?? {}) * chargeMul * this.buffs.damageMul;
    const res = e.health.damage(dmg, { kind: 'gun', weapon: w.s.id, ammoType: w.s.ammoType, zone: hit.zone }, this.owner);
    e.weapons?.interrupt?.('flinch');
    // Buffs like Devour or Well of Night make rounds apply a status.
    if (this.buffs.onHitStatus) e.status?.apply(this.buffs.onHitStatus, { source: this.owner });
    if (w.s.onHit?.status) e.status?.apply(w.s.onHit.status.id, { stacks: w.s.onHit.status.stacks ?? 1, source: this.owner });
    bus.emit('weapon:hit', {
      attacker: this.owner.id, victim: e.id, damage: dmg, zone: hit.zone, armor,
      shieldBroke: !!res?.shieldBroke, killed: !!res?.killed, point: hit.point,
    });
  }

  // Beam weapons: continuous damage with ramp-up (keeping the beam on target is the skill).
  #tickBeam(w, cmd, dt) {
    const s = w.s;
    if (w.battery <= 0) { this.#endBeam(); return bus.emit('weapon:dryFire', { id: this.owner.id }); }
    w.battery = Math.max(0, w.battery - s.ammo.drainPerSec * dt);
    this.#aimDir(_dir, 0, Math.random);
    _origin.copy(this.owner.movement.state.position); _origin.y += this.owner.muzzleHeight ?? 1.6;
    const hit = this.world.raycast(_origin, _dir, s.range ?? 35, this.owner.id);
    const target = hit?.entity ?? null;
    this.beamTime = target && target === this.beamTarget ? this.beamTime + dt : 0;
    if (!this.beamTarget && !this._beamOn) { this._beamOn = true; bus.emit('weapon:beamStart', { id: this.owner.id }); }
    this.beamTarget = target;
    if (target && target.team !== this.owner.team) {
      const ramp = 1 + ((s.damage.rampMul ?? 1) - 1) * Math.min(1, this.beamTime / (s.damage.rampUp ?? 1));
      const armor = target.health.armorFor?.(hit.zone) ?? 'flesh';
      const mul = this.world.damageMatrix?.[s.ammoType]?.[armor] ?? 1;
      target.health.damage(s.damage.dps * ramp * mul * dt * this.buffs.damageMul, { kind: 'beam', weapon: s.id, ammoType: s.ammoType }, this.owner);
      if (s.onHit?.status) target.status?.apply(s.onHit.status.id, { source: this.owner });
    }
    this.recoilPitch += (w.recoil.pattern[0][0] * DEG) * dt * 10;
    bus.emit('weapon:beam', { id: this.owner.id, end: hit?.point ?? null, ramp: this.beamTime, onTarget: !!target });
  }
  #endBeam() {
    if (this._beamOn) { this._beamOn = false; this.beamTarget = null; this.beamTime = 0; bus.emit('weapon:beamEnd', { id: this.owner.id }); }
  }

  // ----------------------------------------------------------------- recoil
  #kick(w, rand) {
    const r = w.recoil;
    const p = r.pattern;
    let idx = this.consecutive;
    if (idx >= p.length) idx = r.loopFrom + ((idx - p.length) % (p.length - r.loopFrom || 1));
    const [up, side] = p[Math.min(idx, p.length - 1)];
    const first = this.consecutive === 0 ? r.firstShotMul : 1;
    const adsMul = 1 - this.ads * 0.35;                    // ADS tames recoil a bit
    const stanceMul = this.owner.movement.state.stance === 'crouch' ? 0.85 : this.owner.movement.state.stance === 'prone' ? 0.6 : 1;
    const heatMul = this.current.usesHeat ? 1 + ((r.heatMul ?? 1) - 1) * (this.current.heat / this.current.s.ammo.max) : 1;
    const scaleV = this.current.s.recoilScale?.vertical ?? 1;
    const jitterV = (rand() * 2 - 1) * r.jitter[0];
    const jitterH = (rand() * 2 - 1) * r.jitter[1];
    const k = first * adsMul * stanceMul * heatMul;
    this.recoilPitch += (up * scaleV + jitterV) * k * DEG;
    this.recoilYaw -= (side + jitterH) * k * DEG;
    bus.emit('weapon:recoil', { id: this.owner.id, kick: r.visualKick * k });
  }

  #recoverRecoil(w, dt, firing) {
    // Recovery only once you stop shooting, so pulling down against the pattern is the skill.
    // Bloom decays independently.
    this.bloom = Math.max(0, this.bloom - dt * 4);
    if (firing && this.sinceShot < 0.15) return;
    const rec = (w.recoil.recovery ?? 10) * DEG * dt;
    const mag = hyp(this.recoilPitch, this.recoilYaw);
    if (mag <= rec) { this.recoilPitch = 0; this.recoilYaw = 0; return; }
    this.recoilPitch -= (this.recoilPitch / mag) * rec;
    this.recoilYaw -= (this.recoilYaw / mag) * rec;
  }

  #aimDir(out, spreadDeg, rand) {
    const cy = Math.cos(this.aimYaw), sy = Math.sin(this.aimYaw);
    const cp = Math.cos(this.aimPitch), spch = Math.sin(this.aimPitch);
    out.set(-sy * cp, spch, -cy * cp);
    if (spreadDeg <= 0) return out;
    // Uniform disc sample inside the cone. sqrt keeps the distribution even rather than center-heavy.
    const a = rand() * Math.PI * 2;
    const rr = Math.sqrt(rand()) * Math.tan((spreadDeg * DEG) / 2);
    _right.set(cy, 0, -sy);
    _up.crossVectors(_right, out).normalize();
    return out.addScaledVector(_right, Math.cos(a) * rr).addScaledVector(_up, Math.sin(a) * rr).normalize();
  }

  // ----------------------------------------------------------------- reload / heat
  #isEmpty(w) {
    if (w.usesHeat) return false;
    if (w.usesBattery) return w.battery <= 0;
    return w.mag <= 0;
  }

  #startReload(w, empty) {
    const s = w.s;
    if (w.usesHeat) {
      if (w.heat <= 0) return;
      // Manual vent. The perfect-timing window sits at 45-60% of the animation.
      this.activeReloadWindow = { start: 0.45, end: 0.6 };
      this.#setPhase(WeaponPhase.VENTING, (s.ammo.manualVent ?? 1.2) / this.buffs.reloadMul);
      return bus.emit('weapon:ventStart', { id: this.owner.id, duration: this.phaseDuration, window: this.activeReloadWindow });
    }
    if (w.usesBattery || w.mag >= s.mag || w.reserve <= 0) return;
    const r = s.reload ?? { style: 'mag', tactical: 2, empty: 2.5 };
    const dur = r.style === 'shell' ? r.perShell : empty ? r.empty : r.tactical;
    this.reloadStyle = r.style;
    this.#setPhase(WeaponPhase.RELOADING, dur / this.buffs.reloadMul);
    bus.emit('weapon:reloadStart', { id: this.owner.id, style: r.style, empty, duration: this.phaseDuration });
  }

  #tickReload(w, cmd) {
    const s = w.s;
    // Shell reloads can be interrupted by firing (you keep the shells already loaded).
    if (this.reloadStyle === 'shell' && cmd.buttons.light?.pressed && w.mag > 0) { this.#setPhase(WeaponPhase.READY); return this.#tickTrigger(w, cmd, 0); }
    if (this.phaseTime < this.phaseDuration) return;
    if (this.reloadStyle === 'shell') {
      w.mag++; w.reserve--;
      bus.emit('weapon:shellIn', { id: this.owner.id });
      if (w.mag < s.mag && w.reserve > 0) { this.phaseTime = 0; return; }
      w.chambered = true;
    } else {
      // Tactical reload keeps one in the chamber (+1); empty reload does not.
      const need = s.mag - w.mag;
      const take = Math.min(need, w.reserve);
      w.mag += take; w.reserve -= take;
    }
    this.consecutive = 0;
    this.#setPhase(WeaponPhase.READY);
    bus.emit('weapon:reloadEnd', { id: this.owner.id });
  }

  #overheat(w) {
    w.heat = w.s.ammo.max;
    this.activeReloadWindow = null;
    this.#setPhase(WeaponPhase.OVERHEATED, w.s.ammo.overheatLock ?? 1.8);
    bus.emit('weapon:overheat', { id: this.owner.id, duration: this.phaseDuration });
  }

  #passiveHeat(w, dt) {
    if (w.usesHeat && this.phase === WeaponPhase.READY && this.sinceShot > (w.s.ammo.ventDelay ?? 0.4)) w.heat = Math.max(0, w.heat - w.s.ammo.ventPerSec * dt);
    if (w.usesBattery && !this._beamOn) w.battery = Math.min(w.s.ammo.max, w.battery + (w.s.ammo.rechargePerSec ?? 10) * dt);
  }

  #swap(i) {
    this.#endBeam();
    this.index = i;
    this.consecutive = 0;
    this.#setPhase(WeaponPhase.SWAPPING, this.current.s.handling?.swap ?? 0.5);
    bus.emit('weapon:swap', { id: this.owner.id, weaponId: this.current.s.id });
  }

  #setPhase(p, duration = 0) { this.phase = p; this.phaseTime = 0; this.phaseDuration = duration; }

  /** Melee hits, stagger, and ability effects (EMP, stun) cancel reloads, charges and ADS. */
  interrupt(reason) {
    if (this.phase === WeaponPhase.RELOADING || this.phase === WeaponPhase.CHARGING || this.phase === WeaponPhase.VENTING) {
      bus.emit('weapon:interrupted', { id: this.owner.id, reason, phase: this.phase });
      this.charge = 0;
      this.#setPhase(WeaponPhase.READY);
    }
    if (reason === 'melee' || reason === 'stun') this.ads = 0;
    this.#endBeam();
  }

  /** Abilities can grant timed weapon buffs (e.g. "Overclock": +20% rpm for 6 s). */
  applyBuff(mods, duration) { this.buffs = { ...this.buffs, ...mods, until: this.time + duration }; }

  /** A fresh loadout (redeploying): full magazines and reserves, cool barrels, charged batteries. */
  restock() {
    this.#endBeam();
    for (const w of this.loadout) { w.mag = w.s.mag ?? 0; w.reserve = w.s.reserve ?? 0; w.heat = 0; w.battery = w.s.ammo?.max ?? 0; w.chambered = true; }
    this.charge = 0; this.burstLeft = 0; this.consecutive = 0; this.cooldown = 0;
    this.#setPhase(WeaponPhase.READY);
  }

  /** How much is missing, in magazines (a quarter battery counts as one); heat weapons never run dry. */
  missing() {
    let n = 0;
    for (const w of this.loadout) {
      if (w.usesHeat) continue;
      if (w.usesBattery) { const max = w.s.ammo?.max ?? 0; if (max) n += (max - w.battery) / (max * 0.25); continue; }
      n += Math.max(0, (w.s.reserve ?? 0) - w.reserve) / Math.max(1, w.s.mag ?? 10);
    }
    return n;
  }

  /**
   * Logistics: put up to `mags` magazines' worth back into the reserves (batteries charge by a
   * quarter per magazine). Returns how many magazines' worth went in.
   */
  resupply(mags) {
    let used = 0;
    for (const w of this.loadout) {
      if (used >= mags) break;
      if (w.usesHeat) continue;
      if (w.usesBattery) {
        const max = w.s.ammo?.max ?? 0, add = Math.min(max - w.battery, max * 0.25 * (mags - used));
        if (add > 0) { w.battery += add; used += add / (max * 0.25); }
        continue;
      }
      const per = Math.max(1, w.s.mag ?? 10), add = Math.min((w.s.reserve ?? 0) - w.reserve, Math.floor(per * (mags - used)));
      if (add > 0) { w.reserve += add; used += add / per; }
    }
    return used;
  }
}

// --------------------------------------------------------------------- projectiles

/**
 * Simulated projectiles: bolts, shards, rockets, grenades, artillery shells. Pooled with no
 * per-tick allocation. A spec may set `gravity` (m/s², else 9.8 × drop), `maxAge` (s, default 6)
 * and `highFly`: a shell high above the tallest ground skips its collision test (nothing to hit
 * up there), which keeps a long barrage cheap.
 */
export class ProjectileSystem {
  constructor(world, max = 1024) {
    this.world = world;
    this.pool = Array.from({ length: max }, () => ({ alive: false, pos: new Vector3(), vel: new Vector3(), prev: new Vector3() }));
    this._seg = new Vector3();
  }

  spawn(spec) {
    const p = this.pool.find((x) => !x.alive);
    if (!p) return null;
    Object.assign(p, { alive: true, spec, age: 0, traveled: 0, ownerId: spec.ownerId, team: spec.team, stuckTo: null, isChild: false });
    p.pos.copy(spec.origin);
    p.vel.copy(spec.dir).multiplyScalar(spec.speed);
    bus.emit('projectile:spawn', { ref: p, style: spec.weapon.vfx?.tracer });
    return p;
  }

  update(dt) {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.stuckTo) {
        if (p.stuckTo !== 'world') p.pos.copy(p.stuckTo.movement.state.position).setY(p.pos.y);
        if (p.age > 6) { p.stuckTo = p.stuckTo === 'world' ? null : p.stuckTo; p.spec.sticky = false; this.#impact(p, { point: p.pos.clone(), entity: p.stuckTo, distance: p.traveled }); }
        continue;
      }
      // Grenades with a fuse explode when the fuse runs out, even in mid-air.
      if (p.spec.fuse != null && !p.spec.sticky && p.age >= p.spec.fuse) { this.#impact(p, { point: p.pos.clone(), entity: null, distance: p.traveled }); continue; }
      p.prev.copy(p.pos);
      p.vel.y -= (p.spec.gravity ?? 9.8 * (p.spec.drop ?? 0)) * dt;
      p.pos.addScaledVector(p.vel, dt);
      // Swept test between the last and current position so fast bolts never tunnel through targets.
      this._seg.subVectors(p.pos, p.prev);
      const len = this._seg.length();
      p.traveled += len;
      const high = p.spec.highFly && Math.min(p.prev.y, p.pos.y) > (this.world.terrain?.maxHeight ?? 0) + HIGH;
      const hit = high ? null : this.world.raycast(p.prev, this._seg.divideScalar(len || 1), len, p.ownerId, { team: p.team, projectile: true });
      if (hit) this.#impact(p, hit);
      else if (p.age > (p.spec.maxAge ?? 6) || p.traveled > (p.spec.weapon.range ?? 400)) {
        if (p.spec.fuse != null) this.#impact(p, { point: p.pos.clone(), entity: p.stuckTo !== 'world' ? p.stuckTo : null, distance: p.traveled });
        else p.alive = false;
      }
    }
  }

  /** Cluster munitions: split into N bomblets that scatter forward and detonate on short fuses. */
  #cluster(p, at) {
    const r = rng(p.ownerId, Math.floor(p.age * 1000) + p.spec.cluster);
    const wasAlive = p.alive;
    p.alive = true; // reserve the parent's pool slot so a bomblet can't overwrite it mid-impact
    for (let i = 0; i < p.spec.cluster; i++) {
      const a = r() * Math.PI * 2;
      const dir = new Vector3(Math.cos(a) * 0.6, 0.8, Math.sin(a) * 0.6).normalize();
      const child = this.spawn({ ...p.spec, origin: at.clone().setY(at.y + 0.3), dir, speed: 4 + r() * 3, drop: 1, fuse: 0.5 + r() * 0.3, cluster: 0, sticky: false });
      if (child) child.isChild = true;
    }
    p.alive = wasAlive;
    bus.emit('projectile:cluster', { point: at.toArray(), count: p.spec.cluster });
  }

  #impact(p, hit) {
    const e = hit.entity;
    // Sticky projectiles (Ember Brand, Arc Snare) attach and then detonate on their fuse.
    if (p.spec.sticky && !p.stuckTo) { p.stuckTo = e ?? 'world'; p.vel.set(0, 0, 0); p.age = 6 - (p.spec.fuse ?? 1); p.pos.copy(hit.point); bus.emit('projectile:stick', { ref: p, victim: e?.id }); return; }
    // Flame-sword guard deflects energy bolts back toward the shooter (see melee.json guard.deflectEnergy).
    if (e && p.spec.deflectable && e.melee?.guarding && e.melee.w.guard.deflectEnergy && e.team !== p.team) {
      p.vel.multiplyScalar(-1); p.team = e.team; p.ownerId = e.id;
      e.melee.heat = Math.min(e.melee.w.heat.max, e.melee.heat + (e.melee.w.guard.deflectHeat ?? 5));
      bus.emit('projectile:deflect', { by: e.id, point: hit.point });
      return;
    }
    p.alive = false;
    const s = p.spec.weapon;
    // Ability projectiles: on-hit statuses go to the direct hit, or to everyone in the splash.
    const onHit = p.spec.onHit;
    if (onHit?.zone) this.world.spawnZone?.({ ...onHit.zone, center: hit.point.clone(), ownerId: p.ownerId, team: p.team, ability: s.id });
    if (p.spec.cluster && !p.isChild) this.#cluster(p, hit.point);
    if (onHit?.status) {
      const victims = p.spec.splash > 0 ? this.world.entitiesInRadius(hit.point, p.spec.splash) : e ? [e] : [];
      for (const v of victims) if (v.team !== p.team) v.status?.apply(onHit.status.id, { stacks: onHit.status.stacks ?? 1, duration: onHit.status.duration, source: this.world.entity?.(p.ownerId) });
    }
    if (p.spec.splash > 0) {
      bus.emit('projectile:explode', { point: hit.point, radius: p.spec.splash, ownerId: p.ownerId, artillery: !!s.artillery });
      this.world.explode?.(hit.point, p.spec.splash, s, p);
    } else if (e && e.team !== p.team) {
      const armor = e.health.armorFor?.(hit.zone) ?? 'flesh';
      const dmg = computeDamage(s, p.traveled, hit.zone, armor, this.world.damageMatrix ?? {}) * p.spec.damageMul;
      const res = e.health.damage(dmg, { kind: 'projectile', weapon: s.id, ammoType: s.ammoType, zone: hit.zone }, { id: p.ownerId });
      bus.emit('weapon:hit', { attacker: p.ownerId, victim: e.id, damage: dmg, zone: hit.zone, armor, shieldBroke: !!res?.shieldBroke, killed: !!res?.killed, point: hit.point });
    } else {
      bus.emit('weapon:impact', { point: hit.point, normal: hit.normal, surface: hit.surface, style: s.vfx?.impact, ownerId: p.ownerId, team: p.team, damage: s.damage?.base ?? 0 });
    }
    // Artillery: craters, blown-away sandbags, the big boom.
    if (s.artillery) this.world.shellImpact?.(hit.point, s, p);
  }
}
