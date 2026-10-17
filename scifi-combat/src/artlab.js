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

const params = new URLSearchParams(location.search);
const station = params.get('station') ?? 'sky';
const palette = await fetch('./data/art/palette.json').then((r) => r.json());
const planet = palette.planets[params.get('planet') ?? 'scorched'];
const STATIONS = ['palette', 'sky', 'materials', 'troopers', 'vehicles', 'scene'];
const VIEWS = { sky: ['sun', 'away', 'moon', 'wide', 'up'] };

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
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 1500);
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); post.setSize(innerWidth, innerHeight); });

  const views = {};
  let focus = new THREE.Vector3();
  if (station === 'sky') skyStation(scene, views, atmo);
  const viewNames = Object.keys(views);
  let view = params.get('view') ?? viewNames[0];
  const setView = (name) => {
    view = name; const v = views[name]; if (!v) return;
    camera.position.copy(v.pos); camera.lookAt(v.look); camera.fov = v.fov ?? 55; camera.updateProjectionMatrix();
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
