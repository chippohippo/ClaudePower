using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Threading.Channels;

namespace UnbrokenAges.Net;

public enum NetEventKind { Connected, Data, Disconnected }

public readonly record struct NetEvent(NetEventKind Kind, int PeerId, byte[]? Data = null, string? Reason = null);

/// <summary>
/// Transport abstraction. The game session never touches sockets directly, so the same
/// HostSession/ClientSession run over Direct-IP TCP (this file), a relay service, Steam/EOS
/// sockets, or an in-memory loopback for hotseat and tests. Events are queued from I/O threads
/// and drained on the game thread via TryReceive (no callbacks into game state off-thread).
/// </summary>
public interface IServerTransport : IDisposable
{
    int Port { get; }
    void Start();
    bool TryReceive(out NetEvent e);
    void Send(int peerId, byte[] frame);
    void Disconnect(int peerId, string reason);
    string? RemoteAddress(int peerId);
}

public interface IClientTransport : IDisposable
{
    bool IsConnected { get; }
    void Connect();
    bool TryReceive(out NetEvent e);
    void Send(byte[] frame);
}

/// <summary>One framed TCP connection: [u32 little-endian length][payload]. Writes go through a queue.</summary>
internal sealed class TcpPeer
{
    private readonly TcpClient _client;
    private readonly NetworkStream _stream;
    private readonly ConcurrentQueue<NetEvent> _events;
    private readonly Channel<byte[]> _outbox = Channel.CreateUnbounded<byte[]>(new UnboundedChannelOptions { SingleReader = true });
    private readonly CancellationTokenSource _cts = new();
    private int _closed;

    public int Id { get; }
    public string Remote { get; }
    public bool IsOpen => Volatile.Read(ref _closed) == 0;

    public TcpPeer(int id, TcpClient client, ConcurrentQueue<NetEvent> events)
    {
        Id = id;
        _client = client;
        _client.NoDelay = true;
        _stream = client.GetStream();
        _events = events;
        Remote = client.Client.RemoteEndPoint?.ToString() ?? "?";
    }

    public void Start()
    {
        _ = Task.Run(ReceiveLoop);
        _ = Task.Run(SendLoop);
    }

    public void Send(byte[] frame)
    {
        if (IsOpen) _outbox.Writer.TryWrite(frame);
    }

    private async Task ReceiveLoop()
    {
        var header = new byte[4];
        try
        {
            while (!_cts.IsCancellationRequested)
            {
                await _stream.ReadExactlyAsync(header, _cts.Token);
                int length = BinaryPrimitives.ReadInt32LittleEndian(header);
                if (length <= 0 || length > Protocol.MaxFrameBytes) throw new InvalidDataException($"Bad frame length {length}.");
                var payload = new byte[length];
                await _stream.ReadExactlyAsync(payload, _cts.Token);
                _events.Enqueue(new NetEvent(NetEventKind.Data, Id, payload));
            }
        }
        catch (Exception ex) when (ex is IOException or SocketException or OperationCanceledException or InvalidDataException or ObjectDisposedException or EndOfStreamException)
        {
            Close(ex is EndOfStreamException ? "Remote closed the connection." : ex.Message);
        }
    }

    private async Task SendLoop()
    {
        var header = new byte[4];
        try
        {
            await foreach (var frame in _outbox.Reader.ReadAllAsync(_cts.Token))
            {
                BinaryPrimitives.WriteInt32LittleEndian(header, frame.Length);
                await _stream.WriteAsync(header, _cts.Token);
                await _stream.WriteAsync(frame, _cts.Token);
            }
            await _stream.FlushAsync(_cts.Token);
            Close(_closeReason ?? "Closed.");
        }
        catch (Exception ex) when (ex is IOException or SocketException or OperationCanceledException or ObjectDisposedException)
        {
            Close(ex.Message);
        }
    }

    private string? _closeReason;

    /// <summary>Graceful close: frames already queued (e.g. a Reject explaining why) are delivered first.</summary>
    public void CloseAfterFlush(string reason)
    {
        _closeReason = reason;
        _outbox.Writer.TryComplete();
    }

    public void Close(string reason)
    {
        if (Interlocked.Exchange(ref _closed, 1) == 1) return;
        _outbox.Writer.TryComplete();
        _cts.Cancel();
        try { _client.Close(); } catch (SocketException) { }
        _events.Enqueue(new NetEvent(NetEventKind.Disconnected, Id, Reason: reason));
    }
}

/// <summary>Direct-IP host. Binds IPv6 dual-stack when available so both "1.2.3.4" and "[::1]" clients work.</summary>
public sealed class TcpServerTransport : IServerTransport
{
    private readonly IPAddress _bind;
    private readonly int _requestedPort;
    private readonly ConcurrentQueue<NetEvent> _events = new();
    private readonly ConcurrentDictionary<int, TcpPeer> _peers = new();
    private readonly CancellationTokenSource _cts = new();
    private TcpListener? _listener;
    private int _nextId;

