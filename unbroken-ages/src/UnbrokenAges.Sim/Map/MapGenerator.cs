using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;

namespace UnbrokenAges.Sim.Map;

public sealed class MapGenSettings
{
    public int Width { get; set; } = 64;
    public int Height { get; set; } = 40;
    public bool WrapX { get; set; } = true;
    public ulong Seed { get; set; } = 1;
    public int LandPercent { get; set; } = 34;
    public int ContinentSeeds { get; set; } = 3;
    /// <summary>Navigable Great Rivers to carve; -1 = scale with map size.</summary>
    public int GreatRivers { get; set; } = -1;
    public int MinGreatRiverLength { get; set; } = 5;
    /// <summary>Approximate percent of land vertices that carry a river edge.</summary>
    public int MinorRiverPercent { get; set; } = 9;
    public int Players { get; set; } = 4;
    /// <summary>-1 cold, 0 temperate, +1 hot.</summary>
    public int Temperature { get; set; }
    /// <summary>-1 arid, 0 normal, +1 wet.</summary>
    public int Rainfall { get; set; }
}

public sealed class MapGenStats
{
    public int LandTiles, Mountains, Hills, Lakes, ChannelTiles, RiverEdges, Floodplains, LowlandTiles, Resources;
    public override string ToString() =>
        $"land={LandTiles} mountains={Mountains} hills={Hills} lakeTiles={Lakes} greatRiverTiles={ChannelTiles} " +
        $"riverEdges={RiverEdges} floodplains={Floodplains} lowlands={LowlandTiles} resources={Resources}";
}

public sealed class GeneratedMap
{
    public required MapGrid Map { get; init; }
    public required List<int> StartTiles { get; init; }
    /// <summary>Each Great River as an ordered list of channel tiles from mouth to source.</summary>
    public required List<List<int>> GreatRivers { get; init; }
    public required MapGenStats Stats { get; init; }
}

