// Procedural weapon models with real silhouettes: every major part is a side profile (a 2D shape
// with bevelled edges, cut-outs for stocks and trigger guards) extruded to its thickness, so guns
// read like the real thing instead of stacked boxes. Materials: gunmetal, polymer, a painted
// accent in the weapon's colour and a fine grain texture for roughness/bump. A small glowing
// ammo display sits on the back of the receiver (Apex-style), driven by setGunAmmo().
//
// Contract (shared with viewmodel.js / avatars): origin at the pistol grip, barrel along -Z, +Y up.
// Named parts animated by the viewmodel: mag, pump, bolt, stock, guard, brake.

import * as THREE from 'three';

// ---------------------------------------------------------------- materials
let grain = null;
function grainTexture() {
  if (grain) return grain;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d'), img = g.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 150 + Math.random() * 70 + (Math.random() < 0.02 ? 30 : 0);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grain = new THREE.CanvasTexture(c);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.repeat.set(6, 6);
  return grain;
}
const matCache = new Map();
function mats(tint, rarity, emissiveRare) {
  const key = tint + rarity + emissiveRare;
  if (matCache.has(key)) return matCache.get(key);
  const t = grainTexture();
  // the weapon colour is an accent, not a paint job: desaturated toward gunmetal for the large
  // painted parts, full colour only on the small inlays
  const muted = new THREE.Color(tint).lerp(new THREE.Color('#3b4048'), 0.62);
  const m = {
    metal: new THREE.MeshStandardMaterial({ color: '#3a3f47', roughness: 0.38, metalness: 0.75, roughnessMap: t, bumpMap: t, bumpScale: 0.6 }),
    dark: new THREE.MeshStandardMaterial({ color: '#1b1d21', roughness: 0.55, metalness: 0.45, roughnessMap: t }),
    polymer: new THREE.MeshStandardMaterial({ color: '#25282d', roughness: 0.78, metalness: 0.05, roughnessMap: t, bumpMap: t, bumpScale: 0.9 }),
    paint: new THREE.MeshStandardMaterial({ color: muted, roughness: 0.5, metalness: 0.35, roughnessMap: t, bumpMap: t, bumpScale: 0.3 }),
    accent: new THREE.MeshStandardMaterial({ color: tint, roughness: 0.45, metalness: 0.2 }),
    rare: new THREE.MeshStandardMaterial({ color: rarity, emissive: rarity, emissiveIntensity: emissiveRare, roughness: 0.4 }),
    glass: new THREE.MeshStandardMaterial({ color: '#0d1b24', roughness: 0.05, metalness: 0.9, emissive: '#06222e', emissiveIntensity: 0.6 }),
    brass: new THREE.MeshStandardMaterial({ color: '#b8893a', roughness: 0.3, metalness: 0.9 }),
  };
  matCache.set(key, m);
  return m;
}

// ---------------------------------------------------------------- geometry helpers
// side profile in (u = forward from the grip, v = up) metres → extruded across X, centred
function profile(points, width, bevel = 0.004, holes = []) {
  const s = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(u, v))));
  const geo = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, width - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.rotateY(Math.PI / 2); // shape u → -Z (forward), extrusion → X
  geo.computeVertexNormals();
  return geo;
}
const tube = (r, len, seg = 14, r2 = r) => { const g = new THREE.CylinderGeometry(r2, r, len, seg); g.rotateX(Math.PI / 2); return g; };
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// ---------------------------------------------------------------- ammo display
export function makeAmmoDisplay() {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 48;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.025), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
  mesh.userData.ammo = { c, tex, last: '' };
  mesh.name = 'ammoDisplay';
  return mesh;
}
export function setGunAmmo(gun, n, max) {
  const d = gun && gun.getObjectByName('ammoDisplay');
  if (!d) return;
  const a = d.userData.ammo, key = `${n}/${max}`;
  if (a.last === key) return;
  a.last = key;
  const g = a.c.getContext('2d');
  g.clearRect(0, 0, 96, 48);
  g.fillStyle = 'rgba(8,18,24,0.85)';
  g.fillRect(0, 0, 96, 48);
  const low = max > 0 && n / max <= 0.25;
  g.fillStyle = low ? '#ff5a3c' : '#9fe8ff';
  g.font = 'bold 34px Rajdhani, Arial';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 48, 22);
  g.fillStyle = low ? 'rgba(255,90,60,0.6)' : 'rgba(159,232,255,0.5)';
  g.fillRect(8, 40, 80 * (max ? n / max : 0), 4);
  a.tex.needsUpdate = true;
}

