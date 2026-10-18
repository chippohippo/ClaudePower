// VisorDamage: what being hurt looks like on screen (the reference clips).
//  * The edges run red as your health drops (from 60% down), and under 30% they pulse with the
//    heartbeat you hear. Every hit flashes them, harder for a bigger hit.
//  * Under 35%, red light streaks cut across the screen's corners (the stylized clip), and blood
//    creeps in round the border (Helldivers 2's low-health frame), thickest at 10%.
//  * The visor cracks: once under 60% health, again under 40%, a third time under 20%. Each is a
//    fine starburst with spider-web rings and long runners, out from the middle of the screen on
//    the side the hit came from.
//  * Blood spatters the edges on heavy hits once you're hurt (a blob, droplets thrown in, a drip
//    running down), drying off over several seconds.
//  * Healing clears it: a crack fades once you're 15% above where it came; a new life starts
//    clean. Dead, it all fades (the ELIMINATED banner takes over). Reduced motion: no pulse.
// All of it is a few gradients and SVG shapes, made when they're needed and faded with opacity,
// under the HUD.

import * as THREE from 'three';

const NS = 'http://www.w3.org/2000/svg';
const W = 1600, H = 900;                   // the overlay's drawing space (sliced to the screen)
const CRACK_AT = [0.6, 0.4, 0.2], HEAL = 0.15, MAX_BLOOD = 6;
/** A red streak across one corner: a faint wash beyond it, a bright line, a fainter one inside. */
const streak = (dir) => `linear-gradient(${dir}, rgba(255, 36, 36, .34) 0%, rgba(255, 36, 36, 0) 7.5%, rgba(255, 60, 60, 0) 8.6%, rgba(255, 74, 74, .95) 9.6%, rgba(255, 60, 60, 0) 10.8%, rgba(255, 60, 60, 0) 12.4%, rgba(255, 70, 70, .45) 13%, rgba(255, 60, 60, 0) 13.7%)`;
const CSS = `
#visor { position: absolute; left: 0; right: 0; top: var(--lb, 0px); bottom: var(--lb, 0px); pointer-events: none; overflow: hidden; }
#visor .vig, #visor .flash, #visor .streaks { position: absolute; inset: 0; opacity: 0; will-change: opacity; }
#visor .vig { background: radial-gradient(ellipse at center, transparent 42%, rgba(120, 6, 6, .32) 70%, rgba(85, 0, 0, .9) 100%); }
#visor .flash { background: radial-gradient(ellipse at center, transparent 36%, rgba(255, 46, 30, .38) 74%, rgba(210, 12, 8, .85) 100%); }
#visor .streaks { background: ${streak('to bottom right')}, ${streak('to bottom left')}, ${streak('to top right')}, ${streak('to top left')}; filter: blur(1.5px); }
#visor svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: hidden; }
#visor .crack { transition: opacity .06s; }
#visor .crack.fade { transition: opacity .7s; }
`;
const _v = new THREE.Vector3();

/** A small seeded random source (the overlay's shapes differ every time but tests can pin them). */
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }
const f1 = (x) => x.toFixed(1);

/**
 * A crack centred at (cx, cy): jagged rays out from the impact, rings joining them (the spider
 * web), a branch or two. Returns path data.
 */
export function crackPath(cx, cy, R, size = 1) {
  const rays = 7 + Math.floor(R() * 4), pts = [];
  let d = '';
  for (let k = 0; k < rays; k++) {
    const a0 = (k / rays) * Math.PI * 2 + (R() - 0.5) * 0.5, len = (70 + R() * 190) * size * (k % 3 === 0 ? 1.5 : 1);
    let x = cx, y = cy, a = a0, r = 0;
    const ray = [[x, y]];
    d += `M${f1(x)} ${f1(y)}`;
    while (r < len) {
      const step = 10 + R() * 18;
      a += (R() - 0.5) * 0.45; a += (a0 - a) * 0.3;          // jagged, but it keeps its heading
      x += Math.cos(a) * step; y += Math.sin(a) * step; r += step;
      ray.push([x, y]);
      d += `L${f1(x)} ${f1(y)}`;
    }
    pts.push(ray);
    // A branch off the ray's middle.
    if (R() < 0.55 && ray.length > 4) {
      const [bx, by] = ray[Math.floor(ray.length * (0.35 + R() * 0.3))], ba = a0 + (R() < 0.5 ? -1 : 1) * (0.4 + R() * 0.4);
      let x2 = bx, y2 = by;
      d += `M${f1(bx)} ${f1(by)}`;
      for (let s = 0, n = 2 + Math.floor(R() * 3); s < n; s++) { x2 += Math.cos(ba + (R() - 0.5) * 0.5) * (12 + R() * 14) * size; y2 += Math.sin(ba + (R() - 0.5) * 0.5) * (12 + R() * 14) * size; d += `L${f1(x2)} ${f1(y2)}`; }
    }
  }
  // The web: rings across neighbouring rays, at a few radii, a little ragged.
  const at = (ray, r) => { let acc = 0; for (let i = 1; i < ray.length; i++) { const [x0, y0] = ray[i - 1], [x1, y1] = ray[i], l = Math.hypot(x1 - x0, y1 - y0); if (acc + l >= r) { const u = (r - acc) / l; return [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u]; } acc += l; } return null; };
  for (const ring of [16, 34, 60].map((r) => r * size)) {
    for (let k = 0; k < rays; k++) {
      if (R() < 0.25) continue;
      const p = at(pts[k], ring * (0.85 + R() * 0.3)), q = at(pts[(k + 1) % rays], ring * (0.85 + R() * 0.3));
      if (p && q) d += `M${f1(p[0])} ${f1(p[1])}L${f1((p[0] + q[0]) / 2 + (R() - 0.5) * 6)} ${f1((p[1] + q[1]) / 2 + (R() - 0.5) * 6)}L${f1(q[0])} ${f1(q[1])}`;
    }
  }
  return d;
}

