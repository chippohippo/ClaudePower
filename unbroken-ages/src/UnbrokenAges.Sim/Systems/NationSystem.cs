using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// Nation signatures: each major nation plays one rule of the game differently, and its leader bends that rule further
/// (<see cref="SignatureDef"/> params, overridden by the leader's <see cref="AugmentDef"/>). Design: docs/05-key-systems/14-nations.md.
/// <list type="bullet">
/// <item><b>Inundation</b> (Egypt): surplus food goes to a royal granary with interest; every N turns the flood pours it into the
///   cities as food and production.</item>
/// <item><b>Ledger</b> (Venice): no Settlers; Free Cities and disloyal foreign cities can be bought; gold from neighbours.</item>
/// <item><b>Mandate</b> (Song): loyal, peaceful cities fill a Mandate meter; at 100 a Golden Dynasty boosts every city; losing a
///   city ends it in turmoil.</item>
/// <item><b>Horde</b> (Mongolia): weak research at home; kills and captured cities pay science, culture and stolen techs.</item>
/// <item><b>SkyRoads</b> (Inca): mountains walkable and farmed in terraces.</item>
/// <item><b>GoldenRoad</b> (Mali): less production, more gold from desert and mines, cheap purchases, interest on the treasury.</item>
/// </list>
/// Everything here is deterministic and reads only the game state, so every peer reaches the same result.
/// </summary>
public static class NationSystem
{
    // ----- Signature and parameters ------------------------------------------------------------------

    public static SignatureDef? Signature(GameState s, PlayerState p) =>
        p.CivIndex >= 0 && p.CivIndex < s.Db.Civilizations.Count ? s.Db.Civilizations[p.CivIndex].Signature : null;

    public static SignatureKind Kind(GameState s, PlayerState p) => Signature(s, p)?.Kind ?? SignatureKind.None;

    public static bool Is(GameState s, int player, SignatureKind kind) =>
        player >= 0 && player < s.Players.Count && Kind(s, s.Players[player]) == kind;

    /// <summary>A signature parameter: the leader's augment wins, then the nation's value, then the fallback.</summary>
    public static int Param(GameState s, PlayerState p, string key, int fallback = 0)
    {
        if (p.LeaderIndex >= 0 && s.Db.Leaders[p.LeaderIndex].Augment.Params.TryGetValue(key, out int v)) return v;
        return Signature(s, p)?.Params.TryGetValue(key, out int c) == true ? c : fallback;
    }

    // ----- City effects (folded into CityEffects.Compute) --------------------------------------------

    public static IEnumerable<(string Source, ModifierDef Modifier)> CityModifiers(GameState s, CityState city)
    {
        var p = s.Players[city.Owner];
        var sig = Signature(s, p);
        if (sig == null) yield break;
        var map = s.Map;
        ModifierDef Percent(YieldType y, int amount) => new() { Effect = ModifierEffect.CityYieldPercent, Yield = y, Amount = amount };
        ModifierDef Flat(YieldType y, int amount) => new() { Effect = ModifierEffect.CityYieldFlat, Yield = y, Amount = amount };
        switch (sig.Kind)
        {
            case SignatureKind.Mandate when p.SignatureTimer > 0:
            {
                string src = $"{sig.Name}: Golden Dynasty";
                int boost = Param(s, p, "dynastyPercent", 25);
                yield return (src, Percent(YieldType.Science, boost));
                yield return (src, Percent(YieldType.Production, boost));
                yield return (src, Percent(YieldType.Culture, Param(s, p, "culturePercent", 25)));
                break;
            }
            case SignatureKind.Horde:
                yield return (sig.Name, Percent(YieldType.Science, -Param(s, p, "sciencePenalty", 40)));
                yield return (sig.Name, Percent(YieldType.Culture, -Param(s, p, "culturePenalty", 25)));
                break;
            case SignatureKind.GoldenRoad:
                yield return (sig.Name, Percent(YieldType.Production, -Param(s, p, "productionPenalty", 30)));
                yield return (sig.Name, new ModifierDef { Effect = ModifierEffect.CityPurchaseDiscountPercent, Amount = Param(s, p, "purchaseDiscount", 35) });
                break;
            case SignatureKind.Ledger:
            {
                int range = Param(s, p, "range", 8);
                int neighbours = s.Cities.Count(c => c.Owner != city.Owner && map.Distance(c.Tile, city.Tile) <= range);
                int gold = neighbours * Param(s, p, "goldPerNeighbor", 1);
                if (gold > 0) yield return ($"{sig.Name}: trade with {neighbours} foreign cities", Flat(YieldType.Gold, gold));
                break;
            }
            case SignatureKind.SkyRoads:
            {
                bool highCentre = false;
                for (int d = 0; d < 6; d++)
                    if (map.Neighbor(city.Tile, d) is var n && n >= 0 && (map.IsMountain(n) || map.Relief[n] == s.Db.Ids.Hills)) highCentre = true;
                int centre = Param(s, p, "highlandCentreProduction", 0);
                if (highCentre && centre > 0) yield return ($"{s.Db.Civilizations[p.CivIndex].Ability.Name}", Flat(YieldType.Production, centre));
                int housing = Param(s, p, "highlandHousing", 0);
                if (housing > 0)
                {
                    var tiles = new List<int>();
                    map.CollectRadius(city.Tile, 3, tiles);
                    if (tiles.Count(map.IsMountain) >= 2)
                    {
                        string src = p.LeaderIndex >= 0 ? s.Db.Leaders[p.LeaderIndex].Augment.Name : sig.Name;
                        yield return (src, new ModifierDef { Effect = ModifierEffect.CityHousing, Amount = housing });
                        yield return (src, new ModifierDef { Effect = ModifierEffect.CityAmenities, Amount = 1 });
                    }
                }
                break;
            }
        }
    }

