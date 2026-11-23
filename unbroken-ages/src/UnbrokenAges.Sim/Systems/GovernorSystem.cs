using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// Governors: appointed with titles (earned from civics), promoted along a small tree, and
/// assigned to one city where they take several turns to become established. Effects are
/// ordinary data-driven modifiers aggregated by CityEffects once established.
/// </summary>
public static class GovernorSystem
{
    public static int EstablishTurns(GameDatabase db, GovernorState gov)
    {
        var def = db.Governors[gov.DefIndex];
        int turns = def.EstablishTurns;
        foreach (int p in gov.Promotions)
            foreach (var m in def.Promotions[p].Modifiers)
                if (m.Effect == ModifierEffect.GovernorEstablishTurns) turns += m.Amount.FloorToInt();
        return Math.Max(1, turns);
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
