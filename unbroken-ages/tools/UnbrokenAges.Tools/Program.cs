using System.Diagnostics;
using System.Net;
using System.Text;
using UnbrokenAges.Net;
using UnbrokenAges.Sim.AI;
using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

// Unbroken Ages developer CLI ("ua"). Everything here runs on the engine-agnostic simulation,
// which is the point: map generation, balance soak tests and dedicated servers need no renderer.
//
//   ua mapgen   [--seed N] [--size MAPSIZE_SMALL]       ASCII terrain + hydrology preview
//   ua validate [modDir ...]                             load base + mods, report errors / content hash
//   ua simulate [--turns N] [--seed N] [--players N]     AI-only headless game, determinism + perf
//   ua host     [--port P] [--humans N] [--ai N]         dedicated/listen Direct-IP server
//   ua join     <host[:port]> [--name X]                 headless client that plays with the baseline AI
//   ua future   [--turns N] [--seed N]                   late-game scenario: three civs, three Divergences, the world remade

var argv = args.ToList();
string command = argv.Count > 0 ? argv[0] : "help";
string Opt(string name, string fallback)
{
    int i = argv.IndexOf(name);
    return i >= 0 && i + 1 < argv.Count ? argv[i + 1] : fallback;
}

bool HasOpt(string name) => argv.Contains(name);

string repo = FindRepoRoot();
GameDatabase LoadDb(IEnumerable<string>? extraMods = null) =>
    ModLoader.LoadFromDirectories(new[] { Path.Combine(repo, "content", "base") }.Concat(extraMods ?? Array.Empty<string>()));

try
{
    switch (command)
    {
        case "mapgen": MapGen(); break;
        case "validate": Validate(); break;
        case "simulate": Simulate(); break;
        case "host": Host(); break;
        case "join": Join(); break;
        case "future": Future(); break;
        default:
            Console.WriteLine("usage: ua mapgen|validate|simulate|host|join (see Program.cs header)");
            break;
    }
}
catch (ModLoadException ex)
{
    Console.Error.WriteLine(ex.Message);
    return 1;
}
return 0;

void MapGen()
{
    var db = LoadDb();
    var size = db.MapSizes[Opt("--size", "MAPSIZE_SMALL")];
    var settings = new MapGenSettings
    {
        Seed = ulong.Parse(Opt("--seed", "7")), Width = size.Width, Height = size.Height,
        Players = size.DefaultPlayers, GreatRivers = size.GreatRivers,
    };
    var sw = Stopwatch.StartNew();
    var g = MapGenerator.Generate(db, settings);
    Console.WriteLine($"{size.Name} {size.Width}x{size.Height}, seed {settings.Seed}: generated in {sw.ElapsedMilliseconds} ms");
    Console.WriteLine(g.Stats);
    Console.WriteLine($"great rivers: {string.Join(", ", g.GreatRivers.Select(r => r.Count + " tiles"))}");
    Console.WriteLine();
    Console.WriteLine(MapAscii.Terrain(g));
    Console.WriteLine(MapAscii.Hydrology(g));
}

void Validate()
{
    var mods = argv.Skip(1).Where(a => !a.StartsWith("--")).ToList();
    var db = LoadDb(mods);
    Console.WriteLine($"OK — {string.Join(", ", db.LoadedMods)}");
    Console.WriteLine($"content hash {db.ContentHash:X16}");
    Console.WriteLine($"{db.Districts.Count} districts, {db.Buildings.Count} buildings, {db.Units.Count} units, {db.Techs.Count} techs, " +
                      $"{db.Civics.Count} civics, {db.Governors.Count} governors, {db.Civilizations.Count} civilizations");
}

