// F8 Technology & Ideas: effective year per tree (next tech and progress), idea slots and groups.
import techs from "../../data/techs.json";
import ideas from "../../data/ideas.json";
import { ActionButton } from "./ActionButton";
import { useUi } from "./store";

const h = { margin: "12px 0 4px", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.7 } as const;

export function Tech() {
  const { snap, setup } = useUi();
  if (!snap || !setup) return null;
  const t = snap.tech, tag = setup.countries[setup.player]!.tag;
  const national = (ideas.national as Record<string, { name: string }[]>)[tag] ?? [];
  return (
    <>
      <div style={h}>Technology</div>
      <div style={{ fontSize: 11, opacity: 0.6 }}>Each tree advances by literacy and research speed; laggards catch up by diffusion, leaders slow when ahead of the calendar.</div>
      {techs.map((tree, k) => {
        const y = t.years[k]!, next = tree.techs.find((x) => x.year > y), done = tree.techs.filter((x) => x.year <= y).length;
        return (
          <div key={tree.id} style={{ fontSize: 12, margin: "3px 0" }} title={tree.techs.map((x) => `${x.year <= y ? "✓" : "·"} ${x.year} ${x.name}: ${x.description}`).join("\n")}>
            <strong>{tree.name}</strong> {y.toFixed(1)} · {done}/{tree.techs.length}
            {next && <span style={{ opacity: 0.7 }}> · next {next.name} ({next.year})</span>}
            <div style={{ height: 3, background: "#333" }}><div style={{ height: 3, width: `${(100 * done) / tree.techs.length}%`, background: "#4cc9f0" }} /></div>
          </div>
        );
      })}
      <div style={h}>Ideas · {t.ideas.length}/{t.slots} slots</div>
      {national.length > 0 && <div style={{ fontSize: 11, opacity: 0.7 }}>National: {national.map((x) => x.name).join(" · ")}</div>}
      {ideas.groups.map((g, i) => {
        const have = t.ideas.find((x) => x.g === i)?.n ?? 0;
        return (
          <div key={g.id} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", margin: "2px 0" }} title={g.ideas.map((x, j) => `${j < have ? "✓" : "·"} ${x.name}`).join("\n")}>
            <span>{g.name} <span style={{ opacity: 0.6 }}>({g.kind}) {have}/7</span></span>
            {have < 7 && <ActionButton cmd={{ type: "take_idea", payload: { group: i } }}>{have ? "Next" : "Adopt"}</ActionButton>}
          </div>
        );
      })}
    </>
  );
}
