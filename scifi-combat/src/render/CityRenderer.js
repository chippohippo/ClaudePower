// CityRenderer: the night city of a `?map=city` match (src/game/frontline/City.js). It draws the
// cover BattlefieldRenderer leaves to it (boxes marked render: 'city') and everything that only
// shows, and it lights the night (docs/ART_DIRECTION.md, "The night city").
//  * Buildings: one instanced box per building, its facades a window grid worked out in the
//    shader from the box's own size (bays from the corners, storeys from the foot): dark glass,
//    a share of the windows lit warm or cool, shopfronts on the ground floor, blown-out windows
//    in the shelled ones. A skyline of towers beyond the map's edge in the same mesh.
//  * Sidewalks (the blocks' slabs), road markings (centre dashes, crosswalks), street lamps (the
//    post, an emissive LED bar, a pool of light on the ground under it; some out, some failing),
//    the wrecks in their old paint or burned out (some on their roofs, a few still burning),
//    barricades (jersey barriers, containers, tank traps), dumpsters, planters, benches, the
//    park's trees, hedges and fountain, neon signs on the facades, red lights on the tall roofs,
//    searchlights sweeping the sky from behind both lines.
//  * Real lights: a handful of spot lights shining down from the working lamps nearest the action
//    (moved every few frames), so soldiers walking under a lamp are lit by it, and a few point
//    lights in the burning wrecks nearest it.
// One draw call per kind of thing; nothing per frame but the lights, the flicker and the fires.

import * as THREE from 'three';
import { wreckModels, WRECK_COLORS, BURNED, lampModels, jerseyModel, containerModel, CONTAINER_COLORS, hedgehogModel, propModels, treeModels, hedgeModel, fountainModel, signAtlas } from './CityKit.js';
import { concreteTexture, triplanar } from './CoverTextures.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const glsl = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };

/** Building colours by style: concrete, dark glass and metal, sandstone, pale panels. */
const STYLE = ['#5d5b58', '#2b313b', '#6d6150', '#7d8086'];

export class CityRenderer {
  /**
   * @param {THREE.Scene} scene
   * @param {object} map   generateFrontlineMap({ theme: 'city' })
   * @param {object} o     { planet (palette.json, its `city` lights), palette, fx: BattleFx (burning wrecks), lights: how many real lights }
   */
  constructor(scene, map, { planet, palette = null, fx = null, anisotropy = 4, lights = null } = {}) {
    this.scene = scene; this.map = map; this.city = map.city; this.fx = fx;
    this.L = planet.city ?? {};
    this.group = new THREE.Group();
    scene.add(this.group);
    this.time = 0;
    this.anisotropy = anisotropy;
    this.ground = (x, z) => map.terrain.height(x, z);
    this.#buildings();
    this.#sidewalks();
    this.#lamps();
    this.#wrecks();
    this.#barricades();
    this.#props();
    this.#signs();
    this.#markings();
    this.#beacons();
    this.#searchlights();
    this.#lightPool(lights ?? this.L.lights ?? 8);
  }

  dispose() { this.group.removeFromParent(); for (const l of [...this.lights, ...this.fireLights]) { l.removeFromParent(); l.target?.removeFromParent(); } }