    // ----- Tiles (CityYields) --------------------------------------------------------------------------

    /// <summary>Inca citizens work mountains (terraces); everyone else leaves them empty.</summary>
    public static bool WorksMountains(GameState s, int player) => Is(s, player, SignatureKind.SkyRoads);

    /// <summary>What a nation adds to a worked tile: Inca terraces, Malian gold.</summary>
    public static YieldSet TileBonus(GameState s, int player, int tile)
    {
        var y = new YieldSet();
        if (player < 0) return y;
        var p = s.Players[player];
        var map = s.Map;
        switch (Kind(s, p))
        {
            case SignatureKind.SkyRoads:
                if (map.IsMountain(tile))
                {
                    y.Food += Param(s, p, "mountainFood", 2);
                    y.Production += Param(s, p, "mountainProduction", 1);
                    y.Science += Param(s, p, "mountainScience", 0);
                }
                else if (map.Relief[tile] == s.Db.Ids.Hills) y.Food += Param(s, p, "hillFood", 1);
                break;
            case SignatureKind.GoldenRoad:
                if (s.Db.Terrains[map.Terrain[tile]].Id == "TERRAIN_DESERT") y.Gold += Param(s, p, "desertGold", 1);
                if (map.Improvement[tile] >= 0 && s.Db.Improvements[map.Improvement[tile]].Id == "IMPROVEMENT_MINE" && !map.HasFlag(tile, TileFlags.Pillaged))
                    y.Gold += Param(s, p, "mineGold", 2);
                break;
        }
        return y;
    }

    // ----- Units ---------------------------------------------------------------------------------------

    /// <summary>Movement cost into a mountain for this unit, or −1 if it cannot climb (everyone but the Inca).</summary>
    public static int MountainCost(GameState s, UnitState u) =>
        Is(s, u.Owner, SignatureKind.SkyRoads) && s.Db.Units[u.DefIndex].Domain != UnitDomain.Naval ? Math.Max(1, Param(s, s.Players[u.Owner], "mountainMoveCost", 2)) : -1;

    public static bool IsMounted(UnitDef d) => d.UnitClass is "LightCavalry" or "HeavyCavalry" && !d.Tags.Contains("Armor");

    /// <summary>Extra movement: Mongol riders.</summary>
    public static int MovesBonus(GameState s, UnitState u) =>
        Is(s, u.Owner, SignatureKind.Horde) && IsMounted(s.Db.Units[u.DefIndex]) ? Param(s, s.Players[u.Owner], "mountedMoves", 1) : 0;

