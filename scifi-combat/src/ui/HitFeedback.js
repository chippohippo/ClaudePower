// HitFeedback: what your shots and the hits you take feel like on screen (docs/GAMEPLAY_PLAN.md §1).
//  * Hit markers, at the gun's reticle (where the rounds really go): four ticks on each hit of
//    yours, 90 ms, refreshed per hit with at most one new marker per 50 ms. A kill: bigger, red,
//    180 ms. A headshot: gold. A round the armor shrugs off (damage-matrix multiplier under 0.5):
//    small and grey, so you know to switch weapons or aim elsewhere. A teammate: a blue X.
//  * Damage direction: a red wedge on a ring round the crosshair pointing at whoever hit you (a
//    blast: where it burst), opacity by the damage (20 = 0.4, 80+ = 1), fading over 1.2 s and
//    turning with you, so you know where to look or which way to dive.
//  * Hit flinch: each hit kicks your camera up and toward its source, 0.6° per 20 damage (at most
//    3°), recovering in 120 ms (CameraRig.flinch; the sim nudges the gun's aim by half of it).

import * as THREE from 'three';
import { bus } from '../core/EventBus.js';

const NS = 'http://www.w3.org/2000/svg';
const KIND = {
  hit: { color: '#ffffff', r0: 9, r1: 17, life: 0.09, width: 2.5 },
  head: { color: '#ffd24d', r0: 9, r1: 18, life: 0.11, width: 3 },
  kill: { color: '#ff3b30', r0: 11, r1: 25, life: 0.18, width: 3.5 },
  shrug: { color: '#9a9a9a', r0: 7, r1: 12, life: 0.09, width: 2 },
  friendly: { color: '#4da6ff', r0: 0, r1: 14, life: 0.2, width: 3 },
};
const WEDGES = 6;
const _v = new THREE.Vector3();

