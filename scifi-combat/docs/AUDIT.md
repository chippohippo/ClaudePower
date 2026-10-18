# Audit: Emberfall against the best competitive shooters

How the game looked to someone opening it for the first time, against what reviewers praise and
punish in the best competitive multiplayer shooters, and the five things built from it.

## Method

- **Played and screenshotted every screen** in Chromium at 1600×900, at 32v32 on the trenches: the
  start menu, the loading screen, deploying, a fight (moving up, aiming, firing), the call-in panel,
  the pause menu, being killed, waiting to redeploy, the end of a match; the commander's seat and the
  dusk city from the rounds before. `screenshots/audit/` has the "before"; `screenshots/polish/` has
  the same battle after, through every new screen.
- **Read what reviewers say** about twenty shooters: Battlefield 6, 1, 4 and 2042, Helldivers 2, Apex
  Legends, Valorant, Counter-Strike 2, Modern Warfare II and III, Black Ops 6, The Finals, Hell Let
  Loose, Squad, Overwatch 2, Rainbow Six Siege, Titanfall 2, Marvel Rivals, Delta Force and Arc Raiders
  (Game Informer, IGN, GameSpot, PC Gamer, Eurogamer, Polygon, Rock Paper Shotgun, VGC, PCGamesN,
  Shacknews, GamesRadar and others; sources at the end).

## What reviewers praise, most to least