void Simulate()
{
    var db = LoadDb();
    int turns = int.Parse(Opt("--turns", "100"));
    ulong seed = ulong.Parse(Opt("--seed", "1"));
    int players = int.Parse(Opt("--players", "3"));
    int offset = int.Parse(Opt("--leader-offset", "0"));
    // One leader per nation in turn (offset 1 picks each nation's second leader), so a 6-player game seats every nation.
    var byNation = db.Civilizations.Select(c => db.Leaders.Where(l => l.CivilizationIndex == c.Index).Select(l => l.Id).ToList()).ToList();
    int nationOffset = int.Parse(Opt("--nation-offset", "0"));
    // --leaders A,B,C seats exactly these leaders (LEADER_ prefix optional); otherwise one leader per nation in turn.
    var chosen = Opt("--leaders", "").Split(',', StringSplitOptions.RemoveEmptyEntries).Select(x => x.StartsWith("LEADER_") ? x : "LEADER_" + x.ToUpperInvariant()).ToList();
    // --civs CIV_A,CIV_B seats these peoples (CIV_ prefix optional) with each one's first leader.
    foreach (var civ in Opt("--civs", "").Split(',', StringSplitOptions.RemoveEmptyEntries))
    {
        string id = civ.StartsWith("CIV_") ? civ : "CIV_" + civ.ToUpperInvariant();
        int ci = db.Civilizations.IndexOf(id);
        if (ci < 0) { Console.Error.WriteLine($"no civilization {id}"); Environment.ExitCode = 2; return; }
        chosen.Add(db.Leaders.First(l => l.CivilizationIndex == ci).Id);
    }
    if (chosen.Count > 0 && !HasOpt("--players")) players = chosen.Count;
    string LeaderFor(int i)
    {
        if (i < chosen.Count) return chosen[i];
        var ls = byNation[(i + nationOffset) % byNation.Count];
        return ls[(offset + i / byNation.Count) % ls.Count];
    }
    bool big = players > 4, huge = players > 8;
    var setup = new GameSetup
    {
        Seed = seed,
        // --map earth plays on a scripted map (MAP_EARTH) with true start locations.
        Map = new MapGenSettings { Width = huge ? 128 : big ? 84 : 64, Height = huge ? 80 : big ? 54 : 40, Seed = seed,
                                   MapId = Opt("--map", "") is { Length: > 0 } m ? (m.StartsWith("MAP_") ? m : "MAP_" + m.ToUpperInvariant()) : null },
        Players = Enumerable.Range(0, players).Select(i => new PlayerSetup { Name = $"AI {i}", Leader = LeaderFor(i) }).ToList(),
    };
    var s = GameFactory.Create(db, setup);
    var ai = new SimpleAi();
    var sw = Stopwatch.StartNew();
    var tally = new Dictionary<GameEventType, int>();
    // --report file.json: per-civ checkpoints every 25 turns, victories and eliminations, for tools/maps/earth_soak.py.
    var checkpoints = new List<object>();
    var victories = new List<object>();
    var eliminated = new Dictionary<string, int>();
    string CivName(int id) => id >= 0 && id < s.Players.Count && s.Players[id].CivIndex >= 0 ? db.Civilizations[s.Players[id].CivIndex].Id : $"p{id}";
    void RecordVictory()
    {
        if (s.Victory.AwaitingChoice) victories.Add(new { turn = s.Victory.Turn, kind = s.Victory.Kind.ToString(), winner = CivName(s.Victory.Winner) });
    }
    void Checkpoint() => checkpoints.Add(new
    {
        turn = s.Turn,
        majors = s.Players.Where(p => p.IsMajor).Select(p => new
        {
            civ = CivName(p.Id), alive = p.IsAlive && s.Cities.Any(c => c.Owner == p.Id), cities = s.CitiesOf(p.Id).Count(),
            pop = s.CitiesOf(p.Id).Sum(c => c.Population), techs = p.Techs.Count(x => x), era = s.PlayerEra(p),
            score = VictorySystem.Score(s, p.Id), units = s.Units.Count(u => u.Owner == p.Id && SupplySystem.IsMilitary(db, u)),
            atWar = MilitaryAi.MajorEnemies(s, p.Id).Count,
            // How far along each road to victory: peoples dominated by its culture, converted to its religion, its
            // diplomatic victory points, its Exodus stage, its Divergence (-1 none).
            culture = CultureSystem.Reach(s, p).Dominated, faith = p.Religion >= 0 ? ReligionSystem.Reach(s, p).Converted : 0,
            dvp = p.DiplomaticPoints, exodus = p.ExodusStage, divergence = p.Divergence, focus = VictoryAi.Focus(s, p).ToString(),
            spaceport = s.CitiesOf(p.Id).Any(c => c.Districts.Any(d => db.Districts[d.DefIndex].Id == "DISTRICT_SPACEPORT")),
        }).ToList(),
    });
    int captures = 0, wars = 0;
    var aiClock = new Stopwatch();
    var execClock = new Stopwatch();
    if (HasOpt("--profile")) { TurnProcessor.Profile = new(); SimpleAi.Profile = new(); }
    var turnClock = new Stopwatch();
    for (int t = 0; t < turns; t++)
    {
        var events = new List<GameEvent>();   // the AI's own actions (captures, declarations) and the turn's resolution
        aiClock.Start();
        foreach (var p in s.Players.Where(p => p.IsMajor))
        {
            var planned = ai.TakeTurn(s, p.Id).ToList();
            execClock.Start();
            foreach (var cmd in planned) CommandProcessor.Execute(s, cmd, events);
            execClock.Stop();
        }
        aiClock.Stop();
        RecordVictory();
        ContinueIfWon(s);
        turnClock.Start();
        CommandProcessor.Execute(s, new AdvanceTurnCommand { Player = GameCommand.SystemPlayer, ExpectedTurn = s.Turn }, events);
        turnClock.Stop();
        RecordVictory();
        ContinueIfWon(s);
        foreach (var e in events)
        {
            if (e.Type == GameEventType.PlayerEliminated) eliminated.TryAdd(CivName(e.Player), s.Turn);
            if (e.Type == GameEventType.CityCaptured) captures++;
            if (e.Type == GameEventType.WarDeclared) wars++;
        }
        if (s.Turn % 25 == 0) Checkpoint();
        foreach (var e in events) tally[e.Type] = tally.GetValueOrDefault(e.Type) + 1;
        if (Opt("--trace-civ", "") is { Length: > 0 } traced)
            foreach (var e in events.Where(e => e.Type is GameEventType.CityCaptured or GameEventType.CityFlipped or GameEventType.CityDeclaredIndependence
                                                   or GameEventType.CityPurchased or GameEventType.WarDeclared or GameEventType.PeaceSigned or GameEventType.PlayerEliminated))
            {
                string Name(int id) => id >= 0 && id < s.Players.Count && s.Players[id].CivIndex >= 0 ? db.Civilizations[s.Players[id].CivIndex].Name : $"p{id}";
                string line = $"   [t{s.Turn}] {e.Type} by {Name(e.Player)} (value {Name(e.Value)}) {e.Detail}";
                if (line.Contains(traced)) Console.WriteLine(line);
            }
        if (s.Turn % 25 == 0 && HasOpt("--nations"))
            Console.WriteLine($"   t{s.Turn}: " + string.Join(" | ", s.Players.Where(p => p.IsMajor).Select(p =>
                $"{(p.CivIndex >= 0 ? db.Civilizations[p.CivIndex].Name[..3] : "?")} c{s.CitiesOf(p.Id).Count()} o{s.Outposts.Count(o => o.Owner == p.Id)} u{s.Units.Count(u => u.Owner == p.Id)} g{p.Gold.FloorToInt()} w{MilitaryAi.MajorEnemies(s, p.Id).Count}")));
        if (s.Turn % 25 == 0)
            Console.WriteLine($"turn {s.Turn,4}: cities={s.Cities.Count} pop={s.Cities.Sum(c => c.Population)} districts={s.Cities.Sum(c => c.Districts.Count - 1)} " +
                              $"techs={s.Players.Sum(p => p.Techs.Count(x => x))} CO2={s.Climate.Co2Ppm}ppm T=+{s.Climate.Temperature}°C phase={s.Climate.Phase} " +
                              $"| world: {WorldSystem.CurrentAge(s)?.Name ?? "an ordinary age"} (progress {s.World.Progress.FloorToInt()}, strife {s.World.Strife.FloorToInt()}, calamity {s.World.Calamity.FloorToInt()})");
    }
    Console.WriteLine($"{turns} turns in {sw.ElapsedMilliseconds} ms ({sw.Elapsed.TotalMilliseconds / turns:0.0} ms/turn)");
    Console.WriteLine($"time: AI {aiClock.ElapsedMilliseconds} ms (of which executing its commands {execClock.ElapsedMilliseconds} ms), turn resolution {turnClock.ElapsedMilliseconds} ms");
    if (SimpleAi.Profile != null)
        Console.WriteLine("AI profile: " + string.Join(", ", SimpleAi.Profile.OrderByDescending(k => k.Value).Select(k => $"{k.Key} {k.Value:0} ms")));
    // --dump-civ CIV_X: that people's research, cities and units at the end (to see why it is stuck).
    if (Opt("--dump-civ", "") is { Length: > 0 } dumpCiv)
        foreach (var p in s.Players.Where(p => p.IsMajor && p.CivIndex >= 0 && db.Civilizations[p.CivIndex].Id.Contains(dumpCiv.ToUpperInvariant())))
        {
            Console.WriteLine($"{db.Civilizations[p.CivIndex].Name}: era {s.PlayerEra(p)}, gold {p.Gold.FloorToInt()}, researching {(p.CurrentTech >= 0 ? db.Techs[p.CurrentTech].Id : "-")}");
            Console.WriteLine("  techs: " + string.Join(" ", db.Techs.Where(t => p.Techs[t.Index]).Select(t => t.Id[5..])));
            var snap = LoyaltySystem.Snapshot(s);
            foreach (var c in s.CitiesOf(p.Id))
            {
                var lb = LoyaltySystem.Compute(s, c, snap);
                Console.WriteLine($"  city {c.Name} pop {c.Population} at {c.Tile % s.Map.Width},{c.Tile / s.Map.Width} loyalty {c.Loyalty} ({lb.Total}: dom {lb.DomesticPressure} for {lb.ForeignPressure} | " +
                                  string.Join(", ", lb.Lines().Select(l => $"{l.Label} {l.Value}")) + ")");
            }
            foreach (var u in s.Units.Where(u => u.Owner == p.Id))
            {
                Console.WriteLine($"  unit {db.Units[u.DefIndex].Id} at {u.Tile % s.Map.Width},{u.Tile / s.Map.Width} {(s.Map.IsWater(u.Tile) ? "(water)" : "")} dest {u.Destination} moves {u.MovesLeft}");
                if (db.Units[u.DefIndex].FoundsCity)
                {
                    int site = ExpansionAi.BestSite(s, p.Id, u.Tile, Array.Empty<int>(), u);
                    Console.WriteLine($"    best site {(site >= 0 ? $"{site % s.Map.Width},{site / s.Map.Width}" : "none")}, path {(site >= 0 ? Movement.FindPath(s, u, site)?.Count.ToString() ?? "null" : "-")}, found here: {new FoundCityCommand { Player = p.Id, UnitId = u.Id }.Validate(s) ?? "ok"}");
                }
            }
            Console.WriteLine($"  wants settler: {ExpansionAi.WantsSettler(s, p)}; best site from capital: {(s.CitiesOf(p.Id).FirstOrDefault() is { } cap ? ExpansionAi.BestSite(s, p.Id, cap.Tile, Array.Empty<int>()) : -1)}; max cities {ExpansionAi.MaxCities(s, p)}");
        }
    if (TurnProcessor.Profile != null)
        Console.WriteLine("profile: " + string.Join(", ", TurnProcessor.Profile.OrderByDescending(k => k.Value).Take(24).Select(k => $"{k.Key} {k.Value:0} ms")));
    if (Opt("--report", "") is { Length: > 0 } reportPath)
    {
        Checkpoint();
        var report = new { map = setup.Map.MapId, seed, turns, msPerTurn = sw.Elapsed.TotalMilliseconds / turns, captures, wars, victories, eliminated, checkpoints };
        File.WriteAllText(reportPath, System.Text.Json.JsonSerializer.Serialize(report));
        Console.WriteLine($"report: {reportPath}");
    }
    Console.WriteLine("events: " + string.Join(", ", tally.OrderBy(k => k.Key).Select(k => $"{k.Key}={k.Value}")));
    Console.WriteLine("score: " + string.Join(", ", s.Players.Where(p => p.IsMajor).Select(p => $"{p.Name} {VictorySystem.Score(s, p.Id)}")));
    Console.WriteLine("nations:");
    foreach (var p in s.Players.Where(p => p.IsMajor))
    {
        string nation = p.CivIndex >= 0 ? db.Civilizations[p.CivIndex].Name : "-";
        string leader = p.LeaderIndex >= 0 ? db.Leaders[p.LeaderIndex].Name : "-";
        var cities = s.CitiesOf(p.Id).ToList();
        Console.WriteLine($"  {nation,-11} {leader,-20} alive={p.IsAlive,-5} cities={cities.Count,2} pop={cities.Sum(c => c.Population),3} techs={p.Techs.Count(x => x),2} " +
                          $"civics={p.Civics.Count(x => x),2} gold={p.Gold.FloorToInt(),5} units={s.Units.Count(u => u.Owner == p.Id),2} score={VictorySystem.Score(s, p.Id),4} " +
                          $"signature: {NationSystem.Status(s, p)} (tally {p.SignatureTally})");
        Console.WriteLine($"  {"",-11} society: {(p.Government >= 0 ? db.Governments[p.Government].Name : "none")} [{string.Join(", ", p.Policies.Select(c => db.Policies[c].Name))}] " +
                          $"pantheon={(p.Pantheon >= 0 ? db.Beliefs[p.Pantheon].Name : "-")} religion={(p.Religion >= 0 ? db.Religions[p.Religion].Name : "-")} " +
                          $"followers={s.Cities.Count(c => p.Religion >= 0 && c.Religion == p.Religion)} greatPeople={p.GreatPeopleRecruited.Sum()} age={p.Age} " +
                          $"wonders=[{string.Join(", ", SocietySystem.Wonders(s, p.Id).Select(w => w.Name))}] promoted={s.Units.Count(u => u.Owner == p.Id && u.Promotions.Count > 0)}");
    }
    foreach (var cs in s.Players.Where(p => p.IsCityState))
        Console.WriteLine($"  city-state {cs.Name,-11} {db.CityStates[cs.CityStateIndex].Type,-12} alive={cs.IsAlive,-5} envoys=[{string.Join(",", cs.Envoys)}] " +
                          $"suzerain={(cs.Suzerain >= 0 ? s.Players[cs.Suzerain].Name : "-")} met={s.Players.Count(m => m.IsMajor && CityStateSystem.HasMet(s, cs, m.Id))} units={s.Units.Count(u => u.Owner == cs.Id)}");
    Console.WriteLine($"trade routes={s.TradeRoutes.Count} (" + string.Join(", ", s.Players.Where(p => p.IsMajor).Select(p => $"{p.Name} {TradeSystem.Active(s, p.Id)}/{TradeSystem.Capacity(s, p)}")) + ")");
    Console.WriteLine("spies: " + string.Join(", ", s.Players.Where(p => p.IsMajor).Select(p => $"{p.Name} {p.Spies.Count} [{string.Join(" ", p.Spies.Select(x => $"{x.Name}:{EspionageSystem.Ranks[x.Level][..1]}:{x.Mission}"))}]")));
    Console.WriteLine("culture: " + string.Join(", ", s.Players.Where(p => p.IsMajor && p.IsAlive).Select(p =>
        $"{p.Name} tourism {CultureSystem.Tourism(s, p)} domestic {CultureSystem.Domestic(p)} reach {CultureSystem.Reach(s, p).Dominated}/{CultureSystem.Reach(s, p).Total} works {s.GreatWorks.Count(g => g.Owner == p.Id)}")));
    Console.WriteLine($"congress: sessions {s.Congress.Sessions}, in force [{string.Join("; ", s.Congress.Active.Select(a => $"{CongressSystem.Info(a.Kind).Name} {(a.Option == 0 ? "A" : "B")}{(a.Target >= 0 ? " " + s.Players[a.Target].Name : "")}"))}] · " +
                      string.Join(", ", s.Players.Where(p => p.IsMajor && p.IsAlive).Select(p => $"{p.Name} favor {p.Favor} DVP {p.DiplomaticPoints}")));
    Console.WriteLine("space: satellites " + s.Satellites.Count + " · " + string.Join(", ", s.Players.Where(p => p.IsMajor && p.IsAlive).Select(p => $"{p.Name} exodus {p.ExodusStage}")));
    Console.WriteLine($"camps={s.Camps.Count} raiders={s.Units.Count(u => s.Players[u.Owner].IsFreeCities)} " +
                      $"natural wonders={Enumerable.Range(0, s.Map.Count).Count(t => s.Map.Feature[t] >= 0 && db.Features[s.Map.Feature[t]].NaturalWonder)}");
    Console.WriteLine($"final state hash {GameStateSerializer.Hash(s):X16} ({GameStateSerializer.Serialize(s).Length / 1024} KiB snapshot)");
    Console.WriteLine();
    Console.WriteLine($"THE CHRONICLE ({s.Chronicle.Count} entries, last 12)");
    foreach (var entry in s.Chronicle.TakeLast(12)) Console.WriteLine("  " + entry.Text);
}

