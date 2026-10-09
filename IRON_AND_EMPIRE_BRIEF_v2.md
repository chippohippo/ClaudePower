IRON & EMPIRE — The Long
Century (1936–2026)

Build Brief for Claude Code · v2.0
   You are the lead engineer, systems designer, and UX
   designer for Iron & Empire, a single-player grand strategy
   game running from 1 Jan 1936 to 31 Dec 2026 in one
   unbroken timeline.

   How to use this file: It is the design authority. On your
   first session, read it fully, then create CLAUDE.md from
   the template in §19. Later sessions read only
    CLAUDE.md plus the sections named for the current
   milestone. Never reread the whole brief unless told to.




0. North Star
"Easy to play, hard to master, and the world feels alive."

Judge every decision by these three questions, in order:

 1. Is it fun right now? A new player makes a meaningful
    choice within 60 seconds and understands why
    anything happened within one hover.
 2. Is the simulation honest? Every number on screen
    comes from the real model and can be traced to its
     causes.
  3. Does it hold up for 90 years? Every run reaches 2026 as
     a coherent, different world. No dead provinces, global
     hyperinflation, or one blob owning Earth by 1960.

Simulate deeply, present simply. When fidelity and fun
conflict, fun wins at the surface and fidelity wins
underneath.




1. Golden Rules for the AI Builder
These rules exist to make your job easier. Follow them
strictly.

  1. One milestone at a time. Finish its exit criteria before
     starting the next. Never leave the build broken.
  2. Everything is a Modifier (§3.3). If a value can change,
     it's computed from a modifier stack. This gives tooltips,
     the explain command, and balancing for free.
  3. Everything the player or AI does is a Command (§3.4).
     No direct state mutation from UI or AI. This gives undo,
     replays, AI parity, and multiplayer later for free.
  4. Content is data, logic is code. Countries, goods,
     buildings, laws, IGs, focuses, events, techs, and traits
     live in data/ as validated JSON. Systems never hard-
     code a country tag.
  5. Generate, don't hand-write, bulk data. Write scripts that
     produce provinces, populations, and name lists.
     Commit the output.
 6. Small files, one system each.
    src/sim/systems/<name>.ts under ~400 lines, each
   with a test file.
 7. Tests are the spec. When balancing, change constants,
   never the calibration assertions.
 8. Log decisions, not diaries. Significant choices go in
    docs/decisions.md (decision, alternatives, why). Keep
   it short.
 9. Quiet output. Run tests with a minimal reporter and
   show only failures. Don't print large data files to the
   console.
10. When in doubt, choose the simpler mechanic that still
   produces interesting decisions, and note it in
    docs/decisions.md .

11. Original names only. No Paradox game names, assets,
   or text. Real history, people, and places are fine.




2. Scope Layers

 Layer         Milestones    Content


                             ~250 provinces (dense in
                             Europe, sparse elsewhere), all
 Slice         M0–M3
                             1936 states, 8 majors playable,
                             economy + pops + EU4 loop
  Layer       Milestones     Content


                             Characters, Interest Groups,
                             focus trees for 8 majors,
  Depth       M4–M7
                             events, diplomacy, war,
                             tech/ideas


                             AI strategy, full 90-year
  Century     M8–M9
                             balance, polish, tutorial


                             ~600 provinces, 20–25 focus
  Breadth     M10+           trees, more characters and
                             events


The architecture supports the full vision from day one;
content ships in layers.




3. Architecture

3.1 Stack
    TypeScript (strict) + Vite + React + Zustand. Map in
    PixiJS (WebGL). Packages to desktop via Tauri later.
    Simulation core: pure TS, zero UI imports, runs in a Web
    Worker in the browser and in Node for tests and
    headless runs.
    Storage: struct-of-arrays tables (typed arrays) keyed by
    integer IDs for provinces, pops, buildings, characters.
    String tags only at the data boundary.
    Deterministic: seeded PRNG ( sfc32 ), fixed system
    order, no Math.random , no Date.now() in sim, fixed-
   point or carefully rounded money (integer cents).
   Validation: Zod schemas for all data/ files; validator
   runs on load and in npm test .
   Saves: versioned MessagePack + gzip, autosave yearly,
   migration functions between versions.
   Testing: Vitest.


