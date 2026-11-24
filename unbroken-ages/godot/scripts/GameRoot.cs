using Godot;
using UnbrokenAges.Client.Audio;
using UnbrokenAges.Client.Hud;
using UnbrokenAges.Client.Map;
using UnbrokenAges.Client.UI;
using UnbrokenAges.Net;
using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client;

/// <summary>
/// Composition root for the client. Owns exactly one "session" — local (single player/hotseat),
/// host (listen server) or client — and exposes a single Submit() so UI code never cares which.
/// The simulation is pumped on the main thread; rendering reacts to sequence/turn changes.
///
/// Controls: left-click selects a unit or city · right-click moves or attacks · Space next unit · B found city · F fortify ·
/// Enter end turn · T research · P diplomacy · C chronicle · V divergence · L supply lens · F5 save · F9 load · WASD/arrows pan · wheel zoom.
/// </summary>
public partial class GameRoot : Node3D
{
    public GameDatabase Db { get; private set; } = null!;
    public int LocalPlayer { get; private set; }
    public int SelectedUnit { get; private set; } = -1;

    private HostSession? _host;
    private ClientSession? _client;
    private GameState? _local;
    private long _renderedVersion = -1;
    private long _localVersion;
    private int _selectedTile = -1;

    private StrategyCamera _camera = null!;
    private HexMapView _map = null!;
    private PlacementLens _lens = null!;
    private CityPanel _cityPanel = null!;
    private LobbyScreen _lobby = null!;
    private DivergencePanel _divergence = null!;
    private SocietyPanel _society = null!;
    private EspionagePanel _espionage = null!;
    private ChroniclePanel _chronicle = null!;
    private DiplomacyPanel _diplomacy = null!;
    private VictoryPanel _victory = null!;
    private CombatTooltip _tooltip = null!;
    private UnitPanel _unitPanel = null!;
    private ResearchPanel _research = null!;
    private NotificationFeed _feed = null!;
    private TopBar _topBar = null!;
    private ResearchTracker _tracker = null!;
    private MiniMapAndTurn _turnCorner = null!;
    private MapOverlay _overlay = null!;
    private GameMenu _menu = null!;
    private AudioManager _audio = null!;
    private double _seaTimer;
    private bool _supplyLens;

    public GameState? State => _host?.State ?? _client?.State ?? _local;
    public StrategyCamera Camera => _camera;

