// POI themes: each named zone gets a palette, an accent trim colour, a ground tint, building
// style rules and a landmark/feature generator that adds verticality and movement routes.
// Everything is deterministic (seeded) so client and server build identical zones.
//
// ctx (provided by map.js): add(x0,y0,z0,x1,y1,z1,kind,color), setBase(y), height(x,z),
// isFree(x,z,r), block(x,z,r), loot(x,y,z,tier), decor(obj), pad(x,y,z), zip(zipObj), rng

export const THEMES = {
  industrial: {
    label: 'INDUSTRIAL', names: ['Kiln Works', 'The Forge', 'Drillsite'],
    palettes: ['#93705a', '#7d8590', '#a2643f'], roof: '#4a4d52', slab: '#6e6a66', trim: '#ff8a2a', ground: '#6f6656',
    floors: [2, 3], containers: 0.85, ruin: 0,
  },
  overgrown: {
    label: 'OVERGROWN', names: ['Hollow Market', 'Sunken Yard', 'Mossgate'],
    palettes: ['#8e9a7c', '#a39b84', '#7f8f72'], roof: '#5f6b55', slab: '#7a7d6a', trim: '#9be04a', ground: '#4f8a3a',
    floors: [1, 3], containers: 0.1, ruin: 0.32,
  },
  hightech: {
    label: 'HIGH-TECH', names: ['Cinder Labs', 'Relay Station', 'Signal Peak'],
    palettes: ['#dfe5ea', '#c9d3dc', '#eef1f4'], roof: '#8e9aa8', slab: '#b8c2cc', trim: '#38e8ff', ground: '#aebac0',
    floors: [2, 3], containers: 0.2, ruin: 0,
  },
  desert: {
    label: 'DESERT', names: ['Glass Basin', 'Dune Gate', 'Sunscar'],
    palettes: ['#d8b07a', '#c89a68', '#e3c391'], roof: '#b98a5a', slab: '#c9a273', trim: '#ff5a3a', ground: '#e2c48a',
    floors: [1, 2], containers: 0.15, ruin: 0.08,
  },
  flooded: {
    label: 'FLOODED', names: ['Harbor 9', 'Saltmarsh', 'Tidewater'],
    palettes: ['#6f8f99', '#8aa3a8', '#5f7c86'], roof: '#3f565f', slab: '#62747a', trim: '#ffd23f', ground: '#6f8476',
    floors: [1, 2], containers: 0.5, ruin: 0.05, stilts: 0.7, water: true,
  },
  military: {
    label: 'MILITARY', names: ['Fort Rook', 'Overpass', 'Skyrail'],
    palettes: ['#7b8064', '#8a8b6c', '#6c7258'], roof: '#4e5240', slab: '#6a6d58', trim: '#ff3b3b', ground: '#7d7a5c',
    floors: [1, 2], containers: 0.4, ruin: 0,
  },
};
export const THEME_IDS = Object.keys(THEMES);

const METAL = '#5a6068', ROCK = '#9a8a74', BARK = '#5d4330', LEAF = '#4f9a3c';

// Platforms spiralling around a core, each 2.2 m above the last: a mantle/climb parkour route.
function spiral(ctx, cx, cz, coreHalf, tiers, rise, size, color, startY = 0) {
  const r = ctx.rng;
  let a = r() * Math.PI * 2;
  for (let i = 0; i < tiers; i++) {
    const y = startY + rise * (i + 1);
    const px = cx + Math.cos(a) * (coreHalf + size / 2 - 0.2), pz = cz + Math.sin(a) * (coreHalf + size / 2 - 0.2);
    ctx.add(px - size / 2, y - 0.5, pz - size / 2, px + size / 2, y, pz + size / 2, 'floor', color);
    if (i % 2 === 1) ctx.loot(px, ctx.baseY() + y + 0.05, pz, 1);
    a += Math.PI / 2.2;
  }
}

function verticalZip(ctx, x, z, top, landX, landZ, landY) {
  const gy = ctx.height(x, z);
  ctx.zip({ ax: x, ay: gy + 2.2, az: z, bx: x, by: top + 2.3, bz: z, top: { x: landX, y: landY + 0.05, z: landZ } });
}

