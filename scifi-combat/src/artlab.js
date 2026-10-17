// Art lab: every piece of the art direction in isolation, to build it and screenshot it
// (docs/ART_DIRECTION.md). ?station=palette|sky|troopers|vehicles|cars|scene|stratagems|gunfx|melee &view=...
// window.__art = { ready, station, view(name) } for automated captures.

import * as THREE from 'three';
import { Atmosphere, installFog } from './render/Atmosphere.js';
import { PostFX } from './render/PostFX.js';
import { groundDetailTexture, groundMaterial } from './render/ArtTextures.js';
import { ScorchField } from './render/ScorchField.js';
import { TerrainChunks } from './render/TerrainChunks.js';
import { sandbagTexture, concreteTexture, woodTexture, metalTexture, triplanar } from './render/CoverTextures.js';
import { Terrain } from './world/Terrain.js';
import { CombatWorld } from './combat/CombatWorld.js';
import { buildFighter } from './game/FighterFactory.js';
import { routeCommand } from './core/routing.js';
import { AnimationSystem } from './anim/AnimationSystem.js';
import { CrowdRenderer } from './render/CrowdRenderer.js';
import { SandbagTops } from './render/SandbagTops.js';
import { BattleFx } from './vfx/BattleFx.js';
import { kitFor } from './render/TrooperKit.js';
import { vehicleModel } from './render/VehicleKit.js';
import { paintMaterial } from './render/TrooperMaterial.js';
import { StratagemViews } from './vfx/StratagemViews.js';
import { StratagemPanel } from './ui/StratagemPanel.js';
import { GunFx } from './vfx/GunFx.js';
import { VehicleViews } from './vfx/VehicleViews.js';
import { BASH } from './combat/melee/MeleeSystem.js';
import { meleeWeapon } from './combat/melee/MeleeWeapons.js';
import { bus } from './core/EventBus.js';

const params = new URLSearchParams(location.search);
const station = params.get('station') ?? 'sky';
const palette = await fetch('./data/art/palette.json').then((r) => r.json());
const planet = palette.planets[params.get('planet') ?? 'scorched'];
const STATIONS = ['palette', 'sky', 'troopers', 'vehicles', 'cars', 'scene', 'stratagems', 'gunfx', 'melee'];

const bar = document.getElementById('bar'), note = document.getElementById('note');
for (const s of STATIONS) {
  const b = document.createElement('button');
  b.textContent = s; if (s === station) b.className = 'on';
  b.onclick = () => { location.search = `?station=${s}`; };
  bar.appendChild(b);
}
window.__art = { ready: false, station };
const tickers = [];   // per-frame updates of a station's moving parts

if (station === 'palette') {
  paletteSheet();
} else {
  await scene3d();
}

// ---------------------------------------------------------------- palette sheet
function paletteSheet() {
  const el = document.getElementById('sheet');
  el.style.display = 'block';
  const sw = (name, hex) => `<div class="sw"><i style="background:${hex}"></i><b>${name}</b><small>${hex}</small></div>`;
  const group = (title, obj, skip = []) => `<h2>${title}</h2><div class="row">${Object.entries(obj).filter(([k, v]) => typeof v === 'string' && v.startsWith('#') && !skip.includes(k)).map(([k, v]) => sw(k, v)).join('')}</div>`;
  const P = planet;
  el.innerHTML = `<h1>Emberfall · Art direction palette</h1><div style="color:#a9a49a">Helldivers 2's look, our own designs · planet preset: ${P.name}</div>
    <h2>Sky (zenith → horizon → below)</h2>
    <div class="grad" style="background:linear-gradient(to bottom, ${P.sky.zenith}, ${P.sky.upper} 45%, ${P.sky.horizon} 78%, ${P.fog.color} 88%, ${P.sky.below})"></div>
    <div class="row">${sw('zenith', P.sky.zenith)}${sw('upper', P.sky.upper)}${sw('horizon', P.sky.horizon)}${sw('haze', P.sky.haze)}${sw('streaks', P.sky.streaks)}${sw('below', P.sky.below)}</div>
    <h2>Sun, moon, fog, fill</h2>
    <div class="row">${sw('sun', P.sun.color)}${sw('sun disk', P.sun.disk)}${sw('sun halo', P.sun.halo)}${sw('moon', P.moon.color)}${sw('moon shade', P.moon.shade)}${sw('ring', P.moon.ring)}${sw('fog', P.fog.color)}${sw('fog toward sun', P.fog.sunColor)}${sw('fill sky', P.fill.sky)}${sw('fill ground', P.fill.ground)}${sw('bounce', P.fill.bounce)}</div>
    ${group('Ground', P.ground)}
    <h2>Solari Shock Troopers</h2><div class="row">${Object.entries(palette.factions.solari).filter(([, v]) => v.startsWith?.('#')).map(([k, v]) => sw(k, v)).join('')}</div>
    <h2>Void Legion</h2><div class="row">${Object.entries(palette.factions.void).filter(([, v]) => v.startsWith?.('#')).map(([k, v]) => sw(k, v)).join('')}</div>
    ${group('Materials', palette.materials)}
    ${group('Effects', palette.vfx)}
    <h2>Interface</h2><div class="row">${Object.entries(palette.ui).map(([k, v]) => sw(k, v)).join('')}</div>`;
  window.__art.ready = true;
}

// ---------------------------------------------------------------- 3D stations
async function scene3d() {
  installFog(planet);
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const atmo = new Atmosphere(scene, planet, { radius: 1100, shadowBox: 40, renderer });
  const post = new PostFX(renderer, planet.post, { quality: params.get('fx') === 'low' ? 'low' : 'high' });
  if (params.get('post') === 'off') post.enabled = false;
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 1500);
  window.__art.camera = camera;
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); post.setSize(innerWidth, innerHeight); });

  const views = {};
  let focus = new THREE.Vector3();
  if (station === 'sky') skyStation(scene, views, atmo);
  if (station === 'troopers') await troopersStation(scene, views, atmo);
  if (station === 'vehicles') await vehiclesStation(scene, views, atmo);
  if (station === 'cars') await carsStation(scene, views, atmo);
  if (station === 'scene') await sceneStation(scene, views, atmo);
  if (station === 'stratagems') await stratagemsStation(scene, views, atmo);
  if (station === 'gunfx') await gunfxStation(scene, views, atmo);
  if (station === 'melee') await meleeStation(scene, views, atmo);
  const viewNames = Object.keys(views);
  let view = params.get('view') ?? viewNames[0];
  const setView = (name) => {
    view = name; const v = views[name]; if (!v) return;
    camera.position.copy(v.pos); camera.lookAt(v.look); camera.fov = v.fov ?? 55; camera.updateProjectionMatrix();
    v.enter?.();
    focus = v.focus ?? v.look;
    note.textContent = `${station} · ${name}${v.note ? ' · ' + v.note : ''}`;
  };
  for (const n of viewNames) {
    const b = document.createElement('button'); b.textContent = n;
    b.onclick = () => { setView(n); for (const x of bar.querySelectorAll('button.v')) x.classList.toggle('on', x.textContent === n); };
    b.className = 'v' + (n === view ? ' on' : ''); bar.appendChild(b);
  }
  setView(view);
  const sun = new THREE.Vector3();
  let last = performance.now();
  const frame = () => {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    atmo.update(dt, camera, focus);
    for (const f of tickers) f(dt);
    post.render(scene, camera, atmo.sunScreen(camera, sun), dt);
    requestAnimationFrame(frame);
  };
  frame();
  Object.assign(window.__art, { ready: true, view: (n) => setView(n), renderer, scene, camera, atmo, post });
  window.__art.camera = camera;
}

