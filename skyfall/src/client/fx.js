// Visual effects: bullet tracers, impact sparks, shield/flesh hit bursts, explosions, floating
// damage numbers, and visuals for every ability entity (domes, smoke, gas, portals, pads...).

import * as THREE from 'three';
import { SHIELD_COLORS } from '../shared/constants.js';
import { RARITY } from '../shared/items.js';

function softTex(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const SOFT = softTex();
const PUFF = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 14; i++) {
    const x = 40 + Math.random() * 48, y = 40 + Math.random() * 48, r = 20 + Math.random() * 26;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
})();

class Particles {
  constructor(scene, max, additive = true) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: additive ? SOFT : PUFF }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float scale;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb, t.a * vA); if (gl_FragColor.a < 0.01) discard; }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, color, size, life, grav = 9.8, grow = 0) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life; this.grav[i] = grav; this.grow[i] = grow;
    this.alpha[i] = 1;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k + 1] -= this.grav[i] * dt;
      const drag = 1 - Math.min(1, dt * 2.5);
      this.vel[k] *= drag; this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = Math.max(0, this.life[i] / this.maxLife[i]);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
  }
}

const tmpC = new THREE.Color();

export class FX {
  constructor(scene, camera, world) {
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    this.sparks = new Particles(scene, 2500, true);
    this.smoke = new Particles(scene, 1200, false);
    // tracers
    this.tracerGeo = new THREE.BoxGeometry(0.03, 0.03, 1);
    this.tracerGeo.translate(0, 0, -0.5);
    this.tracers = [];
    this.bullets = [];
    this.flashes = [];
    this.lights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight('#ffaa55', 0, 30, 2);
      scene.add(l);
      this.lights.push({ l, t: 0, max: 0 });
    }
    this.entityViews = new Map();
    this.dmgLayer = document.getElementById('dmgnums');
    this.dmgNums = [];
    this.tmpV = new THREE.Vector3();
    this.tmpBoxes = [];
  }

  // ---- bullets ------------------------------------------------------------
  spawnBullet(o, d, speed, drop, color = '#ffd27a', width = 1) {
    let tr = this.tracers.pop();
    if (!tr) {
      tr = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.scene.add(tr);
    }
    tr.material.color.set(color);
    tr.visible = true;
    tr.scale.set(width, width, 0.01);
    const b = { x: o.x, y: o.y, z: o.z, vx: d.x * speed, vy: d.y * speed, vz: d.z * speed, g: 6 * drop, life: 1.6, tr, traveled: 0, dead: false };
    this.bullets.push(b);
    return b;
  }

  _updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      if (!b.dead) {
        b.vy -= b.g * dt;
        const sx = b.x, sy = b.y, sz = b.z;
        const dx = b.vx * dt, dy = b.vy * dt, dz = b.vz * dt;
        const len = Math.hypot(dx, dy, dz);
        const hit = this.world.raycast(sx, sy, sz, dx / len, dy / len, dz / len, len, this.tmpBoxes);
        if (hit) {
          b.x = sx + (dx / len) * hit.t; b.y = sy + (dy / len) * hit.t; b.z = sz + (dz / len) * hit.t;
          b.dead = true;
          b.life = Math.min(b.life, 0.03);
          if (!b.silent) this.impact(b.x, b.y, b.z, hit.nx, hit.ny, hit.nz);
        } else { b.x += dx; b.y += dy; b.z += dz; }
        b.traveled += len;
      }
      const tr = b.tr;
      const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
      const tail = Math.min(b.traveled, 14, sp * 0.03);
      tr.position.set(b.x, b.y, b.z);
      tr.lookAt(b.x + b.vx / sp, b.y + b.vy / sp, b.z + b.vz / sp);
      tr.scale.z = Math.max(0.01, tail);
      if (b.life <= 0) {
        tr.visible = false;
        this.tracers.push(tr);
        this.bullets.splice(i, 1);
      }
    }
  }

  killBullet(b, x, y, z) {
    b.dead = true;
    b.x = x; b.y = y; b.z = z;
    b.life = Math.min(b.life, 0.03);
  }

  // ---- impacts / hits -----------------------------------------------------
  impact(x, y, z, nx = 0, ny = 1, nz = 0) {
    tmpC.set('#ffcf7a');
    for (let i = 0; i < 7; i++) {
      this.sparks.emit(x, y, z, nx * 4 + (Math.random() - 0.5) * 6, ny * 4 + Math.random() * 3, nz * 4 + (Math.random() - 0.5) * 6, tmpC, 0.07, 0.2 + Math.random() * 0.2, 14);
    }
    // occasional ricochet streak
    if (Math.random() < 0.2) {
      tmpC.set('#fff0c0');
      const rx = nx * 18 + (Math.random() - 0.5) * 20, ry = ny * 18 + Math.random() * 8, rz = nz * 18 + (Math.random() - 0.5) * 20;
      for (let k = 0; k < 4; k++) this.sparks.emit(x + rx * k * 0.006, y + ry * k * 0.006, z + rz * k * 0.006, rx, ry, rz, tmpC, 0.09 - k * 0.015, 0.12, 9);
    }
    tmpC.set('#9a9080');
    this.smoke.emit(x + nx * 0.1, y + ny * 0.1, z + nz * 0.1, nx * 0.6, 0.4 + ny * 0.5, nz * 0.6, tmpC, 0.45, 0.8, -0.2, 1.4);
    this.decal(x, y, z, nx, ny, nz);
  }

  // bullet hole decals (pooled, fade out)
  decal(x, y, z, nx, ny, nz) {
    if (!this.decals) {
      this.decals = [];
      this.decalIdx = 0;
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grd.addColorStop(0, 'rgba(10,8,6,1)'); grd.addColorStop(0.35, 'rgba(30,26,22,0.9)'); grd.addColorStop(0.6, 'rgba(60,55,50,0.35)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
      this.decalMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
      this.decalGeo = new THREE.PlaneGeometry(0.16, 0.16);
      for (let i = 0; i < 160; i++) { const m = new THREE.Mesh(this.decalGeo, this.decalMat); m.visible = false; this.scene.add(m); this.decals.push(m); }
    }
    const m = this.decals[this.decalIdx];
    this.decalIdx = (this.decalIdx + 1) % this.decals.length;
    m.visible = true;
    m.position.set(x + nx * 0.01, y + ny * 0.01, z + nz * 0.01);
    m.lookAt(x + nx, y + ny, z + nz);
    m.rotateZ(Math.random() * Math.PI);
    const sc = 0.7 + Math.random() * 0.6;
    m.scale.set(sc, sc, 1);
  }

  dust(x, y, z, amt = 1) {
    for (let i = 0; i < 10 * amt; i++) {
      tmpC.setHSL(0.09, 0.15, 0.45 + Math.random() * 0.1);
      const a = Math.random() * Math.PI * 2;
      this.smoke.emit(x + Math.cos(a) * 0.3, y + 0.1, z + Math.sin(a) * 0.3, Math.cos(a) * 2.5 * amt, 0.4 + Math.random() * 0.6, Math.sin(a) * 2.5 * amt, tmpC, 0.6 * amt, 0.6 + Math.random() * 0.4, -0.1, 1.6);
    }
  }

  // world-space muzzle flash for other players' shots
  muzzleFlashWorld(o, d, w) {
    if (!this.mflash) {
      this.mflash = [];
      for (let i = 0; i < 16; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT, color: '#ffd28a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
        sp.visible = false;
        this.scene.add(sp);
        this.mflash.push({ sp, t: 0 });
      }
      this.mfi = 0;
    }
    const f = this.mflash[this.mfi];
    this.mfi = (this.mfi + 1) % this.mflash.length;
    f.sp.position.set(o.x + d[0] * 0.8, o.y + d[1] * 0.8 - 0.15, o.z + d[2] * 0.8);
    const big = w.pellets || w.cls === 'Sniper' ? 1.6 : 1;
    f.sp.scale.set(0.9 * big, 0.9 * big, 1);
    f.sp.material.color.set(w.sound.zap ? '#c6ff7a' : '#ffd28a');
    f.sp.visible = true;
    f.t = 0.05;
    this.flashLight(o.x, o.y, o.z, 5, 0.05, w.sound.zap ? '#b7ff6a' : '#ffbb66');
  }

  // Weighty death: the body is detached, thrown along the killing blow, tumbles and settles.
  ragdoll(avatar, ev) {
    const body = avatar.root.clone(true);
    body.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    body.remove(...body.children.filter((c) => c.isSprite));
    this.scene.add(body);
    let dx = body.position.x - (ev.ax ?? body.position.x), dz = body.position.z - (ev.az ?? body.position.z);
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    if (!isFinite(dx)) { dx = 0; dz = 1; }
    this.ragdolls = this.ragdolls || [];
    this.ragdolls.push({
      obj: body, vx: dx * 4 + (Math.random() - 0.5), vy: 3.5, vz: dz * 4 + (Math.random() - 0.5),
      ax: -dz * 6, az: dx * 6, ay: (Math.random() - 0.5) * 4, t: 0, settled: false, ground: body.position.y,
    });
    avatar.root.visible = false;
    avatar.dead = true;
  }

  deathBurst(x, y, z, mine) {
    tmpC.set(mine ? '#ff3b3b' : '#ff7a5a');
    for (let i = 0; i < 36; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random();
      this.sparks.emit(x, y, z, Math.cos(a) * 5 * (1 - e), e * 7, Math.sin(a) * 5 * (1 - e), tmpC, 0.16, 0.7, 6);
    }
    tmpC.set('#ffffff');
    for (let i = 0; i < 14; i++) this.sparks.emit(x + (Math.random() - 0.5), y - 0.5 + Math.random(), z + (Math.random() - 0.5), 0, 2 + Math.random() * 2, 0, tmpC, 0.1, 1.2, -1);
    this.flashLight(x, y, z, mine ? 25 : 12, 0.25, '#ff4a2a');
  }

  _updateRagdolls(dt) {
    if (!this.ragdolls) return;
    for (let i = this.ragdolls.length - 1; i >= 0; i--) {
      const r = this.ragdolls[i], o = r.obj;
      r.t += dt;
      if (!r.settled) {
        r.vy -= 19 * dt;
        o.position.x += r.vx * dt; o.position.y += r.vy * dt; o.position.z += r.vz * dt;
        o.rotation.x += r.ax * dt * 0.3; o.rotation.z += r.az * dt * 0.3; o.rotation.y += r.ay * dt;
        const g = this.world.groundAt(o.position.x, o.position.z, o.position.y + 1, this.tmpBoxes);
        if (o.position.y < g) {
          o.position.y = g;
          if (Math.abs(r.vy) > 3) { r.vy = -r.vy * 0.3; r.vx *= 0.5; r.vz *= 0.5; this.dust(o.position.x, g, o.position.z, 0.8); }
          else r.settled = true;
        }
      } else {
        // collapse flat
        o.rotation.x += (-Math.PI / 2 - o.rotation.x) * Math.min(1, dt * 6);
        o.rotation.z *= 1 - Math.min(1, dt * 6);
      }
      if (r.t > 5) o.position.y -= dt * 0.6; // sink into the ground
      if (r.t > 7) { this.scene.remove(o); this.ragdolls.splice(i, 1); }
    }
  }

  hitBurst(x, y, z, shieldTier, onShield, head) {
    const col = onShield ? SHIELD_COLORS[shieldTier] || '#ffffff' : head ? '#ffd23f' : '#ff3030';
    tmpC.set(col);
    const n = head ? 18 : 11;
    for (let i = 0; i < n; i++) {
      this.sparks.emit(x, y, z, (Math.random() - 0.5) * 8, Math.random() * 5, (Math.random() - 0.5) * 8, tmpC, onShield ? 0.13 : 0.1, 0.25 + Math.random() * 0.15, onShield ? 4 : 12);
    }
    // a bright flare at the impact point so hits read even at range
    this.sparks.emit(x, y, z, 0, 0, 0, tmpC, onShield ? 0.7 : 0.45, 0.08, 0);
    if (!onShield) {
      tmpC.set('#8a0c0c');
      for (let i = 0; i < 3; i++) this.smoke.emit(x, y, z, (Math.random() - 0.5) * 1.5, 0.3, (Math.random() - 0.5) * 1.5, tmpC, 0.3, 0.45, 2, 1.2);
    }
  }

  shieldBreak(x, y, z, tier) {
    tmpC.set(SHIELD_COLORS[tier] || '#fff');
    // expanding ring of shards + bright pop
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * 2;
      this.sparks.emit(x, y, z, Math.cos(a) * 7, e * 4, Math.sin(a) * 7, tmpC, 0.18, 0.7, 6);
    }
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      this.sparks.emit(x, y, z, Math.cos(a) * 10, 0, Math.sin(a) * 10, tmpC, 0.22, 0.25, 0);
    }
    this.sparks.emit(x, y, z, 0, 0, 0, tmpC, 2.2, 0.15, 0);
    this.flashLight(x, y, z, 18, 0.2, SHIELD_COLORS[tier] || '#fff');
  }

  explosion(x, y, z, r = 5) {
    tmpC.set('#ffb347');
    for (let i = 0; i < 50; i++) {
      this.sparks.emit(x, y + 0.3, z, (Math.random() - 0.5) * r * 6, Math.random() * r * 3, (Math.random() - 0.5) * r * 6, tmpC, 0.25, 0.4 + Math.random() * 0.5, 10);
    }
    for (let i = 0; i < 16; i++) {
      tmpC.setHSL(0.07, 0.1, 0.25 + Math.random() * 0.2);
      this.smoke.emit(x + (Math.random() - 0.5) * r, y + Math.random() * r * 0.6, z + (Math.random() - 0.5) * r, (Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2, tmpC, r * 0.8, 2 + Math.random(), -0.3, r * 0.6);
    }
    tmpC.set('#fff3c4');
    this.sparks.emit(x, y + 0.5, z, 0, 0, 0, tmpC, r * 2.5, 0.18, 0);
    this.flashLight(x, y + 1, z, 40, 0.25, '#ffaa55');
  }

  flashLight(x, y, z, intensity, dur, color) {
    const L = this.lights.reduce((a, b) => (a.t < b.t ? a : b));
    L.l.position.set(x, y, z);
    L.l.color.set(color);
    L.t = dur; L.max = dur; L.int = intensity;
  }

  muzzleWorld(x, y, z) {
    tmpC.set('#ffd28a');
    this.sparks.emit(x, y, z, 0, 0, 0, tmpC, 0.6, 0.05, 0);
  }

  burst(x, y, z, color, n = 20, speed = 4, size = 0.15, life = 0.6) {
    tmpC.set(color);
    for (let i = 0; i < n; i++) this.sparks.emit(x, y, z, (Math.random() - 0.5) * speed * 2, Math.random() * speed, (Math.random() - 0.5) * speed * 2, tmpC, size, life, 3);
  }

  ring(x, y, z, color, r) {
    tmpC.set(color);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      this.sparks.emit(x, y + 0.2, z, Math.cos(a) * r * 2, 0.5, Math.sin(a) * r * 2, tmpC, 0.3, 0.5, 0);
    }
  }

  // ---- damage numbers -----------------------------------------------------
  damageNumber(x, y, z, dmg, color, head, key, shieldStyle) {
    // merge rapid hits on the same target (shotgun pellets, fast SMG bursts) into one number
    if (key !== undefined) {
      const ex = this.dmgNums.find((d) => d.key === key && d.t < 0.12);
      if (ex) {
        ex.val += dmg;
        ex.el.textContent = ex.val;
        ex.el.style.color = color;
        if (head) ex.el.classList.add('head');
        ex.t = 0;
        return;
      }
    }
    const el = document.createElement('div');
    el.className = 'dmgnum' + (head ? ' head' : '') + (shieldStyle ? ' crack' : '');
    el.textContent = dmg;
    el.style.color = color;
    this.dmgLayer.appendChild(el);
    this.dmgNums.push({ el, key, val: dmg, x: x + (Math.random() - 0.5) * 0.4, y: y + 0.2, z: z + (Math.random() - 0.5) * 0.4, t: 0, vx: (Math.random() - 0.5) * 30 });
  }

  _updateDmg(dt) {
    const v = this.tmpV;
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = this.dmgNums.length - 1; i >= 0; i--) {
      const d = this.dmgNums[i];
      d.t += dt;
      if (d.t > 0.9) { d.el.remove(); this.dmgNums.splice(i, 1); continue; }
      v.set(d.x, d.y, d.z).project(this.camera);
      if (v.z > 1) { d.el.style.display = 'none'; continue; }
      d.el.style.display = '';
      const sx = (v.x * 0.5 + 0.5) * w + d.vx * d.t, sy = (-v.y * 0.5 + 0.5) * h - d.t * 60;
      const sc = d.t < 0.08 ? 1.5 - d.t * 6 : 1;
      d.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%,-50%) scale(${sc})`;
      d.el.style.opacity = d.t > 0.6 ? (0.9 - d.t) / 0.3 : 1;
    }
  }

  // ---- ability / world entities --------------------------------------------
  syncEntities(list, time, mySquad) {
    const seen = new Set();
    for (const e of list) {
      seen.add(e.id);
      let v = this.entityViews.get(e.id);
      if (!v) {
        v = this._makeEntity(e, mySquad);
        if (!v) continue;
        this.entityViews.set(e.id, v);
      }
      v.data = e;
    }
    for (const [id, v] of this.entityViews) {
      if (!seen.has(id)) {
        this.scene.remove(v.obj);
        if (v.extra) this.scene.remove(v.extra);
        this.entityViews.delete(id);
      }
    }
  }

  _makeEntity(e, mySquad) {
    const g = new THREE.Group();
    g.position.set(e.x, e.y, e.z);
    const add = (m) => { g.add(m); return m; };
    const basic = (color, opacity = 1, additive = false) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide });
    const v = { obj: g, data: e, kind: e.k, t: 0 };
    switch (e.k) {
      case 'box': {
        const m = add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: '#30343c', emissive: RARITY[Math.max(0, e.tier - 1)] || '#555', emissiveIntensity: 0.35 })));
        m.position.y = 0.3;
        m.castShadow = true;
        if (e.sq === mySquad) {
          v.banner = add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 6, 6), basic('#4fb3ff', 0.6, true)));
          v.banner.position.y = 3;
        }
        break;
      }
      case 'carepkg': {
        const m = add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.7, 1.4), new THREE.MeshStandardMaterial({ color: '#d8dbe0', emissive: '#ffd23f', emissiveIntensity: 0.25, metalness: 0.4, roughness: 0.4 })));
        m.position.y = 0.85;
        m.castShadow = true;
        v.pod = m;
        v.beam = add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 300, 8, 1, true), basic('#ffd23f', 0.25, true)));
        v.beam.position.y = 150;
        break;
      }
      case 'dome': {
        const mat = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
          uniforms: { time: { value: 0 } },
          vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix*mv; }',
          fragmentShader: 'uniform float time; varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ float f = pow(1.0-abs(dot(vN,vV)), 2.5); float hex = 0.5+0.5*sin(vP.x*6.0+time)*sin(vP.y*6.0)*sin(vP.z*6.0-time); gl_FragColor = vec4(vec3(0.3,0.65,1.0)*(f*1.2+0.08+hex*0.06), 1.0); }',
        });
        v.mat = mat;
        const m = add(new THREE.Mesh(new THREE.SphereGeometry(e.r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat));
        m.renderOrder = 3;
        break;
      }
      case 'smoke': case 'gas': {
        v.puffs = [];
        const col = e.k === 'smoke' ? '#c9ccd2' : '#9bd84a';
        const n = e.k === 'smoke' ? 36 : 26;
        for (let i = 0; i < n; i++) {
          const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: PUFF, color: col, transparent: true, opacity: e.k === 'smoke' ? 0.95 : 0.5, depthWrite: false }));
          const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * e.r * 0.85;
          s.position.set(Math.cos(a) * r, 1 + Math.random() * (e.k === 'smoke' ? 5 : 2.5), Math.sin(a) * r);
          const sc = (e.k === 'smoke' ? 6 : 5) + Math.random() * 3;
          s.scale.set(sc, sc, 1);
          s.userData.base = s.position.clone();
          s.userData.ph = Math.random() * 6;
          g.add(s);
          v.puffs.push(s);
        }
        if (e.k === 'gas') {
          const disc = add(new THREE.Mesh(new THREE.CircleGeometry(e.r, 32), basic('#9bd84a', 0.18)));
          disc.rotation.x = -Math.PI / 2;
          disc.position.y = 0.05;
        }
        break;
      }
      case 'gastrap': {
        const m = add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.8, 10), new THREE.MeshStandardMaterial({ color: '#5a6a3a', metalness: 0.4 })));
        m.position.y = 0.4;
        m.castShadow = true;
        v.light = add(new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), basic('#b6ff3a')));
        v.light.position.y = 0.85;
        break;
      }
      case 'jumppad': {
        const m = add(new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 0.15, 20), new THREE.MeshStandardMaterial({ color: '#2a2e35', metalness: 0.5 })));
        m.position.y = 0.08;
        v.glow = add(new THREE.Mesh(new THREE.RingGeometry(0.5, 1.1, 24), basic('#ff7a1a', 0.9, true)));
        v.glow.rotation.x = -Math.PI / 2;
        v.glow.position.y = 0.17;
        break;
      }
      case 'portal': {
        const mk = () => {
          const pg = new THREE.Group();
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.08, 8, 32), basic('#b48bff', 1, true));
          ring.position.y = 1.1;
          pg.add(ring);
          const disc = new THREE.Mesh(new THREE.CircleGeometry(0.85, 24), basic('#4b1d9e', 0.65, true));
          disc.position.y = 1.1;
          pg.add(disc);
          pg.userData.ring = ring; pg.userData.disc = disc;
          return pg;
        };
        v.a = mk(); v.b = mk();
        g.add(v.a);
        this.scene.add(v.b);
        v.extra = v.b;
        break;
      }
      case 'drone': {
        v.drone = add(new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), new THREE.MeshStandardMaterial({ color: '#e8f5ee', emissive: '#4fe39b', emissiveIntensity: 0.6 })));
        const ring = add(new THREE.Mesh(new THREE.RingGeometry(e.r - 0.1, e.r, 48), basic('#4fe39b', 0.35, true)));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = -1.5;
        break;
      }
      case 'mortar': {
        const ring = add(new THREE.Mesh(new THREE.RingGeometry(e.r - 0.4, e.r, 64), basic('#ff3b3b', 0.7, true)));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.2;
        const fill = add(new THREE.Mesh(new THREE.CircleGeometry(e.r, 64), basic('#ff3b3b', 0.1, true)));
        fill.rotation.x = -Math.PI / 2;
        fill.position.y = 0.15;
        break;
      }
      case 'thunder': {
        for (let i = 0; i < 8; i++) {
          const f = add(new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), basic('#5ad1ff', 1, true)));
          f.position.set(e.dx * i * 9, 0.3, e.dz * i * 9);
        }
        break;
      }
      case 'exhibit': {
        const m = add(new THREE.Mesh(new THREE.SphereGeometry(e.r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd23f', wireframe: true, transparent: true, opacity: 0.05, depthWrite: false })));
        m.renderOrder = 2;
        break;
      }
      case 'proj': {
        const col = { frag: '#2f4f2f', arc: '#5ad1ff', missile: '#ff7a1a', domeproj: '#3fa9ff', padproj: '#ff7a1a', gasproj: '#9bd84a', smokeproj: '#c9ccd2' }[e.pk] || '#fff';
        const glow = e.pk === 'arc' || e.pk === 'missile';
        add(new THREE.Mesh(new THREE.SphereGeometry(e.pk === 'missile' ? 0.15 : 0.12, 8, 6), glow ? basic(col, 1, true) : new THREE.MeshStandardMaterial({ color: col })));
        v.trail = glow;
        break;
      }
      default:
        return null;
    }
    this.scene.add(g);
    return v;
  }

  _updateEntities(dt, time) {
    for (const v of this.entityViews.values()) {
      const e = v.data, g = v.obj;
      v.t += dt;
      // smooth position (projectiles move)
      g.position.x += (e.x - g.position.x) * Math.min(1, dt * 20);
      g.position.y += (e.y - g.position.y) * Math.min(1, dt * 20);
      g.position.z += (e.z - g.position.z) * Math.min(1, dt * 20);
      switch (v.kind) {
        case 'carepkg':
          if (!e.landed) v.pod.position.y = 0.85 + (e.lt / 7) * 220;
          else v.pod.position.y = 0.85;
          v.beam.material.opacity = e.landed && e.n === 0 ? 0.05 : 0.25;
          break;
        case 'dome': v.mat.uniforms.time.value = time; break;
        case 'smoke': case 'gas':
          for (const s of v.puffs) {
            const b = s.userData.base;
            s.position.set(b.x + Math.sin(time * 0.4 + s.userData.ph) * 0.6, b.y + Math.sin(time * 0.3 + s.userData.ph) * 0.3, b.z + Math.cos(time * 0.35 + s.userData.ph) * 0.6);
            if (e.t < 1.5) s.material.opacity = Math.min(s.material.opacity, e.t / 1.5);
          }
          break;
        case 'gastrap': v.light.visible = e.armed && Math.sin(time * 6) > 0; break;
        case 'jumppad': v.glow.material.opacity = 0.5 + 0.4 * Math.sin(time * 5); break;
        case 'portal':
          v.b.position.set(e.x2, e.y2, e.z2);
          v.b.visible = !!e.open;
          for (const pg of [v.a, v.b]) { pg.userData.ring.rotation.z = time; pg.userData.disc.rotation.z = -time * 2; pg.lookAt(this.camera.position.x, pg.position.y, this.camera.position.z); }
          break;
        case 'drone': v.drone.position.y = Math.sin(time * 3) * 0.15; break;
        case 'proj':
          if (v.trail) { tmpC.set('#ffaa55'); this.sparks.emit(g.position.x, g.position.y, g.position.z, 0, 0, 0, tmpC, 0.25, 0.25, 0); }
          break;
      }
    }
  }

  update(dt, time) {
    this._updateBullets(dt);
    this.sparks.update(dt);
    this.smoke.update(dt);
    for (const L of this.lights) {
      if (L.t > 0) { L.t -= dt; L.l.intensity = (Math.max(0, L.t) / L.max) * L.int; }
      else L.l.intensity = 0;
    }
    this._updateEntities(dt, time);
    this._updateDmg(dt);
    this._updateRagdolls(dt);
    if (this.mflash) for (const f of this.mflash) { if (f.t > 0) { f.t -= dt; if (f.t <= 0) f.sp.visible = false; } }
  }

  clear() {
    if (this.ragdolls) for (const r of this.ragdolls) this.scene.remove(r.obj);
    this.ragdolls = [];
    for (const v of this.entityViews.values()) { this.scene.remove(v.obj); if (v.extra) this.scene.remove(v.extra); }
    this.entityViews.clear();
    for (const d of this.dmgNums) d.el.remove();
    this.dmgNums = [];
  }
}
