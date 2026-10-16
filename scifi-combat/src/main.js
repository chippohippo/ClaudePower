// Graybox duel: player vs. one Flame Knight bot on flat ground with vault boxes.
// Demonstrates the full loop: Input → fixed-step sim (movement + melee) → events → camera/juice/HUD.
// Run: `npx serve scifi-combat` (or any static server) and open index.html.

import * as THREE from 'three';
import { bus } from './core/EventBus.js';
import { FixedLoop } from './core/FixedLoop.js';
import { InputManager } from './input/InputManager.js';
import { MovementController, FlatGroundBody } from './movement/MovementController.js';
import { MeleeComponent, MeleeSystem } from './combat/melee/MeleeSystem.js';
import { CameraRig } from './camera/CameraRig.js';
import { MeleeDuelistBrain } from './ai/MeleeDuelistBrain.js';

const [movementTuning, meleeData] = await Promise.all([
  fetch('./data/movement.json').then((r) => r.json()),
  fetch('./data/weapons/melee.json').then((r) => r.json()),
]);
const sword = meleeData.weapons[0];

// ---------------------------------------------------------------- scene
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1a1d26');
scene.fog = new THREE.Fog('#1a1d26', 30, 120);
scene.add(new THREE.HemisphereLight('#bcd4ff', '#2a1d14', 0.8));
const sun = new THREE.DirectionalLight('#ffe2b8', 2.2);
sun.position.set(20, 30, 10); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30 });
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#3b3f4a' }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
scene.add(ground);
scene.add(new THREE.GridHelper(200, 100, '#555', '#444'));

// Obstacles: low (vault), mid (climb), tall wall (wall-run).
const boxes = [
  { min: new THREE.Vector3(-2, 0, -8), max: new THREE.Vector3(2, 0.9, -7.4) },
  { min: new THREE.Vector3(5, 0, -12), max: new THREE.Vector3(9, 1.9, -9) },
  { min: new THREE.Vector3(-12, 0, -30), max: new THREE.Vector3(-11.4, 5, 0) },
];
const boxMat = new THREE.MeshStandardMaterial({ color: '#6d7487' });
const collidables = [];
for (const b of boxes) {
  const size = new THREE.Vector3().subVectors(b.max, b.min);
  const m = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), boxMat);
  m.position.copy(b.min).addScaledVector(size, 0.5);
  m.castShadow = m.receiveShadow = true;
  scene.add(m); collidables.push(m);
}

// ---------------------------------------------------------------- entities
class Health {
  constructor(owner, max) { this.owner = owner; this.max = max; this.hp = max; }
  damage(amount, _src, _by) {
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) { bus.emit('entity:death', { id: this.owner.id }); this.hp = this.max; }
  }
}

function makeFighter(id, team, color, pos) {
  const body = new FlatGroundBody(pos, boxes);
  const movement = new MovementController(movementTuning, body, {}, id);
  movement.state.position.copy(pos);
  const ent = { id, team, movement };
  ent.health = new Health(ent, 200);
  ent.melee = new MeleeComponent(sword, ent);

  // Graybox visual: capsule + emissive "blade" that glows with heat.
  const mesh = new THREE.Group();
  const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 4, 12), new THREE.MeshStandardMaterial({ color }));
  capsule.position.y = 0.9; capsule.castShadow = true;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.2), new THREE.MeshStandardMaterial({ color: '#ff8a3d', emissive: '#ff5a00', emissiveIntensity: 1.5 }));
  blade.position.set(0.45, 1.1, -0.6);
  mesh.add(capsule, blade);
  scene.add(mesh);
  ent.view = { mesh, capsule, blade, prev: pos.clone() };
  return ent;
}

const player = makeFighter(1, 0, '#d9a441', new THREE.Vector3(0, 0, 0));
const bot = makeFighter(2, 1, '#6b3fa0', new THREE.Vector3(0, 0, -5));
const melee = new MeleeSystem();
melee.add(player.melee); melee.add(bot.melee);

const brain = new MeleeDuelistBrain(bot, { aggression: 0.65, parrySkill: 0.45, reactionTime: 0.28, feintRate: 0.3 });
brain.target = player;
bus.on('melee:windup', (e) => brain.observeWindup(e));
bus.on('melee:parry', (e) => brain.observeParried(e));

// ---------------------------------------------------------------- systems
const input = new InputManager(renderer.domElement);
const rig = new CameraRig({ collidables });
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  rig.camera.aspect = innerWidth / innerHeight; rig.camera.updateProjectionMatrix();
});

