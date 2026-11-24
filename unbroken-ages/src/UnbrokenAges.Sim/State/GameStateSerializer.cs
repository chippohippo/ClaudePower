using System.Runtime.InteropServices;
using UnbrokenAges.Sim.Core;
using UnbrokenAges.Sim.Data;
using UnbrokenAges.Sim.Map;
using UnbrokenAges.Sim.Systems;

namespace UnbrokenAges.Sim.State;

/// <summary>
/// Compact, versioned binary snapshot of the full simulation state. Used for saves, multiplayer
/// resync/reconnect, and (hashed) for desync detection. Field order is the contract: append new
/// fields at the end of a section and bump <see cref="Version"/>.
/// </summary>
public static class GameStateSerializer
{
    public const uint Magic = 0x56534155; // "UASV"
    public const int Version = 21;

    public static byte[] Serialize(GameState s)
    {
        using var ms = new MemoryStream();
        using (var w = new BinaryWriter(ms)) Write(w, s);
        return ms.ToArray();
    }

    public static ulong Hash(GameState s) => StableHash.Fnv1a64(Serialize(s));

    public static void Write(BinaryWriter w, GameState s)
    {
        w.Write(Magic);
        w.Write(Version);
        w.Write(s.Db.ContentHash);
        w.Write(s.Turn);
        w.Write(s.NextId);
        WriteRng(w, s.GameplayRng);
        WriteRng(w, s.DisasterRng);
        WriteRng(w, s.CombatRng);

        var o = s.Options;
        w.Write(o.GameSpeedPercent); w.Write(o.EraPacingPercent); w.Write(o.DisasterIntensity);
        w.Write(o.ClimateEnabled); w.Write(o.LoyaltyEnabled); w.Write(o.MaxQueueLength);
        w.Write((byte)o.TurnMode); w.Write(o.StartingGovernorTitles); w.Write(o.NoSurpriseWars); w.Write(o.SupplyCombatPenalty);
        w.Write(o.TurnLimit); w.Write((int)o.Victories); w.Write(o.CityStates);

        var m = s.Map;
        w.Write(m.Width); w.Write(m.Height); w.Write(m.WrapX);
        WriteArray<byte>(w, m.Terrain); WriteArray<byte>(w, m.Relief); WriteArray<short>(w, m.Feature);
        WriteArray<short>(w, m.Resource); WriteArray<short>(w, m.Improvement); WriteArray<short>(w, m.District);
        WriteArray<short>(w, m.Elevation); WriteArray<byte>(w, m.RiverEdges); WriteArray<byte>(w, m.Lowland);
        WriteArray<byte>(w, m.Flags); WriteArray<byte>(w, m.Fertility); WriteArray<int>(w, m.OwnerPlayer);
        WriteArray<int>(w, m.OwnerCity); WriteArray<int>(w, m.Reservation);

        w.Write(s.Players.Count);
        foreach (var p in s.Players)
        {
            w.Write(p.Id); w.Write(p.Name); w.Write(p.CivIndex); w.Write(p.LeaderIndex); w.Write(p.Team);
            w.Write(p.IsHuman); w.Write(p.IsFreeCities); w.Write(p.IsAlive); w.Write(p.HasEndedTurn);
            WriteFx(w, p.Gold); WriteFx(w, p.Faith);
            w.Write(p.CurrentTech); w.Write(p.CurrentCivic); WriteFx(w, p.TechProgress); WriteFx(w, p.CivicProgress);
            WriteBools(w, p.Techs); WriteBools(w, p.Civics);
            WriteArray<int>(w, p.Stockpile);
            WriteBools(w, p.Revealed);
            w.Write((byte)p.Age); w.Write(p.GovernorTitles);
            w.Write(p.Governors.Count);
            foreach (var g in p.Governors)
            {
                w.Write(g.DefIndex); w.Write(g.CityId); w.Write(g.EstablishProgress); w.Write(g.Established);
                w.Write(g.Promotions.Count);
                foreach (int pr in g.Promotions) w.Write(pr);
                w.Write(g.Experience);
                w.Write(g.Traits.Count);
                foreach (int t in g.Traits) w.Write(t);
                w.Write(g.TraitProgress.Count);
                foreach (var (trait, count) in g.TraitProgress) { w.Write(trait); w.Write(count); }
            }
            w.Write((byte)p.DispatchPolicy); WriteFx(w, p.EmissionsLastTurn); WriteFx(w, p.CumulativeEmissions);
            w.Write(p.CapitalCityId);
            w.Write(p.Divergence); w.Write(p.DivergenceTurn); w.Write(p.Ascended); w.Write(p.LastWarDeclaredTurn);
            WriteFx(w, p.SignatureMeter); w.Write(p.SignatureTimer); w.Write(p.SignatureTally);
        }

        w.Write(s.Cities.Count);
        foreach (var c in s.Cities)
        {
            w.Write(c.Id); w.Write(c.Owner); w.Write(c.OriginalOwner); w.Write(c.Name); w.Write(c.Tile);
            w.Write(c.Population); WriteFx(w, c.FoodStored); WriteFx(w, c.Loyalty); WriteFx(w, c.LastLoyaltyDelta);
            w.Write(c.IsCapital); w.Write(c.FoundedTurn); w.Write(c.TurnsSinceOwnerChange);
            w.Write(c.Districts.Count);
            foreach (var d in c.Districts)
            {
                w.Write(d.DefIndex); w.Write(d.Tile); w.Write(d.Pillaged);
                w.Write(d.Buildings.Count);
                foreach (int b in d.Buildings) w.Write(b);
            }
            w.Write(c.Queue.NextUid);
            w.Write(c.Queue.Items.Count);
            foreach (var q in c.Queue.Items)
            {
                w.Write(q.Uid); w.Write((byte)q.Kind); w.Write(q.DefIndex); w.Write(q.Tile); w.Write(q.Repeat);
            }
            w.Write(c.ProgressLedger.Count);
            foreach (var (key, value) in c.ProgressLedger) { w.Write(key); WriteFx(w, value); }
            WriteFx(w, c.OverflowProduction);
            w.Write(c.IsPowered); w.Write(c.PowerDemand); w.Write(c.PowerPriority); w.Write(c.GovernorDef);
            WriteFx(w, c.YieldsLastTurnProduction);
            w.Write(c.Hp); w.Write(c.StruckThisTurn); w.Write(c.WasOriginalCapital); WriteFx(w, c.BorderProgress); w.Write(c.TilesClaimed);
        }

        w.Write(s.Units.Count);
        foreach (var u in s.Units)
        {
            w.Write(u.Id); w.Write(u.Owner); w.Write(u.DefIndex); w.Write(u.Tile); WriteFx(w, u.MovesLeft);
            w.Write(u.Hp); w.Write(u.Charges); w.Write(u.Destination); w.Write(u.Fortified); w.Write(u.AttackedThisTurn); w.Write(u.Variant);
        }

        var cl = s.Climate;
        WriteFx(w, cl.Co2Ppm); WriteFx(w, cl.Temperature); w.Write(cl.Phase); WriteFx(w, cl.EmissionsLastTurn);
        WriteFx(w, cl.PendingDeforestation); w.Write(cl.LastPhaseChangeTurn);

        var wd = s.World;
        WriteFx(w, wd.Progress); WriteFx(w, wd.Strife); WriteFx(w, wd.Calamity); w.Write(wd.WorldEra); w.Write(wd.CurrentAge);
        w.Write(wd.AgeHistory.Count);
        foreach (var (era, age) in wd.AgeHistory) { w.Write(era); w.Write(age); }
        w.Write(s.Chronicle.Count);
        foreach (var e in s.Chronicle) { w.Write(e.Turn); w.Write(e.Year); w.Write(e.Player); w.Write((byte)e.Kind); w.Write(e.Text); }

        w.Write(s.Relations.Count);
        foreach (var rel in s.Relations)
        {
            w.Write(rel.A); w.Write(rel.B); w.Write((byte)rel.Status); w.Write(rel.Since); w.Write(rel.DenouncedByA); w.Write(rel.DenouncedByB);
            w.Write(rel.PeaceProposedBy); w.Write(rel.AGrantsB); w.Write(rel.BGrantsA);
        }
        w.Write(s.Grievances.Count);
        foreach (var g in s.Grievances) { w.Write(g.Holder); w.Write(g.Against); WriteFx(w, g.Amount); w.Write(g.Turn); w.Write(g.Reason); }
        w.Write(s.Outposts.Count);
        foreach (var op in s.Outposts)
        {
            w.Write(op.Id); w.Write(op.Owner); w.Write(op.Tile); w.Write(op.Name); w.Write(op.FoundedTurn); w.Write(op.HarvestTile);
            w.Write(op.Tiles.Count);
            foreach (int t in op.Tiles) w.Write(t);
        }
        w.Write(s.TurnPhases.Count);
        foreach (var phase in s.TurnPhases) { w.Write(phase.Length); foreach (int p in phase) w.Write(p); }
        var v = s.Victory;
        w.Write(v.Winner); w.Write(v.WinnerTeam); w.Write((int)v.Kind); w.Write(v.Turn); w.Write(v.Continued);

        // Society (version 14).
        foreach (var p in s.Players)
        {
            w.Write(p.Government); WriteList(w, p.Policies); w.Write(p.PolicySwapFree); w.Write(p.Pantheon); w.Write(p.Religion);
            WriteList(w, p.Beliefs); WriteArray<int>(w, p.GreatPersonPoints); WriteArray<int>(w, p.GreatPeopleRecruited);
            w.Write(p.EraScore); w.Write(p.AgeEra); w.Write(p.WarWeariness);
            w.Write(p.CityStateIndex); w.Write(p.Influence); w.Write(p.EnvoyTokens); w.Write(p.EnvoysEarned); WriteList(w, p.Envoys); w.Write(p.Suzerain);
            w.Write(p.Spies.Count);
            foreach (var spy in p.Spies) { w.Write(spy.Id); w.Write(spy.Name); w.Write(spy.Level); w.Write(spy.CityId); w.Write((byte)spy.Mission); w.Write(spy.TurnsLeft); }
            WriteFx(w, p.LifetimeCulture); WriteList(w, p.TourismTo); w.Write(p.Favor); w.Write(p.DiplomaticPoints); WriteList(w, p.CompletedProjects); w.Write(p.ExodusStage);
        }
        foreach (var c in s.Cities) { w.Write(c.Religion); WriteFx(w, c.ReligionProgress); w.Write(c.ReligionCandidate); }
        foreach (var u in s.Units) { w.Write(u.Experience); WriteList(w, u.Promotions); w.Write(u.Formation); }
        w.Write(s.Camps.Count);
        foreach (var (tile, timer) in s.Camps) { w.Write(tile); w.Write(timer); }
        WriteList(w, s.GreatPeopleTaken.OrderBy(x => x).ToList());
        w.Write(s.Discoveries.Count);
        foreach (long d in s.Discoveries.OrderBy(x => x)) w.Write(d);
        // Trade (version 16).
        w.Write(s.TradeRoutes.Count);
        foreach (var r in s.TradeRoutes)
        {
            w.Write(r.Id); w.Write(r.Owner); w.Write(r.Origin); w.Write(r.Destination); w.Write(r.TurnsLeft); w.Write(r.TraderDef);
            WriteList(w, r.Path);
        }
        // Culture (version 18).
        w.Write(s.GreatWorks.Count);
        foreach (var g in s.GreatWorks) { w.Write(g.Id); w.Write(g.Name); w.Write(g.Kind); w.Write(g.Creator); w.Write(g.Owner); w.Write(g.CityId); }
        // World Congress (version 19).
        var congress = s.Congress;
        w.Write(congress.NextSession); w.Write(congress.Sessions);
        w.Write(congress.Pending.Count);
        foreach (var res in congress.Pending)
        {
            w.Write((byte)res.Kind);
            w.Write(res.Votes.Count);
            foreach (var vote in res.Votes) { w.Write(vote.Player); w.Write(vote.Option); w.Write(vote.Target); w.Write(vote.Extra); }
        }
        w.Write(congress.Active.Count);
        foreach (var a in congress.Active) { w.Write((byte)a.Kind); w.Write(a.Option); w.Write(a.Target); }
        // Space (version 21).
        w.Write(s.Satellites.Count);
        foreach (var sat in s.Satellites) { w.Write(sat.Id); w.Write(sat.Owner); w.Write(sat.Kind); w.Write(sat.Center); w.Write(sat.TurnsLeft); }
    }

