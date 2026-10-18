// Graybox skirmish: you (Solari Dawnblade) + 3 Solari bots vs. 4 Void bots, with vehicles on pads.
// Bots use CombatBotBrain: full class kits, guns, swords and vehicles (?difficulty=recruit|veteran|elite).
// Demonstrates the full loop: Input → fixed-step sim (movement + melee + guns + abilities + statuses)
// → events → camera/juice/audio/HUD.
// Run: `npx serve scifi-combat` (or any static server) and open arena.html (index.html is the frontline battle).

import * as THREE from 'three';
import { bus } from './core/EventBus.js';
import { FixedLoop } from './core/FixedLoop.js';
import { InputManager } from './input/InputManager.js';
import { MovementController, FlatGroundBody } from './movement/MovementController.js';
import { MeleeComponent, MeleeSystem } from './combat/melee/MeleeSystem.js';
import { WeaponComponent, WeaponInstance } from './combat/weapons/WeaponSystem.js';
import { CombatWorld } from './combat/CombatWorld.js';
import { revertTransform } from './combat/TransformSystem.js';
import { ZoneDeployableViews } from './vfx/ZoneDeployableViews.js';
import { VehicleViews } from './vfx/VehicleViews.js';
import { buildWeapon } from './combat/weapons/WeaponDefs.js';
import { AbilityComponent } from './combat/AbilitySystem.js';
import { StatusComponent } from './combat/StatusSystem.js';
import { Health } from './combat/Health.js';
import { CameraRig } from './camera/CameraRig.js';
import { CombatBotBrain } from './ai/CombatBotBrain.js';
import { buildFighter } from './game/FighterFactory.js';
import { routeCommand } from './core/routing.js';
import { AudioDirector } from './audio/AudioDirector.js';
import { SoundEngine } from './audio/SoundEngine.js';
import { AnimationSystem } from './anim/AnimationSystem.js';
import { CrowdRenderer } from './render/CrowdRenderer.js';
import { silhouetteScale } from './movement/Hitboxes.js';
import { reactToHit, woundSite } from './combat/HitReactions.js';

const load = (p) => fetch(`./data/${p}`).then((r) => r.json());
const [movementTuning, meleeData, ballistic, energy, attachments, recoil, damage, statuses, solariKits, voidKits, supers, vehicleDefs, solariClasses, voidClasses, aiDefs, humanoid, down] = await Promise.all([
  load('movement.json'), load('weapons/melee.json'), load('weapons/ballistic.json'), load('weapons/energy.json'),
  load('weapons/attachments.json'), load('weapons/recoil.json'), load('damage-matrix.json'),
  load('abilities/statuses.json'), load('abilities/solari.json'), load('abilities/void.json'), load('supers.json'), load('vehicles.json'),
  load('classes/solari.json'), load('classes/void.json'), load('ai/personalities.json'), load('animation/humanoid.json'), load('down.json'),
]);
const sword = meleeData.weapons[0];
const abilityIndex = new Map();
for (const f of [solariKits, voidKits]) for (const kit of Object.values(f.kits)) for (const a of Object.values(kit)) abilityIndex.set(a.id, { ...a, family: f.soundFamily });

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
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(20, 30, 10);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#3b3f4a' }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
scene.add(ground);
scene.add(new THREE.GridHelper(200, 100, '#555', '#444'));

// Obstacles: low (vault), mid (climb), tall wall (wall-run), plus destructible crates for Breach/Rift charges.
const boxes = [
  { min: new THREE.Vector3(-2, 0, -8), max: new THREE.Vector3(2, 0.9, -7.4) },
  { min: new THREE.Vector3(5, 0, -12), max: new THREE.Vector3(9, 1.9, -9) },
  { min: new THREE.Vector3(-12, 0, -30), max: new THREE.Vector3(-11.4, 5, 0) },
  { min: new THREE.Vector3(-6, 0, -16), max: new THREE.Vector3(-4, 1.4, -15), destructible: true, surface: 'wood' },
  { min: new THREE.Vector3(3, 0, -20), max: new THREE.Vector3(5, 1.4, -19), destructible: true, surface: 'wood' },
];
const boxMat = new THREE.MeshStandardMaterial({ color: '#6d7487' });
const crateMat = new THREE.MeshStandardMaterial({ color: '#8a6a3f' });
const collidables = [];
const coverMeshes = new Map();
for (const b of boxes) {
  const size = new THREE.Vector3().subVectors(b.max, b.min);
  const m = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), b.destructible ? crateMat : boxMat);
  m.position.copy(b.min).addScaledVector(size, 0.5);
  m.castShadow = m.receiveShadow = true;
  scene.add(m); collidables.push(m); coverMeshes.set(b, m);
}

