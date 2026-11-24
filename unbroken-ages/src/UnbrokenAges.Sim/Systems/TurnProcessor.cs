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
        SocietySystem.CloseSwapWindow(s);

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
            var tithes = ReligionSystem.FounderIncome(s, player);
            science += tithes.Science; culture += tithes.Culture; gold += tithes.Gold; faith += tithes.Faith;
            NationSystem.AdjustEmpireYields(s, player, ref science, ref culture, ref gold, ref faith);
            player.Gold += gold - maintenance;
            player.Faith += faith;
            if (player.Gold < Fx.Zero) Bankrupt(s, player, events);
            ResearchSystem.Process(s, player, science, culture, events);
            AccumulateStrategicResources(s, player);
        }

        NationSystem.ProcessTurn(s, events);
        ReligionSystem.ProcessTurn(s, events);
        GreatPeopleSystem.ProcessTurn(s, events);
        CityStateSystem.ProcessTurn(s, events);
        TradeSystem.ProcessTurn(s, events);
        EspionageSystem.ProcessTurn(s, events);
        AgeSystem.ProcessTurn(s, events);
        OutpostSystem.ProcessTurn(s, events);
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
            unit.MovesLeft = UnitStats.Moves(s, unit);
            if (unit.Destination >= 0) Movement.MoveAlong(s, unit);
        }
        SocietySystem.ProcessTurn(s);
        BarbarianSystem.ProcessTurn(s, events);

        GovernorSystem.GainExperience(s, events);
        WorldSystem.ProcessTurn(s, events);
        VictorySystem.Check(s, events, endOfTurn: true);
        s.Turn++;
        foreach (var p in s.Players) p.HasEndedTurn = false;
        TurnPhases.Begin(s);
        events.Add(new GameEvent(GameEventType.TurnAdvanced, Value: s.Turn));
        return events;
    }

    private static void Grow(GameState s, CityState city, CityYieldReport report, Fx fabricated, List<GameEvent> events)
    {
        Fx surplus = report.FoodSurplus + fabricated;
        if (surplus > Fx.Zero) surplus = surplus * CityYields.HousingGrowthPercent(city.Population, report.Housing) / 100;
        if (NationSystem.DivertSurplus(s, city, surplus)) surplus = Fx.Zero;   // Egypt: into the Royal Granary
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
        Fx threshold = CityYields.GrowthThreshold(city.Population) * (100 + NationSystem.GrowthThresholdPercent(s, city)) / 100;
        if (city.FoodStored >= threshold)
        {
            city.FoodStored -= threshold;
            city.Population++;
            events.Add(new GameEvent(GameEventType.CityGrew, city.Owner, city.Id, city.Tile, Value: city.Population));
        }
    }

    /// <summary>
    /// An empire that cannot pay its upkeep: the costliest military unit (then the newest) deserts each turn until the
    /// treasury is back above zero. Debt never grows without limit.
    /// </summary>
    private static void Bankrupt(GameState s, PlayerState player, List<GameEvent> events)
    {
        var db = s.Db;
        var deserter = s.Units.Where(u => u.Owner == player.Id && SupplySystem.IsMilitary(db, u) && db.Units[u.DefIndex].Maintenance > 0)
                              .OrderByDescending(u => db.Units[u.DefIndex].Maintenance).ThenByDescending(u => u.Id).FirstOrDefault();
        if (deserter == null) return;
        s.RemoveUnit(deserter);
        events.Add(new GameEvent(GameEventType.UnitDisbanded, player.Id, Tile: deserter.Tile, Def: deserter.DefIndex, Detail: db.Units[deserter.DefIndex].Name));
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
            player.Stockpile[res.Index] = Math.Min(cap, player.Stockpile[res.Index] + 2 + NationSystem.StrategicBonus(s, player));
        }
    }
}
