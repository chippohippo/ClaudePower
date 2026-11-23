using System.Text.Json.Serialization;
using UnbrokenAges.Sim.Core;

namespace UnbrokenAges.Sim.Data;

// ---------------------------------------------------------------------------------------------
// Definitions are immutable, data-driven records loaded from JSON (see data/base and
// docs/03-data-schemas.md). String references to other definitions are resolved to integer
// indices in Link() so that the simulation never does string lookups in hot paths.
// ---------------------------------------------------------------------------------------------

public enum TerrainClass { Land, Coast, Ocean, Lake, Channel }
public enum ResourceClass { Bonus, Luxury, Strategic, Good }
public enum WorldCurrent { Progress, Strife, Calamity }
public enum DistrictCategory { CityCenter, Specialty, Infrastructure, Wonder }
public enum UnitDomain { Land, Naval, Air, Civilian }
public enum AdjacencyScope { Adjacent, Self }
public enum PowerSourceKind { Renewable, Nuclear, Gas, Oil, Coal }
public enum ProductionCategory { Unit, Building, District, Project, Wonder, Any }
public enum SpecialPlacement { None, Canal }
public enum DisasterKind { RiverFlood, Storm, Drought, Volcano }

public enum ModifierEffect
{
    CityYieldFlat,
    CityYieldPercent,
    CityLoyaltyPerTurn,
    CityPressurePercent,
    CityAmenities,
    CityHousing,
    CityProductionPercent,
    CityDistrictCapacity,
    CityAdjacencyPercent,
    CityPowerOutput,
    CityEmissionsPercent,
    CityDisasterImmunity,
    CityPurchaseDiscountPercent,
    GovernorEstablishTurns,
    BuilderCharges,
    ClimateCo2Reduction,
    PowerRangeBonus,
    /// <summary>Consumed by the espionage system: enemy operations in this city drop this many levels.</summary>
    EspionageDefense,
    /// <summary>Consumed by the espionage system: additional spy capacity for the owner.</summary>
    SpyCapacity,
    /// <summary>Percent change to the food each citizen eats (−100 = citizens do not eat).</summary>
    CitizenFoodUpkeepPercent,
    /// <summary>Percent of production diverted into growth ("fabricated" citizens). Requires power.</summary>
    CityFabricationPercent,
    /// <summary>Power demanded per citizen, in tenths (5 = half a unit of power per citizen).</summary>
    CitizenPowerDemandTenths,
    /// <summary>Project one-shot: lowers the global temperature anomaly directly (geoengineering).</summary>
    ClimateCooling,
    /// <summary>Project one-shot: completes the owner's Divergence (Ascension victory).</summary>
    CompleteAscension,
}

public enum LeaningKind { Building, District, DistrictTag, FeatureTagInBorders, PowerKind, Population, CumulativeEmissions }
public enum TransformKind { Terrain, Feature }

public enum RequirementType
{
    CityHasDistrict,
    CityHasBuilding,
    CityMinPopulation,
    CityIsPowered,
    CityIsCoastal,
    CityOnGreatRiver,
    CityIsCapital,
    PlayerHasTech,
    PlayerHasCivic,
}

public abstract class Definition
{
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public string? Description { get; init; }
    public List<string> Tags { get; init; } = new();

    [JsonIgnore] public int Index { get; internal set; } = -1;
    [JsonIgnore] public string SourceMod { get; internal set; } = "";

    public bool HasTag(string tag) => Tags.Contains(tag, StringComparer.Ordinal);

    internal virtual void Link(LinkContext ctx) { }
}

// ----- Map ---------------------------------------------------------------------------------------

public sealed class TerrainDef : Definition
{
    public TerrainClass Class { get; init; } = TerrainClass.Land;
    public YieldSet Yields { get; init; }
    public int MoveCost { get; init; } = 1;
    public bool FreshWater { get; init; }
    public int Appeal { get; init; }
    /// <summary>Movement cost for land units fording a Great River channel without a bridge.</summary>
    public int FordCost { get; init; }

    [JsonIgnore] public bool IsWater => Class != TerrainClass.Land;
}

public sealed class ReliefDef : Definition
{
    public YieldSet Yields { get; init; }
    public int MoveCost { get; init; } = 1;
    public int Defense { get; init; }
    public bool Impassable { get; init; }
    public int Appeal { get; init; }
}

public sealed class FeatureDef : Definition
{
    public YieldSet Yields { get; init; }
    public int MoveCost { get; init; }
    public int Defense { get; init; }
    public bool Removable { get; init; } = true;
    public bool Impassable { get; init; }
    public bool FreshWater { get; init; }
    public int Appeal { get; init; }
    /// <summary>ppm of CO2 absorbed per tile per turn (forests are carbon sinks).</summary>
    public Fx Co2Absorption { get; init; }
    /// <summary>One-time emissions when the feature is cleared (deforestation).</summary>
    public Fx Co2OnRemoval { get; init; }
    public List<string> ValidTerrains { get; init; } = new();

    [JsonIgnore] public int[] ValidTerrainIndices { get; private set; } = Array.Empty<int>();

    internal override void Link(LinkContext ctx) =>
        ValidTerrainIndices = ctx.ResolveAll(ctx.Db.Terrains, ValidTerrains, this, "validTerrains");
}

public sealed class ResourceDef : Definition
{
    public ResourceClass Class { get; init; }
    public YieldSet Yields { get; init; }
    /// <summary>Relative abundance: placements per 1000 eligible tiles.</summary>
    public int Frequency { get; init; } = 20;
    public List<string> ValidTerrains { get; init; } = new();
    public List<string> ValidFeatures { get; init; } = new();
    public List<string> ValidReliefs { get; init; } = new();
    public string? RevealTech { get; init; }
    /// <summary>Strategic resources accumulate in a stockpile capped by this value per player.</summary>
    public int StockpileCap { get; init; }

