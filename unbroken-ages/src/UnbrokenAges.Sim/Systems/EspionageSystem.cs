using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;

namespace UnbrokenAges.Sim.Systems;

public enum SpyMission : byte { None, Counterintelligence, StealTechnology, SiphonFunds, SabotageProduction, InciteUnrest, FabricateScandal }

/// <summary>
/// Espionage (docs/05-key-systems/18-espionage.md). Civilizations recruit spies as their spy capacity grows (Recorded History,
/// Urbanization, the Spymaster's network), assign them to cities, and run missions. A spy travels first (2 turns plus one per
/// ten tiles), then works the mission's length. Success depends on the mission, the spy's rank and the city's defences
/// (counterintelligence spies and EspionageDefense modifiers). A failed spy may escape home or be caught; a caught spy is lost
/// and the victim gains a grievance. Every success promotes the spy (Recruit → Agent → Special Agent → Master Spy).
/// Rolls are hashed from the turn and the spy, so every peer agrees without touching shared random streams.
/// </summary>
public static class EspionageSystem
{
    public static readonly string[] Ranks = { "Recruit", "Agent", "Special Agent", "Master Spy" };

    public static readonly string[] Codenames =
    {
        "Kestrel", "Juniper", "Halcyon", "Morrow", "Tessellate", "Corvid", "Lantern", "Quill", "Sable", "Wren", "Ember", "Thistle",
        "Cipher", "Marten", "Vesper", "Gannet", "Larkspur", "Obsidian", "Peregrine", "Saffron",
    };

    public static (string Name, int Turns, int BaseChance, string Description) Info(SpyMission m) => m switch
    {
        SpyMission.Counterintelligence => ("Counterintelligence", 0, 100, "Guards one of your cities: enemy missions there are far harder, and caught spies are likelier."),
        SpyMission.StealTechnology => ("Steal Technology", 8, 55, "Progress toward a technology they know and you do not (40% of its cost)."),
        SpyMission.SiphonFunds => ("Siphon Funds", 6, 65, "Takes gold from their treasury: 25 plus four turns of the city's gold."),
        SpyMission.SabotageProduction => ("Sabotage Production", 6, 50, "Destroys half the progress on the city's current build."),
        SpyMission.InciteUnrest => ("Incite Unrest", 6, 45, "The city loses 30 loyalty."),
        SpyMission.FabricateScandal => ("Fabricate Scandal", 6, 50, "In a city-state: its suzerain loses two envoys there."),
        _ => ("Idle", 0, 0, "Awaiting orders."),
    };

    public static int Capacity(GameState s, PlayerState p)
    {
        var db = s.Db;
        int n = 0;
        if (p.HasCivic(db.Civics.IndexOf("CIVIC_RECORDED_HISTORY"))) n++;
        if (p.HasCivic(db.Civics.IndexOf("CIVIC_URBANIZATION"))) n++;
        if (p.HasCivic(db.Civics.IndexOf("CIVIC_ENVIRONMENTALISM"))) n++;
        foreach (var c in s.CitiesOf(p.Id)) n += CityEffects.Compute(s, c).SpyCapacity;
        return n;
    }

    public static SpyState? Find(PlayerState p, int spyId) => p.Spies.Find(x => x.Id == spyId);

    public static bool Foreign(SpyMission m) => m is not (SpyMission.Counterintelligence or SpyMission.None);

    // ----- Orders --------------------------------------------------------------------------------------

