/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the static build works from any sub-path.
  base: "./",
  server: { port: 5173, host: true },
  // Konva, React and Yjs make up most of the main chunk; jsPDF is loaded on demand.
  build: { chunkSizeWarningLimit: 1000 },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
