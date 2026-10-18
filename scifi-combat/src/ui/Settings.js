// Settings: the player's options (graphics, camera, audio, controls), saved in the browser so the
// start menu and the game share them. Presets set the graphics group; anything can then be tuned
// one by one (the preset reads CUSTOM). The game applies them live (OptionsMenu, frontline.js);
// the URL's `fx` still overrides for a single run (fx=low, fx=off).

const KEY = 'emberfall.settings.v1';

export const DEFAULTS = {
  preset: 'high',
  // Graphics
  renderScale: 1,       // the 3D image's resolution against the screen's (upscaled and sharpened)
  hiDpi: false,         // draw at the display's full pixel density (sharp on 4K and laptops; costly)
  aa: 4,                // MSAA samples: 0, 2 or 4
  shadows: true,
  bloom: true,
  rays: true,           // god rays
  ink: true,            // the ink outlines of the stylized look
  letterbox: true,      // cinematic bars (planets that have them)
  film: true,           // film grain and chromatic aberration
  particles: true,      // falling snow and ash
  // Camera
  fov: 70,
  shake: 1,
  bob: 1,
  reducedMotion: false,
  // Audio
  volume: 0.9,
  voices: true,
  // Controls
  sens: 1,
};

/** The graphics group of each preset. */
export const PRESETS = {
  low: { renderScale: 0.67, hiDpi: false, aa: 0, shadows: false, bloom: false, rays: false, ink: true, film: false, particles: false },
  medium: { renderScale: 0.85, hiDpi: false, aa: 0, shadows: true, bloom: true, rays: false, ink: true, film: true, particles: true },
  high: { renderScale: 1, hiDpi: false, aa: 4, shadows: true, bloom: true, rays: true, ink: true, film: true, particles: true },
  ultra: { renderScale: 1, hiDpi: true, aa: 4, shadows: true, bloom: true, rays: true, ink: true, film: true, particles: true },
};
export const GRAPHICS_KEYS = Object.keys(PRESETS.high);

export function loadSettings() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch { return { ...DEFAULTS }; }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window: this run only */ }
}

/** A preset applied to the settings (graphics only). */
export function applyPreset(s, name) {
  if (!PRESETS[name]) return s;
  return Object.assign(s, PRESETS[name], { preset: name });
}

/** Which preset the graphics now match, or 'custom'. */
export function presetOf(s) {
  for (const [name, p] of Object.entries(PRESETS)) if (GRAPHICS_KEYS.every((k) => p[k] === s[k])) return name;
  return 'custom';
}

/** The URL's fx override (fx=low: the low preset; fx=off: no post-processing at all) for one run. */
export function withUrlOverrides(s, params) {
  const fx = params.get('fx');
  if (fx === 'low') applyPreset(s, 'low');
  s.postOff = fx === 'off';
  return s;
}
