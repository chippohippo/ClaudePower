using Godot;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Client.Visuals;

/// <summary>
/// What a city looks like, by its owner's <see cref="TechLook"/>: the buildings on the city-centre tile, each district's
/// buildings, and where smoke (or spores, or data motes) rises. HexMapView draws the pieces, LifeLayer the plumes; both
/// read the same layout so smoke always comes out of a chimney.
/// <list type="table">
/// <item><term>Tribal</term><description>a longhouse among tents and huts</description></item>
/// <item><term>Classical</term><description>a stone keep (a castle for the capital), timber-and-stone houses, towers on the walls</description></item>
/// <item><term>Medieval</term><description>bigger towns: a church, a windmill, an inner ring of houses</description></item>
/// <item><term>Industrial</term><description>a red-brick factory and coal stacks at the heart, terraced suburbs; the old palace kept</description></item>
/// <item><term>Modern</term><description>office blocks downtown, suburbs, a storage tank, the first tower</description></item>
/// <item><term>Atomic</term><description>a skyline rises; satellite dishes</description></item>
/// <item><term>Information</term><description>a full skyline that grows with population; solar fields with renewables</description></item>
/// <item><term>Sovereign</term><description>white arcology spires, bunkers, a bastion wall of sealed blocks, smog stacks, rocket silos</description></item>
/// <item><term>Symbiont</term><description>a great luminous tree, glass greenhouse domes, giant glowing fungi, houses half-swallowed by green</description></item>
/// <item><term>Discarnate</term><description>black monolith towers lit violet, crystal substrate, server blocks, dish arrays</description></item>
/// </list>
/// </summary>
public static class CityLayout
{
    /// <summary>How <see cref="Piece.Size"/> is read: KayKit hex-kit scale factor, or a target width or height in world units.</summary>
    public enum Fit { Kit, Width, Height }

    public readonly record struct Piece(string Prop, Vector3 Offset, float Size, Fit Mode, float Yaw = 0f, Color? Tint = null, float Glow = 0f, bool Team = false);

    /// <summary>Smoke kinds for smoke.gdshader: hearth, coal, spores (Symbiont), data motes (Discarnate), smog (Sovereign).</summary>
    public enum Plume { Hearth = 0, Coal = 1, Spores = 2, Motes = 3, Smog = 4 }

    public static int Houses(CityState c) => Math.Clamp(1 + c.Population / 2, 1, 6);

    private static Vector3 Ring(float degrees, float radius)
    {
        float a = Mathf.DegToRad(degrees);
        return new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * radius;
    }

    /// <summary>
    /// The buildings on the city-centre tile, with the nation's own character: every capital raises its landmark (the pyramid
    /// of Egypt, Venice's campanile, a Song pagoda, the Khan's great ger, an Inca ushnu, Mali's mud mosque), Mongol towns are
    /// tent cities of yurts until the industrial age, and houses before then are built in the nation's materials (sandstone,
    /// terracotta, fieldstone, adobe). Prop names with "{team}" get the owner's team colour.
    /// </summary>
    public static IEnumerable<Piece> Centre(TechLook look, CityState c, bool walls, string? civ)
    {
        bool preIndustrial = look.Architecture < Architecture.Industrial;
        var material = preIndustrial ? Material(civ) : Colors.White;
        foreach (var piece in Centre(look, c, walls))
        {
            bool house = piece.Prop.Contains("home_");
            if (civ == "CIV_MONGOLIA" && preIndustrial && house)
                yield return piece with { Prop = "landmarks/yurt", Size = 0.3f, Mode = Fit.Width, Team = false };
            else if (piece.Team && material != Colors.White)
                yield return piece with { Tint = (piece.Tint ?? Colors.White) * material };
            else yield return piece;
        }
        if (c.IsCapital && Landmark(civ) is { } landmark) yield return landmark;
    }

