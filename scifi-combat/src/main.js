// Graybox duel: player (Solari Dawnblade) vs. one Void Ashsworn bot on flat ground with vault boxes.
// Demonstrates the full loop: Input → fixed-step sim (movement + melee + guns + abilities + statuses)
// → events → camera/juice/audio/HUD.
// Run: `npx serve scifi-combat` (or any static server) and open index.html.

import * as THREE from 'three';
import { bus } from './core/EventBus.js';
import { FixedLoop } from './core/FixedLoop.js';
import { InputManager } from './input/InputManager.js';
import { MovementController, FlatGroundBody } from './movement/MovementController.js';
import { MeleeComponent, MeleeSystem } from './combat/melee/MeleeSystem.js';
import { WeaponComponent, WeaponInstance, ProjectileSystem } from './combat/weapons/WeaponSystem.js';
import { buildWeapon } from './combat/weapons/WeaponDefs.js';
import { AbilityComponent } from './combat/AbilitySystem.js';
import { StatusComponent } from './combat/StatusSystem.js';
import { Health } from './combat/Health.js';
import { CameraRig } from './camera/CameraRig.js';
import { MeleeDuelistBrain } from './ai/MeleeDuelistBrain.js';
import { AudioDirector, SynthBackend } from './audio/AudioDirector.js';

const load = (p) => fetch(`./data/${p}`).then((r) => r.json());
const [movementTuning, meleeData, ballistic, energy, attachments, recoil, damage, statuses, solariKits, voidKits] = await Promise.all([
  load('movement.json'), load('weapons/melee.json'), load('weapons/ballistic.json'), load('weapons/energy.json'),
  load('weapons/attachments.json'), load('weapons/recoil.json'), load('damage-matrix.json'),
  load('abilities/statuses.json'), load('abilities/solari.json'), load('abilities/void.json'),
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

// ---------------------------------------------------------------- world (sim queries)
const entities = [];
const _oc = new THREE.Vector3();
const world = {
  damageMatrix: damage.matrix,
  entity: (id) => entities.find((e) => e.id === id),
  /** Ray vs. entity capsules (approximated as head + body spheres) and static boxes. */
  raycast(o, d, max, ignoreId) {
    let best = null;
    for (const e of entities) {
      if (e.id === ignoreId || e.health.dead) continue;
      for (const [y, r, zone] of [[1.65, 0.22, 'head'], [1.1, 0.42, 'body'], [0.5, 0.35, 'limb']]) {
        _oc.copy(e.movement.state.position); _oc.y += y; _oc.sub(o);
        const t = _oc.dot(d);
        if (t < 0 || t > max) continue;
        if (_oc.lengthSq() - t * t < r * r && (!best || t < best.distance)) best = { entity: e, distance: t, point: o.clone().addScaledVector(d, t), zone };
      }
    }
    const ray = new THREE.Ray(o, d), box = new THREE.Box3(), pt = new THREE.Vector3();
    for (const b of boxes) {
      box.set(b.min, b.max);
      if (ray.intersectBox(box, pt)) { const t = pt.distanceTo(o); if (t <= max && (!best || t < best.distance)) best = { entity: null, distance: t, point: pt.clone(), normal: new THREE.Vector3(0, 1, 0), surface: 'metal' }; }
    }
    if (d.y < 0) { const t = -o.y / d.y; if (t <= max && (!best || t < best.distance)) best = { entity: null, distance: t, point: o.clone().addScaledVector(d, t), normal: new THREE.Vector3(0, 1, 0), surface: 'concrete' }; }
    return best;
  },
  entitiesInRadius: (p, r) => entities.filter((e) => !e.health.dead && e.movement.state.position.distanceTo(p) <= r),
  entitiesInShape(s, o, d) {
    const f = d.clone().setY(0).normalize();
    return entities.filter((e) => {
      const v = e.movement.state.position.clone().sub(o).setY(0);
      const t = v.dot(f);
      if (s.kind === 'cone') return t > 0 && v.length() < s.length && v.normalize().dot(f) > Math.cos((s.angle * Math.PI) / 360);
      return t > 0 && t < s.length && v.addScaledVector(f, -t).length() < (s.width ?? 2) / 2 + 0.4;
    });
  },
  spawnProjectile: (spec) => projectiles.spawn(spec),
  spawnZone: (z) => bus.emit('demo:zone', z),
  spawnDeployable: (d) => bus.emit('demo:deployable', d),
};
const projectiles = new ProjectileSystem(world);

// ---------------------------------------------------------------- entities
function makeFighter(id, team, color, pos, kit, guns) {
  const body = new FlatGroundBody(pos, boxes);
  const movement = new MovementController(movementTuning, body, {}, id);
  movement.state.position.copy(pos);
  const ent = { id, team, movement, mode: 'sword' };
  ent.health = new Health(ent, { health: 140, shield: 60, armor: 'plate' });
  ent.status = new StatusComponent(ent, statuses.statuses, world);
  ent.melee = new MeleeComponent(sword, ent);
  ent.weapons = new WeaponComponent(ent, guns.map((g) => new WeaponInstance(g, recoil.patterns)), world);
  ent.abilities = new AbilityComponent(ent, kit, world);

  // Graybox visual: capsule plus an emissive "blade" that glows with heat.
  const mesh = new THREE.Group();
  const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 4, 12), new THREE.MeshStandardMaterial({ color }));
  capsule.position.y = 0.9; capsule.castShadow = true;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.2), new THREE.MeshStandardMaterial({ color: '#ff8a3d', emissive: team === 0 ? '#ff5a00' : '#7a2cff', emissiveIntensity: 1.5 }));
  blade.position.set(0.45, 1.1, -0.6);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.7), new THREE.MeshStandardMaterial({ color: '#222' }));
  gun.position.set(0.35, 1.3, -0.4); gun.visible = false;
  mesh.add(capsule, blade, gun);
  scene.add(mesh);
  ent.view = { mesh, capsule, blade, gun, prev: pos.clone() };
  entities.push(ent);
  return ent;
}

