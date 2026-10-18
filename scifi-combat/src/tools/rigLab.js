// Rig lab: every move from rigLabStations.js, side by side, looping, with slow motion, orbit,
// pause/step and debug overlays (planted feet, hit spheres, the event log). Use it to judge the
// animation against Helldivers 2 footage frame by frame (docs/ANIMATION.md: calibration).
// URL: rig-lab.html?station=slide&view=side&speed=0.25   ·   &at=1.9 freezes at that loop time;
// &solo shows only that station, &yaw=0.6&pitch=0.9&dist=4 frames the orbit view, &marks=0 hides
// the planted-feet discs (for screenshots).

import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { CombatWorld } from '../combat/CombatWorld.js';
import { MeleeSystem } from '../combat/melee/MeleeSystem.js';
import { buildFighter } from '../game/FighterFactory.js';
import { routeCommand } from '../core/routing.js';
import { AnimationSystem } from '../anim/AnimationSystem.js';
import { CrowdRenderer } from '../render/CrowdRenderer.js';
import { hitSpheres } from '../movement/Hitboxes.js';
import { STATIONS, StationDriver, buddyDriver, floorOf } from './rigLabStations.js';
import { BodyContacts } from '../movement/BodyContacts.js';
import { reactToHit } from '../combat/HitReactions.js';

const DT = 1 / 60;
const SPACING = 6;
const params = new URLSearchParams(location.search);
const load = (p) => fetch(`./data/${p}`).then((r) => r.json());
const [movement, melee, ballistic, energy, attachments, recoil, damage, statuses, solariKits, voidKits, supers, vehicles, solari, voidC, humanoid] = await Promise.all([
  load('movement.json'), load('weapons/melee.json'), load('weapons/ballistic.json'), load('weapons/energy.json'),
  load('weapons/attachments.json'), load('weapons/recoil.json'), load('damage-matrix.json'), load('abilities/statuses.json'),
  load('abilities/solari.json'), load('abilities/void.json'), load('supers.json'), load('vehicles.json'),
  load('classes/solari.json'), load('classes/void.json'), load('animation/humanoid.json'),
]);
const factoryData = {
  movement, weaponFiles: [ballistic, energy], attachments: attachments.attachments, recoil: recoil.patterns, statuses: statuses.statuses,
  meleeWeapons: melee.weapons, kits: { ...solariKits.kits, ...voidKits.kits }, classes: [solari, voidC],
};

// ---------------------------------------------------------------- scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#20242e');
scene.add(new THREE.HemisphereLight('#c8dcff', '#2a2018', 0.9));
const sun = new THREE.DirectionalLight('#fff0d8', 2.2);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
scene.add(sun, sun.target);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 200), new THREE.MeshStandardMaterial({ color: '#3d424e' }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
scene.add(ground, new THREE.GridHelper(400, 400, '#59606e', '#4a505c'));
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 500);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

// ---------------------------------------------------------------- world and stations
const world = new CombatWorld({ damageMatrix: damage.matrix, cover: [], supers, meleeWeapons: melee.weapons, recoilDefs: recoil.patterns, vehicleDefs: vehicles, statusDefs: statuses.statuses });
const meleeSys = new MeleeSystem();
// Bodies solid to each other and feet on what they stand on, as in the game.
const bodies = new BodyContacts(factoryData.movement.bodies);
const animSys = new AnimationSystem(humanoid, { getEntity: (id) => world.entity(id), surfaceAt: (x, y, z) => world.surfaceAt(x, y, z), groundY: floorOf(world.cover), bodies });
const crowd = new CrowdRenderer(scene, { max: STATIONS.length + 2 });
const boxMat = new THREE.MeshStandardMaterial({ color: '#6d7487' });
let nextId = 1;
const solo = params.has('solo');
const slots = STATIONS.map((st, i) => {
  const x = i * SPACING, meshes = [];
  for (const b of st.boxes ?? []) {
    const box = { min: new THREE.Vector3(x + b.min[0], b.min[1], b.min[2]), max: new THREE.Vector3(x + b.max[0], b.max[1], b.max[2]), surface: 'metal' };
    world.cover.push(box);
    const size = new THREE.Vector3().subVectors(box.max, box.min);
    const m = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), boxMat);
    m.position.copy(box.min).addScaledVector(size, 0.5); m.castShadow = m.receiveShadow = true;
    scene.add(m); meshes.push(m);
  }
  return { st, x, e: null, driver: null, meshes };
});

function spawnFighter(slot, def) {
  const [sx, sy, sz] = def.start ?? [0, 0, 0];
  const e = buildFighter(world, factoryData, { id: nextId++, team: def.team ?? 0, classId: def.classId ?? 'lancer', pos: new THREE.Vector3(slot.x + sx, sy, sz) });
  e.mode = def.mode ?? slot.st.mode ?? 'gun';
  // The lab is about motion: nobody dies, but a blow still rocks you (HitReactions).
  e.health.damage = (dmg, info, by) => { reactToHit(e, { dealt: dmg, killed: false, downed: false }, info ?? {}, by); return {}; };
  e.look = { team: e.team, status: null, flame: new THREE.Color(e.melee.w.visual?.flameColor ?? '#ff7a1a'), highlight: false };
  meleeSys.add(e.melee);
  animSys.add(e);
  return e;
}