// The sky, sun, fog, light and ash over a stretch of scorched ground (real terrain, craters, a
// trench, scorch), with things at known distances to judge fog, shadows and the god rays.
function skyStation(scene, views, atmo) {
  const t = Terrain.generate({ seed: 5, amp: 4, rough: 0.6, berm: 0, minX: -500, minZ: -900, width: 1000, depth: 1000, res: 1 });
  const scorch = new ScorchField({ minX: t.minX, minZ: t.minZ, width: t.width, depth: t.depth });
  const flatAt = (x, z, r) => t.flatten(x, z, r);
  flatAt(0, 0, 30);
  // Shell holes, old and fresh, and a stretch of trench.
  let s = 7;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 70; i++) {
    const x = (rnd() - 0.5) * 300, z = -20 - rnd() * 380, r = 1.5 + rnd() * 3.5;
    t.carveDisc(x, z, r, r * 0.35, 0.4);
    scorch.stamp(x, z, r * 1.2, rnd() < 0.2 ? 1 : 0.3 + rnd() * 0.2);   // a few fresh, most old (ash rims)
  }
  t.carveLevel(-40, 8, 40, 10, 1.6);
  const chunks = new TerrainChunks(scene, t, { material: groundMaterial(groundDetailTexture()), ground: planet.ground, scorch: (x, z) => scorch.at(x, z) });
  tickers.push(() => chunks.update(window.__art.camera?.position ?? new THREE.Vector3()));
  window.__art.ground = (x, z) => t.height(x, z);
  const M = palette.materials;
  const sand = triplanar(new THREE.MeshStandardMaterial({ color: M.sandbag, roughness: 1 }), sandbagTexture(), 1, 1.4);
  const conc = triplanar(new THREE.MeshStandardMaterial({ color: M.concrete, roughness: 0.92 }), concreteTexture(), 0.25, 0.6);
  const timber = triplanar(new THREE.MeshStandardMaterial({ color: M.timber, roughness: 0.9 }), woodTexture(), 0.6, 0.8);
  const steel = triplanar(new THREE.MeshStandardMaterial({ color: M.gunmetal, roughness: 0.55, metalness: 0.5 }), metalTexture(), 0.25, 0.5);
  const box = (x, z, w, h, d, m, sink = 0.1) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, t.height(x, z) + h / 2 - sink, z); b.castShadow = b.receiveShadow = true; scene.add(b); return b; };
  // Sandbag parapets along both lips of the trench, revetment posts, a bunker, wreckage, ruins out to 900 m.
  for (let i = 0; i < 26; i++) { box(-38 + i * 3, 6.3, 2.9, 1.0, 0.9, sand); box(-38 + i * 3, 11.8, 2.9, 0.8, 0.9, sand); }
  for (let i = 0; i < 6; i++) box(-14 + i * 5, -22, 0.25, 4 + (i % 3), 0.25, timber);
  box(16, -30, 8, 3.2, 6, conc); box(-20, -55, 7, 2.6, 4, steel);
  for (const [x, z, h] of [[-60, -140, 14], [40, -220, 22], [-150, -380, 30], [120, -600, 40], [-260, -880, 60]]) box(x, z, 18, h, 18, conc);
  // Sun-side props so the god rays have something to cut through.
  const sd = atmo.sunDir, side = Math.atan2(sd.z, sd.x) + Math.PI / 2;
  for (let i = 0; i < 9; i++) { const a = (i - 4) * 4; box(sd.x * 60 + Math.cos(side) * a, sd.z * 60 + Math.sin(side) * a, 0.4, 8 + (i % 4) * 3, 0.4, timber); }
  const toward = (dir, dist, up = 1.7) => new THREE.Vector3(dir.x * dist, up + dir.y * dist, dir.z * dist);
  const flat = (d) => new THREE.Vector3(d.x, 0, d.z).normalize();
  const sf = flat(atmo.sunDir), mf = flat(atmo.moonDir);
  const y = (x, z, up) => new THREE.Vector3(x, t.height(x, z) + up, z);
  views.sun = { pos: y(-sf.x * 8, -sf.z * 8, 1.7), look: toward(atmo.sunDir, 100, 1.7 + t.height(0, 0)), note: 'looking into the sun: halo, god rays through the posts' };
  views.away = { pos: y(4, -8, 1.8), look: y(4 - sf.x * 100, -8 - sf.z * 100, 4), note: 'sun behind: lit faces, long shadows, fog depth' };
  views.moon = { pos: y(0, 0, 1.7), look: toward(atmo.moonDir, 100, 1.7 + t.height(0, 0)), fov: 50, note: 'the ringed moon and smoke columns' };
  views.wide = { pos: y(10, 20, 12), look: y(-20, -120, 0), fov: 65, note: 'craters, scorch and fog out to 900 m' };
  views.trench = { pos: y(-30, 18, 2.2), look: y(10, 4, -0.5), fov: 60, note: 'trench, sandbags and timber up close' };
  views.ground = { pos: y(4, -40, 1.6), look: y(10, -52, 0), fov: 60, note: 'ground detail: cracked plates, pebbles, scorched craters' };
  views.up = { pos: y(0, 0, 1.7), look: y(0.2, -6, 10), fov: 80, note: 'the upper sky and streaks' };
}

// A stretch of scorched ground (shared by the stations).
function scorchedGround(scene, { seed = 5, amp = 4, size = 1000, z0 = -900, flat = [[0, 0, 30]], craters = 70, spread = [300, 380] } = {}) {
  const t = Terrain.generate({ seed, amp, rough: 0.6, berm: 0, minX: -size / 2, minZ: z0, width: size, depth: size, res: 1 });
  const scorch = new ScorchField({ minX: t.minX, minZ: t.minZ, width: t.width, depth: t.depth });
  for (const [x, z, r] of flat) t.flatten(x, z, r);
  let s = 7;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < craters; i++) {
    const x = (rnd() - 0.5) * spread[0], z = -20 - rnd() * spread[1], r = 1.5 + rnd() * 3.5;
    t.carveDisc(x, z, r, r * 0.35, 0.4);
    scorch.stamp(x, z, r * 1.2, rnd() < 0.2 ? 1 : 0.3 + rnd() * 0.2);   // a few fresh, most old (ash rims)
  }
  const chunks = new TerrainChunks(scene, t, { material: groundMaterial(groundDetailTexture()), ground: planet.ground, scorch: (x, z) => scorch.at(x, z) });
  tickers.push(() => chunks.update(window.__art.camera?.position ?? new THREE.Vector3()));
  window.__art.ground = (x, z) => t.height(x, z);
  return { t, scorch, chunks };
}

// Both armies' troopers in their kits, posed by the real rig, on scorched ground under the
// scorched sky: the lineups by role, the three weights, helmets up close, capes from behind, and
// a squad in combat poses.
/**
 * Fighters for a station: the real sim and rig (buildFighter, AnimationSystem) on terrain `t`,
 * drawn by the CrowdRenderer in their role's kit. add(classId, team, pos, yaw, act) where act is
 * stand | aim | crouch | prone | blade; start() settles the poses and keeps them breathing.
 */
