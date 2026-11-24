using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>A unit's effective numbers: its definition adjusted by its variant. Everything that fights or moves reads these.</summary>
public static class UnitStats
{
    /// <summary>The variants on offer for a unit type: its own, or those of the unit it replaces.</summary>
    public static IReadOnlyList<UnitVariantDef> VariantsOf(GameDatabase db, int defIndex)
    {
        var def = db.Units[defIndex];
        if (def.Variants.Count > 0) return def.Variants;
        return def.ReplacesIndex >= 0 ? db.Units[def.ReplacesIndex].Variants : Array.Empty<UnitVariantDef>();
    }

    /// <summary>Units built in a city take the first variant (the standard one).</summary>
    public static int DefaultVariant(GameDatabase db, int defIndex) => VariantsOf(db, defIndex).Count > 0 ? 0 : -1;

    public static UnitVariantDef? VariantOf(GameState s, UnitState u)
    {
        var all = VariantsOf(s.Db, u.DefIndex);
        return u.Variant >= 0 && u.Variant < all.Count ? all[u.Variant] : null;
    }

    private static int Percent(int value, int percent) => value * (100 + percent) / 100;

    public static int Strength(GameState s, UnitState u) => Percent(s.Db.Units[u.DefIndex].Strength, VariantOf(s, u)?.StrengthPercent ?? 0);
    public static int RangedStrength(GameState s, UnitState u) =>
        Math.Max(0, Percent(s.Db.Units[u.DefIndex].RangedStrength, VariantOf(s, u)?.RangedStrengthPercent ?? 0));
    public static bool IsRanged(GameState s, UnitState u) => RangedStrength(s, u) > 0;
    public static int Range(GameState s, UnitState u) => Math.Max(1, s.Db.Units[u.DefIndex].Range + (VariantOf(s, u)?.RangeDelta ?? 0));
    public static int Moves(GameState s, UnitState u) =>
        Math.Max(1, s.Db.Units[u.DefIndex].Moves + (VariantOf(s, u)?.MovesDelta ?? 0) + NationSystem.MovesBonus(s, u) + SocietySystem.MovesBonus(s, u));
    public static bool IgnoresRiverCrossing(GameState s, UnitState u) => VariantOf(s, u)?.IgnoresRiverCrossing ?? false;

    /// <summary>"Swordsman (Heavy)".</summary>
    public static string Name(GameState s, UnitState u) =>
        VariantOf(s, u) is { } v ? $"{s.Db.Units[u.DefIndex].Name} ({v.Name})" : s.Db.Units[u.DefIndex].Name;
}
