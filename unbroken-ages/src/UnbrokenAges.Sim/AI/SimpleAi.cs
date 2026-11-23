using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;
using UnbrokenAges.Sim.Systems.Districts;

namespace UnbrokenAges.Sim.AI;

/// <summary>
/// AI players run ONLY on the host (or in single player) and act purely by emitting the same
/// commands a human would. Clients never run AI, so AI code does not need to be deterministic
/// across machines, may use threads and wall-clock budgets, and can be patched without breaking
/// multiplayer compatibility. This baseline controller exists to exercise the pipeline; the full
/// AI architecture (strategic director, planners, operational/tactical layers) is described in
/// docs/02-technical-architecture.md.
/// </summary>
public interface IAiController
{
    IEnumerable<GameCommand> TakeTurn(GameState state, int playerId);
}

public sealed class SimpleAi : IAiController
{
    public IEnumerable<GameCommand> TakeTurn(GameState s, int playerId)
    {
        var db = s.Db;
        var player = s.Players[playerId];
        var commands = new List<GameCommand>();

        foreach (var unit in s.Units.Where(u => u.Owner == playerId).ToList())
        {
            if (db.Units[unit.DefIndex].FoundsCity)
            {
                var found = new FoundCityCommand { Player = playerId, UnitId = unit.Id };
                if (found.Validate(s) == null) commands.Add(found);
            }
            else if (db.Units[unit.DefIndex].FoundsOutpost)
            {
                var plant = new FoundOutpostCommand { Player = playerId, UnitId = unit.Id };
                if (plant.Validate(s) == null) commands.Add(plant);
            }
        }

        if (player.CurrentTech < 0 && PickTech(s, player) is { } tech)
            commands.Add(new SetResearchCommand { Player = playerId, Tech = tech.Index });
        if (player.CurrentCivic < 0)
        {
            var civic = db.Civics.FirstOrDefault(c => ResearchSystem.CanStudy(player, c));
            if (civic != null) commands.Add(new SetCivicCommand { Player = playerId, Civic = civic.Index });
        }

        foreach (var city in s.CitiesOf(playerId))
        {
            if (city.Queue.Items.Count > 0) continue;
            if (PickDivergenceProduction(s, player, city) is { } divergenceItem)
            {
                commands.Add(new EnqueueCommand { Player = playerId, CityId = city.Id, Kind = divergenceItem.Kind, DefIndex = divergenceItem.Def });
                continue;
            }
            // Prefer the best-scoring specialty district (same scorer the player's lens uses).
            var districtChoice = db.Districts
                .Where(d => d.Category == DistrictCategory.Specialty)
                .Select(d => (Def: d, Best: DistrictPlanner.Rank(s, city, d.Index, DistrictPlanner.BalancedWeights, 1).FirstOrDefault()))
                .Where(x => x.Best != null)
                .OrderByDescending(x => x.Best!.Score).ThenBy(x => x.Def.Index)
                .FirstOrDefault();
            if (districtChoice.Best != null)
            {
                commands.Add(new EnqueueCommand
                {
                    Player = playerId, CityId = city.Id, Kind = ProductionKind.District,
                    DefIndex = districtChoice.Def.Index, Tile = districtChoice.Best.Tile,
                });
                continue;
            }
            var unitDef = db.Units.FirstOrDefault(u => u.Domain == UnitDomain.Land && u.Strength > 0 &&
                                                       ProductionSystem.CanEnqueue(s, city, ProductionKind.Unit, u.Index, -1) == null);
            if (unitDef != null)
                commands.Add(new EnqueueCommand { Player = playerId, CityId = city.Id, Kind = ProductionKind.Unit, DefIndex = unitDef.Index });
        }

        commands.AddRange(Governors(s, player));

        // Upgrades with the preset (standard) variant, keeping 100 gold in reserve.
        foreach (var unit in s.Units.Where(u => u.Owner == playerId && SupplySystem.IsMilitary(db, u)))
            foreach (int target in UpgradeSystem.Targets(s, unit))
            {
                int variant = UnitStats.DefaultVariant(db, target);
                if (UpgradeSystem.Validate(s, unit, target, variant) != null || player.Gold < UpgradeSystem.GoldCost(s, unit, target, variant) + 100) continue;
                commands.Add(new UpgradeUnitCommand { Player = playerId, UnitId = unit.Id, Target = target, Variant = variant });
                break;
            }

        // Diplomacy (baseline): accept any peace offer; offer peace once a war has run its minimum length.
        foreach (var rel in s.Relations)
        {
            if (rel.A != playerId && rel.B != playerId) continue;
            int other = rel.A == playerId ? rel.B : rel.A;
            if (rel.PeaceProposedBy == other) commands.Add(new AcceptPeaceCommand { Player = playerId, Target = other });
            else if (rel.Status == DiploStatus.War && rel.PeaceProposedBy < 0 && DiplomacySystem.ValidateProposePeace(s, playerId, other) == null)
                commands.Add(new ProposePeaceCommand { Player = playerId, Target = other });
        }

        commands.Add(new EndTurnCommand { Player = playerId });
        return commands;
    }