    private static void WriteList(BinaryWriter w, List<int> list)
    {
        w.Write(list.Count);
        foreach (int x in list) w.Write(x);
    }

    private static List<int> ReadList(BinaryReader r)
    {
        int n = r.ReadInt32();
        var list = new List<int>(n);
        for (int i = 0; i < n; i++) list.Add(r.ReadInt32());
        return list;
    }

    public static GameState Deserialize(byte[] data, GameDatabase db)
    {
        using var r = new BinaryReader(new MemoryStream(data));
        return Read(r, db);
    }

    public static GameState Read(BinaryReader r, GameDatabase db)
    {
        if (r.ReadUInt32() != Magic) throw new InvalidDataException("Not a game state snapshot.");
        int version = r.ReadInt32();
        if (version != Version) throw new InvalidDataException($"Unsupported snapshot version {version}.");
        ulong content = r.ReadUInt64();
        if (content != db.ContentHash) throw new InvalidDataException("Snapshot was created with different game content (mods).");
        int turn = r.ReadInt32();
        int nextId = r.ReadInt32();
        var gameplayRng = ReadRng(r);
        var disasterRng = ReadRng(r);
        var combatRng = ReadRng(r);

        var o = new GameOptions
        {
            GameSpeedPercent = r.ReadInt32(), EraPacingPercent = r.ReadInt32(), DisasterIntensity = r.ReadInt32(),
            ClimateEnabled = r.ReadBoolean(), LoyaltyEnabled = r.ReadBoolean(), MaxQueueLength = r.ReadInt32(),
            TurnMode = (TurnMode)r.ReadByte(), StartingGovernorTitles = r.ReadInt32(), NoSurpriseWars = r.ReadBoolean(), SupplyCombatPenalty = r.ReadBoolean(),
            TurnLimit = r.ReadInt32(), Victories = (VictoryKind)r.ReadInt32(), CityStates = r.ReadInt32(),
        };

        int width = r.ReadInt32(), height = r.ReadInt32();
        bool wrap = r.ReadBoolean();
        var m = new MapGrid(db, width, height, wrap);
        ReadArray(r, m.Terrain); ReadArray(r, m.Relief); ReadArray(r, m.Feature);
        ReadArray(r, m.Resource); ReadArray(r, m.Improvement); ReadArray(r, m.District);
        ReadArray(r, m.Elevation); ReadArray(r, m.RiverEdges); ReadArray(r, m.Lowland);
        ReadArray(r, m.Flags); ReadArray(r, m.Fertility); ReadArray(r, m.OwnerPlayer);
        ReadArray(r, m.OwnerCity); ReadArray(r, m.Reservation);

        var s = new GameState(db, o, m, 0) { Turn = turn, NextId = nextId, GameplayRng = gameplayRng, DisasterRng = disasterRng, CombatRng = combatRng };

        int players = r.ReadInt32();
        for (int i = 0; i < players; i++)
        {
            var p = new PlayerState
            {
                Id = r.ReadInt32(), Name = r.ReadString(), CivIndex = r.ReadInt32(), LeaderIndex = r.ReadInt32(), Team = r.ReadInt32(),
                IsHuman = r.ReadBoolean(), IsFreeCities = r.ReadBoolean(), IsAlive = r.ReadBoolean(), HasEndedTurn = r.ReadBoolean(),
                Gold = ReadFx(r), Faith = ReadFx(r),
                CurrentTech = r.ReadInt32(), CurrentCivic = r.ReadInt32(), TechProgress = ReadFx(r), CivicProgress = ReadFx(r),
            };
            p.Techs = ReadBools(r);
            p.Civics = ReadBools(r);
            p.Stockpile = new int[r.ReadInt32()];
            ReadArrayBody(r, p.Stockpile);
            p.Revealed = ReadBools(r);
            p.Age = (AgeState)r.ReadByte();
            p.GovernorTitles = r.ReadInt32();
            int govs = r.ReadInt32();
            for (int g = 0; g < govs; g++)
            {
                var gs = new GovernorState { DefIndex = r.ReadInt32(), CityId = r.ReadInt32(), EstablishProgress = r.ReadInt32(), Established = r.ReadBoolean() };
                int promos = r.ReadInt32();
                for (int k = 0; k < promos; k++) gs.Promotions.Add(r.ReadInt32());
                gs.Experience = r.ReadInt32();
                int traits = r.ReadInt32();
                for (int k = 0; k < traits; k++) gs.Traits.Add(r.ReadInt32());
                int progress = r.ReadInt32();
                for (int k = 0; k < progress; k++) gs.TraitProgress[r.ReadInt32()] = r.ReadInt32();
                p.Governors.Add(gs);
            }
            p.DispatchPolicy = (PowerDispatchPolicy)r.ReadByte();
            p.EmissionsLastTurn = ReadFx(r);
            p.CumulativeEmissions = ReadFx(r);
            p.CapitalCityId = r.ReadInt32();
            p.Divergence = r.ReadInt32();
            p.DivergenceTurn = r.ReadInt32();
            p.Ascended = r.ReadBoolean();
            p.LastWarDeclaredTurn = r.ReadInt32();
            p.SignatureMeter = ReadFx(r);
            p.SignatureTimer = r.ReadInt32();
            p.SignatureTally = r.ReadInt32();
            s.Players.Add(p);
        }

        int cities = r.ReadInt32();
        for (int i = 0; i < cities; i++)
        {
            var c = new CityState
            {
                Id = r.ReadInt32(), Owner = r.ReadInt32(), OriginalOwner = r.ReadInt32(), Name = r.ReadString(), Tile = r.ReadInt32(),
                Population = r.ReadInt32(), FoodStored = ReadFx(r), Loyalty = ReadFx(r), LastLoyaltyDelta = ReadFx(r),
                IsCapital = r.ReadBoolean(), FoundedTurn = r.ReadInt32(), TurnsSinceOwnerChange = r.ReadInt32(),
            };
            int districts = r.ReadInt32();
            for (int d = 0; d < districts; d++)
            {
                var di = new DistrictInstance { DefIndex = r.ReadInt32(), Tile = r.ReadInt32(), Pillaged = r.ReadBoolean() };
                int b = r.ReadInt32();
                for (int k = 0; k < b; k++) di.Buildings.Add(r.ReadInt32());
                c.Districts.Add(di);
            }
            c.Queue.NextUid = r.ReadInt32();
            int items = r.ReadInt32();
            for (int k = 0; k < items; k++)
                c.Queue.Items.Add(new QueueItem { Uid = r.ReadInt32(), Kind = (ProductionKind)r.ReadByte(), DefIndex = r.ReadInt32(), Tile = r.ReadInt32(), Repeat = r.ReadBoolean() });
            int ledger = r.ReadInt32();
            for (int k = 0; k < ledger; k++) c.ProgressLedger[r.ReadInt64()] = ReadFx(r);
            c.OverflowProduction = ReadFx(r);
            c.IsPowered = r.ReadBoolean(); c.PowerDemand = r.ReadInt32(); c.PowerPriority = r.ReadInt32(); c.GovernorDef = r.ReadInt32();
            c.YieldsLastTurnProduction = ReadFx(r);
            c.Hp = r.ReadInt32(); c.StruckThisTurn = r.ReadBoolean(); c.WasOriginalCapital = r.ReadBoolean();
            c.BorderProgress = ReadFx(r); c.TilesClaimed = r.ReadInt32();
            s.Cities.Add(c);
        }

        int units = r.ReadInt32();
        for (int i = 0; i < units; i++)
            s.Units.Add(new UnitState
            {
                Id = r.ReadInt32(), Owner = r.ReadInt32(), DefIndex = r.ReadInt32(), Tile = r.ReadInt32(), MovesLeft = ReadFx(r),
                Hp = r.ReadInt32(), Charges = r.ReadInt32(), Destination = r.ReadInt32(), Fortified = r.ReadBoolean(), AttackedThisTurn = r.ReadBoolean(), Variant = r.ReadInt32(),
            });

        s.Climate = new ClimateState
        {
            Co2Ppm = ReadFx(r), Temperature = ReadFx(r), Phase = r.ReadInt32(), EmissionsLastTurn = ReadFx(r),
            PendingDeforestation = ReadFx(r), LastPhaseChangeTurn = r.ReadInt32(),
        };
        s.World = new WorldState { Progress = ReadFx(r), Strife = ReadFx(r), Calamity = ReadFx(r), WorldEra = r.ReadInt32(), CurrentAge = r.ReadInt32() };
        int ages = r.ReadInt32();
        for (int i = 0; i < ages; i++) s.World.AgeHistory.Add((r.ReadInt32(), r.ReadInt32()));
        int entries = r.ReadInt32();
        for (int i = 0; i < entries; i++)
            s.Chronicle.Add(new ChronicleEntry { Turn = r.ReadInt32(), Year = r.ReadInt32(), Player = r.ReadInt32(), Kind = (GameEventType)r.ReadByte(), Text = r.ReadString() });
        int relations = r.ReadInt32();
        for (int i = 0; i < relations; i++)
            s.Relations.Add(new Relation
            {
                A = r.ReadInt32(), B = r.ReadInt32(), Status = (DiploStatus)r.ReadByte(), Since = r.ReadInt32(), DenouncedByA = r.ReadInt32(),
                DenouncedByB = r.ReadInt32(), PeaceProposedBy = r.ReadInt32(), AGrantsB = r.ReadBoolean(), BGrantsA = r.ReadBoolean(),
            });
        int grievances = r.ReadInt32();
        for (int i = 0; i < grievances; i++)
            s.Grievances.Add(new Grievance { Holder = r.ReadInt32(), Against = r.ReadInt32(), Amount = ReadFx(r), Turn = r.ReadInt32(), Reason = r.ReadString() });
        int outposts = r.ReadInt32();
        for (int i = 0; i < outposts; i++)
        {
            var op = new OutpostState { Id = r.ReadInt32(), Owner = r.ReadInt32(), Tile = r.ReadInt32(), Name = r.ReadString(), FoundedTurn = r.ReadInt32(), HarvestTile = r.ReadInt32() };
            int n = r.ReadInt32();
            for (int k = 0; k < n; k++) op.Tiles.Add(r.ReadInt32());
            s.Outposts.Add(op);
        }
        int phaseCount = r.ReadInt32();
        for (int i = 0; i < phaseCount; i++)
        {
            var phase = new int[r.ReadInt32()];
            for (int k = 0; k < phase.Length; k++) phase[k] = r.ReadInt32();
            s.TurnPhases.Add(phase);
        }
        s.Victory = new VictoryState { Winner = r.ReadInt32(), WinnerTeam = r.ReadInt32(), Kind = (VictoryKind)r.ReadInt32(), Turn = r.ReadInt32(), Continued = r.ReadBoolean() };

        foreach (var p in s.Players)
        {
            p.Government = r.ReadInt32(); p.Policies = ReadList(r); p.PolicySwapFree = r.ReadBoolean(); p.Pantheon = r.ReadInt32(); p.Religion = r.ReadInt32();
            p.Beliefs = ReadList(r);
            p.GreatPersonPoints = new int[7]; ReadArray(r, p.GreatPersonPoints);
            p.GreatPeopleRecruited = new int[7]; ReadArray(r, p.GreatPeopleRecruited);
            p.EraScore = r.ReadInt32(); p.AgeEra = r.ReadInt32(); p.WarWeariness = r.ReadInt32();
            p.CityStateIndex = r.ReadInt32(); p.Influence = r.ReadInt32(); p.EnvoyTokens = r.ReadInt32(); p.EnvoysEarned = r.ReadInt32(); p.Envoys = ReadList(r); p.Suzerain = r.ReadInt32();
            int spies = r.ReadInt32();
            for (int k = 0; k < spies; k++)
                p.Spies.Add(new SpyState { Id = r.ReadInt32(), Name = r.ReadString(), Level = r.ReadInt32(), CityId = r.ReadInt32(),
                                           Mission = (Systems.SpyMission)r.ReadByte(), TurnsLeft = r.ReadInt32() });
            p.LifetimeCulture = ReadFx(r); p.TourismTo = ReadList(r); p.Favor = r.ReadInt32(); p.DiplomaticPoints = r.ReadInt32(); p.CompletedProjects = ReadList(r); p.ExodusStage = r.ReadInt32();
        }
        foreach (var c in s.Cities) { c.Religion = r.ReadInt32(); c.ReligionProgress = ReadFx(r); c.ReligionCandidate = r.ReadInt32(); }
        foreach (var u in s.Units) { u.Experience = r.ReadInt32(); u.Promotions = ReadList(r); u.Formation = r.ReadByte(); }
        int camps = r.ReadInt32();
        for (int i = 0; i < camps; i++) s.Camps.Add((r.ReadInt32(), r.ReadInt32()));
        foreach (int g in ReadList(r)) s.GreatPeopleTaken.Add(g);
        int discoveries = r.ReadInt32();
        for (int i = 0; i < discoveries; i++) s.Discoveries.Add(r.ReadInt64());
        int routes = r.ReadInt32();
        for (int i = 0; i < routes; i++)
            s.TradeRoutes.Add(new TradeRouteState
            {
                Id = r.ReadInt32(), Owner = r.ReadInt32(), Origin = r.ReadInt32(), Destination = r.ReadInt32(), TurnsLeft = r.ReadInt32(),
                TraderDef = r.ReadInt32(), Path = ReadList(r),
            });
        int works = r.ReadInt32();
        for (int i = 0; i < works; i++)
            s.GreatWorks.Add(new GreatWorkState { Id = r.ReadInt32(), Name = r.ReadString(), Kind = r.ReadByte(), Creator = r.ReadInt32(), Owner = r.ReadInt32(), CityId = r.ReadInt32() });
        var congress = s.Congress;
        congress.NextSession = r.ReadInt32(); congress.Sessions = r.ReadInt32();
        int pending = r.ReadInt32();
        for (int i = 0; i < pending; i++)
        {
            var res = new PendingResolutionState { Kind = (Systems.ResolutionKind)r.ReadByte() };
            int votes = r.ReadInt32();
            for (int k = 0; k < votes; k++) res.Votes.Add(new VoteState { Player = r.ReadInt32(), Option = r.ReadInt32(), Target = r.ReadInt32(), Extra = r.ReadInt32() });
            congress.Pending.Add(res);
        }
        int active = r.ReadInt32();
        for (int i = 0; i < active; i++) congress.Active.Add(new ActiveResolutionState { Kind = (Systems.ResolutionKind)r.ReadByte(), Option = r.ReadInt32(), Target = r.ReadInt32() });
        int satellites = r.ReadInt32();
        for (int i = 0; i < satellites; i++)
            s.Satellites.Add(new SatelliteState { Id = r.ReadInt32(), Owner = r.ReadInt32(), Kind = r.ReadInt32(), Center = r.ReadInt32(), TurnsLeft = r.ReadInt32() });
        return s;
    }

