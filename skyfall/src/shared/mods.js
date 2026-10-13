// Movement speed modifiers derived from status effects. Shared so client prediction and the
// server agree exactly on how fast a stimmed / slowed / healing player moves.

import { BTN } from './constants.js';
import { WEAPONS } from './weapons.js';

export function speedMul(status, healing, weaponId, buttons, legend) {
  let mul = 1;
  if (status.stim > 0) mul *= 1.4;
  if (status.phase > 0) mul *= 1.5;
  if (status.doubletime > 0 && buttons & BTN.SPRINT) mul *= 1.3;
  if (status.slow > 0) mul *= 0.6;
  if (status.gas > 0 && legend !== 'miasma') mul *= 0.85;
  if (healing) mul *= 0.55;
  if (weaponId && WEAPONS[weaponId]) mul *= WEAPONS[weaponId].moveMul;
  return mul;
}
