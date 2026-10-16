// Fixed-timestep simulation with interpolated rendering ("Fix Your Timestep").
// sim(dt, tick) runs at a constant rate; render(alpha) gets the blend factor between ticks.
export class FixedLoop {
  constructor({ hz = 60, sim, render, maxFrame = 0.25 }) {
    this.dt = 1 / hz;
    this.sim = sim;
    this.render = render;
    this.maxFrame = maxFrame; // avoid spiral of death after tab-switch
    this.acc = 0;
    this.tick = 0;
    this.last = 0;
    this.running = false;
  }

  start() {
    this.running = true;
    this.last = performance.now() / 1000;
    const frame = () => {
      if (!this.running) return;
      const now = performance.now() / 1000;
      this.acc += Math.min(now - this.last, this.maxFrame);
      this.last = now;
      while (this.acc >= this.dt) {
        this.sim(this.dt, this.tick++);
        this.acc -= this.dt;
      }
      this.render(this.acc / this.dt, now);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  stop() { this.running = false; }
}