    // ----- helpers ---------------------------------------------------------------------------------

    private static void WriteFx(BinaryWriter w, Fx v) => w.Write(v.Raw);
    private static Fx ReadFx(BinaryReader r) => Fx.FromRaw(r.ReadInt64());

    private static void WriteRng(BinaryWriter w, Pcg32 rng) { w.Write(rng.State); w.Write(rng.Increment); }
    private static Pcg32 ReadRng(BinaryReader r) => Pcg32.FromRawState(r.ReadUInt64(), r.ReadUInt64());

    private static void WriteArray<T>(BinaryWriter w, T[] array) where T : unmanaged
    {
        w.Write(array.Length);
        w.Write(MemoryMarshal.AsBytes(array.AsSpan()));
    }

    private static void ReadArray<T>(BinaryReader r, T[] target) where T : unmanaged
    {
        int length = r.ReadInt32();
        if (length != target.Length) throw new InvalidDataException("Array length mismatch in snapshot.");
        ReadArrayBody(r, target);
    }

    private static void ReadArrayBody<T>(BinaryReader r, T[] target) where T : unmanaged
    {
        var bytes = MemoryMarshal.AsBytes(target.AsSpan());
        while (bytes.Length > 0)
        {
            int read = r.Read(bytes);
            if (read <= 0) throw new EndOfStreamException();
            bytes = bytes[read..];
        }
    }

