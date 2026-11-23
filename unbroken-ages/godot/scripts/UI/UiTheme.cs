using Godot;

namespace UnbrokenAges.Client.UI;

/// <summary>
/// The interface look, after Civ V and VI: deep navy panels with a thin antique-gold frame, gold headings, parchment-white
/// text, rounded buttons that light up on hover, and the same yield colours everywhere (food green, production orange, gold
/// yellow, science blue, culture violet, faith pale gold). Every screen uses this one theme.
/// </summary>
public static class UiTheme
{
    public static readonly Color Navy = new("#0e1a2b");
    public static readonly Color NavyLight = new("#18304d");
    public static readonly Color Gold = new("#c9a45c");
    public static readonly Color GoldBright = new("#f0d38a");
    public static readonly Color Text = new("#efe6d2");
    public static readonly Color TextDim = new("#a9b4c2");

    public static readonly Color Food = new("#7ccf5a");
    public static readonly Color Production = new("#e8873a");
    public static readonly Color GoldYield = new("#f2c94c");
    public static readonly Color Science = new("#5fb3f5");
    public static readonly Color Culture = new("#c08cf0");
    public static readonly Color Faith = new("#e8e2c0");
    public static readonly Color Danger = new("#ff5a4f");

    public static StyleBoxFlat Box(Color bg, Color border, int borderWidth = 1, int radius = 6, int margin = 10)
    {
        var b = new StyleBoxFlat
        {
            BgColor = bg, BorderColor = border, CornerDetail = 6,
            ContentMarginLeft = margin, ContentMarginRight = margin, ContentMarginTop = margin * 0.7f, ContentMarginBottom = margin * 0.7f,
            ShadowColor = new Color(0, 0, 0, 0.35f), ShadowSize = 6,
        };
        b.SetBorderWidthAll(borderWidth);
        b.SetCornerRadiusAll(radius);
        return b;
    }

    public static Theme Build()
    {
        var theme = new Theme { DefaultFontSize = 16 };
        theme.SetStylebox("panel", "PanelContainer", Box(new Color(Navy, 0.96f), new Color(Gold, 0.7f)));
        theme.SetStylebox("panel", "TooltipPanel", Box(new Color("#0b1422f5"), Gold, 1, 4, 8));
        theme.SetColor("font_color", "TooltipLabel", Text);

        theme.SetColor("font_color", "Label", Text);
        theme.SetColor("font_outline_color", "Label", new Color(0, 0, 0, 0.6f));
        theme.SetConstant("outline_size", "Label", 0);
        theme.SetTypeVariation("HeaderLarge", "Label");
        theme.SetFontSize("font_size", "HeaderLarge", 24);
        theme.SetColor("font_color", "HeaderLarge", GoldBright);
        theme.SetTypeVariation("HeaderMedium", "Label");
        theme.SetFontSize("font_size", "HeaderMedium", 20);
        theme.SetColor("font_color", "HeaderMedium", GoldBright);
        theme.SetTypeVariation("Caption", "Label");
        theme.SetFontSize("font_size", "Caption", 13);
        theme.SetColor("font_color", "Caption", TextDim);

        var normal = Box(new Color("#1c3352"), new Color(Gold, 0.45f), 1, 5, 9);
        var hover = Box(new Color("#27466f"), GoldBright, 1, 5, 9);
        var pressed = Box(new Color("#13243b"), Gold, 1, 5, 9);
        var disabled = Box(new Color("#141f2e"), new Color(Gold, 0.15f), 1, 5, 9);
        foreach (var type in new[] { "Button", "OptionButton", "MenuButton" })
        {
            theme.SetStylebox("normal", type, normal);
            theme.SetStylebox("hover", type, hover);
            theme.SetStylebox("pressed", type, pressed);
            theme.SetStylebox("disabled", type, disabled);
            theme.SetStylebox("focus", type, new StyleBoxEmpty());
            theme.SetColor("font_color", type, Text);
            theme.SetColor("font_hover_color", type, GoldBright);
            theme.SetColor("font_pressed_color", type, GoldBright);
            theme.SetColor("font_disabled_color", type, new Color(TextDim, 0.45f));
            theme.SetColor("icon_normal_color", type, Text);
            theme.SetColor("icon_disabled_color", type, new Color(TextDim, 0.4f));
        }
        theme.SetStylebox("panel", "ItemList", Box(new Color("#0a1320"), new Color(Gold, 0.3f), 1, 4, 6));
        theme.SetStylebox("selected", "ItemList", Box(new Color("#27466f"), GoldBright, 1, 3, 4));
        theme.SetStylebox("selected_focus", "ItemList", Box(new Color("#27466f"), GoldBright, 1, 3, 4));
        theme.SetColor("font_color", "ItemList", Text);
        theme.SetStylebox("background", "ProgressBar", Box(new Color("#0a1320"), new Color(Gold, 0.3f), 1, 3, 0));
        theme.SetStylebox("fill", "ProgressBar", Box(Science, Science, 0, 3, 0));
        theme.SetColor("font_color", "CheckBox", Text);
        theme.SetStylebox("separator", "HSeparator", new StyleBoxLine { Color = new Color(Gold, 0.35f), Thickness = 1 });
        theme.SetStylebox("panel", "PopupPanel", Box(new Color(Navy, 0.98f), Gold));
        theme.SetStylebox("panel", "PopupMenu", Box(new Color(Navy, 0.98f), Gold, 1, 4, 6));
        theme.SetColor("font_color", "PopupMenu", Text);
        theme.SetColor("font_hover_color", "PopupMenu", GoldBright);
        theme.SetStylebox("hover", "PopupMenu", Box(new Color("#27466f"), new Color(0, 0, 0, 0), 0, 3, 4));
        return theme;
    }
}

