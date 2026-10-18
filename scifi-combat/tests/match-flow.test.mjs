// Match flow: the scoreboard's numbers (MatchStats, read off the battle points' ledger), ribbons as
// they're earned, the after-action report's facts, and the career a match goes into (Career.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bus } from '../src/core/EventBus.js';
import { FrontlineSession } from '../src/game/FrontlineSession.js';
import { RIBBONS } from '../src/game/MatchStats.js';
import { emptyCareer, loadCareer, saveCareer, recordMatch, rankOf, xpFor, RANKS, medalFor, XP } from '../src/game/Career.js';
import { data as H } from './harness.mjs';

const DATA = {
  movement: H.movement, weaponFiles: [H.ballistic, H.energy], attachments: H.attachments, recoil: H.recoil, statuses: H.statuses,
  meleeWeapons: H.melee, kits: H.kits, classes: H.classes, damageMatrix: H.matrix, supers: H.supers, vehicleDefs: H.vehicles,
  personalities: H.ai.personalities, difficulty: H.ai.difficulty.veteran, down: H.down, barks: H.barks, stratagems: H.stratagems,
  battlePoints: H.battlePoints, rules: H.rules, passives: H.passives, support: H.support,
};
const run = (S, seconds) => { for (let i = 0; i < Math.round(seconds * 60); i++) S.step(1 / 60); };

test('the board: every soldier of both sides on it from the start, scored off exactly the battle points he earns', () => {
  const S = new FrontlineSession(DATA, { size: '12v12', seed: 3, map: 'trench' });
  const M = S.match;
  const soldiers = S.fighters.filter((f) => !f.offField && (f.team === 0 || f.team === 1));
  assert.equal(M.lines.size, soldiers.length, 'everyone listed before anyone scores');
  // The ledger kept independently: what each soldier earned, his takedowns, his deaths.
  const score = new Map(), kills = new Map(), deaths = new Map();
  const off = [
    bus.on('bp:earn', (e) => { if (!M.lines.has(e.id)) return; score.set(e.id, Math.max(0, (score.get(e.id) ?? 0) + e.amount)); if (e.why === 'kill') kills.set(e.id, (kills.get(e.id) ?? 0) + 1); }),
    bus.on('entity:death', (e) => { if (M.lines.has(e.id)) deaths.set(e.id, (deaths.get(e.id) ?? 0) + 1); }),
  ];
  run(S, 120);
  off.forEach((f) => f());
  for (const l of M.lines.values()) {
    assert.equal(l.score, score.get(l.id) ?? 0, `${l.name}'s score`);
    assert.equal(l.kills, kills.get(l.id) ?? 0, `${l.name}'s kills`);
    assert.equal(l.deaths, deaths.get(l.id) ?? 0, `${l.name}'s deaths`);
  }
  const all = [...M.lines.values()];
  assert.ok(all.some((l) => l.kills > 0) && all.some((l) => l.deaths > 0), 'two minutes of fighting on the board');
  for (const t of [0, 1]) {
    const b = M.board(t);
    assert.ok(b.every((l) => l.team === t));
    for (let i = 1; i < b.length; i++) assert.ok(b[i - 1].score >= b[i].score, 'best score first');
  }
  assert.ok(M.tickets.length >= 8, 'tickets sampled every 15 s');
  S.dispose();
});

test('ribbons: one each time a count reaches another step in the match, announced as earned', () => {
  const S = new FrontlineSession(DATA, { size: '4v4', seed: 2, map: 'trench' });
  const me = S.fighters.find((f) => f.team === 0 && !f.offField);
  const got = [];
  const off = bus.on('ribbon:earn', (e) => { if (e.id === me.id) got.push(e); });
  for (let i = 0; i < 9; i++) bus.emit('bp:earn', { id: me.id, why: 'kill', amount: 100, points: 0 });
  for (let i = 0; i < 3; i++) bus.emit('bp:earn', { id: me.id, why: 'revive', amount: 150, points: 0 });
  bus.emit('bp:earn', { id: me.id, why: 'resupply', amount: 200, points: 0 });
  off();
  const L = S.match.line(me);
  assert.deepEqual(got.map((e) => `${e.ribbon}:${e.count}`), ['combat:1', 'combat:2', 'medic:1'], '4 and 8 kills, 3 revives; not yet 300 support');
  assert.deepEqual(L.ribbons, { combat: 2, medic: 1 });
  assert.equal(L.score, 9 * 100 + 3 * 150 + 200);
  assert.equal(L.support, 200);
  for (const R of Object.values(RIBBONS)) assert.ok(R.name && R.desc && R.every > 0 && R.of, 'every ribbon named, explained and counted');
  S.dispose();
});

