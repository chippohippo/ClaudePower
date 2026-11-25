using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>One line of a research cost breakdown ("+20% Purity leads Harmony by 5 levels").</summary>
public sealed record CostLine(string Label, int Percent);

/// <summary>How far a civilization is along its affinity's victory: each requirement with whether it is met.</summary>
public sealed record AffinityVictoryStep(string Label, bool Done);

/// <summary>
/// Affinities (docs/08-divergence-tech-tree.md §Affinities): the Divergence's three futures as tracks every civilization climbs,
/// Harmony (the Symbiont branch), Purity (Sovereign) and Supremacy (Discarnate). Points come from what a civilization researches,
/// builds, improves, slots and kills with, all named in data (an "affinity" field on the definition). Points make levels (0–20,
/// thresholds in worldRules.affinity). Levels switch on identity effects in every city and strengthen the affinity's units.
///
/// The affinities are softly exclusive: a tagged technology costs less the higher your level in its affinity and more the further
/// your dominant affinity leads it. The doctrine is the choice point: it needs a level in its affinity, makes that affinity
/// primary (the other two techs then cost much more) and locks the other two victories. Nothing else is locked.
///
/// Read API for the client: <see cref="Level"/>, <see cref="Points"/>, <see cref="Progress"/>, <see cref="Dominant"/>,
/// <see cref="Primary"/>, <see cref="NodeAffinity"/>, <see cref="CostLines"/>, <see cref="ActiveLevels"/>, <see cref="NextLevel"/>,
/// <see cref="VictorySteps"/>, <see cref="Name"/> and <see cref="VictoryName"/>; events AffinityLevelUp and DivergenceChosen.
/// </summary>
public static class AffinitySystem
{
    public const int MaxLevel = 20;

    // ----- Read API --------------------------------------------------------------------------------------

    public static int Count(GameState s) => s.Db.Divergences.Count;
    public static string Name(GameState s, int affinity) => affinity >= 0 && affinity < s.Db.Divergences.Count ? s.Db.Divergences[affinity].Name : "None";
    public static string VictoryName(GameState s, int affinity) =>
        affinity >= 0 && affinity < s.Db.Divergences.Count ? s.Db.Divergences[affinity].VictoryName ?? "Ascension" : "Ascension";

    public static int Points(PlayerState p, int affinity) => affinity >= 0 && affinity < p.AffinityPoints.Length ? p.AffinityPoints[affinity] : 0;
    public static int Level(PlayerState p, int affinity) => affinity >= 0 && affinity < p.AffinityLevels.Length ? p.AffinityLevels[affinity] : 0;

    public static int LevelFor(GameDatabase db, int points)
    {
        var t = db.Rules.Affinity.LevelThresholds;
        int level = 0;
        while (level < t.Count && level < MaxLevel && points >= t[level]) level++;
        return level;
    }

    /// <summary>Points into the current level and points the next level needs (0, 0 at the top).</summary>
    public static (int Into, int Needed) Progress(GameState s, PlayerState p, int affinity)
    {
        var t = s.Db.Rules.Affinity.LevelThresholds;
        int level = Level(p, affinity), points = Points(p, affinity);
        if (level >= t.Count || level >= MaxLevel) return (0, 0);
        int floor = level == 0 ? 0 : t[level - 1];
        return (points - floor, t[level] - floor);
    }

    /// <summary>The affinity the civilization is highest in (level, then points, then lower index); -1 when it has none.</summary>
    public static int Dominant(PlayerState p)
    {
        int best = -1;
        for (int a = 0; a < p.AffinityPoints.Length; a++)
        {
            if (p.AffinityPoints[a] <= 0) continue;
            if (best < 0 || Level(p, a) > Level(p, best) || (Level(p, a) == Level(p, best) && Points(p, a) > Points(p, best))) best = a;
        }
        return best;
    }

    /// <summary>The primary affinity chosen at the doctrine (-1 not yet).</summary>
    public static int Primary(PlayerState p) => p.Divergence;

    /// <summary>The affinity a technology or civic belongs to, for colouring the tree: its branch, else what it grants most of.</summary>
    public static int NodeAffinity(ProgressNodeDef node) => node.DivergenceIndex >= 0 ? node.DivergenceIndex : node.AffinityIndex;

