using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

public sealed class PlayerSetup
{
    public string Name { get; set; } = "";
    public string? Leader { get; set; }
    public bool IsHuman { get; set; }
    public int Team { get; set; } = -1;
}

/// <summary>Everything needed to deterministically construct turn 1. Sent verbatim to every peer.</summary>
public sealed class GameSetup
{
    public ulong Seed { get; set; } = 1;
    public MapGenSettings Map { get; set; } = new();
    public GameOptions Options { get; set; } = new();
    public List<PlayerSetup> Players { get; set; } = new();
}

public static class GameFactory
{
    public static GameState Create(GameDatabase db, GameSetup setup)
    {
        setup.Map.Players = setup.Players.Count;
        if (setup.Map.Seed == 0) setup.Map.Seed = setup.Seed;
        var generated = MapGenerator.Generate(db, setup.Map);
        var s = new GameState(db, setup.Options, generated.Map, setup.Seed);

        int settler = db.Units.FirstOrDefault(u => u.FoundsCity)?.Index ?? -1;
        int builder = db.Units.FirstOrDefault(u => u.Charges > 0 && u.Domain == UnitDomain.Civilian)?.Index ?? -1;
        int warrior = db.Units.IndexOf("UNIT_WARRIOR");

        for (int i = 0; i < setup.Players.Count; i++)
        {
            var ps = setup.Players[i];
            int leader = db.Leaders.IndexOf(ps.Leader);
            var p = new PlayerState
            {
                Id = i,
                Name = ps.Name,
                IsHuman = ps.IsHuman,
                Team = ps.Team >= 0 ? ps.Team : i,
                LeaderIndex = leader,
                CivIndex = leader >= 0 ? db.Leaders[leader].CivilizationIndex : -1,
                Techs = new bool[db.Techs.Count],
                Civics = new bool[db.Civics.Count],
                Stockpile = new int[db.Resources.Count],
                GovernorTitles = setup.Options.StartingGovernorTitles,
            };
            s.Players.Add(p);
            if (i >= generated.StartTiles.Count) continue;

            int start = generated.StartTiles[i];
            if (settler >= 0) Spawn(s, p, settler, start);
            int escort = FirstLandNeighbor(s.Map, start);
            if (warrior >= 0) Spawn(s, p, warrior, escort);
            if (builder >= 0) Spawn(s, p, builder, escort);
        }

        s.Players.Add(new PlayerState
        {
            Id = s.Players.Count,
            Name = "Free Cities",
            IsFreeCities = true,
            Team = -1,
            Techs = new bool[db.Techs.Count],
            Civics = new bool[db.Civics.Count],
            Stockpile = new int[db.Resources.Count],
        });
        TurnPhases.Begin(s);
        VisibilitySystem.RevealAll(s);
        return s;
    }

    private static void Spawn(GameState s, PlayerState p, int def, int tile)
    {
        var d = s.Db.Units[def];
        s.AddUnit(new UnitState { Id = s.AllocateId(), Owner = p.Id, DefIndex = def, Tile = tile, MovesLeft = d.Moves, Charges = d.Charges,
                                  Variant = UnitStats.DefaultVariant(s.Db, def) });
    }

    private static int FirstLandNeighbor(MapGrid map, int tile)
    {
        for (int d = 0; d < 6; d++)
        {
            int n = map.Neighbor(tile, d);
            if (n >= 0 && map.IsLand(n) && !map.IsMountain(n)) return n;
        }
        return tile;
    }
}
