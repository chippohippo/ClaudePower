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
// Buildings that come apart (Structures.js): each piece of a house, scaffold or skybridge knows its
// instance, so a piece shot away or come away disappears from its mesh, the pieces left round a
// hole take spare instances in the same mesh, and a piece that's been hit darkens with the damage
// it's taken. What comes away is CollapseViews' to draw, moving and at rest.

import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { wreckModels, WRECK_COLORS, BURNED, lampModels, jerseyModel, containerModel, CONTAINER_COLORS, hedgehogModel, propModels, treeModels, hedgeModel, fountainModel, signAtlas } from './CityKit.js';
import { concreteTexture, triplanar } from './CoverTextures.js';
import { snowCover } from './SnowCover.js';
import { CityFuture, streetSigns } from './CityFuture.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const RUBBLE_MAX = 1600;
const SOOT = new THREE.Color('#231f1c');
/** The colours structural pieces are drawn in (a house's walls take its facade's). */
const PIECE = { hfloor: '#8e8a82', balcony: '#8e8a82', hroof: '#8e8a82', hstair: '#5e5c58', hrail: '#2a2c31', bridge: '#77736c', brail: '#3a3d44', ramp: '#5d5850', deck: '#7a6448', sstair: '#5f646c' };
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const glsl = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };

/** Building colours by style: concrete, dark glass and metal, sandstone, pale panels. */
const STYLE = ['#5d5b58', '#2b313b', '#6d6150', '#7d8086'];

