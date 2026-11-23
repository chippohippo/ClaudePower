using Godot;
using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.UI;

/// <summary>
/// Diplomacy screen (P), skeleton: one row per civilization you know, with status, how they feel about you (every attitude line,
/// never a hidden number), grievances both ways, and the actions. A disabled button's tooltip says exactly why it is unavailable,
/// from the same validation the host runs. Deals and the World Congress arrive in M4. Wireframe: docs/06-ui-ux-wireframes.md §4.
/// </summary>
public partial class DiplomacyPanel : PanelContainer
{
    private readonly GameRoot _root;
    private VBoxContainer _rows = null!;

    public DiplomacyPanel(GameRoot root) => _root = root;

    public override void _Ready()
    {
        SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        OffsetLeft = 60; OffsetTop = 60; OffsetRight = -60; OffsetBottom = -60;
        var v = new VBoxContainer();
        AddChild(v);
        v.AddChild(new Label { Text = "DIPLOMACY", ThemeTypeVariation = "HeaderLarge" });
        var scroll = new ScrollContainer { SizeFlagsVertical = SizeFlags.ExpandFill };
        v.AddChild(scroll);
        _rows = new VBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        scroll.AddChild(_rows);
        var close = new Button { Text = "Close (P)" };
        close.Pressed += () => Visible = false;
        v.AddChild(close);
    }

    public void Refresh()
    {
        var s = _root.State;
        if (s == null) return;
        int me = _root.LocalPlayer;
        foreach (var child in _rows.GetChildren()) child.QueueFree();
        foreach (var other in s.Players.Where(p => p.Id != me && !p.IsFreeCities && p.IsAlive))
        {
            var row = new HBoxContainer();
            _rows.AddChild(row);
            string civ = other.CivIndex >= 0 ? s.Db.Civilizations[other.CivIndex].Name : other.Name;
            var attitude = DiplomacySystem.Attitude(s, other.Id, me);
            var info = new Label
            {
                CustomMinimumSize = new Vector2(520, 0), AutowrapMode = TextServer.AutowrapMode.WordSmart,
                Text = $"{other.Name} ({civ}) · {DiplomacySystem.StatusName(s, me, other.Id)} · score {VictorySystem.Score(s, other.Id)}\n" +
                       $"Attitude toward you: {attitude.Total:+0;-0;0}  " + string.Join(", ", attitude.Lines.Select(l => $"{l.Label} {l.Value:+0;-0}")) + "\n" +
                       $"Their grievances against you: {DiplomacySystem.GrievanceTotal(s, other.Id, me).FloorToInt()} · yours against them: {DiplomacySystem.GrievanceTotal(s, me, other.Id).FloorToInt()}",
            };
            row.AddChild(info);
            AddAction(row, "Declare war", new DeclareWarCommand { Target = other.Id });
            AddAction(row, "Propose peace", new ProposePeaceCommand { Target = other.Id });
            AddAction(row, "Accept peace", new AcceptPeaceCommand { Target = other.Id });
            AddAction(row, "Denounce", new DenounceCommand { Target = other.Id });
            bool open = DiplomacySystem.Find(s, me, other.Id) is { } r && (r.A == me ? r.AGrantsB : r.BGrantsA);
            AddAction(row, open ? "Close borders" : "Open borders", new SetOpenBordersCommand { Target = other.Id, Open = !open });
        }
    }

    private void AddAction(HBoxContainer row, string label, GameCommand cmd)
    {
        var s = _root.State!;
        cmd.Player = _root.LocalPlayer;
        string? why = cmd.Validate(s);
        var button = new Button { Text = label, Disabled = why != null, TooltipText = why ?? "" };
        button.Pressed += () => { _root.Submit(cmd); Refresh(); };
        row.AddChild(button);
    }

    public override void _UnhandledInput(InputEvent @event)
    {
        if (@event is InputEventKey { Pressed: true, Keycode: Key.P })
        {
            Visible = !Visible;
            if (Visible) { _root.CloseOverlaysExcept(this); Refresh(); }
        }
    }
}