const playerGuns = [
  buildWeapon(ballistic, 'sol_ar_halcyon', attachments.attachments, ['optic_holo', 'ub_grip']),
  buildWeapon(energy, 'sol_pr_aurora', attachments.attachments, []),
];
const player = makeFighter(1, 0, '#d9a441', new THREE.Vector3(0, 0, 0), solariKits.kits.dawnblade, playerGuns);
const bot = makeFighter(2, 1, '#6b3fa0', new THREE.Vector3(0, 0, -5), voidKits.kits.ashsworn, [buildWeapon(ballistic, 'void_sg_maw', attachments.attachments, [])]);
const melee = new MeleeSystem();
melee.add(player.melee); melee.add(bot.melee);

const brain = new MeleeDuelistBrain(bot, { aggression: 0.65, parrySkill: 0.45, reactionTime: 0.28, feintRate: 0.3 });
brain.target = player;
bus.on('melee:windup', (e) => brain.observeWindup(e));
bus.on('melee:parry', (e) => brain.observeParried(e));
// Respawn for the demo.
bus.on('entity:death', (e) => setTimeout(() => { const x = world.entity(e.id); x?.health.revive(1); x?.status.cleanse(); }, 1500));

// ---------------------------------------------------------------- systems
const input = new InputManager(renderer.domElement);
const rig = new CameraRig({ collidables });
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  rig.camera.aspect = innerWidth / innerHeight; rig.camera.updateProjectionMatrix();
});

// Audio needs a user gesture before an AudioContext can start.
let audio = null;
renderer.domElement.addEventListener('mousedown', () => {
  if (audio) return;
  audio = new AudioDirector(new SynthBackend(), {
    listenerId: 1, abilityIndex,
    getEntity: (id) => { const e = world.entity(id); return e && { team: e.team, position: e.movement.state.position }; },
    onSuperWarning: ({ ability }) => log(`ENEMY SUPER: ${abilityIndex.get(ability)?.name ?? ability}`, '#c9a0ff'),
  });
}, { once: false });

