using Godot;
using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Client.Visuals;

/// <summary>
/// The landscape's shape, derived from the tiles a player knows. Every tile has a base height (land just above the sea,
/// coasts and lakes below it, open ocean deep), blended smoothly across neighbours with gaussian weights, so coastlines
/// curve and valleys run between hills. Hills add rolling bumps; mountains add ridged peaks. Unexplored tiles are flat
/// paper at land height, so their shape is never revealed. Water surface is y = 0.
/// Presentation only: the simulation never sees these floats.
/// </summary>
public sealed class HeightField
{
    public const float Land = 0.14f;
    private static readonly float Sqrt3 = Mathf.Sqrt(3f);
    private static readonly (int Q, int R)[] Ring = { (0, 0), (1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1) };

    private readonly FastNoiseLite _noise = new() { Seed = 5, Frequency = 0.55f, NoiseType = FastNoiseLite.NoiseTypeEnum.Simplex, FractalOctaves = 3 };
    private readonly FastNoiseLite _ridge = new() { Seed = 9, Frequency = 1.4f, NoiseType = FastNoiseLite.NoiseTypeEnum.Simplex, FractalType = FastNoiseLite.FractalTypeEnum.Ridged, FractalOctaves = 3 };

    private GameState? _state;
    private float[] _base = Array.Empty<float>();
    private float[] _hill = Array.Empty<float>();
    private float[] _peak = Array.Empty<float>();
    /// <summary>Per-tile signature of everything that shapes the ground (for rebuilding only what changed).</summary>
    public int[] Signature { get; private set; } = Array.Empty<int>();

    public static HeightField Current { get; } = new();

    public void Update(GameState s, bool[] revealed)
    {
        _state = s;
        var map = s.Map;
        var db = s.Db;
        if (_base.Length != map.Count)
        {
            _base = new float[map.Count];
            _hill = new float[map.Count];
            _peak = new float[map.Count];
            Signature = new int[map.Count];
        }
        for (int t = 0; t < map.Count; t++)
        {
            bool known = t < revealed.Length && revealed[t];
            float b = Land, hill = 0, peak = 0;
            if (known)
            {
                var cls = db.Terrains[map.Terrain[t]].Class;
                bool ice = map.Feature[t] >= 0 && db.Features[map.Feature[t]].Id == "FEATURE_ICE";
                if (map.IsWater(t) && !ice)
                    b = cls switch
                    {
                        Sim.Data.TerrainClass.Ocean => -0.62f,
                        Sim.Data.TerrainClass.Coast => -0.26f,
                        _ => -0.24f,   // lakes and Great River channels
                    };
                else if (map.IsMountain(t)) { peak = 1.9f + Hash(t) * 0.7f + (db.Terrains[map.Terrain[t]].Id == "TERRAIN_SNOW" ? 0.4f : 0); b = Land + 0.15f; }
                else if (map.Relief[t] == db.Ids.Hills) hill = 0.42f + Hash(t) * 0.16f;
            }
            _base[t] = b;
            _hill[t] = hill;
            _peak[t] = peak;
            Signature[t] = HashCode.Combine(known, b, hill, peak);
        }
    }

    private static float Hash(int t) => ((uint)(t * 2654435761u) % 1000) / 1000f;

    public static Vector2 WorldToAxial(float x, float z)
    {
        float r = z / 1.5f;
        return new Vector2(x / Sqrt3 - r * 0.5f, r);
    }

    public static (int Q, int R) AxialRound(Vector2 a)
    {
        float x = a.X, z = a.Y, y = -x - z;
        float rx = Mathf.Round(x), ry = Mathf.Round(y), rz = Mathf.Round(z);
        float dx = Mathf.Abs(rx - x), dy = Mathf.Abs(ry - y), dz = Mathf.Abs(rz - z);
        if (dx > dy && dx > dz) rx = -ry - rz;
        else if (dy > dz) ry = -rx - rz;
        else rz = -rx - ry;
        return ((int)rx, (int)rz);
    }

    public static Vector2 AxialToWorld(int q, int r) => new(Sqrt3 * (q + r * 0.5f), 1.5f * r);

    /// <summary>Ground height at world (x, z).</summary>
    public float Sample(float x, float z)
    {
        if (_state == null) return Land;
        var map = _state.Map;
        var (q0, r0) = AxialRound(WorldToAxial(x, z));
        float sumW = 0, sumH = 0, bumps = 0;
        bool anyRelief = false;
        foreach (var (dq, dr) in Ring)
        {
            int q = q0 + dq, r = r0 + dr;
            int t = map.IndexOf(new HexCoord(q, r));
            var c = AxialToWorld(q, r);
            float dx = x - c.X, dz = z - c.Y;
            float d2 = dx * dx + dz * dz;
            float w = Mathf.Exp(-d2 / 0.5f);
            float b = t >= 0 ? _base[t] : -0.62f;
            sumW += w;
            sumH += w * b;
            if (t < 0) continue;
            float d = Mathf.Sqrt(d2);
            if (_hill[t] > 0 && d < 1.25f)
            {
                float f = 1f - d / 1.25f;
                bumps += _hill[t] * f * f * (3f - 2f * f);
                anyRelief = true;
            }
            if (_peak[t] > 0 && d < 1.3f)
            {
                float f = 1f - d / 1.3f;
                float ridge = 0.65f + 0.7f * (_ridge.GetNoise2D(x, z) * 0.5f + 0.5f);
                bumps += _peak[t] * Mathf.Pow(f, 1.5f) * ridge;
                anyRelief = true;
            }
        }
        float h = sumH / sumW + bumps;
        if (h > 0.02f) h += _noise.GetNoise2D(x, z) * (anyRelief ? 0.08f : 0.03f);   // gentle undulation on land
        return h;
    }

    /// <summary>Where things stand: the ground, or the water surface over the sea.</summary>
    public float Surface(float x, float z) => Mathf.Max(Sample(x, z), 0.02f);
}