    public override void _Ready()
    {
        Db = ContentLocator.LoadDatabase();

        AddChild(new DirectionalLight3D
        {
            RotationDegrees = new Vector3(-38, 42, 0), ShadowEnabled = true, LightEnergy = 1.0f, LightColor = new Color("#ffe2bd"),
            DirectionalShadowMode = DirectionalLight3D.ShadowMode.Parallel2Splits, DirectionalShadowMaxDistance = 60f, ShadowBlur = 1.5f,
        });
        AddChild(new WorldEnvironment { Environment = BuildEnvironment() });
        _camera = new StrategyCamera();
        AddChild(_camera);
        _map = new HexMapView();
        AddChild(_map);
        _lens = new PlacementLens();
        AddChild(_lens);
        // The paper finish over the whole 3D frame (grain, warm grade, aged vignette), on a layer under the interface.
        var grade = new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/paper_grade.gdshader") };
        grade.SetShaderParameter("paper_noise", HexMapView.PaperNoise);
        var gradeLayer = new CanvasLayer { Layer = 0 };
        AddChild(gradeLayer);
        var gradeRect = new ColorRect { Material = grade, MouseFilter = Control.MouseFilterEnum.Ignore };
        gradeRect.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        gradeLayer.AddChild(gradeRect);

        var theme = UiTheme.Build();
        var ui = new CanvasLayer { Layer = 1 };
        AddChild(ui);
        _overlay = new MapOverlay(this);
        ui.AddChild(_overlay);
        _topBar = new TopBar(this) { Visible = false };
        ui.AddChild(_topBar);
        _tracker = new ResearchTracker(this) { Visible = false };
        ui.AddChild(_tracker);
        _feed = new NotificationFeed(this);
        ui.AddChild(_feed);
        _cityPanel = new CityPanel(this, _lens) { Visible = false };
        ui.AddChild(_cityPanel);
        _unitPanel = new UnitPanel(this);
        ui.AddChild(_unitPanel);
        _turnCorner = new MiniMapAndTurn(this) { Visible = false };
        ui.AddChild(_turnCorner);
        _research = new ResearchPanel(this);
        ui.AddChild(_research);
        _lobby = new LobbyScreen(this);
        ui.AddChild(_lobby);
        _divergence = new DivergencePanel(this) { Visible = false };
        ui.AddChild(_divergence);
        _society = new SocietyPanel(this) { Visible = false };
        ui.AddChild(_society);
        _espionage = new EspionagePanel(this) { Visible = false };
        ui.AddChild(_espionage);
        _chronicle = new ChroniclePanel(this) { Visible = false };
        ui.AddChild(_chronicle);
        _diplomacy = new DiplomacyPanel(this) { Visible = false };
        ui.AddChild(_diplomacy);
        _victory = new VictoryPanel(this);
        ui.AddChild(_victory);
        _tooltip = new CombatTooltip();
        ui.AddChild(_tooltip);
        _menu = new GameMenu(this);
        ui.AddChild(_menu);
        _audio = new AudioManager();
        AddChild(_audio);
        // Themes do not pass through a CanvasLayer, so each top-level control gets it directly.
        foreach (var child in ui.GetChildren()) if (child is Control control) control.Theme = theme;
        StartAutomation();
        if (State == null) StartBackdrop();
    }

    // ----- Title backdrop ----------------------------------------------------------------------------

    private GameState? _backdrop;

    /// <summary>
    /// Behind the lobby: a small living world, generated and played by the AI for a few dozen turns, shown in full colour
    /// while the camera drifts across it. It is never saved or shared; starting a game replaces it.
    /// </summary>
    private void StartBackdrop()
    {
        var leaders = Db.Leaders.Select(l => l.Id).ToList();
        var setup = new GameSetup
        {
            Seed = 11,
            Map = new MapGenSettings { Width = 44, Height = 26, GreatRivers = 1, Seed = 11 },
            Options = new GameOptions { DisasterIntensity = 0 },
            Players = Enumerable.Range(0, 3).Select(i => new PlayerSetup { Name = $"AI {i}", Leader = leaders[i % leaders.Count] }).ToList(),
        };
        var world = GameFactory.Create(Db, setup);
        var ai = new UnbrokenAges.Sim.AI.SimpleAi();
        for (int t = 0; t < 40; t++)
        {
            foreach (var p in world.Players.Where(p => p.IsMajor && p.IsAlive).ToList())
                foreach (var cmd in ai.TakeTurn(world, p.Id).ToList()) CommandProcessor.Execute(world, cmd, new());
            CommandProcessor.Execute(world, new AdvanceTurnCommand { Player = GameCommand.SystemPlayer, ExpectedTurn = world.Turn }, new());
        }
        _backdrop = world;
        _map.Render(world, 0, -1, seeEverything: true);
        var capital = world.Cities.FirstOrDefault();
        if (capital != null) _camera.LookAtHex(world.Map.CoordOf(capital.Tile));
    }