    [JsonIgnore] public int[] ValidTerrainIndices { get; private set; } = Array.Empty<int>();
    [JsonIgnore] public int[] ValidFeatureIndices { get; private set; } = Array.Empty<int>();
    [JsonIgnore] public int[] ValidReliefIndices { get; private set; } = Array.Empty<int>();
    [JsonIgnore] public int RevealTechIndex { get; private set; } = -1;

    internal override void Link(LinkContext ctx)
    {
        ValidTerrainIndices = ctx.ResolveAll(ctx.Db.Terrains, ValidTerrains, this, "validTerrains");
        ValidFeatureIndices = ctx.ResolveAll(ctx.Db.Features, ValidFeatures, this, "validFeatures");
        ValidReliefIndices = ctx.ResolveAll(ctx.Db.Reliefs, ValidReliefs, this, "validReliefs");
        RevealTechIndex = ctx.Resolve(ctx.Db.Techs, RevealTech, this, "revealTech");
    }
}

public sealed class ImprovementDef : Definition
{
    public YieldSet Yields { get; init; }
    public List<string> ValidTerrains { get; init; } = new();
    public List<string> ValidReliefs { get; init; } = new();
    public List<string> ValidFeatures { get; init; } = new();
    public List<string> ValidResources { get; init; } = new();
    public bool RequiresResource { get; init; }
    /// <summary>The tile must carry one of ValidFeatures (e.g. a camp needs woods).</summary>
    public bool RequiresFeatureOnTile { get; init; }
    public bool RemovesFeature { get; init; }
    public bool OnWater { get; init; }
    public string? PrereqTech { get; init; }
    public PowerPlantSpec? Power { get; init; }
    public int Appeal { get; init; }
    /// <summary>Remakes the tile's terrain when built (Divergence terraforming).</summary>
    public string? TransformsTerrain { get; init; }
    /// <summary>Places a feature on the tile when built (e.g. seeding the Bloom).</summary>
    public string? AddsFeature { get; init; }

    [JsonIgnore] public int[] ValidTerrainIndices { get; private set; } = Array.Empty<int>();
    [JsonIgnore] public int[] ValidReliefIndices { get; private set; } = Array.Empty<int>();
    [JsonIgnore] public int[] ValidFeatureIndices { get; private set; } = Array.Empty<int>();
    [JsonIgnore] public int[] ValidResourceIndices { get; private set; } = Array.Empty<int>();
    [JsonIgnore] public int PrereqTechIndex { get; private set; } = -1;
    [JsonIgnore] public int TransformsTerrainIndex { get; private set; } = -1;
    [JsonIgnore] public int AddsFeatureIndex { get; private set; } = -1;

    internal override void Link(LinkContext ctx)
    {
        TransformsTerrainIndex = ctx.Resolve(ctx.Db.Terrains, TransformsTerrain, this, "transformsTerrain");
        AddsFeatureIndex = ctx.Resolve(ctx.Db.Features, AddsFeature, this, "addsFeature");
        ValidTerrainIndices = ctx.ResolveAll(ctx.Db.Terrains, ValidTerrains, this, "validTerrains");
        ValidReliefIndices = ctx.ResolveAll(ctx.Db.Reliefs, ValidReliefs, this, "validReliefs");
        ValidFeatureIndices = ctx.ResolveAll(ctx.Db.Features, ValidFeatures, this, "validFeatures");
        ValidResourceIndices = ctx.ResolveAll(ctx.Db.Resources, ValidResources, this, "validResources");
        PrereqTechIndex = ctx.Resolve(ctx.Db.Techs, PrereqTech, this, "prereqTech");
        Power?.Link(ctx, this);
    }
}

public sealed class MapSizeDef : Definition
{
    public int Width { get; init; }
    public int Height { get; init; }
    public int DefaultPlayers { get; init; }
    public int GreatRivers { get; init; }
}

// ----- Districts & adjacency --------------------------------------------------------------------

/// <summary>
/// Matches a tile (and the edge between the evaluated tile and that tile). All specified
/// conditions must hold. Unspecified conditions are ignored.
/// </summary>
public sealed class SourceMatcher
{
    public string? Terrain { get; init; }
    public TerrainClass? TerrainClass { get; init; }
    public string? Relief { get; init; }
    public string? Feature { get; init; }
    public string? FeatureTag { get; init; }
    public string? Resource { get; init; }
    public ResourceClass? ResourceClass { get; init; }
    public bool? HasResource { get; init; }
    public string? District { get; init; }
    public string? DistrictTag { get; init; }
    public bool? AnyDistrict { get; init; }
    public bool? CityCenter { get; init; }
    public string? Improvement { get; init; }
    /// <summary>True when a river runs along the edge shared with the evaluated tile (or, for Self scope, any edge).</summary>
    public bool? RiverEdge { get; init; }
    public bool? FreshWater { get; init; }

    [JsonIgnore] public int TerrainIndex { get; private set; } = -1;
    [JsonIgnore] public int ReliefIndex { get; private set; } = -1;
    [JsonIgnore] public int FeatureIndex { get; private set; } = -1;
    [JsonIgnore] public int ResourceIndex { get; private set; } = -1;
    [JsonIgnore] public int DistrictIndex { get; private set; } = -1;
    [JsonIgnore] public int ImprovementIndex { get; private set; } = -1;

