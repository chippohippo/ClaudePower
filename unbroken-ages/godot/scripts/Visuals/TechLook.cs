using Godot;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Client.Visuals;

/// <summary>How a civilization's towns are built, from tribal camps to the three Divergence futures.</summary>
public enum Architecture { Tribal, Classical, Medieval, Industrial, Modern, Atomic, Information, Sovereign, Symbiont, Discarnate }

/// <summary>What its roads are made of. The order matters: a trade road between two civilizations uses the lower of the two.</summary>
public enum RoadKind { Footpath, Track, Stone, Macadam, Asphalt, Smart, Sovereign, Symbiont, Discarnate }

/// <summary>What moves on those roads.</summary>
public enum Traffic { Porters, Carts, Lorries, Motor, Autonomous, Sovereign, Symbiont, Discarnate }

/// <summary>
/// Everything the map shows about a civilization's progress, derived <b>only from the technologies it has researched</b>
/// (a Divergence counts once its doctrine tech is researched). Civics, eras and turn numbers never change the look: research
/// Masonry and your huts become stone towns, Industrialization raises factories and coal stacks, Refining paves the roads
/// for cars, Robotics brings autonomous traffic and glowing lanes. At the top of the tree the three doctrines take human
/// design to three opposite peaks:
/// <list type="bullet">
/// <item><b>Sovereign — destructive.</b> The world graded and sealed: white ceramic arcologies, bunkers and bastion walls,
///   rocket silos, black smog stacks, convoys on broad concrete highways.</item>
/// <item><b>Symbiont — harmonized.</b> Cities grown, not built: great living trees, glass greenhouse domes, giant
///   bioluminescent fungi, mossy paths veined with light, people on foot and drifting spores instead of smoke.</item>
/// <item><b>Discarnate — syncretic.</b> Mind and machine fused: black monolith towers with violet light, crystal substrate,
///   server blocks and dish arrays, glass conduits pulsing with data, hovercraft instead of cars, drones instead of people.</item>
/// </list>
/// The milestone technologies are named here; a mod that removes one simply skips that step.
/// </summary>
public sealed record TechLook(Architecture Architecture, RoadKind Road, Traffic Traffic, int Path, int PathDepth, bool Coal, bool Renewable, bool Electric)
{
    public static readonly TechLook Default = new(Architecture.Tribal, RoadKind.Footpath, Traffic.Porters, -1, 0, false, false, false);

    /// <summary>The Divergence index → index in the order Sovereign, Symbiont, Discarnate (by id, so content order does not matter).</summary>
    public const int Sovereign = 0, Symbiont = 1, Discarnate = 2;

    public bool IsFuture => Path >= 0;

    public static TechLook For(GameState s, int player)
    {
        if (player < 0 || player >= s.Players.Count) return Default;
        var p = s.Players[player];
        var db = s.Db;
        bool Has(string id)
        {
            int i = db.Techs.IndexOf(id);
            return i >= 0 && i < p.Techs.Length && p.Techs[i];
        }

        int path = -1, depth = 0;
        if (p.Divergence >= 0 && p.Divergence < db.Divergences.Count)
        {
            string id = db.Divergences[p.Divergence].Id;
            path = id.Contains("SOVEREIGN") ? Sovereign : id.Contains("SYMBIONT") ? Symbiont : id.Contains("DISCARNATE") ? Discarnate : -1;
            for (int i = 0; i < db.Techs.Count && i < p.Techs.Length; i++)
                if (p.Techs[i] && db.Techs[i].DivergenceIndex == p.Divergence) depth++;
        }

        var arch = Architecture.Tribal;
        if (Has("TECH_MASONRY")) arch = Architecture.Classical;
        if (Has("TECH_APPRENTICESHIP") || Has("TECH_EDUCATION")) arch = Architecture.Medieval;
        if (Has("TECH_INDUSTRIALIZATION")) arch = Architecture.Industrial;
        if (Has("TECH_ELECTRICITY") || Has("TECH_REFINING")) arch = Architecture.Modern;
        if (Has("TECH_NUCLEAR_FISSION") || Has("TECH_ROCKETRY") || Has("TECH_FLIGHT")) arch = Architecture.Atomic;
        if (Has("TECH_ROBOTICS") || Has("TECH_RENEWABLE_ENERGY")) arch = Architecture.Information;

        var road = RoadKind.Footpath;
        if (Has("TECH_ANIMAL_HUSBANDRY") || Has("TECH_POTTERY")) road = RoadKind.Track;
        if (Has("TECH_ENGINEERING")) road = RoadKind.Stone;
        if (Has("TECH_INDUSTRIALIZATION")) road = RoadKind.Macadam;
        if (Has("TECH_REFINING")) road = RoadKind.Asphalt;
        if (Has("TECH_ROBOTICS")) road = RoadKind.Smart;

        var traffic = Traffic.Porters;
        if (Has("TECH_ANIMAL_HUSBANDRY")) traffic = Traffic.Carts;
        if (Has("TECH_INDUSTRIALIZATION")) traffic = Traffic.Lorries;
        if (Has("TECH_REFINING")) traffic = Traffic.Motor;
        if (Has("TECH_ROBOTICS")) traffic = Traffic.Autonomous;

        if (path >= 0)
        {
            arch = Architecture.Sovereign + path;
            road = RoadKind.Sovereign + path;
            traffic = Traffic.Sovereign + path;
        }
        bool renewable = Has("TECH_RENEWABLE_ENERGY");
        return new TechLook(arch, road, traffic, path, depth, Has("TECH_INDUSTRIALIZATION") && !renewable, renewable, Has("TECH_ELECTRICITY"));
    }

    // ----- Palettes for the futures -----------------------------------------------------------------

    /// <summary>Material tint for a path's buildings and units (multiplied into the model's own colours).</summary>
    public static Color PathTint(int path) => path switch
    {
        Sovereign => new Color(1.08f, 1.1f, 1.16f),     // bleached ceramic and steel
        Symbiont => new Color(0.78f, 1.08f, 0.86f),     // grown, green-veined
        Discarnate => new Color(0.2f, 0.19f, 0.28f),    // black glass
        _ => Colors.White,
    };

    /// <summary>The light a path's structures give off.</summary>
    public static Color PathGlow(int path) => path switch
    {
        Sovereign => new Color("#7fd3ff"),
        Symbiont => new Color("#5cffc0"),
        Discarnate => new Color("#a07cff"),
        _ => Colors.Black,
    };

    /// <summary>Per-instance custom data for model_tint.gdshader: the glow colour and its strength (0 = none).</summary>
    public static Color GlowData(int path, float strength) => path < 0 ? new Color(0, 0, 0, 0) : new Color(PathGlow(path), Mathf.Clamp(strength, 0f, 1f));
}
