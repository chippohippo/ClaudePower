using Godot;

namespace UnbrokenAges.Client.UI;

/// <summary>One theme for every screen: opaque dark panels with padding so text never sits on the map, and readable sizes.</summary>
public static class UiTheme
{
    public static Theme Build()
    {
        var theme = new Theme { DefaultFontSize = 16 };
        var panel = new StyleBoxFlat
        {
            BgColor = new Color("#121821fa"), BorderColor = new Color("#2c3a4a"),
            CornerRadiusTopLeft = 6, CornerRadiusTopRight = 6, CornerRadiusBottomLeft = 6, CornerRadiusBottomRight = 6,
            ContentMarginLeft = 12, ContentMarginRight = 12, ContentMarginTop = 8, ContentMarginBottom = 8,
        };
        panel.SetBorderWidthAll(1);
        theme.SetStylebox("panel", "PanelContainer", panel);
        theme.SetFontSize("font_size", "HeaderLarge", 24);
        theme.SetFontSize("font_size", "HeaderMedium", 20);
        theme.SetTypeVariation("HeaderLarge", "Label");
        theme.SetTypeVariation("HeaderMedium", "Label");
        return theme;
    }
}