/// <summary>
/// Deterministic, fixed-point map generator. Pipeline:
///  1. Elevation: continent mask + fractal noise (wraps east-west), sea level by land-percent.
///  2. Relief: ridged noise ranks mountains and hills.
///  3. Water bodies: coast/ocean, small enclosed seas become lakes.
///  4. Climate: latitude temperature; moisture from prevailing-wind sweeps with rain shadows.
///  5. Biomes + features (forest, rainforest, marsh, oasis, reef, ice, volcano, geothermal).
///  6. Tile drainage (priority-flood) → flow accumulation → Great River CHANNEL tiles carved
///     upstream from the largest mouths (contiguous, navigable, guaranteed to reach the sea).
///  7. Vertex drainage on the hex-corner graph → EDGE rivers (fresh water + adjacency) that
///     feed Great Rivers, lakes or the sea.
///  8. Floodplains, coastal lowlands (sea-level-rise bands), resources, start positions.
/// </summary>
public static class MapGenerator
{
    public static GeneratedMap Generate(GameDatabase db, MapGenSettings s)
    {
        var map = new MapGrid(db, s.Width, s.Height, s.WrapX);
        var ids = db.Ids;
        var rng = Pcg32.Derive(s.Seed, "mapgen");
        uint seedElevation = rng.NextUInt(), seedRidge = rng.NextUInt(), seedTemp = rng.NextUInt();
        uint seedMoist = rng.NextUInt(), seedFeature = rng.NextUInt();
        int n = map.Count;
        var stats = new MapGenStats();

        // Tile positions in map units (hex centres; odd rows shifted half a tile).
        var px = new Fx[n];
        var py = new Fx[n];
        var lat = new Fx[n];
        Fx rowHeight = Fx.Ratio(866, 1000);
        for (int i = 0; i < n; i++)
        {
            int col = i % s.Width, row = i / s.Width;
            px[i] = Fx.FromInt(col) + ((row & 1) == 1 ? Fx.Half : Fx.Zero);
            py[i] = rowHeight * row;
            lat[i] = Fx.Ratio(Math.Abs(2 * row - (s.Height - 1)), s.Height - 1);
        }

        // ----- 1. Elevation ------------------------------------------------------------------------
        var seeds = new List<int>();
        for (int k = 0; k < Math.Max(1, s.ContinentSeeds); k++)
        {
            int row = rng.NextInt(s.Height * 22 / 100, s.Height * 78 / 100);
            int col = rng.NextInt(s.Width);
            seeds.Add(row * s.Width + col);
        }
        int radius = Math.Max(6, (Fx.FromInt(s.Width) * Fx.Ratio(42, 100) / Fx.Sqrt(Fx.FromInt(seeds.Count))).FloorToInt());
        var elev = new Fx[n];
        for (int i = 0; i < n; i++)
        {
            int dMin = int.MaxValue;
            foreach (int sd in seeds) dMin = Math.Min(dMin, map.Distance(i, sd));
            Fx mask = Fx.One - Fx.Clamp(Fx.Ratio(dMin, radius), Fx.Zero, Fx.One);
            Fx noise = Noise.Fbm(px[i], py[i], s.Width, 4, 5, seedElevation, s.WrapX);
            Fx polar = lat[i] > Fx.Ratio(8, 10) ? (lat[i] - Fx.Ratio(8, 10)) * 2 : Fx.Zero;
            elev[i] = mask * Fx.Ratio(55, 100) + noise * Fx.Ratio(45, 100) - polar;
        }

        var byElevation = Enumerable.Range(0, n).ToArray();
        Array.Sort(byElevation, (a, b) => elev[b] != elev[a] ? elev[b].CompareTo(elev[a]) : a.CompareTo(b));
        int landTarget = n * s.LandPercent / 100;
        var isLand = new bool[n];
        for (int k = 0; k < landTarget; k++) isLand[byElevation[k]] = true;

        // Elevation stored as 0..10000 for drainage & sea-level bands.
        Fx minE = elev[byElevation[n - 1]], maxE = elev[byElevation[0]];
        Fx span = maxE - minE == Fx.Zero ? Fx.One : maxE - minE;
        for (int i = 0; i < n; i++) map.Elevation[i] = (short)((elev[i] - minE) * 10000 / span).FloorToInt();

        // ----- 2. Relief -----------------------------------------------------------------------------
        var landTiles = Enumerable.Range(0, n).Where(i => isLand[i]).ToArray();
        var reliefScore = new Fx[n];
        foreach (int i in landTiles)
        {
            Fx ridge = Fx.One - Fx.Abs(Noise.Fbm(px[i], py[i], s.Width, 6, 3, seedRidge, s.WrapX) * 2 - Fx.One);
            reliefScore[i] = elev[i] * Fx.Ratio(45, 100) + ridge * Fx.Ratio(55, 100);
        }
        Array.Sort(landTiles, (a, b) => reliefScore[b] != reliefScore[a] ? reliefScore[b].CompareTo(reliefScore[a]) : a.CompareTo(b));
        int mountainCount = landTiles.Length * 7 / 100, hillCount = landTiles.Length * 16 / 100;
        for (int k = 0; k < landTiles.Length; k++)
        {
            int i = landTiles[k];
            map.Relief[i] = (byte)(k < mountainCount ? ids.Mountain : k < mountainCount + hillCount ? ids.Hills : ids.Flat);
        }

        // ----- 3. Water bodies -----------------------------------------------------------------------
        for (int i = 0; i < n; i++)
        {
            if (isLand[i]) { map.Terrain[i] = (byte)ids.Grassland; continue; }
            bool nearLand = false;
            for (int d = 0; d < 6; d++)
            {
                int nb = map.Neighbor(i, d);
                if (nb >= 0 && isLand[nb]) nearLand = true;
            }
            map.Terrain[i] = (byte)(nearLand ? ids.Coast : ids.Ocean);
            map.Relief[i] = (byte)ids.Flat;
        }
        MarkLakes(map, ids, maxLakeSize: Math.Max(4, n / 600), stats);

        // ----- 4. Climate ----------------------------------------------------------------------------
        var temp = new Fx[n];
        for (int i = 0; i < n; i++)
        {
            Fx noise = Noise.Fbm(px[i], py[i], s.Width, 3, 3, seedTemp, s.WrapX);
            Fx t = Fx.One - lat[i] + (noise - Fx.Half) * Fx.Ratio(2, 10) + Fx.Ratio(s.Temperature, 10);
            if (map.Relief[i] == ids.Mountain) t -= Fx.Ratio(25, 100);
            else if (map.Relief[i] == ids.Hills) t -= Fx.Ratio(8, 100);
            temp[i] = t;
        }
        var moisture = ComputeMoisture(map, s, lat, temp, px, py, seedMoist, ids);

        // ----- 5. Biomes & features --------------------------------------------------------------------
        for (int i = 0; i < n; i++)
        {
            if (!map.IsLand(i)) continue;
            Fx t = temp[i], m = moisture[i];
            int terrain = t < Fx.Ratio(15, 100) ? ids.Snow
                : t < Fx.Ratio(30, 100) ? ids.Tundra
                : m < Fx.Ratio(22, 100) && t > Fx.Ratio(45, 100) ? ids.Desert
                : m < Fx.Ratio(48, 100) ? ids.Plains
                : ids.Grassland;
            map.Terrain[i] = (byte)terrain;
        }
        PlaceFeatures(map, s, rng, temp, moisture, lat, px, py, seedFeature, ids);
        PlaceInlandLakes(map, ids, moisture, stats);

        // ----- 6. Tile drainage & Great Rivers -----------------------------------------------------------
        var rain = new Fx[n];
        for (int i = 0; i < n; i++)
            rain[i] = map.IsLand(i) ? moisture[i] + Fx.Ratio(25, 100) + (map.IsMountain(i) ? Fx.Ratio(4, 10) : Fx.Zero) : Fx.Zero;
        var (filled, downstream, tileOrder) = PriorityFlood(map);
        var acc = (Fx[])rain.Clone();
        for (int k = tileOrder.Count - 1; k >= 0; k--)
        {
            int t = tileOrder[k];
            int down = downstream[t];
            if (map.IsLand(t) && down >= 0 && map.IsLand(down)) acc[down] += acc[t];
        }
        var greatRivers = CarveGreatRivers(map, s, ids, acc, downstream, stats);

        // ----- 7. Vertex drainage → edge rivers -------------------------------------------------------
        var vertexAcc = TraceEdgeRivers(map, s, filled, rain, stats, out Fx riverThreshold);

        // ----- 8. Floodplains, lowlands, resources, starts ---------------------------------------------
        PlaceFloodplains(map, ids, rng, vertexAcc, riverThreshold, stats);
        MarkLowlands(map, stats);
        PlaceResources(map, db, rng, stats);

        for (int i = 0; i < n; i++)
        {
            if (!map.IsLand(i)) continue;
            stats.LandTiles++;
            if (map.Relief[i] == ids.Mountain) stats.Mountains++;
            else if (map.Relief[i] == ids.Hills) stats.Hills++;
        }

        var starts = ChooseStartPositions(map, ids, s.Players);
        return new GeneratedMap { Map = map, StartTiles = starts, GreatRivers = greatRivers, Stats = stats };
    }

