// Asset viewer: shows every manifest entry exactly as the game builds it (same normalisation,
// cel conversion, tinting), with a red arrow along -Z (SKYFALL's "forward"), a 1.8 m height
// marker for characters and the muzzle point for guns. Characters can play each mapped clip.
// Open http://localhost:5173/tools/assets/viewer.html while `npm run dev` runs. Edit
// public/assets/manifest.json (rotY, scale, offset, muzzle, sightY, clips) and reload.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { assets, CLIP_PATTERNS } from '../../src/client/assets.js';
import { STYLE } from '../../src/client/comic.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#2a313c');
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight('#dfe9ff', '#4a4235', 1.2));
const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
sun.position.set(3, 6, 4);
scene.add(sun);
scene.add(new THREE.GridHelper(10, 20, '#556', '#334'));
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 200);
camera.position.set(2.5, 1.8, 3.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.9, 0);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// forward (-Z) arrow + height marker
const fwd = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0.02, 0), 1.2, '#ff3b30', 0.15, 0.08);
scene.add(fwd);
const h18 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.005, 0.005), new THREE.MeshBasicMaterial({ color: '#33d6ff' }));
h18.position.y = 1.8;
scene.add(h18);

const info = document.getElementById('info');
const list = document.getElementById('list');
let current = null, mixer = null;
const clock = new THREE.Clock();

function clear() {
  if (current) scene.remove(current);
  current = null; mixer = null;
}

function show(kind, key) {
  clear();
  const lines = [`${kind} ${key}`];
  if (kind === 'character') {
    const c = assets.character(key);
    current = c.root;
    mixer = new THREE.AnimationMixer(c.model);
    const states = Object.keys(CLIP_PATTERNS).map((s) => `${s.padEnd(8)} → ${c.clips[s] ? c.clips[s].name : '(none: falls back)'}`);
    lines.push(`file: ${c.def.file}`, ...states);
    const play = (st) => { mixer.stopAllAction(); if (c.clips[st]) mixer.clipAction(c.clips[st]).play(); };
    play('idle');
    const bar = document.createElement('div');
    for (const st of Object.keys(c.clips)) { const b = document.createElement('button'); b.textContent = '▶ ' + st; b.onclick = () => play(st); bar.appendChild(b); }
    lines.push('');
    info.textContent = lines.join('\n');
    info.appendChild(bar);
    controls.target.set(0, 0.9, 0);
  } else if (kind === 'weapon') {
    const g = assets.gun(key);
    current = new THREE.Group();
    current.add(g.root);
    current.position.y = 1.2;
    const box = new THREE.Box3().setFromObject(g.root);
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.015), new THREE.MeshBasicMaterial({ color: '#ffd23f' }));
    muzzle.position.set(0, (box.min.y + box.max.y) / 2, box.min.z);
    current.add(muzzle);
    lines.push(`file: ${g.def.file}`, `size: ${box.getSize(new THREE.Vector3()).toArray().map((v) => v.toFixed(2)).join(' × ')} m`, 'The barrel must point along the red arrow (-Z); the yellow dot is the muzzle.', 'If it points backwards, add Math.PI to rotY in the manifest.');
    info.textContent = lines.join('\n');
    controls.target.set(0, 1.2, 0);
  } else if (kind === 'nature') {
    const [k, i] = key.split(':');
    const v = assets.natureKinds(k)[+i];
    current = new THREE.Group();
    for (const p of v.parts) current.add(new THREE.Mesh(p.geometry, p.material));
    current.scale.setScalar(k === 'tree' ? 3 : 1.5);
    lines.push(`file: ${v.def.file}`, `${v.parts.length} instanced parts (normalised to 1 m tall, shown ×${current.scale.x})`);
    info.textContent = lines.join('\n');
    controls.target.set(0, 1, 0);
  } else if (kind === 'arms') {
    const a = assets.fpArms();
    current = a.root;
    current.position.set(0, 1.5, 0);
    mixer = new THREE.AnimationMixer(a.model);
    if (a.clips[0]) mixer.clipAction(a.clips[0]).play();
    lines.push(`file: ${a.def.file}`, `clips: ${a.clips.map((c) => c.name).join(', ') || '(none)'}`, 'Tune arms.pos / rot / scale in the manifest so the hands sit at the gun grip.');
    info.textContent = lines.join('\n');
    controls.target.set(0, 1.5, 0);
  }
  if (current) scene.add(current);
}

function build() {
  list.innerHTML = '';
  const section = (title, items) => {
    if (!items.length) return;
    const h = document.createElement('h3'); h.textContent = title; list.appendChild(h);
    for (const [label, fn] of items) {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => { list.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); fn(); };
      list.appendChild(b);
    }
  };
  section('CHARACTERS', [...assets.chars.keys()].map((k) => [k, () => show('character', k)]));
  section('WEAPONS', [...assets.guns.keys()].map((k) => [k, () => show('weapon', k)]));
  section('NATURE', Object.entries(assets.nature).flatMap(([k, vs]) => vs.map((v, i) => [`${k} ${i + 1}: ${v.def.file.split('/').pop()}`, () => show('nature', `${k}:${i}`)])));
  if (assets.arms) section('ARMS', [['first-person arms', () => show('arms', '')]]);
  const showTex = (k) => {
    clear();
    const m = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ map: assets.textures[k].map }));
    m.position.y = 1;
    current = m;
    scene.add(m);
    info.textContent = `texture ${k} (scale ${assets.textures[k].scale} m, strength ${assets.textures[k].strength})`;
  };
  section('TEXTURES', Object.keys(assets.textures).map((k) => [k, () => showTex(k)]));
}

document.getElementById('comic').onchange = (e) => { STYLE.comic = e.target.checked; const on = list.querySelector('button.on'); if (on) on.click(); };
await assets.load();
info.textContent = assets.manifest ? assets.report.join('\n') : 'No public/assets/manifest.json — run tools/assets/import.mjs first.';
build();
renderer.setAnimationLoop(() => { if (mixer) mixer.update(clock.getDelta()); else clock.getDelta(); controls.update(); renderer.render(scene, camera); });