3.2 Folder layout

 /data                content JSON (countries, goods,
 buildings, laws, igs, focuses, events, techs,
 traits, names)
 /data/generated      script output (provinces,
 starting pops) — committed
 /scripts             build-map, build-pops,
 headless-run, century-report, bench, lint-
 content
 /src/sim             core: world.ts, rng.ts,
 tick.ts, modifiers.ts, commands.ts
 /src/sim/systems one file per system
 (demography.ts, market.ts, production.ts,
 igs.ts, ...)
 /src/sim/ai          AI evaluators, one per decision
 domain
 /src/ui              React panels, components, hooks
 /src/map             Pixi renderer, map modes
 /src/worker          worker entry, snapshot
 serialisation
 /tests               unit/, calibration/,
 determinism/, content/
 /docs                decisions.md, CHANGELOG.md




3.3 Modifier system (build in M0, use everywhere)
  type Modifier = { target: StatKey; scope:
  ScopeRef; add?: number; mult?: number; source:
  SourceRef; expires?: Date };
  // value = (base + Σadd) × Π(1 + mult), clamped
  per StatKey


     getStat(scope, key) returns the value and its
    contributor list, sorted by impact.
    Tooltips, the explain console command, and AI
    scoring all use this one function.


3.4 Command system (build in M0, use everywhere)

  type Command = { type: string; actor: CountryId;
  payload: unknown; issuedOn: Date };
  // validate(cmd, world)    → ok | reason      ·
  apply(cmd, world)     → events

    UI, AI, and console all issue Commands. validate
    returns a human-readable reason (used for greyed-out
    buttons: "Requires 50 ADM").
    Undo = re-simulate from the last snapshot without the
    command (only for non-time-advancing actions).


3.5 Tick order (fixed, never reorder silently)
Daily: commands     → movement → combat → sieges →
character health.
Monthly: points & PP  → production → markets/prices →
wages & pop income → pop consumption & SoL → state
budget → construction → research & focus progress → IG
attraction & approval → stability/unrest → events → AI →
alerts.
Yearly: demography  → migration → assimilation & mobility
→ IG clout → ideology drift → rankings → chronicle
snapshot → autosave.


3.6 Performance budgets ( npm run bench )
                                                      →
    Monthly world tick < 50 ms; full headless 1936 2026 <
    3 min.
    Map 60 fps pan/zoom with any map mode.
    UI never blocks; worker posts snapshots at most
    10×/sec, only changed tables.




4. Time & Pacing
    Speeds 1–5 + pause (Space). Speed 3 ≈ 1 month per 3
    seconds.
    Auto-pause (each toggleable): war declared on you,
    focus complete, event, election, leader death,
    bankruptcy risk, IG radicalisation spike, civil war risk.
    Era bands shift UI theming, available content, and AI
    priorities: Crisis (1936–45), Reconstruction (1946–59),
    Cold War/Multipolar (1960–89), Globalisation (1990–
    2009), Information Age (2010–26). Era names adapt to
    world state (e.g. "Pax Germanica" if relevant flags are
    set).
    2026 is a soft end: show the Century Report, then allow
    continuing.
5. Player Resources

  Resource        Generated by            Spent on


                                          Tax dev, cores,
                  Leader, advisors,
  ADM                                     reforms, admin
                  loyal IGs, ideas
                                          ideas, stability


                                          Production dev,
                  Leader, advisors,
  DIP                                     claims, relations,
                  loyal IGs
                                          dip ideas, culture


                                          Manpower dev,
                  Leader, advisors,
  MIL                                     generals, doctrines,
                  loyal IGs
                                          mil ideas


                  Government,             Focuses, laws,
  Political
                  stability, IG           cabinet, decisions,
  Power
                  approval                IG privileges


                  Taxes, tariffs,         Construction,
  Treasury        state enterprise        upkeep, subsidies,
                  (real economy)          debt service

                  Working-age pops
  Manpower                                Army and navy
                  × mobilisation law


