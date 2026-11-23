using System.Net;
using UnbrokenAges.Net;
using UnbrokenAges.Sim.AI;

namespace UnbrokenAges.Tests;

public class NetworkTests
{
    private static GameSetup ThreeHumans() => new()
    {
        Seed = 77,
        Map = new MapGenSettings { Width = 44, Height = 26, Seed = 77 },
        Options = new GameOptions { DisasterIntensity = 2 },
        Players = new()
        {
            new PlayerSetup { Name = "Host", Leader = "LEADER_THUTMOSE", IsHuman = true },
            new PlayerSetup { Name = "Alice", Leader = "LEADER_DANDOLO", IsHuman = true },
            new PlayerSetup { Name = "Bob", Leader = "LEADER_TAIZU_SONG", IsHuman = true },
            new PlayerSetup { Name = "AI", IsHuman = false },
        },
    };

    private static void PumpUntil(Func<bool> done, params Action[] polls)
    {
        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (!done())
        {
            foreach (var p in polls) p();
            if (DateTime.UtcNow > deadline) throw new TimeoutException("Network test timed out.");
            Thread.Sleep(1);
        }
    }

    private static (HostSession Host, ClientSession A, ClientSession B, Action[] Polls) Connect()
    {
        var host = new HostSession(TestWorld.Db, new TcpServerTransport(0, IPAddress.Loopback), ThreeHumans());
        host.Start();
        var a = new ClientSession(TestWorld.Db, new TcpClientTransport("127.0.0.1", host.Port), new ClientOptions { PlayerName = "Alice" });
        var b = new ClientSession(TestWorld.Db, new TcpClientTransport("127.0.0.1", host.Port), new ClientOptions { PlayerName = "Bob" });
        a.Connect();
        b.Connect();
        var polls = new Action[] { host.Poll, a.Poll, b.Poll };
        PumpUntil(() => a.Slot >= 0 && b.Slot >= 0, polls);
        host.StartGame();
        PumpUntil(() => a.State != null && b.State != null && a.LastSeq == host.Seq && b.LastSeq == host.Seq, polls);
        return (host, a, b, polls);
    }

    private static void PlayTurn(HostSession host, ClientSession a, ClientSession b, Action[] polls)
    {
        var ai = new SimpleAi();
        int turn = host.State!.Turn;
        foreach (var cmd in ai.TakeTurn(host.State!, 0)) host.SubmitLocal(cmd);
        foreach (var cmd in ai.TakeTurn(a.State!, a.Slot)) a.Submit(cmd);
        foreach (var cmd in ai.TakeTurn(b.State!, b.Slot)) b.Submit(cmd);
        PumpUntil(() => host.State!.Turn == turn + 1 && a.LastSeq == host.Seq && b.LastSeq == host.Seq && a.State!.Turn == turn + 1, polls);
        for (int i = 0; i < 20; i++) foreach (var p in polls) p(); // let hash reports land
    }

    [Fact]
    public void DirectIp_HostAndTwoClients_StayInLockstep()
    {
        var (host, a, b, polls) = Connect();
        using (host) using (a) using (b)
        {
            Assert.Equal(new[] { 1, 2 }, new[] { a.Slot, b.Slot }.Order());
            for (int t = 0; t < 8; t++)
            {
                PlayTurn(host, a, b, polls);
                ulong h = GameStateSerializer.Hash(host.State!);
                Assert.Equal(h, GameStateSerializer.Hash(a.State!));
                Assert.Equal(h, GameStateSerializer.Hash(b.State!));
            }
            Assert.Equal(0, host.DesyncsDetected);
            Assert.True(host.State!.Cities.Count >= 4); // three humans + the host-run AI founded cities
        }
    }

    [Fact]
    public void Desync_IsDetected_AndHealedWithASnapshot()
    {
        var (host, a, b, polls) = Connect();
        using (host) using (a) using (b)
        {
            PlayTurn(host, a, b, polls);
            b.State!.Players[b.Slot].Gold += 999; // simulate a nondeterminism bug on one machine
            PlayTurn(host, a, b, polls);
            PumpUntil(() => b.ResyncsApplied == 1, polls);
            Assert.Equal(1, host.DesyncsDetected);
            Assert.Equal(GameStateSerializer.Hash(host.State!), GameStateSerializer.Hash(b.State!));
            PlayTurn(host, a, b, polls);
            Assert.Equal(GameStateSerializer.Hash(host.State!), GameStateSerializer.Hash(b.State!));
        }
    }

