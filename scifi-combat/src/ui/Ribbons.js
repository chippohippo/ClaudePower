// Ribbons as you see them: each ribbon's bar, in stripes of its own colours like a service ribbon's
// (the after-action report, the toasts in a match, the start menu's career). No dependencies, so
// the start menu can load it.

/** Each ribbon's stripes. */
export const STRIPES = {
  combat:    ['#4a1414', '#d8432f', '#1b1b1f', '#d8432f', '#4a1414'],
  medic:     ['#e9eef2', '#2f9e5b', '#e9eef2', '#2f9e5b', '#e9eef2'],
  objective: ['#1f3f8a', '#f2c14e', '#1f3f8a', '#f2c14e', '#1f3f8a'],
  defender:  ['#2a3446', '#6f8fbf', '#d9e2f0', '#6f8fbf', '#2a3446'],
  armor:     ['#1b1b1f', '#e8892f', '#1b1b1f', '#e8892f', '#1b1b1f'],
  support:   ['#0f5f62', '#e9eef2', '#38b5ad', '#e9eef2', '#0f5f62'],
  recon:     ['#3b2a5c', '#9b7fd6', '#202027', '#9b7fd6', '#3b2a5c'],
  teamwork:  ['#24467a', '#f2c14e', '#e9eef2', '#f2c14e', '#24467a'],
};

/** A ribbon's bar as an inline SVG. */
export function ribbonSvg(id, w = 46, h = 13) {
  const s = STRIPES[id] ?? ['#666', '#999', '#666'], k = w / s.length;
  return `<svg class="mf-rib" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${s.map((c, i) => `<rect x="${(i * k).toFixed(2)}" width="${(k + 0.05).toFixed(2)}" height="${h}" fill="${c}"/>`).join('')}<rect width="${w}" height="${h}" fill="none" stroke="#0008" stroke-width="1.5"/></svg>`;
}