export class HitFeedback {
  /**
   * @param {HTMLElement} root  the HUD
   * @param {object} o { player, rig: CameraRig (flinch), world }
   */
  constructor(root, { player, rig = null, world = null }) {
    this.player = player; this.rig = rig; this.world = world;
    this.time = 0;
    const svg = (w, h, style) => { const s = document.createElementNS(NS, 'svg'); s.setAttribute('width', w); s.setAttribute('height', h); s.setAttribute('viewBox', `${-w / 2} ${-h / 2} ${w} ${h}`); s.style.cssText = `position:absolute;left:0;top:0;pointer-events:none;overflow:visible;${style}`; root.appendChild(s); return s; };
    // The marker: four ticks (or an X), redrawn when its kind changes.
    this.marker = svg(80, 80, 'margin:-40px 0 0 -40px;display:none');
    this.ticks = [0, 1, 2, 3].map(() => { const l = document.createElementNS(NS, 'line'); l.setAttribute('stroke-linecap', 'round'); this.marker.appendChild(l); return l; });
    this.mk = { kind: null, until: 0, shown: -1 };
    // The damage ring: wedges pointing at the sources of recent hits.
    this.ring = svg(300, 300, 'left:50%;top:50%;margin:-150px 0 0 -150px');
    this.wedges = Array.from({ length: WEDGES }, () => {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', 'M -26 -112 Q 0 -122 26 -112 L 15 -96 Q 0 -102 -15 -96 Z');   // an arc segment at the top of a 100 px ring
      p.setAttribute('fill', '#ff2a1f'); p.style.opacity = 0;
      this.ring.appendChild(p);
      return { el: p, from: new THREE.Vector3(), t: 9, a: 0 };
    });
    this.next = 0;
    this.off = [
      bus.on('weapon:hit', (e) => { if (e.attacker === player.id) this.#mark(e); }),
      bus.on('melee:hit', (e) => { if (e.attacker === player.id) this.#mark({ killed: e.killed, zone: 'body', armorMul: 1, friendly: e.friendly }); }),
    ];
    // Hits on you: the sim calls the soldier's onHit for every one (any weapon, any blast).
    const prev = player.onHit;
    player.onHit = (res, info, by) => { prev?.call(player, res, info, by); this.#hurt(res, info, by); };
    this.unhook = () => { player.onHit = prev; };
  }

  dispose() { this.off.forEach((f) => f()); this.unhook(); this.marker.remove(); this.ring.remove(); }

  #mark(e) {
    const kind = e.friendly ? 'friendly' : e.killed ? 'kill' : e.zone === 'head' ? 'head' : (e.armorMul ?? 1) < 0.5 ? 'shrug' : 'hit';
    // A kill marker isn't cut short by the next ordinary hit.
    if (this.mk.kind === 'kill' && this.time < this.mk.until && kind !== 'kill') return;
    if (this.time < this.mk.shown + 0.05 && kind === this.mk.kind) { this.mk.until = this.time + KIND[kind].life; return; }
    this.mk.kind = kind; this.mk.shown = this.time; this.mk.until = this.time + KIND[kind].life;
    const K = KIND[kind];
    this.ticks.forEach((l, i) => {
      const a = Math.PI / 4 + (i * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a);
      const r0 = kind === 'friendly' ? -K.r1 : K.r0;                 // an X straight through
      l.setAttribute('x1', (c * r0).toFixed(1)); l.setAttribute('y1', (s * r0).toFixed(1));
      l.setAttribute('x2', (c * K.r1).toFixed(1)); l.setAttribute('y2', (s * K.r1).toFixed(1));
      l.setAttribute('stroke', K.color); l.setAttribute('stroke-width', K.width);
      l.style.display = kind === 'friendly' && i > 1 ? 'none' : '';
    });
  }

  #hurt(res, info, by) {
    const dmg = res?.dealt ?? 0;
    if (!(dmg > 0) || this.player.health.dead) return;
    // Where it came from: the blast's centre, the attacker, or nowhere (a fall, a burn).
    let from = null;
    if (info?.from) from = _v.fromArray(info.from);
    else if (by?.movement && by !== this.player) from = _v.copy(by.movement.state.position);
    if (!from) return;
    const w = this.wedges.reduce((a, b) => (b.t > a.t ? b : a));        // the oldest wedge
    w.from.copy(from); w.t = 0; w.a = Math.min(1, 0.4 + (Math.max(0, dmg - 20) / 60) * 0.6) * (dmg < 20 ? dmg / 20 : 1);
    // The flinch: up, and a little toward the source.
    const me = this.player.movement.state.position, yaw = this.player.movement.state.yaw;
    const toSrc = Math.atan2(-(from.x - me.x), -(from.z - me.z));
    let side = toSrc - yaw; side = Math.atan2(Math.sin(side), Math.cos(side));
    if (!this.player.weapons?.unshaken?.()) this.rig?.flinch(Math.min(3, 0.6 * (dmg / 20)), Math.sign(side) * Math.min(1, Math.abs(side)));   // Unshakable: steady behind the shield
  }

  /** @param {THREE.Camera} camera */
  update(dt, camera) {
    this.time += dt;
    const me = this.player, wc = me.weapons, mp = me.movement.state.position;
    // The marker rides the gun's reticle.
    if (this.time < this.mk.until && !me.health.dead) {
      const W = innerWidth, H = innerHeight;
      let x = W / 2, y = H / 2;
      if (wc && me.mode === 'gun') {
        const cy = Math.cos(wc.aimYaw), sy = Math.sin(wc.aimYaw), cp = Math.cos(wc.aimPitch), sp = Math.sin(wc.aimPitch);
        _v.set(mp.x - sy * cp * 60, mp.y + 1.5 + sp * 60, mp.z - cy * cp * 60).project(camera);
        if (_v.z < 1) { x = (_v.x * 0.5 + 0.5) * W; y = (-_v.y * 0.5 + 0.5) * H; }
      }
      const K = KIND[this.mk.kind], u = 1 - (this.mk.until - this.time) / K.life;
      this.marker.style.display = 'block';
      this.marker.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(1 + (this.mk.kind === 'kill' ? 0.25 : 0.12) * (1 - u)).toFixed(3)})`;
      this.marker.style.opacity = (1 - u * u).toFixed(3);
    } else this.marker.style.display = 'none';
    // Wedges turn with the camera. Angles are atan2(x, z) on the ground; turning right lowers
    // them, so the wedge's clockwise angle on screen is the camera's heading minus the source's.
    const camYaw = Math.atan2(-camera.matrixWorld.elements[8], -camera.matrixWorld.elements[10]);
    for (const w of this.wedges) {
      w.t += dt;
      if (w.t > 1.2) { if (w.el.style.opacity !== '0') w.el.style.opacity = 0; continue; }
      const toSrc = Math.atan2(w.from.x - mp.x, w.from.z - mp.z);
      const rel = camYaw - toSrc;
      w.el.setAttribute('transform', `rotate(${((rel * 180) / Math.PI).toFixed(1)})`);
      w.el.style.opacity = (w.a * (1 - w.t / 1.2) ** 1.5).toFixed(3);
    }
  }
}