function spawn(slot) {
  for (const old of [slot.e, slot.buddy]) {
    if (!old) continue;
    world.entities.splice(world.entities.indexOf(old), 1);
    meleeSys.remove(old.melee);
    animSys.remove(old.id);
  }
  slot.e = spawnFighter(slot, slot.st);
  slot.buddy = slot.st.buddy ? spawnFighter(slot, slot.st.buddy) : null;
  slot.driver = new StationDriver(slot.st);
  slot.buddyDriver = buddyDriver(slot.st);
}
slots.forEach(spawn);

function tick() {
  animSys.snapshot();
  for (const slot of slots) {
    if (slot.driver.done) { spawn(slot); animSys.snapshot(); }
    const pairs = [[slot.e, slot.driver.command(slot.e, DT, slot.buddy)]];
    if (slot.buddy) pairs.push([slot.buddy, slot.buddyDriver.command(slot.buddy, DT, slot.e)]);
    for (const [e, cmd] of pairs) {
      e.status.update(DT); e.health.update(DT);
      e.movement.update(cmd, DT);
      e.movement.state.speedScale = e.status.speedMul;
      const r = routeCommand(e, cmd);
      e.abilities.update(cmd, DT); e.melee.update(r.meleeCmd, DT); e.weapons.update(r.gunCmd, DT);
    }
  }
  bodies.step(slots.flatMap((s) => (s.buddy ? [s.e, s.buddy] : [s.e])), [], DT, nudge);
  world.update(DT);
  meleeSys.resolve();
}
const nudge = (f, dx, dz) => f.movement.nudge(dx, dz);

// ---------------------------------------------------------------- UI
let selected = Math.max(0, STATIONS.findIndex((s) => s.id === params.get('station')));
let view = params.get('view') ?? 'side';
let speed = +(params.get('speed') ?? 1);
let paused = false, stepOnce = false;
const overlays = { feet: params.get('marks') !== '0', hits: false };
const ui = document.getElementById('ui');
ui.innerHTML = `
  <div class="row">${STATIONS.map((s, i) => `<button data-st="${i}">${s.name}</button>`).join('')}</div>
  <div class="row">
    ${['side', 'front', 'back', 'top', 'orbit'].map((v) => `<button data-view="${v}">${v}</button>`).join('')}
    <label>speed <input id="speed" type="range" min="0.05" max="1" step="0.05" value="${speed}"><span id="speedv"></span></label>
    <button id="pause">pause</button><button id="step">step</button>
    <label><input id="feet" type="checkbox"${overlays.feet ? ' checked' : ''}> planted feet</label>
    <label><input id="hits" type="checkbox"> hit spheres</label>
  </div>`;
const refreshUi = () => {
  ui.querySelectorAll('[data-st]').forEach((b) => b.classList.toggle('on', +b.dataset.st === selected));
  ui.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  document.getElementById('speedv').textContent = `${speed.toFixed(2)}×`;
  document.getElementById('pause').textContent = paused ? 'play' : 'pause';
};
ui.addEventListener('click', (ev) => {
  const t = ev.target;
  if (t.dataset.st) selected = +t.dataset.st;
  if (t.dataset.view) view = t.dataset.view;
  if (t.id === 'pause') paused = !paused;
  if (t.id === 'step') { paused = true; stepOnce = true; }
  refreshUi();
});
document.getElementById('speed').addEventListener('input', (ev) => { speed = +ev.target.value; refreshUi(); });
document.getElementById('feet').addEventListener('change', (ev) => (overlays.feet = ev.target.checked));
document.getElementById('hits').addEventListener('change', (ev) => (overlays.hits = ev.target.checked));
let orbit = { yaw: +(params.get('yaw') ?? 0.9), pitch: +(params.get('pitch') ?? 0.25), dist: +(params.get('dist') ?? 5), dragging: false };
renderer.domElement.addEventListener('mousedown', () => { orbit.dragging = true; view = 'orbit'; refreshUi(); });
addEventListener('mouseup', () => (orbit.dragging = false));
addEventListener('mousemove', (ev) => { if (orbit.dragging) { orbit.yaw -= ev.movementX * 0.006; orbit.pitch = Math.max(-0.2, Math.min(1.3, orbit.pitch + ev.movementY * 0.004)); } });
refreshUi();

// Event log for the selected fighter: shows that sound hooks fire on the visible contact frame.
const log = [];
const info = document.getElementById('info');
for (const type of ['anim:footstep', 'anim:impact', 'anim:cloth']) {
  bus.on(type, (ev) => {
    if (ev.id !== slots[selected].e.id) return;
    log.unshift(`${slots[selected].driver.t.toFixed(2)}s  ${type.slice(5)} ${ev.kind ?? ev.gait} ${ev.foot !== undefined ? (ev.foot ? 'R' : 'L') : ''} ${(ev.intensity ?? 0).toFixed(2)}`);
    log.length = Math.min(log.length, 10);
  });
}

