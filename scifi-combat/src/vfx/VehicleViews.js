// VehicleViews: vehicles and guns in the art direction's kit (render/VehicleKit.js: faction
// paint, black and gunmetal mechanics, hazard stripes, stencilled numbers, work lights). Read-only;
// reads VehicleSystem state each frame.
//
// Readability: the faction's paint, a turret that visibly lags the camera (its turn rate is the
// counterplay), a glowing rear weak-spot vent, an HP bar above enemy vehicles, a boost flame,
// darkening and smoke at low HP, and exposed riders drawn on top of bikes.
// Field guns: wheels, shield and a split trail that spreads when the gun is set up, the barrel laid
// and elevated where the sim has it (it recoils on every shot); rocket batteries raise their rack
// and drop their stabilizers; supply trucks show their cargo as crates in the bed.
// Recon cars: the whole body turns with the physics (on its side, on its roof), each wheel sits
// where its strut has it, steered and spinning, the ring gun swings with its gunner, and a car
// that has been killed burns (flames, a flickering light, black smoke) until it blows.
// Distance LOD (a 200v200 front has ~80 vehicles): the full model up close, one painted block
// past DETAIL m, nothing past the fog.

import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { vehicleModel } from '../render/VehicleKit.js';
import { paintMaterial } from '../render/TrooperMaterial.js';
import { DEFAULT_PALETTE } from '../render/CrowdRenderer.js';
import { CH, rbox, merge } from '../render/ModelKit.js';

const DETAIL = 160;                                   // m: past this a vehicle is one block
const FIRES = [[0, 1.0, 0.3, 0.7], [0, 0.9, -0.32, 0.5]];   // a burning car: the engine deck and the hood (z as a share of its length), spread
const _fp = new THREE.Vector3(), _fw = new THREE.Vector3();
const BLOCK = merge([rbox(1, 1, 1, { e1: 0.2, e2: 0.2, ws: 6, hs: 3 }).paint(CH.armor).move(0, 0.5, 0)]);
const MODELS = new Map();                             // type -> the kit's geometries (shared by every vehicle of a type)

