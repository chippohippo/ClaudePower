using System.Collections;

namespace UnbrokenAges.Sim.Data;

/// <summary>Ordered, indexed table of definitions. Index order is the deterministic merge order.</summary>
public sealed class DefTable<T> : IReadOnlyList<T> where T : Definition
{
    private readonly List<T> _items = new();
    private readonly Dictionary<string, int> _byId = new(StringComparer.Ordinal);

    public string Category { get; }

    public DefTable(string category) => Category = category;

    public T this[int index] => _items[index];
    public T this[string id] => _items[_byId.TryGetValue(id, out int i) ? i : throw new KeyNotFoundException($"{Category}: unknown id '{id}'")];
    public int Count => _items.Count;

    public int IndexOf(string? id) => id != null && _byId.TryGetValue(id, out int i) ? i : -1;
    public bool Contains(string id) => _byId.ContainsKey(id);

    internal void Add(T def)
    {
        def.Index = _items.Count;
        _byId[def.Id] = def.Index;
        _items.Add(def);
    }

    public IEnumerator<T> GetEnumerator() => _items.GetEnumerator();
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}

public sealed class LinkContext
{
    public GameDatabase Db { get; }
    public List<string> Errors { get; }

    public LinkContext(GameDatabase db, List<string> errors)
    {
        Db = db;
        Errors = errors;
    }

    public void Error(Definition owner, string message) =>
        Errors.Add($"[{owner.SourceMod}] {owner.GetType().Name.Replace("Def", "")} '{owner.Id}': {message}");

    public int Resolve<T>(DefTable<T> table, string? id, Definition owner, string field, bool required = false) where T : Definition
    {
        if (string.IsNullOrEmpty(id))
        {
            if (required) Error(owner, $"'{field}' is required.");
            return -1;
        }
        int index = table.IndexOf(id);
        if (index < 0) Error(owner, $"'{field}' references unknown {table.Category} id '{id}'.");
        return index;
    }

    public int[] ResolveAll<T>(DefTable<T> table, IReadOnlyList<string> ids, Definition owner, string field) where T : Definition
    {
        var result = new List<int>(ids.Count);
        foreach (var id in ids)
        {
            int i = Resolve(table, id, owner, field, required: true);
            if (i >= 0) result.Add(i);
        }
        return result.ToArray();
    }
}

/// <summary>
/// The compiled, read-only set of all game definitions after the base game and every enabled
/// mod have been merged. Shared (read-only) by simulation, UI, AI and tools.
/// </summary>
public sealed class GameDatabase
{
    public DefTable<TerrainDef> Terrains { get; } = new("terrains");
    public DefTable<ReliefDef> Reliefs { get; } = new("reliefs");
    public DefTable<FeatureDef> Features { get; } = new("features");
    public DefTable<ResourceDef> Resources { get; } = new("resources");
    public DefTable<ImprovementDef> Improvements { get; } = new("improvements");
    public DefTable<DistrictDef> Districts { get; } = new("districts");
    public DefTable<BuildingDef> Buildings { get; } = new("buildings");
    public DefTable<ProjectDef> Projects { get; } = new("projects");
    public DefTable<UnitDef> Units { get; } = new("units");
    public DefTable<EraDef> Eras { get; } = new("eras");
    public DefTable<TechDef> Techs { get; } = new("techs");
    public DefTable<CivicDef> Civics { get; } = new("civics");
    public DefTable<GovernorDef> Governors { get; } = new("governors");
    public DefTable<CivilizationDef> Civilizations { get; } = new("civilizations");
    public DefTable<LeaderDef> Leaders { get; } = new("leaders");
    public DefTable<DisasterDef> Disasters { get; } = new("disasters");
    public DefTable<ClimateConfigDef> Climate { get; } = new("climate");
    public DefTable<MapSizeDef> MapSizes { get; } = new("mapSizes");
    public DefTable<DivergenceDef> Divergences { get; } = new("divergences");
    public DefTable<WorldAgeDef> WorldAges { get; } = new("worldAges");
    public DefTable<WorldRulesDef> WorldRules { get; } = new("worldRules");
    public DefTable<ChronicleTemplateDef> ChronicleTemplates { get; } = new("chronicle");
    public DefTable<GovernorTraitDef> GovernorTraits { get; } = new("governorTraits");

    public WorldRulesDef Rules => WorldRules.Count > 0 ? WorldRules[0] : new WorldRulesDef { Id = "WORLD_RULES_DEFAULT" };

    /// <summary>Techs and civics that grant empire-wide modifiers (cached for CityEffects).</summary>
    public int[] TechsWithModifiers { get; private set; } = Array.Empty<int>();
    public int[] CivicsWithModifiers { get; private set; } = Array.Empty<int>();

    /// <summary>Hash of the merged content. Peers must match this exactly to play together.</summary>
    public ulong ContentHash { get; internal set; }

    /// <summary>Mods merged into this database, in load order (id@version).</summary>
    public IReadOnlyList<string> LoadedMods { get; internal set; } = Array.Empty<string>();

    public WellKnownIds Ids { get; private set; } = null!;

    public ClimateConfigDef ClimateConfig => Climate.Count > 0 ? Climate[0] : new ClimateConfigDef { Id = "CLIMATE_DEFAULT" };

    internal sealed record CategoryInfo(string Key, Type Type, Action<Definition> Add);

    /// <summary>Category keys (as used in JSON data files) in fixed merge/hash order.</summary>
    internal IReadOnlyList<CategoryInfo> Categories => _categories ??= BuildCategories();
    private List<CategoryInfo>? _categories;

