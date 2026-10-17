// ZoneDeployableViews: graybox presentation for zones and deployables. Read-only: it listens to
// events and reads system state, and never mutates the sim.
//
// Readability rules implemented here:
//  * Team relation decides color: enemy = red (#ff3b5c), ally/self = faction gold or violet.
//    Hostile enemy zones also get a bright rim so they read against any floor.
//  * Arming zones draw an inner fill that grows from the centre and touches the edge exactly when
//    the zone goes live. The countdown is the shape itself.
//  * Domes are translucent spheres; rotating-beam storms draw their actual spokes; tethers draw
//    the beam between both ends (breaking it is the counterplay, so you must see it).
//  * Turrets draw a laser sight along their real aim; mines and charges blink faster when armed.
//  * Smoke screens are drawn by their smoke (BattleFx), and whatever `skip` claims (a stratagem's
//    sentry, which StratagemViews draws on its pod) by its own view; their tracers are still here.

import * as THREE from 'three';
import { bus } from '../core/EventBus.js';

const ENEMY = '#ff3b5c';
const FACTION = ['#ffcf6b', '#a970ff']; // team 0 Solari gold, team 1 Void violet

export class ZoneDeployableViews {
  constructor(scene, world, { localTeam = 0, coverMeshes = new Map(), skip = () => false } = {}) {
    this.scene = scene;
    this.skip = skip;
    this.world = world;
    this.localTeam = localTeam;
    this.coverMeshes = coverMeshes; // cover object -> mesh, for destruction
    this.zones = new Map();
    this.deps = new Map();
    this.flashes = [];
    this.time = 0;

    bus.on('zone:arming', (e) => this.#addZone(e, true));
    bus.on('zone:start', (e) => { const v = this.zones.get(e.id); if (v) this.#goLive(v); else this.#addZone(e, false); });
    bus.on('zone:end', (e) => this.#remove(this.zones, e.id));
    bus.on('zone:blocked', (e) => this.#flash(new THREE.Vector3().fromArray(e.point), 0.3, '#ffffff', 0.15));
    bus.on('deployable:spawn', (e) => this.#addDeployable(e));
    bus.on('deployable:removed', (e) => { const v = this.deps.get(e.id); if (v && e.reason !== 'replaced' && e.reason !== 'expired') this.#flash(v.root.position.clone().setY(v.root.position.y + 0.6), 1, '#ffaa55', 0.25); this.#remove(this.deps, e.id); });
    bus.on('deployable:triggered', (e) => this.#flash(new THREE.Vector3().fromArray(e.point), e.radius ?? 2, this.#color(e.team), 0.35));
    bus.on('deployable:pulse', (e) => this.#flash(new THREE.Vector3().fromArray(e.center).setY(e.center[1] + 0.5), e.radius, this.#color(e.team), 0.4, true));
    bus.on('deployable:fire', (e) => this.#tracer(e.from, e.to, this.#color(e.team)));
    bus.on('world:coverDestroyed', (e) => {
      const m = this.coverMeshes.get(e.cover);
      if (m) { scene.remove(m); this.coverMeshes.delete(e.cover); }
      this.#flash(new THREE.Vector3().fromArray(e.center), 3, '#ffaa55', 0.5);
    });
  }

  #color(team) { return team === this.localTeam ? FACTION[team] ?? '#ffcf6b' : ENEMY; }

  // ---------------------------------------------------------------- zones
  #addZone(e, arming) {
    if (e.smoke) return;
    const enemy = e.team !== this.localTeam;
    const color = this.#color(e.team);
    const root = new THREE.Group();
    root.position.fromArray(e.center).setY(e.center[1] + 0.03); // on terrain the center carries the ground height
    const mat = (opacity, side = THREE.DoubleSide) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side, depthWrite: false });
    const v = { e, root, arming, born: this.time, parts: {} };

    if (e.tether != null) {
      // Tether: a beam between the owner and the target, updated every frame.
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color, linewidth: 2 }));
      v.parts.tether = line; this.scene.add(line);
      this.zones.set(e.id, v);
      return;
    }
    if (e.shape === 'line') {
      const g = new THREE.PlaneGeometry(e.width, e.length);
      v.parts.edge = new THREE.Mesh(g, mat(enemy ? 0.25 : 0.12));
      v.parts.fill = new THREE.Mesh(g.clone(), mat(enemy ? 0.45 : 0.2));
      for (const m of [v.parts.edge, v.parts.fill]) { m.rotation.order = 'YXZ'; m.rotation.set(-Math.PI / 2, e.yaw, 0); root.add(m); }
    } else {
      v.parts.edge = new THREE.Mesh(new THREE.RingGeometry(e.radius - (enemy ? 0.25 : 0.12), e.radius, 64), mat(enemy ? 0.9 : 0.5));
      v.parts.edge.rotation.x = -Math.PI / 2;
      v.parts.fill = new THREE.Mesh(new THREE.CircleGeometry(e.radius, 64), mat(enemy && e.hostile ? 0.18 : 0.08));
      v.parts.fill.rotation.x = -Math.PI / 2;
      root.add(v.parts.edge, v.parts.fill);
      if (e.dome) {
        v.parts.dome = new THREE.Mesh(new THREE.SphereGeometry(e.radius, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), mat(0.12, THREE.FrontSide));
        root.add(v.parts.dome);
      }
      if (e.pattern === 'rotating_beams') {
        v.parts.spokes = new THREE.Group();
        for (let i = 0; i < 6; i++) {
          const s = new THREE.Mesh(new THREE.PlaneGeometry(0.5, e.radius).translate(0, e.radius / 2, 0), mat(0.7));
          s.rotation.set(-Math.PI / 2, 0, (i * Math.PI) / 3);
          v.parts.spokes.add(s);
        }
        v.parts.spokes.position.y = 0.02;
        root.add(v.parts.spokes);
      }
    }
    if (arming) v.parts.fill.scale.setScalar(0.001);
    this.scene.add(root);
    this.zones.set(e.id, v);
  }

  #goLive(v) {
    v.arming = false;
    v.parts.fill?.scale.setScalar(1);
    this.#flash(v.root.position.clone().setY(v.root.position.y + 0.5), v.e.radius ?? 2, this.#color(v.e.team), 0.3);
  }

  // ---------------------------------------------------------------- deployables
  #addDeployable(e) {
    if (this.skip(e)) return;
    const color = this.#color(e.team);
    const std = (c = color, emissive = 0.6) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: emissive });
    const root = new THREE.Group();
    root.position.fromArray(e.at);
    root.rotation.y = e.yaw;
    const v = { e, root, parts: {} };
    switch (e.kind) {
      case 'wall': {
        const m = new THREE.Mesh(new THREE.BoxGeometry(e.width, e.height, 0.15), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, transparent: true, opacity: 0.45 }));
        m.position.y = e.height / 2;
        const emitter = new THREE.Mesh(new THREE.BoxGeometry(e.width, 0.3, 0.3), std(color, 1.5)); // weak point, visibly brighter
        emitter.position.y = 0.15;
        root.add(m, emitter);
        break;
      }
      case 'turret': {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.8, 12), std('#444', 0));
        base.position.y = 0.4;
        const head = new THREE.Group(); head.position.y = 1.0;
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), std(color, 1));
        const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.8), std('#222', 0)); barrel.position.z = -0.45;
        head.add(core, barrel);
        const laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -0.8), new THREE.Vector3(0, 0, -(e.range ?? 30))]), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 }));
        head.add(laser);
        root.add(base, head);
        v.parts.head = head;
        root.rotation.y = 0; // the head rotates, the base doesn't
        break;
      }
      case 'mine': case 'charge': {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.08, 12), std(color, 0.2));
        m.position.y = 0.05;
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color }));
        light.position.y = 0.12;
        root.add(m, light);
        v.parts.light = light;
        if (e.kind === 'mine') {
          const r = new THREE.Mesh(new THREE.RingGeometry(e.trigger - 0.05, e.trigger, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: e.team === this.localTeam ? 0.25 : 0.0, side: THREE.DoubleSide }));
          r.rotation.x = -Math.PI / 2; r.position.y = 0.02;
          root.add(r); // enemies don't get the trigger radius, only the blink and tick
        }
        break;
      }
      case 'tripwire': {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.25, 0), new THREE.Vector3(0, 0.25, -e.length)]), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 }));
        root.add(line);
        break;
      }
      case 'beacon': case 'engine': {
        const m = new THREE.Mesh(e.kind === 'beacon' ? new THREE.CylinderGeometry(0.15, 0.25, 2, 10) : new THREE.IcosahedronGeometry(0.6, 1), std(color, 1));
        m.position.y = e.kind === 'beacon' ? 1 : 1.2;
        root.add(m);
        v.parts.pulse = m;
        const ring = new THREE.Mesh(new THREE.RingGeometry(e.radius - 0.1, e.radius, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
        root.add(ring);
        break;
      }
      case 'launchpad': {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.1, 24), std(color, 0.8));
        m.position.y = 0.05; root.add(m);
        break;
      }
      case 'decoy': {
        const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 4, 12), new THREE.MeshStandardMaterial({ color: e.team === 0 ? '#d9a441' : '#6b3fa0' }));
        m.position.y = 0.9; root.add(m);
        break;
      }
      case 'vehicle': {
        const ring = new THREE.Mesh(new THREE.RingGeometry(1.8, 2, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 30, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4 }));
        beam.position.y = 15;
        root.add(ring, beam);
        break;
      }
    }
    this.scene.add(root);
    this.deps.set(e.id, v);
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    this.time += dt;
    for (const [id, v] of this.zones) {
      const z = this.world.zones.zones.find((x) => x.id === id);
      if (!z) continue;
      if (v.parts.tether) {
        const a = z.owner.movement.state.position, b = z.target.movement.state.position;
        v.parts.tether.geometry.setFromPoints([a.clone().setY(a.y + 1.2), b.clone().setY(b.y + 1.2)]);
        continue;
      }
      v.root.position.set(z.center.x, z.center.y + 0.03, z.center.z);
      if (v.arming && z.delay) v.parts.fill.scale.setScalar(Math.max(0.001, Math.min(1, z.time / z.delay)));
      if (v.parts.spokes) v.parts.spokes.rotation.y = -z.time * (Math.PI / 3);
      // Enemy hostile zones breathe slightly so they're never mistaken for floor decals.
      if (z.team !== this.localTeam) v.parts.edge.material.opacity = 0.7 + Math.sin(this.time * 6) * 0.2;
    }
    for (const [id, v] of this.deps) {
      const d = this.world.deployables.list.find((x) => x.id === id);
      if (!d) continue;
      v.root.position.copy(d.movement.state.position);
      if (v.parts.head) v.parts.head.rotation.y = d.aimYaw;
      if (v.parts.light) v.parts.light.visible = Math.sin(this.time * (d.armed ? 14 : 5)) > 0;
      if (v.parts.pulse) {
        const charge = d.charging ? 1 + Math.sin(this.time * 30) * 0.15 : 1;
        v.parts.pulse.scale.setScalar(charge);
      }
      if (d.health && d.health.hp < d.health.max) v.root.traverse((o) => o.material?.emissive && (o.material.emissiveIntensity = 0.3 + 0.7 * (d.health.hp / d.health.max)));
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      const u = 1 - f.life / f.max;
      if (f.grow) f.obj.scale.setScalar(0.2 + u * 0.8);
      f.obj.material.opacity = f.base * (1 - u);
      if (f.life <= 0) { this.scene.remove(f.obj); f.obj.geometry.dispose(); this.flashes.splice(i, 1); }
    }
  }

  #flash(pos, radius, color, life, grow = false) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
    m.position.copy(pos);
    this.scene.add(m);
    this.flashes.push({ obj: m, life, max: life, base: 0.35, grow });
  }

  #tracer(from, to, color) {
    const a = new THREE.Vector3().fromArray(from), b = new THREE.Vector3().fromArray(to); b.y += 1.1;
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }));
    this.scene.add(l);
    this.flashes.push({ obj: l, life: 0.06, max: 0.06, base: 0.8 });
  }

  #remove(map, id) {
    const v = map.get(id);
    if (!v) return;
    if (v.parts.tether) this.scene.remove(v.parts.tether);
    this.scene.remove(v.root);
    v.root.traverse((o) => o.geometry?.dispose());
    map.delete(id);
  }
}
