using Godot;
using UnbrokenAges.Client.Map;
using UnbrokenAges.Client.Visuals;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.UI;

/// <summary>
/// The great moments of a game as short films: the founding of your first city, a world wonder raised anywhere you can see, a
/// new era, a faith born, a city taken or lost, a natural wonder found, victory. Black bars close in, the interface steps
/// aside, the camera sweeps low over the place and slowly circles it, light rises from it, and a title card in an engraved
/// face names the moment and its year. Any key or click lets it go. Moments queue (at most three wait); they never play
/// during scripted runs unless asked for.
/// </summary>
public partial class Cinematics : CanvasLayer
{
    public enum Kind { Founding, Wonder, Era, Faith, Conquest, Loss, NaturalWonder, Victory, Defeat }

    public sealed record Moment(Kind Kind, string Banner, string Title, string Subtitle, Vector3 Where, Color Light);

    /// <summary>Players may turn the films off in the menu.</summary>
    public static bool Enabled = true;

    private readonly GameRoot _root;
    private readonly Queue<Moment> _queue = new();
    private Moment? _playing;
    private float _t;
    private float _duration;
    private bool _ending;
    private float _endT;
    private Vector3 _startFocus;
    private float _startDistance, _startYaw;

    private readonly ColorRect _top = new() { Color = Colors.Black, MouseFilter = Control.MouseFilterEnum.Ignore };
    private readonly ColorRect _bottom = new() { Color = Colors.Black, MouseFilter = Control.MouseFilterEnum.Ignore };
    private readonly Control _card = new() { MouseFilter = Control.MouseFilterEnum.Ignore };
    private readonly Label _banner = new(), _title = new(), _subtitle = new();
    private readonly ColorRect _ruleLeft = new(), _ruleRight = new();

    private static FontVariation? _engraved, _italic;

    /// <summary>Cinzel for the titles (an engraved Roman capital), EB Garamond italic for the dates.</summary>
    public static Font Engraved(int weight = 600) => _engraved ??= new FontVariation
    {
        BaseFont = GD.Load<FontFile>("res://assets/ui/fonts/Cinzel.ttf"),
        VariationOpentype = new Godot.Collections.Dictionary { { TextServerManager.GetPrimaryInterface().NameToTag("wght"), weight } },
    };

    public static Font Italic() => _italic ??= new FontVariation { BaseFont = GD.Load<FontFile>("res://assets/ui/fonts/EBGaramond-Italic.ttf") };

    public Cinematics(GameRoot root)
    {
        _root = root;
        Layer = 3;
        Visible = false;
    }

    public override void _Ready()
    {
        foreach (var bar in new[] { _top, _bottom }) AddChild(bar);
        _card.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        AddChild(_card);
        var gold = new Color(0.96f, 0.84f, 0.55f);
        _banner.AddThemeFontOverride("font", Engraved(500));
        _banner.AddThemeFontSizeOverride("font_size", 22);
        _banner.AddThemeColorOverride("font_color", gold);
        _banner.AddThemeConstantOverride("outline_size", 6);
        _banner.AddThemeColorOverride("font_outline_color", new Color(0, 0, 0, 0.6f));
        _title.AddThemeFontOverride("font", Engraved(700));
        _title.AddThemeFontSizeOverride("font_size", 64);
        _title.AddThemeColorOverride("font_color", new Color(1f, 0.97f, 0.9f));
        _title.AddThemeConstantOverride("outline_size", 10);
        _title.AddThemeColorOverride("font_outline_color", new Color(0.1f, 0.06f, 0.03f, 0.75f));
        _title.AddThemeConstantOverride("shadow_offset_y", 3);
        _title.AddThemeColorOverride("font_shadow_color", new Color(0, 0, 0, 0.6f));
        _subtitle.AddThemeFontOverride("font", Italic());
        _subtitle.AddThemeFontSizeOverride("font_size", 30);
        _subtitle.AddThemeColorOverride("font_color", new Color(0.95f, 0.9f, 0.8f));
        _subtitle.AddThemeConstantOverride("outline_size", 6);
        _subtitle.AddThemeColorOverride("font_outline_color", new Color(0, 0, 0, 0.55f));
        foreach (var l in new[] { _banner, _title, _subtitle })
        {
            l.HorizontalAlignment = HorizontalAlignment.Center;
            l.MouseFilter = Control.MouseFilterEnum.Ignore;
            _card.AddChild(l);
        }
        foreach (var r in new[] { _ruleLeft, _ruleRight }) { r.Color = gold; r.MouseFilter = Control.MouseFilterEnum.Ignore; _card.AddChild(r); }
    }