    /// <summary>Pre-industrial building stone: a multiply over the kit's timber-and-plaster houses.</summary>
    public static Color Material(string? civ) => civ switch
    {
        "CIV_EGYPT" or "CIV_BABYLON" or "CIV_PERSIA" => new Color(1.06f, 0.96f, 0.78f),     // sandstone, mud brick and whitewash
        "CIV_MALI" or "CIV_ARABIA" => new Color(1.06f, 0.8f, 0.58f),                      // banco adobe
        "CIV_INCA" or "CIV_MAYA" or "CIV_AZTEC" => new Color(0.86f, 0.86f, 0.9f),          // fitted fieldstone and stucco
        "CIV_VENICE" or "CIV_SPAIN" or "CIV_PORTUGAL" => new Color(1.06f, 0.88f, 0.84f),   // terracotta and pastel stucco
        "CIV_ROME" or "CIV_GREECE" or "CIV_BYZANTIUM" or "CIV_CARTHAGE" => new Color(1.08f, 1.06f, 1.0f),   // marble and limestone
        "CIV_ZULU" or "CIV_KONGO" or "CIV_ETHIOPIA" => new Color(1.02f, 0.9f, 0.7f),       // thatch and daub
        "CIV_JAPAN" or "CIV_KOREA" or "CIV_VIETNAM" or "CIV_KHMER" => new Color(0.9f, 0.86f, 0.84f),   // dark timber and tile
        "CIV_NORWAY" or "CIV_SCOTLAND" or "CIV_RUSSIA" or "CIV_POLAND" => new Color(0.88f, 0.84f, 0.8f),   // grey stone and pine
        _ => Colors.White,
    };

    /// <summary>The capital's landmark, standing at the back of the city so the banner and units stay clear.</summary>
    public static Piece? Landmark(string? civ)
    {
        var at = Ring(305, 0.9f);
        return civ switch
        {
            "CIV_EGYPT" => new Piece("landmarks/pyramid", at, 0.78f, Fit.Width),
            "CIV_SONG" or "CIV_JAPAN" or "CIV_KOREA" or "CIV_VIETNAM" or "CIV_KHMER" => new Piece("landmarks/pagoda", at, 1.05f, Fit.Height),
            "CIV_MONGOLIA" => new Piece("landmarks/yurt", at, 0.6f, Fit.Width),
            "CIV_INCA" or "CIV_MAYA" or "CIV_AZTEC" or "CIV_BABYLON" => new Piece("landmarks/ushnu", at, 0.7f, Fit.Width),
            "CIV_MALI" or "CIV_ARABIA" or "CIV_OTTOMAN" or "CIV_PERSIA" => new Piece("landmarks/mosque", at, 0.8f, Fit.Width),
            "CIV_NORWAY" or "CIV_HAUDENOSAUNEE" => new Piece("landmarks/longhouse", at, 0.8f, Fit.Width),
            "CIV_ZULU" or "CIV_KONGO" => new Piece("landmarks/kraal", at, 0.8f, Fit.Width),
            "CIV_ETHIOPIA" or "CIV_CARTHAGE" => new Piece("landmarks/stele", at, 1.1f, Fit.Height),
            null => null,
            _ => new Piece("landmarks/campanile", at, 1.2f, Fit.Height),   // Europe and the Americas: the bell tower over the square
        };
    }