    private static void MarkLakes(MapGrid map, WellKnownIds ids, int maxLakeSize, MapGenStats stats)
    {
        var seen = new bool[map.Count];
        var queue = new Queue<int>();
        var component = new List<int>();
        for (int start = 0; start < map.Count; start++)
        {
            if (seen[start] || map.IsLand(start)) continue;
            component.Clear();
            seen[start] = true;
            queue.Enqueue(start);
            while (queue.Count > 0)
            {
                int c = queue.Dequeue();
                component.Add(c);
                for (int d = 0; d < 6; d++)
                {
                    int nb = map.Neighbor(c, d);
                    if (nb >= 0 && !seen[nb] && !map.IsLand(nb)) { seen[nb] = true; queue.Enqueue(nb); }
                }
            }
            if (component.Count <= maxLakeSize)
            {
                foreach (int c in component) map.Terrain[c] = (byte)ids.Lake;
                stats.Lakes += component.Count;
            }
        }
    }

    /// <summary>Lakes form in wet, flat interior basins (local elevation minima away from the sea).</summary>
    private static void PlaceInlandLakes(MapGrid map, WellKnownIds ids, Fx[] moisture, MapGenStats stats)
    {
        int target = Math.Max(1, map.Count / 700);
        var basins = new List<int>();
        for (int i = 0; i < map.Count; i++)
        {
            if (!map.IsLand(i) || map.Relief[i] != ids.Flat || map.IsAdjacentToSea(i) || moisture[i] < Fx.Ratio(35, 100)) continue;
            int around = 0;
            bool interior = true;
            for (int d = 0; d < 6; d++)
            {
                int n = map.Neighbor(i, d);
                if (n < 0 || !map.IsLand(n)) { interior = false; break; }
                around += map.Elevation[n];
            }
            if (interior && map.Elevation[i] * 6 <= around) basins.Add(i); // lower than its surroundings on average
        }
        basins.Sort((a, b) => moisture[b] != moisture[a] ? moisture[b].CompareTo(moisture[a]) : a.CompareTo(b));
        var lakes = new List<int>();
        foreach (int b in basins)
        {
            if (lakes.Count >= target) break;
            if (lakes.Any(l => map.Distance(l, b) < 6)) continue;
            lakes.Add(b);
            map.Terrain[b] = (byte)ids.Lake;
            map.Feature[b] = -1;
            stats.Lakes++;
            // Grow into the lowest flat neighbour for a two-tile lake when possible.
            int best = -1;
            for (int d = 0; d < 6; d++)
            {
                int n = map.Neighbor(b, d);
                if (n >= 0 && map.IsLand(n) && map.Relief[n] == ids.Flat && !map.IsAdjacentToSea(n) && (best < 0 || map.Elevation[n] < map.Elevation[best])) best = n;
            }
            if (best >= 0)
            {
                map.Terrain[best] = (byte)ids.Lake;
                map.Feature[best] = -1;
                stats.Lakes++;
            }
        }
    }

