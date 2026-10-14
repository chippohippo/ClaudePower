// Builds small stand-in GLBs that follow the conventions of the real CC0 packs, so the asset
// pipeline can be tested end to end without downloading anything:
//   character.glb  skinned humanoid facing +Z, bones named like Quaternius rigs (Hips, Spine,
//                  Chest, Head, UpperArm.R, LowerArm.R, Hand.R, …), clips "CharacterArmature|Idle",
//                  "|Walk", "|Run", "|Jump_Idle", "|Death", "|Idle_Gun"; materials "Main" + "Skin"
//   gun.glb        rifle lying along +X (exercises the manifest rotation)
//   tree.glb       trunk + canopy (two materials), rock.glb, bush.glb
// Served by Vite at /tools/assets/fixtures.html; tools/assets/fixturetest.mjs drives it.

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

function box(w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function character() {
  const main = new THREE.MeshStandardMaterial({ color: '#8090a0', name: 'Main' });
  const skin = new THREE.MeshStandardMaterial({ color: '#e0b090', name: 'Skin' });
  // skeleton (units: metres, ~1.9 m tall, facing +Z)
  const B = (name, x, y, z, parent) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); if (parent) parent.add(b); return b; };
  const hips = B('Hips', 0, 1.0, 0);
  const spine = B('Spine', 0, 0.15, 0, hips), chest = B('Chest', 0, 0.25, 0, spine), head = B('Head', 0, 0.3, 0, chest);
  const uaR = B('UpperArm.R', -0.25, 0.2, 0, chest), laR = B('LowerArm.R', 0, -0.3, 0, uaR), handR = B('Hand.R', 0, -0.28, 0, laR);
  const uaL = B('UpperArm.L', 0.25, 0.2, 0, chest), laL = B('LowerArm.L', 0, -0.3, 0, uaL);
  const ulR = B('UpperLeg.R', -0.12, -0.05, 0, hips), llR = B('LowerLeg.R', 0, -0.45, 0, ulR);
  const ulL = B('UpperLeg.L', 0.12, -0.05, 0, hips), llL = B('LowerLeg.L', 0, -0.45, 0, ulL);
  const bones = [hips, spine, chest, head, uaR, laR, handR, uaL, laL, ulR, llR, ulL, llL];
  // body parts merged into one skinned mesh, each part rigidly weighted to one bone
  const parts = [
    [0.4, 0.5, 0.25, 0, 1.4, 0, chest, 0], [0.34, 0.25, 0.22, 0, 1.08, 0, hips, 0], [0.24, 0.26, 0.24, 0, 1.82, 0.02, head, 1],
    [0.1, 0.3, 0.1, -0.25, 1.45, 0, uaR, 0], [0.09, 0.3, 0.09, -0.25, 1.15, 0, laR, 1], [0.1, 0.3, 0.1, 0.25, 1.45, 0, uaL, 0], [0.09, 0.3, 0.09, 0.25, 1.15, 0, laL, 1],
    [0.13, 0.45, 0.13, -0.12, 0.72, 0, ulR, 0], [0.11, 0.45, 0.11, -0.12, 0.27, 0.02, llR, 0], [0.13, 0.45, 0.13, 0.12, 0.72, 0, ulL, 0], [0.11, 0.45, 0.11, 0.12, 0.27, 0.02, llL, 0],
  ];
  const geos = [];
  for (const [w, h, d, x, y, z, bone, mi] of parts) {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.translate(x, y, z);
    const n = g.attributes.position.count, bi = bones.indexOf(bone);
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? bi : 0)), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    g.userData.mi = mi;
    geos.push(g);
  }
  // merge with material groups
  const merged = new THREE.BufferGeometry();
  const attrs = ['position', 'normal', 'uv', 'skinIndex', 'skinWeight'];
  let offset = 0;
  for (const a of attrs) {
    const arr = [];
    for (const g of geos) arr.push(...g.attributes[a].array);
    const src = geos[0].attributes[a];
    merged.setAttribute(a, a === 'skinIndex' ? new THREE.Uint16BufferAttribute(arr, src.itemSize) : new THREE.Float32BufferAttribute(arr, src.itemSize));
  }
  for (const g of geos) { merged.addGroup(offset, g.attributes.position.count, g.userData.mi); offset += g.attributes.position.count; }
  const mesh = new THREE.SkinnedMesh(merged, [main, skin]);
  mesh.name = 'Body';
  const arm = new THREE.Group();
  arm.name = 'CharacterArmature';
  arm.add(hips);
  arm.add(mesh);
  arm.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  // clips
  const T = [0, 0.25, 0.5, 0.75, 1];
  const rotX = (name, amps, dur = 1) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, T.map((t) => t * dur), T.flatMap((t, i) => new THREE.Quaternion().setFromEuler(new THREE.Euler(amps[i % amps.length], 0, 0)).toArray()));
  const swing = (a) => [0, a, 0, -a, 0];
  const clip = (name, tracks, dur = 1) => new THREE.AnimationClip('CharacterArmature|' + name, dur, tracks);
  const anims = [
    clip('Idle', [rotX('Chest', [0, 0.03, 0, -0.03, 0])]),
    clip('Idle_Gun', [rotX('UpperArm.R', [-1.3]), rotX('LowerArm.R', [-0.3]), rotX('Chest', [0, 0.02, 0, -0.02, 0])]),
    clip('Walk', [rotX('UpperLeg.R', swing(0.5)), rotX('UpperLeg.L', swing(-0.5)), rotX('UpperArm.L', swing(-0.4))]),
    clip('Run', [rotX('UpperLeg.R', swing(0.9)), rotX('UpperLeg.L', swing(-0.9)), rotX('UpperArm.L', swing(-0.8)), rotX('Spine', [0.2])], 0.7),
    clip('Jump_Idle', [rotX('UpperLeg.R', [-0.6]), rotX('LowerLeg.R', [0.9]), rotX('UpperLeg.L', [-0.2])]),
    clip('Death', [rotX('Hips', [0, -0.6, -1.2, -1.5, -1.57])], 1),
  ];
  return { scene: arm, animations: anims };
}

