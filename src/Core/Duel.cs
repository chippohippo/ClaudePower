using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace AimForge.Core
{
    /// <summary>
    /// THE DUEL LADDER (2026-11-12) - the optimizer whose objective function is the player. Field verdicts outrank theory
    /// in this project, so the search for a better-than-GOAT build is run ON field verdicts: one dial at a time, one
    /// question at a time ("this or that?"), like an eye test.
    ///
    /// A champion (THE GOAT at the start) meets a challenger that differs in exactly ONE dial by one step. The player
    /// plays both (Ctrl+Tab swaps the last two applied builds) and answers:
    ///   challenger better -> it becomes the champion; the same dial keeps moving the same way (momentum);
    ///   champion better   -> the other direction is tried; when both directions have lost, the step halves and the ladder
    ///                        moves to the next dial;
    ///   cannot tell       -> that dial is settled at this resolution (a smaller step would not be felt either).
    /// It ends when every dial is settled or its step is under the smallest worth feeling. Every answer is kept in
    /// duel.json and written to evidence/ as a field verdict. The optimizer (Hand Print) can seed which dial goes first and
    /// in which direction; without it the order is band, cap speed, cap, base speed.
    /// The GOAT card itself is never changed: the champion is a separate build.
    /// </summary>
    public sealed class Duel
    {
        public sealed class DialState { public double Step { get; set; } public int Dir { get; set; } = 1; public bool TriedOther { get; set; } public bool Settled { get; set; } }
        public sealed class Round
        {
            public string Date { get; set; } = ""; public string Dial { get; set; } = ""; public string Verdict { get; set; } = "";
            public string Champion { get; set; } = ""; public string Challenger { get; set; } = ""; public string Note { get; set; } = "";
        }
        public sealed class Spec { public string Name = "", Label = ""; public double Step0, MinStep, Lo, Hi; public bool Relative; }

        public static readonly Spec[] Specs =
        {
            new Spec { Name = "band", Label = "1:1 band (fingertip and wrist zone)", Step0 = 10, MinStep = 2.5, Lo = 10, Hi = 100 },
            new Spec { Name = "onset", Label = "full-power speed (where the arm gets the cap)", Step0 = 40, MinStep = 10, Lo = 80, Hi = 420 },
            new Spec { Name = "power", Label = "arm power (the cap)", Step0 = 0.5, MinStep = 0.125, Lo = 1.5, Hi = 6 },
            new Spec { Name = "base", Label = "base speed (cm/360)", Step0 = 0.08, MinStep = 0.02, Lo = 0.6, Hi = 1.5, Relative = true },
        };

        // ---- persisted state ----
        public double Band { get; set; } = Dials.Goat.Band;
        public double Cap { get; set; } = Dials.Goat.Cap;
        public double CapAt { get; set; } = Dials.Goat.CapAt;
        public double Cm { get; set; } = Dials.Goat.Cm;
        public string Started { get; set; } = "";
        public List<string> Order { get; set; } = Specs.Select(s => s.Name).ToList();
        public Dictionary<string, DialState> State { get; set; } = Specs.ToDictionary(s => s.Name, s => new DialState { Step = s.Step0 });
        public int Current { get; set; }
        public List<Round> History { get; set; } = new();

        public static string DefaultPath => Path.Combine(AppContext.BaseDirectory, "duel.json");
        [JsonIgnore] public Dials Champion => new Dials(Band, Cap, CapAt, Cm);
        [JsonIgnore] public bool ChampionIsGoat => Math.Abs(Band - Dials.Goat.Band) < 1e-9 && Math.Abs(Cap - Dials.Goat.Cap) < 1e-9 && Math.Abs(CapAt - Dials.Goat.CapAt) < 1e-9 && Math.Abs(Cm - Dials.Goat.Cm) < 1e-9;
        [JsonIgnore] public bool Finished => Order.All(n => State[n].Settled);
        [JsonIgnore] public string CurrentDial => Order[Math.Clamp(Current, 0, Order.Count - 1)];
        [JsonIgnore] public int Wins => History.Count(h => h.Verdict == "challenger");

        public static Duel Load(string? path = null)
        {
            try
            {
                string f = path ?? DefaultPath;
                if (File.Exists(f) && JsonSerializer.Deserialize<Duel>(File.ReadAllText(f)) is Duel d && d.Order.Count == Specs.Length && Specs.All(s => d.State.ContainsKey(s.Name))) return d;
            }
            catch { }
            return new Duel();
        }
        public void Save(string? path = null) => File.WriteAllText(path ?? DefaultPath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));

        static Spec SpecOf(string name) => Specs.First(s => s.Name == name);

        /// Start the ladder where the optimizer points: the dial it moves most goes first, each in the direction it moved.
        public void SeedFrom(Dials best)
        {
            var g = Champion;
            var moves = new (string n, double lr)[]
            {
                ("band", Math.Log(Math.Max(1, best.Band) / Math.Max(1, g.Band))), ("onset", Math.Log(best.CapAt / g.CapAt)),
                ("power", Math.Log(best.Cap / g.Cap)), ("base", Math.Log(g.Cm / best.Cm)),
            };
            Order = moves.OrderByDescending(m => Math.Abs(m.lr)).Select(m => m.n).ToList();
            foreach (var (n, lr) in moves) if (Math.Abs(lr) > 1e-9) State[n].Dir = lr > 0 ? 1 : -1;
            Current = 0;
        }

        static Dials Move(Dials d, string dial, double delta)
        {
            switch (dial)
            {
                case "band": return new Dials(d.Band + delta, d.Cap, Math.Max(d.CapAt, d.Band + delta + 50), d.Cm);
                case "onset": return new Dials(d.Band, d.Cap, d.CapAt + delta, d.Cm);
                case "power": return new Dials(d.Band, d.Cap + delta, d.CapAt, d.Cm);
                default: return new Dials(d.Band, d.Cap, d.CapAt, d.Cm / (1 + delta));   // base: +8% speed = cm / 1.08
            }
        }
        static double ValueOf(Dials d, string dial) => dial switch { "band" => d.Band, "onset" => d.CapAt, "power" => d.Cap, _ => Dials.Goat.Cm / d.Cm };

        /// The challenger of the current round, or null when the ladder is finished. Clamped to each dial's range; a
        /// direction that the range forbids counts as lost.
        public Dials? Challenger()
        {
            for (int guard = 0; guard < 64 && !Finished; guard++)
            {
                string dial = CurrentDial; var sp = SpecOf(dial); var st = State[dial];
                if (st.Settled) { Advance(); continue; }
                var c = Move(Champion, dial, st.Dir * st.Step);
                double v = ValueOf(c, dial);
                bool legal = v >= sp.Lo - 1e-9 && v <= sp.Hi + 1e-9 && c.IsValid && (dial != "onset" || c.CapAt >= c.Band + 50);
                if (legal) return c;
                Lost(st, sp);   // this direction is out of range: as if it lost
            }
            return null;
        }

        void Lost(DialState st, Spec sp)
        {
            if (!st.TriedOther) { st.Dir = -st.Dir; st.TriedOther = true; return; }
            st.Step /= 2; st.TriedOther = false;
            if (st.Step < sp.MinStep - 1e-12) st.Settled = true;
            Advance();
        }

        void Advance()
        {
            for (int i = 1; i <= Order.Count; i++)
            {
                int n = (Current + i) % Order.Count;
                if (!State[Order[n]].Settled) { Current = n; return; }
            }
        }

        /// One answer. verdict: "challenger", "champion" or "same". Returns what happened, in the player's words.
        public string Answer(string verdict, string note = "", DateTime? now = null)
        {
            var ch = Challenger(); if (ch is not Dials c) return "the ladder is finished";
            string dial = CurrentDial; var sp = SpecOf(dial); var st = State[dial]; var champ = Champion;
            if (Started.Length == 0) Started = (now ?? DateTime.Now).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            History.Add(new Round { Date = (now ?? DateTime.Now).ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture), Dial = dial, Verdict = verdict, Champion = champ.ToString(), Challenger = c.ToString(), Note = note });
            switch (verdict)
            {
                case "challenger":
                    Band = c.Band; Cap = c.Cap; CapAt = c.CapAt; Cm = c.Cm; st.TriedOther = true;
                    return $"new champion: {c}. The {sp.Label} keeps moving the same way next round.";
                case "champion":
                    bool flipped = !st.TriedOther; Lost(st, sp);
                    return flipped ? $"the champion holds. Next: the {sp.Label} the other way."
                         : st.Settled ? $"the champion holds both ways: the {sp.Label} is settled." : $"the champion holds both ways: the {sp.Label} step halves; on to the next dial.";
                case "same":
                    st.Settled = true; Advance();
                    return $"no difference felt: the {sp.Label} is settled at this resolution.";
                default: History.RemoveAt(History.Count - 1); return "verdict must be challenger, champion or same";
            }
        }

        public Preset ChampionPreset(Preset goatCard)
            => ChampionIsGoat ? goatCard : Champion.ToPreset(goatCard, "duel-champion", "Duel Champion",
                   $"DUEL CHAMPION after {History.Count} round{(History.Count == 1 ? "" : "s")} ({Wins} won by a challenger). {Champion}. {Champion.Versus(Dials.Goat)}. The GOAT's rig otherwise.");
        public Preset? ChallengerPreset(Preset goatCard)
            => Challenger() is Dials c ? c.ToPreset(goatCard, "duel-challenger", "Duel Challenger",
                   $"DUEL CHALLENGER, round {History.Count + 1}: one dial moved - {c.Versus(Champion, "the champion")}. {c}. The GOAT's rig otherwise.") : null;

        /// Where the ladder stands, for the window and --duel status.
        public string Describe()
        {
            var o = new List<string> { $"champion:   {Champion}" + (ChampionIsGoat ? "   (THE GOAT)" : $"   ({Champion.Versus(Dials.Goat)})") };
            if (Challenger() is Dials c)
            {
                var sp = SpecOf(CurrentDial);
                o.Add($"challenger: {c}");
                o.Add($"round {History.Count + 1} - one dial moved, the {sp.Label}: {c.Versus(Champion, "the champion")}");
            }
            else o.Add("the ladder is finished: every dial is settled. The champion is your build.");
            o.Add($"rounds played {History.Count}, challenger wins {Wins}; dials settled: {string.Join(", ", Order.Where(n => State[n].Settled).DefaultIfEmpty("none"))}");
            return string.Join(Environment.NewLine, o);
        }

        /// The ladder's answers as a field-verdict evidence record (evidence/ev-&lt;start&gt;-duel.json).
        [JsonIgnore] public string EvidenceId => "ev-" + (Started.Length > 0 ? Started.Replace("-", "") : "00000000") + "-duel";
        public string EvidenceJson()
            => JsonSerializer.Serialize(new
            {
                evidenceId = EvidenceId, date = Started, kind = "field verdicts (duel ladder)",
                method = "one dial moved per round against the champion; the player's answer after playing both (challenger / champion / same); coordinate pattern search with step halving",
                start = Dials.Goat.ToString(), champion = Champion.ToString(), championVsGoat = Champion.Versus(Dials.Goat), finished = Finished,
                rounds = History,
            }, new JsonSerializerOptions { WriteIndented = true });
    }
}
