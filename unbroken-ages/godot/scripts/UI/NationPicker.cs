using Godot;
using UnbrokenAges.Sim.Data;

namespace UnbrokenAges.Client.UI;

/// <summary>
/// Choose your nation and leader (lobby). Each nation card shows its colours and signature; below it the nation's leaders,
/// and a dossier that says plainly how the choice changes the game: the signature rule and the way to play it, the nation's
/// ability and unique units, and how the chosen leader bends the signature (their augment).
/// </summary>
public partial class NationPicker : VBoxContainer
{
    private readonly GameDatabase _db;
    private readonly List<Button> _nationButtons = new();
    private readonly HBoxContainer _leaders = new();
    private readonly RichTextLabel _dossier = new()
    {
        BbcodeEnabled = true, FitContent = false, ScrollActive = true, SizeFlagsVertical = SizeFlags.ExpandFill,
        CustomMinimumSize = new Vector2(0, 250),
    };
    private int _nation;

    /// <summary>The chosen leader's id (the nation follows from it).</summary>
    public string SelectedLeader { get; private set; } = "";

    public NationPicker(GameDatabase db) => _db = db;

    public override void _Ready()
    {
        AddThemeConstantOverride("separation", 8);
        var title = new Label { Text = "CHOOSE YOUR NATION" };
        title.AddThemeColorOverride("font_color", UiTheme.GoldBright);
        title.AddThemeFontSizeOverride("font_size", 18);
        AddChild(title);
        AddChild(new Label { Text = $"{_db.Civilizations.Count} nations, each playing one rule of the game differently. Hover a card for how it plays.", ThemeTypeVariation = "Caption", AutowrapMode = TextServer.AutowrapMode.WordSmart });

        // Thirty-six nations: a compact, scrollable grid of cards.
        var scroll = new ScrollContainer { CustomMinimumSize = new Vector2(0, 196), HorizontalScrollMode = ScrollContainer.ScrollMode.Disabled };
        AddChild(scroll);
        var grid = new GridContainer { Columns = 4, SizeFlagsHorizontal = SizeFlags.ExpandFill };
        grid.AddThemeConstantOverride("h_separation", 6);
        grid.AddThemeConstantOverride("v_separation", 6);
        scroll.AddChild(grid);
        foreach (var civ in _db.Civilizations)
        {
            int index = civ.Index;
            var b = new Button
            {
                Text = $"{civ.Name}\n{civ.Signature.Name}", ToggleMode = true, CustomMinimumSize = new Vector2(120, 46),
                ClipText = true,
                SizeFlagsHorizontal = SizeFlags.ExpandFill, TooltipText = civ.Signature.Playstyle ?? "",
            };
            Style(b, civ);
            b.Pressed += () => SelectNation(index);
            grid.AddChild(b);
            _nationButtons.Add(b);
        }

        var leadersLabel = new Label { Text = "LEADER", ThemeTypeVariation = "Caption" };
        AddChild(leadersLabel);
        _leaders.AddThemeConstantOverride("separation", 8);
        AddChild(_leaders);

        var frame = new PanelContainer { SizeFlagsVertical = SizeFlags.ExpandFill };
        frame.AddThemeStyleboxOverride("panel", UiTheme.Box(new Color("#0a1320"), new Color(UiTheme.Gold, 0.5f), 1, 8, 12));
        frame.AddChild(_dossier);
        AddChild(frame);

        if (_db.Civilizations.Count > 0) SelectNation(0);
    }

    private static void Style(Button b, CivilizationDef civ)
    {
        var primary = new Color(civ.Colors.Primary);
        var secondary = new Color(civ.Colors.Secondary);
        var normal = UiTheme.Box(primary.Darkened(0.62f), primary.Darkened(0.2f), 2, 8, 8);
        var hover = UiTheme.Box(primary.Darkened(0.5f), primary, 2, 8, 8);
        var pressed = UiTheme.Box(primary.Darkened(0.35f), UiTheme.GoldBright, 3, 8, 8);
        normal.BorderWidthLeft = hover.BorderWidthLeft = pressed.BorderWidthLeft = 8;   // a band of the nation's colour
        normal.BorderColor = primary.Darkened(0.1f);
        b.AddThemeStyleboxOverride("normal", normal);
        b.AddThemeStyleboxOverride("hover", hover);
        b.AddThemeStyleboxOverride("pressed", pressed);
        b.AddThemeStyleboxOverride("hover_pressed", pressed);
        b.AddThemeStyleboxOverride("focus", new StyleBoxEmpty());
        b.AddThemeColorOverride("font_color", primary.Lightened(0.55f));
        b.AddThemeColorOverride("font_pressed_color", Colors.White);
        b.AddThemeColorOverride("font_hover_color", secondary.Lightened(0.6f));
        b.AddThemeFontSizeOverride("font_size", 11);
    }

