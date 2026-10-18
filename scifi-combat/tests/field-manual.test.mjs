// The field manual's hints: the one that matters most right now, one at a time and never two close
// together, each at most once a match, and never again once you've done the thing (or seen it
// enough). The briefing and the hints' look are the browser's (FieldManual's DOM).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextHint, wants, HINTS } from '../src/ui/FieldManual.js';

const quiet = { downed: false, mateDown: false, callins: false, vehicle: false, shells: false, lowAmmo: false, dig: false, capture: false };
const at = (t, o = {}) => ({ ...quiet, t, ...o });

test('the hint that matters most right now, once the briefing\'s had its time', () => {
  const S = {}, M = new Set();
  assert.equal(nextHint(at(5), S, M, -1e9), null, 'nothing yet: the briefing is up');
  assert.equal(nextHint(at(20), S, M, -1e9), 'ping', 'then: ping your squad');
  assert.equal(nextHint(at(20, { downed: true, mateDown: true }), S, M, -1e9), 'downed', 'being downed comes first');
  assert.equal(nextHint(at(20, { mateDown: true }), S, M, -1e9), 'revive');
  assert.equal(nextHint(at(30, { callins: true }), S, M, -1e9), 'ping', 'call-ins only after 40 s');
  assert.equal(nextHint(at(50, { callins: true }), S, M, -1e9), 'callin');
  assert.equal(nextHint(at(130), S, new Set(['ping']), -1e9), 'score', 'the scoreboard after two minutes');
});

test('one at a time: none within 14 s of the last; each once a match', () => {
  const S = {}, M = new Set(['ping']);
  assert.equal(nextHint(at(30, { mateDown: true }), S, M, 20), null, 'too soon after the last');
  assert.equal(nextHint(at(35, { mateDown: true }), S, M, 20), 'revive');
  assert.equal(nextHint(at(60), S, M, -1e9), null, 'ping was shown this match');
});

test('learned, or seen enough: never again', () => {
  assert.ok(!wants({ ping: { learned: true } }, 'ping', new Set()), 'you pinged: no more ping hints');
  assert.ok(wants({ ping: { seen: 2 } }, 'ping', new Set()));
  assert.ok(!wants({ ping: { seen: 3 } }, 'ping', new Set()), 'three times is enough');
  assert.ok(!wants({ downed: { seen: 2 } }, 'downed', new Set()), 'being downed: twice');
  for (const [id, H] of Object.entries(HINTS)) assert.ok(H.text.length > 20 && Array.isArray(H.keys), `${id} says something`);
});
