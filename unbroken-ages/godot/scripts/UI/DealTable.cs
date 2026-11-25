using Godot;
using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.UI;

/// <summary>
/// The deal table (DealSystem; docs/05-key-systems/08-diplomacy.md): what you give and what they give, gold, gold a turn,
/// favor, strategic resources and open borders on each side, and joint items (peace, an alliance, a research agreement).
/// As you compose it the table tells you whether they would take it, and "Balance with gold" adds what would tip it.
/// Offers go on the table; the other side answers on its turn.
/// </summary>
public partial class DealTable : PanelContainer
{
    private readonly GameRoot _root;
    private int _other = -1;
    private readonly VBoxContainer _body = new();
    private Label _verdict = null!;
    private Button _propose = null!, _balance = null!;
    private readonly Dictionary<(int Giver, DealItemKind Kind, int Target), SpinBox> _amounts = new();
    private readonly Dictionary<(int Giver, DealItemKind Kind), CheckBox> _flags = new();
    private readonly Dictionary<DealItemKind, CheckBox> _joint = new();

    public DealTable(GameRoot root) => _root = root;

    public override void _Ready()
    {
        Visible = false;
        SetAnchorsAndOffsetsPreset(LayoutPreset.Center);
        CustomMinimumSize = new Vector2(760, 0);
        var box = UiTheme.Box(new Color(UiTheme.Navy, 0.97f), UiTheme.Gold, 2, 8, 18);
        box.ShadowColor = new Color(0, 0, 0, 0.5f); box.ShadowSize = 14;
        AddThemeStyleboxOverride("panel", box);
        _body.AddThemeConstantOverride("separation", 8);
        AddChild(_body);
    }

    public void Open(int other)
    {
        var s = _root.State;
        if (s == null) return;
        _other = other;
        Build(s, _root.LocalPlayer, other);
        Visible = true;
        CallDeferred(MethodName.Recentre);
    }

    private void Recentre()
    {
        ResetSize();
        Position = (GetViewportRect().Size - Size) / 2;
    }

