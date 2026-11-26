using Godot;
using UnbrokenAges.Client.UI;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.Hud;

/// <summary>
/// The strip across the top (Civ VI): your yields per turn with their icons and colours, gold in the bank with its change,
/// strategic stockpiles, then the world age, turn and date, and buttons for every major screen with their hotkeys.
/// Every number has a tooltip that says where it comes from.
/// </summary>
public partial class TopBar : PanelContainer
{
    private readonly GameRoot _root;
    private Label _science = null!, _culture = null!, _faith = null!, _gold = null!, _turn = null!, _age = null!, _climate = null!;
    private HBoxContainer _strategic = null!;
    private Label _signature = null!;
    private HBoxContainer _bar = null!;
    private PanelContainer _signatureBox = null!;
    private Control _scienceBox = null!, _goldBox = null!, _ageBox = null!, _climateBox = null!;

    public TopBar(GameRoot root) => _root = root;

    public override void _Ready()
    {
        SetAnchorsAndOffsetsPreset(LayoutPreset.TopWide);
        OffsetBottom = 40;
        AddThemeStyleboxOverride("panel", new StyleBoxFlat
        {
            BgColor = new Color("#0b1626f2"), BorderColor = new Color(UiTheme.Gold, 0.8f), BorderWidthBottom = 2,
            ContentMarginLeft = 14, ContentMarginRight = 10, ContentMarginTop = 6, ContentMarginBottom = 6,
            ShadowColor = new Color(0, 0, 0, 0.45f), ShadowSize = 8,
        });
        var h = new HBoxContainer();
        h.AddThemeConstantOverride("separation", 12);
        AddChild(h);
        h.AddChild(_scienceBox = Icons.Stat("science", UiTheme.Science, "", out _science, 20, "Science per turn"));
        h.AddChild(Icons.Stat("culture", UiTheme.Culture, "", out _culture, 20, "Culture per turn"));
        h.AddChild(Icons.Stat("faith", UiTheme.Faith, "", out _faith, 20, "Faith banked"));
        h.AddChild(_goldBox = Icons.Stat("gold", UiTheme.GoldYield, "", out _gold, 20));
        _strategic = new HBoxContainer();
        _strategic.AddThemeConstantOverride("separation", 12);
        h.AddChild(_strategic);
        // The nation's signature at a glance: the granary and the next flood, the Mandate, cities for sale…
        _signatureBox = new PanelContainer { MouseFilter = MouseFilterEnum.Pass };
        _signature = new Label { VerticalAlignment = VerticalAlignment.Center };
        _signature.AddThemeFontSizeOverride("font_size", 14);
        _signatureBox.AddChild(_signature);
        h.AddChild(_signatureBox);
        h.AddChild(new Control { SizeFlagsHorizontal = SizeFlags.ExpandFill });
        h.AddChild(_climateBox = Icons.Stat("apple", new Color("#9fd0e8"), "", out _climate, 16));
        h.AddChild(_ageBox = Icons.Stat("crown", UiTheme.GoldBright, "", out _age, 18));
        // The world age is the one thing that gives way (with an ellipsis; the full text is in its tooltip), so the screen
        // buttons and Menu always stay on screen however long the stats grow. FitAge sizes it.
        _age.TextOverrunBehavior = TextServer.OverrunBehavior.TrimEllipsis;
        _bar = h;
        _turn = new Label();
        _turn.AddThemeColorOverride("font_color", UiTheme.GoldBright);
        h.AddChild(_turn);
        // The screens, as compact icon-and-key buttons close together so the bar fits 1600 px with every screen on it.
        var keys = new HBoxContainer();
        keys.AddThemeConstantOverride("separation", 3);
        h.AddChild(keys);
        foreach (var (icon, key, tip) in new[] { ("science", "T", "Research and civics (T)"), ("hand", "P", "Diplomacy (P)"), ("faith", "G", "Society (G): government and policy cards, faith, great people, ages"), ("gate", "E", "Espionage (E): your spies and their missions"), ("culture", "C", "The Chronicle (C)"), ("crown", "V", "The Divergence (V)"), ("arrow", "L", "Supply lens (L)"), ("pouch", "R", "Resource lens (R): every resource you know, its yields, and whether it is improved"), ("farm", "Y", "Yield lens (Y): food, production, gold, science, culture and faith on every tile you know") })
        {
            var b = Icons.Button(icon, key, UiTheme.GoldBright, () => _root.ToggleByKey(key), tip);
            b.CustomMinimumSize = new Vector2(38, 28);
            keys.AddChild(b);
        }
        var menu = Icons.Button("turns", "Menu", UiTheme.GoldBright, _root.ToggleMenu, "Menu: save, load, sound (Esc)");
        keys.AddChild(menu);
    }

    /// <summary>Gives the world-age label its full text width, or what is left of the bar when everything else is shown.</summary>
    public override void _Process(double delta) => FitAge();

