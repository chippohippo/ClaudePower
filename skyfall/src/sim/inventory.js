// Inventory rules: picking up, swapping, auto-attaching, ammo/consumable stacking and dropping.
// Pure functions over a sim player object so humans and bots share the exact same logic.

import { WEAPONS, magSize, AMMO } from '../shared/weapons.js';
import { stackSize, ATTACHMENTS, CLASS_SLOTS, BACKPACK_SLOTS, CONSUMABLES } from '../shared/items.js';
import { SHIELD_TIERS } from '../shared/constants.js';

export function makeWeapon(id, tier = 0) {
  const w = WEAPONS[id];
  const att = { mag: 0, barrel: 0, stock: 0, optic: null };
  const slots = CLASS_SLOTS[w.cls];
  if (tier >= 1 && slots.includes('mag')) att.mag = Math.min(3, tier);
  if (tier >= 2 && slots.includes('barrel')) att.barrel = Math.min(3, tier);
  if (tier >= 2 && slots.includes('stock')) att.stock = Math.min(3, tier);
  if (tier >= 3 && slots.includes('optic')) att.optic = w.cls === 'Sniper' ? 'optic3' : 'optic1';
  return { id, tier, mag: magSize(w, att.mag), att };
}

export function bagSlots(p) {
  return BACKPACK_SLOTS[p.pack] || 8;
}

export function countItem(p, key) {
  let n = 0;
  for (const s of p.inv) if (s.item === key) n += s.n;
  return n;
}

export function takeItem(p, key, n) {
  let need = n;
  for (let i = p.inv.length - 1; i >= 0 && need > 0; i--) {
    const s = p.inv[i];
    if (s.item !== key) continue;
    const t = Math.min(s.n, need);
    s.n -= t;
    need -= t;
    if (s.n <= 0) p.inv.splice(i, 1);
  }
  return n - need;
}

// Add stackable item to bag. Returns amount that did not fit.
export function addStack(p, key, n, tier = 0) {
  const max = stackSize(key);
  if (max > 1) {
    for (const s of p.inv) {
      if (s.item === key && s.n < max) {
        const t = Math.min(max - s.n, n);
        s.n += t;
        n -= t;
        if (n <= 0) return 0;
      }
    }
  }
  while (n > 0 && p.inv.length < bagSlots(p)) {
    const t = Math.min(max, n);
    p.inv.push({ item: key, n: t, tier });
    n -= t;
  }
  return n;
}

function attachmentFits(weapon, attId) {
  const a = ATTACHMENTS[attId];
  return CLASS_SLOTS[WEAPONS[weapon.id].cls].includes(a.slot);
}

// Try to attach attachment (attId, level) to weapons. Returns the replaced attachment or true if attached, false if not.
function tryAttach(p, attId, level) {
  const a = ATTACHMENTS[attId];
  for (const slot of [p.active, 1 - p.active]) {
    const w = p.weapons[slot];
    if (!w || !attachmentFits(w, attId)) continue;
    if (a.slot === 'optic') {
      if (!w.att.optic) { w.att.optic = attId; return { ok: true }; }
      continue;
    }
    if ((w.att[a.slot] || 0) < level) {
      const old = w.att[a.slot];
      w.att[a.slot] = level;
      return { ok: true, old: old ? { item: 'x:' + attId, tier: old } : null };
    }
  }
  return { ok: false };
}