/** A blood splat at (cx, cy) thrown toward angle `a`: a ragged blob, droplets, a drip. Returns path data. */
export function splatPath(cx, cy, a, R, size = 60) {
  const n = 18, p1 = R() * 6, p2 = R() * 6, rad = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    rad.push(size * (0.62 + 0.18 * Math.sin(3 * t + p1) + 0.12 * Math.sin(5 * t + p2) + R() * 0.14 + 0.25 * Math.max(0, Math.cos(t - a)) ** 3));
  }
  const pt = (i) => { const t = (i / n) * Math.PI * 2; return [cx + Math.cos(t) * rad[i % n], cy + Math.sin(t) * rad[i % n]]; };
  // A smooth closed blob: quadratic curves through the midpoints.
  let [x0, y0] = pt(0), [x1, y1] = pt(1);
  let d = `M${f1((x0 + x1) / 2)} ${f1((y0 + y1) / 2)}`;
  for (let i = 1; i <= n; i++) { [x0, y0] = pt(i); [x1, y1] = pt(i + 1); d += `Q${f1(x0)} ${f1(y0)} ${f1((x0 + x1) / 2)} ${f1((y0 + y1) / 2)}`; }
  d += 'Z';
  // Droplets thrown out along a.
  const circle = (x, y, r) => `M${f1(x - r)} ${f1(y)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0Z`;
  for (let k = 0, m = 5 + Math.floor(R() * 6); k < m; k++) {
    const t = a + (R() - 0.5) * 1.3, r = size * (1.05 + R() * 1.3);
    d += circle(cx + Math.cos(t) * r, cy + Math.sin(t) * r, size * (0.04 + R() * 0.11));
  }
  // A drip running down from the blob's lower edge.
  if (R() < 0.7) {
    const x = cx + (R() - 0.5) * size * 0.8, y = cy + size * 0.55, len = size * (0.6 + R() * 1.2), w = size * (0.06 + R() * 0.05);
    d += `M${f1(x - w)} ${f1(y)}L${f1(x - w * 0.7)} ${f1(y + len)}a${f1(w * 1.3)} ${f1(w * 1.3)} 0 1 0 ${f1(w * 1.4)} 0L${f1(x + w)} ${f1(y)}Z`;
  }
  return d;
}

/**
 * The low-health frame: blood blobs all round the border (heavier along the top and left, the way
 * a visor catches it), their centres just off screen so only their ragged inner edges show, with
 * droplets thrown inward. Two tones: a dark base and a brighter red over it.
 */
export function bloodFrame(R) {
  let dark = '', bright = '';
  const along = (t) => {               // a point round the border, t in [0, 1): top, right, bottom, left
    const P = 2 * (W + H), u = t * P;
    if (u < W) return [u, 0, Math.PI / 2];
    if (u < W + H) return [W, u - W, Math.PI];
    if (u < 2 * W + H) return [W - (u - W - H), H, -Math.PI / 2];
    return [0, H - (u - 2 * W - H), 0];
  };
  for (let k = 0; k < 46; k++) {
    const t = (k + R() * 0.8) / 46;
    const [x, y, inward] = along(t), heavy = y === 0 || x === 0 ? 1.25 : 0.9;
    const size = (45 + R() * 85) * heavy, back = size * (0.35 + R() * 0.35);
    const cx = x - Math.cos(inward) * back, cy = y - Math.sin(inward) * back;
    dark += splatPath(cx, cy, inward + (R() - 0.5) * 0.6, R, size);
    if (R() < 0.7) bright += splatPath(cx + Math.cos(inward) * size * 0.1, cy + Math.sin(inward) * size * 0.1, inward, R, size * 0.72);
  }
  return `<path d="${dark}" fill="rgba(96, 2, 2, .78)"/><path d="${bright}" fill="rgba(196, 26, 20, .7)"/>`;
}

