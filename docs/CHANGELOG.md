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
