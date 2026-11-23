using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace UnbrokenAges.Net;

/// <summary>Small UDP advertisement a LAN host broadcasts once per second.</summary>
public sealed record LanBeacon(string GameName, int Port, int Players, int MaxPlayers, bool HasPassword, int ProtocolVersion, ulong ContentHash)
{
    private static readonly byte[] Magic = Encoding.ASCII.GetBytes("UAGE");

    public byte[] Encode()
    {
        using var ms = new MemoryStream();
        using (var w = new BinaryWriter(ms))
        {
            w.Write(Magic);
            w.Write(ProtocolVersion);
            w.Write(GameName);
            w.Write(Port);
            w.Write(Players);
            w.Write(MaxPlayers);
            w.Write(HasPassword);
            w.Write(ContentHash);
        }
        return ms.ToArray();
    }

    public static LanBeacon? TryDecode(byte[] data)
    {
        try
        {
            using var r = new BinaryReader(new MemoryStream(data));
            if (!r.ReadBytes(4).AsSpan().SequenceEqual(Magic)) return null;
            int version = r.ReadInt32();
            return new LanBeacon(r.ReadString(), r.ReadInt32(), r.ReadInt32(), r.ReadInt32(), r.ReadBoolean(), version, r.ReadUInt64());
        }
        catch (Exception ex) when (ex is EndOfStreamException or IOException or ArgumentException)
        {
            return null;
        }
    }
}

/// <summary>Host side: call Tick() from the game loop; it sends at most once per interval.</summary>
public sealed class LanBeaconBroadcaster : IDisposable
{
    private readonly UdpClient _udp = new() { EnableBroadcast = true };
    private readonly IPEndPoint _target;
    private readonly TimeSpan _interval;
    private DateTime _last = DateTime.MinValue;

    public LanBeaconBroadcaster(IPEndPoint? target = null, TimeSpan? interval = null)
    {
        _target = target ?? new IPEndPoint(IPAddress.Broadcast, Protocol.DiscoveryPort);
        _interval = interval ?? TimeSpan.FromSeconds(1);
    }

    public void Tick(LanBeacon beacon, bool force = false)
    {
        if (!force && DateTime.UtcNow - _last < _interval) return;
        _last = DateTime.UtcNow;
        var bytes = beacon.Encode();
        try { _udp.Send(bytes, bytes.Length, _target); }
        catch (SocketException) { /* no broadcast route (e.g. offline) — LAN browsing simply finds nothing */ }
    }

    public void Dispose() => _udp.Dispose();
}

/// <summary>Client side: listens for beacons and keeps a list of games seen recently.</summary>
public sealed class LanBrowser : IDisposable
{
    private readonly UdpClient _udp;
    private readonly CancellationTokenSource _cts = new();
    private readonly ConcurrentDictionary<string, (LanBeacon Beacon, DateTime Seen)> _games = new();

    public LanBrowser(int port = Protocol.DiscoveryPort, IPAddress? bind = null)
    {
        _udp = new UdpClient(new IPEndPoint(bind ?? IPAddress.Any, port));
        _ = Task.Run(Listen);
    }

    public int Port => ((IPEndPoint)_udp.Client.LocalEndPoint!).Port;

    private async Task Listen()
    {
        while (!_cts.IsCancellationRequested)
        {
            UdpReceiveResult result;
            try { result = await _udp.ReceiveAsync(_cts.Token); }
            catch (Exception ex) when (ex is OperationCanceledException or SocketException or ObjectDisposedException) { return; }
            if (LanBeacon.TryDecode(result.Buffer) is { } beacon)
                _games[$"{result.RemoteEndPoint.Address}:{beacon.Port}"] = (beacon, DateTime.UtcNow);
        }
    }

    /// <summary>Games heard from within the last few seconds, keyed by "address:port" ready for Direct IP join.</summary>
    public IReadOnlyList<(string Address, LanBeacon Beacon)> Games(TimeSpan? maxAge = null)
    {
        var cutoff = DateTime.UtcNow - (maxAge ?? TimeSpan.FromSeconds(5));
        return _games.Where(g => g.Value.Seen >= cutoff).OrderBy(g => g.Key, StringComparer.Ordinal)
            .Select(g => (g.Key, g.Value.Beacon)).ToList();
    }

    public void Dispose()
    {
        _cts.Cancel();
        _udp.Dispose();
    }
}