    public static string? CanAssign(GameState s, PlayerState p, int spyId, int cityId, SpyMission mission)
    {
        if (Find(p, spyId) is not { } spy) return "No such spy.";
        if (mission == SpyMission.None) return null;   // recall
        if (s.GetCity(cityId) is not { } city) return "No such city.";
        var owner = s.Players[city.Owner];
        if (mission == SpyMission.Counterintelligence)
            return city.Owner == p.Id ? null : "Counterintelligence guards your own cities.";
        if (city.Owner == p.Id) return "That is your own city.";
        if (owner.IsFreeCities) return "The Free Cities keep no secrets worth stealing.";
        if (city.Tile >= p.Revealed.Length || !p.Revealed[city.Tile]) return "You do not know where that city is.";
        if (mission == SpyMission.FabricateScandal)
        {
            if (!owner.IsCityState) return "Scandals are fabricated in city-states.";
            if (owner.Suzerain < 0 || owner.Suzerain == p.Id) return "It has no rival suzerain to embarrass.";
        }
        else if (owner.IsCityState) return "City-states only fall for scandals.";
        if (mission == SpyMission.StealTechnology && StealableTech(s, p, owner) == null) return "They know nothing you do not.";
        if (mission == SpyMission.SabotageProduction && city.Queue.Items.Count == 0) return "Nothing is being built there.";
        if (p.Spies.Any(x => x.Id != spy.Id && x.CityId == cityId && x.Mission == mission)) return "Another of your spies is already on it.";
        return null;
    }

    public static void Assign(GameState s, PlayerState p, int spyId, int cityId, SpyMission mission)
    {
        var spy = Find(p, spyId)!;
        spy.Mission = mission;
        if (mission == SpyMission.None) { spy.CityId = -1; spy.TurnsLeft = 0; return; }
        var city = s.GetCity(cityId)!;
        int home = s.CitiesOf(p.Id).Select(c => s.Map.Distance(c.Tile, city.Tile)).DefaultIfEmpty(0).Min();
        spy.CityId = cityId;
        spy.TurnsLeft = Foreign(mission) ? 2 + home / 10 + Info(mission).Turns : 0;
    }

    public static TechDef? StealableTech(GameState s, PlayerState thief, PlayerState victim) =>
        s.Db.Techs.Where(t => victim.Techs[t.Index] && !thief.Techs[t.Index] && t.DivergenceIndex < 0).OrderBy(t => t.Cost).ThenBy(t => t.Index).FirstOrDefault();

    // ----- Odds ----------------------------------------------------------------------------------------

    /// <summary>Defence of a city: its EspionageDefense levels, plus each counterintelligence spy's rank + 1.</summary>
    public static int Defence(GameState s, CityState city) =>
        CityEffects.Compute(s, city).EspionageDefense +
        s.Players[city.Owner].Spies.Where(x => x.CityId == city.Id && x.Mission == SpyMission.Counterintelligence).Sum(x => x.Level + 1);

    public static int SuccessChance(GameState s, SpyState spy, CityState city) =>
        Math.Clamp(Info(spy.Mission).BaseChance + 10 * spy.Level - 12 * Defence(s, city), 5, 95);

    private static int Roll(GameState s, SpyState spy, int salt) =>
        (int)(StableHash.Combine(StableHash.Combine((ulong)s.Turn, (ulong)spy.Id), (ulong)salt) % 100);

    // ----- The turn ------------------------------------------------------------------------------------

    public static void ProcessTurn(GameState s, List<GameEvent> events)
    {
        foreach (var p in s.Players.Where(p => p.IsMajor && p.IsAlive))
        {
            // Recruit up to capacity.
            while (p.Spies.Count < Capacity(s, p))
            {
                // The next codename this civilization has not used (each civilization starts at a different point in the list).
                string name = Enumerable.Range(0, Codenames.Length).Select(k => Codenames[(p.Id * 7 + k) % Codenames.Length])
                                        .FirstOrDefault(n => p.Spies.All(x => x.Name != n)) ?? $"Agent {p.Spies.Count + 1}";
                var spy = new SpyState { Id = s.AllocateId(), Name = name };
                p.Spies.Add(spy);
                events.Add(new GameEvent(GameEventType.SpyRecruited, p.Id, Value: spy.Id, Detail: spy.Name));
            }
            foreach (var spy in p.Spies.ToList())
            {
                if (!Foreign(spy.Mission)) continue;
                var city = s.GetCity(spy.CityId);
                if (city == null || city.Owner == p.Id || s.Players[city.Owner].IsFreeCities) { spy.Mission = SpyMission.None; spy.CityId = -1; continue; }
                if (--spy.TurnsLeft > 0) continue;
                Resolve(s, p, spy, city, events);
            }
        }
    }

