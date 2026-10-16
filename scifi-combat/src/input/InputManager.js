// InputManager: unifies keyboard/mouse + gamepad into one Command per sim tick.
// Buttons are tracked as {down, pressedTick, releasedTick} so gameplay code can do
// buffering ("was jump pressed within the last 150 ms?") without device knowledge.
// AI produces the same Command shape, so controllers never know who is driving.

const DEFAULT_BINDINGS = {
  jump:     { keys: ['Space'],                 pad: [0] },  // A / Cross
  crouch:   { keys: ['KeyC', 'ControlLeft'],   pad: [1] },  // B / Circle (hold = prone)
  sprint:   { keys: ['ShiftLeft'],             pad: [10] }, // L3
  dodge:    { keys: ['AltLeft', 'KeyV'],       pad: [2] },  // X / Square
  light:    { mouse: [0],                      pad: [7] },  // RT  (fire when gun out)
  heavy:    { keys: ['KeyF'],                  pad: [5] },  // RB
  guard:    { mouse: [2],                      pad: [6] },  // LT  (ADS when gun out)
  interact: { keys: ['KeyX'],                  pad: [3] },  // Y / Triangle (hold)
  reload:   { keys: ['KeyR'],                  pad: [3] },  // Y / Triangle (tap)
  swapShoulder: { keys: ['KeyB'],              pad: [11] }, // R3
  togglePOV:{ keys: ['KeyT'],                  pad: [8] },  // View/Share
  toggleMelee:{ keys: ['Digit1'],              pad: [15] }, // D-pad right: sword <-> guns
  swapWeapon:{ keys: ['Digit2'],               pad: [] },   // next gun (pad: hold D-pad right, TBD)
  // Ability kit (Destiny: grenade/class/super; Deadlock: 1-2-3-4)
  ability1: { keys: ['KeyQ'],                  pad: [4] },  // LB
  ability2: { keys: ['KeyE'],                  pad: [12] }, // D-pad up
  grenade:  { keys: ['KeyG'],                  pad: [14] }, // D-pad left
  super:    { keys: ['KeyZ'],                  pad: [13] }, // D-pad down (or LB+RB chord)
};

export function emptyCommand() {
  return {
    tick: 0,
    moveX: 0, moveY: 0,      // -1..1, camera-relative (x = right, y = forward)
    yaw: 0, pitch: 0,         // absolute view angles (radians)
    buttons: {},              // name -> { down, pressed, released }
  };
}

export class InputManager {
  constructor(dom, { bindings = DEFAULT_BINDINGS, mouseSens = 0.0022, padSens = 3.2, deadzone = 0.15 } = {}) {
    this.bindings = bindings;
    this.mouseSens = mouseSens;
    this.padSens = padSens;
    this.deadzone = deadzone;
    this.keys = new Set();
    this.mouse = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.prev = {};
    this.lastDevice = 'kbm';

    addEventListener('keydown', (e) => { this.keys.add(e.code); this.lastDevice = 'kbm'; });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    dom.addEventListener('mousedown', (e) => { this.mouse.add(e.button); dom.requestPointerLock?.(); });
    addEventListener('mouseup', (e) => this.mouse.delete(e.button));
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== dom) return;
      this.yaw -= e.movementX * this.mouseSens;
      this.pitch -= e.movementY * this.mouseSens;
      this.clampPitch();
    });
  }

  clampPitch() { this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch)); }

  // Radial deadzone + response curve: small stick motions stay precise, full tilt is fast.
  stick(x, y) {
    const mag = Math.hypot(x, y);
    if (mag < this.deadzone) return [0, 0];
    const scaled = Math.min(1, (mag - this.deadzone) / (1 - this.deadzone));
    const curved = scaled * scaled; // quadratic response
    return [(x / mag) * curved, (y / mag) * curved];
  }

  sample(tick, dt) {
    const cmd = emptyCommand();
    cmd.tick = tick;

    // Keyboard movement
    let mx = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    let my = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);

    const pad = navigator.getGamepads?.().find(Boolean);
    if (pad) {
      const [lx, ly] = this.stick(pad.axes[0], pad.axes[1]);
      const [rx, ry] = this.stick(pad.axes[2], pad.axes[3]);
      if (lx || ly || rx || ry) this.lastDevice = 'pad';
      if (lx || ly) { mx = lx; my = -ly; }
      this.yaw -= rx * this.padSens * dt;
      this.pitch -= ry * this.padSens * 0.75 * dt;
      this.clampPitch();
    }

    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    cmd.moveX = mx; cmd.moveY = my;
    cmd.yaw = this.yaw; cmd.pitch = this.pitch;

    for (const [name, b] of Object.entries(this.bindings)) {
      const down =
        (b.keys ?? []).some((k) => this.keys.has(k)) ||
        (b.mouse ?? []).some((m) => this.mouse.has(m)) ||
        (pad && (b.pad ?? []).some((i) => pad.buttons[i]?.pressed));
      const was = !!this.prev[name];
      cmd.buttons[name] = { down: !!down, pressed: !!down && !was, released: !down && was };
      this.prev[name] = !!down;
    }
    return cmd;
  }

  rumble(strong = 0.5, weak = 0.5, ms = 80) {
    const pad = navigator.getGamepads?.().find(Boolean);
    pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak });
  }
}
