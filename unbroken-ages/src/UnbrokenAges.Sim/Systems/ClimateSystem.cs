using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// Climate model (simple, legible, tunable from data):
///   ppm  += emissions × ppmPerEmission − forest sink         (never below pre-industrial)
///   Teq   = sensitivity × log2(ppm / basePpm)                 (°C at equilibrium)
///   T    += (Teq − T) × lag%                                  (thermal inertia: cuts take time)
///   phase = number of thresholds T has crossed                (0..7)
/// Each phase raises seas: lowland band L floods at phase L+1 and is submerged at phase L+2
/// unless the owning city has flood barriers. Disaster frequency scales with phase.
/// Per-player emissions are tracked so diplomacy can assign "climate accountability" grievances.
/// </summary>
public static class ClimateSystem
{
    public static readonly int[] IntensityPercent = { 0, 50, 100, 150, 250 };

    public static void ProcessTurn(GameState s, PowerReport power, List<GameEvent> events)
    {
        var db = s.Db;
        var cfg = db.ClimateConfig;
        var climate = s.Climate;

        // --- Emissions -------------------------------------------------------------------------
        Fx total = power.TotalCo2 + climate.PendingDeforestation;
        climate.PendingDeforestation = Fx.Zero;
        foreach (var player in s.Players)
        {
            power.Co2ByPlayer.TryGetValue(player.Id, out Fx co2);
            foreach (var city in s.CitiesOf(player.Id))
            {
                var fx = CityEffects.Compute(s, city);
                foreach (int b in city.AllBuildings())
                {
                    Fx e = db.Buildings[b].Co2PerTurn;
                    co2 += e + e * fx.EmissionsPercent / 100;
                }
            }
            foreach (var unit in s.Units)
            {
                if (unit.Owner != player.Id || db.Units[unit.DefIndex].Upkeep is not { } upkeep) continue;
                if (player.Stockpile[upkeep.ResourceIndex] >= upkeep.Amount)
                {
                    player.Stockpile[upkeep.ResourceIndex] -= upkeep.Amount;
                    co2 += upkeep.Amount;
                }
            }
            total += co2 - power.Co2ByPlayer.GetValueOrDefault(player.Id);
            player.EmissionsLastTurn = co2;
            player.CumulativeEmissions += co2;
        }
        climate.EmissionsLastTurn = total;
        if (!s.Options.ClimateEnabled) return;

        // --- Carbon cycle --------------------------------------------------------------------------
        Fx sink = Fx.Zero;
        for (int t = 0; t < s.Map.Count; t++)
            if (s.Map.Feature[t] >= 0) sink += db.Features[s.Map.Feature[t]].Co2Absorption;
        climate.Co2Ppm = Fx.Max(cfg.BasePpm, climate.Co2Ppm + total * cfg.PpmPerEmission - sink);
        Fx equilibrium = cfg.Sensitivity * Fx.Log2(climate.Co2Ppm / cfg.BasePpm);
        climate.Temperature += (equilibrium - climate.Temperature) * cfg.LagPercent / 100;

        int phase = cfg.PhaseThresholds.Count(th => climate.Temperature >= th);
        while (climate.Phase < phase)
        {
            climate.Phase++;
            climate.LastPhaseChangeTurn = s.Turn;
            events.Add(new GameEvent(GameEventType.ClimatePhaseChanged, Value: climate.Phase));
            ApplySeaLevel(s, climate.Phase, events);
        }

        RollDisasters(s, events);
    }

    public static void ApplySeaLevel(GameState s, int phase, List<GameEvent> events)
    {
        var map = s.Map;
        for (int t = 0; t < map.Count; t++)
        {
            int band = map.Lowland[t];
            if (band == 0 || map.HasFlag(t, TileFlags.FloodProtected) || map.HasFlag(t, TileFlags.Submerged)) continue;
            bool isCityCenter = map.District[t] == s.Db.Ids.CityCenter;
            if (phase >= band + 2 && !isCityCenter)
            {
                Submerge(s, t);
                events.Add(new GameEvent(GameEventType.TileSubmerged, map.OwnerPlayer[t], map.OwnerCity[t], t));
            }
            else if (phase >= band + 1 && !map.HasFlag(t, TileFlags.Flooded))
            {
                map.SetFlag(t, TileFlags.Flooded, true);
                events.Add(new GameEvent(GameEventType.TileFlooded, map.OwnerPlayer[t], map.OwnerCity[t], t));
            }
        }
    }

