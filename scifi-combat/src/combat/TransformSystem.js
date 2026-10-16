// TransformSystem: roaming supers (Destiny-style) that temporarily replace a fighter's weapon,
// sword moveset and/or body (data/supers.json).
//
// Rules:
//  * A transform is owned by the super's ability slot. When the slot's active phase ends (duration,
//    cancel, interrupt, depletion) everything reverts exactly: loadout, gun index, moveset,
//    movement mods and demo mode.
//  * Supers can end early: out of ammo (Judgment, Event Horizon, Unmaking Gaze) or frame broken
//    (Siege Frame). An early end is announced like any other end, so enemies know the threat is over.
//  * Readability: `ability:transform` carries the form's aura and scale. Views must make a
//    transformed fighter recognizable at range (bigger silhouette, faction glow, sound loop).

import { bus } from '../core/EventBus.js';
import { WeaponInstance } from './weapons/WeaponSystem.js';
import { deepMerge } from './weapons/WeaponDefs.js';

export function applyTransform(owner, formId, world, { ability, duration } = {}) {
  const defs = world.supers;
  const form = defs?.forms?.[formId];
  if (!form) { console.warn(`Unknown transform form "${formId}"`); return false; }
  if (owner.transform) revertTransform(owner);

  const saved = { mode: owner.mode, mods: { ...owner.movement.mods } };
  owner.transform = { form: formId, def: form, ability, saved, until: duration };

  if (form.weapon && owner.weapons) {
    const stats = defs.weapons[form.weapon];
    saved.loadout = owner.weapons.loadout;
    saved.index = owner.weapons.index;
    owner.weapons.loadout = [new WeaponInstance(stats, world.recoilDefs ?? {})];
    owner.weapons.index = 0;
    owner.weapons.consecutive = 0;
    if ('mode' in owner) owner.mode = 'gun';
  }
  if (form.moveset && owner.melee) {
    const ms = defs.movesets[form.moveset];
    const base = world.meleeWeapons?.find((w) => w.id === ms.base) ?? owner.melee.w;
    saved.melee = owner.melee.w;
    const merged = deepMerge(structuredClone(base), ms);
    // replaceAttacks: the moveset's attack list is complete (no inherited combo chains or specials).
    if (ms.replaceAttacks) merged.attacks = structuredClone(ms.attacks);
    owner.melee.setMoveset(merged);
    if ('mode' in owner) owner.mode = 'sword';
  }
  if (form.movement) Object.assign(owner.movement.mods, form.movement);
  if (form.frameHp) {
    owner.health.addOvershield(form.frameHp, duration ?? 15);
    owner.transform.frameBroken = false;
    owner.transform.offFrame = bus.on('health:overshieldBreak', (e) => { if (e.id === owner.id && owner.transform?.form === formId) owner.transform.frameBroken = true; });
  }

  bus.emit('ability:transform', {
    id: owner.id, team: owner.team, ability, form: formId, aura: form.aura, duration,
    scale: form.movement?.scale ?? defs.movesets?.[form.moveset]?.visual?.scale ?? 1,
    weapon: form.weapon, moveset: form.moveset,
  });
  return true;
}

export function revertTransform(owner, reason = 'done') {
  const t = owner.transform;
  if (!t) return;
  const s = t.saved;
  if (s.loadout) { owner.weapons.loadout = s.loadout; owner.weapons.index = s.index; owner.weapons.interrupt?.('transform'); }
  if (s.melee) owner.melee.setMoveset(s.melee);
  owner.movement.mods = s.mods;
  if ('mode' in owner) owner.mode = s.mode;
  if (t.def.frameHp) owner.health.overshield = 0;
  t.offFrame?.();
  owner.transform = null;
  bus.emit('ability:transformEnd', { id: owner.id, form: t.form, ability: t.ability, reason });
}

/** True when the super should end early (no ammo left, or the mech frame broke). */
export function transformDepleted(owner) {
  const t = owner.transform;
  if (!t) return false;
  if (t.def.endWhenFrameBreaks && t.frameBroken) return 'frameBroken';
  if (t.def.endWhenEmpty && owner.weapons) {
    const w = owner.weapons.current;
    const empty = w.usesBattery ? w.battery <= 0 : w.usesHeat ? false : w.mag <= 0;
    // Let the last shot's recovery play out so the final Judgment shot isn't cut off.
    if (empty && owner.weapons.cooldown <= 0) return 'depleted';
  }
  return false;
}