void Host()
{
    var db = LoadDb();
    int port = int.Parse(Opt("--port", Protocol.DefaultPort.ToString()));
    int humans = int.Parse(Opt("--humans", "2"));
    int ais = int.Parse(Opt("--ai", "1"));
    var leaders = db.Leaders.Select(l => l.Id).ToList();
    var setup = new GameSetup
    {
        Seed = (ulong)Environment.TickCount64,
        Map = new MapGenSettings { Width = 64, Height = 40 },
        Players = Enumerable.Range(0, humans + ais).Select(i => new PlayerSetup { Name = i < humans ? $"Player {i}" : $"AI {i}", IsHuman = i < humans, Leader = leaders[i % leaders.Count] }).ToList(),
    };
    using var host = new HostSession(db, new TcpServerTransport(port, IPAddress.IPv6Any), setup, new HostOptions { LocalSlot = -1, GameName = Opt("--name", "Dedicated server") });
    using var beacon = new LanBeaconBroadcaster();
    host.Start();
    Console.WriteLine($"Dedicated server on port {host.Port}. Waiting for {humans} players... (Ctrl+C to stop)");
    bool started = false;
    while (true)
    {
        host.Poll();
        beacon.Tick(new LanBeacon(Opt("--name", "Dedicated server"), host.Port, Enumerable.Range(0, humans).Count(host.IsSlotConnected), humans, false, Protocol.Version, db.ContentHash));
        if (!started && Enumerable.Range(0, humans).All(host.IsSlotConnected))
        {
            host.StartGame();
            started = true;
            Console.WriteLine("All players connected — game started.");
        }
        foreach (var line in host.Log) Console.WriteLine(line);
        host.Log.Clear();
        Thread.Sleep(5);
    }
}

