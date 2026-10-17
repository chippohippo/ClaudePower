// Art lab: every piece of the art direction in isolation, to build it and screenshot it
// (docs/ART_DIRECTION.md). ?station=palette|sky|materials|troopers|vehicles|scene &view=...
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
import { kitFor } from './render/TrooperKit.js';
import { vehicleModel } from './render/VehicleKit.js';
import { paintMaterial } from './render/TrooperMaterial.js';

const params = new URLSearchParams(location.search);
const station = params.get('station') ?? 'sky';
const palette = await fetch('./data/art/palette.json').then((r) => r.json());
const planet = palette.planets[params.get('planet') ?? 'scorched'];
const STATIONS = ['palette', 'sky', 'materials', 'troopers', 'vehicles', 'scene'];

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
async function troopersStation(scene, views, atmo) {
  const { t } = scorchedGround(scene, { seed: 11, amp: 1.2, size: 400, z0: -200, flat: [[0, 0, 40]], craters: 30, spread: [300, 160] });
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
  const world = new CombatWorld({ damageMatrix: damage.matrix, cover: [], supers, meleeWeapons: melee.weapons, recoilDefs: recoil.patterns, vehicleDefs: vehicles, statusDefs: statuses.statuses, terrain: t });
  const anim = new AnimationSystem(humanoid, { getEntity: (id) => world.entity(id), surfaceAt: () => 'dirt', groundY: (x, z) => t.height(x, z) });
  const crowd = new CrowdRenderer(scene, { max: 64, palette, nearDist: params.get('lod') === 'mid' ? 0 : 80 });
  window.__art.crowd = crowd;

  // Lighting the troopers 3/4 from the front: they face 35° off the sun.
  const camAz = (planet.sun.azimuth - 35) * Math.PI / 180;
  const fwd = new THREE.Vector3(Math.sin(camAz), 0, -Math.cos(camAz)), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const facing = Math.atan2(-fwd.x, -fwd.z);
  const at = (a, f = 0) => new THREE.Vector3().addScaledVector(right, a).addScaledVector(fwd, f);
  const people = [];
  let id = 1;
  const add = (classId, team, pos, yaw, act = 'stand', extra = {}) => {
    const e = buildFighter(world, data, { id: id++, team, classId, pos: pos.clone().setY(t.height(pos.x, pos.z) + 0.05) });
    e.mode = act === 'blade' ? 'sword' : 'gun';
    e.health.damage = () => ({});
    e.look = { team, status: null, flame: new THREE.Color(team ? '#8b5cf6' : '#ff7a1a'), highlight: false, kit: kitFor(table, e.role), number: (e.id * 37 + 11) % 100, ...extra };
    anim.add(e);
    people.push({ e, yaw, act, t: 0 });
    return e;
  };
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

  const DT = 1 / 60;
  const tick = () => {
    anim.snapshot();
    for (const p of people) {
      const e = p.e, held = new Set(), pressed = new Set();
      if (p.act === 'aim') held.add('guard');
      if (p.act === 'crouch' && p.t < 0.05) pressed.add('crouch');
      if (p.act === 'prone' && p.t < 0.7) held.add('crouch');
      const cmd = { moveX: 0, moveY: 0, yaw: p.yaw, pitch: p.act === 'aim' ? 0.04 : 0, buttons: {} };
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
  for (let i = 0; i < 150; i++) tick();     // settle into the poses (and let the capes hang)
  for (let i = 0; i < 30; i++) { tick(); anim.update(DT, 1, new THREE.Vector3()); }
  tickers.push(() => { tick(); draw(); });

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
  window.__art.people = people;
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
  const place = (type, def, team, pos, yaw) => {
    const M = vehicleModel(def, type), mat = paintMaterial(palette, { team, number: (type.length * 13) % 100 });
    const mesh = (g) => { const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; return m; };
    const root = new THREE.Group();
    root.position.copy(pos).setY(t.height(pos.x, pos.z) + (def.model === 'hover' ? 0.15 : 0));
    root.rotation.y = yaw;
    root.add(mesh(M.body));
    if (M.turret) { const tu = new THREE.Group(); tu.position.y = M.turretY; tu.rotation.y = 0.5; tu.add(mesh(M.turret)); root.add(tu); }
    const tr = def.gun?.trunnion ?? [0, 1, 0];
    if (M.barrel || M.rack) {
      const pivot = new THREE.Group(); pivot.position.set(tr[0], tr[1], tr[2]); pivot.rotation.y = 0.15;
      const elev = new THREE.Group(); elev.rotation.x = M.rack ? 0.5 : 0.22; pivot.add(elev);
      elev.add(mesh(M.barrel ?? M.rack)); root.add(pivot);
    }
    if (M.trail) for (const side of [-1, 1]) { const h = new THREE.Group(); h.position.set(side * 0.18, tr[1] * 0.42, tr[2] + 0.3); h.rotation.y = side * 0.34; h.add(mesh(M.trail)); root.add(h); }
    if (M.leg) for (const [sx, sz] of [[-1, -0.3], [1, -0.3], [-1, 0.35], [1, 0.35]]) { const l = mesh(M.leg); l.position.set(sx * (def.size.x * 0.5 + 0.15), 0.25, sz * def.size.z); root.add(l); }
    if (M.crate) for (let i = 0; i < 6; i++) { const c = mesh(M.crate); c.position.set((i % 2 ? 1 : -1) * def.size.x * 0.22, def.size.y * 0.42 + 0.37, def.size.z * (-0.05 + Math.floor(i / 2) * 0.17)); c.rotation.y = (i % 3 - 1) * 0.04; root.add(c); }
    scene.add(root);
  };
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
