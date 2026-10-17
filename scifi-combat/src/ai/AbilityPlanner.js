// AbilityPlanner: lets bots use any class kit without per-ability code.
//
// 1. profileAbility(def) reads an ability's effect data and infers what it is *for*:
//    tags such as gapCloser, heal, cover, cc, interrupt, trap, aoe, grenade, superGun or
//    callVehicle, plus its reach, radius and how to aim it. New abilities written in
//    data/abilities/*.json are usable by bots automatically.
// 2. score(profile, ctx) turns the situation into a 0..1.5 utility per ready slot: distance,
//    line of sight, HP, incoming damage, enemy casts, statuses and nearby allies.
// 3. aim(profile, ctx) returns the yaw/pitch to press with: ballistic arcs for grenades, ground
//    points for zones, lead on projectiles, away from the target for escapes, an ally for heals.
//
// Deadlock lesson baked in: hold crowd control for the enemy's cast (interrupts refund half the
// cooldown and win fights) rather than spending it on cooldown.

const CC_STATUSES = new Set(['stun', 'suppress', 'silence', 'root']);
const INTERRUPTS = new Set(['stun', 'suppress', 'silence']);
const MELEE_FORMS = new Set(['daybreak', 'abyssal', 'spectral']);
const G = 9.8;

export function profileAbility(def, slot) {
  const p = { id: def.id, slot, tags: new Set(), range: 0, radius: 0, aim: 'target', cast: def.cast?.time ?? 0, delay: 0, cc: false, interrupt: false, speed: 0, drop: 0 };
  const statusOf = (fx) => [fx.status, fx.enemyStatus, fx.onHit?.status, fx.core?.status, fx.onTrigger?.status].filter(Boolean);
  const noteCC = (fx) => {
    for (const s of statusOf(fx)) {
      if (CC_STATUSES.has(s.id) || (s.id === 'slow' && (s.stacks ?? 1) >= 2)) p.cc = true;
      if (INTERRUPTS.has(s.id)) p.interrupt = true;
    }
  };
  const fxs = def.effects ?? [];
  const damaging = fxs.some((f) => f.damage || f.burst || (f.type !== 'self' && statusOf(f).length));
  for (const fx of fxs) {
    noteCC(fx);
    switch (fx.type) {
      case 'dash':
        if (fx.iframes) { p.tags.add('escape'); p.aim = 'away'; p.range = fx.distance; }
        else if (fx.distance >= 5 && damaging) { p.tags.add('gapCloser'); p.range = Math.max(p.range, fx.distance); }
        else if ((fx.lift ?? 0) >= 6 && damaging) { p.tags.add('gapCloser'); p.range = Math.max(p.range, fx.distance + 3); }
        else p.tags.add('mobility');
        break;
      case 'blink':
        if (fx.behindTarget) { p.tags.add('gapCloser'); p.range = fx.distance; }
        else { p.tags.add('escape'); p.aim = 'away'; p.range = fx.distance; }
        break;
      case 'area':
        if (fx.center === 'charge') break;
        if (fx.target === 'allies' || fx.heal) { p.tags.add('heal'); p.aim = 'ally'; p.radius = fx.radius; p.range = fx.range ?? 20; }
        else if (fx.center === 'aim') { p.tags.add('aoe'); p.aim = 'ground'; p.radius = fx.radius; p.range = fx.range ?? 20; p.delay = Math.max(p.delay, fx.at ?? 0); }
        else if (!p.tags.has('gapCloser')) { p.tags.add('pointBlank'); p.radius = Math.max(p.radius, fx.radius); }
        break;
      case 'shape':
        if (!p.tags.has('gapCloser')) { p.tags.add('skillshot'); p.range = fx.length; }
        break;
      case 'projectile':
        if (fx.onHit?.zone?.allyHeal) { p.tags.add('heal'); p.aim = 'ally'; p.radius = fx.onHit.zone.radius; p.range = 18; break; }
        p.tags.add('grenade');
        p.speed = fx.speed; p.drop = fx.drop ?? 0; p.radius = fx.radius ?? 1;
        p.range = p.drop > 0 ? Math.min(35, (fx.speed * fx.speed) / (G * p.drop) * 0.9) : 40;
        break;
      case 'zone': {
        const r = fx.radius ?? 3;
        if (fx.targets === 'aimedEnemy') { p.tags.add('tetherEnemy'); p.range = r * 0.9; }
        else if (fx.targets === 'aimedAlly') { p.tags.add('tetherAlly'); p.aim = 'ally'; p.range = r * 0.9; }
        else if (fx.blocksProjectiles) { p.tags.add('dome'); p.aim = 'self'; p.radius = r; }
        else if (fx.allyHeal || fx.revive || fx.allyWeaponStatus) { p.tags.add('heal'); p.aim = fx.center === 'aim' ? 'ally' : 'self'; p.radius = r; p.range = fx.range ?? 0; }
        else if (fx.allyStatus) { p.tags.add('buffZone'); p.aim = fx.center === 'aim' ? 'ally' : 'self'; p.radius = r; }
        else if (fx.blocksReveal || fx.blocksVision) { p.tags.add('defensive'); p.aim = fx.center === 'aim' ? 'feet' : 'self'; p.radius = r; }
        else if (fx.damage || fx.enemyStatus || fx.pull || fx.burst) {
          if (fx.attach === 'self' || !fx.center) { p.tags.add('pointBlank'); p.radius = Math.max(p.radius, r); }
          else { p.tags.add('aoe'); p.aim = 'ground'; p.radius = r; p.range = fx.range ?? 20; p.delay = Math.max(p.delay, fx.delay ?? 0); }
        }
        break;
      }
      case 'deployable': {
        const k = fx.kind;
        p.deploy = k;
        if (k === 'wall') { p.tags.add('cover'); p.aim = 'level'; }
        else if (k === 'turret' || k === 'engine') { p.tags.add('setup'); p.aim = 'near'; p.range = fx.range ?? 25; }
        else if (k === 'beacon') { p.tags.add('buffZone'); p.aim = 'near'; p.radius = fx.aura?.radius ?? 6; }
        else if (k === 'mine' || k === 'tripwire') { p.tags.add('trap'); p.aim = 'feet'; }
        else if (k === 'charge') { p.tags.add('charge'); p.aim = 'ground'; p.range = 5; }
        else if (k === 'vehicle') { p.tags.add('callVehicle'); p.aim = 'near'; }
        else if (k === 'decoy') { p.tags.add('escape'); p.aim = 'away'; }
        else if (k === 'launchpad') p.tags.add('mobility');
        break;
      }
      case 'self':
        if (fx.overshield || fx.heal || fx.cleanse || fx.status?.id === 'fortify' || fx.status?.id === 'barrier') p.tags.add('defensive');
        if (fx.weaponBuff) p.tags.add('offenseBuff');
        if (fx.meleeBuff || fx.meleeHeat != null) p.tags.add('meleeBuff');
        if (fx.status?.id === 'cloak') p.tags.add('stealth');
        if (fx.status?.id === 'haste' || fx.status?.id === 'hover') p.tags.add('mobility');
        if (fx.status?.id === 'devour') p.tags.add('offenseBuff');
        if (p.aim === 'target') p.aim = 'self';
        break;
      case 'reveal': p.tags.add('info'); p.aim = 'self'; p.radius = fx.radius; break;
      case 'transform':
        p.tags.add(fx.form === 'siege_frame' ? 'superTank' : MELEE_FORMS.has(fx.form) ? 'superMelee' : 'superGun');
        p.aim = 'self';
        break;
    }
  }
  if (def.recast) p.recast = def.recast;
  // An interrupt only counts if it's fast enough to land during an enemy cast.
  p.interrupt = p.interrupt && p.cast <= 0.35 && (p.tags.has('grenade') || p.tags.has('aoe') || p.tags.has('pointBlank') || p.tags.has('skillshot') || p.tags.has('gapCloser'));
  if (p.interrupt) p.tags.add('interrupt');
  return p;
}