Starting constants (tune later): base +3/month per point
type, leader stats add 0–6, cap 999. Approaching the cap
triggers an alert ("You'll waste ADM in 2 months").

Development: costs the matching point (base 50, +5% per
existing dev level, terrain modifier). Each dev level raises
productivity, carrying capacity, and building slots, which feed
the pop/economy model. Over-developing without
infrastructure gives diminishing returns, visible in the tooltip.




6. Population (the showpiece)

6.1 Pop groups
Key = (province, culture, religion, stratum). Fields:

     size by age band (0–14, 15–64, 65+), sex split as a
    ratio
     stratum : Peasants, Workers, Clerks, Professionals,
    Elites, Military, Bureaucrats
     literacy , health (0–1), wealth (cents per capita)

     sol (standard of living 0–100) from needs satisfaction

     ideology vector (Democracy / Fascism / Communism
    / Non-aligned)
     consciousness , militancy

    employment: building id / unemployed / subsistence
    IG attraction weights (§7)

Limit: average 5–25 groups per province, max 40. Merge
below a size threshold, split above a share threshold.


6.2 Demography (yearly, smoothed monthly)
    Births: women 15–49 × fertility. Fertility falls with
    literacy, urbanisation, and SoL (demographic transition);
    rises with pro-natal laws and religiosity.
   Deaths per band: baseline × health tech × healthcare
   spending × famine × war × epidemics.
   Ageing: band transitions create real pension pressure
   by the 2000s.
   Urbanisation: driven by wage gap, urban jobs, and farm
   productivity.
   Migration: internal toward wages; international toward
   rich, safe, open countries; refugees from war and
   persecution; controlled by migration laws.
   Assimilation: slow drift to dominant culture, faster with
   literacy and policy, slower under unrest.
   Mobility: pops climb strata as literacy, jobs, and wealth
   allow.


6.3 Starting data
       scripts/build-pops.ts generates 1936 pops from a
   small hand-written table of country-level estimates
   (population, urban share, literacy, GDP per capita, main
   cultures/religions) in data/start/countries-
   1936.json , distributed to provinces by area,
   development, and cities.
   Reference figures: Maddison Project (GDP),
   UN/academic historical estimates (population).
   Approximate is fine; plausibility beats precision.


6.4 Calibration tests ( tests/calibration/ , AI-only
run)
   World population ~2.2B (1936)  → 5–9B (2026)
   Rich-country life expectancy ~60 → 75–85
    Global urbanisation ~30%    → 45–65%
    Some countries reach below-replacement fertility
    No province reaches zero population without a logged
    cause
    No country above 60% inflation per year for more than 5
    consecutive years in more than 10% of runs




7. Interest Groups
The political voice of the population, sitting between pops
and the government.


7.1 Starting IGs (8)
Landowners · Industrialists · Petite Bourgeoisie ·
Intelligentsia · Trade Unions · Rural Folk · Armed Forces ·
Devout. (Bureaucrats can be added later.)

Each IG has Clout (% of political weight), Approval (−100…
+100), Ideology leaning, a Leader (character), Privileges
(enjoyed or demanded), and Radicalism.


7.2 Mechanics
    Pops   → IGs: monthly, each pop group splits its political
    weight (by size × wealth × literacy) across 1–3 IGs,
    mostly by stratum, modified by culture, religion, SoL,
    and laws.
    Laws: each law has an IG support score. Passing
    against powerful IGs costs extra PP and raises their
    radicalism. Show the support bar before the player
    commits.
    Government: democracies form coalitions from IGs;
    autocracies need backing or acquiescence from high-
    clout IGs. Elections use IG clout plus pop ideology.
    Pressure: angry high-clout IGs generate demands,
    strikes, petitions, coups, and in extremes civil war.
    Bonuses: loyal IGs grant points or PP; angry ones drain
    them.
    Gating: some focuses and decisions require IG approval
    or clout.