// Hit-stop: freeze the sim for a few ticks on impactful events (offline only; see ARCHITECTURE §2).
let hitStop = 0;
for (const ev of ['melee:parry', 'melee:hit', 'melee:perfectBlock', 'melee:block']) {
  bus.on(ev, (e) => { hitStop = Math.max(hitStop, e.hitStop ?? 0); if (e.defender === 2 || e.attacker === 2) input.rumble(0.6, 0.4, 90); });
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
bus.on('melee:windup', (e) => { if (e.id === 2) document.getElementById('tell').style.background = e.unblockable ? '#ff3030' : '#ffb347'; });
bus.on('melee:feint', (e) => e.id === 2 && log('feint!', '#c9a0ff'));
bus.on('ability:cast', (e) => e.id === 2 && log(abilityIndex.get(e.ability)?.name.toUpperCase(), '#ff5c7a'));
bus.on('ability:interrupted', (e) => log(e.id === 2 ? 'INTERRUPTED THEM' : 'INTERRUPTED', '#9fd3ff'));
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
    if (cmd.buttons.toggleMelee?.pressed) {
      player.mode = player.mode === 'sword' ? 'gun' : 'sword';
      log(player.mode === 'gun' ? player.weapons.current.s.name : sword.name, '#ddd');
    }
    lastPlayerCmd = cmd;
    if (hitStop > 0) { hitStop -= dt; return; }

    for (const e of entities) e.view.prev.copy(e.movement.state.position);
    const botCmd = brain.think(dt, tick);
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
    tickEntity(player, pc, pc, meleeCmd, gunCmd);
    tickEntity(bot, botCmd, botCmd, botCmd, null);
    projectiles.update(dt);
    melee.resolve();
  },
  render(alpha, now) {
    const dt = 1 / 60;
    for (const e of entities) {
      const s = e.movement.state;
      e.view.mesh.visible = !e.health.dead;
      e.view.mesh.position.lerpVectors(e.view.prev, s.position, alpha);
      e.view.mesh.rotation.y = s.yaw;
      // Stance squash as a stand-in for animation.
      const h = s.mode === 'slide' ? 0.5 : s.stance === 'crouch' ? 0.65 : s.stance === 'prone' ? 0.3 : 1;
      e.view.capsule.scale.y = THREE.MathUtils.damp(e.view.capsule.scale.y, h, 18, dt);
      const m = e.melee;
      e.view.blade.visible = e.mode !== 'gun';
      e.view.gun.visible = e.mode === 'gun';
      e.view.blade.material.emissiveIntensity = 1 + (m.heat / 100) * 4 + (m.phase === 'active' ? 3 : 0);
      e.view.blade.rotation.x = m.phase === 'guard' ? -1.2 : m.phase === 'windup' ? 0.8 : m.phase === 'active' ? -0.6 : 0;
      // Status readability on the body: blue = i-frames, red = vulnerable, orange = Scorch, violet = Volatile/Weaken.
      const st = e.status;
      e.view.capsule.material.emissive?.set(s.invulnerable ? '#3355ff' : m.vulnerable ? '#ff2222' : st.has('scorch') ? '#7a2a00' : st.has('volatile') || st.has('weaken') ? '#3a1466' : st.silenced ? '#444' : '#000000');
    }
    if (bot.melee.phase !== 'windup') document.getElementById('tell').style.background = 'transparent';
    for (const [p, m] of bolts) { if (!p.alive) { scene.remove(m); bolts.delete(p); } else m.position.copy(p.pos); }
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i]; f.life -= dt;
      f.obj.material.opacity = Math.max(0, f.life / f.max) * (f.obj.material.userData.base ??= f.obj.material.opacity);
      if (f.life <= 0) { scene.remove(f.obj); f.obj.geometry.dispose(); fx.splice(i, 1); }
    }

    const ps = player.movement.state;
    const w = player.weapons;
    const eye = ps.mode === 'slide' ? 0.8 : ps.stance === 'crouch' ? 1.05 : ps.stance === 'prone' ? 0.4 : 1.65;
    // In gun mode the camera renders the recoil-offset aim, so what you see is where shots go.
    const pitch = player.mode === 'gun' ? w.aimPitch : lastPlayerCmd?.pitch ?? 0;
    const view = { ...ps, position: player.view.mesh.position, yaw: player.mode === 'gun' ? w.aimYaw : ps.yaw };
    rig.update(dt, view, pitch, eye, player.mode === 'gun' ? w.ads > 0.5 : player.melee.guarding);
    renderer.render(scene, rig.camera);
    audio?.update(dt, rig.camera.position, ps.yaw);

    const cw = w.current;
    const ammo = cw.usesHeat ? `HEAT ${cw.heat.toFixed(0)}%${w.phase === 'overheated' ? ' OVERHEATED' : w.phase === 'venting' ? ' VENTING (R in window = perfect)' : ''}` : `${cw.mag}/${cw.reserve}${w.phase === 'reloading' ? ' RELOADING' : ''}`;
    hud.innerHTML = `
      <b>${ps.mode}</b> / ${ps.stance} · ${Math.hypot(ps.velocity.x, ps.velocity.z).toFixed(1)} m/s<br>
      HP ${player.health.hp.toFixed(0)} · SH ${player.health.shield.toFixed(0)} · STA ${ps.stamina.toFixed(0)} · statuses: ${[...player.status.active.keys()].join(', ') || '-'}<br>
      ${player.mode === 'gun' ? `<b>${cw.s.name}</b> ${ammo}` : `SWORD heat ${player.melee.heat.toFixed(0)}${player.melee.overheated > 0 ? ' OVERHEAT' : ''} · guard ${player.melee.guardMeter.toFixed(0)} · ${player.melee.phase} ${player.melee.counterWindow > 0 ? '<span style="color:#ffb347">COUNTER!</span>' : ''}`}<br>
      Bot HP ${bot.health.hp.toFixed(0)} SH ${bot.health.shield.toFixed(0)} · ${bot.melee.phase} · ${[...bot.status.active.keys()].join(', ')}`;
    renderAbilityBar(abilityBar, player, true);
    renderAbilityBar(enemyBar, bot, false); // Deadlock-style: enemy cooldowns are visible
    document.getElementById('crosshair').style.display = player.mode === 'gun' ? 'block' : 'none';
  },
});
loop.start();