    /// <summary>Why a nation may not train a unit at all (Venice founds no colonies), or null.</summary>
    public static string? ForbidUnit(GameState s, PlayerState p, UnitDef u) =>
        u.FoundsCity && Kind(s, p) == SignatureKind.Ledger
            ? $"{Signature(s, p)!.Name}: Venice does not send out colonists — buy cities instead."
            : null;

    /// <summary>Extra purchase discount for a category (Sundiata's units).</summary>
    public static int PurchaseDiscount(GameState s, PlayerState p, ProductionKind kind) =>
        Kind(s, p) == SignatureKind.GoldenRoad && kind == ProductionKind.Unit ? Param(s, p, "unitDiscount", 0) : 0;

    /// <summary>After a purchase: Mansa Musa's pilgrimage turns spending into science and faith.</summary>
    public static void OnPurchase(GameState s, PlayerState p, Fx price)
    {
        if (Kind(s, p) != SignatureKind.GoldenRoad) return;
        p.TechProgress += price * Param(s, p, "purchaseSciencePercent", 0) / 100;
        p.Faith += price * Param(s, p, "purchaseFaithPercent", 0) / 100;
        p.SignatureTally++;
    }

    // ----- Growth (TurnProcessor) ----------------------------------------------------------------------

    /// <summary>Egypt: a city's food surplus goes to the Royal Granary (with interest) instead of growing the city.</summary>
    public static bool DivertSurplus(GameState s, CityState city, Fx surplus)
    {
        var p = s.Players[city.Owner];
        if (Kind(s, p) != SignatureKind.Inundation || surplus <= Fx.Zero) return false;
        p.SignatureMeter += surplus * (100 + Param(s, p, "interestPercent", 20)) / 100;
        return true;
    }

    public static int TurnsToFlood(GameState s, PlayerState p)
    {
        int interval = Math.Max(2, Param(s, p, "interval", 8));
        return interval - 1 - s.Turn % interval;
    }

    // ----- Combat (CombatSystem) -----------------------------------------------------------------------

    /// <summary>A unit was destroyed in battle by <paramref name="killerOwner"/>'s <paramref name="killer"/> (null: a city's guns).</summary>
    public static void OnUnitDestroyed(GameState s, int killerOwner, UnitState? killer, UnitState victim, List<GameEvent> events)
    {
        if (!Is(s, killerOwner, SignatureKind.Horde)) return;
        var p = s.Players[killerOwner];
        int strength = Math.Max(UnitStats.Strength(s, victim), UnitStats.RangedStrength(s, victim));
        if (strength <= 0) return;
        Fx science = Fx.FromInt(strength) * Param(s, p, "sciencePerStrength", 200) / 100;
        Fx culture = Fx.FromInt(strength) * Param(s, p, "culturePerStrength", 100) / 100;
        Fx gold = Fx.FromInt(strength) * Param(s, p, "goldPerStrength", 0) / 100;
        p.TechProgress += science;
        p.CivicProgress += culture;
        p.Gold += gold;
        p.SignatureTally++;
        if (killer != null && IsMounted(s.Db.Units[killer.DefIndex]))
            killer.Hp = Math.Min(100, killer.Hp + Param(s, p, "healOnKill", 15));
        events.Add(new GameEvent(GameEventType.Plundered, killerOwner, Tile: victim.Tile, Def: victim.DefIndex, Value: science.FloorToInt(),
            Detail: $"+{science.FloorToInt()} Science, +{culture.FloorToInt()} Culture" + (gold > Fx.Zero ? $", +{gold.FloorToInt()} Gold" : "")));
    }

