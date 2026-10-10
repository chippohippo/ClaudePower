// F1 Government: laws, stability, automation toggles, tax rate.
import { LAWS } from "../sim/laws";
import { AUTO_BUDGET, AUTO_BUILD, AUTO_DEVELOP } from "../sim/setup";
import { ActionButton } from "./ActionButton";
import { useUi } from "./store";

const h = { margin: "12px 0 4px", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.7 } as const;
const AUTOS = [[AUTO_DEVELOP, "Auto-develop", "Spend ADM/DIP/MIL on the cheapest development when points pass 600"], [AUTO_BUILD, "Auto-construct", "The state picks and funds construction projects"], [AUTO_BUDGET, "Auto-budget", "Adjust the tax rate yearly toward a balanced budget"]] as const;

export function Government() {
  const p = useUi((s) => s.snap?.player);
  if (!p) return null;
  return (
    <>
      <div style={h}>Stability {p.stability.toFixed(2)}</div>
      <ActionButton cmd={{ type: "raise_stability", payload: {} }}>Raise stability (+0.5)</ActionButton>
      <div style={h}>Automation</div>
      {AUTOS.map(([flag, name, desc]) => (
        <div key={flag} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "3px 0" }} title={desc}>
          <span>{name}</span>
          <ActionButton cmd={{ type: "set_automation", payload: { flags: p.automation ^ flag } }} style={{ background: p.automation & flag ? "#2d6a4f" : "#5c2b2b" }}>
            {p.automation & flag ? "ON" : "OFF"}
          </ActionButton>
        </div>
      ))}
      <div style={h}>Tax rate {Math.round(p.taxRate * 100)}%</div>
      <div style={{ display: "flex", gap: 4 }}>
        {[-0.05, -0.01, 0.01, 0.05].map((d) => (
          <ActionButton key={d} cmd={{ type: "set_tax_rate", payload: { rate: Math.round((p.taxRate + d) * 100) / 100 } }}>{d > 0 ? "+" : "−"}{Math.abs(d * 100)}%</ActionButton>
        ))}
      </div>
      {LAWS.map((cat, k) => (
        <div key={cat.id}>
          <div style={h}>{cat.name}</div>
          {cat.laws.map((law, j) => (
            <div key={law.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "3px 0", gap: 6 }}>
              <span style={{ fontWeight: p.laws[k] === j ? 700 : 400, color: p.laws[k] === j ? "#ffd60a" : undefined }} title={law.description}>{p.laws[k] === j ? "● " : ""}{law.name}</span>
              {p.laws[k] !== j && <ActionButton cmd={{ type: "set_law", payload: { category: k, law: j } }}>Enact</ActionButton>}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
