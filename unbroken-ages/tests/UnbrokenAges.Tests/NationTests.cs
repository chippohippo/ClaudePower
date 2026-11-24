namespace UnbrokenAges.Tests;

/// <summary>Nation signatures (NationSystem) and leader augments: each nation's rule, and how each leader bends it.</summary>
public class NationTests
{
    private static GameState World(string leader, string? other = null, int width = 30) =>
        TestWorld.Blank(width: width, height: 20, players: 2, leaders: new[] { leader, other });

    private static void Advance(GameState s, int turns)
    {
        for (int i = 0; i < turns; i++) TurnProcessor.Advance(s);
    }

    [Fact]
    public void EveryNation_HasASignature_TwoLeaders_AndAugmentsOnlyTouchRealParams()
    {
        var db = TestWorld.Db;
        Assert.True(db.Civilizations.Count >= 6);
        foreach (var civ in db.Civilizations)
        {
            Assert.NotEqual(SignatureKind.None, civ.Signature.Kind);
            Assert.False(string.IsNullOrWhiteSpace(civ.Signature.Playstyle), civ.Id);
            var leaders = db.Leaders.Where(l => l.CivilizationIndex == civ.Index).ToList();
            Assert.True(leaders.Count >= 2, $"{civ.Id} needs two leaders");
            foreach (var l in leaders)
            {
                Assert.False(string.IsNullOrWhiteSpace(l.Augment.Name), l.Id);
                foreach (var key in l.Augment.Params.Keys)
                    Assert.True(civ.Signature.Params.ContainsKey(key), $"{l.Id} augments unknown param '{key}' of {civ.Id}");
            }
        }
        Assert.Equal(db.Civilizations.Count, db.Civilizations.Select(c => c.Signature.Kind).Distinct().Count());
    }

    // ----- Egypt ----------------------------------------------------------------------------------------

    [Fact]
    public void Egypt_StoresSurplusInTheGranary_ThenTheFloodGrowsCitiesAtOnce()
    {
        var s = World("LEADER_THUTMOSE");
        var waset = TestWorld.City(s, 0, 8, 8, population: 2);
        var p = s.Players[0];
        s.Turn = 0;
        Advance(s, 6);   // turns 0..5: no flood yet (interval 8 → floods on turn 7)
        Assert.Equal(2, waset.Population);
        Assert.Equal(Fx.Zero, waset.FoodStored);
        Assert.True(p.SignatureMeter > Fx.Zero, "the surplus should be in the granary");
        p.SignatureMeter += 60;   // as if a few more cities had been filling it
        Fx granary = p.SignatureMeter;
        Advance(s, 2);   // turns 6 and 7: the flood
        Assert.True(waset.Population > 2, $"the flood should grow the city (pop {waset.Population}, granary was {granary})");
        Assert.Equal(1, p.SignatureTally);
        Assert.Equal(Fx.Zero, p.SignatureMeter);
    }

    [Fact]
    public void Thutmose_MustersAUnitOnTheFlood_Hatshepsut_FloodsSoonerAndPaysGold()
    {
        var s = World("LEADER_THUTMOSE");
        TestWorld.City(s, 0, 8, 8, population: 3);
        s.Turn = 0;
        int before = s.Units.Count(u => u.Owner == 0);
        Advance(s, 8);
        Assert.True(s.Units.Count(u => u.Owner == 0) > before, "Thutmose's flood should muster a unit");

        var h = World("LEADER_HATSHEPSUT");
        TestWorld.City(h, 0, 8, 8, population: 3);
        h.Turn = 0;
        Assert.Equal(5, NationSystem.TurnsToFlood(h, h.Players[0]));   // every 6 turns
        Advance(h, 5);
        Fx gold = h.Players[0].Gold;
        Advance(h, 1);
        Assert.Equal(1, h.Players[0].SignatureTally);
        Assert.True(h.Players[0].Gold > gold, "Hatshepsut's flood pays gold");
    }

    // ----- Venice ---------------------------------------------------------------------------------------

