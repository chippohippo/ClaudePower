namespace UnbrokenAges.Sim.State;

public enum ProductionKind : byte { Unit, Building, District, Project }

public sealed class QueueItem
{
    public int Uid;
    public ProductionKind Kind;
    public int DefIndex;
    /// <summary>Target tile for districts (reserved on the map while queued); -1 otherwise.</summary>
    public int Tile = -1;
    /// <summary>Re-queue at the back after completion (e.g. keep producing builders/trade units).</summary>
    public bool Repeat;

    public long ProgressKey => MakeKey(Kind, DefIndex, Tile);

    public static long MakeKey(ProductionKind kind, int def, int tile) =>
        ((long)kind << 56) | ((long)(def & 0xFFFFFF) << 32) | (uint)(tile + 1);
}

/// <summary>
/// First-class production queue (the #1 "everyone installs a mod for it" request).
/// Pure state; behaviour lives in Systems/ProductionSystem.cs.
/// </summary>
public sealed class ProductionQueue
{
    public List<QueueItem> Items = new();
    public int NextUid = 1;

    public QueueItem? Front => Items.Count > 0 ? Items[0] : null;
}
