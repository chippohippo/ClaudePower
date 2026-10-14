// Bot brain. Bots produce the exact same input commands a human would (move axes, view angles,
// buttons) and run through the same movement code, so they slide, jump, mantle and strafe like players.
//
// Behaviour layers: drop -> loot -> rotate/follow squad -> third-party gunfire -> fight
// (strafe, cover, heal, push weak targets, use abilities) -> revive / banner / respawn.

import { BTN, SHIELD_TIERS } from '../shared/constants.js';
import { WEAPONS, currentSpread } from '../shared/weapons.js';
import { eyeHeight } from '../shared/movement.js';
import { wrapAngle, clamp, anglesFromDir } from '../shared/util.js';
import { itemValue, countItem } from './inventory.js';
import { LEGENDS } from '../shared/legends.js';

export const BOT_NAMES = [
  'Vex', 'Kairo', 'Nyx', 'Talon', 'Rook', 'Juno', 'Sable', 'Onyx', 'Riot', 'Zephyr', 'Mako', 'Echo9', 'Viper',
  'Grit', 'Halcyon', 'Bishop', 'Crux', 'Dagger', 'Ember', 'Frost', 'Ghost', 'Havoc', 'Ion', 'Jinx', 'Kilo',
  'Lynx', 'Mirage', 'Nova', 'Orbit', 'Pyre', 'Quill', 'Rogue', 'Saber', 'Tango', 'Umbra', 'Vandal', 'Wraithe',
  'Xeno', 'Yuki', 'Zulu', 'Ash', 'Blitz', 'Cinder', 'Drift', 'Flux', 'Gale', 'Hex', 'Iris', 'Jett', 'Krait',
  'Lumen', 'Moxie', 'Nomad', 'Oracle', 'Pike', 'Quake', 'Razor', 'Shade', 'Torque', 'Ursa', 'Volt', 'Warden',
  'Axiom', 'Brisk', 'Cobalt', 'Dusk', 'Ether', 'Fang', 'Glitch', 'Husk', 'Ignis', 'Jolt', 'Knox', 'Lotus',
];

const tmpPlayers = [];
const tmpLoot = [];
const tmpBoxes = [];