    [Fact]
    public void Host_RewritesTheIssuer_SoClientsCannotActForOthers()
    {
        var (host, a, b, polls) = Connect();
        using (host) using (a) using (b)
        {
            var bobsSettler = host.State!.Units.First(u => u.Owner == b.Slot && host.State.Db.Units[u.DefIndex].FoundsCity);
            a.Submit(new FoundCityCommand { UnitId = bobsSettler.Id, Player = b.Slot });
            PumpUntil(() => a.LastCommandError != null, polls);
            Assert.Equal("Not your unit.", a.LastCommandError);
            Assert.DoesNotContain(host.State.Cities, c => c.Owner == b.Slot);
        }
    }

    [Fact]
    public void MismatchedMods_AreRejectedAtTheDoor()
    {
        using var host = new HostSession(TestWorld.Db, new TcpServerTransport(0, IPAddress.Loopback), ThreeHumans());
        host.Start();
        using var c = new ClientSession(TestWorld.Db, new TcpClientTransport("127.0.0.1", host.Port)) { ContentHashOverride = 12345 };
        c.Connect();
        PumpUntil(() => c.RejectReason != null, host.Poll, c.Poll);
        Assert.Contains("mods", c.RejectReason);
    }

    [Fact]
    public void Reconnect_RestoresTheSameSlot_WithAFreshSnapshot()
    {
        var (host, a, b, polls) = Connect();
        using (host) using (a)
        {
            PlayTurn(host, a, b, polls);
            string token = b.ReconnectToken!;
            int slot = b.Slot;
            b.Dispose();
            for (int i = 0; i < 50; i++) { host.Poll(); a.Poll(); Thread.Sleep(1); }

            using var b2 = new ClientSession(TestWorld.Db, new TcpClientTransport("127.0.0.1", host.Port), new ClientOptions { PlayerName = "Bob", ReconnectToken = token });
            b2.Connect();
            PumpUntil(() => b2.Slot == slot && b2.State != null && b2.LastSeq == host.Seq, host.Poll, a.Poll, b2.Poll);
            Assert.Equal(GameStateSerializer.Hash(host.State!), GameStateSerializer.Hash(b2.State!));
        }
    }

    [Fact]
    public void Spectators_ReceiveTheStream_ButCannotAct()
    {
        var (host, a, b, polls) = Connect();
        using (host) using (a) using (b)
        {
            using var spec = new ClientSession(TestWorld.Db, new TcpClientTransport("127.0.0.1", host.Port), new ClientOptions { PlayerName = "Caster", Spectator = true });
            spec.Connect();
            var all = polls.Append(spec.Poll).ToArray();
            PumpUntil(() => spec.IsSpectator && spec.State != null && spec.LastSeq == host.Seq, all);
            PlayTurn(host, a, b, all);
            PumpUntil(() => spec.LastSeq == host.Seq, all);
            Assert.Equal(GameStateSerializer.Hash(host.State!), GameStateSerializer.Hash(spec.State!));
        }
    }

    [Theory]
    [InlineData("192.168.1.20", "192.168.1.20", 47620)]
    [InlineData("192.168.1.20:5000", "192.168.1.20", 5000)]
    [InlineData("[::1]:6000", "::1", 6000)]
    [InlineData("::1", "::1", 47620)]
    [InlineData("game.example.org:7000", "game.example.org", 7000)]
    public void DirectIpEndpoint_ParsesWhatPlayersType(string input, string host, int port)
    {
        Assert.True(DirectIpEndpoint.TryParse(input, out var ep));
        Assert.Equal((host, port), (ep.Host, ep.Port));
    }

    [Fact]
    public void LanBeacon_RoundTripsOverUdp()
    {
        using var browser = new LanBrowser(0, IPAddress.Loopback);
        using var broadcaster = new LanBeaconBroadcaster(new IPEndPoint(IPAddress.Loopback, browser.Port));
        var beacon = new LanBeacon("Friday Night Civ", 47620, 3, 8, true, Protocol.Version, TestWorld.Db.ContentHash);
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (browser.Games().Count == 0 && DateTime.UtcNow < deadline)
        {
            broadcaster.Tick(beacon, force: true);
            Thread.Sleep(20);
        }
        var game = Assert.Single(browser.Games());
        Assert.Equal(beacon, game.Beacon);
    }
}