    public TcpServerTransport(int port = Protocol.DefaultPort, IPAddress? bind = null)
    {
        _requestedPort = port;
        _bind = bind ?? IPAddress.Any;
    }

    public int Port => ((IPEndPoint)(_listener ?? throw new InvalidOperationException("Not started.")).LocalEndpoint).Port;

    public void Start()
    {
        _listener = new TcpListener(_bind, _requestedPort);
        if (_bind.AddressFamily == AddressFamily.InterNetworkV6) _listener.Server.DualMode = true;
        _listener.Start();
        _ = Task.Run(AcceptLoop);
    }

    private async Task AcceptLoop()
    {
        while (!_cts.IsCancellationRequested)
        {
            TcpClient client;
            try { client = await _listener!.AcceptTcpClientAsync(_cts.Token); }
            catch (Exception ex) when (ex is OperationCanceledException or SocketException or ObjectDisposedException) { return; }
            var peer = new TcpPeer(Interlocked.Increment(ref _nextId), client, _events);
            _peers[peer.Id] = peer;
            _events.Enqueue(new NetEvent(NetEventKind.Connected, peer.Id));
            peer.Start();
        }
    }

    public bool TryReceive(out NetEvent e)
    {
        if (!_events.TryDequeue(out e)) return false;
        if (e.Kind == NetEventKind.Disconnected) _peers.TryRemove(e.PeerId, out _);
        return true;
    }

    public void Send(int peerId, byte[] frame)
    {
        if (_peers.TryGetValue(peerId, out var p)) p.Send(frame);
    }

    public void Disconnect(int peerId, string reason)
    {
        if (_peers.TryGetValue(peerId, out var p)) p.CloseAfterFlush(reason);
    }

    public string? RemoteAddress(int peerId) => _peers.TryGetValue(peerId, out var p) ? p.Remote : null;

    public void Dispose()
    {
        _cts.Cancel();
        _listener?.Stop();
        foreach (var p in _peers.Values) p.Close("Server shutting down.");
    }
}

public sealed class TcpClientTransport : IClientTransport
{
    private readonly string _host;
    private readonly int _port;
    private readonly TimeSpan _timeout;
    private readonly ConcurrentQueue<NetEvent> _events = new();
    private TcpPeer? _peer;

    public TcpClientTransport(string host, int port = Protocol.DefaultPort, TimeSpan? timeout = null)
    {
        _host = host;
        _port = port;
        _timeout = timeout ?? TimeSpan.FromSeconds(10);
    }

    public static TcpClientTransport FromEndpoint(DirectIpEndpoint ep) => new(ep.Host, ep.Port);

    public bool IsConnected => _peer?.IsOpen == true;

    public void Connect()
    {
        // Default constructor picks IPv4 or IPv6 per resolved address (works with "[::1]" and "1.2.3.4").
        var client = new TcpClient { NoDelay = true };
        try
        {
            using var cts = new CancellationTokenSource(_timeout);
            client.ConnectAsync(_host, _port, cts.Token).AsTask().GetAwaiter().GetResult();
        }
        catch (Exception ex) when (ex is SocketException or OperationCanceledException)
        {
            client.Dispose();
            throw new IOException($"Could not connect to {_host}:{_port} — {ex.Message}", ex);
        }
        _peer = new TcpPeer(0, client, _events);
        _events.Enqueue(new NetEvent(NetEventKind.Connected, 0));
        _peer.Start();
    }

    public bool TryReceive(out NetEvent e) => _events.TryDequeue(out e);

    public void Send(byte[] frame) => _peer?.Send(frame);

    public void Dispose() => _peer?.Close("Client closed.");
}

/// <summary>Parses what players type into the Direct IP box: "1.2.3.4", "1.2.3.4:5000", "[::1]:5000", "host.example:5000".</summary>
public readonly record struct DirectIpEndpoint(string Host, int Port)
{
    public static bool TryParse(string? text, out DirectIpEndpoint endpoint)
    {
        endpoint = default;
        if (string.IsNullOrWhiteSpace(text)) return false;
        text = text.Trim();
        string host = text;
        int port = Protocol.DefaultPort;
        if (text.StartsWith('['))
        {
            int close = text.IndexOf(']');
            if (close < 0) return false;
            host = text[1..close];
            var rest = text[(close + 1)..];
            if (rest.StartsWith(':') && !int.TryParse(rest[1..], out port)) return false;
        }
        else if (text.Count(c => c == ':') == 1)
        {
            int colon = text.IndexOf(':');
            host = text[..colon];
            if (!int.TryParse(text[(colon + 1)..], out port)) return false;
        }
        if (host.Length == 0 || port is <= 0 or > 65535) return false;
        endpoint = new DirectIpEndpoint(host, port);
        return true;
    }

    public override string ToString() => Host.Contains(':') ? $"[{Host}]:{Port}" : $"{Host}:{Port}";
}
