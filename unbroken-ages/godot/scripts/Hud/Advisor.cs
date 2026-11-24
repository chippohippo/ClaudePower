using Godot;
using UnbrokenAges.Client.UI;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.Hud;

/// <summary>
/// The advisor: a card at the top of the screen that teaches the first game one step at a time, from founding the capital
/// to the first war, the Society screen, trade and victory. Each tip appears when it becomes useful and leaves when you have
/// done the thing it teaches (or press "Got it"). Tips you have seen are remembered on this machine (user://advisor.cfg), so a
/// second game starts quiet; the Esc menu turns the advisor off or starts the lessons over.
/// </summary>
public partial class Advisor : PanelContainer
{
    private readonly GameRoot _root;
    private Label _title = null!, _body = null!, _step = null!;
    private string? _showing;
    private readonly HashSet<string> _seen = new();
    private const string ConfigPath = "user://advisor.cfg";
    public bool Enabled { get; private set; } = true;

    /// <summary>One lesson: when it is useful (Show), when it has been learned (Done), and what it says.</summary>
    private sealed record Tip(string Id, string Title, string Body, Func<GameState, PlayerState, bool> Show, Func<GameState, PlayerState, bool> Done);

    private readonly List<Tip> _tips;

    public Advisor(GameRoot root)
    {
        _root = root;
        bool HasCity(GameState s, PlayerState p) => s.Cities.Any(c => c.Owner == p.Id);
        _tips = new()
        {
            new("found", "Found your capital",
                "Your Settler is selected. Press B (or Found City) to settle where it stands. Rivers, coasts and hills make good capitals; the tile tooltip shows what each tile yields.",
                (s, p) => !HasCity(s, p), (s, p) => HasCity(s, p)),
            new("research", "Choose research",
                "Press T and pick a technology. Each one lists what it unlocks. Pottery, Animal Husbandry and Mining open farms, pastures and mines; Bronze Working brings Spearmen and Swordsmen.",
                (s, p) => HasCity(s, p) && p.CurrentTech < 0, (s, p) => p.CurrentTech >= 0),
            new("civic", "Choose a civic",
                "Civics (also on T) are your culture's tree: governments, policy cards and governor titles. Code of Laws opens your first government.",
                (s, p) => HasCity(s, p) && p.CurrentCivic < 0, (s, p) => p.CurrentCivic >= 0),
            new("production", "Choose production",
                "Click your city to open it and queue something. A Scout explores; a Warrior guards the walls; a Settler founds your next city. You can queue several items and buy them with gold.",
                (s, p) => s.CitiesOf(p.Id).Any(c => c.Queue.Items.Count == 0), (s, p) => s.CitiesOf(p.Id).All(c => c.Queue.Items.Count > 0)),
            new("move", "Explore",
                "Select a unit and right-click a tile to move there. Explore to find city sites, natural wonders, city-states and your neighbours. Space skips a unit for the turn; F fortifies it.",
                (s, p) => HasCity(s, p) && s.Turn >= 2, (s, p) => _root.UnitsMoved >= 3),
            new("endturn", "End the turn",
                "The big button at the bottom right always names the next thing that needs you. When it says NEXT TURN, press it or Enter. Your rivals move while it says PLEASE WAIT.",
                (s, p) => HasCity(s, p) && s.Turn <= 3, (s, p) => s.Turn >= 4),
            new("builder", "Improve your land",
                "Builders improve tiles: farms on grassland and plains, mines on hills, pastures and camps on resources. Each builder has three charges. The resource lens (R) shows what is still unimproved.",
                (s, p) => s.Turn >= 6 && HasCity(s, p), (s, p) => Enumerable.Range(0, s.Map.Count).Any(t => s.Map.Improvement[t] >= 0 && s.Map.OwnerPlayer[t] == p.Id)),
            new("expand", "Expand",
                "Queue a Settler. More cities mean more of everything; found them three or four tiles apart, near fresh water and resources. Settlers need a city of at least 2 people.",
                (s, p) => s.Turn >= 14 && s.CitiesOf(p.Id).Count() == 1, (s, p) => s.CitiesOf(p.Id).Count() >= 2 || s.CitiesOf(p.Id).Any(c => c.Queue.Items.Any(i => i.Kind == ProductionKind.Unit && s.Db.Units[i.DefIndex].FoundsCity))),
            new("districts", "Build districts",
                "Districts specialise a city: a Campus for science, a Commercial Hub for gold, a Holy Site for faith. When you queue one, the placement lens scores every tile by its adjacency bonus.",
                (s, p) => s.CitiesOf(p.Id).Any(c => c.Population >= 3) && s.CitiesOf(p.Id).All(c => c.Districts.Count <= 1), (s, p) => s.CitiesOf(p.Id).Any(c => c.Districts.Count > 1 || c.Queue.Items.Any(i => i.Kind == ProductionKind.District))),
            new("neighbours", "Meet your neighbours",
                "You have met another civilization. Diplomacy (P) shows how each leader feels about you and why, and lets you open borders, denounce, declare war or make peace. City-states are there too: send envoys for their bonuses.",
                (s, p) => s.Units.Any(u => u.Owner != p.Id && s.Players[u.Owner].IsMajor && VisibleTo(s, p, u.Tile)), (s, p) => _root.PanelsOpened.Contains("P")),
            new("government", "Adopt a government",
                "You can now choose a government. Open Society (G) to adopt one and fill its policy slots: military, economic, diplomatic and wildcard cards. Swapping is free when you finish a civic.",
                (s, p) => p.Government < 0 && s.Db.Governments.Any(g => g.PrereqCivic != null && p.HasCivic(s.Db.Civics.IndexOf(g.PrereqCivic))), (s, p) => p.Government >= 0 || _root.PanelsOpened.Contains("G")),
            new("war", "War",
                "You are at war. Select a unit and hover an enemy to see the combat preview: every modifier is listed. Hills and woods help defenders, Spearmen stop horsemen, and walls fall to siege engines. Wounded units heal by resting.",
                (s, p) => s.Relations.Any(r => (r.A == p.Id || r.B == p.Id) && r.Status == DiploStatus.War && s.Players[r.A == p.Id ? r.B : r.A].IsMajor), (s, p) => _root.AttacksMade > 0),
            new("trade", "Trade",
                "Traders open 30-turn routes from the city they stand in: Food and Production at home, Gold abroad, influence with city-states. Select the Trader in a city and use Trade Route.",
                (s, p) => s.Db.Units.Any(u => u.HasTag("Trader") && p.HasCivic(u.PrereqCivicIndex) && p.HasTech(u.PrereqTechIndex)) && s.CitiesOf(p.Id).Count() >= 2,
                (s, p) => s.TradeRoutes.Any(r => r.Owner == p.Id) || s.Units.Any(u => u.Owner == p.Id && s.Db.Units[u.DefIndex].HasTag("Trader"))),
            new("chronicle", "Your story so far",
                "The Chronicle (C) is a dated history of your game, written as it happens. Victory comes many ways: conquest, science (Exodus), culture, faith, the World Congress, or the Divergence futures (V).",
                (s, p) => s.Turn >= 50, (s, p) => _root.PanelsOpened.Contains("C") || _root.PanelsOpened.Contains("V")),
        };
    }

