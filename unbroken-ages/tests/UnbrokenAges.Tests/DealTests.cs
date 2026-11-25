using UnbrokenAges.Sim.AI;

namespace UnbrokenAges.Tests;

public class DealTests
{
    private static CommandResult Do(GameState s, GameCommand c, List<GameEvent>? events = null) => CommandProcessor.Execute(s, c, events ?? new());

    private static DealItemState Item(DealItemKind kind, int giver, int amount = 0, int target = -1) => new() { Kind = kind, Giver = giver, Amount = amount, Target = target };

    [Fact]
    public void ADeal_IsOfferedThenAccepted_AndEveryItemChangesHands()
    {
        var s = TestWorld.Blank(players: 2, leaders: new[] { "LEADER_THUTMOSE", "LEADER_DANDOLO" });
        TestWorld.City(s, 0, 3, 3);
        TestWorld.City(s, 1, 12, 3);
        var town = TestWorld.City(s, 1, 12, 10);
        int iron = s.Db.Resources.IndexOf("RESOURCE_IRON");
        s.Players[0].Gold = 500;
        s.Players[1].Stockpile[iron] = 20;
        var items = new List<DealItemState> { Item(DealItemKind.Gold, 0, 200), Item(DealItemKind.Resource, 1, 10, iron), Item(DealItemKind.City, 1, target: town.Id) };
        var events = new List<GameEvent>();
        Assert.True(Do(s, new ProposeDealCommand { Player = 0, Target = 1, Items = items }, events).Ok);
        var deal = Assert.Single(s.Deals);
        Assert.Equal("The offer is not addressed to you.", new RespondDealCommand { Player = 0, DealId = deal.Id, Accept = true }.Validate(s));
        Assert.True(Do(s, new RespondDealCommand { Player = 1, DealId = deal.Id, Accept = true }, events).Ok);
        Assert.Empty(s.Deals);
        Assert.Equal(Fx.FromInt(300), s.Players[0].Gold);
        Assert.Equal(10, s.Players[0].Stockpile[iron]);
        Assert.Equal(0, town.Owner);
        Assert.Contains(events, e => e.Type == GameEventType.CityCeded);
        Assert.True(DiplomacySystem.GoodwillTotal(s, 1, 0) > Fx.Zero);
    }

    [Fact]
    public void Validation_NamesWhatIsWrong()
    {
        var s = TestWorld.Blank(players: 2);
        var capital = TestWorld.City(s, 1, 12, 3);
        Assert.Equal("The deal is empty.", DealSystem.Validate(s, 0, 1, new List<DealItemState>()));
        Assert.Contains("cannot pay", DealSystem.Validate(s, 0, 1, new List<DealItemState> { Item(DealItemKind.Gold, 0, 50) }));
        Assert.Equal("A capital is never traded.", DealSystem.Validate(s, 0, 1, new List<DealItemState> { Item(DealItemKind.City, 1, target: capital.Id) }));
        Do(s, new DeclareWarCommand { Player = 0, Target = 1 });
        Assert.Equal("You are at war: the deal must include peace.", DealSystem.Validate(s, 0, 1, new List<DealItemState> { Item(DealItemKind.OpenBorders, 1) }));
        Assert.StartsWith("Peace is possible after", DealSystem.Validate(s, 0, 1, new List<DealItemState> { Item(DealItemKind.Peace, 0) }));
    }

    [Fact]
    public void PeaceWithReparations_TipsAWinnerThatRefusesPlainPeace()
    {
        var s = TestWorld.Blank(players: 2);
        TestWorld.City(s, 0, 3, 3);
        TestWorld.City(s, 1, 16, 3);
        for (int i = 0; i < 6; i++) TestWorld.Unit(s, 1, "UNIT_SWORDSMAN", 16, 6 + i);
        TestWorld.Unit(s, 0, "UNIT_WARRIOR", 3, 6);
        Do(s, new DeclareWarCommand { Player = 1, Target = 0 });
        s.Turn += DiplomacySystem.MinWarTurns;
        var peace = new List<DealItemState> { Item(DealItemKind.Peace, 0) };
        Assert.False(DealSystem.WouldAccept(s, 0, 1, peace));   // the winner wants more than peace
        s.Players[0].Gold = 2000;
        int gold = DealSystem.GoldToBalance(s, 0, 1, peace);
        Assert.True(gold > 0);
        peace.Add(Item(DealItemKind.Gold, 0, gold));
        Assert.True(DealSystem.WouldAccept(s, 0, 1, peace));
        Assert.True(Do(s, new ProposeDealCommand { Player = 0, Target = 1, Items = peace }).Ok);
        Assert.True(Do(s, new RespondDealCommand { Player = 1, DealId = s.Deals[0].Id, Accept = true }).Ok);
        Assert.False(DiplomacySystem.AtWar(s, 0, 1));
    }

