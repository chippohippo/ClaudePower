using UnbrokenAges.Sim.Core;
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

        commands.AddRange(ExpansionAi.Settlers(s, player));
        commands.AddRange(BuilderAi.Builders(s, player));
        foreach (var unit in s.Units.Where(u => u.Owner == playerId && db.Units[u.DefIndex].FoundsOutpost && !NationSystem.IsColonist(s, player, db.Units[u.DefIndex])).ToList())
        {
            var plant = new FoundOutpostCommand { Player = playerId, UnitId = unit.Id };
            if (plant.Validate(s) == null) commands.Add(plant);
        }

        if (player.CurrentTech < 0 && PickTech(s, player) is { } tech)
            commands.Add(new SetResearchCommand { Player = playerId, Tech = tech.Index });
        if (player.CurrentCivic < 0)
        {
            var civic = db.Civics.FirstOrDefault(c => ResearchSystem.CanStudy(player, c));
            if (civic != null) commands.Add(new SetCivicCommand { Player = playerId, Civic = civic.Index });
        }

        int military = s.Units.Count(u => u.Owner == playerId && SupplySystem.IsMilitary(db, u));
        int cityCount = s.CitiesOf(playerId).Count();
        bool atWar = MilitaryAi.MajorEnemies(s, playerId).Count > 0;
        bool wantSettler = ExpansionAi.WantsSettler(s, player);
        bool wantBuilder = BuilderAi.WantsBuilder(s, player);
        foreach (var city in s.CitiesOf(playerId))
        {
            if (city.Queue.Items.Count > 0) continue;
            var choice = PickProduction(s, player, city, atWar, military, cityCount, ref wantSettler, ref wantBuilder);
            if (choice is (var kind, var def, var tile))
            {
                commands.Add(new EnqueueCommand { Player = playerId, CityId = city.Id, Kind = kind, DefIndex = def, Tile = tile });
                if (kind == ProductionKind.Unit && db.Units[def].Strength > 0) military++;
            }
        }

        commands.AddRange(Governors(s, player));
        commands.AddRange(NationAi.Commands(s, player));
        commands.AddRange(SocietyAi.Commands(s, player));

        // Upgrades with the preset (standard) variant, keeping 100 gold in reserve.
        foreach (var unit in s.Units.Where(u => u.Owner == playerId && SupplySystem.IsMilitary(db, u)))
            foreach (int target in UpgradeSystem.Targets(s, unit))
            {
                int variant = UnitStats.DefaultVariant(db, target);
                if (UpgradeSystem.Validate(s, unit, target, variant) != null || player.Gold < UpgradeSystem.GoldCost(s, unit, target, variant) + 100) continue;
                commands.Add(new UpgradeUnitCommand { Player = playerId, UnitId = unit.Id, Target = target, Variant = variant });
                break;
            }

        // War and peace (AI v2): fight the wars we are in, maybe start one, and make peace on sensible terms.
        commands.AddRange(MilitaryAi.Fight(s, player));
        if (MilitaryAi.WarDeclaration(s, player) is { } war) commands.Add(war);
        commands.AddRange(MilitaryAi.Diplomacy(s, player));

        commands.Add(new EndTurnCommand { Player = playerId });
        return commands;
    }

    /// <summary>
    /// Production priorities: the Divergence's own projects; an army when at war (two units per city); one settler at a time
    /// while sites remain; one builder while tiles need improving; a peacetime garrison (one unit per city, plus two);
    /// the best-scoring specialty district; otherwise another unit.
    /// </summary>
    private static (ProductionKind Kind, int Def, int Tile)? PickProduction(GameState s, PlayerState player, CityState city, bool atWar,
        int military, int cityCount, ref bool wantSettler, ref bool wantBuilder)
    {
        var db = s.Db;
        if (PickDivergenceProduction(s, player, city) is { } divergenceItem) return (divergenceItem.Kind, divergenceItem.Def, -1);
        var soldier = MilitaryAi.BestLandUnit(s, city);
        if (atWar && soldier != null && military < 2 * cityCount + 2 && player.Gold > -50) return (ProductionKind.Unit, soldier.Index, -1);
        if (wantSettler && db.Units.FirstOrDefault(u => NationSystem.IsColonist(s, player, u) && ProductionSystem.CanEnqueue(s, city, ProductionKind.Unit, u.Index, -1) == null) is { } settler)
        {
            wantSettler = false;
            return (ProductionKind.Unit, settler.Index, -1);
        }
        if (wantBuilder && db.Units.FirstOrDefault(u => u.Charges > 0 && u.Domain == UnitDomain.Civilian &&
                                                         ProductionSystem.CanEnqueue(s, city, ProductionKind.Unit, u.Index, -1) == null) is { } builder)
        {
            wantBuilder = false;
            return (ProductionKind.Unit, builder.Index, -1);
        }
        // A horde keeps a standing army even in peace: its research comes from the battlefield.
        int peaceArmy = NationSystem.Kind(s, player) == SignatureKind.Horde ? 2 * cityCount + 3 : cityCount + 2;
        if (soldier != null && military < peaceArmy) return (ProductionKind.Unit, soldier.Index, -1);
        if (SocietyAi.WantsMissionary(s, player, city) is { } missionary) return (ProductionKind.Unit, missionary.Index, -1);
        if (SocietyAi.WantsTrader(s, player, city) is { } trader) return (ProductionKind.Unit, trader.Index, -1);
        if (SocietyAi.WantsSpace(s, player, city) is var (spaceKind, spaceDef, spaceTile)) return (spaceKind, spaceDef, spaceTile);
        if (SocietyAi.WantsWonder(s, player, city) is var (wonder, wonderTile)) return (ProductionKind.District, wonder, wonderTile);
        // Prefer the best-scoring specialty district (same scorer the player's lens uses).
        var districtChoice = db.Districts
            .Where(d => d.Category == DistrictCategory.Specialty)
            .Select(d => (Def: d, Best: DistrictPlanner.Rank(s, city, d.Index, DistrictPlanner.BalancedWeights, 1).FirstOrDefault()))
            .Where(x => x.Best != null)
            .OrderByDescending(x => x.Best!.Score).ThenBy(x => x.Def.Index)
            .FirstOrDefault();
        if (districtChoice.Best != null) return (ProductionKind.District, districtChoice.Def.Index, districtChoice.Best.Tile);
        // Then the cheapest building the city can raise; only then more soldiers, and never into bankruptcy.
        var building = db.Buildings.Where(b => ProductionSystem.CanEnqueue(s, city, ProductionKind.Building, b.Index, -1) == null)
                                   .OrderBy(b => b.Cost).ThenBy(b => b.Index).FirstOrDefault();
        if (building != null) return (ProductionKind.Building, building.Index, -1);
        return soldier != null && military < 3 * cityCount + 3 && player.Gold > Fx.Zero ? (ProductionKind.Unit, soldier.Index, -1) : null;
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
