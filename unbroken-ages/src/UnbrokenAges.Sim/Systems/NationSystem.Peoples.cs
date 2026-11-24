using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// The thirty further nations' signatures (docs/05-key-systems/14-nations.md). Each reads one engine hook:
/// <list type="table">
/// <item><term>City effects</term><description>Rome, Greece, Zulu, England, France, Persia, Aztec, Maya, Korea, India, Khmer,
///   Portugal, Carthage, Babylon, Scotland, Brazil, America, Haudenosaunee</description></item>
/// <item><term>Tiles</term><description>Russia (tundra), Ethiopia (hills), Korea (mines), Khmer (farms), Netherlands (sea),
///   Kongo (forest)</description></item>
/// <item><term>Combat</term><description>Greece, Zulu, Japan, Ottomans, Byzantium, Poland, Vietnam, Haudenosaunee, Spain</description></item>
/// <item><term>Movement</term><description>Rome, Norway, Persia, India, Portugal, Carthage, Vietnam</description></item>
/// <item><term>Battle outcomes</term><description>Norway, Aztec, Poland (kills); Ottomans, Spain (captures)</description></item>
/// <item><term>Empire yields</term><description>Ethiopia (faith → science/culture), Arabia (gold → science)</description></item>
/// <item><term>Rules</term><description>Russia (claims at founding), Portugal (coast only), Haudenosaunee (no declarations
///   of war), France (border growth), America (growth), Babylon (completions), England (strategic stockpiles)</description></item>
/// <item><term>Each turn</term><description>Russia (winter attrition), France (pressure on foreign cities), Brazil (carnival)</description></item>
/// </list>
/// </summary>
public static partial class NationSystem
{
    private static ModifierDef Pct(YieldType y, int amount) => new() { Effect = ModifierEffect.CityYieldPercent, Yield = y, Amount = amount };
    private static ModifierDef Flat(YieldType y, int amount) => new() { Effect = ModifierEffect.CityYieldFlat, Yield = y, Amount = amount };
    private static ModifierDef Effect(ModifierEffect e, int amount, ProductionCategory? category = null, DisasterKind? disaster = null) =>
        new() { Effect = e, Amount = amount, Category = category, Disaster = disaster };

    private static bool AtWarWithAnyone(GameState s, int player) =>
        s.Players.Any(o => o.Id != player && o.IsAlive && !o.IsFreeCities && DiplomacySystem.AtWar(s, player, o.Id));

    private static int PeacePartners(GameState s, int player) =>
        s.Players.Count(o => o.Id != player && o.IsAlive && !o.IsFreeCities && DiplomacySystem.Find(s, player, o.Id) is { } r && r.Status != DiploStatus.War);

    private static string AugmentName(GameState s, PlayerState p, SignatureDef sig) =>
        p.LeaderIndex >= 0 ? $"{s.Db.Leaders[p.LeaderIndex].Name}: {s.Db.Leaders[p.LeaderIndex].Augment.Name}" : sig.Name;

    private static int ImprovedLuxuries(GameState s, CityState city)
    {
        var tiles = new List<int>();
        s.Map.CollectRadius(city.Tile, 3, tiles);
        return tiles.Count(t => s.Map.OwnerCity[t] == city.Id && s.Map.Resource[t] >= 0 && s.Map.Improvement[t] >= 0
                                && s.Db.Resources[s.Map.Resource[t]].Class == ResourceClass.Luxury);
    }

    private static bool HasDistrict(GameState s, CityState city, string id) => city.Districts.Any(d => s.Db.Districts[d.DefIndex].Id == id && !d.Pillaged);

    // ----- City effects ----------------------------------------------------------------------------------

