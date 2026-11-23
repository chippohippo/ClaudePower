using Godot;
using UnbrokenAges.Client.Map;
using UnbrokenAges.Client.UI;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.Hud;

/// <summary>
/// Labels that live on the map, the way Civ V/VI players read the world:
/// <list type="bullet">
/// <item><b>City banners</b> above every known city: population in a disc, the name (★ for capitals), the owner's colour,
///   city strength, and under it the production bar with what is being built and turns left (your cities), plus a health
///   bar when damaged. Click your banner to open the city.</item>
/// <item><b>Unit flags</b> above every visible unit: a shield in the owner's colour with the unit type's icon and a health
///   bar; yours are clickable, and the selected one is outlined in gold.</item>
/// </list>
/// Positions follow the camera every frame; labels behind the camera or off-screen are hidden.
/// </summary>
public partial class MapOverlay : Control
{
    private readonly GameRoot _root;
    private readonly Dictionary<int, (PanelContainer Panel, Label Pop, Label Name, Label Strength, ProgressBar Build, Label BuildText, ProgressBar Hp)> _banners = new();
    private readonly Dictionary<int, (PanelContainer Flag, TextureRect Icon, ProgressBar Hp)> _flags = new();

    public MapOverlay(GameRoot root) => _root = root;

    public override void _Ready()
    {
        SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        MouseFilter = MouseFilterEnum.Ignore;
    }

    public override void _Process(double delta)
    {
        var s = _root.State;
        if (s == null) { Visible = false; return; }
        Visible = true;
        var cam = _root.Camera;
        var visible = VisibilitySystem.Visible(s, _root.LocalPlayer);
        var revealed = s.Players[_root.LocalPlayer].Revealed;
        var view = GetViewportRect();

        var seenCities = new HashSet<int>();
        foreach (var c in s.Cities)
        {
            if (c.Tile >= revealed.Length || !revealed[c.Tile]) continue;
            seenCities.Add(c.Id);
            var b = Banner(s, c);
            var world = HexLayout.ToWorld(s.Map.CoordOf(c.Tile), 2.1f);
            Place(b.Panel, cam, world, view, center: true);
            UpdateBanner(s, c, b, visible[c.Tile]);
        }
        foreach (var id in _banners.Keys.Where(id => !seenCities.Contains(id)).ToList()) { _banners[id].Panel.QueueFree(); _banners.Remove(id); }

        var seenUnits = new HashSet<int>();
        foreach (var u in s.Units)
        {
            if (u.Tile < 0 || !visible[u.Tile]) continue;
            seenUnits.Add(u.Id);
            var f = Flag(s, u);
            var anchor = _root.MapView.Units.WorldOf(u.Id) ?? HexLayout.ToWorld(s.Map.CoordOf(u.Tile), 0);
            Place(f.Flag, cam, anchor + new Vector3(0, 1.0f, 0), view, center: true);
            f.Hp.Value = u.Hp;
            f.Hp.Visible = u.Hp < 100;
            f.Flag.AddThemeStyleboxOverride("panel", FlagStyle(s, u.Owner, u.Id == _root.SelectedUnit));
        }
        foreach (var id in _flags.Keys.Where(id => !seenUnits.Contains(id)).ToList()) { _flags[id].Flag.QueueFree(); _flags.Remove(id); }
    }

    private static void Place(Control c, Camera3D cam, Vector3 world, Rect2 view, bool center)
    {
        if (cam.IsPositionBehind(world)) { c.Visible = false; return; }
        var p = cam.UnprojectPosition(world);
        c.Visible = view.Grow(80).HasPoint(p);
        var size = c.Size;
        c.Position = center ? p - new Vector2(size.X / 2, size.Y) : p;
    }

    // ----- City banners ------------------------------------------------------------------------------

