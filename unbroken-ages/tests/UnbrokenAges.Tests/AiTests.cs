using UnbrokenAges.Sim.AI;

namespace UnbrokenAges.Tests;

public class AiTests
{
    private static void PlayTurns(GameState s, int player, int turns)
    {
        var ai = new SimpleAi();
        for (int t = 0; t < turns; t++)
        {
            foreach (var cmd in ai.TakeTurn(s, player).ToList()) CommandProcessor.Execute(s, cmd, new());
            TurnProcessor.Advance(s);
        }
    }

    private static GameState AtWar()
    {
        var s = TestWorld.Blank(width: 30);
        Assert.True(CommandProcessor.Execute(s, new DeclareWarCommand { Player = 0, Target = 1 }, new()).Ok);
        return s;
    }

    [Fact]
    public void Settlers_WalkToAGoodSite_AndFoundACity()
    {
        var s = TestWorld.Blank(width: 30);
        var capital = TestWorld.City(s, 0, 5, 10);
        TestWorld.Unit(s, 0, "UNIT_SETTLER", 5, 10);
        PlayTurns(s, 0, 5);
        var second = Assert.Single(s.Cities, c => c.Owner == 0 && c.Id != capital.Id);
        Assert.InRange(s.Map.Distance(capital.Tile, second.Tile), FoundCityCommand.MinCityDistance, FoundCityCommand.MinCityDistance + 1);
    }

    [Fact]
    public void ACityWithRoom_TrainsASettler_BeforeABuilderOrAnArmy()
    {
        var s = TestWorld.Blank(width: 30);
        TestWorld.City(s, 0, 5, 10, population: 2);
        var enqueue = Assert.Single(new SimpleAi().TakeTurn(s, 0).OfType<EnqueueCommand>());
        Assert.True(s.Db.Units[enqueue.DefIndex].FoundsCity);
    }

    [Fact]
    public void Builders_ImproveTheResourceFirst()
    {
        var s = TestWorld.Blank(width: 30);
        var city = TestWorld.City(s, 0, 10, 10);
        int wheat = s.Map.Neighbor(s.Map.Neighbor(city.Tile, HexCoord.E), HexCoord.E);
        BorderSystem.Purchase(s, city, wheat, new());
        s.Map.Resource[wheat] = (short)s.Db.Resources.IndexOf("RESOURCE_WHEAT");
        TestWorld.Unit(s, 0, "UNIT_BUILDER", 10, 10);
        Assert.Equal((wheat, s.Db.Improvements.IndexOf("IMPROVEMENT_FARM")), BuilderAi.BestJob(s, s.Players[0], city.Tile, Array.Empty<int>()));
        PlayTurns(s, 0, 3);
        Assert.Equal(s.Db.Improvements.IndexOf("IMPROVEMENT_FARM"), s.Map.Improvement[wheat]);
    }

    [Fact]
    public void Units_AttackOnlyWithGoodOdds()
    {
        var s = AtWar();
        var sword = TestWorld.Unit(s, 0, "UNIT_SWORDSMAN", 10, 10);
        var warrior = TestWorld.Unit(s, 1, "UNIT_WARRIOR", 11, 10);
        Assert.True(MilitaryAi.OddsPercent(CombatSystem.Preview(s, sword, warrior.Tile)) > MilitaryAi.OddsToAttack);
        Assert.True(MilitaryAi.OddsPercent(CombatSystem.Preview(s, warrior, sword.Tile)) < 40);

        var attack = Assert.Single(MilitaryAi.Fight(s, s.Players[0]).OfType<AttackCommand>());
        Assert.Equal(warrior.Tile, attack.TargetTile);
        Assert.Empty(MilitaryAi.Fight(s, s.Players[1]).OfType<AttackCommand>());
    }

    [Fact]
    public void AStrongerNeighbour_DeclaresWar_OnlyFromTheEarliestWarTurn()
    {
        var s = TestWorld.Blank(width: 30);
        TestWorld.City(s, 0, 5, 10);
        TestWorld.City(s, 1, 15, 10);
        for (int i = 0; i < 3; i++) TestWorld.Unit(s, 0, "UNIT_SWORDSMAN", 4 + i, 12);
        TestWorld.Unit(s, 1, "UNIT_WARRIOR", 15, 12);
        int first = Math.Max(MilitaryAi.EarliestWarTurn, MilitaryAi.FirstWarTurn);   // a leader of ordinary temper
        s.Turn = first - 1;
        Assert.Null(MilitaryAi.WarDeclaration(s, s.Players[0]));
        s.Turn = first;
        var war = Assert.IsType<DeclareWarCommand>(MilitaryAi.WarDeclaration(s, s.Players[0]));
        Assert.Equal(1, war.Target);
        Assert.Null(MilitaryAi.WarDeclaration(s, s.Players[1]));               // the weaker side does not start it
    }

