using UnbrokenAges.Sim.Data;

namespace UnbrokenAges.Sim.State;

/// <summary>
/// A save file: a short header (magic, which player you are) followed by the same snapshot multiplayer uses for resync,
/// so anything that survives a resync survives a save. The snapshot carries the content hash, so a save made with
/// different mods is refused with a clear message instead of loading into a broken game.
/// </summary>
public static class SaveGame
{
    private const string Magic = "UASAVE1";

    public static void Write(Stream stream, GameState s, int localPlayer)
    {
        using var w = new BinaryWriter(stream, System.Text.Encoding.UTF8, leaveOpen: true);
        w.Write(Magic);
        w.Write(localPlayer);
        var snapshot = GameStateSerializer.Serialize(s);
        w.Write(snapshot.Length);
        w.Write(snapshot);
    }

    public static (GameState State, int LocalPlayer) Read(Stream stream, GameDatabase db)
    {
        using var r = new BinaryReader(stream, System.Text.Encoding.UTF8, leaveOpen: true);
        if (r.ReadString() != Magic) throw new InvalidDataException("Not an Unbroken Ages save file.");
        int local = r.ReadInt32();
        var snapshot = r.ReadBytes(r.ReadInt32());
        return (GameStateSerializer.Deserialize(snapshot, db), local);
    }

    public static void WriteFile(string path, GameState s, int localPlayer)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        string temp = path + ".tmp";
        using (var f = File.Create(temp)) Write(f, s, localPlayer);
        File.Move(temp, path, overwrite: true);   // never leave a half-written save behind
    }

    public static (GameState State, int LocalPlayer) ReadFile(string path, GameDatabase db)
    {
        using var f = File.OpenRead(path);
        return Read(f, db);
    }
}