    /// <summary>Identity effects switched on at the levels the player holds, per affinity.</summary>
    public static IEnumerable<(int Affinity, AffinityLevelDef Level)> ActiveLevels(GameState s, PlayerState p)
    {
        foreach (var d in s.Db.Divergences)
            foreach (var l in d.Levels)
                if (Level(p, d.Index) >= l.Level) yield return (d.Index, l);
    }

    /// <summary>The next identity effect the player would unlock in the affinity (null when none remain).</summary>
    public static AffinityLevelDef? NextLevel(GameState s, PlayerState p, int affinity) =>
        s.Db.Divergences[affinity].Levels.Where(l => l.Level > Level(p, affinity)).OrderBy(l => l.Level).FirstOrDefault();

    // ----- Earning points ------------------------------------------------------------------------------------

    public static void Award(GameState s, PlayerState p, int affinity, int points, string reason, List<GameEvent>? events)
    {
        if (points == 0 || affinity < 0 || affinity >= Count(s) || !p.IsMajor) return;
        Ensure(s, p);
        p.AffinityPoints[affinity] = Math.Max(0, p.AffinityPoints[affinity] + points);
        int before = p.AffinityLevels[affinity];
        int after = LevelFor(s.Db, p.AffinityPoints[affinity]);
        p.AffinityLevels[affinity] = after;
        if (after > before)
            events?.Add(new GameEvent(GameEventType.AffinityLevelUp, p.Id, Def: affinity, Value: after,
                                      Detail: $"{Name(s, affinity)} level {after} ({reason})"));
    }

    public static void Grant(GameState s, PlayerState p, Definition def, List<GameEvent>? events)
    {
        if (def.AffinityGrants.Length == 0) return;
        for (int a = 0; a < def.AffinityGrants.Length; a++)
            if (def.AffinityGrants[a] != 0) Award(s, p, a, def.AffinityGrants[a], def.Name, events);
    }

    private static void Ensure(GameState s, PlayerState p)
    {
        int n = Count(s);
        if (p.AffinityPoints.Length < n) Array.Resize(ref p.AffinityPoints, n);
        if (p.AffinityLevels.Length < n) Array.Resize(ref p.AffinityLevels, n);
    }

    /// <summary>Why the player may not build or research this yet for want of affinity (null when it may).</summary>
    public static string? RequirementReason(GameState s, PlayerState p, Definition def) =>
        def.RequiresAffinityIndex >= 0 && Level(p, def.RequiresAffinityIndex) < def.RequiresAffinityLevel
            ? $"Requires {Name(s, def.RequiresAffinityIndex)} level {def.RequiresAffinityLevel}." : null;

    public static void OnNodeCompleted(GameState s, PlayerState p, ProgressNodeDef node, List<GameEvent> events) => Grant(s, p, node, events);

    public static void OnCompleted(GameState s, CityState city, ProductionKind kind, int def, List<GameEvent> events)
    {
        var db = s.Db;
        Definition? d = kind switch
        {
            ProductionKind.Building => db.Buildings[def],
            ProductionKind.District => db.Districts[def],
            ProductionKind.Project => db.Projects[def],
            ProductionKind.Unit => null,
            _ => null,
        };
        if (d != null) Grant(s, s.Players[city.Owner], d, events);
    }

    public static void OnImprovementBuilt(GameState s, int player, int improvement, List<GameEvent> events) =>
        Grant(s, s.Players[player], s.Db.Improvements[improvement], events);

    /// <summary>A unit of an affinity (its tag) that destroys an enemy earns its owner that affinity's points.</summary>
    public static void OnKill(GameState s, int killerOwner, UnitState? killer, List<GameEvent> events)
    {
        if (killer == null || killerOwner < 0 || !s.Players[killerOwner].IsMajor) return;
        int a = UnitAffinity(s, killer.DefIndex);
        if (a >= 0) Award(s, s.Players[killerOwner], a, s.Db.Rules.Affinity.PointsPerKill, "a victory in battle", events);
    }