    private static IEnumerable<Piece> Centre(TechLook look, CityState c, bool walls)
    {
        int houses = Houses(c);
        bool capital = c.IsCapital;
        float tall = 0.9f + 0.12f * Math.Min(c.Population, 12);   // skylines grow with the city
        var steel = TechLook.PathTint(look.Path);
        switch (look.Architecture)
        {
            case Architecture.Tribal:
                yield return new Piece("buildings/tavern_{team}", Vector3.Zero, 0.55f, Fit.Kit, Team: true);
                for (int i = 0; i < houses; i++)
                    yield return i % 2 == 0
                        ? new Piece("props/tent", Ring(30 + 60 * i, 0.6f), 1.2f, Fit.Kit, -Mathf.DegToRad(30 + 60 * i))
                        : new Piece("buildings/home_A_{team}", Ring(30 + 60 * i, 0.62f), 0.55f, Fit.Kit, -Mathf.DegToRad(30 + 60 * i) + Mathf.Pi / 2, Team: true);
                if (walls) for (int i = 0; i < 3; i++) yield return new Piece("buildings/tower_A_{team}", Ring(90 + 120 * i, 0.85f), 0.3f, Fit.Kit, Team: true);
                yield break;

            case Architecture.Classical:
            case Architecture.Medieval:
                bool medieval = look.Architecture == Architecture.Medieval;
                yield return new Piece(capital ? "buildings/castle_{team}" : "buildings/tower_A_{team}", Vector3.Zero, capital ? 0.62f : 0.6f, Fit.Kit, Team: true);
                for (int i = 0; i < houses; i++)
                {
                    float a = 30 + 60 * i;
                    string prop = medieval && i == 2 ? "buildings/church_{team}" : medieval && i == 4 && houses >= 5 ? "buildings/windmill_{team}" : i % 2 == 0 ? "buildings/home_A_{team}" : "buildings/home_B_{team}";
                    yield return new Piece(prop, Ring(a, 0.62f), medieval ? 0.8f : 0.75f, Fit.Kit, -Mathf.DegToRad(a) + Mathf.Pi / 2, Team: true);
                }
                if (medieval)
                {
                    // A walled burgh even when small: flanking towers and a parish church by the keep.
                    yield return new Piece("buildings/tower_B_{team}", new Vector3(-0.36f, 0, 0.3f), 0.32f, Fit.Kit, Team: true);
                    yield return new Piece("buildings/tower_B_{team}", new Vector3(0.36f, 0, 0.3f), 0.32f, Fit.Kit, Team: true);
                    if (houses < 3) yield return new Piece("buildings/church_{team}", Ring(150, 0.7f), 0.55f, Fit.Kit, Mathf.Pi / 3, Team: true);
                }
                if (medieval && houses >= 4)
                    for (int i = 0; i < 3; i++) yield return new Piece("buildings/home_B_{team}", Ring(60 + 120 * i, 0.95f), 0.55f, Fit.Kit, Mathf.DegToRad(60 + 120 * i), Team: true);
                if (walls) for (int i = 0; i < 3; i++) yield return new Piece("buildings/tower_B_{team}", Ring(90 + 120 * i, 0.8f), 0.35f, Fit.Kit, Team: true);
                yield break;

            case Architecture.Industrial:
                yield return new Piece("era/factory_a", new Vector3(0.05f, 0, -0.12f), 0.75f, Fit.Width);
                yield return new Piece("era/chimney_industrial", new Vector3(-0.36f, 0, 0.22f), 0.95f, Fit.Height, 0, new Color(0.85f, 0.55f, 0.45f));
                yield return new Piece("era/chimney_industrial", new Vector3(-0.18f, 0, 0.3f), 0.8f, Fit.Height, 0, new Color(0.85f, 0.55f, 0.45f));
                if (capital) yield return new Piece("buildings/castle_{team}", Ring(270, 0.62f), 0.42f, Fit.Kit, Team: true);
                for (int i = 0; i < houses; i++)
                {
                    float a = 30 + 60 * i;
                    if (capital && i == 4) continue;
                    yield return new Piece($"era/suburb_{"abcd"[i % 4]}", Ring(a, 0.66f), 0.42f, Fit.Width, -Mathf.DegToRad(a) - Mathf.Pi / 2);
                }
                yield break;

            case Architecture.Modern:
            case Architecture.Atomic:
                bool atomic = look.Architecture == Architecture.Atomic;
                yield return new Piece(atomic ? "era/skyscraper_a" : "era/office_a", new Vector3(-0.12f, 0, 0), atomic ? tall : 0.8f, Fit.Height);
                yield return new Piece("era/office_b", new Vector3(0.22f, 0, 0.12f), 0.62f, Fit.Height, 0.3f);
                yield return new Piece("era/office_c", new Vector3(0.1f, 0, -0.3f), 0.42f, Fit.Height, 1.2f);
                for (int i = 0; i < houses; i++)
                {
                    float a = 30 + 60 * i;
                    yield return i == 3
                        ? new Piece("era/factory_c", Ring(a, 0.7f), 0.5f, Fit.Width, -Mathf.DegToRad(a))
                        : new Piece($"era/suburb_{"abcd"[i % 4]}", Ring(a, 0.66f), 0.42f, Fit.Width, -Mathf.DegToRad(a) - Mathf.Pi / 2);
                }
                yield return new Piece("era/tank_storage", Ring(200, 0.9f), 0.32f, Fit.Width);
                if (atomic && capital) yield return new Piece("era/dish", Ring(320, 0.92f), 0.32f, Fit.Width, 2.4f);
                yield break;

            case Architecture.Information:
                yield return new Piece(c.Population >= 8 ? "era/skyscraper_d" : "era/skyscraper_b", Vector3.Zero, tall * 1.25f, Fit.Height);
                yield return new Piece("era/skyscraper_c", new Vector3(0.32f, 0, 0.18f), tall * 0.85f, Fit.Height, 1.57f);
                yield return new Piece("era/skyscraper_e", new Vector3(-0.3f, 0, 0.22f), tall * 0.7f, Fit.Height);
                for (int i = 0; i < houses; i++)
                {
                    float a = 30 + 60 * i;
                    yield return new Piece(i % 3 == 0 ? "era/skyscraper_a" : i % 3 == 1 ? "era/office_a" : "era/office_c", Ring(a, 0.68f), i % 3 == 0 ? tall * 0.6f : 0.55f, Fit.Height, -Mathf.DegToRad(a));
                }
                if (look.Renewable) yield return new Piece("era/solar_field", Ring(250, 0.9f), 0.5f, Fit.Width, 0.5f);
                yield return new Piece("era/dish", Ring(320, 0.92f), 0.3f, Fit.Width, 2.4f);
                yield break;

            case Architecture.Sovereign:
                // Destructive: the arcology. Bleached spires, bunkers, a ring of sealed blocks where the walls were, smog stacks.
                yield return new Piece("era/skyscraper_d", Vector3.Zero, tall * 1.5f, Fit.Height, 0, steel, 0.55f);
                yield return new Piece("era/skyscraper_b", new Vector3(0.34f, 0, 0.12f), tall * 1.05f, Fit.Height, 0.8f, steel, 0.45f);
                for (int i = 0; i < houses; i++)
                {
                    float a = 30 + 60 * i;
                    yield return i % 2 == 0
                        ? new Piece("future/hangar_large", Ring(a, 0.66f), 0.42f, Fit.Width, -Mathf.DegToRad(a), steel, 0.25f)
                        : new Piece("era/skyscraper_a", Ring(a, 0.62f), tall * 0.75f, Fit.Height, -Mathf.DegToRad(a), steel, 0.4f);
                }
                for (int i = 0; i < 12; i++)   // the bastion wall
                    yield return new Piece("era/office_c", Ring(i * 30 + 15, 0.98f), 0.24f, Fit.Width, -Mathf.DegToRad(i * 30 + 15), new Color(0.95f, 0.97f, 1.02f), 0.2f);
                yield return new Piece("future/space_chimney", new Vector3(-0.38f, 0, -0.2f), 1.1f, Fit.Height, 0, new Color(0.55f, 0.56f, 0.6f));
                yield return new Piece("future/space_chimney", new Vector3(-0.22f, 0, -0.4f), 0.9f, Fit.Height, 0, new Color(0.55f, 0.56f, 0.6f));
                if (capital || look.PathDepth >= 4) yield return new Piece("future/rocket_base", Ring(200, 0.86f), 0.4f, Fit.Width, 0, steel, 0.3f);
                yield break;

            case Architecture.Symbiont:
                // Harmonized: the city is a garden. A great tree at the heart, greenhouse domes, giant glowing fungi.
                // The great tree: a broad, luminous canopy over the city, with lesser trees around it.
                yield return new Piece("nature/tree_single_B", Vector3.Zero, 1.7f + 0.06f * c.Population, Fit.Height, 0, new Color(0.55f, 0.95f, 1.15f), 1f);
                yield return new Piece("nature/tree_single_B", new Vector3(0.3f, 0, 0.22f), 0.9f, Fit.Height, 1f, new Color(0.95f, 0.75f, 1.05f), 0.6f);
                yield return new Piece("nature/tree_single_B", new Vector3(-0.3f, 0, 0.18f), 0.75f, Fit.Height, 2f, new Color(0.75f, 1.05f, 0.85f), 0.5f);
                for (int i = 0; i < houses; i++)
                {
                    float a = 30 + 60 * i;
                    yield return i % 2 == 0
                        ? new Piece("future/dome_glass", Ring(a, 0.66f), 0.5f, Fit.Width, -Mathf.DegToRad(a), new Color(0.7f, 1.05f, 0.9f), 0.6f)
                        : new Piece($"era/suburb_{"abcd"[i % 4]}", Ring(a, 0.66f), 0.38f, Fit.Width, -Mathf.DegToRad(a) - Mathf.Pi / 2, steel, 0.2f);
                    yield return new Piece("nature/tree_single_A", Ring(a + 28, 0.82f), 0.35f, Fit.Height, a, new Color(0.75f, 1.05f, 0.85f));
                }
                for (int i = 0; i < 3; i++)
                    yield return new Piece("future/mushroom_tall", Ring(90 + 120 * i, 0.4f), 0.55f + 0.15f * i, Fit.Height, i, new Color(0.8f, 0.55f, 1.1f), 0.9f);
                yield break;

            case Architecture.Discarnate:
                // Syncretic: mind fused with machine. Black monoliths lit violet, crystal substrate, server blocks, dish arrays.
                var glass = TechLook.PathTint(TechLook.Discarnate);
                yield return new Piece("era/skyscraper_d", Vector3.Zero, tall * 1.6f, Fit.Height, 0.785f, glass, 0.85f);
                yield return new Piece("era/skyscraper_c", new Vector3(0.3f, 0, -0.2f), tall * 1.0f, Fit.Height, 0, glass, 0.7f);
                for (int i = 0; i < houses; i++)
                {
                    float a = 30 + 60 * i;
                    yield return i % 2 == 0
                        ? new Piece("future/structure_detailed", Ring(a, 0.64f), 0.3f, Fit.Width, -Mathf.DegToRad(a), glass, 0.8f)
                        : new Piece("future/crystal_large", Ring(a, 0.64f), 0.42f, Fit.Width, a, new Color(0.75f, 0.55f, 1.2f), 1f);
                }
                yield return new Piece("future/rock_crystals", Ring(200, 0.9f), 0.45f, Fit.Width, 0, new Color(0.6f, 0.45f, 1.0f), 1f);
                yield return new Piece("era/dish", Ring(320, 0.9f), 0.32f, Fit.Width, 2.4f, glass, 0.6f);
                yield return new Piece("era/dish", Ring(345, 0.95f), 0.24f, Fit.Width, 2.0f, glass, 0.6f);
                yield break;
        }
    }