    private static bool VisibleTo(GameState s, PlayerState p, int tile) => tile >= 0 && tile < p.Revealed.Length && p.Revealed[tile];

    private double _poll;

    /// <summary>Panels open and close without a new game state: look again a few times a second.</summary>
    public override void _Process(double delta)
    {
        if ((_poll += delta) < 0.3) return;
        _poll = 0;
        Refresh();
    }

    public override void _Ready()
    {
        Load();
        SetAnchorsAndOffsetsPreset(LayoutPreset.CenterTop);
        CustomMinimumSize = new Vector2(560, 0);
        GrowHorizontal = GrowDirection.Both;
        OffsetTop = 54;
        AddThemeStyleboxOverride("panel", UiTheme.Box(new Color("#0e1a2bf0"), UiTheme.Gold, 2, 10, 14));
        var h = new HBoxContainer();
        h.AddThemeConstantOverride("separation", 14);
        AddChild(h);
        var badge = new PanelContainer { CustomMinimumSize = new Vector2(46, 46), SizeFlagsVertical = SizeFlags.ShrinkBegin };
        badge.AddThemeStyleboxOverride("panel", UiTheme.Box(new Color(UiTheme.Gold, 0.22f), UiTheme.Gold, 2, 23, 6));
        badge.AddChild(Icons.Rect("crown", UiTheme.GoldBright, 28));
        h.AddChild(badge);
        var v = new VBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        v.AddThemeConstantOverride("separation", 4);
        h.AddChild(v);
        var top = new HBoxContainer();
        _title = new Label { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        _title.AddThemeColorOverride("font_color", UiTheme.GoldBright);
        _step = new Label { ThemeTypeVariation = "Caption" };
        top.AddChild(_title);
        top.AddChild(_step);
        v.AddChild(top);
        _body = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart, CustomMinimumSize = new Vector2(470, 0) };
        v.AddChild(_body);
        var buttons = new HBoxContainer { Alignment = BoxContainer.AlignmentMode.End };
        buttons.AddThemeConstantOverride("separation", 8);
        var hide = new Button { Text = "Turn off tips", ThemeTypeVariation = "FlatButton" };
        hide.Pressed += () => SetEnabled(false);
        var ok = new Button { Text = "Got it" };
        ok.Pressed += () => { if (_showing != null) MarkSeen(_showing); Refresh(); };
        buttons.AddChild(hide);
        buttons.AddChild(ok);
        v.AddChild(buttons);
        Visible = false;
    }