function gun() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: '#30353d', name: 'Gun' });
  const a = new THREE.MeshStandardMaterial({ color: '#d08030', name: 'Accent' });
  g.add(box(0.5, 0.1, 0.07, 0, 0, 0, m), box(0.3, 0.025, 0.025, 0.38, 0.02, 0, m), box(0.06, 0.14, 0.05, -0.05, -0.1, 0, a), box(0.14, 0.09, 0.06, -0.3, -0.02, 0, a));
  return { scene: g, animations: [] };
}

function tree() {
  const g = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ color: '#6b4a2e', name: 'Wood' });
  const leaf = new THREE.MeshStandardMaterial({ color: '#4f8a3a', name: 'Leaves' });
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, 2, 7), bark); t.position.y = 1;
  const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 0), leaf); c.position.y = 2.8;
  g.add(t, c);
  return { scene: g, animations: [] };
}

function rock() {
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#8a8478', name: 'Rock' }));
  m.scale.set(1.3, 0.8, 1);
  const g = new THREE.Group(); g.add(m);
  return { scene: g, animations: [] };
}

function bush() {
  const g = new THREE.Group();
  const leaf = new THREE.MeshStandardMaterial({ color: '#5a9a40', name: 'Leaves' });
  for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), leaf); s.position.set(i * 0.35 - 0.35, 0.4, (i % 2) * 0.2); g.add(s); }
  return { scene: g, animations: [] };
}

async function toGLB({ scene, animations }) {
  return new GLTFExporter().parseAsync(scene, { binary: true, animations });
}

function b64(buf) {
  let s = '';
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

window.makeFixtures = async () => {
  const out = {};
  for (const [name, fn] of Object.entries({ character, gun, tree, rock, bush })) out[name + '.glb'] = b64(await toGLB(fn()));
  return out;
};
window.fixturesReady = true;
