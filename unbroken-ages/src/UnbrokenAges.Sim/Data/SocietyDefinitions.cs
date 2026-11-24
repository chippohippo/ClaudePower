using System.Text.Json.Serialization;

namespace UnbrokenAges.Sim.Data;

// Society: the staples of the genre that shape a civilization beyond its cities — governments and policy cards, religion,
// great people, unit promotions. Content lives in content/base/data/society.json; rules in Systems/SocietySystem.cs and
// friends. Design: docs/05-key-systems/15-society.md.

public enum PolicySlot { Military, Economic, Diplomatic, Wildcard }

/// <summary>A government: its policy slots, its legacy bonus, and the civic that unlocks it.</summary>
public sealed class GovernmentDef : Definition
{
    public string? PrereqCivic { get; init; }
    public int Military { get; init; }
    public int Economic { get; init; }
    public int Diplomatic { get; init; }
    public int Wildcard { get; init; }
    public List<ModifierDef> Modifiers { get; init; } = new();

    [JsonIgnore] public int PrereqCivicIndex { get; private set; } = -1;

    public int Slots(PolicySlot slot) => slot switch
    {
        PolicySlot.Military => Military,
        PolicySlot.Economic => Economic,
        PolicySlot.Diplomatic => Diplomatic,
        _ => Wildcard,
    };

    internal override void Link(LinkContext ctx)
    {
        PrereqCivicIndex = ctx.Resolve(ctx.Db.Civics, PrereqCivic, this, "prereqCivic");
        foreach (var m in Modifiers) m.Link(ctx, this);
    }
}

/// <summary>A policy card. Slotted cards apply their modifiers to every city (and, for UnitStrength, to units).</summary>
public sealed class PolicyDef : Definition
{
    public PolicySlot Slot { get; init; }
    public string? PrereqCivic { get; init; }
    public string? PrereqTech { get; init; }
    public List<ModifierDef> Modifiers { get; init; } = new();

    [JsonIgnore] public int PrereqCivicIndex { get; private set; } = -1;
    [JsonIgnore] public int PrereqTechIndex { get; private set; } = -1;

    internal override void Link(LinkContext ctx)
    {
        PrereqCivicIndex = ctx.Resolve(ctx.Db.Civics, PrereqCivic, this, "prereqCivic");
        PrereqTechIndex = ctx.Resolve(ctx.Db.Techs, PrereqTech, this, "prereqTech");
        foreach (var m in Modifiers) m.Link(ctx, this);
    }
}

public enum BeliefKind { Pantheon, Founder, Follower }

/// <summary>
/// A belief. Pantheon and Follower beliefs apply their modifiers to cities (the pantheon to its owner's cities, followers to
/// every city that follows the religion, whoever owns it). Founder beliefs pay the founder per follower city.
/// </summary>
public sealed class BeliefDef : Definition
{
    public BeliefKind Kind { get; init; }
    public List<ModifierDef> Modifiers { get; init; } = new();
    /// <summary>Founder beliefs: yields to the founder's capital for each city (anywhere) following the religion.</summary>
    public YieldSet PerFollowerCity { get; init; }

    internal override void Link(LinkContext ctx)
    {
        foreach (var m in Modifiers) m.Link(ctx, this);
    }
}

/// <summary>A religion's name (the founder picks one that no one has taken).</summary>
public sealed class ReligionDef : Definition
{
    public string Color { get; init; } = "#ffffff";
}

public enum GreatPersonClass { Scientist, Engineer, Merchant, Artist, Prophet, General, Admiral }

public enum GreatPersonEffectKind { Science, Culture, Production, Gold, Faith, Heal, Loyalty }

/// <summary>A named great person: recruited by the first civilization to gather enough points of their class.</summary>
public sealed class GreatPersonDef : Definition
{
    public GreatPersonClass Class { get; init; }
    public string? Era { get; init; }
    public GreatPersonEffectKind Effect { get; init; }
    public int Amount { get; init; }
    /// <summary>Artists: the great works they create when recruited (named; at least one is always made).</summary>
    public List<string> Works { get; init; } = new();

    [JsonIgnore] public int EraOrder { get; private set; }

    internal override void Link(LinkContext ctx)
    {
        int era = ctx.Resolve(ctx.Db.Eras, Era, this, "era");
        EraOrder = era >= 0 ? ctx.Db.Eras[era].Order : 0;
    }
}

/// <summary>A unit promotion, earned with experience and chosen by the player.</summary>
public sealed class PromotionDef : Definition
{
    /// <summary>Unit classes that may take it (empty: any military unit).</summary>
    public List<string> Classes { get; init; } = new();
    public int Tier { get; init; } = 1;
    public int Strength { get; init; }
    public int Defense { get; init; }
    public int Moves { get; init; }
    /// <summary>Extra strength attacking cities.</summary>
    public int VsCity { get; init; }
    /// <summary>Extra strength fighting in forest, rainforest, marsh or hills.</summary>
    public int Terrain { get; init; }
    public int HealPerTurn { get; init; }
}