    /// <summary>
    /// Lighting and grading in the Civ VI spirit: a clear-sky HDRI (Poly Haven) for ambient light and water reflections, a warm
    /// late-morning sun, ACES tonemapping, ambient occlusion so props sit on the ground, a light bloom and aerial perspective,
    /// and the deep-ocean colour beyond the map edge.
    /// </summary>
    private static Godot.Environment BuildEnvironment()
    {
        var sky = new Sky { SkyMaterial = new PanoramaSkyMaterial { Panorama = GD.Load<Texture2D>("res://assets/sky/sky.hdr"), EnergyMultiplier = 0.3f }, RadianceSize = Sky.RadianceSizeEnum.Size256 };
        return new Godot.Environment
        {
            BackgroundMode = Godot.Environment.BGMode.Color, BackgroundColor = new Color("#0d2a40"), Sky = sky,
            AmbientLightSource = Godot.Environment.AmbientSource.Sky, AmbientLightSkyContribution = 0.6f, AmbientLightEnergy = 0.5f, AmbientLightColor = new Color("#9fb4c8"),
            ReflectedLightSource = Godot.Environment.ReflectionSource.Sky,
            TonemapMode = Godot.Environment.ToneMapper.Aces, TonemapExposure = 0.9f, TonemapWhite = 5f,
            SsaoEnabled = true, SsaoRadius = 0.6f, SsaoIntensity = 1.6f, SsaoPower = 1.4f,
            GlowEnabled = true, GlowIntensity = 0.25f, GlowBloom = 0.02f, GlowHdrThreshold = 1.6f,
            FogEnabled = true, FogLightColor = new Color("#a9c3d6"), FogDensity = 0.004f, FogAerialPerspective = 0.35f, FogSkyAffect = 0f,
            AdjustmentEnabled = true, AdjustmentSaturation = 1.12f, AdjustmentContrast = 1.06f,
        };
    }

    // ----- Session entry points (called by LobbyScreen) --------------------------------------------

    public void StartSinglePlayer(GameSetup setup)
    {
        _local = GameFactory.Create(Db, setup);
        LocalPlayer = 0;
        OnGameStarted();
    }

    public void HostGame(GameSetup setup, int port, string? password)
    {
        _host = new HostSession(Db, new TcpServerTransport(port, System.Net.IPAddress.IPv6Any), setup, new HostOptions { Password = password });
        _host.EventsRaised += events => OnEvents(_host.State!, events);
        _host.Start();
        LocalPlayer = 0;
        _lobby.ShowWaiting($"Hosting on port {_host.Port}. Share your IP with friends.");
    }

    public void LaunchHostedGame()
    {
        _host?.StartGame();
        OnGameStarted();
    }

    public void JoinGame(DirectIpEndpoint endpoint, string name, string? password)
    {
        _client = new ClientSession(Db, TcpClientTransport.FromEndpoint(endpoint), new ClientOptions { PlayerName = name, Password = password });
        _client.EventsRaised += events => OnEvents(_client.State!, events);
        _client.Connect();
        _lobby.ShowWaiting($"Connected to {endpoint}. Waiting for the host to start...");
    }

    private void OnGameStarted()
    {
        _backdrop = null;
        _lobby.Visible = false;
        _topBar.Visible = _tracker.Visible = _turnCorner.Visible = true;
        _audio.StartMusic();
        _renderedVersion = -1;
        var s = State!;
        var settler = s.Units.Where(u => u.Owner == LocalPlayer).OrderByDescending(u => s.Db.Units[u.DefIndex].FoundsCity).ThenBy(u => u.Id).FirstOrDefault();
        if (settler != null) SelectUnit(settler.Id);
        _feed.Note("Welcome. Select your Settler and press B (or Found City) to found your capital. Right-click moves; T opens research.");
    }

    // ----- Command routing -----------------------------------------------------------------------

    public CommandResult Submit(GameCommand cmd)
    {
        cmd.Player = LocalPlayer;
        _localVersion++;
        if (_host != null) return Report(_host.SubmitLocal(cmd));
        if (_client != null)
        {
            _client.Submit(cmd); // optimistic UI: shown as pending until the host echoes it
            return CommandResult.Success;
        }
        if (_local == null) return CommandResult.Fail("No game.");
        var events = new List<GameEvent>();
        var result = CommandProcessor.Execute(_local, cmd, events);
        if (result.Ok && cmd is EndTurnCommand)
        {
            // Single player: the AI moves, then the turn resolves.
            var ai = new UnbrokenAges.Sim.AI.SimpleAi();
            foreach (var p in _local.Players.Where(p => !p.IsHuman && p.IsMajor && p.IsAlive).ToList())
                foreach (var aiCmd in ai.TakeTurn(_local, p.Id)) CommandProcessor.Execute(_local, aiCmd, events);
            CommandProcessor.Execute(_local, new AdvanceTurnCommand { Player = GameCommand.SystemPlayer, ExpectedTurn = _local.Turn }, events);
            SelectNextUnit();
        }
        OnEvents(_local, events);
        return Report(result);
    }

