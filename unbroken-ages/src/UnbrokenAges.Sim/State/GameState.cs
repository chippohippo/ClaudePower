using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;

namespace UnbrokenAges.Sim.State;

public enum AgeState : byte { Normal, Golden, Dark, Heroic }
public enum PowerDispatchPolicy : byte { CleanestFirst, CheapestFirst }
public enum TurnMode : byte { Simultaneous, Dynamic, Sequential }

/// <summary>Game-setup options the simulation itself reads (all peers must agree).</summary>
public sealed class GameOptions
{
    public int GameSpeedPercent { get; set; } = 100;
    /// <summary>"Extended Eras": scales tech/civic costs so unique units and era mechanics stay relevant longer.</summary>
    public int EraPacingPercent { get; set; } = 100;
    /// <summary>0 off, 1 gentle, 2 standard, 3 intense, 4 cataclysmic.</summary>
    public int DisasterIntensity { get; set; } = 2;
    public bool ClimateEnabled { get; set; } = true;
    public bool LoyaltyEnabled { get; set; } = true;
    public int MaxQueueLength { get; set; } = 8;
    public TurnMode TurnMode { get; set; } = TurnMode.Dynamic;
    public int StartingGovernorTitles { get; set; } = 1;
    /// <summary>Wars require a denunciation at least 5 turns earlier.</summary>
    public bool NoSurpriseWars { get; set; }
}

public sealed class GovernorState
{
    public int DefIndex;
    public int CityId = -1;
    public int EstablishProgress;
    public bool Established;
    public List<int> Promotions = new();
}

public sealed class PlayerState
{
    public int Id;
    public string Name = "";
    public int CivIndex = -1;
    public int LeaderIndex = -1;
    public int Team;
    public bool IsHuman;
    public bool IsFreeCities;
    public bool IsAlive = true;
    public bool HasEndedTurn;

    public Fx Gold;
    public Fx Faith;
    public int CurrentTech = -1;
    public int CurrentCivic = -1;
    public Fx TechProgress;
    public Fx CivicProgress;
    public bool[] Techs = Array.Empty<bool>();
    public bool[] Civics = Array.Empty<bool>();
    /// <summary>Strategic-resource stockpiles indexed by resource definition.</summary>
    public int[] Stockpile = Array.Empty<int>();

    public AgeState Age;
    public int GovernorTitles;
    public List<GovernorState> Governors = new();

    public PowerDispatchPolicy DispatchPolicy;
    public Fx EmissionsLastTurn;
    public Fx CumulativeEmissions;
    public int CapitalCityId = -1;
    /// <summary>Committed Divergence (-1 = not yet). Irreversible.</summary>
    public int LastWarDeclaredTurn = -1;
    public int Divergence = -1;
    public int DivergenceTurn = -1;
    /// <summary>Completed its Divergence's Ascension project.</summary>
    public bool Ascended;

    public GovernorState? GetGovernor(int defIndex) => Governors.Find(g => g.DefIndex == defIndex);
    public bool HasTech(int index) => index < 0 || (index < Techs.Length && Techs[index]);
    public bool HasCivic(int index) => index < 0 || (index < Civics.Length && Civics[index]);
}

public sealed class DistrictInstance
{
    public int DefIndex;
    public int Tile;
    public List<int> Buildings = new();
    public bool Pillaged;
}

public sealed class CityState
{
    public int Id;
    public int Owner;
    public int OriginalOwner;
    public string Name = "";
    public int Tile;
    public int Population = 1;
    public Fx FoodStored;
    public Fx Loyalty = 100;
    public Fx LastLoyaltyDelta;
    public bool IsCapital;
    public int FoundedTurn;
    public int TurnsSinceOwnerChange = 999;
    public List<DistrictInstance> Districts = new();
    public ProductionQueue Queue = new();
    /// <summary>Partial progress per item key (kind|def|tile) — kept when switching, like the classic games.</summary>
    public SortedDictionary<long, Fx> ProgressLedger = new();
    public Fx OverflowProduction;
    public bool IsPowered;
    public int PowerDemand;
    public int PowerPriority;
    /// <summary>Governor definition currently assigned here (-1 none). Mirrors PlayerState.Governors.</summary>
    public int GovernorDef = -1;
    public Fx YieldsLastTurnProduction;

    public DistrictInstance? FindDistrict(int defIndex) => Districts.Find(d => d.DefIndex == defIndex);
    public bool HasBuilding(int buildingIndex) => Districts.Any(d => d.Buildings.Contains(buildingIndex));
    public IEnumerable<int> AllBuildings() => Districts.SelectMany(d => d.Buildings);
}

