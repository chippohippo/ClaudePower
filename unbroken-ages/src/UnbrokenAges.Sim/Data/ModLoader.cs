using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using UnbrokenAges.Sim.Core;

namespace UnbrokenAges.Sim.Data;

public sealed class ModDependency
{
    public string Id { get; init; } = "";
    public string? MinVersion { get; init; }
}

/// <summary>mod.json — see docs/07-modding.md.</summary>
public sealed class ModManifest
{
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public string Version { get; init; } = "1.0.0";
    public string? Description { get; init; }
    public List<string> Authors { get; init; } = new();
    public List<ModDependency> DependsOn { get; init; } = new();
    public List<string> LoadAfter { get; init; } = new();
    /// <summary>False for UI-only / cosmetic mods: they don't contribute to the content hash, so players can use different ones in multiplayer.</summary>
    public bool AffectsGameplay { get; init; } = true;
    /// <summary>Data files relative to the mod root. Empty = every *.json under data/.</summary>
    public List<string> Data { get; init; } = new();
    public List<string> Localization { get; init; } = new();
    public List<string> Ui { get; init; } = new();
    public List<string> Scripts { get; init; } = new();
}

public sealed record LoadedMod(ModManifest Manifest, string RootPath);

public sealed class ModLoadException : Exception
{
    public IReadOnlyList<string> Errors { get; }
    public ModLoadException(IReadOnlyList<string> errors)
        : base("Mod loading failed:\n  " + string.Join("\n  ", errors)) => Errors = errors;
}

/// <summary>
/// Loads the base game and mods as ordered "layers". Every data entry is an add, replace,
/// patch, or delete operation on the merged set (the base game is itself just a mod), so mods
/// compose without overwriting whole files. Produces a linked, validated GameDatabase.
/// </summary>
public static class ModLoader
{
    public const string OpKey = "$op";

    public static GameDatabase LoadFromDirectories(IEnumerable<string> modRoots)
    {
        var errors = new List<string>();
        var mods = new List<LoadedMod>();
        foreach (var root in modRoots)
        {
            var manifestPath = Path.Combine(root, "mod.json");
            if (!File.Exists(manifestPath))
            {
                errors.Add($"{root}: missing mod.json");
                continue;
            }
            try
            {
                var manifest = JsonSerializer.Deserialize<ModManifest>(File.ReadAllText(manifestPath), JsonSupport.DataOptions)!;
                mods.Add(new LoadedMod(manifest, root));
            }
            catch (JsonException ex)
            {
                errors.Add($"{manifestPath}: {ex.Message}");
            }
        }
        if (errors.Count > 0) throw new ModLoadException(errors);
        return Load(mods);
    }

    public static GameDatabase Load(IReadOnlyList<LoadedMod> mods)
    {
        var errors = new List<string>();
        var ordered = ResolveLoadOrder(mods, errors);
        if (errors.Count > 0) throw new ModLoadException(errors);

        var files = new List<(string ModId, string Path, string Json)>();
        foreach (var mod in ordered)
        {
            foreach (var file in DataFilesOf(mod))
                files.Add((mod.Manifest.Id, file, File.ReadAllText(file)));
        }
        return Build(files, ordered.Select(m => m.Manifest).ToList(), errors);
    }

    /// <summary>Builds a database from in-memory JSON documents (used by tests and the hot-reload path).</summary>
    public static GameDatabase LoadFromStrings(IEnumerable<(string ModId, string Json)> documents)
    {
        var errors = new List<string>();
        var files = documents.Select((d, i) => (d.ModId, $"<memory:{d.ModId}:{i}>", d.Json)).ToList();
        var manifests = files.Select(f => f.ModId).Distinct().Select(id => new ModManifest { Id = id }).ToList();
        return Build(files, manifests, errors);
    }

    private static IEnumerable<string> DataFilesOf(LoadedMod mod)
    {
        if (mod.Manifest.Data.Count > 0)
            return mod.Manifest.Data.Select(f => Path.Combine(mod.RootPath, f));
        var dataDir = Path.Combine(mod.RootPath, "data");
        if (!Directory.Exists(dataDir)) return Array.Empty<string>();
        return Directory.GetFiles(dataDir, "*.json", SearchOption.AllDirectories).OrderBy(p => p, StringComparer.Ordinal);
    }

