import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const backendTarget = process.env.BEECODE_VITE_BACKEND_URL ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/v1": backendTarget,
      "/oauth": backendTarget,
      "/openapi.json": backendTarget,
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
  },
});
