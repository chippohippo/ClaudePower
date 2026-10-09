// Left dock: Economy (F2) and Population (F3) panels for the inspected country.
import type { CountryReport } from "../sim/inspect";
import { LineChart } from "./Chart";
import { Stat } from "./Stat";
import { fmtBig, fmtMoney, fmtPct } from "./format";
import { useUi } from "./store";

const box = { position: "absolute", top: 40, left: 0, bottom: 0, width: 330, overflowY: "auto", padding: 12, background: "rgba(15,17,26,0.95)", color: "#eee", fontSize: 13, zIndex: 3 } as const;
const h = { margin: "10px 0 4px", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.7 } as const;

export function Dock() {
  const { dock, report, setup, set } = useUi();
  if (!dock) return null;
  if (!report || !setup) return <div style={box}>Loading report…</div>;
  const country = setup.countries.find((c) => c.tag === report.tag);
  return (
    <div style={box}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: 15 }}>{country?.name ?? report.tag} — {dock === "economy" ? "Economy" : "Population"}</strong>
        <button onClick={() => set({ dock: null })} style={{ background: "none", color: "#eee", border: "none", cursor: "pointer" }}>✕</button>
      </div>
      {dock === "economy" ? <Economy r={report} /> : <Population r={report} />}
    </div>
  );
}

function Economy({ r }: { r: CountryReport }) {
  const s = r.stats, hs = r.history.series, years = r.history.years;
  const income = r.budget.filter((b) => b.value > 0), spend = r.budget.filter((b) => b.value < 0);
  return (
    <>
      <div style={h}>Overview</div>
      <Stat label="GDP (year)" value={fmtMoney(s.gdpYear!)} why={r.explain.gdp} />
      <Stat label="GDP per capita" value={fmtMoney(s.gdpPerCapita!)} />
      <Stat label="Treasury" value={fmtMoney(s.treasury!)} />
      <Stat label="Debt" value={`${fmtMoney(s.debt!)} (${(s.debt! / Math.max(1, s.gdpYear!)).toFixed(2)}× GDP)`} />
      <Stat label="Tax rate" value={fmtPct(s.taxRate!, 0)} />
      <Stat label="Inflation (yearly)" value={fmtPct(s.inflation!)} why={r.explain.inflation} />
      <Stat label="Unemployment" value={fmtPct(s.unemployment!)} />
      <div style={h}>Budget this month</div>
      {income.map((b) => <Stat key={b.line} label={b.line.replace("_", " ")} value={`+${fmtMoney(b.value)}`} />)}
      {spend.map((b) => <Stat key={b.line} label={b.line.replace("_", " ")} value={`−${fmtMoney(-b.value)}`} />)}
      <div style={h}>History</div>
      <LineChart years={years} values={hs.gdpYear!.map((g, i) => g / Math.max(1, hs.population![i]!) / 100)} label="GDP per capita ($)" format={(v) => `$${fmtBig(v)}`} />
      <LineChart years={years} values={hs.inflation!.map((x) => 100 * x)} label="Inflation (%)" format={(v) => `${v.toFixed(1)}%`} color="#ffb703" />
      <LineChart years={years} values={hs.unemployment!.map((x) => 100 * x)} label="Unemployment (%)" format={(v) => `${v.toFixed(1)}%`} color="#e76f51" />
      <div style={h}>Market</div>
      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
        <thead><tr style={{ opacity: 0.7 }}><th align="left">Good</th><th align="right">Price</th><th align="right">Supply</th><th align="right">Demand</th></tr></thead>
        <tbody>
          {r.market.map((m) => (
            <tr key={m.good} title={`Price = base × clamp((demand/supply)^0.6, 0.25, 4), smoothed ±10%/month. Base ${(m.base / 100).toFixed(2)}`}>
              <td>{m.good}</td>
              <td align="right" style={{ color: m.price > m.base * 1.2 ? "#e76f51" : m.price < m.base * 0.8 ? "#8ecae6" : undefined }}>{(m.price / 100).toFixed(2)}</td>
              <td align="right">{fmtBig(m.supply)}</td><td align="right">{fmtBig(m.demand)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={h}>Industry</div>
      <table style={{ width: "100%", fontSize: 12 }}>
        <tbody>
          {r.sectors.map((x) => (
            <tr key={x.name} title={`Method: ${x.pm}. Staffing ${fmtPct(x.staffing, 0)}. Profit ${fmtMoney(x.profit)}/month`}>
              <td>{x.name}</td><td align="right">{fmtBig(x.levels)} lv</td><td align="right">{fmtPct(x.staffing, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Population({ r }: { r: CountryReport }) {
  const s = r.stats, hs = r.history.series, years = r.history.years;
  const total = Math.max(1, s.population!);
  return (
    <>
      <div style={h}>Overview</div>
      <Stat label="Population" value={fmtBig(s.population!)} />
      <Stat label="Standard of living" value={s.sol!.toFixed(0)} why={r.explain.sol} />
      <Stat label="Life expectancy" value={s.lifeExp!.toFixed(1)} why={r.explain.lifeExp} />
      <Stat label="Fertility (TFR)" value={s.tfr!.toFixed(2)} why={r.explain.tfr} />
      <Stat label="Literacy" value={fmtPct(s.literacy!)} why={r.explain.literacy} />
      <Stat label="Urbanisation" value={fmtPct(s.urban!)} />
      <Stat label="Ages 0–14 / 15–64 / 65+" value={r.ages.map((a) => fmtPct(a / total, 0)).join(" / ")} />
      <div style={h}>History</div>
      <LineChart years={years} values={hs.population!} label="Population" format={fmtBig} />
      <LineChart years={years} values={hs.lifeExp!} label="Life expectancy" format={(v) => v.toFixed(1)} color="#90be6d" />
      <LineChart years={years} values={hs.tfr!} label="Fertility (TFR)" format={(v) => v.toFixed(2)} color="#f9c74f" />
      <LineChart years={years} values={hs.urban!.map((x) => 100 * x)} label="Urbanisation (%)" format={(v) => `${v.toFixed(0)}%`} color="#577590" />
      <div style={h}>Strata</div>
      <table style={{ width: "100%", fontSize: 12 }}>
        <thead><tr style={{ opacity: 0.7 }}><th align="left">Stratum</th><th align="right">Share</th><th align="right">SoL</th><th align="right">Wage/mo</th></tr></thead>
        <tbody>
          {r.strata.filter((x) => x.size > 0).map((x) => (
            <tr key={x.name} title={`Literacy ${fmtPct(x.literacy, 0)} · unemployment ${fmtPct(x.unemployment, 0)}`}>
              <td>{x.name}</td><td align="right">{fmtPct(x.size / total, 1)}</td><td align="right">{x.sol.toFixed(0)}</td><td align="right">{fmtMoney(x.wage)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={h}>Cultures</div>
      {r.cultures.map((c) => <Stat key={c.name} label={c.name} value={fmtPct(c.size / total)} />)}
      <div style={h}>Religions</div>
      {r.religions.map((c) => <Stat key={c.name} label={c.name} value={fmtPct(c.size / total)} />)}
    </>
  );
}
