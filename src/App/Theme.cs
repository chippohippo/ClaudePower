using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace AimForge.App
{
    /// <summary>
    /// The look (2026-09-27): a tactical-shooter client style - deep navy, one hot red accent, sharp edges, condensed
    /// uppercase headings, big numbers. Every control keeps its WinForms type, so the logic around it is unchanged.
    /// </summary>
    static class Theme
    {
        public static readonly Color Bg = Color.FromArgb(15, 25, 35), Card = Color.FromArgb(24, 35, 46), Well = Color.FromArgb(17, 27, 37),
            Line = Color.FromArgb(44, 58, 72), Ink = Color.FromArgb(236, 232, 225), Steel = Color.FromArgb(139, 151, 160),
            Red = Color.FromArgb(255, 70, 85), RedDim = Color.FromArgb(120, 38, 48), Teal = Color.FromArgb(58, 214, 190),
            Amber = Color.FromArgb(240, 184, 80), Bad = Color.FromArgb(255, 110, 110);

        static Font F(string family, float size, FontStyle st = FontStyle.Regular)
        {
            var f = new Font(family, size, st, GraphicsUnit.Point);
            return f.Name == family ? f : new Font("Segoe UI Semibold", size, st, GraphicsUnit.Point);
        }
        public static readonly Font Display = F("Bahnschrift SemiBold", 22f), Heading = F("Bahnschrift SemiBold", 10.5f),
            Caps = F("Bahnschrift SemiBold", 8.5f), Big = F("Bahnschrift SemiBold", 17f), Num = F("Bahnschrift", 11f),
            Nav = F("Bahnschrift SemiBold", 11f), Body = new Font("Segoe UI", 9.5f), BodyB = new Font("Segoe UI Semibold", 9.5f),
            Small = new Font("Segoe UI", 8.5f), Mono = new Font("Cascadia Mono", 8.75f);

        [System.Runtime.InteropServices.DllImport("uxtheme.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
        static extern int SetWindowTheme(IntPtr hWnd, string pszSubAppName, string? pszSubIdList);
        [System.Runtime.InteropServices.DllImport("dwmapi.dll")]
        static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        /// Dark scrollbars on a list/text control (Windows 10 1809+; a no-op elsewhere).
        public static void DarkScroll(Control c)
        {
            void Go() { try { SetWindowTheme(c.Handle, "DarkMode_Explorer", null); } catch { } }
            if (c.IsHandleCreated) Go(); else c.HandleCreated += (s, e) => Go();
        }
        /// A dark title bar (Windows 10 20H1+ / 11; a no-op elsewhere).
        public static void DarkTitle(Form f)
        {
            void Go() { try { int on = 1; if (DwmSetWindowAttribute(f.Handle, 20, ref on, 4) != 0) DwmSetWindowAttribute(f.Handle, 19, ref on, 4); } catch { } }
            if (f.IsHandleCreated) Go(); else f.HandleCreated += (s, e) => Go();
        }

        public static void DoubleBuffer(Control c)
            => typeof(Control).GetProperty("DoubleBuffered", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!.SetValue(c, true);

        /// A flat button. Primary = solid red; ghost = outlined; chip = small, dim.
        public static void Button(Button b, string text, bool primary = false, bool chip = false)
        {
            b.Text = text; b.FlatStyle = FlatStyle.Flat; b.Cursor = Cursors.Hand; b.UseVisualStyleBackColor = false;
            b.FlatAppearance.BorderSize = primary ? 0 : 1;
            b.FlatAppearance.BorderColor = chip ? Line : Color.FromArgb(70, 86, 102);
            b.BackColor = primary ? Red : chip ? Well : Card;
            b.ForeColor = primary ? Color.White : Ink;
            b.FlatAppearance.MouseOverBackColor = primary ? Color.FromArgb(255, 96, 108) : Color.FromArgb(38, 52, 66);
            b.FlatAppearance.MouseDownBackColor = primary ? Color.FromArgb(220, 55, 70) : Color.FromArgb(48, 64, 80);
            b.Font = primary ? Heading : chip ? Caps : Caps;
            b.Height = chip ? 26 : 32; b.Margin = new Padding(0, 0, 6, 6);
            b.EnabledChanged += (s, e) => { b.BackColor = !b.Enabled ? (primary ? RedDim : Well) : primary ? Red : chip ? Well : Card; b.ForeColor = b.Enabled ? (primary ? Color.White : Ink) : Steel; };
        }

        /// A number field: a flat dark well, no white spinner (the wheel and the arrow keys still step it).
        public static void NumBox(NumericUpDown n)
        {
            n.BackColor = Well; n.ForeColor = Ink; n.BorderStyle = BorderStyle.None; n.Font = Num; n.TextAlign = HorizontalAlignment.Left;
            if (n.Controls.Count > 0) n.Controls[0].Visible = false;
        }

        /// A ListView with dark column headers (the system draws them white).
        public static void DarkList(ListView lv)
        {
            lv.OwnerDraw = true; lv.BorderStyle = BorderStyle.None; lv.BackColor = Card; lv.ForeColor = Ink; lv.Font = Small;
            lv.DrawColumnHeader += (s, e) =>
            {
                using (var bg = new SolidBrush(Well)) e.Graphics.FillRectangle(bg, e.Bounds);
                using (var ln = new Pen(Line)) e.Graphics.DrawLine(ln, e.Bounds.Left, e.Bounds.Bottom - 1, e.Bounds.Right, e.Bounds.Bottom - 1);
                TextRenderer.DrawText(e.Graphics, (e.Header?.Text ?? "").ToUpperInvariant(), Caps, new Rectangle(e.Bounds.X + 6, e.Bounds.Y, e.Bounds.Width - 6, e.Bounds.Height), Steel,
                                      TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
            };
            // the last column fills the width, so no system-drawn (white) header strip is left over
            void FitLast()
            {
                if (lv.Columns.Count == 0) return;
                int used = 0; for (int i = 0; i < lv.Columns.Count - 1; i++) used += lv.Columns[i].Width;
                int w = lv.ClientSize.Width - used; if (w > 80 && lv.Columns[^1].Width != w) lv.Columns[^1].Width = w;
            }
            lv.Resize += (s, e) => FitLast(); lv.HandleCreated += (s, e) => FitLast(); lv.Layout += (s, e) => FitLast();
            lv.DrawItem += (s, e) => e.DrawDefault = true;
            lv.DrawSubItem += (s, e) => e.DrawDefault = true;
            DarkScroll(lv);
        }

        public static Label Caption(string text, int width = 0) => new Label
        {
            Text = text.ToUpperInvariant(), Font = Caps, ForeColor = Steel, AutoSize = width == 0, Width = width, Height = 18,
            Margin = new Padding(0, 0, 0, 2), BackColor = Color.Transparent
        };

        /// A section title: red tick + condensed caps.
        public static Control SectionTitle(string text, int width)
        {
            var p = new Panel { Width = width, Height = 26, Margin = new Padding(0, 8, 0, 4), BackColor = Color.Transparent };
            p.Paint += (s, e) =>
            {
                using var red = new SolidBrush(Red); e.Graphics.FillRectangle(red, 0, 6, 3, 13);
                TextRenderer.DrawText(e.Graphics, text.ToUpperInvariant(), Heading, new Point(10, 3), Ink, TextFormatFlags.NoPrefix);
                using var ln = new Pen(Line); int x = 16 + TextRenderer.MeasureText(text.ToUpperInvariant(), Heading, Size.Empty, TextFormatFlags.NoPrefix).Width;
                if (x < p.Width) e.Graphics.DrawLine(ln, x, 13, p.Width, 13);
            };
            return p;
        }
    }

    /// <summary>A CheckBox drawn as an on/off switch with a title and a dim one-line hint. Same API as CheckBox.</summary>
    sealed class Switch : CheckBox
    {
        public string Hint { get; set; } = "";
        public Switch()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            Cursor = Cursors.Hand; Height = 40; AutoSize = false; BackColor = Theme.Card; ForeColor = Theme.Ink; Font = Theme.BodyB;
        }
        protected override void OnCheckedChanged(EventArgs e) { base.OnCheckedChanged(e); Invalidate(); }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; g.Clear(Parent?.BackColor ?? Theme.Card); g.SmoothingMode = SmoothingMode.AntiAlias;
            int h = 18, w = 34, y = string.IsNullOrEmpty(Hint) ? (Height - h) / 2 : 3;
            var track = new Rectangle(0, y, w, h);
            using (var path = Round(track, h / 2))
            using (var br = new SolidBrush(Checked ? Theme.Red : Theme.Line)) g.FillPath(br, path);
            int kx = Checked ? track.Right - h + 3 : track.X + 3;
            using (var knob = new SolidBrush(Enabled ? Color.White : Theme.Steel)) g.FillEllipse(knob, kx, y + 3, h - 6, h - 6);
            TextRenderer.DrawText(g, Text, Font, new Rectangle(w + 10, y - 1, Width - w - 10, 20), Enabled ? Theme.Ink : Theme.Steel, TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
            if (!string.IsNullOrEmpty(Hint))
                TextRenderer.DrawText(g, Hint, Theme.Small, new Rectangle(w + 10, y + 18, Width - w - 10, 18), Theme.Steel, TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
            if (Focused) { using var fp = new Pen(Theme.Red) { DashStyle = DashStyle.Dot }; g.DrawRectangle(fp, 0, 0, Width - 1, Height - 1); }
        }
        static GraphicsPath Round(Rectangle r, int rad)
        {
            var p = new GraphicsPath(); int d = rad * 2;
            p.AddArc(r.X, r.Y, d, d, 90, 180); p.AddArc(r.Right - d, r.Y, d, d, 270, 180); p.CloseFigure(); return p;
        }
    }

    /// <summary>A row of section tabs (caps text, red underline on the active one). Shows one page at a time.</summary>
    sealed class SegTabs : Panel
    {
        readonly List<(string name, Control page)> pages = new();
        int active;
        public event Action<int>? Changed;
        public bool Big { get; set; }
        public SegTabs() { Height = 34; BackColor = Theme.Bg; Theme.DoubleBuffer(this); Cursor = Cursors.Hand; }
        public void Add(string name, Control page) { pages.Add((name.ToUpperInvariant(), page)); page.Visible = pages.Count == 1; Invalidate(); }
        public int Active => active;
        public void Show(int i)
        {
            if (i < 0 || i >= pages.Count) return;
            active = i;
            for (int k = 0; k < pages.Count; k++) pages[k].page.Visible = k == i;
            Invalidate(); Changed?.Invoke(i);
        }
        List<Rectangle> Slots(Graphics g)
        {
            var o = new List<Rectangle>(); int x = 0; var f = Big ? Theme.Nav : Theme.Caps;
            foreach (var (n, _) in pages) { int w = TextRenderer.MeasureText(g, n, f).Width + (Big ? 30 : 20); o.Add(new Rectangle(x, 0, w, Height)); x += w; }
            return o;
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; g.Clear(BackColor); var f = Big ? Theme.Nav : Theme.Caps; var slots = Slots(g);
            if (!Big) { using var ln = new Pen(Theme.Line); g.DrawLine(ln, 0, Height - 1, Width, Height - 1); }
            for (int i = 0; i < pages.Count; i++)
            {
                var r = slots[i];
                TextRenderer.DrawText(g, pages[i].name, f, r, i == active ? Theme.Ink : Theme.Steel, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
                if (i == active) { using var red = new SolidBrush(Theme.Red); g.FillRectangle(red, r.X + 8, Height - 3, r.Width - 16, 3); }
            }
        }
        protected override void OnMouseClick(MouseEventArgs e)
        {
            base.OnMouseClick(e);
            using var g = CreateGraphics(); var slots = Slots(g);
            for (int i = 0; i < slots.Count; i++) if (slots[i].Contains(e.Location)) { Show(i); return; }
        }
    }

    /// <summary>A stat tile: a big number over a caps caption.</summary>
    sealed class Tile : Panel
    {
        public string Value { get; set; } = "-"; public string Caption { get; set; } = ""; public string Unit { get; set; } = "";
        public Color Tint { get; set; } = Theme.Ink;
        public Tile() { BackColor = Theme.Card; Theme.DoubleBuffer(this); Margin = new Padding(0, 0, 8, 0); }
        public void Set(string v, string unit = "", Color? tint = null) { Value = v; Unit = unit; Tint = tint ?? Theme.Ink; Invalidate(); }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; g.Clear(BackColor);
            using (var red = new SolidBrush(Theme.Red)) g.FillRectangle(red, 0, 0, 2, Height);
            TextRenderer.DrawText(g, Caption.ToUpperInvariant(), Theme.Caps, new Point(12, 8), Theme.Steel, TextFormatFlags.NoPrefix);
            using var vb = new SolidBrush(Tint); using var ub = new SolidBrush(Theme.Steel);
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
            float y = Math.Max(24f, Height - 50f);
            g.DrawString(Value, Theme.Big, vb, 8f, y);
            if (Unit.Length > 0) { var w = g.MeasureString(Value, Theme.Big).Width; g.DrawString(Unit.ToUpperInvariant(), Theme.Caps, ub, 8f + w - 2f, y + 14f); }
        }
    }
}