test('the after-action report: who won and how, both boards and their MVPs, your line and place, the story', () => {
  const S = new FrontlineSession(DATA, { size: '4v4', seed: 5, map: 'trench' });
  const M = S.match, mode = S.mode;
  const me = S.fighters.find((f) => f.team === 0 && !f.offField);
  bus.emit('bp:earn', { id: me.id, why: 'capture', amount: 200, points: 0 });
  run(S, 20);
  mode.tickets[1] = 1; mode.onDeath(1);   // they run out
  const rep = M.report(me.id);
  assert.equal(rep.winner, 0); assert.equal(rep.reason, 'tickets');
  assert.equal(rep.boards[0][0], rep.mvp[0], 'the MVP is the top of the board');
  assert.ok(rep.me === M.line(me) && rep.place === rep.boards[0].indexOf(rep.me) + 1 && rep.place >= 1);
  assert.ok(rep.samples.length >= 2 && rep.samples.at(-1).tickets[1] === 0, 'the tickets to the end');
  assert.ok(rep.duration >= 20);
  S.dispose();
});

test('career: ranks rise with experience, ten grades of three; nothing past the top', () => {
  assert.equal(RANKS.length, 30);
  assert.equal(RANKS[0], 'Recruit I'); assert.equal(RANKS[29], 'Marshal III');
  for (let r = 1; r <= 30; r++) {
    assert.equal(rankOf(xpFor(r)).rank, r, `rank ${r} at its threshold`);
    if (r > 1) assert.equal(rankOf(xpFor(r) - 1).rank, r - 1, 'and not a point before');
    if (r > 1) assert.ok(xpFor(r) - xpFor(r - 1) > xpFor(r - 1) - xpFor(Math.max(1, r - 2)) || r === 2, 'each rank takes longer');
  }
  const top = rankOf(1e9);
  assert.equal(top.rank, 30); assert.equal(top.span, 0);
});

test('career: a match\'s experience (score, seeing it through, the win, ribbons, MVP), totals, medals, the last ten', () => {
  const c = emptyCareer();
  c.ribbons.combat = 9;   // one short of bronze
  const line = { team: 0, classId: 'lancer', score: 2400, kills: 11, deaths: 4, assists: 3, revives: 1, captures: 2, vehicles: 0, ribbons: { combat: 2, objective: 1 } };
  const r = recordMatch(c, line, { won: true, mvp: true, meta: { map: 'trench', size: '32v32', at: 1 } });
  assert.deepEqual(r.xp, { score: 2400, finish: XP.finish, win: XP.win, ribbons: 3 * XP.ribbon, mvp: XP.mvp, total: 2400 + XP.finish + XP.win + 3 * XP.ribbon + XP.mvp });
  assert.equal(c.xp, r.xp.total);
  assert.equal(r.before.rank, 1); assert.ok(r.after.rank > 1, 'a good first match ranks you up');
  assert.deepEqual(r.medals, [{ ribbon: 'combat', medal: 'Bronze' }], 'the tenth combat ribbon: bronze');
  assert.equal(medalFor(c.ribbons.combat), 'Bronze'); assert.equal(medalFor(49), 'Bronze'); assert.equal(medalFor(50), 'Silver');
  assert.deepEqual([c.matches, c.wins, c.losses, c.kills, c.deaths, c.mvps], [1, 1, 0, 11, 4, 1]);
  assert.equal(c.classes.lancer.matches, 1);
  // A loss: no win bonus; still the experience for seeing it through.
  const r2 = recordMatch(c, { ...line, score: 0, ribbons: {} }, { won: false });
  assert.equal(r2.xp.total, XP.finish);
  assert.equal(c.losses, 1);
  for (let i = 0; i < 12; i++) recordMatch(c, line, { won: true });
  assert.equal(c.history.length, 10, 'the last ten matches');
  assert.equal(c.matches, 14);
});

test('career: saved and read back; an unreadable save starts a new one', () => {
  const store = new Map();
  const S = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const c = loadCareer(S);
  assert.deepEqual(c, emptyCareer(), 'nothing saved: a new career');
  recordMatch(c, { score: 900, ribbons: {} }, { won: true });
  saveCareer(c, S);
  assert.deepEqual(loadCareer(S), c);
  store.set('emberfall.career', '{not json');
  assert.deepEqual(loadCareer(S), emptyCareer());
  assert.deepEqual(loadCareer(null), emptyCareer(), 'no storage at all (a private window)');
});
