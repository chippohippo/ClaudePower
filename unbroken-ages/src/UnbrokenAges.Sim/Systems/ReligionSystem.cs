using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// Religion (docs/05-key-systems/15-society.md). Faith buys a <b>pantheon</b> (one belief, unique in the world). A recruited
/// Great Prophet lets a civilization <b>found a religion</b>: a name, a founder belief (pays the founder for every follower city
/// anywhere) and a follower belief (helps every city that follows it). Religions spread by <b>pressure</b> from nearby
/// cities, strongest from the holy city and from cities with a Sanctuary, and by <b>missionaries</b>. A city converts when the
/// pressure of a rival faith builds past its threshold. A religion followed by most of the cities of every other civilization
/// wins the <b>Spiritual</b> victory.
/// </summary>
public static class ReligionSystem
{
    public const int PantheonCost = 25;
    public const int Radius = 9;
    public const int MissionaryProgress = 60;
    /// <summary>A missionary converts a city with no religion, or one this small, at once.</summary>
    public const int InstantConversionPopulation = 3;

    public static PlayerState? Founder(GameState s, int religion) =>
        religion < 0 ? null : s.Players.Find(p => p.Religion == religion);

    public static bool BeliefTaken(GameState s, int belief) =>
        s.Players.Any(p => p.Pantheon == belief || p.Beliefs.Contains(belief));

    public static IEnumerable<BeliefDef> FreeBeliefs(GameState s, BeliefKind kind) =>
        s.Db.Beliefs.Where(b => b.Kind == kind && !BeliefTaken(s, b.Index));

    public static IEnumerable<ReligionDef> FreeReligions(GameState s) =>
        s.Db.Religions.Where(r => Founder(s, r.Index) == null);

    // ----- Pantheon ------------------------------------------------------------------------------------

    public static string? CanFoundPantheon(GameState s, PlayerState p, int belief)
    {
        if (p.Pantheon >= 0) return "You already have a pantheon.";
        if (belief < 0 || belief >= s.Db.Beliefs.Count || s.Db.Beliefs[belief].Kind != BeliefKind.Pantheon) return "Not a pantheon belief.";
        if (BeliefTaken(s, belief)) return "Another people already worships it.";
        if (p.Faith < Fx.FromInt(PantheonCost)) return $"Needs {PantheonCost} faith.";
        if (!s.CitiesOf(p.Id).Any()) return "Found a city first.";
        return null;
    }

    public static void FoundPantheon(GameState s, PlayerState p, int belief, List<GameEvent> events)
    {
        p.Faith -= Fx.FromInt(PantheonCost);
        p.Pantheon = belief;
        events.Add(new GameEvent(GameEventType.PantheonFounded, p.Id, Def: belief, Detail: s.Db.Beliefs[belief].Name));
        AgeSystem.Award(s, p, 2, "Founded a pantheon", events);
    }

    // ----- Religion ------------------------------------------------------------------------------------

    /// <summary>A Great Prophet has been recruited and no religion founded yet.</summary>
    public static bool ProphetWaiting(PlayerState p) =>
        p.Religion < 0 && p.GreatPeopleRecruited[(int)GreatPersonClass.Prophet] > 0;

    public static string? CanFoundReligion(GameState s, PlayerState p, int religion, int founderBelief, int followerBelief)
    {
        var db = s.Db;
        if (p.Religion >= 0) return "You have already founded a religion.";
        if (!ProphetWaiting(p)) return "A Great Prophet must found it.";
        if (religion < 0 || religion >= db.Religions.Count || Founder(s, religion) != null) return "That religion is taken.";
        if (founderBelief < 0 || founderBelief >= db.Beliefs.Count || db.Beliefs[founderBelief].Kind != BeliefKind.Founder || BeliefTaken(s, founderBelief))
            return "Choose a free founder belief.";
        if (followerBelief < 0 || followerBelief >= db.Beliefs.Count || db.Beliefs[followerBelief].Kind != BeliefKind.Follower || BeliefTaken(s, followerBelief))
            return "Choose a free follower belief.";
        if (HolyCity(s, p) == null) return "You need a city to be its holy city.";
        return null;
    }