    internal void Link(LinkContext ctx, Definition owner)
    {
        TerrainIndex = ctx.Resolve(ctx.Db.Terrains, Terrain, owner, "source.terrain");
        ReliefIndex = ctx.Resolve(ctx.Db.Reliefs, Relief, owner, "source.relief");
        FeatureIndex = ctx.Resolve(ctx.Db.Features, Feature, owner, "source.feature");
        ResourceIndex = ctx.Resolve(ctx.Db.Resources, Resource, owner, "source.resource");
        DistrictIndex = ctx.Resolve(ctx.Db.Districts, District, owner, "source.district");
        ImprovementIndex = ctx.Resolve(ctx.Db.Improvements, Improvement, owner, "source.improvement");
    }

    public string Describe()
    {
        var parts = new List<string>();
        if (Terrain != null) parts.Add(Terrain);
        if (TerrainClass != null) parts.Add(TerrainClass.ToString()!);
        if (Relief != null) parts.Add(Relief);
        if (Feature != null) parts.Add(Feature);
        if (FeatureTag != null) parts.Add($"#{FeatureTag}");
        if (Resource != null) parts.Add(Resource);
        if (ResourceClass != null) parts.Add($"{ResourceClass} resource");
        if (HasResource == true) parts.Add("any resource");
        if (District != null) parts.Add(District);
        if (DistrictTag != null) parts.Add($"#{DistrictTag} district");
        if (AnyDistrict == true) parts.Add("any district");
        if (CityCenter == true) parts.Add("City Center");
        if (Improvement != null) parts.Add(Improvement);
        if (RiverEdge == true) parts.Add("river");
        if (FreshWater == true) parts.Add("fresh water");
        return string.Join(" + ", parts);
    }
}

public sealed class AdjacencyRule
{
    public YieldType Yield { get; init; }
    public Fx Amount { get; init; } = Fx.One;
    /// <summary>Grant Amount once per this many matching tiles (e.g. +1 per 2 forests).</summary>
    public int Per { get; init; } = 1;
    public AdjacencyScope Scope { get; init; } = AdjacencyScope.Adjacent;
    public SourceMatcher Source { get; init; } = new();
    public string? Label { get; init; }
}

/// <summary>Adjacency a district grants to its neighbours (e.g. a Civic Plaza boosting all adjacent specialty districts).</summary>
public sealed class ProvidedAdjacency
{
    public string? ToTag { get; init; }
    public string? ToDistrict { get; init; }
    /// <summary>Null = the receiving district's primary yield.</summary>
    public YieldType? Yield { get; init; }
    public Fx Amount { get; init; } = Fx.One;
    public string? Label { get; init; }

    [JsonIgnore] public int ToDistrictIndex { get; private set; } = -1;

    internal void Link(LinkContext ctx, Definition owner) =>
        ToDistrictIndex = ctx.Resolve(ctx.Db.Districts, ToDistrict, owner, "providesAdjacency.toDistrict");
}

public sealed class PlacementRules
{
    public bool OnWater { get; init; }
    public List<TerrainClass> AllowedTerrainClasses { get; init; } = new();
    public List<string> AllowedReliefs { get; init; } = new();
    public bool RequiresAdjacentCityCenter { get; init; }
    public bool ForbidAdjacentCityCenter { get; init; }
    /// <summary>At least one neighbour must satisfy at least one of these matchers.</summary>
    public List<SourceMatcher> RequiresAdjacentAny { get; init; } = new();
    public int MinRiverEdges { get; init; }
    public string? RequiresFeature { get; init; }
    public SpecialPlacement Special { get; init; } = SpecialPlacement.None;

    [JsonIgnore] public int[] AllowedReliefIndices { get; private set; } = Array.Empty<int>();
    [JsonIgnore] public int RequiresFeatureIndex { get; private set; } = -1;

    internal void Link(LinkContext ctx, Definition owner)
    {
        AllowedReliefIndices = ctx.ResolveAll(ctx.Db.Reliefs, AllowedReliefs, owner, "placement.allowedReliefs");
        RequiresFeatureIndex = ctx.Resolve(ctx.Db.Features, RequiresFeature, owner, "placement.requiresFeature");
        foreach (var m in RequiresAdjacentAny) m.Link(ctx, owner);
    }
}

public sealed class DistrictDef : Definition
{
    public DistrictCategory Category { get; init; } = DistrictCategory.Specialty;
    public YieldType? PrimaryYield { get; init; }
    public Fx Cost { get; init; }
    public bool CountsTowardLimit { get; init; } = true;
    public int MaxPerCity { get; init; } = 1;
    public bool UniquePerCiv { get; init; }
    public string? PrereqTech { get; init; }
    public string? PrereqCivic { get; init; }
    public string? Civilization { get; init; }
    public string? Replaces { get; init; }
    public PlacementRules Placement { get; init; } = new();
    public List<AdjacencyRule> Adjacency { get; init; } = new();
    public List<ProvidedAdjacency> ProvidesAdjacency { get; init; } = new();
    public YieldSet Yields { get; init; }
    public int Housing { get; init; }
    public int Amenities { get; init; }
    public int Appeal { get; init; }
    public List<ModifierDef> Modifiers { get; init; } = new();

    [JsonIgnore] public int PrereqTechIndex { get; private set; } = -1;
    [JsonIgnore] public int PrereqCivicIndex { get; private set; } = -1;
    [JsonIgnore] public int CivilizationIndex { get; private set; } = -1;
    [JsonIgnore] public int ReplacesIndex { get; private set; } = -1;