void Join()
{
    var db = LoadDb();
    if (argv.Count < 2 || !DirectIpEndpoint.TryParse(argv[1], out var ep)) { Console.WriteLine("usage: ua join <host[:port]>"); return; }
    using var client = new ClientSession(db, TcpClientTransport.FromEndpoint(ep), new ClientOptions { PlayerName = Opt("--name", "Bot") });
    client.Connect();
    var ai = new SimpleAi();
    int playedTurn = 0;
    Console.WriteLine($"Connecting to {ep}...");
    while (client.IsConnected && client.RejectReason == null)
    {
        client.Poll();
        if (client.State is { } s && client.Slot >= 0 && s.Turn != playedTurn && client.PendingCommands.Count == 0)
        {
            playedTurn = s.Turn;
            foreach (var cmd in ai.TakeTurn(s, client.Slot)) client.Submit(cmd);
            Console.WriteLine($"turn {s.Turn}: submitted orders as slot {client.Slot} (hash {GameStateSerializer.Hash(s):X16})");
        }
        Thread.Sleep(5);
    }
    Console.WriteLine(client.RejectReason ?? "Disconnected.");
}

void Future()
{
    var db = LoadDb();
    int turns = int.Parse(Opt("--turns", "120"));
    ulong seed = ulong.Parse(Opt("--seed", "7"));
    var paths = new[] { "DIVERGENCE_SOVEREIGN", "DIVERGENCE_SYMBIONT", "DIVERGENCE_DISCARNATE" };
    var setup = new GameSetup
    {
        Seed = seed,
        Map = new MapGenSettings { Width = 64, Height = 40, Seed = seed, LandPercent = 40 },
        Options = new GameOptions { DisasterIntensity = 2 },
        Players = new()
        {
            new PlayerSetup { Name = "Egypt", Leader = "LEADER_THUTMOSE" },
            new PlayerSetup { Name = "Venice", Leader = "LEADER_DANDOLO" },
            new PlayerSetup { Name = "Song", Leader = "LEADER_TAIZU_SONG" },
        },
    };
    var s = GameFactory.Create(db, setup);
    FutureScenario.Build(s, paths);
    Console.WriteLine($"THE DIVERGENCE — {turns} turns after the Threshold (seed {seed})");
    foreach (var p in s.Players.Where(p => p.IsMajor))
        Console.WriteLine($"  {p.Id + 1} {p.Name,-7} → {db.Divergences[p.Divergence].People,-16} \"{db.Divergences[p.Divergence].Creed}\"");
    Console.WriteLine();
    Console.WriteLine(FutureScenario.Render(s, "THE WORLD AT THE THRESHOLD"));

    var ai = new SimpleAi();
    var tally = new Dictionary<GameEventType, int>();
    for (int t = 0; t < turns; t++)
    {
        var events = new List<GameEvent>();   // the AI's own actions (captures, declarations) and the turn's resolution
        foreach (var p in s.Players.Where(p => p.IsMajor))
            foreach (var cmd in ai.TakeTurn(s, p.Id)) CommandProcessor.Execute(s, cmd, events);
        ContinueIfWon(s);
        CommandProcessor.Execute(s, new AdvanceTurnCommand { Player = GameCommand.SystemPlayer, ExpectedTurn = s.Turn }, events);
        ContinueIfWon(s);
        foreach (var e in events)
        {
            tally[e.Type] = tally.GetValueOrDefault(e.Type) + 1;
            if (e.Type == GameEventType.AscensionCompleted || (e.Type == GameEventType.TechResearched && s.Db.Techs[e.Def].DivergenceIndex >= 0))
                Console.WriteLine($"  turn {s.Turn}: {s.Players[e.Player].Name} — {e.Detail}");
        }
        if ((t + 1) % 30 == 0)
        {
            var share = DivergenceSystem.WorldShare(s);
            Console.WriteLine($"  turn {s.Turn}: world remade — " + string.Join(", ", db.Divergences.Select(d => $"{d.Name} {share[d.Index]:0.0}%")) +
                              $" · CO2 {s.Climate.Co2Ppm} ppm, +{s.Climate.Temperature}°C, phase {s.Climate.Phase}");
        }
    }
    Console.WriteLine();
    Console.WriteLine(FutureScenario.Render(s, $"THE WORLD {turns} TURNS LATER"));
    Console.WriteLine("THE CHRONICLE (excerpt)");
    foreach (var entry in s.Chronicle.Where(c => c.Kind is not GameEventType.CityFounded).Take(14)) Console.WriteLine("  " + entry.Text);
    Console.WriteLine();
    Console.WriteLine("events: " + string.Join(", ", tally.Where(k => k.Key is GameEventType.WorldRemade or GameEventType.BloomEncroached
        or GameEventType.LandReclaimed or GameEventType.TileSubmerged or GameEventType.Disaster or GameEventType.AscensionCompleted).Select(k => $"{k.Key}={k.Value}")));
}

