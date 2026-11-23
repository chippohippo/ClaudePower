using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems.Districts;

namespace UnbrokenAges.Sim.Systems;

public sealed record QueueEstimate(int Uid, string Name, Fx Cost, Fx Progress, int TurnsToComplete, int CompletesOnTurn);

/// <summary>
/// Production queue rules:
///  • Up to Options.MaxQueueLength items; districts reserve their tile while queued.
///  • Partial progress is kept per item key, so reordering or switching never wastes hammers.
///  • At most one completion per city per turn; leftover production overflows into next turn.
///  • Items that become invalid (lost the tile, obsolete, prerequisites gone) are skipped with a
///    notification instead of silently stalling the queue.
///  • Repeat items re-enqueue themselves at the back (builder/trader loops).
/// </summary>
public static class ProductionSystem
{
    public const int PurchaseGoldPerProduction = 4;

    public static string ItemName(GameDatabase db, QueueItem item) => item.Kind switch
    {
        ProductionKind.Unit => db.Units[item.DefIndex].Name,
        ProductionKind.Building => db.Buildings[item.DefIndex].Name,
        ProductionKind.District => db.Districts[item.DefIndex].Name,
        ProductionKind.Project => db.Projects[item.DefIndex].Name,
        _ => "?",
    };

    public static ProductionCategory CategoryOf(ProductionKind kind) => kind switch
    {
        ProductionKind.Unit => ProductionCategory.Unit,
        ProductionKind.Building => ProductionCategory.Building,
        ProductionKind.District => ProductionCategory.District,
        _ => ProductionCategory.Project,
    };

    /// <summary>Cost after game speed, era scaling for districts (+25% per era reached) and project rules.</summary>
    public static Fx Cost(GameState s, PlayerState player, ProductionKind kind, int def)
    {
        var db = s.Db;
        Fx baseCost = kind switch
        {
            ProductionKind.Unit => db.Units[def].Cost,
            ProductionKind.Building => db.Buildings[def].Cost,
            ProductionKind.District => db.Districts[def].Cost * (Fx.One + Fx.Ratio(s.PlayerEra(player), 4)),
            ProductionKind.Project => db.Projects[def].Cost,
            _ => Fx.Zero,
        };
        return baseCost * s.Options.GameSpeedPercent / 100;
    }

    /// <summary>Why an item cannot be produced right now (null when valid).</summary>
    public static string? Validate(GameState s, CityState city, ProductionKind kind, int def, int tile, int queueUid = -1)
    {
        var db = s.Db;
        var player = s.Players[city.Owner];
        switch (kind)
        {
            case ProductionKind.Unit:
            {
                if (def < 0 || def >= db.Units.Count) return "Unknown unit.";
                var u = db.Units[def];
                if (!player.HasTech(u.PrereqTechIndex) || !player.HasCivic(u.PrereqCivicIndex)) return "Prerequisite not researched.";
                if (u.CivilizationIndex >= 0 && u.CivilizationIndex != player.CivIndex) return "Unique to another civilization.";
                if (u.Domain == UnitDomain.Naval && !s.Map.IsAdjacentToSea(city.Tile) && !s.Map.IsAdjacentToChannel(city.Tile)
                    && !city.Districts.Any(d => s.Map.IsWater(d.Tile)))
                    return "Naval units need a coastal or Great River city.";
                if (u.FoundsCity && city.Population < 2) return "Settlers require population 2.";
                return null;
            }
            case ProductionKind.Building:
            {
                if (def < 0 || def >= db.Buildings.Count) return "Unknown building.";
                var b = db.Buildings[def];
                if (!player.HasTech(b.PrereqTechIndex) || !player.HasCivic(b.PrereqCivicIndex)) return "Prerequisite not researched.";
                if (b.CivilizationIndex >= 0 && b.CivilizationIndex != player.CivIndex) return "Unique to another civilization.";
                if (city.HasBuilding(def)) return "Already built.";
                if (city.Queue.Items.Any(q => q.Kind == ProductionKind.Building && q.DefIndex == def && q.Uid != queueUid)) return "Already queued.";
                var district = city.Districts.Find(d => AdjacencyCalculator.DistrictMatches(db, d.DefIndex, b.DistrictIndex));
                if (district == null) return $"Requires {db.Districts[b.DistrictIndex].Name}.";
                if (district.Pillaged) return "District is pillaged.";
                foreach (int req in b.RequiresBuildingIndices)
                    if (!city.HasBuilding(req)) return $"Requires {db.Buildings[req].Name}.";
                return null;
            }
            case ProductionKind.District:
            {
                if (def < 0 || def >= db.Districts.Count) return "Unknown district.";
                var failures = DistrictPlacement.Check(s, city, def, tile, new PlacementOptions(IgnoreQueueUid: queueUid));
                return failures.Count == 0 ? null : $"Cannot place here: {string.Join(", ", failures)}.";
            }
            case ProductionKind.Project:
            {
                if (def < 0 || def >= db.Projects.Count) return "Unknown project.";
                var p = db.Projects[def];
                if (p.DivergenceIndex >= 0 && player.Divergence != p.DivergenceIndex) return $"Only {db.Divergences[p.DivergenceIndex].People} can build this.";
                if (!player.HasTech(p.PrereqTechIndex)) return "Prerequisite not researched.";
                if (p.RequiresWorldTransformedPercent > 0 && p.DivergenceIndex >= 0)
                {
                    Fx share = DivergenceSystem.WorldShare(s)[p.DivergenceIndex];
                    if (share < p.RequiresWorldTransformedPercent)
                        return $"The world must be remade first: {share.FloorToInt()}% of {p.RequiresWorldTransformedPercent}% of land.";
                }
                if (!p.Repeatable && player.Ascended && p.OnComplete.Any(m => m.Effect == ModifierEffect.CompleteAscension)) return "Already ascended.";
                if (p.DistrictIndex >= 0 && city.Districts.All(d => !AdjacencyCalculator.DistrictMatches(db, d.DefIndex, p.DistrictIndex)))
                    return $"Requires {db.Districts[p.DistrictIndex].Name}.";
                return null;
            }
        }
        return "Unknown item.";
    }

