// CityFuture: what makes the city read as the future (palette.json planet `city.future`; the
// Cyberpunk pass, docs/ART_DIRECTION.md). Presentation only, seeded from the map, nothing in the sim.
//  * Ad screens: giant animated screens on the megatowers' faces toward the city and on the tall
//    buildings' street fronts. Sixteen made-up brands drawn into one atlas (adAtlas); each screen
//    shows one, through LED rows and scanlines, some scrolling, now and then a glitch. Emissive, so
//    they bloom, and fogged, so the far ones melt into the haze.
//  * Flying traffic: cars on sky lanes over the avenues and cross streets and round the edge,
//    each with a white headlight bar, red tail lights and a neon underglow.
//  * Cables: power and data lines slung across the streets between the facades, sagging.
// One draw call each.

import * as THREE from 'three';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * The city's buildings bucketed by 16 m cells: `at(x, z)` is the building standing there (taller
 * than `minH`), `open(B, face)` whether a face (0 -x, 1 +x, 2 -z, 3 +z) looks out on open ground.
 */
export function buildingIndex(buildings, minH = 7) {
  const cells = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
  for (const bd of buildings) {
    const B = bd.box;
    if (B.max.y - B.min.y < minH) continue;
    for (let i = Math.floor(B.min.x / 16); i <= Math.floor(B.max.x / 16); i++) for (let j = Math.floor(B.min.z / 16); j <= Math.floor(B.max.z / 16); j++) {
      const k = key(i, j); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(B);
    }
  }
  const at = (x, z) => (cells.get(key(Math.floor(x / 16), Math.floor(z / 16))) ?? []).find((B) => x > B.min.x - 0.3 && x < B.max.x + 0.3 && z > B.min.z - 0.3 && z < B.max.z + 0.3) ?? null;
  const open = (B, face, d = 4) => {
    const cx = (B.min.x + B.max.x) / 2, cz = (B.min.z + B.max.z) / 2;
    const x = face === 0 ? B.min.x - d : face === 1 ? B.max.x + d : cx, z = face === 2 ? B.min.z - d : face === 3 ? B.max.z + d : cz;
    return !at(x, z);
  };
  return { at, open };
}

