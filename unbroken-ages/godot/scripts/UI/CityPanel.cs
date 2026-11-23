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

    private Label _title = null!, _yields = null!, _loyalty = null!, _hover = null!;
    private ItemList _queue = null!;
    private OptionButton _add = null!;
    private CheckBox _repeat = null!;
    private readonly List<(ProductionKind Kind, int Def)> _addOptions = new();

    public CityPanel(GameRoot root, PlacementLens lens)
    {
        _root = root;
        _lens = lens;
    }

    public override void _Ready()
    {
        SetAnchorsAndOffsetsPreset(LayoutPreset.RightWide);
        CustomMinimumSize = new Vector2(380, 0);
        OffsetLeft = -390;
        var v = new VBoxContainer();
        AddChild(v);

        _title = new Label { ThemeTypeVariation = "HeaderLarge" };
        _yields = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart };
        _loyalty = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart };
        v.AddChild(_title);
        v.AddChild(_yields);
        v.AddChild(_loyalty);
        v.AddChild(new HSeparator());
        v.AddChild(new Label { Text = "PRODUCTION QUEUE" });

        _queue = new ItemList { CustomMinimumSize = new Vector2(0, 220), SelectMode = ItemList.SelectModeEnum.Single };
        v.AddChild(_queue);

        var row = new HBoxContainer();
        v.AddChild(row);
        row.AddChild(Button("▲", () => MoveSelected(-1)));
        row.AddChild(Button("▼", () => MoveSelected(+1)));
        row.AddChild(Button("Remove", RemoveSelected));
        row.AddChild(Button("Buy", BuySelected));

        var addRow = new HBoxContainer();
        v.AddChild(addRow);
        _add = new OptionButton { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        addRow.AddChild(_add);
        _repeat = new CheckBox { Text = "Repeat" };
        addRow.AddChild(_repeat);
        addRow.AddChild(Button("Add", AddSelectedOption));

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
        _title.Text = $"{city.Name}  ·  pop {city.Population}";
        _yields.Text = $"{report.Total}\nHousing {city.Population}/{report.Housing}   Amenities {report.AmenitiesAvailable}/{report.AmenitiesNeeded} ({report.AmenityStatus})" +
                       $"\nDistricts {DistrictPlacement.UsedCapacity(s, city)}/{DistrictPlacement.Capacity(city, fx)}" +
                       (city.PowerDemand > 0 ? $"   Power {(city.IsPowered ? "✔" : "✖")} ({city.PowerDemand} needed)" : "");
        var (nextTile, borderTurns) = BorderSystem.Forecast(s, city, report.Total.Culture);
        if (nextTile >= 0)
            _yields.Text += borderTurns > 0 ? $"\nNext tile in {borderTurns} turns: {BorderSystem.Describe(s, nextTile)}"
                                            : $"\nNext tile (needs culture): {BorderSystem.Describe(s, nextTile)}";

        var loyalty = LoyaltySystem.Compute(s, city, LoyaltySystem.Snapshot(s));
        _loyalty.Text = $"Loyalty {city.Loyalty}/100 ({(loyalty.Total >= Fx.Zero ? "+" : "")}{loyalty.Total}/turn" +
                        (loyalty.TurnsUntilFlip > 0 ? $", flips in {loyalty.TurnsUntilFlip}!)" : ")") +
                        "\n" + string.Join("\n", loyalty.Lines().Select(l => $"  {l.Label}: {l.Value}"));

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

        _add.Clear();
        _addOptions.Clear();
        void Offer(ProductionKind kind, int def, string name)
        {
            _addOptions.Add((kind, def));
            _add.AddItem(name);
        }
        var player = s.Players[city.Owner];
        foreach (var d in s.Db.Districts)
        {
            if (d.Category == DistrictCategory.CityCenter) continue;
            int effective = DistrictPlacement.EffectiveDistrict(s.Db, player, d.Index);
            if (effective != d.Index) continue;
            if (!player.HasTech(d.PrereqTechIndex) || !player.HasCivic(d.PrereqCivicIndex)) continue;
            if (d.CivilizationIndex >= 0 && d.CivilizationIndex != player.CivIndex) continue;
            Offer(ProductionKind.District, d.Index, $"⬡ {d.Name} ({ProductionSystem.Cost(s, player, ProductionKind.District, d.Index).FloorToInt()})");
        }
        foreach (var b in s.Db.Buildings)
            if (ProductionSystem.Validate(s, city, ProductionKind.Building, b.Index, -1) == null)
                Offer(ProductionKind.Building, b.Index, $"▣ {b.Name} ({b.Cost.FloorToInt()})");
        foreach (var u in s.Db.Units)
            if (ProductionSystem.Validate(s, city, ProductionKind.Unit, u.Index, -1) == null)
                Offer(ProductionKind.Unit, u.Index, $"♞ {u.Name} ({u.Cost.FloorToInt()})");
        foreach (var p in s.Db.Projects)
            if (ProductionSystem.Validate(s, city, ProductionKind.Project, p.Index, -1) == null)
                Offer(ProductionKind.Project, p.Index, $"✪ {p.Name} ({p.Cost.FloorToInt()})");
    }

    private void AddSelectedOption()
    {
        var s = _root.State;
        if (s == null || _add.Selected < 0 || _add.Selected >= _addOptions.Count) return;
        var (kind, def) = _addOptions[_add.Selected];
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
