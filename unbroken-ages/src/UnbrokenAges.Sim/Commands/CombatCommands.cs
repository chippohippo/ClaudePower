using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Sim.Commands;

/// <summary>Melee or ranged attack (chosen by the unit's type); the host resolves it with the shared combat RNG stream.</summary>
public sealed class AttackCommand : GameCommand
{
    public int UnitId, TargetTile;
    public override CommandType Type => CommandType.Attack;
    public override string? Validate(GameState s) =>
        OwnUnit(s, UnitId) is not { } u ? "Not your unit." : CombatSystem.Preview(s, u, TargetTile) is { Legal: false } p ? p.Reason : null;
    public override void Apply(GameState s, List<GameEvent> events) => CombatSystem.Resolve(s, s.GetUnit(UnitId)!, TargetTile, events);
    protected override void WritePayload(BinaryWriter w) { w.Write(UnitId); w.Write(TargetTile); }
    protected override void ReadPayload(BinaryReader r) { UnitId = r.ReadInt32(); TargetTile = r.ReadInt32(); }
}

public sealed class FortifyCommand : GameCommand
{
    public int UnitId;
    public override CommandType Type => CommandType.Fortify;
    public override string? Validate(GameState s) =>
        OwnUnit(s, UnitId) is not { } u ? "Not your unit." : !SupplySystem.IsMilitary(s.Db, u) ? "Only military units fortify." : null;
    public override void Apply(GameState s, List<GameEvent> events)
    {
        var u = s.GetUnit(UnitId)!;
        u.Fortified = true;
        u.Destination = -1;
    }
    protected override void WritePayload(BinaryWriter w) => w.Write(UnitId);
    protected override void ReadPayload(BinaryReader r) => UnitId = r.ReadInt32();
}

public sealed class CityStrikeCommand : GameCommand
{
    public int CityId, TargetTile;
    public override CommandType Type => CommandType.CityStrike;
    public override string? Validate(GameState s) =>
        OwnCity(s, CityId) is not { } c ? "Not your city." : CombatSystem.ValidateCityStrike(s, c, TargetTile);
    public override void Apply(GameState s, List<GameEvent> events) => CombatSystem.CityStrike(s, s.GetCity(CityId)!, TargetTile, events);
    protected override void WritePayload(BinaryWriter w) { w.Write(CityId); w.Write(TargetTile); }
    protected override void ReadPayload(BinaryReader r) { CityId = r.ReadInt32(); TargetTile = r.ReadInt32(); }
}

/// <summary>Buy an unclaimed tile touching a city's borders.</summary>
public sealed class PurchaseTileCommand : GameCommand
{
    public int CityId, Tile;
    public override CommandType Type => CommandType.PurchaseTile;
    public override string? Validate(GameState s) => OwnCity(s, CityId) is not { } c ? "Not your city." : BorderSystem.ValidatePurchase(s, c, Tile);
    public override void Apply(GameState s, List<GameEvent> events) => BorderSystem.Purchase(s, s.GetCity(CityId)!, Tile, events);
    protected override void WritePayload(BinaryWriter w) { w.Write(CityId); w.Write(Tile); }
    protected override void ReadPayload(BinaryReader r) { CityId = r.ReadInt32(); Tile = r.ReadInt32(); }
}
