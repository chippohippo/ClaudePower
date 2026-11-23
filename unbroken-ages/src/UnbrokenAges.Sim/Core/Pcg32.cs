namespace UnbrokenAges.Sim.Core;

/// <summary>
/// PCG32 random generator. Fully deterministic, serializable, and cheap to fork into
/// independent streams (map generation, disasters, combat...) so that adding a random roll
/// in one subsystem never shifts the sequence of another — a classic desync source.
/// </summary>
public sealed class Pcg32
{
    private ulong _state;
    private readonly ulong _increment;

    public Pcg32(ulong seed, ulong stream)
    {
        _increment = (stream << 1) | 1UL;
        _state = 0;
        NextUInt();
        _state += seed;
        NextUInt();
    }

    private Pcg32(ulong state, ulong increment, bool _)
    {
        _state = state;
        _increment = increment;
    }

    public ulong State => _state;
    public ulong Increment => _increment;

    public static Pcg32 FromRawState(ulong state, ulong increment) => new(state, increment, true);

    public uint NextUInt()
    {
        ulong old = _state;
        _state = unchecked(old * 6364136223846793005UL + _increment);
        uint xorShifted = (uint)(((old >> 18) ^ old) >> 27);
        int rot = (int)(old >> 59);
        return (xorShifted >> rot) | (xorShifted << (-rot & 31));
    }

    /// <summary>Unbiased integer in [0, maxExclusive).</summary>
    public int NextInt(int maxExclusive)
    {
        if (maxExclusive <= 0) throw new ArgumentOutOfRangeException(nameof(maxExclusive));
        uint bound = (uint)maxExclusive;
        uint threshold = unchecked(0u - bound) % bound;
        while (true)
        {
            uint r = NextUInt();
            if (r >= threshold) return (int)(r % bound);
        }
    }

    public int NextInt(int minInclusive, int maxExclusive) => minInclusive + NextInt(maxExclusive - minInclusive);

    /// <summary>Fixed-point value in [0, 1).</summary>
    public Fx NextFx() => Fx.FromRaw(NextUInt() >> (32 - Fx.FractionBits));

    /// <summary>True with probability permille/1000.</summary>
    public bool ChancePermille(int permille) => NextInt(1000) < permille;

    public void Shuffle<T>(IList<T> list)
    {
        for (int i = list.Count - 1; i > 0; i--)
        {
            int j = NextInt(i + 1);
            (list[i], list[j]) = (list[j], list[i]);
        }
    }

    /// <summary>Derives an independent stream; the parent sequence is not advanced.</summary>
    public static Pcg32 Derive(ulong seed, string streamName) => new(seed, StableHash.Fnv1a64(streamName));
}
