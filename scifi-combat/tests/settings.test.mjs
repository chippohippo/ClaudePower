// The options: presets set the whole graphics group, tuning any of it reads CUSTOM, the URL's fx
// overrides for one run, and with no storage (a private window) everything still has a value.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, PRESETS, GRAPHICS_KEYS, loadSettings, applyPreset, presetOf, withUrlOverrides } from '../src/ui/Settings.js';

test('settings: defaults without storage, presets cover the whole graphics group, tuning reads custom', () => {
  const s = loadSettings();
  assert.deepEqual(s, DEFAULTS, 'no storage: the defaults');
  assert.equal(presetOf(s), 'high', 'the defaults are the high preset');
  for (const [name, p] of Object.entries(PRESETS)) {
    for (const k of GRAPHICS_KEYS) assert.ok(k in p, `${name} sets ${k}`);
    const t = applyPreset({ ...DEFAULTS }, name);
    assert.equal(t.preset, name);
    assert.equal(presetOf(t), name, `${name} reads back as ${name}`);
  }
  // Each step down costs less: a smaller image, fewer samples, fewer effects.
  const order = ['ultra', 'high', 'medium', 'low'], cost = (p) => p.renderScale * (p.hiDpi ? 2 : 1) * (1 + p.aa / 4) * (1 + ['shadows', 'bloom', 'rays', 'particles'].filter((k) => p[k]).length / 4);
  for (let i = 1; i < order.length; i++) assert.ok(cost(PRESETS[order[i]]) < cost(PRESETS[order[i - 1]]), `${order[i]} is lighter than ${order[i - 1]}`);
  const t = applyPreset({ ...DEFAULTS }, 'medium');
  t.renderScale = 0.6;
  assert.equal(presetOf(t), 'custom', 'tuned by hand: custom');
  t.fov = 90;
  t.renderScale = PRESETS.medium.renderScale;
  assert.equal(presetOf(t), 'medium', 'camera and audio options are not part of a preset');
});

test('settings: ?fx=low runs the low preset, ?fx=off drops post-processing, without touching what is saved', () => {
  const saved = applyPreset({ ...DEFAULTS }, 'ultra');
  const low = withUrlOverrides({ ...saved }, new URLSearchParams('fx=low'));
  assert.equal(low.preset, 'low');
  assert.equal(low.renderScale, PRESETS.low.renderScale);
  assert.equal(low.postOff, false);
  const off = withUrlOverrides({ ...saved }, new URLSearchParams('fx=off'));
  assert.equal(off.postOff, true);
  assert.equal(off.preset, 'ultra', 'fx=off keeps the rest');
  const plain = withUrlOverrides({ ...saved }, new URLSearchParams(''));
  assert.equal(plain.preset, 'ultra');
  assert.equal(saved.preset, 'ultra', 'the saved settings are not changed');
});
