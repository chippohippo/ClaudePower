using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Commands;

public enum CommandType : byte
{
    EndTurn = 1,
    AdvanceTurn = 2,
    MoveUnit = 10,
    FoundCity = 11,
    BuildImprovement = 12,
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
        _ => throw new InvalidDataException($"Unknown command type {(byte)type}."),
    };

    public override string ToString() => $"{Type}(p{Player})";
}

public static class CommandProcessor
{
    public static CommandResult Execute(GameState s, GameCommand cmd, List<GameEvent> events)
    {
        string? error = cmd.Validate(s);
        if (error != null) return CommandResult.Fail(error);
        cmd.Apply(s, events);
        return CommandResult.Success;
    }
}
