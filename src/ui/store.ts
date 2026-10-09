import { create } from "zustand";
import type { SetupInfo, Snapshot, ToWorker } from "../worker/protocol";
import type { CountryReport } from "../sim/inspect";

export type MapMode = "political" | "development" | "population" | "sol";
export type DockTab = "economy" | "population" | null;

interface UiState {
  setup: SetupInfo | null;
  snap: Snapshot | null;
  message: string;
  mapMode: MapMode;
  selected: number | null;
  hovered: number | null;
  report: CountryReport | null;
  dock: DockTab;
  send: (m: ToWorker) => void;
  set: (p: Partial<UiState>) => void;
}
export const useUi = create<UiState>((set) => ({
  setup: null, snap: null, message: "", mapMode: "political", selected: null, hovered: null, report: null, dock: null,
  send: () => {}, set,
}));