async function fighters(scene, t, { max = 64, stratagems = null } = {}) {
  const load = (p) => fetch(`./data/${p}`).then((r) => r.json());
  const [movement, melee, ballistic, energy, attachments, recoil, damage, statuses, solariKits, voidKits, supers, vehicles, solari, voidC, humanoid, table, down] = await Promise.all([
    load('movement.json'), load('weapons/melee.json'), load('weapons/ballistic.json'), load('weapons/energy.json'),
    load('weapons/attachments.json'), load('weapons/recoil.json'), load('damage-matrix.json'), load('abilities/statuses.json'),
    load('abilities/solari.json'), load('abilities/void.json'), load('supers.json'), load('vehicles.json'),
    load('classes/solari.json'), load('classes/void.json'), load('animation/humanoid.json'), load('art/troopers.json'), load('down.json'),
  ]);
  const data = {
    movement, weaponFiles: [ballistic, energy], attachments: attachments.attachments, recoil: recoil.patterns, statuses: statuses.statuses,
    meleeWeapons: melee.weapons, kits: { ...solariKits.kits, ...voidKits.kits }, classes: [solari, voidC], down,
  };
  const world = new CombatWorld({ damageMatrix: damage.matrix, cover: [], supers, meleeWeapons: melee.weapons, recoilDefs: recoil.patterns, vehicleDefs: vehicles, statusDefs: statuses.statuses, terrain: t, stratagems });
  const anim = new AnimationSystem(humanoid, { getEntity: (id) => world.entity(id), surfaceAt: () => 'dirt', groundY: (x, z) => t.height(x, z) });
  const crowd = new CrowdRenderer(scene, { max, palette, nearDist: params.get('lod') === 'mid' ? 0 : 80 });
  window.__art.crowd = crowd;
  const people = [];
  let id = 1;
  const add = (classId, team, pos, yaw, act = 'stand', extra = {}) => {
    const e = buildFighter(world, data, { id: id++, team, classId, pos: pos.clone().setY(t.height(pos.x, pos.z) + 0.05) });
    e.mode = act === 'blade' ? 'sword' : 'gun';
    e.health.damage = () => ({});
    e.look = { team, status: null, flame: new THREE.Color(team ? '#8b5cf6' : '#ff7a1a'), highlight: false, kit: kitFor(table, e.role), number: (e.id * 37 + 11) % 100, ...extra };
    anim.add(e);
    people.push({ e, yaw, act, t: 0, pitch: extra.pitch ?? 0 });
    return e;
  };
  const DT = 1 / 60;
  const tick = () => {
    anim.snapshot();
    for (const p of people) {
      const e = p.e, held = new Set(), pressed = new Set();
      if (p.act === 'aim') held.add('guard');
      if (p.act === 'crouch' && p.t < 0.05) pressed.add('crouch');
      if (p.act === 'prone' && p.t < 0.7) held.add('crouch');
      const cmd = { moveX: 0, moveY: 0, yaw: p.yaw, pitch: p.act === 'aim' ? 0.04 + p.pitch : p.pitch, buttons: {} };
      for (const k of new Set([...held, ...pressed])) cmd.buttons[k] = { down: true, pressed: pressed.has(k) || (held.has(k) && p.t < DT * 1.5), released: false };
      p.t += DT;
      e.status.update(DT); e.health.update(DT);
      e.movement.update(cmd, DT);
      const r = routeCommand(e, cmd);
      e.abilities.update(cmd, DT); e.melee.update(r.meleeCmd, DT); e.weapons.update(r.gunCmd, DT);
    }
    world.update(DT);
  };
  const draw = () => {
    const cam = window.__art.camera;
    anim.update(DT, 1, cam.position);
    crowd.begin(cam);
    for (const r of anim.list) r.lod < 2 ? crowd.drawRig(r.h, r.e.look, 0) : crowd.drawImpostor(r.root, { yaw: r.e.movement.state.bodyYaw, height: 1.8 }, r.e.look);
    crowd.end();
  };
  const ctl = { paused: false };              // paused: the moment held still (the rigs keep drawing)
  const start = () => {
    for (let i = 0; i < 150; i++) tick();     // settle into the poses (and let the capes hang)
    for (let i = 0; i < 30; i++) { tick(); anim.update(DT, 1, new THREE.Vector3()); }
    tickers.push(() => { if (!ctl.paused) tick(); draw(); });
    window.__art.people = people;
  };
  return { add, start, world, people, tick, anim, ctl, meleeWeapons: melee.weapons };
}

async function troopersStation(scene, views, atmo) {
  const { t } = scorchedGround(scene, { seed: 11, amp: 1.2, size: 400, z0: -200, flat: [[0, 0, 40]], craters: 30, spread: [300, 160] });
  const { add, start } = await fighters(scene, t);

  // Lighting the troopers 3/4 from the front: they face 35° off the sun.
  const camAz = (planet.sun.azimuth - 35) * Math.PI / 180;
  const fwd = new THREE.Vector3(Math.sin(camAz), 0, -Math.cos(camAz)), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const facing = Math.atan2(-fwd.x, -fwd.z);
  const at = (a, f = 0) => new THREE.Vector3().addScaledVector(right, a).addScaledVector(fwd, f);
  const SOL = ['lancer', 'artificer', 'lumen', 'veil', 'seraph', 'skyrider', 'prism_adept', 'bastion', 'dawnblade', 'breacher'];
  const VOI = ['reaver', 'rigger', 'mender', 'wraith', 'hollow_eye', 'driftcaller', 'psion', 'monolith', 'ashsworn', 'riftbreaker'];
  // Row 1 (z 0): Solari by role; row 2 (8 m behind): Void by role.
  SOL.forEach((c, i) => add(c, 0, at((i - 4.5) * 1.35, 0), facing));
  VOI.forEach((c, i) => add(c, 1, at((i - 4.5) * 1.35, -8), facing));
  // The weights, side by side (light, medium, heavy; Solari then Void), 20 m to the right.
  ['veil', 'lancer', 'bastion'].forEach((c, i) => add(c, 0, at(20 + i * 1.2, 0), facing));
  ['wraith', 'reaver', 'monolith'].forEach((c, i) => add(c, 1, at(23.8 + i * 1.2, 0), facing));
  // Every helmet, one per trooper, 14 m in front of the lineup (medium, heavy, crest, hood, light, pilot; then Void).
  ['lancer', 'bastion', 'dawnblade', 'veil', 'seraph', 'skyrider'].forEach((c, i) => add(c, 0, at(-4 + i * 0.85, 14), facing));
  ['reaver', 'monolith', 'ashsworn', 'wraith', 'hollow_eye', 'driftcaller'].forEach((c, i) => add(c, 1, at(1.6 + i * 0.85, 14), facing));
  // A squad in combat, 20 m to the left: aiming, crouched, kneeling behind the leader, one prone.
  add('lancer', 0, at(-22, 0), facing + 0.5, 'aim');
  add('bastion', 0, at(-20.3, -1.2), facing + 0.2, 'aim');
  add('lumen', 0, at(-23.8, -1.5), facing + 0.8, 'crouch');
  add('seraph', 0, at(-21.5, -3.2), facing + 0.35, 'prone');
  add('dawnblade', 0, at(-18.6, -2.6), facing - 0.2, 'blade');

  start();

  const y = (v, up) => v.clone().setY(t.height(v.x, v.z) + up);
  const mid = at(0, -4);
  views.lineup = { pos: y(at(0, 9.5), 1.55), look: y(at(0, 0), 1.05), fov: 42, note: 'Solari Shock Troopers by role: assault, engineer, medic, infiltrator, marksman, pilot, tech, juggernaut, flame knight, demolitionist' };
  views.void = { pos: y(at(0, 1.5), 1.55), look: y(at(0, -8), 1.05), fov: 42, note: 'Void Legion by role (same order)' };
  views.weights = { pos: y(at(22.6, 4.6), 1.35), look: y(at(22.6, 0), 1.0), fov: 40, note: 'light, medium, heavy: Solari and Void' };
  views.helmets = { pos: y(at(-1.9, 16.1), 1.72), look: y(at(-1.9, 14), 1.6), fov: 46, note: 'Solari helmets: medium, heavy, crest (flame knight), hood (infiltrator), light, pilot' };
  views.helmets2 = { pos: y(at(3.7, 16.1), 1.72), look: y(at(3.7, 14), 1.6), fov: 46, note: 'Void helmets, same order' };
  views.close = { pos: y(at(-5.6, 1.9), 1.45), look: y(at(-6.05, 0), 1.2), fov: 38, note: 'medium kit up close: plates, pouches, stencils, wear' };
  views.back = { pos: y(at(-2, -4.8), 1.7), look: y(at(-2, 0), 1.1), fov: 45, note: 'from behind: capes, packs, antennas (into the sun)' };
  views.squad = { pos: y(at(-21, 5.5), 1.6), look: y(at(-21.3, -1.5), 0.8), fov: 46, note: 'a Solari squad in combat poses' };
  views.mid = { pos: y(at(0, 22), 2.2), look: y(mid, 1.0), fov: 50, note: 'both armies at mid range' };
}

