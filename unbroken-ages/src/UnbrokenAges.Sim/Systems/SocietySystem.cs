using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// Governments and policy cards (docs/05-key-systems/15-society.md). A government gives slots — military, economic, diplomatic,
/// wildcard — and a legacy bonus; slotted cards apply to every city. Changing either is free on the turn after a civic is
/// completed (and at the start of the game), and costs gold otherwise. Also the home of everything society adds to combat:
/// government, card and pantheon strength, and unit promotions.
/// </summary>
public static class SocietySystem
{
    /// <summary>Most strength a unit draws from government, cards, pantheon and wonders combined.</summary>
    public const int MaxSocietyStrength = 6;

    public static int SwapCostPerCard(GameState s, PlayerState p) => 10 * (1 + s.PlayerEra(p));
    public static int GovernmentChangeCost(GameState s, PlayerState p) => 40 * (1 + s.PlayerEra(p));

    // ----- Governments ----------------------------------------------------------------------------------

    public static bool Unlocked(PlayerState p, GovernmentDef g) => p.HasCivic(g.PrereqCivicIndex);
    public static bool Unlocked(PlayerState p, PolicyDef c) => p.HasCivic(c.PrereqCivicIndex) && p.HasTech(c.PrereqTechIndex);

    public static string? CanAdopt(GameState s, PlayerState p, int government)
    {
        if (government < 0 || government >= s.Db.Governments.Count) return "No such government.";
        if (p.Government == government) return "Already your government.";
        if (!Unlocked(p, s.Db.Governments[government])) return "Its civic is not yet completed.";
        if (!p.PolicySwapFree && p.Government >= 0 && p.Gold < Fx.FromInt(GovernmentChangeCost(s, p)))
            return $"Changing government outside a civic's turn costs {GovernmentChangeCost(s, p)} gold.";
        return null;
    }

    public static void Adopt(GameState s, PlayerState p, int government, List<GameEvent> events)
    {
        if (!p.PolicySwapFree && p.Government >= 0) p.Gold -= Fx.FromInt(GovernmentChangeCost(s, p));
        p.Government = government;
        // Cards that no longer fit fall out, last-slotted first.
        while (p.Policies.Count > 0 && !Fits(s, government, p.Policies, ExtraWildcard(s, p))) p.Policies.RemoveAt(p.Policies.Count - 1);
        p.PolicySwapFree = true;   // a new government may re-slot its cards at once
        events.Add(new GameEvent(GameEventType.GovernmentAdopted, p.Id, Def: government, Detail: s.Db.Governments[government].Name));
    }

    /// <summary>The cards fit the government's slots: each in its own kind of slot first, the overflow (and wildcards) in wildcard slots.</summary>
    public static bool Fits(GameState s, int government, IReadOnlyList<int> policies, int extraWildcard = 0)
    {
        if (government < 0) return policies.Count == 0;
        var g = s.Db.Governments[government];
        int wildNeed = 0;
        foreach (PolicySlot slot in Enum.GetValues<PolicySlot>())
        {
            int n = policies.Count(c => s.Db.Policies[c].Slot == slot);
            wildNeed += slot == PolicySlot.Wildcard ? n : Math.Max(0, n - g.Slots(slot));
        }
        return wildNeed <= g.Wildcard + extraWildcard;
    }

    public static string? CanSetPolicies(GameState s, PlayerState p, IReadOnlyList<int> policies)
    {
        if (p.Government < 0) return "Adopt a government first.";
        if (policies.Distinct().Count() != policies.Count) return "A card can be slotted only once.";
        foreach (int c in policies)
        {
            if (c < 0 || c >= s.Db.Policies.Count) return "No such policy.";
            if (!Unlocked(p, s.Db.Policies[c])) return $"{s.Db.Policies[c].Name} is not yet unlocked.";
        }
        if (!Fits(s, p.Government, policies, ExtraWildcard(s, p))) return "Not enough slots for those cards.";
        int cost = SwapCost(s, p, policies);
        if (cost > 0 && p.Gold < Fx.FromInt(cost)) return $"Re-slotting outside a civic's turn costs {cost} gold.";
        return null;
    }

    /// <summary>Gold to slot these cards now: nothing on a free turn; otherwise per newly slotted card. Removing is free.</summary>
    public static int SwapCost(GameState s, PlayerState p, IReadOnlyList<int> policies) =>
        p.PolicySwapFree ? 0 : policies.Count(c => !p.Policies.Contains(c)) * SwapCostPerCard(s, p);

    public static void SetPolicies(GameState s, PlayerState p, IReadOnlyList<int> policies)
    {
        p.Gold -= Fx.FromInt(SwapCost(s, p, policies));
        p.Policies.Clear();
        p.Policies.AddRange(policies);
    }