    private static void WriteBools(BinaryWriter w, bool[] values)
    {
        w.Write(values.Length);
        foreach (bool b in values) w.Write(b);
    }

    private static bool[] ReadBools(BinaryReader r)
    {
        var a = new bool[r.ReadInt32()];
        for (int i = 0; i < a.Length; i++) a[i] = r.ReadBoolean();
        return a;
    }
}

/// <summary>Binary codec for GameSetup (sent in the multiplayer StartGame message).</summary>
public static class GameSetupCodec
{
    public static byte[] Serialize(GameSetup g)
    {
        using var ms = new MemoryStream();
        using (var w = new BinaryWriter(ms))
        {
            w.Write(g.Seed);
            var m = g.Map;
            w.Write(m.Width); w.Write(m.Height); w.Write(m.WrapX); w.Write(m.Seed); w.Write(m.LandPercent);
            w.Write(m.ContinentSeeds); w.Write(m.GreatRivers); w.Write(m.MinGreatRiverLength); w.Write(m.MinorRiverPercent);
            w.Write(m.Players); w.Write(m.Temperature); w.Write(m.Rainfall); w.Write(m.MapId ?? "");
            var o = g.Options;
            w.Write(o.GameSpeedPercent); w.Write(o.EraPacingPercent); w.Write(o.DisasterIntensity); w.Write(o.ClimateEnabled);
            w.Write(o.LoyaltyEnabled); w.Write(o.MaxQueueLength); w.Write((byte)o.TurnMode); w.Write(o.StartingGovernorTitles); w.Write(o.NoSurpriseWars); w.Write(o.SupplyCombatPenalty); w.Write(o.TurnLimit); w.Write((int)o.Victories); w.Write(o.CityStates);
            w.Write(g.Players.Count);
            foreach (var p in g.Players) { w.Write(p.Name); w.Write(p.Leader ?? ""); w.Write(p.IsHuman); w.Write(p.Team); }
        }
        return ms.ToArray();
    }

