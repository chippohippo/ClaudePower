using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;
using AimForge.Core;

namespace AimForge.App
{
    public sealed class MainForm : Form
    {
        readonly Catalogue cat; readonly RawAccelBridge ra; readonly OtdBridge otd; readonly string tunerHtml;
        Preset? cur; Rig rig = new Rig(); Measured? measured;

        // palette: the Theme (a tactical-shooter client look, 2026-09-27) under the old names the drawing code uses
        static readonly Color Bg = Theme.Bg, Panel = Theme.Card, Line = Theme.Line, Ink = Theme.Ink, Steel = Theme.Steel, Accent = Theme.Red,
            Good = Theme.Teal, Warn = Theme.Amber, Bad = Theme.Bad;
        static readonly Font Mono = Theme.Mono, MonoB = new Font("Cascadia Mono", 8.75f, FontStyle.Bold), Ui = Theme.Body, UiB = Theme.BodyB, Title = Theme.Display;

        ListBox list = new ListBox(); Panel curve = new Panel(); TextBox log = new TextBox(); ListBox qc = new ListBox();
        RichTextBox desc = new RichTextBox();   // the build's own write-up (About tab)
        Label summary = new Label(), sens = new Label(), live = new Label(), measuredLbl = new Label();
        NumericUpDown nPx = new NumericUpDown(), nCm = new NumericUpDown(), nSnap = new NumericUpDown(), nYx = new NumericUpDown(), nHdl = new NumericUpDown(), nReset = new NumericUpDown();
        Button bApply = new Button(), bDry = new Button(), bDoctor = new Button(), bTuner = new Button(), bCopy = new Button(), bMeasure = new Button(), bReset = new Button();
        NotifyIcon tray = new NotifyIcon(); bool suppress;
        Label hud = new Label(); Timer hudTimer = new Timer(); Point lastCursor;
        Button bRedetect = new Button(), bCompare = new Button(), bExport = new Button(), bImport = new Button();
        // advanced tab
        TextBox aLut = new TextBox(); Label aVerdict = new Label();
        NumericUpDown aAccel = new NumericUpDown(), aCap = new NumericUpDown(), aOffset = new NumericUpDown(),
            aMult = new NumericUpDown(), aRot = new NumericUpDown(), aTip = new NumericUpDown();
        CheckBox aClassic = new Switch(), aCohOn = new Switch(), aTipSet = new Switch();
        NumericUpDown aHold = new NumericUpDown(), aTap = new NumericUpDown(), aTapArm = new NumericUpDown(),
            aTapHold = new NumericUpDown(), aTapBreak = new NumericUpDown(), aLead = new NumericUpDown();
        // filters panel (Builds tab)
        CheckBox fHdl = new Switch(), fTap = new Switch(), fCoh = new Switch(), fContact = new Switch(), fCadence = new Switch();
        static string EnginePath => System.IO.Path.Combine(AppContext.BaseDirectory, "engine.txt");
        NumericUpDown fHdlMin = new NumericUpDown(), fCadHz = new NumericUpDown(), fCadMerge = new NumericUpDown();
        CheckBox fTwin = new Switch();
        /// True while the window is being built: the state files (engine/xp/mouse) are loaded, never rewritten, until the
        /// user changes something (2026-09-24 review: construction rewrote them, which polluted the dev tree's out\).
        bool constructing = true;
        CheckBox fIntent = new Switch(), fCarry = new Switch(); NumericUpDown fCarryMs = new NumericUpDown(); Experiments.State xpState = Experiments.State.Load();
        CheckBox fMouse = new Switch();
        CheckBox fTps = new Switch(); NumericUpDown fTpsCam = new NumericUpDown(), fTpsFight = new NumericUpDown(); Label tpsRead = new Label();
        Panel tpsDiagram = new Panel(); bool tpsPushing;
        /// every number in the window explains itself on hover (2026-10-11)
        readonly ToolTip tip = new ToolTip { AutoPopDelay = 20000, InitialDelay = 350, ReshowDelay = 100 };
        ThirdPerson.State tpsState = ThirdPerson.State.Load(); NumericUpDown fMouseDpi = new NumericUpDown(), fMouseHl = new NumericUpDown(), fMouseYx = new NumericUpDown();
        Label mouseRead = new Label(); MouseMirror.State mouseState = MouseMirror.State.Load();
        bool applying, redetecting; System.Text.Json.Nodes.JsonObject? raRootCache; DateTime raRootStamp;
        Panel aPreview = new Panel();
        NumericUpDown fTapArm = new NumericUpDown(), fTapHold = new NumericUpDown(), fTapBreak = new NumericUpDown(), fHold = new NumericUpDown();
        Label fGoal = new Label();
        FilterPlan plan = new FilterPlan();
        Preset? custom;                       // the working build the advanced tab edits (null = incomplete)
        Preset? advBase;                      // the card 'load selected preset' put on the Advanced tab
        /// What an apply actually WROTE: the folded build, the rig and the toggles - Ctrl+Tab and compare replay this,
        /// never the catalogue card of the same id (2026-09-16 review).
        sealed record Applied(Preset P, Rig Rg, FilterPlan.Toggles T);
        Applied? lastApplied, prevApplied;    // Ctrl+Tab A/B

        public MainForm(Catalogue c, RawAccelBridge r, OtdBridge o, string tuner)
        {
            cat = c; ra = r; otd = o; tunerHtml = tuner;
            Text = "AimForge"; BackColor = Bg; ForeColor = Ink; Font = Ui;
            ClientSize = new Size(1480, 920); MinimumSize = new Size(1260, 820); StartPosition = FormStartPosition.CenterScreen;
            DoubleBuffered = true;
            Build();
            FillList();
            // start on the card that is LIVE (2026-09-24 review: the window opened on BO6 Original and a quick Ctrl+Enter
            // overwrote the live build)
            var la0 = LastApply.Load();
            var liveCard = cat.Find(la0?.CardId ?? "") ?? cat.Find((la0?.CardId ?? "").Split('~')[0]) ?? cat.Find(mouseState.LastCardId);
            Select(liveCard ?? cat.presets.FirstOrDefault(p => p.id == "bo6og") ?? cat.presets[0]);
            // ...with the rig values that were live, not the card's authored ones (2026-09-24 review: a dialled hover max or
            // px/mm was overwritten by an untouched Ctrl+Enter)
            if (la0 != null && liveCard != null && la0.CardId == liveCard.id && la0.AppliedRig() is Rig lr)
            {
                rig.PxMm = lr.PxMm; rig.Cm360 = lr.Cm360; rig.SnapDeg = lr.SnapDeg; rig.Yx = lr.Yx; rig.HdlMax = lr.HdlMax; rig.ResetMs = lr.ResetMs;
                rig.HdlMin = lr.HdlMin; rig.HdlEnabled = lr.HdlEnabled; rig.Mult = lr.Mult; rig.TpsGain = lr.TpsGain; rig.RotationDeg = lr.RotationDeg; rig.TipThresholdPct = lr.TipThresholdPct;
                ThirdPerson.Strip(rig);   // the window holds the card's multiplier; the match is folded in at apply
                PushRig();
                // ...and the Builds-tab stabilizer toggles as applied (the record holds the folded overlay; no overlay = both off)
                FilterPlan.Toggles? tgL = null;
                if (la0.Card is Preset ac)
                {
                    var pl = FilterPlan.For(ac);
                    tgL = ac.cohOv == null ? new FilterPlan.Toggles(false, false, pl.HoldMs, pl.TapArm, pl.TapHold, pl.TapBreak) : FilterPlan.Prefill(ac);
                }
                suppress = true;
                try
                {
                    fHdl.Checked = lr.HdlEnabled; SetNum(fHdlMin, lr.HdlMin);
                    if (tgL is FilterPlan.Toggles tg)
                    {
                        fTap.Checked = tg.Tap; fCoh.Checked = tg.Hold;
                        SetNum(fTapArm, tg.TapArm); SetNum(fTapHold, tg.TapHold); SetNum(fTapBreak, tg.TapBreak); SetNum(fHold, tg.HoldMs);
                    }
                }
                finally { suppress = false; }
                if (tgL is FilterPlan.Toggles tge) { prefillExact = tge; prefillShown = CurrentToggles(); }
                Recalc();
            }
            else if (la0 != null && liveCard != null && la0.CardId != liveCard.id)
                Log($"note: the live build is '{la0.CardName}' (an Advanced/imported build) - the window shows its base card {liveCard.name}; applying replaces the live build");
            constructing = false;
            RefreshLive();
        }

        // ---- the redesigned window (2026-09-27): top bar + pages; Builds = rail | center | settings, console at the bottom ----
        readonly SegTabs nav = new SegTabs { Big = true, Height = 58 }, setTabs = new SegTabs();
        readonly Dictionary<Control, List<Action>> shownHandlers = new();
        void OnShown(Control page, Action a) { if (!shownHandlers.TryGetValue(page, out var l)) shownHandlers[page] = l = new List<Action>(); l.Add(a); }
        Label heroGroup = new Label(), heroName = new Label(), heroMeta = new Label(), applyBanner = new Label();
        /// The result of the last apply, big and coloured under the build name (2026-09-27: refusals only reached the console).
        void Banner(string text, Color c)
        {
            if (InvokeRequired) { BeginInvoke(new Action(() => Banner(text, c))); return; }
            applyBanner.Text = text; applyBanner.ForeColor = c;
        }
        readonly Tile t180 = new Tile { Caption = "180° turn" }, tEdpi = new Tile { Caption = "eDPI" }, tCap = new Tile { Caption = "Cap gain" },
            tTap = new Tile { Caption = "Tap gain" }, tTrack = new Tile { Caption = "Track gain" }, tFloor = new Tile { Caption = "Micro floor" };
        readonly Panel sensPanel = new Panel(), statusBar = new Panel(), consoleBox = new Panel();
        List<(string game, string val)> sensRows = new();
        List<(string text, Color color)> statusChips = new();
        readonly TextBox search = new TextBox();
        bool consoleOpen;
        sealed class Entry { public string? Group; public Preset? P; public override string ToString() => Group ?? P!.name; }
        readonly List<Entry> entries = new();
        const int SideW = 356;   // usable width inside the settings column

        void Build()
        {
            // ---------- top bar ----------
            var top = new Panel { Dock = DockStyle.Top, Height = 58, BackColor = Theme.Well };
            top.Paint += (s, e) =>
            {
                using var ln = new Pen(Theme.Line); e.Graphics.DrawLine(ln, 0, top.Height - 1, top.Width, top.Height - 1);
                using var red = new SolidBrush(Theme.Red); e.Graphics.FillRectangle(red, 0, 0, 4, top.Height);
            };
            var brand = new Panel { Dock = DockStyle.Left, Width = 250, BackColor = Theme.Well };
            brand.Paint += (s, e) =>
            {
                TextRenderer.DrawText(e.Graphics, "AIMFORGE", Theme.Display, new Point(18, 9), Ink);
                int w = TextRenderer.MeasureText("AIMFORGE", Theme.Display).Width;
                TextRenderer.DrawText(e.Graphics, "PEN AIM", Theme.Caps, new Point(18 + w, 15), Theme.Red);
                TextRenderer.DrawText(e.Graphics, "CONTROL", Theme.Caps, new Point(18 + w, 29), Steel);
            };
            nav.Dock = DockStyle.Left; nav.Width = 420; nav.BackColor = Theme.Well;
            statusBar.Dock = DockStyle.Right; statusBar.Width = 620; statusBar.BackColor = Theme.Well; Theme.DoubleBuffer(statusBar);
            statusBar.Paint += (s, e) =>
            {
                int x = statusBar.Width - 18;
                for (int i = statusChips.Count - 1; i >= 0; i--)
                {
                    var (t, c) = statusChips[i]; var sz = TextRenderer.MeasureText(t, Theme.Caps);
                    x -= sz.Width + 26;
                    var r = new Rectangle(x, 17, sz.Width + 22, 24);
                    using (var bg = new SolidBrush(Theme.Card)) e.Graphics.FillRectangle(bg, r);
                    using (var dot = new SolidBrush(c)) { e.Graphics.SmoothingMode = SmoothingMode.AntiAlias; e.Graphics.FillEllipse(dot, r.X + 8, r.Y + 9, 7, 7); }
                    TextRenderer.DrawText(e.Graphics, t, Theme.Caps, new Point(r.X + 18, r.Y + 5), Ink);
                    x -= 6;
                }
            };
            top.Controls.Add(statusBar); top.Controls.Add(nav); top.Controls.Add(brand);

            // ---------- pages ----------
            var host = new Panel { Dock = DockStyle.Fill, BackColor = Bg };
            var pageBuilds = new Panel { Dock = DockStyle.Fill, BackColor = Bg };
            var pageAdv = new Panel { Dock = DockStyle.Fill, BackColor = Bg };
            var pageFilters = new Panel { Dock = DockStyle.Fill, BackColor = Bg };
            host.Controls.Add(pageFilters); host.Controls.Add(pageAdv); host.Controls.Add(pageBuilds);
            nav.Add("Builds", pageBuilds); nav.Add("Advanced", pageAdv); nav.Add("Filters", pageFilters);
            nav.Changed += i => { var pg = i == 0 ? pageBuilds : i == 1 ? pageAdv : pageFilters; if (shownHandlers.TryGetValue(pg, out var hs)) foreach (var h in hs) h(); };
            Controls.Add(host); Controls.Add(top);
            BuildFiltersTab(pageFilters);
            BuildAdvanced(pageAdv);

            // ---------- Builds: console (bottom) ----------
            consoleBox.Dock = DockStyle.Bottom; consoleBox.Height = 176; consoleBox.BackColor = Theme.Well; consoleBox.Padding = new Padding(16, 0, 16, 10);
            consoleBox.Paint += (s, e) => { using var ln = new Pen(Theme.Line); e.Graphics.DrawLine(ln, 0, 0, consoleBox.Width, 0); };
            var acts = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 46, BackColor = Theme.Well, Padding = new Padding(0, 9, 0, 0), WrapContents = false };
            Theme.Button(bRedetect, "REDETECT  CTRL+D"); bRedetect.Width = 146; bRedetect.Click += async (s, e) => await DoRedetect();
            Theme.Button(bMeasure, "MEASURE CURVE"); bMeasure.Width = 128; bMeasure.Click += async (s, e) => await DoMeasure();
            Theme.Button(bCompare, "COMPARE A/B"); bCompare.Width = 112; bCompare.Click += async (s, e) => await DoCompare();
            Theme.Button(bCopy, "COPY CURVE"); bCopy.Width = 104; bCopy.Click += (s, e) =>
            {
                if (cur == null) return;
                string txt = cur.IsLut ? Curve.RawAccelPoints(cur.lut!, rig.PxMm)
                    : $"classic accel {cur.adv.accel} cap {cur.adv.cap} offset {cur.adv.offset}  (LUT sample of the driver formula, 3 dp: {Curve.RawAccelPointsDistinct(Curve.EffectiveLut(cur, rig.PxMm), rig.PxMm)})";
                Clipboard.SetText(txt); Log("copied " + txt);
            };
            Theme.Button(bExport, "EXPORT"); bExport.Width = 80; bExport.Click += (s, e) => DoExportBuild();
            Theme.Button(bImport, "IMPORT"); bImport.Width = 80; bImport.Click += (s, e) => DoImportBuild();
            Theme.Button(bDoctor, "DOCTOR"); bDoctor.Width = 84; bDoctor.Click += (s, e) => { SetConsole(true); foreach (var i in Doctor.Run(ra, otd, cat)) Log(i.ToString()); };
            Theme.Button(bTuner, "FULL TUNER"); bTuner.Width = 104; bTuner.Click += (s, e) => OpenTuner();
            var bConsole = new Button(); Theme.Button(bConsole, "CONSOLE  ▲"); bConsole.Width = 112;
            bConsole.Click += (s, e) => { SetConsole(!consoleOpen); bConsole.Text = consoleOpen ? "CONSOLE  ▼" : "CONSOLE  ▲"; };
            foreach (var b in new[] { bRedetect, bMeasure, bCompare, bCopy, bExport, bImport, bDoctor, bTuner, bConsole }) acts.Controls.Add(b);
            live.Dock = DockStyle.Top; live.Font = Mono; live.ForeColor = Steel; live.Height = 32; live.BackColor = Theme.Well;
            hud.Dock = DockStyle.Top; hud.Font = Mono; hud.ForeColor = Theme.Teal; hud.Height = 18; hud.BackColor = Theme.Well;
            log.Dock = DockStyle.Fill; log.Multiline = true; log.ReadOnly = true; log.ScrollBars = ScrollBars.Vertical; log.BackColor = Theme.Bg; log.ForeColor = Ink; log.BorderStyle = BorderStyle.None; log.Font = Mono;
            consoleBox.Controls.Add(log); consoleBox.Controls.Add(hud); consoleBox.Controls.Add(live); consoleBox.Controls.Add(acts);

