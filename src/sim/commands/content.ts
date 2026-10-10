// Focus and event commands.
import { registerCommand, type Validation } from "../commands";
import { focusById, EVENT_BY_ID } from "../script/bundle";
import { describeCondition, describeEffect, fill } from "../script/eval";
import { focusBlocker } from "../systems/focus";
import { resolveEvent } from "../systems/events";

const ok: Validation = { ok: true };
const no = (reason: string): Validation => ({ ok: false, reason });

registerCommand<{ focus: string }>("start_focus", {
  validate({ actor, payload: { focus } }, w) {
    const st = w.focus[actor]!, f = focusById(st.tree, focus);
    if (!f) return no("Unknown focus");
    if (st.current && st.current !== focus) return no(`Already working on ${focusById(st.tree, st.current)?.name ?? st.current}`);
    const block = focusBlocker(w, actor, f);
    if (block) return no(f.available && block === "Conditions not met" ? `Needs: ${describeCondition(f.available)}` : block);
    if (w.countries.cols.pp![actor]! < f.cost) return no(`Requires ${f.cost} political power (you have ${Math.floor(w.countries.cols.pp![actor]!)})`);
    for (const k of ["adm", "dip", "mil"] as const) if (f.points?.[k] && w.countries.cols[k]![actor]! < f.points[k]!) return no(`Requires ${f.points[k]} ${k.toUpperCase()}`);
    return ok;
  },
  apply({ actor, payload: { focus } }, w) {
    const st = w.focus[actor]!, f = focusById(st.tree, focus)!;
    w.countries.cols.pp![actor]! -= f.cost;
    for (const k of ["adm", "dip", "mil"] as const) if (f.points?.[k]) w.countries.cols[k]![actor]! -= f.points[k]!;
    st.current = focus; st.progress = 0;
    return [{ type: "focus_started" }];
  },
  preview({ actor, payload: { focus } }, w) {
    const f = focusById(w.focus[actor]!.tree, focus);
    if (!f) return [];
    const pts = f.points ? Object.entries(f.points).map(([k, v]) => ` + ${v} ${k.toUpperCase()}`).join("") : "";
    return [`Costs ${f.cost} PP${pts} · takes ${f.days} days`, f.description, ...f.effects.map(describeEffect).filter(Boolean),
      ...(f.exclusive.length ? [`Locks out: ${f.exclusive.map((x) => focusById(w.focus[actor]!.tree, x)?.name ?? x).join(", ")}`] : [])];
  },
});

registerCommand<Record<string, never>>("cancel_focus", {
  validate({ actor }, w) { return w.focus[actor]!.current ? ok : no("No focus in progress"); },
  apply({ actor }, w) { const st = w.focus[actor]!; st.current = null; st.progress = 0; return [{ type: "focus_cancelled" }]; },
  preview() { return ["Stops the current focus. Progress and the PP spent are lost."]; },
});

registerCommand<{ pending: number; choice: number }>("choose_event", {
  validate({ actor, payload: { pending, choice } }, w) {
    const p = w.pendingEvents.find((x) => x.id === pending);
    if (!p || p.country !== actor) return no("No such event");
    const e = EVENT_BY_ID.get(p.event);
    if (!e || !e.choices[choice]) return no("No such choice");
    return ok;
  },
  apply({ actor, payload: { pending, choice } }, w) {
    const k = w.pendingEvents.findIndex((x) => x.id === pending), p = w.pendingEvents[k]!;
    w.pendingEvents.splice(k, 1);
    resolveEvent(w, actor, EVENT_BY_ID.get(p.event)!, p.bind, choice);
    return [{ type: "event_chosen" }];
  },
  preview({ actor, payload: { pending, choice } }, w) {
    const p = w.pendingEvents.find((x) => x.id === pending);
    const e = p && EVENT_BY_ID.get(p.event);
    if (!e) return [];
    return e.choices[choice]!.effects.map(describeEffect).filter(Boolean).map((t) => fill(t, { w, c: actor, bind: p.bind }));
  },
});
