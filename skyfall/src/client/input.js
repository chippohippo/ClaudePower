// Raw input: pointer-locked mouse look (unaccelerated, per-event deltas), key state with edge
// detection, and Apex-default bindings. Settings persist in localStorage.

export const DEFAULT_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', crouch: 'ControlLeft', crouch2: 'KeyC', sprint: 'ShiftLeft',
  reload: 'KeyR', interact: 'KeyE', tactical: 'KeyQ', ultimate: 'KeyZ', grenade: 'KeyG',
  slot1: 'Digit1', slot2: 'Digit2', heal: 'KeyH', shield: 'Digit4', health: 'Digit5',
  inventory: 'Tab', map: 'KeyM', ping: 'KeyX', holster: 'Digit3', spectate: 'KeyV',
};

export const settings = {
  sens: 1.6, // in Apex-like units (deg per count * ~0.022 * sens)
  adsSens: 1.0,
  fov: 90, // horizontal-ish "Apex FOV" mapped to vertical internally
  volume: 0.8,
  toggleAds: false,
  toggleCrouch: false,
  invertY: false,
  showFps: true,
  quality: 'high',
};

try {
  const s = JSON.parse(localStorage.getItem('skyfall.settings') || '{}');
  Object.assign(settings, s);
} catch {}

export function saveSettings() {
  try { localStorage.setItem('skyfall.settings', JSON.stringify(settings)); } catch {}
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, middle: false, wheel: 0 };
    this.mousePressed = { left: false, right: false, middle: false };
    this.locked = false;
    this.binds = { ...DEFAULT_BINDS };
    this.adsToggled = false;
    this.crouchToggled = false;
    this.enabled = true;
    document.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Tab' || (e.code.startsWith('Control') && this.locked) || e.code === 'Space') e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    document.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.left = true; this.mousePressed.left = true; }
      if (e.button === 2) { this.mouse.right = true; this.mousePressed.right = true; if (settings.toggleAds) this.adsToggled = !this.adsToggled; }
      if (e.button === 1) { this.mouse.middle = true; this.mousePressed.middle = true; e.preventDefault(); }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
      if (e.button === 1) this.mouse.middle = false;
    });
    document.addEventListener('wheel', (e) => { if (this.locked) this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.keys.clear(); this.mouse.left = this.mouse.right = false; }
    });
  }

  lock() {
    if (!this.locked) {
      try {
        const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
        if (p && p.catch) p.catch(() => this.canvas.requestPointerLock());
      } catch { this.canvas.requestPointerLock(); }
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(action) {
    const k = this.binds[action];
    if (action === 'crouch') return this.keys.has(k) || this.keys.has(this.binds.crouch2);
    return this.keys.has(k);
  }

  hit(action) {
    const k = this.binds[action];
    if (action === 'crouch') return this.pressed.has(k) || this.pressed.has(this.binds.crouch2);
    return this.pressed.has(k);
  }

  ads() {
    return settings.toggleAds ? this.adsToggled : this.mouse.right;
  }

  consumeMouse() {
    const d = { dx: this.mouse.dx, dy: this.mouse.dy, wheel: this.mouse.wheel };
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
    return d;
  }

  endFrame() {
    this.pressed.clear();
    this.mousePressed.left = this.mousePressed.right = this.mousePressed.middle = false;
  }
}
