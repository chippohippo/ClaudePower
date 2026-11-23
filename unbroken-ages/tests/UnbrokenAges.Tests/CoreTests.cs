namespace UnbrokenAges.Tests;

public class FxTests
{
    [Fact]
    public void Arithmetic_IsExact()
    {
        Assert.Equal(Fx.Parse("3.75"), Fx.Parse("1.5") + Fx.Parse("2.25"));
        Assert.Equal(Fx.FromInt(6), Fx.FromInt(2) * 3);
        Assert.Equal(Fx.Ratio(1, 2), Fx.One / 2);
        Assert.Equal(3, Fx.Parse("2.5").CeilToInt());
        Assert.Equal(2, Fx.Parse("2.5").FloorToInt());
        Assert.Equal(-3, Fx.Parse("-2.5").FloorToInt());
    }

    [Theory]
    [InlineData(4, 2.0)]
    [InlineData(2, 1.41421)]
    [InlineData(100, 10.0)]
    public void Sqrt_IsAccurate(int value, double expected) =>
        Assert.InRange(Fx.Sqrt(value).ToDouble(), expected - 0.001, expected + 0.001);

    [Theory]
    [InlineData("2", 1.0)]
    [InlineData("1", 0.0)]
    [InlineData("1.5", 0.58496)]
    [InlineData("0.5", -1.0)]
    [InlineData("1000", 9.96578)]
    public void Log2_IsAccurate(string value, double expected) =>
        Assert.InRange(Fx.Log2(Fx.Parse(value)).ToDouble(), expected - 0.001, expected + 0.001);

    [Fact]
    public void Pcg32_IsReproducible_AndStreamsAreIndependent()
    {
        var a = Pcg32.Derive(99, "combat");
        var b = Pcg32.Derive(99, "combat");
        var c = Pcg32.Derive(99, "disasters");
        var seqA = Enumerable.Range(0, 20).Select(_ => a.NextInt(1000)).ToList();
        Assert.Equal(seqA, Enumerable.Range(0, 20).Select(_ => b.NextInt(1000)));
        Assert.NotEqual(seqA, Enumerable.Range(0, 20).Select(_ => c.NextInt(1000)));
        var restored = Pcg32.FromRawState(a.State, a.Increment);
        Assert.Equal(a.NextUInt(), restored.NextUInt());
    }
}

public class HexTopologyTests
{
    [Fact]
    public void OffsetConversion_RoundTrips()
    {
        for (int row = -3; row < 6; row++)
        for (int col = -3; col < 6; col++)
            Assert.Equal((col, row), HexCoord.FromOffset(col, row).ToOffset());
    }

    [Fact]
    public void Neighbours_AreSymmetric_WithWrap()
    {
        var map = new MapGrid(TestWorld.Db, 12, 8, wrapX: true);
        for (int i = 0; i < map.Count; i++)
        for (int d = 0; d < 6; d++)
        {
            int n = map.Neighbor(i, d);
            if (n < 0) continue;
            Assert.Equal(i, map.Neighbor(n, HexCoord.Opposite(d)));
            Assert.Equal(1, map.Distance(i, n));
        }
    }

    [Fact]
    public void WrapDistance_UsesShortestWay()
    {
        var map = new MapGrid(TestWorld.Db, 20, 10, wrapX: true);
        int a = map.IndexOf(HexCoord.FromOffset(0, 4));
        int b = map.IndexOf(HexCoord.FromOffset(19, 4));
        Assert.Equal(1, map.Distance(a, b));
    }

    [Fact]
    public void VertexGraph_IsConsistent()
    {
        var map = new MapGrid(TestWorld.Db, 10, 8, wrapX: true);
        Span<int> nb = stackalloc int[3];
        Span<int> back = stackalloc int[3];
        Span<int> tiles = stackalloc int[3];
        for (int v = 0; v < map.VertexCount; v++)
        {
            map.VertexTiles(v, tiles);
            Assert.Contains(v >> 1, tiles.ToArray());
            map.VertexNeighbors(v, nb);
            foreach (int u in nb.ToArray())
            {
                if (u < 0) continue;
                map.VertexNeighbors(u, back);
                Assert.Contains(v, back.ToArray());
                var (a, b) = map.EdgeTiles(v, u);
                if (a < 0 || b < 0) continue;
                Assert.NotEqual(a, b);
                Assert.Equal(1, map.Distance(a, b));
            }
        }
    }

    [Fact]
    public void TileVertices_MatchVertexTiles()
    {
        var map = new MapGrid(TestWorld.Db, 10, 8, wrapX: true);
        Span<int> verts = stackalloc int[6];
        Span<int> tiles = stackalloc int[3];
        int t = map.IndexOf(HexCoord.FromOffset(4, 4));
        map.TileVertices(t, verts);
        foreach (int v in verts.ToArray())
        {
            map.VertexTiles(v, tiles);
            Assert.Contains(t, tiles.ToArray());
        }
    }

    [Fact]
    public void RiverEdges_AreStoredOnBothSides()
    {
        var map = new MapGrid(TestWorld.Db, 10, 8, wrapX: false);
        int t = map.IndexOf(HexCoord.FromOffset(4, 4));
        map.SetRiverEdge(t, HexCoord.NE, true);
        int n = map.Neighbor(t, HexCoord.NE);
        Assert.True(map.HasRiverEdge(n, HexCoord.SW));
        map.SetRiverEdge(n, HexCoord.SW, false);
        Assert.False(map.HasRiver(t));
    }
}
