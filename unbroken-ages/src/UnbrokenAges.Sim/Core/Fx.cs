using System.Globalization;
using System.Numerics;

namespace UnbrokenAges.Sim.Core;

/// <summary>
/// Deterministic Q47.16 fixed-point number. All simulation math that can be fractional
/// (yields, loyalty, pressure, CO2) uses Fx so that every peer in a multiplayer game computes
/// bit-identical results regardless of CPU, OS, or compiler. Never use float/double in the sim.
/// </summary>
public readonly struct Fx : IEquatable<Fx>, IComparable<Fx>
{
    public const int FractionBits = 16;
    public const long OneRaw = 1L << FractionBits;

    public readonly long Raw;

    private Fx(long raw) => Raw = raw;

    public static readonly Fx Zero = new(0);
    public static readonly Fx One = new(OneRaw);
    public static readonly Fx Half = new(OneRaw / 2);
    public static readonly Fx MaxValue = new(long.MaxValue);
    public static readonly Fx MinValue = new(long.MinValue);

    public static Fx FromRaw(long raw) => new(raw);
    public static Fx FromInt(long value) => new(value << FractionBits);
    public static Fx Ratio(long numerator, long denominator) =>
        new((long)(((Int128)numerator << FractionBits) / denominator));
    public static Fx Percent(long percent) => Ratio(percent, 100);

    public static Fx FromDecimal(decimal value) =>
        new((long)decimal.Round(value * OneRaw, 0, MidpointRounding.AwayFromZero));

    public static Fx Parse(string text) =>
        FromDecimal(decimal.Parse(text, NumberStyles.Float, CultureInfo.InvariantCulture));

    public decimal ToDecimal() => (decimal)Raw / OneRaw;

    /// <summary>Presentation-only conversion. Never feed the result back into the simulation.</summary>
    public double ToDouble() => (double)Raw / OneRaw;

    public static implicit operator Fx(int value) => FromInt(value);

    public static Fx operator +(Fx a, Fx b) => new(a.Raw + b.Raw);
    public static Fx operator -(Fx a, Fx b) => new(a.Raw - b.Raw);
    public static Fx operator -(Fx a) => new(-a.Raw);
    public static Fx operator *(Fx a, Fx b) => new((long)(((Int128)a.Raw * b.Raw) >> FractionBits));
    public static Fx operator *(Fx a, int b) => new(a.Raw * b);
    public static Fx operator *(int a, Fx b) => new(a * b.Raw);
    public static Fx operator /(Fx a, Fx b) => new((long)(((Int128)a.Raw << FractionBits) / b.Raw));
    public static Fx operator /(Fx a, int b) => new(a.Raw / b);

    public static bool operator ==(Fx a, Fx b) => a.Raw == b.Raw;
    public static bool operator !=(Fx a, Fx b) => a.Raw != b.Raw;
    public static bool operator <(Fx a, Fx b) => a.Raw < b.Raw;
    public static bool operator >(Fx a, Fx b) => a.Raw > b.Raw;
    public static bool operator <=(Fx a, Fx b) => a.Raw <= b.Raw;
    public static bool operator >=(Fx a, Fx b) => a.Raw >= b.Raw;

    public int FloorToInt() => (int)(Raw >> FractionBits);
    public int CeilToInt() => (int)((Raw + OneRaw - 1) >> FractionBits);
    public int RoundToInt() => (int)((Raw + (OneRaw >> 1)) >> FractionBits);
    public Fx Floor() => new(Raw & ~(OneRaw - 1));

    public static Fx Min(Fx a, Fx b) => a.Raw <= b.Raw ? a : b;
    public static Fx Max(Fx a, Fx b) => a.Raw >= b.Raw ? a : b;
    public static Fx Abs(Fx a) => a.Raw < 0 ? new(-a.Raw) : a;
    public static Fx Clamp(Fx v, Fx min, Fx max) => v < min ? min : v > max ? max : v;

    /// <summary>Deterministic square root (Newton iteration on 128-bit integers).</summary>
    public static Fx Sqrt(Fx x)
    {
        if (x.Raw <= 0) return Zero;
        UInt128 n = (UInt128)(ulong)x.Raw << FractionBits;
        UInt128 r = (UInt128)1 << ((128 - (int)UInt128.LeadingZeroCount(n)) / 2 + 1);
        while (true)
        {
            UInt128 next = (r + n / r) >> 1;
            if (next >= r) break;
            r = next;
        }
        return new((long)(ulong)r);
    }

    /// <summary>Deterministic base-2 logarithm for x &gt; 0 (bit-by-bit squaring method).</summary>
    public static Fx Log2(Fx x)
    {
        if (x.Raw <= 0) throw new ArgumentOutOfRangeException(nameof(x), "Log2 requires a positive value.");
        int msb = 63 - BitOperations.LeadingZeroCount((ulong)x.Raw);
        int integerPart = msb - FractionBits;
        long y = integerPart >= 0 ? x.Raw >> integerPart : x.Raw << -integerPart; // y in [1, 2)
        long result = (long)integerPart << FractionBits;
        for (int bit = FractionBits - 1; bit >= 0; bit--)
        {
            y = (long)(((Int128)y * y) >> FractionBits);
            if (y >= 2 * OneRaw)
            {
                y >>= 1;
                result += 1L << bit;
            }
        }
        return new(result);
    }

    public bool Equals(Fx other) => Raw == other.Raw;
    public override bool Equals(object? obj) => obj is Fx f && f.Raw == Raw;
    public override int GetHashCode() => Raw.GetHashCode();
    public int CompareTo(Fx other) => Raw.CompareTo(other.Raw);
    public override string ToString() => ToDecimal().ToString("0.###", CultureInfo.InvariantCulture);
}