    private static IEnumerable<(string Source, ModifierDef Modifier)> PeoplesCityModifiers(GameState s, CityState city, PlayerState p, SignatureDef sig)
    {
        var map = s.Map;
        string src = sig.Name;
        int P(string key, int fallback) => Param(s, p, key, fallback);
        switch (sig.Kind)
        {
            case SignatureKind.Imperium:
            {
                int neighbours = s.CitiesOf(p.Id).Count(c => c.Id != city.Id && map.Distance(c.Tile, city.Tile) <= P("linkRange", 6));
                int bonus = Math.Min(P("maxPercent", 30), neighbours * P("percentPerCity", 6));
                if (bonus > 0)
                {
                    yield return ($"{src}: {neighbours} Roman cities nearby", Pct(YieldType.Production, bonus));
                    if (P("cultureToo", 0) > 0) yield return ($"{src}: {neighbours} Roman cities nearby", Pct(YieldType.Culture, bonus));
                }
                break;
            }
            case SignatureKind.Polis:
            {
                int partners = PeacePartners(s, p.Id);
                int each = P("percentPerPeace", 6);
                if (partners > 0)
                {
                    yield return ($"{src}: at peace with {partners}", Pct(YieldType.Science, partners * each));
                    yield return ($"{src}: at peace with {partners}", Pct(YieldType.Culture, partners * (each + P("extraCulturePercent", 0))));
                }
                break;
            }
            case SignatureKind.Impi:
                yield return (src, Effect(ModifierEffect.CityProductionPercent, P("unitProduction", 25), ProductionCategory.Unit));
                yield return (src, Pct(YieldType.Science, -P("sciencePenalty", 20)));
                break;
            case SignatureKind.Workshop:
                if (city.IsPowered) yield return ($"{src}: powered", Pct(YieldType.Production, P("poweredProduction", 25)));
                if (P("harborGold", 0) > 0 && HasDistrict(s, city, "DISTRICT_HARBOR")) yield return (AugmentName(s, p, sig), Flat(YieldType.Gold, P("harborGold", 0)));
                break;
            case SignatureKind.Grandeur:
                yield return (src, Pct(YieldType.Culture, P("culturePercent", 15)));
                if (P("buildingProduction", 0) > 0) yield return (AugmentName(s, p, sig), Effect(ModifierEffect.CityProductionPercent, P("buildingProduction", 0), ProductionCategory.Building));
                break;
            case SignatureKind.Satrapy:
                yield return (src, Effect(ModifierEffect.GovernorEstablishTurns, -P("establishFaster", 3)));
                if (city.GovernorDef >= 0)
                {
                    yield return ($"{src}: governed", Effect(ModifierEffect.CityLoyaltyPerTurn, P("governedLoyalty", 3)));
                    yield return ($"{src}: governed", Effect(ModifierEffect.CityAmenities, 1));
                    yield return ($"{src}: governed", Pct(YieldType.Gold, P("governedGold", 15)));
                }
                break;
            case SignatureKind.FlowerWar:
            {
                int lux = ImprovedLuxuries(s, city);
                if (lux > 0) yield return ($"{src}: {lux} luxuries", Effect(ModifierEffect.CityAmenities, lux * P("amenityPerLuxury", 1)));
                break;
            }
            case SignatureKind.LongCount:
            {
                var capital = s.GetCity(p.CapitalCityId);
                if (capital == null) break;
                bool near = map.Distance(capital.Tile, city.Tile) <= P("radius", 6);
                int amount = near ? P("nearPercent", 15) : -P("farPenalty", 15);
                foreach (var y in new[] { YieldType.Food, YieldType.Production, YieldType.Science, YieldType.Culture, YieldType.Gold })
                    yield return (near ? $"{src}: near the capital" : $"{src}: a far province", Pct(y, amount));
                if (city.IsCapital && P("capitalScience", 0) > 0) yield return (AugmentName(s, p, sig), Flat(YieldType.Science, P("capitalScience", 0)));
                break;
            }
            case SignatureKind.Seowon:
                yield return (src, new ModifierDef { Effect = ModifierEffect.CityAdjacencyPercent, Yield = YieldType.Science, Amount = P("scienceAdjacency", 100) });
                if (P("culturePerPop", 0) > 0) yield return (AugmentName(s, p, sig), Flat(YieldType.Culture, city.Population / P("culturePerPop", 0)));
                if (P("sciencePerPop", 0) > 0) yield return (AugmentName(s, p, sig), Flat(YieldType.Science, city.Population / P("sciencePerPop", 0)));
                break;
            case SignatureKind.Stepwell:
                if (map.IsAdjacentToChannel(city.Tile) || Enumerable.Range(0, 6).Any(d => map.HasRiverEdge(city.Tile, d) || (map.Neighbor(city.Tile, d) is var n && n >= 0 && map.IsWater(n))))
                    yield return ($"{src}: fresh water", Effect(ModifierEffect.CityHousing, P("waterHousing", 3)));
                if (city.Population >= P("faithPopulation", 6)) yield return ($"{src}: a great city", Flat(YieldType.Faith, P("bigCityFaith", 2)));
                if (P("peaceFood", 0) > 0 && !AtWarWithAnyone(s, p.Id)) yield return (AugmentName(s, p, sig), Pct(YieldType.Food, P("peaceFood", 0)));
                break;
            case SignatureKind.Baray:
                if (P("housing", 0) > 0) yield return (AugmentName(s, p, sig), Effect(ModifierEffect.CityHousing, P("housing", 0)));
                break;
            case SignatureKind.Polder:
                yield return (src, Effect(ModifierEffect.CityDisasterImmunity, 1, disaster: DisasterKind.RiverFlood));
                yield return (src, Effect(ModifierEffect.CityDisasterImmunity, 1, disaster: DisasterKind.Storm));
                if (map.IsAdjacentToSea(city.Tile) && P("coastalGold", 0) > 0) yield return (AugmentName(s, p, sig), Flat(YieldType.Gold, P("coastalGold", 0)));
                break;
            case SignatureKind.Navigators:
                if (map.IsAdjacentToSea(city.Tile))
                {
                    yield return ($"{src}: a port", Flat(YieldType.Gold, P("portGold", 3)));
                    yield return ($"{src}: a port", Pct(YieldType.Science, P("portScience", 10)));
                }
                break;
            case SignatureKind.Mercenaries:
                yield return (src, Effect(ModifierEffect.CityProductionPercent, -P("unitProductionPenalty", 30), ProductionCategory.Unit));
                if (map.IsAdjacentToSea(city.Tile)) yield return ($"{src}: a port", Flat(YieldType.Gold, P("portGold", 2)));
                if (map.IsAdjacentToSea(city.Tile) && P("portHousing", 0) > 0) yield return (AugmentName(s, p, sig), Effect(ModifierEffect.CityHousing, P("portHousing", 0)));
                break;
            case SignatureKind.Eureka:
                yield return (src, Pct(YieldType.Science, -P("sciencePenalty", 40)));
                if (P("districtProduction", 0) > 0) yield return (AugmentName(s, p, sig), Effect(ModifierEffect.CityProductionPercent, P("districtProduction", 0), ProductionCategory.District));
                break;
            case SignatureKind.Enlightenment:
            {
                int lux = ImprovedLuxuries(s, city);
                int pct = Math.Min(P("maxPercent", 30), lux * P("percentPerLuxury", 8));
                if (pct > 0)
                {
                    yield return ($"{src}: {lux} luxuries", Pct(YieldType.Science, pct));
                    yield return ($"{src}: {lux} luxuries", Pct(YieldType.Production, pct));
                }
                break;
            }
            case SignatureKind.Carnival when p.SignatureTimer > 0:
                yield return ($"{src}: Carnival!", Effect(ModifierEffect.CityAmenities, P("carnivalAmenities", 3)));
                if (P("carnivalProduction", 0) > 0) yield return (AugmentName(s, p, sig), Pct(YieldType.Production, P("carnivalProduction", 0)));
                break;
            case SignatureKind.Frontier:
                yield return (src, Effect(ModifierEffect.CityHousing, P("housing", 2)));
                if (P("productionPercent", 0) > 0) yield return (AugmentName(s, p, sig), Pct(YieldType.Production, P("productionPercent", 0)));
                if (P("parkCulture", 0) > 0) yield return (AugmentName(s, p, sig), Flat(YieldType.Culture, P("parkCulture", 0)));
                break;
            case SignatureKind.GreatLaw when !AtWarWithAnyone(s, p.Id):
                foreach (var y in YieldSet.All) yield return ($"{src}: at peace with all", Pct(y, P("peacePercent", 15)));
                if (P("peaceLoyalty", 0) > 0) yield return (AugmentName(s, p, sig), Effect(ModifierEffect.CityLoyaltyPerTurn, P("peaceLoyalty", 0)));
                break;
            case SignatureKind.Themes when P("loyalty", 0) > 0:
                yield return (AugmentName(s, p, sig), Effect(ModifierEffect.CityLoyaltyPerTurn, P("loyalty", 0)));
                break;
        }
    }

