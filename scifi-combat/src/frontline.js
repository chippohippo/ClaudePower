// Frontline: a 64-128 player Battlefront-style battle against bots on a seeded 1 km map.
// URL: ?players=64|128 &seed=N &class=dawnblade &team=0|1 &difficulty=recruit|veteran|elite
//
// Client loop: input → FrontlineSession (fixed 60 Hz, the same sim the tests run) → animation
// (rigs, LOD) → HD2 camera → instanced crowd, battlefield, tracers → HUD and audio.

import * as THREE from 'three';
import { bus } from './core/EventBus.js';
import { FixedLoop } from './core/FixedLoop.js';
import { InputManager } from './input/InputManager.js';
import { CameraRig } from './camera/CameraRig.js';
import { FrontlineSession } from './game/FrontlineSession.js';
import { AnimationSystem } from './anim/AnimationSystem.js';
import { CrowdRenderer } from './render/CrowdRenderer.js';
import { BattlefieldRenderer } from './render/BattlefieldRenderer.js';
import { TracerPool } from './render/TracerPool.js';
import { VehicleViews } from './vfx/VehicleViews.js';
import { ZoneDeployableViews } from './vfx/ZoneDeployableViews.js';
import { AudioDirector, SynthBackend } from './audio/AudioDirector.js';
import { FrontlineHud } from './ui/FrontlineHud.js';
import { silhouetteScale } from './movement/Hitboxes.js';

const params = new URLSearchParams(location.search);
const players = Math.max(8, Math.min(128, +(params.get('players') ?? 64)));
const seed = +(params.get('seed') ?? 7);
const myTeam = +(params.get('team') ?? 0) === 1 ? 1 : 0;

const load = (p) => fetch(`./data/${p}`).then((r) => r.json());
const [movement, melee, ballistic, energy, attachments, recoil, damage, statuses, solariKits, voidKits, supers, vehicles, solari, voidC, ai, humanoid] = await Promise.all([
  load('movement.json'), load('weapons/melee.json'), load('weapons/ballistic.json'), load('weapons/energy.json'),
  load('weapons/attachments.json'), load('weapons/recoil.json'), load('damage-matrix.json'), load('abilities/statuses.json'),
  load('abilities/solari.json'), load('abilities/void.json'), load('supers.json'), load('vehicles.json'),
  load('classes/solari.json'), load('classes/void.json'), load('ai/personalities.json'), load('animation/humanoid.json'),
]);
const classes = [solari, voidC];
const myClass = params.get('class') ?? (myTeam === 0 ? 'lancer' : 'reaver');
const data = {
  movement, weaponFiles: [ballistic, energy], attachments: attachments.attachments, recoil: recoil.patterns, statuses: statuses.statuses,
  meleeWeapons: melee.weapons, kits: { ...solariKits.kits, ...voidKits.kits }, classes, damageMatrix: damage.matrix, supers, vehicleDefs: vehicles,
  personalities: ai.personalities, difficulty: ai.difficulty[params.get('difficulty') ?? 'veteran'] ?? ai.difficulty.veteran,
};
const abilityIndex = new Map();
for (const f of [solariKits, voidKits]) for (const kit of Object.values(f.kits)) for (const a of Object.values(kit)) abilityIndex.set(a.id, { ...a, family: f.soundFamily });

const PLAYER_ID = 1;
const session = new FrontlineSession(data, { players, seed, humans: [{ id: PLAYER_ID, team: myTeam, classId: myClass }] });
const { world, map, mode } = session;
const player = session.fighters.find((f) => f.id === PLAYER_ID);
player.name = 'You';

// ---------------------------------------------------------------- scene
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const sky = new THREE.Color('#9fb3c8');
scene.background = sky;
scene.fog = new THREE.Fog(sky, 90, 520);
// Physical light units (r155+): the hemisphere fill has to be ~2 for shaded faces to read as
// shade rather than black. The sun comes from the side so neither team fights into it.
scene.add(new THREE.HemisphereLight('#dfe9ff', '#3b3226', 2.2));
const sun = new THREE.DirectionalLight('#fff0d6', 2.4);
const SUN_OFFSET = new THREE.Vector3(30, 95, 55);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 10, far: 260 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
// Bounce fill from behind the camera (no shadows): stands in for the ground and sky bounce that
// keeps HD2's shaded sides readable, so the back of your own character never goes black.
const fill = new THREE.DirectionalLight('#cfd8e6', 0.9);
scene.add(fill, fill.target);

const battlefield = new BattlefieldRenderer(scene, map, { localTeam: myTeam, anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()) });
const anim = new AnimationSystem(humanoid, { getEntity: (id) => world.entity(id), surfaceAt: (x, y, z) => world.surfaceAt(x, y, z), groundY: (x, z) => map.terrain.height(x, z) });
for (const f of session.fighters) { anim.add(f); f.look = { team: f.team, status: null, flame: new THREE.Color(), highlight: f === player }; }
anim.focusId = PLAYER_ID;
const crowd = new CrowdRenderer(scene, { max: players + 8 });
const tracers = new TracerPool(scene, { getEntity: (id) => world.entity(id) });
const vehicleViews = new VehicleViews(scene, world, { localTeam: myTeam });
const zoneViews = new ZoneDeployableViews(scene, world, { localTeam: myTeam });

