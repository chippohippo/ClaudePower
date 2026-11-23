using Godot;
using UnbrokenAges.Client.Map;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Client.Visuals;

/// <summary>
/// The ground as one continuous, chunked mesh sampled from <see cref="HeightField"/> (about four vertices per hex edge).
/// Chunks rebuild only when a tile that shapes them changes (exploration, flooding, terraforming), so ordinary commands
/// cost nothing here. Normals come from the height grid, so hills and peaks catch the sun.
/// </summary>
public partial class TerrainMesh : Node3D
{
    private const float Spacing = 0.24f;
    private const int ChunkQuads = 56;
    private Material _material = null!;
    private sealed class Chunk
    {
        public MeshInstance3D Node = null!;
        public float X0, Z0;
        public int[] Tiles = Array.Empty<int>();
        public int Signature = int.MinValue;
    }
    private readonly List<Chunk> _chunks = new();
    private int _mapW = -1, _mapH = -1;

    public void Configure(Material material) => _material = material;

    public void Sync(GameState s)
    {
        var map = s.Map;
        if (map.Width != _mapW || map.Height != _mapH) Layout(s);
        var hf = HeightField.Current;
        foreach (var chunk in _chunks)
        {
            int sig = 17;
            foreach (int t in chunk.Tiles) sig = sig * 31 + hf.Signature[t];
            if (sig == chunk.Signature) continue;
            chunk.Signature = sig;
            chunk.Node.Mesh = Build(chunk.X0, chunk.Z0, hf);
        }
    }

    private void Layout(GameState s)
    {
        foreach (var c in _chunks) c.Node.QueueFree();
        _chunks.Clear();
        var map = s.Map;
        _mapW = map.Width;
        _mapH = map.Height;
        float sqrt3 = Mathf.Sqrt(3f);
        float minX = -1.5f, maxX = sqrt3 * (map.Width + 0.5f) + 0.5f;
        float minZ = -2f, maxZ = 1.5f * (map.Height - 1) + 2f;
        float size = ChunkQuads * Spacing;
        for (float z0 = minZ; z0 < maxZ; z0 += size)
            for (float x0 = minX; x0 < maxX; x0 += size)
            {
                var tiles = new List<int>();
                for (int t = 0; t < map.Count; t++)
                {
                    var c = HexLayout.ToWorld(map.CoordOf(t));
                    if (c.X > x0 - 2.5f && c.X < x0 + size + 2.5f && c.Z > z0 - 2.5f && c.Z < z0 + size + 2.5f) tiles.Add(t);
                }
                var node = new MeshInstance3D { MaterialOverride = _material };
                AddChild(node);
                _chunks.Add(new Chunk { Node = node, X0 = x0, Z0 = z0, Tiles = tiles.ToArray() });
            }
    }

    private static ArrayMesh Build(float x0, float z0, HeightField hf)
    {
        int n = ChunkQuads + 1;
        // heights with a one-vertex border for normals
        var h = new float[(n + 2) * (n + 2)];
        for (int j = 0; j < n + 2; j++)
            for (int i = 0; i < n + 2; i++)
                h[j * (n + 2) + i] = hf.Sample(x0 + (i - 1) * Spacing, z0 + (j - 1) * Spacing);
        var verts = new Vector3[n * n];
        var normals = new Vector3[n * n];
        for (int j = 0; j < n; j++)
            for (int i = 0; i < n; i++)
            {
                int k = (j + 1) * (n + 2) + (i + 1);
                verts[j * n + i] = new Vector3(x0 + i * Spacing, h[k], z0 + j * Spacing);
                float dx = h[k + 1] - h[k - 1], dz = h[k + (n + 2)] - h[k - (n + 2)];
                normals[j * n + i] = new Vector3(-dx, 2f * Spacing, -dz).Normalized();
            }
        var idx = new int[ChunkQuads * ChunkQuads * 6];
        int p = 0;
        for (int j = 0; j < ChunkQuads; j++)
            for (int i = 0; i < ChunkQuads; i++)
            {
                int a = j * n + i, b = a + 1, c = a + n, d = c + 1;
                idx[p++] = a; idx[p++] = b; idx[p++] = c;
                idx[p++] = b; idx[p++] = d; idx[p++] = c;
            }
        var arrays = new Godot.Collections.Array();
        arrays.Resize((int)Mesh.ArrayType.Max);
        arrays[(int)Mesh.ArrayType.Vertex] = verts;
        arrays[(int)Mesh.ArrayType.Normal] = normals;
        arrays[(int)Mesh.ArrayType.Index] = idx;
        var mesh = new ArrayMesh();
        mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
        return mesh;
    }
}
