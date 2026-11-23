namespace UnbrokenAges.Net;

public enum MsgType : byte
{
    Hello = 1,
    Welcome = 2,
    Reject = 3,
    Lobby = 4,
    Chat = 5,
    StartGame = 6,
    Submit = 10,
    Broadcast = 11,
    Rejected = 12,
    StateHash = 20,
    Resync = 21,
    Pause = 30,
    Ping = 40,
    Pong = 41,
    Kick = 50,
}

/// <summary>
/// Wire messages. Every frame is: [u32 length][u8 type][body]. Bodies are little-endian
/// BinaryWriter encodings. Bump <see cref="Protocol.Version"/> on any change.
/// </summary>
public static class Protocol
{
    public const int Version = 1;
    public const int DefaultPort = 47620;
    public const int DiscoveryPort = 47621;
    public const int MaxFrameBytes = 32 * 1024 * 1024;

    public static byte[] Encode(NetMessage m)
    {
        using var ms = new MemoryStream();
        using (var w = new BinaryWriter(ms))
        {
            w.Write((byte)m.Type);
            m.WriteBody(w);
        }
        return ms.ToArray();
    }

    public static NetMessage Decode(byte[] frame)
    {
        using var r = new BinaryReader(new MemoryStream(frame));
        var type = (MsgType)r.ReadByte();
        NetMessage m = type switch
        {
            MsgType.Hello => new HelloMsg(),
            MsgType.Welcome => new WelcomeMsg(),
            MsgType.Reject => new RejectMsg(),
            MsgType.Lobby => new LobbyMsg(),
            MsgType.Chat => new ChatMsg(),
            MsgType.StartGame => new StartGameMsg(),
            MsgType.Submit => new SubmitMsg(),
            MsgType.Broadcast => new BroadcastMsg(),
            MsgType.Rejected => new RejectedMsg(),
            MsgType.StateHash => new StateHashMsg(),
            MsgType.Resync => new ResyncMsg(),
            MsgType.Pause => new PauseMsg(),
            MsgType.Ping => new PingMsg(),
            MsgType.Pong => new PongMsg(),
            MsgType.Kick => new KickMsg(),
            _ => throw new InvalidDataException($"Unknown message type {(byte)type}"),
        };
        m.ReadBody(r);
        return m;
    }

    internal static void WriteBytes(BinaryWriter w, byte[] b) { w.Write(b.Length); w.Write(b); }
    internal static byte[] ReadBytes(BinaryReader r)
    {
        int n = r.ReadInt32();
        if (n < 0 || n > MaxFrameBytes) throw new InvalidDataException("Bad byte array length.");
        return r.ReadBytes(n);
    }
}

public abstract class NetMessage
{
    public abstract MsgType Type { get; }
    internal abstract void WriteBody(BinaryWriter w);
    internal abstract void ReadBody(BinaryReader r);
}

public sealed class HelloMsg : NetMessage
{
    public int ProtocolVersion = Protocol.Version;
    public ulong ContentHash;
    public string PlayerName = "";
    public string PasswordHash = "";
    public string ReconnectToken = "";
    public bool Spectator;
    public override MsgType Type => MsgType.Hello;
    internal override void WriteBody(BinaryWriter w) { w.Write(ProtocolVersion); w.Write(ContentHash); w.Write(PlayerName); w.Write(PasswordHash); w.Write(ReconnectToken); w.Write(Spectator); }
    internal override void ReadBody(BinaryReader r) { ProtocolVersion = r.ReadInt32(); ContentHash = r.ReadUInt64(); PlayerName = r.ReadString(); PasswordHash = r.ReadString(); ReconnectToken = r.ReadString(); Spectator = r.ReadBoolean(); }
}

public sealed class WelcomeMsg : NetMessage
{
    public int Slot;
    public string ReconnectToken = "";
    public bool Spectator;
    public override MsgType Type => MsgType.Welcome;
    internal override void WriteBody(BinaryWriter w) { w.Write(Slot); w.Write(ReconnectToken); w.Write(Spectator); }
    internal override void ReadBody(BinaryReader r) { Slot = r.ReadInt32(); ReconnectToken = r.ReadString(); Spectator = r.ReadBoolean(); }
}

public sealed class RejectMsg : NetMessage
{
    public string Reason = "";
    public override MsgType Type => MsgType.Reject;
    internal override void WriteBody(BinaryWriter w) => w.Write(Reason);
    internal override void ReadBody(BinaryReader r) => Reason = r.ReadString();
}

public sealed class LobbySlot
{
    public int Slot;
    public string Name = "";
    public string Leader = "";
    public int Team;
    public bool IsAi;
    public bool Connected;
    public bool Ready;
}

public sealed class LobbyMsg : NetMessage
{
    public List<LobbySlot> Slots = new();
    public int Spectators;
    public override MsgType Type => MsgType.Lobby;
    internal override void WriteBody(BinaryWriter w)
    {
        w.Write(Slots.Count);
        foreach (var s in Slots) { w.Write(s.Slot); w.Write(s.Name); w.Write(s.Leader); w.Write(s.Team); w.Write(s.IsAi); w.Write(s.Connected); w.Write(s.Ready); }
        w.Write(Spectators);
    }
    internal override void ReadBody(BinaryReader r)
    {
        int n = r.ReadInt32();
        for (int i = 0; i < n; i++)
            Slots.Add(new LobbySlot { Slot = r.ReadInt32(), Name = r.ReadString(), Leader = r.ReadString(), Team = r.ReadInt32(), IsAi = r.ReadBoolean(), Connected = r.ReadBoolean(), Ready = r.ReadBoolean() });
        Spectators = r.ReadInt32();
    }
}

