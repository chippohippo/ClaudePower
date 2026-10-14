// Legend voice callouts (Apex-style comms) through the system speech engine (Web Speech API; Windows,
// macOS and most Linux desktops ship voices). Each legend gets its own pitch and pace. Lines are
// throttled and never stack, so a busy fight produces a few clear calls instead of chatter.
// Settings → "Voice callouts" turns them off.

import { settings } from './input.js';

const LEGEND_VOICE = {
  jolt: { pitch: 1.25, rate: 1.15 }, phantom: { pitch: 0.85, rate: 0.95 }, halo: { pitch: 1.15, rate: 1.0 },
  bastion: { pitch: 0.6, rate: 0.9 }, echo: { pitch: 1.05, rate: 1.0 }, miasma: { pitch: 0.7, rate: 0.85 },
  volt: { pitch: 1.1, rate: 1.1 }, spectre: { pitch: 0.95, rate: 1.05 }, kodiak: { pitch: 0.75, rate: 0.95 },
};

const synth = typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis : null;
let voices = [];
const loadVoices = () => { voices = synth ? synth.getVoices().filter((v) => /^en/i.test(v.lang)) : []; };
if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }

let lastAt = 0;
const recent = new Map(); // line → time, so the same call isn't repeated back to back

// Speak a callout. priority lines (knocks, "I'm down") cut in; others wait for silence.
export function say(text, legend = 'jolt', { priority = false } = {}) {
  if (!synth || settings.voice === false || !text) return;
  const now = performance.now();
  if ((recent.get(text) || 0) > now - 4000) return;
  if (!priority && (synth.speaking || now - lastAt < 900)) return;
  if (priority) synth.cancel();
  recent.set(text, now);
  lastAt = now;
  const u = new SpeechSynthesisUtterance(text);
  const v = LEGEND_VOICE[legend] || LEGEND_VOICE.jolt;
  u.pitch = v.pitch; u.rate = v.rate;
  u.volume = Math.min(1, (settings.volume ?? 0.8) * 1.1);
  // a stable voice per legend when several are installed
  if (voices.length) u.voice = voices[Object.keys(LEGEND_VOICE).indexOf(legend) % voices.length] || voices[0];
  synth.speak(u);
}

// What a ping says, by kind (+ the item label for loot pings).
export function pingLine(k, label, mine) {
  switch (k) {
    case 'enemy': return 'Enemy spotted!';
    case 'danger': return 'Enemy was here.';
    case 'loot': return label ? `${label} over here.` : 'Loot over here.';
    case 'going': return mine ? "I'm going here." : 'Going over here.';
    case 'drop': return 'Supply drop, gold loot!';
    default: return "Let's go here.";
  }
}
