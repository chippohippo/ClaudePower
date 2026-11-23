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
        }

        if (player.CurrentTech < 0 && PickTech(db, player) is { } tech)
            commands.Add(new SetResearchCommand { Player = playerId, Tech = tech.Index });
        if (player.CurrentCivic < 0)
        {
            var civic = db.Civics.FirstOrDefault(c => ResearchSystem.CanStudy(player, c));
            if (civic != null) commands.Add(new SetCivicCommand { Player = playerId, Civic = civic.Index });
        }

        foreach (var city in s.CitiesOf(playerId))
        {
            if (city.Queue.Items.Count > 0) continue;
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
                                                       ProductionSystem.Validate(s, city, ProductionKind.Unit, u.Index, -1) == null);
            if (unitDef != null)
                commands.Add(new EnqueueCommand { Player = playerId, CityId = city.Id, Kind = ProductionKind.Unit, DefIndex = unitDef.Index });
        }

        commands.Add(new EndTurnCommand { Player = playerId });
        return commands;
    }

    /// <summary>Beeline toward the cheapest tech that unlocks a specialty district; otherwise cheapest available.</summary>
    private static TechDef? PickTech(GameDatabase db, PlayerState player)
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
        var available = db.Techs.Where(t => ResearchSystem.CanResearch(player, t)).ToList();
        return available.Where(t => wanted.Contains(t.Index)).OrderBy(t => t.Cost).ThenBy(t => t.Index).FirstOrDefault()
               ?? available.OrderBy(t => t.Cost).ThenBy(t => t.Index).FirstOrDefault();
    }
}
