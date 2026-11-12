using System;
using System.Globalization;
using System.Text;

namespace AimForge.Filters
{
    /// <summary>
    /// HAND PRINT (2026-11-12) - a recorder of how THIS hand actually moves in real games, so the curve can be fitted to
    /// the player instead of to a simulated one. It sits inside Cadence Lock and sees only what the curve sees: pen
    /// position, the pen clock, tip pressure. No game, no screen, no memory - pen kinematics only.
    ///
    /// What it keeps (fixed-size counters, no allocation per report):
    ///   - time and hand travel by pen speed (4 bins per octave, 1-2048 mm/s), split hover / tip down (= firing when the
    ///     tip is the fire button);
    ///   - strokes ("episodes"): each movement from start to stop or turnaround, with its duration, hand travel, net
    ///     displacement, delivered (gain-weighted) travel, peak speed and how much of it was tip down;
    ///   - timing health: how every report gap was classified (plain / queued follower / late single / merged / unjudged)
    ///     - the stall and drop rate of the real rig under real game load;
    ///   - where on the tablet the hand lives (8 x 4 grid) and how many strokes end at an edge.
    /// The wrapper snapshots it on a lift and writes handprint-&lt;session&gt;.txt beside the daemon from a pool thread, never
    /// on the report path. AimForge --handprint / --optimize read it (src/Core/HandPrint.cs).
    /// </summary>
    public sealed class HandPrintCore
    {
        public const int Version = 1, Bins = 48, MaxEpisodes = 8192, HeatW = 8, HeatH = 4;
        public const double VOn = 6, VOff = 4, EdgeMm = 8, MinTravelMm = 0.5;
        public const int QuietReports = 3;

        /// bin 0: under 1 mm/s; bin i >= 1 starts at 2^((i-1)/4) mm/s; the last bin is open-ended (2048+ mm/s)
        public static int BinOf(double mms) => mms < 1 ? 0 : Math.Min(Bins - 1, 1 + (int)(Math.Log2(mms) * 4));
        public static double BinLo(int i) => i <= 0 ? 0 : Math.Pow(2, (i - 1) / 4.0);
        public static double BinMid(int i) => i <= 0 ? 0.5 : Math.Pow(2, (i - 0.5) / 4.0);

        public struct Episode
        {
            public float DurMs, TravelMm, NetMm, OutMm, PeakMms, TPeakMs, TipFrac;
            public byte End;   // 's' stopped, 'r' reversed, 'l' lifted or gap
        }

        public double WidthMm = 309, HeightMm = 174;
        public readonly double[] SecHover = new double[Bins], SecTip = new double[Bins], MmHover = new double[Bins], MmTip = new double[Bins];
        public readonly double[] Heat = new double[HeatW * HeatH];
        public readonly long[] Gap = new long[5];
        public readonly Episode[] Ep = new Episode[MaxEpisodes];
        public long Reports, Lifts, EdgeEnds, EpTotal;
        public double Seconds, OutMm, HandMm;
        public int EpCount => (int)Math.Min(EpTotal, MaxEpisodes);

        // ---- the stroke in progress ----
        bool inEp; int quiet, n, tipN; double dur, durMoving, travel, netX, netY, outMm, peak, tPeak, lastX, lastY, dirX, dirY;

        /// One in-stroke report. dx/dy: this report's hand delta in mm; reports x nominalMs: its time on the pen clock;
        /// speedMms and gain as the curve priced it; x/yMm: where the pen is on the tablet.
        public void Tick(double dxMm, double dyMm, double reports, double nominalMs, double speedMms, double gain, bool tip, double xMm, double yMm, int gapClass)
        {
            double sec = reports * nominalMs / 1000.0, len = Math.Sqrt(dxMm * dxMm + dyMm * dyMm);
            Reports++; Seconds += sec; HandMm += len; OutMm += len * gain;
            if ((uint)gapClass < 5u) Gap[gapClass]++;
            int b = BinOf(speedMms);
            if (tip) { SecTip[b] += sec; MmTip[b] += len; } else { SecHover[b] += sec; MmHover[b] += len; }
            int gx = (int)(xMm / WidthMm * HeatW), gy = (int)(yMm / HeightMm * HeatH);
            if (gx < 0) gx = 0; else if (gx >= HeatW) gx = HeatW - 1;
            if (gy < 0) gy = 0; else if (gy >= HeatH) gy = HeatH - 1;
            Heat[gy * HeatW + gx] += sec;
            lastX = xMm; lastY = yMm;

            if (!inEp)
            {
                if (speedMms < VOn) return;
                Begin();
            }
            else if (speedMms >= VOn && len > 0 && (dxMm * dirX + dyMm * dirY) < -0.5 * len)
            {
                // a turnaround (heading more than 120 degrees off the stroke's last direction): this stroke ends, the next begins
                End((byte)'r'); Begin();
            }
            n++; if (tip) tipN++;
            dur += sec * 1000.0; travel += len; netX += dxMm; netY += dyMm; outMm += len * gain;
            if (speedMms > peak) { peak = speedMms; tPeak = dur; }
            if (len > 0 && speedMms >= VOff) { dirX = dxMm / len; dirY = dyMm / len; }
            if (speedMms < VOff) { if (++quiet >= QuietReports) End((byte)'s'); }
            else { quiet = 0; durMoving = dur; }
        }