public sealed class UnitState
{
    public int Id;
    public int Owner;
    public int DefIndex;
    public int Tile;
    public Fx MovesLeft;
    public int Hp = 100;
    public int Charges;
    public int Destination = -1;
}

/// <summary>Shared state of the whole world: currents and the age history.</summary>
public sealed class WorldState
{
    public Fx Progress;
    public Fx Strife;
    public Fx Calamity;
    /// <summary>Highest era order any civilization has reached.</summary>
    public int WorldEra;
    /// <summary>World age currently in effect (-1 = an ordinary age).</summary>
    public int CurrentAge = -1;
    public List<(int Era, int Age)> AgeHistory = new();

    public Fx Get(Data.WorldCurrent c) => c switch
    {
        Data.WorldCurrent.Progress => Progress,
        Data.WorldCurrent.Strife => Strife,
        _ => Calamity,
    };

    public void Set(Data.WorldCurrent c, Fx v)
    {
        v = Fx.Clamp(v, Fx.Zero, 100);
        if (c == Data.WorldCurrent.Progress) Progress = v;
        else if (c == Data.WorldCurrent.Strife) Strife = v;
        else Calamity = v;
    }
}

public sealed class ChronicleEntry
{
    public int Turn;
    public int Year;
    public int Player = -1;
    public GameEventType Kind;
    public string Text = "";
}

public sealed class ClimateState
{
    public Fx Co2Ppm = 280;
    public Fx Temperature;
    public int Phase;
    public Fx EmissionsLastTurn;
    public Fx PendingDeforestation;
    public int LastPhaseChangeTurn;
}

/// <summary>
/// Root of the authoritative simulation state. Everything here is serialized into saves and
/// multiplayer resync snapshots and is hashed for desync detection. No engine types, no floats,
/// no unordered iteration.
/// </summary>
public sealed class GameState
{
    public GameDatabase Db { get; }
    public GameOptions Options { get; }
    public MapGrid Map { get; }

    public int Turn = 1;
    public int NextId = 1;
    public List<PlayerState> Players = new();
    public List<CityState> Cities = new();
    public List<UnitState> Units = new();
    public ClimateState Climate = new();
    public WorldState World = new();
    public List<ChronicleEntry> Chronicle = new();
    public List<Relation> Relations = new();
    public List<Grievance> Grievances = new();
    public Pcg32 GameplayRng;
    public Pcg32 DisasterRng;

    private Dictionary<int, CityState>? _cityIndex;
    private Dictionary<int, UnitState>? _unitIndex;

    public GameState(GameDatabase db, GameOptions options, MapGrid map, ulong seed)
    {
        Db = db;
        Options = options;
        Map = map;
        GameplayRng = Pcg32.Derive(seed, "gameplay");
        DisasterRng = Pcg32.Derive(seed, "disasters");
    }

    public int AllocateId() => NextId++;

    public CityState? GetCity(int id)
    {
        _cityIndex ??= Cities.ToDictionary(c => c.Id);
        return _cityIndex.TryGetValue(id, out var c) ? c : null;
    }

    public UnitState? GetUnit(int id)
    {
        _unitIndex ??= Units.ToDictionary(u => u.Id);
        return _unitIndex.TryGetValue(id, out var u) ? u : null;
    }

    public void InvalidateIndices()
    {
        _cityIndex = null;
        _unitIndex = null;
    }

    public IEnumerable<CityState> CitiesOf(int player) => Cities.Where(c => c.Owner == player);
    public IEnumerable<UnitState> UnitsAt(int tile) => Units.Where(u => u.Tile == tile);

    public PlayerState? FreeCitiesPlayer => Players.Find(p => p.IsFreeCities);

    public void AddCity(CityState city)
    {
        Cities.Add(city);
        Cities.Sort((a, b) => a.Id.CompareTo(b.Id));
        _cityIndex = null;
    }

    public void AddUnit(UnitState unit)
    {
        Units.Add(unit);
        Units.Sort((a, b) => a.Id.CompareTo(b.Id));
        _unitIndex = null;
    }

    public void RemoveUnit(UnitState unit)
    {
        Units.Remove(unit);
        _unitIndex = null;
    }

    public int PlayerEra(PlayerState p)
    {
        int era = 0;
        for (int i = 0; i < p.Techs.Length; i++)
            if (p.Techs[i]) era = Math.Max(era, Db.Eras[Db.Techs[i].EraIndex].Order);
        for (int i = 0; i < p.Civics.Length; i++)
            if (p.Civics[i]) era = Math.Max(era, Db.Eras[Db.Civics[i].EraIndex].Order);
        return era;
    }
}
