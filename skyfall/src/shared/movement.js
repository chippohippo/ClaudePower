// Deterministic player movement — the heart of the game feel.
// Runs identically on the client (prediction) and the server (authority).
//
// Implements: momentum-preserving ground movement, sprint, crouch, slide (with boost cooldown),
// slide-jumping / slide-hopping, Source-style air strafing (tap-strafe redirects), bunny hop
// landing grace, wall jumps / wall bounces, wall climbing, mantling, superglides, skydiving,
// jetpack hover and downed crawling.

import { MOVE, BTN } from './constants.js';

export function createMoveState(x = 0, y = 0, z = 0) {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0,
    mode: 'air',          // ground | air | slide | mantle | skydive
    onGround: false,
    crouch: 0,            // 0 standing .. 1 crouched
    slideCd: 0,
    landT: 1,             // time since landing
    airT: 0,              // time airborne
    wallT: 9,             // time since last wall contact
    wallNx: 0, wallNz: 0,
    wallJumpCd: 0,
    climbT: 0,            // climb time left this airtime
    mantleT: 0, mantleDur: 0,
    msx: 0, msy: 0, msz: 0, mex: 0, mey: 0, mez: 0,
    mfx: 0, mfz: 0,
    jumpBuf: 0,           // jump buffered (s)
    crouchPressT: 9,      // time since crouch press (for superglide)
    prevBtn: 0,
    // modifiers set by the simulation
    speedMul: 1,
    downed: 0,
    jetpack: 0,           // 1 if legend has jetpack passive
    fuel: 1,
    launchT: 0,           // skyward launch time remaining
    lastLandSpeed: 0,
    events: 0,            // bit flags of things that happened this step (for audio/vfx)
  };
}

export const MEV = {
  JUMP: 1, LAND: 2, SLIDE: 4, WALLJUMP: 8, MANTLE: 16, SUPERGLIDE: 32, CLIMB: 64, STEP: 128, HARDLAND: 256, JET: 512, PAD: 1024,
};

// Copies every field (used for snapshots/reconciliation).
export function copyMoveState(src, dst = {}) {
  for (const k in src) dst[k] = src[k];
  return dst;
}

const tmpBoxes = [];

export function playerHeight(s) {
  return MOVE.standHeight - (MOVE.standHeight - MOVE.crouchHeight) * s.crouch;
}
export function eyeHeight(s) {
  if (s.downed) return 0.55;
  return MOVE.eyeStand - (MOVE.eyeStand - MOVE.eyeCrouch) * s.crouch;
}

function overlapsAt(world, x, y, z, h) {
  const r = MOVE.radius;
  return world.overlaps(x - r, y, z - r, x + r, y + h, z + r, tmpBoxes);
}

// Move along one axis and resolve penetration. Returns 1 on collision, 2 if a step-up happened.
function moveAxis(world, s, axis, delta, h, allowStep) {
  if (delta === 0) return 0;
  const r = MOVE.radius;
  if (axis === 1) {
    s.y += delta;
    if (s.y < 0) { s.y = 0; return 1; }
  } else if (axis === 0) s.x += delta;
  else s.z += delta;
  world.query(s.x - r, s.z - r, s.x + r, s.z + r, tmpBoxes);
  let hit = 0;
  for (let i = 0; i < tmpBoxes.length; i++) {
    const b = tmpBoxes[i];
    if (!(s.x + r > b.min[0] && s.x - r < b.max[0] && s.y + h > b.min[1] && s.y < b.max[1] && s.z + r > b.min[2] && s.z - r < b.max[2])) continue;
    if (axis === 1) {
      if (delta < 0) s.y = b.max[1];
      else s.y = b.min[1] - h - 0.001;
      hit = 1;
    } else {
      // try step-up for low obstacles
      const rise = b.max[1] - s.y;
      if (allowStep && rise > 0 && rise <= MOVE.stepHeight && !overlapsAt(world, s.x, b.max[1] + 0.001, s.z, h)) {
        s.y = b.max[1] + 0.001;
        hit = 2;
        continue;
      }
      if (axis === 0) s.x = delta > 0 ? b.min[0] - r - 0.001 : b.max[0] + r + 0.001;
      else s.z = delta > 0 ? b.min[2] - r - 0.001 : b.max[2] + r + 0.001;
      return 1;
    }
  }
  return hit;
}

