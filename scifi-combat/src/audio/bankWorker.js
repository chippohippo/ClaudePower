// bankWorker: renders the SoundBank's sounds off the main thread, in the order they're asked for,
// and sends each back with its samples transferred (not copied). SoundEngine runs it.

import { render, variantsOf } from './SoundBank.js';

let sr = 48000, busy = false;
const queue = [];

onmessage = (e) => {
  const m = e.data;
  if (m.sr) sr = m.sr;
  if (m.ids) queue.push(...m.ids);
  if (!busy) pump();
};

function pump() {
  const id = queue.shift();
  if (!id) { busy = false; return; }
  busy = true;
  const variants = [];
  for (let v = 0; v < variantsOf(id); v++) variants.push(render(id, v, sr));
  const transfer = new Set();
  for (const o of variants) for (const ch of o.ch) transfer.add(ch.buffer);
  postMessage({ id, variants }, [...transfer]);
  setTimeout(pump, 0);
}
