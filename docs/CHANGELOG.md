# Changelog
## m0 — Foundations
- Strict TS, Vite + React + Zustand, Vitest; worker bridge; sfc32 RNG; SoA world tables; calendar.
- Modifier system with getStat breakdowns; command system with validate/apply; fixed-order tick scheduler (empty systems).
- Zod content schemas + lint:content; msgpack+gzip versioned save/load; bench and headless scripts.
## m1 — Map & World
- build-map: Natural Earth 10m admin-1 → 250 provinces (126 in Europe) with adjacency, terrain, development, capitals; 69 countries of 1936.
- Pixi map: pan/zoom/hover/select, Political + Development modes (keys 1/2), province panel, top bar with date, pause (Space), speeds 1–5 (+/-).
- World start or Europe-only quick start. Save format v2 (migration from v1).
