import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    // `server-only` lança ao ser importado fora da condição `react-server`. Sob
    // vitest (node), módulos server-only importados DIRETO no teste (ex.:
    // reconciliacao_assinatura) usam o stub vazio que o pacote expõe na condição
    // react-server. Testes de action que mockam o módulo não são afetados.
    alias: [
      {
        find: /^server-only$/,
        replacement: new URL("./node_modules/server-only/empty.js", import.meta.url).pathname,
      },
    ],
  },
  test: {
    environment: "node",
    globals: true,
    // TZ fixo: testes de timestamptz comparam a string renderizada pela sessão
    // pglite, que herda o TZ do processo. Sem pin, verde em CI (UTC) e vermelho
    // em dev BR (America/Sao_Paulo, -03). Trava em UTC para determinismo.
    env: { TZ: "UTC" },
    include: ["src/**/*.{test,spec}.{ts,tsx}", "tests/**/*.{test,spec}.{ts,tsx}"],
    // pglite sobe um Postgres WASM por arquivo — lento sob contenção de CPU em
    // paralelo. Timeout generoso evita flake; o custo real por teste é baixo.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
