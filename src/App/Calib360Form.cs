using System;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Windows.Forms;
using AimForge.Core;

namespace AimForge.App
{
    /// <summary>
    /// 360° calibration helper (2026-10-11): measure a game's sensitivity constant and write it where the roster is authored
    /// (tuner.html, plus an evidence record) - the same Core path as `--calib360`. Two ways: the game's yaw (Source 2:
    /// m_yaw in the console), or one slow marked 360 with the card applied, measured on the tablet glass. Nothing here
    /// touches a driver or the game; the new sens reaches the cards through the exporter as always.
    /// </summary>
    sealed class Calib360Form : Form
    {
        public bool Written { get; private set; }
        readonly NumericUpDown yaw = new NumericUpDown(), penMm = new NumericUpDown(), turns = new NumericUpDown();
        readonly RadioButton byYaw = new RadioButton(), byTurn = new RadioButton();
        readonly Label result = new Label();
        readonly Button write = new Button();
        Calib360.Result? last;

        public Calib360Form(Game g, Preset card, string tunerPath, Action<string> log)
        {
            Text = "AimForge - 360° calibration · " + g.name; StartPosition = FormStartPosition.CenterParent; ClientSize = new Size(560, 430);
            FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = MinimizeBox = false; BackColor = Theme.Bg; ForeColor = Theme.Ink; Font = Theme.Body;
            var rg = Rig.From(card); double printed = Curve.SensFor(g.K, rg, rg.Mult), band = Calib360.UnityBandMmS(card, rg.PxMm);
            var col = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(18, 14, 18, 10) };
            var intro = new Label { AutoSize = true, MaximumSize = new Size(520, 0), ForeColor = Theme.Steel, Margin = new Padding(0, 0, 0, 10),
                Text = $"{g.name}'s constant (K {g.K:0.0}) is an ESTIMATE. Measure it once and every {g.name} card prints the right in-game sensitivity.\nCurrent card: {card.name} - type {printed:0.000} in game first." };
            byYaw.Text = "The game's yaw (degrees per count at sens 1; Source 2 console: m_yaw)"; byYaw.AutoSize = true; byYaw.Checked = true;
            yaw.DecimalPlaces = 5; yaw.Minimum = 0.0001m; yaw.Maximum = 10; yaw.Increment = 0.001m; yaw.Value = 0.022m; Theme.NumBox(yaw); yaw.Margin = new Padding(24, 2, 0, 8);
            byTurn.Text = "A marked 360: pen travel for whole turns back to a landmark"; byTurn.AutoSize = true;
            var how = new Label { AutoSize = true, MaximumSize = new Size(500, 0), ForeColor = Theme.Steel, Margin = new Padding(24, 2, 0, 4), Font = Theme.Small,
                Text = $"With {card.name} applied and {printed:0.000} typed in game: put the pen on a mark, sweep SLOWLY (under {band:0.0} mm/s - the card's 1:1 band, about {rg.Cm360 * 10 / Math.Max(band, 0.1):0} s a turn) until the crosshair is back on the landmark, measure the distance on the glass." };
            penMm.DecimalPlaces = 1; penMm.Minimum = 10; penMm.Maximum = 5000; penMm.Value = (decimal)Math.Round(rg.Cm360 * 10, 1); Theme.NumBox(penMm);
            turns.Minimum = 1; turns.Maximum = 10; turns.Value = 1; Theme.NumBox(turns);
            var turnRow = new FlowLayoutPanel { AutoSize = true, Margin = new Padding(24, 0, 0, 8) };
            turnRow.Controls.AddRange(new Control[] { new Label { Text = "pen travel, mm", AutoSize = true, Margin = new Padding(0, 6, 6, 0) }, penMm,
                                                      new Label { Text = "turns", AutoSize = true, Margin = new Padding(12, 6, 6, 0) }, turns });
            result.AutoSize = true; result.MaximumSize = new Size(520, 0); result.Margin = new Padding(0, 6, 0, 8); result.Font = Theme.BodyB;
            var row = new FlowLayoutPanel { AutoSize = true };
            Theme.Button(write, "WRITE TO TUNER + EVIDENCE", primary: true); write.Width = 230;
            var close = new Button(); Theme.Button(close, "CLOSE  (Esc)"); close.Width = 120; close.Click += (s, e) => Close();
            row.Controls.AddRange(new Control[] { write, close });
            col.Controls.AddRange(new Control[] { intro, byYaw, yaw, byTurn, how, turnRow, result, row });
            Controls.Add(col); CancelButton = close;

            void Recompute()
            {
                try
                {
                    last = byYaw.Checked ? Calib360.FromYaw(g.id, g.K, (double)yaw.Value)
                                         : Calib360.FromTurn(g.id, g.K, (double)penMm.Value, (double)turns.Value, Math.Round(printed, 3), rg.PxMm, rg.Mult, rg.Cm360);
                    result.ForeColor = Theme.Ink;
                    result.Text = last.Summary + $"\n{card.name} would print {Curve.SensFor(last.NewK, rg, rg.Mult):0.000} (now {printed:0.000}).";
                    write.Enabled = File.Exists(tunerPath);
                    if (!write.Enabled) result.Text += "\ntuner.html is not next to AimForge.exe - use --calib360 in the project folder.";
                }
                catch (ArgumentException ae) { last = null; write.Enabled = false; result.ForeColor = Theme.Bad; result.Text = ae.Message; }
            }
            foreach (var c in new Control[] { yaw, penMm, turns }) ((NumericUpDown)c).ValueChanged += (s, e) => Recompute();
            byYaw.CheckedChanged += (s, e) => Recompute(); byTurn.CheckedChanged += (s, e) => Recompute();
            write.Click += (s, e) =>
            {
                if (last == null) return;
                try
                {
                    var when = DateTime.Now; string evId = Calib360.EvidenceId(g.id, when);
                    File.WriteAllText(tunerPath, Calib360.PatchTuner(File.ReadAllText(tunerPath), last, evId));
                    string evDir = Path.Combine(Path.GetDirectoryName(tunerPath)!, "evidence"); Directory.CreateDirectory(evDir);
                    File.WriteAllText(Path.Combine(evDir, evId + ".json"), Calib360.EvidenceJson(last, evId, when, null));
                    log($"360 calibration: {last.Summary} tuner.html patched, evidence {evId}. Run: node export-presets.js tuner.html");
                    Written = true; write.Enabled = false;
                    result.ForeColor = Theme.Teal; result.Text = "✓ WRITTEN. Now run  node export-presets.js tuner.html  in the AimForge folder and restart AimForge; the cards then print the new sens.";
                }
                catch (Exception ex) { result.ForeColor = Theme.Bad; result.Text = "not written: " + ex.Message; }
            };
            Recompute();
        }
    }
}
