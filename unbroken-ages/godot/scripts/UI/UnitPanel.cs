using Godot;
using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.UI;

/// <summary>
/// The selected unit (bottom-left): what it is, its health, moves and strength, and every action it can take here. An action
/// that is not possible stays visible but disabled, with the host's own reason as its tooltip. Hotkeys: B found city,
/// F fortify, Space next unit. Right-click on the map moves or attacks.
/// </summary>
public partial class UnitPanel : PanelContainer
{
    private readonly GameRoot _root;
    private Label _title = null!, _stats = null!;
    private HFlowContainer _actions = null!;

    public UnitPanel(GameRoot root) => _root = root;

    public override void _Ready()
    {
        SetAnchorsAndOffsetsPreset(LayoutPreset.BottomLeft);
        GrowVertical = GrowDirection.Begin;
        CustomMinimumSize = new Vector2(440, 0);
        OffsetLeft = 12; OffsetBottom = -12;
        var v = new VBoxContainer();
        AddChild(v);
        _title = new Label { ThemeTypeVariation = "HeaderMedium" };
        v.AddChild(_title);
        _stats = new Label { AutowrapMode = TextServer.AutowrapMode.WordSmart };
        v.AddChild(_stats);
        _actions = new HFlowContainer();
        v.AddChild(_actions);
        Visible = false;
    }

    public void Refresh()
    {
        var s = _root.State;
        if (s?.GetUnit(_root.SelectedUnit) is not { } u || u.Owner != _root.LocalPlayer) { Visible = false; return; }
        Visible = true;
        var def = s.Db.Units[u.DefIndex];
        _title.Text = UnitStats.Name(s, u);
        string combat = def.Strength > 0
            ? $"Strength {UnitStats.Strength(s, u)}" + (UnitStats.IsRanged(s, u) ? $" · Ranged {UnitStats.RangedStrength(s, u)} (range {UnitStats.Range(s, u)})" : "")
            : "Civilian";
        _stats.Text = $"{combat} · HP {u.Hp}/100 · Moves {u.MovesLeft.FloorToInt()}/{UnitStats.Moves(s, u)}" +
                      (u.Charges > 0 ? $" · Charges {u.Charges}" : "") + (u.Fortified ? " · Fortified" : "") +
                      (u.Destination >= 0 ? " · En route" : "") + "\nRight-click a tile to move or attack.";

        foreach (var child in _actions.GetChildren()) child.QueueFree();
        if (def.FoundsCity) Action("Found City (B)", new FoundCityCommand { UnitId = u.Id });
        if (def.FoundsOutpost) Action("Plant Outpost", new FoundOutpostCommand { UnitId = u.Id });
        if (def.Charges > 0)
        {
            var player = s.Players[u.Owner];
            foreach (var imp in s.Db.Improvements)
            {
                // Offer what could ever go here; hide improvements of locked tech to keep the row short.
                if (!player.HasTech(imp.PrereqTechIndex)) continue;
                if (ImprovementRules.Validate(s, player, imp, u.Tile) is { } why && why.StartsWith("Invalid")) continue;
                Action($"Build {imp.Name}", new BuildImprovementCommand { UnitId = u.Id, Improvement = imp.Index });
            }
        }
        if (SupplySystem.IsMilitary(s.Db, u))
        {
            Action(u.Fortified ? "Fortified" : "Fortify (F)", new FortifyCommand { UnitId = u.Id });
            foreach (int target in UpgradeSystem.Targets(s, u))
            {
                var variants = UnitStats.VariantsOf(s.Db, target);
                if (variants.Count == 0) Action($"Upgrade → {s.Db.Units[target].Name}", new UpgradeUnitCommand { UnitId = u.Id, Target = target, Variant = -1 },
                                                $"{UpgradeSystem.GoldCost(s, u, target, -1)} gold");
                for (int v = 0; v < variants.Count; v++)
                    Action($"Upgrade → {s.Db.Units[target].Name} ({variants[v].Name})", new UpgradeUnitCommand { UnitId = u.Id, Target = target, Variant = v },
                           $"{variants[v].Description} · {UpgradeSystem.GoldCost(s, u, target, v)} gold");
            }
        }
        var skip = new Button { Text = "Next unit (Space)" };
        skip.Pressed += _root.SelectNextUnit;
        _actions.AddChild(skip);
    }

    private void Action(string label, GameCommand cmd, string? info = null)
    {
        var s = _root.State!;
        cmd.Player = _root.LocalPlayer;
        string? why = cmd.Validate(s);
        var b = new Button { Text = label, Disabled = why != null, TooltipText = why ?? info ?? "" };
        b.Pressed += () => _root.Submit(cmd);
        _actions.AddChild(b);
    }
}
