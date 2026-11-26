using Godot;
using UnbrokenAges.Client.Map;
using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Client.Visuals;

/// <summary>
/// The world going about its business, purely client-side and seeded from the map so it is the same every time you look.
/// Every civilization's roads, traffic, ships, aircraft, plumes and townsfolk follow its researched technologies
/// (<see cref="TechLook"/>), through to the three Divergence futures:
/// <list type="bullet">
/// <item><b>Roads</b> join each civilization's cities (a spanning tree of land paths) and the nearest cities of neighbouring
///   civilizations (trade roads), plus spur tracks from improved resources to the city that works them. Dirt tracks until the
///   industrial era, paved after.</item>
/// <item><b>Traffic</b>: porters on foot, horse carts, steam lorries, cars and vans, autonomous pods; Sovereign convoys,
///   Symbiont travellers on foot, Discarnate hovercraft. From Flight, aircraft shuttle between a civilization's cities.</item>
/// <item><b>Boats</b>: fishing boats work the fish, canoes the pearl beds, sailboats tack off coastal cities, merchantmen sail
///   sea lanes between nearby ports.</item>
/// <item><b>Townsfolk</b> stroll around every city.</item>
/// <item><b>Animals</b>: cattle, deer and horses graze and wander on their resource tiles; sheep at pastures; tractors in fields.</item>
/// <item><b>Birds</b> wheel over the land in flocks; <b>chimney smoke</b> drifts off every city.</item>
/// </list>
/// Life is only drawn on tiles you can currently see — the fog stays a quiet memory.
/// </summary>
public partial class LifeLayer : Node3D
{
    private sealed class Mover
    {
        public Node3D Node = null!;
        public Vector3[] Path = Array.Empty<Vector3>();
        public float[] Length = Array.Empty<float>();
        public float At, Speed, Bob, Hover;
        public bool Loop, OnWater, Fly;
        public int Dir = 1;
    }

    private sealed class Grazer
    {
        public Node3D Node = null!;
        public List<AnimationPlayer> Players = new();
        public Vector3 Home, Target;
        public float Wait, Speed, Roam, MinRoam, YawOffset, Hover;
        public bool Walking;
        public string Walk = "", Idle = "";
    }