    /// <summary>The holy city: the capital (else the oldest city).</summary>
    public static CityState? HolyCity(GameState s, PlayerState p) =>
        s.GetCity(p.CapitalCityId) is { } c && c.Owner == p.Id ? c : s.CitiesOf(p.Id).OrderBy(c => c.Id).FirstOrDefault();

    public static void FoundReligion(GameState s, PlayerState p, int religion, int founderBelief, int followerBelief, List<GameEvent> events)
    {
        p.Religion = religion;
        p.Beliefs.Add(founderBelief);
        p.Beliefs.Add(followerBelief);
        var holy = HolyCity(s, p)!;
        Convert(s, holy, religion, events, announce: false);
        events.Add(new GameEvent(GameEventType.ReligionFounded, p.Id, holy.Id, holy.Tile, Value: religion, Detail: s.Db.Religions[religion].Name));
        AgeSystem.Award(s, p, 3, $"Founded {s.Db.Religions[religion].Name}", events);
    }

    private static void Convert(GameState s, CityState city, int religion, List<GameEvent> events, bool announce = true)
    {
        city.Religion = religion;
        city.ReligionCandidate = -1;
        city.ReligionProgress = Fx.Zero;
        if (announce) events.Add(new GameEvent(GameEventType.CityConverted, city.Owner, city.Id, city.Tile, Value: religion, Detail: s.Db.Religions[religion].Name));
    }

    public static int ConversionThreshold(CityState city) => 30 + 5 * city.Population;

    /// <summary>Pressure of each religion on a city, in whole points per turn (indexed by religion).</summary>
    public static int[] Pressure(GameState s, CityState target)
    {
        var db = s.Db;
        var result = new int[db.Religions.Count];
        foreach (var src in s.Cities)
        {
            if (src.Religion < 0) continue;
            int d = s.Map.Distance(src.Tile, target.Tile);
            if (d > Radius) continue;
            int p = (Radius + 1 - d) * (2 + src.Population);
            if (Founder(s, src.Religion) is { } f && HolyCity(s, f) is { } holy && holy.Id == src.Id && holy.Owner == f.Id) p *= 2;
            if (src.Districts.Any(x => db.Districts[x.DefIndex].HasTag("Faith") && !x.Pillaged)) p += p / 2;
            result[src.Religion] += p;
        }
        return result;
    }

    public static void ProcessTurn(GameState s, List<GameEvent> events)
    {
        if (!s.Cities.Any(c => c.Religion >= 0)) return;
        // Pressure from the state at the start of the step, so city order does not matter.
        var pressures = s.Cities.Select(c => (City: c, P: Pressure(s, c))).ToList();
        foreach (var (city, p) in pressures)
        {
            int top = -1;
            for (int r = 0; r < p.Length; r++)
                if (p[r] > 0 && (top < 0 || p[r] > p[top])) top = r;
            if (top < 0 || top == city.Religion) { city.ReligionCandidate = -1; city.ReligionProgress = Fx.Zero; continue; }
            if (city.ReligionCandidate != top) { city.ReligionCandidate = top; city.ReligionProgress = Fx.Zero; }
            int net = p[top] - (city.Religion >= 0 ? p[city.Religion] : 0);
            if (net <= 0) continue;
            city.ReligionProgress += Fx.Ratio(net, 10);
            if (city.ReligionProgress >= Fx.FromInt(ConversionThreshold(city))) Convert(s, city, top, events);
        }
    }

    /// <summary>Founder beliefs: yields for every city in the world following the founder's religion.</summary>
    public static YieldSet FounderIncome(GameState s, PlayerState p)
    {
        var income = new YieldSet();
        if (p.Religion < 0) return income;
        int followers = s.Cities.Count(c => c.Religion == p.Religion);
        foreach (int b in p.Beliefs)
        {
            var def = s.Db.Beliefs[b];
            if (def.Kind != BeliefKind.Founder) continue;
            foreach (var y in YieldSet.All) income[y] += def.PerFollowerCity[y] * followers;
        }
        return income;
    }

    // ----- Missionaries --------------------------------------------------------------------------------

    public static bool IsMissionary(UnitDef u) => u.HasTag("Missionary");

    /// <summary>
    /// Faith buys religious units outright, once a religion is founded: twice their production cost, +25% for each religious unit
    /// of yours already in the field (a flood of missionaries gets dear).
    /// </summary>
    public const int FaithPerProduction = 2, FaithSurchargePercent = 25;