    [Fact]
    public void Venice_TrainsNoSettlers_ButBuysFreeCitiesAndDisloyalNeighbours()
    {
        var s = World("LEADER_DANDOLO", "LEADER_TAIZU_SONG");
        var venezia = TestWorld.City(s, 0, 8, 8, population: 3);
        Assert.NotNull(ProductionSystem.Validate(s, venezia, ProductionKind.Unit, s.Db.Units.IndexOf("UNIT_SETTLER"), -1));

        int free = s.Players.Count - 1;
        var town = TestWorld.City(s, free, 12, 8, population: 2);
        var far = TestWorld.City(s, free, 27, 18, population: 2);
        s.Players[0].Gold = 10;
        Assert.StartsWith("Not enough gold", NationSystem.CanBuy(s, s.Players[0], town));
        Assert.StartsWith("Too far", NationSystem.CanBuy(s, s.Players[0], far));
        s.Players[0].Gold = 1000;
        var events = new List<GameEvent>();
        Assert.True(CommandProcessor.Execute(s, new BuyCityCommand { Player = 0, CityId = town.Id }, events).Ok);
        Assert.Equal(0, town.Owner);
        Assert.Contains(events, e => e.Type == GameEventType.CityPurchased);

        var songCapital = TestWorld.City(s, 1, 4, 14, population: 2);
        var songTown = TestWorld.City(s, 1, 6, 12, population: 2);
        Assert.Equal("Capitals are not for sale.", NationSystem.CanBuy(s, s.Players[0], songCapital));
        songTown.Loyalty = 90;
        Assert.StartsWith("Its people are too loyal", NationSystem.CanBuy(s, s.Players[0], songTown));
        songTown.Loyalty = 40;
        Assert.Null(NationSystem.CanBuy(s, s.Players[0], songTown));
    }

    [Fact]
    public void Orseolo_BuysCoastalCitiesCheaperAndTheyArriveLoyal()
    {
        var s = World("LEADER_ORSEOLO");
        TestWorld.City(s, 0, 8, 8, population: 3);
        int free = s.Players.Count - 1;
        var port = TestWorld.City(s, free, 12, 8, population: 2);
        s.Map.Terrain[TestWorld.Tile(s, 13, 8)] = (byte)s.Db.Terrains.IndexOf("TERRAIN_COAST");
        var d = World("LEADER_DANDOLO");
        TestWorld.City(d, 0, 8, 8, population: 3);
        var port2 = TestWorld.City(d, d.Players.Count - 1, 12, 8, population: 2);
        d.Map.Terrain[TestWorld.Tile(d, 13, 8)] = (byte)d.Db.Terrains.IndexOf("TERRAIN_COAST");
        Assert.True(NationSystem.CityPrice(s, s.Players[0], port) < NationSystem.CityPrice(d, d.Players[0], port2));
        s.Players[0].Gold = 1000;
        NationSystem.Buy(s, s.Players[0], port, new());
        Assert.Equal(100, port.Loyalty.FloorToInt());
        Assert.Equal(3, port.Population);
    }

    // ----- Song -----------------------------------------------------------------------------------------

    [Fact]
    public void Song_LoyalCitiesFillTheMandate_AGoldenDynastyBoostsEverything_AndALostCityEndsIt()
    {
        var s = World("LEADER_TAIZU_SONG", "LEADER_THUTMOSE");
        var kaifeng = TestWorld.City(s, 0, 8, 8, population: 4);
        var luoyang = TestWorld.City(s, 0, 14, 8, population: 4);
        var p = s.Players[0];
        Fx science = CityYields.Compute(s, luoyang).Total.Science;
        p.SignatureMeter = 98;
        NationSystem.ProcessTurn(s, new());
        Assert.Equal(14, p.SignatureTimer);   // Taizu: 14-turn dynasties
        Assert.True(CityYields.Compute(s, luoyang).Total.Science > science);

        var events = new List<GameEvent>();
        CitySystem.ChangeOwner(s, luoyang, 1, events, GameEventType.CityCaptured);
        Assert.Equal(0, p.SignatureTimer);
        Assert.Contains(events, e => e.Type == GameEventType.DynastyFell);
        Assert.True(kaifeng.Loyalty < 100);
    }