    private static Fx[] ComputeMoisture(MapGrid map, MapGenSettings s, Fx[] lat, Fx[] temp, Fx[] px, Fx[] py, uint seed, WellKnownIds ids)
    {
        int n = map.Count;
        var deposit = new Fx[n];
        for (int row = 0; row < s.Height; row++)
        {
            Fx l = lat[row * s.Width];
            // Easterlies in the tropics and polar band, westerlies at mid latitudes.
            int dir = l < Fx.Ratio(1, 3) || l > Fx.Ratio(2, 3) ? -1 : 1;
            int col = dir > 0 ? 0 : s.Width - 1;
            Fx humidity = Fx.Ratio(6, 10);
            int laps = s.WrapX ? 2 : 1;
            for (int step = 0; step < s.Width * laps; step++)
            {
                int i = row * s.Width + col;
                if (!map.IsLand(i))
                {
                    humidity = Fx.Min(Fx.One, humidity + Fx.Ratio(10, 100) + Fx.Clamp(temp[i], Fx.Zero, Fx.One) * Fx.Ratio(15, 100));
                }
                else
                {
                    Fx rate = map.IsMountain(i) ? Fx.Ratio(55, 100) : map.Relief[i] == ids.Hills ? Fx.Ratio(20, 100) : Fx.Ratio(9, 100);
                    Fx rain = humidity * rate;
                    if (!s.WrapX || step >= s.Width) deposit[i] += rain;
                    humidity = humidity - rain + Fx.Ratio(2, 100);
                }
                col += dir;
                if (col < 0) col += s.Width;
                if (col >= s.Width) col -= s.Width;
            }
        }
        var moisture = new Fx[n];
        for (int i = 0; i < n; i++)
        {
            Fx noise = Noise.Fbm(px[i], py[i], s.Width, 5, 3, seed, s.WrapX);
            Fx m = Fx.Clamp(deposit[i] * 4, Fx.Zero, Fx.One) * Fx.Ratio(55, 100)
                 + noise * Fx.Ratio(30, 100)
                 + (Fx.One - lat[i]) * Fx.Ratio(15, 100)
                 + Fx.Ratio(s.Rainfall * 8, 100);
            moisture[i] = Fx.Clamp(m, Fx.Zero, Fx.One);
        }
        return moisture;
    }