// ---------------------------------------------------------------- world (sim queries)
// CombatWorld owns projectiles, zones, deployables and cover. `boxes` is shared by reference with
// the movement bodies, so destroyed cover stops colliding at the same moment it disappears.
const world = new CombatWorld({ damageMatrix: damage.matrix, cover: boxes, supers, meleeWeapons: meleeData.weapons, recoilDefs: recoil.patterns, vehicleDefs, statusDefs: statuses.statuses, down });
const entities = world.entities;
bus.on('world:coverDestroyed', (e) => { const m = coverMeshes.get(e.cover); const i = collidables.indexOf(m); if (i >= 0) collidables.splice(i, 1); });

// Characters: a procedural Helldivers 2-style rig per fighter (foot planting, sim-timed
// transitions, animation-synced foley), drawn by one instanced crowd renderer.
const animSys = new AnimationSystem(humanoid, { getEntity: (id) => world.entity(id), surfaceAt: (x, y, z) => world.surfaceAt(x, y, z) });
const crowd = new CrowdRenderer(scene, { max: 64 });
const STATUS_GLOW = {
  iframes: new THREE.Color(0.15, 0.25, 1.1), vulnerable: new THREE.Color(1.0, 0.1, 0.1), radiant: new THREE.Color(0.7, 0.45, 0.1),
  void: new THREE.Color(0.35, 0.1, 0.7), mech: new THREE.Color(0.25, 0.25, 0.25), scorch: new THREE.Color(0.5, 0.16, 0), weaken: new THREE.Color(0.22, 0.07, 0.4), silenced: new THREE.Color(0.2, 0.2, 0.2),
};
const LYING = new Set(['dive', 'knockdown', 'ragdoll']);

// ---------------------------------------------------------------- entities
function makeFighter(id, team, color, pos, kit, guns) {
  const body = new FlatGroundBody(pos, boxes);
  const movement = new MovementController(movementTuning, body, {}, id);
  movement.state.position.copy(pos);
  const ent = { id, team, movement, mode: 'sword' };
  ent.health = new Health(ent, { health: 140, shield: 60, armor: 'plate', down });
  ent.status = new StatusComponent(ent, statuses.statuses, world);
  movement.hooks.fallDamage = (amount) => ent.health.damage(amount, { kind: 'fall' }, null);
  // Same body rules as FighterFactory fighters: ragdolls on big hits, downed at 0, revivable.
  movement.hooks.vital = () => (ent.health.dead ? 'dead' : ent.health.downed ? 'downed' : 'alive');
  movement.hooks.scale = () => silhouetteScale(ent);
  ent.onHit = (res, info, by) => reactToHit(ent, res, info, by);
  ent.woundSite = (info) => woundSite(ent, info);
  ent.onDowned = ent.onDied = () => { if (ent.vehicle) world.vehicles.exit(ent, { eject: true }); };
  ent.onRevived = () => ent.movement.getUpFromDown();
  ent.melee = new MeleeComponent(sword, ent, world);
  ent.weapons = new WeaponComponent(ent, guns.map((g) => new WeaponInstance(g, recoil.patterns)), world);
  ent.abilities = new AbilityComponent(ent, kit, world);
  attachView(ent, color);
  world.add(ent);
  return ent;
}

/** Registers the fighter's rig and its per-frame look (team palette, status glow, flame color). */
function attachView(ent) {
  animSys.add(ent);
  ent.look = { team: ent.team, status: null, flame: new THREE.Color(), highlight: false };
}

const playerGuns = [
  buildWeapon(ballistic, 'sol_ar_halcyon', attachments.attachments, ['optic_holo', 'ub_grip']),
  buildWeapon(energy, 'sol_pr_aurora', attachments.attachments, []),
];
const player = makeFighter(1, 0, '#d9a441', new THREE.Vector3(0, 0, 0), solariKits.kits.dawnblade, playerGuns);
player.name = 'You';
const melee = new MeleeSystem({ blades: humanoid.sword });
melee.add(player.melee);

