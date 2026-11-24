namespace UnbrokenAges.Tests;

public class FogAndSaveTests
{
    [Fact]
    public void Units_RevealWhatTheySee_AndTheMapRemembersIt()
    {
        var s = TestWorld.Blank(width: 40);
        var scout = TestWorld.Unit(s, 0, "UNIT_SCOUT", 5, 10);
        VisibilitySystem.Reveal(s, 0);
        int near = TestWorld.Tile(s, 7, 10), far = TestWorld.Tile(s, 30, 10);
        Assert.True(VisibilitySystem.Visible(s, 0)[near]);
        Assert.False(VisibilitySystem.Visible(s, 0)[far]);
        Assert.False(s.Players[0].Revealed[far]);

        scout.Tile = TestWorld.Tile(s, 29, 10);
        VisibilitySystem.Reveal(s, 0);
        Assert.False(VisibilitySystem.Visible(s, 0)[near]);    // no longer in sight...
        Assert.True(s.Players[0].Revealed[near]);              // ...but remembered
        Assert.True(s.Players[0].Revealed[far]);
    }

    [Fact]
    public void Commands_UpdateTheIssuersMap_AndTeammatesShareSight()
    {
        var s = TestWorld.Blank(width: 40, players: 3);
        s.Players[2].Team = 0;
        TestWorld.City(s, 2, 30, 10);
        var u = TestWorld.Unit(s, 0, "UNIT_WARRIOR", 5, 10);
        int dest = TestWorld.Tile(s, 7, 10);
        Assert.True(CommandProcessor.Execute(s, new MoveUnitCommand { Player = 0, UnitId = u.Id, Destination = dest }, new()).Ok);
        Assert.True(s.Players[0].Revealed[TestWorld.Tile(s, 9, 10)]);
        Assert.True(s.Players[0].Revealed[TestWorld.Tile(s, 30, 10)]);   // the teammate's city
        Assert.False(s.Players[1].Revealed.Length > 0 && s.Players[1].Revealed[dest]);
    }

    [Fact]
    public void NewGames_StartWithTheStartingAreaRevealed()
    {
        var s = GameFactory.Create(TestWorld.Db, DeterminismTests.Setup());
        foreach (var p in s.Players.Where(p => p.IsMajor))
        {
            var settler = s.Units.First(u => u.Owner == p.Id && s.Db.Units[u.DefIndex].FoundsCity);
            Assert.True(p.Revealed[settler.Tile]);
            Assert.InRange(p.Revealed.Count(x => x), 7, s.Map.Count / 4);
        }
    }

    [Fact]
    public void ASave_RoundTripsTheWholeGame_AndRefusesForeignFiles()
    {
        var s = GameFactory.Create(TestWorld.Db, DeterminismTests.Setup());
        for (int i = 0; i < 5; i++) DeterminismTests.PlayAiTurn(s);
        var ms = new MemoryStream();
        SaveGame.Write(ms, s, localPlayer: 1);
        ms.Position = 0;
        var (back, local) = SaveGame.Read(ms, s.Db);
        Assert.Equal(1, local);
        Assert.Equal(GameStateSerializer.Hash(s), GameStateSerializer.Hash(back));
        DeterminismTests.PlayAiTurn(s);
        DeterminismTests.PlayAiTurn(back);
        Assert.Equal(GameStateSerializer.Hash(s), GameStateSerializer.Hash(back));   // and it plays on identically

        Assert.Throws<InvalidDataException>(() => SaveGame.Read(new MemoryStream(new byte[] { 3, (byte)'x', (byte)'y', (byte)'z' }), s.Db));
    }
}