/** Utility of using `p` right now. ctx: see CombatBotBrain#context. */
export function scoreAbility(p, ctx, persona) {
  const t = ctx.target, d = ctx.dist, los = ctx.los;
  let s = 0;
  const has = (tag) => p.tags.has(tag);
  if (has('gapCloser') && t && los && d >= p.range * 0.45 && d <= p.range + 1.5) s = Math.max(s, 0.55 + persona.aggression * 0.45);
  if (has('skillshot') && t && los && d <= p.range) s = Math.max(s, 0.8);
  if (has('pointBlank') && t && d <= p.radius * 0.95) s = Math.max(s, 0.8 + 0.15 * Math.min(2, ctx.enemiesNear - 1));
  if (has('aoe') && t && d <= p.range && d > Math.min(4, p.radius)) {
    const sticky = ctx.targetSpeed < 1.5 || ctx.targetRooted;
    s = Math.max(s, p.delay > 1.5 && !sticky ? 0.55 : sticky ? 0.95 : 0.7);
  }
  if (has('grenade') && t && d >= 4 && d <= p.range) s = Math.max(s, ctx.targetSpeed < 1.5 ? 0.85 : 0.65);
  if (p.cc && t) s += 0.1;
  if (has('interrupt') && ctx.targetCasting && d <= Math.max(p.range, p.radius, 6) + 2) s = Math.max(s, 1.5);
  if (has('heal')) { const need = Math.min(ctx.selfHp, ctx.hurtAllyHp); if (need < 0.65) s = Math.max(s, 1.1 - need); }
  if (has('tetherEnemy') && t && los && d <= p.range) s = Math.max(s, ctx.selfHp < 0.8 ? 0.9 : 0.7);
  if (has('tetherAlly') && ctx.hurtAlly && ctx.hurtAllyHp < 0.7 && ctx.hurtAllyDist <= p.range) s = Math.max(s, 0.9);
  if (has('buffZone') && t && d < 28) s = Math.max(s, 0.45 + 0.15 * ctx.alliesNear + (ctx.underFire ? 0.2 : 0));
  if (has('dome') && ctx.underFire && (ctx.selfHp < 0.9 || ctx.alliesNear > 0)) s = Math.max(s, 1.0);
  if (has('defensive') && ((ctx.underFire && ctx.selfHp < 0.7) || ctx.negativeStatuses > 0)) s = Math.max(s, 0.95);
  if (has('cover') && ctx.underFire && t && d > 7) s = Math.max(s, 0.95);
  if (has('setup') && t && d >= 5 && d <= p.range && !ctx.ownsDeployable(p.deploy)) s = Math.max(s, 0.75);
  if (has('trap') && t && d < 30 && !ctx.ownsDeployable(p.deploy)) s = Math.max(s, ctx.closing && d < 18 ? 0.75 : 0.58);
  if (has('charge') && t && d < 6 && !ctx.ownsDeployable('charge')) s = Math.max(s, 0.75);
  if (has('callVehicle') && persona.usesVehicles !== 'never' && !ctx.inVehicle && !ctx.vehicleNearby && (!t || d > 18)) s = Math.max(s, 0.85);
  if (has('escape') && ctx.selfHp < persona.retreatHp + 0.1 && ctx.underFire) s = Math.max(s, 1.05);
  if (has('mobility') && t && (d > persona.preferredRange + 8 || (ctx.selfHp < persona.retreatHp && ctx.underFire))) s = Math.max(s, 0.6);
  if (has('offenseBuff') && t && los && d < 30) s = Math.max(s, 0.65);
  if (has('meleeBuff') && t && d < 4.5) s = Math.max(s, 0.75);
  if (has('stealth') && t && ((persona.flank && d > 8 && d < 35) || (ctx.selfHp < 0.35 && ctx.underFire))) s = Math.max(s, 0.75);
  if (has('info') && t && (!los || ctx.targetCloaked)) s = Math.max(s, 0.75);
  if (has('superGun') && t && los && d < 45) s = Math.max(s, 1.2);
  if (has('superMelee') && t && d < 9) s = Math.max(s, 1.25);
  if (has('superTank') && t && d < 30) s = Math.max(s, 1.1);
  // Hold interrupt-capable CC for the enemy's cast (unless the target is nearly dead): Deadlock rule.
  if (has('interrupt') && !ctx.targetCasting && ctx.holdInterrupts && (ctx.targetHp ?? 1) > 0.3) s *= 0.45;
  if (p.slot === 'super') s *= 1.15;   // supers are made to be used, but only when a rule above fires
  return s * persona.abilityEagerness;
}

