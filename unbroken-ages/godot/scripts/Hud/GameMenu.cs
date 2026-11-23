using Godot;
using UnbrokenAges.Client.UI;

namespace UnbrokenAges.Client.Hud;

/// <summary>Pause menu (Esc): resume, save, load, music / effects / ambience volume, quit. Volumes are remembered per machine.</summary>
public partial class GameMenu : PanelContainer
{
    private readonly GameRoot _root;
    public GameMenu(GameRoot root) => _root = root;

    public override void _Ready()
    {
        SetAnchorsAndOffsetsPreset(LayoutPreset.Center);
        CustomMinimumSize = new Vector2(380, 0);
        GrowHorizontal = GrowDirection.Both;
        GrowVertical = GrowDirection.Both;
        var v = new VBoxContainer();
        v.AddThemeConstantOverride("separation", 10);
        AddChild(v);
        v.AddChild(new Label { Text = "UNBROKEN AGES", ThemeTypeVariation = "HeaderLarge", HorizontalAlignment = HorizontalAlignment.Center });
        v.AddChild(new HSeparator());
        Add(v, "Resume", () => Visible = false);
        Add(v, "Quick save (F5)", () => { _root.QuickSave(); Visible = false; });
        Add(v, "Quick load (F9)", () => { _root.QuickLoad(); Visible = false; });
        v.AddChild(new HSeparator());
        foreach (var bus in new[] { "Music", "SFX", "Ambience" })
        {
            int index = AudioServer.GetBusIndex(bus);
            if (index < 0) continue;
            var row = new HBoxContainer();
            row.AddChild(new Label { Text = bus == "SFX" ? "Effects" : bus, CustomMinimumSize = new Vector2(110, 0) });
            var slider = new HSlider { MinValue = 0, MaxValue = 1, Step = 0.05, Value = Mathf.DbToLinear(AudioServer.GetBusVolumeDb(index)), SizeFlagsHorizontal = SizeFlags.ExpandFill, CustomMinimumSize = new Vector2(0, 24) };
            slider.ValueChanged += value => { AudioServer.SetBusVolumeDb(index, Mathf.LinearToDb((float)Math.Max(0.0001, value))); Audio.AudioManager.SaveVolumes(); };
            row.AddChild(slider);
            v.AddChild(row);
        }
        v.AddChild(new HSeparator());
        Add(v, "Quit to desktop", () => GetTree().Quit());
        Visible = false;
    }

    private static void Add(VBoxContainer v, string text, Action action)
    {
        var b = new Button { Text = text, CustomMinimumSize = new Vector2(0, 36) };
        b.Pressed += action;
        v.AddChild(b);
    }
}
