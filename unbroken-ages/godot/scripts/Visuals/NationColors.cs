using Godot;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Client.Visuals;

/// <summary>
/// Each nation's colour scheme, the way Civ VI does it: a <b>primary</b> (borders' band, banners, the roofs and pennants of
/// every building, unit rings) and a <b>secondary</b> (the border's outer line, the ring's inner band, flag edges). When two
/// nations in one game have colours too close to tell apart, the later one swaps to its secondary-led scheme, and failing that
/// to a free colour from a reserve palette, so every player on the map stays distinct. Free Cities are stone grey.
/// </summary>
public static class NationColors
{
    public readonly record struct Scheme(Color Primary, Color Secondary);

    private static readonly Color[] Reserve =
    {
        new("#d6336c"), new("#2f9e44"), new("#1971c2"), new("#f08c00"), new("#7048e8"), new("#0ca678"),
        new("#e03131"), new("#5c940d"), new("#1098ad"), new("#9c36b5"), new("#e8590c"), new("#364fc7"),
    };

    private static GameState? _for;
    private static Scheme[] _schemes = Array.Empty<Scheme>();
    private static string _key = "";

    public static Scheme For(GameState s, int player)
    {
        if (player < 0 || player >= s.Players.Count) return new Scheme(new Color("#cccccc"), new Color("#333333"));
        string key = string.Join(",", s.Players.Select(p => p.CivIndex));
        if (!ReferenceEquals(_for, s) || key != _key || _schemes.Length != s.Players.Count)
        {
            _for = s;
            _key = key;
            _schemes = Resolve(s);
        }
        return _schemes[player];
    }

    public static Color Primary(GameState s, int player) => For(s, player).Primary;
    public static Color Secondary(GameState s, int player) => For(s, player).Secondary;

    private static float Distance(Color a, Color b)
    {
        // Perceptual-ish: weighted RGB plus a hue term, so a dark and a light red still count as "the same".
        float dr = a.R - b.R, dg = a.G - b.G, db = a.B - b.B;
        float hue = Mathf.Abs(a.H - b.H);
        hue = Mathf.Min(hue, 1 - hue);
        return Mathf.Sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db) + (a.S > 0.25f && b.S > 0.25f ? hue * 1.5f : 0.4f);
    }

    private static Scheme[] Resolve(GameState s)
    {
        var result = new Scheme[s.Players.Count];
        var taken = new List<Color>();
        int reserve = 0;
        for (int i = 0; i < s.Players.Count; i++)
        {
            var p = s.Players[i];
            if (p.IsFreeCities) { result[i] = new Scheme(new Color("#b8b2a6"), new Color("#4a463f")); continue; }
            if (p.CivIndex < 0) { result[i] = new Scheme(new Color("#cccccc"), new Color("#333333")); continue; }
            var colors = s.Db.Civilizations[p.CivIndex].Colors;
            var primary = new Color(colors.Primary);
            var secondary = new Color(colors.Secondary);
            bool Clashes(Color c) => taken.Any(t => Distance(t, c) < 0.42f);
            if (Clashes(primary))
            {
                if (!Clashes(secondary)) (primary, secondary) = (secondary, primary);
                else
                {
                    while (reserve < Reserve.Length && Clashes(Reserve[reserve])) reserve++;
                    primary = reserve < Reserve.Length ? Reserve[reserve++] : primary;
                }
            }
            // A secondary too close to its own primary would vanish on the border: fall back to near-white or near-black.
            if (Distance(primary, secondary) < 0.35f) secondary = primary.Luminance > 0.5f ? new Color("#1b1b1b") : new Color("#f2eee4");
            taken.Add(primary);
            result[i] = new Scheme(primary, secondary);
        }
        return result;
    }
}