    private List<CategoryInfo> BuildCategories()
    {
        var r = new List<CategoryInfo>();
        void Reg<T>(DefTable<T> t) where T : Definition => r.Add(new CategoryInfo(t.Category, typeof(T), d => t.Add((T)d)));
        Reg(Eras); Reg(Terrains); Reg(Reliefs); Reg(Features); Reg(Resources); Reg(Improvements);
        Reg(Districts); Reg(Buildings); Reg(Projects); Reg(Units); Reg(Techs); Reg(Civics);
        Reg(Governors); Reg(Civilizations); Reg(Leaders); Reg(Disasters); Reg(Climate); Reg(MapSizes);
        Reg(Divergences); Reg(WorldAges); Reg(WorldRules); Reg(ChronicleTemplates); Reg(GovernorTraits);
        return r;
    }

    internal IEnumerable<Definition> AllDefinitions()
    {
        IEnumerable<Definition> all = Eras;
        all = all.Concat(Terrains).Concat(Reliefs).Concat(Features).Concat(Resources).Concat(Improvements)
            .Concat(Districts).Concat(Buildings).Concat(Projects).Concat(Units).Concat(Techs).Concat(Civics)
            .Concat(Governors).Concat(Civilizations).Concat(Leaders).Concat(Disasters).Concat(Climate).Concat(MapSizes).Concat(Divergences)
            .Concat(WorldAges).Concat(WorldRules).Concat(ChronicleTemplates).Concat(GovernorTraits);
        return all;
    }

    internal void LinkAll(List<string> errors)
    {
        var ctx = new LinkContext(this, errors);
        foreach (var def in AllDefinitions()) def.Link(ctx);
        Ids = WellKnownIds.Resolve(this, errors);
        ValidateTechTreeAcyclic(errors);
        TechsWithModifiers = Techs.Where(t => t.Modifiers.Count > 0).Select(t => t.Index).ToArray();
        CivicsWithModifiers = Civics.Where(c => c.Modifiers.Count > 0).Select(c => c.Index).ToArray();
        foreach (var d in Divergences)
            if (d.DoctrineTechIndex >= 0 && (Techs[d.DoctrineTechIndex].DivergenceIndex != d.Index || !Techs[d.DoctrineTechIndex].Doctrine))
                errors.Add($"divergences '{d.Id}': doctrineTech '{d.DoctrineTech}' must be a doctrine tech of this divergence.");
    }

    private void ValidateTechTreeAcyclic(List<string> errors)
    {
        void Check<T>(DefTable<T> table) where T : ProgressNodeDef
        {
            var state = new byte[table.Count]; // 0=unvisited 1=visiting 2=done
            bool Visit(int i)
            {
                if (state[i] == 2) return true;
                if (state[i] == 1) return false;
                state[i] = 1;
                foreach (int p in table[i].PrereqIndices)
                    if (!Visit(p)) return false;
                state[i] = 2;
                return true;
            }
            for (int i = 0; i < table.Count; i++)
                if (!Visit(i)) { errors.Add($"{table.Category}: prerequisite cycle involving '{table[i].Id}'."); return; }
        }
        Check(Techs);
        Check(Civics);
    }
}

/// <summary>Definitions the engine itself needs to know about (map generator palette, city center...).</summary>
public sealed class WellKnownIds
{
    public int Ocean, Coast, Lake, Channel, Grassland, Plains, Desert, Tundra, Snow;
    public int Flat, Hills, Mountain;
    public int Forest = -1, Rainforest = -1, Marsh = -1, Floodplains = -1, Oasis = -1, Ice = -1, Volcano = -1, Geothermal = -1, Reef = -1;
    public int CityCenter;

    internal static WellKnownIds Resolve(GameDatabase db, List<string> errors)
    {
        int Req<T>(DefTable<T> t, string id) where T : Definition
        {
            int i = t.IndexOf(id);
            if (i < 0) errors.Add($"engine: required {t.Category} id '{id}' is missing (the base game or a total-conversion mod must define it).");
            return i;
        }
        return new WellKnownIds
        {
            Ocean = Req(db.Terrains, "TERRAIN_OCEAN"),
            Coast = Req(db.Terrains, "TERRAIN_COAST"),
            Lake = Req(db.Terrains, "TERRAIN_LAKE"),
            Channel = Req(db.Terrains, "TERRAIN_CHANNEL"),
            Grassland = Req(db.Terrains, "TERRAIN_GRASSLAND"),
            Plains = Req(db.Terrains, "TERRAIN_PLAINS"),
            Desert = Req(db.Terrains, "TERRAIN_DESERT"),
            Tundra = Req(db.Terrains, "TERRAIN_TUNDRA"),
            Snow = Req(db.Terrains, "TERRAIN_SNOW"),
            Flat = Req(db.Reliefs, "RELIEF_FLAT"),
            Hills = Req(db.Reliefs, "RELIEF_HILLS"),
            Mountain = Req(db.Reliefs, "RELIEF_MOUNTAIN"),
            Forest = db.Features.IndexOf("FEATURE_FOREST"),
            Rainforest = db.Features.IndexOf("FEATURE_RAINFOREST"),
            Marsh = db.Features.IndexOf("FEATURE_MARSH"),
            Floodplains = db.Features.IndexOf("FEATURE_FLOODPLAINS"),
            Oasis = db.Features.IndexOf("FEATURE_OASIS"),
            Ice = db.Features.IndexOf("FEATURE_ICE"),
            Volcano = db.Features.IndexOf("FEATURE_VOLCANO"),
            Geothermal = db.Features.IndexOf("FEATURE_GEOTHERMAL"),
            Reef = db.Features.IndexOf("FEATURE_REEF"),
            CityCenter = Req(db.Districts, "DISTRICT_CITY_CENTER"),
        };
    }
}