    /// <summary>Every source of society modifiers on this city: government, cards, pantheon, the city's faith, the empire's age.</summary>
    public static IEnumerable<(List<ModifierDef> Modifiers, string Source)> CityModifierSources(GameState s, CityState city)
    {
        var db = s.Db;
        var owner = s.Players[city.Owner];
        if (owner.Government >= 0) yield return (db.Governments[owner.Government].Modifiers, db.Governments[owner.Government].Name);
        foreach (int c in owner.Policies) yield return (db.Policies[c].Modifiers, db.Policies[c].Name);
        if (owner.Pantheon >= 0) yield return (db.Beliefs[owner.Pantheon].Modifiers, $"{db.Beliefs[owner.Pantheon].Name} (pantheon)");
        if (city.Religion >= 0 && ReligionSystem.Founder(s, city.Religion) is { } founder)
            foreach (int b in founder.Beliefs)
                if (db.Beliefs[b].Kind == BeliefKind.Follower) yield return (db.Beliefs[b].Modifiers, $"{db.Beliefs[b].Name} ({db.Religions[city.Religion].Name})");
        if (AgeSystem.Modifiers(owner.Age) is { Count: > 0 } age) yield return (age, $"{owner.Age} Age");
        foreach (var w in Wonders(s, city.Owner))
            if (w.EmpireModifiers.Count > 0) yield return (w.EmpireModifiers, w.Name);
        if (WearinessPenalty(owner) is > 0 and var penalty) yield return (WearinessModifiers[penalty], "War weariness");
    }

    // ----- War weariness -------------------------------------------------------------------------------

    public const int WearinessPerAmenity = 8;
    public const int MaxWearinessPenalty = 4;

    /// <summary>Amenities lost in every city: one per eight weariness, at most four.</summary>
    public static int WearinessPenalty(PlayerState p) => Math.Min(MaxWearinessPenalty, p.WarWeariness / WearinessPerAmenity);

    private static readonly List<ModifierDef>[] WearinessModifiers = Enumerable.Range(0, MaxWearinessPenalty + 1)
        .Select(n => new List<ModifierDef> { new() { Effect = ModifierEffect.CityAmenities, Amount = Fx.FromInt(-n) } }).ToArray();

    /// <summary>Weariness from fighting: attacks, cities taken, units lost. Defending at home costs nothing.</summary>
    public static void AddWeariness(GameState s, int player, int amount)
    {
        if (player < 0 || player >= s.Players.Count || !s.Players[player].IsMajor) return;
        s.Players[player].WarWeariness = Math.Min(80, s.Players[player].WarWeariness + amount);
    }

    /// <summary>World wonders the player holds (unpillaged), in city then district order.</summary>
    public static IEnumerable<DistrictDef> Wonders(GameState s, int player)
    {
        foreach (var c in s.CitiesOf(player))
            foreach (var d in c.Districts)
                if (!d.Pillaged && s.Db.Districts[d.DefIndex].Category == DistrictCategory.Wonder) yield return s.Db.Districts[d.DefIndex];
    }

    public static int ExtraWildcard(GameState s, PlayerState p) => Wonders(s, p.Id).Sum(w => w.WildcardSlots);

    /// <summary>Wildcard slots: the government's plus any granted by wonders.</summary>
    public static int WildcardSlots(GameState s, PlayerState p) =>
        (p.Government >= 0 ? s.Db.Governments[p.Government].Wildcard : 0) + Wonders(s, p.Id).Sum(w => w.WildcardSlots);

    // ----- Combat --------------------------------------------------------------------------------------

    private static bool Matches(GameDatabase db, UnitState unit, string? target)
    {
        if (string.IsNullOrEmpty(target)) return true;
        var def = db.Units[unit.DefIndex];
        return def.UnitClass == target || def.HasTag(target);
    }

    private static bool Rugged(GameState s, int tile)
    {
        var map = s.Map;
        if (map.Feature[tile] >= 0 && (s.Db.Features[map.Feature[tile]].HasTag("Woods") || s.Db.Features[map.Feature[tile]].Id == "FEATURE_MARSH")) return true;
        return s.Db.Reliefs[map.Relief[tile]].Id == "RELIEF_HILLS";
    }

    /// <summary>Strength lines from society: government, cards, pantheon, and the unit's own promotions.</summary>
    public static IEnumerable<(string Label, int Value)> CombatLines(GameState s, UnitState unit, bool attacking, bool vsCity, int targetTile)
    {
        var db = s.Db;
        if (!SupplySystem.IsMilitary(db, unit) || unit.Owner < 0 || unit.Owner >= s.Players.Count) yield break;
        var p = s.Players[unit.Owner];
        IEnumerable<(List<ModifierDef>, string)> Sources()
        {
            if (p.Government >= 0) yield return (db.Governments[p.Government].Modifiers, db.Governments[p.Government].Name);
            foreach (int c in p.Policies) yield return (db.Policies[c].Modifiers, db.Policies[c].Name);
            if (p.Pantheon >= 0) yield return (db.Beliefs[p.Pantheon].Modifiers, db.Beliefs[p.Pantheon].Name);
            foreach (var w in Wonders(s, p.Id)) yield return (w.EmpireModifiers, w.Name);
            foreach (var cs in CityStateSystem.SuzerainSources(s, p.Id)) yield return cs;
        }
        // Government, cards, pantheon and wonders together add at most +6: they shape an army, they do not replace it.
        int budget = MaxSocietyStrength;
        foreach (var (mods, source) in Sources())
        {
            int total = 0;
            foreach (var m in mods)
                if (m.Effect == ModifierEffect.UnitStrength && Matches(db, unit, m.Target)) total += m.Amount.RoundToInt();
            total = Math.Min(total, budget);
            if (total <= 0) continue;
            budget -= total;
            yield return (budget == 0 ? $"{source} (society cap)" : source, total);
        }
        foreach (int pr in unit.Promotions)
        {
            var promo = db.Promotions[pr];
            int v = promo.Strength;
            if (!attacking) v += promo.Defense;
            if (attacking && vsCity) v += promo.VsCity;
            if (promo.Terrain != 0 && Rugged(s, attacking ? targetTile : unit.Tile)) v += promo.Terrain;
            if (v != 0) yield return (promo.Name, v);
        }
    }

