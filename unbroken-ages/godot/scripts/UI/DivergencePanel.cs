using Godot;
using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.UI;

/// <summary>
/// The Divergence screen (V). Before commitment: three columns, each with its creed, its promise
/// (the rational case), its price (the outsider's view), how strongly your own history pulls you
/// toward it, the discounted doctrine cost and the full branch with every quote. Committing asks for
/// confirmation, because it locks the other two branches forever. After commitment: your branch's
/// progress, the two locked branches greyed out, and how much of the world each future has remade.
/// Wireframe: docs/06-ui-ux-wireframes.md §5b.
/// </summary>
public partial class DivergencePanel : PanelContainer
{
    private readonly GameRoot _root;
    private HBoxContainer _columns = null!;
    private Label _header = null!, _world = null!;
    private ConfirmationDialog _confirm = null!;
    private int _pendingDoctrine = -1;

    public DivergencePanel(GameRoot root) => _root = root;

    public override void _Ready()
    {
        SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        OffsetLeft = 40; OffsetTop = 40; OffsetRight = -40; OffsetBottom = -40;
        var v = new VBoxContainer();
        AddChild(v);
        _header = new Label { ThemeTypeVariation = "HeaderLarge", AutowrapMode = TextServer.AutowrapMode.WordSmart };
        v.AddChild(_header);
        _columns = new HBoxContainer { SizeFlagsVertical = SizeFlags.ExpandFill };
        v.AddChild(_columns);
        _world = new Label();
        v.AddChild(_world);
        var close = new Button { Text = "Close (V)" };
        close.Pressed += () => Visible = false;
        v.AddChild(close);

        _confirm = new ConfirmationDialog { Title = "Point of no return", OkButtonText = "Commit forever" };
        _confirm.Confirmed += () =>
        {
            if (_pendingDoctrine >= 0) _root.Submit(new SetResearchCommand { Tech = _pendingDoctrine });
            Refresh();
        };
        AddChild(_confirm);
    }

    public void Refresh()
    {
        var s = _root.State;
        if (s == null) return;
        var db = s.Db;
        var me = s.Players[_root.LocalPlayer];
        foreach (var child in _columns.GetChildren()) child.QueueFree();

        bool atThreshold = me.HasTech(db.Techs.IndexOf("TECH_THRESHOLD"));
        _header.Text = me.Divergence >= 0
            ? $"Your people are {db.Divergences[me.Divergence].People}. \"{db.Divergences[me.Divergence].Creed}\""
            : atThreshold ? "THE THRESHOLD — choose what humanity becomes. Two of these futures will close to you forever."
                          : "Beyond the Threshold the tree divides into three futures. Your history is already choosing.";

        var leanings = DivergenceSystem.Leanings(s, me);
        var share = DivergenceSystem.WorldShare(s);
        foreach (var d in db.Divergences)
        {
            bool locked = me.Divergence >= 0 && me.Divergence != d.Index;
            var col = new VBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill, Modulate = locked ? new Color(1, 1, 1, 0.35f) : Colors.White };
            _columns.AddChild(col);
            col.AddChild(new ColorRect { Color = new Color(d.Colors.Primary), CustomMinimumSize = new Vector2(0, 6) });
            col.AddChild(new Label { Text = d.Name.ToUpperInvariant() + (locked ? "  — LOCKED FOREVER" : ""), ThemeTypeVariation = "HeaderMedium" });
            col.AddChild(new Label { Text = $"\"{d.Creed}\"", AutowrapMode = TextServer.AutowrapMode.WordSmart });
            col.AddChild(new Label { Text = "THE PROMISE  " + d.Promise, AutowrapMode = TextServer.AutowrapMode.WordSmart });
            col.AddChild(new Label { Text = "THE PRICE  " + d.Price, AutowrapMode = TextServer.AutowrapMode.WordSmart, Modulate = new Color("#ff9a9a") });

            var lean = leanings[d.Index];
            col.AddChild(new Label { Text = $"Your history leans {(lean.Share * 100).RoundToInt()}% this way" });
            col.AddChild(new ProgressBar { MinValue = 0, MaxValue = 1, Value = lean.Share.ToDouble(), ShowPercentage = false, CustomMinimumSize = new Vector2(0, 10) });
            foreach (var src in lean.Sources.OrderByDescending(x => x.Points).Take(4))
                col.AddChild(new Label { Text = $"   • {src.Label} (+{src.Points})" });

            var doctrine = db.Techs[d.DoctrineTechIndex];
            if (me.Divergence < 0)
            {
                var cost = ResearchSystem.Cost(s, me, doctrine);
                var button = new Button { Text = $"Research {doctrine.Name}  ({cost.FloorToInt()} ⚗)", Disabled = !ResearchSystem.CanResearch(me, doctrine) };
                button.Pressed += () =>
                {
                    _pendingDoctrine = doctrine.Index;
                    _confirm.DialogText = $"Commit to the {d.Name}?\n\n{doctrine.Quote}\n\nThe other two branches will lock forever.";
                    _confirm.PopupCentered();
                };
                col.AddChild(button);
            }

            col.AddChild(new HSeparator());
            foreach (var t in db.Techs.Where(t => t.DivergenceIndex == d.Index).OrderBy(t => t.Cost).ThenBy(t => t.Index))
            {
                string mark = me.HasTech(t.Index) ? "✔" : locked ? "✖" : "○";
                col.AddChild(new Label
                {
                    Text = $"{mark} {t.Name}", TooltipText = $"{t.Quote}\n\n{t.Description}",
                    MouseFilter = MouseFilterEnum.Stop,
                });
            }
            col.AddChild(new Label { Text = $"World remade: {share[d.Index]:0.#}%" });
        }

        _world.Text = "Engineered Ground (pale grid) · the Bloom (bioluminescent) · Substrate (black glass). The longer a future runs, the less the Earth looks like Earth.";
    }

    public override void _UnhandledInput(InputEvent @event)
    {
        if (@event is InputEventKey { Pressed: true, Keycode: Key.V })
        {
            Visible = !Visible;
            if (Visible) { _root.CloseOverlaysExcept(this); Refresh(); }
        }
    }
}
