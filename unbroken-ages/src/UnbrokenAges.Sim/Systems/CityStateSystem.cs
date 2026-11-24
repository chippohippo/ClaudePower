using UnbrokenAges.Sim.AI;
using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.State;
using UnbrokenAges.Sim.Systems.Districts;

namespace UnbrokenAges.Sim.Systems;

/// <summary>
/// City-states (docs/05-key-systems/16-city-states.md). Minor powers of one city, each its own player with its own diplomacy.
/// Civilizations earn <b>influence</b> every turn (more under governments with diplomatic slots and with diplomatic cards), and
/// every so often an <b>envoy</b>. The first civilization to meet a city-state gets a free envoy there; a second meeting is a
/// handshake. Envoys pay the city-state's <b>type bonus</b> — 1 envoy: +2 of its yield in your capital; 3: +2 in every city with its
/// district; 6: +2 more there. The civilization with the most envoys (at least 3, an incumbent keeps a tie) is its
/// <b>suzerain</b> and gets its unique bonus. City-states keep pace with the world's technology, raise defenders, and fight back.
/// </summary>
public static class CityStateSystem
{
    public const int FirstTier = 1, SecondTier = 3, ThirdTier = 6, SuzerainMinimum = 3, TierYield = 2;

    public static int EnvoyCost(PlayerState p) => 25 + 5 * Math.Min(p.EnvoysEarned, 8);

    /// <summary>Influence per turn: one, plus each diplomatic slot of the government and each diplomatic card slotted.</summary>
    public static int InfluencePerTurn(GameState s, PlayerState p)
    {
        int n = 1;
        if (p.Government >= 0) n += s.Db.Governments[p.Government].Diplomatic;
        n += p.Policies.Count(c => s.Db.Policies[c].Slot == PolicySlot.Diplomatic);
        n += TradeSystem.InfluenceFromRoutes(s, p.Id);
        n += LeaderSystem.PlayerEffect(s, p, ModifierEffect.InfluencePerTurn);
        return Math.Max(0, n);
    }

    public static (YieldType Yield, string District) TypeBonus(CityStateType type) => type switch
    {
        CityStateType.Scientific => (YieldType.Science, "DISTRICT_ACADEMY"),
        CityStateType.Cultural => (YieldType.Culture, "DISTRICT_CULTURAL_QUARTER"),
        CityStateType.Trade => (YieldType.Gold, "DISTRICT_MARKET"),
        CityStateType.Religious => (YieldType.Faith, "DISTRICT_SANCTUARY"),
        CityStateType.Industrial => (YieldType.Production, "DISTRICT_FOUNDRY"),
        _ => (YieldType.Production, "DISTRICT_GARRISON"),
    };

    public static IEnumerable<PlayerState> CityStates(GameState s) => s.Players.Where(p => p.IsCityState && p.IsAlive);

    public static int EnvoysFrom(PlayerState cityState, int player) =>
        player >= 0 && player < cityState.Envoys.Count ? cityState.Envoys[player] : 0;

    private static long MetKey(PlayerState cityState, int player) => 3_000_000_000L + (long)cityState.Id * 1000 + player;

    public static bool HasMet(GameState s, PlayerState cityState, int player) => s.Discoveries.Contains(MetKey(cityState, player));

    public static CityState? Capital(GameState s, PlayerState cityState) => s.CitiesOf(cityState.Id).OrderBy(c => c.Id).FirstOrDefault();

    // ----- Envoys --------------------------------------------------------------------------------------

    public static string? CanSendEnvoy(GameState s, PlayerState p, int cityStatePlayer)
    {
        if (!p.IsMajor) return "Only civilizations send envoys.";
        if (cityStatePlayer < 0 || cityStatePlayer >= s.Players.Count || s.Players[cityStatePlayer] is not { IsCityState: true, IsAlive: true } cs) return "No such city-state.";
        if (p.EnvoyTokens <= 0) return "No envoys to send.";
        if (!HasMet(s, cs, p.Id)) return "You have not met them.";
        if (DiplomacySystem.AtWar(s, p.Id, cs.Id)) return "You are at war with them.";
        return null;
    }

    public static void SendEnvoy(GameState s, PlayerState p, int cityStatePlayer, List<GameEvent> events)
    {
        var cs = s.Players[cityStatePlayer];
        p.EnvoyTokens--;
        Grow(cs, s.Players.Count);
        cs.Envoys[p.Id]++;
        events.Add(new GameEvent(GameEventType.EnvoySent, p.Id, Value: cs.Id, Detail: cs.Name));
        UpdateSuzerain(s, cs, events);
    }

