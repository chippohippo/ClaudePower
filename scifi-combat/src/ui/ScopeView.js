// ScopeView: looking through a magnified optic (any gun whose sights narrow the view to 30° or less:
// the snipers, a 4x optic). Aiming down it, the camera goes to the sight whatever the view (third
// person too), the gun and the arms aren't drawn, and the screen is the sight picture: a round field
// of view with black round it, the reticle (posts, a fine crosshair with its stadia dots, a lit dot in
// the middle), the lens's tint and a faint glare, the edge of the picture darkening. The magnification
// is the gun's own ADS field of view (the Longwatch's 18° is about 4x on a 70° view).
// Presentation only: what the sim does with aiming (sway, the held breath) is the weapon's.

const CSS = `
#scope { position: fixed; inset: 0; pointer-events: none; opacity: 0; z-index: 3; --r: 44vmin; }
#hud #fl-right, #hud #fl-top { z-index: 4; }   /* the rounds left and the score stay readable over the black */
#scope .mask { position: absolute; inset: 0; background: radial-gradient(circle at 50% 50%, transparent 0, transparent calc(var(--r) - 3px), rgba(0,0,0,.92) var(--r), #000 calc(var(--r) + 24px)); }
#scope .lens { position: absolute; left: 50%; top: 50%; width: calc(var(--r) * 2); height: calc(var(--r) * 2); transform: translate(-50%, -50%); border-radius: 50%;
  box-shadow: inset 0 0 calc(var(--r) * .32) calc(var(--r) * .1) rgba(0,0,0,.7), inset 0 0 4px 2px rgba(140,190,255,.18);
  background: radial-gradient(circle at 35% 30%, rgba(190,220,255,.07), transparent 40%), linear-gradient(rgba(120,160,200,.05), rgba(60,90,120,.04)); }
#scope svg { position: absolute; left: 50%; top: 50%; width: calc(var(--r) * 2); height: calc(var(--r) * 2); transform: translate(-50%, -50%); overflow: visible; }
`;

/** The reticle, in a -100..100 box: thick posts from the edge, a fine cross, stadia dots, a lit dot. */
function reticle() {
  const dots = [];
  for (const d of [8, 16, 24]) for (const [x, y] of [[d, 0], [-d, 0], [0, d], [0, -d]]) dots.push(`<circle cx="${x}" cy="${y}" r="0.9"/>`);
  const posts = [[0, -100, 0, -30], [0, 100, 0, 30], [-100, 0, -30, 0], [100, 0, 30, 0]].map(([a, b, c, d]) => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}"/>`).join('');
  const fine = '<line x1="-30" y1="0" x2="30" y2="0"/><line x1="0" y1="-30" x2="0" y2="30"/>';
  // A faint light halo under the black lines keeps them readable against a dark street.
  return `<svg viewBox="-100 -100 200 200">
    <g stroke="rgba(230,240,255,.28)" fill="none" stroke-linecap="butt"><g stroke-width="3.4">${posts}</g><g stroke-width="1.1">${fine}</g></g>
    <g stroke="#05070a" fill="none"><g stroke-width="2.2">${posts}</g><g stroke-width="0.45">${fine}</g></g>
    <g fill="#05070a">${dots.join('')}</g>
    <circle cx="0" cy="0" r="0.75" fill="#ff3b2f"/><circle cx="0" cy="0" r="1.8" fill="rgba(255,60,40,.25)"/>
  </svg>`;
}

export class ScopeView {
  /** @param {HTMLElement} root  the HUD (#hud) */
  constructor(root) {
    if (!document.getElementById('scope-css')) document.head.appendChild(Object.assign(document.createElement('style'), { id: 'scope-css', textContent: CSS }));
    this.el = Object.assign(document.createElement('div'), { id: 'scope' });
    this.el.innerHTML = `<div class="mask"></div><div class="lens"></div>${reticle()}`;
    root.appendChild(this.el);
    this.k = 0;
    this.shown = -1;
  }

  /** Does this gun look through a magnified optic? */
  static scoped(gun) { return (gun?.s?.ads?.fov ?? 90) <= 30; }

  /**
   * @param {number} dt
   * @param {object} o { scoped: a magnified optic up and nothing else in the way, ads: 0..1 }
   * @returns {number} how far into the scope (0..1): past 0.5 the view is the sight picture
   */
  update(dt, { scoped, ads }) {
    // The picture comes up over the last part of raising the gun (and goes as it comes down).
    const want = scoped ? Math.min(1, Math.max(0, (ads - 0.6) / 0.35)) : 0;
    this.k = want;
    const o = this.k * this.k * (3 - 2 * this.k);
    if (Math.abs(o - this.shown) > 0.01) { this.shown = o; this.el.style.opacity = o.toFixed(3); }
    return this.k;
  }
}