// Hit-stop: freeze the sim for a few ticks on impactful events (offline only; see ARCHITECTURE §2).
let hitStop = 0;
for (const ev of ['melee:parry', 'melee:hit', 'melee:perfectBlock', 'melee:block']) {
  bus.on(ev, (e) => { hitStop = Math.max(hitStop, e.hitStop ?? 0); if (e.defender === 2 || e.attacker === 2) input.rumble(0.6, 0.4, 90); });
}

// Flash HUD feedback
const hud = document.getElementById('hud');
const flash = document.getElementById('flash');
const log = (msg, color = '#fff') => { flash.textContent = msg; flash.style.color = color; flash.style.opacity = 1; setTimeout(() => (flash.style.opacity = 0), 450); };
bus.on('melee:parry', (e) => log(e.defender === 1 ? 'PERFECT PARRY' : 'PARRIED!', '#ffb347'));
bus.on('melee:perfectBlock', (e) => e.defender === 1 && log('PERFECT BLOCK', '#9fd3ff'));
bus.on('melee:guardBreak', (e) => log(e.defender === 1 ? 'GUARD BROKEN' : 'GUARD BREAK!', '#ff5050'));
bus.on('melee:parryWhiff', (e) => e.id === 1 && log('whiff', '#888'));
bus.on('melee:windup', (e) => { if (e.id === 2) document.getElementById('tell').style.background = e.unblockable ? '#ff3030' : '#ffb347'; });
bus.on('melee:feint', (e) => e.id === 2 && log('feint!', '#c9a0ff'));

let lastPlayerCmd = null;
const loop = new FixedLoop({
  hz: 60,
  sim(dt, tick) {
    const cmd = input.sample(tick, dt);
    if (cmd.buttons.togglePOV?.pressed) rig.togglePOV();
    if (cmd.buttons.swapShoulder?.pressed) rig.swapShoulder();
    lastPlayerCmd = cmd;
    if (hitStop > 0) { hitStop -= dt; return; }

    for (const e of [player, bot]) e.view.prev.copy(e.movement.state.position);
    const botCmd = brain.think(dt, tick);
    player.movement.update(cmd, dt); player.melee.update(cmd, dt);
    bot.movement.update(botCmd, dt); bot.melee.update(botCmd, dt);
    melee.resolve();
  },
  render(alpha) {
    const dt = 1 / 60;
    for (const e of [player, bot]) {
      const s = e.movement.state;
      e.view.mesh.position.lerpVectors(e.view.prev, s.position, alpha);
      e.view.mesh.rotation.y = s.yaw;
      // Stance squash as stand-in for animation.
      const h = s.mode === 'slide' ? 0.5 : s.stance === 'crouch' ? 0.65 : s.stance === 'prone' ? 0.3 : 1;
      e.view.capsule.scale.y = THREE.MathUtils.damp(e.view.capsule.scale.y, h, 18, dt);
      const m = e.melee;
      e.view.blade.material.emissiveIntensity = 1 + (m.heat / 100) * 4 + (m.phase === 'active' ? 3 : 0);
      e.view.blade.rotation.x = m.phase === 'guard' ? -1.2 : m.phase === 'windup' ? 0.8 : m.phase === 'active' ? -0.6 : 0;
      e.view.capsule.material.emissive?.set(s.invulnerable ? '#3355ff' : m.vulnerable ? '#ff2222' : '#000000');
    }
    if (bot.melee.phase !== 'windup') document.getElementById('tell').style.background = 'transparent';

    const ps = player.movement.state;
    const eye = ps.mode === 'slide' ? 0.8 : ps.stance === 'crouch' ? 1.05 : ps.stance === 'prone' ? 0.4 : 1.65;
    rig.update(dt, { ...ps, position: player.view.mesh.position }, lastPlayerCmd?.pitch ?? 0, eye, player.melee.guarding);
    renderer.render(scene, rig.camera);

    hud.innerHTML = `
      <b>${ps.mode}</b> / ${ps.stance} · ${Math.hypot(ps.velocity.x, ps.velocity.z).toFixed(1)} m/s<br>
      HP ${player.health.hp.toFixed(0)} · STA ${ps.stamina.toFixed(0)} · HEAT ${player.melee.heat.toFixed(0)}${player.melee.overheated > 0 ? ' OVERHEAT' : ''} · GUARD ${player.melee.guardMeter.toFixed(0)}<br>
      melee: ${player.melee.phase} ${player.melee.counterWindow > 0 ? '<span style="color:#ffb347">COUNTER!</span>' : ''}<br>
      Bot HP ${bot.health.hp.toFixed(0)} · ${bot.melee.phase}`;
  },
});
loop.start();