// Both armies' vehicles and guns in a row each, posed: turrets turned, guns set up and laid,
// trucks loaded, rocket racks raised.
async function vehiclesStation(scene, views, atmo) {
  const { t } = scorchedGround(scene, { seed: 13, amp: 1, size: 400, z0: -200, flat: [[0, 0, 60]], craters: 25, spread: [300, 160] });
  const file = await fetch('./data/vehicles.json').then((r) => r.json());
  const defs = file.vehicles ?? file;
  const camAz = (planet.sun.azimuth - 40) * Math.PI / 180;
  const fwd = new THREE.Vector3(Math.sin(camAz), 0, -Math.cos(camAz)), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const at = (a, f = 0) => new THREE.Vector3().addScaledVector(right, a).addScaledVector(fwd, f);
  const facing = Math.atan2(fwd.x, fwd.z) + Math.PI;       // the models face -Z: turn them toward the camera
  const ORDER = ['hoverbike', 'skiff', 'tank', 'crawler', 'field_gun', 'at_gun', 'rocket', 'supply', 'dawnship', 'carrier'];
  const rank = (k) => ORDER.findIndex((o) => k.includes(o));
  const place = (type, def, team, pos, yaw) => placeVehicle(scene, t, type, def, team, pos, yaw);
  const rows = [Object.keys(defs).filter((k) => k.startsWith('solari')), Object.keys(defs).filter((k) => k.startsWith('void'))];
  rows.forEach((list, team) => {
    list.sort((a, b) => rank(a) - rank(b));
    let x = -30;
    for (const k of list) { const d = defs[k]; x += d.size.x / 2 + 2.5; place(k, d, team, at(x, -team * 16), facing + 0.6); x += d.size.x / 2 + 2.5; }
  });
  const y = (v, up) => v.clone().setY(t.height(v.x, v.z) + up);
  views.solari = { pos: y(at(-4, 22), 5), look: y(at(-4, 0), 1.2), fov: 50, note: 'Solari vehicles: hoverbike, light tank, field gun, AT gun, rocket battery, supply truck, dropship' };
  views.void = { pos: y(at(-4, 6), 5), look: y(at(-4, -16), 1.2), fov: 50, note: 'Void vehicles, same order' };
  views.tank = { pos: y(at(-14, 8), 2.6), look: y(at(-18.5, 0), 1.2), fov: 45, note: 'light tank up close' };
  views.guns = { pos: y(at(-4, 7), 2.2), look: y(at(-7, 0), 0.9), fov: 48, note: 'field gun and AT gun, set up' };
  views.trucks = { pos: y(at(12, 10), 3.2), look: y(at(9, 0), 1.4), fov: 48, note: 'rocket battery and supply truck' };
}

// The recon cars (docs/VEHICLES.md), the real sim and the game's own views: both parked with
// their crews aboard, then the physics at its moments: a handbrake slide, a sideways slide that
// catches a kerb and rolls (the ring gunner flung out of the hatch), the car on its roof, a car
// killed and burning while its crew bails.
async function carsStation(scene, views, atmo) {
  const camAz = (planet.sun.azimuth - 40) * Math.PI / 180;
  const fwd = new THREE.Vector3(Math.sin(camAz), 0, -Math.cos(camAz)), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const at = (a, f = 0) => new THREE.Vector3().addScaledVector(right, a).addScaledVector(fwd, f);
  const { t } = scorchedGround(scene, { seed: 19, amp: 0.25, size: 400, z0: -200, flat: [[0, 0, 70]], craters: 6, spread: [200, 100] });
  const F = await fighters(scene, t, { max: 40 });
  const W = F.world, VS = W.vehicles, DT = 1 / 60;
  const facing = Math.atan2(fwd.x, fwd.z) + Math.PI;       // toward the camera
  const crew = (car, team, classes) => classes.forEach((c, seat) => { if (c) { const e = F.add(c, team, car.movement.state.position.clone().add(new THREE.Vector3(3 + seat, 0, 0)), 0, 'aim'); VS.enter(e, car, seat); } });
  // Parked, crewed: driver, ring gunner, passengers.
  const kestrel = VS.spawn('solari_recon_car', 0, at(-3.2, 0), facing + 0.65);
  const jackal = VS.spawn('void_recon_car', 1, at(3.4, -2), facing + 0.95);
  crew(kestrel, 0, ['lancer', 'bastion', 'lumen', null, 'seraph']);
  crew(jackal, 1, ['reaver', 'monolith', null, 'wraith', null]);
  // The kerb a slide trips on, 40 m off to the side, and a car for each moment.
  const kerbAt = at(-40, 0), concrete = triplanar(new THREE.MeshStandardMaterial({ color: palette.materials.concrete ?? '#8b8780', roughness: 0.95 }), concreteTexture(), 1, 1);
  const kg = t.height(kerbAt.x, kerbAt.z);
  const kerb = { min: new THREE.Vector3(kerbAt.x - 0.6, kg - 0.3, kerbAt.z - 14), max: new THREE.Vector3(kerbAt.x + 30, kg + 0.22, kerbAt.z + 14), surface: 'concrete' };
  W.cover.push(kerb);
  const km = new THREE.Mesh(new THREE.BoxGeometry(30.6, 0.52, 28), concrete); km.position.set(kerbAt.x + 14.7, kg - 0.04, kerbAt.z); km.receiveShadow = true; scene.add(km);
  F.start();
  const fx = new BattleFx(scene, { fog: scene.fog });
  const vv = new VehicleViews(scene, W, { localTeam: 0, palette, fx });
  tickers.push((dt) => { vv.update(dt, window.__art.camera); fx.update(dt); });
  const run = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) { F.tick(); F.anim.update(DT, 1, window.__art.camera.position); vv.update(DT, window.__art.camera); fx.update(DT); } };
  const hold = () => { F.ctl.paused = true; };
  const y = (v, up) => v.clone().setY(t.height(v.x, v.z) + up);
  // A car sliding sideways (east, toward the kerb) from `x` m short of it: its crew aboard.
  const slider = (speed, gap, yaw = 0) => {
    const car = VS.spawn('solari_recon_car', 0, new THREE.Vector3(kerbAt.x - gap, 0, kerbAt.z), yaw);
    crew(car, 0, ['lancer', 'bastion', 'lumen', 'artificer', null]);
    run(0.6);
    car.car.vel.set(speed, 0, 0);
    return car;
  };
  views.parked = { pos: y(at(0.5, 11.5), 2.6), look: y(at(0, -1), 1.0), fov: 46, note: 'Kestrel Recon Car (Solari) and Jackal Raider (Void), crewed: driver, ring gunner standing at the gun, passengers' };
  views.kestrel = { pos: y(at(-6.8, 4.6), 1.7), look: y(at(-3.2, 0), 1.1), fov: 44, note: 'the Kestrel up close: bull bar, roll cage, ring-mount HMG, fat tyres on long-travel struts' };
  views.jackal = { pos: y(at(7.6, 2.8), 1.7), look: y(at(3.4, -2), 1.1), fov: 44, note: 'the Jackal: wedge nose, slab fenders, spines along the cage' };
  views.rear = { pos: y(at(-1.2, -7), 2.6), look: y(at(-3.2, 0), 1.3), fov: 44, note: 'from behind: the gunner at the ring, the spare, the rear vent (the weak spot)' };
  views.drift = {
    pos: y(at(34, 9), 1.6), look: y(at(28, -4), 0.8), fov: 50, note: 'a handbrake slide: the rear broken loose, the body leaning on its springs',
    enter: () => {
      const car = VS.spawn('solari_recon_car', 0, at(36, -22), facing - 0.35);
      crew(car, 0, ['lancer', 'bastion', null, null, 'seraph']);
      run(0.5);
      const f = new THREE.Vector3(-Math.sin(car.yaw), 0, -Math.cos(car.yaw));
      car.car.vel.copy(f).multiplyScalar(17); car.car.w.set(0, -1.6, 0);
      car.seats[0].cmd = { ...car.seats[0].cmd, moveX: 1, moveY: 0.6, buttons: { jump: { down: true, pressed: false, released: false } } };
      run(0.75); hold();
      // Frame it where it went: three-quarters ahead of its slide, 9 m off.
      const p = car.movement.state.position, vel = car.car.vel, c = window.__art.camera;
      const dir = vel.clone().setY(0).normalize(), side = new THREE.Vector3(-dir.z, 0, dir.x);
      c.position.copy(p).addScaledVector(dir, 7).addScaledVector(side, -6); c.position.y = t.height(c.position.x, c.position.z) + 1.7;
      c.lookAt(p.x, p.y + 0.7, p.z);
    },
  };
  views.roll = {
    pos: y(kerbAt.clone().add(new THREE.Vector3(-9, 0, 9)), 2.2), look: y(kerbAt, 1.2), fov: 52, note: 'a sideways slide catches the kerb and trips it over: the ring gunner flung out of the hatch',
    enter: () => { slider(14, 5); run(0.55); hold(); },
  };
  views.over = {
    pos: y(kerbAt.clone().add(new THREE.Vector3(-8, 0, 7)), 2.4), look: y(kerbAt.clone().add(new THREE.Vector3(1.5, 0, 0)), 0.9), fov: 52, note: 'over it goes: on its roof, crew in the air',
    enter: () => { slider(15, 5); run(1.5); hold(); },
  };
  views.thrown = {
    pos: y(kerbAt.clone().add(new THREE.Vector3(-8, 0, 7)), 2.4), look: y(kerbAt.clone().add(new THREE.Vector3(1.5, 0, 0)), 1.4), fov: 52, note: 'going over: the crew thrown out tumbling',
    enter: () => { slider(15, 5); run(1.05); hold(); },
  };
  views.burning = {
    pos: y(at(10, 9), 2.2), look: y(at(3.4, -2), 1.2), fov: 50, note: 'killed: it burns for a few seconds before it blows, time for the crew to get out',
    enter: () => {
      jackal.health.damage(1e6, { kind: 'test' }, null);
      run(1.6);
      const [d] = jackal.seats; if (d.occupant) VS.exit(d.occupant);
      run(1.4); hold();
    },
  };
  window.__art.sim = W; window.__art.run = run;
}

