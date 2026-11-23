namespace UnbrokenAges.Sim.Core;

/// <summary>
/// Axial hex coordinate, pointy-top orientation, R increasing southward.
/// Direction indices: 0=E, 1=NE, 2=NW, 3=W, 4=SW, 5=SE (opposite = (d+3)%6).
/// Storage uses "odd-r" offset rows so the map can wrap east-west.
/// </summary>
public readonly record struct HexCoord(int Q, int R)
{
    public const int E = 0, NE = 1, NW = 2, W = 3, SW = 4, SE = 5;

    public static readonly HexCoord[] Directions =
    {
        new(1, 0), new(1, -1), new(0, -1), new(-1, 0), new(-1, 1), new(0, 1),
    };

    public int S => -Q - R;

    public HexCoord Neighbor(int direction) => this + Directions[direction];

    public static HexCoord operator +(HexCoord a, HexCoord b) => new(a.Q + b.Q, a.R + b.R);
    public static HexCoord operator -(HexCoord a, HexCoord b) => new(a.Q - b.Q, a.R - b.R);

    public static int Opposite(int direction) => (direction + 3) % 6;

    public static int Distance(HexCoord a, HexCoord b) =>
        (Math.Abs(a.Q - b.Q) + Math.Abs(a.R - b.R) + Math.Abs(a.S - b.S)) / 2;

    public static HexCoord FromOffset(int col, int row) => new(col - ((row - (row & 1)) >> 1), row);

    public (int Col, int Row) ToOffset() => (Q + ((R - (R & 1)) >> 1), R);

    public override string ToString() => $"({Q},{R})";
}
