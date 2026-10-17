// FireControl: what a player sees and does at a crew-served gun or in a supply truck.
// Presentation and input only: the sim receives the same Command a bot sends.
//  * Indirect fire (howitzers, rocket batteries), set up and in the commander's seat: an overhead
//    fire-control view over the marked point. The mouse moves the mark across the ground (faster
//    the further out it is), and it goes to the gun as `cmd.target`. The gun lays itself (the
//    fire-control computer picks the charge). On screen:
//      - the predicted arc;
//      - a ring where rounds will scatter (2 sigma);
//      - range, flight time and spread;
//      - rounds left and the loading bar;
//      - the gun's state: laying, ready, loading, out of range, too close, or swinging the trail
//        to bring the mark into its arc.
//    Hold fire to keep shooting.
//  * Direct fire (AT gun): the normal camera, plus a second reticle where the barrel actually
//    points (it lays at its own rate), the loading bar and rounds left.
//  * Any gun: setting-up and packing-up progress, and what H does next. Trucks: cargo, what's
//    being loaded or unloaded, and the gun on the hook (H hitches the one behind you).

import * as THREE from 'three';
import { barrelDir } from '../vehicles/FieldGuns.js';

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _m = new THREE.Vector3();
const bar = (k, col) => `<span class="pbar"><i style="width:${(Math.min(1, Math.max(0, k)) * 100).toFixed(0)}%;background:${col}"></i></span>`;

