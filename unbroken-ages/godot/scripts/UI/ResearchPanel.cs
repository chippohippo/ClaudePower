using Godot;
using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.UI;

/// <summary>
/// Research and civics (T): the two trees as maps of the ages. Era columns run left to right; each node is a card with its
/// name, cost and turns, a progress bar and what it unlocks; lines join every node to its prerequisites. Researched nodes are
/// gold, the one in progress glows, available ones are blue and the rest are dimmed. Click an available node to study it;
/// click a locked one to plan a path to it (its missing prerequisites first, in order), which the game follows turn by turn.
/// Divergence doctrines are chosen on the Divergence screen (V), because they lock the other branches.
/// </summary>
public partial class ResearchPanel : PanelContainer
{
    private readonly GameRoot _root;
    private Label _current = null!;
    private TreeView _techs = null!, _civics = null!;
    private TabContainer _tabs = null!;

    public ResearchPanel(GameRoot root) => _root = root;

    public override void _Ready()
    {
        SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        OffsetLeft = 40; OffsetTop = 56; OffsetRight = -40; OffsetBottom = -40;
        AddThemeStyleboxOverride("panel", UiTheme.Box(new Color("#0b1626f5"), UiTheme.Gold, 2, 10, 16));
        var v = new VBoxContainer();
        v.AddThemeConstantOverride("separation", 8);
        AddChild(v);
        var head = new HBoxContainer();
        head.AddChild(new Label { Text = "RESEARCH AND CIVICS", ThemeTypeVariation = "HeaderLarge", SizeFlagsHorizontal = SizeFlags.ExpandFill });
        var close = new Button { Text = "Close (T)" };
        close.Pressed += () => Visible = false;
        head.AddChild(close);
        v.AddChild(head);
        _current = new Label { ThemeTypeVariation = "Caption" };
        v.AddChild(_current);
        _tabs = new TabContainer { SizeFlagsVertical = SizeFlags.ExpandFill };
        v.AddChild(_tabs);
        _techs = new TreeView(_root, civics: false) { Name = "Technologies" };
        _civics = new TreeView(_root, civics: true) { Name = "Civics" };
        _techs.Changed = Refresh;
        _civics.Changed = Refresh;
        _tabs.AddChild(Scroll(_techs, "Technologies"));
        _tabs.AddChild(Scroll(_civics, "Civics"));
        var legend = new HBoxContainer();
        legend.AddThemeConstantOverride("separation", 18);
        foreach (var (text, color) in new[] { ("Researched", TreeView.Done), ("In progress", TreeView.Active), ("Available: click to study", TreeView.Open), ("Locked: click to plan a path", TreeView.Locked) })
        {
            var swatch = new ColorRect { Color = color, CustomMinimumSize = new Vector2(14, 14), SizeFlagsVertical = SizeFlags.ShrinkCenter };
            legend.AddChild(swatch);
            legend.AddChild(new Label { Text = text, ThemeTypeVariation = "Caption" });
        }
        v.AddChild(legend);
        Visible = false;
    }

    private static ScrollContainer Scroll(TreeView tree, string name)
    {
        var scroll = new ScrollContainer { Name = name, SizeFlagsVertical = SizeFlags.ExpandFill, HorizontalScrollMode = ScrollContainer.ScrollMode.Auto };
        scroll.AddChild(tree);
        return scroll;
    }

