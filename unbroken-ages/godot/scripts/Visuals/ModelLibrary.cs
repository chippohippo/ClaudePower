using Godot;

namespace UnbrokenAges.Client.Visuals;

/// <summary>
/// Loads the map's 3D models (KayKit / Kenney / Poly Haven, see assets/CREDITS.md) once and serves them two ways:
/// <list type="bullet">
/// <item><b>Props</b> (trees, mountains, buildings): static meshes drawn by the thousand with MultiMesh, each surface re-materialed
///   with model_tint.gdshader so instances can be tinted and fogged.</item>
/// <item><b>Scenes</b> (units): full scenes with skeletons and animations, instanced per unit.</item>
/// </list>
/// Every KayKit / Kenney hex-kit model is authored for a ~11.5 m hex, so one shared scale keeps the kit's proportions.
/// </summary>
public sealed class ModelLibrary
{
    public sealed record Part(ArrayMesh Mesh, Transform3D Local);

    public sealed class Prop
    {
        public List<Part> Parts = new();
        public Aabb Bounds;
    }

    private readonly Dictionary<string, Prop?> _props = new();
    private readonly Dictionary<string, PackedScene?> _scenes = new();
    private readonly Dictionary<string, Aabb> _sceneBounds = new();
    private static readonly Shader TintShader = GD.Load<Shader>("res://shaders/model_tint.gdshader");

    /// <summary>KayKit hex kit: 11.5 m across corners → our hex is 2 units across corners.</summary>
    public const float KitScale = 2f / 11.6f;

    public static string Path(string relative) => $"res://assets/models/{relative}.glb";

    /// <summary>Foliage sways in the wind (a vertex shader on its own material copy); buildings stay still.</summary>
    public static bool IsFoliage(string relative) => relative.Contains("tree") || relative.Contains("waterplant") || relative.Contains("grapes");

    /// <summary>
    /// A prop, optionally repainted for a nation: "buildings/home_A_blue#c8102e" loads the blue kit variant and turns its
    /// team-blue texels into #c8102e (model_tint.gdshader), so any number of nations each get their own colour.
    /// </summary>
    public Prop? GetProp(string relative)
    {
        if (_props.TryGetValue(relative, out var cached)) return cached;
        _foliage = IsFoliage(relative);
        _team = null;
        string path = relative;
        int hash = relative.IndexOf('#');
        if (hash >= 0)
        {
            path = relative[..hash];
            _team = new Color("#" + relative[(hash + 1)..]);
        }
        Prop? prop = null;
        var scene = LoadScene(path);
        if (scene != null)
        {
            var root = scene.Instantiate<Node3D>();
            prop = new Prop();
            bool first = true;
            Collect(root, Transform3D.Identity, prop, ref first);
            root.Free();
            if (prop.Parts.Count == 0) prop = null;
        }
        _props[relative] = prop;
        return prop;
    }

    private void Collect(Node node, Transform3D parent, Prop prop, ref bool first)
    {
        var xf = node is Node3D n3 ? parent * n3.Transform : parent;
        if (node is MeshInstance3D mi && mi.Mesh is ArrayMesh source && !mi.Name.ToString().Contains("LOD", StringComparison.OrdinalIgnoreCase))
        {
            var mesh = (ArrayMesh)source.Duplicate();
            for (int i = 0; i < mesh.GetSurfaceCount(); i++)
                mesh.SurfaceSetMaterial(i, Tinted(mi.GetActiveMaterial(i)));
            prop.Parts.Add(new Part(mesh, xf));
            var box = xf * mesh.GetAabb();
            prop.Bounds = first ? box : prop.Bounds.Merge(box);
            first = false;
        }
        foreach (var child in node.GetChildren()) Collect(child, xf, prop, ref first);
    }

    private readonly Dictionary<(Material, bool, Color?), ShaderMaterial> _tinted = new();
    private bool _foliage;
    private Color? _team;