    // ----- Tiles -------------------------------------------------------------------------------------------

    private static YieldSet PeoplesTileBonus(GameState s, PlayerState p, int tile)
    {
        var y = new YieldSet();
        var map = s.Map;
        var db = s.Db;
        string terrain = db.Terrains[map.Terrain[tile]].Id;
        string? feature = map.Feature[tile] >= 0 ? db.Features[map.Feature[tile]].Id : null;
        string? improvement = map.Improvement[tile] >= 0 && !map.HasFlag(tile, TileFlags.Pillaged) ? db.Improvements[map.Improvement[tile]].Id : null;
        int P(string key, int fallback) => Param(s, p, key, fallback);
        switch (Kind(s, p))
        {
            case SignatureKind.Winter when terrain is "TERRAIN_TUNDRA" or "TERRAIN_SNOW":
                y.Food += P("tundraFood", 1);
                y.Production += P("tundraProduction", 1);
                y.Science += P("tundraScience", 0);
                break;
            case SignatureKind.Highland when map.Relief[tile] == db.Ids.Hills:
                y.Faith += P("hillFaith", 2);
                break;
            case SignatureKind.Seowon when improvement == "IMPROVEMENT_MINE":
                y.Science += P("mineScience", 1);
                break;
            case SignatureKind.Baray when improvement == "IMPROVEMENT_FARM":
                y.Food += P("farmFood", 1);
                if (Enumerable.Range(0, 6).Any(d => map.HasRiverEdge(tile, d)) || map.IsAdjacentToChannel(tile)) y.Faith += P("riverFarmFaith", 1);
                y.Culture += P("farmCulture", 0);
                break;
            case SignatureKind.Polder when map.IsWater(tile) && map.ClassAt(tile) == TerrainClass.Coast:
                y.Food += P("seaFood", 1);
                y.Production += P("seaProduction", 1);
                break;
            case SignatureKind.Forest when feature is "FEATURE_FOREST" or "FEATURE_RAINFOREST":
                y.Food += P("forestFood", 1);
                y.Production += P("forestProduction", 1);
                y.Culture += P("forestCulture", 1);
                break;
            case SignatureKind.Carnival when feature == "FEATURE_RAINFOREST":
                y.Science += P("rainforestScience", 1);
                break;
        }
        return y;
    }