    public void Refresh()
    {
        var s = _root.State;
        if (s == null) return;
        var p = s.Players[_root.LocalPlayer];
        var (science, culture) = ResearchSystem.Rates(s, p.Id);
        string tech = p.CurrentTech >= 0 ? $"{s.Db.Techs[p.CurrentTech].Name} ({p.TechProgress.FloorToInt()}/{ResearchSystem.Cost(s, p, s.Db.Techs[p.CurrentTech]).FloorToInt()})" : "nothing: choose a technology";
        string civic = p.CurrentCivic >= 0 ? $"{s.Db.Civics[p.CurrentCivic].Name} ({p.CivicProgress.FloorToInt()}/{ResearchSystem.Cost(s, p, s.Db.Civics[p.CurrentCivic]).FloorToInt()})" : "nothing: choose a civic";
        string path(List<int> plan, bool civics) => plan.Count == 0 ? "" : "  ·  then " + string.Join(" → ", plan.Select(i => civics ? s.Db.Civics[i].Name : s.Db.Techs[i].Name));
        _current.Text = $"Researching {tech} at {science} science/turn{path(_root.TechPath, false)}\nStudying {civic} at {culture} culture/turn{path(_root.CivicPath, true)}";
        _techs.Rebuild(s, p);
        _civics.Rebuild(s, p);
    }

