// Global tuning constants. All units are meters / seconds / degrees unless noted.
// Movement numbers are tuned to approximate Apex Legends (Source-derived) feel.

export const SIM_DT = 1 / 60;          // movement step for human players (client + server identical)
export const SERVER_TICK = 30;         // authoritative world tick (Hz)
export const SNAPSHOT_RATE = 20;       // snapshots per second
export const INTERP_DELAY = 0.1;       // remote entity interpolation buffer (s)

export const MAX_PLAYERS = 100;
export const MODES = {
  trios: { squadSize: 3, label: 'TRIOS' },
  sixes: { squadSize: 6, label: 'SIXES' },
};

export const MAP_SIZE = 1400;          // square map edge length, centered on origin
export const MAP_HALF = MAP_SIZE / 2;

export const MOVE = {
  gravity: 19.0,
  walkSpeed: 4.6,
  sprintSpeed: 7.4,
  crouchSpeed: 2.4,
  adsSpeedMul: 0.6,
  groundAccel: 10.0,
  groundFriction: 6.0,
  stopSpeed: 2.0,
  airAccel: 90.0,              // high air accel + low wish cap = Source/Apex strafe redirect
  airWishCap: 0.85,            // tap strafing lives in this cap
  airMaxGainSpeed: 11.5,       // soft cap: above this speed air strafing cannot add speed
  airDrag: 0.06,               // gentle drag above sprint speed in air
  jumpVel: 5.6,
  standHeight: 1.8,
  crouchHeight: 1.1,
  eyeStand: 1.62,
  eyeCrouch: 0.98,
  radius: 0.38,
  stepHeight: 0.45,
  crouchTime: 0.12,            // seconds to transition stand <-> crouch
  // slide
  slideMinSpeed: 5.6,
  slideBoost: 2.9,
  slideBoostCooldown: 2.0,
  slideFriction: 1.0,          // m/s^2 deceleration while sliding
  slideSlope: 0.9,             // fraction of gravity applied along the hill while sliding
  slideMaxSlopeSpeed: 17,      // terminal slide speed down hills
  slideEndSpeed: 3.0,
  slideSteer: 1.4,
  slideMaxSpeed: 14,
  // bunny hop: friction is not applied for this many seconds after landing
  landGrace: 0.05,
  // wall jump / bounce
  wallJumpWindow: 0.14,
  wallJumpOut: 4.6,
  wallJumpUp: 5.4,
  wallJumpCooldown: 0.35,
  // climbing / mantling
  climbSpeed: 5.4,
  climbTime: 0.7,
  mantleReach: 2.3,           // max ledge height above feet that can be mantled
  mantleMin: 0.5,
  mantleTime: 0.32,
  superglideWindow: 0.08,     // seconds at end of mantle where jump+crouch triggers a superglide
  superglideSpeed: 10.5,
  // ziplines
  zipSpeed: 13,
  zipVerticalSpeed: 10,
  zipGrab: 1.8,               // max distance from cable to attach
  // skydive
  skydiveFallSpeed: 32,
  skydiveDiveSpeed: 55,
  skydiveGlideSpeed: 26,
  deployHeight: 40,
  deployFallSpeed: 9,
};

export const BTN = {
  JUMP: 1,
  CROUCH: 2,
  SPRINT: 4,
  FIRE: 8,
  ADS: 16,
  INTERACT: 32,
  RELOAD: 64,
  TACTICAL: 128,
  ULTIMATE: 256,
  HEAL: 512,
};

export const HEALTH = 100;
export const SHIELD_TIERS = [0, 50, 75, 100, 125]; // evo: none, white, blue, purple, red
export const SHIELD_COLORS = ['#888888', '#e8e8e8', '#3fa9ff', '#b94dff', '#ff3b3b'];
export const EVO_THRESHOLDS = [0, 150, 300, 500]; // damage needed to reach next tier from 1,2,3

export const BLEEDOUT_TIME = 90;
export const DOWNED_HP = 100;
export const REVIVE_TIME = 5;
export const BANNER_TIME = 90;
export const RESPAWN_TIME = 5;

export const TEAM_COLORS = [
  '#ff9f1c', '#2ec4b6', '#e71d36', '#7b2ff7', '#43aa8b', '#f8961e', '#277da1', '#f94144',
];
