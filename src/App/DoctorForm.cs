using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;
using AimForge.Core;

namespace AimForge.App
{
    /// <summary>
    /// The Doctor as a panel (2026-10-11): traffic-light rows, the detail, and the one action that clears each row - no
    /// terminal. Failures sort first. "Copy report" puts the whole thing on the clipboard as plain text.
    /// </summary>
    sealed class DoctorForm : Form
    {
        public DoctorForm(IReadOnlyList<Doctor.Item> rows)
        {
            Text = "AimForge - Doctor"; StartPosition = FormStartPosition.CenterParent; ClientSize = new Size(980, 560); MinimumSize = new Size(720, 360);
            BackColor = Theme.Bg; ForeColor = Theme.Ink; Font = Theme.Body; KeyPreview = true;
            var lv = new ListView { Dock = DockStyle.Fill, View = View.Details, FullRowSelect = true, HeaderStyle = ColumnHeaderStyle.Nonclickable, ShowItemToolTips = true };
            Theme.DarkList(lv);
            lv.Columns.Add("", 64); lv.Columns.Add("Check", 250); lv.Columns.Add("What it found", 400); lv.Columns.Add("Fix", 250);
            int Rank(Doctor.Item i) => i.Level == "FAIL" ? 0 : i.Level == "WARN" ? 1 : 2;
            foreach (var i in rows.OrderBy(Rank))
            {
                var it = new ListViewItem(new[] { (i.Level == "FAIL" ? "✖ " : i.Level == "WARN" ? "⚠ " : "✓ ") + i.Level, i.Name, i.Detail, i.Level == "OK" ? "" : i.Fix })
                { ForeColor = i.Level == "FAIL" ? Theme.Bad : i.Level == "WARN" ? Theme.Amber : Theme.Steel, ToolTipText = i.Detail + (i.Fix.Length > 0 && i.Level != "OK" ? "\n\nFix: " + i.Fix : "") };
                lv.Items.Add(it);
            }
            int bad = rows.Count(i => i.Level == "FAIL"), warn = rows.Count(i => i.Level == "WARN");
            var head = new Label { Dock = DockStyle.Top, Height = 40, Padding = new Padding(14, 12, 0, 0), Font = Theme.Heading,
                Text = bad > 0 ? $"{bad} FAIL · {warn} WARN · {rows.Count - bad - warn} OK" : warn > 0 ? $"ALL PASS · {warn} WARN" : $"ALL {rows.Count} CHECKS PASS",
                ForeColor = bad > 0 ? Theme.Bad : warn > 0 ? Theme.Amber : Theme.Teal };
            var foot = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 48, Padding = new Padding(10, 8, 10, 0), FlowDirection = FlowDirection.RightToLeft, BackColor = Theme.Bg };
            var close = new Button(); Theme.Button(close, "CLOSE  (Esc)", primary: true); close.Width = 120; close.Click += (s, e) => Close();
            var copy = new Button(); Theme.Button(copy, "COPY REPORT"); copy.Width = 120;
            copy.Click += (s, e) => { Clipboard.SetText(string.Join(Environment.NewLine, rows.Select(r => r.ToString()))); copy.Text = "COPIED ✓"; };
            foot.Controls.Add(close); foot.Controls.Add(copy);
            Controls.Add(lv); Controls.Add(foot); Controls.Add(head);
            CancelButton = close;
            lv.Resize += (s, e) => lv.Columns[2].Width = Math.Max(200, lv.ClientSize.Width - 64 - 250 - lv.Columns[3].Width - 4);
        }
    }
}
