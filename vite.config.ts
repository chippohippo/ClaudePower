import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 300_000, hookTimeout: 300_000 },
} as never);