    // ----- Combat ------------------------------------------------------------------------------------------

    /// <summary>Lines a nation adds to a unit's strength breakdown (shown in the combat preview).</summary>
    public static IEnumerable<(string Label, int Value)> CombatLines(GameState s, UnitState unit, UnitState? opponent, bool attacking, bool ranged, bool vsCity, int targetTile)
    {
        var p = s.Players[unit.Owner];
        var sig = Signature(s, p);
        if (sig == null) yield break;
        var map = s.Map;
        var db = s.Db;
        var def = db.Units[unit.DefIndex];
        int P(string key, int fallback) => Param(s, p, key, fallback);
        bool home = map.OwnerPlayer[unit.Tile] == p.Id;
        switch (sig.Kind)
        {
            case SignatureKind.Polis when AtWarWithAnyone(s, p.Id) && def.UnitClass == "Melee":
                yield return ($"{sig.Name}: the phalanx", P("phalanx", 4));
                break;
            case SignatureKind.Impi when attacking && !ranged && def.UnitClass == "Melee":
            {
                int comrades = 0;
                for (int d = 0; d < 6; d++)
                    if (map.Neighbor(targetTile, d) is var n && n >= 0 && n != unit.Tile)
                        comrades += s.Units.Count(o => o.Tile == n && o.Owner == unit.Owner && o.Id != unit.Id && db.Units[o.DefIndex].UnitClass == "Melee");
                if (comrades > 0) yield return ($"{sig.Name}: the horns ({comrades})", comrades * P("hornsPerComrade", 4));
                break;
            }
            case SignatureKind.Impi when !attacking && home && P("homeDefense", 0) > 0:
                yield return (AugmentName(s, p, sig), P("homeDefense", 0));
                break;
            case SignatureKind.Bushido:
            {
                int penalty = db.Rules.Combat.HpPenaltyPerTen * ((100 - unit.Hp) / 10);
                if (penalty > 0) yield return ($"{sig.Name}: wounds ignored", penalty);
                if (!attacking && P("coastDefense", 0) > 0 && map.IsAdjacentToSea(unit.Tile)) yield return (AugmentName(s, p, sig), P("coastDefense", 0));
                break;
            }
            case SignatureKind.Siege when attacking && vsCity:
                yield return ($"{sig.Name}: siege train", P("vsCity", 10));
                break;
            case SignatureKind.Themes:
            {
                int bonus = Math.Min(P("maxStrength", 10), s.CitiesOf(p.Id).Count() * P("strengthPerCity", 1));
                if (bonus > 0) yield return ($"{sig.Name}: {s.CitiesOf(p.Id).Count()} themes", bonus);
                if (IsMounted(def) && P("mountedStrength", 0) > 0) yield return (AugmentName(s, p, sig), P("mountedStrength", 0));
                break;
            }
            case SignatureKind.Commonwealth when home && P("homeStrength", 0) > 0:
                yield return (AugmentName(s, p, sig), P("homeStrength", 0));
                break;
            case SignatureKind.Guerrilla when map.Feature[unit.Tile] >= 0 || map.Relief[unit.Tile] == db.Ids.Hills:
                yield return ($"{sig.Name}: the land fights", P("terrainStrength", 5));
                break;
            case SignatureKind.GreatLaw when !attacking:
                yield return ($"{sig.Name}: defenders of the Longhouse", P("defense", 8));
                break;
            case SignatureKind.Treasure when attacking && P("attackStrength", 0) > 0:
                yield return (AugmentName(s, p, sig), P("attackStrength", 0));
                break;
            case SignatureKind.Enlightenment when home && P("homeStrength", 0) > 0:
                yield return (AugmentName(s, p, sig), P("homeStrength", 0));
                break;
            case SignatureKind.Highland when map.Relief[unit.Tile] == db.Ids.Hills && P("hillStrength", 0) > 0:
                yield return (AugmentName(s, p, sig), P("hillStrength", 0));
                break;
            case SignatureKind.Forest when map.Feature[unit.Tile] >= 0 && P("forestStrength", 0) > 0:
                yield return (AugmentName(s, p, sig), P("forestStrength", 0));
                break;
            case SignatureKind.Raiders when def.Domain == UnitDomain.Naval:
                yield return ($"{sig.Name}: sea kings", P("navalStrength", 5));
                break;
        }
    }

