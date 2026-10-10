import { create } from "zustand";
import type { PlayerCommand, SetupInfo, Snapshot, ToWorker } from "../worker/protocol";
import type { CountryReport } from "../sim/inspect";
import type { Preview } from "../sim/commands";

export type MapMode = "political" | "development" | "population" | "sol" | "unrest" | "ig";
export type DockTab = "government" | "economy" | "population" | "igs" | null;

interface UiState {
  setup: SetupInfo | null;
  snap: Snapshot | null;
  message: string;
  mapMode: MapMode;
  selected: number | null;
  hovered: number | null;
  report: CountryReport | null;
  dock: DockTab;
  palette: boolean;
  muted: string[];
  /** Event types the player has caused (for First Steps). */
  done: string[];
  firstStepsDismissed: boolean;
  previews: Record<string, Preview>;
  /** Highest chronicle index already shown as a notification. */
  seenChronicle: number;
  notes: { text: string; kind: string }[];
  send: (m: ToWorker) => void;
  jumpTo: (province: number) => void;
  set: (p: Partial<UiState>) => void;
}
export const useUi = create<UiState>((set) => ({
  setup: null, snap: null, message: "", mapMode: "political", selected: null, hovered: null, report: null, dock: null,
  palette: false, muted: loadMuted(), done: [], firstStepsDismissed: false, previews: {}, seenChronicle: -1, notes: [],
  send: () => {}, jumpTo: () => {}, set,
}));

function loadMuted(): string[] {
  try { return JSON.parse(localStorage.getItem("ie.muted") ?? "[]"); } catch { return []; }
}
export function toggleMute(type: string): void {
  const { muted, set } = useUi.getState();
  const next = muted.includes(type) ? muted.filter((t) => t !== type) : [...muted, type];
  set({ muted: next });
  try { localStorage.setItem("ie.muted", JSON.stringify(next)); } catch { /* storage unavailable */ }
}

// ---- Command previews: batched once per frame, refreshed on every snapshot -----------------------
export const cmdKey = (c: PlayerCommand) => JSON.stringify(c);
const wanted = new Map<string, PlayerCommand>();
let scheduled = false, nextId = 1;
const inflight = new Map<number, string[]>();

export function requestPreview(c: PlayerCommand): void {
  wanted.set(cmdKey(c), c);
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(flushPreviews);
}
function flushPreviews() {
  scheduled = false;
  if (!wanted.size) return;
  const keys = [...wanted.keys()], cmds = [...wanted.values()];
  wanted.clear();
  const id = nextId++;
  inflight.set(id, keys);
  useUi.getState().send({ kind: "preview", id, cmds });
}
export function receivePreviews(id: number, results: Preview[]): void {
  const keys = inflight.get(id);
  if (!keys) return;
  inflight.delete(id);
  const previews = { ...useUi.getState().previews };
  keys.forEach((k, i) => { previews[k] = results[i]!; });
  useUi.getState().set({ previews });
}