    /// <summary>A city was taken by force (after the default capture rules ran).</summary>
    public static void OnCityCaptured(GameState s, int captor, CityState city, int victim, int populationBefore, List<GameEvent> events)
    {
        if (!Is(s, captor, SignatureKind.Horde)) return;
        var p = s.Players[captor];
        var db = s.Db;
        Fx science = Fx.FromInt(populationBefore * Param(s, p, "citySciencePerPop", 40));
        p.TechProgress += science;
        p.SignatureTally++;
        if (Param(s, p, "keepPopulation", 0) > 0) city.Population = populationBefore;
        city.Loyalty = Fx.FromInt(Param(s, p, "capturedLoyalty", 50));
        string detail = $"+{science.FloorToInt()} Science from {city.Name}";
        if (Param(s, p, "stealTech", 1) > 0 && victim >= 0 && victim < s.Players.Count)
        {
            var from = s.Players[victim];
            var stolen = db.Techs.Where(t => from.HasTech(t.Index) && !p.Techs[t.Index] && ResearchSystem.CanResearch(p, t))
                                 .OrderBy(t => t.Cost).ThenBy(t => t.Index).FirstOrDefault();
            if (stolen != null)
            {
                p.Techs[stolen.Index] = true;
                if (p.CurrentTech == stolen.Index) p.CurrentTech = -1;
                events.Add(new GameEvent(GameEventType.TechResearched, captor, Def: stolen.Index, Detail: stolen.Name));
                detail += $"; the scholars of {city.Name} teach {stolen.Name}";
            }
        }
        events.Add(new GameEvent(GameEventType.Plundered, captor, city.Id, city.Tile, Value: science.FloorToInt(), Detail: detail));
    }

    /// <summary>Any change of a city's owner (capture, revolt, purchase): a Song dynasty falls if it loses a city.</summary>
    public static void OnCityLost(GameState s, int oldOwner, CityState city, List<GameEvent> events)
    {
        if (oldOwner < 0 || oldOwner >= s.Players.Count) return;
        var p = s.Players[oldOwner];
        if (Kind(s, p) != SignatureKind.Mandate) return;
        p.SignatureMeter = Fx.Max(Fx.Zero, p.SignatureMeter - 30);
        if (p.SignatureTimer <= 0) return;
        p.SignatureTimer = 0;
        int loss = Param(s, p, "collapseLoyalty", 20);
        foreach (var c in s.CitiesOf(oldOwner)) c.Loyalty = Fx.Max(Fx.Zero, c.Loyalty - loss);
        events.Add(new GameEvent(GameEventType.DynastyFell, oldOwner, city.Id, city.Tile, Value: loss, Detail: city.Name));
    }

    // ----- Venice: buying cities -----------------------------------------------------------------------

    public static Fx CityPrice(GameState s, PlayerState buyer, CityState city)
    {
        int price = Param(s, buyer, "costBase", 120) + Param(s, buyer, "costPerPop", 70) * city.Population + 25 * city.AllBuildings().Count();
        int discount = Param(s, buyer, "discountPercent", 0);
        if (s.Map.IsAdjacentToSea(city.Tile)) discount += Param(s, buyer, "coastalDiscount", 0);
        price = price * (100 - Math.Clamp(discount, 0, 80)) / 100;
        return Fx.FromInt(price * s.Options.GameSpeedPercent / 100);
    }

    /// <summary>Why <paramref name="buyer"/> may not buy <paramref name="city"/> now, or null.</summary>
    public static string? CanBuy(GameState s, PlayerState buyer, CityState city)
    {
        if (Kind(s, buyer) != SignatureKind.Ledger) return "Only a merchant republic can buy cities.";
        if (city.Owner == buyer.Id) return "Already yours.";
        var owner = s.Players[city.Owner];
        if (city.IsCapital) return "Capitals are not for sale.";
        int range = Param(s, buyer, "range", 8);
        if (!s.CitiesOf(buyer.Id).Any(c => s.Map.Distance(c.Tile, city.Tile) <= range)) return $"Too far: must be within {range} tiles of one of your cities.";
        if (!owner.IsFreeCities)
        {
            bool war = DiplomacySystem.AtWar(s, buyer.Id, owner.Id);
            if (war && Param(s, buyer, "warPurchase", 0) == 0) return "You are at war with its owner.";
            int threshold = war ? Param(s, buyer, "warLoyaltyThreshold", 60) : Param(s, buyer, "loyaltyThreshold", 60);
            if (city.Loyalty >= threshold) return $"Its people are too loyal (loyalty {city.Loyalty.FloorToInt()}, must be below {threshold}).";
        }
        if (buyer.Gold < CityPrice(s, buyer, city)) return $"Not enough gold ({CityPrice(s, buyer, city).FloorToInt()} needed).";
        return null;
    }

