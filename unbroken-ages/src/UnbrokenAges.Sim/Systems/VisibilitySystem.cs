using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// Fog of war. <see cref="Visible"/> is what a player sees right now: within each unit's sight, within 3 tiles of each city
/// and outpost, and every tile of its own territory (teammates share vision). <see cref="PlayerState.Revealed"/> remembers
/// every tile ever seen (terrain stays drawn, enemy units fade out). Revealed tiles are part of the state and updated after
/// every command and at turn end, so saves and multiplayer peers agree. The AI is not limited by fog yet.
/// </summary>
public static class VisibilitySystem
{
    public const int CitySight = 3;

    public static bool[] Visible(GameState s, int player)
    {
        var map = s.Map;
        var seen = new bool[map.Count];
        var ring = new List<int>();
        void See(int center, int radius)
        {
            ring.Clear();
            map.CollectRadius(center, radius, ring);
            foreach (int t in ring) seen[t] = true;
        }
        bool Ours(int owner) => owner >= 0 && DiplomacySystem.SameTeam(s, owner, player);
        foreach (var u in s.Units) if (Ours(u.Owner)) See(u.Tile, s.Db.Units[u.DefIndex].Sight);
        foreach (var c in s.Cities) if (Ours(c.Owner)) See(c.Tile, CitySight);
        foreach (var o in s.Outposts) if (Ours(o.Owner)) See(o.Tile, CitySight - 1);
        for (int t = 0; t < map.Count; t++) if (Ours(map.OwnerPlayer[t])) seen[t] = true;
        return seen;
    }

    /// <summary>Adds what the player sees now to what it has ever seen.</summary>
    public static void Reveal(GameState s, int player)
    {
        var p = s.Players[player];
        if (p.IsFreeCities || !p.IsAlive) return;
        if (p.Revealed.Length != s.Map.Count) p.Revealed = new bool[s.Map.Count];
        var now = Visible(s, player);
        for (int t = 0; t < now.Length; t++) if (now[t]) p.Revealed[t] = true;
    }

    public static void RevealAll(GameState s)
    {
        foreach (var p in s.Players) Reveal(s, p.Id);
    }
}
