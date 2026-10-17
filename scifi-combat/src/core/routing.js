// Splits one Command between the sword and the gun according to the fighter's mode, so the same
// buttons (LMB, RMB) drive whichever weapon is out. Used for players and bots alike.

const NONE = Object.freeze({ down: false, pressed: false, released: false });

export function stripButtons(cmd, keys) {
  const c = { ...cmd, buttons: { ...cmd.buttons } };
  for (const k of keys) c.buttons[k] = NONE;
  return c;
}

export function routeCommand(e, cmd) {
  const gun = e.mode === 'gun';
  return {
    meleeCmd: gun ? stripButtons(cmd, ['light', 'heavy', 'guard']) : cmd,
    gunCmd: gun && !e.status?.disarmed ? cmd : stripButtons(cmd, ['light', 'guard', 'reload', 'swapWeapon']),
  };
}