export class CityRenderer {
  /**
   * @param {THREE.Scene} scene
   * @param {object} map   generateFrontlineMap({ theme: 'city' })
   * @param {object} o     { planet (palette.json, its `city` lights and `snow`), palette, fx: BattleFx (burning wrecks), lights: how many real lights }
   */
  constructor(scene, map, { planet, palette = null, fx = null, anisotropy = 4, lights = null } = {}) {
    this.scene = scene; this.map = map; this.city = map.city; this.fx = fx;
    this.slots = new Map();          // structural box -> { mesh, i } (its instance)
    this.houseColor = new Map();     // house id -> facade colour
    this.L = planet.city ?? {};
    this.planet = planet;
    this.snow = planet.snow ?? null;   // lying on the roofs, sidewalks, barriers and wrecks (SnowCover)
    this.group = new THREE.Group();
    scene.add(this.group);
    this.time = 0;
    this.anisotropy = anisotropy;
    this.ground = (x, z) => map.terrain.height(x, z);
    this.#buildings();
    this.#houses();
    this.#extras();
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
    this.#outskirts();
    this.#rubble();
    this.off = [
      bus.on('world:coverDestroyed', (e) => { if (e.structural) this.#hide(e.cover); }),
      bus.on('world:coverAdded', (e) => { if (e.structural) this.#show(e.cover); }),
      bus.on('structure:hit', (e) => this.#wear(e.cover)),
    ];
    // The future: ad screens, flying traffic, cables over the streets (a planet's `city.future`).
    if (this.L.future) this.future = new CityFuture(this.group, map, { F: this.L.future, neon: this.L.neon, towers: this.megatowers, buildings: this.city.buildings, ground: this.ground });
  }

  dispose() { this.off?.forEach((f) => f()); this.group.removeFromParent(); for (const l of [...this.lights, ...this.fireLights, ...(this.roomPoints ?? [])]) { l.removeFromParent(); l.target?.removeFromParent(); } }

  /** Ground beyond the map's edge for the skyline to stand on (seen from above, or down a long avenue). */
  #outskirts() {
    const b = this.map.bounds, y = Math.min(this.ground(b.minX, b.minZ), this.ground(b.maxX, b.maxZ), this.ground(0, 0)) - 0.6;
    const g = this.planet.ground ?? {};
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: g.asphalt ?? g.dust ?? '#37383f', roughness: 1 }));
    mesh.position.set((b.minX + b.maxX) / 2, y, (b.minZ + b.maxZ) / 2);
    mesh.receiveShadow = false; mesh.renderOrder = -3;
    this.group.add(mesh);
  }

  // ---------------------------------------------------------------- buildings
  #buildings() {
    const C = this.city, M = this.map, warm = this.L.windowWarm ?? '#ffcf8a', cool = this.L.windowCool ?? '#9ac8ff';
    const winShare = this.L.windows ?? 1;   // how many of the windows are lit (dusk: fewer than at night)
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
    // The future (a planet's `city.future`): megatowers further out, stepping back as they rise,
    // their own height in neon; and neon trim on some of every kind of building (aF below).
    const FU = this.L.future, mega = [];
    if (FU) {
      for (let k = 0; k < (FU.towers ?? 30); k++) {
        const side = Math.floor(r() * 4), t = r(), out = 70 + r() * 520;
        const x = side < 2 ? b.minX - 140 + t * (W + 280) : side === 2 ? b.minX - out : b.maxX + out;
        const z = side < 2 ? (side === 0 ? b.minZ - out : b.maxZ + out) : b.minZ - 140 + t * (D + 280);
        const w = 26 + r() * 40, d = 26 + r() * 40, h = 130 + r() * r() * 320, seed = Math.floor(r() * 1e6);
        const g0 = this.ground(Math.max(b.minX, Math.min(b.maxX, x)), Math.max(b.minZ, Math.min(b.maxZ, z))) - 1;
        // One to three sections, each narrower and set back: a stepped crown.
        const parts = 1 + Math.floor(r() * 3);
        let y = g0, sw = w, sd = d;
        for (let p = 0; p < parts; p++) {
          const sh = p === parts - 1 ? h - (y - g0) : h * (0.45 + r() * 0.2) / parts * 1.6;
          if (sh < 12) break;
          mega.push({ x, z, w: sw, d: sd, y0: y, h: sh, seed: seed + p * 101, top: p === parts - 1, whole: { x, z, w, d, h, y0: g0 } });
          y += sh; sw *= 0.62 + r() * 0.2; sd *= 0.62 + r() * 0.2;
        }
      }
    }
    const n0 = C.buildings.length, count = n0 + sky.length + mega.length;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const aB = new Float32Array(count * 4), aF = new Float32Array(count * 4);
    const neonCols = (this.L.neon ?? ['#2ef2ff', '#ff3fb4', '#ffb030', '#a65cff', '#5cff9a']).slice(0, 5);
    while (neonCols.length < 5) neonCols.push(neonCols[neonCols.length - 1]);
    // Neon trim for one building: a colour, corner strips, vertical lines (their spacing), bands every N storeys.
    const trim = (big) => {
      if (!FU || r() > (big ? FU.megaTrim ?? 0.85 : FU.trim ?? 0.3)) return [0, 0, 0, 0];
      return [1 + Math.floor(r() * 5), r() < 0.7 ? 0.6 + r() * 0.6 : 0, r() < (big ? 0.45 : 0.2) ? 3 + Math.floor(r() * 4) * 1.5 : 0, r() < 0.5 ? 2 + Math.floor(r() * 5) : 0];
    };
    // Rough and barely metallic: along a street you see the walls at a grazing angle, where a
    // glossier facade would mirror the aurora-lit sky into a wash.
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.93, metalness: 0.04, envMapIntensity: 0.55 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aB;\nattribute vec4 aF;\nvarying vec3 vLocal;\nvarying vec3 vScale;\nvarying vec4 vB;\nvarying vec4 vF;\nvarying vec3 vObjN;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  vLocal = position; vB = aB; vF = aF; vObjN = normal;
  vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vLocal;
varying vec3 vScale;
varying vec4 vB;
varying vec4 vF;
varying vec3 vObjN;
uniform vec3 uNeon[5];
uniform float uFuture;
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
    // A shopfront's glass: mullions, the light strongest up under the fascia, some in the neon's colours.
    float shopH = cityHash(vec2(bayS, face));
    vec3 shopC = mix(${glsl(warm)}, ${glsl(cool)}, shopH);
    if (uFuture > 0.5) shopC = mix(shopC, uNeon[int(fract(shopH * 7.13) * 4.99)], 0.55 * step(0.45, fract(shopH * 3.7)));
    float mull = step(0.05, fract(u / 1.6)) * step(0.06, abs(v - 2.2));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.03, 0.04), shopLit * 0.8);
    totalEmissiveRadiance += shopC * shopLit * mull * (0.2 + 0.55 * smoothstep(0.3, 2.9, v)) * vB.w;
    // Neon trim (vF: colour, corner strips, vertical lines' spacing, bands every N storeys) and a lit crown.
    if (vF.x > 0.5) {
      vec3 nc = uNeon[int(vF.x - 0.5)];
      float ew = min(u, wallW - u);
      float strip = wall * step(ew, 0.4) * vF.y;
      float lines = vF.z > 0.0 ? wall * step(fract(u / vF.z) * vF.z, 0.22) * step(7.0, v) * step(1.5, ew) : 0.0;
      float bands = vF.w > 0.0 ? wall * step(mod(v, vF.w * storey), 0.4) * step(4.0, v) : 0.0;
      float crown = wall * step(vScale.y - 2.2, v) * step(v, vScale.y - 1.2) * step(0.1, vF.y + vF.w);
      float top = (1.0 - wall) * step(0.5, n.y) * step(min(min(vLocal.x + 0.5, 0.5 - vLocal.x) * vScale.x, min(vLocal.z + 0.5, 0.5 - vLocal.z) * vScale.z), 0.5) * vF.y;
      diffuseColor.rgb *= 1.0 - 0.8 * max(strip, max(lines, bands));
      totalEmissiveRadiance += nc * (strip * 3.2 + lines * 1.7 + bands * 2.4 + crown * 2.8 + top * 2.0) * (0.85 + 0.15 * vB.w);
    }
  }`);
      sh.uniforms.uNeon = { value: neonCols.map((c) => new THREE.Color(c)) };
      sh.uniforms.uFuture = { value: FU ? 1 : 0 };
    };
    snowCover(mat, this.snow);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const put = (i, x0, y0, z0, x1, y1, z1, color, seed, lit, dmg, glow, f = [0, 0, 0, 0]) => {
      _m.compose(_p.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), _q.identity(), _s.set(x1 - x0, y1 - y0, z1 - z0));
      mesh.setMatrixAt(i, _m);
      mesh.setColorAt(i, _c.set(color));
      aB.set([seed % 1000, lit, dmg, glow], i * 4);   // a small seed: the shader hashes it, and an interpolated big one jitters per pixel
      aF.set(f, i * 4);
    };
    C.buildings.forEach((bd, i) => {
      const B = bd.box;
      put(i, B.min.x, B.min.y + 0.25, B.min.z, B.max.x, B.max.y, B.max.z, STYLE[bd.style], bd.seed, (bd.damaged ? bd.lit * 0.5 : bd.lit) * winShare, bd.damaged ? 1 : 0, 1, bd.damaged ? [0, 0, 0, 0] : trim(false));
    });
    sky.forEach((t, k) => {
      const g = this.ground(Math.max(b.minX, Math.min(b.maxX, t.x)), Math.max(b.minZ, Math.min(b.maxZ, t.z)));
      put(n0 + k, t.x - t.w / 2, g - 1, t.z - t.d / 2, t.x + t.w / 2, g + t.h, t.z + t.d / 2, STYLE[t.seed % 4], t.seed, (0.16 + (t.seed % 7) * 0.035) * winShare, 0, 1.15, trim(t.h > 90));
    });
    // Megatowers: dark glass and steel, more of their windows lit than the old blocks', trimmed alike up the whole stack.
    let mt = null;
    mega.forEach((t, k) => {
      if (k === 0 || mega[k - 1].whole !== t.whole) mt = trim(true);
      put(n0 + sky.length + k, t.x - t.w / 2, t.y0, t.z - t.d / 2, t.x + t.w / 2, t.y0 + t.h, t.z + t.d / 2, ['#2b313b', '#3a3f4a', '#23262e', '#4a4d58'][t.seed % 4], t.seed, (0.3 + (t.seed % 5) * 0.06) * winShare, 0, 1.25, mt);
    });
    geo.setAttribute('aB', new THREE.InstancedBufferAttribute(aB, 4));
    geo.setAttribute('aF', new THREE.InstancedBufferAttribute(aF, 4));
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    this.group.add(mesh);
    this.buildingMesh = mesh;
    this.skylineTops = sky.map((t) => ({ x: t.x, y: this.ground(Math.max(b.minX, Math.min(b.maxX, t.x)), Math.max(b.minZ, Math.min(b.maxZ, t.z))) + t.h, z: t.z, tall: t.h > 90 }));
    for (const t of mega) if (t.top) this.skylineTops.push({ x: t.x, y: t.y0 + t.h, z: t.z, tall: true });
    this.megatowers = [...new Set(mega.map((t) => t.whole))];
  }

  /**
   * The houses you can go into (Houses.js): their walls in the facade's colour, snow on the roof,
   * the parapets and the balconies (never on the floors inside), bare concrete stairs, metal rails,
   * and a lit panel in each room's ceiling, so the windows show who's home.
   */
  #houses() {
    const H = this.city.houses ?? [];
    if (!H.length) return;
    const tex = concreteTexture(); tex.anisotropy = this.anisotropy;
    const walls = [], roofs = [], floors = [], stairs = [], rails = [], lights = [];
    for (const h of H) {
      const col = STYLE[h.style % STYLE.length];
      this.houseColor.set(h.id, col);
      // The ground floor's own floor over the sidewalk slab (so no snow lies indoors): drawn only.
      floors.push([{ min: { x: h.min.x + 0.3, y: h.base - 0.05, z: h.min.z + 0.3 }, max: { x: h.max.x - 0.3, y: h.base + 0.015, z: h.max.z - 0.3 } }, '#8e8a82']);
      for (const b of h.parts.wall) walls.push([b, col]);
      for (const b of h.parts.floor) (b.kind === 'hfloor' ? floors : roofs).push([b, '#8e8a82']);
      for (const b of h.parts.stair) stairs.push([b, '#5e5c58']);
      for (const b of h.parts.rail) rails.push([b, '#2a2c31']);
      for (const L of h.lights) lights.push(L);
    }
    // (Room to spare in each mesh: the pieces left round a shell hole are drawn in it too.)
    const batch = (list, mat, shadows = true, spare = 0) => {
      if (!list.length) return null;
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, list.length + spare);
      list.forEach(([b, col], i) => {
        _m.compose(_p.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2), _q.identity(), _s.set(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z));
        mesh.setMatrixAt(i, _m); mesh.setColorAt(i, _c.set(col));
        this.slots.set(b, { mesh, i });
      });
      mesh.count = list.length; mesh.userData.free = [];
      mesh.castShadow = shadows; mesh.receiveShadow = true; mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    };
    const concrete = (snow, scale = 0.45) => {
      const m = triplanar(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92 }), tex, scale, 0.5);
      return snow ? snowCover(m, this.snow) : m;
    };
    this.houseMeshes = {
      walls: batch(walls, concrete(true, 0.3), true, 600),
      roofs: batch(roofs, concrete(true), true, 160),
      floors: batch(floors, concrete(false), true, 240),
      stairs: batch(stairs, concrete(false), true, 40),
      rails: batch(rails, snowCover(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, metalness: 0.6 }), this.snow), false, 40),
    };
    // Ceiling panels: a glowing slab under each room's ceiling, warm or cool, some rooms dark.
    if (lights.length) {
      const warm = new THREE.Color(this.L.windowWarm ?? '#ffcf8a'), cool = new THREE.Color(this.L.windowCool ?? '#9ac8ff');
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), lights.length);
      lights.forEach((L, i) => {
        const hsh = Math.abs(Math.sin(L.x * 12.9898 + L.z * 78.233 + L.k * 37.7) * 43758.5453) % 1;
        _m.compose(_p.set(L.x, L.y - 0.03, L.z), _q.identity(), _s.set(Math.max(0.5, L.w * 0.55), 0.04, Math.max(0.5, L.d * 0.55)));
        mesh.setMatrixAt(i, _m);
        L.on = hsh >= 0.2; L.col = (hsh < 0.6 ? warm : cool);
        mesh.setColorAt(i, _c.copy(L.col).multiplyScalar(L.on ? 1.1 + hsh * 0.6 : 0.03));
      });
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.houseMeshes.lights = mesh;
      this.roomLights = lights.filter((L) => L.on);
    }
  }

  /**
   * Scaffolding (steel poles, plank decks, rails), skybridges (concrete decks with a neon strip
   * along each edge, rails; a broken one's fallen half a tilted slab over its rubble steps),
   * market stalls (counters, shelves, canopies in bright cloth trimmed in neon, crates) and
   * debris (concrete chunks lying askew). Instanced boxes, a few draw calls.
   */
  #extras() {
    const C = this.city, tex = concreteTexture(); tex.anisotropy = this.anisotropy;
    const neon = (this.L.neon ?? ['#2ef2ff', '#ff3fb4', '#ffb030', '#a65cff', '#5cff9a']).map((c) => new THREE.Color(c));
    const sets = { steel: [], plank: [], concrete: [], rubble: [], wood: [], cloth: [], glow: [] };
    const tread = (b, col) => Object.assign([new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y - 0.03, (b.min.z + b.max.z) / 2), new THREE.Vector3(b.max.x - b.min.x, 0.06, b.max.z - b.min.z), col, 0, 0], { box: b });
    // An axis-aligned box, or one turned (yaw about y, tilt about the box's x): [center, size, color, yaw, tilt].
    const ab = (b, col) => Object.assign([new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2), new THREE.Vector3(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z), col, 0, 0], { box: b });
    const rnd = (k) => { const x = Math.sin(k * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
    for (const sc of C.scaffolds ?? []) {
      for (const d of sc.parts.deck) sets.plank.push(ab(d, '#7a6448'));
      // Open steel treads (the sim's steps are solid to the deck below; drawn, they're grating).
      for (const st of sc.parts.stair) sets.steel.push(tread(st, '#5f646c'));
      // Poles up both edges every 2 m, rails at each level on the street side (drawn only).
      const span = sc.u1 - sc.u0, n = Math.max(2, Math.round(span / 2));
      for (let i = 0; i <= n; i++) for (const off of [0.15, sc.depth + 0.05]) {
        const u = sc.u0 + (span * i) / n, v = sc.at + sc.out * off, h = sc.top + 1.1 - sc.base;
        const [x, z] = sc.axis === 'x' ? [u, v] : [v, u];
        sets.steel.push([new THREE.Vector3(x, sc.base + h / 2, z), new THREE.Vector3(0.07, h, 0.07), '#9aa0a8', 0, 0]);
      }
      for (let l = 1; l <= sc.levels; l++) for (const dy of [0.5, 1.05]) {
        const y = sc.base + l * 2.4 + dy, v = sc.at + sc.out * (sc.depth + 0.05), u = (sc.u0 + sc.u1) / 2;
        const [x, z] = sc.axis === 'x' ? [u, v] : [v, u];
        sets.steel.push([new THREE.Vector3(x, y, z), sc.axis === 'x' ? new THREE.Vector3(span, 0.05, 0.05) : new THREE.Vector3(0.05, 0.05, span), '#9aa0a8', 0, 0]);
      }
    }
    for (const br of C.bridges ?? []) {
      for (const d of br.parts.deck) sets.concrete.push(ab(d, '#77736c'));
      for (const r of br.parts.rail) sets.steel.push(ab(r, '#3a3d44'));
      for (const r of br.parts.ramp) sets.rubble.push(ab(r, '#5d5850'));
      // Neon along both edges under the deck, in one of the city's colours.
      const d = br.parts.deck[0], col = neon[Math.floor(rnd(br.u) * neon.length)];
      for (const side of [0, 1]) {
        const g = br.axis === 'z'
          ? { min: { x: side ? d.max.x - 0.05 : d.min.x, y: d.min.y - 0.06, z: d.min.z }, max: { x: side ? d.max.x : d.min.x + 0.05, y: d.min.y, z: d.max.z } }
          : { min: { x: d.min.x, y: d.min.y - 0.06, z: side ? d.max.z - 0.05 : d.min.z }, max: { x: d.max.x, y: d.min.y, z: side ? d.max.z : d.min.z + 0.05 } };
        sets.glow.push(ab(g, col.clone().multiplyScalar(2.6)));
      }
      // A broken one's fallen half: a slab lying on the ramp, from the deck's end to the ground.
      if (br.ramp) {
        const [fx, fz] = br.ramp.from, [tx, tz] = br.ramp.to, run = Math.hypot(tx - fx, tz - fz), drop = br.ramp.y0 - br.ramp.y1;
        const len = Math.hypot(run, drop), tilt = Math.atan2(drop, run), yaw = Math.atan2(tx - fx, tz - fz);
        sets.concrete.push([new THREE.Vector3((fx + tx) / 2, (br.ramp.y0 + br.ramp.y1) / 2 - 0.05, (fz + tz) / 2), new THREE.Vector3(br.width - 0.3, 0.3, len), '#77736c', yaw, tilt]);
      }
    }
    const cloths = ['#c8322c', '#1f8c8c', '#e0b030', '#b03a8a', '#2f5fb0', '#e06a2a'];
    for (const mk of C.markets ?? []) {
      mk.parts.counter.forEach((c, i) => sets.wood.push(ab(c, ['#7a5a3a', '#3f6f6a', '#8a3a34', '#5a5a66'][Math.floor(rnd(c.min.x + c.min.z) * 4)])));
      for (const c of mk.parts.crate) sets.wood.push(ab(c, '#9a7a4a'));
      mk.stalls.forEach((st) => {
        const cb = st.canopy;
        sets.cloth.push(ab(cb, cloths[st.color % cloths.length]));
        // A warm lantern under the canopy, over the counter.
        sets.glow.push([new THREE.Vector3(st.x, cb.min.y - 0.25, st.z), new THREE.Vector3(0.22, 0.3, 0.22), new THREE.Color('#ffb060').multiplyScalar(3.2), 0, 0]);
        // Neon along the canopy's front edge.
        const [fx, fz] = st.face, g = fx
          ? { min: { x: fx > 0 ? cb.max.x - 0.05 : cb.min.x, y: cb.min.y - 0.05, z: cb.min.z }, max: { x: fx > 0 ? cb.max.x : cb.min.x + 0.05, y: cb.min.y, z: cb.max.z } }
          : { min: { x: cb.min.x, y: cb.min.y - 0.05, z: fz > 0 ? cb.max.z - 0.05 : cb.min.z }, max: { x: cb.max.x, y: cb.min.y, z: fz > 0 ? cb.max.z : cb.min.z + 0.05 } };
        sets.glow.push(ab(g, neon[st.sign % neon.length].clone().multiplyScalar(2.4)));
      });
    }
    for (const d of C.debris ?? []) for (const [i, b] of d.parts.entries()) {
      const e = ab(b, ['#6e6a62', '#5d5a54', '#7a756b'][i % 3]);
      e[3] = (rnd(b.min.x * 3.1 + b.min.z) - 0.5) * 0.5;      // lying a little askew
      sets.rubble.push(e);
    }
    const make = (list, mat, shadows = true, spare = 0) => {
      if (!list.length) return null;
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, list.length + spare);
      list.forEach((entry, i) => {
        const [c, sz, col, yaw, tilt] = entry;
        _e.set(tilt, yaw, 0, 'YXZ');
        mesh.setMatrixAt(i, _m.compose(c, _q.setFromEuler(_e), sz));
        mesh.setColorAt(i, col instanceof THREE.Color ? col : _c.set(col));
        if (entry.box?.st) this.slots.set(entry.box, { mesh, i });   // a piece of a scaffold or a skybridge
      });
      mesh.count = list.length; mesh.userData.free = [];
      mesh.castShadow = shadows; mesh.receiveShadow = true; mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    };
    const tri = (rough, metal = 0, scale = 0.45, snow = true) => {
      const m = triplanar(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: rough, metalness: metal }), tex, scale, 0.4);
      return snow ? snowCover(m, this.snow) : m;
    };
    this.extraMeshes = {
      steel: make(sets.steel, snowCover(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.45, metalness: 0.7 }), this.snow), true, 40),
      plank: make(sets.plank, snowCover(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }), this.snow), true, 40),
      concrete: make(sets.concrete, tri(0.9), true, 40),
      rubble: make(sets.rubble, tri(1, 0, 0.6), true, 20),
      wood: make(sets.wood, snowCover(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }), this.snow)),
      cloth: make(sets.cloth, snowCover(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, side: THREE.DoubleSide }), this.snow, 0.3)),   // (a dusting: the cloth's colour shows)
      glow: make(sets.glow, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), false),
    };
  }

  /** What comes down lies here: one mesh of concrete and steel, every slab and wall lying askew. */
  #rubble() {
    const tex = concreteTexture(); tex.anisotropy = this.anisotropy;
    const mat = snowCover(triplanar(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }), tex, 0.4, 0.5), this.snow);
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, RUBBLE_MAX);
    mesh.count = 0; mesh.userData.free = [];
    mesh.setColorAt(0, _c.set('#6e6a62'));
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    this.group.add(mesh);
    this.rubbleMesh = mesh;
  }

  /** The colour a structural piece is drawn in. */
  colorOf(b) {
    if (b.kind === 'hwall') return this.houseColor.get(b.house) ?? STYLE[0];
    if (b.kind === 'rubble') return b.rubble === 'metal' ? '#4a4d55' : ['#6e6a62', '#5d5a54', '#7a756b', '#66625c'][Math.floor(hash(b.min.x * 3.7 + b.min.z * 1.3) * 4)];
    return PIECE[b.kind] ?? '#77736c';
  }

  /** The mesh a structural piece of this kind is drawn in. */
  #meshFor(b) {
    if (b.kind === 'rubble') return this.rubbleMesh;
    const H = this.houseMeshes ?? {}, X = this.extraMeshes ?? {};
    switch (b.kind) {
      case 'hwall': return H.walls;
      case 'hroof': return H.roofs;
      case 'hfloor': case 'balcony': return H.floors;
      case 'hstair': return H.stairs;
      case 'hrail': return H.rails;
      case 'bridge': return X.concrete;
      case 'brail': case 'sstair': return X.steel;
      case 'deck': return X.plank;
      case 'ramp': return X.rubble;
      default: return null;
    }
  }

  /** A piece shot away or fallen: gone from its mesh (its instance free for another). */
  #hide(b) {
    const s = this.slots.get(b);
    if (!s) return;
    s.mesh.setMatrixAt(s.i, ZERO);
    s.mesh.instanceMatrix.needsUpdate = true;
    s.mesh.userData.free?.push(s.i);
    this.slots.delete(b);
  }

  /** A piece left round a hole, or one lying as rubble: drawn in its mesh (in a free instance). */
  #show(b) {
    if (b.render === 'body') return;   // (a body at rest's stand-in: CollapseViews draws the body)
    const mesh = this.#meshFor(b);
    if (!mesh || this.slots.has(b)) return;
    const free = mesh.userData.free ?? [];
    const i = free.length ? free.pop() : mesh.count < mesh.instanceMatrix.count ? mesh.count++ : -1;
    if (i < 0) return;
    _p.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
    _s.set(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
    // Rubble lies a little askew (its box stays square: you walk on the box).
    if (b.kind === 'rubble') _q.setFromEuler(_e.set((hash(b.min.x) - 0.5) * 0.08, (hash(b.min.z + 7) - 0.5) * 0.3, (hash(b.min.x + b.min.z) - 0.5) * 0.08));
    else _q.identity();
    mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    mesh.instanceMatrix.needsUpdate = true;
    this.slots.set(b, { mesh, i });
    this.#wear(b);
  }

  /** A piece's colour, sooted and darkened by the damage it's taken (worn through, it's near black): you see what's about to go. */
  #wear(b) {
    const s = this.slots.get(b);
    if (!s) return;
    const k = b.st ? 1 - Math.max(0, b.st.hp / b.st.max) : 0;
    s.mesh.setColorAt(s.i, _c.set(this.colorOf(b)).lerp(SOOT, Math.min(0.65, k * 0.9)));
    if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
  }

  /** The blocks' sidewalk slabs: paving, a kerb you can see. */
  #sidewalks() {
    const blocks = this.city.blocks;
    const tex = concreteTexture(); tex.anisotropy = this.anisotropy;
    const mat = snowCover(triplanar(new THREE.MeshStandardMaterial({ color: '#4a4844', roughness: 0.95 }), tex, 0.45, 0.6), this.snow);
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
    // The rooms nearest the action are lit by their ceiling panels (inside a house you can see).
    this.roomPoints = [];
    if (this.roomLights?.length) for (let k = 0; k < 3; k++) {
      const l = new THREE.PointLight('#ffd9a8', 0, 11, 1.6);
      this.scene.add(l);
      this.roomPoints.push(l);
    }
    this.lightT = 0;
  }

  // ---------------------------------------------------------------- the wrecks
  #wrecks() {
    const W = this.city.wrecks, models = wreckModels();
    const by = new Map();
    for (const w of W) { if (!by.has(w.type)) by.set(w.type, []); by.get(w.type).push(w); }
    const mat = snowCover(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35 }), this.snow);
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
    const jm = new THREE.InstancedMesh(jerseyModel(), snowCover(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), this.snow), Math.max(1, jer.length));
    jm.count = jer.length;
    jer.forEach((b, i) => {
      const B = b.box, len = B.max.z - B.min.z;
      _m.compose(_p.set((B.min.x + B.max.x) / 2, B.min.y + 0.25, (B.min.z + B.max.z) / 2), _q.identity(), _s.set(1, 1, len / 3));
      jm.setMatrixAt(i, _m);
    });
    const cm = new THREE.InstancedMesh(containerModel(), snowCover(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.4 }), this.snow), Math.max(1, con.length));
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
    const mat = snowCover(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.1 }), this.snow);
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
      const f = new THREE.Mesh(fountainModel(F.r * 0.75), snowCover(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.2 }), this.snow));
      f.position.set(F.x, this.ground(F.x, F.z), F.z);
      f.castShadow = f.receiveShadow = true;
      this.group.add(f);
    }
  }

  // ---------------------------------------------------------------- neon
  #signs() {
    const F = this.L.future, S = F ? [...this.city.signs, ...streetSigns(this.city.buildings, F.signs ?? 0.6, this.map.seed ?? 1)] : this.city.signs, colors = (this.L.neon ?? ['#2ef2ff', '#ff3fb4', '#ffb030', '#a65cff', '#5cff9a']).map((c) => new THREE.Color(c));
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
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), snowCover(new THREE.MeshStandardMaterial({ color: '#77746c', roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), this.snow, 0.8), Math.max(1, keep.length));
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
    this.future?.update(dt);
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
      if (this.roomPoints.length) this.litRooms = this.roomLights.filter((L) => away(L.x, L.z) < 40 && Math.abs(L.y - focus.y) < 6).sort((a, b) => away(a.x, a.z) - away(b.x, b.z)).slice(0, this.roomPoints.length);
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
    this.roomPoints.forEach((l, k) => {
      const L = this.litRooms?.[k];
      if (!L) { l.intensity = 0; return; }
      l.position.set(L.x, L.y - 0.5, L.z); l.color.copy(L.col);
      l.intensity = 22;
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
