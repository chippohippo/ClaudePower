# Decisions
- **Sim date = integer day index from 1 Jan 1936** (src/sim/date.ts). Alt: JS Date. Why: determinism, cheap compare, trivially serialisable.
- **Modifier scopes as strings ("c:3", "p:12", "g")**. Alt: tagged objects. Why: simple keys for base lookup and filtering.
- **fflate for gzip** instead of pako. Why: smaller, sync API in both Node and browser.
- **Command registry keyed by type string**; systems register handlers at import. Why: AI, UI, console share one path.
