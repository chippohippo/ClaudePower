using Godot;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.UI;

/// <summary>
/// Combat preview tooltip: while a military unit is selected, hovering an enemy shows the verdict, both strengths, damage
/// ranges, warnings and every modifier (the same CombatSystem.Preview the host resolves). Right-click attacks.
/// Wireframe: docs/06-ui-ux-wireframes.md §7c.
/// </summary>
public partial class CombatTooltip : PanelContainer
{
    private Label _text = null!;

    public override void _Ready()
    {
        MouseFilter = MouseFilterEnum.Ignore;
        _text = new Label { MouseFilter = MouseFilterEnum.Ignore };
        AddChild(_text);
        Visible = false;
    }

    public void ShowFor(GameState s, UnitState attacker, int tile, Vector2 at)
    {
        var preview = CombatSystem.Preview(s, attacker, tile);
        bool enemyThere = s.Units.Any(u => u.Tile == tile && u.Owner != attacker.Owner) || s.Cities.Any(c => c.Tile == tile && c.Owner != attacker.Owner);
        if (!enemyThere) { Visible = false; return; }
        _text.Text = string.Join("\n", CombatSystem.Describe(s, attacker, tile, preview));
        int odds = CombatSystem.OddsPercent(preview);
        SelfModulate = !preview.Legal ? new Color("#9aa7b1") : odds >= 60 ? new Color("#7fe08a") : odds >= 40 ? new Color("#f2c14e") : new Color("#ff6b6b");
        Position = at + new Vector2(18, 18);
        Visible = true;
    }
}
