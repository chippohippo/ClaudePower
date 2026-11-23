using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;

namespace UnbrokenAges.Sim.Map;

[Flags]
public enum TileFlags : byte
{
    None = 0,
    Pillaged = 1,
    Flooded = 2,
    Submerged = 4,
    Bridge = 8,
    FloodProtected = 16,
    Contaminated = 32,
}

/// <summary>
/// Hex map stored as structure-of-arrays (cache-friendly, trivially serializable, cheap to hash).
/// Rows use "odd-r" offset layout; the map optionally wraps east-west (cylinder).
///
/// Rivers live on tile EDGES (minor/major rivers: fresh water, adjacency, crossing penalties)
/// while Great Rivers are CHANNEL tiles (navigable water). See docs/systems/mapgen-rivers.md.
///
/// Vertex model: every tile owns its North (k=0) and South (k=1) corner, so vertex id =
/// tile*2+k. Each vertex touches 3 tiles and 3 vertices. River drainage runs on this graph.
/// </summary>
public sealed class MapGrid
{
    public const int NoValue = -1;

    public GameDatabase Db { get; }
    public int Width { get; }
    public int Height { get; }
    public bool WrapX { get; }
    public int Count { get; }

    public readonly byte[] Terrain;
    public readonly byte[] Relief;
    public readonly short[] Feature;
    public readonly short[] Resource;
    public readonly short[] Improvement;
    public readonly short[] District;
    public readonly short[] Elevation;
    public readonly byte[] RiverEdges;
    /// <summary>Coastal lowland band (0 = not lowland, 1..3 = metres above sea level).</summary>
    public readonly byte[] Lowland;
    public readonly byte[] Flags;
    /// <summary>Permanent extra food from floods/eruptions.</summary>
    public readonly byte[] Fertility;
    public readonly int[] OwnerPlayer;
    public readonly int[] OwnerCity;
    /// <summary>City id that has reserved this tile for a queued district or wonder.</summary>
    public readonly int[] Reservation;

    private readonly int[] _neighbors;
    private readonly TerrainClass[] _terrainClass;
    private readonly bool[] _terrainFresh;
    private readonly bool[] _featureFresh;

    public MapGrid(GameDatabase db, int width, int height, bool wrapX)
    {
        if (width < 4 || height < 4) throw new ArgumentOutOfRangeException(nameof(width), "Map must be at least 4x4.");
        if (height % 2 != 0) throw new ArgumentException("Height must be even so odd-r wrapping lines up.", nameof(height));
        Db = db;
        Width = width;
        Height = height;
        WrapX = wrapX;
        Count = width * height;

        Terrain = new byte[Count];
        Relief = new byte[Count];
        Feature = Filled<short>(Count, -1);
        Resource = Filled<short>(Count, -1);
        Improvement = Filled<short>(Count, -1);
        District = Filled<short>(Count, -1);
        Elevation = new short[Count];
        RiverEdges = new byte[Count];
        Lowland = new byte[Count];
        Flags = new byte[Count];
        Fertility = new byte[Count];
        OwnerPlayer = Filled(Count, -1);
        OwnerCity = Filled(Count, -1);
        Reservation = Filled(Count, -1);

        _neighbors = new int[Count * 6];
        for (int i = 0; i < Count; i++)
        {
            var c = CoordOf(i);
            for (int d = 0; d < 6; d++) _neighbors[i * 6 + d] = IndexOf(c.Neighbor(d));
        }

        _terrainClass = db.Terrains.Select(t => t.Class).ToArray();
        _terrainFresh = db.Terrains.Select(t => t.FreshWater).ToArray();
        _featureFresh = db.Features.Select(f => f.FreshWater).ToArray();
    }

    private static T[] Filled<T>(int n, T value)
    {
        var a = new T[n];
        Array.Fill(a, value);
        return a;
    }

    // ----- Coordinates ----------------------------------------------------------------------------

    public int IndexOf(HexCoord c)
    {
        var (col, row) = c.ToOffset();
        if (row < 0 || row >= Height) return NoValue;
        if (WrapX) col = ((col % Width) + Width) % Width;
        else if (col < 0 || col >= Width) return NoValue;
        return row * Width + col;
    }

    public HexCoord CoordOf(int index) => HexCoord.FromOffset(index % Width, index / Width);

    public int Neighbor(int index, int direction) => _neighbors[index * 6 + direction];

