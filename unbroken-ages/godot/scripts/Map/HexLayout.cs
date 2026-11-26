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

/// <summary>
/// Strategy camera: WASD/arrow pan, edge scroll, wheel zoom with tilt (steeper when far, lower and more cinematic when close), Q/E
/// to swing around the focus. Every move eases toward its goal rather than jumping. A cinematic can take the camera over
/// (focus, distance, tilt and swing set directly) and hand it back where it was.
/// </summary>
public partial class StrategyCamera : Camera3D
{
    private Vector3 _focus, _focusGoal;
    private float _distance = 14f, _distanceGoal = 14f;
    private float _yaw, _yawGoal;
    public float PanSpeed = 22f;
    public bool EdgeScroll = true;
    /// <summary>Seconds for a move to settle about two-thirds of the way (0 = jump at once).</summary>
    public static float Easing = 0.12f;

    // A cinematic's hold on the camera.
    private bool _cinematic;
    private Vector3 _cineFocus;
    private float _cineDistance, _cineTilt, _cineYaw;

    public override void _Ready()
    {
        Fov = 40f;
        // A gentle tilt-shift: the far map softens like a painted backdrop, the area you look at stays crisp.
        Attributes = new CameraAttributesPractical { DofBlurFarEnabled = true, DofBlurAmount = 0.06f, DofBlurFarTransition = 18f };
        UpdateTransform();
    }

    public Vector3 Focus => _focusGoal;
    public float Distance => _distanceGoal;
    /// <summary>The eased distance the camera is at this frame (what is on screen, unlike the goal).</summary>
    public float CurrentDistance => _cinematic ? _cineDistance : _distance;

    /// <summary>Strategic zoom: entered beyond <see cref="StrategicEnter"/>, left below <see cref="StrategicExit"/> (hysteresis,
    /// so it does not flicker at the threshold). Map labels collapse and decoration clutter hides while it is on.</summary>
    public bool Strategic { get; private set; }
    public const float StrategicEnter = 26f, StrategicExit = 22f;

    private void UpdateStrategic()
    {
        float d = CurrentDistance;
        if (!Strategic && d > StrategicEnter) Strategic = true;
        else if (Strategic && d < StrategicExit) Strategic = false;
    }

    /// <summary>Slow cinematic pan for the title backdrop.</summary>
    public void Drift(float delta)
    {
        _focusGoal += new Vector3(0.35f, 0, 0.12f) * delta;
        _focus = _focusGoal;
        UpdateTransform();
    }

    public void LookAtHex(HexCoord h) => _focusGoal = HexLayout.ToWorld(h);

    /// <summary>Jumps to the goal at once (scripted shots, loading a game).</summary>
    public void Settle()
    {
        _focus = _focusGoal; _distance = _distanceGoal; _yaw = _yawGoal;
        UpdateTransform();
    }

    public void BeginCinematic() { _cinematic = true; _cineFocus = _focus; _cineDistance = _distance; _cineTilt = TiltFor(_distance); _cineYaw = _yaw; }
    public void SetCinematic(Vector3 focus, float distance, float tilt, float yaw) { _cineFocus = focus; _cineDistance = distance; _cineTilt = tilt; _cineYaw = yaw; UpdateTransform(); }
    public void EndCinematic() { _cinematic = false; _focus = _cineFocus; _distance = _cineDistance; _yaw = _cineYaw; }
    public bool InCinematic => _cinematic;

    public override void _Process(double delta)
    {
        if (_cinematic) return;
        var move = Vector3.Zero;
        if (Input.IsKeyPressed(Key.W) || Input.IsKeyPressed(Key.Up)) move.Z -= 1;
        if (Input.IsKeyPressed(Key.S) || Input.IsKeyPressed(Key.Down)) move.Z += 1;
        if (Input.IsKeyPressed(Key.A) || Input.IsKeyPressed(Key.Left)) move.X -= 1;
        if (Input.IsKeyPressed(Key.D) || Input.IsKeyPressed(Key.Right)) move.X += 1;
        if (Input.IsKeyPressed(Key.Q)) _yawGoal -= 70f * (float)delta;
        if (Input.IsKeyPressed(Key.E) && !Input.IsKeyPressed(Key.Ctrl)) _yawGoal += 70f * (float)delta;
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
            _focusGoal += new Basis(Vector3.Up, Mathf.DegToRad(-_yaw)) * move.Normalized() * PanSpeed * (_distanceGoal / 18f) * (float)delta;
        // Ease toward the goal: frame-rate independent exponential smoothing.
        float k = Easing <= 0f ? 1f : 1f - Mathf.Exp(-(float)delta / Easing);
        _focus = _focus.Lerp(_focusGoal, k);
        _distance = Mathf.Lerp(_distance, _distanceGoal, k);
        _yaw = Mathf.Lerp(_yaw, _yawGoal, k);
        UpdateTransform();
    }

    public override void _UnhandledInput(InputEvent @event)
    {
        if (_cinematic) return;
        if (@event is InputEventMouseButton { Pressed: true } mb)
        {
            if (mb.ButtonIndex == MouseButton.WheelUp) _distanceGoal = Mathf.Max(5f, _distanceGoal * 0.88f);
            if (mb.ButtonIndex == MouseButton.WheelDown) _distanceGoal = Mathf.Min(90f, _distanceGoal * 1.12f);
        }
    }

    /// <summary>Multiplies the camera distance (scripted views, a future zoom slider).</summary>
    public void Zoom(float factor) => _distanceGoal = Mathf.Clamp(_distanceGoal * factor, 5f, 90f);

    /// <summary>Steeper when zoomed out (strategic view), lower when close (a view across the land, like a diorama).</summary>
    private static float TiltFor(float distance) => Mathf.Lerp(36f, 70f, Mathf.Clamp((distance - 5f) / 55f, 0f, 1f));

    private void UpdateTransform()
    {
        var focus = _cinematic ? _cineFocus : _focus;
        float distance = _cinematic ? _cineDistance : _distance;
        float rad = Mathf.DegToRad(_cinematic ? _cineTilt : TiltFor(distance));
        float yaw = Mathf.DegToRad(_cinematic ? _cineYaw : _yaw);
        var back = new Basis(Vector3.Up, -yaw) * new Vector3(0, Mathf.Sin(rad), Mathf.Cos(rad));
        Position = focus + back * distance;
        LookAt(focus, Vector3.Up);
        UpdateStrategic();
        if (Attributes is CameraAttributesPractical dof)
        {
            dof.DofBlurFarDistance = distance * 1.6f;
            dof.DofBlurAmount = _cinematic ? 0.11f : 0.06f;        // a cinematic shot softens the background further
        }
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