    /// <summary>Seat idle governors in the largest ungoverned cities, then spend a title: appoint first, promote after.</summary>
    private static IEnumerable<GameCommand> Governors(GameState s, PlayerState player)
    {
        var open = s.CitiesOf(player.Id).Where(c => c.GovernorDef < 0).OrderByDescending(c => c.Population).ThenBy(c => c.Id).ToList();
        foreach (var gov in player.Governors.Where(g => g.CityId < 0))
        {
            if (open.Count == 0) break;
            yield return new AssignGovernorCommand { Player = player.Id, Governor = gov.DefIndex, CityId = open[0].Id };
            open.RemoveAt(0);
        }
        if (player.GovernorTitles < 1) yield break;
        var next = s.Db.Governors.FirstOrDefault(g => player.GetGovernor(g.Index) == null);
        if (next != null && open.Count > 0)
        {
            yield return new AppointGovernorCommand { Player = player.Id, Governor = next.Index };
            yield break;
        }
        foreach (var gov in player.Governors)
            for (int p = 0; p < s.Db.Governors[gov.DefIndex].Promotions.Count; p++)
                if (GovernorSystem.ValidatePromote(s, player, gov.DefIndex, p) == null)
                {
                    yield return new PromoteGovernorCommand { Player = player.Id, Governor = gov.DefIndex, Promotion = p };
                    yield break;
                }
    }

    /// <summary>
    /// Divergence behaviour: commit to the doctrine its history and personality favour, then pursue
    /// its own branch; in cities, build the world-remaking building first, then the Ascension project.
    /// </summary>
    private static (ProductionKind Kind, int Def)? PickDivergenceProduction(GameState s, PlayerState player, CityState city)
    {
        if (player.Divergence < 0) return null;
        var db = s.Db;
        var d = db.Divergences[player.Divergence];
        if (d.Spread is { SourceBuildingIndex: >= 0 } spread &&
            ProductionSystem.Validate(s, city, ProductionKind.Building, spread.SourceBuildingIndex, -1) == null)
            return (ProductionKind.Building, spread.SourceBuildingIndex);
        if (d.AscensionProjectIndex >= 0 && ProductionSystem.Validate(s, city, ProductionKind.Project, d.AscensionProjectIndex, -1) == null)
            return (ProductionKind.Project, d.AscensionProjectIndex);
        foreach (var b in db.Buildings)
            if (b.PrereqTechIndex >= 0 && db.Techs[b.PrereqTechIndex].DivergenceIndex == player.Divergence &&
                ProductionSystem.Validate(s, city, ProductionKind.Building, b.Index, -1) == null)
                return (ProductionKind.Building, b.Index);
        return null;
    }

    /// <summary>Beeline toward the cheapest tech that unlocks a specialty district; otherwise cheapest available.</summary>
    private static TechDef? PickTech(GameState s, PlayerState player)
    {
        var db = s.Db;
        var available = db.Techs.Where(t => ResearchSystem.CanResearch(player, t)).ToList();
        // At the Threshold: commit to the doctrine our history leans toward (weighted by personality).
        var doctrines = available.Where(t => t.Doctrine).ToList();
        if (doctrines.Count > 0 && player.Divergence < 0)
        {
            int preferred = DivergenceSystem.Preferred(s, player);
            return doctrines.FirstOrDefault(t => t.DivergenceIndex == preferred) ?? doctrines[0];
        }
        if (player.Divergence >= 0)
        {
            var own = available.Where(t => t.DivergenceIndex == player.Divergence).OrderBy(t => t.Cost).ThenBy(t => t.Index).FirstOrDefault();
            if (own != null) return own;
        }
        return PickTechClassic(db, player, available);
    }

    private static TechDef? PickTechClassic(GameDatabase db, PlayerState player, List<TechDef> available)
    {
        var wanted = new HashSet<int>();
        void Want(int t)
        {
            if (t < 0 || player.Techs[t] || !wanted.Add(t)) return;
            foreach (int p in db.Techs[t].PrereqIndices) Want(p);
        }
        var goal = db.Districts.Where(d => d.Category == DistrictCategory.Specialty && d.PrereqTechIndex >= 0 && !player.Techs[d.PrereqTechIndex])
            .OrderBy(d => db.Techs[d.PrereqTechIndex].Cost).ThenBy(d => d.Index).FirstOrDefault();
        if (goal != null) Want(goal.PrereqTechIndex);
        return available.Where(t => wanted.Contains(t.Index)).OrderBy(t => t.Cost).ThenBy(t => t.Index).FirstOrDefault()
               ?? available.OrderBy(t => t.Cost).ThenBy(t => t.Index).FirstOrDefault();
    }
}
