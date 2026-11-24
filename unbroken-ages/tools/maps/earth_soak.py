"""Plays 12-civilization games on the Earth map to the turn limit and checks them against the targets below.

python3 tools/maps/earth_soak.py [--seeds 1,2,3,4] [--turns 500] [--tables A,B] [--jobs 4] [--out DIR]

Two tables of twelve peoples, each spread over every continent:
  A: Egypt, China, Rome, England, Russia, India, Japan, Aztec, Inca, Mali, Zulu, Mongolia
  B: Greece, Persia, Spain, France, Germany, Ottomans, Arabia, Korea, Khmer, Brazil, America, Ethiopia

Targets (what a good Earth game looks like):
  T1 integrity   every game reaches the turn limit without an error
  T2 expansion   at turn 100 every people has 3+ cities (Venice excepted), and the median people 5+
  T3 survival    all twelve alive at turn 150; 9+ alive at turn 300 on average; 7+ alive at the end
  T4 balance     no people holds more than 30% of the great powers' cities at turn 300, or 40% at the end
  T5 pace        the median people reaches the Industrial era by turn 250 but is not past the Modern era at turn 200 (the calendar's
                 AD 1725); someone reaches the Information era by turn 450
  T6 decision    every game is decided by the turn limit, and at least a third end with a victory other than Score
  T7 conflict    every game has wars (5+ declarations) and conquests (10+ cities captured)
  T8 speed       under 500 ms per turn on average
  T9 variety     across the games, at least three kinds of victory, and no kind wins more than half of them
"""
import argparse, json, os, statistics, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
TABLES = {
    "A": "EGYPT,SONG,ROME,ENGLAND,RUSSIA,INDIA,JAPAN,AZTEC,INCA,MALI,ZULU,MONGOLIA",
    "B": "GREECE,PERSIA,SPAIN,FRANCE,GERMANY,OTTOMAN,ARABIA,KOREA,KHMER,BRAZIL,AMERICA,ETHIOPIA",
}
INDUSTRIAL, MODERN, INFORMATION = 4, 5, 7


def run(table, seed, turns, out):
    path = os.path.join(out, f"earth_{table}_{seed}.json")
    cmd = ["dotnet", "run", "--project", os.path.join(ROOT, "tools", "UnbrokenAges.Tools"), "--no-build", "--", "simulate",
           "--map", "earth", "--civs", TABLES[table], "--turns", str(turns), "--seed", str(seed), "--report", path]
    p = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT)
    ok = p.returncode == 0 and os.path.exists(path)
    report = json.load(open(path)) if ok else None
    return table, seed, ok, report, (p.stderr or "")[-2000:]


def at(report, turn):
    cps = [c for c in report["checkpoints"] if c["turn"] <= turn]
    return cps[-1]["majors"] if cps else []


def evaluate(results, turns):
    checks = {f"T{i}": [] for i in range(1, 10)}
    rows = []
    for table, seed, ok, r, err in results:
        name = f"{table}{seed}"
        if not ok:
            checks["T1"].append((name, False, "crashed: " + err.strip().splitlines()[-1] if err.strip() else "no report"))
            continue
        checks["T1"].append((name, True, "ok"))
        t100, t150, t300, end = at(r, 100), at(r, 150), at(r, 300), r["checkpoints"][-1]["majors"]
        small = [m["civ"] for m in t100 if m["cities"] < 3 and m["civ"] != "CIV_VENICE"]
        median100 = statistics.median(m["cities"] for m in t100)
        checks["T2"].append((name, not small and median100 >= 5, f"median {median100}, under 3: {', '.join(s[4:].title() for s in small) or 'none'}"))
        alive = lambda ms: sum(1 for m in ms if m["alive"])
        checks["T3"].append((name, alive(t150) == 12 and alive(end) >= 7, f"alive t150 {alive(t150)}, t300 {alive(t300)}, end {alive(end)}"))
        def top(ms):
            total = sum(m["cities"] for m in ms) or 1
            best = max(ms, key=lambda m: m["cities"])
            return best["cities"] / total, best["civ"][4:].title()
        s300, w300 = top(t300); send, wend = top(end)
        checks["T4"].append((name, s300 <= 0.30 and send <= 0.40, f"top t300 {w300} {s300:.0%}, end {wend} {send:.0%}"))
        era200 = statistics.median(m["era"] for m in at(r, 200) if m["alive"])
        era250 = statistics.median(m["era"] for m in at(r, 250) if m["alive"])
        info = next((c["turn"] for c in r["checkpoints"] if any(m["era"] >= INFORMATION for m in c["majors"])), None)
        checks["T5"].append((name, era200 <= MODERN and era250 >= INDUSTRIAL and info is not None and info <= 450,
                             f"median era t200 {era200}, t250 {era250}, Information by t{info}"))
        v = r["victories"][0] if r["victories"] else None
        checks["T6"].append((name, v is not None, f"{v['kind']} by {v['winner'][4:].title()} on turn {v['turn']}" if v else "undecided"))
        checks["T7"].append((name, r["wars"] >= 5 and r["captures"] >= 10, f"{r['wars']} wars, {r['captures']} captures"))
        checks["T8"].append((name, r["msPerTurn"] < 500, f"{r['msPerTurn']:.0f} ms/turn"))
        rows.append((name, r, t300, end, v))
    kinds = [r["victories"][0]["kind"] for _, r, _, _, _ in rows if r["victories"]]
    if kinds:
        counts = {k: kinds.count(k) for k in sorted(set(kinds))}
        ok = len(counts) >= 3 and max(counts.values()) * 2 <= len(results)
        checks["T9"].append(("all", ok, ", ".join(f"{k} {n}" for k, n in counts.items())))
    decided = [c for c in checks["T6"] if c[1]]
    non_score = sum(1 for _, ok, text in decided if ok and not text.startswith("Score"))
    t3_avg300 = statistics.mean(int(text.split("t300 ")[1].split(",")[0]) for _, ok, text in checks["T3"]) if checks["T3"] else 0
    return checks, non_score, len(checks["T6"]), t3_avg300, rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", default="1,2,3,4")
    ap.add_argument("--turns", type=int, default=500)
    ap.add_argument("--tables", default="A,B")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--out", default=os.path.join(tempfile.gettempdir(), "earth-soak"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    jobs = [(t, int(s)) for t in a.tables.split(",") for s in a.seeds.split(",")]
    with ThreadPoolExecutor(a.jobs) as pool:
        results = list(pool.map(lambda j: run(j[0], j[1], a.turns, a.out), jobs))
    checks, non_score, games, avg300, rows = evaluate(results, a.turns)
    passed_all = True
    for key, items in checks.items():
        ok = all(i[1] for i in items)
        if key == "T6": ok = ok and non_score * 3 >= games
        if key == "T3": ok = ok and avg300 >= 9
        passed_all &= ok
        extra = f" — non-Score victories {non_score}/{games}" if key == "T6" else f" — average alive at t300 {avg300:.1f}" if key == "T3" else ""
        print(f"{'PASS' if ok else 'FAIL'} {key}{extra}")
        for name, good, text in items: print(f"     {'✓' if good else '✗'} {name}: {text}")
    print("ALL TARGETS MET" if passed_all else "TARGETS NOT MET")
    return 0 if passed_all else 1


if __name__ == "__main__":
    sys.exit(main())
