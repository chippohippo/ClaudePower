// Player progression, stored locally (localStorage 'skyfall.profile'):
//   - XP and account level from every match (kills, knocks, damage, revives, respawns, survival,
//     placement), plus per-legend mastery
//   - 3 daily and 4 weekly challenges with XP rewards
//   - Ranked: RP with tiers, an entry cost per tier, placement and kill points (Apex-style)
// It also picks the offline lobby's bot difficulty from your level / rank.

import { LEGENDS } from '../shared/legends.js';

const KEY = 'skyfall.profile';

export const TIERS = [
  { name: 'Rookie', rp: 0, cost: 0, color: '#9aa3ad' },
  { name: 'Bronze', rp: 1000, cost: 10, color: '#c47a3c' },
  { name: 'Silver', rp: 3000, cost: 20, color: '#c9d1d9' },
  { name: 'Gold', rp: 5400, cost: 35, color: '#ffd23f' },
  { name: 'Platinum', rp: 8200, cost: 45, color: '#5fd3d0' },
  { name: 'Diamond', rp: 11400, cost: 55, color: '#7ab8ff' },
  { name: 'Master', rp: 15000, cost: 65, color: '#c77dff' },
  { name: 'Predator', rp: 20000, cost: 75, color: '#ff4d4d' },
];
export const tierOf = (rp) => { let t = 0; TIERS.forEach((x, i) => { if (rp >= x.rp) t = i; }); return t; };

// XP needed to go from `level` to `level + 1`
export const xpForLevel = (level) => 1200 + level * 150;

const CHALLENGES = [
  { id: 'kills', desc: 'Get {n} kills', stat: 'kills', d: [3, 5], w: [15, 25] },
  { id: 'knocks', desc: 'Knock down {n} enemies', stat: 'knocks', d: [4, 6], w: [20] },
  { id: 'damage', desc: 'Deal {n} damage', stat: 'damage', d: [1500, 2500], w: [8000, 12000] },
  { id: 'revives', desc: 'Revive squadmates {n} times', stat: 'revives', d: [2, 3], w: [8] },
  { id: 'respawns', desc: 'Respawn {n} squadmates', stat: 'respawns', d: [1], w: [4] },
  { id: 'top5', desc: 'Finish in the top 5 {n} times', stat: 'top5', d: [2], w: [6] },
  { id: 'wins', desc: 'Win {n} matches', stat: 'wins', d: [1], w: [3] },
  { id: 'survive', desc: 'Survive {n} minutes in total', stat: 'minutes', d: [20, 30], w: [90] },
  { id: 'tank', desc: 'Play {n} matches as a Tank', stat: 'tank', d: [2], w: [6] },
  { id: 'dps', desc: 'Play {n} matches as a DPS', stat: 'dps', d: [2], w: [6] },
  { id: 'support', desc: 'Play {n} matches as a Support', stat: 'support', d: [2], w: [6] },
];

const today = () => new Date().toISOString().slice(0, 10);
const week = () => { const d = new Date(); const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return `${t.getUTCFullYear()}-W${Math.ceil(((t - y) / 864e5 + 1) / 7)}`; };
// seeded pick so everyone gets the same set on the same day
const seeded = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296; };
function rollChallenges(seed, count, kind, reward) {
  const r = seeded(seed), pool = CHALLENGES.slice(), out = [];
  while (out.length < count && pool.length) {
    const c = pool.splice(Math.floor(r() * pool.length), 1)[0];
    const ns = c[kind];
    const n = ns[Math.floor(r() * ns.length)];
    out.push({ id: c.id, stat: c.stat, desc: c.desc.replace('{n}', n.toLocaleString()), goal: n, prog: 0, xp: reward, done: false });
  }
  return out;
}

function fresh() {
  return { xp: 0, level: 1, legends: {}, ranked: false, rp: 0, matches: 0, wins: 0, kills: 0, daily: null, weekly: null, last: null };
}