    /// <summary>Lines a nation adds to its cities' defence.</summary>
    public static IEnumerable<(string Label, int Value)> CityDefenseLines(GameState s, CityState city)
    {
        var p = s.Players[city.Owner];
        if (Kind(s, p) == SignatureKind.Themes) yield return ($"{Signature(s, p)!.Name}: the great walls", Param(s, p, "cityDefense", 10));
        if (Kind(s, p) == SignatureKind.GreatLaw) yield return ($"{Signature(s, p)!.Name}: the palisade", Param(s, p, "defense", 8));
    }

    // ----- Movement ----------------------------------------------------------------------------------------

    private static int PeoplesMovesBonus(GameState s, UnitState u)
    {
        if (u.Owner < 0 || u.Owner >= s.Players.Count) return 0;
        var p = s.Players[u.Owner];
        var def = s.Db.Units[u.DefIndex];
        var map = s.Map;
        int P(string key, int fallback) => Param(s, p, key, fallback);
        return Kind(s, p) switch
        {
            SignatureKind.Imperium when def.Domain == UnitDomain.Land && map.OwnerPlayer[u.Tile] == p.Id => P("homeMoves", 1),
            SignatureKind.Raiders when def.Domain == UnitDomain.Naval => P("navalMoves", 1),
            SignatureKind.Navigators when def.Domain == UnitDomain.Naval => P("navalMoves", 2),
            SignatureKind.Satrapy when def.Domain == UnitDomain.Land && AtWarWithAnyone(s, p.Id) => P("warMoves", 0),
            SignatureKind.Stepwell when def.Domain == UnitDomain.Land && AtWarWithAnyone(s, p.Id) => P("warMoves", 0),
            SignatureKind.Mercenaries when IsMounted(def) => P("mountedMoves", 0),
            SignatureKind.Guerrilla when def.Domain == UnitDomain.Land && (map.Feature[u.Tile] >= 0 || map.Relief[u.Tile] == s.Db.Ids.Hills) => P("terrainMoves", 1),
            _ => 0,
        };
    }

