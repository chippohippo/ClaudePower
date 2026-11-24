using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Sim.Commands;

public sealed class EndTurnCommand : GameCommand
{
    public override CommandType Type => CommandType.EndTurn;
    public override string? Validate(GameState s) =>
        Issuer(s) is not { } p ? "Invalid player." : p.HasEndedTurn ? "Turn already ended." : null;
    public override void Apply(GameState s, List<GameEvent> events) => s.Players[Player].HasEndedTurn = true;
    protected override void WritePayload(BinaryWriter w) { }
    protected override void ReadPayload(BinaryReader r) { }
}

/// <summary>Host-only: resolves the end of turn on every peer.</summary>
public sealed class AdvanceTurnCommand : GameCommand
{
    public int ExpectedTurn;
    public override CommandType Type => CommandType.AdvanceTurn;
    public override string? Validate(GameState s) =>
        Player != SystemPlayer ? "Only the host may advance the turn." : ExpectedTurn != s.Turn ? $"Turn mismatch ({ExpectedTurn} vs {s.Turn})." : null;
    public override void Apply(GameState s, List<GameEvent> events) => events.AddRange(TurnProcessor.Advance(s));
    protected override void WritePayload(BinaryWriter w) => w.Write(ExpectedTurn);
    protected override void ReadPayload(BinaryReader r) => ExpectedTurn = r.ReadInt32();
}

public sealed class MoveUnitCommand : GameCommand
{
    public int UnitId, Destination;
    public override CommandType Type => CommandType.MoveUnit;
    public override string? Validate(GameState s)
    {
        if (OwnUnit(s, UnitId) is not { } u) return "Not your unit.";
        if (Destination < 0 || Destination >= s.Map.Count) return "Invalid destination.";
        if (AirSystem.IsAircraft(s.Db, u)) return AirSystem.ValidateRebase(s, u, Destination);
        path = Movement.FindPath(s, u, Destination);
        pathFrom = u.Tile;
        return path == null ? "No path." : null;
    }
    public override void Apply(GameState s, List<GameEvent> events)
    {
        var u = s.GetUnit(UnitId)!;
        u.Destination = Destination;
        // Apply follows Validate at once, so the path it found still holds (the state has not changed in between).
        Movement.MoveAlong(s, u, path != null && pathFrom == u.Tile ? path : null);
        path = null;
    }
    private List<int>? path;
    private int pathFrom = -1;
    protected override void WritePayload(BinaryWriter w) { w.Write(UnitId); w.Write(Destination); }
    protected override void ReadPayload(BinaryReader r) { UnitId = r.ReadInt32(); Destination = r.ReadInt32(); }
}

public sealed class FoundCityCommand : GameCommand
{
    public const int MinCityDistance = 4;
    public int UnitId;
    public string? Name;
    public override CommandType Type => CommandType.FoundCity;
    public override string? Validate(GameState s)
    {
        if (OwnUnit(s, UnitId) is not { } u) return "Not your unit.";
        if (!s.Db.Units[u.DefIndex].FoundsCity) return "This unit cannot found cities.";
        var map = s.Map;
        if (!map.IsLand(u.Tile) || map.IsMountain(u.Tile)) return "Cities must be founded on land.";
        if (map.OwnerPlayer[u.Tile] >= 0 && map.OwnerPlayer[u.Tile] != Player) return "Tile belongs to another civilization.";
        if (NationSystem.ForbidFound(s, Player, u.Tile) is { } forbidden) return forbidden;
        if (s.Cities.Any(c => map.Distance(c.Tile, u.Tile) < MinCityDistance)) return "Too close to another city.";
        return null;
    }
    public override void Apply(GameState s, List<GameEvent> events)
    {
        var u = s.GetUnit(UnitId)!;
        var city = CitySystem.Found(s, Player, u.Tile, Name);
        s.RemoveUnit(u);
        events.Add(new GameEvent(GameEventType.CityFounded, Player, city.Id, city.Tile, Detail: city.Name));
    }
    protected override void WritePayload(BinaryWriter w) { w.Write(UnitId); w.Write(Name ?? ""); }
    protected override void ReadPayload(BinaryReader r) { UnitId = r.ReadInt32(); var n = r.ReadString(); Name = n.Length == 0 ? null : n; }
}

