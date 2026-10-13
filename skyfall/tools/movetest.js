// Verifies the movement tech works in the shared deterministic movement code.
import { CollisionWorld } from '../src/shared/physics.js';
import { createMoveState, stepMovement, MEV } from '../src/shared/movement.js';
import { BTN, SIM_DT } from '../src/shared/constants.js';

const w = new CollisionWorld(800);
w.addBox([10, 0, -50], [11, 6, 50], 'wall');      // tall wall at x=10..11 (climb + wall jump)
w.addBox([-20, 0, -30], [-15, 1.8, -25], 'ledge'); // mantleable ledge
w.finalize();

const run = (s, inp, n, log) => { let ev = 0; for (let i = 0; i < n; i++) { stepMovement(s, typeof inp === 'function' ? inp(i) : inp, SIM_DT, w); ev |= s.events; if (log) log(s, i); } return ev; };
const hs = (s) => Math.hypot(s.vx, s.vz).toFixed(2);

// sprint
let s = createMoveState(0, 0, 0); s.onGround = true; s.mode = 'ground'; s.yaw = Math.PI / 2; // facing -X
run(s, { mx: 0, mz: 1, yaw: Math.PI / 2, pitch: 0, buttons: BTN.SPRINT }, 90);
console.log('sprint speed', hs(s));
// slide
let ev = run(s, (i) => ({ mx: 0, mz: 1, yaw: Math.PI / 2, pitch: 0, buttons: BTN.SPRINT | BTN.CROUCH }), 1);
console.log('slide start', s.mode, hs(s), !!(ev & MEV.SLIDE));
run(s, { mx: 0, mz: 1, yaw: Math.PI / 2, pitch: 0, buttons: BTN.SPRINT | BTN.CROUCH }, 30);
console.log('after 0.5s slide', s.mode, hs(s));
// slide jump + slide hop chain
let maxSpeed = 0;
for (let hop = 0; hop < 4; hop++) {
  run(s, { mx: 0, mz: 1, yaw: Math.PI / 2, pitch: 0, buttons: BTN.SPRINT | BTN.CROUCH | BTN.JUMP }, 1);
  run(s, (i) => ({ mx: 0, mz: 1, yaw: Math.PI / 2, pitch: 0, buttons: BTN.SPRINT | BTN.CROUCH }), 40, (st) => { maxSpeed = Math.max(maxSpeed, Math.hypot(st.vx, st.vz)); });
  console.log(' hop', hop, s.mode, 'speed', hs(s));
}
// air strafe redirect (tap strafe): in air, turn 90 deg while holding strafe
s = createMoveState(0, 0, 100); s.onGround = true; s.mode = 'ground';
run(s, { mx: 0, mz: 1, yaw: 0, pitch: 0, buttons: BTN.SPRINT }, 90);
run(s, { mx: 0, mz: 1, yaw: 0, pitch: 0, buttons: BTN.SPRINT | BTN.JUMP }, 1);
const v0 = { x: s.vx, z: s.vz };
run(s, (i) => ({ mx: 1, mz: 0, yaw: -(i / 30) * (Math.PI / 2), pitch: 0, buttons: 0 }), 30);
const ang = (Math.atan2(s.vx, -s.vz) - Math.atan2(v0.x, -v0.z)) * 180 / Math.PI;
console.log('air strafe turned velocity by', ang.toFixed(1), 'deg; speed', hs(s));
// wall jump: run at wall x=10 from x=5 facing +X (yaw=-PI/2), jump, then press jump on wall contact
s = createMoveState(2, 0, 0); s.onGround = true; s.mode = 'ground';
run(s, { mx: 0, mz: 1, yaw: -Math.PI / 2, pitch: 0, buttons: BTN.SPRINT }, 40);
run(s, { mx: 0, mz: 1, yaw: -Math.PI / 2, pitch: 0, buttons: BTN.SPRINT | BTN.JUMP }, 1);
let wj = 0;
for (let i = 0; i < 60 && !wj; i++) {
  const touching = s.wallT < 0.05;
  ev = run(s, { mx: 0, mz: 0.2, yaw: -Math.PI / 2, pitch: 0, buttons: touching ? BTN.JUMP : 0 }, 1);
  if (ev & MEV.WALLJUMP) wj = 1;
  else run(s, { mx: 0, mz: 0.2, yaw: -Math.PI / 2, pitch: 0, buttons: 0 }, 0);
}
console.log('wall jump', !!wj, 'vx after', s.vx.toFixed(2), 'vy', s.vy.toFixed(2));
// climb + mantle onto ledge (1.8 high) from the side
s = createMoveState(-17.5, 0, -20); s.onGround = true; s.mode = 'ground';
ev = 0;
run(s, { mx: 0, mz: 1, yaw: 0, pitch: 0, buttons: BTN.SPRINT }, 20);
ev |= run(s, { mx: 0, mz: 1, yaw: 0, pitch: 0, buttons: BTN.JUMP }, 1);
ev |= run(s, { mx: 0, mz: 1, yaw: 0, pitch: 0, buttons: BTN.JUMP }, 60);
console.log('mantle', !!(ev & MEV.MANTLE), 'y', s.y.toFixed(2), s.mode);
// superglide: approach ledge, mantle, press jump+crouch near end
s = createMoveState(-17.5, 0, -20); s.onGround = true; s.mode = 'ground';
run(s, { mx: 0, mz: 1, yaw: 0, pitch: 0, buttons: BTN.SPRINT }, 20);
run(s, { mx: 0, mz: 1, yaw: 0, pitch: 0, buttons: BTN.JUMP }, 1);
let sg = false;
for (let i = 0; i < 80 && !sg; i++) {
  const nearEnd = s.mode === 'mantle' && s.mantleDur - s.mantleT <= 0.06;
  ev = run(s, { mx: 0, mz: 1, yaw: 0, pitch: 0, buttons: nearEnd ? BTN.JUMP | BTN.CROUCH : 0 }, 1);
  if (ev & MEV.SUPERGLIDE) sg = true;
}
console.log('superglide', sg, 'speed', hs(s));
// climb tall wall
s = createMoveState(9.2, 0, 0); s.onGround = true; s.mode = 'ground';
let maxY = 0;
run(s, { mx: 0, mz: 1, yaw: -Math.PI / 2, pitch: 0, buttons: BTN.JUMP }, 80, (st) => { maxY = Math.max(maxY, st.y); });
console.log('climb max height', maxY.toFixed(2));
// bunny hop: land with jump held/pressed right as landing
s = createMoveState(0, 0, 300); s.onGround = true; s.mode = 'ground';
run(s, { mx: 0, mz: 1, yaw: 0, pitch: 0, buttons: BTN.SPRINT }, 90);
let prev = 0;
for (let i = 0; i < 400; i++) {
  const b = s.onGround ? (prev ? 0 : BTN.JUMP) : 0;
  prev = b;
  stepMovement(s, { mx: 0, mz: 1, yaw: 0, pitch: 0, buttons: BTN.SPRINT | b }, SIM_DT, w);
}
console.log('bhop speed after 400 ticks', hs(s));
