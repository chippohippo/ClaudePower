using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Sim.Commands;

// Society commands: government and policy cards, pantheon and religion, missionaries, unit promotions.

public sealed class SetGovernmentCommand : GameCommand
{
    public int Government;
    public override CommandType Type => CommandType.SetGovernment;
    public override string? Validate(GameState s) => Issuer(s) is not { } p ? "Not a player." : SocietySystem.CanAdopt(s, p, Government);
    public override void Apply(GameState s, List<GameEvent> events) => SocietySystem.Adopt(s, s.Players[Player], Government, events);
    protected override void WritePayload(BinaryWriter w) => w.Write(Government);
    protected override void ReadPayload(BinaryReader r) => Government = r.ReadInt32();
}

public sealed class SetPoliciesCommand : GameCommand
{
    public List<int> Policies = new();
    public override CommandType Type => CommandType.SetPolicies;
    public override string? Validate(GameState s) => Issuer(s) is not { } p ? "Not a player." : SocietySystem.CanSetPolicies(s, p, Policies);
    public override void Apply(GameState s, List<GameEvent> events) => SocietySystem.SetPolicies(s, s.Players[Player], Policies);
    protected override void WritePayload(BinaryWriter w)
    {
        w.Write(Policies.Count);
        foreach (int c in Policies) w.Write(c);
    }
    protected override void ReadPayload(BinaryReader r)
    {
        int n = r.ReadInt32();
        if (n < 0 || n > 64) throw new InvalidDataException("Too many policies.");
        Policies = new List<int>(n);
        for (int i = 0; i < n; i++) Policies.Add(r.ReadInt32());
    }
}

public sealed class FoundPantheonCommand : GameCommand
{
    public int Belief;
    public override CommandType Type => CommandType.FoundPantheon;
    public override string? Validate(GameState s) => Issuer(s) is not { } p ? "Not a player." : ReligionSystem.CanFoundPantheon(s, p, Belief);
    public override void Apply(GameState s, List<GameEvent> events) => ReligionSystem.FoundPantheon(s, s.Players[Player], Belief, events);
    protected override void WritePayload(BinaryWriter w) => w.Write(Belief);
    protected override void ReadPayload(BinaryReader r) => Belief = r.ReadInt32();
}

public sealed class FoundReligionCommand : GameCommand
{
    public int Religion, FounderBelief, FollowerBelief;
    public override CommandType Type => CommandType.FoundReligion;
    public override string? Validate(GameState s) =>
        Issuer(s) is not { } p ? "Not a player." : ReligionSystem.CanFoundReligion(s, p, Religion, FounderBelief, FollowerBelief);
    public override void Apply(GameState s, List<GameEvent> events) =>
        ReligionSystem.FoundReligion(s, s.Players[Player], Religion, FounderBelief, FollowerBelief, events);
    protected override void WritePayload(BinaryWriter w) { w.Write(Religion); w.Write(FounderBelief); w.Write(FollowerBelief); }
    protected override void ReadPayload(BinaryReader r) { Religion = r.ReadInt32(); FounderBelief = r.ReadInt32(); FollowerBelief = r.ReadInt32(); }
}

public sealed class SpreadReligionCommand : GameCommand
{
    public int UnitId;
    public override CommandType Type => CommandType.SpreadReligion;
    public override string? Validate(GameState s) => OwnUnit(s, UnitId) is not { } u ? "Not your unit." : ReligionSystem.CanSpread(s, u);
    public override void Apply(GameState s, List<GameEvent> events) => ReligionSystem.Spread(s, s.GetUnit(UnitId)!, events);
    protected override void WritePayload(BinaryWriter w) => w.Write(UnitId);
    protected override void ReadPayload(BinaryReader r) => UnitId = r.ReadInt32();
}