function accelerate(s, wx, wz, wishSpeed, accel, dt) {
  const cur = s.vx * wx + s.vz * wz;
  const add = wishSpeed - cur;
  if (add <= 0) return;
  let a = accel * dt * Math.max(wishSpeed, 1);
  if (a > add) a = add;
  s.vx += a * wx;
  s.vz += a * wz;
}

function applyFriction(s, friction, dt) {
  const sp = Math.hypot(s.vx, s.vz);
  if (sp < 0.01) { s.vx = 0; s.vz = 0; return; }
  const control = sp < MOVE.stopSpeed ? MOVE.stopSpeed : sp;
  let ns = sp - control * friction * dt;
  if (ns < 0) ns = 0;
  const k = ns / sp;
  s.vx *= k; s.vz *= k;
}

// Probe for a mantleable ledge in the facing direction. Returns ledge top y or -1.
function findLedge(world, s, fx, fz) {
  const r = MOVE.radius;
  const px = s.x + fx * (r + 0.35), pz = s.z + fz * (r + 0.35);
  const top = world.groundAt(px, pz, s.y + MOVE.mantleReach, tmpBoxes);
  const rise = top - s.y;
  if (rise < MOVE.mantleMin || rise > MOVE.mantleReach) return -1;
  // need standing (or crouch) room on top
  if (overlapsAt(world, px, top + 0.02, pz, MOVE.crouchHeight)) return -1;
  // and a clear path up (head clearance above current position)
  if (overlapsAt(world, s.x, top + 0.02, s.z, MOVE.crouchHeight * 0.6)) return -1;
  return top;
}

function wallAhead(world, s, fx, fz, h) {
  const r = MOVE.radius, d = 0.22;
  return world.overlaps(s.x - r + fx * d, s.y + 0.3, s.z - r + fz * d, s.x + r + fx * d, s.y + h - 0.1, s.z + r + fz * d, tmpBoxes);
}

