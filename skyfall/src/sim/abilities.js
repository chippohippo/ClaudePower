// Legend ability implementations (tactical, ultimate, passive) and ability-entity behaviour.
// Every effect is built from a few shared primitives: status effects, thrown projectiles,
// timed area entities (zones), explosions and reveals — so new legends are cheap to add.

import { LEGENDS } from '../shared/legends.js';
import { dirFromAngles } from '../shared/util.js';
import { eyeHeight } from '../shared/movement.js';

function ev(match, p, k, extra = {}) {
  match.events.push({ e: 'abil', k, id: p.id, x: p.ms.x, y: p.ms.y, z: p.ms.z, r: 200, ...extra });
}

function throwFrom(match, p, kind, speed, opts) {
  const d = dirFromAngles(p.ms.yaw, p.ms.pitch + 0.1);
  const ey = p.ms.y + eyeHeight(p.ms);
  return match.throwProjectile(p, kind, p.ms.x + d.x * 0.6, ey, p.ms.z + d.z * 0.6, d.x * speed, d.y * speed + 2, d.z * speed, opts);
}

export function useTactical(match, p) {
  const L = LEGENDS[p.legend].tactical;
  switch (L.id) {
    case 'stim':
      p.status.stim = L.dur;
      if (!p.downed) p.hp = Math.max(1, p.hp - L.cost);
      ev(match, p, 'stim');
      return true;
    case 'phase':
      p.status.phase = L.dur;
      p.reloading = null;
      ev(match, p, 'phase');
      return true;
    case 'drone': {
      const f = dirFromAngles(p.ms.yaw, 0);
      const x = p.ms.x + f.x * 1.5, z = p.ms.z + f.z * 1.5;
      match.spawnEntity({ k: 'drone', x, y: p.ms.y + 1.6, z, squad: p.squad, owner: p.id, dur: L.dur, r: L.radius, rate: L.rate });
      ev(match, p, 'drone');
      return true;
    }
    case 'dome':
      throwFrom(match, p, 'domeproj', 14, {
        fuse: 99, life: 4,
        onLand: (pr) => {
          match.spawnEntity({ k: 'dome', x: pr.x, y: pr.y, z: pr.z, r: L.radius, dur: L.dur, squad: p.squad });
          match.events.push({ e: 'abil', k: 'dome', x: pr.x, y: pr.y, z: pr.z, r: 250 });
        },
      });
      ev(match, p, 'throw');
      return true;
    case 'pulse': {
      const d = dirFromAngles(p.ms.yaw, 0);
      const cos = Math.cos(0.65);
      let n = 0;
      for (const q of match.queryPlayers(p.ms.x, p.ms.z, L.range)) {
        if (q.squad === p.squad || !q.alive) continue;
        const dx = q.ms.x - p.ms.x, dz = q.ms.z - p.ms.z;
        const l = Math.hypot(dx, dz) || 1;
        if ((dx * d.x + dz * d.z) / l < cos) continue;
        q.revealTo = q.revealTo || {};
        q.revealTo[p.squad] = match.time + L.dur;
        q.status.revealed = L.dur;
        n++;
        if (q.bot) q.bot.onRevealed(p);
      }
      ev(match, p, 'pulse', { dx: d.x, dz: d.z, n, g: 0 });
      return true;
    }
    case 'gastrap': {
      const f = dirFromAngles(p.ms.yaw, 0);
      const x = p.ms.x + f.x * 1.2, z = p.ms.z + f.z * 1.2;
      const y = match.world.groundAt(x, z, p.ms.y + 1, match.tmp);
      const mine = [...match.entities.values()].filter((e) => e.k === 'gastrap' && e.owner === p.id);
      if (mine.length >= 6) match.removeEntity(mine[0]);
      match.spawnEntity({ k: 'gastrap', x, y, z, owner: p.id, squad: p.squad, dur: 300, triggered: false });
      ev(match, p, 'gastrap');
      return true;
    }
    case 'smoke':
      throwFrom(match, p, 'smokeproj', 42, {
        fuse: 99, life: 3, gravity: 9, impact: true,
        onExplode: (pr) => {
          match.spawnEntity({ k: 'smoke', x: pr.x, y: Math.max(0, pr.y - 1), z: pr.z, r: L.radius, dur: L.dur });
          match.events.push({ e: 'abil', k: 'smoke', x: pr.x, y: pr.y, z: pr.z, r: 300 });
        },
      });
      ev(match, p, 'launch');
      return true;
    case 'missiles': {
      const tgt = match.aimPoint(p, 120);
      const ey = p.ms.y + eyeHeight(p.ms) + 0.5;
      for (let i = 0; i < 12; i++) {
        const ox = ((i % 4) - 1.5) * 3.2, oz = (Math.floor(i / 4) - 1) * 3.2;
        const right = { x: Math.cos(p.ms.yaw), z: -Math.sin(p.ms.yaw) };
        const tx = tgt.x + right.x * ox + tgt.dx * oz, tz = tgt.z + right.z * ox + tgt.dz * oz;
        const dx = tx - p.ms.x, dy = tgt.y + 0.3 - ey, dz = tz - p.ms.z;
        const l = Math.hypot(dx, dy, dz) || 1;
        const sp = 48;
        match.throwProjectile(p, 'missile', p.ms.x, ey, p.ms.z, (dx / l) * sp, (dy / l) * sp + 3, (dz / l) * sp, {
          fuse: 4 + i * 0.03, life: 4, gravity: 2,
          onExplode: (pr) => {
            match.explode(pr.x, pr.y, pr.z, 2.6, 14, p, 'Missile Swarm');
            for (const q of match.queryPlayers(pr.x, pr.z, 2.6)) {
              if (q.squad !== p.squad && q.legend !== 'bastion') q.status.slow = Math.max(q.status.slow || 0, 1.2);
            }
          },
        });
      }
      ev(match, p, 'missiles');
      return true;
    }
  }
  return false;
}

