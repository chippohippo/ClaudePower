// Government panel section: head, heir, cabinet (4), high command (3), candidate pool, academy.
import { useState } from "react";
import type { CharacterInfo } from "../worker/protocol";
import { IGS } from "../sim/igs";
import { CABINET_SLOTS, HIGH_COMMAND_SLOTS } from "../sim/characters";
import { ActionButton, btnStyle } from "./ActionButton";
import { Portrait } from "./Portrait";
import { useUi } from "./store";

const IDEO = ["Democratic", "Fascist", "Communist", "Non-aligned"];
const h = { margin: "12px 0 4px", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.7 } as const;

export function CharacterCard({ c, title, year, children }: { c: CharacterInfo | null; title: string; year: number; children?: React.ReactNode }) {
  if (!c) return <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "4px 0", opacity: 0.6 }}><div style={{ width: 44, height: 44, border: "1px dashed #666", borderRadius: 4 }} /><div><div style={{ fontSize: 11, opacity: 0.7 }}>{title}</div><em>Vacant</em>{children}</div></div>;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "4px 0" }} title={`${IDEO[c.ideology]} · loyalty ${c.loyalty.toFixed(0)}${c.ig >= 0 ? ` · ${IGS[c.ig]!.name}` : ""}`}>
      <Portrait c={c} size={44} year={year} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, opacity: 0.7 }}>{title}</div>
        <div><strong>{c.name}</strong> <span style={{ opacity: 0.7 }}>({c.age})</span></div>
        <div style={{ fontSize: 11 }}>🏛{c.adm} 🕊{c.dip} ⚔{c.mil} {c.traits.length ? `· ${c.traits.join(", ")}` : ""}</div>
        {c.ig >= 0 && <div style={{ fontSize: 11, color: IGS[c.ig]!.color, filter: "brightness(1.6)" }}>{IGS[c.ig]!.name}</div>}
        {children}
      </div>
    </div>
  );
}

export function People() {
  const pol = useUi((s) => s.snap?.politics);
  const year = useUi((s) => (s.snap ? +s.snap.dateLabel.slice(-4) : 1936));
  const [seat, setSeat] = useState<{ role: number; slot: number } | null>(null);
  if (!pol) return null;
  return (
    <>
      <div style={h}>{pol.government === "democracy" ? `Democracy · next election ${pol.nextElection}` : "Autocracy"}</div>
      <CharacterCard c={pol.head} title="Head of Government" year={year} />
      <CharacterCard c={pol.heir} title="Heir" year={year}>
        {pol.heir && <div style={{ display: "flex", gap: 3, marginTop: 2 }}>{["ADM", "DIP", "MIL"].map((k, i) => <ActionButton key={k} cmd={{ type: "educate_heir", payload: { stat: i } }}>Educate {k}</ActionButton>)}</div>}
      </CharacterCard>
      <div style={h}>Cabinet</div>
      {pol.cabinet.map((c, s) => <CharacterCard key={s} c={c} title={CABINET_SLOTS[s]!} year={year}><button style={{ ...btnStyle, marginTop: 2 }} onClick={() => setSeat({ role: 2, slot: s })}>Replace…</button></CharacterCard>)}
      <div style={h}>High Command</div>
      {pol.high.map((c, s) => <CharacterCard key={s} c={c} title={HIGH_COMMAND_SLOTS[s]!} year={year}><button style={{ ...btnStyle, marginTop: 2 }} onClick={() => setSeat({ role: 3, slot: s })}>Replace…</button></CharacterCard>)}
      {seat && (
        <div style={{ margin: "6px 0", padding: 6, border: "1px solid #555", borderRadius: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><strong>Appoint to {seat.role === 2 ? CABINET_SLOTS[seat.slot] : HIGH_COMMAND_SLOTS[seat.slot]}</strong><button style={btnStyle} onClick={() => setSeat(null)}>✕</button></div>
          {pol.pool.map((c) => <CharacterCard key={c.id} c={c} title="Candidate" year={year}><ActionButton cmd={{ type: "appoint", payload: { character: c.id, role: seat.role, slot: seat.slot } }} onDone={() => setSeat(null)}>Appoint</ActionButton></CharacterCard>)}
          {pol.igs.map((g, i) => g.leader && <CharacterCard key={`ig${i}`} c={g.leader} title={`${IGS[i]!.name} leader`} year={year}><ActionButton cmd={{ type: "appoint", payload: { character: g.leader.id, role: seat.role, slot: seat.slot } }} onDone={() => setSeat(null)}>Appoint</ActionButton></CharacterCard>)}
        </div>
      )}
      <div style={h}>Succession & academies</div>
      <div style={{ fontSize: 12, marginBottom: 4 }}>Name an heir from the candidates or ministers, then educate them. Leadership academies ({pol.academy}/5) raise the skill of future leaders.</div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {[...pol.cabinet, ...pol.pool].filter(Boolean).slice(0, 6).map((c) => <ActionButton key={c!.id} cmd={{ type: "designate_heir", payload: { character: c!.id } }}>Heir: {c!.name.split(" ").slice(-1)[0]}</ActionButton>)}
        <ActionButton cmd={{ type: "found_academy", payload: {} }}>Found academy</ActionButton>
      </div>
    </>
  );
}