    [Fact]
    public void Alliances_AreForFriends_AndAnAttackCallsTheAllyToArms()
    {
        var s = TestWorld.Blank(players: 3, leaders: new[] { "LEADER_THUTMOSE", "LEADER_DANDOLO", "LEADER_TAIZU_SONG" });
        s.Options.NoSurpriseWars = true;
        var alliance = new List<DealItemState> { Item(DealItemKind.Alliance, 0) };
        Assert.False(DealSystem.WouldAccept(s, 0, 1, alliance));   // strangers
        DiplomacySystem.AddGoodwill(s, 1, 0, 60, "Gifts");
        DiplomacySystem.AddGoodwill(s, 1, 0, 50, "More gifts");
        Assert.True(DealSystem.WouldAccept(s, 0, 1, alliance));
        Do(s, new ProposeDealCommand { Player = 0, Target = 1, Items = alliance });
        Do(s, new RespondDealCommand { Player = 1, DealId = s.Deals[0].Id, Accept = true });
        Assert.True(DiplomacySystem.Allied(s, 0, 1));

        // Player 2 attacks 0 (after a formal denunciation); 1 may answer without one, and is not called a warmonger.
        Do(s, new DenounceCommand { Player = 2, Target = 0 });
        s.Turn += 6;
        var events = new List<GameEvent>();
        Assert.True(Do(s, new DeclareWarCommand { Player = 2, Target = 0 }, events).Ok);
        Assert.Contains(events, e => e.Type == GameEventType.CalledToArms && e.Player == 1);
        Assert.True(DiplomacySystem.IsDefensiveWar(s, 1, 2));
        Assert.Null(new DeclareWarCommand { Player = 1, Target = 2 }.Validate(s));
        Fx before = DiplomacySystem.GrievanceTotal(s, 0, 1);
        Assert.True(Do(s, new DeclareWarCommand { Player = 1, Target = 2 }).Ok);
        Assert.Equal(before, DiplomacySystem.GrievanceTotal(s, 0, 1));
        Assert.Contains(s.Goodwill, g => g.Holder == 0 && g.Against == 1 && g.Reason == "Answered our call to arms");

        Assert.True(Do(s, new LeaveAllianceCommand { Player = 1, Target = 0 }).Ok);
        Assert.False(DiplomacySystem.Allied(s, 0, 1));
    }

    [Fact]
    public void GoldPerTurn_IsPaidUntilTheTermEnds_AndResearchAgreementsMature()
    {
        var s = TestWorld.Blank(players: 2, allTech: false);
        TestWorld.City(s, 0, 3, 3);
        TestWorld.City(s, 1, 14, 3);
        s.Players[0].Gold = 1000;
        s.Players[1].Gold = 1000;
        Do(s, new ProposeDealCommand { Player = 0, Target = 1, Items = new() { Item(DealItemKind.GoldPerTurn, 0, 5), Item(DealItemKind.ResearchAgreement, 0) } });
        Assert.True(Do(s, new RespondDealCommand { Player = 1, DealId = s.Deals[0].Id, Accept = true }).Ok);
        Assert.Equal(2, s.Agreements.Count);
        var events = new List<GameEvent>();
        for (int t = 0; t < DealSystem.ResearchAgreementTurns; t++) DealSystem.ProcessTurn(s, events);
        Assert.Equal(2, events.Count(e => e.Type == GameEventType.ResearchAgreementCompleted));
        Assert.Single(s.Agreements);
        Assert.Equal(1000 - DealSystem.ResearchAgreementCost(s, s.Players[0]) - 5 * DealSystem.ResearchAgreementTurns, s.Players[0].Gold.FloorToInt());
    }

