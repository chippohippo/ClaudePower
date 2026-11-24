using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>City lifecycle: founding, tile claims, districts, ownership changes.</summary>
public static class CitySystem
{
    public static CityState Found(GameState s, int playerId, int tile, string? name = null)
    {
        var db = s.Db;
        var map = s.Map;
        var player = s.Players[playerId];
        var city = new CityState
        {
            Id = s.AllocateId(),
            Owner = playerId,
            OriginalOwner = playerId,
            Tile = tile,
            Name = name ?? NextCityName(s, player),
            FoundedTurn = s.Turn,
            IsCapital = player.CapitalCityId < 0,
            WasOriginalCapital = !s.Cities.Any(c => c.OriginalOwner == playerId),
        };
        if (city.IsCapital) player.CapitalCityId = city.Id;

        if (map.Feature[tile] >= 0 && db.Features[map.Feature[tile]].Removable && map.Feature[tile] != db.Ids.Floodplains)
            map.Feature[tile] = -1;
        map.Improvement[tile] = -1;
        map.District[tile] = (short)db.Ids.CityCenter;
        city.Districts.Add(new DistrictInstance { DefIndex = db.Ids.CityCenter, Tile = tile });

        s.AddCity(city);
        ClaimTile(s, city, tile);
        for (int d = 0; d < 6; d++)
        {
            int n = map.Neighbor(tile, d);
            if (n >= 0 && map.OwnerPlayer[n] < 0) ClaimTile(s, city, n);
        }
        NationSystem.OnCityFounded(s, city);
        return city;
    }

    public static void ClaimTile(GameState s, CityState city, int tile)
    {
        s.Map.OwnerPlayer[tile] = city.Owner;
        s.Map.OwnerCity[tile] = city.Id;
    }

    public static void AddDistrict(GameState s, CityState city, int districtIndex, int tile)
    {
        var db = s.Db;
        var map = s.Map;
        if (map.OwnerCity[tile] < 0) ClaimTile(s, city, tile);
        if (map.Feature[tile] >= 0 && db.Features[map.Feature[tile]].Removable)
        {
            s.Climate.PendingDeforestation += db.Features[map.Feature[tile]].Co2OnRemoval;
            map.Feature[tile] = -1;
        }
        map.Improvement[tile] = -1;
        if (map.Resource[tile] >= 0 && db.Resources[map.Resource[tile]].Class == ResourceClass.Bonus) map.Resource[tile] = -1;
        map.District[tile] = (short)districtIndex;
        if (map.Reservation[tile] == city.Id) map.Reservation[tile] = -1;
        city.Districts.Add(new DistrictInstance { DefIndex = districtIndex, Tile = tile });
    }

    /// <summary>Loyalty flip, capture, liberation or trade. Clears the queue and unassigns the governor.</summary>
    public static void ChangeOwner(GameState s, CityState city, int newOwner, List<GameEvent> events, GameEventType reason)
    {
        int oldOwner = city.Owner;
        var oldPlayer = s.Players[oldOwner];
        for (int i = city.Queue.Items.Count - 1; i >= 0; i--) ProductionSystem.Remove(s, city, i);
        city.ProgressLedger.Clear();
        GovernorSystem.Unassign(s, city);
        if (oldPlayer.CapitalCityId == city.Id)
        {
            oldPlayer.CapitalCityId = -1;
            city.IsCapital = false;
        }
        city.Owner = newOwner;
        city.TurnsSinceOwnerChange = 0;
        for (int t = 0; t < s.Map.Count; t++)
            if (s.Map.OwnerCity[t] == city.Id) s.Map.OwnerPlayer[t] = newOwner;
        events.Add(new GameEvent(reason, newOwner, city.Id, city.Tile, Value: oldOwner, Detail: city.Name));
        NationSystem.OnCityLost(s, oldOwner, city, events);
    }

    public static string NextCityName(GameState s, PlayerState player)
    {
        if (player.CivIndex >= 0)
        {
            foreach (var n in s.Db.Civilizations[player.CivIndex].CityNames)
                if (!s.Cities.Any(c => c.Name == n)) return n;
        }
        return $"{player.Name} City {s.CitiesOf(player.Id).Count() + 1}";
    }
}