export const LANDMARKS = {
  // smokestacks with catwalk rings, served by vertical ziplines; smoke plumes are client decor
  industrial(ctx, p) {
    const r = ctx.rng;
    for (let k = 0; k < 2; k++) {
      const a = r() * Math.PI * 2, d = p.r * (0.55 + k * 0.25);
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (!ctx.isFree(x, z, 6)) continue;
      ctx.block(x, z, 6);
      const h = r.range(26, 36);
      ctx.setBase(ctx.height(x, z));
      ctx.add(x - 1.8, 0, z - 1.8, x + 1.8, h, z + 1.8, 'stack', '#8c6f5c');
      for (let y = 6; y < h; y += 7) ctx.add(x - 1.95, y, z - 1.95, x + 1.95, y + 0.5, z + 1.95, 'trim', THEMES.industrial.trim);
      // catwalk ring at 12 m
      const cy = 12;
      ctx.add(x - 4, cy - 0.3, z - 4, x + 4, cy, z - 1.8, 'catwalk', METAL);
      ctx.add(x - 4, cy - 0.3, z + 1.8, x + 4, cy, z + 4, 'catwalk', METAL);
      ctx.add(x - 4, cy - 0.3, z - 1.8, x - 1.8, cy, z + 1.8, 'catwalk', METAL);
      ctx.add(x + 1.8, cy - 0.3, z - 1.8, x + 4, cy, z + 1.8, 'catwalk', METAL);
      ctx.loot(x + 3, ctx.baseY() + cy + 0.05, z, 2);
      verticalZip(ctx, x + 4.6, z, ctx.baseY() + cy, x + 3, z, ctx.baseY() + cy);
      ctx.decor({ type: 'smoke', x, y: ctx.baseY() + h + 0.5, z });
    }
  },
  // a giant tree whose branch platforms spiral up in mantle-sized steps
  overgrown(ctx, p) {
    const r = ctx.rng;
    const x = p.x + r.range(-10, 10), z = p.z + r.range(-10, 10);
    if (!ctx.isFree(x, z, 9)) return;
    ctx.block(x, z, 9);
    ctx.setBase(ctx.height(x, z));
    ctx.add(x - 1.6, 0, z - 1.6, x + 1.6, 24, z + 1.6, 'bark', BARK);
    spiral(ctx, x, z, 1.6, 9, 2.2, 3.6, '#6b5a3a');
    ctx.add(x - 5, 21.5, z - 5, x + 5, 22.1, z + 5, 'floor', '#6b5a3a');
    ctx.loot(x + 3, ctx.baseY() + 22.15, z, 2);
    ctx.decor({ type: 'canopy', x, y: ctx.baseY() + 23, z, r: 9 });
    ctx.decor({ type: 'canopy', x: x + 3, y: ctx.baseY() + 15, z: z - 2, r: 6 });
    // fallen pillars as cover
    for (let i = 0; i < 4; i++) {
      const a = r() * Math.PI * 2, d = r.range(0.3, 0.8) * p.r;
      const px = p.x + Math.cos(a) * d, pz = p.z + Math.sin(a) * d;
      if (!ctx.isFree(px, pz, 4)) continue;
      ctx.block(px, pz, 4);
      ctx.setBase(ctx.height(px, pz) - 0.3);
      if (r() < 0.5) ctx.add(px - 3.5, 0, pz - 0.7, px + 3.5, 1.4, pz + 0.7, 'rock', '#8a8f7a');
      else ctx.add(px - 0.7, 0, pz - 0.7, px + 0.7, r.range(3, 7), pz + 0.7, 'rock', '#8a8f7a');
    }
  },
  // a spire with a parkour spiral, glowing pylons and a jump pad at its foot
  hightech(ctx, p) {
    const r = ctx.rng;
    const x = p.x + r.range(-8, 8), z = p.z + r.range(-8, 8);
    if (!ctx.isFree(x, z, 9)) return;
    ctx.block(x, z, 9);
    ctx.setBase(ctx.height(x, z));
    ctx.add(x - 2.5, 0, z - 2.5, x + 2.5, 30, z + 2.5, 'spire', '#e9eef2');
    for (let y = 4; y < 30; y += 5) ctx.add(x - 2.6, y, z - 2.6, x + 2.6, y + 0.25, z + 2.6, 'trim', THEMES.hightech.trim);
    spiral(ctx, x, z, 2.5, 10, 2.2, 3.4, '#b8c2cc');
    ctx.add(x - 4.5, 24.5, z - 4.5, x + 4.5, 25, z + 4.5, 'floor', '#b8c2cc');
    ctx.loot(x, ctx.baseY() + 25.05, z + 3.5, 2);
    ctx.pad(x + 5.5, ctx.baseY(), z + 5.5);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + r(), d = p.r * r.range(0.5, 0.9);
      const px = p.x + Math.cos(a) * d, pz = p.z + Math.sin(a) * d;
      if (!ctx.isFree(px, pz, 1.5)) continue;
      ctx.block(px, pz, 1.5);
      ctx.setBase(ctx.height(px, pz));
      const h = r.range(7, 12);
      ctx.add(px - 0.35, 0, pz - 0.35, px + 0.35, h, pz + 0.35, 'pylon', '#d6dde3');
      ctx.decor({ type: 'glow', x: px, y: ctx.baseY() + h + 0.4, z: pz, color: THEMES.hightech.trim });
    }
  },
  // stepped mesas you can climb, plus a stone arch to fight around
  desert(ctx, p) {
    const r = ctx.rng;
    for (let k = 0; k < 2; k++) {
      const a = r() * Math.PI * 2, d = p.r * r.range(0.6, 1.0);
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (!ctx.isFree(x, z, 14)) continue;
      ctx.block(x, z, 14);
      mesa(ctx, x, z, r.range(9, 13), r.range(10, 14), '#c98f5e');
      ctx.loot(x, ctx.baseY() + 0.05 + mesa.lastTop, z, 2);
      ctx.pad(x - mesa.lastSize / 2 - 3, ctx.height(x - mesa.lastSize / 2 - 3, z), z);
    }
    const a = r() * Math.PI * 2, x = p.x + Math.cos(a) * p.r * 0.4, z = p.z + Math.sin(a) * p.r * 0.4;
    if (ctx.isFree(x, z, 9)) {
      ctx.block(x, z, 9);
      ctx.setBase(ctx.height(x, z) - 0.3);
      ctx.add(x - 7, 0, z - 1.5, x - 4, 9, z + 1.5, 'rock', '#c98f5e');
      ctx.add(x + 4, 0, z - 1.5, x + 7, 9, z + 1.5, 'rock', '#c98f5e');
      ctx.add(x - 7, 9, z - 1.5, x + 7, 11, z + 1.5, 'rock', '#d9a06c');
      ctx.loot(x, ctx.baseY() + 11.05, z, 1);
    }
  },
  // docks out over the water and a dockside crane with a walkable boom
  flooded(ctx, p) {
    const r = ctx.rng;
    for (let k = 0; k < 3; k++) {
      const a = r() * Math.PI * 2, d = p.r * r.range(0.2, 0.7);
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      const len = r.range(14, 24), along = r() < 0.5;
      if (!ctx.isFree(x, z, len / 2)) continue;
      ctx.block(x, z, len / 2);
      ctx.setBase(ctx.height(x, z));
      if (along) ctx.add(x - len / 2, 0, z - 1.6, x + len / 2, 1.2, z + 1.6, 'dock', '#7a5c40');
      else ctx.add(x - 1.6, 0, z - len / 2, x + 1.6, 1.2, z + len / 2, 'dock', '#7a5c40');
      ctx.loot(x, ctx.baseY() + 1.25, z, 1);
    }
    const a = r() * Math.PI * 2, x = p.x + Math.cos(a) * p.r * 0.75, z = p.z + Math.sin(a) * p.r * 0.75;
    if (ctx.isFree(x, z, 8)) {
      ctx.block(x, z, 8);
      ctx.setBase(ctx.height(x, z));
      ctx.add(x - 1.5, 0, z - 1.5, x + 1.5, 22, z + 1.5, 'crane', '#e8b62e');
      const dir = r() < 0.5 ? 1 : -1;
      ctx.add(dir > 0 ? x - 3 : x - 20, 22, z - 1, dir > 0 ? x + 20 : x + 3, 23.4, z + 1, 'crane', '#e8b62e');
      ctx.loot(x + dir * 15, ctx.baseY() + 23.45, z, 2);
      verticalZip(ctx, x - 2.2 * dir, z, ctx.baseY() + 23.4, x, z, ctx.baseY() + 23.4);
    }
  },
  // perimeter wall with gates, watchtowers served by ziplines, sandbag nests
  military(ctx, p) {
    const r = ctx.rng;
    const R = p.r * 0.97, segs = 18;
    for (let i = 0; i < segs; i++) {
      if (i % 4 === 0) continue; // gates
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 0.8) / segs) * Math.PI * 2;
      const x0 = p.x + Math.cos(a0) * R, z0 = p.z + Math.sin(a0) * R, x1 = p.x + Math.cos(a1) * R, z1 = p.z + Math.sin(a1) * R;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      if (!ctx.isFree(mx, mz, 2)) continue;
      ctx.setBase(ctx.height(mx, mz) - 0.2);
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (Math.abs(x1 - x0) > Math.abs(z1 - z0)) ctx.add(mx - len / 2, 0, mz - 0.35, mx + len / 2, 2.6, mz + 0.35, 'wall', '#6f735c');
      else ctx.add(mx - 0.35, 0, mz - len / 2, mx + 0.35, 2.6, mz + len / 2, 'wall', '#6f735c');
    }
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + r() * 0.6, d = p.r * 0.8;
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (!ctx.isFree(x, z, 4)) continue;
      ctx.block(x, z, 4);
      ctx.setBase(ctx.height(x, z));
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) ctx.add(x + sx * 1.8 - 0.2, 0, z + sz * 1.8 - 0.2, x + sx * 1.8 + 0.2, 7, z + sz * 1.8 + 0.2, 'catwalk', METAL);
      ctx.add(x - 2.4, 7, z - 2.4, x + 2.4, 7.3, z + 2.4, 'floor', '#6a6d58');
      for (const s of [-1, 1]) {
        ctx.add(x - 2.4, 7.3, z + s * 2.4 - 0.15, x + 2.4, 8.3, z + s * 2.4 + 0.15, 'wall', '#6f735c');
      }
      ctx.add(x - 2.6, 10, z - 2.6, x + 2.6, 10.25, z + 2.6, 'roof', '#4e5240');
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) ctx.add(x + sx * 2.3 - 0.1, 8.3, z + sz * 2.3 - 0.1, x + sx * 2.3 + 0.1, 10, z + sz * 2.3 + 0.1, 'catwalk', METAL);
      ctx.loot(x, ctx.baseY() + 7.35, z, 1);
      verticalZip(ctx, x + 3.1, z, ctx.baseY() + 7.3, x + 1.2, z, ctx.baseY() + 7.3);
    }
    ctx.decor({ type: 'dish', x: p.x, y: ctx.height(p.x, p.z), z: p.z });
  },
};

