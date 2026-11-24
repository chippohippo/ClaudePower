using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

public sealed class StrengthBreakdown
{
    public List<(string Label, int Value)> Lines { get; } = new();
    public int Total => Math.Max(1, Lines.Sum(l => l.Value));
    public void Add(string label, int value) { if (value != 0) Lines.Add((label, value)); }
    public override string ToString() => $"{Total} (" + string.Join(", ", Lines.Select(l => $"{l.Label} {(l.Value >= 0 ? "+" : "")}{l.Value}")) + ")";
}

/// <summary>The combat preview the UI shows before every attack: both strengths, every modifier, damage ranges.</summary>
public sealed record CombatPreview(
    bool Legal, string? Reason, bool Ranged, bool VsCity, bool CapturesCivilian,
    StrengthBreakdown Attacker, StrengthBreakdown Defender,
    int DefenderDamageMin, int DefenderDamageMax, int AttackerDamageMin, int AttackerDamageMax, int DefenderHp, int AttackerHp)
{
    public bool CertainKill => DefenderDamageMin >= DefenderHp;
    public bool PossibleDeath => AttackerDamageMax >= AttackerHp;
}

/// <summary>
/// Combat v1 (one unit per tile, Civ-style readability):
///   damage = base × 2^((attackerStrength − defenderStrength) / doublingDelta) × random(80–120%)
/// Melee: both sides take damage (the defender's damage uses −Δ); the winner advances; a city at 0 HP
/// falls to melee. Ranged: only the target is damaged. Every modifier is a named line in the preview:
/// wounds, terrain, river crossing, fortification, flanking, support, unit counters, supply, walls.
/// </summary>
public static class CombatSystem
{
    public static bool IsCity(GameState s, int tile, out CityState? city)
    {
        city = s.Cities.FirstOrDefault(c => c.Tile == tile);
        return city != null;
    }

    public static int CityMaxHp(GameState s, CityState city)
    {
        var rules = s.Db.Rules.Combat;
        return rules.CityBaseHp + (HasWalls(s, city) ? rules.WallsHp : 0);
    }

    private static bool HasWalls(GameState s, CityState city) =>
        s.Db.Buildings.IndexOf(s.Db.Rules.Combat.WallsBuilding) is int w && w >= 0 && city.HasBuilding(w);

    public static StrengthBreakdown CityStrength(GameState s, CityState city)
    {
        var rules = s.Db.Rules.Combat;
        var b = new StrengthBreakdown();
        b.Add("City", rules.CityBaseStrength);
        b.Add("Era", rules.CityStrengthPerEra * s.PlayerEra(s.Players[city.Owner]));
        if (HasWalls(s, city)) b.Add("Walls", rules.WallsStrength);
        var garrison = s.Units.Where(u => u.Tile == city.Tile && u.Owner == city.Owner && SupplySystem.IsMilitary(s.Db, u))
            .Select(u => UnitStats.Strength(s, u)).DefaultIfEmpty(0).Max();
        b.Add("Garrison", garrison / 5);
        b.Add("Damaged", -(CityMaxHp(s, city) - city.Hp) / 20);
        foreach (var (label, value) in NationSystem.CityDefenseLines(s, city)) b.Add(label, value);
        return b;
    }

    private static HashSet<string> TagsOf(UnitDef d) => new(d.Tags.Append(d.UnitClass), StringComparer.Ordinal);

