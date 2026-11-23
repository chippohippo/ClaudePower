using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// Governors: appointed with titles (earned from civics), promoted along a small tree, and
/// assigned to one city where they take several turns to become established. Effects are
/// ordinary data-driven modifiers aggregated by CityEffects once established.
///
/// Living Governors: an established governor gains one experience per turn (ranks at 20 / 50 / 100 make
/// re-establishing one turn faster each) and earns up to three traits from where it serves
/// (<see cref="GovernorTraitDef"/>): "River-wise" after 15 turns on a Great River, "Levee-builder" after weathering
/// two disasters. Traits travel with the governor. Ageing, retirement and succession are the Grand-dial layer (M3).
/// </summary>
public static class GovernorSystem
{
    public const int MaxTraits = 3;
    private static readonly int[] RankThresholds = { 20, 50, 100 };
    private static readonly string[] RankNames = { "Newly appointed", "Seasoned", "Veteran", "Legendary" };

    public static int Rank(GovernorState gov) => RankThresholds.Count(t => gov.Experience >= t);
    public static string RankName(GovernorState gov) => RankNames[Rank(gov)];

    public static int EstablishTurns(GameDatabase db, GovernorState gov)
    {
        var def = db.Governors[gov.DefIndex];
        int turns = def.EstablishTurns - Rank(gov);
        foreach (int p in gov.Promotions)
            foreach (var m in def.Promotions[p].Modifiers)
                if (m.Effect == ModifierEffect.GovernorEstablishTurns) turns += m.Amount.FloorToInt();
        foreach (int t in gov.Traits)
            foreach (var m in db.GovernorTraits[t].Modifiers)
                if (m.Effect == ModifierEffect.GovernorEstablishTurns) turns += m.Amount.FloorToInt();
        return Math.Max(1, turns);
    }

    /// <summary>
    /// End of turn, after every other system: established governors gain experience and progress toward traits from
    /// their city's situation and from this turn's events in it.
    /// </summary>
    public static void GainExperience(GameState s, List<GameEvent> events)
    {
        int turnEvents = events.Count; // traits earned now are not themselves counted
        foreach (var p in s.Players)
        foreach (var gov in p.Governors)
        {
            if (!gov.Established || s.GetCity(gov.CityId) is not { } city || city.Owner != p.Id) continue;
            gov.Experience++;
            foreach (var trait in s.Db.GovernorTraits)
            {
                if (gov.Traits.Count >= MaxTraits) break;
                if (!CanEarn(s, gov, trait, city)) continue;
                int gained = trait.EventType is { } type ? CountEvents(s, events, turnEvents, type, city.Id) : 1;
                if (gained == 0) continue;
                int progress = gov.TraitProgress.GetValueOrDefault(trait.Index) + gained;
                if (progress < trait.Goal) { gov.TraitProgress[trait.Index] = progress; continue; }
                gov.TraitProgress.Remove(trait.Index);
                gov.Traits.Add(trait.Index);
                events.Add(new GameEvent(GameEventType.GovernorTraitEarned, p.Id, city.Id, Def: trait.Index, Value: gov.DefIndex,
                    Detail: $"{s.Db.Governors[gov.DefIndex].Name}, serving in {city.Name}, becomes {trait.Name}"));
            }
        }
    }

    private static bool CanEarn(GameState s, GovernorState gov, GovernorTraitDef trait, CityState city) =>
        !gov.Traits.Contains(trait.Index)
        && (trait.GovernorIndices.Length == 0 || Array.IndexOf(trait.GovernorIndices, gov.DefIndex) >= 0)
        && CityEffects.RequirementsMet(s, city, trait.Requirements);

    private static int CountEvents(GameState s, List<GameEvent> events, int end, GameEventType type, int cityId)
    {
        int n = 0;
        for (int i = 0; i < end; i++)
        {
            var e = events[i];
            if (e.Type != type) continue;
            int city = e.City >= 0 ? e.City : e.Tile >= 0 ? s.Map.OwnerCity[e.Tile] : -1;
            if (city == cityId) n++;
        }
        return n;
    }

    /// <summary>The unearned trait this governor is closest to in its current city (for the city panel), or null.</summary>
    public static (GovernorTraitDef Trait, int Progress)? NextTrait(GameState s, GovernorState gov)
    {
        if (gov.Traits.Count >= MaxTraits || s.GetCity(gov.CityId) is not { } city) return null;
        (GovernorTraitDef, int)? best = null;
        int bestPermille = -1;
        foreach (var trait in s.Db.GovernorTraits)
        {
            if (!CanEarn(s, gov, trait, city)) continue;
            int progress = gov.TraitProgress.GetValueOrDefault(trait.Index);
            int permille = progress * 1000 / trait.Goal;
            if (permille > bestPermille) { bestPermille = permille; best = (trait, progress); }
        }
        return best;
    }

