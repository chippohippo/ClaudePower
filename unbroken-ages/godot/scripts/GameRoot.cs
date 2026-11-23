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
/// </summary>
public partial class GameRoot : Node3D
{
    public GameDatabase Db { get; private set; } = null!;
    public int LocalPlayer { get; private set; }

    private HostSession? _host;
    private ClientSession? _client;
    private GameState? _local;
    private long _renderedVersion = -1;

    private StrategyCamera _camera = null!;
    private HexMapView _map = null!;
    private PlacementLens _lens = null!;
    private CityPanel _cityPanel = null!;
    private LobbyScreen _lobby = null!;
    private DivergencePanel _divergence = null!;
    private ChroniclePanel _chronicle = null!;
    private bool _supplyLens;
    private Label _status = null!;

    public GameState? State => _host?.State ?? _client?.State ?? _local;

    public override void _Ready()
    {
        Db = ContentLocator.LoadDatabase();

        AddChild(new DirectionalLight3D { RotationDegrees = new Vector3(-55, 35, 0), ShadowEnabled = true, LightEnergy = 1.1f });
        AddChild(new WorldEnvironment { Environment = new Godot.Environment
        {
            BackgroundMode = Godot.Environment.BGMode.Color, BackgroundColor = new Color("#0e1a26"),
            AmbientLightSource = Godot.Environment.AmbientSource.Color, AmbientLightColor = new Color("#8899aa"), AmbientLightEnergy = 0.6f,
        } });
        _camera = new StrategyCamera();
        AddChild(_camera);
        _map = new HexMapView();
        AddChild(_map);
        _lens = new PlacementLens();
        AddChild(_lens);

        var ui = new CanvasLayer();
        AddChild(ui);
        _status = new Label { Position = new Vector2(16, 12) };
        ui.AddChild(_status);
        _cityPanel = new CityPanel(this, _lens);
        _cityPanel.Visible = false;
        ui.AddChild(_cityPanel);
        _lobby = new LobbyScreen(this);
        ui.AddChild(_lobby);
        _divergence = new DivergencePanel(this) { Visible = false };
        ui.AddChild(_divergence);
        _chronicle = new ChroniclePanel(this) { Visible = false };
        ui.AddChild(_chronicle);
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
        _client.Connect();
        _lobby.ShowWaiting($"Connected to {endpoint}. Waiting for the host to start...");
    }

    private void OnGameStarted()
    {
        _lobby.Visible = false;
        _cityPanel.Visible = true;
        var s = State!;
        var settler = s.Units.FirstOrDefault(u => u.Owner == LocalPlayer);
        if (settler != null) _camera.LookAtHex(s.Map.CoordOf(settler.Tile));
    }

    // ----- Command routing -----------------------------------------------------------------------

    public CommandResult Submit(GameCommand cmd)
    {
        cmd.Player = LocalPlayer;
        if (_host != null) return _host.SubmitLocal(cmd);
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
            var ai = new UnbrokenAges.Sim.AI.SimpleAi();
            foreach (var p in _local.Players.Where(p => !p.IsHuman && !p.IsFreeCities && p.IsAlive).ToList())
                foreach (var aiCmd in ai.TakeTurn(_local, p.Id)) CommandProcessor.Execute(_local, aiCmd, events);
            CommandProcessor.Execute(_local, new AdvanceTurnCommand { Player = GameCommand.SystemPlayer, ExpectedTurn = _local.Turn }, events);
        }
        return result;
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
        }

        var s = State;
        if (s == null) return;
        long version = (_host?.Seq ?? _client?.LastSeq ?? 0) + s.Turn * 1_000_000L + s.Cities.Count;
        if (version != _renderedVersion)
        {
            _renderedVersion = version;
            _map.Render(s, LocalPlayer);
            _map.RenderSupply(s, LocalPlayer, _supplyLens);
            _cityPanel.Refresh();
        }
        var p = s.Players[LocalPlayer];
        string future = p.Divergence >= 0 ? $"   {s.Db.Divergences[p.Divergence].People} (V)" : "";
        _status.Text = $"Turn {s.Turn}   Gold {p.Gold}   CO2 {s.Climate.Co2Ppm} ppm (+{s.Climate.Temperature}°C, phase {s.Climate.Phase}){future}" +
                       (_client?.PendingCommands.Count > 0 ? "   ⏳ syncing" : "") + (_client?.Paused == true ? "   ⏸ PAUSED" : "") +
                       "\n" + WorldLine(s);
    }

    public override void _UnhandledInput(InputEvent @event)
    {
        var s = State;
        if (s == null) return;
        if (@event is InputEventMouseButton { Pressed: true, ButtonIndex: MouseButton.Left } click)
        {
            var hex = _camera.PickHex(click.Position);
            int tile = s.Map.IndexOf(hex);
            if (tile < 0) return;
            if (_lens.IsActive) { _cityPanel.ConfirmPlacement(tile); return; }
            var city = s.Cities.FirstOrDefault(c => c.Tile == tile && c.Owner == LocalPlayer);
            if (city != null) _cityPanel.ShowCity(city.Id);
            else _map.Select(tile);
        }
        if (@event is InputEventMouseMotion motion && _lens.IsActive)
            _lens.Hover(s.Map.IndexOf(_camera.PickHex(motion.Position)));
        if (@event is InputEventKey { Pressed: true, Keycode: Key.Enter })
            Submit(new EndTurnCommand());
        if (@event is InputEventKey { Pressed: true, Keycode: Key.Escape } && _lens.IsActive)
            _lens.Hide();
        if (@event is InputEventKey { Pressed: true, Keycode: Key.L })
        {
            _supplyLens = !_supplyLens;
            _map.RenderSupply(s, LocalPlayer, _supplyLens);
        }
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
        return $"{age}   Progress {w.Progress.FloorToInt()} · Strife {w.Strife.FloorToInt()} · Calamity {w.Calamity.FloorToInt()}   " +
               $"→ if a new era began now: {forecast}   [L] supply  [C] chronicle  [V] divergence";
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
