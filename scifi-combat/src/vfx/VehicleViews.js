// VehicleViews: graybox presentation for vehicles. Read-only; reads VehicleSystem state each frame.
//
// Readability: team-colored hulls (enemy = red trim), a turret that visibly lags the camera
// (its turn rate is the counterplay), a glowing rear weak-spot vent, an HP bar above enemy vehicles,
// a boost flame, darkening and smoke at low HP, and exposed riders drawn on top of bikes.
// Field guns: wheels, shield and a split trail that spreads when the gun is set up, the barrel laid
// and elevated where the sim has it (it recoils on every shot); rocket batteries raise their rack
// and drop their stabilizers; supply trucks show their cargo as crates in the bed.

import * as THREE from 'three';
import { bus } from '../core/EventBus.js';

const TEAM = ['#d9a441', '#6b3fa0'];
const ENEMY_TRIM = '#ff3b5c';
const STEEL = '#3a3d42', DARK = '#1d1f22', WOOD = '#7a5a36';
const box = (w, h, d, color) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.7 }));
const wheel = (r, w) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14), new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.9 })); m.rotation.z = Math.PI / 2; return m; };

export class VehicleViews {
  constructor(scene, world, { localTeam = 0 } = {}) {
    this.scene = scene;
    this.world = world;
    this.localTeam = localTeam;
    this.views = new Map();
    this.time = 0;
    bus.on('vehicle:spawn', (e) => this.#add(e));
    bus.on('vehicle:removed', (e) => this.#remove(e.id));
    bus.on('vehicle:destroyed', (e) => this.#burst(new THREE.Vector3().fromArray(e.at)));
    bus.on('gun:fire', (e) => { const view = this.views.get(e.id); if (view) view.parts.recoil = 1; });
    // Vehicles already in the world (pads fill up while the match is built, before any view exists).
    for (const v of world.vehicles.list) if (!v.removed) this.#add({ id: v.id });
  }

  #add(e) {
    const v = this.world.vehicles.list.find((x) => x.id === e.id);
    if (!v) return;
    const d = v.def;
    const color = TEAM[v.team] ?? '#888';
    const trim = v.team === this.localTeam ? color : ENEMY_TRIM;
    const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.6 });
    const root = new THREE.Group();
    const parts = { mat };
    if (d.model === 'gun') this.#fieldGun(v, root, parts, mat, trim);
    else {
      const truck = !!(d.gun || d.cargo);   // trucks: a low chassis under the cab and bed
      const hull = new THREE.Mesh(new THREE.BoxGeometry(d.size.x, d.size.y * (truck ? 0.18 : d.model === 'tracked' ? 0.55 : 0.6), d.size.z), mat);
      hull.position.y = d.size.y * (truck ? 0.3 : 0.3);
      hull.castShadow = true;
      root.add(hull);
      parts.hull = hull;
      // Trim stripe: the fastest team read at range.
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(d.size.x * 1.02, 0.12, d.size.z * 1.02), new THREE.MeshBasicMaterial({ color: trim }));
      stripe.position.y = d.size.y * 0.3;
      root.add(stripe);
    }