    /// <summary>Topological sort on dependsOn + loadAfter; ties broken by mod id for determinism.</summary>
    public static List<LoadedMod> ResolveLoadOrder(IReadOnlyList<LoadedMod> mods, List<string> errors)
    {
        var byId = new SortedDictionary<string, LoadedMod>(StringComparer.Ordinal);
        foreach (var m in mods)
        {
            if (!byId.TryAdd(m.Manifest.Id, m)) errors.Add($"Duplicate mod id '{m.Manifest.Id}'.");
        }

        var edges = new SortedDictionary<string, SortedSet<string>>(StringComparer.Ordinal); // id -> must load before id
        foreach (var (id, mod) in byId)
        {
            var before = new SortedSet<string>(StringComparer.Ordinal);
            foreach (var dep in mod.Manifest.DependsOn)
            {
                if (!byId.TryGetValue(dep.Id, out var depMod))
                {
                    errors.Add($"Mod '{id}' depends on missing mod '{dep.Id}'.");
                    continue;
                }
                if (dep.MinVersion != null && CompareVersions(depMod.Manifest.Version, dep.MinVersion) < 0)
                    errors.Add($"Mod '{id}' requires '{dep.Id}' >= {dep.MinVersion} but {depMod.Manifest.Version} is installed.");
                before.Add(dep.Id);
            }
            foreach (var after in mod.Manifest.LoadAfter)
                if (byId.ContainsKey(after)) before.Add(after); // soft ordering: ignored if absent
            edges[id] = before;
        }

        var result = new List<LoadedMod>();
        var state = new Dictionary<string, int>(StringComparer.Ordinal);
        void Visit(string id, Stack<string> path)
        {
            state.TryGetValue(id, out int s);
            if (s == 2) return;
            if (s == 1)
            {
                errors.Add($"Mod dependency cycle: {string.Join(" -> ", path.Reverse())} -> {id}");
                return;
            }
            state[id] = 1;
            path.Push(id);
            foreach (var dep in edges[id]) Visit(dep, path);
            path.Pop();
            state[id] = 2;
            result.Add(byId[id]);
        }
        foreach (var id in byId.Keys) Visit(id, new Stack<string>());
        return result;
    }

    public static int CompareVersions(string a, string b)
    {
        var pa = a.Split('.');
        var pb = b.Split('.');
        for (int i = 0; i < Math.Max(pa.Length, pb.Length); i++)
        {
            int x = i < pa.Length && int.TryParse(pa[i], out var xa) ? xa : 0;
            int y = i < pb.Length && int.TryParse(pb[i], out var yb) ? yb : 0;
            if (x != y) return x.CompareTo(y);
        }
        return 0;
    }

    private sealed class Entry
    {
        public required string Id;
        public required JsonObject Node;
        public required string ModId;
    }

    private static GameDatabase Build(List<(string ModId, string Path, string Json)> files, List<ModManifest> manifests, List<string> errors)
    {
        var db = new GameDatabase();
        var registry = db.Categories;
        var knownCategories = registry.Select(c => c.Key).ToHashSet(StringComparer.Ordinal);
        var categories = new Dictionary<string, List<Entry>>(StringComparer.Ordinal);

        foreach (var (modId, path, json) in files)
        {
            JsonNode? root;
            try
            {
                root = JsonNode.Parse(json, documentOptions: JsonSupport.DocumentOptions);
            }
            catch (JsonException ex)
            {
                errors.Add($"[{modId}] {path}: invalid JSON: {ex.Message}");
                continue;
            }
            if (root is not JsonObject rootObj)
            {
                errors.Add($"[{modId}] {path}: root must be an object of categories.");
                continue;
            }
            foreach (var (category, value) in rootObj)
            {
                if (category.StartsWith('$')) continue; // e.g. "$schema"
                if (!knownCategories.Contains(category))
                {
                    errors.Add($"[{modId}] {path}: unknown category '{category}'. Known: {string.Join(", ", knownCategories.Order(StringComparer.Ordinal))}.");
                    continue;
                }
                if (value is not JsonArray array)
                {
                    errors.Add($"[{modId}] {path}: category '{category}' must be an array.");
                    continue;
                }
                if (!categories.TryGetValue(category, out var list)) categories[category] = list = new List<Entry>();
                foreach (var item in array)
                    ApplyOperation(list, item, modId, path, category, errors);
            }
        }

        // Deserialize merged nodes in a fixed category order, then link cross references.
        var hash = StableHash.FnvOffset;
        foreach (var (category, type, add) in registry)
        {
            if (!categories.TryGetValue(category, out var list)) continue;
            foreach (var entry in list)
            {
                entry.Node.Remove(OpKey);
                string canonical = entry.Node.ToJsonString();
                hash = StableHash.Fnv1a64(Encoding.UTF8.GetBytes(category + ":" + canonical), hash);
                try
                {
                    var def = (Definition)entry.Node.Deserialize(type, JsonSupport.DataOptions)!;
                    def.SourceMod = entry.ModId;
                    add(def);
                }
                catch (Exception ex) when (ex is JsonException or InvalidOperationException or FormatException)
                {
                    errors.Add($"[{entry.ModId}] {category} '{entry.Id}': {ex.Message}");
                }
            }
        }

        if (errors.Count == 0) db.LinkAll(errors);
        if (errors.Count > 0) throw new ModLoadException(errors);

        db.ContentHash = hash;
        db.LoadedMods = manifests.Select(m => $"{m.Id}@{m.Version}").ToList();
        return db;
    }