    private void SelectNation(int index)
    {
        _nation = index;
        for (int i = 0; i < _nationButtons.Count; i++) _nationButtons[i].SetPressedNoSignal(i == index);
        foreach (var c in _leaders.GetChildren()) c.QueueFree();
        var leaders = _db.Leaders.Where(l => l.CivilizationIndex == index).ToList();
        var civ = _db.Civilizations[index];
        foreach (var l in leaders)
        {
            var leader = l;
            var b = new Button
            {
                Text = $"{l.Name}\n{l.Epithet}", ToggleMode = true, SizeFlagsHorizontal = SizeFlags.ExpandFill,
                CustomMinimumSize = new Vector2(0, 48), TooltipText = l.Augment.Description ?? "",
            };
            Style(b, civ);
            b.Pressed += () => SelectLeader(leader);
            _leaders.AddChild(b);
        }
        if (leaders.Count > 0) SelectLeader(leaders[0]);
    }

    private void SelectLeader(LeaderDef leader)
    {
        SelectedLeader = leader.Id;
        foreach (var b in _leaders.GetChildren().OfType<Button>()) b.SetPressedNoSignal(b.Text.StartsWith(leader.Name));
        var civ = _db.Civilizations[_nation];
        string gold = UiTheme.GoldBright.ToHtml(false), dim = UiTheme.TextDim.ToHtml(false), colour = new Color(civ.Colors.Primary).Lightened(0.35f).ToHtml(false);
        var uniques = _db.Units.Where(u => u.CivilizationIndex == civ.Index).ToList();
        string text =
            $"[font_size=22][color=#{colour}]{civ.Name.ToUpperInvariant()}[/color][/font_size]   [color=#{dim}]led by[/color] [color=#ffffff]{leader.Name}[/color], {leader.Epithet}\n\n" +
            $"[color=#{gold}]{civ.Signature.Name}[/color]\n{civ.Signature.Description}\n" +
            $"[color=#{dim}]{civ.Signature.Playstyle}[/color]\n\n" +
            $"[color=#{gold}]{leader.Name}: {leader.Augment.Name}[/color]\n{leader.Augment.Description}\n\n" +
            $"[color=#ffffff]{civ.Ability.Name}[/color] — {civ.Ability.Description}\n" +
            $"[color=#ffffff]{leader.Ability.Name}[/color] — {leader.Ability.Description}\n" +
            (uniques.Count > 0 ? $"[color=#ffffff]Unique units[/color] — {string.Join("; ", uniques.Select(u => $"{u.Name}{(u.ReplacesIndex >= 0 ? $" (replaces {_db.Units[u.ReplacesIndex].Name})" : "")}"))}\n" : "") +
            $"[color=#{dim}]Agenda: {leader.Agenda.Name} — {leader.Agenda.Description}[/color]";
        _dossier.Text = text;
    }

    /// <summary>Leaders for the other seats: every other nation first (in an order the seed shuffles), one leader each.</summary>
    public static List<string> Opponents(GameDatabase db, string mine, int count, ulong seed)
    {
        int myCiv = db.Leaders.IndexOf(mine) is var li and >= 0 ? db.Leaders[li].CivilizationIndex : -1;
        var rng = new Random((int)(seed % int.MaxValue));
        var nations = db.Civilizations.Where(c => c.Index != myCiv).OrderBy(_ => rng.Next()).ToList();
        if (myCiv >= 0) nations.Add(db.Civilizations[myCiv]);   // only once every other nation is seated
        var result = new List<string>();
        for (int i = 0; i < count; i++)
        {
            var civ = nations[i % nations.Count];
            var leaders = db.Leaders.Where(l => l.CivilizationIndex == civ.Index && l.Id != mine).ToList();
            if (leaders.Count == 0) leaders = db.Leaders.Where(l => l.CivilizationIndex == civ.Index).ToList();
            result.Add(leaders[rng.Next(leaders.Count)].Id);
        }
        return result;
    }
}