/**
 * How close this ability wants the bot to be (metres), or Infinity. The brain shrinks its preferred
 * range toward this while the ability is ready, so tethers, slams and point-blank supers get used.
 */
export function abilityReach(p) {
  let r = Infinity;
  if (p.tags.has('pointBlank')) r = Math.min(r, p.radius * 0.6);
  if (p.tags.has('superMelee')) r = Math.min(r, 6);
  if (p.tags.has('skillshot')) r = Math.min(r, p.range * 0.8);
  if (p.tags.has('tetherEnemy')) r = Math.min(r, p.range * 0.8);
  if (p.tags.has('gapCloser')) r = Math.min(r, p.range * 0.9);
  if (p.tags.has('charge')) r = Math.min(r, 5);
  return r;
}

/** Yaw/pitch to press the ability with. Eye height ~1.6 m. */
export function aimAbility(p, ctx) {
  const me = ctx.selfPos, t = ctx.target;
  const toward = (pt) => Math.atan2(-(pt.x - me.x), -(pt.z - me.z));
  const yawT = t ? toward(t.pos) : ctx.yaw;
  switch (p.aim) {
    case 'away': return { yaw: t ? yawT + Math.PI : ctx.yaw, pitch: 0 };
    case 'self': return { yaw: ctx.yaw, pitch: 0 };
    case 'feet': return { yaw: ctx.yaw, pitch: -1.25 };
    case 'near': return { yaw: yawT, pitch: -0.55 };
    case 'level': return { yaw: yawT, pitch: -0.15 };
    case 'ally': {
      const a = ctx.hurtAlly && ctx.hurtAllyHp < ctx.selfHp ? ctx.hurtAlly.pos : null;
      if (!a) return { yaw: ctx.yaw, pitch: -1.4 }; // heal yourself: lob it at your feet
      const dx = Math.hypot(a.x - me.x, a.z - me.z);
      return { yaw: toward(a), pitch: -Math.atan2(1.6, Math.max(0.5, dx)) };
    }
    case 'ground': {
      if (!t) return { yaw: ctx.yaw, pitch: -0.5 };
      const dist = Math.min(ctx.dist, (p.range || 20) - 0.5);
      return { yaw: yawT, pitch: -Math.atan2(me.y + 1.6 - t.pos.y, Math.max(0.5, dist)) };
    }
    case 'target':
    default: {
      if (!t) return { yaw: ctx.yaw, pitch: 0 };
      if (p.tags.has('grenade')) return { yaw: yawT, pitch: ballisticPitch(ctx.dist, t.pos.y + 0.6 - (me.y + 1.5), p.speed, G * p.drop) };
      return { yaw: yawT, pitch: Math.atan2(t.pos.y + 1.1 - (me.y + 1.6), Math.max(0.5, ctx.dist)) };
    }
  }
}

/** Low-arc launch angle to hit (dx, dy) at speed v with gravity g; falls back to 45° when out of range. */
export function ballisticPitch(dx, dy, v, g) {
  if (!g) return Math.atan2(dy, dx);
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * dx * dx + 2 * dy * v2);
  if (disc < 0) return Math.PI / 4;
  return Math.atan((v2 - Math.sqrt(disc)) / (g * dx));
}
