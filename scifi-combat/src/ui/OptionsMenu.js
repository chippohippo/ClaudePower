// OptionsMenu: the options panel (graphics, camera, audio, controls), in the game behind [Esc]
// and on the start menu. Every change is saved at once and handed to onChange(settings, key),
// which applies it live; a preset sets the graphics group, and tuning any of it reads CUSTOM.

import { loadSettings, saveSettings, applyPreset, presetOf, PRESETS } from './Settings.js';

const CSS = `
@font-face { font-family: 'HudDisplay'; src: url(./vendor/fonts/Orbitron.woff2) format('woff2'); font-weight: 400 900; font-display: swap; }
@font-face { font-family: 'HudText'; src: url(./vendor/fonts/Rajdhani-SemiBold.woff2) format('woff2'); font-weight: 600; font-display: swap; }
@font-face { font-family: 'HudText'; src: url(./vendor/fonts/Rajdhani-Bold.woff2) format('woff2'); font-weight: 700; font-display: swap; }
#opt-menu { position: fixed; inset: 0; z-index: 20; display: none; place-items: center; background: #05060acc; pointer-events: auto;
  font: 600 15px 'HudText', 'Bahnschrift SemiCondensed', 'Bahnschrift', system-ui, sans-serif; color: #eef2f8; }
#opt-menu.open { display: grid; }
#opt-menu .panel { box-sizing: border-box; width: min(620px, 94vw); max-height: 94vh; overflow: auto; background: #0b0d14f2; border-left: 3px solid #ffc94d; padding: 16px 24px 18px;
  box-shadow: 0 10px 40px #000a; }
#opt-menu h1 { margin: 0 0 4px; font: 800 20px 'HudDisplay', 'Bahnschrift', sans-serif; letter-spacing: 5px; }
#opt-menu h2 { margin: 14px 0 6px; font: 700 11px 'HudDisplay', 'Bahnschrift', sans-serif; letter-spacing: 3px; color: #ffc94d; }
#opt-menu .row { display: grid; grid-template-columns: 150px 1fr; align-items: center; gap: 12px; margin: 5px 0; }
#opt-menu .row label { color: #c9d2e3; letter-spacing: .5px; }
#opt-menu .seg { display: flex; flex-wrap: wrap; gap: 4px; }
#opt-menu button { font: 700 11px 'HudDisplay', 'Bahnschrift', sans-serif; letter-spacing: 1.5px; color: #c9d2e3; background: #ffffff0d; border: 1px solid #ffffff26;
  padding: 6px 10px; cursor: pointer; text-transform: uppercase; }
#opt-menu button:hover { border-color: #ffffff66; color: #fff; }
#opt-menu button.on { background: #5ab4ff26; border-color: #5ab4ff; color: #fff; }
#opt-menu .custom { font: 700 10px 'HudDisplay', sans-serif; letter-spacing: 2px; color: #ffc94d; margin-left: 6px; align-self: center; }
#opt-menu .slide { display: flex; align-items: center; gap: 10px; }
#opt-menu input[type=range] { flex: 1; accent-color: #5ab4ff; }
#opt-menu .val { width: 54px; text-align: right; font: 700 12px 'HudDisplay', sans-serif; }
#opt-menu .chips { display: flex; flex-wrap: wrap; gap: 6px; }
#opt-menu .note { font-size: 13px; color: #9aa3b5; margin-top: 4px; }
#opt-menu .foot { display: flex; justify-content: space-between; gap: 10px; margin-top: 16px; }
#opt-menu .foot button { padding: 9px 18px; font-size: 12px; }
#opt-menu .foot .go { background: #ffc94d; color: #0b0d14; border-color: #ffc94d; }
`;

