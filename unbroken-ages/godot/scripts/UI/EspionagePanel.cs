using Godot;
using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.UI;

/// <summary>
/// The Espionage screen (E): every spy with its rank, where it is and what it is doing. An idle spy can be sent on any mission
/// that is possible now; each choice shows its odds against the city's defences before you commit. Busy spies can be recalled.
/// </summary>
public partial class EspionagePanel : PanelContainer
{
    private readonly GameRoot _root;
    private VBoxContainer _rows = null!;
    private Label _header = null!;

    public EspionagePanel(GameRoot root) => _root = root;

    public override void _Ready()
    {
        SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        OffsetLeft = 60; OffsetTop = 60; OffsetRight = -60; OffsetBottom = -60;
        var v = new VBoxContainer();
        AddChild(v);
        _header = new Label { ThemeTypeVariation = "HeaderLarge", AutowrapMode = TextServer.AutowrapMode.WordSmart };
        v.AddChild(_header);
        var scroll = new ScrollContainer { SizeFlagsVertical = SizeFlags.ExpandFill, HorizontalScrollMode = ScrollContainer.ScrollMode.Disabled };
        v.AddChild(scroll);
        _rows = new VBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        _rows.AddThemeConstantOverride("separation", 10);
        scroll.AddChild(_rows);
        var close = new Button { Text = "Close (E)" };
        close.Pressed += () => Visible = false;
        v.AddChild(close);
    }

    public void Refresh()
    {
        var s = _root.State;
        if (s == null) return;
        var me = s.Players[_root.LocalPlayer];
        foreach (var child in _rows.GetChildren()) child.QueueFree();
        _header.Text = $"ESPIONAGE · {me.Spies.Count} of {EspionageSystem.Capacity(s, me)} spies";
        _rows.AddChild(new Label { Text = "Recorded History, Urbanization and Environmentalism each add a spy, and so does the Spymaster's network. " +
                                          "Odds fall by 12% for each level of a city's defence (counterintelligence spies, the Spymaster).",
                                   AutowrapMode = TextServer.AutowrapMode.WordSmart, Modulate = UiTheme.TextDim });
        if (me.Spies.Count == 0)
        {
            _rows.AddChild(new Label { Text = "No spies yet. Complete Recorded History to recruit your first.", AutowrapMode = TextServer.AutowrapMode.WordSmart });
            return;
        }
        foreach (var spy in me.Spies)
        {
            var card = new PanelContainer();
            card.AddThemeStyleboxOverride("panel", UiTheme.Box(new Color(0.08f, 0.1f, 0.14f, 0.9f), UiTheme.Gold, 1, 6, 10));
            _rows.AddChild(card);
            var v = new VBoxContainer();
            card.AddChild(v);
            var city = s.GetCity(spy.CityId);
            string where = spy.Mission == SpyMission.None ? "at home, awaiting orders"
                         : spy.Mission == SpyMission.Counterintelligence ? $"guarding {city?.Name}"
                         : $"{EspionageSystem.Info(spy.Mission).Name} in {city?.Name} · {spy.TurnsLeft} turns · {(city != null ? EspionageSystem.SuccessChance(s, spy, city) : 0)}% odds";
            var head = new HBoxContainer();
            head.AddChild(new Label { Text = $"{spy.Name} — {EspionageSystem.Ranks[spy.Level]} · {where}", SizeFlagsHorizontal = SizeFlags.ExpandFill });
            if (spy.Mission != SpyMission.None) head.AddChild(Button("Recall", new AssignSpyCommand { SpyId = spy.Id, Mission = SpyMission.None }));
            v.AddChild(head);
            if (spy.Mission != SpyMission.None) continue;

            // Every mission possible now, best odds first.
            var options = new List<(CityState City, SpyMission Mission, int Chance)>();
            foreach (var c in s.Cities)
                foreach (SpyMission m in Enum.GetValues<SpyMission>())
                {
                    if (m == SpyMission.None || EspionageSystem.CanAssign(s, me, spy.Id, c.Id, m) != null) continue;
                    int chance = m == SpyMission.Counterintelligence ? 100 : EspionageSystem.SuccessChance(s, new SpyState { Level = spy.Level, Mission = m }, c);
                    options.Add((c, m, chance));
                }
            var flow = new HFlowContainer();
            flow.AddThemeConstantOverride("h_separation", 6);
            v.AddChild(flow);
            // The best three cities for each mission (guarding: the three largest of your own).
            var shown = options.GroupBy(o => o.Mission).OrderBy(g => g.Key == SpyMission.Counterintelligence ? 1 : 0).ThenBy(g => g.Key)
                               .SelectMany(g => g.OrderByDescending(o => o.Chance).ThenByDescending(o => o.City.Population).ThenBy(o => o.City.Id).Take(3));
            foreach (var (c, m, chance) in shown)
            {
                var info = EspionageSystem.Info(m);
                var b = Button(m == SpyMission.Counterintelligence ? $"Guard {c.Name}" : $"{info.Name}: {c.Name} ({chance}%)",
                               new AssignSpyCommand { SpyId = spy.Id, CityId = c.Id, Mission = m });
                b.TooltipText = $"{info.Description}" + (m == SpyMission.Counterintelligence ? "" : $" Takes {info.Turns} turns after travelling.");
                flow.AddChild(b);
            }
            if (options.Count == 0) v.AddChild(new Label { Text = "No missions possible: find foreign cities first.", Modulate = UiTheme.TextDim });
        }
    }

    private Button Button(string text, GameCommand cmd)
    {
        cmd.Player = _root.LocalPlayer;
        string? why = cmd.Validate(_root.State!);
        var b = new Button { Text = text, Disabled = why != null, TooltipText = why ?? "" };
        b.Pressed += () => { _root.Submit(cmd); Refresh(); };
        return b;
    }

    public override void _UnhandledInput(InputEvent @event)
    {
        if (@event is InputEventKey { Pressed: true, Keycode: Key.E })
        {
            Visible = !Visible;
            if (Visible) { _root.CloseOverlaysExcept(this); Refresh(); }
        }
    }
}
