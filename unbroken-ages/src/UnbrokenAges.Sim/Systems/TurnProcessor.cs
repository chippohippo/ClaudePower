using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// End-of-turn resolution, in a fixed order every peer reproduces exactly:
///   1. Power grids dispatch (decides which cities are powered this turn, burns fuel)
///   2. Per player (id order), per city (id order): yields → growth → production queue
///      then treasury, research/civics, strategic stockpiles
///   3. Governor establishment
///   4. Loyalty (from a population snapshot, so city order is irrelevant)
///   5. Climate: emissions → CO2 → temperature → sea level → disasters
///   6. Units refresh and continue multi-turn moves; world ages; victories (Score at the turn limit); turn counter advances
/// </summary>
public static class TurnProcessor
{
    public static List<GameEvent> Advance(GameState s)
    {
        var events = new List<GameEvent>();
        var db = s.Db;

        var power = PowerSystem.Process(s, commit: true, events);

        foreach (var player in s.Players)
        {
            if (!player.IsAlive) continue;
            Fx science = Fx.Zero, culture = Fx.Zero, gold = Fx.Zero, faith = Fx.Zero;
            int maintenance = 0;
            foreach (var city in s.CitiesOf(player.Id).ToList())
            {
                var fx = CityEffects.Compute(s, city);
                var report = CityYields.Compute(s, city, fx);
                // Fabrication: part of the city's industry builds new citizens instead of feeding them (needs power).
                Fx fabricated = fx.FabricationPercent > 0 && city.IsPowered ? report.Total.Production * fx.FabricationPercent / 100 : Fx.Zero;
                Grow(s, city, report, fabricated, events);
                ProductionSystem.Process(s, city, report.Total.Production - fabricated, fx, events);
                BorderSystem.Grow(s, city, report.Total.Culture, events);
                city.YieldsLastTurnProduction = report.Total.Production;
                science += report.Total.Science;
                culture += report.Total.Culture;
                gold += report.Total.Gold;
                faith += report.Total.Faith;
                maintenance += city.AllBuildings().Sum(b => db.Buildings[b].Maintenance);
            }
            maintenance += s.Units.Where(u => u.Owner == player.Id).Sum(u => db.Units[u.DefIndex].Maintenance);
            player.Gold += gold - maintenance;
            player.Faith += faith;
            ResearchSystem.Process(s, player, science, culture, events);
            AccumulateStrategicResources(s, player);
        }

        IndustrySystem.ProcessTurn(s);
        GovernorSystem.ProcessTurn(s, events);
        LoyaltySystem.ProcessTurn(s, events);
        DiplomacySystem.ProcessTurn(s);
        DivergenceSystem.ProcessTurn(s, events);
        ClimateSystem.ProcessTurn(s, power, events);

        CombatSystem.ProcessTurn(s);
        SupplySystem.ProcessTurn(s, events);
        foreach (var unit in s.Units.ToList())
        {
            unit.MovesLeft = db.Units[unit.DefIndex].Moves;
            if (unit.Destination >= 0) Movement.MoveAlong(s, unit);
        }

        WorldSystem.ProcessTurn(s, events);
        VictorySystem.Check(s, events, endOfTurn: true);
        s.Turn++;
        foreach (var p in s.Players) p.HasEndedTurn = false;
        events.Add(new GameEvent(GameEventType.TurnAdvanced, Value: s.Turn));
        return events;
    }

    private static void Grow(GameState s, CityState city, CityYieldReport report, Fx fabricated, List<GameEvent> events)
    {
        Fx surplus = report.FoodSurplus + fabricated;
        if (surplus > Fx.Zero) surplus = surplus * CityYields.HousingGrowthPercent(city.Population, report.Housing) / 100;
        city.FoodStored += surplus;
        if (city.FoodStored < Fx.Zero)
        {
            city.FoodStored = Fx.Zero;
            if (city.Population > 1)
            {
                city.Population--;
                events.Add(new GameEvent(GameEventType.CityStarved, city.Owner, city.Id, city.Tile, Value: city.Population));
            }
            return;
        }
        Fx threshold = CityYields.GrowthThreshold(city.Population);
        if (city.FoodStored >= threshold)
        {
            city.FoodStored -= threshold;
            city.Population++;
            events.Add(new GameEvent(GameEventType.CityGrew, city.Owner, city.Id, city.Tile, Value: city.Population));
        }
    }

    /// <summary>Improved strategic resources add to a capped stockpile each turn (fuel for plants and units).</summary>
    private static void AccumulateStrategicResources(GameState s, PlayerState player)
    {
        var db = s.Db;
        var map = s.Map;
        for (int t = 0; t < map.Count; t++)
        {
            if (map.OwnerPlayer[t] != player.Id || map.Resource[t] < 0 || map.Improvement[t] < 0 || map.HasFlag(t, Map.TileFlags.Pillaged)) continue;
            var res = db.Resources[map.Resource[t]];
            if (res.Class != ResourceClass.Strategic || !player.HasTech(res.RevealTechIndex)) continue;
            int cap = res.StockpileCap > 0 ? res.StockpileCap : 50;
            player.Stockpile[res.Index] = Math.Min(cap, player.Stockpile[res.Index] + 2);
        }
    }
}