    private CommandResult Report(CommandResult result)
    {
        if (!result.Ok && result.Error != null) _feed.Note($"⚠ {result.Error}");
        return result;
    }

    // ----- Selection -----------------------------------------------------------------------------

    public void SelectUnit(int unitId)
    {
        var s = State;
        SelectedUnit = unitId;
        var u = s?.GetUnit(unitId);
        _selectedTile = u?.Tile ?? -1;
        if (u != null)
        {
            _camera.LookAtHex(s!.Map.CoordOf(u.Tile));
            _cityPanel.Visible = false;
            AudioManager.Sfx(SupplySystem.IsMilitary(s.Db, u) ? "draw" : "cloth", -6f);
        }
        _renderedVersion = -1;
    }

    /// <summary>
    /// What the player hears and sees when something happens: notifications, sound effects, and battle animations on the map.
    /// </summary>
    private void OnEvents(GameState s, IReadOnlyList<GameEvent> events)
    {
        _feed.Add(s, events);
        foreach (var e in events)
        {
            bool mine = e.Player == LocalPlayer;
            switch (e.Type)
            {
                case GameEventType.TurnAdvanced: AudioManager.Sfx("bell", -14f, 1.15f); break;
                case GameEventType.CityFounded when mine: AudioManager.Sfx("bell", -4f); AudioManager.Sfx("build", -6f); break;
                case GameEventType.ProductionCompleted when mine: AudioManager.Sfx("build", -8f); break;
                case GameEventType.TechResearched when mine: case GameEventType.CivicCompleted when mine: AudioManager.Sfx("page", -4f); break;
                case GameEventType.ImprovementBuilt when mine: AudioManager.Sfx("chop", -6f); break;
                case GameEventType.WarDeclared: AudioManager.Sfx("thud", -2f, 0.7f); break;
                case GameEventType.PeaceSigned: AudioManager.Sfx("bell", -6f, 0.9f); break;
                case GameEventType.CityCaptured: AudioManager.Sfx("clash2", -2f); AudioManager.Sfx("bell", -8f, 0.8f); break;
                case GameEventType.UnitDestroyed: AudioManager.Sfx("thud", -4f); break;
                case GameEventType.VictoryAchieved: AudioManager.Sfx("confirm", 0f); break;
                case GameEventType.BattleFought:
                    if (e.Tile >= 0 && VisibilitySystem.Visible(s, LocalPlayer)[e.Tile])
                    {
                        AudioManager.Sfx(e.Value > 25 ? "clash" : "clash2", -3f);
                        var attacker = s.Units.Where(u => u.Owner == e.Player && u.AttackedThisTurn).OrderBy(u => s.Map.Distance(u.Tile, e.Tile)).FirstOrDefault();
                        if (attacker != null) _map.Units.Attack(attacker.Id, HexLayout.ToWorld(s.Map.CoordOf(e.Tile), 0));
                    }
                    break;
            }
        }
    }

    public HexMapView MapView => _map;

    public void ToggleMenu() => _menu.Visible = !_menu.Visible;

    /// <summary>Top-bar buttons share the hotkeys' behaviour.</summary>
    public void ToggleByKey(string key)
    {
        if (key == "T") ToggleResearch();
        else if (key == "L") { _supplyLens = !_supplyLens; if (State is { } s) _map.RenderSupply(s, LocalPlayer, _supplyLens); }
        else if (key == "R") _overlay.ResourceLens = !_overlay.ResourceLens;
        else TogglePanel(key);
    }

    /// <summary>Units the player has passed over this turn (Space / Skip): they stop asking for orders until next turn.</summary>
    private readonly HashSet<int> _skipped = new();
    private int _skippedTurn = -1;