    private static void Resolve(GameState s, PlayerState p, SpyState spy, CityState city, List<GameEvent> events)
    {
        var victim = s.Players[city.Owner];
        int chance = SuccessChance(s, spy, city);
        string mission = Info(spy.Mission).Name;
        if (Roll(s, spy, 1) < chance)
        {
            string what = Apply(s, p, spy.Mission, city, victim);
            spy.Level = Math.Min(Ranks.Length - 1, spy.Level + 1);
            events.Add(new GameEvent(GameEventType.SpyMissionSucceeded, p.Id, city.Id, city.Tile, Value: victim.Id, Detail: $"{spy.Name}: {mission} in {city.Name} — {what}"));
            // Spotted afterwards? The victim learns who did it a third of the time.
            if (Roll(s, spy, 2) < 33 && victim.IsMajor) DiplomacySystem.AddGrievance(s, victim.Id, p.Id, 8, $"Espionage in {city.Name}");
        }
        else
        {
            int counter = s.Players[city.Owner].Spies.Count(x => x.CityId == city.Id && x.Mission == SpyMission.Counterintelligence);
            bool caught = Roll(s, spy, 3) < 40 + 15 * counter;
            if (caught)
            {
                p.Spies.Remove(spy);
                if (victim.IsMajor) DiplomacySystem.AddGrievance(s, victim.Id, p.Id, 15, $"A spy caught in {city.Name}");
                events.Add(new GameEvent(GameEventType.SpyCaught, p.Id, city.Id, city.Tile, Value: victim.Id, Detail: $"{spy.Name} was caught in {city.Name} ({mission})"));
                return;
            }
            events.Add(new GameEvent(GameEventType.SpyMissionFailed, p.Id, city.Id, city.Tile, Value: victim.Id, Detail: $"{spy.Name} failed to {mission.ToLowerInvariant()} in {city.Name} and escaped"));
        }
        spy.Mission = SpyMission.None;
        spy.CityId = -1;
    }

    private static string Apply(GameState s, PlayerState p, SpyMission mission, CityState city, PlayerState victim)
    {
        switch (mission)
        {
            case SpyMission.StealTechnology:
                if (StealableTech(s, p, victim) is not { } tech) return "nothing new to learn";
                Fx gain = ResearchSystem.Cost(s, p, tech) * 40 / 100;
                p.TechProgress += gain;
                return $"+{gain.FloorToInt()} science from their {tech.Name}";
            case SpyMission.SiphonFunds:
            {
                var yields = CityYields.Compute(s, city, CityEffects.Compute(s, city));
                Fx take = Fx.Min(Fx.Max(Fx.Zero, victim.Gold), Fx.FromInt(25) + yields.Total.Gold * 4);
                victim.Gold -= take;
                p.Gold += take;
                return $"{take.FloorToInt()} gold siphoned";
            }
            case SpyMission.SabotageProduction:
                if (city.Queue.Items.FirstOrDefault() is not { } item || !city.ProgressLedger.TryGetValue(item.ProgressKey, out Fx progress)) return "the works were empty";
                city.ProgressLedger[item.ProgressKey] = progress / 2;
                return $"half the work on {ProductionSystem.ItemName(s.Db, item)} destroyed";
            case SpyMission.InciteUnrest:
                city.Loyalty = Fx.Max(Fx.Zero, city.Loyalty - Fx.FromInt(30));
                return "loyalty −30";
            case SpyMission.FabricateScandal:
                if (victim.Suzerain < 0 || victim.Suzerain >= victim.Envoys.Count) return "no suzerain to embarrass";
                int target = victim.Suzerain;
                victim.Envoys[target] = Math.Max(0, victim.Envoys[target] - 2);
                victim.Suzerain = CityStateSystem.ComputeSuzerain(s, victim);
                return $"{s.Players[target].Name} loses two envoys";
        }
        return "";
    }
}