/// <summary>Builders have charges; each improvement consumes one (no infinite workers, no automation tax).</summary>
public sealed class BuildImprovementCommand : GameCommand
{
    public int UnitId, Improvement;
    public override CommandType Type => CommandType.BuildImprovement;
    public override string? Validate(GameState s)
    {
        if (OwnUnit(s, UnitId) is not { } u) return "Not your unit.";
        if (u.Charges <= 0) return "No charges left.";
        if (Improvement < 0 || Improvement >= s.Db.Improvements.Count) return "Unknown improvement.";
        return ImprovementRules.Validate(s, s.Players[Player], s.Db.Improvements[Improvement], u.Tile);
    }
    public override void Apply(GameState s, List<GameEvent> events)
    {
        var u = s.GetUnit(UnitId)!;
        var def = s.Db.Improvements[Improvement];
        var map = s.Map;
        if (def.RemovesFeature && map.Feature[u.Tile] >= 0)
        {
            s.Climate.PendingDeforestation += s.Db.Features[map.Feature[u.Tile]].Co2OnRemoval;
            map.Feature[u.Tile] = -1;
        }
        if (def.TransformsTerrainIndex >= 0)
        {
            if (map.Feature[u.Tile] >= 0) s.Climate.PendingDeforestation += s.Db.Features[map.Feature[u.Tile]].Co2OnRemoval;
            map.Terrain[u.Tile] = (byte)def.TransformsTerrainIndex;
            map.Feature[u.Tile] = -1;
        }
        if (def.AddsFeatureIndex >= 0) map.Feature[u.Tile] = (short)def.AddsFeatureIndex;
        map.Improvement[u.Tile] = (short)Improvement;
        map.SetFlag(u.Tile, TileFlags.Pillaged, false);
        if (--u.Charges <= 0) s.RemoveUnit(u);
        events.Add(new GameEvent(GameEventType.ImprovementBuilt, Player, Tile: u.Tile, Def: Improvement, Detail: def.Name));
    }
    protected override void WritePayload(BinaryWriter w) { w.Write(UnitId); w.Write(Improvement); }
    protected override void ReadPayload(BinaryReader r) { UnitId = r.ReadInt32(); Improvement = r.ReadInt32(); }
}

public static class ImprovementRules
{
    public static string? Validate(GameState s, PlayerState p, ImprovementDef def, int tile)
    {
        var map = s.Map;
        if (map.OwnerPlayer[tile] != p.Id) return "Tile is not in your territory.";
        if (map.District[tile] >= 0) return "Tile has a district.";
        if (!p.HasTech(def.PrereqTechIndex)) return "Prerequisite not researched.";
        if (def.OnWater != map.IsWater(tile)) return def.OnWater ? "Must be built on water." : "Must be built on land.";
        if (def.ValidTerrainIndices.Length > 0 && !def.ValidTerrainIndices.Contains(map.Terrain[tile])) return "Invalid terrain.";
        if (def.ValidReliefIndices.Length > 0 && !def.ValidReliefIndices.Contains(map.Relief[tile])) return "Invalid relief.";
        // Features: allowed if listed; otherwise the improvement must clear them (removesFeature).
        if (map.Feature[tile] >= 0 && !def.ValidFeatureIndices.Contains(map.Feature[tile]) && !def.RemovesFeature && def.TransformsTerrainIndex < 0)
            return "Remove the feature first.";
        if (map.Feature[tile] >= 0 && def.TransformsTerrainIndex >= 0 && !s.Db.Features[map.Feature[tile]].Removable) return "Cannot remake this tile.";
        if (map.Feature[tile] < 0 && def.RequiresFeatureOnTile) return "Requires a feature.";
        if (def.ValidResourceIndices.Length > 0 && !def.ValidResourceIndices.Contains(map.Resource[tile]))
        {
            if (def.RequiresResource) return "Requires a specific resource.";
            if (map.Resource[tile] >= 0) return "Another improvement suits this resource.";
        }
        if (map.Improvement[tile] == def.Index && !map.HasFlag(tile, TileFlags.Pillaged)) return "Already built.";
        return null;
    }
}