/** A vehicle from the kit, posed for a still: turret turned, gun set up and laid, cargo loaded. */
function placeVehicle(scene, t, type, def, team, pos, yaw, { turret = 0.5, elev = null } = {}) {
  const M = vehicleModel(def, type), mat = paintMaterial(palette, { team, number: (type.length * 13) % 100 });
  const mesh = (g) => { const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; return m; };
  const root = new THREE.Group();
  root.position.copy(pos).setY(t.height(pos.x, pos.z) + (def.model === 'hover' ? 0.15 : 0));
  root.rotation.y = yaw;
  root.add(mesh(M.body));
  if (M.turret) { const tu = new THREE.Group(); tu.position.y = M.turretY; tu.rotation.y = turret; tu.add(mesh(M.turret)); root.add(tu); }
  const tr = def.gun?.trunnion ?? [0, 1, 0];
  if (M.barrel || M.rack) {
    const pivot = new THREE.Group(); pivot.position.set(tr[0], tr[1], tr[2]); pivot.rotation.y = 0.15;
    const e = new THREE.Group(); e.rotation.x = elev ?? (M.rack ? 0.5 : 0.22); pivot.add(e);
    e.add(mesh(M.barrel ?? M.rack)); root.add(pivot);
  }
  if (M.trail) for (const side of [-1, 1]) { const h = new THREE.Group(); h.position.set(side * 0.18, tr[1] * 0.42, tr[2] + 0.3); h.rotation.y = side * 0.34; h.add(mesh(M.trail)); root.add(h); }
  if (M.leg) for (const [sx, sz] of [[-1, -0.3], [1, -0.3], [-1, 0.35], [1, 0.35]]) { const l = mesh(M.leg); l.position.set(sx * (def.size.x * 0.5 + 0.15), 0.25, sz * def.size.z); root.add(l); }
  if (M.crate) for (let i = 0; i < 6; i++) { const c = mesh(M.crate); c.position.set((i % 2 ? 1 : -1) * def.size.x * 0.22, def.size.y * 0.42 + 0.37, def.size.z * (-0.05 + Math.floor(i / 2) * 0.17)); c.rotation.y = (i % 3 - 1) * 0.04; root.add(c); }
  scene.add(root);
  return root;
}

