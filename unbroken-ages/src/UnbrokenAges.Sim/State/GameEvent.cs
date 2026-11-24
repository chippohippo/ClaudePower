namespace UnbrokenAges.Sim.State;

public enum GameEventType : byte
{
    CityFounded,
    ProductionCompleted,
    QueueItemInvalidated,
    CityGrew,
    CityStarved,
    TechResearched,
    CivicCompleted,
    GovernorEstablished,
    CityDeclaredIndependence,
    CityFlipped,
    LoyaltyWarning,
    PowerShortage,
    ClimatePhaseChanged,
    TileFlooded,
    TileSubmerged,
    Disaster,
    ImprovementBuilt,
    TurnAdvanced,
    DivergenceChosen,
    WorldRemade,
    BloomEncroached,
    LandReclaimed,
    AscensionCompleted,
    EraEntered,
    WorldAgeBegan,
    UnitLostToAttrition,
    ProductionStalled,
    WarDeclared,
    PeaceProposed,
    PeaceSigned,
    Denounced,
    OpenBordersGranted,
    BattleFought,
    UnitDestroyed,
    CityCaptured,
    CivilianCaptured,
    TileClaimed,
    VictoryAchieved,
    PlayerEliminated,
    GovernorTraitEarned,
    OutpostFounded,
    OutpostPromoted,
    OutpostRazed,
    UnitUpgraded,
    /// <summary>A merchant republic bought a city (Value = previous owner).</summary>
    CityPurchased,
    /// <summary>Mongolia turned a victory into science and culture (Value = science; Detail describes it).</summary>
    Plundered,
    /// <summary>Egypt's granary flooded into its cities (Value = food).</summary>
    Inundation,
    DynastyBegan,
    DynastyEnded,
    /// <summary>A Song dynasty fell with the loss of a city (Value = loyalty lost everywhere).</summary>
    DynastyFell,
    /// <summary>An unpaid unit deserted (the treasury was empty).</summary>
    UnitDisbanded,
}

/// <summary>
/// Facts emitted by the simulation for the presentation layer (notifications, animations,
/// timeline/replay). Events are outputs only; they never feed back into the simulation.
/// </summary>
public readonly record struct GameEvent(
    GameEventType Type,
    int Player = -1,
    int City = -1,
    int Tile = -1,
    int Def = -1,
    int Value = 0,
    string? Detail = null);