    public static StrengthBreakdown UnitStrength(GameState s, UnitState unit, UnitState? opponent, bool attacking, bool ranged, int fromTile, int targetTile)
    {
        var db = s.Db;
        var rules = db.Rules.Combat;
        var def = db.Units[unit.DefIndex];
        var map = s.Map;
        var b = new StrengthBreakdown();
        bool rangedLine = attacking && ranged;
        b.Add(rangedLine ? "Ranged strength" : "Strength", rangedLine ? def.RangedStrength : def.Strength);
        if (UnitStats.VariantOf(s, unit) is { } variant)
        {
            int adjusted = rangedLine ? UnitStats.RangedStrength(s, unit) : UnitStats.Strength(s, unit);
            int raw = rangedLine ? def.RangedStrength : def.Strength;
            if (adjusted != raw) b.Add($"{variant.Name} variant", adjusted - raw);
        }
        b.Add("Wounds", -rules.HpPenaltyPerTen * ((100 - unit.Hp) / 10));

        if (!attacking)
        {
            b.Add("Terrain", db.Reliefs[map.Relief[unit.Tile]].Defense + (map.Feature[unit.Tile] >= 0 ? db.Features[map.Feature[unit.Tile]].Defense : 0));
            if (unit.Fortified) b.Add("Fortified", rules.FortifyBonus);
        }
        else if (!ranged)
        {
            int dir = map.DirectionTo(fromTile, targetTile);
            if (dir >= 0 && map.HasRiverEdge(fromTile, dir) && !map.HasFlag(targetTile, TileFlags.Bridge))
            {
                if (UnitStats.IgnoresRiverCrossing(s, unit)) b.Lines.Add(("Across a river (fords it)", 0));   // shown so the player sees why
                else b.Add("Attacking across a river", -rules.RiverCrossingPenalty);
            }
        }

        // Flanking (attacker) / support (defender): other friendly military units next to the defender.
        if (!ranged)
        {
            int around = targetTile;
            int friends = 0;
            for (int d = 0; d < 6; d++)
            {
                int n = map.Neighbor(around, d);
                if (n < 0 || n == unit.Tile) continue;
                friends += s.Units.Count(o => o.Tile == n && o.Owner == unit.Owner && o.Id != unit.Id && SupplySystem.IsMilitary(db, o));
            }
            b.Add(attacking ? "Flanking" : "Support", friends * (attacking ? rules.FlankingBonus : rules.SupportBonus));
        }

        if (opponent != null)
        {
            var theirTags = TagsOf(db.Units[opponent.DefIndex]);
            if (def.StrongAgainst.Any(theirTags.Contains)) b.Add($"Strong against {db.Units[opponent.DefIndex].Name}", rules.CounterBonus);
            if (def.WeakAgainst.Any(theirTags.Contains)) b.Add($"Weak against {db.Units[opponent.DefIndex].Name}", -rules.CounterBonus);
        }

        if (s.Options.SupplyCombatPenalty && SupplySystem.Compute(s, unit.Owner)[unit.Tile] < 0) b.Add("Out of supply", -rules.OutOfSupplyPenalty);
        bool vsCity = s.Cities.Any(c => c.Tile == targetTile && c.Owner != unit.Owner);
        foreach (var (label, value) in NationSystem.CombatLines(s, unit, opponent, attacking, ranged, vsCity, targetTile)) b.Add(label, value);
        foreach (var (label, value) in SocietySystem.CombatLines(s, unit, attacking, vsCity, targetTile)) b.Add(label, value);
        return b;
    }

    private static (int Min, int Max) DamageRange(GameState s, int delta)
    {
        var rules = s.Db.Rules.Combat;
        Fx mean = rules.BaseDamage * Fx.Pow2(Fx.Ratio(delta, rules.DoublingDelta));
        return ((mean * rules.RandomMinPercent / 100).RoundToInt(), (mean * rules.RandomMaxPercent / 100).RoundToInt());
    }

    private static int RollDamage(GameState s, int delta)
    {
        var rules = s.Db.Rules.Combat;
        Fx mean = rules.BaseDamage * Fx.Pow2(Fx.Ratio(delta, rules.DoublingDelta));
        int percent = s.CombatRng.NextInt(rules.RandomMinPercent, rules.RandomMaxPercent + 1);
        return Math.Clamp((mean * percent / 100).RoundToInt(), 1, 100);
    }