public sealed class EnqueueCommand : GameCommand
{
    public int CityId, DefIndex, Tile = -1, Position = -1;
    public ProductionKind Kind;
    public bool Repeat;
    public override CommandType Type => CommandType.Enqueue;
    public override string? Validate(GameState s)
    {
        if (OwnCity(s, CityId) is not { } c) return "Not your city.";
        if (c.Queue.Items.Count >= s.Options.MaxQueueLength) return "Queue is full.";
        return ProductionSystem.CanEnqueue(s, c, Kind, DefIndex, Tile);
    }
    public override void Apply(GameState s, List<GameEvent> events) =>
        ProductionSystem.Enqueue(s, s.GetCity(CityId)!, Kind, DefIndex, Tile, Position, Repeat);
    protected override void WritePayload(BinaryWriter w)
    {
        w.Write(CityId); w.Write((byte)Kind); w.Write(DefIndex); w.Write(Tile); w.Write(Position); w.Write(Repeat);
    }
    protected override void ReadPayload(BinaryReader r)
    {
        CityId = r.ReadInt32(); Kind = (ProductionKind)r.ReadByte(); DefIndex = r.ReadInt32(); Tile = r.ReadInt32(); Position = r.ReadInt32(); Repeat = r.ReadBoolean();
    }
}

public sealed class RemoveQueueItemCommand : GameCommand
{
    public int CityId, Index;
    public override CommandType Type => CommandType.RemoveQueueItem;
    public override string? Validate(GameState s) =>
        OwnCity(s, CityId) is not { } c ? "Not your city." : Index < 0 || Index >= c.Queue.Items.Count ? "Invalid index." : null;
    public override void Apply(GameState s, List<GameEvent> events) => ProductionSystem.Remove(s, s.GetCity(CityId)!, Index);
    protected override void WritePayload(BinaryWriter w) { w.Write(CityId); w.Write(Index); }
    protected override void ReadPayload(BinaryReader r) { CityId = r.ReadInt32(); Index = r.ReadInt32(); }
}

public sealed class MoveQueueItemCommand : GameCommand
{
    public int CityId, From, To;
    public override CommandType Type => CommandType.MoveQueueItem;
    public override string? Validate(GameState s) =>
        OwnCity(s, CityId) is not { } c ? "Not your city."
        : From < 0 || From >= c.Queue.Items.Count || To < 0 || To >= c.Queue.Items.Count ? "Invalid index." : null;
    public override void Apply(GameState s, List<GameEvent> events) => ProductionSystem.Move(s.GetCity(CityId)!, From, To);
    protected override void WritePayload(BinaryWriter w) { w.Write(CityId); w.Write(From); w.Write(To); }
    protected override void ReadPayload(BinaryReader r) { CityId = r.ReadInt32(); From = r.ReadInt32(); To = r.ReadInt32(); }
}

/// <summary>Gold purchase of a unit or building (districts and projects must be built).</summary>
public sealed class PurchaseCommand : GameCommand
{
    public int CityId, DefIndex;
    public ProductionKind Kind;
    public override CommandType Type => CommandType.Purchase;
    public override string? Validate(GameState s)
    {
        if (OwnCity(s, CityId) is not { } c) return "Not your city.";
        if (Kind is not (ProductionKind.Unit or ProductionKind.Building)) return "Only units and buildings can be purchased.";
        int queued = c.Queue.Items.FindIndex(q => q.Kind == Kind && q.DefIndex == DefIndex);
        int uid = queued >= 0 ? c.Queue.Items[queued].Uid : -1;
        if ((ProductionSystem.Validate(s, c, Kind, DefIndex, -1, uid) ?? ProductionSystem.ResourceShortfall(s, s.Players[Player], Kind, DefIndex)) is { } err) return err;
        return s.Players[Player].Gold < ProductionSystem.PurchaseCost(s, c, Kind, DefIndex) ? "Not enough gold." : null;
    }
    public override void Apply(GameState s, List<GameEvent> events)
    {
        var c = s.GetCity(CityId)!;
        var price = ProductionSystem.PurchaseCost(s, c, Kind, DefIndex);
        s.Players[Player].Gold -= price;
        NationSystem.OnPurchase(s, s.Players[Player], price);
        var item = new QueueItem { Kind = Kind, DefIndex = DefIndex };
        c.ProgressLedger.Remove(item.ProgressKey);
        int queued = c.Queue.Items.FindIndex(q => q.Kind == Kind && q.DefIndex == DefIndex);
        if (queued >= 0) ProductionSystem.Remove(s, c, queued);
        ProductionSystem.Complete(s, c, item, events);
    }
    protected override void WritePayload(BinaryWriter w) { w.Write(CityId); w.Write((byte)Kind); w.Write(DefIndex); }
    protected override void ReadPayload(BinaryReader r) { CityId = r.ReadInt32(); Kind = (ProductionKind)r.ReadByte(); DefIndex = r.ReadInt32(); }
}

