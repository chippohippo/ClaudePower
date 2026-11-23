using Godot;
using UnbrokenAges.Client.Map;
using UnbrokenAges.Client.UI;
using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.Hud;

/// <summary>
/// Bottom-right (Civ VI): the minimap (explored world, borders, cities; click to look there) and above it the big turn
/// button, which always names the next thing that needs you and does it when pressed: Choose Research, Choose Production,
/// Unit Needs Orders, then Next Turn. Shift+Enter or right-click ends the turn regardless.
/// </summary>
public partial class MiniMapAndTurn : VBoxContainer
{
    private readonly GameRoot _root;
    private Button _turn = null!;
    private Label _hint = null!;
    private TextureRect _map = null!;
    private ImageTexture? _texture;
    private Action? _action;

    public MiniMapAndTurn(GameRoot root) => _root = root;

    public override void _Ready()
    {
        SetAnchorsAndOffsetsPreset(LayoutPreset.BottomRight);
        GrowHorizontal = GrowDirection.Begin;
        GrowVertical = GrowDirection.Begin;
        OffsetRight = -12; OffsetBottom = -12;
        AddThemeConstantOverride("separation", 6);
        Alignment = AlignmentMode.End;

        _hint = new Label { HorizontalAlignment = HorizontalAlignment.Right, AutowrapMode = TextServer.AutowrapMode.WordSmart, CustomMinimumSize = new Vector2(300, 0) };
        _hint.AddThemeFontSizeOverride("font_size", 14);
        _hint.AddThemeColorOverride("font_color", UiTheme.Text);
        _hint.AddThemeColorOverride("font_outline_color", new Color(0, 0, 0, 0.9f));
        _hint.AddThemeConstantOverride("outline_size", 5);
        AddChild(_hint);
        _turn = new Button { CustomMinimumSize = new Vector2(300, 58), TooltipText = "Right-click (or Shift+Enter) to end the turn anyway." };
        _turn.AddThemeFontSizeOverride("font_size", 20);
        _turn.AddThemeStyleboxOverride("normal", UiTheme.Box(new Color("#1f4a7a"), UiTheme.GoldBright, 2, 29, 10));
        _turn.AddThemeStyleboxOverride("hover", UiTheme.Box(new Color("#2b6aa8"), UiTheme.GoldBright, 2, 29, 10));
        _turn.AddThemeStyleboxOverride("pressed", UiTheme.Box(new Color("#173a60"), UiTheme.Gold, 2, 29, 10));
        _turn.AddThemeStyleboxOverride("disabled", UiTheme.Box(new Color("#1a2533"), new Color(UiTheme.Gold, 0.3f), 2, 29, 10));
        _turn.Pressed += () => _action?.Invoke();
        _turn.GuiInput += e => { if (e is InputEventMouseButton { Pressed: true, ButtonIndex: MouseButton.Right }) _root.Submit(new EndTurnCommand()); };
        AddChild(_turn);

        var frame = new PanelContainer();
        frame.AddThemeStyleboxOverride("panel", UiTheme.Box(new Color("#b9a27a"), UiTheme.Gold, 2, 6, 4));
        AddChild(frame);
        _map = new TextureRect { CustomMinimumSize = new Vector2(292, 182), ExpandMode = TextureRect.ExpandModeEnum.IgnoreSize, StretchMode = TextureRect.StretchModeEnum.Scale, MouseDefaultCursorShape = CursorShape.PointingHand, TooltipText = "Click to look there." };
        _map.GuiInput += OnMapInput;
        frame.AddChild(_map);
    }

    private void OnMapInput(InputEvent e)
    {
        var s = _root.State;
        if (s == null || e is not InputEventMouseButton { Pressed: true, ButtonIndex: MouseButton.Left } click) return;
        int col = (int)(click.Position.X / _map.Size.X * s.Map.Width);
        int row = (int)(click.Position.Y / _map.Size.Y * s.Map.Height);
        _root.Camera.LookAtHex(Sim.Core.HexCoord.FromOffset(Math.Clamp(col, 0, s.Map.Width - 1), Math.Clamp(row, 0, s.Map.Height - 1)));
    }