7.3 Player tools
Grant/revoke privileges, appoint IG leaders to cabinet, shift
attraction via education, propaganda, and SoL, and
suppress or co-opt radicals (cheap now, risky later).

Design test: expanding the army while ignoring the Armed
Forces, or industrialising while ignoring Trade Unions, must
have visible consequences within a few years.




8. Economy

8.1 Goods (start with 14 in M2, expand to ~30 in
M7)
M2 set: Grain, Consumer Goods, Clothing, Coal, Iron, Steel,
Oil, Fuel, Tools, Machinery, Electricity, Arms, Luxury Goods,
Services.
Added later (era-gated): Meat/Fish, Textiles, Wood, Rubber,
Chemicals, Fertiliser, Vehicles, Aircraft, Ships, Electronics
(1950s+), Pharmaceuticals, Uranium (1940s+),
Semiconductors (1970s+), Lithium & Rare Earths (1990s+),
Digital Services (1990s+).


8.2 Buildings & production methods
    Farms, mines, wells, factories, power plants, ports,
    universities, hospitals, arms factories, dockyards.
    Each has production methods unlocked by tech (hand
    → mechanised → automated; coal → oil →
    nuclear/renewable), each defining inputs, outputs, and
    jobs by stratum.
    Automation cuts worker jobs and adds professional
    jobs, feeding late-game IG tension.


8.3 Markets
    National markets, mergeable into trade blocs. Trade
    flows between markets with distance and infrastructure
    costs; convoys can be raided.
    Price = base × clamp((demand/supply)^0.6, 0.25,
    4) , smoothed (max ±10%/month).

    Shortages have visible effects: unmet needs, idle
    factories, unequipped armies.


8.4 Needs & SoL
Tiers: Subsistence   → Everyday → Luxury, bought from
wages and savings. SoL drives fertility, migration, literacy,
radicalism, and IG approval.


8.5 State & macro
  Wages from profitability and labour scarcity; real
  unemployment.
  Profits go to owners (capitalists, state, or co-ops by
  economic law) and fund investment (private investment
  AI + state construction queue).
  Budget: taxes by stratum, consumption tax, tariffs,
  state enterprise; spending on military, bureaucracy,
  education, health, pensions, subsidies, interest.
  Debt up to a GDP-linked limit; interest rises with
  debt/GDP and instability; default triggers an event
  chain.
  Inflation from deficits and printing, shown as one
  number with causes.
  GDP = value added; total and per capita with history
  graphs.
  Mobilisation laws trade consumer goods (and SoL) for
  arms and manpower.




9. Characters
  Head of State / Government: ADM/DIP/MIL 0–6+, traits,
  age, health, ambition, loyalty, popularity, ideology.
  Cabinet (4 slots), High Command (3),
  Generals/Admirals (skill 1–9), Scientists, Governors, IG
  leaders.
  Historical leaders for the 8 majors; procedural
  characters for everyone else from culture name lists.
  Lifespan: ageing, death, assassination, coups,
  elections, retirement. Transitions auto-pause with a
   portrait card.
   Leader development: spend points + PP to educate
   heirs and found academies that raise future leader
   quality.
   Ambitious, disloyal generals can coup or become
   warlords.
   ~60 balanced traits to start.
   Portraits: generated procedurally (SVG silhouettes with
   era clothing, rank insignia, and colours). No photos.




10. Focuses, Events & Alternate History