    [Fact]
    public void Armies_MarchOnTheNearestEnemyCity_AndTheWoundedFallBack()
    {
        var s = AtWar();
        var home = TestWorld.City(s, 0, 3, 10);
        var enemyCity = TestWorld.City(s, 1, 22, 10);
        TestWorld.City(s, 1, 27, 17);   // a second city, so the first is not the last one the AI spares
        s.Turn = MilitaryAi.CapitalsSparedUntilTurn;   // past the opening, when small rivals are left alone
        var fresh = TestWorld.Unit(s, 0, "UNIT_SWORDSMAN", 12, 10);
        var hurt = TestWorld.Unit(s, 0, "UNIT_SWORDSMAN", 12, 14);
        hurt.Hp = 35;
        var moves = MilitaryAi.Fight(s, s.Players[0]).OfType<MoveUnitCommand>().ToDictionary(m => m.UnitId, m => m.Destination);
        Assert.Equal(1, s.Map.Distance(moves[fresh.Id], enemyCity.Tile));
        Assert.Equal(home.Tile, moves[hurt.Id]);
    }

    [Fact]
    public void TheLosingSide_SuesForPeace_AndTheWinnerTakesItsTime()
    {
        var s = AtWar();
        TestWorld.City(s, 0, 3, 3); TestWorld.City(s, 0, 8, 3);   // the loser still holds two cities: the winner is not yet sated
        TestWorld.Unit(s, 0, "UNIT_WARRIOR", 5, 5);
        for (int i = 0; i < 3; i++) TestWorld.Unit(s, 1, "UNIT_SWORDSMAN", 20 + i, 15);
        s.Turn += DiplomacySystem.MinWarTurns;
        var offer = Assert.Single(MilitaryAi.Diplomacy(s, s.Players[0]).OfType<ProposePeaceCommand>());
        Assert.True(CommandProcessor.Execute(s, offer, new()).Ok);
        Assert.Empty(MilitaryAi.Diplomacy(s, s.Players[1]));                  // twice as strong, early in the war
        s.Turn += 20;
        Assert.Single(MilitaryAi.Diplomacy(s, s.Players[1]).OfType<AcceptPeaceCommand>());
    }

    [Fact]
    public void AtWar_CitiesTrainTheirBestSoldiers()
    {
        var s = AtWar();
        TestWorld.City(s, 0, 5, 10, population: 2);
        var enqueue = Assert.Single(new SimpleAi().TakeTurn(s, 0).OfType<EnqueueCommand>());
        var unit = s.Db.Units[enqueue.DefIndex];
        Assert.True(unit.Strength > 0 && unit.Domain == UnitDomain.Land);
        var city = s.Cities.Single();
        Assert.Equal(MilitaryAi.BestLandUnit(s, city)!.Index, unit.Index);
    }

    [Fact]
    public void BeforeTurn150_TheAiSparesARivalsLastCity_AndMakesPeace()
    {
        var s = AtWar();
        TestWorld.City(s, 0, 3, 10);
        var last = TestWorld.City(s, 1, 13, 10);
        TestWorld.Unit(s, 0, "UNIT_SWORDSMAN", 12, 10);
        s.Turn = 80;
        Assert.DoesNotContain(MilitaryAi.Fight(s, s.Players[0]).OfType<AttackCommand>(), a => a.TargetTile == last.Tile);
        s.Turn += DiplomacySystem.MinWarTurns;
        Assert.Contains(MilitaryAi.Diplomacy(s, s.Players[0]), c => c is ProposePeaceCommand);
    }

    [Fact]
    public void VeniceAi_BuysTheCityItCanAfford_MaliAi_BuysItsProduction()
    {
        var s = TestWorld.Blank(width: 30, players: 2, leaders: new[] { "LEADER_DANDOLO", "LEADER_MANSA_MUSA" });
        TestWorld.City(s, 0, 5, 5, population: 3);
        var free = TestWorld.City(s, s.Players.Count - 1, 9, 5, population: 2);
        s.Players[0].Gold = 2000;
        Assert.Contains(NationAi.Commands(s, s.Players[0]), c => c is BuyCityCommand b && b.CityId == free.Id);

        var niani = TestWorld.City(s, 1, 20, 12, population: 3);
        ProductionSystem.Enqueue(s, niani, ProductionKind.Unit, s.Db.Units.IndexOf("UNIT_WARRIOR"), -1, -1, false);
        s.Players[1].Gold = 2000;
        Assert.Contains(NationAi.Commands(s, s.Players[1]), c => c is PurchaseCommand);
    }
}