public sealed class SetResearchCommand : GameCommand
{
    public int Tech;
    public override CommandType Type => CommandType.SetResearch;
    public override string? Validate(GameState s) =>
        Issuer(s) is not { } p ? "Invalid player." : Tech < 0 || Tech >= s.Db.Techs.Count ? "Unknown technology."
        : DivergenceSystem.LockReason(s.Db, p, s.Db.Techs[Tech]) is { } locked ? locked
        : !ResearchSystem.CanResearch(p, s.Db.Techs[Tech]) ? "Prerequisites not met." : null;
    public override void Apply(GameState s, List<GameEvent> events) => s.Players[Player].CurrentTech = Tech;
    protected override void WritePayload(BinaryWriter w) => w.Write(Tech);
    protected override void ReadPayload(BinaryReader r) => Tech = r.ReadInt32();
}

public sealed class SetCivicCommand : GameCommand
{
    public int Civic;
    public override CommandType Type => CommandType.SetCivic;
    public override string? Validate(GameState s) =>
        Issuer(s) is not { } p ? "Invalid player." : Civic < 0 || Civic >= s.Db.Civics.Count ? "Unknown civic."
        : DivergenceSystem.LockReason(s.Db, p, s.Db.Civics[Civic]) is { } locked ? locked
        : !ResearchSystem.CanStudy(p, s.Db.Civics[Civic]) ? "Prerequisites not met." : null;
    public override void Apply(GameState s, List<GameEvent> events) => s.Players[Player].CurrentCivic = Civic;
    protected override void WritePayload(BinaryWriter w) => w.Write(Civic);
    protected override void ReadPayload(BinaryReader r) => Civic = r.ReadInt32();
}

public sealed class AppointGovernorCommand : GameCommand
{
    public int Governor;
    public override CommandType Type => CommandType.AppointGovernor;
    public override string? Validate(GameState s) => Issuer(s) is not { } p ? "Invalid player." : GovernorSystem.ValidateAppoint(s, p, Governor);
    public override void Apply(GameState s, List<GameEvent> events) => GovernorSystem.Appoint(s.Players[Player], Governor);
    protected override void WritePayload(BinaryWriter w) => w.Write(Governor);
    protected override void ReadPayload(BinaryReader r) => Governor = r.ReadInt32();
}

public sealed class PromoteGovernorCommand : GameCommand
{
    public int Governor, Promotion;
    public override CommandType Type => CommandType.PromoteGovernor;
    public override string? Validate(GameState s) => Issuer(s) is not { } p ? "Invalid player." : GovernorSystem.ValidatePromote(s, p, Governor, Promotion);
    public override void Apply(GameState s, List<GameEvent> events) => GovernorSystem.Promote(s.Players[Player], Governor, Promotion);
    protected override void WritePayload(BinaryWriter w) { w.Write(Governor); w.Write(Promotion); }
    protected override void ReadPayload(BinaryReader r) { Governor = r.ReadInt32(); Promotion = r.ReadInt32(); }
}

public sealed class AssignGovernorCommand : GameCommand
{
    public int Governor, CityId = -1;
    public override CommandType Type => CommandType.AssignGovernor;
    public override string? Validate(GameState s) => Issuer(s) is not { } p ? "Invalid player." : GovernorSystem.ValidateAssign(s, p, Governor, CityId);
    public override void Apply(GameState s, List<GameEvent> events) => GovernorSystem.Assign(s, s.Players[Player], Governor, CityId);
    protected override void WritePayload(BinaryWriter w) { w.Write(Governor); w.Write(CityId); }
    protected override void ReadPayload(BinaryReader r) { Governor = r.ReadInt32(); CityId = r.ReadInt32(); }
}

