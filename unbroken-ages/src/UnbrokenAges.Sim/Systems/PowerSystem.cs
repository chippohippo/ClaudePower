using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

public sealed class PowerPlant
{
    public int CityId;
    public int HostTile;
    public string Source = "";
    public PowerSourceKind Kind;
    public int Output;
    public int FuelIndex = -1;
    public int FuelPerTurn;
    public Fx Co2PerTurn;
    public int Range;
    public int EmissionsPercent;
    // results
    public int Dispatched;
    public bool Fuelled = true;
}

public sealed class PowerGridReport
{
    public int Owner;
    public List<int> Cities = new();
    public List<PowerPlant> Plants = new();
    public int Demand;
    public int Capacity;
    public int Dispatched;
    public Fx Co2;
    public SortedDictionary<int, int> FuelUsed = new();
    public List<int> UnpoweredCities = new();
}

public sealed class PowerReport
{
    public List<PowerGridReport> Grids = new();
    public SortedDictionary<int, Fx> Co2ByPlayer = new();
    public Fx TotalCo2;
}

/// <summary>
/// Power grids (expanded from the Gathering Storm model):
///  • Plants (buildings or improvements) serve every own city within their range, forming grids
///    (union-find over cities). Cities share one supply pool per grid.
///  • Dispatch is demand-driven in merit order: renewables first, then nuclear, gas, oil, coal
///    (CleanestFirst) or by fuel on hand (CheapestFirst). Plants that aren't needed burn no fuel
///    and emit nothing — so building clean capacity actually cuts emissions.
///  • Supply is allocated to cities by priority (capital, player priority, population); a city is
///    powered when its whole demand is met. Unpowered cities lose PoweredYields bonuses.
/// </summary>
public static class PowerSystem
{
    public static PowerReport Process(GameState s, bool commit, List<GameEvent>? events = null)
    {
        var report = new PowerReport();
        foreach (var player in s.Players)
        {
            if (!player.IsAlive) continue;
            var cities = s.CitiesOf(player.Id).ToList();
            if (cities.Count == 0) continue;
            var plants = CollectPlants(s, player, cities);
            var demand = cities.Select(c => DemandOf(s, c)).ToArray();

            // Union-find over cities connected by plant ranges.
            var parent = Enumerable.Range(0, cities.Count).ToArray();
            int Find(int x) { while (parent[x] != x) x = parent[x] = parent[parent[x]]; return x; }
            void Union(int a, int b) { a = Find(a); b = Find(b); if (a != b) parent[Math.Max(a, b)] = Math.Min(a, b); }
            var plantCity = new int[plants.Count];
            for (int p = 0; p < plants.Count; p++)
            {
                plantCity[p] = cities.FindIndex(c => c.Id == plants[p].CityId);
                for (int c = 0; c < cities.Count; c++)
                    if (s.Map.Distance(plants[p].HostTile, cities[c].Tile) <= plants[p].Range) Union(plantCity[p], c);
            }

            var grids = new SortedDictionary<int, PowerGridReport>();
            for (int c = 0; c < cities.Count; c++)
            {
                int root = Find(c);
                if (!grids.TryGetValue(root, out var g)) grids[root] = g = new PowerGridReport { Owner = player.Id };
                g.Cities.Add(cities[c].Id);
                g.Demand += demand[c];
            }
            for (int p = 0; p < plants.Count; p++)
            {
                var g = grids[Find(plantCity[p])];
                g.Plants.Add(plants[p]);
                g.Capacity += plants[p].Output;
            }

            var stockpile = (int[])player.Stockpile.Clone();
            Fx playerCo2 = Fx.Zero;
            foreach (var g in grids.Values)
            {
                Dispatch(g, player, stockpile);
                playerCo2 += g.Co2;
                AllocateToCities(s, g, cities, demand, commit);
                report.Grids.Add(g);
                if (commit && events != null)
                    foreach (int cid in g.UnpoweredCities)
                        events.Add(new GameEvent(GameEventType.PowerShortage, player.Id, cid, Value: g.Demand - g.Dispatched));
            }
            if (commit) player.Stockpile = stockpile;
            report.Co2ByPlayer[player.Id] = playerCo2;
            report.TotalCo2 += playerCo2;
        }
        return report;
    }

    public static int DemandOf(GameState s, CityState city) =>
        city.AllBuildings().Sum(b => s.Db.Buildings[b].PowerDemand);