    /// <summary>"The Castellan · Veteran · Borderer, River-wise · next: Levee-builder 1/2".</summary>
    public static string Describe(GameState s, GovernorState gov)
    {
        var db = s.Db;
        string text = $"{db.Governors[gov.DefIndex].Name} · {RankName(gov)}";
        if (gov.Traits.Count > 0) text += " · " + string.Join(", ", gov.Traits.Select(t => db.GovernorTraits[t].Name));
        if (NextTrait(s, gov) is var (trait, progress)) text += $" · next: {trait.Name} {progress}/{trait.Goal}";
        return text;
    }

    public static string? ValidateAppoint(GameState s, PlayerState p, int def)
    {
        if (def < 0 || def >= s.Db.Governors.Count) return "Unknown governor.";
        if (p.GetGovernor(def) != null) return "Already appointed.";
        if (p.GovernorTitles < 1) return "No governor titles available.";
        return null;
    }

    public static void Appoint(PlayerState p, int def)
    {
        p.GovernorTitles--;
        p.Governors.Add(new GovernorState { DefIndex = def });
        p.Governors.Sort((a, b) => a.DefIndex.CompareTo(b.DefIndex));
    }

    public static string? ValidatePromote(GameState s, PlayerState p, int def, int promotion)
    {
        var gov = p.GetGovernor(def);
        if (gov == null) return "Governor not appointed.";
        var gdef = s.Db.Governors[def];
        if (promotion < 0 || promotion >= gdef.Promotions.Count) return "Unknown promotion.";
        if (gov.Promotions.Contains(promotion)) return "Already promoted.";
        if (p.GovernorTitles < 1) return "No governor titles available.";
        foreach (int req in gdef.Promotions[promotion].RequiresIndices)
            if (!gov.Promotions.Contains(req)) return $"Requires {gdef.Promotions[req].Name}.";
        return null;
    }

    public static void Promote(PlayerState p, int def, int promotion)
    {
        p.GovernorTitles--;
        var gov = p.GetGovernor(def)!;
        gov.Promotions.Add(promotion);
        gov.Promotions.Sort();
    }

    public static string? ValidateAssign(GameState s, PlayerState p, int def, int cityId)
    {
        if (p.GetGovernor(def) == null) return "Governor not appointed.";
        if (cityId < 0) return null; // recall to the unassigned pool
        var city = s.GetCity(cityId);
        if (city == null || city.Owner != p.Id) return "Not your city.";
        return null;
    }

    /// <summary>
    /// Moving a governor restarts establishment; a governor already in the target city is
    /// returned to the pool (swap rather than refuse — fewer clicks).
    /// </summary>
    public static void Assign(GameState s, PlayerState p, int def, int cityId)
    {
        var gov = p.GetGovernor(def)!;
        if (gov.CityId == cityId) return;
        if (gov.CityId >= 0 && s.GetCity(gov.CityId) is { } previous) previous.GovernorDef = -1;
        gov.CityId = -1;
        gov.Established = false;
        gov.EstablishProgress = 0;
        if (cityId < 0) return;

        var city = s.GetCity(cityId)!;
        if (city.GovernorDef >= 0 && p.GetGovernor(city.GovernorDef) is { } incumbent)
        {
            incumbent.CityId = -1;
            incumbent.Established = false;
            incumbent.EstablishProgress = 0;
        }
        gov.CityId = cityId;
        city.GovernorDef = def;
    }

    public static void Unassign(GameState s, CityState city)
    {
        if (city.GovernorDef < 0) return;
        var gov = s.Players[city.Owner].GetGovernor(city.GovernorDef);
        if (gov != null)
        {
            gov.CityId = -1;
            gov.Established = false;
            gov.EstablishProgress = 0;
        }
        city.GovernorDef = -1;
    }

    public static void ProcessTurn(GameState s, List<GameEvent> events)
    {
        foreach (var p in s.Players)
        foreach (var gov in p.Governors)
        {
            if (gov.CityId < 0 || gov.Established) continue;
            gov.EstablishProgress++;
            if (gov.EstablishProgress >= EstablishTurns(s.Db, gov))
            {
                gov.Established = true;
                events.Add(new GameEvent(GameEventType.GovernorEstablished, p.Id, gov.CityId, Def: gov.DefIndex, Detail: s.Db.Governors[gov.DefIndex].Name));
            }
        }
    }
}
