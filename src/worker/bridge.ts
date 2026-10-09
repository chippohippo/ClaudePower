// Main-thread side of the worker bridge.
import type { FromWorker, ToWorker } from "./protocol";

export function createSimBridge(onMessage: (m: FromWorker) => void) {
  const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<FromWorker>) => onMessage(e.data);
  return { send: (m: ToWorker) => worker.postMessage(m), terminate: () => worker.terminate() };
}