    private void FitAge()
    {
        if (_bar == null || !IsInstanceValid(_bar)) return;
        var font = _age.GetThemeFont("font");
        float want = font.GetStringSize(_age.Text, HorizontalAlignment.Left, -1, _age.GetThemeFontSize("font_size")).X + 2;
        float others = _bar.GetCombinedMinimumSize().X - _age.GetCombinedMinimumSize().X;
        float room = GetViewportRect().Size.X - 24 - others;   // 24: the bar's own margins
        _age.CustomMinimumSize = new Vector2(Mathf.Clamp(want, 24, Mathf.Max(24, room)), 0);
    }

    public void Refresh()
    {
        var s = _root.State;
        if (s == null) return;
        var p = s.Players[_root.LocalPlayer];
        var (science, culture) = ResearchSystem.Rates(s, p.Id);
        int income = GoldIncome(s, p.Id);
        _science.Text = $"+{science}";
        _culture.Text = $"+{culture}";
        _faith.Text = $"{p.Faith.FloorToInt()}";
        _gold.Text = $"{p.Gold.FloorToInt()} ({(income >= 0 ? "+" : "")}{income})";
        _goldBox.TooltipText = $"Gold in the treasury, and its change per turn after building and unit maintenance.";
        _scienceBox.TooltipText = $"Science per turn from your cities. Current research: {(p.CurrentTech >= 0 ? s.Db.Techs[p.CurrentTech].Name : "none (press T)")}.";
        _turn.Text = $"Turn {s.Turn} · {Calendar.Format(Calendar.Year(s.Turn, s.Options.GameSpeedPercent))}";
        var w = s.World;
        _age.Text = (WorldSystem.CurrentAge(s)?.Name ?? "An ordinary age") + (p.Age != AgeState.Normal ? $" · your {p.Age} Age" : "");
        int next = WorldSystem.Forecast(s, w.WorldEra + 1);
        _ageBox.TooltipText = _age.Text + "\n" + $"World currents: Progress {w.Progress.FloorToInt()} · Strife {w.Strife.FloorToInt()} · Calamity {w.Calamity.FloorToInt()}\n" +
                              $"If a new era began now: {(next >= 0 ? s.Db.WorldAges[next].Name : "an ordinary age")}." +
                              (s.TurnPhases.Count > 1 ? $"\n{TurnPhases.Describe(s)}" : "");
        _climate.Text = $"{s.Climate.Co2Ppm.FloorToInt()} ppm · +{s.Climate.Temperature.ToDouble().ToString("0.0", System.Globalization.CultureInfo.InvariantCulture)}°C";
        _climateBox.TooltipText = $"Atmospheric CO₂ and warming. Climate phase {s.Climate.Phase} of 7: sea levels rise at higher phases.";

        var sig = NationSystem.Signature(s, p);
        _signatureBox.Visible = sig is { Kind: not Sim.Data.SignatureKind.None };
        if (sig != null && p.CivIndex >= 0)
        {
            var civ = s.Db.Civilizations[p.CivIndex];
            var colour = new Color(civ.Colors.Primary);
            bool golden = sig.Kind == Sim.Data.SignatureKind.Mandate && p.SignatureTimer > 0;
            _signatureBox.AddThemeStyleboxOverride("panel", UiTheme.Box(colour.Darkened(golden ? 0.2f : 0.6f), golden ? UiTheme.GoldBright : colour, golden ? 2 : 1, 10, 3));
            _signature.Text = NationSystem.Status(s, p);
            _signature.AddThemeColorOverride("font_color", golden ? Colors.White : colour.Lightened(0.55f));
            var leader = p.LeaderIndex >= 0 ? s.Db.Leaders[p.LeaderIndex] : null;
            _signatureBox.TooltipText = $"{civ.Name}: {sig.Name}\n{sig.Description}\n\n{sig.Playstyle}" +
                                        (leader != null ? $"\n\n{leader.Name}, {leader.Augment.Name}: {leader.Augment.Description}" : "");
        }

        foreach (var c in _strategic.GetChildren()) c.QueueFree();
        foreach (var res in s.Db.Resources.Where(r => r.Class == Sim.Data.ResourceClass.Strategic && p.Stockpile[r.Index] > 0))
            _strategic.AddChild(Icons.Stat(res.Id.Contains("IRON") ? "iron" : "pouch", new Color("#c9c3b5"), $"{p.Stockpile[res.Index]}", out _, 16, $"{res.Name} stockpile"));
    }

    private static int GoldIncome(GameState s, int player)
    {
        var db = s.Db;
        Sim.Core.Fx gold = Sim.Core.Fx.Zero;
        int upkeep = 0;
        foreach (var city in s.CitiesOf(player))
        {
            gold += CityYields.Compute(s, city, CityEffects.Compute(s, city)).Total.Gold;
            upkeep += city.AllBuildings().Sum(b => db.Buildings[b].Maintenance);
        }
        upkeep += s.Units.Where(u => u.Owner == player).Sum(u => db.Units[u.DefIndex].Maintenance);
        return gold.FloorToInt() - upkeep;
    }
}
