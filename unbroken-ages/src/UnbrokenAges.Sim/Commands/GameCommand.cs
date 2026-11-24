using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Sim.Commands;

public enum CommandType : byte
{
    EndTurn = 1,
    AdvanceTurn = 2,
    MoveUnit = 10,
    FoundCity = 11,
    BuildImprovement = 12,
    FoundOutpost = 13,
    PromoteOutpost = 14,
    UpgradeUnit = 15,
    Enqueue = 20,
    RemoveQueueItem = 21,
    MoveQueueItem = 22,
    Purchase = 23,
    SetResearch = 30,
    SetCivic = 31,
    AppointGovernor = 40,
    PromoteGovernor = 41,
    AssignGovernor = 42,
    SetDispatchPolicy = 50,
    SetPowerPriority = 51,
    Denounce = 60,
    DeclareWar = 61,
    ProposePeace = 62,
    AcceptPeace = 63,
    SetOpenBorders = 64,
    Attack = 70,
    Fortify = 71,
    CityStrike = 72,
    PurchaseTile = 73,
    BuyCity = 74,
    OneMoreTurn = 80,
    SetGovernment = 90,
    SetPolicies = 91,
    FoundPantheon = 92,
    FoundReligion = 93,
    SpreadReligion = 94,
    PromoteUnit = 95,
    SendEnvoy = 96,
    EstablishTradeRoute = 97,
}

public readonly record struct CommandResult(bool Ok, string? Error)
{
    public static readonly CommandResult Success = new(true, null);
    public static CommandResult Fail(string error) => new(false, error);
}

/// <summary>
/// Every change to the simulation is a command: player intent, validated against the current
/// state, then applied deterministically. Commands are tiny (bytes, not state), which is what
/// makes deterministic multiplayer, replays, autosave-by-log and single-player undo cheap.
/// </summary>
public abstract class GameCommand
{
    /// <summary>Issuer used by the host for turn advancement and other authoritative actions.</summary>
    public const int SystemPlayer = -1;

    public int Player { get; set; }
    public abstract CommandType Type { get; }

    /// <summary>Returns null when the command is legal for <see cref="Player"/> in state <paramref name="s"/>.</summary>
    public abstract string? Validate(GameState s);
    public abstract void Apply(GameState s, List<GameEvent> events);

    protected abstract void WritePayload(BinaryWriter w);
    protected abstract void ReadPayload(BinaryReader r);

    protected PlayerState? Issuer(GameState s) =>
        Player >= 0 && Player < s.Players.Count && s.Players[Player].IsAlive ? s.Players[Player] : null;

    protected CityState? OwnCity(GameState s, int cityId) =>
        s.GetCity(cityId) is { } c && c.Owner == Player ? c : null;

    protected UnitState? OwnUnit(GameState s, int unitId) =>
        s.GetUnit(unitId) is { } u && u.Owner == Player ? u : null;

    public byte[] Serialize()
    {
        using var ms = new MemoryStream();
        using var w = new BinaryWriter(ms);
        w.Write((byte)Type);
        w.Write(Player);
        WritePayload(w);
        w.Flush();
        return ms.ToArray();
    }

    public static GameCommand Deserialize(byte[] data)
    {
        using var r = new BinaryReader(new MemoryStream(data));
        var type = (CommandType)r.ReadByte();
        var cmd = Create(type);
        cmd.Player = r.ReadInt32();
        cmd.ReadPayload(r);
        return cmd;
    }

    private static GameCommand Create(CommandType type) => type switch
    {
        CommandType.EndTurn => new EndTurnCommand(),
        CommandType.AdvanceTurn => new AdvanceTurnCommand(),
        CommandType.MoveUnit => new MoveUnitCommand(),
        CommandType.FoundCity => new FoundCityCommand(),
        CommandType.BuildImprovement => new BuildImprovementCommand(),
        CommandType.Enqueue => new EnqueueCommand(),
        CommandType.RemoveQueueItem => new RemoveQueueItemCommand(),
        CommandType.MoveQueueItem => new MoveQueueItemCommand(),
        CommandType.Purchase => new PurchaseCommand(),
        CommandType.SetResearch => new SetResearchCommand(),
        CommandType.SetCivic => new SetCivicCommand(),
        CommandType.AppointGovernor => new AppointGovernorCommand(),
        CommandType.PromoteGovernor => new PromoteGovernorCommand(),
        CommandType.AssignGovernor => new AssignGovernorCommand(),
        CommandType.SetDispatchPolicy => new SetDispatchPolicyCommand(),
        CommandType.SetPowerPriority => new SetPowerPriorityCommand(),
        CommandType.Denounce => new DenounceCommand(),
        CommandType.DeclareWar => new DeclareWarCommand(),
        CommandType.ProposePeace => new ProposePeaceCommand(),
        CommandType.AcceptPeace => new AcceptPeaceCommand(),
        CommandType.SetOpenBorders => new SetOpenBordersCommand(),
        CommandType.Attack => new AttackCommand(),
        CommandType.Fortify => new FortifyCommand(),
        CommandType.CityStrike => new CityStrikeCommand(),
        CommandType.PurchaseTile => new PurchaseTileCommand(),
        CommandType.BuyCity => new BuyCityCommand(),
        CommandType.OneMoreTurn => new OneMoreTurnCommand(),
        CommandType.FoundOutpost => new FoundOutpostCommand(),
        CommandType.PromoteOutpost => new PromoteOutpostCommand(),
        CommandType.UpgradeUnit => new UpgradeUnitCommand(),
        CommandType.SetGovernment => new SetGovernmentCommand(),
        CommandType.SetPolicies => new SetPoliciesCommand(),
        CommandType.FoundPantheon => new FoundPantheonCommand(),
        CommandType.FoundReligion => new FoundReligionCommand(),
        CommandType.SpreadReligion => new SpreadReligionCommand(),
        CommandType.PromoteUnit => new PromoteUnitCommand(),
        CommandType.SendEnvoy => new SendEnvoyCommand(),
        CommandType.EstablishTradeRoute => new EstablishTradeRouteCommand(),
        _ => throw new InvalidDataException($"Unknown command type {(byte)type}."),
    };

    public override string ToString() => $"{Type}(p{Player})";
}

public static class CommandProcessor
{
    public static CommandResult Execute(GameState s, GameCommand cmd, List<GameEvent> events)
    {
        if (s.Victory.AwaitingChoice && cmd.Type != CommandType.OneMoreTurn)
            return CommandResult.Fail("The game has been won. Choose One More Turn to keep playing.");
        string? error = cmd.Validate(s);
        if (error != null) return CommandResult.Fail(error);
        int from = events.Count;
        cmd.Apply(s, events);
        // World-level consequences of whatever just happened, identically on every peer.
        WorldSystem.Push(s, events, from);
        DiplomacySystem.OnEvents(s, events, from);
        VictorySystem.Check(s, events, endOfTurn: false);   // e.g. the capture that completes Hegemony
        if (cmd.Player >= 0) VisibilitySystem.Reveal(s, cmd.Player);
        else VisibilitySystem.RevealAll(s);                  // turn end: everyone's units moved
        ChronicleSystem.Record(s, events, from);
        return CommandResult.Success;
    }
}
