// Teams: who's who on the field. 0 and 1 are the two armies (Solari, the Void Legion); 2 the
// city's civilians and 3 its bandit gangs (City maps, src/game/Neutrals.js).
//
// Who fights whom (CombatWorld.hostile):
//  * the two armies, always;
//  * bandits and the armies, always (a gang holds its turf against both: its brain keeps it there);
//  * a civilian never starts a fight. Armed (only with a gun picked up off the field) he fights
//    whoever comes close, or has been shooting at his people; whoever he's shooting at fights him
//    back while he does. Unarmed, nobody targets him (stray rounds and blasts still kill him).

export const SOLARI = 0, VOID = 1, CIVILIAN = 2, BANDIT = 3;
export const isArmy = (e) => e?.team === SOLARI || e?.team === VOID;
export const isCivilian = (e) => e?.team === CIVILIAN;
export const isBandit = (e) => e?.team === BANDIT;

/** Seconds a civilian keeps a side as his foe after it hurt him or his people, and stays "engaged" after he fires. */
export const GRUDGE = 25, ENGAGED = 8;

/** Is civilian c fighting x right now (would he shoot at x)? */
export function civilianFights(world, c, x) {
  if (!c.civ || !c.weapons?.current || !x || x.team === CIVILIAN || x.health?.dead) return false;
  if ((c.civ.foes[x.team] ?? -1) > world.time) return true;
  const armed = x.isVehicle || !!x.weapons?.current;
  if (!armed) return false;
  const p = c.movement.state.position, q = x.movement.state.position;
  return Math.hypot(p.x - q.x, p.z - q.z) < c.civ.defend && Math.abs(p.y - q.y) < 4;
}

/** Is civilian c engaging team `team` (has he fired at it lately)? Then it fights him back. */
export function civilianEngaging(world, c, team) {
  return !!c.civ && !!c.weapons?.current && (c.civ.engaged[team] ?? -1) > world.time;
}
