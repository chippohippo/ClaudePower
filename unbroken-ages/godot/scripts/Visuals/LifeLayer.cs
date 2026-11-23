using Godot;
using UnbrokenAges.Client.Map;
using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Client.Visuals;

/// <summary>
/// The world going about its business, purely client-side and seeded from the map so it is the same every time you look:
/// <list type="bullet">
/// <item><b>Roads</b> join each civilization's cities (a spanning tree of land paths), plus spur tracks from improved resources
///   to the city that works them. Dirt tracks until the industrial era, paved after.</item>
/// <item><b>Traffic</b>: covered wagons and carts early, lorries and cars later, shuttle along the roads carrying the harvest.</item>
/// <item><b>Boats</b>: fishing boats work the fish, canoes the pearl beds, sailboats tack off coastal cities.</item>
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
        public float At, Speed, Bob;
        public bool Loop, OnWater;
        public int Dir = 1;
    }

    private sealed class Grazer
    {
        public Node3D Node = null!;
        public List<AnimationPlayer> Players = new();
        public Vector3 Home, Target;
        public float Wait, Speed, Roam, YawOffset;
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
        foreach (var p in s.Players) h.Add(s.PlayerEra(p) >= 4);
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
        var dirt = new List<(Vector3[] Pts, float Half)>();
        var paved = new List<(Vector3[] Pts, float Half)>();
        foreach (var group in s.Cities.Where(c => Known(c.Tile)).GroupBy(c => c.Owner))
        {
            var owner = s.Players[group.Key];
            bool modern = s.PlayerEra(owner) >= 4;
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
                AddRoad(map, path, Known, modern ? paved : dirt, 0.13f, owner, s, true);
            }
            // Resource spurs: improved resources (and farms) worked by a city, one track each.
            foreach (var c in cities)
                for (int t = 0; t < map.Count; t++)
                {
                    if (map.OwnerCity[t] != c.Id || map.Improvement[t] < 0 || t == c.Tile || !Known(t)) continue;
                    if (map.Resource[t] < 0 || map.Distance(t, c.Tile) > 4) continue;
                    var path = LandPath(map, t, c.Tile, 6);
                    if (path != null) AddRoad(map, path, Known, modern ? paved : dirt, 0.08f, owner, s, false, t);
                }
        }
        _roads.Mesh = RoadMesh(dirt, paved, map);

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
            if (imp == "IMPROVEMENT_FARM" && map.OwnerPlayer[t] >= 0 && s.PlayerEra(s.Players[map.OwnerPlayer[t]]) >= 4 && Rand(t, 7) < 0.5f)
                Plough(t, centre);
        }

        // ---- Cities: chimney smoke, and sailboats off the coast ----
        foreach (var c in s.Cities.Where(c => Known(c.Tile)))
        {
            var at = HexLayout.ToWorld(map.CoordOf(c.Tile), 0);
            // One plume per house (HexMapView.DressCity puts them on a ring at 30° + 60°·i), from roughly its chimney.
            int houses = Math.Clamp(1 + c.Population / 2, 1, 6);
            bool industrial = s.PlayerEra(s.Players[c.Owner]) >= 4;
            for (int i = 0; i < Math.Min(houses, 4); i++)
            {
                float a = Mathf.DegToRad(30 + 60 * i);
                Smoke(c.Tile, at + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * 0.62f, industrial, 0.4f);
            }
            if (industrial) Smoke(c.Tile, at + new Vector3(-0.5f, 0, 0.4f), true, 0.9f);   // a factory stack
            for (int d = 0; d < 6; d++)
            {
                int n = map.Neighbor(c.Tile, d);
                if (n < 0 || !map.IsWater(n)) continue;
                Boat(n, HexLayout.ToWorld(map.CoordOf(n), 0), "life/sailboat", 0.5f, 0.6f, 0.16f);
                break;
            }
        }

        // ---- Birds: a few flocks per map, circling slowly over the known world ----
        _flocks.Clear();
        var land = Enumerable.Range(0, map.Count).Where(t => Known(t) && !map.IsWater(t)).ToList();
        int flocks = Math.Clamp(land.Count / 90, land.Count > 0 ? 1 : 0, 6);
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

    private void AddRoad(MapGrid map, List<int> tiles, Func<int, bool> known, List<(Vector3[], float)> into, float half, PlayerState owner, GameState s, bool trunk, int resourceTile = -1)
    {
        // Split where the path leaves the known map; each known run becomes a smooth polyline.
        var run = new List<Vector3>();
        void Flush()
        {
            if (run.Count >= 2)
            {
                var pts = Smooth(run);
                into.Add((pts, half));
                _roadPaths.Add(pts);
                AddTraffic(pts, s, owner, trunk, resourceTile);
            }
            run.Clear();
        }
        foreach (int t in tiles)
        {
            if (!known(t)) { Flush(); continue; }
            var p = HexLayout.ToWorld(map.CoordOf(t), 0);
            // Wander a little off the centre line so roads do not look ruled.
            p += new Vector3(Rand(t, 11) - 0.5f, 0, Rand(t, 12) - 0.5f) * 0.35f;
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

    private ArrayMesh RoadMesh(List<(Vector3[] Pts, float Half)> dirt, List<(Vector3[] Pts, float Half)> paved, MapGrid? map)
    {
        var mesh = new ArrayMesh();
        foreach (var (list, isPaved) in new[] { (dirt, false), (paved, true) })
        {
            if (list.Count == 0) continue;
            var st = new SurfaceTool();
            st.Begin(Mesh.PrimitiveType.Triangles);
            var hf = HeightField.Current;
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
                    Vector3 Lift(Vector3 p) => new(p.X, hf.Surface(p.X, p.Z) + 0.045f, p.Z);
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
            mat.SetShaderParameter("paved", isPaved);
            if (map != null && (_mapView ??= GetParentOrNull<HexMapView>()) is { } view) view.ShareMapUniforms(mat, map);
            st.SetMaterial(mat);
            st.Commit(mesh);
        }
        return mesh;
    }

    // ----- Traffic ----------------------------------------------------------------------------------

    private void AddTraffic(Vector3[] pts, GameState s, PlayerState owner, bool trunk, int resourceTile)
    {
        float length = 0;
        for (int i = 0; i < pts.Length - 1; i++) length += pts[i].DistanceTo(pts[i + 1]);
        int era = s.PlayerEra(owner);
        int count = trunk ? Math.Clamp((int)(length / 2.5f), 1, 4) : 1;
        int seed = (int)(pts[0].X * 31 + pts[0].Z * 17);
        for (int i = 0; i < count; i++)
        {
            Node3D vehicle;
            float speed;
            if (era >= 4)
            {
                string model = !trunk ? "life/truck" : Rand(seed, i) < 0.55f ? "life/car" : "life/truck";
                vehicle = Fitted(model, model == "life/car" ? 0.32f : 0.4f, 0, team: owner);
                speed = 0.65f;
            }
            else
            {
                vehicle = Wagon(!trunk || Rand(seed, i) < 0.5f);
                speed = 0.32f;
            }
            var mover = new Mover { Node = vehicle, Path = pts, Speed = speed * (0.85f + 0.3f * Rand(seed, i + 9)), Loop = false };
            mover.Length = Cumulative(pts);
            mover.At = Rand(seed, i + 3) * mover.Length[^1];
            mover.Dir = Rand(seed, i + 5) < 0.5f ? 1 : -1;
            _dynamic.AddChild(vehicle);
            _movers.Add(mover);
        }
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

    private Node3D FittedRaw(string model, float size, float yawOffset)
    {
        var holder = new Node3D();
        var scene = _models.LoadScene(model);
        if (scene == null) return holder;
        var inst = scene.Instantiate<Node3D>();
        var b = _models.SceneBounds(model);
        float extent = Mathf.Max(b.Size.X, b.Size.Z);
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

    private void Boat(int tile, Vector3 centre, string model, float size, float radius, float speed)
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
            _dynamic.AddChild(boat);
            var m = new Mover { Node = boat, Path = pts, Speed = speed, Loop = true, OnWater = true, Bob = Rand(tile, 3) * 6f };
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

    private static void Play(AnimationPlayer ap, string name)
    {
        var all = ap.GetAnimationList();
        var hit = all.FirstOrDefault(a => a == name) ?? all.FirstOrDefault(a => a.Contains(name, StringComparison.OrdinalIgnoreCase));
        if (hit == null) return;
        ap.GetAnimation(hit).LoopMode = Animation.LoopModeEnum.Linear;
        if (ap.CurrentAnimation != hit) ap.Play(hit, 0.3);
    }

    // ----- Smoke and birds --------------------------------------------------------------------------

    private readonly List<(Vector3 At, int Tile, bool Coal)> _plumes = new();
    private MultiMeshInstance3D _smokeMesh = null!;
    private const int PuffsPerPlume = 7;

    private void Smoke(int tile, Vector3 at, bool industrial, float height) => _plumes.Add((Ground(at) + new Vector3(0, height, 0), tile, industrial));

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
                mm.SetInstanceCustomData(n, new Color((i + Rand(p, 5)) / PuffsPerPlume, _plumes[p].Coal ? 1 : 0, 0, 0));
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
        if (m.OnWater) p.Y = 0.01f + Mathf.Sin(time * 1.6f + m.Bob) * 0.012f;
        else p.Y = HeightField.Current.Surface(p.X, p.Z) + 0.035f;
        m.Node.Position = p;
        if (dir.LengthSquared() > 1e-6f)
        {
            float yaw = Mathf.Atan2(dir.X, dir.Z);
            float pitch = m.OnWater ? Mathf.Sin(time * 1.3f + m.Bob) * 0.04f : -Mathf.Atan2(dir.Y, new Vector2(dir.X, dir.Z).Length());
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
            g.Target = g.Home + new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * g.Roam * _rng.Randf();
            g.Walking = true;
            foreach (var ap in g.Players) Play(ap, g.Walk);
        }
        var p = g.Node.Position;
        var to = new Vector3(g.Target.X - p.X, 0, g.Target.Z - p.Z);
        if (to.Length() < 0.02f)
        {
            g.Walking = false;
            g.Wait = 2f + _rng.Randf() * 5f;
            foreach (var ap in g.Players) Play(ap, g.Idle);
            return;
        }
        var step = to.Normalized() * Math.Min(to.Length(), g.Speed * dt);
        g.Node.Position = Ground(p + step);
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