    /// <summary>Direction d such that Neighbor(a, d) == b, or -1 if not adjacent.</summary>
    public int DirectionTo(int a, int b)
    {
        for (int d = 0; d < 6; d++)
            if (_neighbors[a * 6 + d] == b) return d;
        return -1;
    }

    public int Distance(int a, int b)
    {
        var ca = CoordOf(a);
        var cb = CoordOf(b);
        int d = HexCoord.Distance(ca, cb);
        if (WrapX)
        {
            d = Math.Min(d, HexCoord.Distance(ca, new HexCoord(cb.Q + Width, cb.R)));
            d = Math.Min(d, HexCoord.Distance(ca, new HexCoord(cb.Q - Width, cb.R)));
        }
        return d;
    }

    /// <summary>Adds all tiles within radius of center (inclusive), in deterministic spiral-free scan order.</summary>
    public void CollectRadius(int center, int radius, List<int> into)
    {
        var c = CoordOf(center);
        for (int dq = -radius; dq <= radius; dq++)
        {
            int rMin = Math.Max(-radius, -dq - radius);
            int rMax = Math.Min(radius, -dq + radius);
            for (int dr = rMin; dr <= rMax; dr++)
            {
                int i = IndexOf(new HexCoord(c.Q + dq, c.R + dr));
                if (i >= 0 && !into.Contains(i)) into.Add(i);
            }
        }
    }

    // ----- Rivers (edges) -------------------------------------------------------------------------

    public bool HasRiverEdge(int index, int direction) => (RiverEdges[index] & (1 << direction)) != 0;
    public bool HasRiver(int index) => RiverEdges[index] != 0;
    public int RiverEdgeCount(int index) => System.Numerics.BitOperations.PopCount(RiverEdges[index]);

    public void SetRiverEdge(int index, int direction, bool on)
    {
        int other = Neighbor(index, direction);
        int opposite = HexCoord.Opposite(direction);
        if (on)
        {
            RiverEdges[index] |= (byte)(1 << direction);
            if (other >= 0) RiverEdges[other] |= (byte)(1 << opposite);
        }
        else
        {
            RiverEdges[index] &= (byte)~(1 << direction);
            if (other >= 0) RiverEdges[other] &= (byte)~(1 << opposite);
        }
    }

    // ----- Vertices -------------------------------------------------------------------------------

    public int VertexCount => Count * 2;

    /// <summary>The three tiles meeting at vertex v (entries are -1 beyond the map's north/south edge).</summary>
    public void VertexTiles(int v, Span<int> tiles)
    {
        var c = CoordOf(v >> 1);
        tiles[0] = v >> 1;
        if ((v & 1) == 0)
        {
            tiles[1] = IndexOf(new HexCoord(c.Q, c.R - 1));
            tiles[2] = IndexOf(new HexCoord(c.Q + 1, c.R - 1));
        }
        else
        {
            tiles[1] = IndexOf(new HexCoord(c.Q - 1, c.R + 1));
            tiles[2] = IndexOf(new HexCoord(c.Q, c.R + 1));
        }
    }

    /// <summary>The three vertices joined to v by an edge (entries are -1 when off-map).</summary>
    public void VertexNeighbors(int v, Span<int> vertices)
    {
        var c = CoordOf(v >> 1);
        if ((v & 1) == 0)
        {
            vertices[0] = Vertex(new HexCoord(c.Q + 1, c.R - 1), 1);
            vertices[1] = Vertex(new HexCoord(c.Q, c.R - 1), 1);
            vertices[2] = Vertex(new HexCoord(c.Q + 1, c.R - 2), 1);
        }
        else
        {
            vertices[0] = Vertex(new HexCoord(c.Q, c.R + 1), 0);
            vertices[1] = Vertex(new HexCoord(c.Q - 1, c.R + 1), 0);
            vertices[2] = Vertex(new HexCoord(c.Q - 1, c.R + 2), 0);
        }
    }

    /// <summary>The six corners of a tile: N, NE, SE, S, SW, NW (entries are -1 when off-map).</summary>
    public void TileVertices(int tile, Span<int> vertices)
    {
        var c = CoordOf(tile);
        vertices[0] = tile * 2;
        vertices[1] = Vertex(new HexCoord(c.Q + 1, c.R - 1), 1);
        vertices[2] = Vertex(new HexCoord(c.Q, c.R + 1), 0);
        vertices[3] = tile * 2 + 1;
        vertices[4] = Vertex(new HexCoord(c.Q - 1, c.R + 1), 0);
        vertices[5] = Vertex(new HexCoord(c.Q, c.R - 1), 1);
    }