    private ShaderMaterial Tinted(Material? original)
    {
        if (original != null && _tinted.TryGetValue((original, _foliage, _team), out var done)) return done;
        var m = new ShaderMaterial { Shader = TintShader };
        m.SetShaderParameter("sway", _foliage ? 1f : 0f);
        m.SetShaderParameter("team_on", _team.HasValue ? 1f : 0f);
        if (_team is { } team) m.SetShaderParameter("team_color", team);
        if (original is BaseMaterial3D b)
        {
            m.SetShaderParameter("albedo_tex", b.AlbedoTexture);
            m.SetShaderParameter("albedo_color", b.AlbedoColor);
            m.SetShaderParameter("uv_scale", new Vector2(b.Uv1Scale.X, b.Uv1Scale.Y));
            m.SetShaderParameter("uv_offset", new Vector2(b.Uv1Offset.X, b.Uv1Offset.Y));
            m.SetShaderParameter("roughness", Mathf.Clamp(b.Roughness, 0.4f, 1f));
            if (b.AlbedoTexture == null) m.SetShaderParameter("albedo_tex", WhiteTexture);
            // Kenney kits colour by UV into a small palette ("colormap"): mipmaps would bleed neighbouring swatches together.
            else m.SetShaderParameter("palette", b.AlbedoTexture.ResourcePath.Contains("colormap") || b.AlbedoTexture.GetWidth() <= 128 ? 1f : 0f);
        }
        else m.SetShaderParameter("albedo_tex", WhiteTexture);
        if (original != null) _tinted[(original, _foliage, _team)] = m;
        return m;
    }

    private static Texture2D? _white;
    private static Texture2D WhiteTexture => _white ??= ImageTexture.CreateFromImage(Image.CreateEmpty(2, 2, false, Image.Format.Rgb8).Also(i => i.Fill(Colors.White)));

    public PackedScene? LoadScene(string relative)
    {
        if (_scenes.TryGetValue(relative, out var s)) return s;
        string path = Path(relative);
        var scene = ResourceLoader.Exists(path) ? GD.Load<PackedScene>(path) : null;
        if (scene == null) GD.PushWarning($"Missing model {path}");
        _scenes[relative] = scene;
        return scene;
    }

    /// <summary>Bounds of a scene in its own space (for fitting units to a size).</summary>
    public Aabb SceneBounds(string relative)
    {
        if (_sceneBounds.TryGetValue(relative, out var b)) return b;
        var scene = LoadScene(relative);
        var box = new Aabb();
        if (scene != null)
        {
            var root = scene.Instantiate<Node3D>();
            bool first = true;
            void Walk(Node n, Transform3D parent)
            {
                var xf = n is Node3D n3 ? parent * n3.Transform : parent;
                if (n is MeshInstance3D mi && mi.Mesh != null)
                {
                    var bb = xf * mi.Mesh.GetAabb();
                    box = first ? bb : box.Merge(bb);
                    first = false;
                }
                foreach (var c in n.GetChildren()) Walk(c, xf);
            }
            Walk(root, Transform3D.Identity);
            root.Free();
        }
        _sceneBounds[relative] = box;
        return box;
    }
}

public static class SceneTint
{
    /// <summary>Multiplies every material's albedo under <paramref name="root"/> (e.g. the kit's orange horse → chestnut).</summary>
    public static void Apply(Node root, Color tint, Color glow = default)
    {
        foreach (var mi in root.FindChildren("*", "MeshInstance3D", true, false).OfType<MeshInstance3D>())
            for (int i = 0; i < mi.GetSurfaceOverrideMaterialCount(); i++)
                if (mi.GetActiveMaterial(i) is BaseMaterial3D b)
                {
                    var copy = (BaseMaterial3D)b.Duplicate();
                    copy.AlbedoColor = b.AlbedoColor * tint;
                    if (glow.R + glow.G + glow.B > 0.01f)
                    {
                        // light from within: the brightest parts of the texture glow in the path's colour
                        copy.EmissionEnabled = true;
                        copy.Emission = glow;
                        copy.EmissionEnergyMultiplier = 0.35f;
                        if (b.AlbedoTexture != null) copy.EmissionTexture = b.AlbedoTexture;
                    }
                    mi.SetSurfaceOverrideMaterial(i, copy);
                }
    }

    public static readonly Color Chestnut = new(0.66f, 0.6f, 0.62f);
}

internal static class ObjectExtensions
{
    public static T Also<T>(this T value, Action<T> action)
    {
        action(value);
        return value;
    }
}
