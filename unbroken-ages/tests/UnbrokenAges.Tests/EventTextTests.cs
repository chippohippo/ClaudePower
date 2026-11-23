namespace UnbrokenAges.Tests;

public class EventTextTests
{
    [Fact]
    public void YourNews_IsInTheSecondPerson_AndTheWorldsNewsNamesTheCiv()
    {
        var s = TestWorld.Blank(players: 2, leaders: new[] { "LEADER_THUTMOSE", "LEADER_DANDOLO" });
        var city = TestWorld.City(s, 0, 5, 5);
        Assert.Equal("You founded Waset.", EventText.Describe(s, new GameEvent(GameEventType.CityFounded, 0, city.Id, Detail: "Waset"), 0));
        Assert.Equal("Egypt founded Waset.", EventText.Describe(s, new GameEvent(GameEventType.CityFounded, 0, city.Id, Detail: "Waset"), 1));
        Assert.Equal($"{city.Name} grew to 3.", EventText.Describe(s, new GameEvent(GameEventType.CityGrew, 0, city.Id, Value: 3), 0));
        Assert.Null(EventText.Describe(s, new GameEvent(GameEventType.CityGrew, 0, city.Id, Value: 3), 1));   // not their business
        Assert.Equal("— Turn 12 —", EventText.Describe(s, new GameEvent(GameEventType.TurnAdvanced, Value: 12), 1));
    }

    [Fact]
    public void Wars_AreAnnouncedFromEachSide()
    {
        var s = TestWorld.Blank(players: 3, leaders: new[] { "LEADER_THUTMOSE", "LEADER_DANDOLO", "LEADER_TAIZU_SONG" });
        var events = new List<GameEvent>();
        CommandProcessor.Execute(s, new DeclareWarCommand { Player = 1, Target = 0 }, events);
        var war = events.Single(e => e.Type == GameEventType.WarDeclared);
        Assert.Equal("Venice declared war on you!", EventText.Describe(s, war, 0));
        Assert.StartsWith("You declared war on", EventText.Describe(s, war, 1));
        Assert.StartsWith("Venice declared war on", EventText.Describe(s, war, 2));
    }
}
