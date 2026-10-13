// Client "feel" tuning. Every number that shapes camera, hit feedback and mix lives here so it
// can be iterated without touching game logic. `settings.shake` (0..2) scales all camera shake.

export const FEEL = {
  camera: {
    traumaDecay: 1.7,          // trauma units per second
    shakeAngle: 0.03,          // radians of yaw/pitch at full trauma
    shakeRoll: 0.025,
    shakeFreq: 38,
    fireTrauma: { smg: 0.035, ar: 0.05, lmg: 0.06, energy: 0.04, pistol: 0.05, revolver: 0.16, dmr: 0.12, shotgun: 0.24, sniper: 0.32 },
    fireFovPunch: { smg: 0.5, ar: 0.7, lmg: 0.8, energy: 0.6, pistol: 0.6, revolver: 2.2, dmr: 1.6, shotgun: 3.2, sniper: 3.8 },
    fireKick: { smg: 0.9, ar: 1.0, lmg: 1.1, energy: 0.9, pistol: 1.0, revolver: 1.8, dmr: 1.5, shotgun: 2.0, sniper: 2.2 },
    hitTakenTrauma: 0.006,     // per point of damage taken
    hitTakenMax: 0.45,
    hitTakenFovPunch: 2.5,
    hitDealtTrauma: 0.015,
    shieldBreakTrauma: 0.25,
    shieldBreakFov: 4,
    killTrauma: 0.2,
    killFov: 3,
    explosionRadius: 32,       // trauma falls to 0 at this distance
    explosionTrauma: 0.9,
    landTrauma: 0.25,
    slideFov: 6,
    superglideFov: 12,
    sprintFov: 7,
    skydiveFov: 12,
  },
  hit: {
    markerTime: 0.22,
    killMarkerTime: 0.5,
    edgeFlashDealt: 0.0,       // screen edge flash when dealing damage (kept off: clutter)
    edgeFlashTaken: 0.45,
    shieldBreakFlash: 0.6,
    killFlash: 0.7,
    numberMergeWindow: 0.12,
  },
  mix: {
    gunLocal: 0.95,
    gunTailLocal: 0.55,
    gunRemote: 1.0,
    hit: 0.9,
    hitHead: 1.0,
    shieldCrack: 0.65,
    shieldBreak: 1.0,
    kill: 1.0,
    knock: 0.95,
    footstepSelf: 0.22,
    footstepEnemy: 1.25,
    footstepMate: 0.5,
    ability: 1.0,
    tension: 0.32,
    ambience: 0.22,
    occludedLowpass: 900,
    occludedGain: 0.6,
    lowHpLowpass: 3500,        // master low-pass when under 30 HP
    downedLowpass: 1100,
  },
};