    // ----- Battle outcomes ---------------------------------------------------------------------------------

    private static void PeoplesOnUnitDestroyed(GameState s, int killerOwner, UnitState? killer, UnitState victim, List<GameEvent> events)
    {
        if (killerOwner < 0 || killerOwner >= s.Players.Count) return;
        var p = s.Players[killerOwner];
        int strength = Math.Max(UnitStats.Strength(s, victim), UnitStats.RangedStrength(s, victim));
        int P(string key, int fallback) => Param(s, p, key, fallback);
        switch (Kind(s, p))
        {
            case SignatureKind.Raiders:
            {
                Fx gold = Fx.FromInt(strength * P("goldPercent", 150) / 100);
                Fx science = Fx.FromInt(strength * P("sciencePercent", 0) / 100);
                p.Gold += gold;
                p.TechProgress += science;
                p.SignatureTally++;
                events.Add(new GameEvent(GameEventType.Plundered, killerOwner, Tile: victim.Tile, Value: gold.FloorToInt(),
                    Detail: $"+{gold.FloorToInt()} Gold" + (science > Fx.Zero ? $", +{science.FloorToInt()} Science" : "")));
                break;
            }
            case SignatureKind.FlowerWar:
            {
                var city = s.CitiesOf(p.Id).OrderBy(c => s.Map.Distance(c.Tile, victim.Tile)).ThenBy(c => c.Id).FirstOrDefault();
                if (city == null) break;
                Fx works = Fx.FromInt(strength * P("productionPercent", 150) / 100);
                city.OverflowProduction += works;
                city.Loyalty = Fx.Min(Fx.FromInt(100), city.Loyalty + P("loyaltyPerCaptive", 2));
                p.SignatureTally++;
                events.Add(new GameEvent(GameEventType.Plundered, killerOwner, city.Id, victim.Tile, works.FloorToInt(), Detail: $"+{works.FloorToInt()} Production in {city.Name}"));
                break;
            }
            case SignatureKind.Commonwealth:
            {
                var city = s.CitiesOf(p.Id).Where(c => s.Map.Distance(c.Tile, victim.Tile) <= P("range", 4)).OrderBy(c => s.Map.Distance(c.Tile, victim.Tile)).ThenBy(c => c.Id).FirstOrDefault();
                if (city == null) break;
                var ring = new List<int>();
                s.Map.CollectRadius(victim.Tile, P("radius", 1), ring);
                int claimed = 0;
                foreach (int t in ring.OrderBy(t => t))
                {
                    if (s.Map.District[t] >= 0 || s.Cities.Any(c => c.Tile == t) || s.Map.OwnerPlayer[t] == p.Id || s.Map.IsWater(t)) continue;
                    CitySystem.ClaimTile(s, city, t);
                    claimed++;
                }
                if (claimed > 0) { p.SignatureTally++; events.Add(new GameEvent(GameEventType.Plundered, killerOwner, city.Id, victim.Tile, claimed, Detail: $"{claimed} tiles join {city.Name}")); }
                break;
            }
        }
    }

    private static void PeoplesOnCityCaptured(GameState s, int captor, CityState city, int victim, int populationBefore, List<GameEvent> events)
    {
        var p = s.Players[captor];
        int P(string key, int fallback) => Param(s, p, key, fallback);
        switch (Kind(s, p))
        {
            case SignatureKind.Siege:
                city.Population = populationBefore;
                city.Loyalty = Fx.FromInt(P("capturedLoyalty", 75));
                p.SignatureTally++;
                break;
            case SignatureKind.Treasure:
            {
                Fx gold = Fx.FromInt(populationBefore * P("goldPerPop", 80));
                p.Gold += gold;
                p.Faith += Fx.FromInt(populationBefore * P("faithPerPop", 0));
                p.SignatureTally++;
                events.Add(new GameEvent(GameEventType.Plundered, captor, city.Id, city.Tile, gold.FloorToInt(), Detail: $"+{gold.FloorToInt()} Gold from the treasury of {city.Name}"));
                break;
            }
        }
    }