// A front-line moment, composed like a poster: a Solari squad on the fire step of a sandbagged
// trench, rifles over the parapet, looking across no-man's-land into the low sun at the Void
// advancing through the smoke; a tank and a field gun behind them, shells landing out front.
async function sceneStation(scene, views, atmo) {
  const sd = atmo.sunDir, toward = new THREE.Vector3(sd.x, 0, sd.z).normalize(), side = new THREE.Vector3(-toward.z, 0, toward.x);
  const at = (a, f) => new THREE.Vector3().addScaledVector(side, a).addScaledVector(toward, f);
  const yawFacing = (d) => Math.atan2(-d.x, -d.z);
  const { t, scorch, chunks } = scorchedGround(scene, { seed: 17, amp: 1.4, size: 600, z0: -300, flat: [], craters: 0 });
  // The trench: a 2 m cut along `side`, 1.1 m deep, a fire step on the enemy side.
  for (let a = -40; a <= 40; a += 1) {
    const p = at(a, 0);
    t.carveDisc(p.x, p.z, 1.15, 1.1, 0);
  }
  // Shell holes across no-man's-land, fresh ones blackened.
  let sr = 3;
  const rnd = () => { sr = (Math.imul(sr, 1664525) + 1013904223) >>> 0; return sr / 4294967296; };
  for (let i = 0; i < 46; i++) {
    const p = at((rnd() - 0.5) * 90, 6 + rnd() * 80), r = 1.2 + rnd() * 3.2;
    t.carveDisc(p.x, p.z, r, r * 0.35, 0.4);
    scorch.stamp(p.x, p.z, r * 1.25, rnd() < 0.35 ? 1 : 0.35);
  }
  for (const c of chunks.chunks ?? []) c.dirty = true;
  // Sandbag parapet on the enemy lip, a lower parados behind; timber revetment posts.
  const M = palette.materials;
  const sand = triplanar(new THREE.MeshStandardMaterial({ color: M.sandbag, roughness: 1 }), sandbagTexture(), 1, 1.2);
  const timber = triplanar(new THREE.MeshStandardMaterial({ color: M.timber, roughness: 0.9 }), woodTexture(), 0.6, 0.8);
  const boxes = [];
  const wall = (f, h, depth) => {
    for (let a = -36; a < 36; a += 3) {
      const c = at(a + 1.5, f), alongX = Math.abs(side.x) > Math.abs(side.z);
      const w = alongX ? 3 : depth, d = alongX ? depth : 3, g = t.height(c.x, c.z);
      const box = { min: new THREE.Vector3(c.x - w / 2, g - 0.2, c.z - d / 2), max: new THREE.Vector3(c.x + w / 2, g + h, c.z + d / 2), surface: 'sandbag' };
      boxes.push(box);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h + 0.2, d), sand);
      m.position.set(c.x, g + (h - 0.2) / 2, c.z); m.castShadow = m.receiveShadow = true; scene.add(m);
    }
  };
  wall(1.75, 0.6, 0.9);
  wall(-1.7, 0.35, 0.8);
  new SandbagTops(scene, boxes, { color: M.sandbag, far: 400 }).update(new THREE.Vector3());
  for (let a = -36; a <= 36; a += 2.5) {
    const p = at(a, 1.05), g = t.height(p.x, p.z);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.3, 0.14), timber);
    post.position.set(p.x, g + 0.55, p.z); post.castShadow = true; scene.add(post);
  }
  // The squad on the fire step, and the Void coming across.
  const { add, start } = await fighters(scene, t, { max: 48 });
  const face = yawFacing(toward), back = yawFacing(toward.clone().negate());
  const step = (a) => { const p = at(a, 0.55); return p; };
  add('lancer', 0, step(-1.2), face - 0.08, 'aim', { pitch: 0.05 });
  add('bastion', 0, step(0.4), face + 0.05, 'aim', { pitch: 0.03 });
  add('lumen', 0, at(-2.6, -0.2), face + 0.5, 'crouch');
  add('seraph', 0, step(2.2), face + 0.12, 'aim', { pitch: 0.06 });
  add('artificer', 0, at(3.8, -0.3), face - 0.3, 'stand');
  add('breacher', 0, at(-4.2, -0.1), face + 0.2, 'aim');
  for (let i = 0; i < 9; i++) add(['reaver', 'monolith', 'wraith', 'mender', 'rigger', 'riftbreaker', 'reaver', 'hollow_eye', 'ashsworn'][i], 1, at(-14 + i * 3.6 + (rnd() - 0.5) * 2, 34 + rnd() * 22), back + (rnd() - 0.5) * 0.4, i % 3 ? 'aim' : 'stand');
  start();
  // Armor behind the line and across it.
  const defs = (await fetch('./data/vehicles.json').then((r) => r.json())).vehicles;
  placeVehicle(scene, t, 'solari_lancer_tank', defs.solari_lancer_tank, 0, at(-11, -9), face, { turret: 0.12 });
  placeVehicle(scene, t, 'solari_field_gun', defs.solari_field_gun, 0, at(9, -7), face, { elev: 0.18 });
  placeVehicle(scene, t, 'void_crawler_tank', defs.void_crawler_tank, 1, at(12, 78), back, { turret: -0.2 });
  // Shells landing out front: fire, a column of dirt, smoke that hangs.
  const fx = new BattleFx(scene, { fog: scene.fog });
  let next = 0, time = 0;
  const shell = () => { const p = at((rnd() - 0.5) * 60, 14 + rnd() * 45); fx.impact([p.x, t.height(p.x, p.z), p.z], 9); };
  for (let i = 0; i < 6; i++) { shell(); fx.update(0.6); }
  tickers.push((dt) => { time += dt; if (time > next) { shell(); next = time + 1.6 + rnd() * 1.5; } fx.update(dt); });
  const y = (v, up) => v.clone().setY(t.height(v.x, v.z) + up);
  views.hero = { pos: y(at(-2.4, -3.2), 1.55), look: y(at(1.5, 30), 1.4), fov: 58, note: 'on the fire step: rifles over the parapet, into the sun' };
  views.over = { pos: y(at(-9, -6), 3.4), look: y(at(-1, 20), 0.5), fov: 60, note: 'over the shoulder of the line' };
  views.across = { pos: y(at(6, 28), 1.6), look: y(at(-2, 0), 0.9), fov: 50, note: 'from no-man\'s-land: the trench line, the tank and the gun' };
  views.side = { pos: y(at(-16, 2.2), 1.2), look: y(at(4, 1.2), 0.6), fov: 52, note: 'down the trench' };
}

