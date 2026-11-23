using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// Upgrading a unit: pick the target (a civilization's unique unit stands in for the one it replaces) and, when the target has
/// variants, one of them. It costs gold, max(20, 2 × production difference) adjusted by the variant, plus the target's strategic
/// resource. The unit must be in its own territory, keeps its health and ends its turn.
/// </summary>
public static class UpgradeSystem
{
    public static List<int> Targets(GameState s, UnitState u)
    {
        var db = s.Db;
        int civ = s.Players[u.Owner].CivIndex;
        var result = new List<int>();
        foreach (int t in db.Units[u.DefIndex].UpgradesToIndices)
        {
            int target = t;
            if (civ >= 0 && db.Units.FirstOrDefault(x => x.ReplacesIndex == t && x.CivilizationIndex == civ) is { } unique) target = unique.Index;
            if (!result.Contains(target)) result.Add(target);
        }
        return result;
    }

    public static int GoldCost(GameState s, UnitState u, int target, int variant)
    {
        var db = s.Db;
        var rules = db.Rules.Combat;
        int difference = (db.Units[target].Cost - db.Units[u.DefIndex].Cost).FloorToInt();
        int gold = Math.Max(rules.MinUpgradeGold, difference * rules.UpgradeGoldPerProduction);
        var variants = UnitStats.VariantsOf(db, target);
        if (variant >= 0 && variant < variants.Count) gold = gold * (100 + variants[variant].UpgradeCostPercent) / 100;
        return gold;
    }

    public static string? Validate(GameState s, UnitState u, int target, int variant)
    {
        var db = s.Db;
        var player = s.Players[u.Owner];
        if (!Targets(s, u).Contains(target)) return "Cannot upgrade to that unit.";
        var def = db.Units[target];
        if (!player.HasTech(def.PrereqTechIndex)) return $"Requires {db.Techs[def.PrereqTechIndex].Name}.";
        if (!player.HasCivic(def.PrereqCivicIndex)) return $"Requires {db.Civics[def.PrereqCivicIndex].Name}.";
        var variants = UnitStats.VariantsOf(db, target);
        if (variants.Count == 0 && variant != -1) return $"{def.Name} has no variants.";
        if (variants.Count > 0 && (variant < 0 || variant >= variants.Count)) return $"Choose a variant: {string.Join(", ", variants.Select(v => v.Name))}.";
        if (s.Map.OwnerPlayer[u.Tile] != u.Owner) return "Units upgrade inside your own territory.";
        if (u.MovesLeft <= Core.Fx.Zero || u.AttackedThisTurn) return "No moves left this turn.";
        if (def.ResourceCost is { } rc && player.Stockpile[rc.ResourceIndex] < rc.Amount) return $"Needs {rc.Amount} {db.Resources[rc.ResourceIndex].Name}.";
        int gold = GoldCost(s, u, target, variant);
        return player.Gold < gold ? $"Costs {gold} gold." : null;
    }

    public static void Apply(GameState s, UnitState u, int target, int variant, List<GameEvent> events)
    {
        var db = s.Db;
        var player = s.Players[u.Owner];
        player.Gold -= GoldCost(s, u, target, variant);
        if (db.Units[target].ResourceCost is { } rc) player.Stockpile[rc.ResourceIndex] -= rc.Amount;
        u.DefIndex = target;
        u.Variant = variant;
        u.MovesLeft = Core.Fx.Zero;
        u.Fortified = false;
        u.Destination = -1;
        events.Add(new GameEvent(GameEventType.UnitUpgraded, u.Owner, Tile: u.Tile, Def: target, Value: variant, Detail: UnitStats.Name(s, u)));
    }
}