export class Bot {
  constructor(match, p) {
    this.m = match;
    this.p = p;
    const r = match.rng;
    this.baseSkill = 0.22 + r() * 0.3;
    this.inp = { mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0 };
    this.yaw = r() * Math.PI * 2;
    this.pitch = 0;
    this.state = 'ship';
    this.thinkT = r() * 0.25;
    this.target = null;
    this.targetVisible = false;
    this.lastSeen = { x: 0, y: 0, z: 0, t: -99 };
    this.reactT = 0;
    this.trackT = 0;
    this.burstT = 0;
    this.pauseT = 0;
    this.strafe = 1;
    this.strafeT = 0;
    this.crouchT = 0;
    this.err = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, t: 0 };
    this.goal = null;
    this.lootTarget = null;
    this.blacklist = new Set();
    this.stuck = { x: 0, z: 0, t: 0, n: 0, escapeT: 0, ex: 0, ez: 0 };
    this.avoid = { side: 0, t: 0 };
    this.travelT = r() * 2;
    this.heard = null;
    this.follow = null;
    this.jumpDelay = 0;
    this.lastCombat = -99;
    this.cover = null;
    this.rotOff = { x: (r() - 0.5), z: (r() - 0.5) };
    this.nadeT = 3 + r() * 6;
    this.wantJump = false;
    this.boxT = 0;
    this.role = LEGENDS[p.legend].cls; // tank | dps | support
    this.flankSide = r() < 0.5 ? -1 : 1;
  }

  get skill() {
    const m = this.m;
    return clamp(this.baseSkill + 0.38 * (1 - (m.alive || 100) / 100), 0.2, 0.95);
  }

  // ------------------------------------------------------------ hooks from sim
  followJump(leader) {
    this.follow = leader;
    this.jumpDelay = 0.2 + this.m.rng() * 0.6;
  }

  onDamaged(a) {
    this.lastCombat = this.m.time;
    if (!this.target || !this.targetVisible || (this.target.downed && !a.downed)) {
      if (a.squad !== this.p.squad && a.alive) {
        this.target = a;
        this.lastSeen = { x: a.ms.x, y: a.ms.y, z: a.ms.z, t: this.m.time };
        this.reactT = Math.min(this.reactT, 0.15);
      }
    }
  }

  hearShot(shooter, x, z) {
    if (this.target && this.targetVisible) return;
    this.heard = { x, z, t: this.m.time, who: shooter };
  }

  onRevealed() {}
  onSkyward() { this.state = 'skydive'; }

  // ------------------------------------------------------------ helpers
  squadmates() {
    return this.m.squads[this.p.squad].members.map((id) => this.m.players.get(id)).filter((q) => q !== this.p);
  }

  leader() {
    const sq = this.m.squads[this.p.squad].members.map((id) => this.m.players.get(id));
    const human = sq.find((q) => !q.isBot && q.alive && !q.eliminated && !q.inShip);
    if (human) return human;
    return sq.find((q) => q.alive && !q.eliminated && !q.inShip && !q.downed) || null;
  }

  canSee(q) {
    const p = this.p, m = this.m;
    const ex = p.ms.x, ey = p.ms.y + eyeHeight(p.ms), ez = p.ms.z;
    const tx = q.ms.x, ty = q.ms.y + (q.downed ? 0.4 : 1.1), tz = q.ms.z;
    const dx = tx - ex, dy = ty - ey, dz = tz - ez;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.5) return true;
    const hit = m.world.raycast(ex, ey, ez, dx / d, dy / d, dz / d, d, tmpBoxes);
    if (hit && hit.t < d - 0.3) return false;
    for (const s of m.smokes) {
      // segment vs sphere
      const lx = s.x - ex, ly = s.y + 2 - ey, lz = s.z - ez;
      const t = clamp((lx * dx + ly * dy + lz * dz) / (d * d), 0, 1);
      const cx = ex + dx * t - s.x, cy = ey + dy * t - (s.y + 2), cz = ez + dz * t - s.z;
      if (cx * cx + cy * cy + cz * cz < s.r * s.r) return false;
    }
    return true;
  }

  kitted() {
    const p = this.p;
    const w = p.weapons.filter(Boolean);
    if (!w.length) return false;
    let ammo = 0;
    for (const x of w) ammo += countItem(p, 'a:' + WEAPONS[x.id].ammo);
    return w.length === 2 && ammo > 60 && p.armor >= 1 && (countItem(p, 'c:cell') + countItem(p, 'c:battery') > 1);
  }

  hasGun() {
    return this.p.weapons.some(Boolean);
  }

  // ------------------------------------------------------------ main update
  update(dt) {
    const p = this.p, m = this.m, inp = this.inp;
    inp.buttons = 0;
    inp.mx = 0; inp.mz = 0;
    if (p.inShip) {
      this._shipLogic(dt);
      return inp;
    }
    if (p.dummy) {
      // firing-range dummy: strafes back and forth, never shoots
      const ph = Math.sin(m.time * (0.6 + (p.id % 3) * 0.3) + p.id);
      inp.mx = (p.id % 2 ? 1 : 0.6) * Math.sign(ph);
      if (p.id % 4 === 0 && Math.sin(m.time * 1.7 + p.id) > 0.97) inp.buttons |= BTN.JUMP;
      if (p.id % 5 === 0 && Math.sin(m.time * 2.3 + p.id) > 0.6) inp.buttons |= BTN.CROUCH;
      this.yaw = 0;
      return this._finish(dt);
    }
    if (p.ms.mode === 'skydive' || p.ms.launchT > 0) {
      this._skydive(dt);
      return this._finish(dt);
    }
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.22 + m.rng() * 0.1;
      this._think();
    }
    if (p.downed) {
      this._downed(dt);
      return this._finish(dt);
    }
    switch (this.state) {
      case 'fight': this._fight(dt); break;
      case 'chase': this._moveTo(this.lastSeen.x, this.lastSeen.z, dt, true); this._lookMove(dt); break;
      case 'revive': this._revive(dt); break;
      case 'heal': this._heal(dt); break;
      case 'loot': this._loot(dt); break;
      case 'banner': this._banner(dt); break;
      case 'beacon': this._beacon(dt); break;
      default: this._roam(dt); break;
    }
    return this._finish(dt);
  }

  _finish(dt) {
    const inp = this.inp;
    inp.yaw = this.yaw;
    inp.pitch = this.pitch;
    return inp;
  }

  _shipLogic(dt) {
    const m = this.m, p = this.p, S = m.ship;
    if (this.follow) {
      if (!this.follow.inShip) {
        this.jumpDelay -= dt;
        if (this.jumpDelay <= 0) m.action(p, { a: 'jump' });
      }
      return;
    }
    const sq = m.squads[p.squad];
    if (!sq.drop) {
      // squad picks a POI, weighted toward hot zones and toward the ship path
      const ws = m.map.pois.map((poi) => {
        const along = (poi.x - S.ax) * S.dirx + (poi.z - S.az) * S.dirz;
        const lat = Math.abs(-(poi.x - S.ax) * S.dirz + (poi.z - S.az) * S.dirx);
        return [poi, (1 + poi.tier * 1.6) / (1 + lat / 250) * (along > 0 ? 1 : 0.2)];
      });
      let tot = ws.reduce((a, b) => a + b[1], 0), r = m.rng() * tot;
      let poi = ws[0][0];
      for (const [pp, w] of ws) { r -= w; if (r <= 0) { poi = pp; break; } }
      const a = m.rng() * Math.PI * 2, d = m.rng() * poi.r * 0.6;
      sq.drop = { x: poi.x + Math.cos(a) * d, z: poi.z + Math.sin(a) * d, poi };
      const along = (sq.drop.x - S.ax) * S.dirx + (sq.drop.z - S.az) * S.dirz;
      const lat = Math.abs(-(sq.drop.x - S.ax) * S.dirz + (sq.drop.z - S.az) * S.dirx);
      sq.jumpAlong = Math.max(80, along - Math.max(0, 300 - lat) * 0.6);
    }
    const shipAlong = (S.x - S.ax) * S.dirx + (S.z - S.az) * S.dirz;
    if (shipAlong >= sq.jumpAlong + (p.id % 3) * 6) {
      const human = sq.members.map((id) => m.players.get(id)).find((q) => !q.isBot);
      if (human && human.inShip) return; // wait for the human jumpmaster
      m.action(p, { a: 'jump' });
    }
  }

  _dropGoal() {
    const sq = this.m.squads[this.p.squad];
    if (this.follow) {
      const f = this.follow;
      const a = (this.p.id * 2.4) % (Math.PI * 2);
      const tx = f.ms.x + f.ms.vx * 4 + Math.cos(a) * 12, tz = f.ms.z + f.ms.vz * 4 + Math.sin(a) * 12;
      return { x: tx, z: tz };
    }
    if (sq.drop) {
      const a = (this.p.id * 2.4) % (Math.PI * 2);
      return { x: sq.drop.x + Math.cos(a) * 18, z: sq.drop.z + Math.sin(a) * 18 };
    }
    return { x: this.p.ms.x, z: this.p.ms.z };
  }

  _skydive(dt) {
    const p = this.p;
    const g = this._dropGoal();
    const dx = g.x - p.ms.x, dz = g.z - p.ms.z;
    const hd = Math.hypot(dx, dz);
    const alt = p.ms.y;
    this.yaw = Math.atan2(-dx, -dz);
    // glide when far, shallow-dive on approach, dive when nearly above the target
    const above = alt - this.m.world.groundAt(p.ms.x, p.ms.z, alt, this.m.tmp);
    this.pitch = hd > above * 1.2 ? -0.1 : hd > above * 0.35 ? -0.7 : -1.3;
    this.inp.mz = hd > 4 ? 1 : 0;
    this.state = 'loot';
  }

  // ------------------------------------------------------------ perception / decision
  _think() {
    const p = this.p, m = this.m;
    // perception
    let best = null, bestScore = 1e9;
    const range = 130;
    m.queryPlayers(p.ms.x, p.ms.z, range, tmpPlayers);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    for (const q of tmpPlayers) {
      if (q.squad === p.squad || !q.alive || q.inShip || q.eliminated || q.status.phase > 0) continue;
      const dx = q.ms.x - p.ms.x, dz = q.ms.z - p.ms.z;
      const d = Math.hypot(dx, dz);
      const facing = (dx * fx + dz * fz) / (d || 1);
      const revealed = q.revealTo && q.revealTo[p.squad] > m.time;
      if (d > 22 && facing < 0.2 && !revealed && q !== this.target) continue;
      let score = d + (q.downed ? 40 : 0) - (q === this.target ? 15 : 0) - (q.shield <= 0 ? 8 : 0);
      if (this.role === 'tank' && this._threatensMate(q)) score -= 25; // peel for the squad
      if (this.role === 'dps' && q.shield <= 0) score -= 10;          // hunt broken targets
      if (score >= bestScore) continue;
      if (!this.canSee(q)) continue;
      best = q; bestScore = score;
    }
    if (best) {
      if (best !== this.target) {
        this.target = best;
        this.reactT = 0.7 - this.skill * 0.45 + m.rng() * 0.25;
        this.trackT = 0;
        this._newErr(true);
      }
      this.targetVisible = true;
      this.lastSeen = { x: best.ms.x, y: best.ms.y, z: best.ms.z, t: m.time };
      this.lastCombat = m.time;
      best.aimedAt = m.time + 0.6;
    } else {
      this.targetVisible = false;
      if (this.target && (!this.target.alive || this.target.eliminated)) this.target = null;
    }

    // decide state
    const shMax = SHIELD_TIERS[p.armor] || 0;
    const hurt = p.hp < (this.role === 'support' ? 80 : 65) || (shMax > 0 && p.shield < shMax * (this.role === 'support' ? 0.7 : 0.5));
    const healItem = m.bestHeal(p);
    const R = m.ring;
    const ringDist = Math.hypot(p.ms.x - R.cx, p.ms.z - R.cz);

    if (this.targetVisible && this.hasGun()) {
      // retreat to heal when broken and the enemy is not about to die
      const tgt = this.target;
      const tgtWeak = tgt.downed || tgt.shield <= 0 && tgt.hp < 60;
      if (p.shield <= 0 && p.hp < 45 && healItem && !tgtWeak && m.rng() < 0.6) this.state = 'heal';
      else this.state = 'fight';
      return;
    }
    if (this.targetVisible && !this.hasGun()) {
      this.state = 'loot';
      return;
    }
    if (this.target && m.time - this.lastSeen.t < 5 && this.hasGun() && !hurt) {
      this.state = 'chase';
      return;
    }
    // outside ring or ring closing fast → rotate first
    if (ringDist > R.r - 15 || (R.state === 'close' && Math.hypot(p.ms.x - R.nx, p.ms.z - R.nz) > R.nr * 0.9 && R.t < 25)) {
      if (hurt && healItem && ringDist < R.r - 5) { this.state = 'heal'; return; }
      this.state = 'rotate';
      return;
    }
    // revive downed squadmates
    for (const q of this.squadmates()) {
      if (q.downed && q.alive && Math.hypot(q.ms.x - p.ms.x, q.ms.z - p.ms.z) < 80) {
        this.reviveTarget = q;
        this.state = 'revive';
        return;
      }
    }
    if (hurt && healItem && m.time - this.lastCombat > 1.5) { this.state = 'heal'; return; }
    // banners + respawn
    if (p.banners.length) { this.state = 'beacon'; return; }
    for (const e of m.entities.values()) {
      if (e.k === 'box' && e.squad === p.squad && !e.bannerTaken && e.bannerUntil > m.time && Math.hypot(e.x - p.ms.x, e.z - p.ms.z) < 160) {
        this.bannerBox = e;
        this.state = 'banner';
        return;
      }
    }
    // third party: head toward recent gunfire when kitted
    if (this.heard && m.time - this.heard.t < 10 && this.hasGun() && (this.kitted() || this.skill > 0.6)) {
      this.goal = { x: this.heard.x, z: this.heard.z };
      this.state = 'thirdparty';
      return;
    }
    if (!this.kitted() || (m.time - (this.lootStart || 0) < 6)) {
      this.state = 'loot';
      return;
    }
    this.state = 'roam';
  }

  _newErr(big) {
    // metres of aim error; scaled to the slim Apex-style hitboxes (shared/hitbox.js)
    const mag = ((1 - this.skill) * (big ? 3.4 : 1.8) + 0.18) * 0.6;
    const r = this.m.rng;
    this.err.tx = (r() - 0.5) * 2 * mag;
    this.err.ty = (r() - 0.5) * 1.6 * mag;
    this.err.tz = (r() - 0.5) * 2 * mag;
    if (big) { this.err.x = this.err.tx; this.err.y = this.err.ty; this.err.z = this.err.tz; }
    this.err.t = 0.3 + r() * 0.4;
  }

  // ------------------------------------------------------------ movement primitives
  // Sets inp.mx/mz to move toward world point. Aim yaw stays as is (strafe-relative).
  _moveTo(gx, gz, dt, sprint = true, stopDist = 1.2) {
    const p = this.p, m = this.m, inp = this.inp;
    let dx = gx - p.ms.x, dz = gz - p.ms.z;
    const d = Math.hypot(dx, dz);
    if (d < stopDist) { this.path = null; return true; }
    dx /= d; dz /= d;
    // follow an A* path when one is active for this goal
    this.pathCd = Math.max(0, (this.pathCd || 0) - dt);
    if (this.path && Math.hypot(this.path.gx - gx, this.path.gz - gz) > 4) this.path = null;
    let onPath = false;
    if (this.path) {
      const P = this.path;
      let wp = P.pts[P.i];
      while (wp && Math.hypot(wp.x - p.ms.x, wp.z - p.ms.z) < 1.1) { P.i++; wp = P.pts[P.i]; }
      if (!wp || m.time > P.expire) this.path = null;
      else {
        const wd = Math.hypot(wp.x - p.ms.x, wp.z - p.ms.z) || 1;
        dx = (wp.x - p.ms.x) / wd; dz = (wp.z - p.ms.z) / wd;
        onPath = true;
      }
    }
    // stuck detection
    const st = this.stuck;
    st.t += dt;
    if (st.escapeT > 0) {
      st.escapeT -= dt;
      dx = st.ex; dz = st.ez;
      if (st.escapeT > 0.5) this.wantJump = true;
    } else if (st.t > 1.2) {
      const moved = Math.hypot(p.ms.x - st.x, p.ms.z - st.z);
      st.x = p.ms.x; st.z = p.ms.z; st.t = 0;
      if (moved < 1.0) {
        st.n++;
        // stuck: try a real path first, fall back to a random escape
        if (!this._requestPath(gx, gz, d)) {
          const a = m.rng() * Math.PI * 2;
          st.ex = Math.cos(a); st.ez = Math.sin(a);
          st.escapeT = 0.9;
        }
      } else st.n = Math.max(0, st.n - 1);
    }
    // obstacle avoidance (probe ahead); a blocked direct line triggers pathfinding
    if (st.escapeT <= 0 && !onPath) {
      const dir = this._steer(dx, dz);
      if (dir[0] * dx + dir[1] * dz < 0.95) {
        this.blockedT = (this.blockedT || 0) + dt;
        if (this.blockedT > 0.4) { this.blockedT = 0; this._requestPath(gx, gz, d); }
      } else this.blockedT = 0;
      dx = dir[0]; dz = dir[1];
    } else if (onPath && this._probe(dx, dz, 1.0)) {
      const dir = this._steer(dx, dz);
      dx = dir[0]; dz = dir[1];
    }
    this._setMove(dx, dz);
    if (sprint) inp.buttons |= BTN.SPRINT;
    this._travelFlair(dt, d, sprint && !onPath);
    if (this.wantJump) {
      inp.buttons |= BTN.JUMP;
      this.wantJump = false;
    }
    return false;
  }

  // Ask the match's nav grid for a path toward (gx, gz); far goals path to a point 45 m along the way.
  _requestPath(gx, gz, d) {
    const p = this.p, m = this.m;
    if (this.pathCd > 0 || !m.nav || m.navBudget <= 0) return false;
    if (p.ms.y - m.world.terrainH(p.ms.x, p.ms.z) > 1.5) return false; // upper floors: steer instead
    m.navBudget--;
    this.pathCd = 1.2;
    let tx = gx, tz = gz;
    if (d > 45) { tx = p.ms.x + ((gx - p.ms.x) / d) * 45; tz = p.ms.z + ((gz - p.ms.z) / d) * 45; }
    const pts = m.nav.findPath(p.ms.x, p.ms.z, tx, tz);
    if (!pts || !pts.length) return false;
    this.path = { pts, i: 0, gx, gz, expire: m.time + 12 };
    this.stuck.n = 0;
    return true;
  }

  // Movement tech while travelling: slide-hop chains (crouch-slide, jump out holding crouch, land
  // straight into the next slide), longer slides downhill, and opportunistic wall bounces.
  _travelFlair(dt, d, allowed) {
    const p = this.p, m = this.m, inp = this.inp, ms = p.ms;
    const sp = Math.hypot(ms.vx, ms.vz);
    const H = this.hop || (this.hop = { s: 0, t: 0, n: 0, cd: m.rng() * 2 });
    H.cd -= dt;
    if (!ms.onGround && ms.airT > 0.1 && ms.wallT < 0.08 && m.rng() < 0.25 + this.skill * 0.3) this.wantJump = true; // wall bounce
    if (!allowed || d < 18) { H.s = 0; return; }
    switch (H.s) {
      case 0:
        if (H.cd <= 0 && ms.onGround && sp > 6.2) { H.s = 1; H.t = 0; H.n = 0; }
        break;
      case 1: // sliding
        inp.buttons |= BTN.CROUCH;
        H.t += dt;
        if (ms.mode === 'slide' && H.t > 0.28 && (sp < 9 || H.t > 0.9)) { H.s = 2; this.wantJump = true; }
        else if (H.t > 1.2) { H.s = 0; H.cd = 1.5; }
        break;
      case 2: // airborne: hold crouch so the landing chains into a slide
        inp.buttons |= BTN.CROUCH;
        if (ms.onGround) {
          H.n++;
          if (H.n >= 2 + Math.floor(this.skill * 3)) { H.s = 0; H.cd = 2 + m.rng() * 3; }
          else { H.s = 1; H.t = 0; }
        }
        break;
    }
  }

  _probe(dx, dz, dist) {
    const p = this.p, w = this.m.world;
    const r = 0.38;
    const x = p.ms.x + dx * dist, z = p.ms.z + dz * dist;
    return w.overlaps(x - r, p.ms.y + 0.5, z - r, x + r, p.ms.y + 1.7, z + r, tmpBoxes);
  }

  _steer(dx, dz) {
    const p = this.p, w = this.m.world;
    if (!this._probe(dx, dz, 1.3)) { this.avoid.t = Math.max(0, this.avoid.t - 0.05); return [dx, dz]; }
    // climbable? mantle over it
    const px = p.ms.x + dx * 1.0, pz = p.ms.z + dz * 1.0;
    const top = w.groundAt(px, pz, p.ms.y + 2.3, tmpBoxes);
    if (top - p.ms.y > 0.4 && top - p.ms.y < 2.3 && !w.overlaps(px - 0.38, top + 0.05, pz - 0.38, px + 0.38, top + 1.2, pz + 0.38, tmpBoxes)) {
      this.wantJump = true;
      return [dx, dz];
    }
    const base = Math.atan2(dz, dx);
    const side = this.avoid.side || (this.m.rng() < 0.5 ? 1 : -1);
    for (const off of [0.6, 1.1, 1.6, 2.2]) {
      for (const sgn of [side, -side]) {
        const a = base + off * sgn;
        const ox = Math.cos(a), oz = Math.sin(a);
        if (!this._probe(ox, oz, 1.3)) {
          this.avoid.side = sgn;
          return [ox, oz];
        }
      }
    }
    return [-dx, -dz];
  }

  _setMove(dx, dz) {
    // world dir -> local axes relative to current view yaw
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    this.inp.mz = clamp(dx * fx + dz * fz, -1, 1);
    this.inp.mx = clamp(dx * rx + dz * rz, -1, 1);
  }

  // Turn view toward travel direction (non-combat).
  _lookMove(dt) {
    const p = this.p;
    const sp = Math.hypot(p.ms.vx, p.ms.vz);
    let ty = this.yaw;
    if (this.inp.mz || this.inp.mx) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      const wx = fx * this.inp.mz + rx * this.inp.mx, wz = fz * this.inp.mz + rz * this.inp.mx;
      ty = Math.atan2(-wx, -wz);
    } else if (sp > 1) ty = Math.atan2(-p.ms.vx, -p.ms.vz);
    const diff = wrapAngle(ty - this.yaw);
    const turn = Math.min(Math.abs(diff), 7 * dt);
    const oldYaw = this.yaw;
    this.yaw = wrapAngle(this.yaw + Math.sign(diff) * turn);
    this.pitch += (0 - this.pitch) * Math.min(1, dt * 4);
    // keep world move direction constant after rotating view
    if (this.inp.mz || this.inp.mx) {
      const fx = -Math.sin(oldYaw), fz = -Math.cos(oldYaw);
      const rx = Math.cos(oldYaw), rz = -Math.sin(oldYaw);
      const wx = fx * this.inp.mz + rx * this.inp.mx, wz = fz * this.inp.mz + rz * this.inp.mx;
      this._setMove(wx, wz);
    }
  }

  // ------------------------------------------------------------ states
  _roam(dt) {
    const p = this.p, m = this.m;
    const L = this.leader();
    let gx, gz;
    if (this.state === 'thirdparty' && this.goal) { gx = this.goal.x; gz = this.goal.z; }
    else if (L && L !== p && Math.hypot(L.ms.x - p.ms.x, L.ms.z - p.ms.z) > 14) {
      const a = (p.id * 2.1) % (Math.PI * 2);
      gx = L.ms.x + Math.cos(a) * 5; gz = L.ms.z + Math.sin(a) * 5;
      // formation: tanks walk point, supports trail the leader
      const R = m.ring, hx = R.nx - L.ms.x, hz = R.nz - L.ms.z, hl = Math.hypot(hx, hz) || 1;
      const off = this.role === 'tank' ? 7 : this.role === 'support' ? -6 : 0;
      gx += (hx / hl) * off; gz += (hz / hl) * off;
    } else if (L && L !== p && !L.isBot) {
      // stay near the human
      this._lookAround(dt);
      return;
    } else {
      const R = m.ring;
      const tr = R.idx >= 0 ? R.nr : R.r;
      gx = R.nx + this.rotOff.x * tr * 0.7; gz = R.nz + this.rotOff.z * tr * 0.7;
      if (Math.hypot(gx - p.ms.x, gz - p.ms.z) < 10) {
        this.rotOff = { x: m.rng() - 0.5, z: m.rng() - 0.5 };
      }
    }
    const far = Math.hypot(gx - p.ms.x, gz - p.ms.z) > 8;
    this._moveTo(gx, gz, dt, far, 3);
    this._lookMove(dt);
    this._opportunisticLoot();
    this._utilityUlt();
  }

  _lookAround(dt) {
    this.yaw = wrapAngle(this.yaw + Math.sin(this.m.time * 0.7 + this.p.id) * dt * 0.8);
    this.pitch += (0 - this.pitch) * Math.min(1, dt * 3);
    this._opportunisticLoot();
  }

  _opportunisticLoot() {
    const p = this.p, m = this.m;
    m.lootNear(p.ms.x, p.ms.z, 3, tmpLoot);
    for (const wi of tmpLoot) {
      if (Math.abs(wi.y - p.ms.y) < 2 && itemValue(p, wi) > 0 && Math.hypot(wi.x - p.ms.x, wi.z - p.ms.z) < 2.8) {
        m.action(p, { a: 'pickup', id: wi.id });
        return;
      }
    }
  }

  _loot(dt) {
    const p = this.p, m = this.m;
    if (!this.lootStart) this.lootStart = m.time;
    // pick/refresh loot target
    if (!this.lootTarget || !m.loot.has(this.lootTarget.id) || this.lootGiveUp < m.time) {
      this.lootTarget = null;
      m.lootNear(p.ms.x, p.ms.z, 40, tmpLoot);
      let best = null, bs = -1;
      for (const wi of tmpLoot) {
        if (this.blacklist.has(wi.id) || Math.abs(wi.y - p.ms.y) > 1.6) continue;
        const v = itemValue(p, wi);
        if (v <= 0) continue;
        const d = Math.hypot(wi.x - p.ms.x, wi.z - p.ms.z);
        const s = v * 10 - d;
        if (s > bs) { bs = s; best = wi; }
      }
      // unopened bins
      if (!best || bs < 20) {
        for (let i = 0; i < m.map.bins.length; i++) {
          if (m.binsOpened[i]) continue;
          const b = m.map.bins[i];
          const d = Math.hypot(b.x - p.ms.x, b.z - p.ms.z);
          if (d < 30 && !this.blacklist.has('b' + i)) { best = { bin: i, x: b.x, z: b.z, y: 0, id: 'b' + i }; break; }
        }
      }
      // death boxes
      if (!best) {
        for (const e of m.entities.values()) {
          if ((e.k === 'box' || (e.k === 'carepkg' && e.landed)) && e.items.length && Math.hypot(e.x - p.ms.x, e.z - p.ms.z) < 35 && !this.blacklist.has('e' + e.id)) {
            if (e.items.some((it) => itemValue(p, it) > 0)) { best = { box: e, x: e.x, z: e.z, y: e.y, id: 'e' + e.id }; break; }
          }
        }
      }
      this.lootTarget = best;
      this.lootGiveUp = m.time + 10;
      this.stuck.n = 0;
      if (!best) {
        this.lootStart = m.time - 100;
        this._roam(dt);
        return;
      }
    }
    const t = this.lootTarget;
    const d = Math.hypot(t.x - p.ms.x, t.z - p.ms.z);
    if (d < 2.2) {
      if (t.bin !== undefined) m.action(p, { a: 'bin', id: t.bin });
      else if (t.box) {
        const i = t.box.items.findIndex((it) => itemValue(p, it) > 0);
        if (i >= 0) m.action(p, { a: 'boxtake', id: t.box.id, i });
        else this.blacklist.add(t.id);
      } else {
        m.action(p, { a: 'pickup', id: t.id });
        if (m.loot.has(t.id)) this.blacklist.add(t.id);
      }
      this.lootTarget = null;
    } else {
      this._moveTo(t.x, t.z, dt, d > 6, 0.8);
      this._lookMove(dt);
      if (this.stuck.n > 3) { this.blacklist.add(t.id); this.lootTarget = null; this.stuck.n = 0; }
    }
    this._maybeReload();
  }

  _maybeReload() {
    const p = this.p;
    const w = p.weapons[p.active];
    if (!w) {
      if (p.weapons[1 - p.active]) this.m.action(p, { a: 'slot', s: 1 - p.active });
      return;
    }
    const def = WEAPONS[w.id];
    if (!p.reloading && w.mag < def.mag * 0.6) this.m.action(p, { a: 'reload' });
  }

  _heal(dt) {
    const p = this.p, m = this.m;
    // break line of sight first if an enemy is around
    if (this.target && this.targetVisible) {
      this._seekCover(dt);
      if (this.cover && Math.hypot(this.cover.x - p.ms.x, this.cover.z - p.ms.z) > 1.5) return;
    }
    if (!p.healing) {
      m.action(p, { a: 'heal' });
      // support legends use their kit while healing
      const tac = LEGENDS[p.legend].tactical.id;
      if (p.tacCd <= 0 && (tac === 'drone' || tac === 'dome' || tac === 'smoke' || tac === 'gastrap')) {
        if (tac === 'smoke' && this.target) this._faceTarget(dt, this.target, true);
        m.useTac(p);
      }
    }
    if (!p.healing && !m.bestHeal(p)) this.state = 'roam';
    // shuffle while healing
    this.inp.mx = Math.sin(m.time * 3 + p.id) * 0.6;
    if (this.target && this.target.alive) this._faceTarget(dt, this.target, false);
  }

  _seekCover(dt) {
    const p = this.p, m = this.m, t = this.target;
    if (!this.cover || this.coverT < m.time) {
      this.coverT = m.time + 1.5;
      this.cover = null;
      const tx = t.ms.x, ty = t.ms.y + 1.5, tz = t.ms.z;
      let best = null, bd = 1e9;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const r = 4 + (i % 3) * 3;
        const cx = p.ms.x + Math.cos(a) * r, cz = p.ms.z + Math.sin(a) * r;
        if (m.world.overlaps(cx - 0.4, p.ms.y + 0.2, cz - 0.4, cx + 0.4, p.ms.y + 1.7, cz + 0.4, tmpBoxes)) continue;
        const dx = cx - tx, dy = p.ms.y + 1.1 - ty, dz = cz - tz;
        const d = Math.hypot(dx, dy, dz);
        const hit = m.world.raycast(tx, ty, tz, dx / d, dy / d, dz / d, d, tmpBoxes);
        if (hit && hit.t < d - 0.5) {
          const dd = r + (Math.hypot(cx - tx, cz - tz) < Math.hypot(p.ms.x - tx, p.ms.z - tz) ? 5 : 0);
          if (dd < bd) { bd = dd; best = { x: cx, z: cz }; }
        }
      }
      this.cover = best;
    }
    if (this.cover) this._moveTo(this.cover.x, this.cover.z, dt, true, 0.6);
    else {
      // no cover: back off strafing
      const dx = p.ms.x - t.ms.x, dz = p.ms.z - t.ms.z, d = Math.hypot(dx, dz) || 1;
      this._setMove(dx / d + this.strafe * 0.6, dz / d);
    }
  }

  _revive(dt) {
    const p = this.p, q = this.reviveTarget;
    if (!q || !q.downed || !q.alive) { this.state = 'roam'; return; }
    const d = Math.hypot(q.ms.x - p.ms.x, q.ms.z - p.ms.z);
    if (d > 1.6) {
      this._moveTo(q.ms.x, q.ms.z, dt, true, 1.2);
      this._lookMove(dt);
    } else {
      this.inp.buttons |= BTN.INTERACT;
      if (p.legend === 'volt' && p.tacCd <= 0 && this.m.time - this.lastCombat < 6) this.m.useTac(p);
    }
  }

  _banner(dt) {
    const p = this.p, e = this.bannerBox;
    if (!e || !this.m.entities.has(e.id) || e.bannerTaken) { this.state = 'roam'; return; }
    const d = Math.hypot(e.x - p.ms.x, e.z - p.ms.z);
    if (d < 2) this.m.action(p, { a: 'box', id: e.id });
    else { this._moveTo(e.x, e.z, dt, true, 1.5); this._lookMove(dt); }
  }

  _beacon(dt) {
    const p = this.p, m = this.m;
    let best = null, bd = 1e9;
    for (const b of m.map.beacons) {
      const d = Math.hypot(b.x - p.ms.x, b.z - p.ms.z);
      const inRing = Math.hypot(b.x - m.ring.cx, b.z - m.ring.cz) < m.ring.r - 10;
      if (inRing && d < bd) { bd = d; best = b; }
    }
    if (!best) { this.state = 'roam'; return; }
    if (bd < 2.4) this.inp.buttons |= BTN.INTERACT;
    else { this._moveTo(best.x + 1.5, best.z, dt, true, 1.5); this._lookMove(dt); }
  }

  _downed(dt) {
    // crawl toward nearest squadmate / away from enemy
    const p = this.p, m = this.m;
    const mate = this.squadmates().find((q) => q.alive && !q.downed && !q.eliminated);
    // under fire with a Fallback Shield: turn it toward the shooter and back-crawl to the squad
    const threat = p.kd > 0 && p.kdHp > 0 && m.time - p.lastHurt < 4 && m.players.get(p.lastAttacker);
    if (threat && threat.alive && Math.hypot(threat.ms.x - p.ms.x, threat.ms.z - p.ms.z) < 80) {
      this.yaw = Math.atan2(-(threat.ms.x - p.ms.x), -(threat.ms.z - p.ms.z));
      if (mate) this._moveTo(mate.ms.x, mate.ms.z, dt, false, 1.5);
      this.inp.buttons |= BTN.ADS;
      return;
    }
    if (mate) this._moveTo(mate.ms.x, mate.ms.z, dt, false, 1.5);
    this._lookMove(dt);
  }

  _faceTarget(dt, t, fire) {
    const p = this.p, m = this.m;
    const w = p.weapons[p.active];
    const def = w ? WEAPONS[w.id] : null;
    const ex = p.ms.x, ey = p.ms.y + eyeHeight(p.ms), ez = p.ms.z;
    const th = t.downed ? 0.4 : t.ms.crouch > 0.5 ? 0.8 : 1.25;
    let tx = t.ms.x, ty = t.ms.y + th, tz = t.ms.z;
    const dist = Math.hypot(tx - ex, ty - ey, tz - ez);
    // lead the target (imperfect)
    if (def) {
      const tt = dist / def.speed;
      const lead = 0.5 + this.skill * 0.5;
      tx += t.ms.vx * tt * lead; tz += t.ms.vz * tt * lead; ty += t.ms.vy * tt * 0.3;
      ty += 0.5 * 6 * def.drop * tt * tt; // compensate drop
    }
    // smooth aim error that tightens the longer we track
    this.err.t -= dt;
    if (this.err.t <= 0) this._newErr(false);
    const k = Math.min(1, dt * 3);
    this.err.x += (this.err.tx - this.err.x) * k;
    this.err.y += (this.err.ty - this.err.y) * k;
    this.err.z += (this.err.tz - this.err.z) * k;
    const tighten = 1 - Math.min(1, this.trackT / 2.2) * 0.55;
    tx += this.err.x * tighten; ty += this.err.y * tighten; tz += this.err.z * tighten;
    // occasional headshot attempt for skilled bots
    if (this.skill > 0.6 && (p.id + Math.floor(m.time)) % 3 === 0) ty += t.downed ? 0.25 : t.ms.crouch > 0.5 ? 0.22 : 0.42;
    const a = anglesFromDir(tx - ex, ty - ey, tz - ez);
    const dyaw = wrapAngle(a.yaw - this.yaw), dpitch = a.pitch - this.pitch;
    const maxTurn = (4 + this.skill * 9) * dt;
    const f = Math.min(1, dt * (6 + this.skill * 10));
    this.yaw = wrapAngle(this.yaw + clamp(dyaw * f, -maxTurn, maxTurn));
    this.pitch = clamp(this.pitch + clamp(dpitch * f, -maxTurn, maxTurn), -1.4, 1.4);
    return { dist, aimErr: Math.abs(wrapAngle(a.yaw - this.yaw)) + Math.abs(a.pitch - this.pitch) };
  }

  _fight(dt) {
    const p = this.p, m = this.m, t = this.target, inp = this.inp;
    if (!t || !t.alive || t.eliminated) { this.state = 'roam'; this.target = null; return; }
    this.trackT += dt;
    this.reactT -= dt;
    // weapon selection by range
    const dist2d = Math.hypot(t.ms.x - p.ms.x, t.ms.z - p.ms.z);
    this._pickWeapon(dist2d);
    const w = p.weapons[p.active];
    const def = w ? WEAPONS[w.id] : null;
    const aim = this._faceTarget(dt, t, true);
    // preferred engagement range
    let pref = 18;
    if (def) {
      if (def.cls === 'Shotgun' || def.cls === 'SMG') pref = 6;
      else if (def.cls === 'Pistol') pref = 10;
      else if (def.cls === 'Sniper' || def.cls === 'Marksman') pref = 45;
      else if (def.cls === 'LMG') pref = 20;
    }
    const weak = t.downed || (t.shield <= 0 && t.hp < 70);
    const myStrong = p.shield > (SHIELD_TIERS[p.armor] || 0) * 0.5 || p.hp > 80;
    if (this.role === 'tank') pref = Math.max(3, pref - 5);      // tanks take space up front
    if (this.role === 'support') pref += 7;                       // supports hold the back line
    if (weak && myStrong) pref = 2.5; // aggressive push
    if (!this.targetVisible) pref = 0;
    // strafe ADAD
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafe = m.rng() < 0.5 ? -1 : 1;
      this.strafeT = 0.25 + m.rng() * (0.6 - this.skill * 0.3);
      if (this.skill > 0.5 && m.rng() < 0.15 && dist2d < 25) this.wantJump = true;
    }
    const dx = t.ms.x - p.ms.x, dz = t.ms.z - p.ms.z;
    const d = dist2d || 1;
    let fwd = dist2d > pref + 3 ? 1 : dist2d < pref - 3 ? -0.8 : 0;
    // DPS swing wide to flank while closing; everyone else strafes around the line
    const flank = this.role === 'dps' && fwd > 0 && dist2d > 10 ? this.flankSide * 0.8 : 0;
    let mvx = (dx / d) * fwd + (-dz / d) * (this.strafe * 0.9 + flank);
    let mvz = (dz / d) * fwd + (dx / d) * (this.strafe * 0.9 + flank);
    const ml = Math.hypot(mvx, mvz) || 1;
    mvx /= ml; mvz /= ml;
    // wall at our strafe side: skilled bots kick off it (wall bounce) instead of just turning around
    this.bounceT = Math.max(0, (this.bounceT || 0) - dt);
    if (this.bounceT > 0) {
      if (!p.ms.onGround && p.ms.airT > 0.1 && p.ms.wallT < 0.1) { this.wantJump = true; this.bounceT = 0; this.strafe = -this.strafe; }
    } else if (this._probe(mvx, mvz, 1.0)) {
      if (p.ms.onGround && this.skill > 0.4 && m.rng() < 0.35) { this.wantJump = true; this.bounceT = 0.7; }
      else { this.strafe = -this.strafe; mvx = (dx / d) * fwd; mvz = (dz / d) * fwd; }
    }
    if (this.stuck.escapeT > 0) { mvx = this.stuck.ex; mvz = this.stuck.ez; this.stuck.escapeT -= dt; }
    this._setMove(mvx, mvz);
    if (fwd > 0 && dist2d > 15) inp.buttons |= BTN.SPRINT;
    // slide in when pushing close-range
    if (fwd > 0 && dist2d < 14 && dist2d > 5 && Math.hypot(p.ms.vx, p.ms.vz) > 5.8 && m.rng() < 0.08) inp.buttons |= BTN.CROUCH;
    // crouch spam (skilled)
    this.crouchT -= dt;
    if (this.skill > 0.55 && dist2d < 30 && this.crouchT < 0) {
      if (this.crouchT < -0.25) this.crouchT = 0.3 + m.rng() * 0.6;
      else inp.buttons |= BTN.CROUCH;
    }
    if (this.wantJump) { inp.buttons |= BTN.JUMP; this.wantJump = false; }
    if (!def) return;
    // ADS at range
    const ads = dist2d > 16 && def.cls !== 'Shotgun';
    if (ads) inp.buttons |= BTN.ADS;
    // fire
    const inRange = dist2d < (def.cls === 'Shotgun' ? 22 : def.cls === 'SMG' ? 55 : def.cls === 'Pistol' ? 60 : 160);
    const tol = Math.atan2(1.2, aim.dist) + 0.03;
    if (this.reactT <= 0 && this.targetVisible && inRange && aim.aimErr < tol) {
      // burst discipline: auto weapons fire bursts then re-center
      if (this.pauseT > 0) this.pauseT -= dt;
      else {
        const spread = currentSpread(def, p.ms, ads) * (1.4 - this.skill * 0.5);
        if (m.botFire(p, this.yaw, this.pitch, spread)) {
          if (def.mode !== 'auto') this.pauseT = 0.05 + (1 - this.skill) * 0.35;
        }
        this.burstT += dt;
        if (def.mode === 'auto' && this.burstT > 0.5 + this.skill * 1.2 && dist2d > 12) {
          this.burstT = 0;
          this.pauseT = 0.15 + (1 - this.skill) * 0.3;
        }
      }
    }
    if (w.mag === 0 && !p.reloading) {
      const other = p.weapons[1 - p.active];
      if (other && other.mag > 0 && m.rng() < 0.6) m.action(p, { a: 'slot', s: 1 - p.active });
      else m.action(p, { a: 'reload' });
    }
    // abilities
    this._combatAbilities(dist2d, weak);
    // grenades at a target that ducked into cover
    this.nadeT -= dt;
    if (this.nadeT <= 0 && dist2d > 10 && dist2d < 35 && m.time - this.lastSeen.t > 0.2) {
      this.nadeT = 8 + m.rng() * 10;
      if (countItem(p, 'g:frag') + countItem(p, 'g:arc') > 0) {
        const savedPitch = this.pitch;
        this.pitch = Math.min(0.9, Math.atan2(dist2d * 0.35, dist2d) + 0.1);
        m.action(p, { a: 'throw' });
        this.pitch = savedPitch;
      }
    }
  }

  // Is enemy q currently fighting one of our squadmates (tank peel)?
  _threatensMate(q) {
    for (const mate of this.squadmates()) {
      if (!mate.alive || mate.eliminated) continue;
      const near = Math.hypot(mate.ms.x - q.ms.x, mate.ms.z - q.ms.z) < 25;
      const hurt = mate.downed || mate.hp < 70 || mate.shield <= 0;
      if (near && (hurt || (q.bot && q.bot.target === mate))) return true;
    }
    return false;
  }

  _pickWeapon(dist) {
    const p = this.p, m = this.m;
    if (p.switchT > 0 || p.reloading) return;
    const a = p.weapons[p.active], b = p.weapons[1 - p.active];
    if (!b) return;
    const score = (w) => {
      if (!w) return -99;
      const d = WEAPONS[w.id];
      let s = w.mag > 0 ? 0 : -5;
      const close = d.cls === 'Shotgun' ? 3 : d.cls === 'SMG' ? 2 : 0;
      const far = d.cls === 'Sniper' ? 3 : d.cls === 'Marksman' ? 2.5 : d.cls === 'AR' || d.cls === 'LMG' ? 1.5 : 0;
      s += dist < 12 ? close : dist > 40 ? far : (close + far) * 0.5 + (d.cls === 'AR' ? 1 : 0);
      return s + w.tier * 0.3;
    };
    if (score(b) > score(a) + 1 && m.rng() < 0.3) m.action(p, { a: 'slot', s: 1 - p.active });
  }

  _combatAbilities(dist, weak) {
    const p = this.p, m = this.m;
    const L = LEGENDS[p.legend];
    if (p.tacCd <= 0 && (this.role === 'support' || this.role === 'tank') && m.rng() < 0.3) {
      const hurtMate = this.squadmates().some((q) => q.alive && !q.downed && (q.hp < 60 || q.shield <= 0) && Math.hypot(q.ms.x - p.ms.x, q.ms.z - p.ms.z) < 10);
      if (hurtMate && (L.tactical.id === 'drone' || L.tactical.id === 'dome' || L.tactical.id === 'riotwall')) { m.useTac(p); return; }
    }
    if (p.tacCd <= 0 && m.rng() < 0.25) {
      switch (L.tactical.id) {
        case 'stim': if (weak || dist > 12) m.useTac(p); break;
        case 'phase': if (p.hp < 50 && p.shield <= 0) m.useTac(p); break;
        case 'pulse': m.useTac(p); break;
        case 'missiles': if (dist > 8 && dist < 80) m.useTac(p); break;
        case 'dome': if (p.shield <= 0 && p.hp < 60) m.useTac(p); break;
        case 'gastrap': if (dist < 20) m.useTac(p); break;
        case 'riotwall': if (dist > 8 && dist < 50) m.useTac(p); break;
        case 'smoke': if (p.hp < 50 && dist > 10) m.useTac(p); break;
      }
    }
    if (p.ultCd <= 0 && m.rng() < 0.05) {
      switch (L.ultimate.id) {
        case 'bombard': case 'thunder': case 'gasnade': if (dist > 18 && dist < 90) m.useUlt(p); break;
        case 'exhibit': m.useUlt(p); break;
        case 'charge': if (dist < 16 && dist > 4) m.useUlt(p); break;
      }
    }
  }

  _utilityUlt() {
    const p = this.p, m = this.m;
    if (p.ultCd > 0 || m.time - this.lastCombat < 10) return;
    const L = LEGENDS[p.legend].ultimate.id;
    const R = m.ring;
    const ringFar = Math.hypot(p.ms.x - R.nx, p.ms.z - R.nz) > R.nr + 120;
    if (L === 'carepkg' && m.rng() < 0.01) m.useUlt(p);
    if (L === 'skyward' && ringFar && m.rng() < 0.02) m.useUlt(p);
    if (L === 'jumppad' && ringFar && m.rng() < 0.01) m.useUlt(p);
  }
}
