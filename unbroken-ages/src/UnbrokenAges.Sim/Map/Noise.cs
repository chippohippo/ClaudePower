using UnbrokenAges.Sim.Core;

namespace UnbrokenAges.Sim.Map;

/// <summary>Deterministic fixed-point value noise with optional horizontal wrapping.</summary>
public static class Noise
{
    private static uint Hash(int x, int y, uint seed)
    {
        unchecked
        {
            uint h = seed ^ ((uint)x * 0x27D4EB2Du) ^ ((uint)y * 0x165667B1u);
            h ^= h >> 15;
            h *= 0x85EBCA6Bu;
            h ^= h >> 13;
            h *= 0xC2B2AE35u;
            h ^= h >> 16;
            return h;
        }
    }

    private static Fx Lattice(int x, int y, uint seed) => Fx.FromRaw(Hash(x, y, seed) >> (32 - Fx.FractionBits));

    private static Fx Smooth(Fx t) => t * t * (Fx.FromInt(3) - 2 * t);

    private static Fx Lerp(Fx a, Fx b, Fx t) => a + (b - a) * t;

    private static int Mod(int a, int m) => ((a % m) + m) % m;

    /// <summary>Value noise in [0,1). periodX &gt; 0 makes the lattice wrap horizontally.</summary>
    public static Fx Value(Fx x, Fx y, int periodX, uint seed)
    {
        int x0 = x.FloorToInt();
        int y0 = y.FloorToInt();
        Fx tx = Smooth(x - x0);
        Fx ty = Smooth(y - y0);
        int x1 = x0 + 1;
        if (periodX > 0)
        {
            x0 = Mod(x0, periodX);
            x1 = Mod(x1, periodX);
        }
        Fx a = Lattice(x0, y0, seed), b = Lattice(x1, y0, seed);
        Fx c = Lattice(x0, y0 + 1, seed), d = Lattice(x1, y0 + 1, seed);
        return Lerp(Lerp(a, b, tx), Lerp(c, d, tx), ty);
    }

    /// <summary>
    /// Fractal noise sampled at map position (px, py) where px spans [0, mapWidth).
    /// baseCells = lattice cells across the map width at the lowest octave.
    /// </summary>
    public static Fx Fbm(Fx px, Fx py, int mapWidth, int baseCells, int octaves, uint seed, bool wrap)
    {
        Fx sum = Fx.Zero, norm = Fx.Zero, amp = Fx.One;
        int cells = baseCells;
        for (int o = 0; o < octaves; o++)
        {
            Fx u = px * cells / mapWidth;
            Fx v = py * cells / mapWidth;
            sum += amp * Value(u, v, wrap ? cells : 0, unchecked(seed + (uint)o * 7919u));
            norm += amp;
            amp = amp / 2;
            cells *= 2;
        }
        return sum / norm;
    }
}
