// MeleeTells: the swings coming at you (docs/GAMEPLAY_PLAN.md §4). A chevron on a ring round the
// crosshair for every enemy within 6 m winding up a sword (or a rifle butt) while facing you,
// pointing at him and filling as his windup runs out, so you can block, parry or dive in time
// from any angle, the camera's back included. Blockable swings are amber, unblockable ones red;
// the last tenth of a windup flashes white: now.

import { MeleePhase } from '../combat/melee/MeleeSystem.js';

const NS = 'http://www.w3.org/2000/svg';
const N = 6, RANGE = 6;

export class MeleeTells {
  /** @param {HTMLElement} root the HUD @param {object} o { player, world } */
  constructor(root, { player, world }) {
    this.player = player; this.world = world;
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('width', 260); s.setAttribute('height', 260); s.setAttribute('viewBox', '-130 -130 260 260');
    s.style.cssText = 'position:absolute;left:50%;top:50%;margin:-130px 0 0 -130px;pointer-events:none;overflow:visible';
    root.appendChild(s);
    this.svg = s;
    this.marks = Array.from({ length: N }, () => {
      const g = document.createElementNS(NS, 'g');
      const back = document.createElementNS(NS, 'path'), fill = document.createElementNS(NS, 'path');
      const d = 'M -20 -78 L 0 -96 L 20 -78 L 12 -78 L 0 -88 L -12 -78 Z';      // a chevron at the top of the ring, pointing out
      back.setAttribute('d', d); back.setAttribute('fill', '#000'); back.setAttribute('opacity', '0.45'); back.setAttribute('transform', 'translate(0 2)');
      fill.setAttribute('d', d);
      g.append(back, fill); g.style.display = 'none';
      s.appendChild(g);
      return { g, fill };
    });
  }

  dispose() { this.svg.remove(); }

  /** @param {THREE.Camera} camera */
  update(dt, camera) {
    const me = this.player, p = me.movement.state.position;
    let n = 0;
    if (!me.health.dead && !me.health.downed) {
      const camYaw = Math.atan2(-camera.matrixWorld.elements[8], -camera.matrixWorld.elements[10]);
      this.world.fightersNear(p, RANGE + 1, (e) => {
        if (n >= N || e === me || e.team === me.team || !e.melee || e.health?.dead || e.isVehicle || e.isDeployable) return;
        const m = e.melee;
        if (m.phase !== MeleePhase.WINDUP || !m.attack) return;
        const q = e.movement.state.position, dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz);
        if (d > Math.min(RANGE, (m.attack.range ?? 2.5) + 2.5) || d < 1e-3) return;
        const fy = e.movement.state.yaw, fx = -Math.sin(fy), fz = -Math.cos(fy);
        if ((fx * dx + fz * dz) / d < 0.6) return;                               // not swinging at us
        const u = Math.min(1, m.phaseTime / Math.max(0.01, m.attack.windup));
        const toSrc = Math.atan2(q.x - p.x, q.z - p.z);
        const k = this.marks[n++];
        k.g.style.display = '';
        k.g.setAttribute('transform', `rotate(${(((camYaw - toSrc) * 180) / Math.PI).toFixed(1)}) scale(${(0.85 + 0.35 * u).toFixed(3)})`);
        k.fill.setAttribute('fill', u > 0.9 ? '#ffffff' : m.attack.unblockable ? '#ff3b30' : '#ffb020');
        k.g.style.opacity = (0.55 + 0.45 * u).toFixed(2);
      });
    }
    for (let i = n; i < N; i++) if (this.marks[i].g.style.display !== 'none') this.marks[i].g.style.display = 'none';
  }
}