    private static bool FeatureValid(MapGrid map, int feature, int tile)
    {
        if (feature < 0) return false;
        var valid = map.Db.Features[feature].ValidTerrainIndices;
        return valid.Length == 0 || valid.Contains(map.Terrain[tile]);
    }

    private static void PlaceFeatures(MapGrid map, MapGenSettings s, Pcg32 rng, Fx[] temp, Fx[] moisture, Fx[] lat, Fx[] px, Fx[] py, uint seed, WellKnownIds ids)
    {
        for (int i = 0; i < map.Count; i++)
        {
            Fx fn = Noise.Fbm(px[i], py[i], s.Width, 10, 2, seed, s.WrapX);
            if (!map.IsLand(i))
            {
                if (lat[i] > Fx.Ratio(88, 100) && rng.ChancePermille(700) && FeatureValid(map, ids.Ice, i)) map.Feature[i] = (short)ids.Ice;
                else if (map.ClassAt(i) == TerrainClass.Coast && lat[i] < Fx.Ratio(55, 100) && rng.ChancePermille(70) && FeatureValid(map, ids.Reef, i))
                    map.Feature[i] = (short)ids.Reef;
                continue;
            }
            if (map.IsMountain(i))
            {
                if (rng.ChancePermille(50) && ids.Volcano >= 0) map.Feature[i] = (short)ids.Volcano;
                continue;
            }
            Fx t = temp[i], m = moisture[i];
            int f = -1;
            if (t > Fx.Ratio(72, 100) && m > Fx.Ratio(58, 100) && fn > Fx.Ratio(42, 100)) f = ids.Rainforest;
            else if (t > Fx.Ratio(30, 100) && t < Fx.Ratio(75, 100) && m > Fx.Ratio(42, 100) && fn > Fx.Ratio(50, 100)) f = ids.Forest;
            else if (map.Relief[i] == ids.Flat && m > Fx.Ratio(70, 100) && t > Fx.Ratio(35, 100) && fn < Fx.Ratio(22, 100)) f = ids.Marsh;
            else if (map.Terrain[i] == ids.Desert && map.Relief[i] == ids.Flat && rng.ChancePermille(30)) f = ids.Oasis;
            else if (rng.ChancePermille(6)) f = ids.Geothermal;
            if (FeatureValid(map, f, i)) map.Feature[i] = (short)f;
        }
    }

