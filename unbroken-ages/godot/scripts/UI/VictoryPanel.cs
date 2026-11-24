using Godot;
using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.UI;

/// <summary>
/// Victory screen: appears when a civilization wins (the game accepts only One More Turn until someone chooses it). Shows the
/// headline, the winner's Chronicle line, and every civilization's itemized score. "One More Turn" keeps playing; no second
/// victory is awarded. Also tells an eliminated player so, plainly. Wireframe: docs/06-ui-ux-wireframes.md §7d.
/// </summary>
public partial class VictoryPanel : PanelContainer
{
    private readonly GameRoot _root;
    private Label _headline = null!, _scores = null!;
    private Button _continue = null!;

    public VictoryPanel(GameRoot root) => _root = root;

    public override void _Ready()
    {
        SetAnchorsAndOffsetsPreset(LayoutPreset.Center);
        CustomMinimumSize = new Vector2(640, 420);
        var v = new VBoxContainer();
        AddChild(v);
        _headline = new Label { ThemeTypeVariation = "HeaderLarge", AutowrapMode = TextServer.AutowrapMode.WordSmart };
        v.AddChild(_headline);
        _scores = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart, SizeFlagsVertical = SizeFlags.ExpandFill };
        v.AddChild(_scores);
        _continue = new Button { Text = "One More Turn" };
        _continue.Pressed += () => { _root.Submit(new OneMoreTurnCommand()); Visible = false; };
        v.AddChild(_continue);
        Visible = false;
    }

    /// <summary>Called every frame by GameRoot: opens itself when the game is won and the choice is pending.</summary>
    public void Watch()
    {
        var s = _root.State;
        if (s == null) return;
        bool eliminated = !s.Players[_root.LocalPlayer].IsAlive;
        if (!s.Victory.AwaitingChoice && !eliminated) { Visible = false; return; }
        if (Visible) return;
        Visible = true;
        _headline.Text = s.Victory.Decided
            ? (s.Victory.Winner == _root.LocalPlayer || DiplomacySystem.SameTeam(s, s.Victory.Winner, _root.LocalPlayer) ? "VICTORY\n" : "DEFEAT\n") + VictorySystem.Headline(s)
            : "Your civilization has fallen.";
        var lines = s.Players.Where(p => p.IsMajor).OrderByDescending(p => VictorySystem.Score(s, p.Id)).Select(p =>
            $"{p.Name}: {VictorySystem.Score(s, p.Id)}  (" +
            string.Join(", ", VictorySystem.ScoreLines(s, p.Id).Where(l => l.Points != 0).Select(l => $"{l.Label} {l.Points}")) + ")");
        string story = s.Chronicle.LastOrDefault(c => c.Kind == UnbrokenAges.Sim.State.GameEventType.VictoryAchieved)?.Text ?? "";
        _scores.Text = story + "\n\n" + string.Join("\n", lines);
        _continue.Visible = s.Victory.AwaitingChoice && !eliminated;
    }
}
