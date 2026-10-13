// Debug showcase (dev only): renders all legends and the viewmodel guns for visual review.
//   in the browser console on the dev server: (await import('/src/client/debug/lineup.js')).run('legends')
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Avatar } from '../avatars.js';
import { ViewModel } from '../viewmodel.js';
import { LEGEND_IDS } from '../../shared/legends.js';
import { WEAPON_IDS } from '../../shared/weapons.js';

export function run(what = 'legends', opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200; canvas.height = 600;
  canvas.style.cssText = 'position:fixed;inset:0;z-index:999;width:1200px;height:600px';
  document.body.appendChild(canvas);
  const r = new THREE.WebGLRenderer({ canvas, antialias: true });
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  { const pm = new THREE.PMREMGenerator(r); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.45; }
  scene.background = new THREE.Color('#9fb6cc');
  scene.add(new THREE.HemisphereLight('#cfe3ff', '#5a5040', 1.1));
  const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
  sun.position.set(-3, 6, 4);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: '#7d8a5c' }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  if (what === 'legends') {
    const cam = new THREE.PerspectiveCamera(35, 2, 0.1, 100);
    cam.position.set(0, 1.6, 9.5);
    cam.lookAt(0, 1.1, 0);
    const pose = opts.pose || {};
    LEGEND_IDS.forEach((id, i) => {
      const a = new Avatar(scene, { name: id, legend: id }, i < 2);
      a.update(0.016, { x: (i - 3.5) * 1.35, y: 0, z: 0, yaw: Math.PI + (opts.turn || 0.35), pitch: 0, fl: pose.fl || 0, crouch: 0, weapon: 'talon', vx: pose.vx || 0, vz: pose.vz || 0 }, 1);
    });
    r.render(scene, cam);
  } else {
    // weapons: render each viewmodel gun in a grid
    const vm = new ViewModel(r);
    const cam = new THREE.PerspectiveCamera(30, 2, 0.01, 50);
    cam.position.set(0, 0.2, 6.5);
    cam.lookAt(0, 0, 0);
    const s2 = vm.scene;
    s2.background = new THREE.Color('#2a2f38');
    WEAPON_IDS.forEach((id, i) => {
      const g = vm.buildGunForShowcase(id, 2, opts.att || null);
      g.position.set(((i % 5) - 2) * 1.45 + 0.4, i < 5 ? 0.55 : -0.55, 0);
      g.rotation.y = -Math.PI / 2;
      s2.add(g);
    });
    r.render(s2, cam);
  }
  return true;
}
