using Godot;
using UnbrokenAges.Client.UI;

namespace UnbrokenAges.Client.Hud;

/// <summary>
/// Each new turn is announced like a chapter: the turn and the year, engraved, fade in under the top bar between two gilt
/// rules and fade away again. It never takes input.
/// </summary>
public partial class TurnBanner : Control
{
    private readonly Label _turn = new(), _year = new();
    private readonly ColorRect _left = new(), _right = new();
    private Tween? _tween;

    public override void _Ready()
    {
        MouseFilter = MouseFilterEnum.Ignore;
        SetAnchorsPreset(LayoutPreset.TopWide);
        OffsetTop = 58; OffsetBottom = 130;
        Modulate = new Color(1, 1, 1, 0);
        var gold = new Color(0.96f, 0.84f, 0.55f);
        _turn.AddThemeFontOverride("font", Cinematics.Engraved(700));
        _turn.AddThemeFontSizeOverride("font_size", 34);
        _turn.AddThemeColorOverride("font_color", new Color(1f, 0.96f, 0.86f));
        _turn.AddThemeConstantOverride("outline_size", 8);
        _turn.AddThemeColorOverride("font_outline_color", new Color(0.12f, 0.07f, 0.03f, 0.8f));
        _year.AddThemeFontOverride("font", Cinematics.Italic());
        _year.AddThemeFontSizeOverride("font_size", 22);
        _year.AddThemeColorOverride("font_color", gold);
        _year.AddThemeConstantOverride("outline_size", 6);
        _year.AddThemeColorOverride("font_outline_color", new Color(0.12f, 0.07f, 0.03f, 0.8f));
        foreach (var l in new[] { _turn, _year })
        {
            l.HorizontalAlignment = HorizontalAlignment.Center;
            l.MouseFilter = MouseFilterEnum.Ignore;
            AddChild(l);
        }
        foreach (var r in new[] { _left, _right }) { r.Color = gold; r.MouseFilter = MouseFilterEnum.Ignore; AddChild(r); }
    }

    public void Announce(int turn, string year)
    {
        _turn.Text = $"Turn {turn}";
        _year.Text = year;
        float w = GetViewportRect().Size.X;
        _turn.Position = new Vector2(0, 0); _turn.Size = new Vector2(w, 44);
        _year.Position = new Vector2(0, 40); _year.Size = new Vector2(w, 30);
        _left.Position = new Vector2(w / 2 - 190, 22); _left.Size = new Vector2(110, 1.5f);
        _right.Position = new Vector2(w / 2 + 80, 22); _right.Size = new Vector2(110, 1.5f);
        _tween?.Kill();
        _tween = CreateTween();
        _tween.TweenProperty(this, "modulate:a", 1f, 0.45f);
        _tween.TweenInterval(1.4f);
        _tween.TweenProperty(this, "modulate:a", 0f, 0.8f);
    }
}
