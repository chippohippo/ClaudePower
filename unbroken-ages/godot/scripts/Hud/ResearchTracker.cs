using Godot;
using UnbrokenAges.Client.UI;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.Hud;

/// <summary>
/// Top-left, under the top bar (Civ VI): what you are researching and studying, a progress bar each, and turns left.
/// Click to open the research screen. When nothing is chosen it says so in the yield's colour, so it is never missed.
/// </summary>
public partial class ResearchTracker : VBoxContainer
{
    private readonly GameRoot _root;
    private (Label Name, ProgressBar Bar, Label Turns) _tech, _civic;

    public ResearchTracker(GameRoot root) => _root = root;

    public override void _Ready()
    {
        Position = new Vector2(12, 50);
        CustomMinimumSize = new Vector2(330, 0);
        AddThemeConstantOverride("separation", 6);
        _tech = Row("science", UiTheme.Science, "Research");
        _civic = Row("culture", UiTheme.Culture, "Civic");
    }

    private (Label, ProgressBar, Label) Row(string icon, Color color, string kind)
    {
        var panel = new PanelContainer { MouseDefaultCursorShape = CursorShape.PointingHand, TooltipText = $"{kind}: click to choose (T)" };
        panel.AddThemeStyleboxOverride("panel", UiTheme.Box(new Color("#0e1a2bea"), new Color(color, 0.7f), 1, 18, 8));
        panel.GuiInput += e => { if (e is InputEventMouseButton { Pressed: true, ButtonIndex: MouseButton.Left }) _root.ToggleByKey("T"); };
        AddChild(panel);
        var h = new HBoxContainer();
        h.AddThemeConstantOverride("separation", 10);
        panel.AddChild(h);
        var badge = new PanelContainer { CustomMinimumSize = new Vector2(34, 34), MouseFilter = MouseFilterEnum.Ignore };
        badge.AddThemeStyleboxOverride("panel", UiTheme.Box(new Color(color, 0.25f), color, 2, 17, 4));
        badge.AddChild(Icons.Rect(icon, color, 22));
        h.AddChild(badge);
        var v = new VBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill, MouseFilter = MouseFilterEnum.Ignore };
        v.AddThemeConstantOverride("separation", 2);
        h.AddChild(v);
        var top = new HBoxContainer { MouseFilter = MouseFilterEnum.Ignore };
        var name = new Label { SizeFlagsHorizontal = SizeFlags.ExpandFill, ClipText = true };
        var turns = new Label { ThemeTypeVariation = "Caption" };
        top.AddChild(name);
        top.AddChild(turns);
        v.AddChild(top);
        var bar = new ProgressBar { ShowPercentage = false, CustomMinimumSize = new Vector2(0, 7), MouseFilter = MouseFilterEnum.Ignore };
        bar.AddThemeStyleboxOverride("fill", UiTheme.Box(color, color, 0, 3, 0));
        v.AddChild(bar);
        return (name, bar, turns);
    }

    public void Refresh()
    {
        var s = _root.State;
        if (s == null) return;
        var p = s.Players[_root.LocalPlayer];
        var (science, culture) = ResearchSystem.Rates(s, p.Id);
        Set(_tech, p.CurrentTech >= 0 ? s.Db.Techs[p.CurrentTech].Name : null, p.TechProgress.FloorToInt(),
            p.CurrentTech >= 0 ? ResearchSystem.Cost(s, p, s.Db.Techs[p.CurrentTech]).FloorToInt() : 1, science, "Choose research");
        Set(_civic, p.CurrentCivic >= 0 ? s.Db.Civics[p.CurrentCivic].Name : null, p.CivicProgress.FloorToInt(),
            p.CurrentCivic >= 0 ? ResearchSystem.Cost(s, p, s.Db.Civics[p.CurrentCivic]).FloorToInt() : 1, culture, "Choose a civic");
    }

    private static void Set((Label Name, ProgressBar Bar, Label Turns) row, string? name, int progress, int cost, int rate, string prompt)
    {
        row.Name.Text = name ?? prompt;
        row.Name.AddThemeColorOverride("font_color", name == null ? UiTheme.GoldBright : UiTheme.Text);
        row.Bar.MaxValue = Math.Max(1, cost);
        row.Bar.Value = name == null ? 0 : Math.Min(progress, cost);
        row.Turns.Text = name == null ? "" : rate <= 0 ? "—" : $"{Math.Max(1, (cost - progress + rate - 1) / rate)} turns";
    }
}
