using Godot;
using UnbrokenAges.Client.Map;
using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;
using UnbrokenAges.Sim.Systems.Districts;

namespace UnbrokenAges.Client.UI;

/// <summary>
/// City panel with a first-class production queue (wireframe: docs/06-ui-ux-wireframes.md §1).
///  • Queue rows show name, progress and the turn each item completes ("T47"), recomputed live.
///  • Reorder with ▲/▼ (drag-and-drop in the full skin), remove, toggle repeat, buy with gold.
///  • Choosing a district opens the placement lens; clicking a green tile enqueues it with that
///    tile reserved. Shift-click semantics: append (default) vs. Ctrl = insert at front.
///  • Yield, loyalty and housing lines are built from the same breakdowns the sim uses.
/// </summary>
public partial class CityPanel : PanelContainer
{
    private readonly GameRoot _root;
    private readonly PlacementLens _lens;
    private int _cityId = -1;
    private int _pendingDistrict = -1;

    private HBoxContainer _yieldRow = null!;
    private Label _title = null!, _yields = null!, _loyalty = null!, _hover = null!;
    private ItemList _queue = null!;
    private VBoxContainer _build = null!;
    private CheckBox _repeat = null!;

    public CityPanel(GameRoot root, PlacementLens lens)
    {
        _root = root;
        _lens = lens;
    }