    private static void Grow(PlayerState cs, int players)
    {
        while (cs.Envoys.Count < players) cs.Envoys.Add(0);
    }

    /// <summary>Most envoys, at least three; the incumbent keeps a tie, otherwise a tie means no suzerain. Warring players do not count.</summary>
    public static int ComputeSuzerain(GameState s, PlayerState cs)
    {
        int best = -1, bestCount = 0;
        bool tie = false;
        for (int p = 0; p < cs.Envoys.Count; p++)
        {
            int n = cs.Envoys[p];
            if (n < SuzerainMinimum || !s.Players[p].IsAlive || DiplomacySystem.AtWar(s, p, cs.Id)) continue;
            if (n > bestCount) { best = p; bestCount = n; tie = false; }
            else if (n == bestCount) tie = true;
        }
        if (!tie) return best;
        return cs.Suzerain >= 0 && EnvoysFrom(cs, cs.Suzerain) == bestCount && !DiplomacySystem.AtWar(s, cs.Suzerain, cs.Id) ? cs.Suzerain : -1;
    }

    private static void UpdateSuzerain(GameState s, PlayerState cs, List<GameEvent> events)
    {
        int next = ComputeSuzerain(s, cs);
        if (next == cs.Suzerain) return;
        cs.Suzerain = next;
        events.Add(new GameEvent(GameEventType.SuzerainChanged, next, Value: cs.Id, Detail: cs.Name));
    }

    // ----- Bonuses -------------------------------------------------------------------------------------

    private static readonly Dictionary<(YieldType, int), List<ModifierDef>> FlatCache = new();

    private static List<ModifierDef> Flat(YieldType y, int amount)
    {
        lock (FlatCache)
        {
            if (!FlatCache.TryGetValue((y, amount), out var list))
                FlatCache[(y, amount)] = list = new List<ModifierDef> { new() { Effect = ModifierEffect.CityYieldFlat, Yield = y, Amount = Fx.FromInt(amount) } };
            return list;
        }
    }

    /// <summary>Envoy and suzerain modifiers on one of the player's cities.</summary>
    public static IEnumerable<(List<ModifierDef> Modifiers, string Source)> CityModifierSources(GameState s, CityState city)
    {
        var owner = s.Players[city.Owner];
        if (!owner.IsMajor) yield break;
        var db = s.Db;
        foreach (var cs in CityStates(s))
        {
            int n = EnvoysFrom(cs, owner.Id);
            if (n <= 0 || DiplomacySystem.AtWar(s, owner.Id, cs.Id)) continue;
            var def = db.CityStates[cs.CityStateIndex];
            var (yield, district) = TypeBonus(def.Type);
            int family = db.Districts.IndexOf(district);
            int amount = 0;
            if (city.IsCapital) amount += TierYield;
            bool hasDistrict = family >= 0 && city.Districts.Any(d => !d.Pillaged && AdjacencyCalculator.DistrictMatches(db, d.DefIndex, family));
            if (hasDistrict && n >= SecondTier) amount += TierYield;
            if (hasDistrict && n >= ThirdTier) amount += TierYield;
            if (amount > 0) yield return (Flat(yield, amount), $"{def.Name} ({n} envoy{(n == 1 ? "" : "s")})");
            if (cs.Suzerain == owner.Id) yield return (def.Suzerain.Modifiers, $"{def.Name}: {def.Suzerain.Name} (suzerain)");
        }
    }

    /// <summary>Suzerain bonuses that reach units (UnitStrength modifiers).</summary>
    public static IEnumerable<(List<ModifierDef> Modifiers, string Source)> SuzerainSources(GameState s, int player)
    {
        foreach (var cs in CityStates(s))
            if (cs.Suzerain == player) yield return (s.Db.CityStates[cs.CityStateIndex].Suzerain.Modifiers, s.Db.CityStates[cs.CityStateIndex].Name);
    }

    // ----- The turn ------------------------------------------------------------------------------------

