using System;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;
using AimForge.Core;

namespace AimForge.App
{
    /// <summary>
    /// In-window Nib Twin calibration (2026-10-11). Replaces the two message boxes: the user sees what will happen, a live
    /// count of the taps the fit will actually use (NibFit.Progress - the fit's own settled rule, read from the press log the
    /// plugin appends after every press), and the fit's numbers with what each one means for aim. The transaction itself is
    /// unchanged: NibCalibrator.Run (calibration build -> taps -> fit -> save -> re-apply, rolled back on any failure).
    /// The log is polled only while the user is tapping; idle is untouched.
    /// </summary>
    sealed class NibCalibrateForm : Form
    {
        public const int TargetTaps = 20;
        readonly Label head = new Label(), body = new Label(), count = new Label(), result = new Label();
        readonly ProgressBar bar = new ProgressBar();
        readonly CheckBox twinOn = new CheckBox();
        readonly Button go = new Button(), done = new Button(), cancel = new Button();
        readonly Timer poll = new Timer { Interval = 250 };
        readonly ToolTip tip = new ToolTip { AutoPopDelay = 20000 };
        readonly string logPath; readonly double unitsPerMm;
        TaskCompletionSource<bool>? taps;
        int lastPresses = -1; DateTime lastChange = DateTime.MinValue;

        /// Set when the user presses START; the window then runs the transaction and calls BeginTapping / ShowResult.
        public event Action<bool>? Started;
        public bool TwinOptIn => twinOn.Checked;

        public NibCalibrateForm(string cardName, string appliedAt, bool twinAlreadyOn, string logPath, double unitsPerMm)
        {
            this.logPath = logPath; this.unitsPerMm = unitsPerMm;
            Text = "AimForge - calibrate nib"; FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = MinimizeBox = false;
            StartPosition = FormStartPosition.CenterParent; ClientSize = new Size(520, 360); BackColor = Theme.Bg; ForeColor = Theme.Ink; Font = Theme.Body;
            KeyPreview = true;
            var col = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(18, 14, 18, 10) };
            head.Text = "CALIBRATE NIB  ·  " + cardName.ToUpperInvariant(); head.Font = Theme.Heading; head.AutoSize = true;
            body.MaximumSize = new Size(484, 0); body.AutoSize = true; body.ForeColor = Theme.Steel; body.Margin = new Padding(0, 6, 0, 8);
            body.Text = $"Measures how far the pen tip's click moves the reported position, so the Nib Twin can cancel it.\n\n" +
                        $"1. AimForge re-applies your LIVE build ({cardName}, applied {appliedAt}) with the press log on. Nothing else changes.\n" +
                        $"2. Hold the pen still in hover and TAP the tip about {TargetTaps} times, about one tap a second, like firing.\n" +
                        "3. The count below shows only the taps the fit can use (pen still before the tap). It finishes by itself.\n" +
                        "Your build is re-applied afterwards either way; a failed fit changes nothing.";
            twinOn.Text = twinAlreadyOn ? "The Nib Twin is on: it takes the new calibration" : "Turn the Nib Twin ON when the fit succeeds (experimental, field verdict pending)";
            twinOn.Checked = true; twinOn.Enabled = !twinAlreadyOn; twinOn.AutoSize = true; twinOn.ForeColor = Theme.Ink;
            tip.SetToolTip(twinOn, "On: the re-apply after a good fit runs your build with the twin, verified by read-back. Ctrl+Tab then compares it with the build before.");
            count.AutoSize = true; count.Font = Theme.Heading; count.Margin = new Padding(0, 10, 0, 2); count.Text = "";
            tip.SetToolTip(count, "Settled taps: the pen moved < 0.3 mm in the 20 reports before the tip touched. Moving taps are not counted - they would teach the twin your hand motion.");
            bar.Width = 484; bar.Height = 10; bar.Maximum = TargetTaps; bar.Visible = false;
            result.MaximumSize = new Size(484, 0); result.AutoSize = true; result.Margin = new Padding(0, 8, 0, 0);
            var row = new FlowLayoutPanel { AutoSize = true, Margin = new Padding(0, 12, 0, 0) };
            Theme.Button(go, "START  (Enter)", primary: true); go.Width = 150;
            Theme.Button(done, "DONE TAPPING"); done.Width = 130; done.Visible = false;
            Theme.Button(cancel, "CANCEL  (Esc)"); cancel.Width = 120;
            row.Controls.AddRange(new Control[] { go, done, cancel });
            col.Controls.AddRange(new Control[] { head, body, twinOn, count, bar, result, row });
            Controls.Add(col);
            AcceptButton = go; CancelButton = cancel;
            go.Click += (s, e) => { go.Enabled = false; twinOn.Enabled = false; count.Text = "applying the calibration build..."; Started?.Invoke(twinOn.Checked); };
            done.Click += (s, e) => Finish(true);
            cancel.Click += (s, e) => { if (taps != null) Finish(false); else Close(); };
            poll.Tick += (s, e) => Poll();
            FormClosing += (s, e) => { if (taps != null && !taps.Task.IsCompleted) { e.Cancel = true; Finish(false); } };
        }