export function loadProfile() {
  let p;
  try { p = { ...fresh(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { p = fresh(); }
  if (!p.daily || p.daily.date !== today()) p.daily = { date: today(), list: rollChallenges('d' + today(), 3, 'd', 1500) };
  if (!p.weekly || p.weekly.week !== week()) p.weekly = { week: week(), list: rollChallenges('w' + week(), 4, 'w', 5000) };
  return p;
}
export function saveProfile(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ } }

// Offline lobby difficulty: grows with account level, and with rank in ranked.
export function botSkillFor(p) {
  if (p.ranked) return Math.min(0.95, 0.35 + tierOf(p.rp) * 0.08);
  return Math.min(0.75, 0.3 + (p.level - 1) / 80);
}

const PLACE_RP = (place, squads) => {
  const k = (place - 1) / Math.max(1, squads - 1); // 0 = winner … 1 = first out
  if (place === 1) return 125;
  if (k <= 0.07) return 95;
  if (k <= 0.12) return 70;
  if (k <= 0.2) return 50;
  if (k <= 0.33) return 30;
  if (k <= 0.5) return 15;
  return 0;
};

// Records one finished match; returns a summary for the end screen.
export function recordMatch(p, s, place, win) {
  const lines = [];
  const add = (label, xp) => { if (xp > 0) lines.push({ label, xp: Math.round(xp) }); };
  add(`Kills ×${s.kills}`, s.kills * 100);
  add(`Knocks ×${s.knocks}`, s.knocks * 50);
  add(`Damage ${s.damage}`, s.damage * 0.5);
  add(`Revives ×${s.revives}`, s.revives * 80);
  add(`Respawns ×${s.respawns}`, s.respawns * 120);
  add(`Survived ${Math.floor(s.survived / 60)}:${String(s.survived % 60).padStart(2, '0')}`, s.survived * 2);
  const squads = s.squads || 33;
  const top5 = place <= 5, top10 = place <= 10;
  add(win ? 'Champions' : top5 ? 'Top 5' : top10 ? 'Top 10' : '', win ? 1500 : top5 ? 600 : top10 ? 300 : 0);

  // challenges
  const role = LEGENDS[s.legend] ? LEGENDS[s.legend].cls : null;
  const stat = { kills: s.kills, knocks: s.knocks, damage: s.damage, revives: s.revives, respawns: s.respawns, top5: top5 ? 1 : 0, wins: win ? 1 : 0, minutes: s.survived / 60, tank: role === 'tank' ? 1 : 0, dps: role === 'dps' ? 1 : 0, support: role === 'support' ? 1 : 0 };
  const completed = [];
  for (const c of [...p.daily.list, ...p.weekly.list]) {
    if (c.done) continue;
    c.prog = Math.min(c.goal, c.prog + (stat[c.stat] || 0));
    if (c.prog >= c.goal) { c.done = true; completed.push(c); add(`Challenge: ${c.desc}`, c.xp); }
  }

  const gained = lines.reduce((n, l) => n + l.xp, 0);
  const before = { level: p.level, xp: p.xp };
  p.xp += gained;
  while (p.xp >= xpForLevel(p.level)) { p.xp -= xpForLevel(p.level); p.level++; }
  const L = (p.legends[s.legend] ||= { xp: 0, games: 0, kills: 0 });
  L.xp += gained; L.games++; L.kills += s.kills;
  p.matches++; p.kills += s.kills; if (win) p.wins++;

  // ranked
  let rank = null;
  if (p.ranked) {
    const t0 = tierOf(p.rp);
    const cost = TIERS[t0].cost;
    const placeRp = PLACE_RP(place, squads);
    const mult = 1 + Math.max(0, 0.6 - ((place - 1) / Math.max(1, squads - 1)) * 1.2); // kills count more the deeper you go
    const killRp = Math.round(Math.min(6, s.kills + s.knocks * 0.5) * 12 * mult);
    const delta = placeRp + killRp - cost;
    p.rp = Math.max(0, p.rp + delta);
    const t1 = tierOf(p.rp);
    rank = { cost, placeRp, killRp, delta, rp: p.rp, tier: TIERS[t1], promoted: t1 > t0, demoted: t1 < t0 };
  }
  p.last = { at: Date.now(), place, win, gained };
  saveProfile(p);
  return { lines, gained, before, level: p.level, xp: p.xp, need: xpForLevel(p.level), completed, rank };
}

// HTML for the end screen
export function summaryHtml(r) {
  const up = r.level > r.before.level;
  const rows = r.lines.map((l) => `<div class="xprow"><span>${l.label}</span><b>+${l.xp.toLocaleString()} XP</b></div>`).join('');
  const bar = `<div class="xpbar"><i style="width:${Math.round((r.xp / r.need) * 100)}%"></i></div>`;
  const rank = r.rank ? `<div class="rankrow" style="color:${r.rank.tier.color}">RANKED · ${r.rank.tier.name.toUpperCase()} · ${r.rank.rp.toLocaleString()} RP <b>${r.rank.delta >= 0 ? '+' : ''}${r.rank.delta}</b><small>placement +${r.rank.placeRp} · kills +${r.rank.killRp} · entry −${r.rank.cost}</small>${r.rank.promoted ? '<em>PROMOTED!</em>' : r.rank.demoted ? '<em>DEMOTED</em>' : ''}</div>` : '';
  const ch = r.completed.length ? `<div class="chdone">${r.completed.map((c) => `✔ ${c.desc}`).join('<br>')}</div>` : '';
  return `<div class="xpsum">${rows}<div class="xptotal">TOTAL +${r.gained.toLocaleString()} XP</div><div class="lvl">${up ? `<em>LEVEL UP!</em> ` : ''}LEVEL ${r.level}</div>${bar}${rank}${ch}</div>`;
}

// HTML for the menu's profile card
export function profileHtml(p) {
  const t = TIERS[tierOf(p.rp)];
  const ch = (list) => list.map((c) => `<div class="ch${c.done ? ' done' : ''}"><span>${c.desc}</span><b>${c.done ? '✔' : `${Math.floor(c.prog)}/${c.goal}`}</b></div>`).join('');
  return `<div class="prof-head"><b>LEVEL ${p.level}</b><span>${p.matches} matches · ${p.wins} wins · ${p.kills} kills</span></div>
    <div class="xpbar"><i style="width:${Math.round((p.xp / xpForLevel(p.level)) * 100)}%"></i></div>
    <div class="prof-rank" style="color:${t.color}">${p.ranked ? `RANKED · ${t.name.toUpperCase()} · ${p.rp.toLocaleString()} RP · entry ${t.cost} RP` : `Rank: ${t.name} (${p.rp.toLocaleString()} RP)`}</div>
    <div class="prof-ch"><small>DAILY</small>${ch(p.daily.list)}<small>WEEKLY</small>${ch(p.weekly.list)}</div>`;
}
