using System;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using AimForge.Core;

namespace AimForge.App
{
    /// <summary>
    /// The duel ladder's window (2026-11-12): champion against a challenger that moves ONE dial; the player applies both,
    /// plays, and answers. Modeless, so the main window stays live (Ctrl+Tab swaps the last two applied builds there).
    /// The logic is Core/Duel.cs; this window only shows it, applies through the main window's own verified apply, and
    /// records each answer (duel.json + an evidence record).
    /// </summary>
    sealed class DuelForm : Form
    {
        readonly Duel duel; readonly Preset goat; readonly Func<Preset, Task<bool>> apply; readonly Action<string> log;
        readonly Label head = new Label(), body = new Label(), champ = new Label(), chal = new Label(), what = new Label(), status = new Label();
        readonly Button bChal = new Button(), bChamp = new Button(), vChal = new Button(), vChamp = new Button(), vSame = new Button(), bReset = new Button(), bClose = new Button();
        bool challengerTried, busy;

        public DuelForm(Duel duel, Preset goatCard, Func<Preset, Task<bool>> apply, Action<string> log)
        {
            this.duel = duel; goat = goatCard; this.apply = apply; this.log = log;
            Text = "AimForge - the duel"; FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = MinimizeBox = false; ShowInTaskbar = false;
            StartPosition = FormStartPosition.CenterParent; ClientSize = new Size(640, 392); BackColor = Theme.Bg; ForeColor = Theme.Ink; Font = Theme.Body;
            var col = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(18, 14, 18, 10) };
            head.Font = Theme.Heading; head.AutoSize = true;
            body.MaximumSize = new Size(600, 0); body.AutoSize = true; body.ForeColor = Theme.Steel; body.Margin = new Padding(0, 6, 0, 10);
            body.Text = "An eye test for your aim: the champion against a challenger that differs in ONE dial. Apply each, play a few fights on both " +
                        "(Ctrl+Tab in the main window swaps the last two applied builds), then answer. Your answers are the search: a win keeps the dial moving, " +
                        "two losses shrink its step, 'can't tell' settles it. THE GOAT card itself is never changed.";
            foreach (var l in new[] { champ, chal, what, status }) { l.MaximumSize = new Size(600, 0); l.AutoSize = true; l.Margin = new Padding(0, 2, 0, 2); }
            what.ForeColor = Theme.Teal; what.Margin = new Padding(0, 6, 0, 6); status.ForeColor = Theme.Steel; status.Margin = new Padding(0, 8, 0, 0);
            var row1 = new FlowLayoutPanel { AutoSize = true, Margin = new Padding(0, 6, 0, 0) };
            Theme.Button(bChal, "APPLY CHALLENGER", primary: true); bChal.Width = 180;
            Theme.Button(bChamp, "APPLY CHAMPION"); bChamp.Width = 170;
            row1.Controls.AddRange(new Control[] { bChal, bChamp });
            var row2 = new FlowLayoutPanel { AutoSize = true, Margin = new Padding(0, 8, 0, 0) };
            Theme.Button(vChal, "CHALLENGER BETTER"); vChal.Width = 180;
            Theme.Button(vChamp, "CHAMPION BETTER"); vChamp.Width = 170;
            Theme.Button(vSame, "CAN'T TELL"); vSame.Width = 120;
            row2.Controls.AddRange(new Control[] { vChal, vChamp, vSame });
            var row3 = new FlowLayoutPanel { AutoSize = true, Margin = new Padding(0, 12, 0, 0) };
            Theme.Button(bReset, "RESTART FROM THE GOAT"); bReset.Width = 210;
            Theme.Button(bClose, "CLOSE"); bClose.Width = 100;
            row3.Controls.AddRange(new Control[] { bReset, bClose });
            col.Controls.AddRange(new Control[] { head, body, champ, chal, what, row1, row2, status, row3 });
            Controls.Add(col);
            CancelButton = bClose;