    internal override void Link(LinkContext ctx)
    {
        PrereqTechIndex = ctx.Resolve(ctx.Db.Techs, PrereqTech, this, "prereqTech");
        PrereqCivicIndex = ctx.Resolve(ctx.Db.Civics, PrereqCivic, this, "prereqCivic");
        CivilizationIndex = ctx.Resolve(ctx.Db.Civilizations, Civilization, this, "civilization");
        ReplacesIndex = ctx.Resolve(ctx.Db.Districts, Replaces, this, "replaces");
        Placement.Link(ctx, this);
        foreach (var rule in Adjacency) rule.Source.Link(ctx, this);
        foreach (var p in ProvidesAdjacency) p.Link(ctx, this);
        foreach (var m in Modifiers) m.Link(ctx, this);
    }
}

// ----- Buildings, power, projects ---------------------------------------------------------------

public sealed class PowerPlantSpec
{
    public PowerSourceKind Kind { get; init; } = PowerSourceKind.Renewable;
    public int Output { get; init; }
    public string? Fuel { get; init; }
    public int FuelPerTurn { get; init; }
    public Fx Co2PerTurn { get; init; }
    /// <summary>Tiles from the host city within which other cities can draw on this plant.</summary>
    public int Range { get; init; } = 6;

    [JsonIgnore] public int FuelIndex { get; private set; } = -1;

    internal void Link(LinkContext ctx, Definition owner) =>
        FuelIndex = ctx.Resolve(ctx.Db.Resources, Fuel, owner, "power.fuel");
}

public sealed class BuildingDef : Definition
{
    public string District { get; init; } = "";
    public Fx Cost { get; init; }
    public int Maintenance { get; init; }
    public YieldSet Yields { get; init; }
    /// <summary>Additional yields while the city is powered.</summary>
    public YieldSet PoweredYields { get; init; }
    public int PowerDemand { get; init; }
    public PowerPlantSpec? Power { get; init; }
    public Fx Co2PerTurn { get; init; }
    public int Housing { get; init; }
    public int Amenities { get; init; }
    public string? PrereqTech { get; init; }
    public string? PrereqCivic { get; init; }
    public List<string> RequiresBuildings { get; init; } = new();
    public bool ProtectsFromFlood { get; init; }
    public string? Civilization { get; init; }
    public string? Replaces { get; init; }
    public List<ModifierDef> Modifiers { get; init; } = new();
    /// <summary>Industry: converts stockpiled resources into goods every turn, automatically.</summary>
    public IndustryRecipe? Recipe { get; init; }

    [JsonIgnore] public int DistrictIndex { get; private set; } = -1;
    [JsonIgnore] public int PrereqTechIndex { get; private set; } = -1;
    [JsonIgnore] public int PrereqCivicIndex { get; private set; } = -1;
    [JsonIgnore] public int[] RequiresBuildingIndices { get; private set; } = Array.Empty<int>();
    [JsonIgnore] public int CivilizationIndex { get; private set; } = -1;
    [JsonIgnore] public int ReplacesIndex { get; private set; } = -1;

    internal override void Link(LinkContext ctx)
    {
        DistrictIndex = ctx.Resolve(ctx.Db.Districts, District, this, "district", required: true);
        PrereqTechIndex = ctx.Resolve(ctx.Db.Techs, PrereqTech, this, "prereqTech");
        PrereqCivicIndex = ctx.Resolve(ctx.Db.Civics, PrereqCivic, this, "prereqCivic");
        RequiresBuildingIndices = ctx.ResolveAll(ctx.Db.Buildings, RequiresBuildings, this, "requiresBuildings");
        CivilizationIndex = ctx.Resolve(ctx.Db.Civilizations, Civilization, this, "civilization");
        ReplacesIndex = ctx.Resolve(ctx.Db.Buildings, Replaces, this, "replaces");
        Power?.Link(ctx, this);
        Recipe?.Link(ctx, this);
        foreach (var m in Modifiers) m.Link(ctx, this);
    }
}

public sealed class ProjectDef : Definition
{
    public string? District { get; init; }
    public Fx Cost { get; init; }
    public bool Repeatable { get; init; }
    public string? PrereqTech { get; init; }
    public List<ModifierDef> OnComplete { get; init; } = new();
    /// <summary>Only players committed to this Divergence may build it.</summary>
    public string? Divergence { get; init; }
    /// <summary>The builder's Divergence must have remade at least this percent of the world's land.</summary>
    public int RequiresWorldTransformedPercent { get; init; }

    [JsonIgnore] public int DistrictIndex { get; private set; } = -1;
    [JsonIgnore] public int PrereqTechIndex { get; private set; } = -1;
    [JsonIgnore] public int DivergenceIndex { get; private set; } = -1;

    internal override void Link(LinkContext ctx)
    {
        DivergenceIndex = ctx.Resolve(ctx.Db.Divergences, Divergence, this, "divergence");
        DistrictIndex = ctx.Resolve(ctx.Db.Districts, District, this, "district");
        PrereqTechIndex = ctx.Resolve(ctx.Db.Techs, PrereqTech, this, "prereqTech");
        foreach (var m in OnComplete) m.Link(ctx, this);
    }
}

// ----- Modifiers ----------------------------------------------------------------------------------

public sealed class RequirementDef
{
    public RequirementType Type { get; init; }
    public string? Id { get; init; }
    public int Value { get; init; }

    [JsonIgnore] public int ResolvedIndex { get; private set; } = -1;

    internal void Link(LinkContext ctx, Definition owner)
    {
        ResolvedIndex = Type switch
        {
            RequirementType.CityHasDistrict => ctx.Resolve(ctx.Db.Districts, Id, owner, "requirement.id", true),
            RequirementType.CityHasBuilding => ctx.Resolve(ctx.Db.Buildings, Id, owner, "requirement.id", true),
            RequirementType.PlayerHasTech => ctx.Resolve(ctx.Db.Techs, Id, owner, "requirement.id", true),
            RequirementType.PlayerHasCivic => ctx.Resolve(ctx.Db.Civics, Id, owner, "requirement.id", true),
            _ => -1,
        };
    }
}