    public static CombatPreview Preview(GameState s, UnitState attacker, int targetTile)
    {
        var db = s.Db;
        var map = s.Map;
        var def = db.Units[attacker.DefIndex];
        bool ranged = UnitStats.IsRanged(s, attacker);
        var empty = new StrengthBreakdown();
        CombatPreview Illegal(string why) => new(false, why, ranged, false, false, empty, empty, 0, 0, 0, 0, 0, attacker.Hp);

        if (targetTile < 0 || targetTile >= map.Count) return Illegal("Invalid target.");
        if (!SupplySystem.IsMilitary(db, attacker)) return Illegal("This unit cannot attack.");
        if (attacker.AttackedThisTurn) return Illegal("Already attacked this turn.");
        if (attacker.MovesLeft <= Fx.Zero) return Illegal("No moves left.");

        bool vsCity = IsCity(s, targetTile, out var city);
        var defender = s.Units.Where(u => u.Tile == targetTile).OrderByDescending(u => UnitStats.Strength(s, u)).ThenBy(u => u.Id).FirstOrDefault();
        int targetOwner = vsCity ? city!.Owner : defender?.Owner ?? -1;
        if (targetOwner < 0) return Illegal("Nothing to attack there.");
        if (targetOwner == attacker.Owner) return Illegal("That is yours.");
        if (!DiplomacySystem.AtWar(s, attacker.Owner, targetOwner)) return Illegal("You are not at war with them.");

        int distance = map.Distance(attacker.Tile, targetTile);
        if (ranged ? distance > UnitStats.Range(s, attacker) : distance != 1) return Illegal(ranged ? "Out of range." : "Melee units must be adjacent.");
        if (!ranged && !vsCity && Movement.TerrainCost(s, attacker, attacker.Tile, targetTile) == Movement.Impassable) return Illegal("Cannot reach that tile.");

        if (!vsCity && defender != null && !SupplySystem.IsMilitary(db, defender))
            return ranged ? Illegal("Ranged units cannot capture civilians.")
                          : new CombatPreview(true, null, false, false, true, empty, empty, 0, 0, 0, 0, 0, attacker.Hp);

        var atk = UnitStrength(s, attacker, vsCity ? null : defender, attacking: true, ranged, attacker.Tile, targetTile);
        var dfn = vsCity ? CityStrength(s, city!) : UnitStrength(s, defender!, attacker, attacking: false, ranged, attacker.Tile, targetTile);
        int delta = atk.Total - dfn.Total;
        var (dMin, dMax) = DamageRange(s, delta);
        var (aMin, aMax) = ranged ? (0, 0) : DamageRange(s, -delta);
        int defenderHp = vsCity ? city!.Hp : defender!.Hp;
        return new CombatPreview(true, null, ranged, vsCity, false, atk, dfn, dMin, dMax, aMin, aMax, defenderHp, attacker.Hp);
    }

    /// <summary>
    /// The attacker's share of the exchange, in percent: expected damage dealt as a share of the defender's health, against
    /// expected damage taken as a share of ours. Ranged attacks, civilian captures and risk-free certain kills score 100.
    /// The AI attacks above 60; the preview turns it into a verdict.
    /// </summary>
    public static int OddsPercent(CombatPreview p)
    {
        if (!p.Legal) return 0;
        if (p.CapturesCivilian || (p.CertainKill && !p.PossibleDeath)) return 100;
        long dealt = (p.DefenderDamageMin + p.DefenderDamageMax) / 2, taken = (p.AttackerDamageMin + p.AttackerDamageMax) / 2;
        if (taken == 0) return dealt > 0 ? 100 : 0;
        long ours = dealt * Math.Max(1, p.AttackerHp), theirs = taken * Math.Max(1, p.DefenderHp);
        return (int)(100 * ours / (ours + theirs));
    }

    public static string Verdict(int odds) => odds switch
    {
        >= 85 => "Decisive",
        >= 60 => "Favourable",
        >= 40 => "Even",
        >= 20 => "Costly",
        _ => "Disastrous",
    };

    /// <summary>The tooltip shown while hovering a target: headline, damage ranges, warnings, then every modifier on both sides.</summary>
    public static List<string> Describe(GameState s, UnitState attacker, int targetTile, CombatPreview p)
    {
        var lines = new List<string>();
        if (!p.Legal) { lines.Add(p.Reason ?? "Cannot attack."); return lines; }
        string us = UnitStats.Name(s, attacker);
        if (p.CapturesCivilian) { lines.Add($"{us} captures the civilians here."); return lines; }
        string them = p.VsCity ? s.Cities.First(c => c.Tile == targetTile).Name
                                : UnitStats.Name(s, s.Units.Where(u => u.Tile == targetTile).OrderByDescending(u => UnitStats.Strength(s, u)).ThenBy(u => u.Id).First());
        int odds = OddsPercent(p);
        lines.Add($"{Verdict(odds)} ({odds}%): {us} {p.Attacker.Total} vs {them} {p.Defender.Total}{(p.Ranged ? " (ranged)" : "")}");
        lines.Add($"Deal {p.DefenderDamageMin}–{p.DefenderDamageMax} of {p.DefenderHp} HP" + (p.Ranged ? ", take none" : $", take {p.AttackerDamageMin}–{p.AttackerDamageMax} of {p.AttackerHp} HP"));
        if (p.CertainKill) lines.Add(p.VsCity && !p.Ranged ? "The city will fall." : "Certain kill.");
        if (p.PossibleDeath) lines.Add("⚠ Your unit may die.");
        lines.AddRange(p.Attacker.Lines.Select(l => $"  + {l.Label} {(l.Value >= 0 ? "+" : "")}{l.Value}"));
        lines.AddRange(p.Defender.Lines.Select(l => $"  − {l.Label} {(l.Value >= 0 ? "+" : "")}{l.Value}"));
        return lines;
    }