static string FindRepoRoot()
{
    var dir = new DirectoryInfo(AppContext.BaseDirectory);
    while (dir != null && !File.Exists(Path.Combine(dir.FullName, "content", "base", "mod.json"))) dir = dir.Parent;
    return dir?.FullName ?? Directory.GetCurrentDirectory();
}

// After a victory the headless tools keep playing (One More Turn), so soaks always run their full length.
static void ContinueIfWon(GameState s)
{
    if (!s.Victory.AwaitingChoice) return;
    var v = s.Victory;
    Console.WriteLine($"  turn {v.Turn}: VICTORY ({v.Kind}) for {s.Players[v.Winner].Name}; continuing with One More Turn");
    CommandProcessor.Execute(s, new OneMoreTurnCommand { Player = GameCommand.SystemPlayer }, new());
}

static class MapAscii
{
    public static string Terrain(GeneratedMap g)
    {
        var m = g.Map;
        var ids = m.Db.Ids;
        var sb = new StringBuilder("TERRAIN  ~ ocean  - coast  o lake  = GREAT RIVER  ^ mountain  % volcano  n hills  f woods  j rainforest  m marsh\n" +
                                   "         _ floodplains  , grassland  . plains  : desert  t tundra  * snow  # ice  @ start\n");
        for (int row = 0; row < m.Height; row++)
        {
            if ((row & 1) == 1) sb.Append(' ');
            for (int col = 0; col < m.Width; col++)
            {
                int i = row * m.Width + col;
                sb.Append(Glyph(g, m, ids, i)).Append(' ');
            }
            sb.AppendLine();
        }
        return sb.ToString();
    }

