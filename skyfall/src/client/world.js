// Static world rendering: sky, lighting, terrain, instanced map geometry with a world-space panel
// shader (gives strong scale/readability cues for movement), trees, beacons, ring wall and drop ship.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { STYLE, toonify } from './comic.js';

const SUN_DIR = new THREE.Vector3(-0.45, 0.8, 0.35).normalize();

function patchPanels(mat, scale = 1, lineStrength = 0.18) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        #ifdef USE_INSTANCING
          vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vWNrm = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);
        #else
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWNrm = normalize(mat3(modelMatrix) * objectNormal);
        #endif`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNrm;
        float hash3(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 n = abs(vWNrm);
          vec2 uv = n.y > 0.5 ? vWPos.xz : (n.x > 0.5 ? vWPos.zy : vWPos.xy);
          uv *= ${(1 / scale).toFixed(3)};
          vec2 g = abs(fract(uv) - 0.5);
          float line = smoothstep(0.47, 0.5, max(g.x, g.y));
          float cell = hash3(floor(vec3(uv, n.y * 7.0 + n.x * 3.0)));
          diffuseColor.rgb *= (1.0 - line * ${lineStrength.toFixed(2)}) * (0.93 + cell * 0.12);
          // ambient-occlusion-ish darkening near the ground
          diffuseColor.rgb *= mix(0.72, 1.0, clamp(vWPos.y * 0.6, 0.0, 1.0));
          // top faces slightly lighter for silhouette readability
          diffuseColor.rgb *= n.y > 0.5 ? 1.06 : 1.0;
        }`,
      );
  };
  return mat;
}

export class WorldView {
  constructor(renderer, map) {
    this.renderer = renderer;
    this.map = map;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color('#a9c4dc');
    scene.fog = new THREE.Fog('#b9cde0', 160, 1100);
    // image-based lighting so metal and armour materials have something to reflect
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = this.envMap;
    scene.environmentIntensity = 0.45;

    // sky dome
    const skyGeo = new THREE.SphereGeometry(3000, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sun: { value: SUN_DIR }, comic: { value: STYLE.comic ? 1 : 0 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vDir; uniform vec3 sun; uniform float comic;
        float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
        void main(){
          float h = vDir.y;
          vec3 top = vec3(0.24,0.46,0.78), hor = vec3(0.78,0.85,0.92), low = vec3(0.62,0.66,0.7);
          vec3 c = h > 0.0 ? mix(hor, top, pow(h, 0.55)) : mix(hor, low, min(1.0, -h * 4.0));
          float s = max(0.0, dot(vDir, sun));
          if (comic > 0.5) {
            // pop-art sky: banded gradient + cel-shaded cloud blobs with ink rims
            top = vec3(0.16,0.5,0.95); hor = vec3(0.7,0.88,1.0);
            float band = floor(clamp(h, 0.0, 1.0) * 5.0) / 5.0;
            c = h > 0.0 ? mix(hor, top, pow(band, 0.7)) : mix(hor, low, min(1.0, -h * 4.0));
            vec2 uv = vDir.xz / (vDir.y + 0.3) * 3.2;
            float n = vn(uv) * 0.6 + vn(uv * 2.1 + 7.0) * 0.3 + vn(uv * 4.3) * 0.1;
            float cl = smoothstep(0.645, 0.66, n) * smoothstep(0.06, 0.2, h);
            float rim = smoothstep(0.625, 0.635, n) - smoothstep(0.645, 0.655, n);
            vec3 cloud = mix(vec3(0.93, 0.95, 1.0), vec3(0.78, 0.82, 0.92), step(0.72, n));
            c = mix(c, cloud, cl);
            c = mix(c, vec3(0.1, 0.12, 0.2), rim * smoothstep(0.06, 0.2, h) * 0.85);
            c += vec3(1.0,0.9,0.5) * step(0.9985, s) * 2.0;
          } else {
            c += vec3(1.0,0.86,0.6) * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.25);
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    // lights
    scene.add(new THREE.HemisphereLight('#cfe3ff', '#5a5040', 1.05));
    const sun = (this.sun = new THREE.DirectionalLight('#fff1d6', 2.4));
    sun.position.copy(SUN_DIR).multiplyScalar(200);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 500;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
    scene.add(sun);
    scene.add(sun.target);

    this._ground();
    this._boxes();
    this._trees();
    this._ziplines();
    this._bins();
    this._beacons();
    this._ring();
    this._ship();
    this._pois();
    if (STYLE.comic) toonify(this.scene);
  }

  _ground() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#7d8a5c';
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 9000; i++) {
      const v = Math.random();
      g.fillStyle = v < 0.33 ? 'rgba(92,110,64,0.5)' : v < 0.66 ? 'rgba(140,140,95,0.45)' : 'rgba(110,98,72,0.4)';
      const s = 1 + Math.random() * 5;
      g.fillRect(Math.random() * 512, Math.random() * 512, s, s);
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = 'rgba(120,105,80,0.18)';
      g.beginPath();
      g.arc(Math.random() * 512, Math.random() * 512, 20 + Math.random() * 60, 0, Math.PI * 2);
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const T = this.map.terrain;
    // terrain mesh: heights from the shared heightfield, vertex colours from slope and altitude
    const SIZE = 2000, SEG = 400;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    const cols = new Float32Array(pos.count * 3);
    const grass = new THREE.Color(STYLE.comic ? '#93b858' : '#8d9a66'), dry = new THREE.Color(STYLE.comic ? '#d8c27a' : '#a59a72'), rock = new THREE.Color(STYLE.comic ? '#a08f7a' : '#7e776c'), high = new THREE.Color(STYLE.comic ? '#e8dcb4' : '#b8b29a');
    const tmpC = new THREE.Color(), n = { x: 0, y: 1, z: 0 };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = T.height(x, z);
      pos.setY(i, h);
      uv.setXY(i, x / 12.5, z / 12.5);
      T.normal(x, z, n);
      const slope = 1 - n.y; // 0 flat .. ~0.17 at 33°
      const alt = (h - T.minH) / Math.max(1, T.maxH - T.minH);
      tmpC.copy(grass).lerp(dry, Math.min(1, alt * 1.2 + Math.sin(x * 0.01) * Math.cos(z * 0.013) * 0.25));
      tmpC.lerp(rock, Math.min(1, Math.max(0, (slope - 0.04) * 9)));
      if (alt > 0.8) tmpC.lerp(high, (alt - 0.8) * 3);
      cols[i * 3] = tmpC.r; cols[i * 3 + 1] = tmpC.g; cols[i * 3 + 2] = tmpC.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    // canvas texture is a neutral detail map; tint comes from vertex colours
    const mat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.95, metalness: 0, color: '#d8dccb' });
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    this.scene.add(ground);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshStandardMaterial({ color: '#7d875c', roughness: 1 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.6;
    this.scene.add(outer);
    // POI concrete pads, at their flattened height
    const padMat = patchPanels(new THREE.MeshStandardMaterial({ color: '#8e8a82', roughness: 0.9 }), 4, 0.25);
    for (const p of this.map.pois) {
      const pad = new THREE.Mesh(new THREE.CircleGeometry(p.r * 0.95, 48), padMat);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(p.x, T.height(p.x, p.z) + 0.03, p.z);
      pad.receiveShadow = true;
      this.scene.add(pad);
    }
  }

  _bins() {
    // lids with a glowing seam; they swing open when a bin is looted
    this.binLids = [];
    const lidMat = new THREE.MeshStandardMaterial({ color: '#39465a', metalness: 0.5, roughness: 0.4 });
    const seamMat = new THREE.MeshBasicMaterial({ color: '#4fb3ff' });
    for (const b of this.map.bins) {
      const pivot = new THREE.Group();
      pivot.position.set(b.x, b.y, b.z + 0.45);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.12, 0.95), lidMat);
      lid.position.set(0, 0.06, -0.47);
      pivot.add(lid);
      const seam = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.03, 0.04), seamMat);
      seam.position.set(0, 0.0, -0.94);
      pivot.add(seam);
      this.scene.add(pivot);
      this.binLids.push({ pivot, seam, open: false });
    }
  }

  setBinOpened(i) {
    const l = this.binLids && this.binLids[i];
    if (!l || l.open) return;
    l.open = true;
    l.seam.visible = false;
    l.pivot.rotation.x = -1.9;
  }

  _ziplines() {
    const cableMat = new THREE.MeshStandardMaterial({ color: '#1b1d22', metalness: 0.7, roughness: 0.35 });
    const glowMat = new THREE.MeshBasicMaterial({ color: '#ffb347' });
    const poleMat = new THREE.MeshStandardMaterial({ color: '#3a3f47', metalness: 0.5, roughness: 0.5 });
    const cableGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 5, 1, true);
    cableGeo.translate(0, 0.5, 0);
    cableGeo.rotateX(Math.PI / 2);
    const up = new THREE.Vector3();
    for (const z of this.map.zips) {
      const a = new THREE.Vector3(z.ax, z.ay, z.az), b = new THREE.Vector3(z.bx, z.by, z.bz);
      const L = a.distanceTo(b);
      const cable = new THREE.Mesh(cableGeo, cableMat);
      cable.position.copy(a);
      cable.lookAt(b);
      cable.scale.set(1, 1, L);
      this.scene.add(cable);
      // anchor heads with amber lights so lines read from a distance
      for (const e of [a, b]) {
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), poleMat);
        head.position.copy(e);
        this.scene.add(head);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), glowMat);
        lamp.position.copy(e).add(up.set(0, 0.3, 0));
        this.scene.add(lamp);
        if (z.poles) {
          const gy = this.map.terrain.height(e.x, e.z);
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, e.y - gy, 6), poleMat);
          pole.position.set(e.x, (e.y + gy) / 2, e.z);
          pole.castShadow = true;
          this.scene.add(pole);
        }
      }
      if (z.top) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 6), poleMat);
        pole.position.set(z.bx, z.by + 0.3, z.bz);
        this.scene.add(pole);
      }
    }
  }

  _boxes() {
    const groups = new Map();
    for (const b of this.map.boxes) {
      if (b.kind === 'tree') continue;
      const key = b.kind + '|' + b.color;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { kind: b.kind, color: b.color, list: [] }));
      g.list.push(b);
    }
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (const g of groups.values()) {
      const rough = g.kind === 'container' ? 0.55 : g.kind === 'rock' ? 0.95 : 0.85;
      const metal = g.kind === 'container' ? 0.35 : 0.0;
      const scale = g.kind === 'container' ? 0.6 : g.kind === 'rock' ? 2.5 : g.kind === 'wall' ? 1.2 : 1;
      const mat = patchPanels(new THREE.MeshStandardMaterial({ color: g.color, roughness: rough, metalness: metal }), scale, g.kind === 'rock' ? 0.08 : 0.2);
      if (g.kind === 'beacon') { mat.emissive = new THREE.Color('#1c6dd0'); mat.emissiveIntensity = 0.4; }
      if (g.kind === 'bin') { mat.emissive = new THREE.Color('#0a3a6a'); mat.emissiveIntensity = 0.3; }
      const mesh = new THREE.InstancedMesh(geo, mat, g.list.length);
      g.list.forEach((b, i) => {
        s.set(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
        p.set((b.max[0] + b.min[0]) / 2, (b.max[1] + b.min[1]) / 2, (b.max[2] + b.min[2]) / 2);
        m4.compose(p, q, s);
        mesh.setMatrixAt(i, m4);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
    }
  }

  _trees() {
    const trees = this.map.trees;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.32, 1, 6), new THREE.MeshStandardMaterial({ color: '#5b4330', roughness: 1 }), trees.length);
    const leafGeo = new THREE.ConeGeometry(1, 1, 7);
    const leaf1 = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ color: '#3f6b3a', roughness: 0.9, flatShading: true }), trees.length);
    const leaf2 = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ color: '#4f8045', roughness: 0.9, flatShading: true }), trees.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    trees.forEach((t, i) => {
      const h = t.h;
      s.set(1, h * 0.6, 1); p.set(t.x, t.y + h * 0.3, t.z); m4.compose(p, q, s); trunk.setMatrixAt(i, m4);
      s.set(h * 0.32, h * 0.55, h * 0.32); p.set(t.x, t.y + h * 0.55, t.z); m4.compose(p, q, s); leaf1.setMatrixAt(i, m4);
      s.set(h * 0.24, h * 0.42, h * 0.24); p.set(t.x, t.y + h * 0.82, t.z); m4.compose(p, q, s); leaf2.setMatrixAt(i, m4);
    });
    for (const m of [trunk, leaf1, leaf2]) { m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); this.scene.add(m); }
  }

  _beacons() {
    // respawn beacons: emissive core, rotating holo rings and a beam that flares when you carry banners
    this.beaconFx = [];
    for (const b of this.map.beacons) {
      const beamMat = new THREE.MeshBasicMaterial({ color: '#4fb3ff', transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.5, 60, 8, 1, true), beamMat);
      beam.position.set(b.x, b.y + 31, b.z);
      this.scene.add(beam);
      const ringMat = new THREE.MeshBasicMaterial({ color: '#7fd0ff', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const rings = [];
      for (let i = 0; i < 2; i++) {
        const r = new THREE.Mesh(new THREE.TorusGeometry(1.1 + i * 0.35, 0.05, 6, 32), ringMat);
        r.position.set(b.x, b.y + 2.9 + i * 0.5, b.z);
        r.rotation.x = Math.PI / 2;
        this.scene.add(r);
        rings.push(r);
      }
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.4), new THREE.MeshStandardMaterial({ color: '#2b7de0', emissive: '#4fb3ff', emissiveIntensity: 1.6 }));
      core.position.set(b.x, b.y + 3.4, b.z);
      this.scene.add(core);
      this.beaconFx.push({ beam, beamMat, rings, core });
    }
  }

  setBeaconHighlight(on, time) {
    for (const f of this.beaconFx) {
      f.beamMat.opacity = on ? 0.55 + 0.25 * Math.sin(time * 6) : 0.22;
      f.beam.scale.set(on ? 2 : 1, on ? 2.4 : 1, on ? 2 : 1);
      f.rings[0].rotation.z = time * 1.5;
      f.rings[1].rotation.z = -time * 2;
      f.rings[0].rotation.x = Math.PI / 2 + Math.sin(time) * 0.2;
      f.core.rotation.y = time * 2;
      f.core.position.y = f.rings[0].position.y + 0.5 + Math.sin(time * 2) * 0.15;
    }
  }

  _ring() {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 128, 1, true);
    const mat = (this.ringMat = new THREE.ShaderMaterial({
      transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false,
      uniforms: { time: { value: 0 }, radius: { value: 1000 } },
      vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `varying vec2 vUv; varying vec3 vW; uniform float time; uniform float radius;
        void main(){
          float a = atan(vW.z, vW.x) * radius;
          float stripes = 0.5 + 0.5 * sin(a * 0.08 + vW.y * 0.06 - time * 2.0);
          float d = distance(cameraPosition.xz, vW.xz);
          float near = 1.0 - smoothstep(30.0, 260.0, d);
          float edge = smoothstep(0.0, 0.04, vUv.y) * (1.0 - smoothstep(0.45, 0.9, vUv.y));
          vec3 col = mix(vec3(1.0,0.32,0.1), vec3(1.0,0.6,0.25), stripes);
          float alpha = (0.05 + near * (0.28 + stripes * 0.16)) * edge;
          gl_FragColor = vec4(col, alpha);
        }`,
    }));
    this.ringMesh = new THREE.Mesh(geo, mat);
    this.ringMesh.frustumCulled = false;
    this.ringMesh.renderOrder = 5;
    this.scene.add(this.ringMesh);
    // next-ring marker on the ground (white line)
    const nGeo = new THREE.RingGeometry(0.995, 1, 128);
    this.nextRing = new THREE.Mesh(nGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    this.nextRing.rotation.x = -Math.PI / 2;
    this.nextRing.position.y = 0.3;
    this.scene.add(this.nextRing);
  }

  _ship() {
    const g = new THREE.Group();
    const hull = new THREE.MeshStandardMaterial({ color: '#7d8894', metalness: 0.15, roughness: 0.55 });
    const accent = new THREE.MeshStandardMaterial({ color: '#ff7a1a', emissive: '#ff5a00', emissiveIntensity: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 60), hull);
    g.add(body);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(70, 1.2, 14), hull);
    wing.position.set(0, 0, 4);
    g.add(wing);
    for (const x of [-26, -12, 12, 26]) {
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 9, 10), hull);
      eng.rotation.x = Math.PI / 2;
      eng.position.set(x, -2, 6);
      g.add(eng);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(2.1, 12), accent);
      glow.position.set(x, -2, 10.6);
      g.add(glow);
    }
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(14.2, 1, 40), accent);
    stripe.position.y = 1;
    g.add(stripe);
    g.visible = false;
    this.ship = g;
    this.scene.add(g);
  }

  _pois() {
    // floating POI name labels are drawn by the HUD/map; add tall landmark masts for readability
    const mat = new THREE.MeshStandardMaterial({ color: '#444a52', metalness: 0.5, roughness: 0.5 });
    const light = new THREE.MeshBasicMaterial({ color: '#ff3b3b' });
    for (const p of this.map.pois) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.7, 40, 6), mat);
      const py = this.map.terrain.height(p.x, p.z);
      mast.position.set(p.x, py + 20, p.z);
      mast.castShadow = true;
      this.scene.add(mast);
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), light);
      l.position.set(p.x, py + 40.5, p.z);
      this.scene.add(l);
    }
  }

  // Atmosphere: the sky warms and the fog closes in as the ring shrinks; outside the ring the
  // world turns a choking orange.
  setAtmosphere(stage, outside, dt) {
    const target = outside ? 1 : 0;
    this.outsideK = (this.outsideK ?? 0) + (target - (this.outsideK ?? 0)) * Math.min(1, dt * 2.5);
    const k = this.outsideK, st = Math.max(0, Math.min(1, stage));
    const base = this._fogBase || (this._fogBase = new THREE.Color('#b9cde0'));
    const late = this._fogLate || (this._fogLate = new THREE.Color('#d6b9a0'));
    const burn = this._fogBurn || (this._fogBurn = new THREE.Color('#ff7a3a'));
    const c = this.scene.fog.color;
    c.copy(base).lerp(late, st * 0.6).lerp(burn, k * 0.75);
    this.scene.background.copy(c);
    this.scene.fog.near = 160 - st * 60 - k * 130;
    this.scene.fog.far = 1100 - st * 350 - k * 800;
    this.sun.color.setRGB(1, 0.94 - st * 0.08 - k * 0.2, 0.84 - st * 0.15 - k * 0.4);
  }

  update(dt, time, camPos, ring, ship) {
    this.ringMat.uniforms.time.value = time;
    this.ringMesh.visible = !!ring && ring.r < 3000;
    if (ring) {
      this.ringMesh.scale.set(ring.r, 700, ring.r);
      this.ringMesh.position.set(ring.cx, 300, ring.cz);
      this.ringMat.uniforms.radius.value = ring.r;
      this.nextRing.visible = ring.st === 'wait' || ring.st === 'close';
      this.nextRing.scale.set(Math.max(1, ring.nr), Math.max(1, ring.nr), 1);
      this.nextRing.position.set(ring.nx, 0.3, ring.nz);
    }
    if (ship) {
      this.ship.visible = true;
      this.ship.position.set(ship.x, ship.y + 8, ship.z);
      this.ship.rotation.y = Math.atan2(ship.dx, ship.dz);
    } else this.ship.visible = false;
    // shadow camera follows the viewer
    this.sun.position.set(camPos.x + SUN_DIR.x * 200, camPos.y + SUN_DIR.y * 200, camPos.z + SUN_DIR.z * 200);
    this.sun.target.position.set(camPos.x, camPos.y, camPos.z);
    this.sky.position.copy(camPos);
  }
}

export { patchPanels };
