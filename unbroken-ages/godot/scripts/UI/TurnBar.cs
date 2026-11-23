using Godot;
using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.UI;

/// <summary>
/// Bottom-centre bar: what still needs your attention this turn, the End Turn button (Enter), and Save (F5) / Load (F9).
/// The button names the most important thing left undone ("Choose research"), but never blocks ending the turn.
/// </summary>
public partial class TurnBar : PanelContainer
{
    private readonly GameRoot _root;
    private Label _hint = null!;
    private Button _end = null!;

    public TurnBar(GameRoot root) => _root = root;

    public override void _Ready()
    {
        SetAnchorsAndOffsetsPreset(LayoutPreset.CenterBottom);
        GrowHorizontal = GrowDirection.Both;
        GrowVertical = GrowDirection.Begin;
        OffsetBottom = -12;
        var h = new HBoxContainer();
        AddChild(h);
        _hint = new Label { CustomMinimumSize = new Vector2(320, 0), AutowrapMode = TextServer.AutowrapMode.WordSmart };
        h.AddChild(_hint);
        _end = new Button { Text = "End Turn", CustomMinimumSize = new Vector2(140, 40) };
        _end.Pressed += () => _root.Submit(new EndTurnCommand());
        h.AddChild(_end);
        var save = new Button { Text = "Save (F5)" };
        save.Pressed += _root.QuickSave;
        h.AddChild(save);
        var load = new Button { Text = "Load (F9)" };
        load.Pressed += _root.QuickLoad;
        h.AddChild(load);
    }

    public void Refresh()
    {
        var s = _root.State;
        if (s == null) return;
        var p = s.Players[_root.LocalPlayer];
        var todo = new List<string>();
        if (!s.Cities.Any(c => c.Owner == p.Id) && s.Units.Any(u => u.Owner == p.Id && s.Db.Units[u.DefIndex].FoundsCity))
            todo.Add("Found your first city: select the Settler and press B");
        if (p.CurrentTech < 0 && s.Db.Techs.Any(t => ResearchSystem.CanResearch(p, t))) todo.Add("Choose research (T)");
        if (p.CurrentCivic < 0 && s.Db.Civics.Any(c => ResearchSystem.CanStudy(p, c))) todo.Add("Choose a civic (T)");
        int idle = s.CitiesOf(p.Id).Count(c => c.Queue.Items.Count == 0);
        if (idle > 0) todo.Add($"{idle} {(idle == 1 ? "city needs" : "cities need")} production (click the city)");
        _hint.Text = p.HasEndedTurn ? $"Waiting… {TurnPhases.Describe(s)}" : todo.Count > 0 ? string.Join("\n", todo) : "Ready.";
        _end.Disabled = p.HasEndedTurn || s.Victory.AwaitingChoice;
        _end.Text = p.HasEndedTurn ? "Waiting" : "End Turn";
    }
}