    /// <summary>What rises from a city: one plume per chimney / tree / monolith, in the city's own kind.</summary>
    public static IEnumerable<(Vector3 Offset, float Height, Plume Kind)> Plumes(TechLook look, CityState c)
    {
        int houses = Houses(c);
        switch (look.Architecture)
        {
            case Architecture.Tribal:
            case Architecture.Classical:
            case Architecture.Medieval:
                for (int i = 0; i < Math.Min(houses, 4); i++) yield return (Ring(30 + 60 * i, 0.62f), 0.4f, Plume.Hearth);
                yield break;
            case Architecture.Industrial:
                yield return (new Vector3(-0.36f, 0, 0.22f), 0.95f, Plume.Coal);
                yield return (new Vector3(-0.18f, 0, 0.3f), 0.8f, Plume.Coal);
                yield return (Ring(90, 0.66f), 0.42f, Plume.Hearth);
                yield break;
            case Architecture.Modern:
            case Architecture.Atomic:
            case Architecture.Information:
                if (houses > 3) yield return (Ring(120, 0.7f) + new Vector3(0, 0, 0), 0.45f, look.Coal ? Plume.Coal : Plume.Hearth);
                yield break;
            case Architecture.Sovereign:
                yield return (new Vector3(-0.38f, 0, -0.2f), 1.1f, Plume.Smog);
                yield return (new Vector3(-0.22f, 0, -0.4f), 0.9f, Plume.Smog);
                yield break;
            case Architecture.Symbiont:
                for (int i = 0; i < 3; i++) yield return (Ring(90 + 120 * i, 0.4f), 0.5f, Plume.Spores);
                yield return (Vector3.Zero, 1.6f, Plume.Spores);
                yield return (new Vector3(0.3f, 0, 0.22f), 0.9f, Plume.Spores);
                yield break;
            case Architecture.Discarnate:
                yield return (Vector3.Zero, 1.2f, Plume.Motes);
                for (int i = 0; i < houses; i += 2) yield return (Ring(30 + 60 * i, 0.64f), 0.3f, Plume.Motes);
                yield break;
        }
    }

