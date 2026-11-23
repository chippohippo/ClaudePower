using Godot;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.UI;

/// <summary>
/// The Chronicle (C): your civilization's auto-written history plus the world's ages, newest first.
/// Exported at game end beside the timelapse. Wireframe: docs/06-ui-ux-wireframes.md §7b.
/// </summary>
public partial class ChroniclePanel : PanelContainer
{
    private readonly GameRoot _root;
    private RichTextLabel _text = null!;
    private CheckBox _everyone = null!;

    public ChroniclePanel(GameRoot root) => _root = root;

    public override void _Ready()
    {
        SetAnchorsAndOffsetsPreset(LayoutPreset.LeftWide);
        CustomMinimumSize = new Vector2(520, 0);
        var v = new VBoxContainer();
        AddChild(v);
        v.AddChild(new Label { Text = "THE CHRONICLE", ThemeTypeVariation = "HeaderLarge" });
        _everyone = new CheckBox { Text = "Include other civilizations (as far as you know)" };
        _everyone.Toggled += _ => Refresh();
        v.AddChild(_everyone);
        _text = new RichTextLabel { BbcodeEnabled = true, SizeFlagsVertical = SizeFlags.ExpandFill, ScrollFollowing = false };
        v.AddChild(_text);
    }

    public void Refresh()
    {
        var s = _root.State;
        if (s == null) return;
        var entries = _everyone.ButtonPressed ? s.Chronicle : ChronicleSystem.Of(s, _root.LocalPlayer).ToList();
        _text.Text = string.Join("\n", entries.AsEnumerable().Reverse().Select(e =>
            e.Player < 0 ? $"[i][color=#9fb3c8]{e.Text}[/color][/i]" : e.Player == _root.LocalPlayer ? $"[b]{e.Text}[/b]" : e.Text));
    }

    public override void _UnhandledInput(InputEvent @event)
    {
        if (@event is InputEventKey { Pressed: true, Keycode: Key.C })
        {
            Visible = !Visible;
            if (Visible) { _root.CloseOverlaysExcept(this); Refresh(); }
        }
    }
}