    public static void Buy(GameState s, PlayerState buyer, CityState city, List<GameEvent> events)
    {
        var price = CityPrice(s, buyer, city);
        int seller = city.Owner;
        buyer.Gold -= price;
        if (!s.Players[seller].IsFreeCities) s.Players[seller].Gold += price / 2;   // the city's notables are paid off; half reaches the old crown
        foreach (var u in s.Units.Where(u => u.Tile == city.Tile && u.Owner == seller).ToList()) s.RemoveUnit(u);
        CitySystem.ChangeOwner(s, city, buyer.Id, events, GameEventType.CityPurchased);
        city.Loyalty = Fx.FromInt(Param(s, buyer, "boughtLoyalty", 75));
        city.Population += Param(s, buyer, "boughtPop", 0);
        buyer.SignatureTally++;
        if (!s.Players[seller].IsFreeCities) DiplomacySystem.AddGrievance(s, seller, buyer.Id, 10, $"Bought {city.Name}");
    }

    // ----- Turn ----------------------------------------------------------------------------------------

    public static void ProcessTurn(GameState s, List<GameEvent> events)
    {
        foreach (var p in s.Players)
        {
            if (!p.IsAlive || p.IsFreeCities) continue;
            switch (Kind(s, p))
            {
                case SignatureKind.Inundation: Inundation(s, p, events); break;
                case SignatureKind.Mandate: Mandate(s, p, events); break;
                case SignatureKind.GoldenRoad:
                {
                    if (p.Gold <= Fx.Zero) break;
                    Fx interest = Fx.Min(p.Gold * Param(s, p, "interestPercent", 2) / 100, Fx.FromInt(Param(s, p, "interestCap", 25)));
                    p.Gold += interest;
                    break;
                }
                case SignatureKind.Horde: Terror(s, p); break;
            }
        }
    }

    /// <summary>Egypt: on flood turns the Royal Granary pours into the cities, weighted toward river and floodplain land.</summary>
    private static void Inundation(GameState s, PlayerState p, List<GameEvent> events)
    {
        if (TurnsToFlood(s, p) != 0) return;
        var cities = s.CitiesOf(p.Id).OrderBy(c => c.Id).ToList();
        Fx granary = p.SignatureMeter;
        if (cities.Count == 0 || granary <= Fx.Zero) return;
        var map = s.Map;
        var weights = cities.Select(c =>
        {
            var tiles = new List<int>();
            map.CollectRadius(c.Tile, 2, tiles);
            int river = tiles.Count(t => map.OwnerCity[t] == c.Id && (map.RiverEdges[t] != 0 || map.IsAdjacentToChannel(t) ||
                                                                       (map.Feature[t] >= 0 && s.Db.Features[map.Feature[t]].Id == "FEATURE_FLOODPLAINS")));
            return 2 + river;
        }).ToList();
        int total = weights.Sum();
        int productionPercent = Param(s, p, "productionPercent", 40);
        for (int i = 0; i < cities.Count; i++)
        {
            var c = cities[i];
            Fx share = granary * weights[i] / total;
            c.FoodStored += share;
            // Grow as many times as the flood allows (a great flood lifts a city several sizes at once).
            for (int guard = 0; guard < 6 && c.FoodStored >= CityYields.GrowthThreshold(c.Population); guard++)
            {
                c.FoodStored -= CityYields.GrowthThreshold(c.Population);
                c.Population++;
                events.Add(new GameEvent(GameEventType.CityGrew, c.Owner, c.Id, c.Tile, Value: c.Population));
            }
            c.OverflowProduction += share * productionPercent / 100;
        }
        p.Gold += granary * Param(s, p, "goldPercent", 0) / 100;
        p.SignatureMeter = Fx.Zero;
        p.SignatureTally++;
        if (Param(s, p, "freeUnit", 0) > 0 && s.GetCity(p.CapitalCityId) is { } capital)
        {
            var best = s.Db.Units.Where(u => u.Domain == UnitDomain.Land && u.UnitClass == "Melee" && ProductionSystem.Validate(s, capital, ProductionKind.Unit, u.Index, -1) == null)
                                 .OrderByDescending(u => u.Strength).ThenBy(u => u.Index).FirstOrDefault();
            if (best != null)
                s.AddUnit(new UnitState { Id = s.AllocateId(), Owner = p.Id, DefIndex = best.Index, Tile = capital.Tile, MovesLeft = Fx.FromInt(best.Moves), Variant = UnitStats.DefaultVariant(s.Db, best.Index) });
        }
        events.Add(new GameEvent(GameEventType.Inundation, p.Id, Value: granary.FloorToInt(), Detail: $"{granary.FloorToInt()} food flooded into {cities.Count} cities"));
    }

