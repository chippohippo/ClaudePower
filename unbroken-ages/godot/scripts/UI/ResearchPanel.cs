using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
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
            Add(_techs, $"{t.Name}  ·  {cost}  ·  {Turns(cost, science)}" + Unlocks(s, p, t.Index, -1), t.Index == p.CurrentTech, t.Boost,
                new SetResearchCommand { Tech = t.Index });
        }
        foreach (var c in _civics.GetChildren()) c.QueueFree();
        foreach (var c in s.Db.Civics.Where(c => ResearchSystem.CanStudy(p, c)).OrderBy(c => c.Cost).ThenBy(c => c.Index))
        {
            int cost = ResearchSystem.Cost(s, p, c).FloorToInt();
            Add(_civics, $"{c.Name}  ·  {cost}  ·  {Turns(cost, culture)}" + (c.GovernorTitles > 0 ? "  ·  +governor title" : "") + Unlocks(s, p, -1, c.Index), c.Index == p.CurrentCivic, c.Boost,
                new SetCivicCommand { Civic = c.Index });
        }
    }

    /// <summary>What a technology (or civic) opens, on a second line: your own units (your unique in place of the generic it
    /// replaces), districts, buildings and improvements.</summary>
    private static string Unlocks(GameState s, PlayerState p, int tech, int civic)
    {
        var db = s.Db;
        bool Opens(int techIndex, int civicIndex) => tech >= 0 ? techIndex == tech : civicIndex == civic;
        var names = new List<string>();
        foreach (var u in db.Units)
        {
            if (!Opens(u.PrereqTechIndex, u.PrereqCivicIndex)) continue;
            if (u.CivilizationIndex >= 0 && u.CivilizationIndex != p.CivIndex) continue;                    // others' uniques
            if (u.CivilizationIndex < 0 && db.Units.Any(x => x.ReplacesIndex == u.Index && x.CivilizationIndex == p.CivIndex)) continue;   // replaced by yours
            names.Add(u.Name);
        }
        // The same rule for districts and buildings: your unique in place of the generic, never another nation's.
        bool MineD(DistrictDef d) => d.CivilizationIndex < 0 ? !db.Districts.Any(x => x.ReplacesIndex == d.Index && x.CivilizationIndex == p.CivIndex) : d.CivilizationIndex == p.CivIndex;
        bool MineB(BuildingDef b) => b.CivilizationIndex < 0 ? !db.Buildings.Any(x => x.ReplacesIndex == b.Index && x.CivilizationIndex == p.CivIndex) : b.CivilizationIndex == p.CivIndex;
        names.AddRange(db.Districts.Where(d => Opens(d.PrereqTechIndex, d.PrereqCivicIndex) && d.Model == null && MineD(d)).Select(d => d.Name));
        names.AddRange(db.Buildings.Where(b => Opens(b.PrereqTechIndex, b.PrereqCivicIndex) && MineB(b)).Select(b => b.Name));
        names.AddRange(db.Districts.Where(d => Opens(d.PrereqTechIndex, d.PrereqCivicIndex) && d.Model != null).Select(d => d.Name));   // wonders last
        if (tech >= 0) names.AddRange(db.Improvements.Where(i => i.PrereqTechIndex == tech).Select(i => i.Name));
        return names.Count == 0 ? "" : "\n      " + string.Join(", ", names.Distinct().Take(6)) + (names.Distinct().Count() > 6 ? "…" : "");
    }

    private static string Turns(int cost, int rate) => rate <= 0 ? "—" : $"{(cost + rate - 1) / rate} turns";

    private void Add(VBoxContainer list, string text, bool current, string? boost, GameCommand cmd)
    {
        var b = new Button { Text = (current ? "▶ " : "") + text, Alignment = HorizontalAlignment.Left, TooltipText = boost ?? "", ClipText = true };
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
