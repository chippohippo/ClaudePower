using Godot;

namespace UnbrokenAges.Client.Visuals;

/// <summary>
/// A sheet of drifting cloud high over the map. It follows the camera, is invisible from close up and gathers as the camera
/// climbs to the strategic view, as if looking down at the world from the sky.
/// </summary>
public partial class CloudLayer : MeshInstance3D
{
    private readonly ShaderMaterial _mat;

    public CloudLayer(Texture2D noise)
    {
        _mat = new ShaderMaterial { Shader = GD.Load<Shader>("res://shaders/clouds.gdshader") };
        _mat.SetShaderParameter("noise", noise);
        Mesh = new PlaneMesh { Size = new Vector2(260, 260) };
        MaterialOverride = _mat;
        CastShadow = ShadowCastingSetting.Off;
    }

    public override void _Process(double delta)
    {
        if (GetViewport().GetCamera3D() is not { } cam) return;
        float height = cam.GlobalPosition.Y;
        float opacity = Mathf.SmoothStep(26f, 55f, height);
        _mat.SetShaderParameter("opacity", opacity);
        Visible = opacity > 0.01f;
        // Halfway between the camera and the ground, under the camera (so it never cuts through the lens).
        GlobalPosition = new Vector3(cam.GlobalPosition.X, Mathf.Clamp(height * 0.55f, 8f, 40f), cam.GlobalPosition.Z - height * 0.3f);
    }
}