        /// Called from the transaction's waitForTaps (on the UI thread): show the counter and wait for the user.
        public Task<bool> BeginTapping()
        {
            taps = new TaskCompletionSource<bool>();
            lastPresses = -1; bar.Visible = true; done.Visible = true; done.Enabled = false; AcceptButton = done;
            count.Text = $"TAP NOW  ·  0 / {TargetTaps} usable taps"; count.ForeColor = Theme.Teal;
            poll.Start();
            return taps.Task;
        }

        void Poll()
        {
            (int presses, int settled) p = (0, 0);
            try { if (File.Exists(logPath)) p = NibFit.Progress(File.ReadAllLines(logPath), unitsPerMm); } catch (IOException) { return; }   // the plugin is mid-append
            if (p.presses != lastPresses) { lastPresses = p.presses; lastChange = DateTime.UtcNow; }
            bar.Value = Math.Min(TargetTaps, p.settled);
            count.Text = $"TAP NOW  ·  {p.settled} / {TargetTaps} usable taps" + (p.presses > p.settled ? $"   ({p.presses - p.settled} moved, not used)" : "");
            done.Enabled = p.settled >= NibCal.MinTaps;
            // finishes by itself: the target reached and 1.5 s without a new press (the plugin flushes 250 ms after a release)
            if (p.settled >= TargetTaps && (DateTime.UtcNow - lastChange).TotalSeconds > 1.5) Finish(true);
        }

        void Finish(bool ok)
        {
            poll.Stop();
            if (taps == null || taps.Task.IsCompleted) return;
            done.Enabled = false; cancel.Enabled = false; count.Text = ok ? "fitting and re-applying your build..." : "cancelling - re-applying your build...";
            taps.TrySetResult(ok);
        }

        /// The outcome, with every number explained (hover for what it means for aim).
        public void ShowResult(NibFit.Result res, string? error)
        {
            bar.Visible = false; done.Visible = false; go.Visible = false; cancel.Enabled = true; cancel.Text = "CLOSE"; AcceptButton = cancel;
            var cal = res.Cal;
            if (error != null) { count.Text = "✖  ERROR"; count.ForeColor = Theme.Bad; result.Text = error; return; }
            bool saved = cal != null && res.Refused == null || (res.Refused?.StartsWith("calibration saved") ?? false);
            count.ForeColor = res.Refused == null ? Theme.Teal : saved ? Theme.Amber : Theme.Bad;
            count.Text = res.Refused == null ? (res.Restored?.NibTwin == true ? "✓  CALIBRATED - TWIN LIVE" : "✓  CALIBRATED") : saved ? "⚠  CALIBRATED, NOT RE-APPLIED" : "✖  NOT CALIBRATED";
            result.Text = (cal != null
                ? $"swing {cal.MagMm:0.000} mm at {cal.AngleDeg:0}°   ·   R² {cal.R2:0.00}   ·   lag {cal.SkidLagReports:0} reports   ·   per-tap spread {cal.PerTapMagSpreadPct:0}%   ·   {cal.Taps} taps\n"
                : "") + (res.Refused ?? (res.Restored?.NibTwin == true ? "The live build now cancels this swing. Ctrl+Tab A/Bs it against the build before." : "Tick 'Nib twin' in Modes and apply to use it."));
            tip.SetToolTip(result, "swing: how far the tip's click drags the reported point - what the twin removes from every shot.\n" +
                                   "R²: how well pressure predicts that drag (>= 0.8 needed; low = the skid is not consistent for this grip).\n" +
                                   "lag: reports between pressure and movement, matched by the twin.\n" +
                                   "per-tap spread: tap-to-tap variation; above 35% the Doctor asks for a recalibration.");
        }
    }
}
