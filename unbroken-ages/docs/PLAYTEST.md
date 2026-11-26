# First playtest guide

Thank you for playing. This build is the first one meant for people outside the project. Everything in the design
documents is in it, from the Ancient era to the three Divergence futures. It will still have rough edges: play the way
you normally would, and tell us where it confuses you, bores you or breaks.

## Getting it running

1. Install the [.NET 8 SDK](https://dotnet.microsoft.com/download) and **Godot 4.3, .NET edition**.
2. From the repository root: `dotnet build godot/UnbrokenAges.Client.csproj`.
3. Open `godot/project.godot` in Godot and press **Play** (F5). The first launch imports the art (a minute or two).

## Recommended first game

| Setting | Use | Why |
|---|---|---|
| Map size | Small (64×40, the default) | room to expand; wars arrive in the Classical era |
| AI players | 3 | a full game takes an evening |
| Disasters & climate | Standard | |
| Era pacing | Standard | |
| City-states | -1 (one per civilization) | |
| Nation | any. The dossier shows how each plays | Egypt, Rome or England are gentle starts; Venice and the Haudenosaunee are for a second game |

Your Settler is selected: press **B** to found your capital. The **advisor** at the top of the screen then teaches the
first game a step at a time (research, production, exploring, builders, expanding, districts, neighbours, government, war,
trade); each tip leaves when you have done what it says. The Esc menu turns it off or starts the lessons over. Then follow
the big button at the bottom right. It always
names the next thing that needs you (research, a civic, production, a unit waiting for orders) and becomes **NEXT TURN**
when nothing does.

## Controls

| Do this | How |
|---|---|
| Select a unit or city | Left-click (click a city again to cycle through the units inside) |
| Move or attack | Right-click a tile; hovering an enemy shows the combat preview, every modifier listed |
| Found city · Fortify | B · F |
| Skip a unit for this turn | Space (or **Skip** in the unit panel) |
| End the turn | Enter, or the turn button |
| Research and civics | T |
| Diplomacy, city-states, World Congress | P |
| Society: government, policy cards, faith, great people, ages | G |
| Espionage | E |
| Chronicle · Divergence | C · V |
| Supply lens · Resource lens | L · R |
| Yield lens | Y |
| Quick save · quick load | F5 · F9 |
| Pan · zoom · close a screen | WASD or arrows · mouse wheel · Esc |

## What to look at

1. **The first 50 turns.** Is it clear what to do next? Do you find your first city sites, builders and research choices
   without a manual?
2. **Your first war.** Read the combat preview before you attack. The roster now runs through every era: Spearmen and
   Pikemen stop cavalry, Catapults to Artillery break walls but fight troops badly. Aircraft fly from your cities and
   carriers; Fighters intercept enemy strikes in their range. Does the
   preview tell you enough? Do battles feel fair?
3. **Upgrades.** Units in your own territory upgrade along their line (Warrior → Swordsman → Musketman → Line Infantry →
   Infantry → Mechanized Infantry). Does the unit panel make the choice clear?
4. **The look of the ages.** Towns change with what you research: tents and longhouses, stone keeps, walled burghs,
   half-timbered Renaissance towns, brick factory towns, offices and skylines, then the futures. Units are period
   soldiers, riders on horses, elephants and camels, tanks of each war, triremes to destroyers. Tell us if anything looks
   wrong, too small or out of its era.
5. **The AI.** It settles, builds, trades, sends envoys, votes in Congress and goes to war. It spares a rival's last city
   until turn 150. Tell us if it is too passive, too aggressive or does something silly.
6. **Victory.** Score, Hegemony, Culture, Spiritual, Concord, Exodus and Ascension are all in. Did you see a path to one?
   Did a rival nearly win before you noticed?

## Known limitations

- **Loading is single-player.** In multiplayer, the host saves and restarts from the save.
- **Balance is from simulations.** Eight AI civilizations over 300 turns typically leave 3–4 standing. Human players will
  find things the AI does not.

## Reporting a problem

Please include:

- **What you did and what you expected.** One or two sentences is plenty.
- **A screenshot.**
- **A save from just before the problem.** Press F5. The quick save is at `user://saves/quicksave.uasave`:
  - Linux: `~/.local/share/godot/app_userdata/Unbroken Ages/saves/`
  - Windows: `%APPDATA%\Godot\app_userdata\Unbroken Ages\saves\`
  - macOS: `~/Library/Application Support/Godot/app_userdata/Unbroken Ages/saves/`
- **The Chronicle (C)** if the story of the game matters: it is a dated history of everything that happened.

Crashes write to Godot's log in the same `app_userdata` folder (`logs/godot.log`).