    /// <summary>The affinity a unit type belongs to (its tag), or -1.</summary>
    public static int UnitAffinity(GameState s, int unitDef)
    {
        var u = s.Db.Units[unitDef];
        foreach (var d in s.Db.Divergences)
            if (d.UnitTag != null && u.HasTag(d.UnitTag)) return d.Index;
        return u.AffinityIndex;
    }

    /// <summary>Slotted policies pay their affinity every few turns; living units regenerate.</summary>
    public static void ProcessTurn(GameState s, List<GameEvent> events)
    {
        var rules = s.Db.Rules.Affinity;
        if (rules.PolicyInterval > 0 && s.Turn % rules.PolicyInterval == 0)
            foreach (var p in s.Players)
            {
                if (!p.IsMajor || !p.IsAlive) continue;
                foreach (int c in p.Policies) Grant(s, p, s.Db.Policies[c], events);
            }
        foreach (var d in s.Db.Divergences)
        {
            if (d.UnitHealPerTurn <= 0 || d.UnitTag == null) continue;
            foreach (var u in s.Units)
                if (u.Hp < 100 && s.Db.Units[u.DefIndex].HasTag(d.UnitTag)) u.Hp = Math.Min(100, u.Hp + d.UnitHealPerTurn);
        }
    }

    // ----- Research costs (soft exclusivity) -------------------------------------------------------------------

    /// <summary>Percent lines applied to a node's cost: the affinity discount, the gap penalty, the primary bias and the affinity boost.</summary>
    public static List<CostLine> CostLines(GameState s, PlayerState p, ProgressNodeDef node)
    {
        var lines = new List<CostLine>();
        var rules = s.Db.Rules.Affinity;
        int a = NodeAffinity(node);
        if (a >= 0 && !node.Doctrine)
        {
            int level = Level(p, a);
            int discount = Math.Min(rules.MaxDiscountPercent, rules.DiscountPercentPerLevel * level);
            if (discount > 0) lines.Add(new CostLine($"{Name(s, a)} level {level}", -discount));
            int dominant = Dominant(p);
            int gap = dominant >= 0 && dominant != a ? Level(p, dominant) - level : 0;
            int penalty = Math.Min(rules.MaxGapPenaltyPercent, rules.GapPenaltyPercentPerLevel * Math.Max(0, gap));
            if (penalty > 0) lines.Add(new CostLine($"{Name(s, dominant)} leads {Name(s, a)} by {gap} levels", penalty));
            if (p.Divergence >= 0 && p.Divergence != a) lines.Add(new CostLine($"Your people chose {Name(s, p.Divergence)}", rules.CommittedPenaltyPercent));
        }
        if (node.BoostAffinityIndex >= 0 && node.BoostLevel > 0 && Level(p, node.BoostAffinityIndex) >= node.BoostLevel)
            lines.Add(new CostLine($"Boost: {Name(s, node.BoostAffinityIndex)} level {node.BoostLevel}", -node.BoostPercent));
        return lines;
    }

    public static Fx CostMultiplier(GameState s, PlayerState p, ProgressNodeDef node)
    {
        if (NodeAffinity(node) < 0 && node.BoostAffinityIndex < 0) return Fx.One;
        int percent = 100 + CostLines(s, p, node).Sum(l => l.Percent);
        return Fx.Ratio(Math.Max(20, percent), 100);
    }

    // ----- Identity effects ----------------------------------------------------------------------------------

    /// <summary>The level effects that hold in this city (every affinity, at the owner's levels).</summary>
    public static IEnumerable<(List<ModifierDef> Modifiers, string Source)> CityModifierSources(GameState s, CityState city)
    {
        var p = s.Players[city.Owner];
        if (!p.IsMajor) yield break;
        foreach (var d in s.Db.Divergences)
        {
            int level = Level(p, d.Index);
            if (level <= 0) continue;
            foreach (var l in d.Levels)
                if (level >= l.Level) yield return (l.Modifiers, $"{d.Name} level {l.Level}");
        }
    }

    /// <summary>Strength the unit draws from its affinity's level (combat breakdown line).</summary>
    public static IEnumerable<(string Label, int Value)> CombatLines(GameState s, UnitState unit)
    {
        int a = UnitAffinity(s, unit.DefIndex);
        if (a < 0) yield break;
        var d = s.Db.Divergences[a];
        if (d.LevelsPerUnitStrength <= 0) yield break;
        int bonus = Level(s.Players[unit.Owner], a) / d.LevelsPerUnitStrength;
        if (bonus > 0) yield return ($"{d.Name} level {Level(s.Players[unit.Owner], a)}", bonus);
    }