/// <summary>
/// A single data-driven effect. Modifiers are attached to governors, promotions, buildings,
/// districts, civ/leader abilities, policies and beliefs, and are aggregated per city each turn
/// into a CityEffects bundle (see Systems/CityEffects.cs). Every modifier carries its source so
/// the UI can always explain where a number came from.
/// </summary>
public sealed class ModifierDef
{
    public ModifierEffect Effect { get; init; }
    public YieldType? Yield { get; init; }
    public Fx Amount { get; init; }
    public ProductionCategory? Category { get; init; }
    public DisasterKind? Disaster { get; init; }
    public List<RequirementDef> Requirements { get; init; } = new();

    internal void Link(LinkContext ctx, Definition owner)
    {
        foreach (var r in Requirements) r.Link(ctx, owner);
        if (Effect is ModifierEffect.CityYieldFlat or ModifierEffect.CityYieldPercent or ModifierEffect.CityAdjacencyPercent && Yield is null)
            ctx.Error(owner, $"modifier {Effect} requires a 'yield'.");
    }
}

public sealed class AbilityDef
{
    public string Name { get; init; } = "";
    public string? Description { get; init; }
    public List<ModifierDef> Modifiers { get; init; } = new();

    internal void Link(LinkContext ctx, Definition owner)
    {
        foreach (var m in Modifiers) m.Link(ctx, owner);
    }
}

// ----- Units ---------------------------------------------------------------------------------------

public sealed class ResourceCost
{
    public string Resource { get; init; } = "";
    public int Amount { get; init; } = 1;
    [JsonIgnore] public int ResourceIndex { get; internal set; } = -1;
}

public sealed class UnitDef : Definition
{
    public UnitDomain Domain { get; init; }
    public string UnitClass { get; init; } = "";
    public string? Era { get; init; }
    public Fx Cost { get; init; }
    public int Maintenance { get; init; }
    public int Strength { get; init; }
    public int RangedStrength { get; init; }
    public int Range { get; init; }
    public int AntiAirStrength { get; init; }
    public int Moves { get; init; } = 2;
    public int Sight { get; init; } = 2;
    public int Charges { get; init; }
    public bool FoundsCity { get; init; }
    public bool OceanGoing { get; init; }
    /// <summary>Naval units: may sail Great River channels. Land units: may ford them.</summary>
    public bool RiverCapable { get; init; } = true;
    public string? PrereqTech { get; init; }
    public string? PrereqCivic { get; init; }
    public List<string> UpgradesTo { get; init; } = new();
    public ResourceCost? ResourceCost { get; init; }
    /// <summary>Fuel consumed per turn while the unit exists (contributes to emissions).</summary>
    public ResourceCost? Upkeep { get; init; }
    public string? Civilization { get; init; }
    public string? Replaces { get; init; }
    public List<string> StrongAgainst { get; init; } = new();
    public List<string> WeakAgainst { get; init; } = new();

    [JsonIgnore] public int PrereqTechIndex { get; private set; } = -1;
    [JsonIgnore] public int PrereqCivicIndex { get; private set; } = -1;
    [JsonIgnore] public int[] UpgradesToIndices { get; private set; } = Array.Empty<int>();
    [JsonIgnore] public int CivilizationIndex { get; private set; } = -1;
    [JsonIgnore] public int ReplacesIndex { get; private set; } = -1;

    internal override void Link(LinkContext ctx)
    {
        PrereqTechIndex = ctx.Resolve(ctx.Db.Techs, PrereqTech, this, "prereqTech");
        PrereqCivicIndex = ctx.Resolve(ctx.Db.Civics, PrereqCivic, this, "prereqCivic");
        UpgradesToIndices = ctx.ResolveAll(ctx.Db.Units, UpgradesTo, this, "upgradesTo");
        CivilizationIndex = ctx.Resolve(ctx.Db.Civilizations, Civilization, this, "civilization");
        ReplacesIndex = ctx.Resolve(ctx.Db.Units, Replaces, this, "replaces");
        if (ResourceCost != null) ResourceCost.ResourceIndex = ctx.Resolve(ctx.Db.Resources, ResourceCost.Resource, this, "resourceCost.resource", true);
        if (Upkeep != null) Upkeep.ResourceIndex = ctx.Resolve(ctx.Db.Resources, Upkeep.Resource, this, "upkeep.resource", true);
    }
}

// ----- Progression ---------------------------------------------------------------------------------

public sealed class EraDef : Definition
{
    public int Order { get; init; }
}

public abstract class ProgressNodeDef : Definition
{
    public string Era { get; init; } = "";
    public Fx Cost { get; init; }
    public List<string> Prereqs { get; init; } = new();
    /// <summary>Description of the "eureka/inspiration"-style boost trigger shown in the tree.</summary>
    public string? Boost { get; init; }
    public int BoostPercent { get; init; } = 40;
    /// <summary>Divergence branch this node belongs to (null = shared by everyone).</summary>
    public string? Divergence { get; init; }
    /// <summary>Researching a doctrine commits the player to its Divergence and locks every other branch forever.</summary>
    public bool Doctrine { get; init; }
    /// <summary>Flavour quote shown on the node and in the completion pop-up.</summary>
    public string? Quote { get; init; }
    /// <summary>Empire-wide modifiers granted once the node is completed.</summary>
    public List<ModifierDef> Modifiers { get; init; } = new();

    [JsonIgnore] public int EraIndex { get; private set; } = -1;
    [JsonIgnore] public int[] PrereqIndices { get; protected set; } = Array.Empty<int>();
    [JsonIgnore] public int DivergenceIndex { get; private set; } = -1;