    [Fact]
    public void Liberation_ReturnsACity_ForgivesGrievances_AndEarnsAPointOnce()
    {
        var s = TestWorld.Blank(players: 3);
        TestWorld.City(s, 0, 3, 3);
        TestWorld.City(s, 1, 14, 3);
        var taken = TestWorld.City(s, 1, 14, 12);
        CitySystem.ChangeOwner(s, taken, 0, new(), GameEventType.CityCaptured);
        DiplomacySystem.AddGrievance(s, 1, 0, 40, "Surprise war");
        Do(s, new DeclareWarCommand { Player = 0, Target = 1 });
        Assert.Equal("Make peace with its founders first.", new LiberateCityCommand { Player = 0, CityId = taken.Id }.Validate(s));
        s.Relations.Clear();
        var events = new List<GameEvent>();
        Assert.True(Do(s, new LiberateCityCommand { Player = 0, CityId = taken.Id }, events).Ok);
        Assert.Equal(1, taken.Owner);
        Assert.Equal(Fx.Zero, DiplomacySystem.GrievanceTotal(s, 1, 0));
        Assert.Equal(1, s.Players[0].DiplomaticPoints);
        Assert.Contains(s.Chronicle, c => c.Text.Contains("is liberated"));
        Assert.Contains(DiplomacySystem.Attitude(s, 1, 0).Lines, l => l.Label == "Goodwill" && l.Value > 0);
    }

    [Fact]
    public void Patronage_BuysAGreatPerson_AndEachCostsMoreThanTheLast()
    {
        var s = TestWorld.Blank(players: 2);
        TestWorld.City(s, 0, 3, 3);
        s.World.WorldEra = 8;
        var p = s.Players[0];
        Assert.Equal("Prophets answer to faith, not gold.", GreatPeopleSystem.ValidatePatronize(s, p, GreatPersonClass.Prophet, false));
        int price = GreatPeopleSystem.PatronagePrice(s, p, GreatPersonClass.Engineer, false);
        Assert.Equal(GreatPeopleSystem.Cost(s, GreatPersonClass.Engineer) * GreatPeopleSystem.GoldPerPoint, price);
        p.Gold = 10000;
        var events = new List<GameEvent>();
        Assert.True(Do(s, new PatronizeCommand { Player = 0, Class = GreatPersonClass.Engineer }, events).Ok);
        Assert.Contains(events, e => e.Type == GameEventType.GreatPersonRecruited);
        Assert.Equal(1, p.GreatPeopleRecruited[(int)GreatPersonClass.Engineer]);
        Assert.True(GreatPeopleSystem.PatronagePrice(s, p, GreatPersonClass.Engineer, false) > price);
    }

    [Fact]
    public void AI_AnswersOffers_WithTheVerdictTheDealScreenShows()
    {
        var s = TestWorld.Blank(players: 2);
        TestWorld.City(s, 0, 3, 3);
        TestWorld.City(s, 1, 14, 3);
        s.Players[0].Gold = 100;
        Do(s, new ProposeDealCommand { Player = 0, Target = 1, Items = new() { Item(DealItemKind.Gold, 0, 50) } });
        var answer = DiplomacyAi.Commands(s, s.Players[1]).OfType<RespondDealCommand>().Single();
        Assert.True(answer.Accept);   // a gift
        Do(s, answer);
        Assert.Equal(Fx.FromInt(50), s.Players[1].Gold);
    }

    [Fact]
    public void DealsAndGoodwill_SurviveSnapshots()
    {
        var s = TestWorld.Blank(players: 2);
        TestWorld.City(s, 0, 3, 3);
        TestWorld.City(s, 1, 14, 3);
        s.Players[0].Gold = 300;
        Do(s, new ProposeDealCommand { Player = 0, Target = 1, Items = new() { Item(DealItemKind.GoldPerTurn, 0, 3) } });
        DiplomacySystem.AddGoodwill(s, 1, 0, 12, "Gifts");
        var copy = GameStateSerializer.Deserialize(GameStateSerializer.Serialize(s), s.Db);
        Assert.Equal(GameStateSerializer.Hash(s), GameStateSerializer.Hash(copy));
        Assert.Single(copy.Deals);
        Assert.Single(copy.Goodwill);
    }
}
