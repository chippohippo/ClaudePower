import { create } from "zustand";
import type { SetupInfo, Snapshot, ToWorker } from "../worker/protocol";

export type MapMode = "political" | "development";

interface UiState {
  setup: SetupInfo | null;
  snap: Snapshot | null;
  message: string;
  mapMode: MapMode;
  selected: number | null;
  hovered: number | null;
  send: (m: ToWorker) => void;
  set: (p: Partial<UiState>) => void;
}
export const useUi = create<UiState>((set) => ({
  setup: null, snap: null, message: "", mapMode: "political", selected: null, hovered: null,
  send: () => {}, set,
}));