    /// <summary>Priority-flood from all water tiles: every land tile gets a downstream neighbour, no pits.</summary>
    private static (int[] Filled, int[] Downstream, List<int> Order) PriorityFlood(MapGrid map)
    {
        int n = map.Count;
        var filled = new int[n];
        var downstream = new int[n];
        Array.Fill(downstream, -1);
        var visited = new bool[n];
        var order = new List<int>(n);
        var pq = new PriorityQueue<int, long>();
        for (int i = 0; i < n; i++)
        {
            if (map.IsLand(i)) continue;
            visited[i] = true;
            filled[i] = map.Elevation[i];
            pq.Enqueue(i, ((long)filled[i] << 24) | (uint)i);
        }
        while (pq.TryDequeue(out int cur, out _))
        {
            order.Add(cur);
            for (int d = 0; d < 6; d++)
            {
                int nb = map.Neighbor(cur, d);
                if (nb < 0 || visited[nb]) continue;
                visited[nb] = true;
                filled[nb] = Math.Max(map.Elevation[nb], filled[cur] + 1);
                downstream[nb] = cur;
                pq.Enqueue(nb, ((long)filled[nb] << 24) | (uint)nb);
            }
        }
        // Land not reachable from any water (landlocked worlds) drains to itself.
        for (int i = 0; i < n; i++)
            if (!visited[i]) { filled[i] = map.Elevation[i]; order.Add(i); }
        return (filled, downstream, order);
    }

    private static List<List<int>> CarveGreatRivers(MapGrid map, MapGenSettings s, WellKnownIds ids, Fx[] acc, int[] downstream, MapGenStats stats)
    {
        int target = s.GreatRivers >= 0 ? s.GreatRivers : Math.Max(1, map.Count / 1100);
        int maxLength = Math.Max(8, (s.Width + s.Height) / 3);
        var result = new List<List<int>>();
        if (target == 0) return result;

        var mouths = Enumerable.Range(0, map.Count)
            .Where(t => map.IsLand(t) && !map.IsMountain(t) && downstream[t] >= 0 && !map.IsLand(downstream[t]) && !map.IsChannel(downstream[t]))
            .OrderByDescending(t => acc[t]).ThenBy(t => t)
            .ToList();

        bool TouchesChannel(int t)
        {
            for (int d = 0; d < 6; d++)
            {
                int nb = map.Neighbor(t, d);
                if (nb >= 0 && map.IsChannel(nb)) return true;
            }
            return map.IsChannel(t);
        }

        foreach (int mouth in mouths)
        {
            if (result.Count >= target) break;
            if (TouchesChannel(mouth)) continue;
            var path = new List<int> { mouth };
            int cur = mouth;
            Fx minAcc = acc[mouth] * Fx.Ratio(8, 100);
            while (path.Count < maxLength)
            {
                int best = -1;
                for (int d = 0; d < 6; d++)
                {
                    int up = map.Neighbor(cur, d);
                    if (up < 0 || downstream[up] != cur || !map.IsLand(up) || map.IsMountain(up)) continue;
                    if (best < 0 || acc[up] > acc[best] || (acc[up] == acc[best] && up < best)) best = up;
                }
                if (best < 0 || acc[best] < minAcc || TouchesChannel(best)) break;
                path.Add(best);
                cur = best;
            }
            if (path.Count < s.MinGreatRiverLength) continue;
            foreach (int t in path)
            {
                map.Terrain[t] = (byte)ids.Channel;
                map.Relief[t] = (byte)ids.Flat;
                map.Feature[t] = -1;
            }
            stats.ChannelTiles += path.Count;
            result.Add(path);
        }
        return result;
    }