    /// <summary>What a technology (or civic) opens: your own units (your unique in place of the generic it replaces),
    /// districts, buildings, wonders and improvements.</summary>
    public static List<string> Unlocks(GameState s, PlayerState p, int tech, int civic)
    {
        var db = s.Db;
        bool Opens(int techIndex, int civicIndex) => tech >= 0 ? techIndex == tech : civicIndex == civic;
        var names = new List<string>();
        foreach (var u in db.Units)
        {
            if (!Opens(u.PrereqTechIndex, u.PrereqCivicIndex)) continue;
            if (u.CivilizationIndex >= 0 && u.CivilizationIndex != p.CivIndex) continue;
            if (u.CivilizationIndex < 0 && db.Units.Any(x => x.ReplacesIndex == u.Index && x.CivilizationIndex == p.CivIndex)) continue;
            names.Add(u.Name);
        }
        bool MineD(DistrictDef d) => d.CivilizationIndex < 0 ? !db.Districts.Any(x => x.ReplacesIndex == d.Index && x.CivilizationIndex == p.CivIndex) : d.CivilizationIndex == p.CivIndex;
        bool MineB(BuildingDef b) => b.CivilizationIndex < 0 ? !db.Buildings.Any(x => x.ReplacesIndex == b.Index && x.CivilizationIndex == p.CivIndex) : b.CivilizationIndex == p.CivIndex;
        names.AddRange(db.Districts.Where(d => Opens(d.PrereqTechIndex, d.PrereqCivicIndex) && d.Model == null && MineD(d)).Select(d => d.Name));
        names.AddRange(db.Buildings.Where(b => Opens(b.PrereqTechIndex, b.PrereqCivicIndex) && MineB(b)).Select(b => b.Name));
        names.AddRange(db.Districts.Where(d => Opens(d.PrereqTechIndex, d.PrereqCivicIndex) && d.Model != null).Select(d => d.Name));
        if (tech >= 0) names.AddRange(db.Improvements.Where(i => i.PrereqTechIndex == tech).Select(i => i.Name));
        if (civic >= 0) names.AddRange(db.Governments.Where(g => g.PrereqCivic == db.Civics[civic].Id).Select(g => g.Name));
        return names.Distinct().ToList();
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

/// <summary>One tree (technologies or civics) laid out by era, drawn with its prerequisite lines.</summary>
public partial class TreeView : Control
{
    public static readonly Color Done = new("#c9a45c"), Active = new("#5fd0ff"), Open = new("#3f7fc0"), Locked = new("#3a4554");
    private const float ColumnWidth = 270, NodeWidth = 230, NodeHeight = 74, RowHeight = 90, Top = 44;

    private readonly GameRoot _root;
    private readonly bool _civics;
    private readonly Dictionary<int, Rect2> _rects = new();
    private readonly List<(int From, int To, bool Lit)> _links = new();
    private readonly List<(string Name, float X)> _eras = new();

    public TreeView(GameRoot root, bool civics) { _root = root; _civics = civics; }

    /// <summary>Raised when a click changed what is being studied (the panel refreshes).</summary>
    public Action? Changed;

    public void Rebuild(GameState s, PlayerState p)
    {
        foreach (var c in GetChildren()) c.QueueFree();
        _rects.Clear(); _links.Clear(); _eras.Clear();
        var db = s.Db;
        IReadOnlyList<ProgressNodeDef> all = _civics ? db.Civics.Cast<ProgressNodeDef>().ToList() : db.Techs.Cast<ProgressNodeDef>().ToList();
        var nodes = all.Where(n => !n.Doctrine && (n.DivergenceIndex < 0 || n.DivergenceIndex == p.Divergence)).ToList();
        // Columns by depth (one step further than the deepest prerequisite), so every line runs left to right.
        var byIndex = nodes.ToDictionary(n => n.Index);
        var depth = new Dictionary<int, int>();
        int Depth(ProgressNodeDef n) => depth.TryGetValue(n.Index, out var d) ? d
            : depth[n.Index] = n.PrereqIndices.Where(byIndex.ContainsKey).Select(i => Depth(byIndex[i]) + 1).DefaultIfEmpty(0).Max();
        var columns = nodes.GroupBy(Depth).OrderBy(g => g.Key).ToList();
        var row = new Dictionary<int, float>();
        for (int col = 0; col < columns.Count; col++)
        {
            // Rows by the barycentre of each node's prerequisites, so lines run as straight as they can.
            var ordered = columns[col].OrderBy(n => n.PrereqIndices.Where(row.ContainsKey).Select(i => row[i]).DefaultIfEmpty(99).Average()).ThenBy(n => n.Cost).ThenBy(n => n.Index).ToList();
            var eras = ordered.Select(n => db.Eras[n.EraIndex]).Distinct().OrderBy(e => e.Order).ToList();
            string Short(string era) => era.Replace(" Era", "").Replace(" era", "");
            _eras.Add((eras.Count == 1 ? eras[0].Name : $"{Short(eras[0].Name)} – {Short(eras[^1].Name)}", col * ColumnWidth));
            for (int r = 0; r < ordered.Count; r++)
            {
                row[ordered[r].Index] = r;
                _rects[ordered[r].Index] = new Rect2(col * ColumnWidth + 16, Top + r * RowHeight, NodeWidth, NodeHeight);
            }
        }
        int current = _civics ? p.CurrentCivic : p.CurrentTech;
        var plan = _civics ? _root.CivicPath : _root.TechPath;
        foreach (var n in nodes)
        {
            bool done = _civics ? p.Civics[n.Index] : p.Techs[n.Index];
            foreach (int pre in n.PrereqIndices.Where(_rects.ContainsKey))
                _links.Add((pre, n.Index, _civics ? p.Civics[pre] : p.Techs[pre]));
            bool open = !done && (_civics ? ResearchSystem.CanStudy(p, (CivicDef)n) : ResearchSystem.CanResearch(p, (TechDef)n));
            AddChild(Card(s, p, n, done, n.Index == current, open, plan.IndexOf(n.Index)));
        }
        float width = columns.Count * ColumnWidth + 20;
        float height = Top + (columns.Count == 0 ? 0 : columns.Max(c => c.Count())) * RowHeight + 10;
        CustomMinimumSize = new Vector2(width, height);
        QueueRedraw();
    }

    private Control Card(GameState s, PlayerState p, ProgressNodeDef n, bool done, bool active, bool open, int planned)
    {
        var rect = _rects[n.Index];
        var color = done ? Done : active ? Active : open ? Open : Locked;
        var card = new PanelContainer { Position = rect.Position, Size = rect.Size, CustomMinimumSize = rect.Size, MouseDefaultCursorShape = done ? CursorShape.Arrow : CursorShape.PointingHand };
        var bg = done ? new Color("#2a2414") : active ? new Color("#0f2d44") : open ? new Color("#12233a") : new Color("#141a22");
        card.AddThemeStyleboxOverride("panel", UiTheme.Box(bg, color, active ? 3 : 2, 8, 6));
        var cost = ResearchSystem.Cost(s, p, n).FloorToInt();
        var (science, culture) = ResearchSystem.Rates(s, p.Id);
        int rate = _civics ? culture : science;
        var unlocks = ResearchPanel.Unlocks(s, p, _civics ? -1 : n.Index, _civics ? n.Index : -1);
        card.TooltipText = $"{n.Name}\nCost {cost}" + (n.Boost != null ? $"\nBoost: {n.Boost}" : "") + (unlocks.Count > 0 ? "\nUnlocks: " + string.Join(", ", unlocks) : "") + (n.Quote != null ? $"\n\n{n.Quote}" : "");
        var v = new VBoxContainer { MouseFilter = MouseFilterEnum.Ignore };
        v.AddThemeConstantOverride("separation", 1);
        card.AddChild(v);
        var top = new HBoxContainer { MouseFilter = MouseFilterEnum.Ignore };
        var name = new Label { Text = (planned >= 0 ? $"{planned + 1}. " : "") + n.Name, ClipText = true, SizeFlagsHorizontal = SizeFlags.ExpandFill, MouseFilter = MouseFilterEnum.Ignore };
        name.AddThemeColorOverride("font_color", done ? UiTheme.GoldBright : open || active ? UiTheme.Text : UiTheme.TextDim);
        top.AddChild(name);
        top.AddChild(new Label { Text = done ? "✓" : rate > 0 ? $"{(cost + rate - 1) / rate}t" : "—", ThemeTypeVariation = "Caption", MouseFilter = MouseFilterEnum.Ignore });
        v.AddChild(top);
        var detail = new Label { Text = unlocks.Count == 0 ? (n.Boost ?? "") : string.Join(", ", unlocks), ThemeTypeVariation = "Caption", ClipText = true, MouseFilter = MouseFilterEnum.Ignore };
        detail.AddThemeFontSizeOverride("font_size", 13);
        v.AddChild(detail);
        var bar = new ProgressBar { ShowPercentage = false, CustomMinimumSize = new Vector2(0, 5), MaxValue = Math.Max(1, cost), MouseFilter = MouseFilterEnum.Ignore,
                                    Value = done ? cost : active ? (_civics ? p.CivicProgress : p.TechProgress).FloorToInt() : 0 };
        bar.AddThemeStyleboxOverride("fill", UiTheme.Box(color, color, 0, 2, 0));
        v.AddChild(bar);
        if (!done)
            card.GuiInput += e =>
            {
                if (e is not InputEventMouseButton { Pressed: true, ButtonIndex: MouseButton.Left }) return;
                _root.PlanResearch(n.Index, _civics);
                Changed?.Invoke();
            };
        return card;
    }

    public override void _Draw()
    {
        foreach (var (name, x) in _eras)
        {
            DrawRect(new Rect2(x + 6, 4, ColumnWidth - 12, 28), new Color(UiTheme.Gold, 0.12f));
            DrawString(ThemeDB.FallbackFont, new Vector2(x + 16, 24), name.ToUpperInvariant(), HorizontalAlignment.Left, -1, 15, UiTheme.Gold);
            if (x > 0) DrawLine(new Vector2(x + 2, 36), new Vector2(x + 2, Size.Y), new Color(UiTheme.Gold, 0.15f), 1);
        }
        foreach (var (from, to, lit) in _links)
        {
            var a = _rects[from]; var b = _rects[to];
            var start = new Vector2(a.End.X, a.Position.Y + a.Size.Y / 2);
            var end = new Vector2(b.Position.X, b.Position.Y + b.Size.Y / 2);
            float mid = (start.X + end.X) / 2;
            var color = lit ? new Color(Done, 0.85f) : new Color(0.45f, 0.55f, 0.68f, 0.55f);
            // A rounded elbow: out, across, in.
            var points = new List<Vector2>();
            for (int i = 0; i <= 12; i++)
            {
                float t = i / 12f;
                var p0 = start; var p1 = new Vector2(mid, start.Y); var p2 = new Vector2(mid, end.Y); var p3 = end;
                float u = 1 - t;
                points.Add(u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3);
            }
            DrawPolyline(points.ToArray(), color, lit ? 3 : 2, true);
        }
    }
}