public sealed class PromoteUnitCommand : GameCommand
{
    public int UnitId, Promotion;
    public override CommandType Type => CommandType.PromoteUnit;
    public override string? Validate(GameState s) => OwnUnit(s, UnitId) is not { } u ? "Not your unit." : SocietySystem.CanPromote(s, u, Promotion);
    public override void Apply(GameState s, List<GameEvent> events) => SocietySystem.Promote(s, s.GetUnit(UnitId)!, Promotion, events);
    protected override void WritePayload(BinaryWriter w) { w.Write(UnitId); w.Write(Promotion); }
    protected override void ReadPayload(BinaryReader r) { UnitId = r.ReadInt32(); Promotion = r.ReadInt32(); }
}

public sealed class SendEnvoyCommand : GameCommand
{
    public int CityState;
    public override CommandType Type => CommandType.SendEnvoy;
    public override string? Validate(GameState s) => Issuer(s) is not { } p ? "Not a player." : CityStateSystem.CanSendEnvoy(s, p, CityState);
    public override void Apply(GameState s, List<GameEvent> events) => CityStateSystem.SendEnvoy(s, s.Players[Player], CityState, events);
    protected override void WritePayload(BinaryWriter w) => w.Write(CityState);
    protected override void ReadPayload(BinaryReader r) => CityState = r.ReadInt32();
}

public sealed class EstablishTradeRouteCommand : GameCommand
{
    public int UnitId, DestinationCity;
    public override CommandType Type => CommandType.EstablishTradeRoute;
    public override string? Validate(GameState s) => OwnUnit(s, UnitId) is not { } u ? "Not your unit." : TradeSystem.CanEstablish(s, u, DestinationCity);
    public override void Apply(GameState s, List<GameEvent> events) => TradeSystem.Establish(s, s.GetUnit(UnitId)!, DestinationCity, events);
    protected override void WritePayload(BinaryWriter w) { w.Write(UnitId); w.Write(DestinationCity); }
    protected override void ReadPayload(BinaryReader r) { UnitId = r.ReadInt32(); DestinationCity = r.ReadInt32(); }
}

/// <summary>Send a spy to a city on a mission (Counterintelligence for your own cities), or recall it (Mission = None).</summary>
public sealed class AssignSpyCommand : GameCommand
{
    public int SpyId, CityId = -1;
    public SpyMission Mission;
    public override CommandType Type => CommandType.AssignSpy;
    public override string? Validate(GameState s) => Issuer(s) is not { } p ? "Not a player." : EspionageSystem.CanAssign(s, p, SpyId, CityId, Mission);
    public override void Apply(GameState s, List<GameEvent> events) => EspionageSystem.Assign(s, s.Players[Player], SpyId, CityId, Mission);
    protected override void WritePayload(BinaryWriter w) { w.Write(SpyId); w.Write(CityId); w.Write((byte)Mission); }
    protected override void ReadPayload(BinaryReader r) { SpyId = r.ReadInt32(); CityId = r.ReadInt32(); Mission = (SpyMission)r.ReadByte(); }
}

/// <summary>Cast (or change) a vote on a resolution before the World Congress: option 0 = A, 1 = B; extra votes cost favor.</summary>
public sealed class VoteCommand : GameCommand
{
    public int Resolution, Option, Target = -1, Extra;
    public override CommandType Type => CommandType.Vote;
    public override string? Validate(GameState s) => Issuer(s) is not { } p ? "Not a player." : CongressSystem.CanVote(s, p, Resolution, Option, Target, Extra);
    public override void Apply(GameState s, List<GameEvent> events) => CongressSystem.Vote(s, s.Players[Player], Resolution, Option, Target, Extra);
    protected override void WritePayload(BinaryWriter w) { w.Write(Resolution); w.Write(Option); w.Write(Target); w.Write(Extra); }
    protected override void ReadPayload(BinaryReader r) { Resolution = r.ReadInt32(); Option = r.ReadInt32(); Target = r.ReadInt32(); Extra = r.ReadInt32(); }
}