export function useUltimate(match, p) {
  const L = LEGENDS[p.legend].ultimate;
  switch (L.id) {
    case 'jumppad':
      throwFrom(match, p, 'padproj', 12, {
        fuse: 99, life: 4,
        onLand: (pr) => {
          match.spawnEntity({ k: 'jumppad', x: pr.x, y: pr.y, z: pr.z, dur: L.dur });
          match.events.push({ e: 'abil', k: 'jumppad', x: pr.x, y: pr.y, z: pr.z, r: 200 });
        },
      });
      ev(match, p, 'throw');
      return true;
    case 'rift': {
      if (p.abil.riftOpen) {
        closeRift(match, p.abil.riftOpen, p);
        return true;
      }
      const e = match.spawnEntity({
        k: 'portal', x: p.ms.x, y: p.ms.y, z: p.ms.z, x2: p.ms.x, y2: p.ms.y, z2: p.ms.z, open: false,
        owner: p.id, squad: p.squad, dur: 9999, range: L.range, life: L.dur,
      });
      p.abil.riftOpen = e;
      ev(match, p, 'riftstart');
      return true;
    }
    case 'carepkg': {
      const a = match.aimPoint(p, 35);
      match.spawnCarePackage(a.x, a.z, 2);
      ev(match, p, 'call');
      return true;
    }
    case 'bombard': {
      const a = match.aimPoint(p, 160);
      match.spawnEntity({ k: 'mortar', x: a.x, y: a.y, z: a.z, r: L.radius, dur: L.dur + 2.4, owner: p.id, squad: p.squad, acc: 0, stopT: L.dur + 1.5 });
      match.events.push({ e: 'abil', k: 'bombard', x: a.x, y: a.y, z: a.z, g: 1 });
      ev(match, p, 'call');
      return true;
    }
    case 'exhibit':
      match.spawnEntity({ k: 'exhibit', x: p.ms.x, y: p.ms.y, z: p.ms.z, r: L.radius, dur: L.dur, squad: p.squad, owner: p.id, acc: 0 });
      ev(match, p, 'exhibit');
      return true;
    case 'gasnade':
      throwFrom(match, p, 'gasproj', 20, {
        fuse: 99, life: 4,
        onLand: (pr) => {
          match.spawnEntity({ k: 'gas', x: pr.x, y: pr.y, z: pr.z, r: L.radius, dur: L.dur, squad: p.squad, owner: p.id, acc: 0 });
          match.events.push({ e: 'abil', k: 'gas', x: pr.x, y: pr.y, z: pr.z, r: 250 });
        },
      });
      ev(match, p, 'throw');
      return true;
    case 'thunder': {
      const a = match.aimPoint(p, 90);
      const f = dirFromAngles(p.ms.yaw, 0);
      match.spawnEntity({ k: 'thunder', x: a.x, y: a.y, z: a.z, dx: +f.x.toFixed(3), dz: +f.z.toFixed(3), dur: 9, owner: p.id, squad: p.squad, acc: 0, stopT: 8 });
      match.events.push({ e: 'abil', k: 'thunder', x: a.x, y: a.y, z: a.z, g: 1 });
      ev(match, p, 'call');
      return true;
    }
    case 'skyward': {
      const sq = match.squads[p.squad];
      for (const id of sq.members) {
        const q = match.players.get(id);
        if (!q.alive || q.downed || q.eliminated) continue;
        if (Math.hypot(q.ms.x - p.ms.x, q.ms.z - p.ms.z) > 9) continue;
        q.ms.launchT = 2.3;
        q.ms.onGround = false;
        q.ms.mode = 'air';
        if (q.bot) q.bot.onSkyward(p);
      }
      ev(match, p, 'skyward', { g: 1 });
      return true;
    }
  }
  return false;
}