    public static void ProcessTurn(GameState s, List<GameEvent> events)
    {
        var majors = s.Players.Where(p => p.IsMajor && p.IsAlive).ToList();
        if (!CityStates(s).Any()) return;

        // Influence and envoys.
        foreach (var p in majors)
        {
            p.Influence += InfluencePerTurn(s, p);
            int cost = EnvoyCost(p);
            if (p.Influence < cost) continue;
            p.Influence -= cost;
            p.EnvoyTokens++;
            p.EnvoysEarned++;
            events.Add(new GameEvent(GameEventType.EnvoyEarned, p.Id, Value: p.EnvoyTokens));
        }

        foreach (var cs in CityStates(s).ToList())
        {
            Grow(cs, s.Players.Count);
            var capital = Capital(s, cs);
            // First contact: whoever has seen the city-state's capital has met it; the first to do so leaves an envoy.
            if (capital != null)
                foreach (var p in majors)
                {
                    if (capital.Tile >= p.Revealed.Length || !p.Revealed[capital.Tile] || !s.Discoveries.Add(MetKey(cs, p.Id))) continue;
                    bool first = !majors.Any(o => o.Id != p.Id && HasMet(s, cs, o.Id));   // ties go to the lowest id
                    events.Add(new GameEvent(GameEventType.CityStateMet, p.Id, Value: cs.Id, Detail: cs.Name));
                    if (first) { cs.Envoys[p.Id]++; events.Add(new GameEvent(GameEventType.EnvoySent, p.Id, Value: cs.Id, Detail: cs.Name)); }
                }
            KeepPace(s, cs, majors);
            // City-states never want war: they accept any lawful peace.
            foreach (var rel in s.Relations.Where(r => (r.A == cs.Id || r.B == cs.Id) && r.PeaceProposedBy >= 0 && r.PeaceProposedBy != cs.Id).ToList())
            {
                var accept = new Commands.AcceptPeaceCommand { Player = cs.Id, Target = rel.PeaceProposedBy };
                if (accept.Validate(s) == null) accept.Apply(s, events);
            }
            if (capital != null) Defend(s, cs, capital, events);
            UpdateSuzerain(s, cs, events);
        }
    }

    /// <summary>A city-state knows every technology and civic that half the living civilizations know.</summary>
    private static void KeepPace(GameState s, PlayerState cs, List<PlayerState> majors)
    {
        if (majors.Count == 0) return;
        for (int t = 0; t < cs.Techs.Length; t++)
            if (!cs.Techs[t] && s.Db.Techs[t].DivergenceIndex < 0 && majors.Count(p => p.Techs[t]) * 2 >= majors.Count) cs.Techs[t] = true;
        for (int c = 0; c < cs.Civics.Length; c++)
            if (!cs.Civics[c] && s.Db.Civics[c].DivergenceIndex < 0 && majors.Count(p => p.Civics[c]) * 2 >= majors.Count) cs.Civics[c] = true;
    }

    /// <summary>Keep two defenders (three at war), else build; strike anything hostile that comes adjacent.</summary>
    private static void Defend(GameState s, PlayerState cs, CityState city, List<GameEvent> events)
    {
        var db = s.Db;
        var guards = s.Units.Where(u => u.Owner == cs.Id && SupplySystem.IsMilitary(db, u)).ToList();
        bool threatened = s.Players.Any(o => o.Id != cs.Id && o.IsAlive && !o.IsFreeCities && DiplomacySystem.AtWar(s, cs.Id, o.Id) &&
                                             s.Units.Any(u => u.Owner == o.Id && s.Map.Distance(u.Tile, city.Tile) <= 5));
        int want = threatened ? 3 : 2;
        if (city.Queue.Items.Count == 0)
        {
            if (guards.Count < want && MilitaryAi.BestLandUnit(s, city) is { } unit)
                ProductionSystem.Enqueue(s, city, ProductionKind.Unit, unit.Index, -1, -1, false);
            else if (db.Buildings.Where(b => ProductionSystem.Validate(s, city, ProductionKind.Building, b.Index, -1) == null)
                                 .OrderBy(b => b.Cost).ThenBy(b => b.Index).FirstOrDefault() is { } building)
                ProductionSystem.Enqueue(s, city, ProductionKind.Building, building.Index, -1, -1, false);
        }
        foreach (var guard in guards)
        {
            if (s.GetUnit(guard.Id) == null || guard.MovesLeft <= Fx.Zero) continue;
            var foe = s.Units.Where(u => u.Owner != cs.Id && s.Map.Distance(u.Tile, guard.Tile) == 1 && DiplomacySystem.AtWar(s, cs.Id, u.Owner))
                             .OrderBy(u => u.Hp).ThenBy(u => u.Id).FirstOrDefault();
            if (foe != null)
            {
                var preview = CombatSystem.Preview(s, guard, foe.Tile);
                if (preview.Legal && CombatSystem.OddsPercent(preview) >= 55) { CombatSystem.Resolve(s, guard, foe.Tile, events); continue; }
            }
            // Stray guards come home.
            if (s.Map.Distance(guard.Tile, city.Tile) > 2 && guard.Destination < 0 && Movement.FindPath(s, guard, city.Tile) != null)
            {
                guard.Destination = city.Tile;
                Movement.MoveAlong(s, guard);
            }
            else if (s.Map.Distance(guard.Tile, city.Tile) <= 1) guard.Fortified = true;
        }
    }