    internal override void Link(LinkContext ctx)
    {
        EraIndex = ctx.Resolve(ctx.Db.Eras, Era, this, "era", required: true);
        DivergenceIndex = ctx.Resolve(ctx.Db.Divergences, Divergence, this, "divergence");
        if (Doctrine && DivergenceIndex < 0) ctx.Error(this, "a doctrine must name its 'divergence'.");
        foreach (var m in Modifiers) m.Link(ctx, this);
    }
}

public sealed class TechDef : ProgressNodeDef
{
    internal override void Link(LinkContext ctx)
    {
        base.Link(ctx);
        PrereqIndices = ctx.ResolveAll(ctx.Db.Techs, Prereqs, this, "prereqs");
    }
}

public sealed class CivicDef : ProgressNodeDef
{
    public int GovernorTitles { get; init; }

    internal override void Link(LinkContext ctx)
    {
        base.Link(ctx);
        PrereqIndices = ctx.ResolveAll(ctx.Db.Civics, Prereqs, this, "prereqs");
    }
}

// ----- Governors -----------------------------------------------------------------------------------

public sealed class GovernorPromotionDef
{
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public string? Description { get; init; }
    public int Tier { get; init; } = 1;
    public List<string> Requires { get; init; } = new();
    public List<ModifierDef> Modifiers { get; init; } = new();

    [JsonIgnore] public int[] RequiresIndices { get; internal set; } = Array.Empty<int>();
}

public sealed class GovernorDef : Definition
{
    public string Title { get; init; } = "";
    public int EstablishTurns { get; init; } = 5;
    public List<ModifierDef> BaseModifiers { get; init; } = new();
    public List<GovernorPromotionDef> Promotions { get; init; } = new();

    public int PromotionIndex(string id) => Promotions.FindIndex(p => p.Id == id);

    internal override void Link(LinkContext ctx)
    {
        foreach (var m in BaseModifiers) m.Link(ctx, this);
        foreach (var p in Promotions)
        {
            foreach (var m in p.Modifiers) m.Link(ctx, this);
            var indices = new List<int>();
            foreach (var req in p.Requires)
            {
                int i = PromotionIndex(req);
                if (i < 0) ctx.Error(this, $"promotion '{p.Id}' requires unknown promotion '{req}'.");
                else indices.Add(i);
            }
            p.RequiresIndices = indices.ToArray();
        }
    }
}

// ----- Civilizations & leaders ----------------------------------------------------------------------

public sealed class CivColors
{
    public string Primary { get; init; } = "#ffffff";
    public string Secondary { get; init; } = "#000000";
}

public sealed class CivilizationDef : Definition
{
    public string Adjective { get; init; } = "";
    public List<string> StartBias { get; init; } = new();
    public AbilityDef Ability { get; init; } = new();
    public List<string> CityNames { get; init; } = new();
    public CivColors Colors { get; init; } = new();

    internal override void Link(LinkContext ctx) => Ability.Link(ctx, this);
}

public sealed class AgendaDef
{
    public string Name { get; init; } = "";
    public string? Description { get; init; }
    public List<string> Likes { get; init; } = new();
    public List<string> Dislikes { get; init; } = new();
}

public sealed class LeaderDef : Definition
{
    public string Civilization { get; init; } = "";
    public AbilityDef Ability { get; init; } = new();
    public AgendaDef Agenda { get; init; } = new();
    /// <summary>AI personality weights, e.g. {"science": 1.2, "war": 0.6}.</summary>
    public Dictionary<string, Fx> Personality { get; init; } = new();

    [JsonIgnore] public int CivilizationIndex { get; private set; } = -1;

    internal override void Link(LinkContext ctx)
    {
        CivilizationIndex = ctx.Resolve(ctx.Db.Civilizations, Civilization, this, "civilization", required: true);
        Ability.Link(ctx, this);
    }
}

// ----- Environment -----------------------------------------------------------------------------------

public sealed class DisasterDef : Definition
{
    public DisasterKind Kind { get; init; }
    /// <summary>Chance per turn (permille) at climate phase 0 and standard intensity.</summary>
    public int BaseChancePermille { get; init; }
    /// <summary>Extra chance per climate phase, in percent of base.</summary>
    public int ClimateScalingPercent { get; init; }
    public int Radius { get; init; } = 1;
    public int PillageChancePercent { get; init; }
    public int PopulationLossChancePercent { get; init; }
    public int FertilityFood { get; init; }
}

public sealed class ClimateConfigDef : Definition
{
    public Fx BasePpm { get; init; } = 280;
    /// <summary>ppm added per unit of CO2 emitted.</summary>
    public Fx PpmPerEmission { get; init; } = Fx.Ratio(1, 100);
    /// <summary>Equilibrium warming (°C) per doubling of CO2.</summary>
    public Fx Sensitivity { get; init; } = 3;
    /// <summary>Percent of the gap to equilibrium temperature closed per turn (thermal inertia).</summary>
    public int LagPercent { get; init; } = 4;
    /// <summary>Temperature anomaly (°C) at which each climate phase begins.</summary>
    public List<Fx> PhaseThresholds { get; init; } = new();
}

// ----- Divergence (Future-era branching) ---------------------------------------------------------------

/// <summary>One historical pressure that pulls a civilization toward a Divergence before it commits.</summary>
public sealed class LeaningDef
{
    public LeaningKind Kind { get; init; }
    /// <summary>Building / district id, district or feature tag, or power kind name, depending on Kind.</summary>
    public string? Id { get; init; }
    public Fx Weight { get; init; } = Fx.One;
    public string? Label { get; init; }

    [JsonIgnore] public int ResolvedIndex { get; internal set; } = -1;
}

