using Godot;
using UnbrokenAges.Sim.Core;

namespace UnbrokenAges.Client.Map;

/// <summary>
/// Pointy-top hex ↔ world (XZ plane, north = −Z). Presentation-only floats; the simulation
/// never sees these numbers.
/// </summary>
public static class HexLayout
{
    public const float Size = 1f; // circumradius in world units
    private static readonly float Sqrt3 = Mathf.Sqrt(3f);

    public static Vector3 ToWorld(HexCoord h, float y = 0f) =>
        new(Size * Sqrt3 * (h.Q + h.R / 2f), y, Size * 1.5f * h.R);

    /// <summary>Corner k (0..5) at angle 30°+60°k counter-clockwise from +X (viewed from above).</summary>
    public static Vector3 Corner(HexCoord h, int k, float y = 0f)
    {
        float a = Mathf.DegToRad(30f + 60f * k);
        return ToWorld(h, y) + new Vector3(Mathf.Cos(a), 0, -Mathf.Sin(a)) * Size;
    }

    /// <summary>The two corners bounding the edge toward sim direction d (0=E,1=NE,2=NW,3=W,4=SW,5=SE).</summary>
    public static (Vector3 A, Vector3 B) Edge(HexCoord h, int direction, float y = 0f) =>
        (Corner(h, (direction + 5) % 6, y), Corner(h, direction, y));

    public static HexCoord FromWorld(Vector3 p)
    {
        float q = (Sqrt3 / 3f * p.X - 1f / 3f * p.Z) / Size;
        float r = (2f / 3f * p.Z) / Size;
        return CubeRound(q, r);
    }

    private static HexCoord CubeRound(float q, float r)
    {
        float s = -q - r;
        int rq = Mathf.RoundToInt(q), rr = Mathf.RoundToInt(r), rs = Mathf.RoundToInt(s);
        float dq = Mathf.Abs(rq - q), dr = Mathf.Abs(rr - r), ds = Mathf.Abs(rs - s);
        if (dq > dr && dq > ds) rq = -rr - rs;
        else if (dr > ds) rr = -rq - rs;
        return new HexCoord(rq, rr);
    }
}

/// <summary>Classic strategy camera: WASD/arrow pan, edge scroll, wheel zoom with tilt, all rebindable later.</summary>
public partial class StrategyCamera : Camera3D
{
    private Vector3 _focus;
    private float _distance = 18f;
    public float PanSpeed = 22f;
    public bool EdgeScroll = true;

    public override void _Ready()
    {
        Fov = 45f;
        UpdateTransform();
    }

    public void LookAtHex(HexCoord h)
    {
        _focus = HexLayout.ToWorld(h);
        UpdateTransform();
    }

    public override void _Process(double delta)
    {
        var move = Vector3.Zero;
        if (Input.IsKeyPressed(Key.W) || Input.IsKeyPressed(Key.Up)) move.Z -= 1;
        if (Input.IsKeyPressed(Key.S) || Input.IsKeyPressed(Key.Down)) move.Z += 1;
        if (Input.IsKeyPressed(Key.A) || Input.IsKeyPressed(Key.Left)) move.X -= 1;
        if (Input.IsKeyPressed(Key.D) || Input.IsKeyPressed(Key.Right)) move.X += 1;
        if (EdgeScroll)
        {
            var mouse = GetViewport().GetMousePosition();
            var size = GetViewport().GetVisibleRect().Size;
            if (mouse.X < 4) move.X -= 1;
            if (mouse.X > size.X - 4) move.X += 1;
            if (mouse.Y < 4) move.Z -= 1;
            if (mouse.Y > size.Y - 4) move.Z += 1;
        }
        if (move != Vector3.Zero)
        {
            _focus += move.Normalized() * PanSpeed * (_distance / 18f) * (float)delta;
            UpdateTransform();
        }
    }

    public override void _UnhandledInput(InputEvent @event)
    {
        if (@event is InputEventMouseButton { Pressed: true } mb)
        {
            if (mb.ButtonIndex == MouseButton.WheelUp) _distance = Mathf.Max(5f, _distance * 0.9f);
            if (mb.ButtonIndex == MouseButton.WheelDown) _distance = Mathf.Min(90f, _distance * 1.1f);
            UpdateTransform();
        }
    }

    private void UpdateTransform()
    {
        // Steeper when zoomed out (strategic view), lower when close (city view).
        float tilt = Mathf.Lerp(50f, 72f, Mathf.Clamp((_distance - 5f) / 60f, 0f, 1f));
        float rad = Mathf.DegToRad(tilt);
        Position = _focus + new Vector3(0, Mathf.Sin(rad), Mathf.Cos(rad)) * _distance;
        LookAt(_focus, Vector3.Up);
    }

    public HexCoord PickHex(Vector2 screen)
    {
        var origin = ProjectRayOrigin(screen);
        var dir = ProjectRayNormal(screen);
        if (Mathf.Abs(dir.Y) < 1e-4f) return new HexCoord(int.MinValue, int.MinValue);
        float t = -origin.Y / dir.Y;
        return HexLayout.FromWorld(origin + dir * t);
    }
}
