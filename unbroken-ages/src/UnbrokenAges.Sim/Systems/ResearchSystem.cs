using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>Separate technology and civic trees. Costs scale with game speed and era pacing ("Extended Eras").</summary>
public static class ResearchSystem
{
    public static Fx Cost(GameState s, ProgressNodeDef node) =>
        node.Cost * s.Options.GameSpeedPercent / 100 * s.Options.EraPacingPercent / 100;

    /// <summary>
    /// Player-specific cost: doctrines are cheaper for the Divergence your history leans toward, and knowledge diffuses: a technology
    /// or civic is up to <see cref="DiffusionPercent"/>% cheaper as more of the other living great powers know it (none for the
    /// Divergence's own branches). Peoples that fall behind can catch up; the leader pays full price.
    /// </summary>
    public static Fx Cost(GameState s, PlayerState p, ProgressNodeDef node)
    {
        Fx cost = Cost(s, node) * DivergenceSystem.CostMultiplier(s, p, node) * AffinitySystem.CostMultiplier(s, p, node);
        int known = Known(s, p, node, out int others);
        return others == 0 || known == 0 ? cost : cost - cost * (DiffusionPercent * known) / (100 * others);
    }

    public const int DiffusionPercent = 40;

    /// <summary>How many of the other living great powers know the node (out of <paramref name="others"/>).</summary>
    public static int Known(GameState s, PlayerState p, ProgressNodeDef node, out int others)
    {
        others = 0;
        if (node.DivergenceIndex >= 0) return 0;
        int known = 0;
        foreach (var o in s.Players)
        {
            if (o.Id == p.Id || !o.IsMajor || !o.IsAlive) continue;
            others++;
            if (node is TechDef ? o.Techs[node.Index] : o.Civics[node.Index]) known++;
        }
        return known;
    }

    public static bool CanResearch(PlayerState p, TechDef t) =>
        !p.Techs[t.Index] && t.PrereqIndices.All(i => p.Techs[i]) && DivergenceSystem.IsAvailable(p, t);

    public static bool CanStudy(PlayerState p, CivicDef c) =>
        !p.Civics[c.Index] && c.PrereqIndices.All(i => p.Civics[i]) && DivergenceSystem.IsAvailable(p, c);

    /// <summary>Science and culture per turn from all of a player's cities, as the next turn will count them.</summary>
    public static (int Science, int Culture) Rates(GameState s, int player)
    {
        Fx science = Fx.Zero, culture = Fx.Zero;
        foreach (var city in s.CitiesOf(player))
        {
            var report = CityYields.Compute(s, city, CityEffects.Compute(s, city));
            science += report.Total.Science;
            culture += report.Total.Culture;
        }
        return (science.FloorToInt(), culture.FloorToInt());
    }

    public static void Process(GameState s, PlayerState p, Fx science, Fx culture, List<GameEvent> events)
    {
        var db = s.Db;
        int eraBefore = s.PlayerEra(p);
        p.TechProgress += science;
        if (p.CurrentTech >= 0)
        {
            var tech = db.Techs[p.CurrentTech];
            Fx cost = Cost(s, p, tech);
            if (p.TechProgress >= cost)
            {
                p.TechProgress -= cost;
                p.Techs[tech.Index] = true;
                p.CurrentTech = -1;
                events.Add(new GameEvent(GameEventType.TechResearched, p.Id, Def: tech.Index, Detail: tech.Name));
                DivergenceSystem.OnNodeCompleted(s, p, tech, events);
            }
        }

        p.CivicProgress += culture;
        if (p.CurrentCivic >= 0)
        {
            var civic = db.Civics[p.CurrentCivic];
            Fx cost = Cost(s, p, civic);
            if (p.CivicProgress >= cost)
            {
                p.CivicProgress -= cost;
                p.Civics[civic.Index] = true;
                p.GovernorTitles += civic.GovernorTitles;
                p.CurrentCivic = -1;
                p.PolicySwapFree = true;   // a new civic: cards and government may change for free next turn
                events.Add(new GameEvent(GameEventType.CivicCompleted, p.Id, Def: civic.Index, Detail: civic.Name));
                DivergenceSystem.OnNodeCompleted(s, p, civic, events);
            }
        }

        int eraAfter = s.PlayerEra(p);
        if (eraAfter > eraBefore && db.Eras.FirstOrDefault(e => e.Order == eraAfter) is { } era)
        {
            events.Add(new GameEvent(GameEventType.EraEntered, p.Id, Def: era.Index, Value: eraAfter, Detail: era.Name));
            AgeSystem.OnEraEntered(s, p, eraAfter, events);
        }
    }
}
