// Data-driven weapon definitions. Every gun's behaviour (damage, fire mode, recoil pattern, spread,
// projectile ballistics, handling, audio profile) is described here, so adding a gun is data-only.
//
// recoil: a learnable per-shot pattern of [yawKick, pitchKick] in degrees (positive pitch = up,
// positive yaw = right). The pattern repeats its tail when the mag is longer than the pattern.

const pat = (pairs) => pairs.map(([x, y]) => [x, y]);

export const AMMO = {
  light: { label: 'Light', color: '#e5a54b', stack: 60 },
  heavy: { label: 'Heavy', color: '#4fc2a0', stack: 60 },
  energy: { label: 'Energy', color: '#b7e34b', stack: 60 },
  shotgun: { label: 'Shells', color: '#d9452b', stack: 16 },
  sniper: { label: 'Sniper', color: '#5a6ee6', stack: 24 },
};

export const WEAPONS = {
  talon: {
    name: 'Talon AR', cls: 'AR', ammo: 'light', mode: 'auto', rpm: 780, damage: 14, headMul: 1.75, legMul: 0.9,
    mag: 18, magExt: [21, 24, 28], reload: 2.0, reloadEmpty: 2.5, speed: 560, drop: 1.0,
    hip: 2.4, adsSpread: 0.08, moveSpread: 1.4, airSpread: 3, slideSpread: -0.8,
    adsTime: 0.2, adsFov: 1.3, deploy: 0.5, moveMul: 1.0,
    recoil: pat([[0, 0.55], [0.08, 0.55], [0.15, 0.5], [0.1, 0.45], [-0.1, 0.45], [-0.2, 0.4], [-0.15, 0.4], [0.05, 0.35], [0.2, 0.35], [0.25, 0.3], [0.1, 0.3], [-0.15, 0.3], [-0.25, 0.3], [-0.1, 0.25], [0.1, 0.25], [0.2, 0.25]]),
    recoilRand: 0.08, recover: 6,
    sound: { body: 520, sub: 90, crack: 0.8, tail: 0.6, pitchVar: 0.03, punch: 0.85, mech: 0.4 },
    tint: '#f2a03d', rarityBase: 0,
  },
  mauler: {
    name: 'Mauler', cls: 'AR', ammo: 'heavy', mode: 'auto', rpm: 600, damage: 19, headMul: 1.75, legMul: 0.9,
    mag: 20, magExt: [25, 28, 30], reload: 2.4, reloadEmpty: 3.0, speed: 520, drop: 1.0,
    hip: 2.6, adsSpread: 0.1, moveSpread: 1.5, airSpread: 3, slideSpread: -0.8,
    adsTime: 0.22, adsFov: 1.3, deploy: 0.55, moveMul: 0.98,
    recoil: pat([[0, 0.8], [0.1, 0.75], [0.25, 0.7], [0.35, 0.6], [0.2, 0.55], [-0.1, 0.5], [-0.35, 0.5], [-0.45, 0.45], [-0.3, 0.4], [0, 0.4], [0.3, 0.4], [0.45, 0.35], [0.3, 0.35], [0, 0.35], [-0.3, 0.35], [-0.4, 0.3]]),
    recoilRand: 0.12, recover: 5,
    sound: { body: 300, sub: 70, crack: 0.9, tail: 0.8, pitchVar: 0.03, punch: 1.0, mech: 0.6 },
    tint: '#3fbf97', rarityBase: 0,
  },
  hornet: {
    name: 'Hornet SMG', cls: 'SMG', ammo: 'light', mode: 'auto', rpm: 1080, damage: 11, headMul: 1.5, legMul: 0.9,
    mag: 19, magExt: [21, 24, 27], reload: 1.8, reloadEmpty: 2.2, speed: 480, drop: 1.2,
    hip: 1.7, adsSpread: 0.12, moveSpread: 0.9, airSpread: 2, slideSpread: -0.9,
    adsTime: 0.16, adsFov: 1.15, deploy: 0.4, moveMul: 1.05,
    recoil: pat([[0, 0.45], [0.15, 0.45], [0.3, 0.4], [0.35, 0.35], [0.2, 0.3], [-0.1, 0.3], [-0.35, 0.3], [-0.5, 0.25], [-0.35, 0.25], [0, 0.25], [0.3, 0.25], [0.45, 0.2], [0.3, 0.2], [0, 0.2]]),
    recoilRand: 0.1, recover: 8,
    sound: { body: 820, sub: 110, crack: 1.0, tail: 0.35, pitchVar: 0.05, punch: 0.6, mech: 0.3 },
    tint: '#f5c542', rarityBase: 0,
  },
  volt: {
    name: 'Volt SMG', cls: 'SMG', ammo: 'energy', mode: 'auto', rpm: 720, damage: 15, headMul: 1.5, legMul: 0.9,
    mag: 19, magExt: [21, 23, 26], reload: 1.45, reloadEmpty: 2.0, speed: 900, drop: 0.3,
    hip: 1.8, adsSpread: 0.08, moveSpread: 1.0, airSpread: 2, slideSpread: -0.9,
    adsTime: 0.17, adsFov: 1.15, deploy: 0.4, moveMul: 1.04,
    recoil: pat([[0, 0.5], [-0.1, 0.45], [-0.15, 0.4], [-0.05, 0.35], [0.1, 0.35], [0.18, 0.3], [0.1, 0.3], [-0.05, 0.3], [-0.15, 0.25], [-0.05, 0.25]]),
    recoilRand: 0.06, recover: 8,
    sound: { body: 1100, sub: 80, crack: 0.5, tail: 0.4, pitchVar: 0.02, punch: 0.55, mech: 0.2, energy: 1 },
    tint: '#b7e34b', rarityBase: 1,
  },
  bulwark: {
    name: 'Bulwark LMG', cls: 'LMG', ammo: 'heavy', mode: 'auto', rpm: 540, damage: 18, headMul: 1.5, legMul: 0.9,
    mag: 35, magExt: [40, 45, 50], reload: 3.2, reloadEmpty: 4.0, speed: 540, drop: 1.0,
    hip: 3.0, adsSpread: 0.12, moveSpread: 1.8, airSpread: 3.5, slideSpread: -0.6,
    adsTime: 0.3, adsFov: 1.4, deploy: 0.75, moveMul: 0.92,
    recoil: pat([[0, 0.7], [0.1, 0.65], [0.2, 0.6], [0.3, 0.5], [0.4, 0.45], [0.45, 0.4], [0.4, 0.35], [0.3, 0.3], [0.2, 0.25], [0.1, 0.22], [0, 0.2], [-0.05, 0.2]]),
    recoilRand: 0.1, recover: 4,
    sound: { body: 240, sub: 60, crack: 0.9, tail: 0.95, pitchVar: 0.025, punch: 1.1, mech: 0.7 },
    tint: '#4fc2a0', rarityBase: 0,
  },
  breacher: {
    name: 'Breacher', cls: 'Shotgun', ammo: 'shotgun', mode: 'semi', rpm: 75, damage: 11, pellets: 11, headMul: 1.25, legMul: 1.0,
    mag: 5, magExt: [5, 5, 5], reload: 3.0, reloadEmpty: 3.0, speed: 300, drop: 2.0, pelletSpread: 1.9,
    hip: 0.6, adsSpread: 0.0, moveSpread: 0.3, airSpread: 0.5, slideSpread: -0.2,
    adsTime: 0.2, adsFov: 1.1, deploy: 0.5, moveMul: 1.0, falloffStart: 10, falloffEnd: 28, falloffMin: 0.35,
    recoil: pat([[0, 4.5]]), recoilRand: 0.5, recover: 6,
    sound: { body: 180, sub: 50, crack: 1.0, tail: 1.1, pitchVar: 0.03, punch: 1.4, mech: 0.9, pump: 1 },
    tint: '#d9452b', rarityBase: 0,
  },
  scout: {
    name: 'Scout DMR', cls: 'Marksman', ammo: 'light', mode: 'semi', rpm: 240, damage: 34, headMul: 2.0, legMul: 0.85,
    mag: 10, magExt: [15, 18, 20], reload: 2.4, reloadEmpty: 3.0, speed: 850, drop: 0.7,
    hip: 3.0, adsSpread: 0.0, moveSpread: 2, airSpread: 3, slideSpread: 0,
    adsTime: 0.25, adsFov: 2.1, deploy: 0.6, moveMul: 0.97,
    recoil: pat([[0.1, 1.6], [-0.1, 1.5], [0.15, 1.5], [-0.15, 1.4]]), recoilRand: 0.2, recover: 7,
    sound: { body: 420, sub: 80, crack: 1.2, tail: 1.0, pitchVar: 0.02, punch: 1.1, mech: 0.3 },
    tint: '#e5a54b', rarityBase: 1,
  },
  sentinel: {
    name: 'Sentinel', cls: 'Sniper', ammo: 'sniper', mode: 'bolt', rpm: 50, damage: 70, headMul: 2.0, legMul: 0.85,
    mag: 4, magExt: [5, 6, 7], reload: 3.0, reloadEmpty: 3.6, speed: 1100, drop: 0.6,
    hip: 6.0, adsSpread: 0.0, moveSpread: 4, airSpread: 6, slideSpread: 0,
    adsTime: 0.35, adsFov: 4.5, deploy: 0.75, moveMul: 0.92,
    recoil: pat([[0, 4]]), recoilRand: 0.4, recover: 5,
    sound: { body: 200, sub: 45, crack: 1.4, tail: 1.8, pitchVar: 0.01, punch: 1.6, mech: 0.8, bolt: 1 },
    tint: '#5a6ee6', rarityBase: 2,
  },
  viper: {
    name: 'Viper Revolver', cls: 'Pistol', ammo: 'heavy', mode: 'semi', rpm: 156, damage: 45, headMul: 2.0, legMul: 0.9,
    mag: 6, magExt: [7, 8, 9], reload: 2.1, reloadEmpty: 2.1, speed: 600, drop: 1.1,
    hip: 1.6, adsSpread: 0.0, moveSpread: 1.2, airSpread: 2, slideSpread: -0.6,
    adsTime: 0.18, adsFov: 1.2, deploy: 0.35, moveMul: 1.05,
    recoil: pat([[0.1, 2.6], [-0.1, 2.6]]), recoilRand: 0.25, recover: 8,
    sound: { body: 260, sub: 60, crack: 1.3, tail: 1.2, pitchVar: 0.03, punch: 1.35, mech: 0.5 },
    tint: '#4fc2a0', rarityBase: 1,
  },
  p20: {
    name: 'P20 Pistol', cls: 'Pistol', ammo: 'light', mode: 'semi', rpm: 420, damage: 18, headMul: 1.5, legMul: 0.9,
    mag: 10, magExt: [12, 14, 16], reload: 1.25, reloadEmpty: 1.25, speed: 440, drop: 1.3,
    hip: 1.4, adsSpread: 0.05, moveSpread: 0.7, airSpread: 1.5, slideSpread: -0.5,
    adsTime: 0.14, adsFov: 1.1, deploy: 0.25, moveMul: 1.08,
    recoil: pat([[0.05, 1.0], [-0.05, 1.0]]), recoilRand: 0.12, recover: 10,
    sound: { body: 900, sub: 100, crack: 0.9, tail: 0.4, pitchVar: 0.05, punch: 0.6, mech: 0.3 },
    tint: '#e5a54b', rarityBase: 0,
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS);

export function fireInterval(w) {
  return 60 / w.rpm;
}

// Damage multiplier by distance (shotguns).
export function falloff(w, dist) {
  if (!w.falloffStart) return 1;
  if (dist <= w.falloffStart) return 1;
  if (dist >= w.falloffEnd) return w.falloffMin;
  const t = (dist - w.falloffStart) / (w.falloffEnd - w.falloffStart);
  return 1 + (w.falloffMin - 1) * t;
}

export function magSize(w, magLevel) {
  return magLevel > 0 ? w.magExt[magLevel - 1] : w.mag;
}

// Current spread cone (degrees, full angle) given player movement state.
export function currentSpread(w, ms, ads, bloom = 0) {
  const hs = Math.hypot(ms.vx, ms.vz);
  if (ads) return w.adsSpread + (ms.onGround ? 0 : 0.6) + bloom * 0.15;
  let s = w.hip + bloom;
  if (ms.mode === 'slide') s += w.slideSpread;
  else if (!ms.onGround && ms.mode !== 'mantle') s += w.airSpread;
  else s += Math.min(1, hs / 7) * w.moveSpread;
  if (ms.crouch > 0.5 && ms.mode !== 'slide') s *= 0.8;
  return Math.max(0.2, s);
}