    public static QueueItem Enqueue(GameState s, CityState city, ProductionKind kind, int def, int tile, int position, bool repeat)
    {
        var item = new QueueItem { Uid = city.Queue.NextUid++, Kind = kind, DefIndex = def, Tile = kind == ProductionKind.District ? tile : -1, Repeat = repeat };
        if (position < 0 || position > city.Queue.Items.Count) city.Queue.Items.Add(item);
        else city.Queue.Items.Insert(position, item);
        if (item.Tile >= 0) s.Map.Reservation[item.Tile] = city.Id;
        return item;
    }

    public static void Remove(GameState s, CityState city, int index)
    {
        var item = city.Queue.Items[index];
        city.Queue.Items.RemoveAt(index);
        if (item.Tile >= 0 && s.Map.Reservation[item.Tile] == city.Id) s.Map.Reservation[item.Tile] = -1;
    }

    public static void Move(CityState city, int from, int to)
    {
        var item = city.Queue.Items[from];
        city.Queue.Items.RemoveAt(from);
        city.Queue.Items.Insert(Math.Clamp(to, 0, city.Queue.Items.Count), item);
    }

    /// <summary>Called once per turn with the city's production yield.</summary>
    public static void Process(GameState s, CityState city, Fx production, CityEffects fx, List<GameEvent> events)
    {
        var player = s.Players[city.Owner];
        Fx available = production + city.OverflowProduction;
        city.OverflowProduction = Fx.Zero;

        while (city.Queue.Items.Count > 0)
        {
            var item = city.Queue.Items[0];
            string? invalid = Validate(s, city, item.Kind, item.DefIndex, item.Tile, item.Uid);
            if (invalid != null)
            {
                events.Add(new GameEvent(GameEventType.QueueItemInvalidated, city.Owner, city.Id, item.Tile, item.DefIndex, (int)item.Kind, invalid));
                Remove(s, city, 0);
                continue;
            }

            Fx bonus = available * fx.ProductionBonusFor(CategoryOf(item.Kind)) / 100;
            Fx cost = Cost(s, player, item.Kind, item.DefIndex);
            city.ProgressLedger.TryGetValue(item.ProgressKey, out Fx progress);
            progress += available + bonus;
            if (progress < cost)
            {
                city.ProgressLedger[item.ProgressKey] = progress;
                return;
            }

            // Completed: overflow (in base production terms) carries into next turn.
            Fx overflowRaw = progress - cost;
            city.OverflowProduction = Fx.Min(overflowRaw, cost);
            city.ProgressLedger.Remove(item.ProgressKey);
            Remove(s, city, 0);
            Complete(s, city, item, events);
            if (item.Repeat && Validate(s, city, item.Kind, item.DefIndex, item.Tile) == null)
                Enqueue(s, city, item.Kind, item.DefIndex, item.Tile, -1, repeat: true);
            return; // one completion per turn
        }
        // Empty queue: bank production as overflow (capped) so nothing is lost while idle.
        city.OverflowProduction = Fx.Min(available, 2 * production + 10);
    }