10.1 Focus trees
   8 majors (GER, SOV, USA, ENG, FRA, ITA, JAP, CHI), 3–5
   ideological branches, 40–80 focuses each.
   Cost PP (sometimes plus points) and time. Trees
   continue across eras via world-state-conditioned sub-
   trees (post-war, Cold War/multipolar, 21st century). No
   resets.
   Generic modular trees for everyone else: industrialise,
   alignment, independence/decolonisation, regional
   union.
   Focus tree authoring format: one JSON file per tree
   with id, prerequisites, mutually exclusive groups, cost,
   days, conditions, effects, and AI weight. Layout (x, y) is
   auto-computed by a script.


10.2 Consistency engine
    World-changing outcomes set global flags
    ( ger_democratic , sov_collapsed , first_nuke:
    <tag> , ...).

    Focuses, events, and AI read flags through conditions;
    affected nations get reaction content.
    Content linter ( npm run lint:content ) reports flags
    read but never set, unreachable branches, and major
    outcomes with no reaction content for affected
    neighbours.
    Ideology flips require causes (crisis, war loss,
    depression, IG radicalism, coup) above encoded
    thresholds.


10.3 Events
    Trigger + mean-time-to-happen + 2–3 choices with
    previewed effects. No hidden gotchas.
    Prefer emergent events fired by sim state (famine,
    strike, crash, breakthrough, refugee crisis, IG demand)
    over date scripts.
    Event templates with variables ( {country} ,
     {province} , {ig} , {leader} ) let one event serve
    every nation.




11. Tech, Ideas, Diplomacy, War
Tech: 8 trees (Industry, Computing, Energy, Land, Naval,
                                             →
Air/Aerospace, Biomedicine, Society), 1936 2026. Every
tech unlocks something concrete. Speed from points,
universities, scientists, literacy. Diffusion discount from
neighbours and trade partners; ahead-of-time penalty.

Ideas: 9 groups (3 ADM, 3 DIP, 3 MIL), 7 ideas each, era-
appropriate. Plus national ideas.

Diplomacy: relations, alliances, guarantees, blocs, trade
agreements, customs unions, claims, puppets,
independence wars, international organisations (founded,
captured, or collapsed). World Tension becomes Global
Stability and Great-Power Competition after the first major
war.

War (EU4-style, readable):

       Armies are stacks; manpower, equipment from the
       goods economy, supply, organisation.
       Daily battles with visible modifiers; a battle report
       explains the result.
       Occupation   → war score → peace deal screen (annex,
       puppet, change government, reparations, demilitarise,
       release). Deals set flags for future revenge or
       reconciliation.
       Nukes from the 1940s with deterrence AI and severe,
       clearly shown costs.
       Auto-command: assign an army to a front and
       objective; AI handles movement.




12. AI
   Personality per nation-leader (Builder, Expansionist,
   Diplomat, Ideologue, Isolationist) weighting priorities.
   Utility scoring per domain each month (develop, build,
   research, focus, diplomacy, war, IG management). Each
   evaluator scores Commands using getStat , so AI
   understands the same numbers the player sees.
   Strategic goal re-evaluated yearly (hegemony,
   industrialise, join bloc, survive), steering focuses,
   alliances, and privileges.
   Consistency: no ideology flips without causal triggers.
   Anti-blob: coalitions, overextension unrest, occupation
   resistance, IG radicalism.
   Debug: ai_why <tag> prints the top 3 scored options
   per domain.
   Cheap AI for minors: minor nations run monthly on a
   reduced evaluator set, every 3 months for non-urgent
   domains.




13. UX & UI