1. Gun feel and damage feedback (nearly every verdict leads with it).
2. "Only in X" moments nobody scripted.
3. Distinct roles, and teamwork that pays.
4. Destruction that changes tactics.
5. Sound, as spectacle and as information.
6. Talking without voice chat: pings (Apex's is "a quiet revolution in how we communicate in games").
7. Call-ins, commanders and big toys (Battlefield 2042 was docked for leaving the commander out).
8. Vehicles fighting alongside infantry.
9. Maps and modes.
10. Progression and rewards ("a compelling reward track").
11. Quick respawns, little downtime, a deploy screen that informs.
12. AI you can read.
13. Performance and fairness.
14. Visual clarity.
15. Onboarding and practice.

And what makes a shooter feel unfinished: bugs and crashes, clunky menus, bad spawns and long walks,
big battles with no structure, blurred roles, grinds and locked features, robotic voices, deaths you
can't avoid, opacity for newcomers, thin content.

## What Emberfall already does well

Most of the list, in its systems: weighty guns with hit markers, kill confirmations, flinch, staged
reloads and brass; skyscrapers that come down on each other; ten classes per army with support items
and passives; destruction; Helldivers-style call-ins and a commander who plays to win; tanks,
hoverbikes, field guns and supply trucks; bots that talk, flank, storm and break; incoming shells you
can hear coming.

## What a reviewer would have docked, most to least

| # | Found | What reviewers say |
|---|---|---|
| 1 | **A match ended on a banner.** No scoreboard, no report, no MVP, nothing to show for it, no way back to the menu but closing the tab; nothing carried from one match to the next | Progression and rewards are praised; Battlefield 2042's scoreboard was docked for having "no usable information" |
| 2 | **A web form for a start menu.** System fonts, no art, the Deploy button below the fold at 1600×900, the controls a wall of text, the developer labs on the main screen | "Menu navigation and organization" a Battlefield 6 con; menus "a step back" (MWII) |
| 3 | **A bare loading screen**, a block of developer help showing through it; an unknown class in the URL hung "BUILDING THE FRONT…" for ever | Bugs and hangs: the first thing that makes a game feel unfinished |
| 4 | **No way to talk.** Your squad followed you, but you couldn't send it anywhere, mark an enemy or ask for a medic; you saw only what you saw | Pings: the genre's most praised communication tool; teamwork that pays |
| 5 | **Death was a timer.** No recap of what killed you, no choice of where to deploy or as what | "The new deploy screen is much more informative" (Battlefield 4); bad spawns and long walks docked everywhere |
| 6 | **Opaque.** Dozens of keys, a card of text for 25 s, no briefing of what your side has to do | "A nightmarishly opaque experience for beginners" (Hell Let Loose); Squad's "unfriendly systems" |
| 7 | Off-screen markers clipped at the screen's edge and piled on each other ("OKE SCREEN"); the kill feed over the commander's radio | Readability |
| 8 | The trenches' buildings are plain grey boxes; distant enemies sink into the orange haze | Visual clarity; Marvel Rivals docked as "hard to read" |
| 9 | No music during a match (only the stingers at the end); no announcer | Sound as spectacle |
| 10 | Options without key rebinding, colourblind modes, invert Y or separate volumes | Options and accessibility |
| 11 | No firing range or boot camp | Onboarding and practice |

## The five built

1. **Scoreboard, after-action report and career** (docs/FRONTLINE.md, "Match flow"). Hold **P** for
   both sides' boards. Ribbons come up as they're earned (Combat, Field Medic, Objective, Defender,
   Anti-Armor, Support, Recon, Teamwork). At the end, VICTORY or DEFEAT and how, the battle's ticket
   chart with the sectors as they fell, your battle (score, place, counts, ribbons, experience line by
   line and your rank's bar filling), both MVPs and boards, and **Play again**, **Main menu**, **Keep
   watching**. A career that carries over: 30 ranks, medals, totals, the last ten matches; nothing
   locked behind it.
2. **A front end** (docs/FRONTLINE.md, "Play it"). The start menu as a game's: the battlefield's key
   art, your rank, Play / Career / Controls / Settings, map cards with their art, class cards with
   their health, weapon, kit and passive from the data, the deploy bar always on screen. A loading
   screen with the battlefield's art, where you're going, a progress bar and the field manual's tips.
   An error screen with the way back instead of an endless load; an unknown class falls back to the
   army's first.
3. **Pings and squad commands** (docs/FRONTLINE.md, "Pings"). Middle mouse or **Y**: an enemy revealed
   to your whole side and your squad on him; a point to attack or defend, or a place to go, and your
   squad goes and holds it, saying so; **regroup**; need a medic or ammo, and the nearest one comes;
   danger. Hold for the ping wheel. Your side's soldiers ping what they call out. Marks in the world,
   held inside the screen's edge with an arrow when they're off it, on the minimap, with a blip.
4. **The deploy screen** (docs/FRONTLINE.md, "Deploying"). Who killed you, with what, from how far,
   with how much left, and the damage you took; then the front from above with every place you can
   deploy (the HQ, your side's quiet points, squadmates who are clear; closed ones say why), your
   class for the next life, and the countdown.
5. **The briefing and the field manual** (docs/FRONTLINE.md, "Learning the game"). What your side has
   to do as the battle starts, then the one hint you need when you need it, until you've done it.

## Next

- Readability at scale: enemies against the haze at distance (a rim or outline when spotted, a colour
  option), the trench map's buildings dressed like the city's.
- Music that follows the battle (a last stand when the tickets run low) and an announcer for the big
  moments, recorded rather than synthetic.
- Key rebinding, colourblind presets, invert Y, separate volumes.
- A firing range and a boot camp (moving, shooting, call-ins, reviving, pinging your squad).
- Performance measured on real hardware at 64v64 and 200v200.

## Sources

Game Informer on [Battlefield 6](https://www.gameinformer.com/review/battlefield-6/battle-ready), [Helldivers 2](https://www.gameinformer.com/review/helldivers-2/bullet-heaven), [The Finals](https://www.gameinformer.com/review/the-finals/appetite-for-destruction), [Apex Legends](https://www.gameinformer.com/review/apex-legends/embracing-the-new-frontier), [Battlefield 2042](https://www.gameinformer.com/review/battlefield-2042/battlefield-2042-review-the-battle-of-the-bugs) and [Arc Raiders](https://www.gameinformer.com/review/arc-raiders/consequential-and-worthwhile-multiplayer);
[PC Gamer on Apex Legends](https://www.pcgamer.com/apex-legends-review/); [VGC on Battlefield 6](https://www.videogameschronicle.com/review/battlefield-6-review/);
[Shacknews on Battlefield 6](https://www.shacknews.com/article/146365/battlefield-6-review-score) and [Battlefield 2042](https://www.shacknews.com/article/127744/battlefield-2042-review-aimless-and-shameless);
[PCGamesN on Hell Let Loose](https://www.pcgamesn.com/hell-let-loose/review-10); [GamesRadar on Helldivers 2](https://www.gamesradar.com/helldivers-2-review/);
[GameSpot on Helldivers 2](https://www.gamespot.com/reviews/helldivers-2-review-starship-bloopers/1900-6418184/); [MP1st on Battlefield 4](https://mp1st.com/features/battlefield-4-multiplayer-review-2);
[GameRevolution on Apex Legends](https://www.gamerevolution.com/review/494359-apex-legends-review-pc-ps4-xbox); [TheSixthAxis on Modern Warfare II](https://www.thesixthaxis.com/2022/10/31/call-of-duty-modern-warfare-2-review/);
[GameSkinny on Hell Let Loose](http://www.gameskinny.com/jabp3/hell-let-loose-review-hell-or-highwater); [PC Gamer on Squad](https://www.pcgamer.com/squad-review/);
[TechRadar on Marvel Rivals](https://www.techradar.com/gaming/marvel-rivals-review).