    public static void Complete(GameState s, CityState city, QueueItem item, List<GameEvent> events)
    {
        var db = s.Db;
        switch (item.Kind)
        {
            case ProductionKind.Unit:
            {
                var def = db.Units[item.DefIndex];
                var fx = CityEffects.Compute(s, city);
                var unit = new UnitState
                {
                    Id = s.AllocateId(), Owner = city.Owner, DefIndex = item.DefIndex, Tile = city.Tile,
                    MovesLeft = def.Moves, Charges = def.Charges > 0 ? def.Charges + fx.BuilderCharges : 0,
                };
                if (def.Domain == UnitDomain.Naval) unit.Tile = FindNavalSpawn(s, city) ?? city.Tile;
                s.AddUnit(unit);
                if (def.FoundsCity) city.Population = Math.Max(1, city.Population - 1);
                break;
            }
            case ProductionKind.Building:
            {
                var b = db.Buildings[item.DefIndex];
                var district = city.Districts.First(d => AdjacencyCalculator.DistrictMatches(db, d.DefIndex, b.DistrictIndex));
                district.Buildings.Add(item.DefIndex);
                if (b.ProtectsFromFlood) ClimateSystem.RefreshFloodProtection(s, city);
                break;
            }
            case ProductionKind.District:
                CitySystem.AddDistrict(s, city, item.DefIndex, item.Tile);
                break;
            case ProductionKind.Project:
                foreach (var m in db.Projects[item.DefIndex].OnComplete)
                {
                    if (m.Effect == ModifierEffect.ClimateCo2Reduction)
                        s.Climate.Co2Ppm = Fx.Max(s.Db.ClimateConfig.BasePpm, s.Climate.Co2Ppm - m.Amount);
                    else if (m.Effect == ModifierEffect.ClimateCooling)
                        s.Climate.Temperature = Fx.Max(Fx.Zero, s.Climate.Temperature - m.Amount); // decays back unless renewed
                    else if (m.Effect == ModifierEffect.CompleteAscension)
                        DivergenceSystem.CompleteAscension(s, s.Players[city.Owner], events);
                }
                break;
        }
        events.Add(new GameEvent(GameEventType.ProductionCompleted, city.Owner, city.Id, item.Tile, item.DefIndex, (int)item.Kind, ItemName(db, item)));
    }

    private static int? FindNavalSpawn(GameState s, CityState city)
    {
        foreach (var d in city.Districts)
            if (s.Map.IsWater(d.Tile)) return d.Tile;
        for (int dir = 0; dir < 6; dir++)
        {
            int n = s.Map.Neighbor(city.Tile, dir);
            if (n >= 0 && s.Map.IsWater(n)) return n;
        }
        return null;
    }

    /// <summary>Turn estimates for every queued item at current production (drives the queue UI).</summary>
    public static List<QueueEstimate> Estimate(GameState s, CityState city, Fx productionPerTurn)
    {
        var player = s.Players[city.Owner];
        var fx = CityEffects.Compute(s, city);
        var list = new List<QueueEstimate>();
        int turn = 0;
        Fx carry = city.OverflowProduction;
        foreach (var item in city.Queue.Items)
        {
            Fx cost = Cost(s, player, item.Kind, item.DefIndex);
            city.ProgressLedger.TryGetValue(item.ProgressKey, out Fx progress);
            Fx perTurn = productionPerTurn + productionPerTurn * fx.ProductionBonusFor(CategoryOf(item.Kind)) / 100;
            Fx remaining = cost - progress - carry;
            int turns = remaining <= Fx.Zero ? 1 : perTurn <= Fx.Zero ? -1 : Math.Max(1, (remaining / perTurn).CeilToInt());
            if (turns < 0)
            {
                list.Add(new QueueEstimate(item.Uid, ItemName(s.Db, item), cost, progress, -1, -1));
                continue;
            }
            turn += turns;
            carry = Fx.Min(perTurn * turns - remaining, cost);
            if (carry < Fx.Zero) carry = Fx.Zero;
            list.Add(new QueueEstimate(item.Uid, ItemName(s.Db, item), cost, progress, turns, s.Turn + turn));
        }
        return list;
    }

    public static Fx PurchaseCost(GameState s, CityState city, ProductionKind kind, int def)
    {
        var player = s.Players[city.Owner];
        var fx = CityEffects.Compute(s, city);
        Fx cost = Cost(s, player, kind, def) * PurchaseGoldPerProduction;
        city.ProgressLedger.TryGetValue(QueueItem.MakeKey(kind, def, -1), out Fx progress);
        cost -= progress * PurchaseGoldPerProduction;
        return (cost - cost * fx.PurchaseDiscountPercent / 100).Floor();
    }
}
