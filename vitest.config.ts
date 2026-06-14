import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}", "tests/**/*.{test,spec}.{ts,tsx}"],
    // pglite sobe um Postgres WASM por arquivo — lento sob contenção de CPU em
    // paralelo. Timeout generoso evita flake; o custo real por teste é baixo.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