    public bool Playing => _playing != null;

    public void Play(Moment m)
    {
        if (!Enabled) return;
        if (_queue.Count >= 3) return;
        _queue.Enqueue(m);
    }

    /// <summary>Lets the current moment go (any key, any click).</summary>
    public void Skip()
    {
        if (_playing != null && !_ending) { _ending = true; _endT = 0f; }
    }

    public override void _Input(InputEvent e)
    {
        if (_playing == null || _t < 0.4f) return;
        if (e is InputEventKey { Pressed: true } or InputEventMouseButton { Pressed: true })
        {
            Skip();
            GetViewport().SetInputAsHandled();
        }
    }

    public override void _Process(double delta)
    {
        if (_playing == null)
        {
            if (_queue.Count == 0 || _root.AiBusy) return;
            Begin(_queue.Dequeue());
        }
        float dt = (float)delta;
        _t += dt;
        if (!_ending && _t >= _duration) { _ending = true; _endT = 0f; }
        float bars = _ending ? (_queue.Count > 0 ? 1f : 1f - Mathf.Clamp(_endT / 0.6f, 0f, 1f)) : _chained ? 1f : Mathf.Clamp(_t / 0.6f, 0f, 1f);
        Layout(Ease(bars));
        Shoot();
        // The title card: fades in after the camera has arrived, holds, fades out with the bars.
        float card = _ending ? 1f - Mathf.Clamp(_endT / 0.4f, 0f, 1f) : Mathf.Clamp((_t - 1.0f) / 0.8f, 0f, 1f);
        _card.Modulate = new Color(1, 1, 1, card);
        float rule = Mathf.Clamp((_t - 1.2f) / 1.0f, 0f, 1f);
        var size = GetViewport().GetVisibleRect().Size;
        float half = Ease(rule) * size.X * 0.16f;
        _ruleLeft.Position = new Vector2(size.X / 2 - 24 - half, size.Y * 0.785f); _ruleLeft.Size = new Vector2(half, 1.5f);
        _ruleRight.Position = new Vector2(size.X / 2 + 24, size.Y * 0.785f); _ruleRight.Size = new Vector2(half, 1.5f);
        _root.SetGrade(0.65f + 0.3f * bars, 0.07f + 0.05f * bars);
        if (_ending)
        {
            _endT += dt;
            if (_endT >= 0.6f) Finish();
        }
    }

    private static float Ease(float x) => x * x * (3f - 2f * x);

    private void Begin(Moment m)
    {
        _playing = m;
        _t = 0f;
        _ending = false;
        _duration = m.Kind is Kind.Victory or Kind.Defeat ? 8f : m.Kind == Kind.Founding ? 6f : 5.5f;
        Visible = true;
        _root.SetHudVisible(false);
        var cam = _root.Camera;
        _chained = _chainFrom != null;
        if (_chainFrom is var (f, d))
        {
            _startFocus = f; _startDistance = d;
            _chainFrom = null;
        }
        else
        {
            _startFocus = cam.Focus;
            _startDistance = cam.Distance;
            cam.BeginCinematic();
        }
        _startYaw = 0f;
        _banner.Text = m.Banner.ToUpperInvariant();
        _title.Text = m.Title;
        _subtitle.Text = m.Subtitle;
        _card.Modulate = new Color(1, 1, 1, 0);
        var size = GetViewport().GetVisibleRect().Size;
        _banner.Position = new Vector2(0, size.Y * 0.635f); _banner.Size = new Vector2(size.X, 30);
        _title.Position = new Vector2(0, size.Y * 0.665f); _title.Size = new Vector2(size.X, 80);
        _subtitle.Position = new Vector2(0, size.Y * 0.795f); _subtitle.Size = new Vector2(size.X, 40);
        Audio.AudioManager.Sfx(m.Kind is Kind.Loss or Kind.Defeat ? "thud" : "bell", -2f, m.Kind is Kind.Loss or Kind.Defeat ? 0.7f : 0.85f);
        // The spectacle on the ground, timed to land as the camera arrives.
        GetTree().CreateTimer(0.9f).Timeout += () => Spectacle(m);
    }