    [Fact]
    public void Huizong_FillsTheMandateFaster_ButWarDrainsItHarder()
    {
        var s = World("LEADER_HUIZONG", "LEADER_THUTMOSE");
        TestWorld.City(s, 0, 8, 8, population: 3);
        NationSystem.ProcessTurn(s, new());
        Assert.Equal(4, s.Players[0].SignatureMeter.FloorToInt());
        CommandProcessor.Execute(s, new DeclareWarCommand { Player = 0, Target = 1 }, new());
        s.Players[0].SignatureMeter = 20;
        NationSystem.ProcessTurn(s, new());
        Assert.Equal(16, s.Players[0].SignatureMeter.FloorToInt());   // +4 loyal city, −8 war
    }

    // ----- Mongolia -------------------------------------------------------------------------------------

    [Fact]
    public void Mongolia_LearnsLittleAtHome_ButEveryKillPaysScience_AndRidersMoveFurther()
    {
        var s = World("LEADER_GENGHIS", "LEADER_TAIZU_SONG");
        var mongol = TestWorld.City(s, 0, 4, 4, population: 4);
        var song = TestWorld.City(s, 1, 20, 4, population: 4);
        Assert.True(CityYields.Compute(s, mongol).Total.Science < CityYields.Compute(s, song).Total.Science);

        var keshig = TestWorld.Unit(s, 0, "UNIT_KESHIG", 10, 10);
        Assert.Equal(6, UnitStats.Moves(s, keshig));
        CommandProcessor.Execute(s, new DeclareWarCommand { Player = 0, Target = 1 }, new());
        var victim = TestWorld.Unit(s, 1, "UNIT_WARRIOR", 11, 10);
        victim.Hp = 1;
        Fx science = s.Players[0].TechProgress, gold = s.Players[0].Gold;
        var events = new List<GameEvent>();
        Assert.True(CommandProcessor.Execute(s, new AttackCommand { Player = 0, UnitId = keshig.Id, TargetTile = TestWorld.Tile(s, 11, 10) }, events).Ok);
        Assert.Contains(events, e => e.Type == GameEventType.Plundered);
        Assert.Equal(40, (s.Players[0].TechProgress - science).FloorToInt());   // 2 × strength 20
        Assert.Equal(20, (s.Players[0].Gold - gold).FloorToInt());             // Genghis: gold too
    }

    [Fact]
    public void Kublai_CapturesCitiesWhole_AndTheirScholarsTeachATech()
    {
        var s = TestWorld.Blank(width: 30, height: 20, players: 2, leaders: new[] { "LEADER_KUBLAI", "LEADER_TAIZU_SONG" }, allTech: false);
        TestWorld.City(s, 0, 4, 4, population: 2);
        TestWorld.City(s, 1, 20, 4, population: 2);
        var target = TestWorld.City(s, 1, 11, 10, population: 5);
        int writing = s.Db.Techs.First(t => t.PrereqIndices.Length == 0 && t.DivergenceIndex < 0).Index;   // a root tech Mongolia can learn
        s.Players[1].Techs[writing] = true;
        CommandProcessor.Execute(s, new DeclareWarCommand { Player = 0, Target = 1 }, new());
        target.Hp = 0;
        var horse = TestWorld.Unit(s, 0, "UNIT_KESHIG", 10, 10);
        var events = new List<GameEvent>();
        Assert.True(CommandProcessor.Execute(s, new AttackCommand { Player = 0, UnitId = horse.Id, TargetTile = target.Tile }, events).Ok, string.Join("; ", events));
        Assert.Equal(0, target.Owner);
        Assert.Equal(5, target.Population);
        Assert.Equal(80, target.Loyalty.FloorToInt());
        Assert.True(s.Players[0].Techs[writing]);
    }

    // ----- Inca -----------------------------------------------------------------------------------------

