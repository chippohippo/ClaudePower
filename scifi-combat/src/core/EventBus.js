// Tiny synchronous event bus. Simulation emits, presentation (VFX/audio/UI/camera) listens.
export class EventBus {
  #handlers = new Map();

  on(type, fn) {
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
    this.#handlers.get(type).add(fn);
    return () => this.#handlers.get(type)?.delete(fn);
  }

  emit(type, payload) {
    this.#handlers.get(type)?.forEach((fn) => fn(payload));
    this.#handlers.get('*')?.forEach((fn) => fn(type, payload));
  }
}

export const bus = new EventBus();