    private static char Glyph(GeneratedMap g, MapGrid m, WellKnownIds ids, int i)
    {
        if (g.StartTiles.Contains(i)) return '@';
        int f = m.Feature[i];
        if (f == ids.Ice) return '#';
        switch (m.ClassAt(i))
        {
            case TerrainClass.Ocean: return '~';
            case TerrainClass.Coast: return '-';
            case TerrainClass.Lake: return 'o';
            case TerrainClass.Channel: return '=';
        }
        if (m.IsMountain(i)) return f == ids.Volcano ? '%' : '^';
        if (f == ids.Forest) return 'f';
        if (f == ids.Rainforest) return 'j';
        if (f == ids.Marsh) return 'm';
        if (f == ids.Floodplains) return '_';
        if (m.Relief[i] == ids.Hills) return 'n';
        int t = m.Terrain[i];
        return t == ids.Grassland ? ',' : t == ids.Plains ? '.' : t == ids.Desert ? ':' : t == ids.Tundra ? 't' : t == ids.Snow ? '*' : '?';
    }

    public static string Hydrology(GeneratedMap g)
    {
        var m = g.Map;
        var sb = new StringBuilder("HYDROLOGY  ~ sea  o lake  = navigable GREAT RIVER (channel tiles)  + tile bordered by an edge river  ^ mountain  . dry land\n");
        for (int row = 0; row < m.Height; row++)
        {
            if ((row & 1) == 1) sb.Append(' ');
            for (int col = 0; col < m.Width; col++)
            {
                int i = row * m.Width + col;
                char c = m.ClassAt(i) switch
                {
                    TerrainClass.Ocean or TerrainClass.Coast => '~',
                    TerrainClass.Lake => 'o',
                    TerrainClass.Channel => '=',
                    _ => m.HasRiver(i) ? '+' : m.IsMountain(i) ? '^' : '.',
                };
                sb.Append(c).Append(' ');
            }
            sb.AppendLine();
        }
        return sb.ToString();
    }
}