    public void Refresh()
    {
        var s = _root.State;
        if (s == null) return;
        DrawMap(s);
        var p = s.Players[_root.LocalPlayer];
        (string Label, string Hint, Action? Do) state =
            s.Victory.AwaitingChoice ? ("GAME OVER", "", null) :
            p.HasEndedTurn ? ("PLEASE WAIT", TurnPhases.Describe(s), null) :
            !s.Cities.Any(c => c.Owner == p.Id) && s.Units.FirstOrDefault(u => u.Owner == p.Id && s.Db.Units[u.DefIndex].FoundsCity) is { } settler
                ? ("FOUND A CITY", "Select your Settler and press B.", () => _root.SelectUnit(settler.Id)) :
            p.CurrentTech < 0 && s.Db.Techs.Any(t => ResearchSystem.CanResearch(p, t)) ? ("CHOOSE RESEARCH", "Pick what your scholars study next.", () => _root.ToggleByKey("T")) :
            p.CurrentCivic < 0 && s.Db.Civics.Any(c => ResearchSystem.CanStudy(p, c)) ? ("CHOOSE CIVIC", "Pick the next civic.", () => _root.ToggleByKey("T")) :
            s.CitiesOf(p.Id).FirstOrDefault(c => c.Queue.Items.Count == 0) is { } idle ? ("CHOOSE PRODUCTION", $"{idle.Name} has nothing to build.", () => _root.OpenCity(idle)) :
            ReadyUnits(s, p.Id) > 0 ? ("UNIT NEEDS ORDERS", $"{ReadyUnits(s, p.Id)} unit(s) waiting. Fortify (F) or skip (Space) the ones you do not need.", _root.SelectNextUnit) :
            ("NEXT TURN", "Enter", () => _root.Submit(new EndTurnCommand()));
        _turn.Text = state.Label;
        _hint.Text = state.Hint;
        _turn.Disabled = state.Do == null;
        _action = state.Do;
    }

    private static int ReadyUnits(GameState s, int player) =>
        s.Units.Count(u => u.Owner == player && u.MovesLeft > Sim.Core.Fx.Zero && u.Destination < 0 && !u.Fortified && !s.Db.Units[u.DefIndex].FoundsCity && u.Charges == 0 && SupplySystem.IsMilitary(s.Db, u) && !s.Cities.Any(c => c.Tile == u.Tile));

    private void DrawMap(GameState s)
    {
        var map = s.Map;
        var img = Image.CreateEmpty(map.Width * 2, map.Height * 2, false, Image.Format.Rgb8);
        var revealed = s.Players[_root.LocalPlayer].Revealed;
        var visible = VisibilitySystem.Visible(s, _root.LocalPlayer);
        for (int row = 0; row < map.Height; row++)
            for (int col = 0; col < map.Width; col++)
            {
                int t = map.IndexOf(Sim.Core.HexCoord.FromOffset(col, row));
                Color c;
                if (t < 0 || t >= revealed.Length || !revealed[t]) c = new Color("#b9a27a").Darkened(((col * 7 + row * 13) % 5) * 0.02f);
                else
                {
                    var cls = s.Db.Terrains[map.Terrain[t]].Class;
                    c = cls == TerrainClass.Ocean ? new Color("#183d66") : map.IsWater(t) ? new Color("#2f78a8")
                      : map.IsMountain(t) ? new Color("#8d8780") : s.Db.Terrains[map.Terrain[t]].Id switch
                      {
                          "TERRAIN_DESERT" => new Color("#d9c08a"), "TERRAIN_PLAINS" => new Color("#a9a35a"),
                          "TERRAIN_TUNDRA" => new Color("#8f9583"), "TERRAIN_SNOW" => new Color("#e8eef2"), _ => new Color("#5f9a46"),
                      };
                    if (map.OwnerPlayer[t] >= 0) c = c.Lerp(HexMapView.CivColor(s, map.OwnerPlayer[t]), 0.45f);
                    if (!visible[t]) c = c.Darkened(0.35f);
                }
                int ox = row % 2 == 1 ? 1 : 0;
                for (int dy = 0; dy < 2; dy++)
                    for (int dx = 0; dx < 2; dx++)
                        img.SetPixel(Math.Min(map.Width * 2 - 1, col * 2 + dx + ox), row * 2 + dy, c);
            }
        foreach (var city in s.Cities)
        {
            if (city.Tile >= revealed.Length || !revealed[city.Tile]) continue;
            var o = map.CoordOf(city.Tile).ToOffset();
            var cc = HexMapView.CivColor(s, city.Owner).Lightened(0.4f);
            for (int dy = -1; dy <= 2; dy++)
                for (int dx = -1; dx <= 2; dx++)
                {
                    int x = o.Col * 2 + dx + (o.Row % 2), y = o.Row * 2 + dy;
                    if (x >= 0 && y >= 0 && x < map.Width * 2 && y < map.Height * 2) img.SetPixel(x, y, cc);
                }
        }
        if (_texture == null || _texture.GetWidth() != img.GetWidth()) { _texture = ImageTexture.CreateFromImage(img); _map.Texture = _texture; }
        else _texture.Update(img);
    }
}
