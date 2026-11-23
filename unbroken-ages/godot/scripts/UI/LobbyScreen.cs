using Godot;
using UnbrokenAges.Net;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.UI;

/// <summary>
/// Front-end: Single Player / Host (Direct IP) / Join (Direct IP) / LAN browser.
/// No account, launcher or online service is involved in any of these paths.
/// Wireframe: docs/06-ui-ux-wireframes.md §5.
/// </summary>
public partial class LobbyScreen : PanelContainer
{
    private readonly GameRoot _root;
    private LineEdit _name = null!, _address = null!, _password = null!;
    private SpinBox _port = null!, _humans = null!, _ais = null!, _seed = null!;
    private OptionButton _mapSize = null!, _disasters = null!, _pacing = null!;
    private ItemList _lanGames = null!;
    private Label _message = null!;
    private Button _launch = null!;
    private LanBrowser? _browser;
    private double _lanRefresh;
    private readonly List<string> _lanAddresses = new();

    public LobbyScreen(GameRoot root) => _root = root;

    public override void _Ready()
    {
        SetAnchorsAndOffsetsPreset(LayoutPreset.Center);
        CustomMinimumSize = new Vector2(720, 540);
        GrowHorizontal = GrowDirection.Both;
        GrowVertical = GrowDirection.Both;
        OffsetLeft = -360; OffsetRight = 360; OffsetTop = -230; OffsetBottom = 310;
        AddThemeStyleboxOverride("panel", UiTheme.Box(new Color(UiTheme.Navy, 0.9f), UiTheme.Gold, 2, 10, 18));
        var v = new VBoxContainer();
        v.AddThemeConstantOverride("separation", 8);
        AddChild(v);
        var title = new Label { Text = "UNBROKEN AGES", HorizontalAlignment = HorizontalAlignment.Center, ThemeTypeVariation = "HeaderLarge" };
        title.AddThemeFontSizeOverride("font_size", 40);
        title.AddThemeColorOverride("font_outline_color", new Color(0, 0, 0, 0.7f));
        title.AddThemeConstantOverride("outline_size", 6);
        v.AddChild(title);
        v.AddChild(new Label { Text = "One people. Every age.", HorizontalAlignment = HorizontalAlignment.Center, ThemeTypeVariation = "Caption" });
        v.AddChild(new HSeparator());

        _name = new LineEdit { Text = System.Environment.UserName, PlaceholderText = "Your name" };
        v.AddChild(Labeled("Name", _name));

        var tabs = new TabContainer { SizeFlagsVertical = SizeFlags.ExpandFill };
        v.AddChild(tabs);

        // --- Game setup (shared by single player and host) ---
        var setup = new VBoxContainer { Name = "New Game" };
        tabs.AddChild(setup);
        _mapSize = new OptionButton();
        foreach (var size in _root.Db.MapSizes) _mapSize.AddItem($"{size.Name} ({size.Width}×{size.Height})");
        _mapSize.Selected = Math.Min(1, _root.Db.MapSizes.Count - 1);
        setup.AddChild(Labeled("Map size", _mapSize));
        _humans = new SpinBox { MinValue = 1, MaxValue = 12, Value = 1 };
        setup.AddChild(Labeled("Human players", _humans));
        _ais = new SpinBox { MinValue = 0, MaxValue = 11, Value = 3 };
        setup.AddChild(Labeled("AI players", _ais));
        _disasters = new OptionButton();
        foreach (var d in new[] { "Off", "Gentle", "Standard", "Intense", "Cataclysmic" }) _disasters.AddItem(d);
        _disasters.Selected = 2;
        setup.AddChild(Labeled("Disasters & climate", _disasters));
        _pacing = new OptionButton();
        foreach (var p in new[] { "Standard eras (100%)", "Extended eras (150%)", "Epic eras (200%)" }) _pacing.AddItem(p);
        setup.AddChild(Labeled("Era pacing", _pacing));
        _seed = new SpinBox { MinValue = 0, MaxValue = int.MaxValue, Value = 0, Prefix = "Seed" };
        setup.AddChild(Labeled("Map seed (0 = random)", _seed));
        var spButtons = new HBoxContainer();
        setup.AddChild(spButtons);
        spButtons.AddChild(MakeButton("Start Single Player / Hotseat", () => _root.StartSinglePlayer(BuildSetup())));

        // --- Host ---
        var host = new VBoxContainer { Name = "Host (Direct IP)" };
        tabs.AddChild(host);
        _port = new SpinBox { MinValue = 1024, MaxValue = 65535, Value = Protocol.DefaultPort };
        host.AddChild(Labeled("Port (forward TCP on your router for internet games)", _port));
        _password = new LineEdit { Secret = true, PlaceholderText = "optional" };
        host.AddChild(Labeled("Password", _password));
        host.AddChild(MakeButton("Open Lobby", () => _root.HostGame(BuildSetup(), (int)_port.Value, _password.Text.Length > 0 ? _password.Text : null)));
        _launch = MakeButton("Launch Game", _root.LaunchHostedGame);
        _launch.Disabled = true;
        host.AddChild(_launch);

        // --- Join ---
        var join = new VBoxContainer { Name = "Join (Direct IP)" };
        tabs.AddChild(join);
        _address = new LineEdit { PlaceholderText = "203.0.113.7  ·  203.0.113.7:47620  ·  [2001:db8::1]:47620" };
        join.AddChild(Labeled("Host address", _address));
        var joinPassword = new LineEdit { Secret = true, PlaceholderText = "if required" };
        join.AddChild(Labeled("Password", joinPassword));
        join.AddChild(MakeButton("Join", () =>
        {
            if (!DirectIpEndpoint.TryParse(_address.Text, out var ep)) { _message.Text = "That doesn't look like an address."; return; }
            _root.JoinGame(ep, _name.Text, joinPassword.Text.Length > 0 ? joinPassword.Text : null);
        }));

        // --- LAN ---
        var lan = new VBoxContainer { Name = "LAN" };
        tabs.AddChild(lan);
        _lanGames = new ItemList { CustomMinimumSize = new Vector2(0, 220) };
        lan.AddChild(_lanGames);
        lan.AddChild(MakeButton("Join selected", () =>
        {
            var sel = _lanGames.GetSelectedItems();
            if (sel.Length == 0 || !DirectIpEndpoint.TryParse(_lanAddresses[sel[0]], out var ep)) return;
            _root.JoinGame(ep, _name.Text, null);
        }));

        _message = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart };
        v.AddChild(_message);