    // ----- Placement ---------------------------------------------------------------------------------

    /// <summary>
    /// Places city-states at game start: good land (fresh water, open neighbours), at least six tiles from every start and from
    /// each other, chosen from the best candidates by the setup seed. Each gets a city and a warrior.
    /// </summary>
    public static void Place(GameState s, IReadOnlyList<int> starts, ulong seed, IReadOnlyDictionary<int, int>? sites = null)
    {
        var db = s.Db;
        var map = s.Map;
        int majors = s.Players.Count(p => p.IsMajor);
        int wanted = s.Options.CityStates < 0 ? majors : s.Options.CityStates;
        wanted = Math.Min(wanted, db.CityStates.Count);
        if (wanted <= 0) return;
        var rng = Pcg32.Derive(seed, "city-states");
        var order = Enumerable.Range(0, db.CityStates.Count).ToList();
        for (int i = order.Count - 1; i > 0; i--) { int j = rng.NextInt(i + 1); (order[i], order[j]) = (order[j], order[i]); }

        var taken = new List<int>(starts);
        int warrior = db.Units.IndexOf("UNIT_WARRIOR");
        var around = new List<int>();
        foreach (int defIndex in order)
        {
            if (wanted == 0) break;
            if (sites is { Count: > 0 })
            {
                // A scripted map: the city-state stands at its real site (or the nearest good tile within two), or not at all.
                if (!sites.TryGetValue(defIndex, out int site)) continue;
                around.Clear();
                map.CollectRadius(site, 2, around);
                int at = around.Where(t => map.IsLand(t) && !map.IsMountain(t) && !map.IsChannel(t) &&
                                           !(map.Feature[t] >= 0 && db.Features[map.Feature[t]].NaturalWonder) &&
                                           starts.All(o => map.Distance(o, t) >= 4) && taken.Skip(starts.Count).All(o => map.Distance(o, t) >= 3))
                               .OrderBy(t => map.Distance(t, site)).ThenBy(t => t).DefaultIfEmpty(-1).First();
                if (at < 0) continue;
                Found(at, defIndex);
                continue;
            }
            var candidates = new List<(int Tile, int Score)>();
            for (int t = 0; t < map.Count; t++)
            {
                if (!map.IsLand(t) || map.IsMountain(t) || map.IsChannel(t) || map.Resource[t] >= 0) continue;
                if (map.Feature[t] >= 0 && (db.Features[map.Feature[t]].NaturalWonder || !db.Features[map.Feature[t]].Removable)) continue;
                if (taken.Any(o => map.Distance(o, t) < 6)) continue;
                around.Clear();
                map.CollectRadius(t, 2, around);
                int score = around.Count(n => map.IsLand(n) && !map.IsMountain(n)) * 2 + (map.RiverEdges[t] != 0 ? 6 : 0) + around.Count(n => map.IsWater(n) && !map.IsChannel(n) && n != t);
                if (around.Count(n => map.IsLand(n)) < 8) continue;
                candidates.Add((t, score));
            }
            if (candidates.Count == 0) break;
            var best = candidates.OrderByDescending(c => c.Score).ThenBy(c => c.Tile).Take(Math.Max(1, candidates.Count / 6)).ToList();
            Found(best[rng.NextInt(best.Count)].Tile, defIndex);
        }

        void Found(int tile, int defIndex)
        {
            var def = db.CityStates[defIndex];
            var cs = new PlayerState
            {
                Id = s.Players.Count, Name = def.Name, CityStateIndex = defIndex, Team = -1,
                Techs = new bool[db.Techs.Count], Civics = new bool[db.Civics.Count], Stockpile = new int[db.Resources.Count],
                Revealed = new bool[map.Count],
            };
            s.Players.Add(cs);
            CitySystem.Found(s, cs.Id, tile, def.Name);
            if (warrior >= 0)
                s.AddUnit(new UnitState { Id = s.AllocateId(), Owner = cs.Id, DefIndex = warrior, Tile = tile, MovesLeft = Fx.FromInt(db.Units[warrior].Moves), Fortified = true });
            taken.Add(tile);
            wanted--;
        }
        foreach (var p in s.Players) Grow(p, 0);
        foreach (var cs in s.Players.Where(p => p.IsCityState)) Grow(cs, s.Players.Count);
    }
}