export function stepMovement(s, inp, dt, world) {
  const btn = inp.buttons | 0;
  const pressed = btn & ~s.prevBtn;
  s.prevBtn = btn;
  s.yaw = inp.yaw;
  s.pitch = inp.pitch;
  s.events = 0;

  s.slideCd = Math.max(0, s.slideCd - dt);
  s.wallJumpCd = Math.max(0, s.wallJumpCd - dt);
  s.wallT += dt;
  s.jumpBuf = pressed & BTN.JUMP ? 0.1 : Math.max(0, s.jumpBuf - dt);
  s.crouchPressT = pressed & BTN.CROUCH ? 0 : s.crouchPressT + dt;

  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
  const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
  let mx = inp.mx || 0, mz = inp.mz || 0;
  let wx = fx * mz + rx * mx, wz = fz * mz + rz * mx;
  const wl = Math.hypot(wx, wz);
  if (wl > 1e-4) { wx /= wl; wz /= wl; }
  const wishAmt = Math.min(1, wl);

  if (s.launchT > 0) {
    // Skyward Dive: rocket straight up, then hand over to skydive
    s.launchT -= dt;
    s.vy = 60;
    s.vx *= 0.95; s.vz *= 0.95;
    moveAxis(world, s, 1, s.vy * dt, MOVE.standHeight, false);
    if (s.launchT <= 0) { s.mode = 'skydive'; s.vy = 0; }
    return s;
  }
  if (s.mode === 'skydive') return skydive(s, wx, wz, wishAmt, dt, world);
  if (s.mode === 'mantle') return mantle(s, btn, pressed, dt, world);

  // crouch transition (need headroom to stand)
  const wantCrouch = s.downed ? 1 : btn & BTN.CROUCH || s.mode === 'slide' ? 1 : 0;
  if (wantCrouch) s.crouch = Math.min(1, s.crouch + dt / MOVE.crouchTime);
  else if (s.crouch > 0) {
    if (!overlapsAt(world, s.x, s.y + 0.01, s.z, MOVE.standHeight)) s.crouch = Math.max(0, s.crouch - dt / MOVE.crouchTime);
  }
  const h = playerHeight(s);
  const ads = btn & BTN.ADS;
  const sprinting = !s.downed && btn & BTN.SPRINT && mz > 0.3 && !ads && s.crouch < 0.5;
  let wishSpeed = s.downed ? 1.4 : s.crouch > 0.5 ? MOVE.crouchSpeed : sprinting ? MOVE.sprintSpeed : MOVE.walkSpeed;
  if (ads && !s.downed) wishSpeed *= MOVE.adsSpeedMul;
  wishSpeed *= s.speedMul * wishAmt;

  const hSpeed = Math.hypot(s.vx, s.vz);

  if (s.onGround) {
    s.landT += dt;
    s.airT = 0;
    s.climbT = MOVE.climbTime;
    if (s.jetpack) s.fuel = Math.min(1, s.fuel + dt * 0.25);
    // jump (buffered so a slightly early press still bhops)
    if (s.jumpBuf > 0 && !s.downed) {
      s.jumpBuf = 0;
      s.vy = MOVE.jumpVel;
      s.onGround = false;
      s.mode = 'air';
      s.events |= MEV.JUMP;
    } else if (s.mode === 'slide') {
      // slide: low friction, slight steering, ends when slow or crouch released
      const ns = Math.max(0, hSpeed - MOVE.slideFriction * dt * (hSpeed > 9 ? 1.6 : 1));
      if (hSpeed > 0.01) {
        let vx = s.vx / hSpeed, vz = s.vz / hSpeed;
        if (wishAmt > 0.1) {
          const st = MOVE.slideSteer * dt;
          vx += wx * st; vz += wz * st;
          const l = Math.hypot(vx, vz); vx /= l; vz /= l;
        }
        s.vx = vx * ns; s.vz = vz * ns;
      }
      if (ns < MOVE.slideEndSpeed || !(btn & BTN.CROUCH)) s.mode = 'ground';
    } else {
      s.mode = 'ground';
      if (pressed & BTN.CROUCH && hSpeed >= MOVE.slideMinSpeed && !s.downed) {
        startSlide(s, hSpeed);
      } else {
        if (s.landT > MOVE.landGrace) applyFriction(s, MOVE.groundFriction, dt);
        accelerate(s, wx, wz, wishSpeed, MOVE.groundAccel, dt);
      }
    }
    if (s.onGround) s.vy = 0;
  }

  if (!s.onGround) {
    s.airT += dt;
    if (s.mode !== 'air') s.mode = 'air';
    s.vy -= MOVE.gravity * dt;

    // Source-style air acceleration: tiny wish cap + high accel = strafe redirect / tap strafing
    if (wishAmt > 0.01) {
      const cap = MOVE.airWishCap * s.speedMul;
      const before = Math.hypot(s.vx, s.vz);
      accelerate(s, wx, wz, cap, MOVE.airAccel, dt);
      const after = Math.hypot(s.vx, s.vz);
      if (after > before && after > MOVE.airMaxGainSpeed) {
        const k = Math.max(before, MOVE.airMaxGainSpeed) / after;
        s.vx *= k; s.vz *= k;
      }
    }
    if (hSpeed > MOVE.sprintSpeed * 1.2) {
      const k = 1 - MOVE.airDrag * dt;
      s.vx *= k; s.vz *= k;
    }

    // jetpack hover (Spectre passive): hold jump in air
    if (s.jetpack && btn & BTN.JUMP && s.airT > 0.25 && s.fuel > 0) {
      s.vy += (14 + (s.vy < 0 ? 18 : 0)) * dt;
      if (s.vy > 6) s.vy = 6;
      s.fuel = Math.max(0, s.fuel - dt * 0.33);
      s.events |= MEV.JET;
    }

    // wall jump / wall bounce
    if (pressed & BTN.JUMP && s.wallT < MOVE.wallJumpWindow && s.wallJumpCd <= 0 && !s.downed) {
      s.vx += s.wallNx * MOVE.wallJumpOut;
      s.vz += s.wallNz * MOVE.wallJumpOut;
      s.vy = Math.max(s.vy, MOVE.wallJumpUp);
      s.wallJumpCd = MOVE.wallJumpCooldown;
      s.wallT = 9;
      s.climbT = 0;
      s.events |= MEV.WALLJUMP;
    } else if (!s.downed && mz > 0.5 && wallAhead(world, s, fx, fz, h)) {
      const ledge = findLedge(world, s, fx, fz);
      if (ledge >= 0 && s.vy < 7) {
        startMantle(s, ledge, fx, fz);
        return s;
      }
      // climb the wall while holding forward + jump
      if (btn & BTN.JUMP && s.climbT > 0 && s.airT < 1.2) {
        s.climbT -= dt;
        s.vy = Math.max(s.vy, MOVE.climbSpeed);
        s.events |= MEV.CLIMB;
      }
    }
  }

  // integrate with collision
  const wasGround = s.onGround;
  const fallSpeed = -s.vy;
  const allowStep = wasGround;
  const cx = moveAxis(world, s, 0, s.vx * dt, h, allowStep);
  if (cx === 1) { s.wallNx = s.vx > 0 ? -1 : 1; s.wallNz = 0; s.wallT = 0; s.vx = 0; }
  const cz = moveAxis(world, s, 2, s.vz * dt, h, allowStep);
  if (cz === 1) { s.wallNz = s.vz > 0 ? -1 : 1; s.wallNx = cx === 1 ? s.wallNx : 0; s.wallT = 0; s.vz = 0; }
  if (cx === 2 || cz === 2) s.events |= MEV.STEP;

  // vertical: snap to ground while grounded so we stick to steps going down
  let vdelta = s.vy * dt;
  if (wasGround && s.vy <= 0) vdelta = -0.06;
  const startY = s.y;
  const cy = moveAxis(world, s, 1, vdelta, h, false);
  if (cy && vdelta < 0) {
    if (!wasGround) landed(s, fallSpeed, btn);
    s.onGround = true;
    s.vy = 0;
  } else if (cy && vdelta > 0) {
    s.vy = Math.min(0, s.vy);
  } else if (wasGround && vdelta < 0) {
    // walked off a ledge: undo snap, become airborne
    s.y = startY;
    s.onGround = false;
    if (s.mode !== 'slide') s.mode = 'air';
    else s.mode = 'air';
  }

  // jump pads
  for (let i = 0; i < world.pads.length; i++) {
    const pd = world.pads[i];
    if (Math.abs(s.y - pd.y) < 0.7 && (s.x - pd.x) ** 2 + (s.z - pd.z) ** 2 < 1.6 && s.vy < 4 && !s.downed) {
      s.vy = 16.5;
      const hs = Math.hypot(s.vx, s.vz);
      if (hs > 0.5) { const k = Math.min(1.6, (hs + 3) / hs); s.vx *= k; s.vz *= k; }
      s.onGround = false;
      s.mode = 'air';
      s.events |= MEV.PAD;
    }
  }

  // map bounds
  const lim = 760;
  if (s.x < -lim) { s.x = -lim; s.vx = 0; }
  if (s.x > lim) { s.x = lim; s.vx = 0; }
  if (s.z < -lim) { s.z = -lim; s.vz = 0; }
  if (s.z > lim) { s.z = lim; s.vz = 0; }
  return s;
}