public sealed class ChatMsg : NetMessage
{
    public const int ToAll = -1, ToTeam = -2;
    public int From;
    public int To = ToAll;
    public string Text = "";
    public override MsgType Type => MsgType.Chat;
    internal override void WriteBody(BinaryWriter w) { w.Write(From); w.Write(To); w.Write(Text); }
    internal override void ReadBody(BinaryReader r) { From = r.ReadInt32(); To = r.ReadInt32(); Text = r.ReadString(); }
}

public sealed class StartGameMsg : NetMessage
{
    public byte[] Setup = Array.Empty<byte>();
    public ulong InitialHash;
    public override MsgType Type => MsgType.StartGame;
    internal override void WriteBody(BinaryWriter w) { Protocol.WriteBytes(w, Setup); w.Write(InitialHash); }
    internal override void ReadBody(BinaryReader r) { Setup = Protocol.ReadBytes(r); InitialHash = r.ReadUInt64(); }
}

public sealed class SubmitMsg : NetMessage
{
    public int ClientSeq;
    public byte[] Command = Array.Empty<byte>();
    public override MsgType Type => MsgType.Submit;
    internal override void WriteBody(BinaryWriter w) { w.Write(ClientSeq); Protocol.WriteBytes(w, Command); }
    internal override void ReadBody(BinaryReader r) { ClientSeq = r.ReadInt32(); Command = Protocol.ReadBytes(r); }
}

/// <summary>An accepted command, stamped with the host's global sequence number.</summary>
public sealed class BroadcastMsg : NetMessage
{
    public long Seq;
    public int FromSlot;
    public int ClientSeq;
    public byte[] Command = Array.Empty<byte>();
    public override MsgType Type => MsgType.Broadcast;
    internal override void WriteBody(BinaryWriter w) { w.Write(Seq); w.Write(FromSlot); w.Write(ClientSeq); Protocol.WriteBytes(w, Command); }
    internal override void ReadBody(BinaryReader r) { Seq = r.ReadInt64(); FromSlot = r.ReadInt32(); ClientSeq = r.ReadInt32(); Command = Protocol.ReadBytes(r); }
}

public sealed class RejectedMsg : NetMessage
{
    public int ClientSeq;
    public string Reason = "";
    public override MsgType Type => MsgType.Rejected;
    internal override void WriteBody(BinaryWriter w) { w.Write(ClientSeq); w.Write(Reason); }
    internal override void ReadBody(BinaryReader r) { ClientSeq = r.ReadInt32(); Reason = r.ReadString(); }
}

public sealed class StateHashMsg : NetMessage
{
    public long Seq;
    public int Turn;
    public ulong Hash;
    public override MsgType Type => MsgType.StateHash;
    internal override void WriteBody(BinaryWriter w) { w.Write(Seq); w.Write(Turn); w.Write(Hash); }
    internal override void ReadBody(BinaryReader r) { Seq = r.ReadInt64(); Turn = r.ReadInt32(); Hash = r.ReadUInt64(); }
}

/// <summary>Full authoritative snapshot: used for desync recovery, reconnects and late joins.</summary>
public sealed class ResyncMsg : NetMessage
{
    public long Seq;
    public byte[] Snapshot = Array.Empty<byte>();
    public override MsgType Type => MsgType.Resync;
    internal override void WriteBody(BinaryWriter w) { w.Write(Seq); Protocol.WriteBytes(w, Snapshot); }
    internal override void ReadBody(BinaryReader r) { Seq = r.ReadInt64(); Snapshot = Protocol.ReadBytes(r); }
}

public sealed class PauseMsg : NetMessage
{
    public bool Paused;
    public int BySlot;
    public override MsgType Type => MsgType.Pause;
    internal override void WriteBody(BinaryWriter w) { w.Write(Paused); w.Write(BySlot); }
    internal override void ReadBody(BinaryReader r) { Paused = r.ReadBoolean(); BySlot = r.ReadInt32(); }
}

public sealed class PingMsg : NetMessage
{
    public long Timestamp;
    public override MsgType Type => MsgType.Ping;
    internal override void WriteBody(BinaryWriter w) => w.Write(Timestamp);
    internal override void ReadBody(BinaryReader r) => Timestamp = r.ReadInt64();
}

public sealed class PongMsg : NetMessage
{
    public long Timestamp;
    public override MsgType Type => MsgType.Pong;
    internal override void WriteBody(BinaryWriter w) => w.Write(Timestamp);
    internal override void ReadBody(BinaryReader r) => Timestamp = r.ReadInt64();
}

public sealed class KickMsg : NetMessage
{
    public string Reason = "";
    public override MsgType Type => MsgType.Kick;
    internal override void WriteBody(BinaryWriter w) => w.Write(Reason);
    internal override void ReadBody(BinaryReader r) => Reason = r.ReadString();
}