    [Fact]
    public void Inca_WalkAndFarmTheMountains_OthersCannot()
    {
        var s = World("LEADER_TOPA_INCA", "LEADER_THUTMOSE");
        int peak = TestWorld.Tile(s, 11, 10);
        s.Map.Relief[peak] = (byte)s.Db.Ids.Mountain;
        var inca = TestWorld.Unit(s, 0, "UNIT_WARRIOR", 10, 10);
        var egypt = TestWorld.Unit(s, 1, "UNIT_WARRIOR", 12, 10);
        Assert.Equal(2, Movement.TerrainCost(s, inca, inca.Tile, peak));
        Assert.Equal(Movement.Impassable, Movement.TerrainCost(s, egypt, egypt.Tile, peak));

        var p = World("LEADER_PACHACUTI");
        int peak2 = TestWorld.Tile(p, 11, 10);
        p.Map.Relief[peak2] = (byte)p.Db.Ids.Mountain;
        var runner = TestWorld.Unit(p, 0, "UNIT_WARRIOR", 10, 10);
        Assert.Equal(1, Movement.TerrainCost(p, runner, runner.Tile, peak2));

        // A city ringed by mountains still feeds itself from terraces.
        var c = TestWorld.City(s, 0, 5, 5, population: 3);
        var ring = new List<int>();
        s.Map.CollectRadius(c.Tile, 1, ring);
        foreach (int t in ring) if (t != c.Tile) s.Map.Relief[t] = (byte)s.Db.Ids.Mountain;
        var report = CityYields.Compute(s, c);
        Assert.Contains(report.WorkedTiles, t => s.Map.IsMountain(t));
        Assert.True(report.Housing > CityYields.BaseHousing(s.Map, c.Tile));   // Topa Inca: highland housing
    }

    // ----- Mali -----------------------------------------------------------------------------------------

    [Fact]
    public void Mali_BuildsSlowly_BuysCheaply_AndEarnsInterest()
    {
        var s = World("LEADER_MANSA_MUSA", "LEADER_THUTMOSE");
        var niani = TestWorld.City(s, 0, 6, 6, population: 3);
        var waset = TestWorld.City(s, 1, 20, 6, population: 3);
        Assert.True(CityYields.Compute(s, niani).Total.Production < CityYields.Compute(s, waset).Total.Production);
        int warrior = s.Db.Units.IndexOf("UNIT_WARRIOR");
        Assert.True(ProductionSystem.PurchaseCost(s, niani, ProductionKind.Unit, warrior) < ProductionSystem.PurchaseCost(s, waset, ProductionKind.Unit, warrior));

        s.Players[0].Gold = 500;
        NationSystem.ProcessTurn(s, new());
        Assert.Equal(515, s.Players[0].Gold.FloorToInt());   // 3%

        Fx science = s.Players[0].TechProgress;
        Assert.True(CommandProcessor.Execute(s, new PurchaseCommand { Player = 0, CityId = niani.Id, Kind = ProductionKind.Unit, DefIndex = warrior }, new()).Ok);
        Assert.True(s.Players[0].TechProgress > science, "Mansa Musa's purchases also fund scholars");

        int desert = TestWorld.Tile(s, 7, 6);
        s.Map.Terrain[desert] = (byte)s.Db.Terrains.IndexOf("TERRAIN_DESERT");
        Assert.Equal(1, NationSystem.TileBonus(s, 0, desert).Gold.FloorToInt());
    }

    [Fact]
    public void Signatures_SurviveSaveAndLoad()
    {
        var s = World("LEADER_TAIZU_SONG");
        s.Players[0].SignatureMeter = 42;
        s.Players[0].SignatureTimer = 3;
        s.Players[0].SignatureTally = 7;
        var copy = GameStateSerializer.Deserialize(GameStateSerializer.Serialize(s), TestWorld.Db);
        Assert.Equal((42, 3, 7), (copy.Players[0].SignatureMeter.FloorToInt(), copy.Players[0].SignatureTimer, copy.Players[0].SignatureTally));
    }

    // ----- The thirty further nations: one test per engine hook ------------------------------------