    public bool IsSkipped(GameState s, int unitId)
    {
        if (_skippedTurn != s.Turn) { _skipped.Clear(); _skippedTurn = s.Turn; }
        return _skipped.Contains(unitId);
    }

    /// <summary>Space: pass over the selected unit for this turn, then select the next one still waiting.</summary>
    public void SkipUnit()
    {
        var s = State;
        if (s == null) return;
        IsSkipped(s, -1);   // roll the set over on a new turn
        if (SelectedUnit >= 0 && s.GetUnit(SelectedUnit) is { } u && u.Owner == LocalPlayer) _skipped.Add(u.Id);
        SelectNextUnit();
    }

    /// <summary>Cycles through your units that still have moves, no orders and were not skipped this turn.</summary>
    public void SelectNextUnit()
    {
        var s = State;
        if (s == null) return;
        var ready = s.Units.Where(u => u.Owner == LocalPlayer && u.MovesLeft > Sim.Core.Fx.Zero && u.Destination < 0 && !u.Fortified && !IsSkipped(s, u.Id))
                           .OrderBy(u => u.Id).ToList();
        if (ready.Count == 0) { SelectedUnit = -1; _selectedTile = -1; _renderedVersion = -1; return; }
        var next = ready.FirstOrDefault(u => u.Id > SelectedUnit) ?? ready[0];
        SelectUnit(next.Id);
    }

    // ----- Save / load ---------------------------------------------------------------------------

    private static string QuickSavePath => ProjectSettings.GlobalizePath("user://saves/quicksave.uasave");

    public void QuickSave()
    {
        var s = State;
        if (s == null) return;
        SaveGame.WriteFile(QuickSavePath, s, LocalPlayer);
        _feed.Note($"Saved (turn {s.Turn}).");
    }

    public void QuickLoad()
    {
        if (_host != null || _client != null) { _feed.Note("⚠ Loading is single-player for now; the host can save and restart from it."); return; }
        if (!System.IO.File.Exists(QuickSavePath)) { _feed.Note("⚠ No quicksave yet (F5 saves)."); return; }
        try
        {
            var (state, local) = SaveGame.ReadFile(QuickSavePath, Db);
            _local = state;
            LocalPlayer = local;
            OnGameStarted();
            _feed.Note($"Loaded (turn {state.Turn}).");
        }
        catch (Exception ex) when (ex is InvalidDataException or IOException) { _feed.Note($"⚠ Could not load: {ex.Message}"); }
    }

    // ----- Frame loop ----------------------------------------------------------------------------

    public override void _Process(double delta)
    {
        _host?.Poll();
        if (_client != null)
        {
            _client.Poll();
            if (_client.Slot >= 0) LocalPlayer = _client.Slot;
            if (_client.State != null && _lobby.Visible) OnGameStarted();
            if (_client.RejectReason != null) _lobby.ShowWaiting($"Rejected: {_client.RejectReason}");
            if (_client.LastCommandError is { } error) { _feed.Note($"⚠ {error}"); _client.LastCommandError = null; }
        }

        var s = State;
        if (s == null)
        {
            if (_backdrop != null) _camera.Drift((float)delta);
            return;
        }
        long version = (_host?.Seq ?? _client?.LastSeq ?? 0) + s.Turn * 1_000_000L + _localVersion * 7919;
        if (version != _renderedVersion)
        {
            _renderedVersion = version;
            if (s.GetUnit(SelectedUnit) is { } sel) _selectedTile = sel.Tile;
            else if (SelectedUnit >= 0) { SelectedUnit = -1; _selectedTile = -1; }
            _map.Render(s, LocalPlayer, _selectedTile);
            _map.RenderSupply(s, LocalPlayer, _supplyLens);
            if (_cityPanel.Visible) _cityPanel.Refresh();
            _unitPanel.Refresh();
            _topBar.Refresh();
            _tracker.Refresh();
            _turnCorner.Refresh();
            if (_research.Visible) _research.Refresh();
            if (_society.Visible) _society.Refresh();
            if (_espionage.Visible) _espionage.Refresh();
        }
        _victory.Watch();
        _seaTimer -= delta;
        if (_seaTimer <= 0)
        {
            // Surf in the ambience follows how much sea is around where you are looking.
            _seaTimer = 1.0;
            var focus = HexLayout.FromWorld(_camera.Focus);
            int center = s.Map.IndexOf(focus), water = 0, total = 0;
            if (center >= 0)
            {
                var around = new List<int>();
                s.Map.CollectRadius(center, 6, around);
                foreach (int t in around) { total++; if (s.Map.IsWater(t)) water++; }
            }
            _audio.SetSeaShare(total == 0 ? 0 : (float)water / total);
        }
    }