// Debug overlays: planted feet (green discs) and hit spheres (wireframe).
const footMarks = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16), new THREE.MeshBasicMaterial({ color: '#4dff88', depthTest: false, transparent: true, opacity: 0.85 })); m.rotation.x = -Math.PI / 2; m.renderOrder = 10; scene.add(m); return m; });
const hitMarks = [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: '#ff4d6d', wireframe: true })); scene.add(m); return m; });

// ---------------------------------------------------------------- loop
const look = new THREE.Vector3();
const camPos = new THREE.Vector3();
function placeCamera(dtReal) {
  const rec = animSys.record(slots[selected].e.id);
  const root = rec.root, s = slots[selected].e.movement.state;
  look.set(root.x, root.y + (s.stance === 'prone' || s.mode === 'dive' || s.mode === 'slide' ? 0.45 : 0.9), root.z);
  const k = 1 - Math.exp(-6 * dtReal);
  const want = new THREE.Vector3();
  if (view === 'side') want.set(root.x + 5, root.y + 1.0, root.z);
  else if (view === 'front') want.set(root.x, root.y + 1.2, root.z - 5);
  else if (view === 'back') want.set(root.x + 0.6, root.y + 1.8, root.z + 2.6);
  else if (view === 'top') want.set(root.x + 0.01, root.y + 9, root.z);
  else want.set(root.x + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * orbit.dist, root.y + 0.9 + Math.sin(orbit.pitch) * orbit.dist, root.z + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * orbit.dist);
  camPos.lerp(want, camPos.lengthSq() === 0 ? 1 : k);
  camera.position.copy(camPos);
  camera.lookAt(look);
  sun.position.set(root.x + 6, 12, root.z + 4); sun.target.position.copy(root);
}

function draw(dtAnim, alpha, dtReal) {
  animSys.focusId = slots[selected].e.id;
  animSys.update(dtAnim, alpha, camera.position);
  placeCamera(dtReal);
  const sel = slots[selected], h = animSys.get(sel.e.id), s = sel.e.movement.state;
  crowd.begin(camera);
  for (const r of animSys.list) {
    if (solo && r.e !== sel.e && r.e !== sel.buddy) continue;
    r.lod < 2 ? crowd.drawRig(r.h, r.e.look, r.lod) : crowd.drawImpostor(r.root, { yaw: r.e.movement.state.bodyYaw, height: 1.8 }, r.e.look);
  }
  crowd.end();
  if (solo) for (const sl of slots) for (const m of sl.meshes) m.visible = sl === sel;
  for (let i = 0; i < 2; i++) {
    const f = h.planter.feet[i];
    footMarks[i].visible = overlays.feet && h.planterLive && f.planted;
    footMarks[i].position.set(f.plant.x, f.plant.y + 0.01, f.plant.z);
  }
  const hs = hitSpheres(sel.e);
  hitMarks.forEach((m, i) => { m.visible = overlays.hits; m.position.set(hs[i].x, hs[i].y, hs[i].z); m.scale.setScalar(hs[i].r); });
  info.innerHTML = `<b>${sel.st.name}</b>  t ${sel.driver.t.toFixed(2)} / ${sel.st.length}s<br>` +
    `mode ${s.mode} · stance ${s.stance}${s.stanceT ? ` → ${s.stanceT.to} ${(s.stanceT.t / s.stanceT.dur * 100).toFixed(0)}%` : ''} · ${s.speed.toFixed(2)} m/s · gait ${s.gait}${s.supine ? ' · supine' : ''}${s.invulnerable ? ' · <b style="color:#7aa2ff">i-frames</b>' : ''}<br>` +
    `feet ${h.planter.feet.map((f) => (f.planted ? 'planted' : `swing ${(f.u * 100).toFixed(0)}%`)).join(' / ')} · weapon ${sel.e.weapons.phase} raise ${h.raise.toFixed(2)}<br>` +
    `<pre>${log.join('\n')}</pre>`;
  renderer.render(scene, camera);
}

const at = params.has('at') ? +params.get('at') : null;
if (at !== null) {
  // Screenshot mode: fast-forward deterministically to `at` seconds into the loop, then freeze.
  while (slots[selected].driver.t < at - 1e-6) { tick(); animSys.update(DT, 1, null); }
  paused = true; refreshUi();
}
let acc = 0, last = performance.now();
function frame(now) {
  const real = Math.min(0.1, (now - last) / 1000); last = now;
  if (!paused || stepOnce) acc += stepOnce ? DT : real * speed;
  let ticked = 0;
  while (acc >= DT) { tick(); acc -= DT; ticked++; }
  const dtAnim = paused && !stepOnce ? 0 : stepOnce ? DT : real * speed;
  stepOnce = false;
  draw(dtAnim, acc / DT, real);
  window.__lab = { ready: true, slots, animSys };
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
