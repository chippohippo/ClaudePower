// sfc32 seeded PRNG. The only randomness source allowed in the sim.
export type RngState = [number, number, number, number];

export function seedRng(seed: number): RngState {
  const s: RngState = [0x9e3779b9, 0x243f6a88, 0xb7e15162, seed >>> 0];
  const rng = new Rng(s);
  for (let i = 0; i < 15; i++) rng.nextU32();
  return rng.state;
}

export class Rng {
  constructor(public state: RngState) {}
  nextU32(): number {
    let [a, b, c, d] = this.state;
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    this.state = [a >>> 0, b, c, d];
    return t;
  }
  /** Float in [0, 1). */
  next(): number { return this.nextU32() / 4294967296; }
  /** Integer in [min, max]. */
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)); }
  chance(p: number): boolean { return this.next() < p; }
}
