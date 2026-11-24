using Godot;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.UI;

/// <summary>
/// Notification feed (left, under the research trackers): what just happened to you or the world, as cards with a coloured edge
/// by kind (war red, science blue, culture violet, faith pale, building orange, the rest gold), newest on top. Cards fade after
/// a while so the map stays clear; the Chronicle (C) keeps the whole history.
/// </summary>
public partial class NotificationFeed : VBoxContainer
{
    private readonly GameRoot _root;
    private const int MaxCards = 5;
    private const double Lifetime = 14;

    public NotificationFeed(GameRoot root) => _root = root;

    public override void _Ready()
    {
        Position = new Vector2(12, 152);
        CustomMinimumSize = new Vector2(330, 0);
        MouseFilter = MouseFilterEnum.Ignore;
        AddThemeConstantOverride("separation", 5);
    }

    public void Add(GameState s, IEnumerable<GameEvent> events)
    {
        foreach (var e in events)
            if (EventText.Describe(s, e, _root.LocalPlayer) is { Length: > 0 } line && !line.StartsWith("—"))
                Card(line, Tone(e.Type, e.Player == _root.LocalPlayer || e.Value == _root.LocalPlayer));
    }

    /// <summary>A client-side message (saved, loaded, refused command).</summary>
    public void Note(string line) => Card(line, line.StartsWith("⚠") ? UiTheme.Danger : UiTheme.TextDim);

    private static Color Tone(GameEventType type, bool aboutMe) => type switch
    {
        GameEventType.WarDeclared or GameEventType.CityCaptured or GameEventType.UnitDestroyed or GameEventType.BattleFought or GameEventType.PlayerEliminated
            or GameEventType.CityFlipped or GameEventType.CityDeclaredIndependence => UiTheme.Danger,
        GameEventType.TechResearched => UiTheme.Science,
        GameEventType.CivicCompleted => UiTheme.Culture,
        GameEventType.ProductionCompleted or GameEventType.ImprovementBuilt => UiTheme.Production,
        GameEventType.PeaceSigned => UiTheme.Food,
        _ => aboutMe ? UiTheme.GoldBright : UiTheme.Gold,
    };

    private void Card(string text, Color tone)
    {
        var card = new PanelContainer { MouseFilter = MouseFilterEnum.Ignore };
        var box = UiTheme.Box(new Color("#0e1a2be0"), new Color(tone, 0.55f), 1, 6, 8);
        box.BorderWidthLeft = 4;
        box.BorderColor = new Color(tone, 0.9f);
        card.AddThemeStyleboxOverride("panel", box);
        var label = new Label { Text = text, AutowrapMode = TextServer.AutowrapMode.WordSmart, CustomMinimumSize = new Vector2(310, 0), MouseFilter = MouseFilterEnum.Ignore, ThemeTypeVariation = "Caption" };
        card.AddChild(label);
        AddChild(card);
        MoveChild(card, 0);   // newest on top
        while (GetChildCount() > MaxCards) { var old = GetChild(GetChildCount() - 1); RemoveChild(old); old.QueueFree(); }
        card.Modulate = new Color(1, 1, 1, 0);
        var tween = card.CreateTween();
        tween.TweenProperty(card, "modulate:a", 1f, 0.25f);
        tween.TweenInterval(Lifetime);
        tween.TweenProperty(card, "modulate:a", 0f, 1.2f);
        tween.TweenCallback(Callable.From(() => { if (IsInstanceValid(card)) card.QueueFree(); }));
    }
}