    [Fact]
    public void Zulu_HornsStrengthenTheAttack_Japan_IgnoresWounds()
    {
        var s = World("LEADER_SHAKA", "LEADER_TOKUGAWA");
        CommandProcessor.Execute(s, new DeclareWarCommand { Player = 0, Target = 1 }, new());
        var impi = TestWorld.Unit(s, 0, "UNIT_WARRIOR", 10, 10);
        TestWorld.Unit(s, 0, "UNIT_WARRIOR", 11, 9);
        var samurai = TestWorld.Unit(s, 1, "UNIT_WARRIOR", 11, 10);
        samurai.Hp = 40;
        var p = CombatSystem.Preview(s, impi, samurai.Tile);
        Assert.Contains(p.Attacker.Lines, l => l.Label.Contains("horns") && l.Value == 6);
        Assert.Contains(p.Defender.Lines, l => l.Label.Contains("wounds ignored"));
        Assert.Equal(0, p.Defender.Lines.Where(l => l.Label is "Wounds" || l.Label.Contains("wounds ignored")).Sum(l => l.Value));
    }

    [Fact]
    public void Russia_ClaimsTheSecondRing_Portugal_FoundsOnlyOnTheCoast_Haudenosaunee_NeverDeclareWar()
    {
        var s = World("LEADER_PETER", "LEADER_HIAWATHA");
        var moskva = TestWorld.City(s, 0, 8, 8);
        Assert.Equal(19, Enumerable.Range(0, s.Map.Count).Count(t => s.Map.OwnerCity[t] == moskva.Id));
        Assert.NotNull(DiplomacySystem.ValidateDeclareWar(s, 1, 0));
        Assert.Null(DiplomacySystem.ValidateDeclareWar(s, 0, 1));

        var pt = World("LEADER_HENRY");
        Assert.NotNull(NationSystem.ForbidFound(pt, 0, TestWorld.Tile(pt, 10, 10)));
        pt.Map.Terrain[TestWorld.Tile(pt, 11, 10)] = (byte)pt.Db.Terrains.IndexOf("TERRAIN_COAST");
        Assert.Null(NationSystem.ForbidFound(pt, 0, TestWorld.Tile(pt, 10, 10)));
    }

    [Fact]
    public void Babylon_LearnsFromEveryBuilding_Arabia_TurnsGoldIntoScience()
    {
        var s = World("LEADER_HAMMURABI");
        var city = TestWorld.City(s, 0, 8, 8, population: 4);
        Fx science = s.Players[0].TechProgress;
        int district = s.Db.Districts.First(d => d.Category == DistrictCategory.Specialty).Index;
        NationSystem.OnCompleted(s, city, ProductionKind.District, district, new());
        Assert.True(s.Players[0].TechProgress > science);
        Assert.True(s.Players[0].CivicProgress > Fx.Zero);   // Hammurabi: culture too

        var a = World("LEADER_HARUN");
        Fx sci = 10, cul = 0, gold = 40, faith = 0;
        NationSystem.AdjustEmpireYields(a, a.Players[0], ref sci, ref cul, ref gold, ref faith);
        Assert.Equal(30, gold.FloorToInt());     // a quarter of 40 went to the scholars
        Assert.Equal(25, sci.FloorToInt());      // 10 + 10 × 150%
    }

    [Fact]
    public void France_BordersGrowTwiceAsFast_America_GrowsFaster()
    {
        Assert.Equal(100, NationSystem.BorderCulturePercent(World("LEADER_LOUIS_XIV"), 0));
        var s = World("LEADER_TEDDY");
        var c = TestWorld.City(s, 0, 8, 8);
        Assert.Equal(-35, NationSystem.GrowthThresholdPercent(s, c));
    }