            bChal.Click += async (s, e) => { if (duel.ChallengerPreset(goat) is Preset p && await Apply(p, "challenger")) { challengerTried = true; Refresh2(); } };
            bChamp.Click += async (s, e) => await Apply(duel.ChampionPreset(goat), "champion");
            vChal.Click += (s, e) => Answer("challenger");
            vChamp.Click += (s, e) => Answer("champion");
            vSame.Click += (s, e) => Answer("same");
            bReset.Click += (s, e) =>
            {
                if (MessageBox.Show(this, "Restart the ladder from THE GOAT? The answers so far stay in the evidence file.", "AimForge - the duel", MessageBoxButtons.OKCancel) != DialogResult.OK) return;
                var fresh = new Duel(); duel.Band = fresh.Band; duel.Cap = fresh.Cap; duel.CapAt = fresh.CapAt; duel.Cm = fresh.Cm; duel.Order = fresh.Order; duel.State = fresh.State; duel.Current = 0; duel.History.Clear(); duel.Started = "";
                Persist(); challengerTried = false; log("duel: ladder restarted from THE GOAT"); Refresh2();
            };
            bClose.Click += (s, e) => Close();
            Refresh2();
        }

        async Task<bool> Apply(Preset p, string who)
        {
            if (busy) return false;
            busy = true; SetButtons();
            status.ForeColor = Theme.Steel; status.Text = $"applying the {who}...";
            bool ok = false;
            try { ok = await apply(p); }
            catch (Exception ex) { log("duel: apply failed - " + ex.Message); }
            busy = false;
            status.ForeColor = ok ? Theme.Teal : Theme.Bad;
            status.Text = ok ? $"the {who} is live. Play, then apply the other one (or Ctrl+Tab in the main window)." : $"the {who} was NOT applied - see the main window's console.";
            SetButtons();
            return ok;
        }

        void Answer(string verdict)
        {
            string msg = duel.Answer(verdict);
            Persist();
            log("duel: " + msg);
            challengerTried = false; Refresh2();
            status.ForeColor = Theme.Teal; status.Text = msg;
        }

        void Persist()
        {
            try
            {
                duel.Save();
                if (duel.History.Count > 0) { Directory.CreateDirectory(RolePolicy.EvidenceDir); File.WriteAllText(Path.Combine(RolePolicy.EvidenceDir, duel.EvidenceId + ".json"), duel.EvidenceJson()); }
            }
            catch (Exception ex) { log("duel: could not save (" + ex.Message + ") - the answer holds for this session only"); }
        }

        void SetButtons()
        {
            bool live = !busy && !duel.Finished;
            bChal.Enabled = live; bChamp.Enabled = !busy;
            // an answer needs the challenger to have been live this round (the champion is the build you already know)
            vChal.Enabled = vChamp.Enabled = vSame.Enabled = live && challengerTried;
            bReset.Enabled = !busy;
        }

        void Refresh2()
        {
            var ch = duel.Challenger();   // may settle a dial whose range is exhausted
            head.Text = duel.Finished ? "THE DUEL  ·  FINISHED" : $"THE DUEL  ·  ROUND {duel.History.Count + 1}";
            champ.Text = "CHAMPION     " + duel.Champion + (duel.ChampionIsGoat ? "     (THE GOAT)" : "");
            if (ch is Dials c)
            {
                chal.Text = "CHALLENGER   " + c;
                what.Text = "this round: " + c.Versus(duel.Champion, "the champion");
            }
            else
            {
                chal.Text = "";
                what.Text = duel.ChampionIsGoat ? "Every dial is settled and nothing beat THE GOAT: it is your build."
                                                : "Every dial is settled. The champion is your build: " + duel.Champion.Versus(Dials.Goat) + ". Apply it and export it from the main window.";
            }
            if (status.Text.Length == 0)
                status.Text = $"{duel.History.Count} round{(duel.History.Count == 1 ? "" : "s")} played, {duel.Wins} won by a challenger." + (challengerTried ? "" : " Apply the challenger to unlock the answers.");
            SetButtons();
        }
    }
}