        /// A lift or a gap: the stroke in progress (if any) is over.
        public void Break(bool lift)
        {
            if (lift) Lifts++;
            if (inEp) End((byte)'l');
        }

        void Begin() { inEp = true; quiet = 0; n = tipN = 0; dur = durMoving = travel = netX = netY = outMm = peak = tPeak = 0; dirX = dirY = 0; }

        void End(byte how)
        {
            inEp = false;
            if (travel < MinTravelMm || n < 2) return;
            if (lastX < EdgeMm || lastX > WidthMm - EdgeMm || lastY < EdgeMm || lastY > HeightMm - EdgeMm) EdgeEnds++;
            Ep[(int)(EpTotal % MaxEpisodes)] = new Episode
            {
                DurMs = (float)(durMoving > 0 ? durMoving : dur), TravelMm = (float)travel, NetMm = (float)Math.Sqrt(netX * netX + netY * netY), OutMm = (float)outMm,
                PeakMms = (float)peak, TPeakMs = (float)tPeak, TipFrac = n > 0 ? (float)tipN / n : 0, End = how,
            };
            EpTotal++;
        }

        /// A detached copy for the writer thread (the report thread keeps recording into this one).
        public HandPrintCore Snapshot()
        {
            var c = new HandPrintCore { WidthMm = WidthMm, HeightMm = HeightMm, Reports = Reports, Lifts = Lifts, EdgeEnds = EdgeEnds, EpTotal = EpTotal, Seconds = Seconds, OutMm = OutMm, HandMm = HandMm };
            Array.Copy(SecHover, c.SecHover, Bins); Array.Copy(SecTip, c.SecTip, Bins); Array.Copy(MmHover, c.MmHover, Bins); Array.Copy(MmTip, c.MmTip, Bins);
            Array.Copy(Heat, c.Heat, Heat.Length); Array.Copy(Gap, c.Gap, Gap.Length); Array.Copy(Ep, c.Ep, EpCount);
            return c;
        }

        /// The file AimForge reads. header: free "key value" lines the wrapper adds (session, curve, nominalHz).
        public string Serialize(string header)
        {
            var inv = CultureInfo.InvariantCulture; var sb = new StringBuilder(64 * 1024);
            sb.Append("aimforge-handprint ").Append(Version).Append('\n');
            if (!string.IsNullOrEmpty(header)) sb.Append(header.TrimEnd('\n')).Append('\n');
            sb.Append(string.Format(inv, "tablet {0:0.##} {1:0.##}\n", WidthMm, HeightMm));
            sb.Append(string.Format(inv, "totals seconds {0:0.###} reports {1} lifts {2} handMm {3:0.##} outMm {4:0.##} edgeEnds {5} episodes {6}\n", Seconds, Reports, Lifts, HandMm, OutMm, EdgeEnds, EpTotal));
            sb.Append("gapclass ").Append(string.Join(" ", Gap)).Append('\n');
            void Row(string name, double[] a, string fmt) { sb.Append(name); foreach (var v in a) sb.Append(' ').Append(v.ToString(fmt, inv)); sb.Append('\n'); }
            Row("secHover", SecHover, "0.###"); Row("secTip", SecTip, "0.###"); Row("mmHover", MmHover, "0.##"); Row("mmTip", MmTip, "0.##"); Row("heat", Heat, "0.##");
            int cnt = EpCount; sb.Append("episodes ").Append(cnt).Append('\n');
            for (int i = 0; i < cnt; i++)
            {
                var e = Ep[i];
                sb.Append(string.Format(inv, "{0:0.#} {1:0.##} {2:0.##} {3:0.##} {4:0.#} {5:0.#} {6:0.##} {7}\n", e.DurMs, e.TravelMm, e.NetMm, e.OutMm, e.PeakMms, e.TPeakMs, e.TipFrac, (char)e.End));
            }
            return sb.ToString();
        }
    }
}
