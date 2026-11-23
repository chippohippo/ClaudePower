using Godot;
using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.UI;

/// <summary>
/// Research and civics (T): what you are studying, and every technology and civic available now, with its cost and the
/// turns it would take at your current rate. Click to choose. The tree graph comes later; this list is enough to play.
/// Divergence doctrines are chosen on the Divergence screen (V), because they lock the other branches.
/// </summary>
public partial class ResearchPanel : PanelContainer
{
    private readonly GameRoot _root;
    private Label _current = null!;
    private VBoxContainer _techs = null!, _civics = null!;

    public ResearchPanel(GameRoot root) => _root = root;

    public override void _Ready()
    {
        SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        OffsetLeft = 80; OffsetTop = 70; OffsetRight = -420; OffsetBottom = -90;
        var v = new VBoxContainer();
        AddChild(v);
        v.AddChild(new Label { Text = "RESEARCH AND CIVICS", ThemeTypeVariation = "HeaderLarge" });
        _current = new Label();
        v.AddChild(_current);
        var columns = new HBoxContainer { SizeFlagsVertical = SizeFlags.ExpandFill };
        v.AddChild(columns);
        _techs = Column(columns, "TECHNOLOGIES");
        _civics = Column(columns, "CIVICS");
        var close = new Button { Text = "Close (T)" };
        close.Pressed += () => Visible = false;
        v.AddChild(close);
        Visible = false;
    }

    private static VBoxContainer Column(HBoxContainer parent, string title)
    {
        var box = new VBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        parent.AddChild(box);
        box.AddChild(new Label { Text = title });
        var scroll = new ScrollContainer { SizeFlagsVertical = SizeFlags.ExpandFill };
        box.AddChild(scroll);
        var list = new VBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        scroll.AddChild(list);
        return list;
    }

    public void Refresh()
    {
        var s = _root.State;
        if (s == null) return;
        var p = s.Players[_root.LocalPlayer];
        var (science, culture) = ResearchSystem.Rates(s, p.Id);
        string tech = p.CurrentTech >= 0 ? $"{s.Db.Techs[p.CurrentTech].Name} ({p.TechProgress.FloorToInt()}/{ResearchSystem.Cost(s, p, s.Db.Techs[p.CurrentTech]).FloorToInt()})" : "nothing: choose a technology";
        string civic = p.CurrentCivic >= 0 ? $"{s.Db.Civics[p.CurrentCivic].Name} ({p.CivicProgress.FloorToInt()}/{ResearchSystem.Cost(s, p, s.Db.Civics[p.CurrentCivic]).FloorToInt()})" : "nothing: choose a civic";
        _current.Text = $"Researching {tech} at {science} science/turn · Studying {civic} at {culture} culture/turn";

        foreach (var c in _techs.GetChildren()) c.QueueFree();
        foreach (var t in s.Db.Techs.Where(t => ResearchSystem.CanResearch(p, t) && !t.Doctrine).OrderBy(t => t.Cost).ThenBy(t => t.Index))
        {
            int cost = ResearchSystem.Cost(s, p, t).FloorToInt();
            Add(_techs, $"{t.Name}  ·  {cost}  ·  {Turns(cost, science)}", t.Index == p.CurrentTech, t.Boost,
                new SetResearchCommand { Tech = t.Index });
        }
        foreach (var c in _civics.GetChildren()) c.QueueFree();
        foreach (var c in s.Db.Civics.Where(c => ResearchSystem.CanStudy(p, c)).OrderBy(c => c.Cost).ThenBy(c => c.Index))
        {
            int cost = ResearchSystem.Cost(s, p, c).FloorToInt();
            Add(_civics, $"{c.Name}  ·  {cost}  ·  {Turns(cost, culture)}" + (c.GovernorTitles > 0 ? "  ·  +governor title" : ""), c.Index == p.CurrentCivic, c.Boost,
                new SetCivicCommand { Civic = c.Index });
        }
    }

    private static string Turns(int cost, int rate) => rate <= 0 ? "—" : $"{(cost + rate - 1) / rate} turns";

    private void Add(VBoxContainer list, string text, bool current, string? boost, GameCommand cmd)
    {
        var b = new Button { Text = (current ? "▶ " : "") + text, Alignment = HorizontalAlignment.Left, TooltipText = boost ?? "" };
        b.Pressed += () => { _root.Submit(cmd); Refresh(); };
        list.AddChild(b);
    }

    public override void _UnhandledInput(InputEvent @event)
    {
        if (@event is InputEventKey { Pressed: true, Keycode: Key.T })
        {
            Visible = !Visible;
            if (Visible) { _root.CloseOverlaysExcept(this); Refresh(); }
        }
    }
}
