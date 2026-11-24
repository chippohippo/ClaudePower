using Godot;
using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;
using UnbrokenAges.Sim.Systems.Districts;

namespace UnbrokenAges.Client.Map;

/// <summary>
/// District placement lens ("map tacks with live adjacency"): every tile in range is tinted —
/// red if illegal (with every reason available on hover), green shaded by planner score if
/// legal — and the top spots get floating yield labels. Hovering shows the full breakdown,
/// including what the placement would add or remove from NEIGHBOURING districts.
/// Pure read-only queries against the simulation: nothing here can desync anything.
/// </summary>
public partial class PlacementLens : Node3D
{
    private MultiMeshInstance3D _tint = null!;
    private readonly List<Label3D> _labels = new();
    private GameState? _state;
    private CityState? _city;
    private int _district = -1;
    private Dictionary<int, PlacementCandidate> _scored = new();
    private Dictionary<int, List<PlacementFailure>> _invalid = new();

    public bool IsActive => _city != null;
    public string HoverText { get; private set; } = "";
    public event Action<string>? HoverChanged;

    public override void _Ready()
    {
        _tint = new MultiMeshInstance3D
        {
            Multimesh = new MultiMesh
            {
                TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseColors = true,
                Mesh = new CylinderMesh { TopRadius = 0.9f, BottomRadius = 0.9f, Height = 0.02f, RadialSegments = 6, Rings = 1 },
            },
            MaterialOverride = new StandardMaterial3D
            {
                VertexColorUseAsAlbedo = true, Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
                ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
            },
        };
        AddChild(_tint);
    }

    public void Show(GameState s, CityState city, int districtIndex)
    {
        _state = s;
        _city = city;
        _district = districtIndex;
        _scored = DistrictPlanner.Rank(s, city, districtIndex, DistrictPlanner.BalancedWeights, max: 64).ToDictionary(c => c.Tile);
        _invalid.Clear();
        foreach (int t in DistrictPlacement.CandidateTiles(s, city))
        {
            if (_scored.ContainsKey(t)) continue;
            var f = DistrictPlacement.Check(s, city, districtIndex, t);
            if (f.Count > 0) _invalid[t] = f;
        }
        Paint();
    }

    public new void Hide()
    {
        _city = null;
        _tint.Multimesh.InstanceCount = 0;
        foreach (var l in _labels) l.QueueFree();
        _labels.Clear();
        HoverChanged?.Invoke("");
    }

    public bool IsValid(int tile) => _scored.ContainsKey(tile);

    private void Paint()
    {
        var s = _state!;
        var mm = _tint.Multimesh;
        var items = new List<(int Tile, Color Color)>();
        Fx best = _scored.Count > 0 ? _scored.Values.Max(c => c.Score) : Fx.One;
        foreach (var (t, c) in _scored)
        {
            float k = best > Fx.Zero ? Mathf.Clamp((float)(c.Score / best).ToDouble(), 0f, 1f) : 0f;
            items.Add((t, new Color(0.2f, 0.45f + 0.5f * k, 0.25f, 0.55f)));
        }
        foreach (var t in _invalid.Keys) items.Add((t, new Color(0.85f, 0.2f, 0.2f, 0.35f)));
        mm.InstanceCount = items.Count;
        var rotate = new Basis(Vector3.Up, Mathf.Pi / 6f);
        for (int i = 0; i < items.Count; i++)
        {
            mm.SetInstanceTransform(i, new Transform3D(rotate, HexLayout.ToWorld(s.Map.CoordOf(items[i].Tile), 0.2f)));
            mm.SetInstanceColor(i, items[i].Color);
        }

        foreach (var l in _labels) l.QueueFree();
        _labels.Clear();
        foreach (var c in _scored.Values.OrderByDescending(c => c.Score).Take(6))
        {
            var label = new Label3D
            {
                Text = c.Adjacency.IsZero ? "+0" : Short(c.Adjacency),
                Billboard = BaseMaterial3D.BillboardModeEnum.Enabled,
                FontSize = 48, OutlineSize = 12, Modulate = Colors.White,
                Position = HexLayout.ToWorld(s.Map.CoordOf(c.Tile), 0.9f),
            };
            AddChild(label);
            _labels.Add(label);
        }
    }

    public void Hover(int tile)
    {
        if (_state == null || _city == null || tile < 0) return;
        HoverText = Explain(tile);
        HoverChanged?.Invoke(HoverText);
    }

    /// <summary>Tooltip text: every adjacency contribution, "almost there" hints, neighbour effects, or every failure reason.</summary>
    public string Explain(int tile)
    {
        var s = _state!;
        if (_invalid.TryGetValue(tile, out var failures))
            return "Cannot place here:\n• " + string.Join("\n• ", failures.Select(Humanize));
        if (!_scored.TryGetValue(tile, out var c)) return "";
        var lines = new List<string> { $"{s.Db.Districts[_district].Name}: {c.Adjacency}" };
        foreach (var contrib in c.Detail.Contributions)
        {
            if (contrib.Amount > Fx.Zero) lines.Add($"  {contrib.Label}  (+{contrib.Amount})");
            else if (contrib.Matches > 0 && contrib.MatchesToNextBonus > 0)
                lines.Add($"  {contrib.Label}: {contrib.Matches}/{contrib.Per} — {contrib.MatchesToNextBonus} more for +{contrib.Increment}");
        }
        if (!c.NeighborDelta.IsZero) lines.Add($"Neighbouring districts: {Signed(c.NeighborDelta)}");
        if (!c.LostTileYields.IsZero) lines.Add($"Replaces tile yields: {c.LostTileYields}");
        return string.Join("\n", lines);
    }

    private static string Short(YieldSet y) =>
        string.Join(" ", YieldSet.All.Where(t => y[t] != Fx.Zero).Select(t => $"+{y[t]}{Icon(t)}"));

    private static string Signed(YieldSet y) =>
        string.Join(", ", YieldSet.All.Where(t => y[t] != Fx.Zero).Select(t => $"{(y[t] > Fx.Zero ? "+" : "")}{y[t]} {t}"));

    private static string Icon(YieldType t) => t switch
    {
        YieldType.Food => "🌾", YieldType.Production => "⚙", YieldType.Gold => "◉",
        YieldType.Science => "⚗", YieldType.Culture => "♪", YieldType.Faith => "✦", _ => "",
    };

    public static string Humanize(PlacementFailure f) => f switch
    {
        PlacementFailure.DistrictCapacity => "No free district slot (grow the city or promote a governor).",
        PlacementFailure.RequiresAdjacentCityCenter => "Must be next to the City Center.",
        PlacementFailure.ForbidsAdjacentCityCenter => "Cannot be next to the City Center.",
        PlacementFailure.RequiresAdjacentSource => "Needs an adjacent water source or required neighbour.",
        PlacementFailure.BlockedByResource => "A luxury or strategic resource is here.",
        PlacementFailure.Reserved => "Already planned for another queued district.",
        PlacementFailure.CanalConnection => "A canal must join two bodies of water across land.",
        PlacementFailure.WonderBuiltElsewhere => "Another civilization has already built this wonder.",
        _ => System.Text.RegularExpressions.Regex.Replace(f.ToString(), "(?<!^)([A-Z])", " $1") + ".",
    };
}
