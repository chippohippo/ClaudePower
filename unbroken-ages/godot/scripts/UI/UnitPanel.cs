using Godot;
using UnbrokenAges.Client.Hud;
using UnbrokenAges.Client.Map;
using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.UI;

/// <summary>
/// The selected unit (bottom-left, Civ VI layout): a portrait medallion in the owner's colour with the unit-type icon, the
/// name with its variant, strength / ranged / moves / health as icon stats, and every action available here as a button
/// with its hotkey. Impossible actions stay visible but disabled, with the host's own reason as the tooltip.
/// Right-click on the map moves or attacks; hovering an enemy shows the combat preview first.
/// </summary>
public partial class UnitPanel : PanelContainer
{
    private readonly GameRoot _root;
    private Label _title = null!, _subtitle = null!;
    private HBoxContainer _stats = null!;
    private HFlowContainer _actions = null!;
    private PanelContainer _portrait = null!;
    private TextureRect _portraitIcon = null!;
    private ProgressBar _hp = null!;

    public UnitPanel(GameRoot root) => _root = root;

    public override void _Ready()
    {
        SetAnchorsAndOffsetsPreset(LayoutPreset.BottomLeft);
        GrowVertical = GrowDirection.Begin;
        CustomMinimumSize = new Vector2(470, 0);
        OffsetLeft = 12; OffsetBottom = -12;
        var h = new HBoxContainer();
        h.AddThemeConstantOverride("separation", 14);
        AddChild(h);
        _portrait = new PanelContainer { CustomMinimumSize = new Vector2(84, 84) };
        _portraitIcon = Icons.Rect("strength", Colors.White, 48);
        _portrait.AddChild(_portraitIcon);
        h.AddChild(_portrait);
        var v = new VBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        v.AddThemeConstantOverride("separation", 5);
        h.AddChild(v);
        _title = new Label { ThemeTypeVariation = "HeaderMedium" };
        v.AddChild(_title);
        _subtitle = new Label { ThemeTypeVariation = "Caption" };
        v.AddChild(_subtitle);
        _stats = new HBoxContainer();
        _stats.AddThemeConstantOverride("separation", 16);
        v.AddChild(_stats);
        _hp = new ProgressBar { ShowPercentage = false, CustomMinimumSize = new Vector2(0, 6), MaxValue = 100 };
        _hp.AddThemeStyleboxOverride("fill", UiTheme.Box(new Color("#59d16b"), new Color("#59d16b"), 0, 3, 0));
        v.AddChild(_hp);
        _actions = new HFlowContainer();
        _actions.AddThemeConstantOverride("h_separation", 6);
        _actions.AddThemeConstantOverride("v_separation", 6);
        v.AddChild(_actions);
        Visible = false;
    }

