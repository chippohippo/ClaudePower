using Godot;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.UI;

/// <summary>Notification feed (left, under the status line): the last few things that happened to you or the world, newest first.</summary>
public partial class NotificationFeed : PanelContainer
{
    private readonly GameRoot _root;
    private readonly List<string> _lines = new();
    private Label _text = null!;

    public NotificationFeed(GameRoot root) => _root = root;

    public override void _Ready()
    {
        Position = new Vector2(12, 152);
        CustomMinimumSize = new Vector2(330, 0);
        MouseFilter = MouseFilterEnum.Ignore;
        SelfModulate = new Color(1, 1, 1, 0.8f);
        _text = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart, CustomMinimumSize = new Vector2(330, 0), MouseFilter = MouseFilterEnum.Ignore, ThemeTypeVariation = "Caption" };
        AddChild(_text);
        Visible = false;
    }

    public void Add(GameState s, IEnumerable<GameEvent> events)
    {
        foreach (var e in events)
            if (EventText.Describe(s, e, _root.LocalPlayer) is { Length: > 0 } line) _lines.Add(line);
        Show();
    }

    /// <summary>A client-side message (saved, loaded, refused command).</summary>
    public void Note(string line)
    {
        _lines.Add(line);
        Show();
    }

    private new void Show()
    {
        if (_lines.Count > 60) _lines.RemoveRange(0, _lines.Count - 60);
        _text.Text = string.Join("\n", _lines.Where(l => !l.StartsWith("—")).TakeLast(6).AsEnumerable().Reverse());
        Visible = _lines.Count > 0;
    }
}
