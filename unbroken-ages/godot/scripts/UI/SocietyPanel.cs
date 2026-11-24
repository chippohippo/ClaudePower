using Godot;
using UnbrokenAges.Sim.Commands;
using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Client.UI;

/// <summary>
/// The Society screen (G): four columns. <b>Government</b> — the government and its slots, every card you may slot (click to
/// add or remove, then confirm; free on the turn after a civic, gold otherwise). <b>Faith</b> — choose a pantheon, found a
/// religion when a Great Prophet arrives, see how far it has spread. <b>Great People</b> — points, cost and who is next in every
/// class. <b>Ages</b> — this era's score against the Dark and Golden thresholds, the current age, and war weariness.
/// </summary>
public partial class SocietyPanel : PanelContainer
{
    private readonly GameRoot _root;
    private HBoxContainer _columns = null!;
    private Label _header = null!;
    private List<int>? _draft;   // cards being arranged, not yet confirmed
    private int _religion = -1, _founder = -1, _follower = -1;

    public SocietyPanel(GameRoot root) => _root = root;

    public override void _Ready()
    {
        SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);
        OffsetLeft = 40; OffsetTop = 56; OffsetRight = -40; OffsetBottom = -40;
        var v = new VBoxContainer();
        AddChild(v);
        _header = new Label { ThemeTypeVariation = "HeaderLarge", AutowrapMode = TextServer.AutowrapMode.WordSmart };
        v.AddChild(_header);
        var scroll = new ScrollContainer { SizeFlagsVertical = SizeFlags.ExpandFill, HorizontalScrollMode = ScrollContainer.ScrollMode.Disabled };
        v.AddChild(scroll);
        _columns = new HBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        _columns.AddThemeConstantOverride("separation", 18);
        scroll.AddChild(_columns);
        var close = new Button { Text = "Close (G)" };
        close.Pressed += () => Visible = false;
        v.AddChild(close);
    }

    private static Label Text(string text, Color? color = null, int size = 0)
    {
        var l = new Label { Text = text, AutowrapMode = TextServer.AutowrapMode.WordSmart };
        if (color is { } c) l.AddThemeColorOverride("font_color", c);
        if (size > 0) l.AddThemeFontSizeOverride("font_size", size);
        return l;
    }

    private static VBoxContainer Column(HBoxContainer parent, string title, Color accent)
    {
        var col = new VBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill, CustomMinimumSize = new Vector2(220, 0) };
        parent.AddChild(col);
        col.AddChild(new ColorRect { Color = accent, CustomMinimumSize = new Vector2(0, 5) });
        col.AddChild(new Label { Text = title, ThemeTypeVariation = "HeaderMedium" });
        return col;
    }

    private Button Action(string text, Action pressed, bool enabled = true, string tip = "")
    {
        var b = new Button { Text = text, Disabled = !enabled, TooltipText = tip, Alignment = HorizontalAlignment.Left, ClipText = true };
        b.Pressed += () => { pressed(); Refresh(); };
        return b;
    }

    /// <summary>A one-line button with its explanation beneath (buttons do not wrap well).</summary>
    private void Choice(VBoxContainer col, string title, string? description, Action pressed, bool enabled = true, string tip = "")
    {
        col.AddChild(Action(title, pressed, enabled, tip));
        if (!string.IsNullOrEmpty(description)) col.AddChild(Text("    " + description, enabled ? UiTheme.TextDim : UiTheme.TextDim.Darkened(0.35f), 12));
    }

    public void Refresh()
    {
        var s = _root.State;
        if (s == null) return;
        var db = s.Db;
        var me = s.Players[_root.LocalPlayer];
        foreach (var child in _columns.GetChildren()) child.QueueFree();
        _draft ??= new List<int>(me.Policies);
        _draft.RemoveAll(c => !SocietySystem.Unlocked(me, db.Policies[c]));

        string gov = me.Government >= 0 ? db.Governments[me.Government].Name : "No government";
        _header.Text = $"{gov} · {me.Age} Age · " + (me.PolicySwapFree ? "A civic was just completed: change cards and government for free this turn."
                                                                          : $"Changing cards costs {SocietySystem.SwapCostPerCard(s, me)} gold each until the next civic.");
        Government(s, me);
        Faith(s, me);
        GreatPeople(s, me);
        Ages(s, me);
        Culture(s, me);
    }

    // ----- Culture -------------------------------------------------------------------------------------

    private void Culture(GameState s, PlayerState me)
    {
        var col = Column(_columns, "CULTURE", new Color("#e07bd0"));
        int tourism = CultureSystem.Tourism(s, me);
        col.AddChild(Text($"Tourism: {tourism} a turn · your domestic tourists: {CultureSystem.Domestic(me)}"));
        var (dominated, total) = CultureSystem.Reach(s, me);
        col.AddChild(Text($"Culturally dominant over {dominated} of {total} civilizations" +
                          (VictorySystem.Enabled(s, VictoryKind.Culture) ? " (all of them, at least two: Culture victory)." : "."), dominated > 0 ? UiTheme.GoldBright : null));
        foreach (var o in s.Players.Where(o => o.IsMajor && o.IsAlive && o.Id != me.Id && s.CitiesOf(o.Id).Any()))
        {
            int visitors = CultureSystem.Visitors(me, o.Id), domestic = CultureSystem.Domestic(o);
            int bonus = CultureSystem.Affinity(s, me.Id, o.Id);
            col.AddChild(Text($"{(visitors > domestic ? "✓" : "·")} {o.Name}: {visitors} of your tourists vs {domestic} of theirs" + (bonus > 0 ? $" (+{bonus}% tourism)" : ""),
                              visitors > domestic ? UiTheme.GoldBright : null, 13));
        }
        col.AddChild(Text("Tourism: 2 per great work on display, 3 per world wonder, 2 per natural wonder in your lands; +25% per era from the Industrial; " +
                          "+25% toward a civilization you trade with, that opens its borders to you, or whose capital keeps your faith.", UiTheme.TextDim, 12));
        col.AddChild(new HSeparator());
        var works = s.GreatWorks.Where(g => g.Owner == me.Id).ToList();
        int slots = s.CitiesOf(me.Id).Sum(c => CultureSystem.Slots(s, c));
        col.AddChild(Text($"Great works: {works.Count} ({works.Count(g => g.CityId >= 0)} on display, {slots} slots)"));
        foreach (var g in works.Take(14))
            col.AddChild(Text($"  {(g.Kind == 1 ? "✝" : "♪")} {g.Name} — {(s.GetCity(g.CityId)?.Name ?? "in storage")}", UiTheme.TextDim, 12));
        col.AddChild(Text("Great Artists create works and Great Prophets leave relics. Slots: the palace 1, Amphitheater 2, Museum 3, Temple 1.", UiTheme.TextDim, 12));
    }

    // ----- Government and cards ------------------------------------------------------------------------

    private void Government(GameState s, PlayerState me)
    {
        var db = s.Db;
        var col = Column(_columns, "GOVERNMENT", UiTheme.GoldBright);
        foreach (var g in db.Governments)
        {
            bool current = g.Index == me.Government;
            bool unlocked = SocietySystem.Unlocked(me, g);
            if (!unlocked && !current) continue;
            string slots = $"{g.Military}M {g.Economic}E {g.Diplomatic}D {g.Wildcard}W";
            if (current) { col.AddChild(Text($"▶ {g.Name}  ({slots})\n{g.Description}", UiTheme.GoldBright)); continue; }
            string? why = SocietySystem.CanAdopt(s, me, g.Index);
            string cost = me.PolicySwapFree ? "free" : $"{SocietySystem.GovernmentChangeCost(s, me)} gold";
            Choice(col, $"Adopt {g.Name} ({slots}, {cost})", g.Description, () => { _root.Submit(new SetGovernmentCommand { Government = g.Index }); _draft = null; },
                   why == null, why ?? "");
        }
        if (db.Governments.Any(g => !SocietySystem.Unlocked(me, g)))
            col.AddChild(Text("Locked: " + string.Join(", ", db.Governments.Where(g => !SocietySystem.Unlocked(me, g)).Select(g => g.Name)), UiTheme.TextDim, 12));

        col.AddChild(new HSeparator());
        int wild = SocietySystem.WildcardSlots(s, me);
        var g0 = me.Government >= 0 ? db.Governments[me.Government] : null;
        col.AddChild(Text(g0 == null ? "No slots." : $"Slots: {g0.Military} military · {g0.Economic} economic · {g0.Diplomatic} diplomatic · {wild} wildcard"));
        var draft = _draft!;
        foreach (int c in draft.ToList())
        {
            var card = db.Policies[c];
            Choice(col, $"✓ {card.Name} ({card.Slot})", card.Description, () => draft.Remove(c), true, "Click to take it out");
        }
        bool changed = !draft.OrderBy(x => x).SequenceEqual(me.Policies.OrderBy(x => x));
        if (changed)
        {
            string? why = SocietySystem.CanSetPolicies(s, me, draft);
            int cost = SocietySystem.SwapCost(s, me, draft);
            col.AddChild(Action(cost > 0 ? $"Confirm cards ({cost} gold)" : "Confirm cards", () => { _root.Submit(new SetPoliciesCommand { Policies = new List<int>(draft) }); _draft = null; },
                                why == null, why ?? ""));
            col.AddChild(Action("Undo changes", () => _draft = null));
        }
        col.AddChild(Text("Available cards (click to slot):", UiTheme.TextDim, 13));
        foreach (var card in db.Policies.Where(c => SocietySystem.Unlocked(me, c) && !draft.Contains(c.Index)))
        {
            var test = draft.Append(card.Index).ToList();
            bool fits = me.Government >= 0 && SocietySystem.Fits(s, me.Government, test, SocietySystem.ExtraWildcard(s, me));
            Choice(col, $"+ {card.Name} ({card.Slot})", card.Description, () => draft.Add(card.Index), fits, fits ? "" : "No free slot of that kind.");
        }
    }

    // ----- Faith ---------------------------------------------------------------------------------------

    private void Faith(GameState s, PlayerState me)
    {
        var db = s.Db;
        var col = Column(_columns, "FAITH", new Color("#c9a3ff"));
        col.AddChild(Text($"Faith: {me.Faith.FloorToInt()}"));
        if (me.Pantheon >= 0)
            col.AddChild(Text($"Pantheon: {db.Beliefs[me.Pantheon].Name} — {db.Beliefs[me.Pantheon].Description}"));
        else
        {
            bool afford = me.Faith >= Fx.FromInt(ReligionSystem.PantheonCost);
            col.AddChild(Text(afford ? "Choose a pantheon:" : $"A pantheon needs {ReligionSystem.PantheonCost} faith.", afford ? UiTheme.GoldBright : UiTheme.TextDim));
            foreach (var b in ReligionSystem.FreeBeliefs(s, BeliefKind.Pantheon))
                Choice(col, b.Name, b.Description, () => _root.Submit(new FoundPantheonCommand { Belief = b.Index }), afford);
        }
        col.AddChild(new HSeparator());
        if (me.Religion >= 0)
        {
            var r = db.Religions[me.Religion];
            var (converted, total) = ReligionSystem.Reach(s, me);
            col.AddChild(Text($"You founded {r.Name}.", new Color(r.Color)));
            foreach (int b in me.Beliefs) col.AddChild(Text($"· {db.Beliefs[b].Name} ({db.Beliefs[b].Kind}) — {db.Beliefs[b].Description}", null, 13));
            col.AddChild(Text($"Followed by {s.Cities.Count(c => c.Religion == me.Religion)} cities. Majority faith in {converted} of {total} other civilizations" +
                              (VictorySystem.Enabled(s, VictoryKind.Spiritual) ? " (all of them, at least two: Spiritual victory)." : ".")));
        }
        else if (ReligionSystem.ProphetWaiting(me))
        {
            col.AddChild(Text("A Great Prophet awaits: found a religion.", UiTheme.GoldBright));
            Pick(col, "Name", ReligionSystem.FreeReligions(s).Select(r => (r.Index, r.Name)).ToList(), _religion, x => _religion = x);
            Pick(col, "Founder belief", ReligionSystem.FreeBeliefs(s, BeliefKind.Founder).Select(b => (b.Index, $"{b.Name} — {b.Description}")).ToList(), _founder, x => _founder = x);
            Pick(col, "Follower belief", ReligionSystem.FreeBeliefs(s, BeliefKind.Follower).Select(b => (b.Index, $"{b.Name} — {b.Description}")).ToList(), _follower, x => _follower = x);
            string? why = ReligionSystem.CanFoundReligion(s, me, _religion, _founder, _follower);
            col.AddChild(Action("Found the religion", () => _root.Submit(new FoundReligionCommand { Religion = _religion, FounderBelief = _founder, FollowerBelief = _follower }),
                                why == null, why ?? ""));
        }
        else col.AddChild(Text("Religions are founded by Great Prophets (Sanctuaries earn prophet points).", UiTheme.TextDim));

        col.AddChild(new HSeparator());
        col.AddChild(Text("World faiths:", UiTheme.TextDim, 13));
        foreach (var r in db.Religions)
        {
            int n = s.Cities.Count(c => c.Religion == r.Index);
            if (ReligionSystem.Founder(s, r.Index) is not { } f) continue;
            col.AddChild(Text($"● {r.Name} ({EventText.Civ(s, f.Id)}): {n} cities", new Color(r.Color), 13));
        }
    }

    private void Pick(VBoxContainer col, string label, List<(int Index, string Name)> options, int chosen, Action<int> set)
    {
        col.AddChild(Text(label, UiTheme.TextDim, 12));
        if (!options.Any(x => x.Index == chosen)) set(chosen = options.Count > 0 ? options[0].Index : -1);
        var o = new OptionButton { ClipText = true, CustomMinimumSize = new Vector2(240, 0) };
        foreach (var (index, name) in options) o.AddItem(name, index);
        if (chosen >= 0) o.Select(options.FindIndex(x => x.Index == chosen));
        o.ItemSelected += i => { set(o.GetItemId((int)i)); Refresh(); };
        col.AddChild(o);
    }

    // ----- Great people --------------------------------------------------------------------------------

    private void GreatPeople(GameState s, PlayerState me)
    {
        var db = s.Db;
        var col = Column(_columns, "GREAT PEOPLE", new Color("#7fd3ff"));
        var perTurn = GreatPeopleSystem.PointsPerTurn(s, me);
        foreach (GreatPersonClass cls in Enum.GetValues<GreatPersonClass>())
        {
            int c = (int)cls;
            var next = GreatPeopleSystem.Next(s, cls);
            int cost = GreatPeopleSystem.Cost(s, cls);
            string who = next == null ? "no one yet (a later era)" : $"{next.Name}: {GreatPeopleSystem.Deed(next)}";
            col.AddChild(Text($"{cls}s — {me.GreatPersonPoints[c]}/{cost} (+{perTurn[c]}/turn)", perTurn[c] > 0 ? UiTheme.GoldBright : null, 14));
            col.AddChild(Text($"   next: {who}", UiTheme.TextDim, 12));
            var bar = new ProgressBar { MaxValue = cost, Value = Math.Min(cost, me.GreatPersonPoints[c]), ShowPercentage = false, CustomMinimumSize = new Vector2(0, 6) };
            col.AddChild(bar);
        }
        col.AddChild(Text("Points come from districts: Academy → Scientists, Foundry → Engineers, Market → Merchants, Cultural Quarter → Artists, " +
                          "Sanctuary → Prophets, Garrison → Generals, Harbor → Admirals (+1 per building).", UiTheme.TextDim, 12));
        var mine = db.GreatPeople.Where(g => s.GreatPeopleTaken.Contains(g.Index)).ToList();
        if (mine.Count > 0) col.AddChild(Text($"Recruited in the world: {string.Join(", ", mine.Select(g => g.Name))}", null, 12));
    }

    // ----- Ages ----------------------------------------------------------------------------------------

    private void Ages(GameState s, PlayerState me)
    {
        var col = Column(_columns, "AGES", new Color("#f2c14e"));
        int era = s.PlayerEra(me);
        int cities = s.CitiesOf(me.Id).Count();
        int dark = AgeSystem.DarkBelow(era, cities), golden = AgeSystem.GoldenFrom(era, cities);
        col.AddChild(Text(AgeSystem.Describe(me.Age), me.Age switch { AgeState.Golden or AgeState.Heroic => UiTheme.GoldBright, AgeState.Dark => new Color("#9aa4c8"), _ => null }));
        col.AddChild(Text($"Era score this era: {me.EraScore}"));
        col.AddChild(Text($"Dark Age below {dark} · Golden Age from {golden}" + (me.Age == AgeState.Dark ? " (a Heroic Age, out of darkness)" : "")));
        var bar = new ProgressBar { MaxValue = golden, Value = Math.Min(golden, me.EraScore), ShowPercentage = false, CustomMinimumSize = new Vector2(0, 8) };
        col.AddChild(bar);
        col.AddChild(Text("Historic moments: founding cities, districts (+1), wonders (+4), great people (+2), a pantheon (+2), a religion (+3), " +
                          "natural wonders (+2), scattering camps (+1), taking cities (+2), veteran companies (+1). The age is decided as you enter the next era.",
                          UiTheme.TextDim, 12));
        col.AddChild(new HSeparator());
        int penalty = SocietySystem.WearinessPenalty(me);
        col.AddChild(Text($"War weariness: {me.WarWeariness}" + (penalty > 0 ? $" — −{penalty} Amenity in every city" : ""), penalty > 0 ? new Color("#ff9a9a") : null));
        col.AddChild(Text("Rises with every attack abroad, unit lost and city taken; fades by 1 a turn at war and 3 in peace.", UiTheme.TextDim, 12));
        var wonders = SocietySystem.Wonders(s, me.Id).ToList();
        col.AddChild(new HSeparator());
        col.AddChild(Text(wonders.Count == 0 ? "No world wonders yet. Build them as districts from a city's production list." : "Your wonders: " + string.Join(", ", wonders.Select(w => w.Name))));
        col.AddChild(new HSeparator());
        col.AddChild(Text($"Trade routes: {TradeSystem.Active(s, me.Id)} of {TradeSystem.Capacity(s, me)} (one per city with a Market or Harbor, +1 with Foreign Trade)"));
        foreach (var r in s.TradeRoutes.Where(r => r.Owner == me.Id))
            if (s.GetCity(r.Origin) is { } o && s.GetCity(r.Destination) is { } d)
                col.AddChild(Text($"  {o.Name} → {d.Name} · {r.TurnsLeft} turns left", UiTheme.TextDim, 12));
        if (s.Camps.Count > 0) col.AddChild(Text($"Barbarian camps known in the world: {s.Camps.Count(c => me.Revealed.Length > c.Tile && me.Revealed[c.Tile])}", null, 13));
    }

    public override void _UnhandledInput(InputEvent @event)
    {
        if (@event is InputEventKey { Pressed: true, Keycode: Key.G })
        {
            Visible = !Visible;
            if (Visible) { _root.CloseOverlaysExcept(this); _draft = null; Refresh(); }
        }
    }
}
