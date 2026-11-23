using System.Net;
using UnbrokenAges.Net;

namespace UnbrokenAges.Tests;

public class TurnPhaseTests
{
    private static GameState Four(TurnMode mode)
    {
        var s = TestWorld.Blank(width: 30, players: 4);
        s.Options.TurnMode = mode;
        return s;
    }

    private static void War(GameState s, int a, int b) =>
        Assert.True(CommandProcessor.Execute(s, new DeclareWarCommand { Player = a, Target = b }, new()).Ok);

    [Fact]
    public void Dynamic_PutsEnemiesInDifferentPhases_AndEveryoneElseTogether()
    {
        var s = Four(TurnMode.Dynamic);
        Assert.Equal(new[] { new[] { 0, 1, 2, 3 } }, TurnPhases.Compute(s));
        War(s, 0, 2);
        War(s, 1, 2);
        War(s, 1, 3);
        // 0 → phase 1; 1 is at peace with 0 → phase 1; 2 fights 0 and 1 → phase 2; 3 fights 1 but not 2 → phase 2.
        Assert.Equal(new[] { new[] { 0, 1 }, new[] { 2, 3 } }, TurnPhases.Compute(s));
    }

    [Fact]
    public void Teammates_ShareAPhase_AndTheOtherModesAreFixed()
    {
        var s = Four(TurnMode.Dynamic);
        s.Players[1].Team = 0;
        War(s, 0, 2);                                       // the whole team is now at war with 2
        Assert.Equal(new[] { new[] { 0, 1, 3 }, new[] { 2 } }, TurnPhases.Compute(s));
        s.Options.TurnMode = TurnMode.Sequential;
        Assert.Equal(4, TurnPhases.Compute(s).Count);
        s.Options.TurnMode = TurnMode.Simultaneous;
        Assert.Single(TurnPhases.Compute(s));
    }

    [Fact]
    public void TheCurrentPhase_IsTheFirstWithSomeoneStillToMove()
    {
        var s = Four(TurnMode.Dynamic);
        War(s, 0, 1);
        TurnPhases.Begin(s);                                 // [[0, 2, 3], [1]]
        Assert.True(TurnPhases.MayAct(s, 2));
        Assert.False(TurnPhases.MayAct(s, 1));
        Assert.Equal("Phase 1 of 2: P0, P2, P3", TurnPhases.Describe(s));
        foreach (int p in new[] { 0, 2, 3 }) s.Players[p].HasEndedTurn = true;
        Assert.True(TurnPhases.MayAct(s, 1));
        Assert.False(TurnPhases.MayAct(s, 0));
        s.Players[1].HasEndedTurn = true;
        Assert.Equal(-1, TurnPhases.Current(s));

        var back = GameStateSerializer.Deserialize(GameStateSerializer.Serialize(s), s.Db);
        Assert.Equal(s.TurnPhases, back.TurnPhases);
    }

    [Fact]
    public void DirectIp_DynamicTurns_EnemiesMoveOneAfterTheOther()
    {
        var setup = new GameSetup
        {
            Seed = 91,
            Map = new MapGenSettings { Width = 44, Height = 26, Seed = 91 },
            Options = new GameOptions { TurnMode = TurnMode.Dynamic, DisasterIntensity = 0 },
            Players = new()
            {
                new PlayerSetup { Name = "Host", Leader = "LEADER_THUTMOSE", IsHuman = true },
                new PlayerSetup { Name = "Alice", Leader = "LEADER_DANDOLO", IsHuman = true },
                new PlayerSetup { Name = "Bob", Leader = "LEADER_TAIZU_SONG", IsHuman = true },
                new PlayerSetup { Name = "AI", IsHuman = false },
            },
        };
        using var host = new HostSession(TestWorld.Db, new TcpServerTransport(0, IPAddress.Loopback), setup);
        host.Start();
        using var first = new ClientSession(TestWorld.Db, new TcpClientTransport("127.0.0.1", host.Port), new ClientOptions { PlayerName = "C1" });
        using var second = new ClientSession(TestWorld.Db, new TcpClientTransport("127.0.0.1", host.Port), new ClientOptions { PlayerName = "C2" });
        first.Connect();
        second.Connect();
        var polls = new Action[] { host.Poll, first.Poll, second.Poll };
        void Pump(Func<bool> done)
        {
            var deadline = DateTime.UtcNow.AddSeconds(15);
            while (!done())
            {
                foreach (var p in polls) p();
                if (DateTime.UtcNow > deadline) throw new TimeoutException("Network test timed out.");
                Thread.Sleep(1);
            }
        }
        Pump(() => first.Slot >= 1 && second.Slot >= 1);
        // Slots follow connection order, which is a race: name the clients by the slot they got (slot 1 "Alice", slot 2 "Bob").
        var alice = first.Slot == 1 ? first : second;
        var bob = first.Slot == 2 ? first : second;
        host.StartGame();
        Pump(() => alice.State != null && bob.State != null && alice.LastSeq == host.Seq && bob.LastSeq == host.Seq);
        Assert.Equal(new[] { 0, 1, 2 }, host.ActivePlayers.Where(p => p != 3));   // turn 1: everyone at peace, AI already done

        // Turn 1: the host declares war on Bob; it only reorders the NEXT turn.
        Assert.True(host.SubmitLocal(new DeclareWarCommand { Target = 2 }).Ok);
        Assert.True(host.SubmitLocal(new EndTurnCommand()).Ok);
        alice.Submit(new EndTurnCommand());
        bob.Submit(new EndTurnCommand());
        Pump(() => host.State!.Turn == 2 && alice.LastSeq == host.Seq && bob.LastSeq == host.Seq);
        Assert.Equal(new[] { new[] { 0, 1, 3 }, new[] { 2 } }, host.State!.TurnPhases);
        Assert.Equal(host.State.TurnPhases, bob.State!.TurnPhases);

        // Turn 2: Bob must wait for the host's phase.
        bob.Submit(new EndTurnCommand());
        Pump(() => bob.LastCommandError != null);
        Assert.StartsWith("Not your phase yet. Phase 1 of 2: Host, Alice", bob.LastCommandError);
        Assert.True(host.SubmitLocal(new EndTurnCommand()).Ok);
        alice.Submit(new EndTurnCommand());
        Pump(() => host.ActivePlayers.SequenceEqual(new[] { 2 }) && bob.LastSeq == host.Seq);
        Assert.Equal(1, TurnPhases.Current(bob.State!));                         // every peer sees whose phase it is
        Assert.False(host.SubmitLocal(new EndTurnCommand()).Ok);                  // and now the host waits

        bob.Submit(new EndTurnCommand());
        Pump(() => host.State!.Turn == 3 && alice.LastSeq == host.Seq && bob.LastSeq == host.Seq);
        Assert.Equal(GameStateSerializer.Hash(host.State!), GameStateSerializer.Hash(alice.State!));
        Assert.Equal(GameStateSerializer.Hash(host.State!), GameStateSerializer.Hash(bob.State!));
        Assert.Equal(0, host.DesyncsDetected);
    }
}