export class VehicleViews {
  /** @param {object} o { localTeam, far: m beyond which nothing is drawn (the fog's end), palette (palette.json), fx: BattleFx (a burning car's flames and smoke) } */
  constructor(scene, world, { localTeam = 0, far = 540, palette = DEFAULT_PALETTE, fx = null } = {}) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.localTeam = localTeam;
    this.far = far;
    this.palette = palette;
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
    if (!MODELS.has(v.type)) MODELS.set(v.type, vehicleModel(d, v.type));
    const M = MODELS.get(v.type);
    // One material per vehicle: its own damage darkening and status glow, the shared program.
    const mat = paintMaterial(this.palette, { team: v.team, number: (v.id * 29 + 7) % 100 });
    const mesh = (geo) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; return m; };
    const root = new THREE.Group();
    const parts = { mat };
    root.add(mesh(M.body));
    if (d.model === 'gun') this.#fieldGun(v, root, parts, M, mesh);
    else if (d.model === 'car') this.#car(v, root, parts, M, mesh);
    else if (d.gun || d.cargo) this.#truck(v, root, parts, M, mesh);
    else if (M.turret) {
      const turret = new THREE.Group(); turret.position.y = M.turretY;
      turret.add(mesh(M.turret));
      root.add(turret);
      parts.turret = turret;
    }
    // Rear weak spot glows so players learn where to shoot.
    if (d.weakSpot === 'rear') {
      const car = d.model === 'car';   // a car's is its radiator, under the spare
      const vent = new THREE.Mesh(new THREE.BoxGeometry(d.size.x * (car ? 0.42 : 0.6), car ? 0.12 : d.size.y * 0.3, 0.1), new THREE.MeshBasicMaterial({ color: '#ffb347' }));
      vent.position.set(0, car ? 0.66 : d.size.y * 0.35, d.size.z / 2 + 0.05);
      root.add(vent);
    }
    // Boost flame (hover vehicles) and low-HP smoke puffs.
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.6, 10), new THREE.MeshBasicMaterial({ color: v.team === 0 ? '#ffcf6b' : '#a970ff', transparent: true, opacity: 0.85 }));
    flame.rotation.x = Math.PI / 2; flame.position.set(0, d.size.y * 0.45, d.size.z / 2 + 0.8); flame.visible = false;
    root.add(flame);
    parts.flame = flame;
    const smoke = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), new THREE.MeshBasicMaterial({ color: '#222', transparent: true, opacity: 0.5, depthWrite: false }));
    smoke.position.y = d.size.y; smoke.visible = false;
    root.add(smoke);
    parts.smoke = smoke;
    // HP bar (enemies only; your own HP is on the HUD).
    if (v.team !== this.localTeam) {
      const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.18), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.6, depthTest: false }));
      const fg = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.18).translate(1, 0, 0), new THREE.MeshBasicMaterial({ color: '#ff3b5c', depthTest: false }));
      fg.position.x = -1; fg.position.z = 0.01;
      const bar = new THREE.Group(); bar.add(bg, fg); bar.position.y = d.size.y + 1.2;
      bar.renderOrder = 10; root.add(bar);
      parts.bar = bar; parts.fg = fg;
    }
    // LOD: the model built above, or past DETAIL a painted block (it darkens with damage too).
    // The HP bar stays on the root.
    const full = new THREE.Group();
    for (const c of [...root.children]) if (c !== parts.bar) full.add(c);
    const block = new THREE.Mesh(BLOCK, mat);
    block.scale.set(d.size.x, d.size.y * (d.model === 'gun' ? 0.6 : 0.8), d.size.z);
    const lod = new THREE.LOD();
    lod.addLevel(full, 0); lod.addLevel(block, DETAIL);
    root.add(lod);
    parts.lod = lod;
    this.scene.add(root);
    this.views.set(v.id, { v, root, parts });
  }

  update(dt, camera) {
    this.time += dt;
    const far2 = this.far * this.far;
    for (const { v, root, parts } of this.views.values()) {
      const s = v.movement.state;
      // Past the fog there is nothing to draw (and no pose to work out).
      const d2 = camera ? s.position.distanceToSquared(camera.position) : 0;
      root.visible = d2 < far2;
      if (!root.visible) continue;
      if (v.car) { root.position.copy(v.car.base); root.quaternion.copy(v.car.q); this.#carPose(v, parts, dt); }
      else {
        root.position.copy(s.position); root.position.y -= v.def.hoverHeight ?? 0;
        root.rotation.y = v.yaw;
        // Bikes bank into turns; dropships pitch with speed.
        const lat = s.velocity.x * Math.cos(v.yaw) - s.velocity.z * Math.sin(v.yaw);
        root.rotation.z = THREE.MathUtils.damp(root.rotation.z, v.def.model === 'hover' ? -lat * 0.04 : 0, 6, dt);
      }
      if (parts.turret) parts.turret.rotation.y = v.turretYaw - v.yaw;
      if (v.gun) this.#gunPose(v, parts, dt);
      if (parts.crates) { const k = v.cargo / (v.def.cargo || 1); parts.crates.forEach((c, i) => { c.visible = i < Math.ceil(k * parts.crates.length - 1e-6); }); }
      parts.flame.visible = v.boostTime > 0;
      if (parts.flame.visible) parts.flame.scale.setScalar(0.9 + Math.sin(this.time * 40) * 0.15);
      const hpFrac = v.health.hp / v.health.max, paint = parts.mat.paint;
      paint.uGlow.value.set(v.status.silenced ? '#1f3a66' : '#000');
      paint.uTint.value = 0.4 + 0.6 * hpFrac;
      parts.smoke.visible = hpFrac < 0.35 && !v.wreck;
      if (parts.smoke.visible) { parts.smoke.position.y = v.def.size.y + ((this.time * 2) % 1.5); parts.smoke.material.opacity = 0.6 - ((this.time * 2) % 1.5) * 0.35; }
      if (parts.bar) {
        parts.bar.visible = d2 < 120 * 120;   // the bar draws over everything: only for vehicles close enough to fight
        parts.fg.scale.x = Math.max(0.001, hpFrac);
        if (camera) parts.bar.quaternion.copy(root.quaternion).invert().multiply(camera.quaternion);
      }
    }
  }

  /**
   * A towed field piece: the kit's carriage (axle, wheels, shield), a split trail toward the
   * rear (spread and spaded when set up), and the barrel on its trunnion.
   */
  #fieldGun(v, root, parts, M, mesh) {
    const d = v.def, g = d.gun, tr = g.trunnion ?? [0, 1, 0];
    // Trail legs, hinged at the axle; they swing apart when the gun is set up.
    parts.trail = [];
    for (const side of [-1, 1]) {
      const hinge = new THREE.Group(); hinge.position.set(side * 0.18, tr[1] * 0.42, tr[2] + 0.3);
      hinge.add(mesh(M.trail)); hinge.userData.side = side; root.add(hinge); parts.trail.push(hinge);
    }
    // The barrel: yaw and elevation on the trunnion, recoiling along its own axis.
    const pivot = new THREE.Group(); pivot.position.set(tr[0], tr[1], tr[2]);
    const elev = new THREE.Group(); pivot.add(elev);
    const slide = new THREE.Group(); slide.add(mesh(M.barrel));
    elev.add(slide);
    root.add(pivot);
    Object.assign(parts, { pivot, elev, slide, recoil: 0, spread: 0 });
  }

  /**
   * A recon car: four wheels (the left pair mirrored) on steering knuckles, the gun on its ring,
   * and the fire it burns with once it's been killed (hidden until then).
   */
  #car(v, root, parts, M, mesh) {
    parts.wheels = v.car.wheels.map((wh) => {
      const knuckle = new THREE.Group(), spin = mesh(M.wheel);
      if (wh.mount.x < 0) spin.scale.x = -1;
      knuckle.add(spin); root.add(knuckle);
      return { wh, knuckle, spin };
    });
    const ring = new THREE.Group(); ring.position.fromArray(M.gunAt);
    ring.add(mesh(M.gun)); root.add(ring);
    parts.ring = ring;
    // Burning: a light that flickers with the flames (the flames and smoke are BattleFx particles).
    const glow = new THREE.PointLight('#ff7a2a', 0, 14, 1.6); glow.position.set(0, 1.8, v.def.size.z * 0.15);
    glow.visible = false;
    root.add(glow); parts.glow = glow;
  }

  /** Wheels from the struts, the gun after its gunner, the wreck's fire. */
  #carPose(v, parts, dt) {
    const C = v.car;
    const sp = C.speed;
    for (const w of parts.wheels) {
      C.hub(w.wh, w.knuckle.position);
      w.knuckle.rotation.y = -w.wh.steer;
      w.spin.rotation.x = -w.wh.spin;            // (the mirror is across the axle: both sides roll the same way)
      // A tyre sliding sideways kicks up the dirt.
      if (this.fx && w.wh.contact && sp > 4 && w.wh.slip > 0.22) this.fx.skid(C.point(_fp.copy(w.wh.mount).setY(0), _fw), C.vel.x, C.vel.z, Math.min(1, (w.wh.slip - 0.22) * 3) * dt * 40);
    }
    parts.ring.rotation.y = v.seats.some((q) => q.def.role === 'gunner' && q.occupant) ? v.turretYaw - v.yaw : THREE.MathUtils.damp(parts.ring.rotation.y, 0, 1.5, dt);
    const burning = !!v.wreck;
    parts.glow.visible = burning;
    if (burning) {
      const t = this.time, k = Math.min(1, 0.3 + v.wreck.t * 0.8);
      parts.glow.intensity = (14 + 6 * Math.sin(t * 23) + 4 * Math.sin(t * 37)) * k;
      // Fire over the engine and the cockpit (where they are now: a wreck can lie on its side).
      if (this.fx) for (const [x, y, z, r] of FIRES) this.fx.fire(C.point(_fp.set(x, y, z * v.def.size.z), _fw), dt * 0.5, r, k);
    }
  }

  /** Rocket battery or supply truck: the kit's cab and chassis, then the launcher rack or the cargo crates. */
  #truck(v, root, parts, M, mesh) {
    const d = v.def, W = d.size.x, L = d.size.z, H = d.size.y;
    if (d.cargo) {
      parts.crates = [];
      for (let i = 0; i < 6; i++) {
        const c = mesh(M.crate);
        c.position.set((i % 2 ? 1 : -1) * W * 0.22, H * 0.42 + 0.37, L * (-0.05 + Math.floor(i / 2) * 0.17));
        c.rotation.y = (i % 3 - 1) * 0.04;
        root.add(c); parts.crates.push(c);
      }
      return;
    }
    // Rocket battery: a box of tubes on a turntable, and four stabilizer legs.
    const g = d.gun, tr = g.trunnion ?? [0, 2.3, 1];
    const pivot = new THREE.Group(); pivot.position.set(tr[0], tr[1], tr[2]);
    const elev = new THREE.Group(); pivot.add(elev);
    const slide = new THREE.Group(); slide.add(mesh(M.rack));
    elev.add(slide);
    root.add(pivot);
    parts.legs = [];
    for (const [sx, sz] of [[-1, -0.3], [1, -0.3], [-1, 0.35], [1, 0.35]]) {
      const leg = mesh(M.leg); leg.position.set(sx * (W * 0.5 + 0.15), 0.6, sz * L); root.add(leg); parts.legs.push(leg);
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
    // The kit's geometries are shared by every vehicle of the type: only the per-vehicle bits go.
    view.root.traverse((o) => { if (o.material && o.material !== view.parts.mat) { o.geometry?.dispose(); o.material.dispose?.(); } });
    view.parts.mat.dispose();
    this.views.delete(id);
  }
}