// Returns list of world items to drop (swapped-out gear), or null if pickup failed.
export function pickup(p, wi) {
  const drops = [];
  const [t, id] = wi.item.split(':');
  if (t === 'w') {
    const nw = makeWeapon(id, wi.tier);
    if (wi.mag !== undefined) nw.mag = wi.mag;
    if (wi.att) nw.att = { ...wi.att };
    let slot = p.weapons[0] ? (p.weapons[1] ? p.active : 1) : 0;
    const old = p.weapons[slot];
    if (old) {
      // move attachments from old weapon to new where compatible
      for (const k of ['mag', 'barrel', 'stock']) {
        if (old.att[k] && CLASS_SLOTS[WEAPONS[nw.id].cls].includes(k) && old.att[k] > (nw.att[k] || 0)) {
          nw.att[k] = old.att[k];
          old.att[k] = 0;
        }
      }
      if (old.att.optic && !nw.att.optic && CLASS_SLOTS[WEAPONS[nw.id].cls].includes('optic')) {
        nw.att.optic = old.att.optic;
        old.att.optic = null;
      }
      drops.push({ item: 'w:' + old.id, n: 1, tier: old.tier, mag: 0, att: old.att });
      // refund mag ammo to bag
      if (old.mag > 0) addStack(p, 'a:' + WEAPONS[old.id].ammo, old.mag);
    }
    p.weapons[slot] = nw;
    p.active = slot;
    p.switchT = WEAPONS[nw.id].deploy;
    return drops;
  }
  if (t === 'a' || t === 'c' || t === 'g') {
    const left = addStack(p, wi.item, wi.n);
    if (left === wi.n) return null;
    if (left > 0) drops.push({ item: wi.item, n: left, tier: 0, keepId: true });
    return drops;
  }
  if (wi.item === 'armor') {
    const old = p.armor;
    const oldCharge = p.shield, oldEvo = p.evoDmg;
    if (wi.tier <= old && (wi.charge ?? SHIELD_TIERS[wi.tier]) <= oldCharge) return null;
    p.armor = wi.tier;
    p.shield = wi.charge ?? SHIELD_TIERS[wi.tier];
    p.evoDmg = wi.evo ?? 0;
    if (old > 0) drops.push({ item: 'armor', n: 1, tier: old, charge: oldCharge, evo: oldEvo });
    return drops;
  }
  if (wi.item === 'helmet' || wi.item === 'pack') {
    const cur = p[wi.item];
    if (wi.tier <= cur) return null;
    p[wi.item] = wi.tier;
    if (cur > 0) drops.push({ item: wi.item, n: 1, tier: cur });
    return drops;
  }
  if (t === 'x') {
    const r = tryAttach(p, id, wi.tier);
    if (r.ok) {
      if (r.old) {
        if (addStack(p, r.old.item, 1, r.old.tier) > 0) drops.push({ item: r.old.item, n: 1, tier: r.old.tier });
      }
      return drops;
    }
    if (addStack(p, wi.item, 1, wi.tier) > 0) return null;
    return drops;
  }
  return null;
}

// Is this item useful for the player? (bots + auto-pickup hints)
export function itemValue(p, wi) {
  const [t, id] = wi.item.split(':');
  if (t === 'w') {
    if (!p.weapons[0] || !p.weapons[1]) return 10 + wi.tier;
    const worst = Math.min(p.weapons[0].tier, p.weapons[1].tier);
    return wi.tier > worst + 1 ? 4 : 0;
  }
  if (t === 'a') {
    const uses = p.weapons.some((w) => w && WEAPONS[w.id].ammo === id);
    if (!uses) return 0;
    return countItem(p, wi.item) < AMMO[id].stack * 2 ? 6 : 1;
  }
  if (wi.item === 'armor') return wi.tier > p.armor ? 9 : 0;
  if (wi.item === 'helmet' || wi.item === 'pack') return wi.tier > p[wi.item] ? 5 : 0;
  if (t === 'c') return countItem(p, wi.item) < CONSUMABLES[id].stack * 2 ? 5 : 0;
  if (t === 'g') return countItem(p, wi.item) < 2 ? 3 : 0;
  if (t === 'x') {
    return p.weapons.some((w) => w && attachmentFits(w, id) && (ATTACHMENTS[id].slot === 'optic' ? !w.att.optic : (w.att[ATTACHMENTS[id].slot] || 0) < wi.tier)) ? 4 : 0;
  }
  return 0;
}

export function reloadAmount(p, w) {
  const def = WEAPONS[w.id];
  const need = magSize(def, w.att.mag) - w.mag;
  if (need <= 0) return 0;
  return Math.min(need, countItem(p, 'a:' + def.ammo));
}
