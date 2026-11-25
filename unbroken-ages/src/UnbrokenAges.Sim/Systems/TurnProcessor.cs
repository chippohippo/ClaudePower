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
    /// <summary>Optional profiling (tools only): milliseconds spent in each part of turn resolution. Null in games.</summary>
    public static Dictionary<string, double>? Profile;

    internal static void Time(string name, Action step)
    {
        if (Profile == null) { step(); return; }
        var clock = System.Diagnostics.Stopwatch.StartNew();
        step();
        Profile[name] = Profile.GetValueOrDefault(name) + clock.Elapsed.TotalMilliseconds;
    }

    internal static T Timed<T>(string name, Func<T> step)
    {
        if (Profile == null) return step();
        var clock = System.Diagnostics.Stopwatch.StartNew();
        var result = step();
        Profile[name] = Profile.GetValueOrDefault(name) + clock.Elapsed.TotalMilliseconds;
        return result;
    }

    public static List<GameEvent> Advance(GameState s)
    {
        var events = new List<GameEvent>();
        var db = s.Db;

        var power = Timed("PowerSystem", () => PowerSystem.Process(s, commit: true, events));
        var cityClock = Profile != null ? System.Diagnostics.Stopwatch.StartNew() : null;
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
            player.LifetimeCulture += culture;
            player.Gold += gold - maintenance;
            player.Faith += faith;
            if (player.Gold < Fx.Zero) Bankrupt(s, player, events);
            ResearchSystem.Process(s, player, science, culture, events);
            AccumulateStrategicResources(s, player);
        }

        Time("NationSystem.ProcessTurn", () => NationSystem.ProcessTurn(s, events));
        Time("ReligionSystem.ProcessTurn", () => ReligionSystem.ProcessTurn(s, events));
        Time("GreatPeopleSystem.ProcessTurn", () => GreatPeopleSystem.ProcessTurn(s, events));
        Time("CityStateSystem.ProcessTurn", () => CityStateSystem.ProcessTurn(s, events));
        Time("TradeSystem.ProcessTurn", () => TradeSystem.ProcessTurn(s, events));
        Time("EspionageSystem.ProcessTurn", () => { VictorySystem.RevealVictoryProjects(s); EspionageSystem.ProcessTurn(s, events); });
        Time("CultureSystem.ProcessTurn", () => CultureSystem.ProcessTurn(s, events));
        Time("CongressSystem.ProcessTurn", () => CongressSystem.ProcessTurn(s, events));
        Time("DealSystem.ProcessTurn", () => DealSystem.ProcessTurn(s, events));
        Time("DilemmaSystem.ProcessTurn", () => DilemmaSystem.ProcessTurn(s, events));
        Time("AffinitySystem.ProcessTurn", () => AffinitySystem.ProcessTurn(s, events));
        Time("SpaceSystem.ProcessTurn", () => SpaceSystem.ProcessTurn(s, events));
        Time("AgeSystem.ProcessTurn", () => AgeSystem.ProcessTurn(s, events));
        Time("OutpostSystem.ProcessTurn", () => OutpostSystem.ProcessTurn(s, events));
        Time("IndustrySystem.ProcessTurn", () => IndustrySystem.ProcessTurn(s));
        Time("GovernorSystem.ProcessTurn", () => GovernorSystem.ProcessTurn(s, events));
        Time("LoyaltySystem.ProcessTurn", () => LoyaltySystem.ProcessTurn(s, events));
        Time("DiplomacySystem.ProcessTurn", () => DiplomacySystem.ProcessTurn(s));
        Time("DivergenceSystem.ProcessTurn", () => DivergenceSystem.ProcessTurn(s, events));
        Time("ClimateSystem.ProcessTurn", () => ClimateSystem.ProcessTurn(s, power, events));

        Time("CombatSystem.ProcessTurn", () => CombatSystem.ProcessTurn(s));
        Time("AirSystem.ProcessTurn", () => AirSystem.ProcessTurn(s, events));
        Time("SupplySystem.ProcessTurn", () => SupplySystem.ProcessTurn(s, events));
        Time("Unit moves", () =>
        {
            foreach (var unit in s.Units.ToList())
            {
                unit.MovesLeft = UnitStats.Moves(s, unit);
                if (unit.Destination >= 0) Movement.MoveAlong(s, unit);
            }
        });
        Time("SocietySystem.ProcessTurn", () => SocietySystem.ProcessTurn(s));
        Time("BarbarianSystem.ProcessTurn", () => BarbarianSystem.ProcessTurn(s, events));

        Time("GovernorSystem.GainExperience", () => GovernorSystem.GainExperience(s, events));
        Time("WorldSystem.ProcessTurn", () => WorldSystem.ProcessTurn(s, events));
        Time("VictorySystem.Check", () => VictorySystem.Check(s, events, endOfTurn: true));
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
