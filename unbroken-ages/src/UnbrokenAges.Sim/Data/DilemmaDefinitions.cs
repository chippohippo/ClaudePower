using System.Text.Json.Serialization;
using UnbrokenAges.Sim.Core;

namespace UnbrokenAges.Sim.Data;

// Historic dilemmas (GDD §12.4 "Historic events" and "City demands"): era-appropriate choices with real stakes, written as data
// (content/base/data/dilemmas.json) so modders can add their own. Rules: Systems/DilemmaSystem.cs; design:
// docs/05-key-systems/15-society.md#historic-dilemmas.

/// <summary>What must be true for a dilemma to arise. Each names where it happens (a city) or whom it concerns (another people).</summary>
public enum DilemmaTrigger
{
    /// <summary>The empire as a whole (the capital is named).</summary>
    Empire,
    /// <summary>A city on a river or a lake.</summary>
    RiverCity,
    CoastalCity,
    /// <summary>A city of eight citizens or more.</summary>
    LargeCity,
    /// <summary>A city whose loyalty is below 80.</summary>
    RestlessCity,
    /// <summary>A city that has changed hands in the last 30 turns.</summary>
    NewlyTakenCity,
    /// <summary>At war with another great power (it is the other party).</summary>
    AtWar,
    /// <summary>A great power whose cities lie within reach, at peace with us (it is the other party).</summary>
    Neighbour,
    /// <summary>The empire follows a religion it founded.</summary>
    HasReligion,
    /// <summary>Over 300 gold in the treasury.</summary>
    Wealthy,
    GoldenAge,
    DarkAge,
}

/// <summary>A historic dilemma: a situation and two or three answers, each with its consequences.</summary>
public sealed class DilemmaDef : Definition
{
    public DilemmaTrigger Trigger { get; init; }
    public string? MinEra { get; init; }
    public string? MaxEra { get; init; }
    public int Weight { get; init; } = 10;
    public List<DilemmaOptionDef> Options { get; init; } = new();

    [JsonIgnore] public int MinEraOrder { get; private set; }
    [JsonIgnore] public int MaxEraOrder { get; private set; } = int.MaxValue;

    internal override void Link(LinkContext ctx)
    {
        int min = ctx.Resolve(ctx.Db.Eras, MinEra, this, "minEra");
        int max = ctx.Resolve(ctx.Db.Eras, MaxEra, this, "maxEra");
        if (min >= 0) MinEraOrder = ctx.Db.Eras[min].Order;
        if (max >= 0) MaxEraOrder = ctx.Db.Eras[max].Order;
        if (Options.Count is < 2 or > 3) ctx.Error(this, "a dilemma offers two or three options.");
        foreach (var o in Options)
            foreach (var m in o.Modifiers) m.Link(ctx, this);
    }
}

/// <summary>
/// One answer. Costs and gains are paid at once (negative gold or faith is a cost the empire must afford); modifiers last
/// <see cref="Turns"/> turns in the dilemma's city (or every city with <see cref="EmpireWide"/>).
/// </summary>
public sealed class DilemmaOptionDef
{
    public string Name { get; init; } = "";
    public string? Description { get; init; }
    public int Gold { get; init; }
    public int Faith { get; init; }
    public int Favor { get; init; }
    public int Science { get; init; }
    public int Culture { get; init; }
    public int EraScore { get; init; }
    /// <summary>Loyalty in the dilemma's city (every city when empire-wide).</summary>
    public int Loyalty { get; init; }
    /// <summary>Citizens gained or lost in the dilemma's city.</summary>
    public int Population { get; init; }
    /// <summary>Goodwill (positive) or a grievance (negative) the other party holds toward us.</summary>
    public int Relations { get; init; }
    public int WarWeariness { get; init; }
    public Fx Progress { get; init; }
    public Fx Strife { get; init; }
    public Fx Calamity { get; init; }
    public List<ModifierDef> Modifiers { get; init; } = new();
    public int Turns { get; init; } = 10;
    public bool EmpireWide { get; init; }
}