    // ----- Empire-level yields (TurnProcessor) -----------------------------------------------------------

    /// <summary>Converts the empire's yields before they are banked (Ethiopia's faith, Arabia's gold).</summary>
    public static void AdjustEmpireYields(GameState s, PlayerState p, ref Fx science, ref Fx culture, ref Fx gold, ref Fx faith)
    {
        int P(string key, int fallback) => Param(s, p, key, fallback);
        switch (Kind(s, p))
        {
            case SignatureKind.Highland when faith > Fx.Zero:
            {
                Fx scholars = faith * P("faithToScience", 40) / 100, chroniclers = faith * P("faithToCulture", 20) / 100;
                science += scholars;
                culture += chroniclers;
                break;
            }
            case SignatureKind.Wisdom when gold > Fx.Zero:
            {
                Fx part = gold * P("goldToScience", 25) / 100;
                gold -= part;
                science += part * P("conversionPercent", 120) / 100;
                faith += part * P("goldToFaith", 0) / 100;
                break;
            }
        }
    }

    /// <summary>Percent change to the food a city needs to grow (America grows fast).</summary>
    public static int GrowthThresholdPercent(GameState s, CityState city) =>
        Is(s, city.Owner, SignatureKind.Frontier) ? -Param(s, s.Players[city.Owner], "growthPercent", 25) : 0;

    /// <summary>Percent extra culture toward border growth (France).</summary>
    public static int BorderCulturePercent(GameState s, int player) =>
        Is(s, player, SignatureKind.Grandeur) ? Param(s, s.Players[player], "borderPercent", 100) : 0;

    /// <summary>Extra strategic resources per improved source per turn (England).</summary>
    public static int StrategicBonus(GameState s, PlayerState p) => Kind(s, p) == SignatureKind.Workshop ? Param(s, p, "strategicBonus", 2) : 0;

    // ----- Rules -----------------------------------------------------------------------------------------

    /// <summary>A new city: Russia claims the second ring as well.</summary>
    public static void OnCityFounded(GameState s, CityState city)
    {
        var p = s.Players[city.Owner];
        if (Kind(s, p) != SignatureKind.Winter) return;
        var ring = new List<int>();
        s.Map.CollectRadius(city.Tile, Param(s, p, "claimRadius", 2), ring);
        foreach (int t in ring.OrderBy(t => t))
            if (s.Map.OwnerPlayer[t] < 0) CitySystem.ClaimTile(s, city, t);
    }

    /// <summary>Why this nation may not found a city here (Portugal: only on the coast), or null.</summary>
    public static string? ForbidFound(GameState s, int player, int tile)
    {
        if (!Is(s, player, SignatureKind.Navigators)) return null;
        return s.Map.IsAdjacentToSea(tile) || s.Map.IsAdjacentToChannel(tile) ? null : $"{Signature(s, s.Players[player])!.Name}: Portuguese cities are founded on the coast.";
    }

    /// <summary>Why this nation may not declare war (the Haudenosaunee never strike first), or null.</summary>
    public static string? ForbidWar(GameState s, int player) =>
        Is(s, player, SignatureKind.GreatLaw) ? $"{Signature(s, s.Players[player])!.Name}: the Confederacy never declares war; it only defends itself." : null;

    /// <summary>Something was built (Babylon: every building and district is a discovery).</summary>
    public static void OnCompleted(GameState s, CityState city, ProductionKind kind, int def, List<GameEvent> events)
    {
        var p = s.Players[city.Owner];
        if (Kind(s, p) != SignatureKind.Eureka || kind is not (ProductionKind.Building or ProductionKind.District)) return;
        Fx cost = ProductionSystem.Cost(s, p, kind, def);
        Fx science = cost * Param(s, p, "sciencePercent", 60) / 100;
        Fx culture = cost * Param(s, p, "culturePercent", 0) / 100;
        p.TechProgress += science;
        p.CivicProgress += culture;
        p.SignatureTally++;
        events.Add(new GameEvent(GameEventType.Plundered, p.Id, city.Id, city.Tile, science.FloorToInt(), Detail: $"a discovery in {city.Name}: +{science.FloorToInt()} Science"));
    }

    // ----- Each turn ---------------------------------------------------------------------------------------