    public static Fx FaithCost(GameState s, CityState city, int unitDef)
    {
        int inField = s.Units.Count(u => u.Owner == city.Owner && IsMissionary(s.Db.Units[u.DefIndex]));
        Fx cost = ProductionSystem.Cost(s, s.Players[city.Owner], ProductionKind.Unit, unitDef) * FaithPerProduction;
        return (cost + cost * (FaithSurchargePercent * inField) / 100).Floor();
    }

    public static string? ValidateFaithPurchase(GameState s, CityState city, int unitDef)
    {
        if (unitDef < 0 || unitDef >= s.Db.Units.Count || !IsMissionary(s.Db.Units[unitDef])) return "Only religious units can be bought with faith.";
        var p = s.Players[city.Owner];
        if (p.Religion < 0) return "Found a religion first.";
        if (ProductionSystem.Validate(s, city, ProductionKind.Unit, unitDef, -1) is { } err) return err;
        var cost = FaithCost(s, city, unitDef);
        return p.Faith < cost ? $"Needs {cost.FloorToInt()} faith." : null;
    }

    public static void PurchaseWithFaith(GameState s, CityState city, int unitDef, List<GameEvent> events)
    {
        s.Players[city.Owner].Faith -= FaithCost(s, city, unitDef);
        ProductionSystem.Complete(s, city, new QueueItem { Kind = ProductionKind.Unit, DefIndex = unitDef }, events);
    }

    public static CityState? SpreadTarget(GameState s, UnitState u) =>
        s.Cities.Where(c => s.Map.Distance(c.Tile, u.Tile) <= 1).OrderBy(c => s.Map.Distance(c.Tile, u.Tile)).ThenBy(c => c.Id).FirstOrDefault();

    public static string? CanSpread(GameState s, UnitState u)
    {
        if (!IsMissionary(s.Db.Units[u.DefIndex])) return "Only missionaries spread the faith.";
        var p = s.Players[u.Owner];
        if (p.Religion < 0) return "You have no religion to spread.";
        if (SpreadTarget(s, u) is not { } city) return "Stand in or next to a city.";
        if (city.Religion == p.Religion) return "That city already follows your faith.";
        if (u.MovesLeft <= Fx.Zero) return "No moves left.";
        return null;
    }

    /// <summary>A missionary's sermon: small cities convert at once, larger ones move far toward it. The missionary is spent.</summary>
    public static void Spread(GameState s, UnitState u, List<GameEvent> events)
    {
        var p = s.Players[u.Owner];
        var city = SpreadTarget(s, u)!;
        if (city.ReligionCandidate != p.Religion) { city.ReligionCandidate = p.Religion; city.ReligionProgress = Fx.Zero; }
        city.ReligionProgress += Fx.FromInt(MissionaryProgress);
        if (city.Population <= InstantConversionPopulation || city.Religion < 0 || city.ReligionProgress >= Fx.FromInt(ConversionThreshold(city)))
            Convert(s, city, p.Religion, events);
        s.RemoveUnit(u);
    }

    // ----- Spiritual victory ---------------------------------------------------------------------------

    /// <summary>Living majors (other than the founder) whose cities mostly follow the religion, out of all living majors with cities.</summary>
    public static (int Converted, int Total) Reach(GameState s, PlayerState founder)
    {
        int converted = 0, total = 0;
        foreach (var other in s.Players)
        {
            if (other.Id == founder.Id || !other.IsMajor || !other.IsAlive) continue;
            var cities = s.CitiesOf(other.Id).ToList();
            if (cities.Count == 0) continue;
            total++;
            if (cities.Count(c => c.Religion == founder.Religion) * 2 > cities.Count) converted++;
        }
        return (converted, total);
    }

    public static int SpiritualWinner(GameState s)
    {
        foreach (var p in s.Players.Where(p => p.Religion >= 0 && p.IsAlive && p.IsMajor).OrderBy(p => p.Id))
        {
            var (converted, total) = Reach(s, p);
            if (total >= 2 && converted == total && s.CitiesOf(p.Id).Any(c => c.Religion == p.Religion)) return p.Id;
        }
        return -1;
    }
}
