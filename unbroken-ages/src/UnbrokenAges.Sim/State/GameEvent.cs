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
    // ----- Culture -----
    /// <summary>Def = the great person; Detail = the work.</summary>
    GreatWorkCreated,
    /// <summary>Player's visiting tourists now outnumber Value's domestic tourists.</summary>
    CulturalDominance,
    // ----- World Congress -----
    /// <summary>Value = the session's turn; Detail = the resolutions.</summary>
    CongressAnnounced,
    /// <summary>Player = target (-1 for global); Def = ResolutionKind; Value = option.</summary>
    ResolutionPassed,
    /// <summary>Value = the player's new total.</summary>
    DiplomaticPointEarned,
    /// <summary>A corps or army formed (Value = formation level).</summary>
    FormationCreated,
    // ----- Space -----
    /// <summary>Value = satellite kind; Tile = the centre of its coverage.</summary>
    SatelliteLaunched,
    SatelliteFell,
    /// <summary>Value = the stage reached.</summary>
    ExodusStageReached,
    /// <summary>The capital fell and the government moved to this city (Player = its owner).</summary>
    CapitalMoved,
    // ----- Deals, alliances, liberation -----
    /// <summary>Player offers Value a deal (Def = deal id; Detail = its items).</summary>
    DealProposed,
    /// <summary>Player accepted Value's deal (Detail = its items).</summary>
    DealAccepted,
    DealRejected,
    /// <summary>Player and Value are now allies.</summary>
    AllianceFormed,
    /// <summary>Player left its alliance with Value.</summary>
    AllianceEnded,
    /// <summary>Player's ally (Def) was attacked by Value: Player may answer with a defensive war.</summary>
    CalledToArms,
    /// <summary>A city changed hands in a deal (Player = the new owner, Value = the old).</summary>
    CityCeded,
    /// <summary>A city returned to its founders (Player = the founders, Value = the liberator).</summary>
    CityLiberated,
    /// <summary>Value = science gained; Detail = the partner.</summary>
    ResearchAgreementCompleted,
    /// <summary>A historic dilemma awaits Player's choice (Def = the dilemma).</summary>
    DilemmaPresented,
    /// <summary>Player chose (Def = the dilemma, Value = the option; Detail = the outcome).</summary>
    DilemmaResolved,
    /// <summary>Player reached a new level (Value) in an affinity (Def = the affinity, a Divergence index).</summary>
    AffinityLevelUp,
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