// ---------------------------------------------------------------- bots (4v4 skirmish)
const factoryData = {
  down,
  movement: movementTuning, weaponFiles: [ballistic, energy], attachments: attachments.attachments, recoil: recoil.patterns,
  statuses: statuses.statuses, meleeWeapons: meleeData.weapons, kits: { ...solariKits.kits, ...voidKits.kits }, classes: [solariClasses, voidClasses],
};
const difficultyName = new URLSearchParams(location.search).get('difficulty') ?? 'veteran';
const difficulty = aiDefs.difficulty[difficultyName] ?? aiDefs.difficulty.veteran;
const SPAWNS = [new THREE.Vector3(0, 0, 6), new THREE.Vector3(0, 0, -58)];
const spawnPoint = (team, i) => SPAWNS[team].clone().add(new THREE.Vector3(((i % 4) - 1.5) * 3.5, 0, 0));
const ROSTER = [[0, 'lancer'], [0, 'skyrider'], [0, 'lumen'], [1, 'ashsworn'], [1, 'monolith'], [1, 'driftcaller'], [1, 'hollow_eye']];
const bots = ROSTER.map(([team, classId], i) => {
  const e = buildFighter(world, factoryData, { id: 10 + i, team, classId, pos: spawnPoint(team, i) });
  e.name = classId.replace('_', '-').replace(/^./, (c) => c.toUpperCase());
  attachView(e, team === 0 ? '#c9a24a' : '#5b3a8f');
  melee.add(e.melee);
  e.brain = new CombatBotBrain(e, world, aiDefs.personalities[e.ai], difficulty, { seed: 10 + i });
  e.abilities.superEnergy = 40; // supers come online within the first couple of minutes
  return e;
});
const fighterName = (id) => { const x = world.entity(id); return x?.name ?? x?.def?.name ?? (x?.isDeployable ? x.kind : '?'); };

// Demo: K cycles the player through all 20 class kits so every ability can be tried.
const kitOrder = [...Object.entries(solariKits.kits).map(([k, v]) => ['Solari', k, v]), ...Object.entries(voidKits.kits).map(([k, v]) => ['Void', k, v])];
let kitIndex = kitOrder.findIndex(([, k]) => k === 'dawnblade');
function nextKit() {
  kitIndex = (kitIndex + 1) % kitOrder.length;
  const [faction, id, kit] = kitOrder[kitIndex];
  revertTransform(player, 'kitSwap'); // never leave a super's weapon/moveset behind
  player.abilities = new AbilityComponent(player, kit, world);
  player.abilities.superEnergy = player.abilities.superCost; // demo: super ready so it can be tried immediately
  const names = Object.values(kit).map((a, i) => `${['Q', 'E', 'G', 'Z'][i]} ${a.name}`).join(' · ');
  document.getElementById('kit').innerHTML = `<b>${faction} ${id.replace('_', ' ')}</b> (K: next class)<br>${names}`;
  log(`${faction.toUpperCase()} ${id.replace('_', ' ').toUpperCase()}`, faction === 'Solari' ? '#ffcf6b' : '#c9a0ff');
}
const views = new ZoneDeployableViews(scene, world, { localTeam: 0, coverMeshes });

// Vehicle pads (Battlefront pickups). Yours are near spawn; the enemy's are downrange as targets.
const vehicleViews = new VehicleViews(scene, world, { localTeam: 0 });
world.vehicles.addPad({ vehicle: 'solari_hoverbike', team: 0, at: new THREE.Vector3(5, 0, 4), respawn: 10 });
world.vehicles.addPad({ vehicle: 'solari_lancer_tank', team: 0, at: new THREE.Vector3(-8, 0, 9), respawn: 20 });
world.vehicles.addPad({ vehicle: 'solari_dawnship', team: 0, at: new THREE.Vector3(16, 0, 14), respawn: 30 });
world.vehicles.addPad({ vehicle: 'void_crawler_tank', team: 1, at: new THREE.Vector3(4, 0, -50), yaw: Math.PI, respawn: 20 });
world.vehicles.addPad({ vehicle: 'void_skiff', team: 1, at: new THREE.Vector3(-10, 0, -45), yaw: Math.PI, respawn: 10 });