  // ---------------------------------------------------------------- buildings
  #buildings() {
    const C = this.city, M = this.map, warm = this.L.windowWarm ?? '#ffcf8a', cool = this.L.windowCool ?? '#9ac8ff';
    // The skyline: towers ringing the map beyond its edges (seeded), lit like the rest.
    const b = M.bounds, sky = [];
    let s = (M.seed ?? 1) * 7717 + 3;
    const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const W = b.maxX - b.minX, D = b.maxZ - b.minZ, n = Math.round((W + D) / 9);
    for (let k = 0; k < n; k++) {
      const side = Math.floor(r() * 4), t = r(), out = 20 + r() * r() * 420;
      const x = side < 2 ? b.minX - 60 + t * (W + 120) : side === 2 ? b.minX - out : b.maxX + out;
      const z = side < 2 ? (side === 0 ? b.minZ - out : b.maxZ + out) : b.minZ - 60 + t * (D + 120);
      const w = 14 + r() * 34, d = 14 + r() * 34, h = 25 + r() * r() * 240;
      sky.push({ x, z, w, d, h, seed: Math.floor(r() * 1e6) });
    }
    const n0 = C.buildings.length, count = n0 + sky.length;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const aB = new Float32Array(count * 4);
    // Rough and barely metallic: along a street you see the walls at a grazing angle, where a
    // glossier facade would mirror the aurora-lit sky into a wash.
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.93, metalness: 0.04, envMapIntensity: 0.55 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aB;\nvarying vec3 vLocal;\nvarying vec3 vScale;\nvarying vec4 vB;\nvarying vec3 vObjN;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  vLocal = position; vB = aB; vObjN = normal;
  vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vLocal;
varying vec3 vScale;
varying vec4 vB;
varying vec3 vObjN;
float cityHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    // The facade: a window grid from the building's own corners and foot (vB: seed, lit share, damage, glow).
    vec3 n = vObjN;
    float wall = 1.0 - step(0.5, abs(n.y));
    bool alongZ = abs(n.x) > 0.5;
    float wallW = alongZ ? vScale.z : vScale.x;
    float u = (alongZ ? vLocal.z : vLocal.x) * wallW + wallW * 0.5;
    float v = (vLocal.y + 0.5) * vScale.y;
    float bay = 2.6, storey = 3.6;
    float nb = max(1.0, floor((wallW - 1.0) / bay));
    float bu = (u - (wallW - nb * bay) * 0.5) / bay, bv = v / storey;
    vec2 cell = vec2(floor(bu), floor(bv)), f = fract(vec2(bu, bv));
    float face = n.x * 3.0 + n.z * 7.0 + 11.0;
    float win = wall * step(0.0, bu) * step(bu, nb) * step(0.15, f.x) * step(f.x, 0.85) * step(0.3, f.y) * step(f.y, 0.88) * step(1.0, cell.y) * step(v, vScale.y - 1.0);
    float h = cityHash(cell + vec2(vB.x * 0.0137 + face, vB.x * 0.0071 - face));
    float blown = win * vB.z * step(0.72, cityHash(cell * 1.7 + vec2(vB.x * 0.01, face)));
    float lit = win * step(1.0 - vB.y, h) * (1.0 - blown);
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.022, 0.026, 0.034), vec3(0.0), blown), win);
    // Storey lines and grime streaks under the windows.
    diffuseColor.rgb *= wall > 0.5 ? (1.0 - 0.18 * step(0.97, f.y) - 0.12 * step(f.x, 0.15) * step(0.5, cityHash(cell + 5.3))) : 0.55;
    // Shopfronts: a lit band in some ground floors.
    float bayS = floor(u / 6.0), shop = wall * step(0.4, v) * step(v, 3.0) * step(0.18, fract(u / 6.0)) * step(fract(u / 6.0), 0.9);
    float shopLit = shop * step(0.55, cityHash(vec2(bayS + face, vB.x * 0.003)));
    vec3 wc = mix(${glsl(warm)}, ${glsl(cool)}, step(0.62, cityHash(cell + 3.1 + face)));
    totalEmissiveRadiance += wc * lit * (0.55 + 0.6 * cityHash(cell + 7.7)) * vB.w;
    totalEmissiveRadiance += mix(${glsl(warm)}, ${glsl(cool)}, cityHash(vec2(bayS, face))) * shopLit * 0.45 * vB.w;
  }`);
    };
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const put = (i, x0, y0, z0, x1, y1, z1, color, seed, lit, dmg, glow) => {
      _m.compose(_p.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), _q.identity(), _s.set(x1 - x0, y1 - y0, z1 - z0));
      mesh.setMatrixAt(i, _m);
      mesh.setColorAt(i, _c.set(color));
      aB.set([seed % 1000, lit, dmg, glow], i * 4);   // a small seed: the shader hashes it, and an interpolated big one jitters per pixel
    };
    C.buildings.forEach((bd, i) => {
      const B = bd.box;
      put(i, B.min.x, B.min.y + 0.25, B.min.z, B.max.x, B.max.y, B.max.z, STYLE[bd.style], bd.seed, bd.damaged ? bd.lit * 0.5 : bd.lit, bd.damaged ? 1 : 0, 1);
    });
    sky.forEach((t, k) => {
      const g = this.ground(Math.max(b.minX, Math.min(b.maxX, t.x)), Math.max(b.minZ, Math.min(b.maxZ, t.z)));
      put(n0 + k, t.x - t.w / 2, g - 1, t.z - t.d / 2, t.x + t.w / 2, g + t.h, t.z + t.d / 2, STYLE[t.seed % 4], t.seed, 0.16 + (t.seed % 7) * 0.035, 0, 1.15);
    });
    geo.setAttribute('aB', new THREE.InstancedBufferAttribute(aB, 4));
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    this.group.add(mesh);
    this.buildingMesh = mesh;
    this.skylineTops = sky.map((t) => ({ x: t.x, y: this.ground(Math.max(b.minX, Math.min(b.maxX, t.x)), Math.max(b.minZ, Math.min(b.maxZ, t.z))) + t.h, z: t.z, tall: t.h > 90 }));
  }

  /** The blocks' sidewalk slabs: paving, a kerb you can see. */
  #sidewalks() {
    const blocks = this.city.blocks;
    const tex = concreteTexture(); tex.anisotropy = this.anisotropy;
    const mat = triplanar(new THREE.MeshStandardMaterial({ color: '#4a4844', roughness: 0.95 }), tex, 0.45, 0.6);
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, blocks.length);
    blocks.forEach((k, i) => {
      const B = k.slab;
      _m.compose(_p.set((B.min.x + B.max.x) / 2, (B.min.y + B.max.y) / 2, (B.min.z + B.max.z) / 2), _q.identity(), _s.set(B.max.x - B.min.x, B.max.y - B.min.y, B.max.z - B.min.z));
      mesh.setMatrixAt(i, _m);
    });
    mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.renderOrder = -2;
    this.group.add(mesh);
  }

  // ---------------------------------------------------------------- lamps and their light
  #lamps() {
    const L = this.L, lamps = this.city.lamps, M = lampModels();
    const cool = new THREE.Color(L.lampCool ?? '#cfe2ff'), warm = new THREE.Color(L.lampWarm ?? '#ffb35c');
    const post = new THREE.InstancedMesh(M.post, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.5 }), lamps.length);
    const head = new THREE.InstancedMesh(M.head, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), lamps.length);
    // The pools are drawn right after the ground and the sidewalks (and before anything else): their
    // light lands on those alone, and a soldier's boots under the plane draw over it.
    const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: radial(), blending: THREE.AdditiveBlending, depthWrite: false, color: '#ffffff' }), lamps.length);
    this.lampInfo = lamps.map((l, i) => {
      const y = l.y;   // the sidewalk it stands on (or the park's ground)
      const yaw = Math.atan2(l.nx, l.nz);
      _m.compose(_p.set(l.x, y, l.z), _q.setFromAxisAngle(UP, yaw), _s.set(1, 1, 1));
      post.setMatrixAt(i, _m); head.setMatrixAt(i, _m);
      const lx = l.x + l.nx * M.reach, lz = l.z + l.nz * M.reach, gy = this.ground(lx, lz) + 0.22;
      _m.compose(_p.set(lx, gy, lz), _q.identity(), _s.set(12, 1, 12));
      pool.setMatrixAt(i, _m);
      const col = (l.warm ? warm : cool).clone();
      return { l, col, light: new THREE.Vector3(lx, y + M.height - 0.2, lz), on: l.state !== 'out', flicker: l.state === 'flicker', seed: i * 1.37 };
    });
    Object.assign(this, { lampHead: head, lampPool: pool });
    for (let i = 0; i < lamps.length; i++) this.#lampColor(i, 1);
    post.castShadow = true; post.frustumCulled = head.frustumCulled = pool.frustumCulled = false;
    pool.renderOrder = -1;
    this.group.add(post, head, pool);
  }

  #lampColor(i, k) {
    const info = this.lampInfo[i];
    const on = info.on ? k : 0;
    this.lampHead.setColorAt(i, _c.copy(info.col).multiplyScalar(on > 0 ? 2.6 * on : 0.04));
    this.lampPool.setColorAt(i, _c.copy(info.col).multiplyScalar(0.3 * on * (this.L.pool ?? 1)));
  }

  /**
   * A few real lights kept on what's nearest the action: spots under the lamps (a lamp's head
   * shines down, so the facade beside it isn't lit above it) and points in the fires.
   */
  #lightPool(n) {
    this.lights = []; this.fireLights = [];
    for (let k = 0; k < n; k++) {
      const l = new THREE.SpotLight('#ffffff', 0, 30, 1.05, 0.65, 1.6);
      this.scene.add(l, l.target);
      this.lights.push(l);
    }
    for (let k = 0; k < Math.max(2, Math.round(n / 3)); k++) {
      const l = new THREE.PointLight(FIRE, 0, 24, 1.6);
      this.scene.add(l);
      this.fireLights.push(l);
    }
    this.lightT = 0;
  }

  // ---------------------------------------------------------------- the wrecks
  #wrecks() {
    const W = this.city.wrecks, models = wreckModels();
    const by = new Map();
    for (const w of W) { if (!by.has(w.type)) by.set(w.type, []); by.get(w.type).push(w); }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35 });
    this.burning = [];
    for (const [type, list] of by) {
      const mesh = new THREE.InstancedMesh(models[type].geo, mat, list.length);
      list.forEach((w, i) => {
        const B = w.box, cx = (B.min.x + B.max.x) / 2, cz = (B.min.z + B.max.z) / 2, y = this.ground(cx, cz);
        const h = B.max.y - B.min.y - 0.25;
        if (w.roof) { _e.set(0, w.yaw, Math.PI); _q.setFromEuler(_e); _p.set(cx, y + h, cz); }
        else { _q.setFromAxisAngle(UP, w.yaw); _p.set(cx, y, cz); }
        _m.compose(_p, _q, _s.set(1, 1, 1));
        mesh.setMatrixAt(i, _m);
        mesh.setColorAt(i, _c.set(w.burned ? BURNED : WRECK_COLORS[w.color % WRECK_COLORS.length]).multiplyScalar(w.burned ? 1 : 0.8));
        if (w.burning) this.burning.push({ x: cx, y: y + Math.min(1.4, h), z: cz, r: Math.min(1.2, (B.max.x - B.min.x) * 0.25 + 0.4), seed: w.seed });
      });
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }

  #barricades() {
    const bars = this.city.barricades;
    const jer = bars.filter((b) => b.kind === 'jersey'), con = bars.filter((b) => b.kind === 'container');
    const jm = new THREE.InstancedMesh(jerseyModel(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), Math.max(1, jer.length));
    jm.count = jer.length;
    jer.forEach((b, i) => {
      const B = b.box, len = B.max.z - B.min.z;
      _m.compose(_p.set((B.min.x + B.max.x) / 2, B.min.y + 0.25, (B.min.z + B.max.z) / 2), _q.identity(), _s.set(1, 1, len / 3));
      jm.setMatrixAt(i, _m);
    });
    const cm = new THREE.InstancedMesh(containerModel(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.4 }), Math.max(1, con.length));
    cm.count = con.length;
    con.forEach((b, i) => {
      const B = b.box, len = B.max.z - B.min.z;
      _m.compose(_p.set((B.min.x + B.max.x) / 2, B.min.y + 0.25, (B.min.z + B.max.z) / 2), _q.identity(), _s.set(1, 1, len / 6));
      cm.setMatrixAt(i, _m);
      cm.setColorAt(i, _c.set(CONTAINER_COLORS[b.color % CONTAINER_COLORS.length]));
    });
    for (const m of [jm, cm]) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; this.group.add(m); }
  }

  #props() {
    const P = this.city.props, models = propModels(), trees = treeModels();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.1 });
    const inst = (geo, list, place, material = mat) => {
      if (!list.length) return null;
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((p, i) => { place(p, _m, i, mesh); mesh.setMatrixAt(i, _m); });
      mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    };
    const atBox = (p, yaw = 0, sx = 1, sy = 1, sz = 1) => { const B = p.box; return _m.compose(_p.set((B.min.x + B.max.x) / 2, B.min.y + 0.25, (B.min.z + B.max.z) / 2), _q.setFromAxisAngle(UP, yaw), _s.set(sx, sy, sz)); };
    inst(models.dumpster, P.filter((p) => p.kind === 'dumpster'), (p) => atBox(p, p.yaw ?? 0));
    inst(models.planter, P.filter((p) => p.kind === 'planter'), (p) => atBox(p));
    inst(models.bench, P.filter((p) => p.kind === 'bench'), (p) => atBox(p, p.yaw ?? 0));
    inst(hedgehogModel(), P.filter((p) => p.kind === 'hedgehog'), (p) => atBox(p, p.yaw ?? 0));
    inst(hedgeModel(), P.filter((p) => p.kind === 'hedge'), (p) => { const B = p.box; return atBox(p, 0, B.max.x - B.min.x, 1.15, B.max.z - B.min.z); });
    // The park's trees: trunks, and crowns in a few dark greens (none on the burned ones).
    const T = this.city.trees;
    inst(trees.trunk, T, (t) => _m.compose(_p.set(t.x, this.ground(t.x, t.z) - 0.1, t.z), _q.setFromAxisAngle(UP, (t.seed % 628) / 100), _s.set(t.s, t.s, t.s)));
    const crowns = T.filter((t) => !t.burned);
    const cm = inst(trees.crown, crowns, (t) => _m.compose(_p.set(t.x, this.ground(t.x, t.z) - 0.1, t.z), _q.setFromAxisAngle(UP, (t.seed % 628) / 100), _s.set(t.s, t.s * (0.9 + (t.seed % 7) * 0.04), t.s)));
    if (cm) crowns.forEach((t, i) => cm.setColorAt(i, _c.set(['#1b2b1a', '#22301c', '#1a2620', '#2a3320'][t.seed % 4])));
    // The fountain.
    const F = this.city.fountain;
    if (F) {
      const f = new THREE.Mesh(fountainModel(F.r * 0.75), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.2 }));
      f.position.set(F.x, this.ground(F.x, F.z), F.z);
      f.castShadow = f.receiveShadow = true;
      this.group.add(f);
    }
  }

  // ---------------------------------------------------------------- neon
  #signs() {
    const S = this.city.signs, colors = (this.L.neon ?? ['#2ef2ff', '#ff3fb4', '#ffb030', '#a65cff', '#5cff9a']).map((c) => new THREE.Color(c));
    const tex = signAtlas();
    if (!S.length || !tex) return;
    const geo = new THREE.PlaneGeometry(1, 1);
    const aSign = new Float32Array(S.length * 2);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aSign;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vMapUv = vec2((uv.x + aSign.x) * 0.5, 1.0 - (1.0 - uv.y + aSign.y) * 0.25);');
    };
    const mesh = new THREE.InstancedMesh(geo, mat, S.length);
    this.signInfo = [];
    S.forEach((sg, i) => {
      const B = sg.building.box, cx = (B.min.x + B.max.x) / 2, cz = (B.min.z + B.max.z) / 2;
      // faces: 0 -x, 1 +x, 2 -z, 3 +z
      const n = [[-1, 0], [1, 0], [0, -1], [0, 1]][sg.face];
      const x = n[0] ? (n[0] < 0 ? B.min.x - 0.08 : B.max.x + 0.08) : cx + sg.u, z = n[1] ? (n[1] < 0 ? B.min.z - 0.08 : B.max.z + 0.08) : cz + sg.u;
      const yaw = Math.atan2(n[0], n[1]);
      _e.set(0, yaw, sg.vertical ? Math.PI / 2 : 0);
      _m.compose(_p.set(x, sg.y, z), _q.setFromEuler(_e), sg.vertical ? _s.set(sg.h, sg.w, 1) : _s.set(sg.w, sg.h, 1));
      mesh.setMatrixAt(i, _m);
      aSign[i * 2] = sg.design % 2; aSign[i * 2 + 1] = Math.floor(sg.design / 2) % 4;
      this.signInfo.push({ col: colors[sg.color % colors.length], state: sg.state, seed: i * 2.17 });
      mesh.setColorAt(i, _c.copy(colors[sg.color % colors.length]).multiplyScalar(sg.state === 'out' ? 0.05 : 2.2));
    });
    geo.setAttribute('aSign', new THREE.InstancedBufferAttribute(aSign, 2));
    mesh.frustumCulled = false; mesh.renderOrder = 3;
    this.group.add(mesh);
    this.signMesh = mesh;
  }

  /** Centre dashes down every street, crosswalks at the crossings. */
  #markings() {
    const C = this.city, quads = [];
    for (const s of C.segs) for (let t = s.from + 3; t < s.to - 3; t += 6) quads.push(s.axis === 'x' ? [t, s.at, 3, 0.16] : [s.at, t, 0.16, 3]);
    for (const c of C.crossings) for (const side of [-1, 1]) {
      // Across the avenue, either side of the cross street.
      const x = c.x + side * 8.5;
      for (let k = -5; k <= 5; k++) quads.push([x, c.z + k * 1.2, 3, 0.55]);
    }
    const craters = this.map.craters ?? [];
    const keep = quads.filter(([x, z]) => !craters.some((cr) => Math.hypot(cr.x - x, cr.z - z) < cr.r + 1));
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#77746c', roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), Math.max(1, keep.length));
    mesh.count = keep.length;
    keep.forEach(([x, z, w, d], i) => { _m.compose(_p.set(x, this.ground(x, z) + 0.03, z), _q.identity(), _s.set(w, 1, d)); mesh.setMatrixAt(i, _m); });
    mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.renderOrder = -2;
    this.group.add(mesh);
  }

  /** Red lights on the tall roofs (the city's own and the skyline's), blinking out of step. */
  #beacons() {
    const tops = [
      ...this.city.buildings.filter((b) => b.storeys >= 10).map((b) => ({ x: (b.box.min.x + b.box.max.x) / 2, y: b.box.max.y + 0.4, z: (b.box.min.z + b.box.max.z) / 2 })),
      ...this.skylineTops.filter((t) => t.tall),
    ];
    if (!tops.length) { this.beacons = null; return; }
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), tops.length);
    tops.forEach((t, i) => { _m.compose(_p.set(t.x, t.y, t.z), _q.identity(), _s.set(1, 1, 1)); mesh.setMatrixAt(i, _m); mesh.setColorAt(i, _c.set('#ff2a1a')); });
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.beacons = { mesh, n: tops.length };
  }

  /** Searchlights behind both lines, sweeping the sky. */
  #searchlights() {
    const col = new THREE.Color(this.L.searchlight ?? '#c8d6ff');
    const geo = new THREE.CylinderGeometry(5, 0.3, 260, 20, 1, true).translate(0, 130, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { col: { value: col } },
      vertexShader: 'varying float vH; varying vec3 vN; varying vec3 vV; void main() { vH = position.y / 260.0; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 col; varying float vH; varying vec3 vN; varying vec3 vV; void main() { float edge = pow(abs(dot(vN, vV)), 1.5); gl_FragColor = vec4(col * edge * (1.0 - vH) * (1.0 - vH) * 0.07, 1.0); }',
    });
    const hq = this.map.hq ?? [];
    this.beams = [];
    hq.forEach((h, k) => {
      for (const dz of [-0.28, 0.28]) {
        const m = new THREE.Mesh(geo, mat);
        const z = h.z + dz * (this.map.bounds.maxZ - this.map.bounds.minZ);
        m.position.set(h.x + (k === 0 ? -12 : 12), this.ground(h.x, z), z);
        m.frustumCulled = false;
        this.group.add(m);
        this.beams.push({ m, phase: k * 2.1 + dz * 7, speed: 0.11 + 0.04 * (k + dz) });
      }
    });
  }

  // ---------------------------------------------------------------- per frame
  /**
   * @param {number} dt
   * @param {THREE.Camera} camera
   * @param {THREE.Vector3} focus  where the action is (the player): the real lights go to the lamps
   *   and fires nearest it, the fires burn near it
   */
  update(dt, camera, focus = camera.position) {
    this.time += dt;
    const t = this.time;
    // Failing lamps and signs stutter.
    for (let i = 0; i < this.lampInfo.length; i++) {
      const L = this.lampInfo[i];
      if (!L.flicker) continue;
      const k = Math.sin(t * 23 + L.seed * 9) > 0.55 || Math.sin(t * 3.1 + L.seed) > 0.85 ? 0.08 : 1;
      if (k !== L.k) { L.k = k; this.#lampColor(i, k); this.lampHead.instanceColor.needsUpdate = this.lampPool.instanceColor.needsUpdate = true; }
    }
    if (this.signMesh) {
      let dirty = false;
      this.signInfo.forEach((s, i) => {
        if (s.state !== 'flicker') return;
        const k = Math.sin(t * 17 + s.seed * 5) > 0.7 ? 0.1 : 2.2;
        if (k !== s.k) { s.k = k; this.signMesh.setColorAt(i, _c.copy(s.col).multiplyScalar(k)); dirty = true; }
      });
      if (dirty) this.signMesh.instanceColor.needsUpdate = true;
    }
    if (this.beacons) {
      const B = this.beacons;
      for (let i = 0; i < B.n; i++) B.mesh.setColorAt(i, _c.set('#ff2a1a').multiplyScalar(Math.sin(t * 2.4 + i * 1.7) > 0.2 ? 3 : 0.15));
      B.mesh.instanceColor.needsUpdate = true;
    }
    for (const b of this.beams) {
      const a = b.phase + t * b.speed;
      b.m.rotation.order = 'YXZ';
      b.m.rotation.set(0.32 + 0.22 * Math.sin(a * 1.3), a, 0);   // leaning out from vertical, swinging round
    }
    // The fires nearest the action burn (particles), and the real lights go to what's nearest.
    if (this.fx) for (const f of this.burning) if (Math.abs(f.x - focus.x) + Math.abs(f.z - focus.z) < 160) this.fx.fire([f.x, f.y, f.z], dt * 0.8, f.r, 1, f);
    this.lightT -= dt;
    if (this.lightT <= 0) {
      this.lightT = 0.25;
      const away = (x, z) => Math.abs(x - focus.x) + Math.abs(z - focus.z);
      this.lit = this.lampInfo.filter((L) => L.on).sort((a, b) => away(a.light.x, a.light.z) - away(b.light.x, b.light.z)).slice(0, this.lights.length);
      this.litFires = this.burning.slice().sort((a, b) => away(a.x, a.z) - away(b.x, b.z)).slice(0, this.fireLights.length);
    }
    this.lights.forEach((l, k) => {
      const L = this.lit?.[k];
      if (!L) { l.intensity = 0; return; }
      l.position.copy(L.light); l.target.position.set(L.light.x, L.light.y - 7, L.light.z); l.color.copy(L.col);
      l.intensity = 34 * (L.flicker ? L.k ?? 1 : 1);
    });
    this.fireLights.forEach((l, k) => {
      const f = this.litFires?.[k];
      if (!f) { l.intensity = 0; return; }
      l.position.set(f.x, f.y + 1.2, f.z);
      l.intensity = 26 * (0.75 + 0.25 * Math.sin(t * 19 + k) * Math.sin(t * 7.3 + k * 2));
    });
  }
}

const FIRE = new THREE.Color('#ff7a2a');

/** A soft round pool of light (white: the instance colour tints it). */
function radial() {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.15)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
