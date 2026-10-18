// Tiny synchronous event bus. Simulation emits, presentation (VFX/audio/UI/camera) listens.
export class EventBus {
  #handlers = new Map();
  #hushed = 0;

  /** Runs fn with nothing heard: a rehearsal off stage (the simulation warming up at load). */
  hush(fn) { this.#hushed++; try { return fn(); } finally { this.#hushed--; } }

  on(type, fn) {
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
    this.#handlers.get(type).add(fn);
    return () => this.#handlers.get(type)?.delete(fn);
  }

  emit(type, payload) {
    if (this.#hushed) return;
    this.#handlers.get(type)?.forEach((fn) => fn(payload));
    this.#handlers.get('*')?.forEach((fn) => fn(type, payload));
  }
}

export const bus = new EventBus();