    private void Build(GameState s, int me, int other)
    {
        foreach (var c in _body.GetChildren()) c.QueueFree();
        _amounts.Clear(); _flags.Clear(); _joint.Clear();
        string them = Cinematics.PeopleName(s, other);
        var title = new Label { Text = $"A deal with {them}" };
        title.AddThemeFontOverride("font", Cinematics.Engraved(700));
        title.AddThemeFontSizeOverride("font_size", 24);
        title.AddThemeColorOverride("font_color", UiTheme.GoldBright);
        _body.AddChild(title);
        var attitude = DiplomacySystem.Attitude(s, other, me);
        _body.AddChild(new Label { Text = $"{DiplomacySystem.StatusName(s, me, other)} · their attitude toward you {attitude.Total:+0;-0;0}", Modulate = UiTheme.TextDim });

        var sides = new HBoxContainer();
        sides.AddThemeConstantOverride("separation", 24);
        _body.AddChild(sides);
        sides.AddChild(Side(s, me, "You give"));
        sides.AddChild(Side(s, other, $"{them} gives"));

        var joint = new HBoxContainer();
        joint.AddThemeConstantOverride("separation", 16);
        _body.AddChild(joint);
        if (DiplomacySystem.AtWar(s, me, other)) Joint(joint, DealItemKind.Peace, "Peace");
        else
        {
            Joint(joint, DealItemKind.Alliance, "An alliance");
            Joint(joint, DealItemKind.ResearchAgreement, $"A research agreement ({DealSystem.ResearchAgreementCost(s, s.Players[me])} gold each)");
        }

        _verdict = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart, CustomMinimumSize = new Vector2(700, 0) };
        _body.AddChild(_verdict);
        var buttons = new HBoxContainer();
        buttons.AddThemeConstantOverride("separation", 10);
        _body.AddChild(buttons);
        _balance = new Button { Text = "Balance with gold", TooltipText = "Add the gold that would make them accept, if you have it." };
        _balance.Pressed += Balance;
        buttons.AddChild(_balance);
        _propose = new Button { Text = "Put it on the table" };
        _propose.Pressed += Propose;
        buttons.AddChild(_propose);
        var close = new Button { Text = "Close" };
        close.Pressed += () => Visible = false;
        buttons.AddChild(close);
        Evaluate();
    }

    private VBoxContainer Side(GameState s, int giver, string heading)
    {
        var p = s.Players[giver];
        var col = new VBoxContainer { CustomMinimumSize = new Vector2(340, 0) };
        var h = new Label { Text = heading.ToUpperInvariant() };
        h.AddThemeColorOverride("font_color", UiTheme.Gold);
        col.AddChild(h);
        Amount(col, giver, DealItemKind.Gold, -1, "Gold", Math.Max(0, p.Gold.FloorToInt()));
        Amount(col, giver, DealItemKind.GoldPerTurn, -1, $"Gold a turn ({DealSystem.GoldPerTurnTurns} turns)", 200);
        if (p.Favor > 0) Amount(col, giver, DealItemKind.Favor, -1, "Favor", p.Favor);
        foreach (var r in s.Db.Resources.Where(r => r.Class == ResourceClass.Strategic))
            if (r.Index < p.Stockpile.Length && p.Stockpile[r.Index] > 0) Amount(col, giver, DealItemKind.Resource, r.Index, r.Name, p.Stockpile[r.Index]);
        var borders = new CheckBox { Text = "Open borders" };
        borders.Toggled += _ => Evaluate();
        _flags[(giver, DealItemKind.OpenBorders)] = borders;
        col.AddChild(borders);
        return col;
    }

    private void Amount(VBoxContainer col, int giver, DealItemKind kind, int target, string label, int max)
    {
        var row = new HBoxContainer();
        row.AddChild(new Label { Text = label, SizeFlagsHorizontal = SizeFlags.ExpandFill });
        var spin = new SpinBox { MinValue = 0, MaxValue = Math.Max(0, max), Step = kind == DealItemKind.Gold ? 10 : 1, CustomMinimumSize = new Vector2(110, 0) };
        spin.ValueChanged += _ => Evaluate();
        _amounts[(giver, kind, target)] = spin;
        row.AddChild(spin);
        col.AddChild(row);
    }

    private void Joint(HBoxContainer row, DealItemKind kind, string label)
    {
        var box = new CheckBox { Text = label };
        box.Toggled += _ => Evaluate();
        _joint[kind] = box;
        row.AddChild(box);
    }

    private List<DealItemState> Items()
    {
        int me = _root.LocalPlayer;
        var items = new List<DealItemState>();
        foreach (var ((giver, kind, target), spin) in _amounts)
            if ((int)spin.Value > 0) items.Add(new DealItemState { Kind = kind, Giver = giver, Amount = (int)spin.Value, Target = target });
        foreach (var ((giver, kind), box) in _flags)
            if (box.ButtonPressed) items.Add(new DealItemState { Kind = kind, Giver = giver, Amount = 1 });
        foreach (var (kind, box) in _joint)
            if (box.ButtonPressed) items.Add(new DealItemState { Kind = kind, Giver = me, Amount = 1 });
        return items;
    }

    private void Evaluate()
    {
        var s = _root.State;
        if (s == null || _verdict == null) return;
        int me = _root.LocalPlayer;
        var items = Items();
        string? why = items.Count == 0 ? "Put something on the table." : DealSystem.Validate(s, me, _other, items);
        if (why != null)
        {
            _verdict.Text = why;
            _verdict.Modulate = UiTheme.TextDim;
            _propose.Disabled = true;
            _balance.Disabled = true;
            return;
        }
        bool yes = DealSystem.WouldAccept(s, me, _other, items);
        int gold = DealSystem.GoldToBalance(s, me, _other, items);
        _verdict.Text = yes ? $"{Cinematics.PeopleName(s, _other)} would accept this." :
                        gold > 0 ? $"{Cinematics.PeopleName(s, _other)} would refuse; {gold} more gold would tip it." :
                        $"{Cinematics.PeopleName(s, _other)} would refuse, and no gold you have would change that.";
        _verdict.Modulate = yes ? UiTheme.Food : UiTheme.Danger;
        _propose.Disabled = false;
        _balance.Disabled = yes || gold <= 0;
    }

    private void Balance()
    {
        var s = _root.State;
        if (s == null) return;
        int gold = DealSystem.GoldToBalance(s, _root.LocalPlayer, _other, Items());
        if (gold > 0 && _amounts.TryGetValue((_root.LocalPlayer, DealItemKind.Gold, -1), out var spin)) spin.Value += gold;
        Evaluate();
    }

    private void Propose()
    {
        var r = _root.Submit(new ProposeDealCommand { Target = _other, Items = Items() });
        _verdict.Text = r.Ok ? "On the table: they will answer on their turn." : r.Error ?? "";
        _verdict.Modulate = r.Ok ? UiTheme.GoldBright : UiTheme.Danger;
        if (r.Ok) _propose.Disabled = true;
    }
}
