# Changelog
## m0 — Foundations
- Strict TS, Vite + React + Zustand, Vitest; worker bridge; sfc32 RNG; SoA world tables; calendar.
- Modifier system with getStat breakdowns; command system with validate/apply; fixed-order tick scheduler (empty systems).
- Zod content schemas + lint:content; msgpack+gzip versioned save/load; bench and headless scripts.
## m1 — Map & World
- build-map: Natural Earth 10m admin-1 → 250 provinces (126 in Europe) with adjacency, terrain, development, capitals; 69 countries of 1936.
- Pixi map: pan/zoom/hover/select, Political + Development modes (keys 1/2), province panel, top bar with date, pause (Space), speeds 1–5 (+/-).
- World start or Europe-only quick start. Save format v2 (migration from v1).
## m2 — Population & Economy
- 1936 country table (data/start/countries-1936.json, 2.16B people) and build-pops: ~5.8k pop groups by province/culture/religion/stratum; demand-sized starting industry.
- Systems: labour, production methods (profit-chosen), national + world markets with clamped smoothed prices, wages/dividends/taxes, needs tiers & SoL, state budget (payroll, pensions, arms, government consumption), debt, printing, inflation, monetary policy, private and state construction, demography, mobility, assimilation, migration, stats & yearly history.
- Integer-cent money with escrow and ledger; budget lines per category.
- UI: Population and SoL map modes (keys 3/4), Economy (F2) and Population (F3) panels with history graphs, market/industry tables and hover breakdowns.
- Tests: §6.4 calibration over 1936–2026 (5.7B people, rich LE ~80, 62% urban), economy sanity (no negative stocks, prices in clamp, budgets to the cent, money and population conserved). Bench 33 ms/month.
## m3 — The Core Loop
- Nation select (8 majors) and Europe quick start; ADM/DIP/MIL and political power; development by type with terrain costs.
- Laws: economic system, mobilisation, migration, education (PP costs, modifier effects).
- Stability and per-province unrest (output penalty); manpower from mobilisation.
- Player construction (state projects) with outliner and cancel; tax rate control.
- Automation toggles (auto-develop, auto-construct, auto-budget), undo (Ctrl+Z), Ctrl+K search (provinces incl. merged regions, countries, laws, panels).
- Alerts column (click to jump, mute per type), First Steps card, greyed buttons with reasons, hover previews of effects, top-bar breakdown tooltips, Unrest map mode (5), Government panel (F1).
- Fixes: import-dependent markets price near the world price; shortage alerts use unmet demand; more iron regions; construction costs ~8 months of output; gzip saves deterministic (mtime 0).
- Scripted playtest as Germany: 10 years, 26 decisions, 60 fps at speed 5, no errors.
## m4 — Characters & Interest Groups
- Characters: historical 1936 leaders for the 8 majors, procedural characters from culture name lists, 60 traits, ageing and death, succession, heirs and education, leadership academies, cabinet (4) and high command (3) with appointments, candidate pool, procedural SVG portraits.
- 8 interest groups: clout from pops, approval with breakdown, privileges, radicalism, strikes, PP effects, law support bars and opposition costs, elections, coups, yearly ideology drift.
- UI: Interest Groups panel (F4), people in Government (F1), IG map mode (6), chronicle notifications with auto-pause on leadership changes, IG alerts.
- Exit test: ignoring Trade Unions while industrialising → radicalism 64 and 19 strike-years in 20; accommodating → radicalism 14, no strikes.
- Fixes: fromYmd before 1936; US oil regions.
## m5 — Focuses, Events & Consistency
- Content scripting language (conditions/effects with plain-language previews); global and country flags; era flags.
- Focus engine with computed layout; trees for GER, SOV, USA, GBR, FRA, ITA, JAP, CHI (1930s branches + era sub-trees) and generic modules (industrialise, alignment, independence, regional union) — 128 focuses.
- Event engine: 59 emergent/reaction/era events with templates ({country} {province} {ig} {leader}), MTTH, binding, auto-pause and choice previews.
- Ambitions (12, three per nation) and a headline ticker from real sim events.
- Content linter (consistency) and a harness that forces choices: every focus reachable.
- UI: Focus panel (F5), event pop-ups, ambitions in Government, ticker; shortage alerts name the building to build.
- docs/ARCHITECTURE.md: layers, extension points, merge guide.