    public static int MovesBonus(GameState s, UnitState unit)
    {
        int m = 0;
        foreach (int pr in unit.Promotions) m += s.Db.Promotions[pr].Moves;
        return m;
    }

    // ----- Experience and promotions -------------------------------------------------------------------

    public const int MaxPromotions = 4;

    /// <summary>Experience needed for the next promotion: 15, 45, 90, 150.</summary>
    public static int ExperienceFor(int promotions) => 15 * (promotions + 1) * (promotions + 2) / 2;

    public static bool CanPromote(GameState s, UnitState u) =>
        SupplySystem.IsMilitary(s.Db, u) && u.Promotions.Count < MaxPromotions && u.Experience >= ExperienceFor(u.Promotions.Count) &&
        Available(s, u).Any();

    public static IEnumerable<PromotionDef> Available(GameState s, UnitState u)
    {
        var def = s.Db.Units[u.DefIndex];
        return s.Db.Promotions.Where(p => p.Tier <= u.Promotions.Count + 1 && !u.Promotions.Contains(p.Index) &&
                                          (p.Classes.Count == 0 ? def.Domain != UnitDomain.Civilian : p.Classes.Contains(def.UnitClass)));
    }

    public static string? CanPromote(GameState s, UnitState u, int promotion)
    {
        if (promotion < 0 || promotion >= s.Db.Promotions.Count) return "No such promotion.";
        if (!SupplySystem.IsMilitary(s.Db, u)) return "Only military units are promoted.";
        if (u.Promotions.Count >= MaxPromotions) return "This unit has every promotion it can earn.";
        if (u.Experience < ExperienceFor(u.Promotions.Count)) return $"Needs {ExperienceFor(u.Promotions.Count)} experience.";
        if (!Available(s, u).Any(p => p.Index == promotion)) return "Not available to this unit.";
        return null;
    }

    /// <summary>Promoting takes the unit's turn and heals it by half.</summary>
    public static void Promote(GameState s, UnitState u, int promotion, List<GameEvent> events)
    {
        u.Promotions.Add(promotion);
        u.Hp = Math.Min(100, u.Hp + 50);
        u.MovesLeft = Fx.Zero;
        events.Add(new GameEvent(GameEventType.UnitPromoted, u.Owner, Tile: u.Tile, Def: u.DefIndex, Value: promotion, Detail: s.Db.Promotions[promotion].Name));
        if (u.Promotions.Count == 3) AgeSystem.Award(s, s.Players[u.Owner], 1, "A veteran company", events);
    }

    /// <summary>Experience from a fight: survivors learn, victors learn more, fights against cities teach the most.</summary>
    public static void GainExperience(GameState s, UnitState? unit, bool attacking, bool vsCity, bool killed)
    {
        if (unit == null || unit.Hp <= 0 || !SupplySystem.IsMilitary(s.Db, unit)) return;
        unit.Experience += (attacking ? 4 : 3) + (vsCity ? 3 : 0) + (killed ? 6 : 0);
    }

    /// <summary>Start-of-turn healing from promotions (field medics); weariness fades (fast in peace).</summary>
    public static void ProcessTurn(GameState s)
    {
        foreach (var p in s.Players)
        {
            if (p.WarWeariness <= 0 || !p.IsMajor) continue;
            bool atWar = s.Players.Any(o => o.Id != p.Id && o.IsAlive && !o.IsFreeCities && DiplomacySystem.AtWar(s, p.Id, o.Id));
            p.WarWeariness = Math.Max(0, p.WarWeariness - (atWar ? 1 : 3));
        }
        foreach (var u in s.Units)
        {
            int heal = 0;
            foreach (int pr in u.Promotions) heal += s.Db.Promotions[pr].HealPerTurn;
            if (heal > 0) u.Hp = Math.Min(100, u.Hp + heal);
        }
    }

    /// <summary>The free re-slot lasts one turn: cleared as the turn resolves, set again when a civic completes.</summary>
    public static void CloseSwapWindow(GameState s)
    {
        foreach (var p in s.Players) p.PolicySwapFree = false;
    }
}