/// <summary>Kenney icons (CC0) drawn as tinted masks.</summary>
public static class Icons
{
    private static readonly Dictionary<string, Texture2D?> Cache = new();
    private static ShaderMaterial? _mask;
    public static ShaderMaterial Mask => _mask ??= new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/icon_mask.gdshader") };

    public static Texture2D? Get(string name)
    {
        if (Cache.TryGetValue(name, out var t)) return t;
        string path = $"res://assets/ui/icons/{name}.png";
        if (ResourceLoader.Exists(path))
        {
            // Whiten the glyph and keep its alpha, so modulate / icon colours can tint it to any yield colour.
            var img = GD.Load<Texture2D>(path).GetImage();
            if (img.IsCompressed()) img.Decompress();
            img.Convert(Image.Format.Rgba8);
            for (int y = 0; y < img.GetHeight(); y++)
                for (int x = 0; x < img.GetWidth(); x++)
                {
                    var c = img.GetPixel(x, y);
                    img.SetPixel(x, y, new Color(1, 1, 1, c.A));
                }
            img.GenerateMipmaps();
            t = ImageTexture.CreateFromImage(img);
        }
        Cache[name] = t;
        return t;
    }

    public static TextureRect Rect(string name, Color color, int size = 20) => new()
    {
        Texture = Get(name), SelfModulate = color, CustomMinimumSize = new Vector2(size, size),
        ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize, StretchMode = TextureRect.StretchModeEnum.KeepAspectCentered,
        MouseFilter = Control.MouseFilterEnum.Ignore,
    };

    /// <summary>[icon] value, e.g. a yield in the top bar.</summary>
    public static HBoxContainer Stat(string icon, Color color, string text, out Label label, int size = 20, string? tooltip = null)
    {
        var h = new HBoxContainer { TooltipText = tooltip ?? "", MouseFilter = Control.MouseFilterEnum.Pass };
        h.AddThemeConstantOverride("separation", 4);
        h.AddChild(Rect(icon, color, size));
        label = new Label { Text = text, VerticalAlignment = VerticalAlignment.Center };
        label.AddThemeColorOverride("font_color", color.Lerp(Colors.White, 0.35f));
        h.AddChild(label);
        return h;
    }

    public static Button Button(string icon, string text, Color color, Action pressed, string tooltip = "")
    {
        var b = new Button { Text = text, Icon = Get(icon), TooltipText = tooltip, ExpandIcon = false };
        b.AddThemeConstantOverride("icon_max_width", 20);
        b.AddThemeColorOverride("icon_normal_color", color);
        b.AddThemeColorOverride("icon_hover_color", color.Lightened(0.25f));
        b.Pressed += pressed;
        return b;
    }
}
