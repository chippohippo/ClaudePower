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
    /// <summary>Leader doctrine (player-level): percent change to war weariness gained.</summary>
    WarWearinessPercent,
    /// <summary>Leader doctrine (player-level): influence toward envoys each turn.</summary>
    InfluencePerTurn,
    /// <summary>Leader doctrine (player-level): Diplomatic Favor each turn once the Congress has convened.</summary>
    FavorPerTurn,
    /// <summary>Project one-shot: launches a satellite of kind <c>amount</c> (SpaceSystem.SatelliteKind) over the city.</summary>
    LaunchSatellite,
    /// <summary>Project one-shot: the builder reaches Exodus stage <c>amount</c> (4 = the ark departs: Exodus victory).</summary>
    ExodusStage,
    /// <summary>Project one-shot: completes the owner's Divergence (Ascension victory).</summary>
    CompleteAscension,
    /// <summary>Unit combat strength (policies, governments, beliefs): <c>target</c> = a unit class, or empty for every military unit.</summary>
    UnitStrength,
    /// <summary>A flat yield for every tile of the city's land whose feature carries the tag in <c>target</c> (amount per tile).</summary>
    CityYieldPerFeature,
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
    /// <summary>Another civilization's territory lies within <c>value</c> tiles of the city (default 3).</summary>
    CityOnFrontier,
    /// <summary>The city's owner is at war with another civilization (Free Cities do not count).</summary>
    OwnerAtWar,
    /// <summary>The owner is at war with no civilization.</summary>
    OwnerAtPeace,
    /// <summary>UnitStrength only: the unit stands inside its owner's borders.</summary>
    UnitInOwnTerritory,
    /// <summary>UnitStrength only: the unit stands outside its owner's borders.</summary>
    UnitInForeignTerritory,
}

public abstract class Definition
{
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public string? Description { get; init; }
    public List<string> Tags { get; init; } = new();

    [JsonIgnore] public int Index { get; internal set; } = -1;
    [JsonIgnore] public string SourceMod { get; internal set; } = "";

    /// <summary>
    /// Affinity points this grants (affinity id → points): techs and civics when completed, buildings, districts, wonders and projects
    /// when built, improvements when made, policies while slotted (every few turns). See AffinitySystem.
    /// </summary>
    public Dictionary<string, int> Affinity { get; init; } = new();
    /// <summary>Only a civilization with at least <see cref="RequiresAffinityLevel"/> in this affinity may build or research it.</summary>
    public string? RequiresAffinity { get; init; }
    public int RequiresAffinityLevel { get; init; }

    /// <summary>Points per affinity (indexed like Divergences); empty when it grants none.</summary>
    [JsonIgnore] public int[] AffinityGrants { get; internal set; } = Array.Empty<int>();
    /// <summary>The affinity it grants most of (-1 none).</summary>
    [JsonIgnore] public int AffinityIndex { get; internal set; } = -1;
    [JsonIgnore] public int RequiresAffinityIndex { get; internal set; } = -1;

    public bool HasTag(string tag) => Tags.Contains(tag, StringComparer.Ordinal);

    internal virtual void Link(LinkContext ctx) { }

