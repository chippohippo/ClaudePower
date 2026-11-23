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