    private static void ApplyOperation(List<Entry> list, JsonNode? item, string modId, string path, string category, List<string> errors)
    {
        if (item is not JsonObject obj)
        {
            errors.Add($"[{modId}] {path}: entries in '{category}' must be objects.");
            return;
        }
        string? id = obj["id"]?.GetValue<string>();
        if (string.IsNullOrEmpty(id))
        {
            errors.Add($"[{modId}] {path}: an entry in '{category}' has no 'id'.");
            return;
        }
        string op = obj[OpKey]?.GetValue<string>() ?? "add";
        int existing = list.FindIndex(e => e.Id == id);
        string where = $"[{modId}] {path}: {category} '{id}'";

        switch (op)
        {
            case "add":
                if (existing >= 0)
                {
                    errors.Add($"{where}: already defined by mod '{list[existing].ModId}'. Use \"$op\": \"replace\" or \"patch\".");
                    return;
                }
                list.Add(new Entry { Id = id, Node = (JsonObject)obj.DeepClone(), ModId = modId });
                break;
            case "replace":
                if (existing < 0) { errors.Add($"{where}: cannot replace, not defined."); return; }
                list[existing] = new Entry { Id = id, Node = (JsonObject)obj.DeepClone(), ModId = modId };
                break;
            case "patch":
                if (existing < 0) { errors.Add($"{where}: cannot patch, not defined."); return; }
                try
                {
                    DeepMerge(list[existing].Node, obj);
                    list[existing].ModId = $"{list[existing].ModId}+{modId}";
                }
                catch (InvalidOperationException ex)
                {
                    errors.Add($"{where}: {ex.Message}");
                }
                break;
            case "delete":
                if (existing < 0) { errors.Add($"{where}: cannot delete, not defined."); return; }
                list.RemoveAt(existing);
                break;
            default:
                errors.Add($"{where}: unknown $op '{op}' (expected add, replace, patch, delete).");
                break;
        }
    }

    /// <summary>
    /// Recursive merge. Objects merge key-by-key; scalars and plain arrays replace; null removes
    /// the key. Array operators: {"$append": [...]}, {"$prepend": [...]},
    /// {"$removeWhere": {"field": value}}, {"$remove": [scalar, ...]}.
    /// </summary>
    public static void DeepMerge(JsonObject target, JsonObject patch)
    {
        foreach (var (key, value) in patch.ToList())
        {
            if (key == OpKey || key == "id") continue;
            if (value is null)
            {
                target.Remove(key);
                continue;
            }
            if (value is JsonObject pObj && IsArrayOperator(pObj))
            {
                var arr = target[key] as JsonArray ?? new JsonArray();
                if (target[key] is null) target[key] = arr;
                ApplyArrayOperator(arr, pObj);
                continue;
            }
            if (value is JsonObject patchObj && target[key] is JsonObject targetObj)
            {
                DeepMerge(targetObj, patchObj);
                continue;
            }
            target[key] = value.DeepClone();
        }
    }

    private static bool IsArrayOperator(JsonObject o) =>
        o.ContainsKey("$append") || o.ContainsKey("$prepend") || o.ContainsKey("$removeWhere") || o.ContainsKey("$remove");

    private static void ApplyArrayOperator(JsonArray arr, JsonObject op)
    {
        if (op["$removeWhere"] is JsonObject where)
        {
            for (int i = arr.Count - 1; i >= 0; i--)
            {
                if (arr[i] is not JsonObject element) continue;
                bool all = true;
                foreach (var (field, expected) in where)
                    if (!JsonNode.DeepEquals(element[field], expected)) { all = false; break; }
                if (all) arr.RemoveAt(i);
            }
        }
        if (op["$remove"] is JsonArray remove)
        {
            for (int i = arr.Count - 1; i >= 0; i--)
                if (remove.Any(r => JsonNode.DeepEquals(r, arr[i]))) arr.RemoveAt(i);
        }
        if (op["$prepend"] is JsonArray prepend)
        {
            for (int i = prepend.Count - 1; i >= 0; i--) arr.Insert(0, prepend[i]?.DeepClone());
        }
        if (op["$append"] is JsonArray append)
        {
            foreach (var a in append) arr.Add(a?.DeepClone());
        }
    }
}