    public static void Resolve(GameState s, UnitState attacker, int targetTile, List<GameEvent> events)
    {
        var db = s.Db;
        var preview = Preview(s, attacker, targetTile);
        if (!preview.Legal) return;
        attacker.AttackedThisTurn = true;
        attacker.Fortified = false;
        if (s.Map.OwnerPlayer[targetTile] != attacker.Owner && !s.Players[attacker.Owner].IsFreeCities &&
            !(IsCity(s, targetTile, out var targetCity) ? s.Players[targetCity!.Owner].IsFreeCities : s.Units.Any(u => u.Tile == targetTile && s.Players[u.Owner].IsFreeCities)))
            SocietySystem.AddWeariness(s, attacker.Owner, 1);
        attacker.MovesLeft = Fx.Zero;
        var atkDef = db.Units[attacker.DefIndex];

        if (preview.CapturesCivilian)
        {
            foreach (var civ in s.Units.Where(u => u.Tile == targetTile).ToList())
            {
                civ.Owner = attacker.Owner;
                civ.Destination = -1;
                events.Add(new GameEvent(GameEventType.CivilianCaptured, attacker.Owner, Tile: targetTile, Def: civ.DefIndex, Detail: db.Units[civ.DefIndex].Name));
            }
            attacker.Tile = targetTile;
            return;
        }

        int delta = preview.Attacker.Total - preview.Defender.Total;
        int toDefender = RollDamage(s, delta);
        int toAttacker = preview.Ranged ? 0 : RollDamage(s, -delta);

        if (preview.VsCity)
        {
            var city = s.Cities.First(c => c.Tile == targetTile);
            int victim = city.Owner;
            city.Hp = Math.Max(0, city.Hp - toDefender);
            attacker.Hp -= toAttacker;
            events.Add(new GameEvent(GameEventType.BattleFought, attacker.Owner, city.Id, targetTile, attacker.DefIndex, toDefender,
                $"{atkDef.Name} ({preview.Attacker.Total}) vs {city.Name} ({preview.Defender.Total}): {toDefender} damage dealt, {toAttacker} taken"));
            if (attacker.Hp <= 0) { Destroy(s, attacker, events, city.Owner, null); return; }
            SocietySystem.GainExperience(s, attacker, attacking: true, vsCity: true, killed: city.Hp == 0 && !preview.Ranged);
            if (city.Hp == 0 && !preview.Ranged) Capture(s, attacker, city, victim, events);
            return;
        }

        var defender = s.Units.Where(u => u.Tile == targetTile).OrderByDescending(u => UnitStats.Strength(s, u)).ThenBy(u => u.Id).First();
        defender.Hp -= toDefender;
        attacker.Hp -= toAttacker;
        events.Add(new GameEvent(GameEventType.BattleFought, attacker.Owner, Tile: targetTile, Def: attacker.DefIndex, Value: toDefender,
            Detail: $"{atkDef.Name} ({preview.Attacker.Total}) vs {db.Units[defender.DefIndex].Name} ({preview.Defender.Total}): {toDefender} damage dealt, {toAttacker} taken"));
        bool defenderDied = defender.Hp <= 0;
        SocietySystem.GainExperience(s, attacker, attacking: true, vsCity: false, killed: defenderDied);
        SocietySystem.GainExperience(s, defender, attacking: false, vsCity: false, killed: attacker.Hp <= 0);
        if (defenderDied) Destroy(s, defender, events, attacker.Owner, attacker);
        if (attacker.Hp <= 0) { Destroy(s, attacker, events, defender.Owner, defenderDied ? null : defender); return; }
        if (defenderDied && !preview.Ranged && !s.Units.Any(u => u.Tile == targetTile && u.Owner != attacker.Owner))
        {
            foreach (var civ in s.Units.Where(u => u.Tile == targetTile && u.Owner != attacker.Owner).ToList()) civ.Owner = attacker.Owner;
            attacker.Tile = targetTile; // the victor advances
        }
    }