function closeRift(match, e, p) {
  e.open = true;
  e.x2 = p.ms.x; e.y2 = p.ms.y; e.z2 = p.ms.z;
  e.dur = e.t + e.life;
  p.abil.riftOpen = null;
  match.events.push({ e: 'abil', k: 'riftopen', x: e.x2, y: e.y2, z: e.z2, r: 250 });
}

export function updateEntity(match, e, dt) {
  switch (e.k) {
    case 'jumppad':
      match.world.pads.push(e);
      break;
    case 'dome':
      match.world.bulletBlockers.push({ x: e.x, y: e.y, z: e.z, r: e.r });
      break;
    case 'smoke':
      match.smokes.push(e);
      break;
    case 'drone':
      for (const q of match.queryPlayers(e.x, e.z, e.r)) {
        if (q.squad !== e.squad || !q.alive || q.downed) continue;
        if (q.hp < 100) q.hp = Math.min(100, q.hp + e.rate * dt);
      }
      break;
    case 'carepkg':
      if (!e.landed) {
        e.landT -= dt;
        if (e.landT <= 0) {
          e.landed = true;
          match.events.push({ e: 'boom', x: e.x, y: e.y, z: e.z, r: 3, k: 'land', rr: 600 });
          for (const q of match.queryPlayers(e.x, e.z, 1.5)) match.damage(q, 999, null, { weapon: 'Care Package', ignoreShield: true });
        }
      }
      break;
    case 'portal': {
      const owner = match.players.get(e.owner);
      if (!e.open) {
        if (!owner || !owner.alive || owner.downed || owner.eliminated) {
          match.removeEntity(e);
          if (owner) { owner.abil.riftOpen = null; owner.ultCd = 30; }
          return;
        }
        e.x2 = owner.ms.x; e.y2 = owner.ms.y; e.z2 = owner.ms.z;
        if (Math.hypot(e.x2 - e.x, e.z2 - e.z) >= e.range || e.t > 14) {
          closeRift(match, e, owner);
          owner.ultCd = LEGENDS.phantom.ultimate.cd;
        }
        break;
      }
      for (const end of [0, 1]) {
        const ax = end ? e.x2 : e.x, ay = end ? e.y2 : e.y, az = end ? e.z2 : e.z;
        const bx = end ? e.x : e.x2, by = end ? e.y : e.y2, bz = end ? e.z : e.z2;
        for (const q of match.queryPlayers(ax, az, 1.1)) {
          if (!q.alive || q.inShip || Math.abs(q.ms.y - ay) > 1.6) continue;
          if ((q.portalCd || 0) > match.time) continue;
          q.portalCd = match.time + 1.5;
          q.ms.x = bx; q.ms.y = by + 0.05; q.ms.z = bz;
          match.events.push({ e: 'abil', k: 'portal', id: q.id, x: bx, y: by, z: bz, r: 120 });
        }
      }
      break;
    }
    case 'gastrap':
      if (!e.triggered) {
        for (const q of match.queryPlayers(e.x, e.z, 4.5)) {
          if (q.squad === e.squad || !q.alive || q.status.phase > 0) continue;
          e.triggered = true;
          match.spawnEntity({ k: 'gas', x: e.x, y: e.y, z: e.z, r: 6, dur: 12, squad: e.squad, owner: e.owner, acc: 0 });
          match.events.push({ e: 'abil', k: 'gas', x: e.x, y: e.y, z: e.z, r: 250 });
          e.dur = e.t + 12;
          break;
        }
      }
      break;
    case 'gas': {
      e.acc += dt;
      const owner = match.players.get(e.owner);
      for (const q of match.queryPlayers(e.x, e.z, e.r)) {
        if (q.squad === e.squad || !q.alive) continue;
        if (Math.abs(q.ms.y - e.y) > 5) continue;
        q.status.gas = 0.6;
        if (owner) { q.revealTo = q.revealTo || {}; q.revealTo[e.squad] = match.time + 0.6; }
        if (e.acc >= 1) match.damage(q, 5, owner, { ignoreShield: true, weapon: 'Nox Gas', src: 1 });
      }
      if (e.acc >= 1) e.acc -= 1;
      break;
    }
    case 'mortar': {
      if (e.t < 1.5) break;
      if (e.t > e.stopT) { tickShells(e, dt); break; }
      e.acc += dt;
      const owner = match.players.get(e.owner);
      while (e.acc >= 0.22) {
        e.acc -= 0.22;
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * e.r;
        const x = e.x + Math.cos(a) * d, z = e.z + Math.sin(a) * d;
        const y = match.world.groundAt(x, z, e.y + 20, match.tmp);
        incoming(match, e, x, y, z, 0.75, () => match.explode(x, y + 0.3, z, 4.5, 30, owner, 'Bombardment'));
      }
      tickShells(e, dt);
      break;
    }
    case 'thunder': {
      if (e.t < 1.2) break;
      if (e.t > e.stopT) { tickShells(e, dt); break; }
      e.acc += dt;
      const owner = match.players.get(e.owner);
      while (e.acc >= 0.12) {
        e.acc -= 0.12;
        const prog = ((e.t - 1.2) / 6.8) * 70;
        const lat = (Math.random() - 0.5) * 34;
        const x = e.x + e.dx * prog - e.dz * lat, z = e.z + e.dz * prog + e.dx * lat;
        const y = match.world.groundAt(x, z, e.y + 20, match.tmp);
        incoming(match, e, x, y, z, 0.6, () => {
          match.explode(x, y + 0.3, z, 3.5, 20, owner, 'Rolling Thunder');
          for (const q of match.queryPlayers(x, z, 5)) {
            if (q.squad !== e.squad && q.legend !== 'bastion') q.status.slow = Math.max(q.status.slow || 0, 2);
          }
        });
      }
      tickShells(e, dt);
      break;
    }
    case 'exhibit': {
      e.acc += dt;
      if (e.acc < 0.5) break;
      e.acc = 0;
      for (const q of match.queryPlayers(e.x, e.z, e.r)) {
        if (q.squad === e.squad || !q.alive) continue;
        const sp = Math.hypot(q.ms.vx, q.ms.vz);
        if (sp > 5 || match.time - q.lastFire < 1) {
          q.revealTo = q.revealTo || {};
          q.revealTo[e.squad] = match.time + 1;
        }
      }
      break;
    }
  }
}

// Artillery is telegraphed: a 'shell' event shows the round falling before it lands.
function incoming(match, e, x, y, z, delay, land) {
  e.shells = e.shells || [];
  e.shells.push({ t: delay, land });
  match.events.push({ e: 'shell', x, y, z, tt: delay, r: 500 });
}

function tickShells(e, dt) {
  if (!e.shells) return;
  for (let i = e.shells.length - 1; i >= 0; i--) {
    const s = e.shells[i];
    s.t -= dt;
    if (s.t <= 0) { s.land(); e.shells.splice(i, 1); }
  }
}

export function passiveTick(match, p, dt) {
  if (p.legend === 'jolt' && !p.downed && p.hp < 100 && match.time - p.lastHurt > 6) {
    p.hp = Math.min(100, p.hp + 2 * dt);
  }
}