export class FireControl {
  /**
   * @param {THREE.Scene} scene
   * @param {object} o { world, map, el (HUD element for the panel), aspect }
   */
  constructor(scene, { world, map, el, aspect = 16 / 9 }) {
    this.world = world; this.map = map; this.el = el;
    // The AT gun's barrel reticle lives beside the panel (the panel is transformed for centring).
    this.reticle = Object.assign(document.createElement('div'), { className: 'fc-barrel' });
    this.reticle.style.display = 'none';
    el.parentElement?.appendChild(this.reticle);
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.5, 4000);
    this.active = false;
    this.aims = new Map();        // gun id -> last aim point (each gun remembers its mark)
    this.aim = null;
    this.last = null;             // last input yaw/pitch (mouse deltas move the mark)
    this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3();
    // Markers: the scatter ring, a centre cross, the arc.
    const ringMat = new THREE.MeshBasicMaterial({ color: '#7fffb0', transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2), ringMat);
    this.cross = new THREE.Mesh(new THREE.RingGeometry(0, 0.6, 4).rotateX(-Math.PI / 2), ringMat);
    this.arcGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(41 * 3), 3));
    this.arc = new THREE.Line(this.arcGeo, new THREE.LineDashedMaterial({ color: '#7fffb0', dashSize: 3, gapSize: 2, transparent: true, opacity: 0.8, depthTest: false }));
    for (const o of [this.ring, this.cross, this.arc]) { o.visible = false; o.renderOrder = 20; o.frustumCulled = false; scene.add(o); }
  }

  /** The vehicle the player crews, the seat, and the gun block (or null). */
  #seat(player) {
    const ref = player.vehicle;
    if (!ref) return null;
    return { v: ref.veh, seat: ref.seat, gun: ref.veh.gun ?? null, d: ref.veh.def.gun ?? null };
  }

  /**
   * Per sim tick, before the command goes to the session: moves the mark and puts it on the
   * command (indirect fire), and works out whether the overhead view is on.
   */
  command(cmd, input, player) {
    const c = this.#seat(player);
    const was = this.active;
    this.active = !!(c?.gun && c.seat === 0 && c.d.indirect && c.gun.state === 'deployed');
    if (!this.active) { this.last = null; return cmd; }
    const v = c.v, p = v.movement.state.position;
    if (!was || !this.aim || this.aimFor !== v.id) {
      this.aimFor = v.id;
      this.aim = this.aims.get(v.id) ?? p.clone().addScaledVector(barrelDir(c.gun.yaw, 0, _f), 350);
      this.aims.set(v.id, this.aim);
      this.camPos.set(0, 0, 0);
    }
    // The mouse moves the mark: right is right, up is further out (seen from the gun).
    if (this.last) {
      const dy = input.yaw - this.last.yaw, dp = input.pitch - this.last.pitch;
      const range = Math.hypot(this.aim.x - p.x, this.aim.z - p.z), k = 140 + range * 0.7;
      _f.set(this.aim.x - p.x, 0, this.aim.z - p.z);
      if (_f.lengthSq() < 1) _f.copy(barrelDir(c.gun.yaw, 0, _m)).setY(0);
      _f.normalize();
      const rx = -_f.z, rz = _f.x;
      this.aim.x += (-dy * rx + dp * _f.x) * k;
      this.aim.z += (-dy * rz + dp * _f.z) * k;
      const b = this.map.bounds;
      this.aim.x = Math.max(b.minX + 5, Math.min(b.maxX - 5, this.aim.x));
      this.aim.z = Math.max(b.minZ + 5, Math.min(b.maxZ - 5, this.aim.z));
    }
    this.last = { yaw: input.yaw, pitch: input.pitch };
    this.aim.y = this.map.terrain.height(this.aim.x, this.aim.z);
    return { ...cmd, target: [this.aim.x, this.aim.z] };
  }

  /** Per render frame: the overhead camera (when active), the markers, and the HUD panel. Returns the camera to render with. */
  update(dt, player, defaultCamera) {
    const c = this.#seat(player);
    this.ring.visible = this.cross.visible = this.arc.visible = false;
    this.reticle.style.display = 'none';
    this.el.innerHTML = c ? this.#panel(c, player, defaultCamera) : '';
    this.el.style.display = c ? 'block' : 'none';
    if (!this.active || !c?.gun) return defaultCamera;
    const v = c.v, d = c.d, G = c.gun, guns = this.world.vehicles.guns;
    const p = v.movement.state.position, aim = this.aim;
    const range = Math.hypot(aim.x - p.x, aim.z - p.z), sig = d.dispersion[0] + d.dispersion[1] * range;
    // Camera: behind the gun's line of fire, high over the mark, looking down at it.
    _f.set(aim.x - p.x, 0, aim.z - p.z).normalize();
    const back = 40 + range * 0.07, up = 60 + range * 0.1;
    _v.set(aim.x - _f.x * back, aim.y + up, aim.z - _f.z * back);
    if (this.camPos.lengthSq() === 0) this.camPos.copy(_v); else this.camPos.lerp(_v, 1 - Math.exp(-dt * 6));
    this.camLook.copy(aim);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.aspect = defaultCamera.aspect; this.camera.updateProjectionMatrix();
    // Markers: the scatter ring (2 sigma), the centre, and the arc the round will fly.
    const muzzle = guns.muzzle(v, new THREE.Vector3());
    const sol = guns.solve(muzzle, aim.x, aim.y, aim.z, d);
    const col = !sol ? '#ff6b6b' : G.laid && G.load <= 0 ? '#7fffb0' : '#ffd166';
    this.ring.material.color.set(col); this.arc.material.color.set(col);
    this.ring.position.set(aim.x, aim.y + 0.3, aim.z); this.ring.scale.setScalar(Math.max(2, sig * 2));
    this.cross.position.set(aim.x, aim.y + 0.3, aim.z); this.cross.scale.setScalar(Math.max(1.5, sig * 0.25));
    this.ring.visible = this.cross.visible = true;
    if (sol) {
      const pos = this.arcGeo.attributes.position, dir = barrelDir(sol.yaw, sol.pitch, _m);
      for (let i = 0; i <= 40; i++) {
        const t = (sol.eta * i) / 40;
        pos.setXYZ(i, muzzle.x + dir.x * sol.speed * t, muzzle.y + dir.y * sol.speed * t - 0.5 * d.gravity * t * t, muzzle.z + dir.z * sol.speed * t);
      }
      pos.needsUpdate = true;
      this.arc.computeLineDistances();
      this.arcGeo.computeBoundingSphere();
      this.arc.visible = true;
    }
    return this.camera;
  }

  #panel(c, player, camera) {
    const { v, gun: G, d } = c, name = v.def.name;
    if (!G) return this.#truckPanel(v);
    if (c.seat !== 0) return `<b>${name}</b> · LOADER<br><small>you're loading: it fires ${Math.round((1 / (d.loaderMul ?? 1) - 1) * 100)}% faster · X leave</small>`;
    const rounds = `${G.ammo}/${d.ammoMax}`;
    if (G.state === 'deploying') return `<b>${name}</b> · SETTING UP ${bar(1 - G.t / d.deployTime, '#ffd166')}`;
    if (G.state === 'packing') return `<b>${name}</b> · PACKING UP ${bar(1 - G.t / d.packTime, '#ffd166')}`;
    if (G.state === 'packed') {
      const how = v.def.model === 'gun' ? 'WASD push it (slowly), or hitch it to a truck' : 'drive';
      return `<b>${name}</b> · PACKED · ${rounds} rounds<br><small><b>H</b> set it up (${d.deployTime} s) · ${how} · <b>X</b> leave</small>`;
    }
    const loading = G.salvo > 0 ? `RIPPLE ${bar(1 - G.salvo / (d.salvo || 1), '#ff9a5c')}` : G.load > 0 ? `LOADING ${bar(1 - G.load / d.reload, '#ffd166')}` : G.ammo <= 0 ? '<span style="color:#ff6b6b">NO ROUNDS · get it near a depot</span>' : '';
    if (d.indirect) {
      const p = v.movement.state.position, aim = this.aim ?? p, range = Math.hypot(aim.x - p.x, aim.z - p.z);
      const sol = this.world.vehicles.guns.solve(this.world.vehicles.guns.muzzle(v, _m), aim.x, aim.y, aim.z, d);
      const [lo, hi] = this.world.vehicles.guns.range(d), sig = d.dispersion[0] + d.dispersion[1] * range;
      const state = !sol ? `<span style="color:#ff6b6b">${range < lo * 1.2 ? 'TOO CLOSE' : 'OUT OF RANGE'}</span>` : G.outOfArc ? '<span style="color:#ffd166">SWINGING THE TRAIL</span>' : !G.laid ? '<span style="color:#ffd166">LAYING</span>' : G.load > 0 ? '' : '<span style="color:#7fffb0">READY</span>';
      return `<b>${name}</b> · FIRE MISSION · ${state} ${loading}<br>${range.toFixed(0)} m · ${sol ? `${sol.eta.toFixed(1)} s flight · ±${(sig * 2).toFixed(0)} m` : `reach ${lo.toFixed(0)}-${hi.toFixed(0)} m`} · ${rounds} rounds<br><small>mouse: move the mark · hold <b>LMB</b> fire · <b>H</b> pack up · <b>X</b> leave</small>`;
    }
    // Direct fire: where the barrel really points, on screen.
    const m = this.world.vehicles.guns.muzzle(v, _m), dir = barrelDir(G.yaw, G.pitch, _f);
    _v.copy(m).addScaledVector(dir, 150).project(camera);
    if (_v.z < 1) {
      this.reticle.style.display = 'block';
      this.reticle.style.transform = `translate(${((_v.x * 0.5 + 0.5) * innerWidth).toFixed(0)}px,${((-_v.y * 0.5 + 0.5) * innerHeight).toFixed(0)}px)`;
    }
    const state = G.outOfArc ? '<span style="color:#ffd166">SWINGING THE TRAIL</span>' : G.laid ? '<span style="color:#7fffb0">ON TARGET</span>' : '<span style="color:#ffd166">LAYING</span>';
    return `<b>${name}</b> · ${state} ${loading} · ${rounds} rounds<br><small>aim · hold <b>LMB</b> fire when laid · <b>H</b> pack up · <b>X</b> leave</small>`;
  }

  #truckPanel(v) {
    if (!v.def.cargo) return '';
    const guns = this.world.vehicles.guns, L = this.world.logistics;
    let at = '';
    const p = v.movement.state.position;
    for (const d of L?.depots ?? []) if (d.team === v.team && Math.hypot(d.pos.x - p.x, d.pos.z - p.z) < d.radius) at = d.kind === 'hq' ? ' · AT THE HQ DUMP (stop to load)' : ' · AT THE FORWARD DEPOT (stop to unload)';
    const tow = v.towing ? `<br>towing ${v.towing.def.name} · <b>H</b> unhitch` : guns.hitchable(v) ? `<br><b>H</b> hitch the ${guns.hitchable(v).def.name}` : '';
    return `<b>${v.def.name}</b> · CARGO ${bar(v.cargo / v.def.cargo, '#d9b77a')} ${Math.round(v.cargo)}/${v.def.cargo}${at}${tow}<br><small>load at the HQ dump, unload at the forward depot: drive in and stop</small>`;
  }
}