    internal void LinkAffinity(LinkContext ctx)
    {
        RequiresAffinityIndex = ctx.Resolve(ctx.Db.Divergences, RequiresAffinity, this, "requiresAffinity");
        if (Affinity.Count == 0) return;
        var grants = new int[ctx.Db.Divergences.Count];
        foreach (var (id, points) in Affinity.OrderBy(k => k.Key, StringComparer.Ordinal))
        {
            int a = ctx.Resolve(ctx.Db.Divergences, id, this, "affinity");
            if (a >= 0) grants[a] += points;
        }
        AffinityGrants = grants;
        int best = -1;
        for (int a = 0; a < grants.Length; a++)
            if (grants[a] > 0 && (best < 0 || grants[a] > grants[best])) best = a;
        AffinityIndex = best;
    }
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
    /// <summary>A natural wonder: placed once per map by the generator, never removed, admired from afar.</summary>
    public bool NaturalWonder { get; init; }
    /// <summary>Client model under assets/models for natural wonders (e.g. "wonders/uluru").</summary>
    public string? Model { get; init; }

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

/// <summary>A Great River on a scripted map: its channel tiles as [column, row], from the mouth upstream.</summary>
public sealed class MapRiverDef
{
    public string Name { get; init; } = "";
    public List<int[]> Tiles { get; init; } = new();
}

/// <summary>
/// A scripted map (e.g. Earth): every tile's terrain, relief, feature and elevation as one character per tile, row by row;
/// its Great Rivers; and true start locations for civilizations (with alternates, in order of preference), city-states and
/// natural wonders, as [column, row]. The generator keeps its own drainage, minor rivers, floodplains, lowlands and resources.
/// <para>Terrain: o ocean, c coast, l lake, G grassland, P plains, D desert, T tundra, S snow. Relief: . flat, h hills, m mountain.
/// Features: . none, f forest, j rainforest, m marsh, p floodplains, i ice, o oasis, v volcano, g geothermal, r reef. Elevation 0-9.</para>
/// </summary>
public sealed class MapDef : Definition
{
    public int Width { get; init; }
    public int Height { get; init; }
    public bool WrapX { get; init; } = true;
    public List<string> Terrain { get; init; } = new();
    public List<string> Relief { get; init; } = new();
    public List<string> Features { get; init; } = new();
    public List<string> Elevation { get; init; } = new();
    public List<MapRiverDef> GreatRivers { get; init; } = new();
    public Dictionary<string, List<int[]>> Starts { get; init; } = new();
    public Dictionary<string, int[]> CityStates { get; init; } = new();
    public Dictionary<string, int[]> NaturalWonders { get; init; } = new();

