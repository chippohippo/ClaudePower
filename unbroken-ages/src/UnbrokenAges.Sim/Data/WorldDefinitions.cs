using System.Text.Json.Serialization;

namespace UnbrokenAges.Sim.Data;

// The wider world: city-states (docs/05-key-systems/16-city-states.md).

public enum CityStateType { Scientific, Cultural, Trade, Religious, Industrial, Militaristic }

/// <summary>A city-state: a minor power of one city. Envoys sent to it pay its type's bonus; its suzerain gets its unique bonus.</summary>
public sealed class CityStateDef : Definition
{
    public CityStateType Type { get; init; }
    public string Color { get; init; } = "#cccccc";
    /// <summary>The suzerain's bonus: modifiers applied to every city of the suzerain (UnitStrength reaches its units).</summary>
    public AbilityDef Suzerain { get; init; } = new();

    internal override void Link(LinkContext ctx) => Suzerain.Link(ctx, this);
}