    private static List<PowerPlant> CollectPlants(GameState s, PlayerState player, List<CityState> cities)
    {
        var db = s.Db;
        var plants = new List<PowerPlant>();
        foreach (var city in cities)
        {
            var fx = CityEffects.Compute(s, city);
            void Add(PowerPlantSpec spec, string source, int tile)
            {
                plants.Add(new PowerPlant
                {
                    CityId = city.Id, HostTile = tile, Source = source, Kind = spec.Kind,
                    Output = spec.Output + fx.PowerOutput, FuelIndex = spec.FuelIndex, FuelPerTurn = spec.FuelPerTurn,
                    Co2PerTurn = spec.Co2PerTurn, Range = spec.Range + fx.PowerRangeBonus, EmissionsPercent = fx.EmissionsPercent,
                });
            }
            foreach (var d in city.Districts)
            {
                if (d.Pillaged) continue;
                foreach (int b in d.Buildings)
                    if (db.Buildings[b].Power is { } spec) Add(spec, db.Buildings[b].Name, city.Tile);
            }
            for (int t = 0; t < s.Map.Count; t++)
            {
                if (s.Map.OwnerCity[t] != city.Id || s.Map.Improvement[t] < 0 || s.Map.HasFlag(t, Map.TileFlags.Pillaged)) continue;
                if (db.Improvements[s.Map.Improvement[t]].Power is { } spec) Add(spec, db.Improvements[s.Map.Improvement[t]].Name, t);
            }
        }
        return plants;
    }

    private static void Dispatch(PowerGridReport g, PlayerState player, int[] stockpile)
    {
        var order = g.Plants.ToList();
        if (player.DispatchPolicy == PowerDispatchPolicy.CleanestFirst)
            order.Sort((a, b) => a.Kind != b.Kind ? a.Kind.CompareTo(b.Kind) : a.CityId.CompareTo(b.CityId));
        else
            order.Sort((a, b) =>
            {
                int ra = a.FuelIndex < 0 ? int.MaxValue : stockpile[a.FuelIndex];
                int rb = b.FuelIndex < 0 ? int.MaxValue : stockpile[b.FuelIndex];
                return ra != rb ? rb.CompareTo(ra) : a.Kind != b.Kind ? a.Kind.CompareTo(b.Kind) : a.CityId.CompareTo(b.CityId);
            });

        int remaining = g.Demand;
        foreach (var plant in order)
        {
            if (remaining <= 0) break;
            if (plant.FuelIndex >= 0)
            {
                if (stockpile[plant.FuelIndex] < plant.FuelPerTurn) { plant.Fuelled = false; continue; }
                stockpile[plant.FuelIndex] -= plant.FuelPerTurn;
                g.FuelUsed.TryGetValue(plant.FuelIndex, out int used);
                g.FuelUsed[plant.FuelIndex] = used + plant.FuelPerTurn;
            }
            int use = Math.Min(plant.Output, remaining);
            plant.Dispatched = use;
            remaining -= use;
            g.Dispatched += use;
            Fx co2 = plant.Output > 0 ? plant.Co2PerTurn * use / plant.Output : Fx.Zero;
            g.Co2 += co2 + co2 * plant.EmissionsPercent / 100;
        }
    }

    private static void AllocateToCities(GameState s, PowerGridReport g, List<CityState> cities, int[] demand, bool commit)
    {
        var members = g.Cities.Select(id => cities.FindIndex(c => c.Id == id)).ToList();
        members.Sort((a, b) =>
        {
            var ca = cities[a];
            var cb = cities[b];
            if (ca.IsCapital != cb.IsCapital) return ca.IsCapital ? -1 : 1;
            if (ca.PowerPriority != cb.PowerPriority) return cb.PowerPriority.CompareTo(ca.PowerPriority);
            if (ca.Population != cb.Population) return cb.Population.CompareTo(ca.Population);
            return ca.Id.CompareTo(cb.Id);
        });
        int supply = g.Dispatched;
        foreach (int i in members)
        {
            var city = cities[i];
            bool powered;
            if (demand[i] == 0) powered = g.Capacity > 0;
            else if (supply >= demand[i]) { powered = true; supply -= demand[i]; }
            else { powered = false; g.UnpoweredCities.Add(city.Id); }
            if (commit)
            {
                city.IsPowered = powered;
                city.PowerDemand = demand[i];
            }
        }
    }
}