    [Fact]
    public void Poland_VictoriesPushTheBorder_Spain_TakesTreasure()
    {
        var s = World("LEADER_JADWIGA", "LEADER_TOKUGAWA");
        var krakow = TestWorld.City(s, 0, 8, 8);
        CommandProcessor.Execute(s, new DeclareWarCommand { Player = 0, Target = 1 }, new());
        var lancer = TestWorld.Unit(s, 0, "UNIT_SWORDSMAN", 12, 8);
        var foe = TestWorld.Unit(s, 1, "UNIT_WARRIOR", 13, 8);
        foe.Hp = 1;
        Assert.True(CommandProcessor.Execute(s, new AttackCommand { Player = 0, UnitId = lancer.Id, TargetTile = foe.Tile }, new()).Ok);
        Assert.Equal(krakow.Id, s.Map.OwnerCity[TestWorld.Tile(s, 13, 8)]);

        var sp = World("LEADER_PHILIP", "LEADER_TOKUGAWA");
        TestWorld.City(sp, 0, 4, 4);
        TestWorld.City(sp, 1, 20, 4);
        var target = TestWorld.City(sp, 1, 11, 10, population: 3);
        CommandProcessor.Execute(sp, new DeclareWarCommand { Player = 0, Target = 1 }, new());
        target.Hp = 0;
        var tercio = TestWorld.Unit(sp, 0, "UNIT_SWORDSMAN", 10, 10);
        Fx gold = sp.Players[0].Gold;
        Assert.True(CommandProcessor.Execute(sp, new AttackCommand { Player = 0, UnitId = tercio.Id, TargetTile = target.Tile }, new()).Ok);
        Assert.Equal(360, (sp.Players[0].Gold - gold).FloorToInt());   // Philip: 120 per citizen
    }

    [Fact]
    public void Byzantium_EveryCityStrengthensTheArmy_AndTheWalls()
    {
        var s = World("LEADER_BASIL", "LEADER_TOKUGAWA");
        for (int i = 0; i < 4; i++) TestWorld.City(s, 0, 3 + 5 * i, 3);
        var city = s.CitiesOf(0).First();
        Assert.Contains(CombatSystem.CityStrength(s, city).Lines, l => l.Label.Contains("great walls") && l.Value == 10);
        CommandProcessor.Execute(s, new DeclareWarCommand { Player = 0, Target = 1 }, new());
        var cat = TestWorld.Unit(s, 0, "UNIT_HORSEMAN", 10, 10);
        var foe = TestWorld.Unit(s, 1, "UNIT_WARRIOR", 11, 10);
        var p = CombatSystem.Preview(s, cat, foe.Tile);
        Assert.Contains(p.Attacker.Lines, l => l.Label.Contains("themes") && l.Value == 4);
        Assert.Contains(p.Attacker.Lines, l => l.Value == 6 && l.Label.Contains("Cataphracts"));
    }

    [Fact]
    public void Tiles_Kongo_Forests_Netherlands_Sea_Korea_Mines()
    {
        var k = World("LEADER_MVEMBA");
        int wood = TestWorld.Tile(k, 5, 5);
        k.Map.Feature[wood] = (short)k.Db.Ids.Forest;
        Assert.Equal((1, 1, 2), (NationSystem.TileBonus(k, 0, wood).Food.FloorToInt(), NationSystem.TileBonus(k, 0, wood).Production.FloorToInt(), NationSystem.TileBonus(k, 0, wood).Culture.FloorToInt()));

        var n = World("LEADER_WILHELMINA");
        int sea = TestWorld.Tile(n, 5, 5);
        n.Map.Terrain[sea] = (byte)n.Db.Terrains.IndexOf("TERRAIN_COAST");
        Assert.Equal(2, NationSystem.TileBonus(n, 0, sea).Production.FloorToInt());
    }

    [Fact]
    public void Carthage_HiresItsArmies_AtHalfPrice()
    {
        var s = World("LEADER_DIDO", "LEADER_TOKUGAWA");
        var qart = TestWorld.City(s, 0, 6, 6, population: 3);
        var edo = TestWorld.City(s, 1, 20, 6, population: 3);
        int warrior = s.Db.Units.IndexOf("UNIT_WARRIOR");
        var mine = ProductionSystem.PurchaseCost(s, qart, ProductionKind.Unit, warrior);
        var theirs = ProductionSystem.PurchaseCost(s, edo, ProductionKind.Unit, warrior);
        Assert.Equal(theirs.FloorToInt() / 2, mine.FloorToInt(), 1.0);
    }
}