    public static IEnumerable<(string Label, int Value)> CityDefenseLines(GameState s, CityState city)
    {
        var p = s.Players[city.Owner];
        foreach (var d in s.Db.Divergences)
        {
            if (d.LevelsPerCityDefense <= 0) continue;
            int bonus = Level(p, d.Index) / d.LevelsPerCityDefense;
            if (bonus > 0) yield return ($"{d.Name} level {Level(p, d.Index)}", bonus);
        }
    }

    /// <summary>Peoples whose dominant affinities agree feel a kinship; those that differ, a rivalry (before or after the choice).</summary>
    public static int Attitude(GameState s, PlayerState from, PlayerState toward)
    {
        if (from.Divergence >= 0 && toward.Divergence >= 0) return 0;   // the committed weigh each other by ideology (DivergenceSystem)
        var rules = s.Db.Rules.Affinity;
        int a = Dominant(from), b = Dominant(toward);
        if (a < 0 || b < 0 || Level(from, a) < rules.KindredLevel || Level(toward, b) < rules.KindredLevel) return 0;
        return a == b ? rules.KindredAttitude : rules.RivalAttitude;
    }

    // ----- The affinity victory ----------------------------------------------------------------------------

    /// <summary>
    /// The steps to the player's affinity victory: the primary affinity, then for the victory project and every project it needs,
    /// its technology, its level and the project itself. Empty when the victory has no project.
    /// </summary>
    public static List<AffinityVictoryStep> VictorySteps(GameState s, PlayerState p)
    {
        var steps = new List<AffinityVictoryStep>();
        int a = p.Divergence >= 0 ? p.Divergence : Dominant(p);
        if (a < 0) a = 0;
        var d = s.Db.Divergences[a];
        steps.Add(new AffinityVictoryStep($"Choose {d.Name} as your primary affinity", p.Divergence == a));
        if (d.AscensionProjectIndex < 0) return steps;
        foreach (int proj in VictoryChain(s, d.AscensionProjectIndex))
        {
            var pr = s.Db.Projects[proj];
            if (pr.PrereqTechIndex >= 0) steps.Add(new AffinityVictoryStep($"Research {s.Db.Techs[pr.PrereqTechIndex].Name}", p.HasTech(pr.PrereqTechIndex)));
            if (pr.RequiresAffinityLevel > 0)
                steps.Add(new AffinityVictoryStep($"Reach {d.Name} level {pr.RequiresAffinityLevel}", Level(p, a) >= pr.RequiresAffinityLevel));
            if (pr.RequiresWorldTransformedPercent > 0)
                steps.Add(new AffinityVictoryStep($"Remake {pr.RequiresWorldTransformedPercent}% of the world's land",
                                                  DivergenceSystem.WorldShare(s)[a] >= pr.RequiresWorldTransformedPercent));
            steps.Add(new AffinityVictoryStep($"Complete {pr.Name}", p.CompletedProjects.Contains(proj) || (proj == d.AscensionProjectIndex && p.Ascended)));
        }
        return steps;
    }

    /// <summary>The victory project's chain in build order (prerequisite projects first, the victory project last).</summary>
    public static List<int> VictoryChain(GameState s, int project)
    {
        var order = new List<int>();
        void Visit(int pr)
        {
            if (order.Contains(pr)) return;
            foreach (int req in s.Db.Projects[pr].RequiresProjectIndices) Visit(req);
            order.Add(pr);
        }
        Visit(project);
        return order;
    }

    /// <summary>The first project of the chain still to build (for the AI and the victory dashboard), or -1.</summary>
    public static int NextVictoryProject(GameState s, PlayerState p)
    {
        if (p.Divergence < 0 || p.Ascended) return -1;
        int final = s.Db.Divergences[p.Divergence].AscensionProjectIndex;
        if (final < 0) return -1;
        foreach (int proj in VictoryChain(s, final))
            if (!p.CompletedProjects.Contains(proj)) return proj;
        return -1;
    }
}