    private (PanelContainer Panel, Label Pop, Label Name, Label Strength, ProgressBar Build, Label BuildText, ProgressBar Hp) Banner(GameState s, CityState c)
    {
        if (_banners.TryGetValue(c.Id, out var b)) return b;
        var panel = new PanelContainer { MouseDefaultCursorShape = CursorShape.PointingHand };
        panel.GuiInput += e =>
        {
            if (e is InputEventMouseButton { Pressed: true, ButtonIndex: MouseButton.Left } && _root.State?.GetCity(c.Id) is { } city && city.Owner == _root.LocalPlayer)
                _root.OpenCity(city);
        };
        var v = new VBoxContainer { MouseFilter = MouseFilterEnum.Ignore };
        v.AddThemeConstantOverride("separation", 2);
        panel.AddChild(v);
        var h = new HBoxContainer { MouseFilter = MouseFilterEnum.Ignore };
        h.AddThemeConstantOverride("separation", 8);
        v.AddChild(h);
        var popDisc = new PanelContainer { CustomMinimumSize = new Vector2(26, 26), MouseFilter = MouseFilterEnum.Ignore };
        popDisc.AddThemeStyleboxOverride("panel", UiTheme.Box(new Color("#0b1422"), UiTheme.GoldBright, 2, 13, 2));
        var pop = new Label { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        pop.AddThemeFontSizeOverride("font_size", 15);
        popDisc.AddChild(pop);
        h.AddChild(popDisc);
        var name = new Label { VerticalAlignment = VerticalAlignment.Center };
        name.AddThemeFontSizeOverride("font_size", 17);
        name.AddThemeColorOverride("font_outline_color", new Color(0, 0, 0, 0.8f));
        name.AddThemeConstantOverride("outline_size", 4);
        h.AddChild(name);
        var strength = new Label { VerticalAlignment = VerticalAlignment.Center, ThemeTypeVariation = "Caption" };
        var sbox = new HBoxContainer { MouseFilter = MouseFilterEnum.Ignore };
        sbox.AddChild(Icons.Rect("defense", UiTheme.Text, 14));
        sbox.AddChild(strength);
        h.AddChild(sbox);
        var build = new ProgressBar { ShowPercentage = false, CustomMinimumSize = new Vector2(0, 6), MouseFilter = MouseFilterEnum.Ignore };
        build.AddThemeStyleboxOverride("fill", UiTheme.Box(UiTheme.Production, UiTheme.Production, 0, 3, 0));
        v.AddChild(build);
        var buildText = new Label { ThemeTypeVariation = "Caption", HorizontalAlignment = HorizontalAlignment.Center };
        v.AddChild(buildText);
        var hp = new ProgressBar { ShowPercentage = false, CustomMinimumSize = new Vector2(0, 5), MaxValue = 100, MouseFilter = MouseFilterEnum.Ignore };
        hp.AddThemeStyleboxOverride("fill", UiTheme.Box(new Color("#59d16b"), new Color("#59d16b"), 0, 2, 0));
        v.AddChild(hp);
        AddChild(panel);
        b = (panel, pop, name, strength, build, buildText, hp);
        _banners[c.Id] = b;
        return b;
    }

    private void UpdateBanner(GameState s, CityState c, (PanelContainer Panel, Label Pop, Label Name, Label Strength, ProgressBar Build, Label BuildText, ProgressBar Hp) b, bool visible)
    {
        var color = HexMapView.CivColor(s, c.Owner);
        bool mine = c.Owner == _root.LocalPlayer;
        var bg = color.Darkened(0.55f);
        bg.A = 0.93f;
        b.Panel.AddThemeStyleboxOverride("panel", UiTheme.Box(bg, color.Lightened(0.2f), 2, 14, 7));
        b.Pop.Text = c.Population.ToString();
        b.Name.Text = (c.IsCapital ? "★ " : "") + c.Name.ToUpperInvariant();
        b.Name.AddThemeColorOverride("font_color", color.Lightened(0.55f));
        b.Strength.Text = CombatSystem.CityStrength(s, c).Total.ToString();
        int max = CombatSystem.CityMaxHp(s, c);
        b.Hp.MaxValue = max;
        b.Hp.Value = c.Hp;
        b.Hp.Visible = c.Hp < max;
        var item = mine && c.Queue.Items.Count > 0 ? c.Queue.Items[0] : null;
        b.Build.Visible = b.BuildText.Visible = mine;
        if (mine)
        {
            if (item == null) { b.Build.Value = 0; b.BuildText.Text = "Choose production"; b.BuildText.AddThemeColorOverride("font_color", UiTheme.GoldBright); }
            else
            {
                var est = ProductionSystem.Estimate(s, c, c.YieldsLastTurnProduction);
                if (est.Count > 0)
                {
                    var first = est[0];
                    b.Build.MaxValue = Math.Max(1, first.Cost.FloorToInt());
                    b.Build.Value = first.Progress.FloorToInt();
                    b.BuildText.Text = $"{first.Name} · {(first.TurnsToComplete > 0 ? $"{first.TurnsToComplete} t" : "—")}";
                }
                b.BuildText.RemoveThemeColorOverride("font_color");
            }
        }
        b.Panel.Modulate = new Color(1, 1, 1, visible ? 1 : 0.7f);
    }

    // ----- Unit flags --------------------------------------------------------------------------------

    private (PanelContainer Flag, TextureRect Icon, ProgressBar Hp) Flag(GameState s, UnitState u)
    {
        if (_flags.TryGetValue(u.Id, out var f)) return f;
        var def = s.Db.Units[u.DefIndex];
        var panel = new PanelContainer { CustomMinimumSize = new Vector2(30, 30), TooltipText = UnitStats.Name(s, u), MouseDefaultCursorShape = CursorShape.PointingHand };
        panel.GuiInput += e =>
        {
            if (e is InputEventMouseButton { Pressed: true, ButtonIndex: MouseButton.Left } && _root.State?.GetUnit(u.Id) is { } unit && unit.Owner == _root.LocalPlayer)
                _root.SelectUnit(unit.Id);
        };
        var v = new VBoxContainer { MouseFilter = MouseFilterEnum.Ignore };
        v.AddThemeConstantOverride("separation", 1);
        panel.AddChild(v);
        var icon = Icons.Rect(UnitIcon(def), Colors.White, 18);
        v.AddChild(icon);
        var hp = new ProgressBar { ShowPercentage = false, CustomMinimumSize = new Vector2(22, 4), MaxValue = 100, MouseFilter = MouseFilterEnum.Ignore };
        hp.AddThemeStyleboxOverride("fill", UiTheme.Box(new Color("#59d16b"), new Color("#59d16b"), 0, 2, 0));
        v.AddChild(hp);
        AddChild(panel);
        f = (panel, icon, hp);
        _flags[u.Id] = f;
        return f;
    }

    private static StyleBoxFlat FlagStyle(GameState s, int owner, bool selected)
    {
        var color = HexMapView.CivColor(s, owner);
        var bg = color.Darkened(0.35f);
        bg.A = 0.95f;
        var box = UiTheme.Box(bg, selected ? UiTheme.GoldBright : color.Lightened(0.35f), selected ? 3 : 2, 8, 4);
        box.CornerRadiusBottomLeft = box.CornerRadiusBottomRight = 14;   // a shield
        return box;
    }

    public static string UnitIcon(UnitDef d)
    {
        if (d.FoundsCity) return "home";
        if (d.FoundsOutpost) return "watchtower";
        if (d.Charges > 0) return "production";
        if (d.Domain == UnitDomain.Naval) return "arrow";
        return d.UnitClass switch
        {
            "Ranged" => "arrow",
            "Recon" => "moves",
            "LightCavalry" or "HeavyCavalry" => "moves",
            "Support" => "defense",
            _ => "strength",
        };
    }
}
