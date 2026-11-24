using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// Leader doctrines (docs/05-key-systems/14-nations.md, "Leaders of the World Wars"): the parts of a civilization's and leader's
/// abilities that act on the whole player or on units rather than on cities — strength by where a unit stands or whether its
/// people are at war, and player-level effects (war weariness, influence, favor).
/// </summary>
public static class LeaderSystem
{
    public static bool AtWar(GameState s, int player) =>
        s.Players.Any(o => o.IsAlive && o.IsMajor && o.Id != player && DiplomacySystem.AtWar(s, player, o.Id));

    private static IEnumerable<(List<ModifierDef> Modifiers, string Source)> Abilities(GameState s, PlayerState p)
    {
        var db = s.Db;
        if (p.CivIndex >= 0) yield return (db.Civilizations[p.CivIndex].Ability.Modifiers, db.Civilizations[p.CivIndex].Ability.Name);
        if (p.LeaderIndex >= 0) yield return (db.Leaders[p.LeaderIndex].Ability.Modifiers, db.Leaders[p.LeaderIndex].Ability.Name);
    }

    /// <summary>Player-level requirements: war and peace (others never hold at this level).</summary>
    private static bool PlayerMet(GameState s, PlayerState p, List<RequirementDef> reqs) => reqs.All(r => r.Type switch
    {
        RequirementType.OwnerAtWar => AtWar(s, p.Id),
        RequirementType.OwnerAtPeace => !AtWar(s, p.Id),
        _ => false,
    });

    /// <summary>The sum of a player-level effect across the civilization's and leader's abilities.</summary>
    public static int PlayerEffect(GameState s, PlayerState p, ModifierEffect effect)
    {
        int n = 0;
        foreach (var (mods, _) in Abilities(s, p))
            foreach (var m in mods)
                if (m.Effect == effect && PlayerMet(s, p, m.Requirements)) n += m.Amount.RoundToInt();
        return n;
    }

    private static bool UnitMet(GameState s, UnitState u, List<RequirementDef> reqs) => reqs.All(r => r.Type switch
    {
        RequirementType.OwnerAtWar => AtWar(s, u.Owner),
        RequirementType.OwnerAtPeace => !AtWar(s, u.Owner),
        RequirementType.UnitInOwnTerritory => s.Map.OwnerPlayer[u.Tile] == u.Owner,
        RequirementType.UnitInForeignTerritory => s.Map.OwnerPlayer[u.Tile] != u.Owner,
        _ => false,
    });

    /// <summary>Strength from the civilization's and leader's abilities, by where the unit stands and whether its people are at war.</summary>
    public static IEnumerable<(string Label, int Value)> CombatLines(GameState s, UnitState unit)
    {
        if (unit.Owner < 0 || unit.Owner >= s.Players.Count) yield break;
        var db = s.Db;
        var def = db.Units[unit.DefIndex];
        foreach (var (mods, source) in Abilities(s, s.Players[unit.Owner]))
        {
            int total = 0;
            foreach (var m in mods)
                if (m.Effect == ModifierEffect.UnitStrength && (string.IsNullOrEmpty(m.Target) || def.UnitClass == m.Target || def.HasTag(m.Target)) &&
                    UnitMet(s, unit, m.Requirements))
                    total += m.Amount.RoundToInt();
            if (total != 0) yield return (source, total);
        }
    }
}