export class VisorDamage {
  /**
   * @param {HTMLElement} root  the HUD layer (the visor goes under everything on it)
   * @param {object} o { player, reducedMotion }
   */
  constructor(root, { player, reducedMotion = false, seed = 0x51ed }) {
    this.player = player; this.reducedMotion = reducedMotion;
    this.R = rng(seed);
    if (!document.getElementById('visor-css')) document.head.appendChild(Object.assign(document.createElement('style'), { id: 'visor-css', textContent: CSS }));
    this.el = Object.assign(document.createElement('div'), { id: 'visor' });
    this.vig = Object.assign(document.createElement('div'), { className: 'vig' });
    this.flashEl = Object.assign(document.createElement('div'), { className: 'flash' });
    this.streaks = Object.assign(document.createElement('div'), { className: 'streaks' });
    const svg = (fit = 'xMidYMid slice') => { const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', `0 0 ${W} ${H}`); s.setAttribute('preserveAspectRatio', fit); return s; };
    this.bloodSvg = svg(); this.crackSvg = svg();
    // The low-health frame: blood round the border, made once (stretched to the screen; it's all edge).
    this.frame = svg('none');
    this.frame.innerHTML = bloodFrame(rng(seed ^ 0x9e37));
    this.frame.style.cssText = 'opacity: 0; will-change: opacity';
    this.el.append(this.vig, this.frame, this.streaks, this.bloodSvg, this.crackSvg, this.flashEl);
    root.prepend(this.el);
    this.time = 0; this.flash = 0; this.lastHp = 1; this.side = 0; this.fade = 1;
    this.shown = new Map();                      // element -> the opacity last written (DOM writes only on change)
    this.cracks = CRACK_AT.map(() => null);    // per threshold: { g } while it shows
    this.blood = [];                             // { g, t, life }
    const prev = player.onHit;
    player.onHit = (res, info, by) => { prev?.call(player, res, info, by); this.#hurt(res, info, by); };
    this.unhook = () => { player.onHit = prev; };
  }

  dispose() { this.unhook(); this.el.remove(); }

  #hurt(res, info, by) {
    const dmg = res?.dealt ?? 0, h = this.player.health;
    if (!(dmg > 0) || h.dead) return;
    this.flash = Math.min(1, Math.max(this.flash, 0.25 + dmg / 45));
    // Which side of the screen it came from (for where the visor cracks and the blood lands).
    let from = null;
    if (info?.from) from = _v.fromArray(info.from);
    else if (by?.movement && by !== this.player) from = _v.copy(by.movement.state.position);
    this.side = 0;
    if (from && this.camYaw != null) {
      // Headings as atan2(x, z), like the damage wedges: the view's minus the source's is + to the right.
      const me = this.player.movement.state.position, to = Math.atan2(from.x - me.x, from.z - me.z);
      const rel = Math.atan2(Math.sin(this.camYaw - to), Math.cos(this.camYaw - to));
      this.side = Math.abs(rel) > 2.6 ? 0 : rel > 0 ? 1 : -1;      // behind: either side
    }
    const frac = h.hp / h.max;
    if (dmg >= 12 && frac < 0.7 && this.R() < 0.4 + dmg / 80) this.#splat();
  }

  /** A spot near the screen's edge, on `side` (-1 left, 1 right, 0 either; never the middle). */
  #edge(margin) {
    const R = this.R, side = this.side || (R() < 0.5 ? -1 : 1);
    const x = side < 0 ? 150 + R() * margin : W - 150 - R() * margin;
    const y = R() < 0.5 ? 70 + R() * 230 : H - 70 - R() * 230;
    return [x, y];
  }