function startSlide(s, hSpeed) {
  s.mode = 'slide';
  s.events |= MEV.SLIDE;
  if (s.slideCd <= 0 && hSpeed > 0.1) {
    const ns = Math.min(MOVE.slideMaxSpeed, hSpeed + MOVE.slideBoost);
    s.vx *= ns / hSpeed; s.vz *= ns / hSpeed;
    s.slideCd = MOVE.slideBoostCooldown;
  }
}

function landed(s, fallSpeed, btn) {
  s.landT = 0;
  s.lastLandSpeed = fallSpeed;
  s.events |= fallSpeed > 11 ? MEV.HARDLAND : MEV.LAND;
  s.wallT = 9;
  const hs = Math.hypot(s.vx, s.vz);
  // slide-hop: landing with crouch held at speed goes straight into a slide (momentum kept)
  if (btn & BTN.CROUCH && hs >= MOVE.slideMinSpeed && !s.downed) startSlide(s, hs);
  else s.mode = 'ground';
}

function startMantle(s, top, fx, fz) {
  s.mode = 'mantle';
  s.events |= MEV.MANTLE;
  const rise = top - s.y;
  s.mantleDur = MOVE.mantleTime * (0.6 + 0.4 * (rise / MOVE.mantleReach));
  s.mantleT = 0;
  s.msx = s.x; s.msy = s.y; s.msz = s.z;
  s.mex = s.x + fx * (MOVE.radius + 0.45); s.mey = top + 0.02; s.mez = s.z + fz * (MOVE.radius + 0.45);
  s.mfx = fx; s.mfz = fz;
  s.vx = 0; s.vy = 0; s.vz = 0;
  s.onGround = false;
}