public sealed class SetDispatchPolicyCommand : GameCommand
{
    public PowerDispatchPolicy Policy;
    public override CommandType Type => CommandType.SetDispatchPolicy;
    public override string? Validate(GameState s) => Issuer(s) == null ? "Invalid player." : null;
    public override void Apply(GameState s, List<GameEvent> events) => s.Players[Player].DispatchPolicy = Policy;
    protected override void WritePayload(BinaryWriter w) => w.Write((byte)Policy);
    protected override void ReadPayload(BinaryReader r) => Policy = (PowerDispatchPolicy)r.ReadByte();
}

public sealed class SetPowerPriorityCommand : GameCommand
{
    public int CityId, Priority;
    public override CommandType Type => CommandType.SetPowerPriority;
    public override string? Validate(GameState s) => OwnCity(s, CityId) == null ? "Not your city." : null;
    public override void Apply(GameState s, List<GameEvent> events) => s.GetCity(CityId)!.PowerPriority = Priority;
    protected override void WritePayload(BinaryWriter w) { w.Write(CityId); w.Write(Priority); }
    protected override void ReadPayload(BinaryReader r) { CityId = r.ReadInt32(); Priority = r.ReadInt32(); }
}

/// <summary>After a victory: keep playing. Any living civilization (or the host) may choose it; no further victory is awarded.</summary>
public sealed class OneMoreTurnCommand : GameCommand
{
    public override CommandType Type => CommandType.OneMoreTurn;
    public override string? Validate(GameState s)
    {
        if (!s.Victory.Decided) return "No one has won yet.";
        if (s.Victory.Continued) return "The game is already continuing.";
        return Player == SystemPlayer || Issuer(s) is { IsFreeCities: false } ? null : "Invalid player.";
    }
    public override void Apply(GameState s, List<GameEvent> events) => s.Victory.Continued = true;
    protected override void WritePayload(BinaryWriter w) { }
    protected override void ReadPayload(BinaryReader r) { }
}

/// <summary>Waymakers plant an Outpost where they stand.</summary>
public sealed class FoundOutpostCommand : GameCommand
{
    public int UnitId;
    public override CommandType Type => CommandType.FoundOutpost;
    public override string? Validate(GameState s) => OwnUnit(s, UnitId) is not { } u ? "Not your unit." : OutpostSystem.ValidateFound(s, Player, u);
    public override void Apply(GameState s, List<GameEvent> events)
    {
        var u = s.GetUnit(UnitId)!;
        OutpostSystem.Found(s, Player, u.Tile, events);
        s.RemoveUnit(u);
    }
    protected override void WritePayload(BinaryWriter w) => w.Write(UnitId);
    protected override void ReadPayload(BinaryReader r) => UnitId = r.ReadInt32();
}

/// <summary>Buy an Outpost up into a city.</summary>
public sealed class PromoteOutpostCommand : GameCommand
{
    public int OutpostId;
    public override CommandType Type => CommandType.PromoteOutpost;
    public override string? Validate(GameState s) =>
        s.Outposts.Find(o => o.Id == OutpostId) is not { } o || o.Owner != Player ? "Not your outpost." : OutpostSystem.ValidatePromote(s, o);
    public override void Apply(GameState s, List<GameEvent> events) => OutpostSystem.Promote(s, s.Outposts.Find(o => o.Id == OutpostId)!, events);
    protected override void WritePayload(BinaryWriter w) => w.Write(OutpostId);
    protected override void ReadPayload(BinaryReader r) => OutpostId = r.ReadInt32();
}

/// <summary>Venice's Ledger: buy a Free City or a disloyal foreign city for gold (NationSystem.CanBuy explains the rules).</summary>
public sealed class BuyCityCommand : GameCommand
{
    public int CityId;
    public override CommandType Type => CommandType.BuyCity;
    public override string? Validate(GameState s) =>
        s.GetCity(CityId) is not { } c ? "No such city." : NationSystem.CanBuy(s, s.Players[Player], c);
    public override void Apply(GameState s, List<GameEvent> events) => NationSystem.Buy(s, s.Players[Player], s.GetCity(CityId)!, events);
    protected override void WritePayload(BinaryWriter w) => w.Write(CityId);
    protected override void ReadPayload(BinaryReader r) => CityId = r.ReadInt32();
}
