using UnbrokenAges.Sim.Core;

namespace UnbrokenAges.Sim.State;

public enum DiploStatus : byte { Peace, War, Alliance }

/// <summary>The relationship between two players (A &lt; B). Absent = peace with no history.</summary>
public sealed class Relation
{
    public int A;
    public int B;
    public DiploStatus Status;
    /// <summary>Turn the current status began.</summary>
    public int Since;
    public int DenouncedByA = -1;
    public int DenouncedByB = -1;
    /// <summary>Player who has a peace offer on the table (-1 = none).</summary>
    public int PeaceProposedBy = -1;
    /// <summary>A lets B's military units cross A's territory.</summary>
    public bool AGrantsB;
    public bool BGrantsA;
}

/// <summary>An itemized, decaying reason for one leader to resent another (always visible in the UI).</summary>
public sealed class Grievance
{
    public int Holder;
    public int Against;
    public Fx Amount;
    public int Turn;
    public string Reason = "";
}