    public static GameSetup Deserialize(byte[] data)
    {
        using var r = new BinaryReader(new MemoryStream(data));
        var g = new GameSetup { Seed = r.ReadUInt64() };
        g.Map = new MapGenSettings
        {
            Width = r.ReadInt32(), Height = r.ReadInt32(), WrapX = r.ReadBoolean(), Seed = r.ReadUInt64(), LandPercent = r.ReadInt32(),
            ContinentSeeds = r.ReadInt32(), GreatRivers = r.ReadInt32(), MinGreatRiverLength = r.ReadInt32(), MinorRiverPercent = r.ReadInt32(),
            Players = r.ReadInt32(), Temperature = r.ReadInt32(), Rainfall = r.ReadInt32(),
        };
        g.Map.MapId = r.ReadString() is { Length: > 0 } mapId ? mapId : null;
        g.Options = new GameOptions
        {
            GameSpeedPercent = r.ReadInt32(), EraPacingPercent = r.ReadInt32(), DisasterIntensity = r.ReadInt32(), ClimateEnabled = r.ReadBoolean(),
            LoyaltyEnabled = r.ReadBoolean(), MaxQueueLength = r.ReadInt32(), TurnMode = (TurnMode)r.ReadByte(), StartingGovernorTitles = r.ReadInt32(),
            NoSurpriseWars = r.ReadBoolean(), SupplyCombatPenalty = r.ReadBoolean(), TurnLimit = r.ReadInt32(), Victories = (VictoryKind)r.ReadInt32(), CityStates = r.ReadInt32(),
        };
        int n = r.ReadInt32();
        for (int i = 0; i < n; i++)
        {
            var name = r.ReadString();
            var leader = r.ReadString();
            g.Players.Add(new PlayerSetup { Name = name, Leader = leader.Length == 0 ? null : leader, IsHuman = r.ReadBoolean(), Team = r.ReadInt32() });
        }
        return g;
    }
}