// Respawn at the team spawn after 3 s; score and killfeed.
const score = [0, 0];
bus.on('entity:death', (e) => {
  const x = world.entity(e.id);
  if (!x || x.isVehicle || x.isDeployable) return;
  const killer = world.entity(e.by);
  const killerTeam = killer?.team ?? -1;
  if (killerTeam >= 0 && killerTeam !== x.team) score[killerTeam]++;
  pushKill(killer ? fighterName(e.by) : 'World', killerTeam, x.name, x.team);
  setTimeout(() => {
    if (x.vehicle) world.vehicles.exit(x);
    revertTransform(x, 'respawn');
    const p = spawnPoint(x.team, x.id);
    x.movement.reset(p);
    x.health.revive(1); x.health.shield = x.health.maxShield; x.status.cleanse();
  }, 3000);
});

// ---------------------------------------------------------------- systems
const input = new InputManager(renderer.domElement);
const rig = new CameraRig({ raycast: (o, d, max) => world.raycastStatic(o, d, max) });
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  rig.camera.aspect = innerWidth / innerHeight; rig.camera.updateProjectionMatrix();
});

// The sound (SoundEngine): rendered while you look round, started by your first click or key.
const sound = new SoundEngine({ environment: 'open' });
const audio = new AudioDirector(sound, {
  listenerId: 1, abilityIndex, environment: 'trench',
  getEntity: (id) => {
    const e = world.entity(id);
    if (!e) return null;
    const v = e.movement.state.velocity, W = e.weapons;
    return { team: e.team, position: e.movement.state.position, perks: e.perks, speed: v ? Math.hypot(v.x, v.z) : 0, weapon: W?.current?.s ?? null, loadout: W?.loadout?.map((x) => x.s) ?? [], shield: e.health?.shield ?? 0, hpFrac: e.health && !e.isVehicle ? e.health.hp / e.health.max : 1 };
  },
  onSuperWarning: ({ ability }) => log(`ENEMY SUPER: ${abilityIndex.get(ability)?.name ?? ability}`, '#c9a0ff'),
});
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => sound.resume());

// Hit-stop: freeze the sim for a few ticks on impactful events (offline only; see ARCHITECTURE §2).
let hitStop = 0;
for (const ev of ['melee:parry', 'melee:hit', 'melee:perfectBlock', 'melee:block']) {
  bus.on(ev, (e) => { hitStop = Math.max(hitStop, e.hitStop ?? 0); if (e.defender === 1 || e.attacker === 1) input.rumble(0.6, 0.4, 90); });
}

// ---------------------------------------------------------------- presentation: tracers and telegraphs
const fx = []; // { obj, life, max }
function addFx(obj, life) { scene.add(obj); fx.push({ obj, life, max: life }); }
const tracerMat = new THREE.LineBasicMaterial({ color: '#ffd27a', transparent: true });
bus.on('weapon:tracer', (e) => {
  const from = new THREE.Vector3().fromArray(e.from), to = from.clone().addScaledVector(new THREE.Vector3().fromArray(e.dir), e.dist);
  addFx(new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), tracerMat.clone()), 0.08);
});
const boltGeo = new THREE.SphereGeometry(0.08, 6, 6);
const bolts = new Map();
bus.on('projectile:spawn', (e) => {
  const m = new THREE.Mesh(boltGeo, new THREE.MeshBasicMaterial({ color: e.ref.team === 0 ? '#ffb347' : '#a970ff' }));
  scene.add(m); bolts.set(e.ref, m);
});