    private static Fx[] TraceEdgeRivers(MapGrid map, MapGenSettings s, int[] filled, Fx[] rain, MapGenStats stats, out Fx threshold)
    {
        int vc = map.VertexCount;
        var isSink = new bool[vc];
        var velev = new int[vc];
        var vrain = new Fx[vc];
        Span<int> tiles = stackalloc int[3];
        for (int v = 0; v < vc; v++)
        {
            map.VertexTiles(v, tiles);
            int sum = 0;
            foreach (int t in tiles)
            {
                if (t < 0 || !map.IsLand(t)) { isSink[v] = true; continue; }
                sum += filled[t];
                vrain[v] += rain[t] / 3;
            }
            velev[v] = sum;
        }

        var vfilled = new int[vc];
        var vdown = new int[vc];
        Array.Fill(vdown, -1);
        var visited = new bool[vc];
        var order = new List<int>(vc);
        var pq = new PriorityQueue<int, long>();
        for (int v = 0; v < vc; v++)
        {
            if (!isSink[v]) continue;
            visited[v] = true;
            pq.Enqueue(v, v);
        }
        Span<int> nbs = stackalloc int[3];
        while (pq.TryDequeue(out int cur, out _))
        {
            order.Add(cur);
            map.VertexNeighbors(cur, nbs);
            foreach (int nb in nbs)
            {
                if (nb < 0 || visited[nb]) continue;
                visited[nb] = true;
                vfilled[nb] = Math.Max(velev[nb], vfilled[cur] + 1);
                vdown[nb] = cur;
                pq.Enqueue(nb, ((long)vfilled[nb] << 25) | (uint)nb);
            }
        }

        var vacc = (Fx[])vrain.Clone();
        for (int k = order.Count - 1; k >= 0; k--)
        {
            int v = order[k];
            if (isSink[v] || vdown[v] < 0 || isSink[vdown[v]]) continue;
            vacc[vdown[v]] += vacc[v];
        }

        var land = new List<Fx>();
        for (int v = 0; v < vc; v++) if (!isSink[v]) land.Add(vacc[v]);
        land.Sort();
        threshold = land.Count == 0 ? Fx.MaxValue : land[Math.Min(land.Count - 1, land.Count * (100 - s.MinorRiverPercent) / 100)];

        for (int v = 0; v < vc; v++)
        {
            if (isSink[v] || vacc[v] < threshold || vdown[v] < 0) continue;
            var (a, b) = map.EdgeTiles(v, vdown[v]);
            if (a < 0 || b < 0 || !map.IsLand(a) || !map.IsLand(b)) continue;
            int dir = map.DirectionTo(a, b);
            if (dir < 0 || map.HasRiverEdge(a, dir)) continue;
            map.SetRiverEdge(a, dir, true);
            stats.RiverEdges++;
        }
        return vacc;
    }

    private static void PlaceFloodplains(MapGrid map, WellKnownIds ids, Pcg32 rng, Fx[] vacc, Fx threshold, MapGenStats stats)
    {
        if (ids.Floodplains < 0) return;
        Span<int> verts = stackalloc int[6];
        for (int i = 0; i < map.Count; i++)
        {
            if (!map.IsLand(i) || map.Relief[i] != ids.Flat || map.Feature[i] >= 0) continue;
            if (!FeatureValid(map, ids.Floodplains, i)) continue;
            bool major = false;
            if (map.HasRiver(i))
            {
                map.TileVertices(i, verts);
                foreach (int v in verts)
                    if (v >= 0 && vacc[v] >= threshold * 2) major = true;
            }
            if (major || (map.IsAdjacentToChannel(i) && rng.ChancePermille(600)))
            {
                map.Feature[i] = (short)ids.Floodplains;
                stats.Floodplains++;
            }
        }
    }

    private static void MarkLowlands(MapGrid map, MapGenStats stats)
    {
        var coastal = Enumerable.Range(0, map.Count)
            .Where(i => map.IsLand(i) && !map.IsMountain(i) && map.Relief[i] == map.Db.Ids.Flat && map.IsAdjacentToSea(i))
            .OrderBy(i => map.Elevation[i]).ThenBy(i => i)
            .ToList();
        int lowCount = coastal.Count * 35 / 100;
        for (int k = 0; k < lowCount; k++)
        {
            map.Lowland[coastal[k]] = (byte)(1 + k * 3 / Math.Max(1, lowCount));
            stats.LowlandTiles++;
        }
    }