/// <summary>Builds a late-game sandbox: every civ at the Threshold, each committed to a different Divergence.</summary>
static class FutureScenario
{
    public static void Build(GameState s, string[] paths)
    {
        var db = s.Db;
        s.Turn = 296; // the calendar reads AD 2000: a world arriving at the Threshold
        var humans = s.Players.Where(p => p.IsMajor).ToList();
        for (int i = 0; i < humans.Count; i++)
        {
            var p = humans[i];
            var settler = s.Units.First(u => u.Owner == p.Id && db.Units[u.DefIndex].FoundsCity);
            var capital = CitySystem.Found(s, p.Id, settler.Tile);
            s.RemoveUnit(settler);
            foreach (int extra in ExpansionSites(s, capital.Tile, 3)) CitySystem.Found(s, p.Id, extra);

            // Everything shared, then the chosen branch: a civilization arriving at the Threshold.
            p.Techs = db.Techs.Select(t => t.DivergenceIndex < 0).ToArray();
            p.Civics = db.Civics.Select(c => c.DivergenceIndex < 0).ToArray();
            var d = db.Divergences[paths[i % paths.Length]];
            p.Techs[d.DoctrineTechIndex] = true;
            var chosen = new List<GameEvent>();
            DivergenceSystem.OnNodeCompleted(s, p, db.Techs[d.DoctrineTechIndex], chosen);
            ChronicleSystem.Record(s, chosen, 0);
            foreach (var t in db.Techs.Where(t => t.DivergenceIndex == d.Index && t.Cost < 3400)) p.Techs[t.Index] = true;
            p.Gold = 2000;
            p.Stockpile[db.Resources.IndexOf("RESOURCE_URANIUM")] = 400;
            p.Stockpile[db.Resources.IndexOf("RESOURCE_COAL")] = 200;

            foreach (var city in s.CitiesOf(p.Id).ToList())
            {
                city.Population = 12;
                AddScenarioDistrict(s, city, "DISTRICT_FOUNDRY", "BUILDING_WORKSHOP", "BUILDING_FACTORY", "BUILDING_NUCLEAR_PLANT");
                AddScenarioDistrict(s, city, "DISTRICT_ACADEMY", "BUILDING_LIBRARY", "BUILDING_UNIVERSITY", "BUILDING_RESEARCH_LAB");
                city.Districts[0].Buildings.Add(db.Buildings.IndexOf("BUILDING_GRANARY"));
                // A few turns past commitment: each city already hosts its branch's terraforming building.
                if (d.Spread is { SourceBuildingIndex: >= 0 } spread) city.Districts[0].Buildings.Add(spread.SourceBuildingIndex);
            }
        }
    }