const SLIDERS = {
  renderScale: { label: 'Render scale', min: 0.5, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  fov: { label: 'Field of view', min: 55, max: 100, step: 1, fmt: (v) => `${v}°` },
  shake: { label: 'Camera shake', min: 0, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  bob: { label: 'Step bob', min: 0, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  volume: { label: 'Volume', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  sens: { label: 'Mouse sensitivity', min: 0.25, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) },
};
const TOGGLES = {
  graphics: [['shadows', 'Shadows'], ['bloom', 'Bloom'], ['rays', 'God rays'], ['ink', 'Ink outlines'], ['letterbox', 'Letterbox'], ['film', 'Film grain'], ['particles', 'Snow & ash'], ['hiDpi', 'High DPI']],
  camera: [['reducedMotion', 'Reduced motion']],
  audio: [['voices', 'Voices']],
};

export class OptionsMenu {
  /**
   * @param {HTMLElement} root
   * @param {object} o { onChange(settings, key), onClose(), onQuit() (in a match), inGame }
   */
  constructor(root, { onChange = () => {}, onClose = () => {}, onQuit = null, inGame = false } = {}) {
    this.settings = loadSettings();
    this.onChange = onChange; this.onClose = onClose; this.onQuit = onQuit; this.inGame = inGame;
    if (!document.getElementById('opt-css')) document.head.appendChild(Object.assign(document.createElement('style'), { id: 'opt-css', textContent: CSS }));
    this.el = Object.assign(document.createElement('div'), { id: 'opt-menu' });
    this.el.addEventListener('mousedown', (e) => { if (e.target === this.el) this.close(); });
    root.appendChild(this.el);
    this.render();
  }

  get isOpen() { return this.el.classList.contains('open'); }
  open() { this.render(); this.el.classList.add('open'); }
  close() { if (!this.isOpen) return; this.el.classList.remove('open'); this.onClose(); }
  toggle() { if (this.isOpen) this.close(); else this.open(); }

  #set(key, value) {
    const s = this.settings;
    if (key === 'preset') applyPreset(s, value);
    else { s[key] = value; s.preset = presetOf(s); }
    saveSettings(s);
    this.onChange(s, key);
    this.render();
  }

  render() {
    const s = this.settings, el = this.el;
    const btn = (text, on, fn) => { const b = document.createElement('button'); b.textContent = text; if (on) b.className = 'on'; b.onclick = fn; return b; };
    const row = (label, ...kids) => { const r = document.createElement('div'); r.className = 'row'; const l = document.createElement('label'); l.textContent = label; const v = document.createElement('div'); v.append(...kids); r.append(l, v); return r; };
    const seg = (...bs) => { const d = document.createElement('div'); d.className = 'seg'; d.append(...bs); return d; };
    const slider = (key) => {
      const S = SLIDERS[key], d = document.createElement('div'); d.className = 'slide';
      const input = Object.assign(document.createElement('input'), { type: 'range', min: S.min, max: S.max, step: S.step, value: s[key] });
      const val = Object.assign(document.createElement('span'), { className: 'val', textContent: S.fmt(s[key]) });
      input.oninput = () => { val.textContent = S.fmt(Number(input.value)); };
      input.onchange = () => this.#set(key, Number(input.value));
      d.append(input, val);
      return row(S.label, d);
    };
    const chips = (list) => { const d = document.createElement('div'); d.className = 'chips'; for (const [k, name] of list) d.append(btn(`${name} ${s[k] ? 'on' : 'off'}`, s[k], () => this.#set(k, !s[k]))); return d; };
    const h = (t) => Object.assign(document.createElement('h2'), { textContent: t });

    const panel = document.createElement('div'); panel.className = 'panel';
    panel.append(Object.assign(document.createElement('h1'), { textContent: this.inGame ? 'PAUSED · OPTIONS' : 'OPTIONS' }));
    panel.append(h('GRAPHICS'));
    const presets = seg(...Object.keys(PRESETS).map((p) => btn(p, s.preset === p, () => this.#set('preset', p))));
    if (s.preset === 'custom') presets.append(Object.assign(document.createElement('span'), { className: 'custom', textContent: 'CUSTOM' }));
    panel.append(row('Preset', presets));
    panel.append(slider('renderScale'));
    panel.append(row('Anti-aliasing', seg(btn('Off', s.aa === 0, () => this.#set('aa', 0)), btn('MSAA 2×', s.aa === 2, () => this.#set('aa', 2)), btn('MSAA 4×', s.aa === 4, () => this.#set('aa', 4)))));
    panel.append(row('Effects', chips(TOGGLES.graphics)));
    panel.append(Object.assign(document.createElement('div'), { className: 'note', textContent: 'Below 100% the 3D image is drawn smaller, scaled up and sharpened (contrast-adaptive, like FSR 1): the cheapest way to more frames. High DPI draws at your display\'s full pixel density.' }));
    panel.append(h('CAMERA'));
    panel.append(slider('fov'), slider('shake'), slider('bob'));
    panel.append(row('Comfort', chips(TOGGLES.camera)));
    panel.append(h('AUDIO'));
    panel.append(slider('volume'));
    panel.append(row('Callouts', chips(TOGGLES.audio)));
    panel.append(h('CONTROLS'));
    panel.append(slider('sens'));
    const foot = document.createElement('div'); foot.className = 'foot';
    if (this.inGame) {
      const quit = btn('Quit to menu', false, () => this.onQuit?.());
      const resume = btn('Resume', false, () => this.close()); resume.classList.add('go');
      foot.append(quit, resume);
    } else {
      const done = btn('Done', false, () => this.close()); done.classList.add('go');
      foot.append(Object.assign(document.createElement('span')), done);
    }
    panel.append(foot);
    el.replaceChildren(panel);
  }
}