/// <summary>How a Divergence remakes the planet around its cities, turn by turn.</summary>
public sealed class SpreadSpec
{
    public TransformKind Kind { get; init; }
    /// <summary>The terrain or feature this Divergence turns the world into.</summary>
    public string Id { get; init; } = "";
    /// <summary>Cities with this building remake nearby tiles every turn.</summary>
    public string? SourceBuilding { get; init; }
    public string? RequiresTech { get; init; }
    public int PerCityPerTurn { get; init; } = 1;
    public int Radius { get; init; } = 3;
    /// <summary>Chance per turn (‰) that each transformed tile spreads on its own to a neighbour.</summary>
    public int OrganicChancePermille { get; init; }
    /// <summary>Organic spread may enter other civilizations' land.</summary>
    public bool CrossesBorders { get; init; }
    /// <summary>Cities rebuild submerged tiles they own as dry land.</summary>
    public bool ReclaimSubmerged { get; init; }

    [JsonIgnore] public int TargetIndex { get; internal set; } = -1;
    [JsonIgnore] public int SourceBuildingIndex { get; internal set; } = -1;
    [JsonIgnore] public int RequiresTechIndex { get; internal set; } = -1;
}

/// <summary>
/// A Future-era destiny for humanity. Committing (researching the doctrine tech) locks the other
/// Divergences out forever, applies the empire-wide modifiers, unlocks the branch's techs, units,
/// buildings and terraforming, and points the civilization at its Ascension project.
/// </summary>
public sealed class DivergenceDef : Definition
{
    /// <summary>What its people are called ("the Sovereign").</summary>
    public string People { get; init; } = "";
    public string Creed { get; init; } = "";
    /// <summary>The rational case, in the faction's own words.</summary>
    public string? Promise { get; init; }
    /// <summary>What it costs, in an outsider's words.</summary>
    public string? Price { get; init; }
    public string DoctrineTech { get; init; } = "";
    public string? AscensionProject { get; init; }
    public CivColors Colors { get; init; } = new();
    public List<ModifierDef> Modifiers { get; init; } = new();
    public List<LeaningDef> Leanings { get; init; } = new();
    public SpreadSpec? Spread { get; init; }
    /// <summary>Leader personality key the AI multiplies its leaning by ("war", "science", "growth"...).</summary>
    public string? AiPersonality { get; init; }
    public int AttitudeTowardSame { get; init; } = 6;
    public int AttitudeTowardOthers { get; init; } = -8;

    [JsonIgnore] public int DoctrineTechIndex { get; private set; } = -1;
    [JsonIgnore] public int AscensionProjectIndex { get; private set; } = -1;

    internal override void Link(LinkContext ctx)
    {
        DoctrineTechIndex = ctx.Resolve(ctx.Db.Techs, DoctrineTech, this, "doctrineTech", required: true);
        AscensionProjectIndex = ctx.Resolve(ctx.Db.Projects, AscensionProject, this, "ascensionProject");
        foreach (var m in Modifiers) m.Link(ctx, this);
        foreach (var l in Leanings)
        {
            l.ResolvedIndex = l.Kind switch
            {
                LeaningKind.Building => ctx.Resolve(ctx.Db.Buildings, l.Id, this, "leanings.id", true),
                LeaningKind.District => ctx.Resolve(ctx.Db.Districts, l.Id, this, "leanings.id", true),
                LeaningKind.PowerKind => Enum.TryParse<PowerSourceKind>(l.Id, out var k) ? (int)k : Fail(ctx, $"unknown power kind '{l.Id}'."),
                _ => -1,
            };
        }
        if (Spread != null)
        {
            Spread.TargetIndex = Spread.Kind == TransformKind.Terrain
                ? ctx.Resolve(ctx.Db.Terrains, Spread.Id, this, "spread.id", true)
                : ctx.Resolve(ctx.Db.Features, Spread.Id, this, "spread.id", true);
            Spread.SourceBuildingIndex = ctx.Resolve(ctx.Db.Buildings, Spread.SourceBuilding, this, "spread.sourceBuilding");
            Spread.RequiresTechIndex = ctx.Resolve(ctx.Db.Techs, Spread.RequiresTech, this, "spread.requiresTech");
        }
    }

    private int Fail(LinkContext ctx, string message)
    {
        ctx.Error(this, message);
        return -1;
    }
}

// ----- Industry (production chains) ----------------------------------------------------------------------

/// <summary>
/// An automatic production chain step: each turn, if the empire stockpile holds the inputs (and the
/// city is powered when required), they become the outputs. No routing, no trucks: one empire pool.
/// </summary>
public sealed class IndustryRecipe
{
    public Dictionary<string, int> Inputs { get; init; } = new();
    public Dictionary<string, int> Outputs { get; init; } = new();
    public bool RequiresPower { get; init; } = true;

    [JsonIgnore] public (int Resource, int Amount)[] ResolvedInputs { get; private set; } = Array.Empty<(int, int)>();
    [JsonIgnore] public (int Resource, int Amount)[] ResolvedOutputs { get; private set; } = Array.Empty<(int, int)>();

    internal void Link(LinkContext ctx, Definition owner)
    {
        (int, int)[] Resolve(Dictionary<string, int> map, string field) => map
            .Select(kv => (ctx.Resolve(ctx.Db.Resources, kv.Key, owner, field, true), kv.Value))
            .Where(x => x.Item1 >= 0).OrderBy(x => x.Item1).ToArray();
        ResolvedInputs = Resolve(Inputs, "recipe.inputs");
        ResolvedOutputs = Resolve(Outputs, "recipe.outputs");
    }
}

// ----- World currents & ages ---------------------------------------------------------------------------

