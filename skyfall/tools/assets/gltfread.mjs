// Minimal glTF / GLB reader for the asset importer (no three.js, no DOM): JSON + world-space
// vertex positions of every mesh (node TRS hierarchy applied), enough for bounds and the
// gun-facing heuristic.

import fs from 'node:fs';
import path from 'node:path';

export function readGltf(file) {
  const buf = fs.readFileSync(file);
  let json, bin = null;
  if (/\.gltf$/i.test(file)) json = JSON.parse(buf.toString('utf8'));
  else {
    if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
    const jl = buf.readUInt32LE(12);
    json = JSON.parse(buf.slice(20, 20 + jl).toString('utf8'));
    const o = 20 + jl;
    if (o + 8 <= buf.length) bin = buf.slice(o + 8, o + 8 + buf.readUInt32LE(o));
  }
  const buffers = (json.buffers || []).map((b, i) => {
    if (!b.uri) return i === 0 ? bin : null;
    if (b.uri.startsWith('data:')) return Buffer.from(b.uri.split(',')[1], 'base64');
    const p = path.join(path.dirname(file), decodeURIComponent(b.uri));
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
  });
  return { json, buffers };
}

function accessorFloats(g, idx) {
  const a = g.json.accessors[idx];
  if (!a || a.bufferView === undefined || a.componentType !== 5126) return null;
  const bv = g.json.bufferViews[a.bufferView], buf = g.buffers[bv.buffer];
  if (!buf) return null;
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const stride = bv.byteStride || comps * 4, base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Float32Array(a.count * comps);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < comps; c++) out[i * comps + c] = buf.readFloatLE(base + i * stride + c * 4);
  return out;
}

// 4x4 column-major helpers
function trs(n) {
  if (n.matrix) return n.matrix.slice();
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

// World-space positions of every mesh primitive reachable from the default scene.
export function worldPositions(g, { skipNode } = {}) {
  const j = g.json, out = [];
  const visit = (ni, parent) => {
    const n = j.nodes[ni];
    if (skipNode && skipNode(n)) return;
    const m = mul(parent, trs(n));
    if (n.mesh !== undefined && !n.skin) {
      for (const p of j.meshes[n.mesh].primitives) {
        const pos = accessorFloats(g, p.attributes.POSITION);
        if (!pos) continue;
        for (let i = 0; i < pos.length; i += 3) {
          const x = pos[i], y = pos[i + 1], z = pos[i + 2];
          out.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
        }
      }
    }
    for (const c of n.children || []) visit(c, m);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scene = j.scenes ? j.scenes[j.scene || 0] : { nodes: j.nodes.map((_, i) => i) };
  for (const ni of scene.nodes || []) visit(ni, I);
  return new Float32Array(out);
}