// ---------------------------------------------------------------- builders
// Returns { group, muzzleZ, barrelY, topY, len, fore } where fore is the handguard z for the left hand.
export function buildProceduralGun(w, id, att, rarityColor, tier) {
  const g = new THREE.Group();
  const M = mats(w.tint, rarityColor, tier > 0 ? 0.7 : 0.1);
  const add = (geo, mat, x = 0, y = 0, z = 0, name) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (name) m.name = name; m.castShadow = true; g.add(m); return m; };
  const P = (pts, wd, mat, opts = {}) => add(profile(pts, wd, opts.bevel ?? 0.004, opts.holes || []), mat, opts.x || 0, opts.y || 0, opts.z || 0, opts.name);
  const rail = (u0, u1, y, wd = 0.03) => { // picatinny rail with teeth
    add(box(wd, 0.008, u1 - u0), M.dark, 0, y, -(u0 + u1) / 2);
    for (let u = u0 + 0.008; u < u1; u += 0.016) add(box(wd + 0.004, 0.006, 0.008), M.dark, 0, y + 0.007, -u);
  };
  const grip = (u = 0) => P([[u + 0.02, -0.02], [u + 0.045, -0.02], [u + 0.01, -0.13], [u - 0.035, -0.135], [u - 0.03, -0.11], [u - 0.005, -0.02]], 0.032, M.polymer, { bevel: 0.006 });
  const triggerGuard = (u = 0) => {
    P([[u + 0.02, -0.02], [u + 0.1, -0.02], [u + 0.1, -0.065], [u + 0.025, -0.07]], 0.008, M.dark, { bevel: 0.001, holes: [[[u + 0.028, -0.028], [u + 0.092, -0.028], [u + 0.092, -0.058], [u + 0.032, -0.062]]] });
    add(box(0.006, 0.025, 0.006), M.metal, 0, -0.04, -(u + 0.055));
  };
  const cls = w.cls;
  const magLvl = att.mag || 0;
  let muzzleZ, barrelY, topY, len, fore;

  if (cls === 'Pistol') {
    const revolver = id === 'viper';
    len = revolver ? 0.3 : 0.22;
    // slide / frame
    P([[-0.04, 0.0], [len, 0.0], [len, 0.045], [len - 0.02, 0.06], [-0.03, 0.06], [-0.045, 0.045]], 0.03, M.metal, { name: 'slide' });
    P([[-0.03, -0.02], [len - 0.03, -0.02], [len - 0.03, 0.002], [-0.03, 0.002]], 0.028, M.polymer);
    for (let u = -0.025; u < 0.04; u += 0.008) add(box(0.031, 0.04, 0.002), M.dark, 0, 0.03, -u); // serrations
    if (revolver) add(tube(0.03, 0.06, 12), M.metal, 0, 0.025, -0.06);
    grip(0.0); triggerGuard(0.0);
    const mag = add(box(0.024, 0.1, 0.036), M.dark, 0, -0.08, 0.005, 'mag');
    mag.rotation.x = 0.25; mag.userData.base = mag.position.clone();
    add(tube(0.008, 0.02), M.dark, 0, 0.03, -len - 0.005);
    add(box(0.022, 0.004, 0.05), M.paint, 0, 0.061, -len * 0.55);
    muzzleZ = -len - 0.02; barrelY = 0.03; topY = 0.06; fore = 0.02;
  } else if (cls === 'Shotgun') {
    len = 0.86;
    // receiver + long barrel over a tube magazine
    P([[-0.08, -0.03], [0.22, -0.03], [0.24, 0.0], [0.24, 0.055], [-0.06, 0.06], [-0.1, 0.03]], 0.05, M.metal);
    add(tube(0.017, 0.62), M.metal, 0, 0.035, -0.55);
    add(tube(0.014, 0.5), M.dark, 0, -0.005, -0.5);
    const pump = P([[0.3, -0.035], [0.52, -0.035], [0.54, -0.01], [0.54, 0.02], [0.3, 0.02], [0.29, -0.01]], 0.06, M.polymer, { name: 'pump', bevel: 0.008 });
    for (let u = 0.32; u < 0.52; u += 0.025) add(box(0.062, 0.004, 0.008), M.dark, 0, -0.014, -u);
    pump.userData.base = pump.position.z;
    P([[-0.08, 0.04], [-0.06, -0.03], [-0.3, -0.11], [-0.42, -0.12], [-0.42, 0.0], [-0.3, 0.02]], 0.045, M.paint, { name: 'stock', bevel: 0.008, holes: [[[-0.14, -0.01], [-0.28, -0.07], [-0.33, -0.04], [-0.2, 0.0]]] });
    grip(0.0); triggerGuard(0.0);
    add(box(0.01, 0.012, 0.01), M.rare, 0, 0.06, -0.8);
    muzzleZ = -0.87; barrelY = 0.035; topY = 0.06; fore = 0.42;
  } else if (cls === 'Sniper' || cls === 'Marksman') {
    const sniper = cls === 'Sniper';
    len = sniper ? 1.18 : 0.98;
    P([[-0.06, -0.035], [0.32, -0.035], [0.36, -0.01], [0.36, 0.05], [-0.04, 0.055], [-0.08, 0.02]], 0.052, M.metal);
    // chassis / handguard with lightening slots
    const hg = sniper ? 0.7 : 0.62;
    P([[0.3, -0.045], [hg, -0.04], [hg + 0.02, -0.015], [hg + 0.02, 0.04], [0.3, 0.045]], 0.056, M.paint, { bevel: 0.006 });
    for (let u = 0.36; u < hg - 0.04; u += 0.07) add(box(0.058, 0.02, 0.035), M.dark, 0, 0.0, -u);
    add(tube(sniper ? 0.016 : 0.014, len - hg + 0.04, 14, sniper ? 0.013 : 0.012), M.metal, 0, 0.012, -(hg + (len - hg) / 2));
    if (sniper) add(tube(0.024, 0.08, 10), M.dark, 0, 0.012, -len - 0.02);
    // adjustable stock with cheek rest
    P([[-0.08, 0.05], [-0.08, -0.03], [-0.36, -0.1], [-0.44, -0.1], [-0.44, 0.06], [-0.3, 0.07]], 0.05, M.polymer, { name: 'stock', bevel: 0.008, holes: [[[-0.15, 0.0], [-0.3, -0.05], [-0.36, -0.04], [-0.36, 0.02], [-0.18, 0.025]]] });
    grip(0.0); triggerGuard(0.0);
    const mag = add(profile([[0.1, -0.03], [0.18, -0.03], [0.17, -0.13], [0.1, -0.13]], 0.04), M.dark, 0, 0, 0, 'mag');
    mag.userData.base = mag.position.clone();
    if (sniper) {
      const bolt = add(tube(0.008, 0.06), M.metal, 0.04, 0.04, 0.02, 'bolt');
      add(new THREE.SphereGeometry(0.014, 10, 8), M.metal, 0.07, 0.03, 0.03);
      bolt.userData.base = 0.02;
      // folded bipod
      add(box(0.008, 0.008, 0.2), M.dark, -0.02, -0.05, -(hg - 0.1)); add(box(0.008, 0.008, 0.2), M.dark, 0.02, -0.05, -(hg - 0.1));
    }
    rail(-0.02, 0.36, 0.058);
    muzzleZ = -len - (sniper ? 0.06 : 0.02); barrelY = 0.012; topY = 0.066; fore = hg - 0.12;
  } else {
    // AR / SMG / LMG / energy
    const smg = cls === 'SMG', lmg = cls === 'LMG';
    len = smg ? 0.52 : lmg ? 0.95 : 0.76;
    const rcv = smg ? 0.24 : 0.3;
    // receiver: upper + lower with an ejection port
    P([[-0.08, -0.04], [rcv, -0.04], [rcv + 0.02, -0.02], [rcv + 0.02, 0.055], [-0.05, 0.06], [-0.09, 0.03]], lmg ? 0.07 : 0.052, M.metal);
    add(box(lmg ? 0.072 : 0.054, 0.018, 0.07), M.dark, 0.0, 0.025, -0.12);
    // handguard (vented)
    const hg = smg ? 0.4 : lmg ? 0.72 : 0.58;
    const guard = P([[rcv, -0.045], [hg, -0.04], [hg + 0.015, -0.02], [hg + 0.015, 0.05], [rcv, 0.055]], lmg ? 0.068 : 0.056, M.paint, { name: 'guard', bevel: 0.006 });
    for (let u = rcv + 0.04; u < hg - 0.02; u += 0.05) add(box(lmg ? 0.07 : 0.058, 0.018, 0.022), M.dark, 0, 0.008, -u);
    // barrel + flash hider (or energy coils)
    const bl = len - hg + 0.04;
    add(tube(0.012, bl, 12), M.metal, 0, 0.012, -(hg + bl / 2));
    if (w.sound.zap) {
      for (let i = 0; i < 3; i++) add(new THREE.TorusGeometry(0.028, 0.008, 8, 18), new THREE.MeshStandardMaterial({ color: '#b7e34b', emissive: '#b7e34b', emissiveIntensity: 1.6 }), 0, 0.012, -(hg - 0.03 - i * 0.05));
    } else add(tube(0.017, 0.05, 6), M.dark, 0, 0.012, -(len + 0.01));
    if (lmg) {
      add(tube(0.03, 0.3, 10), M.dark, 0, 0.012, -(hg - 0.12)); // barrel shroud
      for (let k = 0; k < 4; k++) add(tube(0.031, 0.012, 10), M.metal, 0, 0.012, -(hg - 0.24 + k * 0.07));
    }
    // stock
    if (smg) P([[-0.08, 0.04], [-0.08, -0.02], [-0.26, -0.06], [-0.3, -0.06], [-0.3, 0.035], [-0.2, 0.045]], 0.04, M.polymer, { name: 'stock', bevel: 0.006, holes: [[[-0.12, 0.0], [-0.24, -0.035], [-0.26, 0.01]]] });
    else P([[-0.09, 0.045], [-0.09, -0.03], [-0.34, -0.1], [-0.4, -0.1], [-0.4, 0.05]], lmg ? 0.06 : 0.048, M.polymer, { name: 'stock', bevel: 0.008, holes: [[[-0.14, 0.01], [-0.3, -0.055], [-0.34, -0.05], [-0.34, 0.025]]] });
    grip(0.0); triggerGuard(0.0);
    // magazine: curved box mag, drum for the LMG, scaled by extended-mag level
    let mag;
    if (lmg) mag = add(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 18), M.paint, 0, -0.1, -0.16, 'mag'), mag.rotation.z = Math.PI / 2;
    else {
      const h = (smg ? 0.12 : 0.16) * (1 + magLvl * 0.14);
      mag = add(profile([[0.1, -0.03], [0.17, -0.03], [0.19 + h * 0.18, -0.03 - h], [0.115 + h * 0.18, -0.03 - h * 1.02]], 0.034, 0.003), M.dark, 0, 0, 0, 'mag');
    }
    mag.userData.base = mag.position.clone();
    if (smg) add(box(0.028, 0.08, 0.03), M.polymer, 0, -0.08, -(hg - 0.06)); // vertical foregrip
    if (lmg) { add(box(0.008, 0.008, 0.22), M.dark, -0.025, -0.06, -(hg - 0.05)); add(box(0.008, 0.008, 0.22), M.dark, 0.025, -0.06, -(hg - 0.05)); }
    rail(-0.04, rcv + 0.02, 0.062, lmg ? 0.036 : 0.03);
    muzzleZ = -(len + 0.04); barrelY = 0.012; topY = 0.07; fore = smg ? hg - 0.06 : hg - 0.12;
  }
  // weapon-colour inlay panels on both sides of the receiver
  if (cls !== 'Pistol') for (const sx of [-1, 1]) add(box(0.002, 0.018, 0.14), M.accent, sx * (cls === 'LMG' ? 0.036 : 0.027), 0.035, -0.04);
  // rarity accents: stripe on the receiver side + front sight tip glow
  add(box(0.002, 0.012, 0.09), M.rare, cls === 'LMG' ? 0.036 : 0.028, 0.0, -0.1);
  add(box(0.002, 0.012, 0.09), M.rare, cls === 'LMG' ? -0.036 : -0.028, 0.0, -0.1);
  // ammo display on the back of the receiver, facing the player
  const disp = makeAmmoDisplay();
  disp.position.set(0.0, topY - 0.015, 0.085 - (cls === 'Pistol' ? 0.03 : 0));
  disp.rotation.x = -0.35;
  if (cls !== 'Pistol') g.add(disp);
  return { group: g, muzzleZ, barrelY, topY, len, fore };
}
