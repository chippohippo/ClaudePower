// DOM HUD. Kept minimal and readable: crosshair with live spread, Apex-style hit/kill markers,
// directional damage arcs, segmented shield bar in evo colours, squad cards, ability cooldown
// sweeps, weapon/ammo panel, compass, minimap + full map, ring timer, kill feed and panels.

import { SHIELD_COLORS, SHIELD_TIERS, EVO_THRESHOLDS } from '../shared/constants.js';
import { LEGENDS, ROLES } from '../shared/legends.js';
import { ROLE_ICON } from './roleicons.js';
import { WEAPONS, magSize } from '../shared/weapons.js';
import { RARITY, itemName, itemRarity, CONSUMABLES, KD_HP } from '../shared/items.js';
import { MAP_HALF } from '../shared/constants.js';
import { FEEL } from './tuning.js';

const $ = (s) => document.querySelector(s);

export class HUD {
  constructor() {
    this.el = {
      hud: $('#hud'), ch: $('#crosshair'), hm: $('#hitmarker'), dirs: $('#dmgdirs'), vignette: $('#vignette'), flash: $('#dmgflash'),
      tint: $('#tint'), scope: $('#scope'), compass: $('#compass-strip'), mini: $('#minimap'), ringinfo: $('#ringinfo'),
      ringLabel: $('#ring-label'), ringTime: $('#ring-time'), alive: $('#alive'), squads: $('#squadsleft'), kills: $('#kills'),
      killfeed: $('#killfeed'), announce: $('#announce'), toasts: $('#toasts'), squad: $('#squad'), legend: $('#legendname'),
      shield: $('#shieldbar'), hp: $('#hpbar'), tac: $('#ab-tac'), ult: $('#ab-ult'), fuel: $('#fuel'), w0: $('#w0'), w1: $('#w1'),
      cons: $('#consumables'), prompt: $('#prompt'), progress: $('#progress'), center: $('#center-msg'), hb: $('#heartbeat'),
      net: $('#netstats'), bigmap: $('#bigmap'), inv: $('#inventory'), db: $('#deathbox'), spect: $('#spectate'), end: $('#endscreen'),
    };
    this.miniCtx = this.el.mini.getContext('2d');
    this.bigCtx = this.el.bigmap.querySelector('canvas').getContext('2d');
    this.hmT = 0;
    this.flashT = 0;
    this.dirs = [];
    this.announceT = 0;
    this.cache = {};
    this._buildCompass();
  }

  show(on) { this.el.hud.classList.toggle('hidden', !on); }

  _buildCompass() {
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    let html = '';
    for (let r = 0; r < 3; r++)
      for (let d = 0; d < 360; d += 15) html += names[d] ? `<span class="c">${names[d]}</span>` : `<span>${d}</span>`;
    this.el.compass.innerHTML = html;
  }

  set(key, el, val, fn) {
    if (this.cache[key] === val) return;
    this.cache[key] = val;
    fn(el, val);
  }

  // ---- events ------------------------------------------------------------
  // Apex crosshair feedback: an X on every hit plus a shield icon in the armor's colour while the
  // target still has shields (gold X on headshots, red on knocks/kills)
  hitmarker(kind, shieldColor = null) {
    const hm = this.el.hm;
    // restart the CSS pop animation every hit
    hm.className = '';
    void hm.offsetWidth;
    hm.className = 'pop ' + (kind === 'kill' ? 'kill' : kind === 'head' ? 'head' : kind === 'break' ? 'break' : '');
    let ic = this.hmShield;
    if (!ic) { ic = this.hmShield = document.createElement('div'); ic.id = 'hmshield'; hm.parentNode.appendChild(ic); }
    if (shieldColor && kind !== 'kill') {
      ic.style.setProperty('--sc', shieldColor);
      ic.className = '';
      void ic.offsetWidth;
      ic.className = 'show';
    }
    this.hmT = kind === 'kill' ? FEEL.hit.killMarkerTime : FEEL.hit.markerTime;
  }

  damageFrom(angle, color = '#ff2a2a') {
    const d = document.createElement('div');
    d.className = 'dmgdir';
    d.style.borderTopColor = color;
    this.el.dirs.appendChild(d);
    this.dirs.push({ el: d, angle, t: 1.3 });
    this.flashT = 0.25;
  }