  #crack(i) {
    // Out from the middle of the screen (a quarter of the way in from a side, a third up or down),
    // never over the crosshair; the side the hit came from.
    const R = this.R, side = this.side || (R() < 0.5 ? -1 : 1), taken = this.cracks.filter(Boolean).map((c) => c.y);
    const cx = W / 2 + side * W * (0.16 + R() * 0.18);
    let cy = H * (0.25 + R() * 0.5);
    if (taken.some((y) => Math.abs(y - cy) < H * 0.2)) cy = cy < H / 2 ? cy + H * 0.3 : cy - H * 0.3;
    const g = document.createElementNS(NS, 'g'), d = crackPath(cx, cy, R, 1.1 + R() * 0.45);
    g.setAttribute('class', 'crack');
    g.innerHTML = `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="26" fill="url(#frost)"/>`
      + `<path d="${d}" fill="none" stroke="rgba(0,0,0,.32)" stroke-width="1.9" transform="translate(1 1.2)" stroke-linejoin="round"/>`
      + `<path d="${d}" fill="none" stroke="rgba(226,238,252,.7)" stroke-width=".9" stroke-linejoin="round"/>`
      + `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="3.2" fill="rgba(240,248,255,.75)"/>`;
    if (!this.crackSvg.querySelector('#frost')) this.crackSvg.insertAdjacentHTML('afterbegin', '<defs><radialGradient id="frost"><stop offset="0" stop-color="#e8f4ff" stop-opacity=".38"/><stop offset="1" stop-color="#e8f4ff" stop-opacity="0"/></radialGradient></defs>');
    g.style.opacity = 0;
    this.crackSvg.appendChild(g);
    requestAnimationFrame(() => { g.style.opacity = 1; });
    this.cracks[i] = { g, y: cy };
  }

  #splat() {
    const R = this.R, [cx, cy] = this.#edge(320), size = 34 + R() * 46;
    // Thrown in from the edge toward the middle.
    const a = Math.atan2(H / 2 - cy, W / 2 - cx) + (R() - 0.5) * 0.8;
    const g = document.createElementNS(NS, 'g');
    const d = splatPath(cx, cy, a, R, size);
    g.innerHTML = `<path d="${d}" fill="rgba(60,0,0,.55)" transform="translate(2 3)"/><path d="${d}" fill="rgba(122,8,6,.82)"/>`;
    this.bloodSvg.appendChild(g);
    this.blood.push({ g, t: 0, life: 7 + R() * 4 });
    while (this.blood.length > MAX_BLOOD) { const o = this.blood.shift(); o.g.remove(); this.shown.delete(o.g); }
  }

  #clear() {
    for (const c of this.cracks) c?.g.remove();
    this.cracks.fill(null);
    for (const b of this.blood) { b.g.remove(); this.shown.delete(b.g); }
    this.blood = [];
  }

  /** Opacity, written only when it changes; a layer at zero is taken out of the page's drawing altogether. */
  #op(el, v) {
    if (Math.abs((this.shown.get(el) ?? -1) - v) < 0.004) return;
    this.shown.set(el, v);
    el.style.opacity = v.toFixed(3);
    const off = v < 0.004;
    if (off !== (el.style.display === 'none')) el.style.display = off ? 'none' : '';
  }

  /** @param {THREE.Camera} camera */
  update(dt, camera) {
    this.time += dt;
    const e = camera.matrixWorld.elements;
    this.camYaw = Math.atan2(-e[8], -e[10]);
    const h = this.player.health, frac = h.dead ? 0 : Math.max(0, Math.min(1, h.hp / h.max));
    // A new life (or a full heal) starts clean.
    if (frac >= 0.999 && this.lastHp < 0.999) this.#clear();
    this.lastHp = frac;
    this.fade = h.dead ? Math.max(0, this.fade - dt * 2) : 1;
    this.#op(this.el, this.fade);
    if (h.dead) return;
    // Cracks come at their thresholds and fade once healed well past them.
    CRACK_AT.forEach((at, i) => {
      const c = this.cracks[i];
      if (!c && frac < at) this.#crack(i);
      else if (c && frac > at + HEAL) { c.g.classList.add('fade'); c.g.style.opacity = 0; const g = c.g; setTimeout(() => g.remove(), 800); this.cracks[i] = null; }
    });
    // The red edges: from 60% down, pulsing with the heartbeat under 30%.
    let red = Math.max(0, (0.6 - frac) / 0.5) ** 1.2 * 0.85;
    if (h.downed) red = 1;
    if (frac < 0.3 && !this.reducedMotion) {
      const beat = (this.time * 1.15) % 1, lub = Math.exp(-beat * 9), dub = beat > 0.18 ? 0.6 * Math.exp(-(beat - 0.18) * 9) : 0;
      red *= 0.78 + 0.22 * Math.min(1, lub + dub);
    }
    this.#op(this.vig, Math.min(1, red));
    // Under 35%: the corner streaks and the blood round the border.
    const low = h.downed ? 1 : Math.max(0, Math.min(1, (0.35 - frac) / 0.25));
    this.#op(this.streaks, low * (frac < 0.3 && !this.reducedMotion ? 0.85 + 0.15 * Math.sin(this.time * 7.2) : 1));
    this.#op(this.frame, low * 0.8);
    this.flash = Math.max(0, this.flash - dt * 3.2);
    this.#op(this.flashEl, this.flash ** 1.5);
    // Blood dries off.
    for (let i = this.blood.length - 1; i >= 0; i--) {
      const b = this.blood[i];
      b.t += dt;
      this.#op(b.g, b.t > b.life - 2.5 ? Math.max(0, (b.life - b.t) / 2.5) : 1);
      if (b.t >= b.life) { b.g.remove(); this.shown.delete(b.g); this.blood.splice(i, 1); }
    }
  }
}
