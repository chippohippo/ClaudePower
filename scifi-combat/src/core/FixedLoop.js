// Fixed-timestep simulation with interpolated rendering ("Fix Your Timestep").
// sim(dt, tick) runs at a constant rate; render(alpha) gets the blend factor between ticks.
// A computer that can't keep up runs the battle in slow motion rather than freezing: at most
// maxSteps ticks per frame, and time it couldn't simulate is dropped (no spiral of death, where
// each frame owes more ticks than the last). Paused (the options menu), it keeps drawing frames
// but runs no ticks and owes none when it resumes.
export class FixedLoop {
  constructor({ hz = 60, sim, render, maxFrame = 0.25, maxSteps = 4 }) {
    this.dt = 1 / hz;
    this.sim = sim;
    this.render = render;
    this.maxFrame = maxFrame; // avoid spiral of death after tab-switch
    this.maxSteps = maxSteps;
    this.behind = 0;          // frames in a row that hit maxSteps (the computer is falling behind)
    this.acc = 0;
    this.tick = 0;
    this.last = 0;
    this.running = false;
    this.paused = false;
  }

  start() {
    this.running = true;
    this.last = performance.now() / 1000;
    const frame = () => {
      if (!this.running) return;
      const now = performance.now() / 1000;
      this.acc += Math.min(now - this.last, this.maxFrame);
      this.last = now;
      if (this.paused) { this.acc = 0; this.behind = 0; this.render(1, now); requestAnimationFrame(frame); return; }
      let steps = 0;
      while (this.acc >= this.dt && steps < this.maxSteps) {
        this.sim(this.dt, this.tick++);
        this.acc -= this.dt;
        steps++;
      }
      if (this.acc >= this.dt) { this.acc %= this.dt; this.behind++; } else this.behind = 0;
      this.render(this.acc / this.dt, now);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  stop() { this.running = false; }
}
