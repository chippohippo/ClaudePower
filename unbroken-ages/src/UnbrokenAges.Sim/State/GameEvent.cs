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
    // ----- Society -----
    GovernmentAdopted,
    PantheonFounded,
    /// <summary>A religion was founded (Value = religion index; City = holy city).</summary>
    ReligionFounded,
    /// <summary>A city converted (Value = religion index).</summary>
    CityConverted,
    /// <summary>Def = great person index.</summary>
    GreatPersonRecruited,
    /// <summary>Era score earned (Value = points, Detail = the moment).</summary>
    HistoricMoment,
    /// <summary>Value = (int)AgeState.</summary>
    AgeBegan,
    NaturalWonderDiscovered,
    /// <summary>Value = promotion index.</summary>
    UnitPromoted,
    CampSpawned,
    CampCleared,
    /// <summary>Raiders burned an improvement (Player = its owner).</summary>
    TilePillaged,
    // ----- City-states -----
    /// <summary>A new envoy to send (Value = envoys in hand).</summary>
    EnvoyEarned,
    /// <summary>Value = the city-state's player id.</summary>
    EnvoySent,
    CityStateMet,
    /// <summary>Player = the new suzerain (-1 = none); Value = the city-state's player id.</summary>
    SuzerainChanged,
    // ----- Trade -----
    /// <summary>City = origin, Tile = destination, Value = destination owner.</summary>
    TradeRouteEstablished,
    TradeRouteEnded,
    /// <summary>Player = the route's owner, Value = the plunderer.</summary>
    TradeRoutePlundered,
    // ----- Espionage -----
    SpyRecruited,
    /// <summary>Player = the spy's owner, Value = the victim.</summary>
    SpyMissionSucceeded,
    SpyMissionFailed,
    SpyCaught,
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
