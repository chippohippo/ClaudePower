// Ambience: each map's atmosphere, alive. Its beds play together, each drifting in level on its own
// (they never line up the same way twice); its spots (a gust, a siren, steel groaning, a fire
// flaring, an aircraft going over) come at random from round you, each kind on its own clock; and
// the war beyond the map goes on: barrages walking along the horizon, machine guns, single blasts,
// rockets, from far off in every direction, all through the map's room (louder on a cold night,
// when sound carries). Everything here is the bed of the mix: the battle near you ducks it, and
// what it would only add mush to isn't played.

/** Per map: the beds ([id, level]) and the war beyond it (each kind's interval s, distance m, level). */
export const MAPS = {
  trench: {
    beds: [['amb:trench:wind', 0.85], ['amb:trench:front', 0.8], ['amb:trench:ash', 0.5]],
    war: { barrage: [14, 32], burst: [6, 14], blast: [8, 18], rockets: [35, 80], dist: [800, 2400], gain: 1 },
  },
  city: {
    beds: [['amb:city:wind', 0.8], ['amb:city:hum', 0.8], ['amb:city:snow', 0.6]],
    war: { barrage: [35, 70], burst: [9, 22], blast: [14, 30], rockets: null, dist: [600, 1800], gain: 0.8 },
  },
  night: {
    beds: [['amb:night:air', 0.85], ['amb:night:hum', 0.8], ['amb:night:sing', 0.6]],
    war: { barrage: [30, 60], burst: [7, 16], blast: [12, 26], rockets: null, dist: [700, 2200], gain: 1.15 },
  },
};
export const mapOf = (environment) => (MAPS[environment] ? environment : environment === 'open' ? 'trench' : 'city');

const between = ([a, b], r = Math.random) => a + (b - a) * r();

export class Ambience {
  /**
   * @param {SoundEngine} engine
   * @param {string} map 'trench' | 'city' | 'night'
   * @param {object} o { rand: () => 0..1 (seeded in tests), gain }
   */
  constructor(engine, map, { rand = Math.random, gain = 1 } = {}) {
    this.E = engine; this.map = mapOf(map); this.M = MAPS[this.map]; this.rand = rand; this.gain = gain;
    this.time = 0;
    this.beds = this.M.beds.map(([id, level], i) => ({ id, level, key: `amb:${i}`, drift: 1, next: 0 }));
    this.spots = null;                    // (from the manifest, once it's in)
    this.war = Object.fromEntries(['barrage', 'burst', 'blast', 'rockets'].filter((k) => this.M.war[k]).map((k) => [k, { every: this.M.war[k], next: between(this.M.war[k], rand) * 0.5 }]));
    this.queue = [];                      // the war's sounds still to come: { at, id, pos, kind, gain }
  }

  dispose() { for (const b of this.beds) this.E.stopLoop(b.key, 0.5); }

  /** The spots this map has (the forge's manifest says where each belongs and how often it comes). */
  #spots() {
    const M = this.E.manifest;
    if (!M) return null;
    const out = [];
    for (const [id, e] of Object.entries(M)) if (e.kind === 'spot' && e.spot?.maps?.includes(this.map)) out.push({ id, ...e.spot, next: between(e.spot.every, this.rand) * 0.6 });
    return out;
  }

  /** A point `d` m from you in a random direction (or round `bearing`), at ground level. */
  #around(d, bearing = null) {
    const L = this.E.listener, a = bearing ?? this.rand() * Math.PI * 2;
    return { x: L.x + Math.sin(a) * d, y: L.y - 1.5, z: L.z + Math.cos(a) * d };
  }

  update(dt) {
    const E = this.E;
    if (!E.running) return;
    this.time += dt;
    const t = this.time, r = this.rand;
    // The beds: started when their recordings are in, then each wandering in level over seconds.
    for (const b of this.beds) {
      if (!E.hasLoop(b.key)) { E.loop(b.key, b.id, { amb: true, gain: b.level * this.gain }); continue; }
      if (t < b.next) continue;
      b.next = t + 4 + r() * 6;
      b.drift = Math.max(0.55, Math.min(1, b.drift + (r() - 0.5) * 0.35));
      E.updateLoop(b.key, { gain: b.level * b.drift * this.gain }, 4);
    }
    // The spots: each kind on its own clock, from somewhere round you.
    this.spots ??= this.#spots();
    for (const s of this.spots ?? []) {
      if (t < s.next) continue;
      s.next = t + between(s.every, r);
      E.play(s.id, { pos: this.#around(between(s.dist, r)), kind: 'spot', gain: s.gain * this.gain, amb: true, jitter: 0.04 });
    }
    // The war beyond the map.
    const W = this.M.war;
    for (const [kind, w] of Object.entries(this.war)) {
      if (t < w.next) continue;
      w.next = t + between(w.every, r);
      this.#war(kind, between(W.dist, r), r() * Math.PI * 2, W.gain * this.gain);
    }
    while (this.queue.length && this.queue[0].at <= t) {
      const q = this.queue.shift();
      E.play(q.id, { pos: q.pos, kind: 'war', gain: q.gain, amb: true, occlude: false });
    }
  }

  /** One event of the war beyond the map, queued as the sounds it's made of. */
  #war(kind, d, bearing, gain) {
    const r = this.rand, add = (dt, id, g, spread = 0.12, dd = 0) => this.queue.push({ at: this.time + dt, id, pos: this.#around(d + dd, bearing + (r() - 0.5) * spread), gain: gain * g });
    if (kind === 'barrage') {
      // A battery walking its rounds along a line: shells landing a second apart, a few together.
      const n = 4 + Math.floor(r() * 6), size = r() < 0.3 ? 'bomb' : 'shell';
      let at = 0;
      for (let i = 0; i < n; i++) { at += 0.25 + r() * 1.1; add(at, `boom:${size}:near`, 0.8 + r() * 0.4, 0.3, (r() - 0.5) * 200); }
    } else if (kind === 'burst') {
      // A machine gun or a rifle section: a burst or two.
      const id = r() < 0.5 ? 'gun:hmg:near' : r() < 0.5 ? 'gun:ar_void:near' : 'gun:ar_sol:near', gap = 0.075 + r() * 0.05;
      const bursts = 1 + Math.floor(r() * 3);
      let at = 0;
      for (let b = 0; b < bursts; b++) {
        const n = 3 + Math.floor(r() * 9);
        for (let i = 0; i < n; i++) { add(at, id, 0.9, 0.02); at += gap * (0.9 + r() * 0.2); }
        at += 0.4 + r() * 1.2;
      }
    } else if (kind === 'blast') add(0, `boom:${r() < 0.5 ? 'vehicle' : 'shell'}:near`, 1);
    else if (kind === 'rockets') {
      const n = 6 + Math.floor(r() * 8);
      for (let i = 0; i < n; i++) add(i * (0.12 + r() * 0.08), 'report:rocket', 0.7, 0.05);
      for (let i = 0; i < n; i++) add(6 + i * (0.15 + r() * 0.2), 'boom:shell:near', 0.8, 0.35, 300 + (r() - 0.5) * 300);
    }
    this.queue.sort((a, b) => a.at - b.at);
  }
}
