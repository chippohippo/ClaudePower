// Builds final weapon stats from data: archetype defaults ← weapon overrides ← attachment ops.
// Result is a frozen plain object consumed by WeaponSystem (sim) and WeaponVisuals (presentation).

export function deepMerge(base, over) {
  if (Array.isArray(over) || typeof over !== 'object' || over === null) return over ?? base;
  const out = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base?.[k], v);
  return out;
}

function applyOp(obj, path, op, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] ??= {};
  const k = keys[keys.length - 1];
  if (op === 'set') o[k] = value;
  else if (op === 'mul') o[k] = (o[k] ?? 1) * value;
  else if (op === 'add') o[k] = (o[k] ?? 0) + value;
}

export function buildWeapon(file, weaponId, attachmentDefs = [], equipped = []) {
  const w = file.weapons.find((x) => x.id === weaponId);
  if (!w) throw new Error(`Unknown weapon ${weaponId}`);
  const stats = deepMerge(structuredClone(file.archetypes?.[w.archetype] ?? {}), w);
  for (const attId of equipped) {
    const att = attachmentDefs.find((a) => a.id === attId);
    if (!att) continue;
    if (stats.slots && !stats.slots.includes(att.slot)) throw new Error(`${attId} does not fit ${weaponId}`);
    for (const { stat, op, value } of att.ops) applyOp(stats, stat, op, value);
  }
  if (stats.mag) stats.mag = Math.round(stats.mag);
  return Object.freeze(stats);
}

/** Damage = base × falloff × hitzone × matrix[ammo][armor]. */
export function computeDamage(stats, dist, zone, armorType, matrix) {
  const d = stats.damage;
  let dmg = d.base;
  if (d.falloffStart != null && dist > d.falloffStart) {
    const u = Math.min(1, (dist - d.falloffStart) / (d.falloffEnd - d.falloffStart));
    dmg = d.base + (d.min - d.base) * u;
  }
  dmg *= zone === 'head' ? d.head ?? 1 : zone === 'limb' ? d.limb ?? 1 : 1;
  return dmg * (matrix[stats.ammoType]?.[armorType] ?? 1);
}