    private static void PlaceResources(MapGrid map, GameDatabase db, Pcg32 rng, MapGenStats stats)
    {
        foreach (var res in db.Resources)
        {
            // Never consume randomness for resources that don't appear on maps (manufactured goods),
            // so adding such content can't reshuffle every seed's map.
            if (res.Frequency <= 0 || res.Class == ResourceClass.Good) continue;
            var eligible = new List<int>();
            for (int i = 0; i < map.Count; i++)
            {
                if (map.Resource[i] >= 0 || map.IsChannel(i)) continue;
                if (res.ValidTerrainIndices.Length > 0 && !res.ValidTerrainIndices.Contains(map.Terrain[i])) continue;
                if (res.ValidFeatureIndices.Length > 0 ? !res.ValidFeatureIndices.Contains(map.Feature[i]) : map.Feature[i] >= 0 && map.Feature[i] != db.Ids.Floodplains) continue;
                if (res.ValidReliefIndices.Length > 0 ? !res.ValidReliefIndices.Contains(map.Relief[i]) : map.IsMountain(i)) continue;
                eligible.Add(i);
            }
            int target = eligible.Count * res.Frequency / 1000;
            rng.Shuffle(eligible);
            int spacing = res.Class == ResourceClass.Bonus ? 1 : 3;
            var placed = new List<int>();
            foreach (int i in eligible)
            {
                if (placed.Count >= target) break;
                bool crowded = false;
                foreach (int p in placed)
                    if (map.Distance(p, i) <= spacing) { crowded = true; break; }
                if (crowded) continue;
                if (res.Class == ResourceClass.Bonus)
                {
                    for (int d = 0; d < 6 && !crowded; d++)
                    {
                        int nb = map.Neighbor(i, d);
                        if (nb >= 0 && map.Resource[nb] >= 0) crowded = true;
                    }
                    if (crowded) continue;
                }
                map.Resource[i] = (short)res.Index;
                placed.Add(i);
                stats.Resources++;
            }
        }
    }

    private static List<int> ChooseStartPositions(MapGrid map, WellKnownIds ids, int players)
    {
        var scored = new List<(int Tile, int Score)>();
        var ring = new List<int>();
        for (int i = 0; i < map.Count; i++)
        {
            if (!map.IsLand(i) || map.IsMountain(i) || map.Terrain[i] == ids.Snow) continue;
            if (map.Feature[i] >= 0 && (map.Feature[i] == ids.Marsh || map.Feature[i] == ids.Oasis || map.Feature[i] == ids.Volcano)) continue;
            ring.Clear();
            map.CollectRadius(i, 2, ring);
            int score = 0;
            foreach (int t in ring)
            {
                if (t == i) continue;
                var y = map.TileYields(t);
                int w = map.IsLand(t) ? 1 : 0;
                score += y.Food.FloorToInt() * (2 + w) + y.Production.FloorToInt() * 2 + y.Gold.FloorToInt();
                if (map.Resource[t] >= 0) score += 2;
            }
            if (map.HasFreshWaterAccess(i)) score += 15;
            if (map.IsAdjacentToSea(i)) score += 6;
            if (map.IsAdjacentToChannel(i)) score += 8;
            if (map.Terrain[i] == ids.Tundra || map.Terrain[i] == ids.Desert) score -= 8;
            scored.Add((i, score));
        }
        scored.Sort((a, b) => a.Score != b.Score ? b.Score.CompareTo(a.Score) : a.Tile.CompareTo(b.Tile));

        int landTiles = scored.Count;
        int minDist = Math.Max(5, Fx.Sqrt(Fx.Ratio(Math.Max(1, landTiles), Math.Max(1, players))).FloorToInt());
        var chosen = new List<int>();
        while (chosen.Count < players && minDist >= 2)
        {
            foreach (var (tile, _) in scored)
            {
                if (chosen.Count >= players) break;
                if (chosen.All(c => map.Distance(c, tile) >= minDist)) chosen.Add(tile);
            }
            minDist--;
        }
        return chosen;
    }
}
