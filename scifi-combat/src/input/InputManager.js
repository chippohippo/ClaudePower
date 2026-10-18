// InputManager: unifies keyboard/mouse + gamepad into one Command per sim tick.
// Buttons are tracked as {down, pressedTick, releasedTick} so gameplay code can do
// buffering ("was jump pressed within the last 150 ms?") without device knowledge.
// AI produces the same Command shape, so controllers never know who is driving.

const DEFAULT_BINDINGS = {
  jump:     { keys: ['Space'],                 pad: [0] },  // A / Cross
  crouch:   { keys: ['KeyC'],                  pad: [1] },  // B / Circle: tap = crouch, hold = prone (HD2 pad layout); while sprinting = slide
  sprint:   { keys: ['ShiftLeft'],             pad: [10] }, // L3
  dodge:    { keys: ['AltLeft'],               pad: [2] },  // X / Square: HD2 dive (class evade for melee classes)
  cover:    { keys: ['KeyT'],                  pad: [] },   // into (and out of) cover against the wall, barrier or parked car in front of you
  bash:     { keys: ['KeyF'],                  pad: [11] }, // R3: quick melee with a gun out (a rifle-butt shove; F is the sword's heavy)
  light:    { mouse: [0],                      pad: [7] },  // RT  (fire when gun out)
  heavy:    { keys: ['KeyF'],                  pad: [5] },  // RB
  guard:    { mouse: [2],                      pad: [6] },  // LT  (ADS when gun out)
  interact: { keys: ['KeyX'],                  pad: [3] },  // Y / Triangle (hold)
  dig:      { keys: ['KeyH'],                  pad: [] },   // hold: dig in (foxhole, sandbags, then trench to the next position)
  reload:   { keys: ['KeyR'],                  pad: [3] },  // Y / Triangle (tap)
  swapShoulder: { keys: ['KeyB'],              pad: [] },   // (R3 is the quick melee)
  togglePOV:{ keys: ['KeyV'],                  pad: [8] },  // View/Share: first / third person
  toggleMelee:{ keys: ['Digit1'],              pad: [15] }, // D-pad right: sword <-> guns
  swapWeapon:{ keys: ['Digit2'],               pad: [] },   // next gun (pad: hold D-pad right, TBD)
  item:     { keys: ['Digit3'],                pad: [] },   // the role's item: a medic's stim, an engineer's ammo pack
  ping:     { keys: ['KeyY'], mouse: [1],      pad: [] },   // tap: ping what's under the crosshair; double tap: danger; hold: the ping wheel
  // Ability kit (Destiny: grenade/class/super; Deadlock: 1-2-3-4)
  ability1: { keys: ['KeyQ'],                  pad: [] },   // LB tap (on release; see sample)
  ability2: { keys: ['KeyE'],                  pad: [12] }, // D-pad up
  grenade:  { keys: ['KeyG'],                  pad: [14] }, // D-pad left
  super:    { keys: ['KeyZ'],                  pad: [13] }, // D-pad down (or LB+RB chord)
  debugNextKit: { keys: ['KeyK'],              pad: [] },   // demo only: cycle class kits
  // Call-ins (stratagems): hold Tab and type the code with WASD or the arrow keys (Ctrl works
  // with the arrow keys: Ctrl+W would close the browser tab). Pad: hold LB (a tap is still ability1).
  stratagem:  { keys: ['Tab', 'ControlLeft', 'ControlRight'], pad: [] },
  arrowUp:    { keys: ['ArrowUp'],             pad: [] },
  arrowDown:  { keys: ['ArrowDown'],           pad: [] },
  arrowLeft:  { keys: ['ArrowLeft'],           pad: [] },
  arrowRight: { keys: ['ArrowRight'],          pad: [] },
};

/** While the call-in is held (Tab): WASD and the D-pad type arrows (and WASD stop walking). */
const CODE_KEYS = { arrowUp: ['KeyW'], arrowDown: ['KeyS'], arrowLeft: ['KeyA'], arrowRight: ['KeyD'] };
const CODE_PAD = { arrowUp: 12, arrowDown: 13, arrowLeft: 14, arrowRight: 15 };
const PAD_LB = 4, HOLD_FOR_CALLIN = 0.25;   // s: LB held this long opens the call-in; a shorter tap is ability1

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
    this.lookLock = null;   // { x, y }: the mouse moves this instead of the view (the ping wheel)

    addEventListener('keydown', (e) => { this.keys.add(e.code); this.lastDevice = 'kbm'; if (e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault(); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    dom.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); this.mouse.add(e.button); dom.requestPointerLock?.(); });   // (the middle button pings: no autoscroll)
    addEventListener('mouseup', (e) => this.mouse.delete(e.button));
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== dom) return;
      if (this.lookLock) { this.lookLock.x += e.movementX; this.lookLock.y += e.movementY; return; }
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

    // The call-in: Tab (or Ctrl) on the keyboard; on a pad, LB held past HOLD_FOR_CALLIN (a tap stays ability1).
    const lb = !!pad?.buttons[PAD_LB]?.pressed;
    this.lbHeld = lb ? (this.lbHeld ?? 0) + dt : 0;
    const padCallIn = lb && this.lbHeld >= HOLD_FOR_CALLIN;
    const tabCall = this.keys.has('Tab');
    const callIn = this.bindings.stratagem.keys.some((k) => this.keys.has(k)) || padCallIn;
    if (tabCall) { mx = 0; my = 0; }                            // WASD type the code instead of walking

    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    cmd.moveX = mx; cmd.moveY = my;
    cmd.yaw = this.yaw; cmd.pitch = this.pitch;

    for (const [name, b] of Object.entries(this.bindings)) {
      let down =
        (b.keys ?? []).some((k) => this.keys.has(k)) ||
        (b.mouse ?? []).some((m) => this.mouse.has(m)) ||
        (pad && (b.pad ?? []).some((i) => pad.buttons[i]?.pressed));
      if (name === 'stratagem') down = callIn;
      else if (CODE_KEYS[name]) down = down || (tabCall && CODE_KEYS[name].some((k) => this.keys.has(k))) || (padCallIn && !!pad.buttons[CODE_PAD[name]]?.pressed);
      else if (callIn && pad && (b.pad ?? []).some((i) => Object.values(CODE_PAD).includes(i) || i === PAD_LB)) down = false;   // the D-pad and LB belong to the code now
      const was = !!this.prev[name];
      cmd.buttons[name] = { down: !!down, pressed: !!down && !was, released: !down && was };
      this.prev[name] = !!down;
    }
    // A short LB tap is ability1 on release (LB held long opened the call-in instead).
    if (pad && !lb && this.lbWas && this.lbTap) cmd.buttons.ability1 = { down: false, pressed: true, released: false };
    this.lbTap = lb ? this.lbHeld < HOLD_FOR_CALLIN : this.lbTap && false;
    this.lbWas = lb;
    return cmd;
  }

  rumble(strong = 0.5, weak = 0.5, ms = 80) {
    const pad = navigator.getGamepads?.().find(Boolean);
    pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak });
  }
}