const input = new InputManager(renderer.domElement);
input.yaw = myTeam === 0 ? -Math.PI / 2 : Math.PI / 2; // face the enemy's side of the map
const groundOrCover = (o, d, max) => {
  const a = world.raycastStatic(o, d, max), b = world.raycastGround(o, d, max);
  return !a ? b : !b ? a : a.distance < b.distance ? a : b;
};
const rig = new CameraRig({ raycast: groundOrCover });
rig.camera.far = 1200; rig.camera.updateProjectionMatrix();
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); rig.camera.aspect = innerWidth / innerHeight; rig.camera.updateProjectionMatrix(); });

let audio = null;
renderer.domElement.addEventListener('mousedown', () => {
  if (audio) return;
  audio = new AudioDirector(new SynthBackend(), {
    listenerId: PLAYER_ID, abilityIndex,
    getEntity: (id) => { const e = world.entity(id); return e && { team: e.team, position: e.movement.state.position }; },
  });
});

const hud = new FrontlineHud(document.getElementById('hud'), session, player);
const STATUS_GLOW = {
  iframes: new THREE.Color(0.15, 0.25, 1.1), vulnerable: new THREE.Color(1.0, 0.1, 0.1), radiant: new THREE.Color(0.7, 0.45, 0.1),
  void: new THREE.Color(0.35, 0.1, 0.7), mech: new THREE.Color(0.25, 0.25, 0.25), scorch: new THREE.Color(0.5, 0.16, 0), weaken: new THREE.Color(0.22, 0.07, 0.4),
};
const LYING = new Set(['dive', 'knockdown']);

// ---------------------------------------------------------------- loop
const loop = new FixedLoop({
  hz: 60,
  sim(dt, tick) {
    const cmd = input.sample(tick, dt);
    if (cmd.buttons.togglePOV?.pressed) rig.togglePOV();
    if (cmd.buttons.swapShoulder?.pressed) rig.swapShoulder();
    if (cmd.buttons.toggleMelee?.pressed) player.mode = player.mode === 'sword' ? 'gun' : 'sword';
    if (player.health.dead && cmd.buttons.jump?.pressed) session.respawn(PLAYER_ID);
    session.setCommand(PLAYER_ID, cmd);
    session.focus[0] = player.movement.state.position;
    anim.snapshot();
    session.step(dt);
  },
  render(alpha) {
    const dt = 1 / 60;
    for (const f of session.fighters) {
      const s = f.movement.state, st = f.status, tf = f.transform;
      f.look.status = s.invulnerable ? STATUS_GLOW.iframes : f.melee.vulnerable ? STATUS_GLOW.vulnerable : tf ? STATUS_GLOW[tf.def.aura] ?? null
        : st.has('scorch') ? STATUS_GLOW.scorch : st.has('volatile') || st.has('weaken') ? STATUS_GLOW.weaken : null;
      f.look.flame.set(f.melee.w.visual?.flameColor ?? (f.team === 0 ? '#ff7a1a' : '#8b5cf6'));
    }
    anim.update(dt, alpha, rig.camera.position);
    const w = player.weapons, pv = player.vehicle?.veh;
    const lookYaw = input.yaw + (player.mode === 'gun' ? w.recoilYaw : 0);
    const lookPitch = Math.max(-1.45, Math.min(1.45, input.pitch + (player.mode === 'gun' ? w.recoilPitch : 0)));
    rig.update(dt, {
      target: player, pos: anim.record(PLAYER_ID).root, yaw: lookYaw, pitch: lookPitch,
      ads: player.mode === 'gun' ? w.ads : player.melee.guarding ? 0.3 : 0, adsFov: w.current?.s.ads?.fov,
      vehicle: pv ? pv.def.camera : null, scale: silhouetteScale(player),
    });
    crowd.begin(rig.camera);
    for (const r of anim.list) {
      const f = r.e, s = f.movement.state;
      if (f.vehicle && !f.vehicle.exposed) continue;
      if (f.health.dead && f.health.sinceDamage > 6) continue;
      if (r.lod < 2) crowd.drawRig(r.h, f.look, r.lod);
      else crowd.drawImpostor(r.root, { yaw: s.bodyYaw, scale: silhouetteScale(f), height: s.stance === 'crouch' ? 1.2 : 1.8, lying: LYING.has(s.mode) || s.stance === 'prone' || s.slide?.kind === 'belly' || f.health.dead }, f.look);
    }
    crowd.end();
    const root = anim.record(PLAYER_ID).root;
    sun.position.copy(root).add(SUN_OFFSET); sun.target.position.copy(root);
    fill.position.copy(rig.camera.position).addScaledVector(rig.camera.up, 4); fill.target.position.copy(root);
    battlefield.update(mode, session.time);
    tracers.update(dt);
    zoneViews.update(dt);
    vehicleViews.update(dt, rig.camera);
    renderer.render(scene, rig.camera);
    audio?.update(dt, rig.camera.position, player.movement.state.yaw);
    hud.update(dt, rig.camera);
  },
});
window.__frontline = { session, player, anim, crowd, rig, hud, renderer, scene };
loop.start();
bus.emit('frontline:ready', { players, seed });
