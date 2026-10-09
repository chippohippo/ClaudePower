import { create } from "zustand";
import type { Snapshot } from "../worker/protocol";

interface UiState { snap: Snapshot | null; message: string; set: (p: Partial<UiState>) => void }
export const useUi = create<UiState>((set) => ({ snap: null, message: "", set }));