function mantle(s, btn, pressed, dt, world) {
  s.mantleT += dt;
  const t = Math.min(1, s.mantleT / s.mantleDur);
  // rise first (70%), then pop forward
  const ty = Math.min(1, t / 0.7);
  const tf = t < 0.55 ? 0 : (t - 0.55) / 0.45;
  s.y = s.msy + (s.mey - s.msy) * (1 - (1 - ty) * (1 - ty));
  s.x = s.msx + (s.mex - s.msx) * tf;
  s.z = s.msz + (s.mez - s.msz) * tf;
  const remaining = s.mantleDur - s.mantleT;
  // superglide: jump + crouch on the same tick (or 1 tick apart) at the very end of a mantle
  if (pressed & BTN.JUMP && remaining <= MOVE.superglideWindow + 0.03 && s.crouchPressT <= 1.5 / 60 + 1e-6) {
    exitMantle(s, world);
    s.vx = s.mfx * MOVE.superglideSpeed; s.vz = s.mfz * MOVE.superglideSpeed;
    s.vy = 3.2;
    s.crouch = 1;
    s.events |= MEV.SUPERGLIDE;
    return s;
  }
  if (pressed & BTN.JUMP && t > 0.35) {
    // mantle jump
    exitMantle(s, world);
    s.vx = s.mfx * 3.8; s.vz = s.mfz * 3.8; s.vy = MOVE.jumpVel * 0.92;
    s.events |= MEV.JUMP;
    return s;
  }
  if (t >= 1) {
    exitMantle(s, world);
    s.vx = s.mfx * 2.6; s.vz = s.mfz * 2.6;
    s.onGround = true;
    s.mode = 'ground';
    s.landT = 1;
  }
  return s;
}

function exitMantle(s, world) {
  s.x = s.mex; s.y = s.mey; s.z = s.mez;
  if (overlapsAt(world, s.x, s.y, s.z, playerHeight(s))) s.crouch = 1;
  s.mode = 'air';
  s.onGround = false;
  s.climbT = 0;
}

function skydive(s, wx, wz, wishAmt, dt, world) {
  const ground = world.groundAt(s.x, s.z, s.y, tmpBoxes);
  const alt = s.y - ground;
  // look down to dive: pitch < 0 means looking down
  const dive = Math.max(0, Math.min(1, (-s.pitch - 0.2) / 1.0));
  const deployed = alt < MOVE.deployHeight;
  const tgtVy = deployed ? -MOVE.deployFallSpeed : -(MOVE.skydiveFallSpeed + dive * (MOVE.skydiveDiveSpeed - MOVE.skydiveFallSpeed));
  const glide = deployed ? 9 : MOVE.skydiveGlideSpeed * (1 - dive * 0.55);
  const k = Math.min(1, dt * (deployed ? 4 : 1.2));
  s.vy += (tgtVy - s.vy) * k;
  const tvx = wx * glide * wishAmt, tvz = wz * glide * wishAmt;
  const kh = Math.min(1, dt * 1.1);
  s.vx += (tvx - s.vx) * kh;
  s.vz += (tvz - s.vz) * kh;
  const h = MOVE.standHeight;
  moveAxis(world, s, 0, s.vx * dt, h, false);
  moveAxis(world, s, 2, s.vz * dt, h, false);
  const hit = moveAxis(world, s, 1, s.vy * dt, h, false);
  if (hit && s.vy < 0) {
    s.mode = 'ground';
    s.onGround = true;
    s.vy = 0;
    s.vx *= 0.4; s.vz *= 0.4;
    s.landT = 0;
    s.events |= MEV.LAND;
  }
  const lim = 760;
  s.x = Math.max(-lim, Math.min(lim, s.x));
  s.z = Math.max(-lim, Math.min(lim, s.z));
  return s;
}