    private static void Submerge(GameState s, int t)
    {
        var map = s.Map;
        if (map.District[t] >= 0 && s.GetCity(map.OwnerCity[t]) is { } city)
            city.Districts.RemoveAll(d => d.Tile == t);
        map.District[t] = -1;
        map.Improvement[t] = -1;
        map.Feature[t] = -1;
        map.Resource[t] = -1;
        map.Terrain[t] = (byte)s.Db.Ids.Coast;
        map.Relief[t] = (byte)s.Db.Ids.Flat;
        map.RiverEdges[t] = 0;
        for (int d = 0; d < 6; d++)
        {
            int n = map.Neighbor(t, d);
            if (n >= 0) map.RiverEdges[n] &= (byte)~(1 << HexCoord.Opposite(d));
        }
        map.SetFlag(t, TileFlags.Flooded, false);
        map.SetFlag(t, TileFlags.Submerged, true);
    }

    /// <summary>Flood barriers protect every lowland tile the city owns and drain flooded ones.</summary>
    public static void RefreshFloodProtection(GameState s, CityState city)
    {
        bool protectedCity = city.AllBuildings().Any(b => s.Db.Buildings[b].ProtectsFromFlood);
        for (int t = 0; t < s.Map.Count; t++)
        {
            if (s.Map.OwnerCity[t] != city.Id || s.Map.Lowland[t] == 0) continue;
            s.Map.SetFlag(t, TileFlags.FloodProtected, protectedCity);
            if (protectedCity) s.Map.SetFlag(t, TileFlags.Flooded, false);
        }
    }

    public static int DisasterChancePermille(GameState s, DisasterDef d)
    {
        int chance = d.BaseChancePermille * IntensityPercent[Math.Clamp(s.Options.DisasterIntensity, 0, 4)] / 100;
        chance = chance * (100 + s.Climate.Phase * d.ClimateScalingPercent) / 100;
        if (WorldSystem.CurrentAge(s) is { } age) chance = chance * Math.Max(0, 100 + age.DisasterChancePercent) / 100;
        return chance;
    }

    private static void RollDisasters(GameState s, List<GameEvent> events)
    {
        var map = s.Map;
        var rng = s.DisasterRng;
        foreach (var d in s.Db.Disasters)
        {
            if (!rng.ChancePermille(DisasterChancePermille(s, d))) continue;
            var candidates = new List<int>();
            for (int t = 0; t < map.Count; t++)
            {
                bool ok = d.Kind switch
                {
                    DisasterKind.RiverFlood => map.IsLand(t) && !map.IsMountain(t) && (map.HasRiver(t) || map.IsAdjacentToChannel(t)),
                    DisasterKind.Storm => map.IsLand(t) && map.IsAdjacentToSea(t),
                    DisasterKind.Drought => map.IsLand(t) && !map.IsMountain(t) && !map.HasFreshWaterAccess(t),
                    DisasterKind.Volcano => map.Feature[t] >= 0 && map.Feature[t] == s.Db.Ids.Volcano,
                    _ => false,
                };
                if (ok) candidates.Add(t);
            }
            if (candidates.Count == 0) continue;
            int epicenter = candidates[rng.NextInt(candidates.Count)];
            var area = new List<int>();
            map.CollectRadius(epicenter, d.Radius, area);
            area.Sort();
            int affected = 0;
            foreach (int t in area)
            {
                if (!map.IsLand(t)) continue;
                if (d.Kind == DisasterKind.RiverFlood && !(map.HasRiver(t) || map.IsAdjacentToChannel(t))) continue;
                var city = map.OwnerCity[t] >= 0 ? s.GetCity(map.OwnerCity[t]) : null;
                if (city != null && CityEffects.Compute(s, city).IsImmune(d.Kind)) continue;
                affected++;
                if ((map.Improvement[t] >= 0 || map.District[t] >= 0) && map.District[t] != s.Db.Ids.CityCenter && rng.NextInt(100) < d.PillageChancePercent)
                {
                    map.SetFlag(t, TileFlags.Pillaged, true);
                    if (city?.Districts.Find(x => x.Tile == t) is { } di) di.Pillaged = true;
                }
                if (d.FertilityFood > 0 && map.Fertility[t] < 3) map.Fertility[t] = (byte)Math.Min(3, map.Fertility[t] + d.FertilityFood);
                if (city != null && city.Tile == t)
                {
                    if (city.Population > 1 && rng.NextInt(100) < d.PopulationLossChancePercent) city.Population--;
                    if (d.Kind == DisasterKind.Drought) city.FoodStored /= 2;
                }
            }
            events.Add(new GameEvent(GameEventType.Disaster, map.OwnerPlayer[epicenter], map.OwnerCity[epicenter], epicenter, d.Index, affected, d.Name));
        }
    }
}