    private static void PeoplesTurn(GameState s, PlayerState p, List<GameEvent> events)
    {
        int P(string key, int fallback) => Param(s, p, key, fallback);
        var map = s.Map;
        switch (Kind(s, p))
        {
            case SignatureKind.Winter:
            {
                // General Winter: enemy units standing in Russian tundra or snow freeze.
                int damage = P("winterDamage", 10);
                foreach (var u in s.Units.Where(u => u.Owner != p.Id && map.OwnerPlayer[u.Tile] == p.Id && DiplomacySystem.AtWar(s, p.Id, u.Owner)).ToList())
                {
                    string terrain = s.Db.Terrains[map.Terrain[u.Tile]].Id;
                    if (terrain is not ("TERRAIN_TUNDRA" or "TERRAIN_SNOW")) continue;
                    u.Hp -= damage;
                    if (u.Hp <= 0)
                    {
                        s.RemoveUnit(u);
                        events.Add(new GameEvent(GameEventType.UnitLostToAttrition, u.Owner, Tile: u.Tile, Def: u.DefIndex));
                    }
                }
                break;
            }
            case SignatureKind.Grandeur when P("foreignPressure", 0) > 0:
                foreach (var c in s.Cities.Where(c => c.Owner != p.Id && s.CitiesOf(p.Id).Any(m => map.Distance(m.Tile, c.Tile) <= 6)))
                    c.Loyalty = Fx.Max(Fx.Zero, c.Loyalty - P("foreignPressure", 0));
                break;
            case SignatureKind.Carnival:
            {
                if (p.SignatureTimer > 0) { p.SignatureTimer--; break; }
                int interval = Math.Max(3, P("interval", 10));
                if (((s.Turn % interval) + interval) % interval != interval - 1) break;
                p.SignatureTimer = P("carnivalTurns", 2);
                Fx culture = Fx.FromInt(s.CitiesOf(p.Id).Sum(c => c.Population) * P("culturePerPop", 6));
                p.CivicProgress += culture;
                p.SignatureTally++;
                events.Add(new GameEvent(GameEventType.Plundered, p.Id, Value: culture.FloorToInt(), Detail: $"Carnival! +{culture.FloorToInt()} Culture and joy in every city"));
                break;
            }
        }
    }

    private static string? PeoplesStatus(GameState s, PlayerState p)
    {
        int P(string key, int fallback) => Param(s, p, key, fallback);
        return Kind(s, p) switch
        {
            SignatureKind.Polis => $"At peace with {PeacePartners(s, p.Id)}: +{PeacePartners(s, p.Id) * P("percentPerPeace", 6)}% Science",
            SignatureKind.Raiders => $"{p.SignatureTally} raids paid",
            SignatureKind.FlowerWar => $"{p.SignatureTally} captives offered",
            SignatureKind.Siege => $"{p.SignatureTally} cities taken whole",
            SignatureKind.Treasure => $"{p.SignatureTally} treasuries seized",
            SignatureKind.Eureka => $"{p.SignatureTally} discoveries",
            SignatureKind.Commonwealth => $"{p.SignatureTally} victories pushed the border",
            SignatureKind.Carnival => p.SignatureTimer > 0 ? "Carnival!" : $"Carnival in {Math.Max(3, P("interval", 10)) - 1 - ((s.Turn % Math.Max(3, P("interval", 10))) + Math.Max(3, P("interval", 10))) % Math.Max(3, P("interval", 10))} turns",
            SignatureKind.GreatLaw => AtWarWithAnyone(s, p.Id) ? "At war: the peace bonus is lost" : $"At peace with all: +{P("peacePercent", 15)}% everything",
            SignatureKind.Themes => $"Army +{Math.Min(P("maxStrength", 10), s.CitiesOf(p.Id).Count() * P("strengthPerCity", 1))} strength",
            SignatureKind.Wisdom => $"{P("goldToScience", 25)}% of gold income becomes Science",
            SignatureKind.Highland => "Highland faith feeds the scholars",
            SignatureKind.LongCount => "The capital's realm thrives",
            SignatureKind.None or SignatureKind.Inundation or SignatureKind.Ledger or SignatureKind.Mandate or SignatureKind.Horde
                or SignatureKind.SkyRoads or SignatureKind.GoldenRoad => null,
            _ => Signature(s, p)?.Name,
        };
    }
}
