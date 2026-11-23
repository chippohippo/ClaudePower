using System.Text;

namespace UnbrokenAges.Sim.Core;

/// <summary>
/// Process-stable hashing (string.GetHashCode is randomized per process and must never be
/// used for simulation logic, content hashes, or desync checks).
/// </summary>
public static class StableHash
{
    public const ulong FnvOffset = 14695981039346656037UL;
    public const ulong FnvPrime = 1099511628211UL;

    public static ulong Fnv1a64(ReadOnlySpan<byte> data, ulong hash = FnvOffset)
    {
        foreach (byte b in data)
        {
            hash ^= b;
            hash = unchecked(hash * FnvPrime);
        }
        return hash;
    }

    public static ulong Fnv1a64(string text) => Fnv1a64(Encoding.UTF8.GetBytes(text));

    public static ulong Combine(ulong a, ulong b) => unchecked((a ^ (b + 0x9E3779B97F4A7C15UL + (a << 6) + (a >> 2))) * FnvPrime);
}