public sealed class CurrentCondition
{
    public WorldCurrent Current { get; init; }
    public Fx Min { get; init; } = Fx.Zero;
    public Fx Max { get; init; } = 100;
}

/// <summary>
/// The character of a whole era for the whole world, chosen when the first civilization enters a new
/// era, from the world's currents (Progress, Strife, Calamity). It colours history; it never replaces
/// anyone's civilization, techs or units.
/// </summary>
public sealed class WorldAgeDef : Definition
{
    public int Priority { get; init; }
    public string? MinEra { get; init; }
    public List<CurrentCondition> Conditions { get; init; } = new();
    public List<ModifierDef> Modifiers { get; init; } = new();
    /// <summary>Percent change to every disaster's chance while this age lasts.</summary>
    public int DisasterChancePercent { get; init; }
    public string? Narration { get; init; }

    [JsonIgnore] public int MinEraOrder { get; private set; }

    internal override void Link(LinkContext ctx)
    {
        int era = ctx.Resolve(ctx.Db.Eras, MinEra, this, "minEra");
        MinEraOrder = era >= 0 ? ctx.Db.Eras[era].Order : 0;
        foreach (var m in Modifiers) m.Link(ctx, this);
    }
}

public sealed class CurrentPush
{
    /// <summary>Event type name, or a derived key such as "MilitaryUnitTrained".</summary>
    public string Event { get; init; } = "";
    public WorldCurrent Current { get; init; }
    public Fx Amount { get; init; } = Fx.One;
}

public sealed class SupplyRules
{
    /// <summary>Supply budget at a city, in cost units.</summary>
    public int CityRange { get; init; } = 10;
    public int MilitaryDistrictBonus { get; init; } = 4;
    /// <summary>Supply budget projected over water from Port-tagged districts.</summary>
    public int PortRange { get; init; } = 12;
    public int OwnCost { get; init; } = 2;
    public int NeutralCost { get; init; } = 3;
    public int ForeignCost { get; init; } = 5;
    public int RoughExtra { get; init; } = 1;
    /// <summary>Great Rivers are highways: supply flows cheaply along channel tiles.</summary>
    public int ChannelCost { get; init; } = 1;
    public int WaterCost { get; init; } = 2;
    public int AttritionHp { get; init; } = 10;
    public int HealHp { get; init; } = 10;
}

/// <summary>Combat tuning. Damage = baseDamage × 2^(Δstrength / doublingDelta) × random(min..max)%.</summary>
public sealed class CombatRules
{
    public int BaseDamage { get; init; } = 30;
    public int DoublingDelta { get; init; } = 17;
    public int RandomMinPercent { get; init; } = 80;
    public int RandomMaxPercent { get; init; } = 120;
    public int HpPenaltyPerTen { get; init; } = 1;
    public int RiverCrossingPenalty { get; init; } = 5;
    public int FortifyBonus { get; init; } = 4;
    public int FlankingBonus { get; init; } = 2;
    public int SupportBonus { get; init; } = 2;
    public int CounterBonus { get; init; } = 10;
    public int OutOfSupplyPenalty { get; init; } = 5;
    public int CityBaseStrength { get; init; } = 15;
    public int CityStrengthPerEra { get; init; } = 4;
    public int WallsStrength { get; init; } = 10;
    public int CityBaseHp { get; init; } = 100;
    public int WallsHp { get; init; } = 100;
    public int CityHealPerTurn { get; init; } = 20;
    public int CityStrikeRange { get; init; } = 2;
    public string WallsBuilding { get; init; } = "BUILDING_ANCIENT_WALLS";
}

/// <summary>Hegemony thresholds and score weights (score sources are visible all game).</summary>
public sealed class VictoryRules
{
    /// <summary>Alternative Hegemony: this share of world population (in loyal cities) and of all land.</summary>
    public int HegemonySharePercent { get; init; } = 60;
    /// <summary>Cities count toward Hegemony population only above this loyalty.</summary>
    public int HegemonyMinLoyalty { get; init; } = 50;
    public int ScorePerCitizen { get; init; } = 1;
    public int ScorePerCity { get; init; } = 5;
    public int ScorePerDistrict { get; init; } = 2;
    public int ScorePerBuilding { get; init; } = 1;
    public int ScorePerWonder { get; init; } = 15;
    public int ScorePerTech { get; init; } = 2;
    public int ScorePerCivic { get; init; } = 2;
    /// <summary>One point per this many tiles of territory.</summary>
    public int TilesPerPoint { get; init; } = 5;
    public int ScoreForAscension { get; init; } = 100;
}

/// <summary>Singleton rules for world-level systems (currents, supply, combat, victory).</summary>
public sealed class WorldRulesDef : Definition
{
    public int CurrentDecayPercent { get; init; } = 3;
    public List<CurrentPush> Pushes { get; init; } = new();
    public SupplyRules Supply { get; init; } = new();
    public CombatRules Combat { get; init; } = new();
    public VictoryRules Victory { get; init; } = new();
}

// ----- Chronicle --------------------------------------------------------------------------------------

/// <summary>Turns a game event into a line of your civilization's auto-written history.</summary>
public sealed class ChronicleTemplateDef : Definition
{
    public string Event { get; init; } = "";
    /// <summary>Placeholders: {year} {civ} {leader} {city} {detail} {value}.</summary>
    public string Text { get; init; } = "";
    public int MinValue { get; init; } = int.MinValue;
    /// <summary>Record only the first occurrence per player (e.g. "the sea claims the first lowland").</summary>
    public bool OncePerPlayer { get; init; }
    /// <summary>Skip events that happened to no one (e.g. a storm in empty wilderness).</summary>
    public bool RequiresPlayer { get; init; }
}