    if (d.model === 'gun') { /* built above */ }
    else if (d.gun || d.cargo) this.#truck(v, root, parts, mat);
    else if (d.model === 'tracked') {
      const turret = new THREE.Group(); turret.position.y = d.size.y * 0.75;
      const dome = new THREE.Mesh(new THREE.CylinderGeometry(d.size.x * 0.32, d.size.x * 0.38, d.size.y * 0.4, 16), mat);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, d.size.z * 0.7, 10), new THREE.MeshStandardMaterial({ color: '#333' }));
      barrel.rotation.x = Math.PI / 2; barrel.position.z = -d.size.z * 0.4;
      turret.add(dome, barrel);
      root.add(turret);
      parts.turret = turret;
      for (const side of [-1, 1]) {
        const track = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, d.size.z * 1.05), new THREE.MeshStandardMaterial({ color: '#222' }));
        track.position.set(side * (d.size.x / 2 + 0.2), 0.35, 0);
        root.add(track);
      }
    } else if (d.model === 'flyer') {
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(d.size.x * 0.6, 0.2, d.size.z * 0.4), mat);
        wing.position.set(side * d.size.x * 0.75, d.size.y * 0.4, 0.5);
        root.add(wing);
      }
    } else {
      const nose = new THREE.Mesh(new THREE.ConeGeometry(d.size.x * 0.45, d.size.z * 0.4, 8), mat);
      nose.rotation.x = -Math.PI / 2; nose.position.set(0, d.size.y * 0.3, -d.size.z * 0.65);
      root.add(nose);
    }
    // Rear weak spot glows so players learn where to shoot.
    if (d.weakSpot === 'rear') {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(d.size.x * 0.6, d.size.y * 0.3, 0.1), new THREE.MeshBasicMaterial({ color: '#ffb347' }));
      vent.position.set(0, d.size.y * 0.35, d.size.z / 2 + 0.05);
      root.add(vent);
    }
    // Boost flame (hover vehicles) and low-HP smoke puffs.
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.6, 10), new THREE.MeshBasicMaterial({ color: v.team === 0 ? '#ffcf6b' : '#a970ff', transparent: true, opacity: 0.85 }));
    flame.rotation.x = Math.PI / 2; flame.position.set(0, d.size.y * 0.3, d.size.z / 2 + 0.8); flame.visible = false;
    if (d.model !== 'hover') flame.visible = false;
    root.add(flame);
    parts.flame = flame;
    const smoke = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), new THREE.MeshBasicMaterial({ color: '#222', transparent: true, opacity: 0.5, depthWrite: false }));
    smoke.position.y = d.size.y; smoke.visible = false;
    root.add(smoke);
    parts.smoke = smoke;
    // HP bar (enemies only; your own HP is on the HUD).
    if (v.team !== this.localTeam) {
      const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.18), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.6, depthTest: false }));
      const fg = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.18).translate(1, 0, 0), new THREE.MeshBasicMaterial({ color: ENEMY_TRIM, depthTest: false }));
      fg.position.x = -1; fg.position.z = 0.01;
      const bar = new THREE.Group(); bar.add(bg, fg); bar.position.y = d.size.y + 1.2;
      bar.renderOrder = 10; root.add(bar);
      parts.bar = bar; parts.fg = fg;
    }
    this.scene.add(root);
    this.views.set(v.id, { v, root, parts });
  }

  update(dt, camera) {
    this.time += dt;
    for (const { v, root, parts } of this.views.values()) {
      const s = v.movement.state;
      root.position.copy(s.position); root.position.y -= v.def.hoverHeight ?? 0;
      root.rotation.y = v.yaw;
      // Bikes bank into turns; dropships pitch with speed.
      const lat = s.velocity.x * Math.cos(v.yaw) - s.velocity.z * Math.sin(v.yaw);
      root.rotation.z = THREE.MathUtils.damp(root.rotation.z, v.def.model === 'hover' ? -lat * 0.04 : 0, 6, dt);
      if (parts.turret) parts.turret.rotation.y = v.turretYaw - v.yaw;
      if (v.gun) this.#gunPose(v, parts, dt);
      if (parts.crates) { const k = v.cargo / (v.def.cargo || 1); parts.crates.forEach((c, i) => { c.visible = i < Math.ceil(k * parts.crates.length - 1e-6); }); }
      parts.flame.visible = v.boostTime > 0;
      if (parts.flame.visible) parts.flame.scale.setScalar(0.9 + Math.sin(this.time * 40) * 0.15);
      const hpFrac = v.health.hp / v.health.max;
      parts.mat.emissive.set(v.status.silenced ? '#1f3a66' : '#000');
      parts.mat.color.set(TEAM[v.team]).multiplyScalar(0.4 + 0.6 * hpFrac);
      parts.smoke.visible = hpFrac < 0.35;
      if (parts.smoke.visible) { parts.smoke.position.y = v.def.size.y + ((this.time * 2) % 1.5); parts.smoke.material.opacity = 0.6 - ((this.time * 2) % 1.5) * 0.35; }
      if (parts.bar) { parts.fg.scale.x = Math.max(0.001, hpFrac); if (camera) parts.bar.quaternion.copy(root.quaternion).invert().multiply(camera.quaternion); }
    }
  }

  /**
   * A towed field piece: axle and wheels, a shield, a split trail toward the rear (spread and
   * spaded when set up), and the barrel on its trunnion.
   */
  #fieldGun(v, root, parts, mat, trim) {
    const d = v.def, g = d.gun, W = d.size.x, L = d.size.z, small = g.kind === 'at';
    const tr = g.trunnion ?? [0, 1, 0];
    const axle = box(W * 0.85, 0.22, 0.3, STEEL); axle.position.set(0, tr[1] * 0.5, tr[2] + 0.2); root.add(axle);
    for (const side of [-1, 1]) { const w = wheel(small ? 0.45 : 0.62, 0.22); w.position.set(side * W * 0.46, small ? 0.45 : 0.62, tr[2] + 0.2); root.add(w); }
    const shield = new THREE.Mesh(new THREE.BoxGeometry(W * 0.92, small ? 0.8 : 1.05, 0.06), mat);
    shield.position.set(0, tr[1] * 0.75, tr[2] - 0.15); shield.rotation.x = -0.12; shield.castShadow = true; root.add(shield);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(W * 0.94, 0.1, 0.07), new THREE.MeshBasicMaterial({ color: trim }));
    stripe.position.set(0, tr[1] * 0.75 + (small ? 0.3 : 0.42), tr[2] - 0.16); root.add(stripe);
    // Trail legs, hinged at the axle; they swing apart when the gun is set up.
    parts.trail = [];
    for (const side of [-1, 1]) {
      const hinge = new THREE.Group(); hinge.position.set(side * 0.18, tr[1] * 0.42, tr[2] + 0.3);
      const leg = box(0.16, 0.16, L * 0.55, STEEL); leg.position.z = L * 0.27; leg.rotation.x = 0.16; leg.position.y = -0.2;
      const spade = box(0.5, 0.35, 0.08, DARK); spade.position.set(0, -0.42, L * 0.53);
      hinge.add(leg, spade); hinge.userData.side = side; root.add(hinge); parts.trail.push(hinge);
    }
    // The barrel: yaw and elevation on the trunnion, recoiling along its own axis.
    const pivot = new THREE.Group(); pivot.position.set(tr[0], tr[1], tr[2]);
    const elev = new THREE.Group(); pivot.add(elev);
    const len = g.barrel ?? 2;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(small ? 0.07 : 0.11, small ? 0.09 : 0.14, len, 12), new THREE.MeshStandardMaterial({ color: STEEL, metalness: 0.6, roughness: 0.4 }));
    tube.rotation.x = Math.PI / 2; tube.position.z = -len / 2;
    const cradle = box(0.36, 0.3, 0.9, STEEL); cradle.position.z = 0.1;
    const slide = new THREE.Group(); slide.add(tube);
    elev.add(cradle, slide);
    root.add(pivot);
    Object.assign(parts, { pivot, elev, slide, recoil: 0, spread: 0 });
  }

  /** Rocket battery or supply truck: a cab up front, then the launcher rack or the cargo bed. */
  #truck(v, root, parts, mat) {
    const d = v.def, W = d.size.x, L = d.size.z, H = d.size.y;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(W * 0.92, H * 0.5, L * 0.26), mat);
    cab.position.set(0, H * 0.62, -L * 0.36); cab.castShadow = true; root.add(cab);
    const glass = box(W * 0.8, H * 0.18, 0.05, '#28323c'); glass.position.set(0, H * 0.72, -L * 0.495); root.add(glass);
    for (const z of [-0.33, 0.05, 0.33]) for (const side of [-1, 1]) { const w = wheel(0.5, 0.35); w.position.set(side * W * 0.47, 0.5, z * L); root.add(w); }
    if (d.cargo) {
      const bed = box(W * 0.9, 0.12, L * 0.62, WOOD); bed.position.set(0, H * 0.42, L * 0.16); root.add(bed);
      parts.crates = [];
      for (let i = 0; i < 6; i++) {
        const c = box(W * 0.38, 0.62, 0.9, '#8c6a3f');
        c.position.set((i % 2 ? 1 : -1) * W * 0.22, H * 0.42 + 0.37, L * (-0.05 + Math.floor(i / 2) * 0.17));
        root.add(c); parts.crates.push(c);
      }
      const hitch = box(0.16, 0.16, 0.7, DARK); hitch.position.set(0, 0.7, L * 0.5 + 0.2); root.add(hitch);
      return;
    }
    // Rocket battery: a box of tubes on a turntable, and four stabilizer legs.
    const g = d.gun, tr = g.trunnion ?? [0, 2.3, 1];
    const pivot = new THREE.Group(); pivot.position.set(tr[0], tr[1], tr[2]);
    const elev = new THREE.Group(); pivot.add(elev);
    const rack = new THREE.Mesh(new THREE.BoxGeometry(W * 0.75, 0.9, 2.4), mat);
    rack.position.z = -0.6; rack.castShadow = true;
    const face = box(W * 0.7, 0.8, 0.04, DARK); face.position.z = -1.82;
    const slide = new THREE.Group(); slide.add(rack, face);
    elev.add(slide);
    root.add(pivot);
    parts.legs = [];
    for (const [sx, sz] of [[-1, -0.3], [1, -0.3], [-1, 0.35], [1, 0.35]]) {
      const leg = box(0.18, 1, 0.18, STEEL); leg.position.set(sx * (W * 0.5 + 0.15), 0.6, sz * L); root.add(leg); parts.legs.push(leg);
    }
    Object.assign(parts, { pivot, elev, slide, recoil: 0, spread: 0 });
  }

  /** Lay and elevate the barrel or rack, spread the trail or drop the legs, play the recoil. */
  #gunPose(v, parts, dt) {
    const G = v.gun;
    if (parts.pivot) { parts.pivot.rotation.y = G.yaw - v.yaw; parts.elev.rotation.x = G.pitch; }
    parts.recoil = Math.max(0, parts.recoil - dt * 2.2);
    if (parts.slide) parts.slide.position.z = (v.def.gun.kind === 'rockets' ? 0.15 : 0.45) * Math.sin(Math.min(1, parts.recoil) * Math.PI * 0.5);
    const T = v.def.gun, want = G.state === 'deployed' ? 1 : G.state === 'deploying' ? 1 - G.t / T.deployTime : G.state === 'packing' ? G.t / T.packTime : 0;
    parts.spread += (want - parts.spread) * Math.min(1, dt * 8);
    for (const h of parts.trail ?? []) h.rotation.y = h.userData.side * 0.34 * parts.spread;
    for (const leg of parts.legs ?? []) { leg.scale.y = 0.3 + 0.7 * parts.spread; leg.position.y = 0.6 - 0.35 * parts.spread; }
  }

  #burst(at) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(5, 20, 12), new THREE.MeshBasicMaterial({ color: '#ff8a3d', transparent: true, opacity: 0.6, depthWrite: false }));
    m.position.copy(at);
    this.scene.add(m);
    let life = 0.5;
    const tick = () => { life -= 1 / 60; m.material.opacity = Math.max(0, life * 1.2); m.scale.setScalar(1 + (0.5 - life)); if (life > 0) requestAnimationFrame(tick); else { this.scene.remove(m); m.geometry.dispose(); } };
    requestAnimationFrame(tick);
  }

  #remove(id) {
    const view = this.views.get(id);
    if (!view) return;
    this.scene.remove(view.root);
    view.root.traverse((o) => o.geometry?.dispose());
    this.views.delete(id);
  }
}
