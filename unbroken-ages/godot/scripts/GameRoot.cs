using Godot;
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
    private ChroniclePanel _chronicle = null!;
    private DiplomacyPanel _diplomacy = null!;
    private VictoryPanel _victory = null!;
    private CombatTooltip _tooltip = null!;
    private UnitPanel _unitPanel = null!;
    private ResearchPanel _research = null!;
    private NotificationFeed _feed = null!;
    private TurnBar _turnBar = null!;
    private bool _supplyLens;
    private Label _status = null!;

    public GameState? State => _host?.State ?? _client?.State ?? _local;
    public StrategyCamera Camera => _camera;

    public override void _Ready()
    {
        Db = ContentLocator.LoadDatabase();

        AddChild(new DirectionalLight3D { RotationDegrees = new Vector3(-55, 35, 0), ShadowEnabled = true, LightEnergy = 1.1f });
        AddChild(new WorldEnvironment { Environment = new Godot.Environment
        {
            BackgroundMode = Godot.Environment.BGMode.Color, BackgroundColor = new Color("#0b0f14"),
            AmbientLightSource = Godot.Environment.AmbientSource.Color, AmbientLightColor = new Color("#8899aa"), AmbientLightEnergy = 0.6f,
        } });
        _camera = new StrategyCamera();
        AddChild(_camera);
        _map = new HexMapView();
        AddChild(_map);
        _lens = new PlacementLens();
        AddChild(_lens);

        var theme = UiTheme.Build();
        var ui = new CanvasLayer();
        AddChild(ui);
        _status = new Label { Position = new Vector2(16, 12) };
        ui.AddChild(_status);
        _feed = new NotificationFeed(this);
        ui.AddChild(_feed);
        _cityPanel = new CityPanel(this, _lens) { Visible = false };
        ui.AddChild(_cityPanel);
        _unitPanel = new UnitPanel(this);
        ui.AddChild(_unitPanel);
        _turnBar = new TurnBar(this) { Visible = false };
        ui.AddChild(_turnBar);
        _research = new ResearchPanel(this);
        ui.AddChild(_research);
        _lobby = new LobbyScreen(this);
        ui.AddChild(_lobby);
        _divergence = new DivergencePanel(this) { Visible = false };
        ui.AddChild(_divergence);
        _chronicle = new ChroniclePanel(this) { Visible = false };
        ui.AddChild(_chronicle);
        _diplomacy = new DiplomacyPanel(this) { Visible = false };
        ui.AddChild(_diplomacy);
        _victory = new VictoryPanel(this);
        ui.AddChild(_victory);
        _tooltip = new CombatTooltip();
        ui.AddChild(_tooltip);
        // Themes do not pass through a CanvasLayer, so each top-level control gets it directly.
        foreach (var child in ui.GetChildren()) if (child is Control control) control.Theme = theme;
        StartAutomation();
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
        _host.EventsRaised += events => _feed.Add(_host.State!, events);
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
        _client.EventsRaised += events => _feed.Add(_client.State!, events);
        _client.Connect();
        _lobby.ShowWaiting($"Connected to {endpoint}. Waiting for the host to start...");
    }

    private void OnGameStarted()
    {
        _lobby.Visible = false;
        _turnBar.Visible = true;
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
            foreach (var p in _local.Players.Where(p => !p.IsHuman && !p.IsFreeCities && p.IsAlive).ToList())
                foreach (var aiCmd in ai.TakeTurn(_local, p.Id)) CommandProcessor.Execute(_local, aiCmd, events);
            CommandProcessor.Execute(_local, new AdvanceTurnCommand { Player = GameCommand.SystemPlayer, ExpectedTurn = _local.Turn }, events);
            SelectNextUnit();
        }
        _feed.Add(_local, events);
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
        }
        _renderedVersion = -1;
    }

    /// <summary>Cycles through your units that still have moves and no orders.</summary>
    public void SelectNextUnit()
    {
        var s = State;
        if (s == null) return;
        var ready = s.Units.Where(u => u.Owner == LocalPlayer && u.MovesLeft > Sim.Core.Fx.Zero && u.Destination < 0 && !u.Fortified)
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
        if (s == null) return;
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
            _turnBar.Refresh();
            if (_research.Visible) _research.Refresh();
        }
        _victory.Watch();
        var p = s.Players[LocalPlayer];
        string future = p.Divergence >= 0 ? $"   {s.Db.Divergences[p.Divergence].People} (V)" : "";
        var (science, culture) = ResearchSystem.Rates(s, p.Id);
        _status.Text = $"Turn {s.Turn} ({Calendar.Format(Calendar.Year(s.Turn, s.Options.GameSpeedPercent))})   Gold {p.Gold.FloorToInt()}   Science {science}   Culture {culture}   " +
                       $"CO2 {s.Climate.Co2Ppm.FloorToInt()} ppm (+{s.Climate.Temperature}°C){future}" +
                       (_client?.PendingCommands.Count > 0 ? "   ⏳ syncing" : "") + (_client?.Paused == true ? "   ⏸ PAUSED" : "") +
                       "\n" + WorldLine(s);
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
            if (hovered >= 0 && s.GetUnit(SelectedUnit) is { } attacker && SupplySystem.IsMilitary(s.Db, attacker))
                _tooltip.ShowFor(s, attacker, hovered, motion.Position);
            else _tooltip.Visible = false;
        }
        if (@event is not InputEventKey { Pressed: true, Echo: false } key) return;
        switch (key.Keycode)
        {
            case Key.Enter or Key.KpEnter: Submit(new EndTurnCommand()); break;
            case Key.Space: SelectNextUnit(); break;
            case Key.B when s.GetUnit(SelectedUnit) is { } settler: Submit(new FoundCityCommand { UnitId = settler.Id }); break;
            case Key.F when s.GetUnit(SelectedUnit) is { } guard: Submit(new FortifyCommand { UnitId = guard.Id }); break;
            case Key.F5: QuickSave(); break;
            case Key.F9: QuickLoad(); break;
            case Key.Escape:
                if (_lens.IsActive) _lens.Hide();
                else if (_research.Visible || _diplomacy.Visible || _chronicle.Visible || _divergence.Visible) CloseOverlaysExcept(null);
                else { SelectedUnit = -1; _selectedTile = -1; _cityPanel.Visible = false; _renderedVersion = -1; }
                break;
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
        else Submit(new MoveUnitCommand { UnitId = unit.Id, Destination = tile });
        _tooltip.Visible = false;
    }

    /// <summary>Full-screen overlays are exclusive: opening one closes the others.</summary>
    public void CloseOverlaysExcept(Control? keep)
    {
        foreach (Control panel in new Control[] { _research, _diplomacy, _chronicle, _divergence })
            if (panel != keep) panel.Visible = false;
    }

    public void ToggleResearch() { _research.Visible = !_research.Visible; if (_research.Visible) { CloseOverlaysExcept(_research); _research.Refresh(); } }
    public void TogglePanel(string which)
    {
        Control panel = which switch { "P" => _diplomacy, "C" => _chronicle, "V" => _divergence, _ => _research };
        panel.Visible = !panel.Visible;
        if (panel.Visible) CloseOverlaysExcept(panel);
        if (panel.Visible) (panel as DiplomacyPanel)?.Refresh();
        if (panel.Visible) (panel as ChroniclePanel)?.Refresh();
        if (panel.Visible) (panel as DivergencePanel)?.Refresh();
        if (panel.Visible) (panel as ResearchPanel)?.Refresh();
    }
}

public partial class GameRoot
{
    /// <summary>One HUD line: the world's age, its currents, and what the next era would bring.</summary>
    private static string WorldLine(GameState s)
    {
        var w = s.World;
        int next = WorldSystem.Forecast(s, w.WorldEra + 1);
        string age = WorldSystem.CurrentAge(s)?.Name ?? "An ordinary age";
        string forecast = next >= 0 ? s.Db.WorldAges[next].Name : "an ordinary age";
        // Dynamic and sequential turns: say whose phase it is (only when there is more than one).
        string phase = s.TurnPhases.Count > 1 ? $"   {TurnPhases.Describe(s)}" : "";
        return $"{age}   Progress {w.Progress.FloorToInt()} · Strife {w.Strife.FloorToInt()} · Calamity {w.Calamity.FloorToInt()}   " +
               $"→ if a new era began now: {forecast}{phase}   [L] supply  [C] chronicle  [P] diplomacy  [V] divergence";
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