    /// <summary>A district's buildings, by what it is and how far its owner has come.</summary>
    public static IEnumerable<Piece> District(TechLook look, DistrictDef def)
    {
        // World wonders keep their own form in every age.
        if (def.Model is { } model)
        {
            bool tall = model is "wonders/eiffel" or "wonders/big_ben" or "wonders/colossus" or "wonders/launch_complex";
            yield return tall ? new Piece(model, Vector3.Zero, 1.35f, Fit.Height) : new Piece(model, Vector3.Zero, 1.3f, Fit.Width);
            yield break;
        }
        var side = new Vector3(0.42f, 0, 0.25f);
        var steel = TechLook.PathTint(look.Path);
        switch (look.Architecture)
        {
            case Architecture.Sovereign:
                yield return new Piece(def.PrimaryYield == YieldType.Production || def.Id == "DISTRICT_GARRISON" ? "future/hangar_large" : "era/skyscraper_a", Vector3.Zero, def.PrimaryYield == YieldType.Production ? 0.7f : 1.1f, def.PrimaryYield == YieldType.Production ? Fit.Width : Fit.Height, 0, steel, 0.45f);
                yield return new Piece("era/office_c", side, 0.26f, Fit.Width, 0, steel, 0.2f);
                yield return new Piece("era/office_c", -side, 0.26f, Fit.Width, 0, steel, 0.2f);
                yield break;
            case Architecture.Symbiont:
                yield return new Piece("future/dome_glass", Vector3.Zero, 0.75f, Fit.Width, 0, new Color(0.7f, 1.05f, 0.9f), 0.6f);
                yield return new Piece("future/mushroom_tall", side, 0.6f, Fit.Height, 0, new Color(0.8f, 0.55f, 1.1f), 0.9f);
                yield return new Piece("nature/tree_single_B", -side, 0.9f, Fit.Height, 0, new Color(0.7f, 1.0f, 0.95f), 0.6f);
                yield break;
            case Architecture.Discarnate:
                yield return new Piece("era/skyscraper_c", Vector3.Zero, 1.2f, Fit.Height, 0.4f, steel, 0.75f);
                yield return new Piece("future/crystal_large", side, 0.4f, Fit.Width, 0, new Color(0.75f, 0.55f, 1.2f), 1f);
                yield return new Piece("future/structure_detailed", -side, 0.26f, Fit.Width, 0, steel, 0.8f);
                yield break;
        }
        if (look.Architecture >= Architecture.Industrial)
        {
            bool info = look.Architecture == Architecture.Information;
            bool atomic = look.Architecture >= Architecture.Atomic;
            switch (def.Id)
            {
                case "DISTRICT_NEIGHBORHOOD":
                    for (int i = 0; i < 4; i++)
                        yield return info
                            ? new Piece(i % 2 == 0 ? "era/skyscraper_e" : "era/office_a", new Vector3((i % 2) * 0.6f - 0.3f, 0, (i / 2) * 0.6f - 0.3f), i % 2 == 0 ? 1.0f : 0.55f, Fit.Height)
                            : new Piece($"era/suburb_{"abcd"[i]}", new Vector3((i % 2) * 0.6f - 0.3f, 0, (i / 2) * 0.6f - 0.3f), 0.42f, Fit.Width);
                    yield break;
                case "DISTRICT_HARBOR":
                    yield return new Piece("buildings/building-port", Vector3.Zero, 0.155f * 0.6f, Fit.Kit);
                    yield return new Piece("era/tank_storage", side, 0.3f, Fit.Width);
                    yield break;
                case "DISTRICT_GARRISON" when atomic:
                    yield return new Piece("future/hangar_large", Vector3.Zero, 0.6f, Fit.Width);
                    yield break;
            }
            switch (def.PrimaryYield)
            {
                case YieldType.Production:
                    yield return new Piece("era/factory_b", Vector3.Zero, 0.8f, Fit.Width);
                    yield return new Piece("era/chimney_industrial", new Vector3(-0.3f, 0, -0.3f), 0.8f, Fit.Height);
                    yield break;
                case YieldType.Science:
                    yield return new Piece(info ? "era/skyscraper_c" : "era/office_b", Vector3.Zero, info ? 1.0f : 0.6f, Fit.Height);
                    if (atomic) yield return new Piece("era/dish", side, 0.35f, Fit.Width, 2.4f);
                    yield break;
                case YieldType.Gold:
                    yield return new Piece(atomic ? "era/skyscraper_a" : "era/office_a", Vector3.Zero, atomic ? 1.1f : 0.7f, Fit.Height);
                    yield return new Piece("era/office_c", side, 0.4f, Fit.Height);
                    yield break;
            }
        }
    }

    /// <summary>A plume on a district (factories smoke, future districts glow).</summary>
    public static (Vector3 Offset, float Height, Plume Kind)? DistrictPlume(TechLook look, DistrictDef def) => look.Architecture switch
    {
        Architecture.Symbiont => (new Vector3(0.42f, 0, 0.25f), 0.5f, Plume.Spores),
        Architecture.Discarnate => (Vector3.Zero, 1.0f, Plume.Motes),
        Architecture.Sovereign when def.PrimaryYield == YieldType.Production => (Vector3.Zero, 0.6f, Plume.Smog),
        >= Architecture.Industrial when def.PrimaryYield == YieldType.Production && look.Coal => (new Vector3(-0.3f, 0, -0.3f), 0.8f, Plume.Coal),
        _ => null,
    };
}