    private int Vertex(HexCoord owner, int k)
    {
        int i = IndexOf(owner);
        return i < 0 ? -1 : i * 2 + k;
    }

    /// <summary>The two tiles separated by the edge between adjacent vertices a and b.</summary>
    public (int A, int B) EdgeTiles(int va, int vb)
    {
        Span<int> ta = stackalloc int[3];
        Span<int> tb = stackalloc int[3];
        VertexTiles(va, ta);
        VertexTiles(vb, tb);
        int first = -1, second = -1;
        foreach (int t in ta)
        {
            if (t < 0) continue;
            if (tb.Contains(t))
            {
                if (first < 0) first = t;
                else if (t != first) second = t;
            }
        }
        return (first, second);
    }

    // ----- Semantics --------------------------------------------------------------------------------

    public TerrainClass ClassAt(int i) => _terrainClass[Terrain[i]];
    public bool IsWater(int i) => _terrainClass[Terrain[i]] != TerrainClass.Land;
    public bool IsLand(int i) => _terrainClass[Terrain[i]] == TerrainClass.Land;
    public bool IsChannel(int i) => _terrainClass[Terrain[i]] == TerrainClass.Channel;
    public bool IsSea(int i) => _terrainClass[Terrain[i]] is TerrainClass.Coast or TerrainClass.Ocean;
    public bool IsMountain(int i) => Relief[i] == Db.Ids.Mountain;
    public bool HasFlag(int i, TileFlags f) => (Flags[i] & (byte)f) != 0;
    public void SetFlag(int i, TileFlags f, bool on)
    {
        if (on) Flags[i] |= (byte)f;
        else Flags[i] &= (byte)~f;
    }

    /// <summary>Lake, Great River channel, or oasis.</summary>
    public bool IsFreshWaterSource(int i) =>
        _terrainFresh[Terrain[i]] || (Feature[i] >= 0 && _featureFresh[Feature[i]]);

    /// <summary>True if the tile has a river edge or touches a fresh-water source.</summary>
    public bool HasFreshWaterAccess(int i)
    {
        if (HasRiver(i)) return true;
        for (int d = 0; d < 6; d++)
        {
            int n = Neighbor(i, d);
            if (n >= 0 && IsFreshWaterSource(n)) return true;
        }
        return false;
    }

    public bool IsAdjacentToSea(int i)
    {
        for (int d = 0; d < 6; d++)
        {
            int n = Neighbor(i, d);
            if (n >= 0 && IsSea(n)) return true;
        }
        return false;
    }

    public bool IsAdjacentToChannel(int i)
    {
        for (int d = 0; d < 6; d++)
        {
            int n = Neighbor(i, d);
            if (n >= 0 && IsChannel(n)) return true;
        }
        return false;
    }

    /// <summary>Raw tile yields from terrain, relief, feature, resource, improvement and fertility.</summary>
    public YieldSet TileYields(int i)
    {
        var y = Db.Terrains[Terrain[i]].Yields + Db.Reliefs[Relief[i]].Yields;
        if (Feature[i] >= 0) y += Db.Features[Feature[i]].Yields;
        if (Resource[i] >= 0) y += Db.Resources[Resource[i]].Yields;
        if (Improvement[i] >= 0 && !HasFlag(i, TileFlags.Pillaged)) y += Db.Improvements[Improvement[i]].Yields;
        if (Fertility[i] > 0) y.Food += Fertility[i];
        if (HasFlag(i, TileFlags.Flooded)) y = y * Fx.Half;
        return y;
    }

    /// <summary>Appeal: sum of neighbour terrain/feature/district appeal (drives Neighborhood housing, tourism, preserves).</summary>
    public int Appeal(int i)
    {
        int appeal = 0;
        for (int d = 0; d < 6; d++)
        {
            int n = Neighbor(i, d);
            if (n < 0) continue;
            appeal += Db.Terrains[Terrain[n]].Appeal + Db.Reliefs[Relief[n]].Appeal;
            if (Feature[n] >= 0) appeal += Db.Features[Feature[n]].Appeal;
            if (District[n] >= 0) appeal += Db.Districts[District[n]].Appeal;
            if (Improvement[n] >= 0) appeal += Db.Improvements[Improvement[n]].Appeal;
            if (HasRiverEdge(i, d)) appeal += 1;
        }
        return appeal;
    }
}