    private static IEnumerable<int> ExpansionSites(GameState s, int capital, int count)
    {
        var map = s.Map;
        var ring = new List<int>();
        map.CollectRadius(capital, 7, ring);
        var picked = new List<int>();
        foreach (int t in ring.OrderBy(t => Math.Abs(map.Distance(capital, t) - 5)).ThenBy(t => t))
        {
            if (picked.Count >= count) break;
            if (!map.IsLand(t) || map.IsMountain(t) || (map.OwnerPlayer[t] >= 0 && map.OwnerPlayer[t] != map.OwnerPlayer[capital])) continue;
            if (s.Cities.Any(c => map.Distance(c.Tile, t) < 4) || picked.Any(p => map.Distance(p, t) < 4)) continue;
            picked.Add(t);
        }
        return picked;
    }

    private static void AddScenarioDistrict(GameState s, CityState city, string district, params string[] buildings)
    {
        int def = s.Db.Districts.IndexOf(district);
        var ring = new List<int>();
        s.Map.CollectRadius(city.Tile, 2, ring);
        int tile = ring.OrderBy(t => t).FirstOrDefault(t => t != city.Tile && s.Map.IsLand(t) && !s.Map.IsMountain(t) && s.Map.District[t] < 0
                                                             && (s.Map.OwnerCity[t] == city.Id || s.Map.OwnerPlayer[t] < 0), -1);
        if (tile < 0) return;
        CitySystem.AddDistrict(s, city, def, tile);
        foreach (var b in buildings) city.Districts[^1].Buildings.Add(s.Db.Buildings.IndexOf(b));
    }

    public static string Render(GameState s, string title)
    {
        var map = s.Map;
        var db = s.Db;
        var engineered = db.Terrains.IndexOf("TERRAIN_ENGINEERED");
        var substrate = db.Terrains.IndexOf("TERRAIN_SUBSTRATE");
        var bloom = db.Features.IndexOf("FEATURE_BLOOM");
        var sb = new System.Text.StringBuilder($"{title}\n  E Engineered Ground (Sovereign)  B the Bloom (Symbiont)  S Substrate (Discarnate)  1-3 cities  " +
                                               "~ sea  = Great River  ^ mountain  ' woods  . other land  ! submerged\n");
        for (int row = 0; row < map.Height; row++)
        {
            sb.Append((row & 1) == 1 ? "   " : "  ");
            for (int col = 0; col < map.Width; col++)
            {
                int t = row * map.Width + col;
                var city = s.Cities.FirstOrDefault(c => c.Tile == t);
                char ch = city != null ? (char)('1' + city.Owner)
                    : map.Terrain[t] == engineered ? 'E' : map.Terrain[t] == substrate ? 'S' : map.Feature[t] == bloom ? 'B'
                    : map.HasFlag(t, TileFlags.Submerged) ? '!' : map.IsChannel(t) ? '=' : map.IsWater(t) ? '~'
                    : map.IsMountain(t) ? '^' : map.Feature[t] == db.Ids.Forest || map.Feature[t] == db.Ids.Rainforest ? '\'' : '.';
                sb.Append(ch).Append(' ');
            }
            sb.AppendLine();
        }
        return sb.ToString();
    }
}
