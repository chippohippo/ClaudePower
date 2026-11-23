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

var argv = args.ToList();
string command = argv.Count > 0 ? argv[0] : "help";
string Opt(string name, string fallback)
{
    int i = argv.IndexOf(name);
    return i >= 0 && i + 1 < argv.Count ? argv[i + 1] : fallback;
}

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
    var leaders = db.Leaders.Select(l => l.Id).ToList();
    var setup = new GameSetup
    {
        Seed = seed,
        Map = new MapGenSettings { Width = 64, Height = 40, Seed = seed },
        Players = Enumerable.Range(0, players).Select(i => new PlayerSetup { Name = $"AI {i}", Leader = leaders[i % leaders.Count] }).ToList(),
    };
    var s = GameFactory.Create(db, setup);
    var ai = new SimpleAi();
    var sw = Stopwatch.StartNew();
    var tally = new Dictionary<GameEventType, int>();
    for (int t = 0; t < turns; t++)
    {
        foreach (var p in s.Players.Where(p => !p.IsFreeCities))
            foreach (var cmd in ai.TakeTurn(s, p.Id)) CommandProcessor.Execute(s, cmd, new());
        var events = new List<GameEvent>();
        CommandProcessor.Execute(s, new AdvanceTurnCommand { Player = GameCommand.SystemPlayer, ExpectedTurn = s.Turn }, events);
        foreach (var e in events) tally[e.Type] = tally.GetValueOrDefault(e.Type) + 1;
        if (s.Turn % 25 == 0)
            Console.WriteLine($"turn {s.Turn,4}: cities={s.Cities.Count} pop={s.Cities.Sum(c => c.Population)} districts={s.Cities.Sum(c => c.Districts.Count - 1)} " +
                              $"techs={s.Players.Sum(p => p.Techs.Count(x => x))} CO2={s.Climate.Co2Ppm}ppm T=+{s.Climate.Temperature}°C phase={s.Climate.Phase}");
    }
    Console.WriteLine($"{turns} turns in {sw.ElapsedMilliseconds} ms ({sw.Elapsed.TotalMilliseconds / turns:0.0} ms/turn)");
    Console.WriteLine("events: " + string.Join(", ", tally.OrderBy(k => k.Key).Select(k => $"{k.Key}={k.Value}")));
    Console.WriteLine($"final state hash {GameStateSerializer.Hash(s):X16} ({GameStateSerializer.Serialize(s).Length / 1024} KiB snapshot)");
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

static string FindRepoRoot()
{
    var dir = new DirectoryInfo(AppContext.BaseDirectory);
    while (dir != null && !File.Exists(Path.Combine(dir.FullName, "content", "base", "mod.json"))) dir = dir.Parent;
    return dir?.FullName ?? Directory.GetCurrentDirectory();
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
