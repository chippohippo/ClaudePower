using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Sim.Commands;

/// <summary>Base for commands aimed at one other player.</summary>
public abstract class TargetedCommand : GameCommand
{
    public int Target;
    protected override void WritePayload(BinaryWriter w) => w.Write(Target);
    protected override void ReadPayload(BinaryReader r) => Target = r.ReadInt32();
    protected string? Alive(GameState s) => Issuer(s) == null ? "Invalid player." : null;
}

public sealed class DenounceCommand : TargetedCommand
{
    public override CommandType Type => CommandType.Denounce;
    public override string? Validate(GameState s) => Alive(s) ?? DiplomacySystem.ValidateDenounce(s, Player, Target);
    public override void Apply(GameState s, List<GameEvent> events) => DiplomacySystem.Denounce(s, Player, Target, events);
}

public sealed class DeclareWarCommand : TargetedCommand
{
    public override CommandType Type => CommandType.DeclareWar;
    public override string? Validate(GameState s) => Alive(s) ?? DiplomacySystem.ValidateDeclareWar(s, Player, Target);
    public override void Apply(GameState s, List<GameEvent> events) => DiplomacySystem.DeclareWar(s, Player, Target, events);
}

public sealed class ProposePeaceCommand : TargetedCommand
{
    public override CommandType Type => CommandType.ProposePeace;
    public override string? Validate(GameState s) => Alive(s) ?? DiplomacySystem.ValidateProposePeace(s, Player, Target);
    public override void Apply(GameState s, List<GameEvent> events) => DiplomacySystem.ProposePeace(s, Player, Target, events);
}

/// <summary>Target = the player whose offer is accepted.</summary>
public sealed class AcceptPeaceCommand : TargetedCommand
{
    public override CommandType Type => CommandType.AcceptPeace;
    public override string? Validate(GameState s) => Alive(s) ?? DiplomacySystem.ValidateAcceptPeace(s, Player, Target);
    public override void Apply(GameState s, List<GameEvent> events) => DiplomacySystem.AcceptPeace(s, Player, Target, events);
}

/// <summary>Grant (or revoke) the target's military passage through the issuer's territory.</summary>
public sealed class SetOpenBordersCommand : TargetedCommand
{
    public bool Open = true;
    public override CommandType Type => CommandType.SetOpenBorders;
    public override string? Validate(GameState s) =>
        Alive(s) ?? (Target < 0 || Target >= s.Players.Count || Target == Player ? "Invalid target."
            : DiplomacySystem.AtWar(s, Player, Target) ? "Not while at war." : null);
    public override void Apply(GameState s, List<GameEvent> events) => DiplomacySystem.SetOpenBorders(s, Player, Target, Open, events);
    protected override void WritePayload(BinaryWriter w) { base.WritePayload(w); w.Write(Open); }
    protected override void ReadPayload(BinaryReader r) { base.ReadPayload(r); Open = r.ReadBoolean(); }
}

/// <summary>Put a deal on the table for <see cref="TargetedCommand.Target"/> (it replaces any earlier offer to them).</summary>
public sealed class ProposeDealCommand : TargetedCommand
{
    public List<DealItemState> Items = new();
    public override CommandType Type => CommandType.ProposeDeal;
    public override string? Validate(GameState s) => Alive(s) ?? DealSystem.Validate(s, Player, Target, Items);
    public override void Apply(GameState s, List<GameEvent> events) => DealSystem.Propose(s, Player, Target, Items, events);
    protected override void WritePayload(BinaryWriter w)
    {
        base.WritePayload(w);
        w.Write(Items.Count);
        foreach (var i in Items) { w.Write((byte)i.Kind); w.Write(i.Giver); w.Write(i.Amount); w.Write(i.Target); }
    }
    protected override void ReadPayload(BinaryReader r)
    {
        base.ReadPayload(r);
        int n = r.ReadInt32();
        if (n < 0 || n > DealSystem.MaxItems) throw new InvalidDataException("Too many deal items.");
        Items = new List<DealItemState>(n);
        for (int k = 0; k < n; k++)
            Items.Add(new DealItemState { Kind = (DealItemKind)r.ReadByte(), Giver = r.ReadInt32(), Amount = r.ReadInt32(), Target = r.ReadInt32() });
    }
}

/// <summary>Accept or reject the offer <see cref="DealId"/> addressed to the issuer.</summary>
public sealed class RespondDealCommand : GameCommand
{
    public int DealId;
    public bool Accept;
    public override CommandType Type => CommandType.RespondDeal;
    public override string? Validate(GameState s) => Issuer(s) == null ? "Invalid player." : DealSystem.ValidateRespond(s, Player, DealId, Accept);
    public override void Apply(GameState s, List<GameEvent> events) => DealSystem.Respond(s, Player, DealId, Accept, events);
    protected override void WritePayload(BinaryWriter w) { w.Write(DealId); w.Write(Accept); }
    protected override void ReadPayload(BinaryReader r) { DealId = r.ReadInt32(); Accept = r.ReadBoolean(); }
}

/// <summary>Leave the alliance with the target.</summary>
public sealed class LeaveAllianceCommand : TargetedCommand
{
    public override CommandType Type => CommandType.LeaveAlliance;
    public override string? Validate(GameState s) => Alive(s) ?? DiplomacySystem.ValidateLeaveAlliance(s, Player, Target);
    public override void Apply(GameState s, List<GameEvent> events) => DiplomacySystem.LeaveAlliance(s, Player, Target, events);
}

/// <summary>Return a city to the people who founded it.</summary>
public sealed class LiberateCityCommand : GameCommand
{
    public int CityId;
    public override CommandType Type => CommandType.LiberateCity;
    public override string? Validate(GameState s) => Issuer(s) == null ? "Invalid player." : DiplomacySystem.ValidateLiberate(s, Player, CityId);
    public override void Apply(GameState s, List<GameEvent> events) => DiplomacySystem.Liberate(s, Player, CityId, events);
    protected override void WritePayload(BinaryWriter w) => w.Write(CityId);
    protected override void ReadPayload(BinaryReader r) => CityId = r.ReadInt32();
}