    public void Refresh()
    {
        var s = _root.State;
        if (s?.GetUnit(_root.SelectedUnit) is not { } u || u.Owner != _root.LocalPlayer) { Visible = false; return; }
        Visible = true;
        var def = s.Db.Units[u.DefIndex];
        var civ = HexMapView.CivColor(s, u.Owner);
        _portrait.AddThemeStyleboxOverride("panel", UiTheme.Box(civ.Darkened(0.45f), UiTheme.GoldBright, 3, 42, 14));
        _portraitIcon.Texture = Icons.Get(MapOverlay.UnitIcon(def));
        _title.Text = UnitStats.Name(s, u).ToUpperInvariant();
        _subtitle.Text = (def.Domain == Sim.Data.UnitDomain.Civilian ? "Civilian" : def.UnitClass) +
                         (u.Fortified ? " · Fortified" : "") + (u.Destination >= 0 ? " · En route" : "") + (u.Charges > 0 ? $" · {u.Charges} build charges" : "") +
                         (SupplySystem.IsMilitary(s.Db, u) ? $" · XP {u.Experience}/{SocietySystem.ExperienceFor(u.Promotions.Count)}" : "") +
                         (u.Promotions.Count > 0 ? " · " + string.Join(", ", u.Promotions.Select(p => s.Db.Promotions[p].Name)) : "");
        foreach (var c in _stats.GetChildren()) c.QueueFree();
        if (def.Strength > 0) _stats.AddChild(Icons.Stat("strength", UiTheme.Text, UnitStats.Strength(s, u).ToString(), out _, 18, "Combat strength"));
        if (UnitStats.IsRanged(s, u)) _stats.AddChild(Icons.Stat("arrow", UiTheme.Text, $"{UnitStats.RangedStrength(s, u)} · range {UnitStats.Range(s, u)}", out _, 18, "Ranged strength and range"));
        _stats.AddChild(Icons.Stat("moves", UiTheme.Text, $"{u.MovesLeft.FloorToInt()}/{UnitStats.Moves(s, u)}", out _, 18, "Moves left this turn"));
        _stats.AddChild(Icons.Stat("defense", new Color("#8fe09c"), $"{u.Hp}/100", out _, 18, "Health"));
        _hp.Value = u.Hp;

        foreach (var child in _actions.GetChildren()) child.QueueFree();
        if (def.FoundsCity) Action("home", "Found City", "B", new FoundCityCommand { UnitId = u.Id });
        if (def.FoundsOutpost) Action("watchtower", "Plant Outpost", "", new FoundOutpostCommand { UnitId = u.Id });
        if (def.Charges > 0)
        {
            var player = s.Players[u.Owner];
            foreach (var imp in s.Db.Improvements)
            {
                if (!player.HasTech(imp.PrereqTechIndex)) continue;
                if (ImprovementRules.Validate(s, player, imp, u.Tile) is { } why && why.StartsWith("Invalid")) continue;
                Action(imp.Id.Contains("FARM") ? "farm" : imp.Id.Contains("MINE") ? "iron" : "production", imp.Name, "", new BuildImprovementCommand { UnitId = u.Id, Improvement = imp.Index });
            }
        }
        if (ReligionSystem.IsMissionary(def)) Action("faith", "Spread Religion", "", new SpreadReligionCommand { UnitId = u.Id });
        if (TradeSystem.IsTrader(def))
        {
            var options = TradeSystem.Options(s, u);
            if (options.Count == 0)
                _subtitle.Text += TradeSystem.OriginOf(s, u) == null ? " · move into one of your cities to trade"
                                : $" · no route open ({TradeSystem.Active(s, u.Owner)}/{TradeSystem.Capacity(s, s.Players[u.Owner])} slots)";
            foreach (var (city, yields, influence, _) in options.Take(6))
            {
                string pays = string.Join(" ", Sim.Data.YieldSet.All.Where(y => yields[y] != Sim.Core.Fx.Zero).Select(y => $"+{yields[y].FloorToInt()} {y}")) +
                              (influence > 0 ? $" +{influence} influence" : "");
                Action("gold", $"→ {city.Name}: {pays}", "", new EstablishTradeRouteCommand { UnitId = u.Id, DestinationCity = city.Id },
                       $"A {TradeSystem.Duration}-turn trade route to {city.Name} ({s.Players[city.Owner].Name}).");
            }
        }
        if (SupplySystem.IsMilitary(s.Db, u))
        {
            Action("defense", u.Fortified ? "Fortified" : "Fortify", "F", new FortifyCommand { UnitId = u.Id });
            foreach (var partner in s.Units.Where(o => o.Owner == u.Owner && o.Id != u.Id && o.DefIndex == u.DefIndex && s.Map.Distance(o.Tile, u.Tile) <= 1))
            {
                int next = Math.Max(u.Formation, partner.Formation) + 1;
                if (next > 2) continue;
                Action("strength", $"Form {SocietySystem.FormationName[next]} (+{SocietySystem.FormationStrength[next]})", "", new FormCorpsCommand { UnitId = u.Id, PartnerId = partner.Id },
                       "Merge the two into one stronger unit.");
                break;
            }
            if (SocietySystem.CanPromote(s, u))
                foreach (var promo in SocietySystem.Available(s, u))
                    Action("crown", $"Promote: {promo.Name}", "", new PromoteUnitCommand { UnitId = u.Id, Promotion = promo.Index }, promo.Description);
            foreach (int target in UpgradeSystem.Targets(s, u))
            {
                var variants = UnitStats.VariantsOf(s.Db, target);
                if (variants.Count == 0) Action("crown", $"Upgrade → {s.Db.Units[target].Name}", "", new UpgradeUnitCommand { UnitId = u.Id, Target = target, Variant = -1 },
                                                $"{UpgradeSystem.GoldCost(s, u, target, -1)} gold");
                for (int v = 0; v < variants.Count; v++)
                    Action("crown", $"{variants[v].Name} {s.Db.Units[target].Name}", "", new UpgradeUnitCommand { UnitId = u.Id, Target = target, Variant = v },
                           $"Upgrade: {variants[v].Description} · {UpgradeSystem.GoldCost(s, u, target, v)} gold");
            }
        }
        var skip = Icons.Button("arrow", "Next", UiTheme.TextDim, _root.SelectNextUnit, "Next unit (Space)");
        _actions.AddChild(skip);
    }

    private void Action(string icon, string label, string key, GameCommand cmd, string? info = null)
    {
        var s = _root.State!;
        cmd.Player = _root.LocalPlayer;
        string? why = cmd.Validate(s);
        var b = Icons.Button(icon, key.Length > 0 ? $"{label} ({key})" : label, UiTheme.GoldBright, () => _root.Submit(cmd), why ?? info ?? "");
        b.Disabled = why != null;
        _actions.AddChild(b);
    }
}