    private void Spectacle(Moment m)
    {
        var fx = MapFx.Current;
        if (fx == null || _playing != m) return;
        var at = m.Where;
        switch (m.Kind)
        {
            case Kind.Wonder:
                fx.LightPillar(at, m.Light, 4.5f, 9f, 0.42f);
                fx.Shockwave(at, m.Light, 3.2f, 1.2f);
                fx.Fireworks(at, 6);
                break;
            case Kind.Founding:
                fx.LightPillar(at, m.Light, 4f, 6f, 0.5f);
                fx.Shockwave(at, m.Light, 2.8f, 1.1f);
                fx.Sparkles(at, m.Light, 50);
                break;
            case Kind.Era:
            case Kind.Faith:
            case Kind.NaturalWonder:
                fx.LightPillar(at, m.Light, 4f, 7f, 0.6f);
                fx.Sparkles(at, m.Light, 60);
                fx.Shockwave(at, m.Light, 3f, 1.4f);
                break;
            case Kind.Conquest:
            case Kind.Loss:
                fx.Shockwave(at, new Color(1f, 0.4f, 0.2f), 2.2f, 0.8f);
                for (int i = 0; i < 6; i++)   // the city burns through the whole shot
                    GetTree().CreateTimer(0.75f * i).Timeout += () => { if (_playing == m) { fx.Flames(at + new Vector3(0.2f, 0, 0.1f)); fx.Smoke(at, 2.5f); } };
                break;
            case Kind.Victory:
                fx.LightPillar(at, m.Light, 7f, 10f, 0.9f);
                for (int i = 0; i < 3; i++) GetTree().CreateTimer(1.6f * i).Timeout += () => { if (_playing == m) fx.Fireworks(at, 6); };
                break;
            case Kind.Defeat:
                fx.Smoke(at, 6f);
                break;
        }
    }

    /// <summary>The shot: a sweep in from where the player was looking, low over the place, then a slow circle and push in.</summary>
    private void Shoot()
    {
        if (_playing is not { } m) return;
        float arrive = Ease(Mathf.Clamp(_t / 1.3f, 0f, 1f));
        float circle = _t / _duration;
        var focus = _startFocus.Lerp(m.Where + new Vector3(0, 0.35f, 0), arrive);
        float distance = Mathf.Lerp(_startDistance, Mathf.Lerp(7.5f, 5.6f, circle), arrive);
        float tilt = Mathf.Lerp(55f, m.Kind is Kind.Victory or Kind.Wonder ? 22f : 27f, arrive);
        float yaw = _startYaw + Mathf.Lerp(-18f, 32f, circle) * arrive;
        _root.Camera.SetCinematic(focus, distance, tilt, yaw);
        _lastFocus = focus; _lastDistance = distance;
    }

    private (Vector3, float)? _chainFrom;
    private bool _chained;
    private Vector3 _lastFocus;
    private float _lastDistance;

    private void Layout(float bars)
    {
        var size = GetViewport().GetVisibleRect().Size;
        float h = size.Y * 0.12f * bars;
        _top.Position = Vector2.Zero; _top.Size = new Vector2(size.X, h);
        _bottom.Position = new Vector2(0, size.Y - h); _bottom.Size = new Vector2(size.X, h);
    }

    private void Finish()
    {
        if (_queue.Count > 0 && Enabled)
        {
            // Another moment waits: cut straight to it, the bars and the camera's hold kept.
            var next = _queue.Dequeue();
            _chainFrom = (_lastFocus, _lastDistance);
            _playing = null;
            Begin(next);
            return;
        }
        _root.Camera.EndCinematic();
        _root.SetHudVisible(true);
        _root.SetGrade(0.65f, 0.07f);
        _playing = null;
        Visible = false;
    }

    // ----- Which events become films -------------------------------------------------------------------

