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
    sound: { cls: 'ar', gain: 0.86, crack: 0.9, snapHz: 2600, bodyHz: 650, bodyQ: 1.1, bodyDecay: 0.03, subHz: 82, sub: 0.6, subDecay: 0.035, mech: 0.45, tail: 0.7, tailHz: 1400, pitchVar: 0.03 },
    tint: '#f2a03d', rarityBase: 0,
  },
  mauler: {
    name: 'Mauler', cls: 'AR', ammo: 'heavy', mode: 'auto', rpm: 600, damage: 19, headMul: 1.75, legMul: 0.9,
    mag: 20, magExt: [25, 28, 30], reload: 2.4, reloadEmpty: 3.0, speed: 520, drop: 1.0,
    hip: 2.6, adsSpread: 0.1, moveSpread: 1.5, airSpread: 3, slideSpread: -0.8,
    adsTime: 0.22, adsFov: 1.3, deploy: 0.55, moveMul: 0.98,
    recoil: pat([[0, 0.8], [0.1, 0.75], [0.25, 0.7], [0.35, 0.6], [0.2, 0.55], [-0.1, 0.5], [-0.35, 0.5], [-0.45, 0.45], [-0.3, 0.4], [0, 0.4], [0.3, 0.4], [0.45, 0.35], [0.3, 0.35], [0, 0.35], [-0.3, 0.35], [-0.4, 0.3]]),
    recoilRand: 0.12, recover: 5,
    sound: { cls: 'ar', gain: 0.92, crack: 0.8, snapHz: 2100, bodyHz: 430, bodyQ: 0.9, bodyDecay: 0.04, subHz: 66, sub: 0.85, subDecay: 0.045, mech: 0.55, tail: 0.85, tailHz: 1100, pitchVar: 0.03 },
    tint: '#3fbf97', rarityBase: 0,
  },
  hornet: {
    name: 'Hornet SMG', cls: 'SMG', ammo: 'light', mode: 'auto', rpm: 1080, damage: 11, headMul: 1.5, legMul: 0.9,
    mag: 19, magExt: [21, 24, 27], reload: 1.8, reloadEmpty: 2.2, speed: 480, drop: 1.2,
    hip: 1.7, adsSpread: 0.12, moveSpread: 0.9, airSpread: 2, slideSpread: -0.9,
    adsTime: 0.16, adsFov: 1.15, deploy: 0.4, moveMul: 1.05,
    recoil: pat([[0, 0.45], [0.15, 0.45], [0.3, 0.4], [0.35, 0.35], [0.2, 0.3], [-0.1, 0.3], [-0.35, 0.3], [-0.5, 0.25], [-0.35, 0.25], [0, 0.25], [0.3, 0.25], [0.45, 0.2], [0.3, 0.2], [0, 0.2]]),
    recoilRand: 0.1, recover: 8,
    sound: { cls: 'smg', gain: 0.72, crack: 1.0, snapHz: 3400, bodyHz: 980, bodyQ: 1.3, bodyDecay: 0.02, subHz: 115, sub: 0.32, subDecay: 0.03, mech: 0.35, tail: 0.4, tailHz: 1800, pitchVar: 0.05 },
    tint: '#f5c542', rarityBase: 0,
  },
  volt: {
    name: 'Volt SMG', cls: 'SMG', ammo: 'energy', mode: 'auto', rpm: 720, damage: 15, headMul: 1.5, legMul: 0.9,
    mag: 19, magExt: [21, 23, 26], reload: 1.45, reloadEmpty: 2.0, speed: 900, drop: 0.3,
    hip: 1.8, adsSpread: 0.08, moveSpread: 1.0, airSpread: 2, slideSpread: -0.9,
    adsTime: 0.17, adsFov: 1.15, deploy: 0.4, moveMul: 1.04,
    recoil: pat([[0, 0.5], [-0.1, 0.45], [-0.15, 0.4], [-0.05, 0.35], [0.1, 0.35], [0.18, 0.3], [0.1, 0.3], [-0.05, 0.3], [-0.15, 0.25], [-0.05, 0.25]]),
    recoilRand: 0.06, recover: 8,
    sound: { cls: 'energy', gain: 0.78, crack: 0.55, snapHz: 3000, bodyHz: 820, bodyQ: 1.2, bodyDecay: 0.025, subHz: 95, sub: 0.45, subDecay: 0.035, mech: 0.2, tail: 0.45, tailHz: 2200, pitchVar: 0.02, zap: 1 },
    tint: '#b7e34b', rarityBase: 1,
  },
  bulwark: {
    name: 'Bulwark LMG', cls: 'LMG', ammo: 'heavy', mode: 'auto', rpm: 540, damage: 18, headMul: 1.5, legMul: 0.9,
    mag: 35, magExt: [40, 45, 50], reload: 3.2, reloadEmpty: 4.0, speed: 540, drop: 1.0,
    hip: 3.0, adsSpread: 0.12, moveSpread: 1.8, airSpread: 3.5, slideSpread: -0.6,
    adsTime: 0.3, adsFov: 1.4, deploy: 0.75, moveMul: 0.92,
    recoil: pat([[0, 0.7], [0.1, 0.65], [0.2, 0.6], [0.3, 0.5], [0.4, 0.45], [0.45, 0.4], [0.4, 0.35], [0.3, 0.3], [0.2, 0.25], [0.1, 0.22], [0, 0.2], [-0.05, 0.2]]),
    recoilRand: 0.1, recover: 4,
    sound: { cls: 'lmg', gain: 0.95, crack: 0.75, snapHz: 1900, bodyHz: 360, bodyQ: 0.8, bodyDecay: 0.05, subHz: 58, sub: 0.95, subDecay: 0.05, mech: 0.8, tail: 1.0, tailHz: 1000, pitchVar: 0.025, rattle: 1 },
    tint: '#4fc2a0', rarityBase: 0,
  },
  breacher: {
    name: 'Breacher', cls: 'Shotgun', ammo: 'shotgun', mode: 'semi', rpm: 75, damage: 11, pellets: 11, headMul: 1.25, legMul: 1.0,
    mag: 5, magExt: [5, 5, 5], reload: 3.0, reloadEmpty: 3.0, speed: 300, drop: 2.0, pelletSpread: 1.9,
    hip: 0.6, adsSpread: 0.0, moveSpread: 0.3, airSpread: 0.5, slideSpread: -0.2,
    adsTime: 0.2, adsFov: 1.1, deploy: 0.5, moveMul: 1.0, falloffStart: 10, falloffEnd: 28, falloffMin: 0.35,
    recoil: pat([[0, 4.5]]), recoilRand: 0.5, recover: 6,
    sound: { cls: 'shotgun', gain: 1.0, crack: 1.0, snapHz: 1700, bodyHz: 280, bodyQ: 0.6, bodyDecay: 0.08, subHz: 52, sub: 1.0, subDecay: 0.11, mech: 0.6, tail: 1.3, tailHz: 900, pitchVar: 0.03, scatter: 1, pump: 1 },
    tint: '#d9452b', rarityBase: 0,
  },
  scout: {
    name: 'Scout DMR', cls: 'Marksman', ammo: 'light', mode: 'semi', rpm: 240, damage: 34, headMul: 2.0, legMul: 0.85,
    mag: 10, magExt: [15, 18, 20], reload: 2.4, reloadEmpty: 3.0, speed: 850, drop: 0.7,
    hip: 3.0, adsSpread: 0.0, moveSpread: 2, airSpread: 3, slideSpread: 0,
    adsTime: 0.25, adsFov: 2.1, deploy: 0.6, moveMul: 0.97,
    recoil: pat([[0.1, 1.6], [-0.1, 1.5], [0.15, 1.5], [-0.15, 1.4]]), recoilRand: 0.2, recover: 7,
    sound: { cls: 'dmr', gain: 0.94, crack: 1.2, snapHz: 2400, bodyHz: 520, bodyQ: 1.0, bodyDecay: 0.04, subHz: 70, sub: 0.75, subDecay: 0.07, mech: 0.35, tail: 1.1, tailHz: 1200, pitchVar: 0.02, slap: 1 },
    tint: '#e5a54b', rarityBase: 1,
  },
  sentinel: {
    name: 'Sentinel', cls: 'Sniper', ammo: 'sniper', mode: 'bolt', rpm: 50, damage: 70, headMul: 2.0, legMul: 0.85,
    mag: 4, magExt: [5, 6, 7], reload: 3.0, reloadEmpty: 3.6, speed: 1100, drop: 0.6,
    hip: 6.0, adsSpread: 0.0, moveSpread: 4, airSpread: 6, slideSpread: 0,
    adsTime: 0.35, adsFov: 4.5, deploy: 0.75, moveMul: 0.92,
    recoil: pat([[0, 4]]), recoilRand: 0.4, recover: 5,
    sound: { cls: 'sniper', gain: 1.0, crack: 1.4, snapHz: 2000, bodyHz: 250, bodyQ: 0.7, bodyDecay: 0.07, subHz: 46, sub: 1.0, subDecay: 0.14, mech: 0.5, tail: 1.9, tailHz: 900, pitchVar: 0.01, nwave: 1, slap: 1, bolt: 1 },
    tint: '#5a6ee6', rarityBase: 2,
  },
  viper: {
    name: 'Viper Revolver', cls: 'Pistol', ammo: 'heavy', mode: 'semi', rpm: 156, damage: 45, headMul: 2.0, legMul: 0.9,
    mag: 6, magExt: [7, 8, 9], reload: 2.1, reloadEmpty: 2.1, speed: 600, drop: 1.1,
    hip: 1.6, adsSpread: 0.0, moveSpread: 1.2, airSpread: 2, slideSpread: -0.6,
    adsTime: 0.18, adsFov: 1.2, deploy: 0.35, moveMul: 1.05,
    recoil: pat([[0.1, 2.6], [-0.1, 2.6]]), recoilRand: 0.25, recover: 8,
    sound: { cls: 'revolver', gain: 0.97, crack: 1.2, snapHz: 2200, bodyHz: 300, bodyQ: 0.8, bodyDecay: 0.06, subHz: 55, sub: 0.9, subDecay: 0.1, mech: 0.5, tail: 1.3, tailHz: 1000, pitchVar: 0.03, ring: 1 },
    tint: '#4fc2a0', rarityBase: 1,
  },
  p20: {
    name: 'P20 Pistol', cls: 'Pistol', ammo: 'light', mode: 'semi', rpm: 420, damage: 18, headMul: 1.5, legMul: 0.9,
    mag: 10, magExt: [12, 14, 16], reload: 1.25, reloadEmpty: 1.25, speed: 440, drop: 1.3,
    hip: 1.4, adsSpread: 0.05, moveSpread: 0.7, airSpread: 1.5, slideSpread: -0.5,
    adsTime: 0.14, adsFov: 1.1, deploy: 0.25, moveMul: 1.08,
    recoil: pat([[0.05, 1.0], [-0.05, 1.0]]), recoilRand: 0.12, recover: 10,
    sound: { cls: 'pistol', gain: 0.7, crack: 0.85, snapHz: 3000, bodyHz: 1100, bodyQ: 1.3, bodyDecay: 0.02, subHz: 125, sub: 0.28, subDecay: 0.03, mech: 0.35, tail: 0.45, tailHz: 1800, pitchVar: 0.05 },
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
