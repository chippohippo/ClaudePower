using Godot;
using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.UI;

/// <summary>
/// A historic dilemma laid before the player: the situation, written on a page of the chronicle, and its two or three answers,
/// each with what it costs and what it brings. An answer you cannot afford is shown but disabled. "Later" sets it aside until next
/// turn; if nobody answers by the deadline the council takes the first course (docs/05-key-systems/15-society.md).
/// </summary>
public partial class DilemmaDialog : PanelContainer
{
    private readonly GameRoot _root;
    private readonly VBoxContainer _body = new();
    private int _shownFor = -1;        // the deadline of the dilemma on screen (a new dilemma has a new deadline)
    private int _setAsideTurn = -1;

    public DilemmaDialog(GameRoot root) => _root = root;

    public override void _Ready()
    {
        Visible = false;
        SetAnchorsPreset(LayoutPreset.Center);
        CustomMinimumSize = new Vector2(640, 0);
        var paper = UiTheme.Box(new Color("#e9dcc0"), new Color("#7a5a30"), 2, 4, 26);
        paper.ShadowColor = new Color(0, 0, 0, 0.55f);
        paper.ShadowSize = 18;
        AddThemeStyleboxOverride("panel", paper);
        _body.AddThemeConstantOverride("separation", 10);
        AddChild(_body);
    }

    public override void _Process(double delta)
    {
        var s = _root.State;
        if (s == null || _root.LocalPlayer < 0 || _root.LocalPlayer >= s.Players.Count) { Visible = false; return; }
        var me = s.Players[_root.LocalPlayer];
        if (me.Dilemma is not { } d) { Visible = false; _shownFor = -1; return; }
        if (_root.AiBusy || _root.Cinematics.Playing || _setAsideTurn == s.Turn) { Visible = false; return; }
        if (!Visible || _shownFor != d.Deadline) Build(s, me, d);
        Visible = true;
    }

    private void Build(GameState s, PlayerState me, PendingDilemmaState d)
    {
        _shownFor = d.Deadline;
        foreach (var c in _body.GetChildren()) c.QueueFree();
        var def = s.Db.Dilemmas[d.Def];
        var ink = new Color("#3a2614");
        var title = new Label { Text = def.Name, HorizontalAlignment = HorizontalAlignment.Center };
        title.AddThemeFontOverride("font", Cinematics.Engraved(700));
        title.AddThemeFontSizeOverride("font_size", 30);
        title.AddThemeColorOverride("font_color", ink);
        _body.AddChild(title);
        string where = s.GetCity(d.CityId)?.Name ?? "";
        var sub = new Label { Text = $"{(where.Length > 0 ? where + " · " : "")}{Calendar.Format(Calendar.Year(s.Turn, s.Options.GameSpeedPercent))} · the council decides in {Math.Max(0, d.Deadline - s.Turn)} turns",
                              HorizontalAlignment = HorizontalAlignment.Center };
        sub.AddThemeFontOverride("font", Cinematics.Italic());
        sub.AddThemeFontSizeOverride("font_size", 18);
        sub.AddThemeColorOverride("font_color", new Color("#6b4a26"));
        _body.AddChild(sub);
        _body.AddChild(new ColorRect { Color = new Color("#7a5a30"), CustomMinimumSize = new Vector2(0, 1.5f) });
        var text = new Label { Text = DilemmaSystem.Title(s, d), AutowrapMode = TextServer.AutowrapMode.WordSmart, CustomMinimumSize = new Vector2(580, 0) };
        text.AddThemeFontOverride("font", Cinematics.Italic());
        text.AddThemeFontSizeOverride("font_size", 22);
        text.AddThemeColorOverride("font_color", ink);
        _body.AddChild(text);

        for (int i = 0; i < def.Options.Count; i++)
        {
            var o = def.Options[i];
            int option = i;
            string? why = DilemmaSystem.ValidateResolve(s, me, i);
            string desc = o.Description != null ? DilemmaSystem.Fill(s, o.Description, d) : "";
            var button = new Button
            {
                Text = $"{o.Name}{(desc.Length > 0 ? " — " + desc : "")}\n{Effects(s, o)}{(i == 0 ? "   (the council's choice if you do not answer)" : "")}",
                Disabled = why != null, TooltipText = why ?? "", Alignment = HorizontalAlignment.Left,
                AutowrapMode = TextServer.AutowrapMode.WordSmart, CustomMinimumSize = new Vector2(580, 58),
            };
            button.Pressed += () =>
            {
                var r = _root.Submit(new ResolveDilemmaCommand { Option = option });
                if (r.Ok) { Visible = false; Audio.AudioManager.Sfx("page", -4f); }
            };
            _body.AddChild(button);
        }
        var later = new Button { Text = "Later", SizeFlagsHorizontal = SizeFlags.ShrinkEnd };
        later.Pressed += () => { _setAsideTurn = s.Turn; Visible = false; };
        _body.AddChild(later);
        // keep it centred as its height settles
        CallDeferred(MethodName.Recentre);
        Audio.AudioManager.Sfx("page", -6f);
    }

    private void Recentre()
    {
        var size = GetViewportRect().Size;
        ResetSize();
        Position = (size - Size) / 2;
    }

    /// <summary>A modifier in a few words: "+2 Food", "+15% Production", "−1 amenity".</summary>
    public static string Describe(ModifierDef m)
    {
        int n = m.Amount.FloorToInt();
        string signed = $"{n:+0;−0;0}";
        return m.Effect switch
        {
            ModifierEffect.CityYieldFlat => $"{signed} {m.Yield}",
            ModifierEffect.CityYieldPercent => $"{signed}% {m.Yield}",
            ModifierEffect.CityProductionPercent => $"{signed}% production",
            ModifierEffect.CityAmenities => $"{signed} amenit{(Math.Abs(n) == 1 ? "y" : "ies")}",
            ModifierEffect.CityHousing => $"{signed} housing",
            ModifierEffect.CityLoyaltyPerTurn => $"{signed} loyalty a turn",
            ModifierEffect.CityPressurePercent => $"{signed}% loyalty pressure",
            _ => $"{signed} {System.Text.RegularExpressions.Regex.Replace(m.Effect.ToString().Replace("City", ""), "(?<!^)([A-Z])", " $1").ToLowerInvariant()}",
        };
    }

    /// <summary>What an answer costs and brings, in a line.</summary>
    public static string Effects(GameState s, DilemmaOptionDef o)
    {
        var parts = new List<string>();
        void Add(int v, string what) { if (v != 0) parts.Add($"{v:+0;-0} {what}"); }
        Add(o.Gold, "gold"); Add(o.Faith, "faith"); Add(o.Favor, "favor"); Add(o.Science, "science"); Add(o.Culture, "culture");
        Add(o.EraScore, "era score"); Add(o.Loyalty, o.EmpireWide ? "loyalty everywhere" : "loyalty"); Add(o.Population, "citizens");
        if (o.Relations > 0) parts.Add("their goodwill"); else if (o.Relations < 0) parts.Add("their grievance");
        Add(o.WarWeariness, "war weariness");
        if (o.Calamity != default) parts.Add("risk of calamity");
        if (o.Modifiers.Count > 0)
            parts.Add($"{string.Join(", ", o.Modifiers.Select(Describe))} for {o.Turns} turns{(o.EmpireWide ? " in every city" : "")}");
        return parts.Count == 0 ? "no immediate cost" : string.Join(" · ", parts);
    }
}