13.1 Layout
   Top bar: date/speed, treasury (+monthly delta),
   ADM/DIP/MIL, PP, manpower, stability, war support. All
   clickable.
   Map with modes on keys 1–0: Political, Development,
   Population, SoL, Ideology, Unrest, GDP/capita, Markets,
   Diplomacy, IG Clout.
   Left dock tabs (F1–F9): Government, Economy,
   Population, Interest Groups, Military, Diplomacy,
   Technology, Ideas, Focus.
   Right: Alerts column — the most important ease-of-play
   feature. Actionable icons ("ADM near cap", "Focus
   done", "Trade Unions radicalising", "Unemployment 14%
   in Lancashire", "Bankruptcy in 8 months", "Enemy near
   capital"). Click to jump. Each alert type can be muted.
   Bottom: selected province/army/IG card. Outliner:
   armies, construction, focuses, wars, restless IGs.


13.2 Ease-of-play (required)
   Nested tooltips (hover terms inside tooltips; hold Shift
   to lock).
   Breakdown on every number via the modifier system.
   Greyed buttons explain why (from
    Command.validate ).

   Action previews: hovering a button shows its effects
   before committing.
   Guided start: per-nation "First Steps" card with 3 goals
   for year one.
   Tutorial: skippable, ~15 minutes, covering development,
   economy, IGs, focuses, and war.
   Automation menu: auto-develop, auto-construct, auto-
   research, auto-advisors, auto-privileges. Each toggle, so
   beginners can master one system at a time.
   Undo last non-time-advancing action. Ctrl+K search for
   anything.
   Graphs for population, GDP, prices, ideology, IG clout;
   compare nations.
    Ledger (F10): sortable tables of all nations by any stat.
    Chronicle: auto-generated history timeline.
    Century Report at 2026: map then vs now, rankings,
    your story, notable leaders, IG shifts, divergence score.
    Accessibility: colour-blind palettes, UI scale 75–150%,
    rebindable keys.
    Feedback: snappy animations and cues on key actions;
    sound hooks for later.


13.3 Visual style
"Modern war-room": muted parchment/steel palette, strong
typography, era-tinted accents (art-deco   → modernist → flat
digital) shifting through the decades. Readability beats
ornament.




14. Fun Features That Earn Their Keep
Add these where their milestone lands. Each is small to
build but large for replay value.

    Quick-start scenarios (M3): 1936 Europe-only test start
    for fast iteration, plus later bookmark starts (1946,
    1962, 1991) generated by running AI-only from 1936
    with a fixed seed.
    "What If" world seeds (M8): a seed screen with sliders
    for historical bias vs chaos, AI aggression, and
    economic volatility.
    Rival system (M6): the game picks 1–3 rivals for you
    based on proximity and power; beating them gives
    prestige and PP.
    Ambitions (M5): every nation gets 3 long-term
    ambitions (e.g. "Become a nuclear power", "Unite
    Scandinavia") that reward points and feed the Century
    Report.
    Headline ticker (M5): a newspaper strip of era-flavoured
    headlines from real sim events ("Steel prices soar as
    Ruhr strikes enter third week").
    Achievements (M9): 30+ for alternate-history feats and
    efficient play. Ironman mode with no console.
    Observer mode (M8): watch the AI play a century, with
    the ticker and Chronicle running.




15. Milestones
Each milestone has Read (brief sections to load), Build, and
Exit (all must pass). On finishing: tests green, game runs,
CHANGELOG.md entry, git tag m<N> , CLAUDE.md status
updated.


M0 — Foundations
    Read: §1, §3
    Build: repo, strict TS, Vite + React, Vitest, worker bridge,
    seeded RNG, world tables, modifier system, command
    system, tick scheduler (empty systems in fixed order),
    Zod schemas, save/load, npm test / bench /
     lint:content , CLAUDE.md

    Exit: save/load round-trip test passes; determinism test
    passes on an empty world; getStat returns a
    breakdown; a dummy command validates and applies


M1 — Map & World
    Read: §2, §3.6, §4, §13.1
    Build: scripts/build-map.ts from Natural Earth         →
    ~250 provinces with adjacency and terrain; 1936
    countries, borders, capitals, colours; Pixi map with
    pan/zoom/hover/select; Political + Development
    modes; province panel; top bar with date; time controls
    and speeds; Europe-only quick start
    Exit: map at 60 fps; clicking any province shows owner
    and data; time runs and pauses


M2 — Population & Economy (foundation; spend the
effort here)
    Read: §6, §8
    Build: build-pops.ts and 1936 country table; pops,
    demography, migration, mobility; 14 goods, buildings,
    production methods, markets, prices, wages, needs,
    SoL, budget, debt, inflation; headless-run script;
    Population and Economy panels with graphs and
    breakdown tooltips; Population and SoL map modes
                                                   →
    Exit: all §6.4 calibration tests pass on a 1936 2026 AI-
    free run (state construction auto-managed); economy
    sanity tests pass (no negative stocks, prices in clamp,
    budgets balance to the cent, population conserved
    except births/deaths/migration); bench within budget


M3 — The Core Loop (first playtest gate)
    Read: §5, §13, §14 (quick-start)
   Build: monarch points, PP, development, construction
   UI, laws (economic, mobilisation, migration, education),
   stability/unrest, alerts column, outliner, greyed-button
   reasons, action previews, Ctrl+K, automation toggles,
   undo
   Exit: as Germany or the USA, a new player plays 10
   years making 20+ meaningful decisions without
   confusion. Stop and report to the user: what to try, what
   feels off, what you'd tune


M4 — Characters & Interest Groups
   Read: §7, §9
   Build: characters, lifespans, cabinet, high command,
   leader development, procedural portraits; 8 IGs with
   clout, approval, privileges, radicalism; IG-driven law
   support, elections, coups; IG panel and map mode
   Exit: unit tests for clout/approval; a scripted 20-year
   test where ignoring Trade Unions during
   industrialisation produces strikes or radicalism


M5 — Focuses, Events & Consistency
   Read: §10, §14 (ambitions, ticker)
   Build: focus engine + auto-layout; 8 major trees (1930s
   branches first, era sub-trees stubbed); generic modular
   trees; event engine with templates; ~60 emergent
   events; flags; content linter; ambitions; headline ticker
   Exit: linter clean; every major branch reachable in a test
   harness that forces choices


M6 — Diplomacy & War
   Read: §11, §14 (rivals)
   Build: diplomacy actions, blocs, trade agreements,
   claims, puppets; armies, movement, supply, daily
   combat, battle report, sieges, war score, peace deals,
   nukes, auto-command; AI diplomacy and war
   evaluators; rivals
   Exit: AI-only run reaches 1950 with at least one major
   war that ends in a peace deal; no instant wipes; battle
   reports explain outcomes


M7 — Tech, Ideas & Eras
   Read: §11, §4 (eras), §8.1
   Build: 8 tech trees to 2026; 9 idea groups; diffusion;
   remaining goods and production methods; era
   transitions and UI theming; complete era sub-trees for
   the 8 majors
   Exit: an AI-only run unlocks plausible tech by decade
   (computers by the 1960s–70s, internet by the 1990s,
   ±15 years)


M8 — AI & Century Balance (second playtest gate)
   Read: §12, §14 (seeds, observer), §6.4
   Build: strategic goals, personalities, minor-nation cheap
   AI, ai_why ; scripts/century-report.ts ; 20-seed
   batch runner; world seed sliders; observer mode
   Exit: 20 seeded runs all reach 2026; all calibration tests
   pass; no nation owns >25% of world land; at least 3
   distinct "world shapes" across runs. Stop and report
   with the batch summary
M9 — Polish
    Read: §13.2, §14
    Build: tutorial, guided starts, Century Report screen,
    Chronicle, Ledger, achievements, Ironman, accessibility,
    bookmark starts, performance pass
    Exit: Definition of Done (§18) met for the 8 majors


M10+ — Breadth
Expand to ~600 provinces, 20–25 focus trees, more
historical characters, events, and goods. Each content drop
must keep the linter, calibration, and bench green.




16. Model & Effort Guide

  Milestone     Model        Effort       Budget tip


                                          Boilerplate, but
                                          modifier/command
                Sonnet
  M0                         Medium       design matters.
                5.5
                                          Haiku 4.5 is fine for
                                          scaffolding alone

                Sonnet       Low–         Data pipeline +
  M1
                5.5          Med          rendering


  M2            Fable        High         Most valuable
                5.1          (plan)       expensive session
                plans   →                 in the project
                Sonnet
Milestone   Model       Effort   Budget tip

            5.5
            builds


            Opus                 Game feel and UX
M3                      High
            5.5                  judgment


            Opus
            5.5

M4
            plans   →   Medium   Clear spec
            Sonnet
            5.5
            builds

            Fable
            5.1
            (engine
                                 Content is
            + linter)
M5
            →           High     repetitive; engine is
                                 subtle
            Sonnet
            5.5 (tree
            content)


            Opus                 Combat balance
M6                      High
            5.5                  and war economy


            Sonnet
M7                      Medium   Mostly content
            5.5


            Fable                Multi-decade AI +
M8                      Max
            5.1                  balance debugging

            Opus                 UX taste, tutorial
M9                      Medium
            5.5                  writing
  Milestone      Model        Effort      Budget tip


                 Sonnet
                 5.5 /                    Bulk content and
  M10+                        Low
                 Haiku                    name lists
                 4.5


Token rules: fresh session per task ( /clear after each
chunk); load only CLAUDE.md + listed sections; quiet test
output; scripts for bulk data; escalate to a stronger model
only for a bug that failed twice, then drop back.




17. Testing & Debug Tools
    Unit: every formula (prices, births/deaths, wages,
    combat, IG clout/approval, dev cost).
    Determinism: same seed     → byte-identical save at 1950.
    Calibration (§6.4) and economy sanity (§M2 exit).
    Content: schema + consistency linter.
    Bench: §3.6 thresholds.
    Console (dev builds): tag , add_adm/dip/mil ,
     add_pp , money , set_flag , run_years N , explain
    <stat> <scope> , ai_why <tag> , ig <tag> ,
     observe .

    Sim inspector: raw state of any entity.




18. Definition of Done (v1.0)
A player can:

    Start as any 1936 nation and feel competent within 5
    minutes.
    Run the loop (spend points, develop, build, pick focuses,
    manage pops, markets, and IGs) and see effects on real
    simulated people, prices, and politics.
    Fight wars whose peace terms reshape the following
    decades.
    Watch leaders age and die, and IGs rise and fall with the
    economy.
    Reach 2026 in a world shaped by every nation's choices
    and read its story in the Century Report.
    Want to immediately start another run as someone
    else.




19. CLAUDE.md Template (create in M0,
keep under 120 lines)

  # Iron & Empire — Working Memory
  ## Current milestone: M<N> — <name>           Status:
  <in progress / done>
  ## Next task: <one line>
  ## Golden rules: (copy §1 as one-liners)
  ## Stack & commands: npm run dev | test | bench
  | lint:content | headless -- --years N --seed S
  ## Architecture pointers: modifiers in
  src/sim/modifiers.ts, commands in
  src/sim/commands.ts, tick order in
  src/sim/tick.ts
  ## Key constants: (file paths, not values)
  ## Known issues / tuning notes: (max 10 bullets,
  prune old ones)
  ## Decisions: see docs/decisions.md




20. Session Kickoff Prompts (copy-
paste)
First session

   Read IRON_AND_EMPIRE_BRIEF_v2.md fully. Create
   CLAUDE.md from §19. Then start M0. Work until M0's
   exit criteria pass, commit, tag m0, and update
   CLAUDE.md.

Every later session

   Read CLAUDE.md, then the brief sections listed under
   "Read" for the current milestone. Continue the next task.
   Stop at the end of the milestone or when the context
   gets long; update CLAUDE.md before stopping.

Bug escalation (stronger model)

   Read CLAUDE.md. Bug: <symptom>. Failing test:
   <name>. Find the root cause, fix it, add a regression test,
   and note the cause in CLAUDE.md. Don't refactor
   unrelated code.

End of brief.