// Telegraph clarity: enemy casts = red-tinted with a faction rim; ally/self = faction color, fainter.
// The shape and size come straight from the ability data, so the warning always matches the hit.
const teleColor = (team) => (team === player.team ? '#ffcf6b' : '#ff3b5c');
bus.on('ability:cast', (e) => {
  const t = e.telegraph; if (!t || t.shape === 'none') return;
  const enemy = e.team !== player.team;
  const mat = new THREE.MeshBasicMaterial({ color: teleColor(e.team), transparent: true, opacity: enemy ? 0.55 : 0.25, side: THREE.DoubleSide, depthWrite: false });
  let geo;
  if (t.shape === 'line') geo = new THREE.PlaneGeometry(t.width, t.length).translate(0, t.length / 2, 0); // +y maps to forward (-z) after the X rotation
  else if (['circle', 'dome', 'pillar', 'drop_marker'].includes(t.shape)) geo = new THREE.RingGeometry(Math.max(0.1, (t.radius ?? 3) - 0.25), t.radius ?? 3, 48);
  else return;
  const m = new THREE.Mesh(geo, mat);
  m.rotation.order = 'YXZ';
  m.rotation.set(-Math.PI / 2, e.yaw, 0);
  m.position.fromArray(e.origin).setY(0.03);
  addFx(m, (e.castTime ?? 0.3) + (t.lead ?? 0) + 0.25);
});
bus.on('ability:area', (e) => {
  const m = new THREE.Mesh(new THREE.CircleGeometry(e.radius, 40), new THREE.MeshBasicMaterial({ color: e.element === 'radiant' ? '#ffb347' : '#8b5cf6', transparent: true, opacity: 0.5, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.fromArray(e.center).setY(0.04);
  addFx(m, 0.35);
});
bus.on('status:burst', (e) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(e.radius, 20, 12), new THREE.MeshBasicMaterial({ color: e.cause === 'ignite' ? '#ff7a1a' : '#a970ff', transparent: true, opacity: 0.35, depthWrite: false }));
  m.position.fromArray(e.center).setY(1); addFx(m, 0.3);
});

// ---------------------------------------------------------------- HUD
const hud = document.getElementById('hud');
const flash = document.getElementById('flash');
const abilityBar = document.getElementById('abilities');
const enemyBar = document.getElementById('enemyAbilities');
const log = (msg, color = '#fff') => { flash.textContent = msg; flash.style.color = color; flash.style.opacity = 1; clearTimeout(log.t); log.t = setTimeout(() => (flash.style.opacity = 0), 600); };
bus.on('melee:parry', (e) => log(e.defender === 1 ? 'PERFECT PARRY' : 'PARRIED!', '#ffb347'));
bus.on('melee:perfectBlock', (e) => e.defender === 1 && log('PERFECT BLOCK', '#9fd3ff'));
bus.on('melee:guardBreak', (e) => log(e.defender === 1 ? 'GUARD BROKEN' : 'GUARD BREAK!', '#ff5050'));
bus.on('melee:parryWhiff', (e) => e.id === 1 && log('whiff', '#888'));
// "Near enemy" = an enemy within `r` metres of you: only their tells reach the centre of the screen.
const nearEnemy = (id, r) => { const x = world.entity(id); return x && x.team !== player.team && x.movement.state.position.distanceTo(player.movement.state.position) < r; };
let tellUntil = 0;
bus.on('melee:windup', (e) => { if (nearEnemy(e.id, 6)) { document.getElementById('tell').style.background = e.unblockable ? '#ff3030' : '#ffb347'; tellUntil = performance.now() + e.windup * 1000; } });
bus.on('melee:feint', (e) => nearEnemy(e.id, 8) && log('feint!', '#c9a0ff'));
bus.on('ability:cast', (e) => nearEnemy(e.id, 30) && log(`${fighterName(e.id)}: ${abilityIndex.get(e.ability)?.name.toUpperCase()}`, '#ff5c7a'));
bus.on('ability:interrupted', (e) => (e.id === 1 || nearEnemy(e.id, 40)) && log(e.id === 1 ? 'INTERRUPTED' : 'INTERRUPTED THEM', '#9fd3ff'));

// Killfeed (top right under help) and team score.
const killfeed = document.getElementById('killfeed');
const kills = [];
function pushKill(killer, kTeam, victim, vTeam) {
  const col = (t) => (t === 0 ? '#ffcf6b' : t === 1 ? '#c9a0ff' : '#aaa');
  kills.unshift(`<span style="color:${col(kTeam)}">${killer}</span> ▸ <span style="color:${col(vTeam)}">${victim}</span>`);
  kills.length = Math.min(kills.length, 5);
  killfeed.innerHTML = `<b style="color:#ffcf6b">SOLARI ${score[0]}</b> — <b style="color:#c9a0ff">${score[1]} VOID</b><br>${kills.join('<br>')}`;
}
bus.on('status:applied', (e) => e.id === 1 && log(e.status.toUpperCase(), '#c9a0ff'));
bus.on('status:threshold', (e) => e.to === 'ignite' && log('IGNITE', '#ff7a1a'));
bus.on('weapon:perfectVent', (e) => e.id === 1 && log('PERFECT VENT +15%', '#9fd3ff'));
bus.on('ability:blocked', (e) => e.id === 1 && e.reason === 'silenced' && log('SILENCED', '#888'));

const KEYS = { ability1: 'Q', ability2: 'E', grenade: 'G', super: 'Z' };
function renderAbilityBar(el, ent, showKeys) {
  const snap = ent.abilities.snapshot();
  el.innerHTML = Object.entries(snap).map(([slot, s]) => {
    const name = abilityIndex.get(s.id)?.name ?? s.id;
    const pct = slot === 'super' ? ent.abilities.superEnergy / ent.abilities.superCost : s.ready ? 1 : 1 - s.cooldown / (s.max || 1);
    const label = s.ready ? (showKeys ? KEYS[slot] : '✓') : slot === 'super' ? `${Math.floor(pct * 100)}%` : Math.ceil(s.cooldown);
    return `<div class="ab ${s.ready ? 'ready' : ''} ${ent.status.silenced ? 'locked' : ''}" title="${name}"><div class="fill" style="height:${(pct * 100).toFixed(0)}%"></div><span>${label}</span><small>${name}</small></div>`;
  }).join('');
}

// ---------------------------------------------------------------- loop
// Sword mode: LMB/F/RMB drive melee. Gun mode (1 or D-pad right toggles; 2 cycles guns): LMB fires, RMB aims, R reloads.
const strip = (cmd, keys) => { const c = { ...cmd, buttons: { ...cmd.buttons } }; for (const k of keys) c.buttons[k] = { down: false, pressed: false, released: false }; return c; };
let lastPlayerCmd = null;
const loop = new FixedLoop({
  hz: 60,
  sim(dt, tick) {
    const cmd = input.sample(tick, dt);
    if (cmd.buttons.togglePOV?.pressed) rig.togglePOV();
    if (cmd.buttons.swapShoulder?.pressed) rig.swapShoulder();
    if (cmd.buttons.debugNextKit?.pressed) nextKit();
    if (cmd.buttons.toggleMelee?.pressed) {
      player.mode = player.mode === 'sword' ? 'gun' : 'sword';
      log(player.mode === 'gun' ? player.weapons.current.s.name : sword.name, '#ddd');
    }
    lastPlayerCmd = cmd;
    if (hitStop > 0) { hitStop -= dt; return; }

    animSys.snapshot();
    const pc = player.status.rooted ? strip(cmd, []) : cmd;
    const meleeCmd = player.mode === 'sword' ? pc : strip(pc, ['light', 'heavy', 'guard']);
    const gunCmd = player.mode === 'gun' && !player.status.disarmed ? pc : strip(pc, ['light', 'guard', 'reload', 'swapWeapon']);

    for (const e of entities) { e.status.update(dt); e.health.update(dt); }
    // Movement consumes last tick's speedScale; then it resets and each system re-applies its slow
    // (guard, ADS, casting, Slow status) for the next tick.
    const tickEntity = (e, moveCmd, abCmd, mCmd, gCmd) => {
      e.movement.update(moveCmd, dt);
      e.movement.state.speedScale = e.status.speedMul;
      e.abilities.update(abCmd, dt); e.melee.update(mCmd, dt); if (gCmd) e.weapons.update(gCmd, dt);
    };
    // Revives first (kneel, nothing else), then vehicles: a driver or rider's vehicle consumes the command.
    const kneel = (e, c) => ({ ...c, moveX: 0, moveY: 0, buttons: { interact: c.buttons.interact } });
    if (world.revives.handleInput(player, pc, dt)) { player.movement.kneel(); tickEntity(player, kneel(player, pc), kneel(player, pc), kneel(player, pc), null); }
    else if (world.vehicles.handleInput(player, pc, dt)) player.movement.update(pc, dt);
    else tickEntity(player, pc, pc, meleeCmd, gunCmd);
    // Bots: same pipeline as the player, with the command split between sword and gun by mode.
    for (const b of bots) {
      const bc = b.brain.think(dt, tick);
      if (world.revives.handleInput(b, bc, dt)) { b.movement.kneel(); const k = kneel(b, bc); tickEntity(b, k, k, k, null); continue; }
      if (world.vehicles.handleInput(b, bc, dt)) { b.movement.update(bc, dt); continue; }
      const r = routeCommand(b, b.status.rooted ? strip(bc, []) : bc);
      tickEntity(b, bc, bc, r.meleeCmd, r.gunCmd);
    }
    world.update(dt);
    melee.resolve();
  },
  render(alpha, now) {
    const dt = 1 / 60;
    // Per-fighter look: status readability on the body (blue = i-frames, red = vulnerable,
    // orange = Scorch, violet = Volatile/Weaken, transform auras), flame color with heat.
    for (const e of entities) {
      const s = e.movement.state, st = e.status, tf = e.transform, look = e.look;
      look.status = s.invulnerable ? STATUS_GLOW.iframes : e.melee.vulnerable ? STATUS_GLOW.vulnerable : tf ? STATUS_GLOW[tf.def.aura] ?? null
        : st.has('scorch') ? STATUS_GLOW.scorch : st.has('volatile') || st.has('weaken') ? STATUS_GLOW.weaken : st.silenced ? STATUS_GLOW.silenced : null;
      look.flame.set(e.melee.w.visual?.flameColor ?? (e.team === 0 ? '#ff7a1a' : '#8b5cf6'));
      look.highlight = e === player;
    }
    animSys.update(dt, alpha, rig.camera.position);
    if (performance.now() > tellUntil) document.getElementById('tell').style.background = 'transparent';
    for (const [p, m] of bolts) { if (!p.alive) { scene.remove(m); bolts.delete(p); } else m.position.copy(p.pos); }
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i]; f.life -= dt;
      f.obj.material.opacity = Math.max(0, f.life / f.max) * (f.obj.material.userData.base ??= f.obj.material.opacity);
      if (f.life <= 0) { scene.remove(f.obj); f.obj.geometry.dispose(); fx.splice(i, 1); }
    }

    const ps = player.movement.state;
    const w = player.weapons;
    // HD2 camera: zero-latency look straight from the input (plus recoil), stiff follow, footfall bob, dynamic FOV.
    const pv = player.vehicle?.veh;
    const lookYaw = input.yaw + (player.mode === 'gun' ? w.recoilYaw : 0);
    const lookPitch = Math.max(-1.45, Math.min(1.45, input.pitch + (player.mode === 'gun' ? w.recoilPitch : 0)));
    rig.update(dt, {
      target: player, pos: animSys.record(player.id).root, yaw: lookYaw, pitch: lookPitch,
      ads: player.mode === 'gun' ? w.ads : player.melee.guarding ? 0.3 : 0, adsFov: w.current.s.ads?.fov,
      vehicle: pv ? pv.def.camera : null, scale: silhouetteScale(player),
    });
    // Draw the crowd: full rigs near, reduced mid, capsule impostors far (frustum-culled per fighter).
    crowd.begin(rig.camera);
    for (const r of animSys.list) {
      const e = r.e, s = e.movement.state;
      if (e.vehicle && !e.vehicle.exposed && !e.vehicle.shown) continue;   // inside a hull: unseen (an open car's driver is seen)
      if (r.lod < 2) crowd.drawRig(r.h, e.look, r.lod);
      else crowd.drawImpostor(r.root, { yaw: s.bodyYaw, scale: silhouetteScale(e), height: s.stance === 'crouch' ? 1.2 : 1.8, lying: LYING.has(s.mode) || s.stance === 'prone' || s.downed || s.slide?.kind === 'belly' || e.health.dead }, e.look);
    }
    crowd.end();
    // Shadows follow the player (the shadow camera covers +-30 m).
    const pr = animSys.record(player.id).root;
    sun.position.copy(pr).add(SUN_OFFSET); sun.target.position.copy(pr);
    views.update(dt);
    vehicleViews.update(dt, rig.camera);
    renderer.render(scene, rig.camera);
    audio.update(dt, ps.position, ps.yaw);

    // Focused enemy: the living enemy closest to the centre of the screen within 60 m.
    const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(rig.camera.quaternion);
    let focus = null, bestDot = 0.9;
    for (const b of bots) {
      if (b.team === player.team || b.health.dead) continue;
      const to = b.movement.state.position.clone().setY(b.movement.state.position.y + 1).sub(rig.camera.position);
      const dist = to.length();
      const dot = to.divideScalar(dist).dot(camFwd);
      if (dist < 60 && dot > bestDot) { bestDot = dot; focus = b; }
    }
    const cw = w.current;
    const ammo = cw.usesHeat ? `HEAT ${cw.heat.toFixed(0)}%${w.phase === 'overheated' ? ' OVERHEATED' : w.phase === 'venting' ? ' VENTING (R in window = perfect)' : ''}` : `${cw.mag}/${cw.reserve}${w.phase === 'reloading' ? ' RELOADING' : ''}`;
    const flippedCar = !player.vehicle && world.vehicles.flippedNear(player);
    const near = !player.vehicle && !flippedCar && world.vehicles.nearestEnterable(player);
    const prompt = document.getElementById('prompt');
    prompt.style.display = near || flippedCar ? 'block' : 'none';
    if (flippedCar) prompt.textContent = `Hold X  Push the ${flippedCar.def.name} back over`;
    else if (near) prompt.textContent = `X  Enter ${near.def.name} (${near.seats.find((s) => !s.occupant).def.role})`;
    const vehLine = pv ? (() => {
      const seat = pv.seats[player.vehicle.seat];
      const wpn = seat.weapons?.current;
      const heat = wpn?.usesHeat ? ` · ${wpn.s.name} heat ${wpn.heat.toFixed(0)}%${seat.weapons.phase === 'overheated' ? ' OVERHEATED' : ''}` : wpn?.usesBattery ? ` · ${wpn.s.name} ${wpn.battery.toFixed(0)}%` : '';
      const boost = pv.def.boost ? ` · boost ${pv.boostTime > 0 ? 'ACTIVE' : pv.boostCd > 0 ? pv.boostCd.toFixed(1) + 's' : 'READY (Shift)'}` : '';
      const alt = pv.def.model === 'flyer' ? ` · alt ${pv.altitude.toFixed(0)} m (Space/C)` : '';
      return `<span style="color:#9fd3ff"><b>${pv.def.name}</b> [${seat.def.role}] HP ${pv.health.hp.toFixed(0)}/${pv.health.max}${heat}${boost}${alt}${pv.status.silenced ? ' <b>EMP</b>' : ''} · ${Math.hypot(pv.movement.state.velocity.x, pv.movement.state.velocity.z).toFixed(0)} m/s · X exit</span><br>`;
    })() : '';
    hud.innerHTML = `${vehLine}
      <b>${ps.mode}</b> / ${ps.stance} · ${Math.hypot(ps.velocity.x, ps.velocity.z).toFixed(1)} m/s<br>
      HP ${player.health.hp.toFixed(0)} · SH ${player.health.shield.toFixed(0)} · STA ${ps.stamina.toFixed(0)} · statuses: ${[...player.status.active.keys()].join(', ') || '-'}<br>
      ${player.mode === 'gun' ? `<b>${cw.s.name}</b> ${ammo}` : `SWORD heat ${player.melee.heat.toFixed(0)}${player.melee.overheated > 0 ? ' OVERHEAT' : ''} · guard ${player.melee.guardMeter.toFixed(0)} · ${player.melee.phase} ${player.melee.counterWindow > 0 ? '<span style="color:#ffb347">COUNTER!</span>' : ''}`}<br>
      ${player.transform ? `<span style="color:#ffcf6b"><b>SUPER: ${abilityIndex.get(player.transform.ability)?.name}</b> ${Math.max(0, (player.abilities.slots.super.stats.duration ?? 0) - player.abilities.slots.super.phaseTime).toFixed(1)}s${player.weapons.current.s.id.startsWith('super_') ? ` · ammo ${player.weapons.current.usesBattery ? player.weapons.current.battery.toFixed(0) + '%' : player.weapons.current.mag}` : ''}${player.transform.def.frameHp ? ` · frame ${player.health.overshield.toFixed(0)}` : ''}</span><br>` : ''}
      ${focus ? `<span style="color:#ff8fa3">${focus.name}${focus.vehicle ? ` (in ${focus.vehicle.veh.def.name})` : ''} HP ${focus.health.hp.toFixed(0)}${focus.transform ? ' <b>SUPER ACTIVE</b>' : ''} · ${[...focus.status.active.keys()].join(', ')}</span>` : ''}`;
    renderAbilityBar(abilityBar, player, true);
    // Deadlock-style: the cooldowns of the enemy under your crosshair are visible.
    if (focus) renderAbilityBar(enemyBar, focus, false); else enemyBar.innerHTML = '';
    document.getElementById('crosshair').style.display = player.mode === 'gun' ? 'block' : 'none';
  },
});
kitIndex = (kitIndex - 1 + kitOrder.length) % kitOrder.length; nextKit(); // show the starting kit
window.__emberfall = { world, player, bots, rig, animSys, crowd }; // dev console handle (and for automated smoke tests)
loop.start();