// Stepped mesa: a plateau with a ring of ledges each ≤2.2 m apart so it can be mantled up.
export function mesa(ctx, x, z, half, height, color) {
  const r = ctx.rng;
  ctx.setBase(Math.min(ctx.height(x - half, z - half), ctx.height(x + half, z + half), ctx.height(x, z)) - 0.5);
  ctx.add(x - half, 0, z - half, x + half, height, z + half, 'rock', color);
  // ledge staircase up one side
  const side = r.int(0, 3);
  const steps = Math.ceil(height / 2.1);
  for (let i = 0; i < steps; i++) {
    const y = Math.min(height, (i + 1) * 2.1), off = half + 1.4 + (steps - i) * 0.0;
    const t = -half + 2 + (i / steps) * (half * 2 - 4);
    let x0, z0;
    if (side === 0) { x0 = x + t; z0 = z - off; } else if (side === 1) { x0 = x + off; z0 = z + t; } else if (side === 2) { x0 = x - t; z0 = z + off; } else { x0 = x - off; z0 = z - t; }
    ctx.add(x0 - 1.5, 0, z0 - 1.5, x0 + 1.5, y, z0 + 1.5, 'rock', '#b98a5e');
  }
  // rim boulders for cover on top
  for (let i = 0; i < 3; i++) {
    const bx = x + r.range(-half + 2, half - 2), bz = z + r.range(-half + 2, half - 2);
    ctx.add(bx - 1, height, bz - 1, bx + 1, height + 1.3, bz + 1, 'rock', color);
  }
  mesa.lastTop = height;
  mesa.lastSize = half * 2;
}