    /// <summary>Song: the Mandate meter and Golden Dynasties.</summary>
    private static void Mandate(GameState s, PlayerState p, List<GameEvent> events)
    {
        if (p.SignatureTimer > 0)
        {
            p.SignatureTimer--;
            if (p.SignatureTimer == 0) events.Add(new GameEvent(GameEventType.DynastyEnded, p.Id));
            return;
        }
        int loyal = Param(s, p, "loyalThreshold", 75);
        Fx change = Fx.Zero;
        foreach (var c in s.CitiesOf(p.Id))
        {
            if (c.Loyalty >= loyal) change += Param(s, p, "gainPerLoyalCity", 3);
            else if (c.Loyalty < 50) change -= Param(s, p, "lossPerUnrestCity", 6);
        }
        if (s.Players.Any(o => o.Id != p.Id && o.IsAlive && !o.IsFreeCities && DiplomacySystem.AtWar(s, p.Id, o.Id)))
            change -= Param(s, p, "warDrain", 4);
        p.SignatureMeter = Fx.Clamp(p.SignatureMeter + change, Fx.Zero, Fx.FromInt(100));
        if (p.SignatureMeter >= 100)
        {
            p.SignatureMeter = Fx.Zero;
            p.SignatureTimer = Param(s, p, "dynastyTurns", 10);
            p.SignatureTally++;
            events.Add(new GameEvent(GameEventType.DynastyBegan, p.Id, Value: p.SignatureTimer, Detail: $"Golden Dynasty {p.SignatureTally}"));
        }
    }

    /// <summary>Genghis: enemy cities with a Mongol military unit beside them lose loyalty.</summary>
    private static void Terror(GameState s, PlayerState p)
    {
        int terror = Param(s, p, "terrorLoyalty", 0);
        if (terror <= 0) return;
        foreach (var c in s.Cities)
        {
            if (c.Owner == p.Id || !DiplomacySystem.AtWar(s, p.Id, c.Owner)) continue;
            bool menaced = s.Units.Any(u => u.Owner == p.Id && SupplySystem.IsMilitary(s.Db, u) && s.Map.Distance(u.Tile, c.Tile) == 1);
            if (menaced) c.Loyalty = Fx.Max(Fx.Zero, c.Loyalty - terror);
        }
    }

    // ----- For the interface -----------------------------------------------------------------------------

    /// <summary>One line on where the signature stands ("Granary 84 food · flood in 3 turns").</summary>
    public static string? Status(GameState s, PlayerState p)
    {
        var sig = Signature(s, p);
        if (sig == null) return null;
        return sig.Kind switch
        {
            SignatureKind.Inundation => TurnsToFlood(s, p) == 0
                ? $"Granary {p.SignatureMeter.FloorToInt()} food · the river floods this turn"
                : $"Granary {p.SignatureMeter.FloorToInt()} food · flood in {TurnsToFlood(s, p)} turns",
            SignatureKind.Mandate => p.SignatureTimer > 0
                ? $"Golden Dynasty · {p.SignatureTimer} turns left"
                : $"Mandate {p.SignatureMeter.FloorToInt()} / 100",
            SignatureKind.Ledger => BuyableCount(s, p) is var n and > 0 ? $"{n} cities for sale · {p.SignatureTally} bought" : $"{p.SignatureTally} cities bought",
            SignatureKind.Horde => $"{p.SignatureTally} victories plundered",
            SignatureKind.SkyRoads => "Mountains are roads and farmland",
            SignatureKind.GoldenRoad => $"Interest {Fx.Min(Fx.Max(Fx.Zero, p.Gold) * Param(s, p, "interestPercent", 2) / 100, Fx.FromInt(Param(s, p, "interestCap", 25))).FloorToInt()} gold/turn",
            _ => null,
        };
    }

    /// <summary>Cities Venice could buy if it had the gold (range and loyalty satisfied).</summary>
    public static int BuyableCount(GameState s, PlayerState p) =>
        s.Cities.Count(c => CanBuy(s, p, c) is not { } reason || reason.StartsWith("Not enough gold"));
}
