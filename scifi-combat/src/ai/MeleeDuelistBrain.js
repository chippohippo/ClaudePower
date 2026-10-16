// MeleeDuelistBrain — utility-scored melee AI that *produces Commands* (same as a player).
// It respects and reads the player's guard: it remembers the player's parry timing, mixes
// delayed swings, feints, and guard breaks, and backs off when the player is too good.
//
// Tells for skilled players: every heavy is preceded by a 0.15 s "plant" (crouch-lean in anim);
// feints have a shorter flame flare than real heavies.

import { emptyCommand } from '../input/InputManager.js';
import { MeleePhase } from '../combat/melee/MeleeSystem.js';

export class MeleeDuelistBrain {
  /**
   * @param {object} self    { movement, melee }
   * @param {object} personality { aggression, patience, feintRate, reactionTime, parrySkill }
   */
  constructor(self, personality) {
    this.self = self;
    this.p = { aggression: 0.6, patience: 0.5, feintRate: 0.2, reactionTime: 0.3, parrySkill: 0.5, ...personality };
    this.target = null;
    this.reactTimer = 0;
    this.pendingReaction = null;
    this.playerParryRate = 0;  // learned: how often the target parries our lights
    this.decisionCooldown = 0;
    this.prevButtons = {};
    this.circleDir = Math.random() < 0.5 ? -1 : 1;
  }

  /** Called from bus listeners. Reacting is delayed by reactionTime → difficulty knob. */
  observeWindup(e) {
    if (e.id !== this.target?.id) return;
    const roll = Math.random();
    let action = 'none';
    if (e.unblockable) action = 'dodge';
    else if (roll < this.p.parrySkill) action = 'parry';
    else if (roll < this.p.parrySkill + 0.3) action = 'block';
    // Schedule the response so it lands just before the hit (parry needs to be timed!).
    const hitAt = e.windup;
    this.pendingReaction = { action, at: Math.max(this.p.reactionTime, hitAt - 0.08) };
    this.reactTimer = 0;
  }
  observeParried(e) {
    if (e.attacker === this.self.id) this.playerParryRate = this.playerParryRate * 0.7 + 0.3;
  }

  think(dt, tick) {
    const cmd = emptyCommand();
    cmd.tick = tick;
    const t = this.target;
    if (!t) return this.#finish(cmd, {});
    const me = this.self.movement.state;
    const dx = t.movement.state.position.x - me.position.x;
    const dz = t.movement.state.position.z - me.position.z;
    const dist = Math.hypot(dx, dz);
    cmd.yaw = Math.atan2(-dx, -dz);
    const want = {};

    // 1) Defensive reaction scheduled by observeWindup.
    if (this.pendingReaction) {
      this.reactTimer += dt;
      if (this.reactTimer >= this.pendingReaction.at) {
        const a = this.pendingReaction.action;
        // Parry = press just before impact and keep holding briefly (a release before the hit would whiff).
        const held = this.reactTimer - this.pendingReaction.at;
        if (a === 'parry') { want.guard = 'hold'; if (held > 0.2) this.pendingReaction = null; }
        if (a === 'block') { want.guard = 'hold'; if (held > 0.6) this.pendingReaction = null; }
        if (a === 'dodge') { want.dodge = true; cmd.moveX = this.circleDir; this.pendingReaction = null; }
        if (a === 'none') this.pendingReaction = null;
      }
    }

    // 2) Punish: target staggered or whiffed a parry → go in.
    const tm = t.melee;
    if (tm.vulnerable || tm.phase === MeleePhase.PARRY_WHIFF || tm.phase === MeleePhase.RECOVERY) {
      if (dist > 2) cmd.moveY = 1; else want.light = true;
    } else if (this.self.melee.counterWindow > 0) {
      want.light = true; // riposte
    } else if (!want.guard && !want.dodge) {
      // 3) Spacing + offense via utility scores.
      this.decisionCooldown -= dt;
      const inRange = dist < 2.2;
      if (!inRange) {
        cmd.moveY = dist > 4 ? 1 : 0.5;
        cmd.moveX = this.circleDir * 0.4;
      } else if (this.decisionCooldown <= 0) {
        this.decisionCooldown = 0.35 + this.p.patience * 0.6;
        const scores = {
          light: this.p.aggression * (1 - this.playerParryRate),
          heavy: this.p.aggression * 0.5 + (tm.guarding ? 0.2 : 0),
          guardBreak: tm.guarding ? 0.6 : 0.05,
          feint: this.playerParryRate * this.p.feintRate * 2,
          backoff: (1 - this.p.aggression) * 0.4 + (this.self.movement.state.stamina < 30 ? 0.6 : 0),
        };
        const choice = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
        this.intent = { choice, time: 0 };
      }
      if (this.intent) {
        this.intent.time += dt;
        const c = this.intent.choice;
        if (c === 'light') { want.light = true; this.intent = null; }
        else if (c === 'heavy') { want.heavyHold = this.intent.time < 0.3; if (this.intent.time > 0.3) this.intent = null; }
        else if (c === 'feint') { want.heavyHold = true; if (this.intent.time > 0.2) { want.guard = 'tap'; this.intent = null; } }
        else if (c === 'guardBreak') { want.heavyHold = true; want.light = true; this.intent = null; }
        else if (c === 'backoff') { cmd.moveY = -1; cmd.moveX = this.circleDir; if (this.intent.time > 0.6) this.intent = null; }
      }
    }
    // Zone awareness: telegraphed hostile zones (airstrikes, anchors, storms) are readable for bots
    // too. Step out along the threat vector, which overrides everything except an ongoing parry.
    const threat = this.world?.zones?.threatAt(me.position, this.self.team);
    if (threat && threat.lengthSq() > 0 && want.guard !== 'hold') {
      const fx = -Math.sin(cmd.yaw), fz = -Math.cos(cmd.yaw); // forward
      const rx = -fz, rz = fx;                                 // right
      const len = Math.hypot(threat.x, threat.z);
      cmd.moveY = (threat.x * fx + threat.z * fz) / len;
      cmd.moveX = (threat.x * rx + threat.z * rz) / len;
      want.light = false; want.heavyHold = false;
      if (this.self.movement.state.stamina > 40 && Math.random() < 0.05) want.dodge = true;
    }
    // Abilities: the bot uses its gap-closer from mid range, the same way a player would.
    // Like a Deadlock bot, it only commits a long cooldown when the target is not guarding.
    const ab = this.self.abilities?.slots?.ability1;
    if (ab?.ready && dist > 4 && dist < 8 && !tm.guarding && Math.random() < 0.03 * (0.5 + this.p.aggression)) want.ability1 = true;
    // Super: commit when the target is close and not already transformed (don't trade supers blindly).
    const ab2 = this.self.abilities;
    if (ab2?.slots?.super && ab2.superEnergy >= ab2.superCost && !this.self.transform && dist < 7 && !t.transform && !this.self.status?.silenced) want.super = true;
    return this.#finish(cmd, want);
  }

  // Convert intents into press/release edges like a real controller would generate.
  #finish(cmd, want) {
    const down = {
      light: !!want.light,
      heavy: !!want.heavyHold,
      guard: want.guard === 'hold' || (want.guard === 'tap' && !this.prevButtons.guard),
      dodge: !!want.dodge,
      ability1: !!want.ability1,
      super: !!want.super,
    };
    for (const [k, d] of Object.entries(down)) {
      const was = !!this.prevButtons[k];
      cmd.buttons[k] = { down: d, pressed: d && !was, released: !d && was };
      this.prevButtons[k] = d;
    }
    return cmd;
  }
}
