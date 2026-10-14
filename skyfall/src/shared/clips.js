// Animation states the game plays on imported characters → clip-name patterns, first match wins.
// Shared by the runtime (client/assets.js maps clips to states) and the importer (which keeps only
// clips that can match, to keep files small). Covers Quaternius (Universal Animation Library,
// Ultimate Animated Characters: "CharacterArmature|Run"), KayKit ("2H_Ranged_Aiming",
// "Running_A", "Lie_Idle"), Kenney and Mixamo (clips renamed after their file, e.g. "Rifle Run").
// A manifest "clips" map overrides any state per character.

export const CLIP_PATTERNS = {
  idle: [/^idle_?gun/i, /gun.*idle/i, /rifle.?(idle|aiming)/i, /2h_ranged_aiming/i, /^idle$/i, /idle_?loop/i, /^idle/i, /breath/i],
  walk: [/^walk_?gun/i, /rifle.?walk/i, /^walking_a$/i, /^walk(_?loop)?$/i, /^walk(?!.*back)/i, /walking(?!.*back)/i],
  walkBack: [/walk.*back/i, /back.*walk/i],
  run: [/^run_?gun/i, /gun.*run/i, /rifle.?run/i, /^running_a$/i, /^run(_?loop)?$/i, /^sprint/i, /^run(?!.*strafe)/i, /running(?!.*strafe)/i, /jog/i],
  strafeL: [/strafe.?l(eft)?$/i, /left.?strafe/i],
  strafeR: [/strafe.?r(ight)?$/i, /right.?strafe/i],
  crouch: [/crouch.*(walk|fwd|forward|move)/i, /^crouch/i, /sneak/i],
  slide: [/slide/i, /sit_floor_(pose|idle)/i, /^roll/i, /crouch/i],
  jump: [/jump_?idle/i, /^jump$/i, /jump.*(loop|air|fall)/i, /fall/i, /^jump/i, /air/i],
  skydive: [/sky.?dive/i, /falling/i, /jump_?idle/i, /swim/i, /^jump/i],
  downed: [/crawl/i, /lie_idle/i, /lie_pose/i, /^death/i, /dead/i, /die/i],
  death: [/^death_?a$/i, /^death/i, /dead/i, /die/i, /dying/i],
  shoot: [/2h_ranged_shoot$/i, /rifle.?(shoot|fire)/i, /shoot/i, /fire/i, /punch/i],
  reload: [/2h_ranged_reload/i, /rifle.?reload/i, /reload/i],
  hit: [/hit_?a$/i, /hit.?react/i, /^hit/i, /damage/i],
  heal: [/use_item/i, /interact/i, /^use/i, /pickup/i],
  zip: [/hang/i, /climb/i, /jump_?idle/i],
  // optional extras (UAL): faster locomotion, transitions and reactions. Missing ones fall back.
  sprint: [/^sprint/i, /fast.?run/i],
  crouchIdle: [/crouch.?idle/i],
  mantle: [/climb.?up/i, /vault/i, /mantle/i],
  jumpStart: [/jump_?start/i, /jump.?up$/i],
  land: [/jump_?land/i, /^land/i],
  slideIn: [/slide_?start/i],
  knock: [/hit_?knock/i, /knock.?back/i],
  roll: [/^roll/i],
  revive: [/fixing.?kneel/i, /kneel/i, /interact/i, /pickup/i],
  cast: [/overhand.?throw/i, /throw/i, /spell.*shoot/i],
  idlePistol: [/pistol_?idle/i],
  dive: [/swim_?fwd/i, /dive/i],
  getUp: [/lay.?to.?idle/i, /get.?up/i, /stand.?up/i],
};

// Bare clip name: strips armature prefixes like "CharacterArmature|Run" or "mixamo.com|Run".
export const clipShort = (n) => String(n || '').split('|').pop();

export function matchClip(names, state, overrides) {
  if (overrides && overrides[state] && names.includes(overrides[state])) return overrides[state];
  const short = names.map(clipShort);
  for (const re of CLIP_PATTERNS[state] || []) {
    const i = short.findIndex((n) => re.test(n));
    if (i >= 0) return names[i];
  }
  return null;
}

// Clips worth shipping: the best match for every state (importer prunes the rest).
export function usefulClips(names, overrides) {
  const keep = new Set();
  for (const st of Object.keys(CLIP_PATTERNS)) { const n = matchClip(names, st, overrides); if (n) keep.add(n); }
  return keep;
}