  // Coloured flash on the screen edges (damage taken, shield break, kills).
  edgeFlash(color, strength) {
    const e = $('#edgeflash');
    e.style.setProperty('--ec', color);
    e.style.transition = 'none';
    e.style.opacity = Math.min(1, strength);
    void e.offsetWidth;
    e.style.transition = 'opacity 0.45s ease-out';
    e.style.opacity = 0;
  }

  killConfirm(name) {
    const now = performance.now();
    this.streak = now - (this.lastKillAt || 0) < 8000 ? (this.streak || 1) + 1 : 1;
    this.lastKillAt = now;
    const k = $('#killconfirm');
    k.innerHTML = `<div class="skull">✖</div><div class="txt">ELIMINATED <b>${name}</b></div>${this.streak > 1 ? `<div class="streak">${['', '', 'DOUBLE', 'TRIPLE', 'QUAD', 'SQUAD WIPE'][Math.min(5, this.streak)] || this.streak + 'X'} KILL</div>` : ''}`;
    k.classList.remove('show');
    void k.offsetWidth;
    k.classList.add('show');
  }

  // Third-party cue: distant enemy gunfire shown on the compass.
  gunfireCue(angle, dist) {
    this.cues = this.cues || [];
    const near = this.cues.find((c) => Math.abs(((c.angle - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.15);
    if (near) { near.t = 3; near.dist = dist; return; }
    if (this.cues.length > 8) return;
    const el = document.createElement('div');
    el.className = 'gcue';
    $('#compass-cues').appendChild(el);
    this.cues.push({ angle, dist, t: 3, el });
  }

  killfeed(ev, kind, g) {
    const nm = (id) => (id ? (id === g.killLeader ? '<span class="kl">♛</span>' : '') + g._name(id) : 'RING');
    const col = (id) => { const m = g.meta.get(id); return m ? LEGENDS[m.legend].color : '#888'; };
    const cls = (id) => (id === g.myId ? 'mine' : g._isMate(id) ? 'sq' : '');
    const icon = kind === 'knock' ? '<i class="ki knock">⤓</i>' : '<i class="ki kill">✖</i>';
    const d = document.createElement('div');
    d.className = 'kf' + (ev.a === g.myId || ev.v === g.myId ? ' me' : '');
    d.innerHTML = `<span class="dot" style="background:${col(ev.a)}"></span><span class="${cls(ev.a)}">${nm(ev.a)}</span><span class="w">${icon}${ev.w || ''}</span><span class="dot" style="background:${col(ev.v)}"></span><span class="${cls(ev.v)}">${nm(ev.v)}</span>`;
    this.el.killfeed.prepend(d);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.lastChild.remove();
    setTimeout(() => d.classList.add('out'), 6500);
    setTimeout(() => d.remove(), 7000);
  }

  // big centre call-out; slams in (re-triggered animation) with an optional coloured subtitle
  announce(text, dur = 3, sub = '', color = '') {
    const a = this.el.announce;
    a.innerHTML = '';
    const t = document.createElement('div');
    t.className = 'at';
    t.textContent = text;
    if (color) t.style.color = color;
    a.appendChild(t);
    if (sub) {
      const s = document.createElement('div');
      s.className = 'as';
      s.innerHTML = sub;
      a.appendChild(s);
    }
    a.classList.remove('slam');
    void a.offsetWidth;
    a.classList.add('slam');
    a.style.opacity = 1;
    this.announceT = dur;
  }

  // zone call-out under the compass when entering a named POI
  zone(name, label, accent) {
    let z = document.getElementById('zonecall');
    if (!z) {
      z = document.createElement('div');
      z.id = 'zonecall';
      this.el.announce.parentNode.appendChild(z);
    }
    z.style.setProperty('--zc', accent || '#ffd23f');
    z.innerHTML = `<small>${label}</small><b>${name}</b>`;
    z.classList.remove('in');
    void z.offsetWidth;
    z.classList.add('in');
  }

  toast(text) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = text;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.remove(), 3000);
  }

  // ---- per-frame -----------------------------------------------------------
  update(dt, g) {
    const me = g.meView;
    if (!me) return;
    const el = this.el;
    // hitmarker / flash / dirs
    this.hmT -= dt;
    el.hm.style.opacity = this.hmT > 0 ? Math.min(1, this.hmT * 8) : 0;
    this.flashT -= dt;
    el.flash.style.opacity = Math.max(0, this.flashT * 3);
    for (let i = this.dirs.length - 1; i >= 0; i--) {
      const d = this.dirs[i];
      d.t -= dt;
      if (d.t <= 0) { d.el.remove(); this.dirs.splice(i, 1); continue; }
      const rel = d.angle - g.viewYaw;
      d.el.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
      d.el.style.opacity = Math.min(1, d.t);
    }
    if (this.cues) {
      for (let i = this.cues.length - 1; i >= 0; i--) {
        const c = this.cues[i];
        c.t -= dt;
        if (c.t <= 0) { c.el.remove(); this.cues.splice(i, 1); continue; }
        let rel = ((-(c.angle - g.viewYaw) * 180) / Math.PI + 540) % 360 - 180; // degrees right of center
        c.el.style.display = Math.abs(rel) > 125 ? 'none' : '';
        c.el.style.transform = `translateX(${260 + rel * 2}px) scale(${c.dist < 150 ? 1.2 : 0.85})`;
        c.el.style.opacity = Math.min(1, c.t);
      }
    }
    this.announceT -= dt;
    if (this.announceT <= 0) el.announce.style.opacity = 0;

    // freefall readout: height above ground and airspeed, like the Apex drop HUD
    const sky = g.skydiving && me.alive && !me.inShip && !g.spectating;
    if (sky || this.skyEl) {
      if (!this.skyEl) { this.skyEl = document.createElement('div'); this.skyEl.id = 'skyhud'; el.announce.parentNode.appendChild(this.skyEl); }
      this.skyEl.style.display = sky ? '' : 'none';
      if (sky) {
        const ms = g.pred;
        const alt = Math.max(0, Math.round(ms.y - g.world.groundAt(ms.x, ms.z, ms.y, this.tmpB || (this.tmpB = []))));
        const spd = Math.round(Math.hypot(ms.vx, ms.vy, ms.vz) * 3.6);
        const k = `${alt}|${spd}`;
        if (k !== this.skyK) { this.skyK = k; this.skyEl.innerHTML = `<div><small>ALT</small><b>${alt}</b><i>m</i></div><div><small>SPEED</small><b>${spd}</b><i>km/h</i></div>`; }
      }
    }

    // crosshair spread
    const sp = g.crosshairSpread; // px gap
    const showCh = !g.adsFull && me.alive && !g.spectating && !g.skydiving;
    el.ch.style.display = showCh ? '' : 'none';
    if (showCh) {
      // Apex-style hipfire reticles by weapon class (lines, shotgun ring, sniper dot)
      const rt = g.reticle || 'AR';
      if (el.ch.dataset.rt !== rt) el.ch.dataset.rt = rt;
      if (rt === 'Shotgun') {
        if (!this.chRing) { this.chRing = document.createElement('div'); this.chRing.className = 'ring'; el.ch.appendChild(this.chRing); }
        const d = Math.max(16, g.pelletPx * 2);
        this.chRing.style.width = this.chRing.style.height = d.toFixed(0) + 'px';
      }
      const gap = 4 + sp;
      el.ch.children[0].style.transform = `translateY(${-gap - 9}px)`;
      el.ch.children[1].style.transform = `translateY(${gap}px)`;
      el.ch.children[2].style.transform = `translateX(${-gap - 9}px)`;
      el.ch.children[3].style.transform = `translateX(${gap}px)`;
    }
    el.scope.style.display = g.scoped ? 'block' : 'none';

    // downed: Fallback Shield prompt and its remaining HP
    const kdShow = me.alive && me.down && !g.spectating;
    if (kdShow || this.kdEl) {
      if (!this.kdEl) { this.kdEl = document.createElement('div'); this.kdEl.id = 'kdhud'; el.announce.parentNode.appendChild(this.kdEl); }
      this.kdEl.style.display = kdShow ? '' : 'none';
      if (kdShow) {
        const max = KD_HP[me.kd || 0] || 0;
        const k = `${me.kd}|${me.kdHp}|${me.kdUp}`;
        if (k !== this.kdK) {
          this.kdK = k;
          this.kdEl.innerHTML = max ? `<div class="kt">${me.kdUp ? 'SHIELD UP' : '<b>[RMB]</b> RAISE FALLBACK SHIELD'}</div><div class="kb"><i style="width:${((me.kdHp || 0) / max * 100).toFixed(0)}%"></i></div>` : '<div class="kt dim">NO FALLBACK SHIELD</div>';
        }
      }
    }

    // vignette when low
    const lowHp = me.alive && !me.down ? (100 - me.hp) / 100 : 0;
    el.vignette.style.boxShadow = `inset 0 0 ${120 + lowHp * 200}px rgba(160,0,0,${(lowHp * 0.7).toFixed(2)})`;
    let tint = '';
    if (me.st && me.st.phase > 0) tint = 'rgba(120,70,255,0.28)';
    else if (me.st && me.st.gas > 0) tint = 'rgba(120,200,40,0.22)';
    else if (me.out) tint = 'rgba(255,80,20,0.18)';
    else if (me.st && me.st.stim > 0) tint = 'rgba(255,140,40,0.08)';
    else if (me.down) tint = 'rgba(160,0,0,0.25)';
    this.set('tint', el.tint, tint, (e, v) => { e.style.background = v; e.style.opacity = v ? 1 : 0; });

    // compass
    const deg = ((-g.viewYaw * 180) / Math.PI + 360) % 360;
    el.compass.style.transform = `translateX(${260 - 15 - (deg / 15) * 30 - 24 * 30}px)`;

    // counts / ring
    const R = g.ring;
    if (R) {
      const closing = R.st === 'close';
      this.set('ringcls', el.ringinfo, closing, (e, v) => e.classList.toggle('closing', v));
      const label = R.st === 'final' ? 'FINAL RING' : closing ? `RING ${R.idx + 1} CLOSING` : `RING ${R.idx + 1}`;
      this.set('ringl', el.ringLabel, label, (e, v) => (e.textContent = v));
      const frac = R.tot ? Math.max(0, Math.min(1, R.t / R.tot)) : 0;
      el.ringinfo.querySelector('.rbar i').style.width = (frac * 100).toFixed(1) + '%';
      const t = Math.ceil(R.t);
      this.set('ringt', el.ringTime, t, (e, v) => (e.textContent = R.st === 'final' ? '' : `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`));
    }
    this.set('alive', el.alive, g.aliveCount, (e, v) => (e.textContent = v));
    this.set('squads', el.squads, g.squadsLeft, (e, v) => (e.textContent = v));
    this.set('kills', el.kills, me.kills || 0, (e, v) => (e.textContent = v));

    // player bars
    const L = LEGENDS[me.legend || g.myLegend];
    this.set('lname', el.legend, L.name + g.mode, (e) => {
      const R = ROLES[L.cls];
      e.innerHTML = L.name + (g.mode === 'sixes' ? ` <span class="rbadge" style="color:${R.color}">${ROLE_ICON[L.cls]}${R.label}</span>` : '');
      e.style.color = L.color;
    });
    const maxS = SHIELD_TIERS[me.armor] || 0;
    const sFill = el.shield.querySelector('.fill');
    this.set('shw', sFill, maxS ? (me.sh / 125) * 100 : 0, (e, v) => (e.style.width = v + '%'));
    this.set('shc', sFill, me.armor, (e, v) => (e.style.background = SHIELD_COLORS[v]));
    this.set('shmax', el.shield, maxS, (e, v) => {
      e.style.width = Math.max(8, (v / 125) * 100) + '%';
      e.querySelector('.segs').innerHTML = '<i></i>'.repeat(Math.max(1, v / 25));
      sFill.style.width = v ? (me.sh / v) * 100 + '%' : '0';
    });
    if (maxS) sFill.style.width = (me.sh / maxS) * 100 + '%';
    const hFill = el.hp.querySelector('.fill');
    this.set('hp', hFill, me.down ? me.hp : me.hp, (e, v) => (e.style.width = v + '%'));
    this.set('hplow', el.hp, me.hp < 35 || me.down, (e, v) => e.classList.toggle('low', v));

    // abilities
    const tacMax = L.tactical.cd, ultMax = L.ultimate.cd;
    this._abil(el.tac, 'tac', L.tactical.name, me.tac, tacMax, L.color);
    this._abil(el.ult, 'ult', L.ultimate.name, me.rift ? 0 : me.ult, ultMax, L.color, me.rift ? 'PLACE' : null);
    el.fuel.style.display = me.legend === 'spectre' ? '' : 'none';
    if (me.legend === 'spectre') el.fuel.firstChild.style.width = (me.fuel * 100).toFixed(0) + '%';

    // weapons
    const inv = g.inv;
    for (let i = 0; i < 2; i++) {
      const w = inv && inv.weapons[i];
      const box = i ? el.w1 : el.w0;
      const active = me.act === i;
      const ammoReserve = w ? g.ammoCount(WEAPONS[w.id].ammo) : 0;
      const mag = w ? (i === me.act ? g.localMag : me.mags[i]) : 0;
      const key = w ? `${w.id}|${w.tier}|${mag}|${ammoReserve}|${active}` : 'none' + active;
      this.set('w' + i, box, key, (e) => {
        e.classList.toggle('active', active);
        e.style.setProperty('--rc', w ? RARITY[w.tier] : '#888');
        e.querySelector('.nm').textContent = w ? WEAPONS[w.id].name.toUpperCase() : `SLOT ${i + 1}`;
        const max = w ? magSize(WEAPONS[w.id], w.att.mag) : 0;
        const a = e.querySelector('.ammo');
        a.innerHTML = w ? `${mag}<small> / ${ammoReserve}</small>` : '';
        a.classList.toggle('low', !!w && mag <= max * 0.25);
      });
    }
    if (inv) {
      const c = (k) => g.itemCount(k);
      const key = ['cell', 'battery', 'syringe', 'medkit', 'phoenix'].map((k) => c('c:' + k)).join() + '|' + c('g:frag') + c('g:arc');
      this.set('cons', el.cons, key, (e) => {
        e.innerHTML = `<span style="color:#3fa9ff">◆ ${c('c:cell')}</span><span style="color:#3fa9ff">▣ ${c('c:battery')}</span><span style="color:#ff5a5a">✚ ${c('c:syringe')}</span><span style="color:#ff5a5a">▣ ${c('c:medkit')}</span><span style="color:#ff9f1c">✦ ${c('c:phoenix')}</span><span>● ${c('g:frag') + c('g:arc')}</span>`;
      });
    }

    // prompt / progress / center message
    this.set('prompt', el.prompt, g.promptHtml || '', (e, v) => { e.innerHTML = v; e.style.display = v ? 'block' : 'none'; });
    if (g.promptColor) el.prompt.style.setProperty('--rc', g.promptColor);
    const prog = g.progress;
    el.progress.style.display = prog ? 'block' : 'none';
    if (prog) {
      el.progress.querySelector('.label').textContent = prog.label;
      el.progress.querySelector('.fill').style.width = Math.min(100, prog.p * 100) + '%';
    }
    this.set('center', el.center, g.centerMsg || '', (e, v) => (e.innerHTML = v));
    // heartbeat (Echo passive)
    if (g.heartbeat > 0 && g.adsAmt > 0.5) {
      const rate = 0.4 + (g.heartbeat / 40) * 0.8;
      el.hb.style.opacity = (Math.sin(performance.now() / 1000 / rate * Math.PI * 2) > 0.7 ? 0.9 : 0.2).toString();
    } else el.hb.style.opacity = 0;

    // squad
    this._squad(g);
    // minimap
    this._minimap(g);
    el.net.textContent = g.showStats ? `${g.fps} FPS · ${g.pingMs} ms` : '';
  }

  spectator(g) {
    const v = g.meView, el = this.el.spect;
    if (!v) return;
    const L = LEGENDS[v.legend] || LEGENDS.jolt;
    const key = `${v.id}|${v.hp}|${v.sh}|${v.armor}|${v.kills}|${v.down}`;
    this.set('spect', el, key, (e) => {
      e.style.setProperty('--c', L.color);
      e.querySelector('.who').textContent = (g._name(v.id) || '').toUpperCase();
      e.querySelector('.legend').textContent = L.name + ' · ' + L.role.toUpperCase();
      const ms = SHIELD_TIERS[v.armor] || 0;
      const sb = e.querySelector('.ssh i');
      sb.style.width = (ms ? (v.sh / 125) * 100 : 0) + '%';
      sb.style.background = SHIELD_COLORS[v.armor];
      e.querySelector('.shp i').style.width = v.hp + '%';
      e.querySelector('.sstats').textContent = `${v.kills || 0} KILLS · ${v.dmg || 0} DAMAGE${v.down ? ' · DOWNED' : ''}`;
    });
  }

  roster(list) {
    const r = this.el.end.querySelector('.roster');
    if (!list) { r.innerHTML = ''; return; }
    r.innerHTML = list.map((m, i) => {
      const L = LEGENDS[m.legend] || LEGENDS.jolt;
      return `<div class="rcard" style="--c:${L.color};animation-delay:${0.25 + i * 0.12}s"><div class="rl">${L.name}</div><div class="rn">${m.name}</div><div class="rs"><b>${m.kills}</b> KILLS<br><b>${m.damage}</b> DMG</div></div>`;
    }).join('');
  }

  _abil(el, key, name, cd, max, color, label) {
    const p = cd > 0 ? Math.min(100, (cd / max) * 100) : 0;
    const k = `${name}|${Math.ceil(cd)}|${p.toFixed(1)}|${label}`;
    this.set('ab' + key, el, k, (e) => {
      e.style.setProperty('--c', color);
      // SVG ring fills clockwise as the ability recharges (circumference 2π·36 ≈ 226)
      e.querySelector('.fg').style.strokeDashoffset = ((p / 100) * 226).toFixed(1);
      const ready = cd <= 0;
      if (ready && !e.classList.contains('ready')) { e.classList.remove('flash'); void e.offsetWidth; e.classList.add('flash'); }
      e.classList.toggle('ready', ready);
      e.querySelector('.nm').textContent = label || name.toUpperCase();
      e.querySelector('.t').textContent = cd > 0 ? Math.ceil(cd) : '';
    });
  }

  _squad(g) {
    const sq = g.squadInfo || [];
    const key = JSON.stringify(sq.filter((m) => m.id !== g.myId).map((m) => [m.id, m.hp, m.sh, m.armor, m.down, m.elim, m.banner]));
    this.set('squad', this.el.squad, key, (e) => {
      e.classList.toggle('compact', sq.length > 3);
      e.innerHTML = sq.filter((m) => m.id !== g.myId).map((m) => {
        const L = LEGENDS[m.legend];
        const ms = SHIELD_TIERS[m.armor] || 0;
        const cls = m.elim ? 'mate elim' : m.down ? 'mate down' : 'mate';
        const tag = m.elim ? (m.banner === 1 ? '<small>BANNER READY</small>' : m.banner === 2 ? '<small>BANNER TAKEN</small>' : '<small>ELIMINATED</small>') : `<small>${L.name}</small>`;
        const gi = g.mode === 'sixes' ? `<span class="gi">${ROLE_ICON[L.cls]}</span>` : '';
        return `<div class="${cls}" style="--c:${L.color}"><i class="glyph">${gi}</i><div class="n"><span>${m.name}${m.bot ? ' <small>BOT</small>' : ''}</span>${tag}</div>
          <div class="bars2"><div class="sb"><i style="width:${ms ? (m.sh / 125) * 100 : 0}%;background:${SHIELD_COLORS[m.armor]}"></i></div><div class="hb"><i style="width:${m.hp}%"></i></div></div></div>`;
      }).join('');
    });
  }

  _drawMap(ctx, size, g, cx, cz, scale, big) {
    // scale: px per meter; centered at (cx,cz) in world
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(70,82,60,0.92)';
    ctx.fillRect(0, 0, size, size);
    const toX = (x) => size / 2 + (x - cx) * scale;
    const toY = (z) => size / 2 + (z - cz) * scale;
    // hill-shaded terrain so high ground and valleys read at a glance
    const W = MAP_HALF + 20, img = this._terrainImage(g.map, W);
    ctx.drawImage(img, toX(-W), toY(-W), 2 * W * scale, 2 * W * scale);
    // POIs
    for (const w of g.map.waters) {
      ctx.fillStyle = 'rgba(70,170,210,0.75)';
      ctx.beginPath();
      ctx.arc(toX(w.x), toY(w.z), w.r * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of g.map.pois) {
      ctx.fillStyle = (p.accent || '#a09687') + '55';
      ctx.strokeStyle = p.accent || '#a09687';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(toX(p.x), toY(p.z), p.r * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(toX(p.x), toY(p.z), p.r * scale, 0, Math.PI * 2);
      ctx.fill();
      if (big || scale > 0.25) {
        ctx.fillStyle = p.tier === 2 ? '#ffd23f' : '#e8e8e8';
        ctx.font = `bold ${big ? 15 : 11}px Rajdhani, Arial`;
        ctx.textAlign = 'center';
        ctx.fillText(p.name.toUpperCase(), toX(p.x), toY(p.z) + 4);
      }
    }
    if (scale > 0.5) {
      ctx.fillStyle = 'rgba(40,40,40,0.55)';
      for (const b of g.map.boxes) {
        if (b.max[1] - b.min[1] < 1.5 || b.kind === 'tree') continue;
        const x = toX(b.min[0]), y = toY(b.min[2]);
        if (x > size || y > size || x < -50 || y < -50) continue;
        ctx.fillRect(x, y, (b.max[0] - b.min[0]) * scale, (b.max[2] - b.min[2]) * scale);
      }
    }
    // ring
    const R = g.ring;
    if (R) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,60,20,0.28)';
      ctx.beginPath();
      ctx.rect(0, 0, size, size);
      ctx.arc(toX(R.cx), toY(R.cz), R.r * scale, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.strokeStyle = '#ff6a2a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(toX(R.cx), toY(R.cz), R.r * scale, 0, Math.PI * 2);
      ctx.stroke();
      if (R.st !== 'final') {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(toX(R.nx), toY(R.nz), R.nr * scale, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    // ship path
    if (g.shipInfo && g.phase === 'ship') {
      const S = g.shipInfo;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(toX(S.ax), toY(S.az));
      ctx.lineTo(toX(S.bx), toY(S.bz));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // ziplines
    ctx.strokeStyle = 'rgba(255,179,71,0.8)';
    ctx.lineWidth = big ? 2 : 1.2;
    for (const z of g.map.zips) {
      ctx.beginPath(); ctx.moveTo(toX(z.ax), toY(z.az)); ctx.lineTo(toX(z.bx) + (z.top ? 2 : 0), toY(z.bz)); ctx.stroke();
    }
    // pings
    for (const p of g.pings) {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(toX(p.x), toY(p.z), big ? 7 : 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // care packages
    for (const e of g.entityList) {
      if (e.k === 'carepkg') { ctx.fillStyle = '#ffd23f'; ctx.fillRect(toX(e.x) - 3, toY(e.z) - 3, 6, 6); }
    }
    // redeploy balloons
    ctx.fillStyle = '#7ab8ff';
    for (const b of g.map.balloons || []) {
      const x = toX(b.x), y = toY(b.z), r = big ? 6 : 4;
      ctx.beginPath(); ctx.arc(x, y - r * 0.4, r * 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(x - 0.6, y, 1.2, r);
    }
    // timed markers: supply drops, Kill Leader sightings
    for (const mk of g.mapMarks || []) {
      const x = toX(mk.x), y = toY(mk.z), pulse = 1 + 0.25 * Math.sin(performance.now() / 150);
      ctx.strokeStyle = mk.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, (big ? 11 : 7) * pulse, 0, Math.PI * 2); ctx.stroke();
      if (big || scale > 0.2) {
        ctx.fillStyle = mk.color;
        ctx.font = `bold ${big ? 13 : 10}px Rajdhani, Arial`;
        ctx.textAlign = 'center';
        ctx.fillText(mk.label, x, y - (big ? 15 : 10));
      }
    }
    // squad + revealed enemies
    for (const p of g.mapDots) {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(toX(p.x), toY(p.z), p.me ? (big ? 6 : 4) : big ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      if (p.me) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(toX(p.x), toY(p.z));
        ctx.lineTo(toX(p.x) - Math.sin(p.yaw) * 14, toY(p.z) - Math.cos(p.yaw) * 14);
        ctx.stroke();
      }
    }
  }

  _terrainImage(map, W) {
    if (this.terrainImg && this.terrainSeed === map.seed) return this.terrainImg;
    const N = 384, c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d'), img = ctx.createImageData(N, N), T = map.terrain;
    const n = { x: 0, y: 1, z: 0 };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -W + ((i + 0.5) / N) * 2 * W, z = -W + ((j + 0.5) / N) * 2 * W;
      const h = (T.height(x, z) - T.minH) / Math.max(1, T.maxH - T.minH);
      T.normal(x, z, n);
      const shade = Math.max(0, 0.55 + (-n.x * 0.6 - n.z * 0.4) * 2.2); // light from the north-west
      const k = (j * N + i) * 4;
      img.data[k] = (62 + h * 70) * shade; img.data[k + 1] = (78 + h * 55) * shade; img.data[k + 2] = (52 + h * 30) * shade; img.data[k + 3] = 255;
      // contour lines every ~6 m
      const hm = T.height(x, z);
      if (Math.abs((hm % 6) - 3) > 2.75) { img.data[k] *= 0.8; img.data[k + 1] *= 0.8; img.data[k + 2] *= 0.8; }
    }
    ctx.putImageData(img, 0, 0);
    this.terrainImg = c;
    this.terrainSeed = map.seed;
    return c;
  }

  _minimap(g) {
    this.miniT = (this.miniT || 0) + 1;
    if (this.miniT % 3) return;
    const me = g.viewPos;
    const scale = g.phase === 'ship' || g.skydiving ? 0.12 : 0.55;
    this._drawMap(this.miniCtx, 200, g, me.x, me.z, scale, false);
    if (!this.el.bigmap.classList.contains('hidden')) {
      this._drawMap(this.bigCtx, 900, g, 0, 0, 900 / (MAP_HALF * 2 + 40), true);
    }
  }

  bigMapToWorld(px, py, rect) {
    const s = 900 / (MAP_HALF * 2 + 40);
    const x = ((px - rect.left) / rect.width) * 900, y = ((py - rect.top) / rect.height) * 900;
    return { x: (x - 450) / s, z: (y - 450) / s };
  }

  // ---- panels --------------------------------------------------------------
  renderInventory(g, onDrop, onDropWeapon) {
    const inv = g.inv;
    if (!inv) return;
    const W = $('#inv-weapons'), G = $('#inv-gear'), B = $('#inv-bag');
    W.innerHTML = '<h4>WEAPONS</h4>' + inv.weapons.map((w, i) => {
      if (!w) return `<div class="witem"><div class="t">— empty —</div></div>`;
      const d = WEAPONS[w.id];
      const att = [w.att.optic ? itemName('x:' + w.att.optic) : null, w.att.mag ? `Mag Lv${w.att.mag}` : null, w.att.barrel ? `Barrel Lv${w.att.barrel}` : null, w.att.stock ? `Stock Lv${w.att.stock}` : null].filter(Boolean).join(' · ') || 'no attachments';
      return `<div class="witem" style="--rc:${RARITY[w.tier]}" data-w="${i}"><div class="t">${d.name} <small>${d.cls} · ${d.ammo}</small></div><div class="att">${att}</div></div>`;
    }).join('');
    const ev = inv.evo ?? 0;
    G.innerHTML = `<h4>GEAR</h4>
      <div class="item" style="--rc:${SHIELD_COLORS[inv.armor]}">Adapt Armor <small>Lv${inv.armor}${inv.armor && inv.armor < 4 ? ` · ${g.meView.evo || 0}/${EVO_THRESHOLDS[inv.armor]}` : ''}</small></div>
      <div class="item" style="--rc:${RARITY[Math.max(0, inv.helmet - 1)]}">Helmet <small>Lv${inv.helmet}</small></div>
      <div class="item" style="--rc:${RARITY[Math.max(0, inv.pack - 1)]}">Backpack <small>Lv${inv.pack}</small></div>
      <div class="item" style="--rc:${RARITY[Math.max(0, (inv.kd || 0) - 1)]}">Fallback Shield <small>Lv${inv.kd || 0}</small></div>`;
    B.innerHTML = `<h4>BACKPACK (${inv.inv.length}/${[8, 10, 12, 14][inv.pack]})</h4>` + inv.inv.map((s, i) =>
      `<div class="item" data-i="${i}" style="--rc:${RARITY[itemRarity(s.item, s.tier)]}">${itemName(s.item, s.tier)} <small>x${s.n}</small></div>`).join('');
    B.querySelectorAll('.item').forEach((d) => d.addEventListener('contextmenu', (e) => { e.preventDefault(); onDrop(+d.dataset.i); }));
    W.querySelectorAll('.witem[data-w]').forEach((d) => d.addEventListener('contextmenu', (e) => { e.preventDefault(); onDropWeapon(+d.dataset.w); }));
  }

  renderDeathbox(title, items, onTake) {
    $('#db-title').firstChild.textContent = title + ' ';
    const el = $('#db-items');
    el.innerHTML = items.length ? items.map((s, i) => `<div class="item" data-i="${i}" style="--rc:${RARITY[itemRarity(s.item, s.tier)]}">${itemName(s.item, s.tier)} <small>${s.n > 1 ? 'x' + s.n : ''}</small></div>`).join('') : '<div class="item">— empty —</div>';
    el.querySelectorAll('.item[data-i]').forEach((d) => d.addEventListener('click', () => onTake(+d.dataset.i)));
  }
}

export { CONSUMABLES };
