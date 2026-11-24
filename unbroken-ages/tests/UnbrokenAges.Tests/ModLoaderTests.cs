namespace UnbrokenAges.Tests;

public class ModLoaderTests
{
    private static GameDatabase LoadWith(string modJson) =>
        ModLoader.LoadFromStrings(TestWorld.BaseDocuments().Append(("testmod", modJson)));

    [Fact]
    public void BaseGame_LoadsAndLinksWithoutErrors()
    {
        var db = TestWorld.Db;
        Assert.True(db.Districts.Count >= 15);
        Assert.Equal(8, db.Governors.Count);
        Assert.NotEqual(0UL, db.ContentHash);
        Assert.Equal(db.Districts.IndexOf("DISTRICT_FOUNDRY"), db.Districts["DISTRICT_ARSENAL"].ReplacesIndex);
    }

    [Fact]
    public void Patch_MergesObjects_AndAppendsArrays()
    {
        var db = LoadWith("""
        { "districts": [ { "$op": "patch", "id": "DISTRICT_ACADEMY", "cost": 70,
            "adjacency": { "$append": [ { "yield": "Science", "amount": 1, "source": { "terrainClass": "Channel" } } ] } } ] }
        """);
        var academy = db.Districts["DISTRICT_ACADEMY"];
        Assert.Equal(Fx.FromInt(70), academy.Cost);
        Assert.Equal(6, academy.Adjacency.Count);
        Assert.Equal(TerrainClass.Channel, academy.Adjacency[^1].Source.TerrainClass);
        Assert.NotEqual(TestWorld.Db.ContentHash, db.ContentHash);
    }

    [Fact]
    public void Patch_RemoveWhere_DeletesMatchingArrayElements()
    {
        var db = LoadWith("""
        { "districts": [ { "$op": "patch", "id": "DISTRICT_ACADEMY",
            "adjacency": { "$removeWhere": { "source": { "feature": "FEATURE_GEOTHERMAL" } } } } ] }
        """);
        Assert.DoesNotContain(db.Districts["DISTRICT_ACADEMY"].Adjacency, r => r.Source.Feature == "FEATURE_GEOTHERMAL");
        Assert.Equal(4, db.Districts["DISTRICT_ACADEMY"].Adjacency.Count);
    }

    [Fact]
    public void Delete_And_Replace_Work()
    {
        var db = LoadWith("""
        { "units": [
            { "$op": "delete", "id": "UNIT_RIVER_BARGE" },
            { "$op": "replace", "id": "UNIT_WARRIOR", "name": "Clubman", "domain": "Land", "unitClass": "Melee", "cost": 35, "strength": 18 } ] }
        """);
        Assert.False(db.Units.Contains("UNIT_RIVER_BARGE"));
        Assert.Equal("Clubman", db.Units["UNIT_WARRIOR"].Name);
        Assert.Empty(db.Units["UNIT_WARRIOR"].UpgradesTo);
    }

    [Fact]
    public void DuplicateAdd_IsAnError()
    {
        var ex = Assert.Throws<ModLoadException>(() => LoadWith("""{ "units": [ { "id": "UNIT_SCOUT", "name": "Dup", "domain": "Land" } ] }"""));
        Assert.Contains(ex.Errors, e => e.Contains("already defined"));
    }

    [Fact]
    public void UnknownProperty_IsAnError_CatchingTypos()
    {
        var ex = Assert.Throws<ModLoadException>(() => LoadWith("""{ "units": [ { "id": "UNIT_X", "name": "X", "domain": "Land", "costt": 5 } ] }"""));
        Assert.Contains(ex.Errors, e => e.Contains("costt"));
    }

    [Fact]
    public void DanglingReference_IsAnError_WithContext()
    {
        var ex = Assert.Throws<ModLoadException>(() => LoadWith("""{ "buildings": [ { "id": "BUILDING_X", "name": "X", "district": "DISTRICT_NOPE", "cost": 10 } ] }"""));
        Assert.Contains(ex.Errors, e => e.Contains("[testmod]") && e.Contains("DISTRICT_NOPE"));
    }

    [Fact]
    public void LoadOrder_RespectsDependencies_AndDetectsCycles()
    {
        LoadedMod Mod(string id, params string[] deps) =>
            new(new ModManifest { Id = id, DependsOn = deps.Select(d => new ModDependency { Id = d }).ToList() }, "/nowhere");
        var errors = new List<string>();
        var order = ModLoader.ResolveLoadOrder(new[] { Mod("zeta", "alpha"), Mod("alpha", "base"), Mod("base") }, errors);
        Assert.Empty(errors);
        Assert.Equal(new[] { "base", "alpha", "zeta" }, order.Select(m => m.Manifest.Id));

        errors.Clear();
        ModLoader.ResolveLoadOrder(new[] { Mod("a", "b"), Mod("b", "a") }, errors);
        Assert.Contains(errors, e => e.Contains("cycle"));
    }

    [Fact]
    public void ExampleMod_LoadsOnTopOfBase()
    {
        var db = ModLoader.LoadFromDirectories(new[] { TestWorld.BaseModPath, Path.Combine(TestWorld.RepoRoot, "mods", "example-river-trade") });
        Assert.True(db.Buildings.Contains("BUILDING_TOLL_HOUSE"));
        Assert.Contains(db.LoadedMods, m => m.StartsWith("example-river-trade"));
    }
}