    public override void _UnhandledInput(InputEvent @event)
    {
        var s = State;
        if (s == null) return;
        if (@event is InputEventMouseButton { Pressed: true, ButtonIndex: MouseButton.Left } click)
        {
            int tile = s.Map.IndexOf(_camera.PickHex(click.Position));
            if (tile < 0) return;
            if (_lens.IsActive) { _cityPanel.ConfirmPlacement(tile); return; }
            ClickTile(tile);
        }
        // Right-click with a unit selected: attack what is there if the preview allows it, otherwise move there.
        if (@event is InputEventMouseButton { Pressed: true, ButtonIndex: MouseButton.Right } order)
        {
            int tile = s.Map.IndexOf(_camera.PickHex(order.Position));
            if (tile >= 0) OrderSelectedTo(tile);
        }
        if (@event is InputEventMouseMotion motion)
        {
            int hovered = s.Map.IndexOf(_camera.PickHex(motion.Position));
            if (_lens.IsActive) _lens.Hover(hovered);
            _map.Hover(hovered, s.Map);
            if (hovered >= 0 && s.GetUnit(SelectedUnit) is { } attacker && SupplySystem.IsMilitary(s.Db, attacker))
                _tooltip.ShowFor(s, attacker, hovered, motion.Position);
            else _tooltip.Visible = false;
        }
        if (@event is not InputEventKey { Pressed: true, Echo: false } key) return;
        switch (key.Keycode)
        {
            case Key.Enter or Key.KpEnter: Submit(new EndTurnCommand()); break;
            case Key.Space: SkipUnit(); break;
            case Key.B when s.GetUnit(SelectedUnit) is { } settler: Submit(new FoundCityCommand { UnitId = settler.Id }); break;
            case Key.F when s.GetUnit(SelectedUnit) is { } guard: Submit(new FortifyCommand { UnitId = guard.Id }); break;
            case Key.F5: QuickSave(); break;
            case Key.F9: QuickLoad(); break;
            case Key.Escape:
                if (_menu.Visible) _menu.Visible = false;
                else if (_lens.IsActive) _lens.Hide();
                else if (_overlay.ResourceLens) _overlay.ResourceLens = false;
                else if (_research.Visible || _diplomacy.Visible || _chronicle.Visible || _divergence.Visible || _society.Visible || _espionage.Visible) CloseOverlaysExcept(null);
                else if (SelectedUnit >= 0 || _cityPanel.Visible) { SelectedUnit = -1; _selectedTile = -1; _cityPanel.Visible = false; _renderedVersion = -1; }
                else _menu.Visible = true;
                break;
            case Key.R: _overlay.ResourceLens = !_overlay.ResourceLens; break;
            case Key.L:
                _supplyLens = !_supplyLens;
                _map.RenderSupply(s, LocalPlayer, _supplyLens);
                break;
        }
    }