        try { _browser = new LanBrowser(); }
        catch (System.Net.Sockets.SocketException) { _message.Text = "LAN discovery unavailable (port in use); Direct IP still works."; }
    }

    public override void _Process(double delta)
    {
        if (_browser == null || !Visible) return;
        _lanRefresh += delta;
        if (_lanRefresh < 1) return;
        _lanRefresh = 0;
        _lanGames.Clear();
        _lanAddresses.Clear();
        foreach (var (address, b) in _browser.Games())
        {
            bool compatible = b.ProtocolVersion == Protocol.Version && b.ContentHash == _root.Db.ContentHash;
            _lanGames.AddItem($"{b.GameName}  {b.Players}/{b.MaxPlayers}{(b.HasPassword ? "  🔒" : "")}{(compatible ? "" : "  (different mods/version)")}");
            _lanAddresses.Add(address);
        }
    }

    public void ShowWaiting(string text)
    {
        _message.Text = text;
        _launch.Disabled = false;
    }

    private GameSetup BuildSetup()
    {
        var size = _root.Db.MapSizes[Math.Max(0, _mapSize.Selected)];
        int humans = (int)_humans.Value, ais = (int)_ais.Value;
        var leaders = _root.Db.Leaders.Select(l => l.Id).ToList();
        ulong seed = _seed.Value > 0 ? (ulong)_seed.Value : (ulong)System.Environment.TickCount64;
        return new GameSetup
        {
            Seed = seed,
            Map = new MapGenSettings { Width = size.Width, Height = size.Height, GreatRivers = size.GreatRivers, Seed = seed },
            Options = new GameOptions
            {
                DisasterIntensity = _disasters.Selected,
                ClimateEnabled = _disasters.Selected > 0,
                EraPacingPercent = new[] { 100, 150, 200 }[Math.Max(0, _pacing.Selected)],
            },
            Players = Enumerable.Range(0, humans + ais).Select(i => new PlayerSetup
            {
                Name = i == 0 ? _name.Text : i < humans ? $"Player {i + 1}" : $"AI {i + 1}",
                IsHuman = i < humans,
                Leader = leaders[i % leaders.Count],
            }).ToList(),
        };
    }

    private static Control Labeled(string label, Control control)
    {
        var h = new HBoxContainer();
        h.AddChild(new Label { Text = label, CustomMinimumSize = new Vector2(260, 0) });
        control.SizeFlagsHorizontal = SizeFlags.ExpandFill;
        h.AddChild(control);
        return h;
    }

    private static Button MakeButton(string text, Action onPressed)
    {
        var b = new Button { Text = text };
        b.Pressed += onPressed;
        return b;
    }

    public override void _ExitTree() => _browser?.Dispose();
}