// Stratagems on a stretch of the front (docs/GAMEPLAY_PLAN.md §2), driven by the real sim: a
// trooper typing a code on the wrist pad (the call-in panel up), one with a beacon cocked to
// throw, and each payload at its moment: a strike's red beam and danger ring among the enemy,
// the round streaking down and landing, the strafing run's jet overhead, a supply pod open on
// its crates, a sentry up on its pod, a smoke screen, an orbital barrage, every beam at once.
// Each view sets its call-in up and runs the sim to the moment.
async function stratagemsStation(scene, views, atmo) {
  // The enemy lies 75° off the sun: light from the front left, so the beams read against sky
  // that isn't the sun's glare.
  const sd = atmo.sunDir, sa = Math.atan2(sd.x, sd.z) + 1.3, toward = new THREE.Vector3(Math.sin(sa), 0, Math.cos(sa)), side = new THREE.Vector3(-toward.z, 0, toward.x);
  const at = (a, f) => new THREE.Vector3().addScaledVector(side, a).addScaledVector(toward, f);
  const yawOf = (d) => Math.atan2(-d.x, -d.z);
  const { t, scorch, chunks } = scorchedGround(scene, { seed: 23, amp: 1.2, size: 600, z0: -300, flat: [[0, 0, 22]], craters: 0 });
  let sr = 9;
  const rnd = () => { sr = (Math.imul(sr, 1664525) + 1013904223) >>> 0; return sr / 4294967296; };
  for (let i = 0; i < 40; i++) {
    const p = at((rnd() - 0.5) * 110, 10 + rnd() * 90), r = 1.2 + rnd() * 3;
    t.carveDisc(p.x, p.z, r, r * 0.35, 0.4);
    scorch.stamp(p.x, p.z, r * 1.25, rnd() < 0.35 ? 1 : 0.35);
  }
  for (const c of chunks.chunks ?? []) c.dirty = true;
  const strat = await fetch('./data/stratagems.json').then((r) => r.json());
  const F = await fighters(scene, t, { max: 40, stratagems: strat });
  const S = F.world.stratagems, face = yawOf(toward), back = yawOf(toward.clone().negate());
  const typist = F.add('lancer', 0, at(-1.2, 0), face + 0.5, 'stand');
  const thrower = F.add('artificer', 0, at(1.3, -1.1), face - 0.25, 'stand');
  F.add('bastion', 0, at(3.4, 0.8), face + 0.05, 'aim');
  F.add('lumen', 0, at(-3.6, -1.4), face + 0.3, 'crouch');
  F.add('seraph', 0, at(5.8, -0.6), face - 0.12, 'aim');
  F.add('breacher', 0, at(-6, 0.4), face + 0.15, 'aim');
  for (let i = 0; i < 10; i++) F.add(['reaver', 'monolith', 'wraith', 'mender', 'rigger', 'riftbreaker', 'reaver', 'hollow_eye', 'ashsworn', 'psion'][i], 1, at(-16 + i * 3.5 + (rnd() - 0.5) * 2, 33 + rnd() * 14), back + (rnd() - 0.5) * 0.5, i % 3 ? 'aim' : 'stand');
  F.start();
  // The typist mid-code, the thrower with a sentry beacon cocked behind the shoulder.
  typist.stratagems.state = 'typing'; typist.stratagems.code = 'RR';
  thrower.stratagems.state = 'armed'; thrower.stratagems.armed = thrower.stratagems.slot('sentry');
  const fx = new BattleFx(scene, { fog: scene.fog });
  const sv = new StratagemViews(scene, F.world, { palette, fx, anim: F.anim, groundY: (x, z) => t.height(x, z) });
  tickers.push(() => { sv.update(1 / 60, window.__art.camera); fx.update(1 / 60); });
  /** A call-in planted at p, as if thrown from where `from` stands. */
  const call = (id, p, from = thrower) => {
    const b = S.throwBeacon(from, { id, def: S.defs[id] }, 0, 0);
    b.pos.set(p.x, t.height(p.x, p.z) + 0.25, p.z); b.vel.set(0, -3, 0);
    return b;
  };
  /** Run the sim (and its views) for `sec` seconds. */
  const run = (sec) => {
    for (let i = 0; i < sec * 60; i++) { F.tick(); F.anim.update(1 / 60, 1, window.__art.camera.position); sv.update(1 / 60, window.__art.camera); fx.update(1 / 60); }
  };
  const y = (v, up) => v.clone().setY(t.height(v.x, v.z) + up);
  views.callin = {
    pos: y(at(-2.6, 2.6), 1.7), look: y(at(-0.4, -0.6), 1.2), fov: 50, note: 'typing a code on the wrist pad; a sentry beacon cocked to throw',
    enter: () => { const panel = new StratagemPanel(document.body, { world: F.world, player: typist, colors: palette.stratagem }); tickers.push((dt) => panel.update(dt, window.__art.camera)); run(0.6); },
  };
  views.strike = { pos: y(at(-3, -5), 2.2), look: y(at(0, 30), 6), fov: 55, note: 'a precision strike called on the enemy line: the red beam and the danger ring', enter: () => { call('precision_strike', at(0, 37)); run(1.6); } };
  views.inbound = { pos: y(at(-8, 18), 1.6), look: y(at(0, 37), 14), fov: 58, note: 'the round streaking down on the beacon', enter: () => { call('precision_strike', at(0, 37)); run(2.86); } };
  views.boom = { pos: y(at(-3, -5), 2.2), look: y(at(0, 30), 4), fov: 55, note: 'the strike lands', enter: () => { call('precision_strike', at(0, 37)); run(3.4); } };
  views.strafe = { pos: y(at(-5, -8), 1.6), look: y(at(0, 40), 18), fov: 70, note: 'a strafing run: the jet pulling away, the run walking up the field', enter: () => { call('strafing_run', at(0, 26), typist); run(1.9); } };
  views.supply = { pos: y(at(-6.5, 1.5), 1.75), look: y(at(-3, 7), 0.9), fov: 50, note: 'a supply pod open on its four crates', enter: () => { call('supply_drop', at(-3, 7)); run(6.6); } };
  views.sentry = { pos: y(at(9.5, 1), 1.9), look: y(at(6, 6.5), 1.6), fov: 50, note: 'a sentry up on its pod, turning on the enemy', enter: () => { call('sentry', at(6, 6.5)); run(6.2); } };
  views.smoke = { pos: y(at(-2, -6), 2.4), look: y(at(0, 18), 2), fov: 58, note: 'a smoke screen across the front', enter: () => { call('smoke_screen', at(0, 17), typist); run(5.5); } };
  views.barrage = { pos: y(at(-14, -10), 7), look: y(at(0, 45), 4), fov: 55, note: 'an orbital barrage on the enemy line', enter: () => { call('orbital_barrage', at(0, 46)); run(7.8); } };
  // A vehicle bought with battle points: the tank in its cradle on the way down, then on the
  // ground with the empty cradle lifting away (the landed vehicle is VehicleViews', as in the game).
  const vehicles = () => { if (!F.vv) { F.vv = new VehicleViews(scene, F.world, { localTeam: 0, palette }); tickers.push((dt) => F.vv.update(dt, window.__art.camera)); } };
  views.cradle = { pos: y(at(-15, -3), 1.6), look: y(at(-3, 13), 12), fov: 55, note: 'a tank bought with battle points coming down in its drop cradle, retro thrusters burning', enter: () => { vehicles(); call('tank_drop', at(-3, 13)); run(7.8); } };
  views.delivered = { pos: y(at(-13, 0), 2.2), look: y(at(-3, 13), 6), fov: 60, note: 'the tank delivered, the empty cradle lifting away', enter: () => { vehicles(); call('tank_drop', at(-3, 13)); run(9.3); } };
  views.beams = {
    pos: y(at(-10, -12), 3), look: y(at(0, 20), 12), fov: 60, note: 'every kind of beacon at once: strike, supply, sentry, smoke',
    enter: () => { call('orbital_barrage', at(-12, 44)); call('precision_strike', at(10, 38)); call('supply_drop', at(-5, 9)); call('sentry', at(7, 10)); call('smoke_screen', at(1, 20)); run(1.2); },
  };
  window.__art.call = call; window.__art.run = run; window.__art.sim = F.world; window.__art.anim = F.anim;
}