    /// <summary>
    /// Left-click: a city of yours opens first; clicking it again cycles through the units inside and back to the city.
    /// Elsewhere, your units there (cycling through a stack), else just highlight the tile.
    /// </summary>
    public void ClickTile(int tile)
    {
        var s = State!;
        var mine = s.Units.Where(u => u.Tile == tile && u.Owner == LocalPlayer).OrderBy(u => u.Id).ToList();
        var city = s.Cities.FirstOrDefault(c => c.Tile == tile && c.Owner == LocalPlayer);
        bool cityShowing = city != null && _cityPanel.Visible && _selectedTile == tile && SelectedUnit < 0;
        bool unitHere = SelectedUnit >= 0 && mine.Any(u => u.Id == SelectedUnit);
        if (city != null && !cityShowing && !unitHere) { OpenCity(city); return; }
        if (mine.Count > 0)
        {
            var next = unitHere ? mine.FirstOrDefault(u => u.Id > SelectedUnit) : mine[0];
            if (next != null) SelectUnit(next.Id);
            else if (city != null) OpenCity(city);
            else SelectUnit(mine[0].Id);
            return;
        }
        SelectedUnit = -1;
        _selectedTile = tile;
        _cityPanel.Visible = false;
        _renderedVersion = -1;
    }

    public void OpenCity(CityState city)
    {
        SelectedUnit = -1;
        _selectedTile = city.Tile;
        _cityPanel.ShowCity(city.Id);
        _cityPanel.Visible = true;
        _renderedVersion = -1;
    }

    public void OrderSelectedTo(int tile)
    {
        var s = State!;
        if (s.GetUnit(SelectedUnit) is not { } unit) return;
        if (SupplySystem.IsMilitary(s.Db, unit) && CombatSystem.Preview(s, unit, tile).Legal) Submit(new AttackCommand { UnitId = unit.Id, TargetTile = tile });
        else if (Submit(new MoveUnitCommand { UnitId = unit.Id, Destination = tile }).Ok) AudioManager.Sfx(s.Map.IsWater(tile) ? "cloth" : "step", -6f);
        _tooltip.Visible = false;
    }

    /// <summary>Full-screen overlays are exclusive: opening one closes the others.</summary>
    public void CloseOverlaysExcept(Control? keep)
    {
        foreach (Control panel in new Control[] { _research, _diplomacy, _chronicle, _divergence, _society, _espionage })
            if (panel != keep) panel.Visible = false;
    }

    public void ToggleResearch() { _research.Visible = !_research.Visible; if (_research.Visible) { CloseOverlaysExcept(_research); _research.Refresh(); } }
    public void TogglePanel(string which)
    {
        Control panel = which switch { "P" => _diplomacy, "C" => _chronicle, "V" => _divergence, "G" => _society, "E" => _espionage, _ => _research };
        panel.Visible = !panel.Visible;
        if (panel.Visible) CloseOverlaysExcept(panel);
        if (panel.Visible) (panel as DiplomacyPanel)?.Refresh();
        if (panel.Visible) (panel as ChroniclePanel)?.Refresh();
        if (panel.Visible) (panel as DivergencePanel)?.Refresh();
        if (panel.Visible) (panel as SocietyPanel)?.Refresh();
        if (panel.Visible) (panel as EspionagePanel)?.Refresh();
        if (panel.Visible) (panel as ResearchPanel)?.Refresh();
    }
}

/// <summary>Finds the content folder in the editor (../content) or next to an exported executable.</summary>
public static class ContentLocator
{
    public static GameDatabase LoadDatabase()
    {
        string root = OS.HasFeature("editor")
            ? System.IO.Path.GetFullPath(System.IO.Path.Combine(ProjectSettings.GlobalizePath("res://"), ".."))
            : System.IO.Path.GetDirectoryName(OS.GetExecutablePath())!;
        var mods = new List<string> { System.IO.Path.Combine(root, "content", "base") };
        var enabled = System.IO.Path.Combine(OS.GetUserDataDir(), "enabled_mods.txt");
        if (System.IO.File.Exists(enabled))
            mods.AddRange(System.IO.File.ReadAllLines(enabled).Where(l => l.Trim().Length > 0).Select(l => System.IO.Path.Combine(root, "mods", l.Trim())));
        return ModLoader.LoadFromDirectories(mods);
    }
}