/** The ads: a 4 x 4 atlas of tall cells (256 x 512), made-up brands, drawn once. */
export function adAtlas() {
  const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!cv) return null;
  cv.width = 1024; cv.height = 2048;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 1024, 2048);
  const W = 256, H = 512;
  const cell = (i, draw) => { const x = (i % 4) * W, y = Math.floor(i / 4) * H; g.save(); g.translate(x, y); g.beginPath(); g.rect(4, 4, W - 8, H - 8); g.clip(); draw(); g.restore(); };
  const grad = (a, b, c = null) => { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, a); if (c) gr.addColorStop(0.55, c); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, W, H); };
  const text = (s, size, x, y, col, { rot = 0, weight = 800, align = 'center', glow = 0 } = {}) => {
    g.save(); g.translate(x, y); g.rotate(rot);
    g.font = `${weight} ${size}px system-ui, sans-serif`; g.textAlign = align; g.textBaseline = 'middle';
    if (glow) { g.shadowColor = col; g.shadowBlur = glow; }
    g.fillStyle = col; g.fillText(s, 0, 0); g.restore();
  };
  const circle = (x, y, r, col, fill = true, w = 6) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); if (fill) { g.fillStyle = col; g.fill(); } else { g.strokeStyle = col; g.lineWidth = w; g.stroke(); } };
  const poly = (pts, col, fill = true, w = 6) => { g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); if (fill) { g.fillStyle = col; g.fill(); } else { g.strokeStyle = col; g.lineWidth = w; g.stroke(); } };
  // 0 KAIRO: a face in profile, an eye of light.
  cell(0, () => {
    grad('#2a0638', '#ff3fa8', '#7a1aa0');
    circle(150, 210, 92, '#ffd0e6');
    poly([[58, 210], [30, 250], [64, 262], [70, 300], [120, 300]], '#ffd0e6');
    g.fillStyle = '#ff3fa8'; g.fillRect(150, 118, 92, 62);
    poly([[118, 200], [178, 190], [150, 214]], '#1ad6ff');
    circle(150, 202, 8, '#ffffff');
    text('KAIRO', 74, 128, 400, '#ffffff', { glow: 20 });
    text('SEE MORE', 30, 128, 452, '#ffe0f0', { weight: 600 });
  });
  // 1 VOLT: a can and a bolt.
  cell(1, () => {
    grad('#04363a', '#0a0f14');
    g.fillStyle = '#e8ff3a'; g.beginPath(); g.roundRect(68, 92, 120, 250, 26); g.fill();
    g.fillStyle = '#0b0b0b'; g.fillRect(68, 120, 120, 14); g.fillRect(68, 300, 120, 14);
    poly([[140, 150], [100, 230], [130, 230], [112, 300], [162, 210], [132, 210]], '#0b0b0b');
    text('VOLT', 88, 128, 410, '#e8ff3a', { glow: 26 });
    text('NO SLEEP', 30, 128, 466, '#7ff8ff', { weight: 600 });
  });
  // 2 NIMBUS 9: rings.
  cell(2, () => {
    grad('#050a2a', '#0b2a6a');
    for (let k = 0; k < 5; k++) circle(128, 200, 30 + k * 20, k % 2 ? '#1ad6ff' : '#8ff4ff', false, 7);
    circle(128, 200, 18, '#ffffff');
    text('NIMBUS', 62, 128, 380, '#d8f8ff', { glow: 18 });
    text('9', 90, 128, 452, '#1ad6ff', { glow: 22 });
  });
  // 3 RAMEN 24: a bowl and chopsticks.
  cell(3, () => {
    grad('#2a0404', '#100202', '#5a0a06');
    g.fillStyle = '#ff5a2a'; g.beginPath(); g.arc(128, 220, 92, 0, Math.PI); g.fill();
    g.strokeStyle = '#ffd0a0'; g.lineWidth = 8; g.beginPath(); g.moveTo(80, 90); g.lineTo(150, 214); g.moveTo(110, 82); g.lineTo(170, 214); g.stroke();
    for (let k = 0; k < 3; k++) { g.strokeStyle = 'rgba(255,220,180,0.6)'; g.lineWidth = 5; g.beginPath(); g.moveTo(96 + k * 30, 200); g.bezierCurveTo(80 + k * 30, 170, 116 + k * 30, 150, 100 + k * 30, 120); g.stroke(); }
    text('RAMEN', 70, 128, 380, '#ffb04a', { glow: 18 });
    text('24', 96, 128, 456, '#ff3a2a', { glow: 26 });
  });
  // 4 PULSE: a heartbeat line.
  cell(4, () => {
    grad('#020a06', '#04140c');
    g.strokeStyle = '#3aff8a'; g.lineWidth = 7; g.shadowColor = '#3aff8a'; g.shadowBlur = 18; g.beginPath();
    g.moveTo(10, 220); g.lineTo(80, 220); g.lineTo(100, 150); g.lineTo(128, 300); g.lineTo(150, 190); g.lineTo(170, 220); g.lineTo(246, 220); g.stroke(); g.shadowBlur = 0;
    text('PULSE', 72, 128, 400, '#c8ffe0', { glow: 16 });
    text('LIVE LONGER', 26, 128, 456, '#3aff8a', { weight: 600 });
  });
  // 5 SOMA: a capsule.
  cell(5, () => {
    grad('#f4d8ec', '#c06aa8');
    g.save(); g.translate(128, 210); g.rotate(-0.6);
    g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(-110, -40, 110, 80, 40); g.fill();
    g.fillStyle = '#ff2a8a'; g.beginPath(); g.roundRect(0, -40, 110, 80, 40); g.fill(); g.restore();
    text('SOMA', 86, 128, 390, '#4a0a3a');
    text('BE CALM', 32, 128, 454, '#4a0a3a', { weight: 600 });
  });
  // 6 ORBIT: a ringed planet.
  cell(6, () => {
    grad('#12062a', '#3a0a4a');
    circle(128, 200, 70, '#ff8a2a');
    g.save(); g.translate(128, 200); g.scale(1, 0.32); circle(0, 0, 118, '#ffd06a', false, 10); g.restore();
    text('ORBIT', 76, 128, 392, '#ffd06a', { glow: 18 });
    text('TICKETS NOW', 26, 128, 454, '#ffb0ff', { weight: 600 });
  });
  // 7 HALO: a ring of light.
  cell(7, () => {
    grad('#000000', '#101018');
    circle(128, 200, 88, '#ffffff', false, 16);
    g.shadowColor = '#9ad8ff'; g.shadowBlur = 30; circle(128, 200, 88, '#9ad8ff', false, 6); g.shadowBlur = 0;
    text('HALO', 82, 128, 390, '#ffffff', { glow: 22 });
    text('ALWAYS ON', 28, 128, 452, '#9ad8ff', { weight: 600 });
  });
  // 8 TETRA: hexagons.
  cell(8, () => {
    grad('#0a0018', '#1a0030');
    g.strokeStyle = '#ff3fd0'; g.lineWidth = 5; g.shadowColor = '#ff3fd0'; g.shadowBlur = 12;
    for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) {
      const x = 48 + c * 80 + (r % 2) * 40, y = 50 + r * 56;
      g.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k + Math.PI / 6; g.lineTo(x + Math.cos(a) * 30, y + Math.sin(a) * 30); } g.closePath(); g.stroke();
    }
    g.shadowBlur = 0;
    text('TETRA', 78, 128, 420, '#ffffff', { glow: 22 });
  });
  // 9 DRIFT: a car in a wedge of speed lines.
  cell(9, () => {
    grad('#1a0206', '#04040c', '#3a0410');
    for (let k = 0; k < 9; k++) { g.fillStyle = k % 2 ? '#ff2a4a' : '#1ad6ff'; g.fillRect(0, 120 + k * 18, 120 + k * 12, 5); }
    poly([[60, 260], [110, 222], [190, 216], [236, 240], [236, 268], [60, 276]], '#f0f0f8');
    circle(100, 278, 18, '#111'); circle(200, 278, 18, '#111');
    text('DRIFT', 80, 128, 400, '#ff2a4a', { glow: 20 });
    text('DRIVE IT LOUD', 24, 128, 456, '#ffffff', { weight: 600 });
  });
  // 10 SYNTH: a robot head.
  cell(10, () => {
    grad('#00141a', '#003a44');
    g.fillStyle = '#9af8ff'; g.beginPath(); g.roundRect(64, 100, 128, 150, 18); g.fill();
    g.fillStyle = '#002028'; g.fillRect(84, 150, 88, 30);
    circle(108, 165, 9, '#ff3fa8'); circle(150, 165, 9, '#ff3fa8');
    g.fillStyle = '#9af8ff'; g.fillRect(122, 72, 12, 30); circle(128, 68, 12, '#ff3fa8');
    text('SYNTH', 78, 128, 388, '#9af8ff', { glow: 20 });
    text('HIRE ONE TODAY', 22, 128, 452, '#ffffff', { weight: 600 });
  });
  // 11 VANTA: a black triangle.
  cell(11, () => {
    grad('#e8e8f0', '#9898b0');
    poly([[128, 80], [230, 300], [26, 300]], '#0a0a10');
    poly([[128, 140], [190, 270], [66, 270]], '#e8e8f0', false, 6);
    text('VANTA', 78, 128, 392, '#0a0a10');
    text('DISAPPEAR', 30, 128, 452, '#2a2a3a', { weight: 600 });
  });
  // 12 NOVA: a starburst.
  cell(12, () => {
    grad('#24064a', '#5a0a8a');
    g.fillStyle = '#ffe84a'; g.beginPath();
    for (let k = 0; k < 24; k++) { const a = Math.PI * 2 * k / 24, r = k % 2 ? 46 : 112; g.lineTo(128 + Math.cos(a) * r, 200 + Math.sin(a) * r); }
    g.closePath(); g.fill(); circle(128, 200, 40, '#ffffff');
    text('NOVA', 88, 128, 392, '#ffffff', { glow: 24 });
    text('GO FURTHER', 28, 128, 454, '#ffe84a', { weight: 600 });
  });
  // 13 ECHO: an equaliser.
  cell(13, () => {
    grad('#020208', '#0a0a1a');
    const cols = ['#ff3fa8', '#a65cff', '#1ad6ff', '#3aff8a', '#ffe84a'];
    for (let k = 0; k < 9; k++) { const h = 40 + ((k * 73) % 200); g.fillStyle = cols[k % 5]; g.fillRect(18 + k * 25, 300 - h, 18, h); }
    text('ECHO', 88, 128, 392, '#ffffff', { glow: 20 });
    text('HEAR EVERYTHING', 22, 128, 452, '#1ad6ff', { weight: 600 });
  });
  // 14 LUXE: a diamond.
  cell(14, () => {
    grad('#000000', '#1a1206');
    poly([[128, 90], [204, 170], [128, 300], [52, 170]], '#e8c46a');
    poly([[128, 90], [204, 170], [52, 170]], '#fff0c0');
    text('LUXE', 86, 128, 392, '#e8c46a', { glow: 16 });
    text('YOU EARNED IT', 24, 128, 452, '#fff0c0', { weight: 600 });
  });
  // 15 ZERO-G: arrows up.
  cell(15, () => {
    grad('#00182a', '#00365a');
    for (let k = 0; k < 3; k++) poly([[128, 70 + k * 70], [200, 140 + k * 70], [170, 140 + k * 70], [128, 100 + k * 70], [86, 140 + k * 70], [56, 140 + k * 70]], k === 0 ? '#ffffff' : '#4aa8ff');
    text('ZERO-G', 70, 128, 400, '#ffffff', { glow: 20 });
    text('JUMP CLUB', 30, 128, 456, '#4aa8ff', { weight: 600 });
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * More neon at street level (the Cyberpunk density): blade signs and boards low on the street
 * faces, in the same shape as City.js `signs` (CityRenderer draws them all as one).
 */
export function streetSigns(buildings, share = 0.6, seed = 1) {
  let s = (seed * 48271 + 11) >>> 0;
  const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const R = (a, b) => a + (b - a) * r(), idx = buildingIndex(buildings, 5), out = [];
  for (const bd of buildings) {
    if (r() > share) continue;
    const B = bd.box, faces = [0, 1, 2, 3].filter((f) => idx.open(B, f, 3));
    for (let k = 0; k < 1 + Math.floor(r() * 3) && faces.length; k++) {
      const face = faces[Math.floor(r() * faces.length)], vertical = r() < 0.6;
      const fw = face < 2 ? B.max.z - B.min.z : B.max.x - B.min.x;
      const sw = vertical ? R(0.9, 1.4) : Math.min(fw * 0.7, R(2.5, 5)), sh = vertical ? R(3, 7) : R(1, 1.8);
      const u = R(-fw / 2 + sw / 2 + 0.4, fw / 2 - sw / 2 - 0.4), y = B.min.y + R(3.4, 9);
      if (fw < sw + 1 || y + sh / 2 > B.max.y - 0.5) continue;
      out.push({ building: bd, face, u, y, w: sw, h: sh, vertical, design: Math.floor(r() * 8), color: Math.floor(r() * 5), state: r() < 0.08 ? 'flicker' : 'on' });
    }
  }
  return out;
}

export class CityFuture {
  /**
   * @param {THREE.Object3D} group   where to add the meshes
   * @param {object} map             generateFrontlineMap({ theme: 'city' })
   * @param {object} o { F: the planet's `city.future`, neon: colours, towers: the megatowers
   *                    [{ x, z, w, d, h }], buildings: the city's own [{ box }], ground(x, z) }
   */
  constructor(group, map, { F = {}, neon = ['#2ef2ff', '#ff3fb4', '#a65cff', '#ffb030', '#ff4a3a'], towers = [], buildings = [], ground = () => 0 } = {}) {
    this.group = group; this.map = map; this.F = F; this.ground = ground; this.buildings = buildings;
    this.index = buildingIndex(buildings);
    this.neon = neon.map((c) => new THREE.Color(c));
    let s = ((map.seed ?? 1) * 92821 + 17) >>> 0;
    this.rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    this.time = 0;
    this.#screens(towers, buildings);
    this.#traffic(F.traffic ?? 50);
    this.#cables(F.cables ?? 1);
  }

  // ---------------------------------------------------------------- ad screens
  #screens(towers, buildings) {
    const tex = adAtlas();
    if (!tex) return;
    const r = this.rand, list = [], b = this.map.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    // A face of a box toward a point: its centre, outward normal and width.
    const faceToward = (B, x, z) => {
      const mx = (B.x0 + B.x1) / 2, mz = (B.z0 + B.z1) / 2, dx = x - mx, dz = z - mz;
      if (Math.abs(dx) / (B.x1 - B.x0) > Math.abs(dz) / (B.z1 - B.z0)) return { x: dx > 0 ? B.x1 : B.x0, z: mz, nx: Math.sign(dx) || 1, nz: 0, w: B.z1 - B.z0 };
      return { x: mx, z: dz > 0 ? B.z1 : B.z0, nx: 0, nz: Math.sign(dz) || 1, w: B.x1 - B.x0 };
    };
    // The megatowers: one or two big screens on the face toward the city.
    for (const t of towers) {
      if (r() > (this.F.screens ?? 0.6)) continue;
      const f = faceToward({ x0: t.x - t.w / 2, x1: t.x + t.w / 2, z0: t.z - t.d / 2, z1: t.z + t.d / 2 }, cx, cz);
      const w = Math.min(f.w * (0.45 + r() * 0.3), 46), h = Math.min(w * (1.5 + r() * 1.2), t.h * 0.55);
      const y = t.y0 + t.h * (0.35 + r() * 0.35);
      list.push({ ...f, y, w, h });
      if (r() < 0.35 && t.h > 160) list.push({ ...f, y: y + h * 0.5 + 30 + r() * 30, w: w * 0.7, h: w * 0.7 * (1.2 + r() * 0.6) });
    }
    // The city's tall buildings: a screen on the street front, above the shopfronts.
    for (const bd of buildings) {
      const B = bd.box, H = B.max.y - B.min.y;
      if (H < 20 || r() > (this.F.streetScreens ?? 0.3)) continue;
      const box = { x0: B.min.x, x1: B.max.x, z0: B.min.z, z1: B.max.z };
      // On a face that looks out on a street (not into the next building).
      const faces = [0, 1, 2, 3].filter((f) => this.index.open(B, f));
      if (!faces.length) continue;
      const face = faces[Math.floor(r() * faces.length)], mx = (box.x0 + box.x1) / 2, mz = (box.z0 + box.z1) / 2;
      const dir = [[-1, 0], [1, 0], [0, -1], [0, 1]][face];
      const f = faceToward(box, mx + dir[0] * 1000, mz + dir[1] * 1000);
      const w = Math.min(f.w * 0.6, 7 + r() * 7), h = Math.min(w * (1.4 + r()), H - 10);
      if (h < 6) continue;
      list.push({ ...f, y: B.min.y + 7 + h / 2 + r() * Math.max(0, H - h - 12), w, h });
    }
    if (!list.length) return;
    const geo = new THREE.PlaneGeometry(1, 1);
    const aAd = new Float32Array(list.length * 4);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1, 1, 1).multiplyScalar(this.F.screenGain ?? 2.2), toneMapped: false, fog: true });
    this.adTime = { value: 0 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.adTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aAd;\nvarying vec4 vAd;\nvarying vec2 vAdUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vAd = aAd; vAdUv = uv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec4 vAd;\nvarying vec2 vAdUv;')
        .replace('#include <map_fragment>', `
  {
    // One ad from the atlas, through the screen: LED rows, scanlines, a scroll, a glitch now and then.
    vec2 a = vAdUv;
    float t = uTime + vAd.w * 17.0;
    if (vAd.z > 0.5) a.y = fract(a.y - t * 0.04);
    float row = floor(a.y * 48.0);
    float glitch = step(0.992, fract(sin(row * 12.9898 + floor(t * 6.0) * 78.233) * 43758.5453));
    a.x = fract(a.x + glitch * 0.06);
    a = clamp(a, 0.012, 0.988);
    vec4 ad = texture2D(map, vec2((a.x + vAd.x) * 0.25, 1.0 - ((1.0 - a.y) + vAd.y) * 0.25));
    float led = 0.72 + 0.28 * smoothstep(0.15, 0.5, abs(fract(vAdUv.y * 180.0) - 0.5) * 2.0);
    float scan = 0.88 + 0.12 * sin((vAdUv.y + t * 0.15) * 40.0);
    float flick = 1.0 - 0.5 * step(0.985, fract(t * 0.37 + vAd.w));
    diffuseColor.rgb *= ad.rgb * led * scan * flick;
  }`);
    };
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((q, i) => {
      _q.setFromAxisAngle(UP, Math.atan2(q.nx, q.nz));
      _m.compose(_p.set(q.x + q.nx * 0.2, q.y, q.z + q.nz * 0.2), _q, _s.set(q.w, q.h, 1));
      mesh.setMatrixAt(i, _m);
      const k = Math.floor(r() * 16);
      aAd.set([k % 4, Math.floor(k / 4), r() < 0.3 ? 1 : 0, r()], i * 4);
    });
    geo.setAttribute('aAd', new THREE.InstancedBufferAttribute(aAd, 4));
    mesh.frustumCulled = false;
    this.screens = mesh;
    this.group.add(mesh);
  }

  // ---------------------------------------------------------------- flying traffic
  #traffic(n) {
    if (!(n > 0)) return;
    const r = this.rand, C = this.map.city, b = this.map.bounds, pad = 380;
    const lanes = [];
    for (const z of C.avenues) lanes.push({ axis: 'x', at: z, from: b.minX - pad, to: b.maxX + pad });
    for (const x of C.cross) if (r() < 0.5) lanes.push({ axis: 'z', at: x, from: b.minZ - pad, to: b.maxZ + pad });
    // The edge: a ring road in the sky beyond the map.
    for (const z of [b.minZ - 90, b.maxZ + 90]) lanes.push({ axis: 'x', at: z, from: b.minX - pad, to: b.maxX + pad, high: true });
    for (const x of [b.minX - 90, b.maxX + 90]) lanes.push({ axis: 'z', at: x, from: b.minZ - pad, to: b.maxZ + pad, high: true });
    this.cars = Array.from({ length: n }, () => {
      const L = lanes[Math.floor(r() * lanes.length)], dir = r() < 0.5 ? 1 : -1;
      return { L, dir, off: dir * (3 + r() * 2.5), y: (L.high ? 120 : 48) + r() * 70, s: L.from + r() * (L.to - L.from), v: 24 + r() * 26, bob: r() * 6.28, neon: Math.floor(r() * this.neon.length), paint: r() };
    });
    // Bodies: a sleek hull, a canopy, four thruster pods (forward is -Z).
    const hull = new THREE.CapsuleGeometry(0.75, 3.2, 4, 10).rotateX(Math.PI / 2).scale(1.25, 0.55, 1);
    const canopy = new THREE.SphereGeometry(0.62, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1.9).translate(0, 0.32, 0.2);
    const parts = [hull, canopy];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(new THREE.CylinderGeometry(0.3, 0.34, 0.45, 10).translate(sx * 1.15, -0.1, sz * 1.5));
    const body = mergeSimple(parts);
    const paints = ['#1c1d24', '#2a2f3a', '#d8d8e0', '#5a1a2a', '#14304a', '#3a2a50'];
    this.carBody = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, metalness: 0.6 }), n);
    this.carLights = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, fog: true }), n * 3);
    this.cars.forEach((c, i) => {
      this.carBody.setColorAt(i, _c.set(paints[Math.floor(c.paint * paints.length)]));
      this.carLights.setColorAt(i * 3, _c.set('#fff6e8').multiplyScalar(5));
      this.carLights.setColorAt(i * 3 + 1, _c.set('#ff2a20').multiplyScalar(5));
      this.carLights.setColorAt(i * 3 + 2, _c.copy(this.neon[c.neon]).multiplyScalar(2.5));
    });
    for (const m of [this.carBody, this.carLights]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(m); }
    this.#moveCars(0);
  }

  #moveCars(dt) {
    if (!this.cars) return;
    const t = this.time;
    this.cars.forEach((c, i) => {
      const L = c.L, span = L.to - L.from;
      c.s += c.v * c.dir * dt;
      if (c.s > L.to) c.s -= span; else if (c.s < L.from) c.s += span;
      const y = c.y + Math.sin(t * 0.7 + c.bob) * 0.6;
      const x = L.axis === 'x' ? c.s : L.at + c.off, z = L.axis === 'x' ? L.at + c.off : c.s;
      // Forward (-Z in the model) along the lane, the way it's going.
      const yaw = L.axis === 'x' ? (c.dir > 0 ? -Math.PI / 2 : Math.PI / 2) : (c.dir > 0 ? Math.PI : 0);
      _q.setFromAxisAngle(UP, yaw);
      this.carBody.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1)));
      // Lights in the car's frame: the head bar at the nose, tail lights, the underglow.
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      this.carLights.setMatrixAt(i * 3, _m.compose(_p.set(x + fx * 2.35, y + 0.05, z + fz * 2.35), _q, _s.set(1.5, 0.1, 0.1)));
      this.carLights.setMatrixAt(i * 3 + 1, _m.compose(_p.set(x - fx * 2.35, y + 0.1, z - fz * 2.35), _q, _s.set(1.7, 0.14, 0.1)));
      this.carLights.setMatrixAt(i * 3 + 2, _m.compose(_p.set(x, y - 0.42, z), _q, _s.set(1.4, 0.06, 3.6)));
    });
    this.carBody.instanceMatrix.needsUpdate = true;
    this.carLights.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- cables
  #cables(k) {
    if (!(k > 0)) return;
    const r = this.rand, C = this.map.city, pts = [];
    const facadeY = (x, z) => this.ground(x, z);
    // Slung between facades only: both ends need a building just behind them.
    const wallAt = (x, z) => !!this.index.at(x, z);
    for (const seg of C.segs ?? []) {
      const len = seg.to - seg.from, half = (seg.axis === 'x' ? 14 : 11) / 2 + 3.4;
      for (let u = seg.from + 4 + r() * 6; u < seg.to - 4; u += (7 + r() * 9) / k) {
        const n = 1 + (r() < 0.35 ? 1 : 0);
        for (let j = 0; j < n; j++) {
          const a = u + (r() - 0.5) * 2, bpos = u + (r() - 0.5) * 6, h0 = 6 + r() * 9, h1 = 6 + r() * 9, sag = 0.6 + r() * 1.8;
          const P0 = seg.axis === 'x' ? [a, seg.at - half] : [seg.at - half, a];
          const P1 = seg.axis === 'x' ? [bpos, seg.at + half] : [seg.at + half, bpos];
          const o0 = seg.axis === 'x' ? [P0[0], P0[1] - 1.5] : [P0[0] - 1.5, P0[1]], o1 = seg.axis === 'x' ? [P1[0], P1[1] + 1.5] : [P1[0] + 1.5, P1[1]];
          if (!wallAt(o0[0], o0[1]) || !wallAt(o1[0], o1[1])) continue;
          const y0 = facadeY(P0[0], P0[1]) + h0, y1 = facadeY(P1[0], P1[1]) + h1;
          let prev = null;
          for (let q = 0; q <= 10; q++) {
            const f = q / 10, x = P0[0] + (P1[0] - P0[0]) * f, z = P0[1] + (P1[1] - P0[1]) * f, y = y0 + (y1 - y0) * f - sag * 4 * f * (1 - f);
            if (prev) pts.push(prev[0], prev[1], prev[2], x, y, z);
            prev = [x, y, z];
          }
        }
      }
      void len;
    }
    if (!pts.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.cableLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#141219', fog: true }));
    this.cableLines.frustumCulled = false;
    this.group.add(this.cableLines);
  }

  update(dt) {
    this.time += dt;
    if (this.adTime) this.adTime.value = this.time;
    this.#moveCars(dt);
  }
}

/** Plain geometries (position, normal) merged into one. */
function mergeSimple(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