    /// <summary>Cities with walls bombard one enemy unit within range per turn.</summary>
    public static string? ValidateCityStrike(GameState s, CityState city, int targetTile)
    {
        if (city.StruckThisTurn) return "This city has already fired this turn.";
        if (!HasWalls(s, city)) return "Only walled cities can strike.";
        if (s.Map.Distance(city.Tile, targetTile) > s.Db.Rules.Combat.CityStrikeRange) return "Out of range.";
        var target = s.Units.FirstOrDefault(u => u.Tile == targetTile && SupplySystem.IsMilitary(s.Db, u));
        if (target == null) return "No military unit there.";
        if (!DiplomacySystem.AtWar(s, city.Owner, target.Owner)) return "You are not at war with them.";
        return null;
    }

    public static void CityStrike(GameState s, CityState city, int targetTile, List<GameEvent> events)
    {
        var target = s.Units.Where(u => u.Tile == targetTile && SupplySystem.IsMilitary(s.Db, u)).OrderBy(u => u.Id).First();
        var atk = CityStrength(s, city);
        var dfn = UnitStrength(s, target, null, attacking: false, ranged: true, city.Tile, targetTile);
        int damage = RollDamage(s, atk.Total - dfn.Total);
        target.Hp -= damage;
        city.StruckThisTurn = true;
        events.Add(new GameEvent(GameEventType.BattleFought, city.Owner, city.Id, targetTile, -1, damage, $"{city.Name} bombards {s.Db.Units[target.DefIndex].Name}: {damage} damage"));
        if (target.Hp <= 0) Destroy(s, target, events, city.Owner, null);
    }

    private static void Destroy(GameState s, UnitState unit, List<GameEvent> events, int killerOwner = -1, UnitState? killer = null)
    {
        s.RemoveUnit(unit);
        if (killerOwner >= 0 && !s.Players[killerOwner].IsFreeCities) SocietySystem.AddWeariness(s, unit.Owner, 1);
        events.Add(new GameEvent(GameEventType.UnitDestroyed, unit.Owner, Tile: unit.Tile, Def: unit.DefIndex, Detail: s.Db.Units[unit.DefIndex].Name));
        if (killerOwner >= 0) NationSystem.OnUnitDestroyed(s, killerOwner, killer, unit, events);
    }

    private static void Capture(GameState s, UnitState attacker, CityState city, int victim, List<GameEvent> events)
    {
        foreach (var u in s.Units.Where(u => u.Tile == city.Tile && u.Owner == victim).ToList()) Destroy(s, u, events, attacker.Owner, attacker);
        int populationBefore = city.Population;
        CitySystem.ChangeOwner(s, city, attacker.Owner, events, GameEventType.CityCaptured);
        city.Hp = CityMaxHp(s, city) / 4;
        city.Loyalty = 50;
        if (city.Population > 1) city.Population--;
        NationSystem.OnCityCaptured(s, attacker.Owner, city, victim, populationBefore, events);
        AgeSystem.Award(s, s.Players[attacker.Owner], 2, $"Took {city.Name}", events);
        if (!s.Players[victim].IsFreeCities) SocietySystem.AddWeariness(s, attacker.Owner, 6);
        attacker.Tile = city.Tile;
        DiplomacySystem.AddGrievance(s, victim, attacker.Owner, 20, $"Captured {city.Name}");
    }

    /// <summary>Start-of-turn upkeep: attack flags reset; cities heal; units that held still stay fortified.</summary>
    public static void ProcessTurn(GameState s)
    {
        var rules = s.Db.Rules.Combat;
        foreach (var u in s.Units) u.AttackedThisTurn = false;
        foreach (var c in s.Cities)
        {
            c.StruckThisTurn = false;
            c.Hp = Math.Min(CityMaxHp(s, c), c.Hp + rules.CityHealPerTurn);
        }
    }
}