    public override void _Ready()
    {
        SetAnchorsAndOffsetsPreset(LayoutPreset.RightWide);
        CustomMinimumSize = new Vector2(390, 0);
        OffsetLeft = -402; OffsetRight = -12; OffsetTop = 50; OffsetBottom = -294;   // below the top bar, above the turn button
        var scroll = new ScrollContainer { HorizontalScrollMode = ScrollContainer.ScrollMode.Disabled };
        AddChild(scroll);
        var v = new VBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        v.AddThemeConstantOverride("separation", 6);
        scroll.AddChild(v);

        _title = new Label { ThemeTypeVariation = "HeaderLarge" };
        _yieldRow = new HBoxContainer();
        _yieldRow.AddThemeConstantOverride("separation", 12);
        _yields = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart };
        _loyalty = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart };
        v.AddChild(_title);
        v.AddChild(_yieldRow);
        v.AddChild(_yields);
        v.AddChild(_loyalty);
        v.AddChild(new HSeparator());
        v.AddChild(new Label { Text = "PRODUCTION QUEUE" });

        _queue = new ItemList { CustomMinimumSize = new Vector2(0, 96), SelectMode = ItemList.SelectModeEnum.Single, AutoHeight = true };
        v.AddChild(_queue);

        var row = new HBoxContainer();
        v.AddChild(row);
        row.AddChild(Button("▲", () => MoveSelected(-1)));
        row.AddChild(Button("▼", () => MoveSelected(+1)));
        row.AddChild(Button("Remove", RemoveSelected));
        row.AddChild(Button("Buy", BuySelected));

        var buildHead = new HBoxContainer();
        v.AddChild(buildHead);
        buildHead.AddChild(new Label { Text = "BUILD  (click to queue)", SizeFlagsHorizontal = SizeFlags.ExpandFill });
        _repeat = new CheckBox { Text = "Repeat" };
        buildHead.AddChild(_repeat);
        _build = new VBoxContainer();
        _build.AddThemeConstantOverride("separation", 3);
        v.AddChild(_build);

        v.AddChild(new HSeparator());
        _hover = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart };
        v.AddChild(_hover);
        _lens.HoverChanged += text => _hover.Text = text;

        v.AddChild(Button("End Turn  (Enter)", () => _root.Submit(new EndTurnCommand())));
    }

    private static Button Button(string text, Action onPressed)
    {
        var b = new Button { Text = text };
        b.Pressed += onPressed;
        return b;
    }

    public void ShowCity(int cityId)
    {
        _cityId = cityId;
        _lens.Hide();
        Refresh();
    }

    public void Refresh()
    {
        var s = _root.State;
        var city = s?.GetCity(_cityId) ?? s?.Cities.FirstOrDefault(c => c.Owner == _root.LocalPlayer);
        if (s == null || city == null)
        {
            _title.Text = "No city selected";
            return;
        }
        _cityId = city.Id;
        var fx = CityEffects.Compute(s, city);
        var report = CityYields.Compute(s, city, fx);
        _title.Text = $"{(city.IsCapital ? "★ " : "")}{city.Name.ToUpperInvariant()}  ·  {city.Population}";
        foreach (var child in _yieldRow.GetChildren()) child.QueueFree();
        foreach (var (icon, color, value, tip) in new[]
        {
            ("food", UiTheme.Food, report.Total.Food, "Food"), ("production", UiTheme.Production, report.Total.Production, "Production"),
            ("gold", UiTheme.GoldYield, report.Total.Gold, "Gold"), ("science", UiTheme.Science, report.Total.Science, "Science"),
            ("culture", UiTheme.Culture, report.Total.Culture, "Culture"), ("faith", UiTheme.Faith, report.Total.Faith, "Faith"),
        })
            _yieldRow.AddChild(Icons.Stat(icon, color, value.ToString(), out _, 18, $"{tip} per turn"));
        _yields.Text = $"Housing {city.Population}/{report.Housing}   Amenities {report.AmenitiesAvailable}/{report.AmenitiesNeeded} ({report.AmenityStatus})" +
                       $"\nDistricts {DistrictPlacement.UsedCapacity(s, city)}/{DistrictPlacement.Capacity(city, fx)}" +
                       (city.PowerDemand > 0 ? $"   Power {(city.IsPowered ? "✔" : "✖")} ({city.PowerDemand} needed)" : "");
        var (nextTile, borderTurns) = BorderSystem.Forecast(s, city, report.Total.Culture);
        if (nextTile >= 0)
            _yields.Text += borderTurns > 0 ? $"\nNext tile in {borderTurns} turns: {BorderSystem.Describe(s, nextTile)}"
                                            : $"\nNext tile (needs culture): {BorderSystem.Describe(s, nextTile)}";

        var loyalty = LoyaltySystem.Compute(s, city, LoyaltySystem.Snapshot(s));
        static string One(Fx v) => v.ToDouble().ToString("0.#", System.Globalization.CultureInfo.InvariantCulture);
        _loyalty.Text = $"Loyalty {One(city.Loyalty)}/100 ({(loyalty.Total >= Fx.Zero ? "+" : "")}{One(loyalty.Total)}/turn" +
                        (loyalty.TurnsUntilFlip > 0 ? $", flips in {loyalty.TurnsUntilFlip}!)" : ")") +
                        "\n" + string.Join("\n", loyalty.Lines().Select(l => $"  {l.Label}: {(l.Value >= Fx.Zero ? "+" : "")}{One(l.Value)}"));
        if (city.GovernorDef >= 0 && s.Players[city.Owner].GetGovernor(city.GovernorDef) is { } gov)
            _loyalty.Text += $"\nGovernor: {GovernorSystem.Describe(s, gov)}" +
                             (gov.Established ? "" : $" (establishing {gov.EstablishProgress}/{GovernorSystem.EstablishTurns(s.Db, gov)})");

        _queue.Clear();
        var estimates = ProductionSystem.Estimate(s, city, report.Total.Production);
        for (int i = 0; i < city.Queue.Items.Count; i++)
        {
            var item = city.Queue.Items[i];
            var e = estimates[i];
            string when = e.TurnsToComplete < 0 ? "never" : $"{e.TurnsToComplete} t (T{e.CompletesOnTurn})";
            string where = item.Tile >= 0 ? " 📍" : "";
            _queue.AddItem($"{e.Name}{where}{(item.Repeat ? " ↻" : "")}   {e.Progress.FloorToInt()}/{e.Cost.FloorToInt()}   {when}");
        }

        foreach (var c in _build.GetChildren()) c.QueueFree();
        var groups = new SortedDictionary<int, (string Title, Color Tone, List<(ProductionKind Kind, int Def, string Name, string Tip)> Items)>
        {
            [0] = ("Units", UiTheme.Danger, new()), [1] = ("Districts", UiTheme.Science, new()), [2] = ("Buildings", UiTheme.Production, new()),
            [3] = ("Wonders", UiTheme.GoldBright, new()), [4] = ("Projects", UiTheme.Culture, new()),
        };
        int production = Math.Max(1, report.Total.Production.FloorToInt());
        void Offer(ProductionKind kind, int def, string name)
        {
            int group = kind switch { ProductionKind.Unit => 0, ProductionKind.Building => 2, ProductionKind.Project => 4, _ => s.Db.Districts[def].Category == DistrictCategory.Wonder ? 3 : 1 };
            string description = kind switch
            {
                ProductionKind.Unit => s.Db.Units[def].Description ?? "",
                ProductionKind.District => s.Db.Districts[def].Description ?? "",
                ProductionKind.Building => s.Db.Buildings[def].Description ?? "",
                _ => s.Db.Projects[def].Description ?? "",
            };
            groups[group].Items.Add((kind, def, name, description));
        }
        var player = s.Players[city.Owner];
        foreach (var d in s.Db.Districts)
        {
            if (d.Category == DistrictCategory.CityCenter) continue;
            int effective = DistrictPlacement.EffectiveDistrict(s.Db, player, d.Index);
            if (effective != d.Index) continue;
            if (!player.HasTech(d.PrereqTechIndex) || !player.HasCivic(d.PrereqCivicIndex)) continue;
            if (d.CivilizationIndex >= 0 && d.CivilizationIndex != player.CivIndex) continue;
            bool wonder = d.Category == DistrictCategory.Wonder;
            if (wonder && s.Cities.Any(c => c.Districts.Any(x => x.DefIndex == d.Index))) continue;   // someone has built it
            Offer(ProductionKind.District, d.Index, d.Name);
        }
        foreach (var b in s.Db.Buildings)
            if (ProductionSystem.Validate(s, city, ProductionKind.Building, b.Index, -1) == null)
                Offer(ProductionKind.Building, b.Index, b.Name);
        foreach (var u in s.Db.Units)
            if (ProductionSystem.Validate(s, city, ProductionKind.Unit, u.Index, -1) == null)
                Offer(ProductionKind.Unit, u.Index, u.Name);
        foreach (var p in s.Db.Projects)
            if (ProductionSystem.Validate(s, city, ProductionKind.Project, p.Index, -1) == null)
                Offer(ProductionKind.Project, p.Index, p.Name);

        // Cards by group: name, turns at this city's production, cost; the description as the tooltip.
        foreach (var (title, tone, items) in groups.Values)
        {
            if (items.Count == 0) continue;
            var header = new Label { Text = title.ToUpperInvariant(), ThemeTypeVariation = "Caption" };
            header.AddThemeColorOverride("font_color", tone);
            _build.AddChild(header);
            foreach (var (kind, def, name, tip) in items.OrderBy(i => ProductionSystem.Cost(s, player, i.Kind, i.Def)))
            {
                int cost = ProductionSystem.Cost(s, player, kind, def).FloorToInt();
                var card = new Button { Alignment = HorizontalAlignment.Left, TooltipText = tip, CustomMinimumSize = new Vector2(0, 30), ClipText = true,
                                        Text = $"{name}    {(cost + production - 1) / production} t  ·  {cost}" };
                var box = UiTheme.Box(new Color("#12233acc"), new Color(tone, 0.35f), 1, 5, 6);
                box.BorderWidthLeft = 3;
                box.BorderColor = new Color(tone, 0.85f);
                card.AddThemeStyleboxOverride("normal", box);
                var hover = (StyleBoxFlat)box.Duplicate();
                hover.BgColor = new Color("#1d3a5c");
                card.AddThemeStyleboxOverride("hover", hover);
                var (k, d2) = (kind, def);
                card.Pressed += () => Queue(k, d2);
                _build.AddChild(card);
            }
        }
    }

    private void Queue(ProductionKind kind, int def)
    {
        var s = _root.State;
        if (s == null) return;
        if (kind == ProductionKind.District)
        {
            _pendingDistrict = def;
            _lens.Show(s, s.GetCity(_cityId)!, def); // choose the tile on the map
            return;
        }
        Report(_root.Submit(new EnqueueCommand { CityId = _cityId, Kind = kind, DefIndex = def, Repeat = _repeat.ButtonPressed }));
    }

    public void ConfirmPlacement(int tile)
    {
        if (_pendingDistrict < 0 || !_lens.IsValid(tile)) return;
        bool front = Input.IsKeyPressed(Key.Ctrl);
        Report(_root.Submit(new EnqueueCommand
        {
            CityId = _cityId, Kind = ProductionKind.District, DefIndex = _pendingDistrict, Tile = tile, Position = front ? 0 : -1,
        }));
        _pendingDistrict = -1;
        _lens.Hide();
    }

    private int Selected => _queue.GetSelectedItems() is { Length: > 0 } sel ? sel[0] : -1;

    private void MoveSelected(int delta)
    {
        int i = Selected;
        if (i < 0) return;
        Report(_root.Submit(new MoveQueueItemCommand { CityId = _cityId, From = i, To = i + delta }));
    }

    private void RemoveSelected()
    {
        if (Selected >= 0) Report(_root.Submit(new RemoveQueueItemCommand { CityId = _cityId, Index = Selected }));
    }

    private void BuySelected()
    {
        var city = _root.State?.GetCity(_cityId);
        if (city == null || Selected < 0) return;
        var item = city.Queue.Items[Selected];
        Report(_root.Submit(new PurchaseCommand { CityId = _cityId, Kind = item.Kind, DefIndex = item.DefIndex }));
    }

    private void Report(CommandResult r)
    {
        _hover.Text = r.Ok ? "" : $"⚠ {r.Error}";
        Refresh();
    }
}
