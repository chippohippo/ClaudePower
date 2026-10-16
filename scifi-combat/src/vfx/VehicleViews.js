// VehicleViews: graybox presentation for vehicles. Read-only; reads VehicleSystem state each frame.
//
// Readability: team-colored hulls (enemy = red trim), a turret that visibly lags the camera
// (its turn rate is the counterplay), a glowing rear weak-spot vent, an HP bar above enemy vehicles,
// a boost flame, darkening and smoke at low HP, and exposed riders drawn on top of bikes.

import * as THREE from 'three';
import { bus } from '../core/EventBus.js';

const TEAM = ['#d9a441', '#6b3fa0'];
const ENEMY_TRIM = '#ff3b5c';

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
  }

  #add(e) {
    const v = this.world.vehicles.list.find((x) => x.id === e.id);
    if (!v) return;
    const d = v.def;
    const color = TEAM[v.team] ?? '#888';
    const trim = v.team === this.localTeam ? color : ENEMY_TRIM;
    const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.6 });
    const root = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(d.size.x, d.size.y * (d.model === 'tracked' ? 0.55 : 0.6), d.size.z), mat);
    hull.position.y = d.size.y * 0.3;
    hull.castShadow = true;
    root.add(hull);
    const parts = { hull, mat };
    // Trim stripe: the fastest team read at range.
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(d.size.x * 1.02, 0.12, d.size.z * 1.02), new THREE.MeshBasicMaterial({ color: trim }));
    stripe.position.y = d.size.y * 0.3;
    root.add(stripe);

    if (d.model === 'tracked') {
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