// Melee on the front (docs/GAMEPLAY_PLAN.md §4): every class's blade held in guard, a duel frozen
// mid-swing (the sweep the sim tests is the arc the rig draws), a spear's thrust, the rifle-butt
// shove and a finisher over a downed enemy. Poses are the sim's melee phases, held still.
async function meleeStation(scene, views, atmo) {
  const sd = atmo.sunDir, sa = Math.atan2(sd.x, sd.z) - 0.6, fwd = new THREE.Vector3(Math.sin(sa), 0, Math.cos(sa)), side = new THREE.Vector3(-fwd.z, 0, fwd.x);   // the sun behind the cameras
  const at = (a, f) => new THREE.Vector3().addScaledVector(side, a).addScaledVector(fwd, f);
  const { t } = scorchedGround(scene, { seed: 41, amp: 0.4, size: 300, z0: -150, flat: [[0, 0, 40]], craters: 4, spread: [100, 80] });
  const F = await fighters(scene, t, { max: 32 });
  const toward = (a, b) => Math.atan2(-(b.x - a.x), -(b.z - a.z));
  /** Freeze a soldier's melee in a phase of an attack (or a guard). */
  const hold = (e, phase, attackId = null, u = 0.5, def = null) => {
    const m = e.melee;
    m.update = () => {};
    m.phase = phase; m.attackId = attackId; m.attack = def ?? (attackId ? m.w.attacks[attackId] : null);
    m.phaseTime = m.attack ? (m.attack[phase === 'active' ? 'active' : phase === 'recovery' ? 'recovery' : 'windup'] ?? 0.2) * u : u;
  };
  // The blades: each class's own, both armies, in guard, facing the camera's side.
  const row = ['dawnblade', 'veil', 'bastion', 'prism_adept', 'lancer', 'ashsworn', 'wraith', 'monolith', 'reaver', 'psion'];
  const lineFace = toward(at(0, 0), at(0, 6));
  const line = row.map((c, i) => F.add(c, i < 5 ? 0 : 1, at((i - 4.5) * 1.5, 0), lineFace, 'blade'));
  // A duel mid-swing, a spear thrust beside it.
  const A = F.add('dawnblade', 0, at(-4, -9), 0, 'blade'), B = F.add('ashsworn', 1, at(-4, -11), 0, 'blade');
  const S = F.add('lancer', 0, at(2, -9), 0, 'blade'), T = F.add('reaver', 1, at(2, -11.6), 0, 'blade');
  // The rifle butt, and a finisher.
  const G = F.add('lancer', 0, at(-4, -18), 0, 'stand'), H = F.add('wraith', 1, at(-4, -19.4), 0, 'stand');
  const K = F.add('bastion', 0, at(3, -18), 0, 'stand'), D = F.add('reaver', 1, at(3, -19.1), 0, 'stand');
  for (const [p, q] of [[A, B], [S, T], [G, H], [K, D]]) {
    const pp = p.movement.state.position, qq = q.movement.state.position;
    F.people.find((x) => x.e === p).yaw = toward(pp, qq); F.people.find((x) => x.e === q).yaw = toward(qq, pp);
  }
  F.start();
  for (const e of line) hold(e, 'guard', null, 0.5);
  hold(A, 'active', 'light1', 0.55); hold(B, 'guard', null, 0.5);
  S.melee.setMoveset(meleeWeapon(F.meleeWeapons, 'solari_sunlance')); hold(S, 'active', 'light1', 0.7); hold(T, 'stagger', null, 0.1);
  hold(G, 'active', 'bash', 0.8, BASH); hold(H, 'stagger', null, 0.1);
  Object.assign(D.movement.state, { downed: true, stance: 'prone' });
  K.reviveJob = { patient: D, t: 0.55, need: 1.1, finish: true };
  for (let i = 0; i < 40; i++) F.tick();
  const y = (v, up) => v.clone().setY(t.height(v.x, v.z) + up);
  views.blades = { pos: y(at(0, 6.5), 1.45), look: y(at(0, 0), 1.15), fov: 48, note: 'every class its own blade: flame swords, a vibroblade, a power fist, an ion halberd, a knife, twin embers, a rift cleaver, a hook' };
  views.duel = { pos: y(at(-0.2, -9.6), 1.5), look: y(at(-4, -10), 1.2), fov: 50, note: 'mid-swing: the arc the rig draws is the sweep the sim tests' };
  views.spear = { pos: y(at(5.8, -10.1), 1.5), look: y(at(2, -10.3), 1.2), fov: 50, note: 'a spear\'s thrust: the longest reach on the front' };
  views.bash = { pos: y(at(-1.6, -16.6), 1.4), look: y(at(-4, -18.7), 1.15), fov: 46, note: 'the rifle butt: a gunner\'s quick shove' };
  views.finisher = { pos: y(at(5.4, -16.8), 1.5), look: y(at(3, -18.6), 0.6), fov: 46, note: 'a finisher over a downed enemy' };
}

// Small arms up close (docs/GAMEPLAY_PLAN.md §1, GunFx): rounds landing on each material side by
// side (dirt, sandbags, timber, metal, concrete) and a trooper firing, the flash and puff at the
// rig's barrel. The events are the sim's (weapon:impact, weapon:fire), sent at a steady rate.
async function gunfxStation(scene, views, atmo) {
  const sd = atmo.sunDir, sa = Math.atan2(sd.x, sd.z) + Math.PI - 0.5, fwd = new THREE.Vector3(Math.sin(sa), 0, Math.cos(sa)), side = new THREE.Vector3(-fwd.z, 0, fwd.x);   // the sun behind us: the targets lit
  const at = (a, f) => new THREE.Vector3().addScaledVector(side, a).addScaledVector(fwd, f);
  const { t } = scorchedGround(scene, { seed: 31, amp: 0.3, size: 300, z0: -150, flat: [[0, 0, 30]], craters: 6, spread: [100, 80] });
  const M = palette.materials;
  const mats = {
    sandbag: triplanar(new THREE.MeshStandardMaterial({ color: M.sandbag, roughness: 1 }), sandbagTexture(), 1, 1.2),
    wood: triplanar(new THREE.MeshStandardMaterial({ color: M.timber, roughness: 0.9 }), woodTexture(), 0.6, 0.8),
    metal: triplanar(new THREE.MeshStandardMaterial({ color: '#4a4a4c', roughness: 0.5, metalness: 0.7 }), metalTexture(), 0.8, 0.6),
    concrete: triplanar(new THREE.MeshStandardMaterial({ color: M.concrete, roughness: 0.95 }), concreteTexture(), 0.8, 1),
  };
  // The targets in a row, 7 m out; the dirt patch in front of them.
  const faceYaw = Math.atan2(-fwd.x, -fwd.z) + Math.PI;
  const targets = [['sandbag', -3.3, [1.5, 0.9, 0.9]], ['wood', -1.2, [0.5, 1.6, 0.5]], ['metal', 0.6, [1.3, 1.3, 0.12]], ['concrete', 2.6, [1.4, 1.2, 0.8]]].map(([kind, a, [w, h, d]]) => {
    const c = at(a, 7), g = t.height(c.x, c.z), m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[kind]);
    m.position.set(c.x, g + h / 2, c.z); m.rotation.y = faceYaw; m.castShadow = m.receiveShadow = true; scene.add(m);
    return { kind, c, g, w, h, d };
  });
  const F = await fighters(scene, t, { max: 8 });
  const shooter = F.add('lancer', 0, at(5.5, 3.2), Math.atan2(-(at(0.6, 7).x - at(5.5, 3.2).x), -(at(0.6, 7).z - at(5.5, 3.2).z)), 'aim');
  F.start();
  const fx = new BattleFx(scene, { fog: scene.fog });
  const gfx = new GunFx(scene, { fx, anim: F.anim, world: F.world, player: shooter, palette });
  let sr = 5, time = 0, nextHit = 0, nextShot = 0;
  const rnd = () => { sr = (Math.imul(sr, 1664525) + 1013904223) >>> 0; return sr / 4294967296; };
  const n = new THREE.Vector3().copy(fwd).negate();
  tickers.push((dt) => {
    time += 1 / 60;
    if (time > nextHit) {
      nextHit = time + 0.05;
      // Into one target's face (toward the camera), or the dirt in front of them.
      const k = Math.floor(rnd() * 5);
      if (k < 4) {
        const T = targets[k], p = T.c.clone().addScaledVector(side, (rnd() - 0.5) * T.w * 0.8).addScaledVector(n, T.d / 2 + 0.01);
        p.y = T.g + 0.1 + rnd() * (T.h - 0.2);
        bus.emit('weapon:impact', { point: p, normal: n, surface: T.kind });
      } else {
        const p = at((rnd() - 0.5) * 7, 4.5 + rnd() * 1.5); p.y = t.height(p.x, p.z);
        bus.emit('weapon:impact', { point: p, normal: new THREE.Vector3(0, 1, 0), surface: 'dirt' });
      }
    }
    if (time > nextShot) { nextShot = time + 0.09; bus.emit('weapon:fire', { id: shooter.id, weaponId: 'sol_ar_halcyon' }); }
    gfx.update(1 / 60, window.__art.camera); fx.update(1 / 60);
  });
  const y = (v, up) => v.clone().setY(t.height(v.x, v.z) + up);
  views.impacts = { pos: y(at(-0.3, 3.4), 1.25), look: y(at(-0.3, 7), 0.6), fov: 52, note: 'rounds landing on sandbags, timber, metal, concrete and dirt: spray, splinters, sparks, chips, dust, holes', enter: () => { for (let i = 0; i < 240; i++) tickers.forEach((f) => f(1 / 60)); } };
  views.muzzle = { pos: y(at(7.6, 2.4), 1.55), look: y(at(5.4, 3.4), 1.35), fov: 40, note: 'the flash and the puff at the barrel', enter: () => { for (let i = 0; i < 30; i++) tickers.forEach((f) => f(1 / 60)); } };
}