    private readonly ModelLibrary _models;
    private readonly MeshInstance3D _roads = new() { CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
    private readonly Node3D _dynamic = new() { Name = "Life" };
    private readonly List<Mover> _movers = new();
    private readonly List<Grazer> _grazers = new();

    private MultiMeshInstance3D _birds = null!;
    private readonly List<(Vector3 Center, float Radius, float Speed, float Phase, int Count)> _flocks = new();
    private string _signature = "";
    private bool[] _visible = Array.Empty<bool>();
    private MapGrid? _map;
    private readonly RandomNumberGenerator _rng = new();

    public LifeLayer(ModelLibrary models)
    {
        _models = models;
        Name = "LifeLayer";
        AddChild(_roads);
        AddChild(_dynamic);
        BuildBirds();
        BuildSmoke();
    }

    /// <summary>Townsfolk, animals, traffic and birds (roads and smoke stay). The strategic zoom hides them as clutter.</summary>
    public bool Decorations
    {
        get => _dynamic.Visible;
        set { _dynamic.Visible = value; if (_birds != null) _birds.Visible = value; }
    }

    /// <summary>All roads currently drawn, as world-space polylines (for tests and the overlay).</summary>
    public IReadOnlyList<Vector3[]> Roads => _roadPaths;
    private readonly List<Vector3[]> _roadPaths = new();

    public void Sync(GameState s, int viewer, bool[] visible, bool[] revealed, bool seeEverything)
    {
        _visible = visible;
        _map = s.Map;
        string signature = Signature(s, viewer, revealed, seeEverything);
        if (signature != _signature)
        {
            _signature = signature;
            Rebuild(s, viewer, revealed, seeEverything);
        }
        ApplyVisibility();
    }

    private static string Signature(GameState s, int viewer, bool[] revealed, bool seeAll)
    {
        var h = new HashCode();
        foreach (var c in s.Cities) { h.Add(c.Tile); h.Add(c.Owner); h.Add(c.Population / 3); }
        for (int t = 0; t < s.Map.Count; t++)
        {
            if (t < revealed.Length && revealed[t]) h.Add(t);
            if (s.Map.Improvement[t] >= 0) { h.Add(t * 7 + s.Map.Improvement[t]); }
            if (HexMapView.VisibleResource(s, viewer, t, seeAll) is var r and >= 0) h.Add(t * 13 + r);
        }
        for (int p = 0; p < s.Players.Count; p++) h.Add(TechLook.For(s, p));
        return h.ToHashCode().ToString();
    }

    private void Rebuild(GameState s, int viewer, bool[] revealed, bool seeAll)
    {
        foreach (var child in _dynamic.GetChildren()) child.QueueFree();
        _movers.Clear();
        _grazers.Clear();
        _plumes.Clear();
        _roadPaths.Clear();
        var map = s.Map;
        bool Known(int t) => t >= 0 && t < revealed.Length && revealed[t];

        // ---- Roads: per civilization, a spanning tree over its cities (shortest land paths), then spurs to resources ----
        var roads = new Dictionary<RoadKind, List<(Vector3[] Pts, float Half)>>();
        var looks = Enumerable.Range(0, s.Players.Count).Select(p => TechLook.For(s, p)).ToArray();
        _looks = looks;
        foreach (var group in s.Cities.Where(c => Known(c.Tile)).GroupBy(c => c.Owner))
        {
            var owner = s.Players[group.Key];
            var look = looks[group.Key];
            var cities = group.ToList();
            var linked = new HashSet<int> { 0 };
            while (linked.Count < cities.Count)
            {
                // Prim: the shortest hop from any linked city to an unlinked one.
                (int From, int To, int Dist) best = (-1, -1, int.MaxValue);
                foreach (int a in linked)
                    for (int b = 0; b < cities.Count; b++)
                        if (!linked.Contains(b) && map.Distance(cities[a].Tile, cities[b].Tile) is var d && d < best.Dist) best = (a, b, d);
                linked.Add(best.To);
                if (best.Dist > 12) continue;
                var path = LandPath(map, cities[best.From].Tile, cities[best.To].Tile, 16);
                if (path == null) continue;
                AddRoad(map, path, Known, roads, look.Road, 1f, look, true);
            }
            // Resource spurs: improved resources (and farms) worked by a city, one track each.
            foreach (var c in cities)
                for (int t = 0; t < map.Count; t++)
                {
                    if (map.OwnerCity[t] != c.Id || map.Improvement[t] < 0 || t == c.Tile || !Known(t)) continue;
                    if (map.Resource[t] < 0 || map.Distance(t, c.Tile) > 4) continue;
                    var path = LandPath(map, t, c.Tile, 6);
                    if (path != null) AddRoad(map, path, Known, roads, look.Road, 0.65f, look, false);
                }
        }
        // Real trade routes: caravans along their land roads, merchantmen along their sea lanes.
        foreach (var route in s.TradeRoutes)
        {
            if (route.Path.Count < 2 || !route.Path.Any(Known)) continue;
            var look = looks[route.Owner];
            int water = route.Path.Count(t => map.IsWater(t));
            if (water * 2 < route.Path.Count) { AddRoad(map, route.Path, Known, roads, look.Road, 1.15f, look, true); continue; }
            if (!route.Path.All(Known)) continue;
            var pts = Smooth(route.Path.Select(t => HexLayout.ToWorld(map.CoordOf(t), 0) + new Vector3(Rand(t, 17) - 0.5f, 0, Rand(t, 18) - 0.5f) * 0.4f).ToList());
            var ship = Merchantman(look);
            _dynamic.AddChild(ship);
            var m = new Mover { Node = ship, Path = pts, Speed = 0.3f, OnWater = true, Bob = Rand(route.Origin, 15) * 6 };
            m.Length = Cumulative(pts);
            m.At = Rand(route.Id, 16) * m.Length[^1];
            _movers.Add(m);
        }
        // Trade roads: the nearest pair of cities between each two civilizations, if they are close, joined by a caravan road.
        var known = s.Cities.Where(c => Known(c.Tile)).ToList();
        var owners = known.Select(c => c.Owner).Distinct().ToList();
        for (int i = 0; i < owners.Count; i++)
            for (int j = i + 1; j < owners.Count; j++)
            {
                var pair = known.Where(c => c.Owner == owners[i])
                    .SelectMany(a => known.Where(c => c.Owner == owners[j]).Select(b => (A: a, B: b, D: map.Distance(a.Tile, b.Tile))))
                    .OrderBy(x => x.D).FirstOrDefault();
                if (pair.A == null || pair.D > 10) continue;
                var path = LandPath(map, pair.A.Tile, pair.B.Tile, 14);
                if (path == null) continue;
                // A trade road is built to the lesser of the two standards; the caravans are the richer partner's.
                var la = looks[pair.A.Owner]; var lb = looks[pair.B.Owner];
                var kind = (RoadKind)Math.Min((int)la.Road, (int)lb.Road);
                if (kind >= RoadKind.Sovereign && la.Road != lb.Road) kind = RoadKind.Smart;   // two different futures meet on neutral ground
                AddRoad(map, path, Known, roads, kind, 1f, la.Traffic >= lb.Traffic ? la : lb, true);
            }

        // Sea lanes: merchantmen sail between nearby coastal cities.
        var ports = known.Where(c => Enumerable.Range(0, 6).Any(d => map.Neighbor(c.Tile, d) is var n && n >= 0 && map.IsWater(n))).ToList();
        var sailed = new HashSet<int>();
        foreach (var a in ports)
        {
            if (sailed.Contains(a.Id)) continue;
            var b = ports.Where(c => c.Id != a.Id && !sailed.Contains(c.Id)).OrderBy(c => map.Distance(a.Tile, c.Tile)).FirstOrDefault();
            if (b == null || map.Distance(a.Tile, b.Tile) > 16) continue;
            var lane = SeaPath(map, a.Tile, b.Tile, 30);
            if (lane == null || lane.Count < 3 || !lane.All(Known)) continue;
            sailed.Add(a.Id);
            sailed.Add(b.Id);
            var la = looks[a.Owner];
            var pts = Smooth(lane.Select(t => HexLayout.ToWorld(map.CoordOf(t), 0) + new Vector3(Rand(t, 13) - 0.5f, 0, Rand(t, 14) - 0.5f) * 0.5f).ToList());
            var ship = Merchantman(la);
            _dynamic.AddChild(ship);
            var m = new Mover { Node = ship, Path = pts, Speed = 0.3f, OnWater = true, Bob = Rand(a.Tile, 15) * 6 };
            m.Length = Cumulative(pts);
            m.At = Rand(a.Tile, 16) * m.Length[^1];
            _movers.Add(m);
        }

        _roads.Mesh = RoadMesh(roads, map);

        // Aircraft: from Flight on, each civilization's skies carry its own craft between its cities.
        foreach (var group in s.Cities.Where(c => Known(c.Tile)).GroupBy(c => c.Owner))
        {
            var look = looks[group.Key];
            if (look.Architecture < Architecture.Atomic || group.Count() < 2) continue;
            var cs = group.OrderBy(c => c.Id).ToList();
            for (int i = 0; i + 1 < cs.Count && i < 3; i++)
                Flyer(look, HexLayout.ToWorld(map.CoordOf(cs[i].Tile), 0), HexLayout.ToWorld(map.CoordOf(cs[i + 1].Tile), 0), cs[i].Tile);
        }

        // ---- Life on tiles: animals, boats, tractors ----
        for (int t = 0; t < map.Count; t++)
        {
            if (!Known(t)) continue;
            var centre = HexLayout.ToWorld(map.CoordOf(t), 0);
            int r = HexMapView.VisibleResource(s, viewer, t, seeAll);
            string? res = r >= 0 ? s.Db.Resources[r].Id : null;
            string? imp = map.Improvement[t] >= 0 ? s.Db.Improvements[map.Improvement[t]].Id : null;
            switch (res)
            {
                case "RESOURCE_CATTLE": Herd(t, centre, "resources/cow", 3, 0.3f, "walk", "eat", 0); break;
                case "RESOURCE_DEER": Herd(t, centre, "resources/deer", 2, 0.32f, "walk", "eat", 0); break;
                case "RESOURCE_HORSES": Herd(t, centre, "units/horse", 3, 0.36f, "walk", "walk", -Mathf.Pi / 2, slow: true); break;
                case "RESOURCE_FISH": Boat(t, centre, "life/fishing_boat", 0.42f, 0.38f, 0.12f); break;
                case "RESOURCE_PEARLS": Boat(t, centre, "life/canoe", 0.3f, 0.3f, 0.1f); break;
            }
            if (imp == "IMPROVEMENT_PASTURE" && res != "RESOURCE_CATTLE" && res != "RESOURCE_HORSES") Herd(t, centre, "resources/sheep", 3, 0.24f, "Walk", "Idle", 0);
            if (imp == "IMPROVEMENT_FARM" && map.OwnerPlayer[t] >= 0 && looks[map.OwnerPlayer[t]].Architecture is >= Architecture.Industrial and < Architecture.Sovereign && Rand(t, 7) < 0.5f)
                Plough(t, centre);
        }

        // ---- Cities: chimney smoke, and sailboats off the coast ----
        foreach (var c in s.Cities.Where(c => Known(c.Tile)))
        {
            var at = HexLayout.ToWorld(map.CoordOf(c.Tile), 0);
            var look = looks[c.Owner];
            foreach (var (offset, height, kind) in CityLayout.Plumes(look, c)) Smoke(c.Tile, at + offset, kind, height);
            foreach (var d in c.Districts)
            {
                if (d.DefIndex == s.Db.Ids.CityCenter || d.Pillaged || !Known(d.Tile)) continue;
                if (CityLayout.DistrictPlume(look, s.Db.Districts[d.DefIndex]) is { } plume)
                    Smoke(d.Tile, HexLayout.ToWorld(map.CoordOf(d.Tile), 0) + plume.Offset, plume.Kind, plume.Height);
            }
            // Townsfolk wander between the houses — or, for the Discarnate, their drones.
            int folk = Math.Clamp(2 + c.Population / 2, 2, 6);
            for (int i = 0; i < folk; i++) Townsfolk(c.Tile, at, look, i);
            for (int d = 0; d < 6; d++)
            {
                int n = map.Neighbor(c.Tile, d);
                if (n < 0 || !map.IsWater(n)) continue;
                if (look.Architecture < Architecture.Industrial) Boat(n, HexLayout.ToWorld(map.CoordOf(n), 0), "life/sailboat", 0.5f, 0.6f, 0.16f);
                else Boat(n, HexLayout.ToWorld(map.CoordOf(n), 0), look.IsFuture ? "life/speeder" : "life/fishing_boat", 0.4f, 0.6f, 0.2f, look);
                break;
            }
        }

        // ---- Birds: a few flocks per map, circling slowly over the known world ----
        _flocks.Clear();
        var land = Enumerable.Range(0, map.Count).Where(t => Known(t) && !map.IsWater(t)).ToList();
        int flocks = Math.Clamp(land.Count / 90 + looks.Count(l => l.Path == TechLook.Symbiont) * 2, land.Count > 0 ? 1 : 0, 8);
        for (int f = 0; f < flocks; f++)
        {
            int t = land[(int)(Rand(f, 77) * land.Count) % land.Count];
            _flocks.Add((HexLayout.ToWorld(map.CoordOf(t), 2.6f + Rand(f, 78)), 2.5f + 3f * Rand(f, 79), 0.08f + 0.06f * Rand(f, 80), Rand(f, 81) * Mathf.Tau, 5 + (int)(Rand(f, 82) * 5)));
        }
        _birds.Multimesh.InstanceCount = _flocks.Sum(f => f.Count);
        FillSmoke();
        if (OS.GetCmdlineUserArgs().Contains("--debug-life"))
            GD.Print($"[life] roads {_roadPaths.Count} movers {_movers.Count} grazers {_grazers.Count} smoke {_plumes.Count} flocks {_flocks.Count} cities {s.Cities.Count(c => Known(c.Tile))}");
    }

    // ----- Roads ------------------------------------------------------------------------------------

    /// <summary>A land path (A*) avoiding mountains and water; hills and woods cost more, so roads follow the valleys.</summary>
    private static List<int>? LandPath(MapGrid map, int from, int to, int maxLen)
    {
        var open = new PriorityQueue<int, float>();
        var cost = new Dictionary<int, float> { [from] = 0 };
        var came = new Dictionary<int, int>();
        open.Enqueue(from, 0);
        while (open.TryDequeue(out int cur, out _))
        {
            if (cur == to) break;
            if (cost[cur] > maxLen * 2.5f) continue;
            for (int d = 0; d < 6; d++)
            {
                int n = map.Neighbor(cur, d);
                if (n < 0 || map.IsWater(n) || (map.IsMountain(n) && n != to)) continue;
                float step = 1f + (map.Relief[n] != 0 ? 0.8f : 0f) + (map.Feature[n] >= 0 ? 0.5f : 0f) + (map.HasRiverEdge(cur, d) ? 0.6f : 0f);
                for (int e = 0; e < 6; e++) if (map.Neighbor(n, e) is var m && m >= 0 && map.IsMountain(m)) step += 0.6f;   // keep off the foothills
                float c = cost[cur] + step;
                if (cost.TryGetValue(n, out var old) && old <= c) continue;
                cost[n] = c;
                came[n] = cur;
                open.Enqueue(n, c + map.Distance(n, to));
            }
        }
        if (!came.ContainsKey(to)) return null;
        var path = new List<int> { to };
        while (path[^1] != from) path.Add(came[path[^1]]);
        path.Reverse();
        return path.Count - 1 <= maxLen ? path : null;
    }

    /// <summary>A path over water from beside one coastal city to beside another; open coast is preferred to deep ocean.</summary>
    private static List<int>? SeaPath(MapGrid map, int fromCity, int toCity, int maxLen)
    {
        var open = new PriorityQueue<int, float>();
        var cost = new Dictionary<int, float>();
        var came = new Dictionary<int, int>();
        for (int d = 0; d < 6; d++)
            if (map.Neighbor(fromCity, d) is var n && n >= 0 && map.IsWater(n)) { cost[n] = 0; open.Enqueue(n, 0); }
        var goals = Enumerable.Range(0, 6).Select(d => map.Neighbor(toCity, d)).Where(n => n >= 0 && map.IsWater(n)).ToHashSet();
        int end = -1;
        while (open.TryDequeue(out int cur, out _))
        {
            if (goals.Contains(cur)) { end = cur; break; }
            if (cost[cur] > maxLen * 1.6f) continue;
            for (int d = 0; d < 6; d++)
            {
                int n = map.Neighbor(cur, d);
                if (n < 0 || !map.IsWater(n)) continue;
                bool coastal = Enumerable.Range(0, 6).Any(e => map.Neighbor(n, e) is var m && m >= 0 && !map.IsWater(m));
                float c = cost[cur] + (coastal ? 1.25f : 1f);
                if (cost.TryGetValue(n, out var old) && old <= c) continue;
                cost[n] = c;
                came[n] = cur;
                open.Enqueue(n, c + map.Distance(n, toCity));
            }
        }
        if (end < 0) return null;
        var path = new List<int> { end };
        while (came.TryGetValue(path[^1], out var prev)) path.Add(prev);
        path.Reverse();
        return path.Count <= maxLen ? path : null;
    }

    /// <summary>Road half-widths: footpaths are a trodden line, future highways broad.</summary>
    private static float RoadHalf(RoadKind k) => k switch
    {
        RoadKind.Footpath => 0.06f, RoadKind.Track => 0.1f, RoadKind.Stone => 0.12f, RoadKind.Macadam => 0.13f,
        RoadKind.Asphalt => 0.14f, RoadKind.Smart => 0.15f, RoadKind.Sovereign => 0.2f, RoadKind.Symbiont => 0.1f, _ => 0.12f,
    };

    private TechLook[] _looks = Array.Empty<TechLook>();

    private void AddRoad(MapGrid map, List<int> tiles, Func<int, bool> known, Dictionary<RoadKind, List<(Vector3[] Pts, float Half)>> into,
                         RoadKind kind, float widthScale, TechLook traffic, bool trunk)
    {
        // Split where the path leaves the known map; each known run becomes a smooth polyline.
        var run = new List<Vector3>();
        void Flush()
        {
            if (run.Count >= 2)
            {
                var pts = Smooth(run);
                if (!into.TryGetValue(kind, out var list)) into[kind] = list = new();
                list.Add((pts, RoadHalf(kind) * widthScale));
                _roadPaths.Add(pts);
                AddTraffic(pts, traffic, trunk);
            }
            run.Clear();
        }
        foreach (int t in tiles)
        {
            if (!known(t)) { Flush(); continue; }
            var p = HexLayout.ToWorld(map.CoordOf(t), 0);
            // Wander a little off the centre line so roads do not look ruled (engineered roads less so).
            p += new Vector3(Rand(t, 11) - 0.5f, 0, Rand(t, 12) - 0.5f) * (kind >= RoadKind.Macadam ? 0.18f : 0.35f);
            run.Add(p);
        }
        Flush();
    }

    /// <summary>Chaikin corner-cutting (twice), then resampled every ~0.15 units and lifted onto the ground.</summary>
    private static Vector3[] Smooth(List<Vector3> pts)
    {
        var cur = pts;
        for (int pass = 0; pass < 2; pass++)
        {
            var next = new List<Vector3> { cur[0] };
            for (int i = 0; i < cur.Count - 1; i++)
            {
                next.Add(cur[i].Lerp(cur[i + 1], 0.25f));
                next.Add(cur[i].Lerp(cur[i + 1], 0.75f));
            }
            next.Add(cur[^1]);
            cur = next;
        }
        var outPts = new List<Vector3> { cur[0] };
        for (int i = 0; i < cur.Count - 1; i++)
        {
            int pieces = Math.Max(1, (int)(cur[i].DistanceTo(cur[i + 1]) / 0.15f));
            for (int k = 1; k <= pieces; k++) outPts.Add(cur[i].Lerp(cur[i + 1], k / (float)pieces));
        }
        var hf = HeightField.Current;
        return outPts.Select(p => new Vector3(p.X, hf.Surface(p.X, p.Z), p.Z)).ToArray();
    }

    private HexMapView? _mapView;

    private ArrayMesh RoadMesh(Dictionary<RoadKind, List<(Vector3[] Pts, float Half)>> roads, MapGrid? map)
    {
        var mesh = new ArrayMesh();
        foreach (var (kind, list) in roads.OrderBy(kv => kv.Key))
        {
            if (list.Count == 0) continue;
            var st = new SurfaceTool();
            st.Begin(Mesh.PrimitiveType.Triangles);
            var hf = HeightField.Current;
            float lift = 0.045f + (int)kind * 0.002f;   // higher standards drawn over lower where they meet
            foreach (var (pts, half) in list)
            {
                float v = 0;
                for (int i = 0; i < pts.Length - 1; i++)
                {
                    Vector3 Side(int j)
                    {
                        var tan = pts[Math.Min(j + 1, pts.Length - 1)] - pts[Math.Max(j - 1, 0)];
                        tan.Y = 0;
                        tan = tan.Normalized();
                        return new Vector3(-tan.Z, 0, tan.X) * half;
                    }
                    Vector3 Lift(Vector3 p) => new(p.X, hf.Surface(p.X, p.Z) + lift, p.Z);
                    var s0 = Side(i); var s1 = Side(i + 1);
                    float v1 = v + pts[i].DistanceTo(pts[i + 1]);
                    var a0 = Lift(pts[i] - s0); var b0 = Lift(pts[i] + s0);
                    var a1 = Lift(pts[i + 1] - s1); var b1 = Lift(pts[i + 1] + s1);
                    void V(Vector3 p, float u, float vv) { st.SetNormal(Vector3.Up); st.SetUV(new Vector2(u, vv)); st.AddVertex(p); }
                    V(a0, 0, v); V(a1, 0, v1); V(b1, 1, v1);
                    V(a0, 0, v); V(b1, 1, v1); V(b0, 1, v);
                    v = v1;
                }
            }
            var mat = new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/road.gdshader") };
            mat.SetShaderParameter("noise", HexMapView.PaperNoise);
            mat.SetShaderParameter("style", (int)kind);
            if (map != null && (_mapView ??= GetParentOrNull<HexMapView>()) is { } view) view.ShareMapUniforms(mat, map);
            st.SetMaterial(mat);
            st.Commit(mesh);
        }
        return mesh;
    }

    // ----- Traffic ----------------------------------------------------------------------------------

    /// <summary>
    /// What travels a road, by the owner's research: porters on foot, then horse carts, steam lorries, cars and vans, then
    /// autonomous pods; Sovereign convoys of white armoured trucks, Symbiont travellers on foot among the deer, Discarnate
    /// hovercraft gliding above their conduits.
    /// </summary>
    private void AddTraffic(Vector3[] pts, TechLook look, bool trunk)
    {
        float length = 0;
        for (int i = 0; i < pts.Length - 1; i++) length += pts[i].DistanceTo(pts[i + 1]);
        int count = trunk ? Math.Clamp((int)(length / 2.5f), 1, 4) : 1;
        if (look.Traffic is Traffic.Autonomous or Traffic.Discarnate or Traffic.Sovereign) count += trunk ? 1 : 0;
        int seed = (int)(pts[0].X * 31 + pts[0].Z * 17);
        for (int i = 0; i < count; i++)
        {
            float r = Rand(seed, i);
            float hover = 0;
            (Node3D vehicle, float speed) = look.Traffic switch
            {
                Traffic.Porters => (Person(r < 0.5f ? "units/civilian_a" : "units/civilian_b", 0.22f, Colors.White, walking: true), 0.11f),
                Traffic.Carts => (Wagon(!trunk || r < 0.5f), 0.32f),
                Traffic.Lorries => (Fitted(r < 0.6f ? "life/truck" : "life/wagon_covered", 0.38f, 0), 0.45f),
                Traffic.Motor => (Fitted(r < 0.45f ? "life/car" : r < 0.75f ? "life/van" : "life/truck", 0.36f, 0), 0.65f),
                Traffic.Autonomous => (Fitted(r < 0.6f ? "life/race_future" : "life/van", 0.32f, 0), 0.85f),
                Traffic.Sovereign => (Tinted(Fitted(r < 0.6f ? "life/truck" : "units/rover", 0.42f, 0), TechLook.PathTint(0), TechLook.PathGlow(0) * 0.4f), 0.55f),
                Traffic.Symbiont => (r < 0.7f ? Person(r < 0.35f ? "units/civilian_a" : "units/civilian_b", 0.22f, new Color(0.75f, 1.05f, 0.8f), walking: true)
                                              : Tinted(Fitted("resources/deer", 0.3f, 0), Colors.White, default), r < 0.7f ? 0.1f : 0.16f),
                _ => (Tinted(Fitted(r < 0.6f ? "life/speeder" : "life/cargo_craft", 0.34f, 0), TechLook.PathTint(2), TechLook.PathGlow(2) * 1.2f), 1.0f),
            };
            if (look.Traffic == Traffic.Discarnate) hover = 0.18f;
            if (look.Traffic == Traffic.Symbiont && r >= 0.7f)
                foreach (var ap in vehicle.FindChildren("*", "AnimationPlayer", true, false).OfType<AnimationPlayer>()) Play(ap, "walk");
            var mover = new Mover { Node = vehicle, Path = pts, Speed = speed * (0.85f + 0.3f * Rand(seed, i + 9)), Loop = false, Hover = hover };
            mover.Length = Cumulative(pts);
            mover.At = Rand(seed, i + 3) * mover.Length[^1];
            mover.Dir = Rand(seed, i + 5) < 0.5f ? 1 : -1;
            _dynamic.AddChild(vehicle);
            _movers.Add(mover);
            // Sovereign convoys travel in column.
            if (look.Traffic == Traffic.Sovereign && trunk)
                for (int k = 1; k <= 2; k++)
                {
                    var follower = Tinted(Fitted("life/truck", 0.38f, 0), TechLook.PathTint(0), TechLook.PathGlow(0) * 0.4f);
                    var f = new Mover { Node = follower, Path = pts, Speed = mover.Speed, Length = mover.Length, Dir = mover.Dir, At = Mathf.Clamp(mover.At - mover.Dir * 0.45f * k, 0, mover.Length[^1]) };
                    _dynamic.AddChild(follower);
                    _movers.Add(f);
                }
        }
    }

    /// <summary>A walking figure (porter, traveller, townsperson), tinted.</summary>
    private Node3D Person(string model, float height, Color tint, bool walking)
    {
        var node = FittedRaw(model, height, 0, byHeight: true);
        if (tint != Colors.White) SceneTint.Apply(node, tint);
        if (walking) foreach (var ap in node.FindChildren("*", "AnimationPlayer", true, false).OfType<AnimationPlayer>()) Play(ap, "walk");
        return node;
    }

    private static Node3D Tinted(Node3D node, Color tint, Color glow)
    {
        SceneTint.Apply(node, tint, glow);
        return node;
    }

    /// <summary>A trading ship by its owner's research: galleys, then sail, steamers, container ships, future hulls.</summary>
    private Node3D Merchantman(TechLook look) => look.Architecture switch
    {
        Architecture.Tribal => Fitted("units/ship_small", 0.5f, 0),
        Architecture.Classical or Architecture.Medieval or Architecture.Renaissance => Fitted("units/ship_medium", 0.62f, 0),
        Architecture.Industrial => Fitted("units/ship_large", 0.75f, 0),
        < Architecture.Sovereign => Fitted("life/fishing_boat", 0.7f, 0),
        _ => Tinted(Fitted("life/cargo_craft", 0.6f, 0), TechLook.PathTint(look.Path), TechLook.PathGlow(look.Path) * 0.8f),
    };

    /// <summary>An aircraft shuttling between two cities: jets from Flight, then each future's own craft.</summary>
    private void Flyer(TechLook look, Vector3 a, Vector3 b, int seed)
    {
        Node3D craft = look.Path switch
        {
            TechLook.Sovereign => Tinted(Fitted("life/racer_craft", 0.42f, 0), TechLook.PathTint(0), TechLook.PathGlow(0)),
            TechLook.Symbiont => Tinted(Fitted("future/mushroom_tall", 0.3f, 0), new Color(0.85f, 0.6f, 1.1f), TechLook.PathGlow(1) * 1.5f),   // a drifting spore-pod
            TechLook.Discarnate => Tinted(Fitted("units/drone", 0.3f, 0), TechLook.PathTint(2), TechLook.PathGlow(2) * 1.5f),
            _ => Fitted("life/racer_craft", 0.4f, 0),
        };
        var mid = (a + b) / 2 + new Vector3(Rand(seed, 70) - 0.5f, 0, Rand(seed, 71) - 0.5f) * 2f;
        var pts = new[] { a, mid, b };
        var m = new Mover { Node = craft, Path = pts, Speed = look.Path == TechLook.Symbiont ? 0.2f : 1.3f, Hover = look.Path == TechLook.Symbiont ? 1.6f : 2.4f, Fly = true };
        m.Length = Cumulative(pts);
        m.At = Rand(seed, 72) * m.Length[^1];
        _dynamic.AddChild(craft);
        _movers.Add(m);
    }

    /// <summary>A townsperson — or, in a Discarnate city, a hovering drone; tinted to their people.</summary>
    private void Townsfolk(int tile, Vector3 centre, TechLook look, int i)
    {
        if (look.Path == TechLook.Discarnate)
        {
            var drone = Tinted(FittedRaw("units/drone", 0.14f, 0), TechLook.PathTint(2), TechLook.PathGlow(2) * 1.5f);
            AddWalker(tile, centre, drone, 0.4f, 1.0f, i, 0.35f + 0.2f * Rand(tile, 150 + i), "", "");
            return;
        }
        var tint = look.Path == TechLook.Sovereign ? new Color(1.1f, 1.12f, 1.2f) : look.Path == TechLook.Symbiont ? new Color(0.7f, 1.08f, 0.82f) : Colors.White;
        var node = FittedRaw(i % 2 == 0 ? "units/civilian_a" : "units/civilian_b", 0.24f, 0, byHeight: true);
        if (tint != Colors.White) SceneTint.Apply(node, tint);
        AddWalker(tile, centre, node, 0.45f, 1.05f, i, 0, "walk", "idle");
    }

    /// <summary>A horse pulling a wagon (covered for long hauls, an open cart of goods for the harvest).</summary>
    private Node3D Wagon(bool covered)
    {
        var root = new Node3D();
        var cart = Fitted(covered ? "life/wagon_covered" : "life/wagon", 0.36f, 0);
        cart.Position = new Vector3(0, 0, -0.08f);
        root.AddChild(cart);
        var horse = Fitted("units/horse", 0.24f, -Mathf.Pi / 2);
        horse.Position = new Vector3(0, 0, 0.2f);
        root.AddChild(horse);
        foreach (var ap in horse.FindChildren("*", "AnimationPlayer", true, false).OfType<AnimationPlayer>()) Play(ap, "walk");
        return root;
    }

    /// <summary>A scene scaled so its longest horizontal side is <paramref name="size"/>, feet on the ground, facing +Z.</summary>
    private Node3D Fitted(string model, float size, float yawOffset, PlayerState? team = null)
    {
        var node = FittedRaw(model, size, yawOffset);
        if (model.EndsWith("horse")) SceneTint.Apply(node, SceneTint.Chestnut);
        return node;
    }

    private Node3D FittedRaw(string model, float size, float yawOffset, bool byHeight = false)
    {
        var holder = new Node3D();
        var scene = _models.LoadScene(model);
        if (scene == null) return holder;
        var inst = scene.Instantiate<Node3D>();
        var b = _models.SceneBounds(model);
        float extent = byHeight ? b.Size.Y : Mathf.Max(b.Size.X, b.Size.Z);
        float k = extent > 0.0001f ? size / extent : 1f;
        inst.Scale = Vector3.One * k;
        inst.Position = new Vector3(-(b.Position.X + b.Size.X / 2) * k, -b.Position.Y * k, -(b.Position.Z + b.Size.Z / 2) * k);
        var pivot = new Node3D { Rotation = new Vector3(0, yawOffset, 0) };
        pivot.AddChild(inst);
        holder.AddChild(pivot);
        return holder;
    }

    private static float[] Cumulative(Vector3[] pts)
    {
        var len = new float[pts.Length];
        for (int i = 1; i < pts.Length; i++) len[i] = len[i - 1] + pts[i - 1].DistanceTo(pts[i]);
        return len;
    }

    private void Boat(int tile, Vector3 centre, string model, float size, float radius, float speed, TechLook? look = null)
    {
        // A loop around the tile, pulled in until every point floats on open water.
        var hf = HeightField.Current;
        for (float r = radius; r >= 0.15f; r -= 0.08f)
        {
            var pts = new Vector3[25];
            bool wet = true;
            for (int i = 0; i < pts.Length; i++)
            {
                float a = i / (float)(pts.Length - 1) * Mathf.Tau;
                pts[i] = centre + new Vector3(Mathf.Cos(a) * r, 0, Mathf.Sin(a) * r * 0.8f);
                wet &= hf.Sample(pts[i].X, pts[i].Z) < -0.08f;
            }
            if (!wet) continue;
            var boat = Fitted(model, size, 0);
            if (look is { IsFuture: true }) Tinted(boat, TechLook.PathTint(look.Path), TechLook.PathGlow(look.Path) * 0.8f);
            _dynamic.AddChild(boat);
            var m = new Mover { Node = boat, Path = pts, Speed = speed, Loop = true, OnWater = true, Bob = Rand(tile, 3) * 6f, Hover = look is { IsFuture: true } ? 0.12f : 0f };
            m.Length = Cumulative(pts);
            m.At = Rand(tile, 4) * m.Length[^1];
            _movers.Add(m);
            return;
        }
    }

    private void Plough(int tile, Vector3 centre)
    {
        var a = centre + new Vector3(-0.4f, 0, 0.15f);
        var b = centre + new Vector3(0.35f, 0, -0.2f);
        var pts = new[] { a, a.Lerp(b, 0.5f), b };
        var tractor = Fitted("life/tractor", 0.24f, 0);
        _dynamic.AddChild(tractor);
        var m = new Mover { Node = tractor, Path = pts, Speed = 0.12f };
        m.Length = Cumulative(pts);
        m.At = Rand(tile, 5) * m.Length[^1];
        _movers.Add(m);
    }

    // ----- Animals ----------------------------------------------------------------------------------

    private void Herd(int tile, Vector3 centre, string model, int count, float size, string walk, string idle, float yawOffset, bool slow = false)
    {
        for (int i = 0; i < count; i++)
        {
            var node = Fitted(model, size, yawOffset);
            float a = Rand(tile, 20 + i) * Mathf.Tau;
            var home = centre + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * 0.3f;
            var g = new Grazer
            {
                Node = node, Home = home, Target = home, Roam = 0.4f, Speed = slow ? 0.12f : 0.09f, Wait = Rand(tile, 40 + i) * 4f,
                Walk = walk, Idle = idle, YawOffset = 0,
            };
            node.Position = Ground(home);
            node.Rotation = new Vector3(0, Rand(tile, 50 + i) * Mathf.Tau, 0);
            _dynamic.AddChild(node);
            g.Players.AddRange(node.FindChildren("*", "AnimationPlayer", true, false).OfType<AnimationPlayer>());
            foreach (var ap in g.Players) { Play(ap, idle); ap.Seek(Rand(tile, 60 + i) * 2f, true); }
            _grazers.Add(g);
        }
    }

    /// <summary>Someone (or something) strolling around a town between an inner and outer ring, keeping out of the keep.</summary>
    private void AddWalker(int tile, Vector3 centre, Node3D node, float inner, float outer, int i, float hover, string walk, string idle)
    {
        float a = Rand(tile, 120 + i) * Mathf.Tau;
        var start = centre + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * Mathf.Lerp(inner, outer, Rand(tile, 130 + i));
        var g = new Grazer
        {
            Node = node, Home = centre, Target = start, Roam = outer, MinRoam = inner, Speed = hover > 0 ? 0.14f : 0.07f, Wait = Rand(tile, 140 + i) * 3f,
            Walk = walk, Idle = idle, Hover = hover,
        };
        node.Position = Ground(start) + new Vector3(0, hover, 0);
        node.Rotation = new Vector3(0, a, 0);
        _dynamic.AddChild(node);
        g.Players.AddRange(node.FindChildren("*", "AnimationPlayer", true, false).OfType<AnimationPlayer>());
        foreach (var ap in g.Players) Play(ap, idle);
        _grazers.Add(g);
    }

    private static void Play(AnimationPlayer ap, string name)
    {
        var all = ap.GetAnimationList();
        var hit = all.FirstOrDefault(a => a == name) ?? all.FirstOrDefault(a => a.Contains(name, StringComparison.OrdinalIgnoreCase));
        if (hit == null) return;
        ap.GetAnimation(hit).LoopMode = Animation.LoopModeEnum.Linear;
        if (ap.CurrentAnimation != hit) ap.Play(hit, 0.3);
    }

    // ----- Smoke and birds --------------------------------------------------------------------------

    private readonly List<(Vector3 At, int Tile, CityLayout.Plume Kind)> _plumes = new();
    private MultiMeshInstance3D _smokeMesh = null!;
    private const int PuffsPerPlume = 7;

    private void Smoke(int tile, Vector3 at, CityLayout.Plume kind, float height) => _plumes.Add((Ground(at) + new Vector3(0, height, 0), tile, kind));

    private void BuildSmoke()
    {
        _smokeMesh = new MultiMeshInstance3D
        {
            Multimesh = new MultiMesh
            {
                TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseColors = true, UseCustomData = true,
                Mesh = new QuadMesh { Size = Vector2.One, Material = new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/smoke.gdshader") } },
            },
            CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
            ExtraCullMargin = 4f,
        };
        AddChild(_smokeMesh);
    }

    private void FillSmoke()
    {
        var mm = _smokeMesh.Multimesh;
        mm.InstanceCount = _plumes.Count * PuffsPerPlume;
        for (int p = 0; p < _plumes.Count; p++)
            for (int i = 0; i < PuffsPerPlume; i++)
            {
                int n = p * PuffsPerPlume + i;
                mm.SetInstanceTransform(n, new Transform3D(Basis.Identity, _plumes[p].At));
                mm.SetInstanceCustomData(n, new Color((i + Rand(p, 5)) / PuffsPerPlume, (int)_plumes[p].Kind, 0, 0));
                mm.SetInstanceColor(n, Colors.White);
            }
    }

    private void BuildBirds()
    {
        var mesh = new ArrayMesh();
        var arrays = new Godot.Collections.Array();
        arrays.Resize((int)Mesh.ArrayType.Max);
        // A gull in a shallow V: body point forward, two swept wings.
        arrays[(int)Mesh.ArrayType.Vertex] = new Vector3[]
        {
            new(0, 0, 0.05f), new(-0.11f, 0.015f, -0.03f), new(0, 0, -0.02f),
            new(0, 0, 0.05f), new(0, 0, -0.02f), new(0.11f, 0.015f, -0.03f),
        };
        arrays[(int)Mesh.ArrayType.Normal] = Enumerable.Repeat(Vector3.Up, 6).ToArray();
        mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
        mesh.SurfaceSetMaterial(0, new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/bird.gdshader") });
        _birds = new MultiMeshInstance3D
        {
            Multimesh = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseCustomData = true, Mesh = mesh },
            CastShadow = GeometryInstance3D.ShadowCastingSetting.On,
        };
        AddChild(_birds);
    }

    // ----- Per frame --------------------------------------------------------------------------------

    public string Describe() => string.Join(" | ", _movers.Select(m => $"{m.Node.GetChild(0)?.GetChild(0)?.Name ?? m.Node.Name} at {m.Node.Position.Snapped(Vector3.One * 0.01f)} vis {m.Node.Visible}"))
        + " || " + string.Join(" | ", _grazers.Select(g => $"{g.Node.GetChild(0)?.GetChild(0)?.Name} at {g.Node.GlobalPosition.Snapped(Vector3.One * 0.01f)} vis {g.Node.IsVisibleInTree()} scale {(g.Node.GetChild(0)?.GetChild(0) is Node3D n ? n.Scale.X : 0)}"))
        + " || " + string.Join(" | ", _plumes.Select(p => $"smoke {p.At.Snapped(Vector3.One * 0.01f)}"));

    private bool Seen(Vector3 p)
    {
        if (_map == null) return false;
        int t = _map.IndexOf(HexLayout.FromWorld(p));
        return t >= 0 && t < _visible.Length && _visible[t];
    }

    private void ApplyVisibility()
    {
        foreach (var m in _movers) m.Node.Visible = Seen(m.Node.Position == Vector3.Zero ? m.Path[0] : m.Node.Position);
        foreach (var g in _grazers) g.Node.Visible = Seen(g.Home);
        var mm = _smokeMesh.Multimesh;
        for (int p = 0; p < _plumes.Count; p++)
        {
            int t = _plumes[p].Tile;
            var c = new Color(1, 1, 1, t < _visible.Length && _visible[t] ? 1 : 0);
            for (int i = 0; i < PuffsPerPlume && p * PuffsPerPlume + i < mm.InstanceCount; i++) mm.SetInstanceColor(p * PuffsPerPlume + i, c);
        }
    }

    public override void _Process(double delta)
    {
        float dt = (float)Math.Min(delta, 0.1);
        float time = Time.GetTicksMsec() / 1000f;
        foreach (var m in _movers) Advance(m, dt, time);
        foreach (var g in _grazers) Graze(g, dt);
        int i = 0;
        var mm = _birds.Multimesh;
        foreach (var f in _flocks)
        {
            for (int b = 0; b < f.Count && i < mm.InstanceCount; b++, i++)
            {
                float a = f.Phase + time * f.Speed + b * 0.09f;
                float wobble = Mathf.Sin(time * 0.7f + b * 1.7f) * 0.35f;
                var p = f.Center + new Vector3(Mathf.Cos(a) * (f.Radius + wobble), Mathf.Sin(time * 0.5f + b) * 0.15f, Mathf.Sin(a) * (f.Radius + wobble) * 0.7f);
                p += new Vector3(Mathf.Cos(b * 2.4f), 0, Mathf.Sin(b * 2.4f)) * 0.25f * (b % 3);
                var tangent = new Vector3(-Mathf.Sin(a), 0, Mathf.Cos(a) * 0.7f);
                var basis = new Basis(Vector3.Up, Mathf.Atan2(tangent.X, tangent.Z)).Scaled(Vector3.One * 1.3f);
                mm.SetInstanceTransform(i, new Transform3D(basis, p));
                mm.SetInstanceCustomData(i, new Color(b * 0.137f % 1f, 0, 0, 0));
            }
        }
    }

    private void Advance(Mover m, float dt, float time)
    {
        float total = m.Length[^1];
        if (total <= 0.001f) return;
        m.At += m.Speed * dt * m.Dir;
        if (m.Loop) m.At = Mathf.PosMod(m.At, total);
        else if (m.At >= total) { m.At = total; m.Dir = -1; }
        else if (m.At <= 0) { m.At = 0; m.Dir = 1; }
        int seg = Array.BinarySearch(m.Length, m.At);
        if (seg < 0) seg = ~seg - 1;
        seg = Math.Clamp(seg, 0, m.Path.Length - 2);
        float f = (m.At - m.Length[seg]) / Math.Max(0.0001f, m.Length[seg + 1] - m.Length[seg]);
        var p = m.Path[seg].Lerp(m.Path[seg + 1], f);
        var dir = (m.Path[seg + 1] - m.Path[seg]) * m.Dir;
        if (m.OnWater) p.Y = 0.01f + Mathf.Sin(time * 1.6f + m.Bob) * 0.012f + m.Hover;
        else if (m.Fly) p.Y = m.Hover + Mathf.Sin(time * 0.8f + m.Bob) * 0.08f;
        else p.Y = HeightField.Current.Surface(p.X, p.Z) + 0.035f + m.Hover + (m.Hover > 0 ? Mathf.Sin(time * 2.2f + m.At) * 0.02f : 0);
        m.Node.Position = p;
        if (dir.LengthSquared() > 1e-6f)
        {
            float yaw = Mathf.Atan2(dir.X, dir.Z);
            float pitch = m.OnWater ? Mathf.Sin(time * 1.3f + m.Bob) * 0.04f : m.Fly || m.Hover > 0 ? 0 : -Mathf.Atan2(dir.Y, new Vector2(dir.X, dir.Z).Length());
            m.Node.Rotation = new Vector3(pitch, Mathf.LerpAngle(m.Node.Rotation.Y, yaw, Math.Min(1f, dt * 6f)), 0);
        }
        m.Node.Visible = Seen(p);
    }

    private void Graze(Grazer g, float dt)
    {
        if (!g.Node.Visible) return;
        if (!g.Walking)
        {
            g.Wait -= dt;
            if (g.Wait > 0) return;
            float a = _rng.Randf() * Mathf.Tau;
            g.Target = g.Home + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * Mathf.Lerp(g.MinRoam, g.Roam, _rng.Randf());
            g.Walking = true;
            if (g.Walk != "") foreach (var ap in g.Players) Play(ap, g.Walk);
        }
        var p = g.Node.Position;
        var to = new Vector3(g.Target.X - p.X, 0, g.Target.Z - p.Z);
        if (to.Length() < 0.02f)
        {
            g.Walking = false;
            g.Wait = 2f + _rng.Randf() * 5f;
            if (g.Idle != "") foreach (var ap in g.Players) Play(ap, g.Idle);
            return;
        }
        var step = to.Normalized() * Math.Min(to.Length(), g.Speed * dt);
        g.Node.Position = Ground(p + step) + new Vector3(0, g.Hover, 0);
        g.Node.Rotation = new Vector3(0, Mathf.LerpAngle(g.Node.Rotation.Y, Mathf.Atan2(to.X, to.Z), Math.Min(1f, dt * 4f)), 0);
    }

    private static Vector3 Ground(Vector3 p) => new(p.X, HeightField.Current.Surface(p.X, p.Z), p.Z);

    private static float Rand(int t, int salt)
    {
        uint h = (uint)(t * 73856093) ^ (uint)(salt * 19349663);
        h ^= h >> 13; h *= 0x5bd1e995; h ^= h >> 15;
        return (h & 0xFFFFFF) / (float)0x1000000;
    }
}
