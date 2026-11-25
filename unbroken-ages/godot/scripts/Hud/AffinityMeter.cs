using Godot;
using UnbrokenAges.Client.UI;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.Hud;

/// <summary>
/// The three affinities (Purity, Harmony, Supremacy) as meters under the top bar, once the first affinity point is earned:
/// each with its level, a bar toward the next level, and a mark on the primary affinity once chosen. The tooltip lists what the
/// next level brings and the affinity victory's steps (AffinitySystem; docs/08-divergence-tech-tree.md).
/// </summary>
public partial class AffinityMeter : PanelContainer
{
    private readonly GameRoot _root;
    private readonly VBoxContainer _rows = new();
    private string _shown = "";

    public AffinityMeter(GameRoot root) => _root = root;

    /// <summary>The affinity's colour for the interface: the brighter of its two (Purity silver, Harmony green, Supremacy violet).</summary>
    public static Color Of(GameState s, int affinity)
    {
        if (affinity < 0 || affinity >= s.Db.Divergences.Count) return UiTheme.Gold;
        var c = s.Db.Divergences[affinity].Colors;
        var a = new Color(c.Primary);
        var b = new Color(c.Secondary);
        return a.Luminance >= b.Luminance ? a : b;
    }

    public override void _Ready()
    {
        Visible = false;
        SetAnchorsPreset(LayoutPreset.TopRight);
        OffsetTop = 52; OffsetRight = -12; OffsetLeft = -232;
        AddThemeStyleboxOverride("panel", UiTheme.Box(new Color(UiTheme.Navy, 0.86f), new Color(UiTheme.Gold, 0.6f), 1, 6, 8));
        _rows.AddThemeConstantOverride("separation", 4);
        AddChild(_rows);
    }

    public override void _Process(double delta)
    {
        var s = _root.State;
        if (s == null || _root.LocalPlayer < 0 || _root.LocalPlayer >= s.Players.Count) { Visible = false; return; }
        var me = s.Players[_root.LocalPlayer];
        int n = AffinitySystem.Count(s);
        bool any = false;
        var key = new System.Text.StringBuilder();
        for (int a = 0; a < n; a++) { int pts = AffinitySystem.Points(me, a); any |= pts > 0; key.Append(pts).Append(','); }
        key.Append(AffinitySystem.Primary(me));
        Visible = any && !_root.Cinematics.Playing;
        if (!any || key.ToString() == _shown) return;
        _shown = key.ToString();
        Build(s, me, n);
    }

    private void Build(GameState s, PlayerState me, int n)
    {
        foreach (var c in _rows.GetChildren()) c.QueueFree();
        var head = new Label { Text = "AFFINITY" };
        head.AddThemeFontOverride("font", Cinematics.Engraved(600));
        head.AddThemeFontSizeOverride("font_size", 13);
        head.AddThemeColorOverride("font_color", UiTheme.GoldBright);
        _rows.AddChild(head);
        int primary = AffinitySystem.Primary(me);
        for (int a = 0; a < n; a++)
        {
            var color = Of(s, a);
            int level = AffinitySystem.Level(me, a);
            var (into, needed) = AffinitySystem.Progress(s, me, a);
            var row = new HBoxContainer();
            row.AddThemeConstantOverride("separation", 6);
            var name = new Label { Text = (a == primary ? "★ " : "") + AffinitySystem.Name(s, a), CustomMinimumSize = new Vector2(96, 0) };
            name.AddThemeColorOverride("font_color", color);
            name.AddThemeFontSizeOverride("font_size", 14);
            row.AddChild(name);
            var bar = new ProgressBar { MaxValue = Math.Max(1, needed), Value = Math.Min(needed, into), ShowPercentage = false, CustomMinimumSize = new Vector2(70, 8), SizeFlagsVertical = SizeFlags.ShrinkCenter };
            var fill = new StyleBoxFlat { BgColor = color, CornerRadiusTopLeft = 3, CornerRadiusTopRight = 3, CornerRadiusBottomLeft = 3, CornerRadiusBottomRight = 3 };
            bar.AddThemeStyleboxOverride("fill", fill);
            row.AddChild(bar);
            var lv = new Label { Text = $"{level}" };
            lv.AddThemeFontOverride("font", Cinematics.Engraved(700));
            lv.AddThemeFontSizeOverride("font_size", 16);
            lv.AddThemeColorOverride("font_color", color);
            row.AddChild(lv);
            row.TooltipText = Tooltip(s, me, a, into, needed);
            row.MouseFilter = MouseFilterEnum.Pass;
            _rows.AddChild(row);
        }
    }

    private static string Tooltip(GameState s, PlayerState me, int a, int into, int needed)
    {
        var lines = new List<string> { $"{AffinitySystem.Name(s, a)}: level {AffinitySystem.Level(me, a)}, {AffinitySystem.Points(me, a)} points ({into}/{needed} toward the next level)" };
        if (AffinitySystem.NextLevel(s, me, a) is { } next) lines.Add($"At level {next.Level}: {next.Description ?? "stronger identity effects"}");
        if (AffinitySystem.Primary(me) == a || AffinitySystem.Primary(me) < 0)
        {
            lines.Add($"Victory: {AffinitySystem.VictoryName(s, a)}");
            if (AffinitySystem.Primary(me) == a)
                foreach (var step in AffinitySystem.VictorySteps(s, me)) lines.Add($"  {(step.Done ? "✔" : "·")} {step.Label}");
        }
        lines.Add("Points come from affinity techs, civics, buildings, wonders, projects, improvements, policies and victories in battle.");
        return string.Join("\n", lines);
    }
}