    /// <summary>Shows the first lesson that is useful now and not yet learned; marks lessons learned as you do them.</summary>
    public void Refresh()
    {
        var s = _root.State;
        if (s == null || !Enabled || _root.AiBusy || _root.AnyOverlayOpen) { Visible = false; return; }
        var p = s.Players[_root.LocalPlayer];
        // The lesson on screen is learned once you do what it says; a lesson never shown stays for when it is useful.
        if (_showing != null && _tips.Find(t => t.Id == _showing) is { } shown && shown.Done(s, p)) MarkSeen(shown.Id);
        var next = _tips.FirstOrDefault(t => !_seen.Contains(t.Id) && t.Show(s, p) && !t.Done(s, p));
        _showing = next?.Id;
        Visible = next != null;
        if (next == null) return;
        _title.Text = next.Title;
        _body.Text = next.Body;
        _step.Text = $"Advisor · {_tips.IndexOf(next) + 1} of {_tips.Count}";
    }

    private void MarkSeen(string id)
    {
        if (_seen.Add(id)) Save();
    }

    public void SetEnabled(bool on)
    {
        Enabled = on;
        Save();
        Refresh();
    }

    /// <summary>Starts the lessons over (from the Esc menu).</summary>
    public void Reset()
    {
        _seen.Clear();
        Enabled = true;
        Save();
        Refresh();
    }

    private void Load()
    {
        var cfg = new ConfigFile();
        if (cfg.Load(ConfigPath) != Error.Ok) return;
        Enabled = (bool)cfg.GetValue("advisor", "enabled", true);
        foreach (var id in ((string)cfg.GetValue("advisor", "seen", "")).Split(',', StringSplitOptions.RemoveEmptyEntries)) _seen.Add(id);
    }

    private void Save()
    {
        var cfg = new ConfigFile();
        cfg.SetValue("advisor", "enabled", Enabled);
        cfg.SetValue("advisor", "seen", string.Join(",", _seen));
        cfg.Save(ConfigPath);
    }
}