    /// <summary>Turns the game's events into moments, from the local player's point of view.</summary>
    public void Consider(GameState s, IReadOnlyList<GameEvent> events, int me, bool[] visible)
    {
        string year = Calendar.Format(Calendar.Year(s.Turn, s.Options.GameSpeedPercent));
        string Civ(int p) => PeopleName(s, p);
        Vector3 At(int tile) => tile >= 0 ? HexLayout.ToWorld(s.Map.CoordOf(tile), HexMapView.SurfaceY(s.Map, tile)) : _root.Camera.Focus;
        bool Seen(int tile) => tile >= 0 && tile < visible.Length && visible[tile];
        var gold = new Color(1f, 0.82f, 0.45f);
        foreach (var e in events)
        {
            bool mine = e.Player == me;
            switch (e.Type)
            {
                case GameEventType.CityFounded when mine && s.Cities.Count(c => c.Owner == me) == 1:
                    Play(new Moment(Kind.Founding, "A people takes root", $"The Founding of {e.Detail}", $"{Civ(me)} · {year}", At(e.Tile), gold));
                    break;
                case GameEventType.ProductionCompleted when e.Value == (int)ProductionKind.District && e.Def >= 0 && e.Def < s.Db.Districts.Count &&
                                                            s.Db.Districts[e.Def].Category == DistrictCategory.Wonder && (mine || Seen(e.Tile)):
                {
                    var city = s.GetCity(e.City);
                    Play(new Moment(Kind.Wonder, "A wonder of the world", s.Db.Districts[e.Def].Name,
                                    $"{city?.Name ?? ""}{(city != null ? ", " : "")}{Civ(e.Player)} · {year}", At(e.Tile >= 0 ? e.Tile : city?.Tile ?? -1), gold));
                    break;
                }
                case GameEventType.EraEntered when mine:
                {
                    var capital = s.GetCity(s.Players[me].CapitalCityId);
                    Play(new Moment(Kind.Era, $"{Civ(me)} enters", e.Detail ?? "A New Era", year, At(capital?.Tile ?? -1), EraLight(e.Value)));
                    break;
                }
                case GameEventType.ReligionFounded when mine:
                    Play(new Moment(Kind.Faith, "A faith is born", e.Detail ?? "", $"{s.GetCity(e.City)?.Name} · {year}", At(e.Tile), new Color(0.95f, 0.9f, 1f)));
                    break;
                case GameEventType.CityCaptured when mine:
                    Play(new Moment(Kind.Conquest, "Conquest", $"{e.Detail} Falls", $"taken from {Civ(e.Value)} · {year}", At(e.Tile), new Color(1f, 0.5f, 0.25f)));
                    break;
                case GameEventType.CityCaptured when e.Value == me:
                    Play(new Moment(Kind.Loss, "A city is lost", e.Detail ?? "", $"taken by {Civ(e.Player)} · {year}", At(e.Tile), new Color(0.6f, 0.5f, 0.45f)));
                    break;
                case GameEventType.NaturalWonderDiscovered when mine:
                    Play(new Moment(Kind.NaturalWonder, "A wonder of nature", e.Detail ?? "", $"discovered · {year}", At(e.Tile), new Color(0.6f, 1f, 0.75f)));
                    break;
                case GameEventType.VictoryAchieved:
                {
                    bool won = DiplomacySystem.SameTeam(s, e.Player, me);
                    var capital = s.GetCity(s.Players[e.Player].CapitalCityId);
                    Play(new Moment(won ? Kind.Victory : Kind.Defeat, won ? "Victory" : "The end of an age", e.Detail ?? "", year,
                                    At(capital?.Tile ?? -1), won ? gold : new Color(0.55f, 0.5f, 0.6f)));
                    break;
                }
            }
        }
    }

    /// <summary>A people's name for a title card: its civilization (the player's own name may just be "You").</summary>
    public static string PeopleName(GameState s, int p) =>
        p < 0 || p >= s.Players.Count ? "" : s.Players[p].CivIndex >= 0 ? s.Db.Civilizations[s.Players[p].CivIndex].Name : s.Players[p].Name;

    /// <summary>The colour of an era's light: bronze in antiquity, gold in the middle ages, steel and electric blue in the modern world.</summary>
    public static Color EraLight(int era) => era switch
    {
        <= 1 => new Color(1f, 0.72f, 0.4f),
        <= 3 => new Color(1f, 0.85f, 0.5f),
        <= 5 => new Color(0.85f, 0.9f, 1f),
        <= 7 => new Color(0.55f, 0.85f, 1f),
        _ => new Color(0.8f, 0.6f, 1f),
    };
}