            // ---------- Builds: three columns ----------
            var body = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 1, BackColor = Bg, Padding = new Padding(16, 14, 16, 12) };
            body.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 268)); body.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); body.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, SideW + 32));
            pageBuilds.Controls.Add(body); pageBuilds.Controls.Add(consoleBox);

            // rail: search + build list
            var rail = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Card, Margin = new Padding(0, 0, 14, 0), Padding = new Padding(0, 0, 0, 6) };
            var searchWrap = new Panel { Dock = DockStyle.Top, Height = 48, BackColor = Theme.Card, Padding = new Padding(12, 8, 12, 8) };
            var searchWell = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Well, Padding = new Padding(10, 7, 8, 4) };
            search.Dock = DockStyle.Fill; search.BackColor = Theme.Well; search.ForeColor = Ink; search.BorderStyle = BorderStyle.None; search.Font = Theme.Body;
            search.PlaceholderText = "Search builds…";
            search.TextChanged += (s, e) => { FillList(); if (cur != null) MarkSelected(cur); };
            searchWell.Controls.Add(search); searchWrap.Controls.Add(searchWell);
            list.Dock = DockStyle.Fill; list.BackColor = Theme.Card; list.ForeColor = Ink; list.BorderStyle = BorderStyle.None; list.IntegralHeight = false;
            list.DrawMode = DrawMode.OwnerDrawVariable; list.Font = Theme.Body;
            list.MeasureItem += (s, e) => { if (e.Index >= 0 && e.Index < list.Items.Count) e.ItemHeight = list.Items[e.Index] is Entry { Group: not null } ? (e.Index == 0 ? 26 : 34) : 30; };
            list.DrawItem += DrawEntry;
            list.SelectedIndexChanged += (s, e) =>
            {
                if (suppress) return;
                if (list.SelectedItem is Entry { P: Preset p }) { if (!ReferenceEquals(p, cur)) Select(p); }
                else if (cur != null) MarkSelected(cur);   // a group header is not selectable
            };
            var railTitle = Theme.SectionTitle("Builds", 240); railTitle.Dock = DockStyle.Top; railTitle.Margin = new Padding(0); railTitle.Height = 30;
            railTitle.Padding = new Padding(12, 0, 0, 0);
            var railHead = new Panel { Dock = DockStyle.Top, Height = 36, BackColor = Theme.Card, Padding = new Padding(12, 10, 0, 0) };
            railHead.Controls.Add(railTitle);
            rail.Controls.Add(list); rail.Controls.Add(searchWrap); rail.Controls.Add(railHead);
            body.Controls.Add(rail, 0, 0);

            // center: hero, tiles, curve, sensitivity + checks
            var center = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4, BackColor = Bg, Margin = new Padding(0, 0, 14, 0) };
            center.RowStyles.Add(new RowStyle(SizeType.Absolute, 124)); center.RowStyles.Add(new RowStyle(SizeType.Absolute, 96));
            center.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); center.RowStyles.Add(new RowStyle(SizeType.Absolute, 200));
            body.Controls.Add(center, 1, 0);

            var hero = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Card, Margin = new Padding(0, 0, 0, 10) };
            hero.Paint += (s, e) => { using var red = new SolidBrush(Theme.Red); e.Graphics.FillRectangle(red, 0, 0, 4, hero.Height); };
            heroGroup.Font = Theme.Caps; heroGroup.ForeColor = Theme.Red; heroGroup.AutoSize = true; heroGroup.Location = new Point(20, 12); heroGroup.BackColor = Color.Transparent;
            heroName.Font = Theme.Display; heroName.ForeColor = Ink; heroName.AutoSize = true; heroName.Location = new Point(16, 28); heroName.BackColor = Color.Transparent;
            heroMeta.Font = Theme.Small; heroMeta.ForeColor = Steel; heroMeta.AutoSize = true; heroMeta.Location = new Point(20, 68); heroMeta.BackColor = Color.Transparent;
            var heroBtns = new FlowLayoutPanel { Dock = DockStyle.Right, Width = 330, FlowDirection = FlowDirection.RightToLeft, WrapContents = false, BackColor = Theme.Card, Padding = new Padding(0, 28, 16, 0) };
            Theme.Button(bApply, "APPLY TO DRIVERS", primary: true); bApply.Width = 190; bApply.Height = 44; bApply.Margin = new Padding(8, 0, 0, 0);
            bApply.Click += async (s, e) => await DoApply(false);
            Theme.Button(bDry, "DRY RUN"); bDry.Width = 96; bDry.Height = 44; bDry.Margin = new Padding(0);
            bDry.Click += async (s, e) => await DoApply(true);
            heroBtns.Controls.Add(bApply); heroBtns.Controls.Add(bDry);
            applyBanner.Font = Theme.Caps; applyBanner.AutoSize = false; applyBanner.Location = new Point(20, 88); applyBanner.Size = new Size(900, 20); applyBanner.BackColor = Color.Transparent;
            applyBanner.ForeColor = Steel; applyBanner.Text = "NOT APPLIED YET THIS SESSION";
            hero.Controls.Add(heroBtns); hero.Controls.Add(applyBanner); hero.Controls.Add(heroMeta); hero.Controls.Add(heroName); hero.Controls.Add(heroGroup);
            center.Controls.Add(hero, 0, 0);

            var tiles = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 6, RowCount = 1, BackColor = Bg, Margin = new Padding(0, 0, 0, 10) };
            var tileSet = new[] { t180, tEdpi, tFloor, tTap, tTrack, tCap };
            for (int i = 0; i < tileSet.Length; i++)
            {
                tiles.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f / tileSet.Length));
                tileSet[i].Dock = DockStyle.Fill; tileSet[i].Margin = new Padding(0, 0, i == tileSet.Length - 1 ? 0 : 8, 0);
                tiles.Controls.Add(tileSet[i], i, 0);
            }
            center.Controls.Add(tiles, 0, 1);

            curve.Dock = DockStyle.Fill; curve.BackColor = Theme.Card; curve.Margin = new Padding(0, 0, 0, 10); curve.Paint += PaintCurve; curve.Resize += (s, e) => curve.Invalidate();
            Theme.DoubleBuffer(curve);
            center.Controls.Add(curve, 0, 2);

            var lower = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, BackColor = Bg, Margin = new Padding(0) };
            lower.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50)); lower.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
            var sensCard = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Card, Margin = new Padding(0, 0, 10, 0), Padding = new Padding(14, 8, 14, 8) };
            var sensTitle = Theme.SectionTitle("In-game sensitivity", 300); sensTitle.Dock = DockStyle.Top; sensTitle.Margin = new Padding(0);
            sensPanel.Dock = DockStyle.Fill; sensPanel.BackColor = Theme.Card; Theme.DoubleBuffer(sensPanel);
            sensPanel.Paint += (s, e) =>
            {
                int colW = sensPanel.Width / 2, rowH = 26;
                for (int i = 0; i < sensRows.Count; i++)
                {
                    int cx = (i % 2) * colW, cy = 6 + (i / 2) * rowH;
                    TextRenderer.DrawText(e.Graphics, sensRows[i].game, Theme.Small, new Rectangle(cx, cy + 2, colW - 64, rowH), Steel, TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
                    TextRenderer.DrawText(e.Graphics, sensRows[i].val, Theme.Num, new Rectangle(cx + colW - 68, cy, 56, rowH), Ink, TextFormatFlags.Right);
                }
            };
            sensPanel.Resize += (s, e) => sensPanel.Invalidate();
            measuredLbl.Dock = DockStyle.Bottom; measuredLbl.Height = 20; measuredLbl.Font = Theme.Small; measuredLbl.ForeColor = Theme.Teal; measuredLbl.BackColor = Theme.Card;
            sensCard.Controls.Add(sensPanel); sensCard.Controls.Add(measuredLbl); sensCard.Controls.Add(sensTitle);
            var checksCard = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Card, Margin = new Padding(0), Padding = new Padding(14, 8, 8, 8) };
            var checksTitle = Theme.SectionTitle("Build checks", 400); checksTitle.Dock = DockStyle.Top; checksTitle.Margin = new Padding(0);
            qc.Dock = DockStyle.Fill; qc.BackColor = Theme.Card; qc.ForeColor = Ink; qc.BorderStyle = BorderStyle.None; qc.Font = Theme.Small; qc.IntegralHeight = false;
            qc.DrawMode = DrawMode.OwnerDrawVariable; qc.MeasureItem += MeasureQc; qc.DrawItem += DrawQc; qc.SelectionMode = SelectionMode.None;
            qc.Resize += (s, e) => { var items = qc.Items.Cast<object>().ToArray(); qc.BeginUpdate(); qc.Items.Clear(); qc.Items.AddRange(items); qc.EndUpdate(); };
            checksCard.Controls.Add(qc); checksCard.Controls.Add(checksTitle);
            lower.Controls.Add(sensCard, 0, 0); lower.Controls.Add(checksCard, 1, 0);
            center.Controls.Add(lower, 0, 3);

            // settings column: section tabs, one page each, sized to fit without scrolling
            var side = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Card, Margin = new Padding(0), Padding = new Padding(16, 6, 12, 8) };
            setTabs.Dock = DockStyle.Top; setTabs.BackColor = Theme.Card;
            var pAbout = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Card, Padding = new Padding(0, 14, 0, 0) };
            desc.Dock = DockStyle.Fill; desc.ReadOnly = true; desc.BorderStyle = BorderStyle.None; desc.BackColor = Theme.Card; desc.ForeColor = Ink; desc.Font = Theme.Body;
            desc.ScrollBars = RichTextBoxScrollBars.Vertical; desc.DetectUrls = false;
            pAbout.Controls.Add(desc);
            var pRig = SidePage(); var pFilt = SidePage(); var pEng = SidePage(); var pMouse = SidePage();
            foreach (var sp in new Control[] { pRig, pFilt, pEng, pMouse }) Theme.DarkScroll(sp);
            BuildRigPage(pRig);
            BuildSettingsPages(pFilt, pEng, pMouse);
            foreach (var pg in new Control[] { pMouse, pEng, pFilt, pRig, pAbout }) side.Controls.Add(pg);
            side.Controls.Add(setTabs);
            setTabs.Add("About", pAbout); setTabs.Add("Rig", pRig); setTabs.Add("Filters", pFilt); setTabs.Add("Engine", pEng); setTabs.Add("Modes", pMouse);
            body.Controls.Add(side, 2, 0);

            foreach (var c in new Control[] { list, qc, desc, log }) Theme.DarkScroll(c);
            Theme.DarkTitle(this);

            // HUD: 10Hz zone/gain estimate from cursor motion mapped through the active curve (screen-side estimate)
            hudTimer.Interval = 100;
            hudTimer.Tick += (s, e) =>
            {
                try
                {
                    var pos = Cursor.Position;
                    double dpx = Math.Sqrt(Math.Pow(pos.X - lastCursor.X, 2) + Math.Pow(pos.Y - lastCursor.Y, 2));
                    lastCursor = pos;
                    double cps = dpx / (hudTimer.Interval / 1000.0);
                    if (cur == null) { hud.Text = ""; return; }
                    var eff = Curve.EffectiveLut(cur, rig.PxMm);
                    double v = cps / rig.PxMm;
                    v = cps / (rig.PxMm * Math.Max(1, Curve.GainAt(eff, v)));
                    string zone = v < cat.tablet.UnitStepMms ? "still" : v < 15 ? "1-unit/micro" : v < 55 ? "tap" : v < 150 ? "track" : "flick";
                    hud.Text = $"HUD (estimate)  pen ~{v,5:F0} mm/s  zone {zone,-12} gain {Curve.GainAt(eff, v):F2}x   tier {FilterCatalog.BuildTier(cur)}  role {RolePolicy.RoleOf(cur)}";
                }
                catch { }
            };
            // Idle contract: the HUD samples only while the window is ACTIVE.
            Activated += (s, e) => hudTimer.Start();
            Deactivate += (s, e) => { hudTimer.Stop(); hud.Text = ""; };

            foreach (var n in new[] { nPx, nCm, nSnap, nYx, nHdl, nReset }) n.ValueChanged += (s, e) => { if (!suppress) { PullRig(); Recalc(); } };

            // tray: minimise to tray, quick apply
            tray.Icon = SystemIcons.Application; tray.Text = "AimForge"; tray.Visible = true;
            var menu = new ContextMenuStrip();
            menu.Items.Add("Show", null, (s, e) => { Show(); WindowState = FormWindowState.Normal; Activate(); });
            menu.Items.Add("Apply current preset", null, async (s, e) => await DoApply(false));
            menu.Items.Add("Redetect tablet (Ctrl+D)", null, async (s, e) => await DoRedetect());
            menu.Items.Add("Restart OTD daemon (loads new plugins)", null, async (s, e) =>
            {
                if (applying || redetecting) { Log("daemon restart: an apply or redetect is in progress - try again when it finishes"); return; }
                redetecting = true;
                try { await Task.Run(() => otd.RestartDaemon(Log)); } finally { redetecting = false; }
                RefreshLive();
            });
            menu.Items.Add("Restore last RawAccel backup", null, (s, e) => { if (applying) { Log("restore: an apply is in progress - try again when it finishes"); return; } try { ra.RestoreLastBackup(Log); } catch (Exception ex) { Log("restore: " + ex.Message); } RefreshLive(); });
            menu.Items.Add("Exit", null, (s, e) => Shutdown());
            tray.ContextMenuStrip = menu; tray.DoubleClick += (s, e) => { Show(); WindowState = FormWindowState.Normal; Activate(); };
            Resize += (s, e) => { if (WindowState == FormWindowState.Minimized) Hide(); };
        }

        void SetConsole(bool open) { consoleOpen = open; consoleBox.Height = open ? 380 : 176; }

        static FlowLayoutPanel SidePage() => new FlowLayoutPanel
        {
            Dock = DockStyle.Fill, BackColor = Theme.Card, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true, Padding = new Padding(0, 8, 0, 0)
        };

        void BuildRigPage(FlowLayoutPanel p)
        {
            p.Controls.Add(Theme.SectionTitle("Pen and game", SideW));
            var grid = new FlowLayoutPanel { Width = SideW, Height = 186, WrapContents = true, BackColor = Theme.Card, Margin = new Padding(0) };
            grid.Controls.Add(Field("px / mm", nPx, 20, 300, 1, 0));
            grid.Controls.Add(Field("cm / 360", nCm, 10, 120, 0.5m, 1));
            grid.Controls.Add(Field("angle snap °", nSnap, 0, 30, 0.5m, 1));
            grid.Controls.Add(Field("Y / X ratio", nYx, 0.3m, 1.5m, 0.01m, 3));
            grid.Controls.Add(Field("hover max", nHdl, 0, 100, 1, 0));
            grid.Controls.Add(Field("reset after lift, ms", nReset, 10, 500, 5, 0));
            p.Controls.Add(grid);
            p.Controls.Add(Theme.SectionTitle("Quick picks", SideW));
            var chips = new FlowLayoutPanel { Width = SideW, Height = 70, WrapContents = true, BackColor = Theme.Card, Margin = new Padding(0) };
            foreach (var ms in new[] { 60, 80, 120 })
            {
                var chip = new Button(); Theme.Button(chip, "RESET " + ms, chip: true); chip.Width = 78;
                chip.Click += (s, e) => { nReset.Value = ms; PullRig(); Recalc(); };
                chips.Controls.Add(chip);
            }
            // cm/360 chips: the FIELD tiers this project actually established (not template numbers)
            foreach (var cm in new[] { 27.0, 34.0, 37.7, 42.0 })
            {
                double cmv = cm;
                var chip = new Button(); Theme.Button(chip, "CM " + cm.ToString("0.#"), chip: true); chip.Width = 78;
                chip.Click += (s, e) => { nCm.Value = (decimal)cmv; PullRig(); Recalc(); };
                chips.Controls.Add(chip);
            }
            p.Controls.Add(chips);
            Theme.Button(bReset, "↺  RESTORE THE CARD'S VALUES"); bReset.Width = SideW - 4; bReset.Margin = new Padding(0, 10, 0, 0);
            bReset.Click += (s, e) => { if (cur != null) { rig = RigFor(cur); PushRig(); Recalc(); } };
            p.Controls.Add(bReset);

        }

        Control Field(string label, NumericUpDown n, decimal min, decimal max, decimal step, int dec)
        {
            var p = new Panel { Width = SideW / 2 - 8, Height = 58, Margin = new Padding(0, 2, 8, 4), BackColor = Theme.Card };
            var l = new Label { Text = label.ToUpperInvariant(), Font = Theme.Caps, ForeColor = Steel, Dock = DockStyle.Top, Height = 20 };
            n.Minimum = min; n.Maximum = max; n.Increment = step; n.DecimalPlaces = dec; n.Dock = DockStyle.Top; Theme.NumBox(n);
            p.Controls.Add(n); p.Controls.Add(l); return p;
        }

        static void Style(Button b, bool primary = false) => Theme.Button(b, b.Text.ToUpperInvariant(), primary);

        void FillList()
        {
            string q = search.Text.Trim();
            entries.Clear();
            foreach (var g in cat.presets.Select(p => p.group).Distinct())
            {
                var hits = cat.presets.Where(p => p.group == g && (q.Length == 0 || p.name.Contains(q, StringComparison.OrdinalIgnoreCase)
                                                                  || g.Contains(q, StringComparison.OrdinalIgnoreCase) || p.id.Contains(q, StringComparison.OrdinalIgnoreCase))).ToList();
                if (hits.Count == 0) continue;
                entries.Add(new Entry { Group = g });
                foreach (var p in hits) entries.Add(new Entry { P = p });
            }
            suppress = true;
            try { list.BeginUpdate(); list.Items.Clear(); list.Items.AddRange(entries.Cast<object>().ToArray()); list.EndUpdate(); }
            finally { suppress = false; }
        }

        void MarkSelected(Preset p)
        {
            suppress = true;
            try { int i = entries.FindIndex(x => ReferenceEquals(x.P, p)); if (i >= 0) list.SelectedIndex = i; else list.ClearSelected(); }
            finally { suppress = false; }
        }

        void DrawEntry(object? s, DrawItemEventArgs e)
        {
            if (e.Index < 0 || e.Index >= list.Items.Count) return;
            var g = e.Graphics; var r = e.Bounds; var en = (Entry)list.Items[e.Index];
            if (en.Group != null)
            {
                using (var bg = new SolidBrush(Theme.Card)) g.FillRectangle(bg, r);
                string t = en.Group.ToUpperInvariant();
                TextRenderer.DrawText(g, t, Theme.Caps, new Rectangle(r.X + 14, r.Bottom - 20, r.Width - 20, 18), Theme.Red, TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
                return;
            }
            var p = en.P!; bool sel = (e.State & DrawItemState.Selected) != 0;
            using (var bg = new SolidBrush(sel ? Color.FromArgb(40, 56, 72) : Theme.Card)) g.FillRectangle(bg, r);
            if (sel) using (var red = new SolidBrush(Theme.Red)) g.FillRectangle(red, r.X, r.Y, 3, r.Height);
            string tier = RolePolicy.PlanTier(p);
            int right = r.Right - 10;
            if (tier.Length > 1 && tier[1] >= '3')
            {
                var sz = TextRenderer.MeasureText(tier, Theme.Caps); right -= sz.Width + 8;
                var br = new Rectangle(right, r.Y + 7, sz.Width + 8, 16);
                using (var pen = new Pen(Theme.Amber)) g.DrawRectangle(pen, br);
                TextRenderer.DrawText(g, tier, Theme.Caps, br, Theme.Amber, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
                right -= 6;
            }
            if (p.field == "good") { g.SmoothingMode = SmoothingMode.AntiAlias; using var dot = new SolidBrush(Theme.Teal); g.FillEllipse(dot, right - 8, r.Y + 12, 6, 6); right -= 14; }
            TextRenderer.DrawText(g, p.name, sel ? Theme.BodyB : Theme.Body, new Rectangle(r.X + 16, r.Y, right - r.X - 16, r.Height), sel ? Color.White : Ink,
                                  TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
        }

        void MeasureQc(object? s, MeasureItemEventArgs e)
        {
            if (e.Index < 0 || e.Index >= qc.Items.Count) return;
            string t = qc.Items[e.Index]!.ToString()!; t = t.Length > 2 ? t.Substring(2) : t;
            var sz = TextRenderer.MeasureText(e.Graphics, t, Theme.Small, new Size(Math.Max(80, qc.ClientSize.Width - 30), 0), TextFormatFlags.WordBreak);
            e.ItemHeight = Math.Min(255, Math.Max(22, sz.Height + 8));
        }

        void DrawQc(object? s, DrawItemEventArgs e)
        {
            if (e.Index < 0 || e.Index >= qc.Items.Count) return;
            var g = e.Graphics; var r = e.Bounds;
            using (var bg = new SolidBrush(Theme.Card)) g.FillRectangle(bg, r);
            string t = qc.Items[e.Index]!.ToString()!;
            var c = t.StartsWith("✖") ? Bad : t.StartsWith("⚠") ? Warn : t.StartsWith("✓") ? Good : Steel;
            using (var mark = new SolidBrush(c)) g.FillRectangle(mark, r.X + 2, r.Y + 7, 8, 8);
            string body = t.Length > 2 ? t.Substring(2) : t;
            TextRenderer.DrawText(g, body, Theme.Small, new Rectangle(r.X + 20, r.Y + 3, r.Width - 24, r.Height - 3),
                                  t.StartsWith("✓") ? Good : t.StartsWith("ℹ") ? Steel : Ink, TextFormatFlags.WordBreak | TextFormatFlags.Left);
        }

        // ================= settings pages (Builds tab): Filters, Engine, Mouse =================
        Switch Sw(CheckBox c, string title, string hint)
        {
            var s = (Switch)c; s.Text = title; s.Hint = hint; s.Width = SideW; s.Height = 40; s.Margin = new Padding(0, 6, 0, 2); s.BackColor = Theme.Card;
            s.CheckedChanged += (o, e) => { if (!suppress) Recalc(); };
            return s;
        }
        Control FRow(string t, NumericUpDown n, decimal mi, decimal ma, decimal st, int d, decimal v)
        {
            var r = new FlowLayoutPanel { Width = SideW, Height = 32, BackColor = Theme.Card, Margin = new Padding(0, 0, 0, 2), WrapContents = false };
            r.Controls.Add(new Label { Text = t, ForeColor = Steel, Font = Theme.Small, Width = 180, Height = 26, TextAlign = ContentAlignment.MiddleLeft, Margin = new Padding(44, 2, 0, 0) });
            n.Minimum = mi; n.Maximum = ma; n.Increment = st; n.DecimalPlaces = d; n.Value = Math.Max(mi, Math.Min(ma, v)); n.Width = 96; Theme.NumBox(n);
            n.ValueChanged += (s, e) => { if (!suppress) Recalc(); };
            n.Margin = new Padding(0, 2, 0, 0);
            r.Controls.Add(n);
            return r;
        }

        void BuildSettingsPages(FlowLayoutPanel pf, FlowLayoutPanel pe, FlowLayoutPanel pm)
        {
            // ---------- FILTERS ----------
            fGoal.Width = SideW; fGoal.Height = 48; fGoal.Font = Theme.Small; fGoal.ForeColor = Steel; fGoal.Margin = new Padding(0, 4, 0, 0);
            pf.Controls.Add(fGoal);
            pf.Controls.Add(Theme.SectionTitle("Hover", SideW));
            Sw(fHdl, "Hover Distance Limiter", "drops high-hover wobble · T0, zero cost"); fHdl.Checked = true;
            pf.Controls.Add(fHdl);
            // contact-only aim = HDL with a ~zero hover ceiling, so hover reports never move the camera
            Sw(fContact, "Contact-only aim", "hover max 1: only the tip on the screen moves the camera");
            fContact.CheckedChanged += (s, e) =>
            {
                if (suppress) return;
                suppress = true;
                nHdl.Value = fContact.Checked ? 1 : (decimal)(cur?.hdlMax ?? 87);
                suppress = false;
                PullRig(); Recalc();
            };
            pf.Controls.Add(fContact);
            pf.Controls.Add(FRow("hover min", fHdlMin, 0, 60, 1, 0, 0));
            fHdlMin.ValueChanged += (s, e) => { rig.HdlMin = (double)fHdlMin.Value; };
            // hover is dialled BY FEEL: these push only the Hover Distance Limiter to the daemon (never a `detect`)
            var hoverChips = new FlowLayoutPanel { Width = SideW - 44, Height = 34, BackColor = Theme.Card, Margin = new Padding(44, 4, 0, 0), WrapContents = false };
            foreach (var hv in new[] { 1, 40, 87, 100 })
            {
                int v = hv;
                var chip = new Button(); Theme.Button(chip, v == 1 ? "CONTACT" : "MAX " + v, chip: true); chip.Width = 72;
                chip.Click += (s, e) =>
                {
                    suppress = true; nHdl.Value = v; fContact.Checked = v == 1; suppress = false;
                    PullRig(); Recalc(); PushHoverLive();
                };
                hoverChips.Controls.Add(chip);
            }
            pf.Controls.Add(hoverChips);
            var bHover = new Button(); Theme.Button(bHover, "SET HOVER LIVE  (NO FULL APPLY)"); bHover.Width = SideW - 44; bHover.Margin = new Padding(44, 2, 0, 4);
            bHover.Click += (s, e) => PushHoverLive();
            pf.Controls.Add(bHover);
            pf.Controls.Add(Theme.SectionTitle("Click and stability", SideW));
            Sw(fTap, "Tap Anchor", "pins the pen tip's click skid · T1");
            pf.Controls.Add(fTap);
            pf.Controls.Add(FRow("arm at pressure %", fTapArm, 0.1m, 90, 0.1m, 1, 1.0m));
            pf.Controls.Add(FRow("hold after release, ms", fTapHold, 0, 500, 5, 0, 45));
            pf.Controls.Add(FRow("break distance, mm", fTapBreak, 0.02m, 20, 0.1m, 2, 0.8m));
            Sw(fCoh, "Hold smoothing", "full stabilizer: stillness bought with onset ms · T3");
            pf.Controls.Add(fCoh);
            pf.Controls.Add(FRow("hold window, ms", fHold, 1, 2000, 10, 0, 120));

            // ---------- ENGINE ----------
            pe.Controls.Add(Theme.SectionTitle("Curve engine", SideW));
            Sw(fCadence, "Cadence Lock", "runs the curve on the pen's own clock · RawAccel flat · T0");
            // engine.txt: "cadence|rawaccel;<pen Hz, 0 = auto>;<merge cap reports>"
            double savedHz = cat.tablet.reportHz, savedMerge = 8;   // a missing/old engine.txt pins the MEASURED rate, as the CLI does
            try
            {
                if (System.IO.File.Exists(EnginePath))
                {
                    var parts = System.IO.File.ReadAllText(EnginePath).Trim().Split(';');
                    fCadence.Checked = parts[0] == "cadence";
                    if (parts.Length > 1 && double.TryParse(parts[1], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var hz)) savedHz = hz;
                    if (parts.Length > 2 && double.TryParse(parts[2], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var mg)) savedMerge = mg;
                }
            }
            catch { }
            void SaveEngine()
            {
                rig.Engine = fCadence.Checked ? "cadence" : "rawaccel";
                rig.ReportHz = (double)fCadHz.Value; rig.MergeMax = (double)fCadMerge.Value;
                if (!constructing) try { System.IO.File.WriteAllText(EnginePath, string.Format(System.Globalization.CultureInfo.InvariantCulture, "{0};{1};{2}", rig.Engine, rig.ReportHz, rig.MergeMax)); } catch { }
            }
            fCadence.CheckedChanged += (s, e) =>
            {
                SaveEngine();
                Log(fCadence.Checked ? "engine: Cadence Lock - next apply writes RawAccel FLAT and runs the curve in OTD on the pen's clock (dt rounded to whole reports)"
                                     : "engine: RawAccel - next apply writes the curve into RawAccel and disables Cadence Lock");
            };
            pe.Controls.Add(fCadence);
            pe.Controls.Add(FRow("pen rate, Hz (0 = auto)", fCadHz, 0, 2000, 1, 0, (decimal)savedHz));
            pe.Controls.Add(FRow("merge cap, reports", fCadMerge, 1, 16, 1, 0, (decimal)savedMerge));
            fCadHz.ValueChanged += (s, e) => { SaveEngine(); Log(fCadHz.Value == 0 ? "cadence: pen rate AUTO (running-mean estimate; use to VERIFY the hardware rate)" : $"cadence: pen rate pinned {fCadHz.Value} Hz"); };
            fCadMerge.ValueChanged += (s, e) => { SaveEngine(); Log($"cadence: merge cap {fCadMerge.Value} reports (a longer gap is still priced as this many reports, never a spike)"); };
            SaveEngine();

            pe.Controls.Add(Theme.SectionTitle("Experimental", SideW));
            Sw(fTwin, "Nib Twin", "cancels the click skid on moving shots · calibrate first");
            fTwin.Checked = xpState.Twin;
            pe.Controls.Add(fTwin);
            var bNib = new Button(); Theme.Button(bNib, "CALIBRATE NIB  (20 TAPS)"); bNib.Width = SideW - 44; bNib.Margin = new Padding(44, 2, 0, 6);
            bNib.Click += async (s, e) => await DoNibCalibrate();
            pe.Controls.Add(bNib);
            Sw(fIntent, "Intent speed", "gain from your coherent velocity · needs Cadence Lock");
            fIntent.Checked = xpState.Intent;
            pe.Controls.Add(fIntent);
            Sw(fCarry, "Reversal carry", "keeps gain through strafe turnarounds · Lab cards only");
            fCarry.Checked = xpState.CarryMs > 0;
            pe.Controls.Add(fCarry);
            pe.Controls.Add(FRow("carry window, ms", fCarryMs, 10, (decimal)Experiments.MaxCarryMs, 5, 0, (decimal)(xpState.CarryMs > 0 ? xpState.CarryMs : Experiments.DefaultCarryMs)));
            void SaveXp()
            {
                xpState.Intent = fIntent.Checked; xpState.CarryMs = fCarry.Checked ? (double)fCarryMs.Value : 0; xpState.Twin = fTwin.Checked;
                if (!constructing) try { xpState.Save(); } catch { }
                xpState.ApplyTo(rig);
            }
            fIntent.CheckedChanged += (s, e) => { SaveXp(); Log(fIntent.Checked ? "experimental: Intent Speed ON - the next Cadence Lock apply selects gain from the coherent velocity (needs the Cadence Lock engine)" : "experimental: Intent Speed off"); };
            fCarry.CheckedChanged += (s, e) => { SaveXp(); Log(fCarry.Checked ? $"experimental: Reversal Carry {fCarryMs.Value} ms - Lab-only (refused on Master/Baseline/Turbo/Tapped); needs the Cadence Lock engine" : "experimental: Reversal Carry off"); };
            fCarryMs.ValueChanged += (s, e) => SaveXp();
            fTwin.CheckedChanged += (s, e) =>
            {
                SaveXp();
                var nc = NibCal.Load();
                Log(!fTwin.Checked ? "experimental: Nib Twin off"
                    : nc == null ? "experimental: Nib Twin ON - but there is no calibration yet: press 'calibrate nib' before applying"
                    : nc.Invalid() is string why ? "experimental: Nib Twin ON - but the calibration is refused (" + why + "): recalibrate"
                    : $"experimental: Nib Twin ON - removes a {nc.MagMm:0.000} mm swing at {nc.AngleDeg:0} deg keyed on tip pressure (either engine; apply to use it)");
            };

            // ---------- MODES: third-person match, then the mouse mirror ----------
            // 2026-09-27: third-person match (THIRD_PERSON.md) - an over-the-shoulder camera made to feel first-person
            pm.Controls.Add(Theme.SectionTitle("Third-person match", SideW));
            Sw(fTps, "Feel like a first-person game", "third-person games (Marvel Rivals, Deadlock) · matched at your fight distance");
            fTps.Checked = tpsState.On;
            pm.Controls.Add(fTps);
            pm.Controls.Add(FRow("camera arm, m (this game)", fTpsCam, 0.5m, 8, 0.1m, 1, (decimal)ThirdPerson.DefaultCameraM));
            tip.SetToolTip(fTpsCam, "Distance from the camera to your hero, for the selected card's game. The roster value is an ESTIMATE (the games do not publish it); raise it for large heroes.");
            pm.Controls.Add(FRow("fight distance, m", fTpsFight, 2, 60, 1, 0, (decimal)tpsState.FightM));
            tip.SetToolTip(fTpsFight, "Targets at this distance move under the pen exactly like in a first-person game. Nearer targets still feel heavier, farther ones lighter.");
            // 2026-10-11: named fight distances (starting points from THIRD_PERSON.md, not measurements)
            var tpsChips = new FlowLayoutPanel { AutoSize = true, Margin = new Padding(44, 2, 0, 0), BackColor = Color.Transparent };
            foreach (var (name, m, who) in ThirdPerson.DistancePresets)
            {
                var chip = new Button(); Theme.Button(chip, name.ToUpperInvariant() + " " + m.ToString("0") + " M", chip: true); chip.Width = 78;
                tip.SetToolTip(chip, $"Match at {m:0} m - a starting point for {who}. Tune by feel; field verdict pending.");
                double mv = m; chip.Click += (s, e) => fTpsFight.Value = (decimal)mv;
                tpsChips.Controls.Add(chip);
            }
            pm.Controls.Add(tpsChips);
            // the (D+L)/D geometry, drawn: camera -L- hero -D- target
            tpsDiagram.Size = new Size(SideW - 48, 46); tpsDiagram.Margin = new Padding(44, 6, 0, 0); tpsDiagram.BackColor = Color.Transparent;
            Theme.DoubleBuffer(tpsDiagram); tpsDiagram.Paint += (s, e) => PaintTpsDiagram(e.Graphics, tpsDiagram.ClientSize);
            pm.Controls.Add(tpsDiagram);
            tpsRead.Width = SideW - 44; tpsRead.Height = 72; tpsRead.Font = Theme.Small; tpsRead.ForeColor = Steel; tpsRead.Margin = new Padding(44, 4, 0, 0);
            pm.Controls.Add(tpsRead);
            void SaveTps()
            {
                tpsState.On = fTps.Checked; tpsState.FightM = (double)fTpsFight.Value;
                // the arm control edits the selected card's game only, and only when the user changed it (not when a select pushed it)
                if (cur != null && ThirdPerson.IsThirdPerson(cur) && !tpsPushing && Math.Abs((double)fTpsCam.Value - tpsState.ArmFor(cur)) > 1e-9) tpsState.SetArm(cur, (double)fTpsCam.Value);
                if (!constructing) try { tpsState.Save(); } catch { }
                Recalc();
            }
            fTps.CheckedChanged += (s, e) => { SaveTps(); Log(fTps.Checked ? "third-person match ON - " + (cur != null && ThirdPerson.IsThirdPerson(cur) ? "the next apply of this card scales its output by x" + tpsState.KFor(cur).ToString("0.00") : "third-person cards will be scaled at apply") + " (in-game sensitivity unchanged)" : "third-person match off"); };
            fTpsCam.ValueChanged += (s, e) => SaveTps();
            fTpsFight.ValueChanged += (s, e) => SaveTps();
            // ---------- MOUSE ----------
            pm.Controls.Add(Theme.SectionTitle("Mouse mirror", SideW));
            Sw(fMouse, "Mirror this build to the mouse", "a second RawAccel profile, matched to the pen");
            fMouse.Checked = mouseState.On;
            pm.Controls.Add(fMouse);
            pm.Controls.Add(FRow("mouse DPI", fMouseDpi, 100, 30000, 50, 0, (decimal)mouseState.Dpi));
            pm.Controls.Add(FRow("speed EMA, ms", fMouseHl, 0, 10, 0.5m, 1, (decimal)mouseState.HalfLifeMs));
            pm.Controls.Add(FRow("mouse Y/X (0 = pen's)", fMouseYx, 0, 1.5m, 0.01m, 3, (decimal)(mouseState.Yx ?? 0)));
            mouseRead.Width = SideW; mouseRead.Height = 90; mouseRead.Font = Theme.Small; mouseRead.ForeColor = Steel; mouseRead.Margin = new Padding(0, 10, 0, 4);
            pm.Controls.Add(mouseRead);
            void SaveMouse()
            {
                mouseState.On = fMouse.Checked; mouseState.Dpi = (double)fMouseDpi.Value; mouseState.HalfLifeMs = (double)fMouseHl.Value;
                mouseState.Yx = fMouseYx.Value == 0 ? (double?)null : (double)fMouseYx.Value;
                if (!constructing) try { mouseState.Save(); } catch { }
                mouseState.ApplyTo(rig); UpdateMouseReadout();
            }
            fMouse.CheckedChanged += (s, e) => { SaveMouse(); Log(fMouse.Checked
                ? "mouse mirror ON - the next apply builds the mouse profile from the card and binds your mouse in RawAccel (sensor DPI as typed; AimForge cannot check it)"
                : "mouse mirror OFF - the next apply returns the mouse to raw (RawAccel device entries disabled)"); };
            fMouseDpi.ValueChanged += (s, e) => { SaveMouse(); if ((double)fMouseDpi.Value % 50 != 0) Log("mouse DPI is not a multiple of 50 - check the sensor step"); };
            fMouseHl.ValueChanged += (s, e) => SaveMouse();
            fMouseYx.ValueChanged += (s, e) => SaveMouse();
            SaveMouse();
        }

        bool selecting;
        void Select(Preset p)
        {
            if (selecting) return;            // Selected= below re-enters via SelectedIndexChanged
            selecting = true;
            try
            {
                cur = p; rig = RigFor(p); measured = null; PushRig(); PrefillFilters(); Recalc();
                suppress = true;
                suppress = false;
                MarkSelected(p);
            }
            finally { selecting = false; }
        }

        void PushRig()
        {
            suppress = true;
            nPx.Value = (decimal)Clamp(rig.PxMm, nPx); nCm.Value = (decimal)Clamp(rig.Cm360, nCm); nSnap.Value = (decimal)Clamp(rig.SnapDeg, nSnap);
            nYx.Value = (decimal)Clamp(rig.Yx, nYx); nHdl.Value = (decimal)Clamp(rig.HdlMax, nHdl); nReset.Value = (decimal)Clamp(rig.ResetMs, nReset);
            suppress = false;
        }
        static double Clamp(double v, NumericUpDown n) => Math.Max((double)n.Minimum, Math.Min((double)n.Maximum, v));
        void PullRig() { rig.HdlMin = (double)fHdlMin.Value; rig.PxMm = (double)nPx.Value; rig.Cm360 = (double)nCm.Value; rig.SnapDeg = (double)nSnap.Value; rig.Yx = (double)nYx.Value; rig.HdlMax = (double)nHdl.Value; rig.ResetMs = (double)nReset.Value; }

        void Recalc()
        {
            UpdateMouseReadout();
            if (cur == null) return;
            if (ThirdPerson.IsThirdPerson(cur)) { tpsPushing = true; try { SetNum(fTpsCam, tpsState.ArmFor(cur)); } finally { tpsPushing = false; } }
            fTpsCam.Enabled = ThirdPerson.IsThirdPerson(cur);
            double tk = tpsState.KFor(cur), tarm = tpsState.ArmFor(cur);
            tpsRead.Text = !ThirdPerson.IsThirdPerson(cur) ? "This card is a first-person game: the match never changes it."
                : string.Format(System.Globalization.CultureInfo.InvariantCulture,
                    (tpsState.On ? "MATCHED AT {3:0} M{7} - output x{0:0.00}." : "OFF - would be x{0:0.00} matched at {3:0} m{7}.") + " Hand motion per on-screen offset vs an FPS:\n  5 m {1:0.00}x   (unmatched {2:0.00}x)\n  {3:0} m 1.00x   (unmatched {4:0.00}x)\n  25 m {5:0.00}x   (unmatched {6:0.00}x)",
                    tk, ThirdPerson.FeelVsFps(tk, tarm, 5), ThirdPerson.FeelVsFps(1, tarm, 5),
                    tpsState.FightM, ThirdPerson.FeelVsFps(1, tarm, tpsState.FightM),
                    ThirdPerson.FeelVsFps(tk, tarm, 25), ThirdPerson.FeelVsFps(1, tarm, 25),
                    tpsState.PresetName is string pn ? " (" + pn + ")" : "");
            tpsDiagram.Invalidate();
            desc.Text = cur.desc.Replace("\n", Environment.NewLine);
            heroGroup.Text = (cur.group ?? "").ToUpperInvariant();
            heroName.Text = cur.name.ToUpperInvariant();
            {
                var eff = Curve.EffectiveLut(cur, rig.PxMm);
                var s = Curve.Summary(eff, cat.tablet);
                t180.Set(Curve.Turn180Mm(eff, rig).ToString("0.0"), "mm");
                tEdpi.Set(Curve.EDpi(rig, rig.Mult).ToString("0"));
                tFloor.Set(s.floor.ToString("0.00"), "", s.floor < 0.995 ? Warn : Ink);
                tTap.Set(s.tap.ToString("0.00")); tTrack.Set(s.track.ToString("0.00")); tCap.Set(s.cap.ToString("0.0"));
                var effT = EffectivePreset();
                heroMeta.Text = (RolePolicy.RoleOf(effT) + "  ·  latency tier " + RolePolicy.PlanTier(effT) + "  ·  " + (fCadence.Checked ? "Cadence Lock engine" : "RawAccel engine") + "  ·  "
                    + (tpsState.On && ThirdPerson.IsThirdPerson(cur) ? $"3rd-person match x{tpsState.KFor(cur):0.00} @ {tpsState.FightM:0} m  ·  " : "")
                    + (cur.IsLut ? $"LUT, {cur.lut!.Length} points" : $"classic  accel {cur.adv.accel}  cap {cur.adv.cap}  offset {cur.adv.offset}")).ToUpperInvariant();
                summary.Text = (cur.IsLut ? "" : $"classic  accel {cur.adv.accel}  cap {cur.adv.cap}  offset {cur.adv.offset} ({(cur.adv.offset ?? 0) * 1000 / rig.PxMm:0.0} mm/s)\n")
                    + $"floor {s.floor:0.00}   2-unit {s.twoUnit:0.00}   tap {s.tap:0.00}   track {s.track:0.00}   cap {s.cap:0.0}\n180° @150ms  {Curve.Turn180Mm(eff, rig):0.0} mm        eDPI {Curve.EDpi(rig, rig.Mult):0}";
            }
            sensRows = cat.games.Select(g => { double v = Curve.SensFor(g.K, rig, rig.Mult); return (g.name, v.ToString(v < 1 ? "0.000" : "0.00")); }).ToList();
            sensPanel.Invalidate();
            sens.Text = string.Join("\n", cat.games.Select(g => { double v = Curve.SensFor(g.K, rig, rig.Mult); return $"{g.name,-16} {v.ToString(v < 1 ? "0.000" : "0.00"),7}"; }).Chunk(2).Select(ch => string.Join("    ", ch)));
            measuredLbl.Text = measured == null ? "" : "MEASURED  " + measured.ToString();
            qc.Items.Clear();
            var effP = EffectivePreset();   // the build an apply would WRITE (toggles folded), judged on this rig
            var issues = cur.IsLut ? Curve.Check(cur, cat.tablet) : new List<string>();
            if (fCoh.Checked) qc.Items.Add("⚠ hold smoothing " + fHold.Value + "ms enabled - this is the delayed feel; " + (plan.HoldOffered ? "offered for this stillness goal" : "not suggested for this goal"));
            else if (fTap.Checked) qc.Items.Add("ℹ Tap Anchor only: exact passthrough + click pin (hold " + fTapHold.Value + "ms, break " + fTapBreak.Value + "mm)");
            else if (cur.RunsFilter) qc.Items.Add(cur.cohOv?.IsTapOnly == true ? "ℹ runs the Coherence Stabilizer in tap-anchor-only mode" : "⚠ runs an aim filter (not a pure LUT build)");
            if (!fHdl.Checked) qc.Items.Add("⚠ Hover Distance Limiter OFF - high-hover wobble returns; this filter is free, off is for A/B only");
            double tipPct = rig.TipThresholdPct ?? 2.0;
            if ((fTap.Checked || fCoh.Checked) && (double)fTapArm.Value >= tipPct)
                qc.Items.Add((rig.TipThresholdPct != null ? "✖" : "⚠") + " tap arm " + fTapArm.Value + "% is at/above the " + tipPct + "% tip threshold" + (rig.TipThresholdPct != null ? "" : " (OTD default; check yours)") + " - the pin lands AFTER the click");
            if (rig.SnapDeg > 0 && rig.SnapDeg < 4) qc.Items.Add("⚠ snap < 4° only cleans fast turns (measured: 15mm/s needs ~15°)");
            if (rig.PxMm < 80 && cur.IsLut && Curve.GainAt(cur.lut!, cat.tablet.UnitStepMms) < 0.9) qc.Items.Add($"⚠ {rig.PxMm} px/mm: an attenuated floor costs onset dead time (measured 13ms at 55)");
            foreach (var i in issues) qc.Items.Add("✖ " + i);
            // role policy (3.2): named-exception model - violations fail, warns carry evidence ids
            int problems = qc.Items.Count;
            string tier = RolePolicy.PlanTier(effP);
            string role = RolePolicy.RoleOf(effP);
            if (OtdBridge.HoverBlocker(new Rig { HdlEnabled = fHdl.Checked, HdlMin = rig.HdlMin, HdlMax = rig.HdlMax }) is string hb) { qc.Items.Add("✖ " + hb.Replace(" - nothing was written", "")); problems++; }
            foreach (var r in RolePolicy.Check(effP, rig))
            {
                if (r.StartsWith("warn:")) qc.Items.Add("⚠ " + r.Substring(5).Trim());
                else { qc.Items.Add("✖ " + r); problems++; }
            }
            if (rig.ResetMs <= 0) { qc.Items.Add("✖ reset ms 0 - relative mode cannot re-origin after a lift"); problems++; }
            qc.Items.Add("ℹ role " + role + " · latency tier " + tier + (tier == "T0" ? " — gates only, zero temporal cost"
                : tier == "T1" ? " — state (tap pin), ~0ms on coherent motion"
                : tier == "T3" ? " — hold smoothing: stillness bought with onset ms (stated on the card)"
                : tier == "T5" ? " — Lead Sight prediction: lab-class, decel-gated, measured"
                : ""));
            if (rig.HdlMax <= 2 && fHdl.Checked) qc.Items.Add("ℹ contact-only aim: hover reports never move the camera");
            if (cur.id.StartsWith("val")) qc.Items.Add("ℹ compat: VMulti relative output — Vanguard-safe; fire must be a keyboard key mapped to the pen tip");
            if (cur.id == "valwx") qc.Items.Add("ℹ philosophy: low-accel tactical — the doc-orthodoxy sibling of the sat-265 Master, not a rival");
            if (problems == 0) qc.Items.Add("✓ passes every field-derived rule");
            curve.Invalidate();
        }

        // ---- curve panel: log-speed axis, gain, landmarks ----
        void PaintCurve(object? s, PaintEventArgs e)
        {
            var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.Clear(Panel);
            var r = curve.ClientRectangle; int L = 52, R = 16, T = 18, B = 28;
            var plot = new Rectangle(r.X + L, r.Y + T, r.Width - L - R, r.Height - T - B);
            if (cur == null) return;
            var eff = Curve.EffectiveLut(cur, rig.PxMm);
            double vmin = 1, vmax = 1500, gmax = Math.Max(1.5, eff.Max(p => p[1]) * 1.1);
            Func<double, float> X = v => (float)(plot.X + (Math.Log10(Math.Max(v, vmin)) - Math.Log10(vmin)) / (Math.Log10(vmax) - Math.Log10(vmin)) * plot.Width);
            Func<double, float> Y = gn => (float)(plot.Bottom - gn / gmax * plot.Height);
            // QC bands: the tremor band (<15 mm/s, dips forbidden) shaded so the rules are
            // visible on the graph itself, not just in the checklist.
            using (var band = new SolidBrush(Color.FromArgb(14, Warn)))
                g.FillRectangle(band, plot.X, plot.Top, X(15) - plot.X, plot.Height);
            using var grid = new Pen(Line, 1); using var txt = new SolidBrush(Steel);
            foreach (var v in new[] { 1.0, 10, 100, 1000 }) { g.DrawLine(grid, X(v), plot.Top, X(v), plot.Bottom); g.DrawString(v.ToString(), Mono, txt, X(v) - 8, plot.Bottom + 4); }
            for (double gn = 0; gn <= gmax; gn += gmax > 4 ? 1 : 0.5) { g.DrawLine(grid, plot.Left, Y(gn), plot.Right, Y(gn)); g.DrawString(gn.ToString("0.0"), Mono, txt, plot.Left - 34, Y(gn) - 7); }
            using var unity = new Pen(Color.FromArgb(90, Ink), 1) { DashStyle = DashStyle.Dash }; g.DrawLine(unity, plot.Left, Y(1), plot.Right, Y(1));
            // landmarks
            foreach (var (v, name, col) in new[] { (cat.tablet.UnitStepMms, "1-unit", Steel), (Curve.TapSkidMms, "tap", Warn), (Curve.AccelFloorMms, "55", Steel), (Curve.TrackMms, "track", Steel), (Curve.FlickMms, "flick", Steel) })
            { using var lp = new Pen(Color.FromArgb(110, col), 1) { DashStyle = DashStyle.Dot }; g.DrawLine(lp, X(v), plot.Top, X(v), plot.Bottom); g.DrawString(name, Mono, new SolidBrush(col), X(v) + 2, plot.Top - 2); }
            // feather ghost for comparison
            var fe = cat.Find("bo6og") is Preset b && !ReferenceEquals(b, cur) ? b : cat.Find("feather");
            if (fe != null && !ReferenceEquals(fe, cur)) DrawLut(g, Curve.EffectiveLut(fe, rig.PxMm), X, Y, new Pen(Color.FromArgb(70, Ink), 1.5f), vmin, vmax);
            DrawLut(g, eff, X, Y, new Pen(Accent, 2.2f), vmin, vmax);
            if (cur.IsLut)   // anchor dots mark AUTHORED LUT points; a classic curve is a dense sample, not anchors
                foreach (var p in eff.Where(p => p[0] >= vmin)) { float x = X(p[0]), y = Y(p[1]); g.FillEllipse(new SolidBrush(Accent), x - 3, y - 3, 6, 6); }
            g.DrawString($"gain vs pen speed (mm/s, log)  ·  ghost = {(ReferenceEquals(fe, cur) || fe == null ? "-" : fe.name)}"
                + (cur.IsLut ? "" : "  ·  classic curve = RawAccel's formula 1+a(v-off)^2/v"), Mono, txt, plot.Left + 4, plot.Bottom - 16);
        }

        static void DrawLut(Graphics g, double[][] lut, Func<double, float> X, Func<double, float> Y, Pen pen, double vmin, double vmax)
        {
            var pts = new List<PointF>();
            for (int i = 0; i <= 300; i++) { double v = vmin * Math.Pow(vmax / vmin, i / 300.0); pts.Add(new PointF(X(v), Y(Curve.GainAt(lut, v)))); }
            g.DrawLines(pen, pts.ToArray());
        }

        // ---- actions ----
        async Task DoMeasure()
        {
            if (cur == null) return;
            // snapshot the card AND the rig: the measurement runs on a background task while the UI stays live
            var pc = cur; var rg = rig.Clone(); var lut = Curve.EffectiveLut(pc, rg.PxMm); var tb = cat.tablet;
            bMeasure.Enabled = false; measuredLbl.Text = "measuring…";
            measured = await Task.Run(() => Measure.Run(lut, rg, tb));
            measuredLbl.Text = "measured  " + measured; bMeasure.Enabled = true;
            // 4.4: every measurement becomes a saved evidence artifact a build can cite.
            try
            {
                string id = $"ev-{DateTime.Now:yyyyMMdd-HHmmss}-{pc.id}";
                System.IO.Directory.CreateDirectory(RolePolicy.EvidenceDir);
                var doc = new
                {
                    evidenceId = id, date = DateTime.Now.ToString("yyyy-MM-dd HH:mm"),
                    presetId = pc.id, preset = pc.name, tablet = cat.tablet.name,
                    rig = new { pxmm = rg.PxMm, cm360 = rg.Cm360, snap = rg.SnapDeg, yx = rg.Yx, resetMs = rg.ResetMs },
                    curve = pc.IsLut ? (object)pc.lut! : new { classic = true, accel = pc.adv.accel, cap = pc.adv.cap, offset = pc.adv.offset },
                    measured = new { holdPct = measured!.HoldPct, micro3Pct = measured.Micro3Pct, deadMs = measured.DeadMs, skidMm = measured.SkidMm, turn180Mm = measured.Turn180Mm },
                };
                string path = System.IO.Path.Combine(RolePolicy.EvidenceDir, id + ".json");
                System.IO.File.WriteAllText(path, System.Text.Json.JsonSerializer.Serialize(doc, new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
                Log("evidence saved: " + id + " (cite this id in a build's exception note)");
            }
            catch (Exception e) { Log("evidence save failed: " + e.Message); }
        }

        /// Re-entrancy guard (review 2026-09-14): Ctrl+Enter / Ctrl+Tab could start a second apply
        /// while one was still inside writer.exe - two commits racing on one settings.json.
        async Task DoApply(bool dry, Rig? replay = null)
        {
            if (applying || redetecting) { Log((applying ? "apply" : "redetect") + " already in progress - ignored"); Banner("⚠  " + (applying ? "AN APPLY" : "A REDETECT") + " IS ALREADY RUNNING - wait for it to finish", Warn); return; }
            Banner(dry ? "…  DRY RUN" : "…  APPLYING", Steel);
            applying = true;
            try { await DoApplyCore(dry, replay); } finally { applying = false; }
        }

        async Task DoApplyCore(bool dry, Rig? replay = null)
        {
            if (cur == null) return;
            // Ctrl+Enter is consumed before a NumericUpDown commits typed text: reading .Value validates it (2026-09-16 review)
            PullRig();
            // ONE path for catalogue cards, imports and Advanced builds: a copy with the toggles folded on (Prefill ran on
            // select, so an untouched apply writes the build exactly)
            var p = EffectivePreset();
            var toggles = CurrentToggles();
            rig.HdlEnabled = fHdl.Checked;
            rig.Engine = fCadence.Checked ? "cadence" : "rawaccel";
            rig.ReportHz = (double)fCadHz.Value; rig.MergeMax = (double)fCadMerge.Value;
            xpState.ApplyTo(rig);
            if (Experiments.Any(rig)) Log("experimental: " + Experiments.Describe(rig) + " (Cadence Lock modes; field verdicts pending)");
            mouseState.On = fMouse.Checked; mouseState.ApplyTo(rig);
            if (rig.MirrorMouse && rig.MouseIdPrefixes.Length == 0)
            {
                try
                {
                    // discovered for THIS apply; persisted only after a successful real apply (a dry run never mutates state)
                    rig.MouseIdPrefixes = MouseMirror.DiscoverPrefixes(ra.ReadRoot());
                    Log("mouse: allowlist discovered from RawAccel's own device list: " + (rig.MouseIdPrefixes.Length == 0 ? "(none - open the RawAccel GUI Devices menu once so the mouse is listed)" : string.Join(", ", rig.MouseIdPrefixes)));
                }
                catch (Exception ex) { Log("mouse: could not read RawAccel devices (" + ex.Message + ")"); }
            }
            var rg = rig.Clone();   // snapshot: a control edited mid-apply can no longer desync the verify
            // A/B replays the rig that was APPLIED, exactly (2026-10-11): its third-person gain, mouse mirror and Nib Twin
            // calibration, not whatever tps.txt / mouse.txt / nibtwin.json hold now
            if (replay != null) rg = replay.Clone();
            else ThirdPerson.ApplyTo(rg, p, tpsState);
            var skipped = Experiments.Soften(rg, p, otd.NibBlocker(rg));
            foreach (var sk in skipped) Log("note: " + sk);
            if (rg.TpsGain != 1.0) Log("third-person match: " + ThirdPerson.Describe(tpsState, p) + $" - output multiplier {rg.Mult:0.###} (in-game sensitivity unchanged)");
            Log(dry ? $"--- dry run: {p.name} ---" : $"--- applying {p.name} ---");
            string gameOn = string.Join(", ", (p.filters ?? new List<FilterSpec>()).Where(f => f.on && f.id.StartsWith("AimForge.Filters.")).Select(f => f.id.Replace("AimForge.Filters.", "")));
            if (p.cohOv != null) Log((p.cohOv.IsTapOnly ? "stabilizer: Tap Anchor only (passthrough + click pin)" : $"stabilizer: hold {p.cohOv.hold}ms" + (p.cohOv.tap > 0 ? " + Tap Anchor" : "") + (p.cohOv.lead > 0 ? $" + Lead Sight {p.cohOv.lead}ms" : "")) + (gameOn.Length > 0 ? "; game filter: " + gameOn : "; no game filter"));
            else Log("stabilizer: none" + (gameOn.Length > 0 ? "; game filter: " + gameOn : "; no game filter") + (fHdl.Checked ? " (HDL on)" : " (HDL OFF)"));
            // ONE gate for the GUI and the CLI (2026-09-16 audit): curve QC, role policy, the plan that is actually
            // WRITTEN, the Cadence plugin pre-flight and the pen device config - all before RawAccel is touched.
            List<string> blockers, warnings;
            try { (blockers, warnings) = RolePolicy.GateForApply(p, cat.tablet, () => FilterCatalog.Discover(otd), rg, otd.CadenceBlocker(rg, p), OtdBridge.HoverBlocker(rg), Experiments.Blocker(rg, p), otd.NibBlocker(rg), ra.PenDeviceBlocker()); }
            catch (Exception ex) { Log("refused: the build could not be checked (" + ex.Message + ")"); Banner("✖  NOT APPLIED - the build could not be checked: " + ex.Message, Bad); SetConsole(true); return; }
            foreach (var w in warnings) Log("plan: " + w);
            if (blockers.Count > 0)
            {
                foreach (var b in blockers) Log((dry ? "would refuse: " : "refused: ") + b);
                Banner((dry ? "✖  DRY RUN WOULD REFUSE - " : "✖  NOT APPLIED - ") + blockers[0].Replace("; nothing was written", "").Replace(" - nothing was written", ""), Bad);
                SetConsole(true);
                if (!dry) return;
            }
            bApply.Enabled = bDry.Enabled = false;
            Log($"OTD: after {rg.ResetMs:0}ms of silence the next pen point is a new origin (lift-and-place never yanks the camera)");
            if (p.cohOv != null && otd.PluginNewerThanDaemon(otd.StabilizerDll) != null)
                Log("note: the Coherence Stabilizer plugin was rebuilt after the daemon started - its moving-tap fade is not live until you " + OtdBridge.RestartHint);
            try
            {
                await Task.Run(() =>
                {
                    string bak = ra.Apply(p, rg, dry, Log);
                    bool otdOk;
                    try { otdOk = otd.Apply(p, rg, dry, Log); }
                    catch { if (!dry && bak.Length > 0) { Log("OTD half threw - rolling RawAccel back"); ra.RestoreBackup(bak, Log); } throw; }
                    if (!otdOk && !dry)
                    {
                        // cross-driver rollback: the curve must never be live in both places or in neither
                        if (bak.Length > 0) ra.RestoreBackup(bak, Log);
                        throw new InvalidOperationException("the OTD half did not take" + (otd.LastFailure != null ? " (" + otd.LastFailure + ")" : "") + " - RawAccel was rolled back to the build before this apply; nothing changed");
                    }
                });
                if (!dry)
                {
                    var snap = new Applied(p, rg.Clone(), toggles);
                    // a new A/B partner whenever the build, the rig or a mode differs - not only the card id (2026-09-24 review:
                    // applying the same card with a toggle off then on never became an A/B pair)
                    var abDiff = lastApplied == null ? null : ApplyIdentity.Differences(lastApplied.P, lastApplied.Rg, lastApplied.T, p, rg, toggles);
                    if (lastApplied != null && abDiff!.Count > 0) { prevApplied = lastApplied; Log("A/B (Ctrl+Tab): " + lastApplied.P.name + " vs this apply - differs in " + string.Join(", ", abDiff)); }
                    LastApply.From(p, rg).Save();
                    lastApplied = snap;
                    // the last APPLIED card, mirrored or not (the CLI --mouse on builds from it)
                    mouseState.LastCardId = p.id; mouseState.LastPxMm = rg.PxMm; mouseState.LastMult = rg.Mult;
                    if (rg.MirrorMouse && rg.MouseIdPrefixes.Length > 0) mouseState.Prefixes = rg.MouseIdPrefixes;
                    try { mouseState.Save(); } catch { }
                    // Watchdog: an apply occasionally costs OTD the tablet. Verify and self-heal
                    // once before telling the user anything is wrong.
                    bool alive = await Task.Run(() => otd.TabletResponding());
                    if (!alive)
                    {
                        Log("watchdog: tablet not responding after apply - redetecting");
                        alive = await Task.Run(() => otd.Redetect(Log));
                    }
                    Log(alive ? "applied. Tablet responding. In-game sens per game is in the panel above."
                              : "applied, but the tablet is NOT responding - press Ctrl+D after replugging the cable.");
                    Banner(!alive ? $"⚠  APPLIED {DateTime.Now:HH:mm} - {p.name}, but the tablet is not responding (Ctrl+D after replugging)"
                         : skipped.Count > 0 ? $"⚠  APPLIED {DateTime.Now:HH:mm} - {p.name}, verified; " + string.Join("; ", skipped.Select(x => x.Split(':')[0]))
                         : $"✓  APPLIED {DateTime.Now:HH:mm} - {p.name}, verified by read-back" + (rg.TpsGain != 1.0 ? $" · third-person x{rg.TpsGain:0.00}" : ""),
                         !alive || skipped.Count > 0 ? Warn : Good);
                }
                else { Log("dry run complete"); if (blockers.Count == 0) Banner("✓  DRY RUN OK - " + p.name + " would apply" + (skipped.Count > 0 ? " (" + string.Join("; ", skipped.Select(x => x.Split(':')[0])) + ")" : ""), Good); }
            }
            catch (Exception ex) { Log("ERROR: " + ex.Message); Banner("✖  NOT APPLIED - " + ex.Message, Bad); SetConsole(true); }
            RefreshLive(); bApply.Enabled = bDry.Enabled = true;
        }

        /// A/B compare (mission item 10): the selected build vs the last APPLIED one - the two
        /// things you are actually deciding between - measured on the same rig, QC included.
        async Task DoCompare()
        {
            if (cur == null) return;
            var other = lastApplied != null && lastApplied.P.id != cur.id ? lastApplied : prevApplied;
            if (other == null) { Log("compare: apply something first - A/B compares the selection against the last applied build"); return; }
            bCompare.Enabled = false; Log($"--- compare: {cur.name} ({cur.id})  vs  applied {other.P.name} ({other.P.id}) ---");
            var a = EffectivePreset(); var b = other.P; var rg = rig.Clone(); var rgB = other.Rg.Clone(); var tb = cat.tablet;
            var (ma, mb) = await Task.Run(() =>
                (Measure.Run(Curve.EffectiveLut(a, rg.PxMm), rg, tb), Measure.Run(Curve.EffectiveLut(b, rgB.PxMm), rgB, tb)));
            Log($"  {"",-10} {"hold",8} {"micro3",8} {"dead",7} {"skid",8} {"180mm",7}  tier  QC");
            Log($"  {a.id,-10} {ma.HoldPct,7:0.0}% {ma.Micro3Pct,7:0.0}% {ma.DeadMs,5:0.0}ms {ma.SkidMm,7:0.000} {ma.Turn180Mm,7:0.0}  {RolePolicy.PlanTier(a),-4}  {(Curve.Check(a, tb).Count + RolePolicy.ApplyBlockers(a, rg).Count == 0 ? "pass" : "FAIL")}");
            Log($"  {b.id,-10} {mb.HoldPct,7:0.0}% {mb.Micro3Pct,7:0.0}% {mb.DeadMs,5:0.0}ms {mb.SkidMm,7:0.000} {mb.Turn180Mm,7:0.0}  {RolePolicy.PlanTier(b),-4}  {(Curve.Check(b, tb).Count + RolePolicy.ApplyBlockers(b, rgB).Count == 0 ? "pass" : "FAIL")}");
            bCompare.Enabled = true;
        }

        /// Export the EFFECTIVE build (preset + current rig folded in) as standalone JSON.
        /// Never touches presets.json - the tuner stays the single write path for the roster.
        void DoExportBuild()
        {
            if (cur == null) return;
            using var dlg = new SaveFileDialog { Filter = "AimForge build (*.json)|*.json", FileName = cur.id + "-build.json" };
            if (dlg.ShowDialog() != DialogResult.OK) return;
            var src = EffectivePreset();
            // serialize a deep COPY (2026-09-16 audit: the old fast path handed back the catalogue object and this
            // wrote the rig into the loaded roster)
            var p = System.Text.Json.JsonSerializer.Deserialize<Preset>(System.Text.Json.JsonSerializer.Serialize(src))!;
            p.pxmm = rig.PxMm; p.cm = rig.Cm360; p.snap = rig.SnapDeg; p.hdlMax = rig.HdlMax;
            p.adv.yx = rig.Yx; p.adv.reset = rig.ResetMs; p.adv.mult = rig.Mult;
            System.IO.File.WriteAllText(dlg.FileName, System.Text.Json.JsonSerializer.Serialize(p,
                new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
            Log("exported build -> " + dlg.FileName);
        }

        void DoImportBuild()
        {
            using var dlg = new OpenFileDialog { Filter = "AimForge build (*.json)|*.json" };
            if (dlg.ShowDialog() != DialogResult.OK) return;
            try
            {
                var opts = new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true, NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowReadingFromString };
                var p = System.Text.Json.JsonSerializer.Deserialize<Preset>(System.IO.File.ReadAllText(dlg.FileName), opts)
                        ?? throw new InvalidDataException("empty build file");
                if (string.IsNullOrEmpty(p.id)) throw new InvalidDataException("build has no id");
                // validate BEFORE anything is selected (2026-09-16 review: a rejected import stayed selected and applied)
                if (p.adv == null) throw new InvalidDataException("build has no adv block");
                if (p.lut != null && p.lut.Any(pt => pt == null || pt.Length != 2)) throw new InvalidDataException("every LUT point must be [mm/s, gain]");
                if (!p.IsLut && p.adv.accel == null) throw new InvalidDataException("build has neither a LUT nor classic accel/cap/offset");
                p.name ??= p.id; p.group ??= "Custom"; p.desc ??= "";
                if (p.filters != null)
                {
                    if (p.filters.Any(f => f == null || string.IsNullOrEmpty(f.id))) throw new InvalidDataException("every filter entry needs an id");
                    foreach (var f in p.filters) f.settings ??= new Dictionary<string, double>();
                }
                var probe = Rig.From(p);
                Curve.Summary(Curve.EffectiveLut(p, probe.PxMm), cat.tablet); RolePolicy.Check(p, probe);
                FilterPlan.Fold(p, FilterPlan.Prefill(p));   // the apply path must be able to fold it
                custom = null; Select(p); measured = null; Recalc();
                Log($"imported build '{p.name}' ({p.id}) - QC runs now; the Builds-tab toggles show its own overlay; Ctrl+Enter applies it. presets.json untouched.");
            }
            catch (Exception ex) { Log("import failed: " + ex.Message); }
        }

        /// Pushes ONLY the hover dials to the daemon: no curve, no RawAccel, no re-scan.
        /// Lets hover be tuned while the pen is in the air instead of through a full apply.
        void PushHoverLive()
        {
            if (applying || redetecting) { Log("hover: an apply/redetect is in progress - ignored"); return; }
            PullRig();
            rig.HdlEnabled = fHdl.Checked;
            try { if (otd.SetHoverLive(rig, Log)) LastApply.NoteHover(rig); }
            catch (Exception ex) { Log("hover: " + ex.Message); }
            RefreshLive();
        }

        /// A fresh rig for a card that KEEPS the apply-time modes (mouse mirror, engine) - Rig.From
        /// alone reset them, so the mouse readout lied after every card selection (review 2026-09-14).
        Rig RigFor(Preset p)
        {
            var r = Rig.From(p);
            mouseState.ApplyTo(r);
            r.Engine = fCadence.Checked ? "cadence" : "rawaccel";
            r.HdlMin = (double)fHdlMin.Value;   // the hover-min dial is not a card field: keep it with the rig (2026-09-16 review)
            return r;
        }

        /// The one-line truth about what the mouse HAS, read from RawAccel's live file (cached on its
        /// write time, so a keystroke is not a disk read) - never just the checkbox.
        void UpdateMouseReadout()
        {
            try
            {
                var live = new MouseMirror.Live();
                try
                {
                    var stamp = File.GetLastWriteTimeUtc(ra.SettingsPath);
                    if (raRootCache == null || stamp != raRootStamp) { raRootCache = ra.ReadRoot(); raRootStamp = stamp; }
                    live = MouseMirror.Read(raRootCache);
                }
                catch { }
                bool extras = cur != null && cur.cohOv != null;
                string? stale = live.Exists && mouseState.LastCardId.Length > 0 && cur != null && mouseState.LastCardId != cur.id ? mouseState.LastCardId : null;
                mouseRead.Text = MouseMirror.LiveReadout(rig, live, extras, stale);
            }
            catch (Exception e) { mouseRead.Text = "Mouse: " + e.Message; }
        }

        void RefreshLive()
        {
            UpdateMouseReadout();
            try
            {
                var r = ra.ReadLive(); var o = otd.ReadLive();
                string eng = o.CadenceOn && r.Flat ? "engine: CADENCE LOCK" : !o.CadenceOn && !r.Flat ? "engine: RawAccel" : "engine: MISMATCH - re-apply";
                live.Text = $"live  RawAccel {r}  snap {r.SnapDeg}° Y/X {r.Yx}   {eng}\nlive  OTD {o.PxMm} px/mm  filters: {string.Join(", ", o.EnabledFilters)}  {o.CoherenceSummary}";
                bool tab = otd.TabletDevicePresent(); var la = LastApply.Load();
                statusChips = new List<(string, Color)>
                {
                    ("LIVE  " + (la?.CardName ?? "no apply on record").ToUpperInvariant(), la == null ? Steel : Good),
                    (o.CadenceOn && r.Flat ? "CADENCE LOCK" : !o.CadenceOn && !r.Flat ? "RAWACCEL ENGINE" : "ENGINE MISMATCH", o.CadenceOn == r.Flat ? Good : Bad),
                    (tab ? "TABLET CONNECTED" : "TABLET NOT FOUND", tab ? Good : Bad),
                };
                statusBar.Invalidate();
            }
            catch (Exception e) { live.Text = "live: " + e.Message; }
        }

        void OpenTuner()
        {
            if (File.Exists(tunerHtml)) Process.Start(new ProcessStartInfo(tunerHtml) { UseShellExecute = true });
            else Process.Start(new ProcessStartInfo("https://claude.ai/code/artifact/1dad1027-49ec-44df-a2d5-3ea455a63538") { UseShellExecute = true });
        }

        void Log(string s)
        {
            if (InvokeRequired) { BeginInvoke(new Action(() => Log(s))); return; }
            log.AppendText(s + Environment.NewLine);
        }

        /// Ctrl+D redetect, Ctrl+Enter apply, Ctrl+Tab A/B swap, F5 refresh live readout.
        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (keyData == (Keys.Control | Keys.D)) { _ = DoRedetect(); return true; }
            if (keyData == (Keys.Control | Keys.Enter)) { _ = DoApply(false); return true; }
            if (keyData == Keys.F5) { RefreshLive(); Log("live state refreshed"); return true; }
            if (keyData == (Keys.Control | Keys.Tab))
            {
                if (prevApplied is Applied pv)
                {
                    if (applying || redetecting) { Log("A/B: an apply/redetect is in progress - ignored"); return true; }
                    SelectApplied(pv); _ = DoApply(false, pv.Rg); return true;
                }
            }
            return base.ProcessCmdKey(ref msg, keyData);
        }

        async Task DoRedetect()
        {
            if (applying || redetecting) { Log("redetect: an apply/redetect is already in progress - ignored"); return; }
            redetecting = true;
            try
            {
                bRedetect.Enabled = false; Log("--- redetect (Ctrl+D) ---");
                bool ok = await Task.Run(() => otd.Redetect(Log));
                if (!ok) Log("if the cable was replugged just now, give Windows a second and press Ctrl+D again");
                RefreshLive();
            }
            finally { redetecting = false; bRedetect.Enabled = true; }
        }

        // ================= Advanced tab =================
        // ---- Filters tab: the discovered catalog, not a hardcoded whitelist ----
        void BuildFiltersTab(Control page)
        {
            var split = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 4, ColumnCount = 1, BackColor = Bg, Padding = new Padding(10) };
            split.Padding = new Padding(16, 14, 16, 14);
            split.RowStyles.Add(new RowStyle(SizeType.Absolute, 176));
            split.RowStyles.Add(new RowStyle(SizeType.Percent, 70));
            split.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));
            split.RowStyles.Add(new RowStyle(SizeType.Percent, 30));

            // Active build's declared plan as real rows. The toggles ARE the Builds-tab toggles -
            // one state, two views, one write path (apply from either tab, Ctrl+Enter).
            var planBox = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, BackColor = Panel, Padding = new Padding(10), Margin = new Padding(0, 0, 0, 12) };
            planBox.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            planBox.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 290));
            var planLv = new ListView { Dock = DockStyle.Fill, View = View.Details, FullRowSelect = true, BackColor = Panel, ForeColor = Ink, Font = Mono, HeaderStyle = ColumnHeaderStyle.Nonclickable };
            Theme.DarkList(planLv);
            planLv.Columns.Add("active build plan", 300); planLv.Columns.Add("state", 50); planLv.Columns.Add("tier", 44); planLv.Columns.Add("settings", 620);
            var planSide = new FlowLayoutPanel { Dock = DockStyle.Fill, BackColor = Panel, FlowDirection = FlowDirection.TopDown, Padding = new Padding(14, 2, 0, 0) };
            var planHdr = new Label { Font = Theme.Heading, ForeColor = Ink, Width = 270, Height = 44, Text = "" };
            var pHdl = new Switch { Text = "Hover Distance Limiter", Hint = "T0 · the Builds-tab toggle", Width = 270 };
            var pTap = new Switch { Text = "Tap Anchor", Hint = "T1 · the Builds-tab toggle", Width = 270 };
            var planNote = new Label { Font = Theme.Small, ForeColor = Steel, Width = 270, Height = 52, Text = "Apply (Ctrl+Enter) writes this plan and verifies it by read-back." };
            planSide.Controls.Add(planHdr); planSide.Controls.Add(pHdl); planSide.Controls.Add(pTap); planSide.Controls.Add(planNote);
            bool planSync = false;
            pHdl.CheckedChanged += (s, e) => { if (!planSync) fHdl.Checked = pHdl.Checked; };
            pTap.CheckedChanged += (s, e) => { if (!planSync) fTap.Checked = pTap.Checked; };
            string TierOfPlanId(string id)
            {
                if (id.Contains("Hover_Distance")) return "T0";
                if (id.Contains("Coherence")) return cur?.cohOv == null ? "T1" : FilterCatalog.BuildTier(cur);
                var hit = FilterCatalog.GameFilters.FirstOrDefault(g => id.Contains(g.id) || g.id.EndsWith(id));
                return hit.tier ?? "?";
            }
            void SyncPlan()
            {
                planSync = true;
                pHdl.Checked = fHdl.Checked; pTap.Checked = fTap.Checked;
                planHdr.Text = cur == null ? "no build selected"
                    : cur.name + "\n" + RolePolicy.RoleOf(cur) + " · " + RolePolicy.PlanTier(EffectivePreset());
                planLv.Items.Clear();
                foreach (var f in cur?.filters ?? new List<FilterSpec>())
                {
                    string settings = string.Join("  ", f.settings.Where(kv => kv.Value != 0 || kv.Key.Contains("Hold") || kv.Key.Contains("Max"))
                                                                  .Take(8).Select(kv => kv.Key + "=" + kv.Value.ToString("0.###")));
                    var it = new ListViewItem(new[] { f.id.Replace("AimForge.Filters.", "game: "), f.on ? "ON" : "off", TierOfPlanId(f.id), settings })
                    { ForeColor = f.on ? Good : Steel };
                    planLv.Items.Add(it);
                }
                planSync = false;
            }
            fHdl.CheckedChanged += (s, e) => SyncPlan();
            fTap.CheckedChanged += (s, e) => SyncPlan();
            planBox.Controls.Add(planLv, 0, 0); planBox.Controls.Add(planSide, 1, 0);
            OnShown(page, SyncPlan);
            split.Controls.Add(planBox, 0, 0);

            var lv = new ListView { Dock = DockStyle.Fill, View = View.Details, FullRowSelect = true, BackColor = Panel, ForeColor = Ink, Font = Mono, HeaderStyle = ColumnHeaderStyle.Nonclickable };
            Theme.DarkList(lv);
            lv.Columns.Add("filter", 240); lv.Columns.Add("tier", 50); lv.Columns.Add("stage", 60);
            lv.Columns.Add("live", 60); lv.Columns.Add("registered", 80); lv.Columns.Add("used by", 70); lv.Columns.Add("policy note", 580);

            var refresh = new Button { Text = "↻ rescan filters" };
            Style(refresh); refresh.Width = 170; refresh.Margin = new Padding(0, 8, 0, 6);
            var detail = new Label { Dock = DockStyle.Fill, Font = Theme.Small, ForeColor = Steel, BackColor = Panel, Padding = new Padding(14, 10, 14, 10) };

            List<FilterInfo> catalog = new List<FilterInfo>();
            void Fill()
            {
                try { catalog = FilterCatalog.Discover(otd); } catch { catalog = new List<FilterInfo>(); }
                lv.Items.Clear();
                foreach (var f in catalog)
                {
                    // how many roster builds carry this filter on their declared plan
                    int used = cat.presets.Count(p => (p.filters ?? new List<FilterSpec>())
                        .Any(fs => fs.on && (f.Path.Contains(fs.id, StringComparison.OrdinalIgnoreCase)
                                          || fs.id.Contains(f.Path, StringComparison.OrdinalIgnoreCase))));
                    var it = new ListViewItem(new[]
                    {
                        f.Display, f.LiveTier, f.Stage,
                        f.EnabledLive ? "ON" : "off",
                        f.Registered ? "yes" : "dir only",
                        used > 0 ? used + " builds" : "—",
                        f.Note
                    })
                    { Tag = f, ForeColor = f.EnabledLive ? Good : (f.LiveTier == "T4" || f.LiveTier == "T5" ? Warn : Ink) };
                    lv.Items.Add(it);
                }
                var conflicts = FilterCatalog.Conflicts(catalog);
                detail.Text = (conflicts.Count > 0
                        ? "CONFLICTS:\n" + string.Join("\n", conflicts.Select(c => "  ✖ " + c)) + "\n\n"
                        : "✓ no conflicts in the live chain\n\n")
                    + "Presets author only two filters by design: Hover Distance Limiter (T0, always on) and the\n"
                    + "Coherence Stabilizer (T1 at hold 0 / T3 with hold smoothing / T5 with Lead Sight - the\n"
                    + "wildcard builds). Everything else here is discovered so nothing on this machine is invisible;\n"
                    + "select a row to see its live settings. T4 interpolators stay off on every shipped build.";
            }
            lv.SelectedIndexChanged += (s, e) =>
            {
                if (lv.SelectedItems.Count == 0 || lv.SelectedItems[0].Tag is not FilterInfo f) return;
                detail.Text = f.Display + "  [" + f.LiveTier + ", " + f.Stage + "-transform]\n" + f.Note + "\n\n"
                    + (f.Live.Count == 0 ? "(no live settings registered - open OTD once and Save, or apply a build using it)"
                       : "live settings:  " + string.Join("   ", f.Live.Select(kv => kv.prop + "=" + kv.val)));
            };
            refresh.Click += (s, e) => Fill();
            OnShown(page, () => { if (lv.Items.Count == 0) Fill(); });

            split.Controls.Add(lv, 0, 1);
            split.Controls.Add(refresh, 0, 2);
            split.Controls.Add(detail, 0, 3);
            page.Controls.Add(split);
        }

        void BuildAdvanced(Control page)
        {
            var root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, BackColor = Bg, Padding = new Padding(10) };
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 38)); root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 62));
            root.Padding = new Padding(16, 14, 16, 14);
            page.Controls.Add(root);

            // ---- left: the curve as text, in mm/s ----
            var lp = new Panel { Dock = DockStyle.Fill, BackColor = Panel, Padding = new Padding(16, 10, 16, 12), Margin = new Padding(0, 0, 14, 0) };
            var lh = new Label { Text = "One point per line:  speed mm/s, gain. Authored in PEN speed and converted to counts/ms for your px/mm when applied.", Dock = DockStyle.Top, Height = 40, ForeColor = Steel, Font = Theme.Small };
            var lt = Theme.SectionTitle("Curve points", 400); lt.Dock = DockStyle.Top;
            aLut.Multiline = true; aLut.Dock = DockStyle.Fill; aLut.Font = new Font("Cascadia Mono", 10.5f); aLut.BackColor = Theme.Well; aLut.ForeColor = Ink; aLut.BorderStyle = BorderStyle.None; aLut.ScrollBars = ScrollBars.Vertical;
            Theme.DarkScroll(aLut);
            aLut.TextChanged += (s, e) => ParseAdvanced();
            aVerdict.Dock = DockStyle.Bottom; aVerdict.Height = 96; aVerdict.Font = Mono; aVerdict.ForeColor = Steel; aVerdict.Padding = new Padding(0, 8, 0, 0);
            var lb = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 48, BackColor = Panel, Padding = new Padding(0, 10, 0, 0) };
            var bLoad = new Button { Text = "load selected preset" }; Style(bLoad); bLoad.Width = 150;
            bLoad.Click += (s, e) => LoadIntoAdvanced();
            var bCopyA = new Button { Text = "copy RawAccel string" }; Style(bCopyA); bCopyA.Width = 150;
            bCopyA.Click += (s, e) => { if (custom != null) { var txt = custom.IsLut ? Curve.RawAccelPoints(custom.lut!, rig.PxMm) : Curve.RawAccelPointsDistinct(Curve.EffectiveLut(custom, rig.PxMm), rig.PxMm); Clipboard.SetText(txt); Log("copied " + txt); } };
            var bApplyA = new Button { Text = "apply this build" }; Style(bApplyA, true); bApplyA.Width = 150;
            // rotation / multiplier / tip threshold are applied HERE, not written into the shared rig on every keystroke
            bApplyA.Click += async (s, e) =>
            {
                if (applying || redetecting) { Log("advanced: an apply/redetect is in progress - ignored"); return; }
                PullRig(); ParseAdvanced();   // rebuild from the CURRENT Builds-tab rig (snap, Y/X, px/mm typed there)
                if (custom == null) { Log("advanced: nothing applied - " + aVerdict.Text.Replace(Environment.NewLine, " ")); return; }
                Select(custom); rig.RotationDeg = (double)aRot.Value; rig.Mult = (double)aMult.Value; rig.TpsGain = 1.0; rig.TipThresholdPct = aTipSet.Checked ? (double)aTip.Value : (double?)null; Recalc();
                await DoApply(false);
            };
            lb.Controls.Add(bLoad); lb.Controls.Add(bCopyA); lb.Controls.Add(bApplyA);
            lp.Controls.Add(aLut); lp.Controls.Add(lb); lp.Controls.Add(aVerdict); lp.Controls.Add(lh); lp.Controls.Add(lt);
            foreach (var b in new[] { bLoad, bCopyA, bApplyA }) { b.Width = 150; b.Height = 36; }
            root.Controls.Add(lp, 0, 0);

            // ---- right: every remaining driver parameter ----
            var rp = new FlowLayoutPanel { Dock = DockStyle.Fill, BackColor = Panel, Padding = new Padding(16, 6, 12, 10), FlowDirection = FlowDirection.TopDown, WrapContents = true, AutoScroll = true };
            Theme.DarkScroll(rp);
            Control H(string t) => Theme.SectionTitle(t, 470);

            // live preview of the edited curve, tremor band shaded - the graph updates as you type
            rp.Controls.Add(H("live preview (edited build; ghost = selected preset)"));
            aPreview.Width = 470; aPreview.Height = 190; aPreview.BackColor = Theme.Well; aPreview.Margin = new Padding(0, 0, 0, 4); Theme.DoubleBuffer(aPreview);
            aPreview.Paint += (s, e) =>
            {
                var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.Clear(Theme.Well);
                var r2 = aPreview.ClientRectangle; var plot2 = new Rectangle(r2.X + 34, r2.Y + 6, r2.Width - 44, r2.Height - 24);
                var show = custom ?? cur; if (show == null) return;
                double[][] eff2;
                try { eff2 = Curve.EffectiveLut(show, rig.PxMm); } catch { return; }
                double vmin2 = 1, vmax2 = 1500, gmax2 = Math.Max(1.5, eff2.Max(pt => pt[1]) * 1.1);
                float X2(double v) => (float)(plot2.X + (Math.Log10(Math.Max(v, vmin2)) - 0) / (Math.Log10(vmax2)) * plot2.Width);
                float Y2(double gn) => (float)(plot2.Bottom - gn / gmax2 * plot2.Height);
                using (var band = new SolidBrush(Color.FromArgb(14, Warn))) g.FillRectangle(band, plot2.X, plot2.Top, X2(15) - plot2.X, plot2.Height);
                using var txt2 = new SolidBrush(Steel); using var gridp = new Pen(Line, 1);
                foreach (var v in new[] { 10.0, 100, 1000 }) { g.DrawLine(gridp, X2(v), plot2.Top, X2(v), plot2.Bottom); g.DrawString(v.ToString(), Mono, txt2, X2(v) - 8, plot2.Bottom + 2); }
                using (var unity2 = new Pen(Color.FromArgb(90, Ink), 1) { DashStyle = DashStyle.Dash }) g.DrawLine(unity2, plot2.Left, Y2(1), plot2.Right, Y2(1));
                g.DrawString(gmax2.ToString("0.0"), Mono, txt2, plot2.Left - 30, plot2.Top - 2);
                void DrawEff(double[][] lu, Pen pen)
                {
                    var pts = new System.Collections.Generic.List<PointF>();
                    for (int i = 0; i <= 200; i++) { double v = vmin2 * Math.Pow(vmax2 / vmin2, i / 200.0); pts.Add(new PointF(X2(v), Y2(Curve.GainAt(lu, v)))); }
                    g.DrawLines(pen, pts.ToArray());
                }
                if (custom != null && cur != null && !ReferenceEquals(custom, cur))
                    try { DrawEff(Curve.EffectiveLut(cur, rig.PxMm), new Pen(Color.FromArgb(70, Ink), 1.5f)); } catch { }
                DrawEff(eff2, new Pen(Accent, 2f));
            };
            rp.Controls.Add(aPreview);

            rp.Controls.Add(H("RawAccel - classic mode (used only when ticked)"));
            aClassic.Text = "Classic curve instead of the LUT"; ((Switch)aClassic).Hint = "RawAccel's own accel / cap / offset formula"; aClassic.Width = 470; aClassic.Margin = new Padding(0, 4, 0, 4);
            aClassic.CheckedChanged += (s, e) => ParseAdvanced();
            rp.Controls.Add(aClassic);
            rp.Controls.Add(Row("accel", aAccel, 0, 5, 0.005m, 3, "cap (output)", aCap, 1, 20, 0.1m, 2));
            rp.Controls.Add(Row("input offset", aOffset, 0, 50, 0.1m, 2, "sens mult", aMult, 0.1m, 5, 0.05m, 2));

            rp.Controls.Add(H("RawAccel - profile"));
            rp.Controls.Add(Row("rotation deg", aRot, -45, 45, 0.5m, 1, "snap and Y/X: Builds tab", null, 0, 0, 0, 0));

            rp.Controls.Add(H("OpenTabletDriver"));
            aTipSet.Text = "Set the tip activation threshold"; aTipSet.Width = 330; aTipSet.Height = 34; aTipSet.CheckedChanged += (s, e) => ParseAdvanced();
            var tipRow = new FlowLayoutPanel { Width = 470, Height = 40, BackColor = Panel, Margin = new Padding(0) };
            aTip.Minimum = 0; aTip.Maximum = 90; aTip.DecimalPlaces = 1; aTip.Increment = 0.5m; aTip.Value = 2.0m; aTip.Width = 90; StyleNum(aTip); aTip.Margin = new Padding(8, 6, 0, 0);
            aTip.ValueChanged += (s, e) => ParseAdvanced();
            tipRow.Controls.Add(aTipSet); tipRow.Controls.Add(aTip);
            rp.Controls.Add(tipRow);
            rp.Controls.Add(new Label { Text = "percent. The Tap Anchor arms below this, so keep it ABOVE the arm %.", ForeColor = Steel, Font = Theme.Small, Width = 470, Height = 20 });

            rp.Controls.Add(H("Coherence Stabilizer override (ticked = run the filter)"));
            aCohOn.Text = "Run the Coherence Stabilizer"; ((Switch)aCohOn).Hint = "ticked = this build carries the filter overlay below"; aCohOn.Width = 470; aCohOn.CheckedChanged += (s, e) => ParseAdvanced();
            rp.Controls.Add(aCohOn);
            rp.Controls.Add(Row("hold ms (0=passthrough)", aHold, 0, 2000, 10, 0, "tap anchor 0-1", aTap, 0, 1, 0.1m, 2));
            rp.Controls.Add(Row("tap arm %", aTapArm, 0.1m, 90, 0.1m, 1, "tap hold ms", aTapHold, 0, 500, 5, 0));
            rp.Controls.Add(Row("tap break mm", aTapBreak, 0.02m, 20, 0.1m, 2, "lead ms", aLead, 0, 8, 0.5m, 1));
            rp.Controls.Add(new Label { Text = "Hold 0 with tap 1 is the tap-anchor-only hybrid: exact passthrough, only the pressure-gated click pin runs.", ForeColor = Steel, Font = Theme.Small, Width = 470, Height = 36 });
            root.Controls.Add(rp, 1, 0);

            aMult.Value = 1.0m; aTapArm.Value = 1.0m; aTapHold.Value = 60; aTapBreak.Value = 0.6m; aTap.Value = 1.0m;
        }

        Control Row(string l1, NumericUpDown? n1, decimal mi1, decimal ma1, decimal st1, int d1,
                    string l2, NumericUpDown? n2, decimal mi2, decimal ma2, decimal st2, int d2)
        {
            var row = new FlowLayoutPanel { Width = 540, Height = 34, BackColor = Panel, Margin = new Padding(0, 0, 0, 2), WrapContents = false };
            void Add(string t, NumericUpDown? n, decimal mi, decimal ma, decimal st, int d)
            {
                row.Controls.Add(new Label { Text = t, ForeColor = Steel, Font = Theme.Small, Width = n == null ? 230 : 136, Height = 26, TextAlign = ContentAlignment.MiddleLeft, Margin = new Padding(0, 4, 2, 0) });
                if (n == null) return;
                n.Minimum = mi; n.Maximum = ma; n.Increment = st; n.DecimalPlaces = d; n.Width = 84; StyleNum(n); n.Margin = new Padding(0, 6, 14, 0);
                n.ValueChanged += (s, e) => ParseAdvanced();
                row.Controls.Add(n);
            }
            Add(l1, n1, mi1, ma1, st1, d1); Add(l2, n2, mi2, ma2, st2, d2);
            return row;
        }

        static void StyleNum(NumericUpDown n) => Theme.NumBox(n);

        void LoadIntoAdvanced()
        {
            if (cur == null) return;
            advBase = cur.WithCohOv(cur.cohOv?.Copy());   // the build keeps its name/role, filters and full overlay
            aLut.Text = cur.IsLut ? string.Join(Environment.NewLine, cur.lut!.Select(pt => pt[0].ToString("0.###", System.Globalization.CultureInfo.InvariantCulture) + ", " + pt[1].ToString("0.###", System.Globalization.CultureInfo.InvariantCulture))) : "";
            aClassic.Checked = !cur.IsLut;
            aAccel.Value = (decimal)Math.Min((double)aAccel.Maximum, cur.adv.accel ?? 0);
            aCap.Value = (decimal)Math.Max((double)aCap.Minimum, Math.Min((double)aCap.Maximum, cur.adv.cap ?? 1));
            aOffset.Value = (decimal)Math.Min((double)aOffset.Maximum, cur.adv.offset ?? 0);
            aMult.Value = (decimal)Math.Max((double)aMult.Minimum, cur.adv.mult ?? 1.0);
            aCohOn.Checked = cur.cohOv != null;
            if (cur.cohOv is CohOv c)
            { aHold.Value = (decimal)Math.Min(2000, c.hold); aTap.Value = (decimal)c.tap; aTapArm.Value = (decimal)c.tapArm; aTapHold.Value = (decimal)c.tapHold; aTapBreak.Value = (decimal)Math.Max(0.02, c.tapBreak); aLead.Value = (decimal)Math.Min(8, c.lead); }
            ParseAdvanced();
            Log("advanced: loaded '" + cur.name + "' - edit and press apply");
        }

        void ParseAdvanced()
        {
            aPreview.Invalidate();      // the live preview tracks every keystroke
            try
            {
                var pts = new List<double[]>();
                foreach (var raw in aLut.Text.Split(new[] { '\n', ';' }, StringSplitOptions.RemoveEmptyEntries))
                {
                    var t = raw.Trim().TrimEnd(';'); if (t.Length == 0) continue;
                    var parts = t.Split(',');
                    if (parts.Length != 2) throw new FormatException("'" + t + "' is not 'mm/s, gain'");
                    pts.Add(new[] { double.Parse(parts[0].Trim(), System.Globalization.CultureInfo.InvariantCulture), double.Parse(parts[1].Trim(), System.Globalization.CultureInfo.InvariantCulture) });
                }
                // start from the loaded card (name/role, group, declared game filters, the whole overlay) and overlay only what
                // this tab edits (2026-09-16 review: a fresh 'Custom' build dropped the game filter and was judged as a Master)
                var p = advBase != null ? advBase.WithCohOv(advBase.cohOv?.Copy())
                                        : new Preset { name = "Custom (advanced)", group = "Custom", tag = "theory" };
                p.id = advBase != null ? RolePolicy.BaseId(advBase) + "~adv" : "custom";
                p.name = advBase != null ? advBase.name + " (advanced)" : "Custom (advanced)";
                p.desc = "Built on the Advanced tab" + (advBase != null ? " from " + advBase.name : "") + ". Authored in mm/s; the QC rules apply exactly as to shipped presets.";
                p.pxmm = rig.PxMm; p.cm = rig.Cm360; p.snap = rig.SnapDeg; p.hdlMax = rig.HdlMax;
                p.adv = new Adv { reset = rig.ResetMs, yx = rig.Yx, mult = (double)aMult.Value,
                                  accel = aClassic.Checked ? (double)aAccel.Value : null,
                                  cap = aClassic.Checked ? (double)aCap.Value : null,
                                  offset = aClassic.Checked ? (double)aOffset.Value : null };
                p.lut = aClassic.Checked || pts.Count < 2 ? null : pts.OrderBy(x => x[0]).ToArray();
                if (aCohOn.Checked)
                {
                    var co = p.cohOv ?? new CohOv { rails = 0, settle = 0, anchor = 0 };
                    co.hold = (double)aHold.Value; co.tap = (double)aTap.Value; co.tapArm = (double)aTapArm.Value;
                    co.tapHold = (double)aTapHold.Value; co.tapBreak = (double)aTapBreak.Value; co.lead = (double)aLead.Value;
                    p.cohOv = co;
                }
                else p.cohOv = null;
                // an incomplete build is never the working build (2026-09-16 review: it applied as a flat curve)
                if (!p.IsLut && !aClassic.Checked) { custom = null; aVerdict.ForeColor = Steel; aVerdict.Text = "enter at least two 'mm/s, gain' lines, or tick classic mode"; return; }
                custom = p;
                var issues = p.IsLut ? Curve.Check(p, cat.tablet) : new List<string>();
                if (issues.Count == 0)
                {
                    if (p.IsLut)
                    {
                        var sm = Curve.Summary(p.lut!, cat.tablet);
                        aVerdict.ForeColor = Good;
                        aVerdict.Text = "OK  floor " + sm.floor.ToString("0.00") + "  2u " + sm.twoUnit.ToString("0.00") + "  tap " + sm.tap.ToString("0.00") + "  track " + sm.track.ToString("0.00") + "  cap " + sm.cap.ToString("0.0")
                            + Environment.NewLine + "RawAccel @" + rig.PxMm + "px/mm:" + Environment.NewLine + Curve.RawAccelPoints(p.lut!, rig.PxMm);
                    }
                    else { aVerdict.ForeColor = Good; aVerdict.Text = "OK  classic: accel " + aAccel.Value + "  cap " + aCap.Value + "  offset " + aOffset.Value; }
                }
                else { aVerdict.ForeColor = Bad; aVerdict.Text = "X " + string.Join(Environment.NewLine + "X ", issues.Take(3)); }
            }
            catch (Exception ex) { custom = null; aVerdict.ForeColor = Bad; aVerdict.Text = "parse: " + ex.Message; }
        }

        /// The preset that actually gets applied: a COPY of the selected card with the filter toggles folded onto
        /// the card's OWN overlay and its declared game-filter plan carried (FilterPlan.Fold - selftest-pinned for
        /// every card). The catalogue entry itself is never mutated or returned.
        Preset EffectivePreset()
        {
            var t = CurrentToggles();
            if (prefillShown is FilterPlan.Toggles shown && prefillExact is FilterPlan.Toggles exact && SameToggles(t, shown)) t = exact;
            return FilterPlan.Fold(cur!, t);
        }

        FilterPlan.Toggles CurrentToggles()
            => new FilterPlan.Toggles(fTap.Checked, fCoh.Checked, (double)fHold.Value, (double)fTapArm.Value, (double)fTapHold.Value, (double)fTapBreak.Value);

        /// Ctrl+Tab: put an APPLIED build back in the window exactly as it was written - build, rig and toggles.
        void SelectApplied(Applied a)
        {
            Select(a.P);
            suppress = true;
            try
            {
                fHdl.Checked = a.Rg.HdlEnabled; SetNum(fHdlMin, a.Rg.HdlMin);
                fTap.Checked = a.T.Tap; fCoh.Checked = a.T.Hold;
                SetNum(fTapArm, a.T.TapArm); SetNum(fTapHold, a.T.TapHold); SetNum(fTapBreak, a.T.TapBreak); SetNum(fHold, a.T.HoldMs);
            }
            finally { suppress = false; }
            // the engine and the experimental modes are part of what was applied: restore (and persist) them too
            fCadence.Checked = a.Rg.CadenceEngine; SetNum(fCadHz, a.Rg.ReportHz); SetNum(fCadMerge, a.Rg.MergeMax);
            fIntent.Checked = a.Rg.IntentSpeed; if (a.Rg.ReversalCarryMs > 0) SetNum(fCarryMs, a.Rg.ReversalCarryMs); fCarry.Checked = a.Rg.ReversalCarryMs > 0;
            fTwin.Checked = a.Rg.NibTwin;
            rig = a.Rg.Clone(); ThirdPerson.Strip(rig); PushRig();
            prefillExact = a.T; prefillShown = CurrentToggles();   // replay the applied toggles exactly
            Recalc();
        }

        /// camera --L-- hero --D-- target, to scale, with k = (D+L)/D. Pure drawing from the same numbers the apply uses.
        void PaintTpsDiagram(Graphics g, Size sz)
        {
            if (cur == null || !ThirdPerson.IsThirdPerson(cur)) return;
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            double L = tpsState.ArmFor(cur), D = tpsState.FightM, k = tpsState.KFor(cur);
            float w = sz.Width - 12, y = 14, x0 = 6, xs = (float)(w / (L + D));
            float xh = x0 + (float)(L * xs), xt = x0 + w;
            using var line = new Pen(Steel, 1.5f); using var acc = new SolidBrush(tpsState.On ? Good : Steel); using var ink = new SolidBrush(Steel);
            g.DrawLine(line, x0, y, xt, y);
            g.FillRectangle(ink, x0 - 3, y - 4, 7, 8);                  // camera
            g.FillEllipse(acc, xh - 4, y - 4, 9, 9);                     // hero (the orbit pivot)
            g.FillEllipse(ink, xt - 4, y - 4, 9, 9);                     // target at the matched distance
            var f = Theme.Small;
            g.DrawString($"cam  L {L:0.0} m", f, ink, x0, y + 7);
            var dTxt = $"D {D:0} m  →  k = (D+L)/D = {k:0.00}";
            g.DrawString(dTxt, f, acc, Math.Max(xh + 4, xt - g.MeasureString(dTxt, f).Width), y + 7);
        }

        static void SetNum(NumericUpDown n, double v) => n.Value = (decimal)Math.Clamp(v, (double)n.Minimum, (double)n.Maximum);

        volatile bool calibrating;   // the calibration press log may be live (a forced exit switches it off first)
        Rig? calibratingRig;         // the user's live build while calibrating: a forced exit restores ITS twin (third review)

        /// 'calibrate nib': one transaction (NibCalibrator) on the LIVE build - calibration build, the user taps, fit, save,
        /// restore. Never the card browsed in the window (2026-09-24 review).
        async Task DoNibCalibrate()
        {
            if (applying || redetecting) { Banner("⚠  CALIBRATION NOT STARTED - an apply/redetect is in progress; try again when it finishes", Warn); return; }
            var la = LastApply.Load();
            var (lcard, lrig, why) = NibCalibrator.LiveBuild(la);
            if (lcard == null) { Banner("⚠  CALIBRATION NOT STARTED - " + why, Warn); Log("nib: " + why); return; }
            // 2026-10-11: one in-window flow (NibCalibrateForm) - live tap count, fit numbers explained, opt-in twin
            using var dlg = new NibCalibrateForm(lcard.name, la!.At, lrig!.NibTwin, NibCalibrator.ProbeLog(otd), 1.0 / cat.tablet.unitMm);
            dlg.Started += async optIn =>
            {
                // the tray stays usable while the dialog is open: re-check before taking the lock, and make sure the live build
                // is still the one the dialog named (2026-09-24 review)
                var laNow = LastApply.Load();
                if (applying || redetecting) { dlg.ShowResult(new NibFit.Result { Refused = "an apply/redetect started meanwhile - close this and try again" }, null); return; }
                if (laNow == null || System.Text.Json.JsonSerializer.Serialize(laNow) != System.Text.Json.JsonSerializer.Serialize(la))
                { dlg.ShowResult(new NibFit.Result { Refused = "the live build changed while this was open - close this and press 'calibrate nib' again" }, null); return; }
                calibratingRig = laNow.AppliedRig();
                applying = true; bApply.Enabled = bDry.Enabled = false;
                var before = lastApplied;
                try
                {
                    var res = await Task.Run(() => NibCalibrator.Run(ra, otd, cat.tablet,
                        () => ((Task<bool>)dlg.Invoke(new Func<Task<bool>>(dlg.BeginTapping))).GetAwaiter().GetResult(),
                        Log, 1.0 / cat.tablet.unitMm, laNow, f => calibrating = f, enableTwin: optIn));
                    if (res.Restored != null && lastApplied != null && lastApplied.P.id == laNow.CardId)
                    {
                        lastApplied = lastApplied with { Rg = res.Restored.Clone() };
                        // the twin was turned on by this calibration: Ctrl+Tab compares it with the build before
                        if (before != null && !ApplyIdentity.Same(before.P, before.Rg, before.T, lastApplied.P, lastApplied.Rg, lastApplied.T)) prevApplied = before;
                    }
                    if (res.Restored?.NibTwin == true && !fTwin.Checked) fTwin.Checked = true;   // the Modes switch follows what is live (and persists it)
                    Log(res.Refused != null ? "nib: " + res.Refused
                        : res.Restored?.NibTwin == true ? "nib: calibrated - the live twin uses the new calibration"
                        : "nib: calibrated - tick 'Nib twin' and apply (either engine)");
                    Banner(res.Refused == null ? $"✓  NIB CALIBRATED {DateTime.Now:HH:mm} - swing {res.Cal?.MagMm:0.000} mm, R² {res.Cal?.R2:0.00}" + (res.Restored?.NibTwin == true ? " · twin live" : "")
                                               : "⚠  NIB NOT CALIBRATED - " + res.Refused, res.Refused == null ? Good : Warn);
                    dlg.ShowResult(res, null);
                }
                catch (Exception ex) { Log("nib: ERROR " + ex.Message); Banner("✖  NIB CALIBRATION ERROR - " + ex.Message + " (both drivers were rolled back)", Bad); dlg.ShowResult(new NibFit.Result(), ex.Message); }
                finally { applying = false; bApply.Enabled = bDry.Enabled = true; RefreshLive(); }
            };
            dlg.ShowDialog(this);
            await Task.CompletedTask;
        }

        /// A forced exit mid-calibration would leave the press log live and saved as the daemon default: switch it off
        /// first (bounded by the console calls' own timeouts).
        void ProbeOffBeforeExit()
        {
            if (!calibrating) return;
            try { otd.NibProbeOff(s => { try { log.AppendText(s + Environment.NewLine); } catch { } }, calibratingRig); } catch { }
        }

        void PrefillFilters()
        {
            if (cur == null) return;
            plan = FilterPlan.For(cur);
            var tg = FilterPlan.Prefill(cur);   // the card's OWN overlay, so an untouched apply is the card exactly
            suppress = true;
            try
            {
                fHdl.Checked = true;
                fContact.Checked = false;
                fTap.Checked = tg.Tap;
                fCoh.Checked = tg.Hold;
                SetNum(fTapArm, tg.TapArm); SetNum(fTapHold, tg.TapHold); SetNum(fTapBreak, tg.TapBreak);
                SetNum(fHold, tg.HoldMs);
                fCoh.Enabled = true; fHold.Enabled = true;
                fGoal.Text = "goal: " + plan.Rationale;
            }
            finally { suppress = false; }
            // the controls clamp: remember the exact values so an UNTOUCHED apply still writes the build as authored
            prefillExact = tg; prefillShown = CurrentToggles();
            if (!SameToggles(tg, prefillShown.Value))
                Log($"note: this build's overlay (arm {tg.TapArm}, tap hold {tg.TapHold}, break {tg.TapBreak}, hold {tg.HoldMs}) is outside the Builds-tab ranges; an untouched apply writes it exactly, an edited one writes the clamped values");
        }
        FilterPlan.Toggles? prefillExact, prefillShown;
        static bool SameToggles(FilterPlan.Toggles a, FilterPlan.Toggles b)
            => a.Tap == b.Tap && a.Hold == b.Hold && a.HoldMs == b.HoldMs && a.TapArm == b.TapArm && a.TapHold == b.TapHold && a.TapBreak == b.TapBreak;

        public void SelectById(string id) { var p = cat.Find(id); if (p != null) Select(p); }
        public void ShowAdvancedTab() { nav.Show(1); LoadIntoAdvanced(); }
        public void ShowFiltersTab() { nav.Show(2); }
        public void ShowSideTab(int i) => setTabs.Show(i);
        public void Shutdown()
        {
            if ((applying || redetecting) && !ForceExit()) { Log("exit: an apply/redetect is in progress - exit again within 10 s to force it (a half-written apply can leave the curve in one driver only)"); return; }
            ProbeOffBeforeExit();
            tray.Visible = false; tray.Dispose(); Close(); Application.ExitThread();
        }

        /// Closing mid-apply would kill the transaction between the RawAccel commit and the OTD apply (2026-09-16 review).
        /// A second close within 10 s forces it, so a hung console call can never trap the window.
        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if ((applying || redetecting) && e.CloseReason != CloseReason.WindowsShutDown && e.CloseReason != CloseReason.TaskManagerClosing && !ForceExit())
            { e.Cancel = true; Log("close: an apply/redetect is in progress - close again within 10 s to force it (the apply rolls back on the next start only if you re-apply)"); return; }
            ProbeOffBeforeExit();
            base.OnFormClosing(e);
        }
        DateTime lastExitAttempt = DateTime.MinValue;
        bool ForceExit() { bool force = (DateTime.UtcNow - lastExitAttempt).TotalSeconds < 10; lastExitAttempt = DateTime.UtcNow; return force; }

        /// Headless render for automated visual verification.
        public void Snapshot(string path)
        {
            using var bmp = new Bitmap(Width, Height); DrawToBitmap(bmp, new Rectangle(0, 0, Width, Height)); bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
        }
    }
}