    internal override void Link(LinkContext ctx)
    {
        if (Width <= 0 || Height <= 0) { ctx.Error(this, "width and height must be positive."); return; }
        foreach (var (name, rows, chars) in new[] { ("terrain", Terrain, "ocGPDTSl"), ("relief", Relief, ".hm"), ("features", Features, ".fjmpiovgr"), ("elevation", Elevation, "0123456789") })
        {
            if (rows.Count != Height || rows.Any(r => r.Length != Width)) { ctx.Error(this, $"'{name}' must be {Height} rows of {Width} characters."); continue; }
            foreach (var row in rows)
                foreach (char ch in row)
                    if (!chars.Contains(ch)) { ctx.Error(this, $"'{name}' has an unknown character '{ch}'."); break; }
        }
        bool OnMap(int[] t) => t.Length == 2 && t[0] >= 0 && t[0] < Width && t[1] >= 0 && t[1] < Height;
        foreach (var (civ, spots) in Starts)
        {
            ctx.Resolve(ctx.Db.Civilizations, civ, this, "starts");
            if (spots.Count == 0 || !spots.All(OnMap)) ctx.Error(this, $"start '{civ}' needs [column, row] tiles on the map.");
        }
        foreach (var (cs, at) in CityStates) { ctx.Resolve(ctx.Db.CityStates, cs, this, "cityStates"); if (!OnMap(at)) ctx.Error(this, $"city-state '{cs}' is off the map."); }
        foreach (var (f, at) in NaturalWonders) { ctx.Resolve(ctx.Db.Features, f, this, "naturalWonders"); if (!OnMap(at)) ctx.Error(this, $"wonder '{f}' is off the map."); }
        foreach (var r in GreatRivers) if (r.Tiles.Count < 2 || !r.Tiles.All(OnMap)) ctx.Error(this, $"river '{r.Name}' needs two or more tiles on the map.");
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
    /// <summary>World wonders: modifiers on every city of the owner's empire (and UnitStrength on its units).</summary>
    public List<ModifierDef> EmpireModifiers { get; init; } = new();
    /// <summary>World wonders: extra wildcard policy slots while the owner holds it.</summary>
    public int WildcardSlots { get; init; }
    /// <summary>Client model under assets/models (e.g. "wonders/giza"); drawn instead of the era's district buildings.</summary>
    public string? Model { get; init; }

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
        foreach (var m in EmpireModifiers) m.Link(ctx, this);
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
    /// <summary>Slots for great works (art and relics) — CultureSystem.</summary>
    public int GreatWorkSlots { get; init; }
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
    /// <summary>Projects the builder must have completed first (the Exodus chain).</summary>
    public List<string> RequiresProjects { get; init; } = new();

    [JsonIgnore] public int DistrictIndex { get; private set; } = -1;
    [JsonIgnore] public int PrereqTechIndex { get; private set; } = -1;
    [JsonIgnore] public int DivergenceIndex { get; private set; } = -1;
    [JsonIgnore] public int[] RequiresProjectIndices { get; private set; } = Array.Empty<int>();

    internal override void Link(LinkContext ctx)
    {
        RequiresProjectIndices = ctx.ResolveAll(ctx.Db.Projects, RequiresProjects, this, "requiresProjects");
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
    /// <summary>For UnitStrength: the unit class it applies to (empty = all military units).</summary>
    public string? Target { get; init; }
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

/// <summary>
/// Unit Variants (docs/09 §3): one honest trade-off picked when a unit is upgraded ("Heavy: +15% strength, −1 move").
/// Units built in a city get the first variant. A civilization's unique unit inherits the variants of the unit it replaces.
/// </summary>
public sealed class UnitVariantDef
{
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public string? Description { get; init; }
    public int StrengthPercent { get; init; }
    /// <summary>−100 removes the ranged attack (the unit fights in melee).</summary>
    public int RangedStrengthPercent { get; init; }
    public int MovesDelta { get; init; }
    public int RangeDelta { get; init; }
    public bool IgnoresRiverCrossing { get; init; }
    /// <summary>Extra percent on the upgrade's gold cost.</summary>
    public int UpgradeCostPercent { get; init; }
}

/// <summary>
/// How the client draws a unit (the simulation ignores it): a model under assets/models, how many figures make the squad,
/// the fitted size in tile units (height, or length when <see cref="ByLength"/>), an optional tint ("#rrggbb"), a hover
/// height and an optional piece mounted on top (a tank's turret).
/// </summary>
public sealed class UnitLookDef
{
    public string Model { get; init; } = "";
    public int Count { get; init; } = 1;
    public Fx Size { get; init; } = Fx.Ratio(7, 10);
    public bool ByLength { get; init; }
    public string? Tint { get; init; }
    public Fx Hover { get; init; }
    public string? Addon { get; init; }
    /// <summary>A figure seated on the mount (cavalry, elephants, camels), in its sitting pose.</summary>
    public string? Rider { get; init; }
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
    /// <summary>Can plant an Outpost (a cheap claim with no city screen).</summary>
    public bool FoundsOutpost { get; init; }
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
    public List<UnitVariantDef> Variants { get; init; } = new();
    /// <summary>How the client draws it; without one the client picks a figure by class and era.</summary>
    public UnitLookDef? Look { get; init; }

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
        foreach (var dup in Variants.GroupBy(v => v.Id).Where(g => g.Count() > 1)) ctx.Error(this, $"duplicate variant '{dup.Key}'.");
        if (Variants.Count == 1) ctx.Error(this, "a unit with variants needs at least two to choose from.");
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
    /// <summary>Researching a doctrine commits the player to its Divergence as its primary affinity (the choice point).</summary>
    public bool Doctrine { get; init; }
    /// <summary>A victory enabler: only a civilization whose primary affinity is this node's Divergence may research it.</summary>
    public bool Victory { get; init; }
    /// <summary>Affinity-flavoured boost: once the researcher reaches this level in the affinity, the node costs BoostPercent less.</summary>
    public string? BoostAffinity { get; init; }
    public int BoostLevel { get; init; }
    [JsonIgnore] public int BoostAffinityIndex { get; private set; } = -1;
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
        BoostAffinityIndex = ctx.Resolve(ctx.Db.Divergences, BoostAffinity, this, "boostAffinity");
        if (Doctrine && DivergenceIndex < 0) ctx.Error(this, "a doctrine must name its 'divergence'.");
        if (Victory && DivergenceIndex < 0) ctx.Error(this, "a victory node must name its 'divergence'.");
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

/// <summary>
/// Living Governors: a trait a governor earns from where it serves, either <see cref="Turns"/> established turns in a city meeting
/// <see cref="Requirements"/>, or <see cref="Count"/> end-of-turn events of type <see cref="Event"/> in that city. Traits travel with the
/// governor, apply their modifiers wherever it is established, and are written into the Chronicle.
/// </summary>
public sealed class GovernorTraitDef : Definition
{
    public List<RequirementDef> Requirements { get; init; } = new();
    public int Turns { get; init; }
    public string? Event { get; init; }
    public int Count { get; init; }
    /// <summary>Only these governors can earn it (empty = any).</summary>
    public List<string> Governors { get; init; } = new();
    public List<ModifierDef> Modifiers { get; init; } = new();

    [JsonIgnore] public State.GameEventType? EventType { get; private set; }
    [JsonIgnore] public int[] GovernorIndices { get; private set; } = Array.Empty<int>();
    [JsonIgnore] public int Goal => EventType != null ? Count : Turns;

    internal override void Link(LinkContext ctx)
    {
        foreach (var r in Requirements) r.Link(ctx, this);
        foreach (var m in Modifiers) m.Link(ctx, this);
        if (Event != null)
        {
            if (Enum.TryParse<State.GameEventType>(Event, out var t)) EventType = t;
            else ctx.Error(this, $"unknown event '{Event}'.");
            if (Count <= 0) ctx.Error(this, "an event trait needs a positive 'count'.");
        }
        else if (Turns <= 0) ctx.Error(this, "needs either 'turns' or 'event' + 'count'.");
        GovernorIndices = Governors.Select(g => ctx.Resolve(ctx.Db.Governors, g, this, "governors", true)).Where(i => i >= 0).ToArray();
    }
}

// ----- Civilizations & leaders ----------------------------------------------------------------------

public sealed class CivColors
{
    public string Primary { get; init; } = "#ffffff";
    public string Secondary { get; init; } = "#000000";
}

/// <summary>
/// A nation's signature: a rule of the game it plays differently (see <c>NationSystem</c> and docs/05-key-systems/14-nations.md).
/// <see cref="Params"/> are the tunables; a leader's <see cref="AugmentDef"/> overrides or adds to them.
/// </summary>
public enum SignatureKind
{
    None,
    /// <summary>Egypt: surplus food fills a royal granary that floods into the cities every few turns.</summary>
    Inundation,
    /// <summary>Venice: never trains Settlers; buys Free Cities and disloyal foreign cities with gold.</summary>
    Ledger,
    /// <summary>Song: a Mandate meter fed by loyal, peaceful cities triggers golden dynasties; losing a city ends one.</summary>
    Mandate,
    /// <summary>Mongolia: little science or culture at home; victories in battle and captured cities pay for progress.</summary>
    Horde,
    /// <summary>Inca: mountains are walkable and farmed in terraces.</summary>
    SkyRoads,
    /// <summary>Mali: slow production, rich land and cheap purchases; gold earns interest.</summary>
    GoldenRoad,
    /// <summary>Rome: a dense, connected empire (production from neighbouring Roman cities, swift legions at home).</summary>
    Imperium,
    /// <summary>Greece: every peace treaty feeds science and culture; phalanxes fight harder at war.</summary>
    Polis,
    /// <summary>Zulu: melee units grow stronger for every comrade beside the foe; a war economy.</summary>
    Impi,
    /// <summary>Norway: sea raiders; kills pay gold, longships range far.</summary>
    Raiders,
    /// <summary>Japan: units fight at full strength however wounded.</summary>
    Bushido,
    /// <summary>England: coal and steam; powered cities out-produce the world.</summary>
    Workshop,
    /// <summary>France: borders spread at twice the pace; culture is power.</summary>
    Grandeur,
    /// <summary>Russia: vast claims at every founding; tundra prospers; winter kills invaders.</summary>
    Winter,
    /// <summary>Persia: governed cities are loyal and rich.</summary>
    Satrapy,
    /// <summary>Aztec: every captive feeds the nearest city's works; luxuries delight.</summary>
    FlowerWar,
    /// <summary>Maya: everything within six tiles of the capital thrives; the far provinces do not.</summary>
    LongCount,
    /// <summary>Ethiopia: faith from the highlands becomes science and culture.</summary>
    Highland,
    /// <summary>Ottomans: masters of the siege; captured cities stay whole and loyal.</summary>
    Siege,
    /// <summary>Arabia: a quarter of the treasury's income becomes science.</summary>
    Wisdom,
    /// <summary>Korea: academies and mines feed science.</summary>
    Seowon,
    /// <summary>India: stepwells and great cities; large cities give faith.</summary>
    Stepwell,
    /// <summary>Khmer: farms fed by reservoirs grow food and faith.</summary>
    Baray,
    /// <summary>Netherlands: the sea is farmland; floods and storms spare the Dutch.</summary>
    Polder,
    /// <summary>Portugal: cities only on the coast; ships range far; trade pays.</summary>
    Navigators,
    /// <summary>Spain: conquered cities pay treasure.</summary>
    Treasure,
    /// <summary>Byzantium: every city strengthens the army; the walls are the strongest in the world.</summary>
    Themes,
    /// <summary>Carthage: armies are hired, not raised.</summary>
    Mercenaries,
    /// <summary>Babylon: little science from scholars; every building and district completed is a discovery.</summary>
    Eureka,
    /// <summary>Kongo: the forest is home: forest and rainforest tiles are rich.</summary>
    Forest,
    /// <summary>Poland: every victory pushes the border out.</summary>
    Commonwealth,
    /// <summary>Scotland: luxuries make the people inventive and industrious.</summary>
    Enlightenment,
    /// <summary>Brazil: a great carnival every few turns.</summary>
    Carnival,
    /// <summary>America: cities grow fast and house many.</summary>
    Frontier,
    /// <summary>Vietnam: the land fights for its people: units in forest, marsh and hills are stronger and swifter.</summary>
    Guerrilla,
    /// <summary>Haudenosaunee: may never declare war; peace with everyone makes every city thrive.</summary>
    GreatLaw,
    /// <summary>Germany: an extra district slot in every city and industrial heartlands; leaders shape its armour and fleet.</summary>
    Ruhr,
    /// <summary>Italy: cities of art — wonders and great works pay culture and gold, districts and wonders rise faster.</summary>
    Rinascimento,
}

public sealed class SignatureDef
{
    public SignatureKind Kind { get; init; }
    public string Name { get; init; } = "";
    public string? Description { get; init; }
    /// <summary>How the nation plays, for the nation card ("You never build Settlers…").</summary>
    public string? Playstyle { get; init; }
    public Dictionary<string, int> Params { get; init; } = new();
}

/// <summary>How a leader bends their nation's signature (overrides or adds signature parameters).</summary>
public sealed class AugmentDef
{
    public string Name { get; init; } = "";
    public string? Description { get; init; }
    public Dictionary<string, int> Params { get; init; } = new();
}

public sealed class CivilizationDef : Definition
{
    public string Adjective { get; init; } = "";
    public List<string> StartBias { get; init; } = new();
    public AbilityDef Ability { get; init; } = new();
    public SignatureDef Signature { get; init; } = new();
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
    /// <summary>"Warrior Pharaoh", shown under the name on the leader card.</summary>
    public string? Epithet { get; init; }
    public AbilityDef Ability { get; init; } = new();
    public AugmentDef Augment { get; init; } = new();
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
    /// <summary>The name of this affinity's victory (Ascension in the engine): "Transcendence", "Emancipation", "the Digital Singularity".</summary>
    public string? VictoryName { get; init; }
    /// <summary>Unit tag marking this affinity's units: they kill for its points and draw its level's strength bonus.</summary>
    public string? UnitTag { get; init; }
    /// <summary>Its units fight with +1 strength per this many levels the owner holds (0 = none).</summary>
    public int LevelsPerUnitStrength { get; init; }
    /// <summary>Cities defend with +1 strength per this many levels (0 = none).</summary>
    public int LevelsPerCityDefense { get; init; }
    /// <summary>Its units heal this much more every turn, anywhere (regeneration).</summary>
    public int UnitHealPerTurn { get; init; }
    /// <summary>Identity effects that switch on as the owner's level in this affinity rises (committed or not).</summary>
    public List<AffinityLevelDef> Levels { get; init; } = new();

    [JsonIgnore] public int DoctrineTechIndex { get; private set; } = -1;
    [JsonIgnore] public int AscensionProjectIndex { get; private set; } = -1;

    internal override void Link(LinkContext ctx)
    {
        DoctrineTechIndex = ctx.Resolve(ctx.Db.Techs, DoctrineTech, this, "doctrineTech", required: true);
        foreach (var level in Levels)
            foreach (var m in level.Modifiers) m.Link(ctx, this);
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

/// <summary>Identity effects that hold in every city of a civilization at or above this level in the affinity.</summary>
public sealed class AffinityLevelDef
{
    public int Level { get; init; }
    public string? Description { get; init; }
    public List<ModifierDef> Modifiers { get; init; } = new();
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
    /// <summary>Siege weapons (the "Siege" tag): a bonus against cities and a penalty against troops.</summary>
    public int SiegeVsCityBonus { get; init; } = 12;
    public int SiegeVsUnitsPenalty { get; init; } = 8;
    /// <summary>Embarkation: land units may cross coast and lakes with the first tech, the open ocean with the second, and
    /// defend at sea with this strength (they cannot attack from the water).</summary>
    public string EmbarkTech { get; init; } = "TECH_SAILING";
    public string OceanEmbarkTech { get; init; } = "TECH_CELESTIAL_NAVIGATION";
    public int EmbarkedStrength { get; init; } = 10;
    /// <summary>A civilization down to two cities (having lost one) defends harder: city strength and units at home.</summary>
    public int LastStandCity { get; init; } = 8;
    public int LastStandUnits { get; init; } = 5;
    public int OutOfSupplyPenalty { get; init; } = 5;
    public int CityBaseStrength { get; init; } = 15;
    public int CityStrengthPerEra { get; init; } = 4;
    public int WallsStrength { get; init; } = 10;
    public int CityBaseHp { get; init; } = 100;
    public int WallsHp { get; init; } = 100;
    public int CityHealPerTurn { get; init; } = 20;
    public int CityStrikeRange { get; init; } = 2;
    public string WallsBuilding { get; init; } = "BUILDING_ANCIENT_WALLS";
    /// <summary>Upgrade gold = max(minUpgradeGold, (target cost − current cost) × this), then the variant's percent.</summary>
    public int UpgradeGoldPerProduction { get; init; } = 2;
    public int MinUpgradeGold { get; init; } = 20;
}

/// <summary>Outposts: cheap claims that hold land, extend supply and harvest one resource; promotable to cities.</summary>
public sealed class OutpostRules
{
    public int ClaimRadius { get; init; } = 1;
    /// <summary>Minimum distance from any city or outpost.</summary>
    public int MinDistance { get; init; } = 3;
    /// <summary>Supply budget seeded at the outpost (cities seed <c>supply.cityRange</c>).</summary>
    public int SupplyRange { get; init; } = 6;
    public int GoldPerTurn { get; init; } = 1;
    public int BonusGold { get; init; } = 2;
    public int LuxuryGold { get; init; } = 3;
    /// <summary>Stockpile per turn from a revealed strategic resource in the claim.</summary>
    public int StrategicPerTurn { get; init; } = 2;
    public int PromoteGold { get; init; } = 150;
    public int PromoteGoldPerCity { get; init; } = 25;
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
    public OutpostRules Outposts { get; init; } = new();
    public AffinityRules Affinity { get; init; } = new();
}

/// <summary>Affinity tuning (AffinitySystem): level thresholds and the soft exclusivity between affinities.</summary>
public sealed class AffinityRules
{
    /// <summary>Cumulative points for levels 1, 2, 3 … (at most 20 levels).</summary>
    public List<int> LevelThresholds { get; init; } = new() { 3, 7, 12, 18, 25, 33, 42, 52, 63, 75, 88, 102, 117, 133, 150, 168, 187, 207, 228, 250 };
    /// <summary>Tagged techs of an affinity cost this much less per level you hold in it…</summary>
    public int DiscountPercentPerLevel { get; init; } = 2;
    public int MaxDiscountPercent { get; init; } = 25;
    /// <summary>…and this much more per level your dominant affinity leads it by.</summary>
    public int GapPenaltyPercentPerLevel { get; init; } = 4;
    public int MaxGapPenaltyPercent { get; init; } = 40;
    /// <summary>Once a primary affinity is chosen, the other affinities' tagged techs cost this much more.</summary>
    public int CommittedPenaltyPercent { get; init; } = 50;
    /// <summary>Slotted policies with affinity grant their points every this many turns.</summary>
    public int PolicyInterval { get; init; } = 10;
    /// <summary>Points for a kill by a unit of the affinity.</summary>
    public int PointsPerKill { get; init; } = 1;
    /// <summary>Attitude between peoples whose dominant affinities (both at least <see cref="KindredLevel"/>) agree or differ.</summary>
    public int KindredLevel { get; init; } = 3;
    public int KindredAttitude { get; init; } = 3;
    public int RivalAttitude { get; init; } = -3;
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
