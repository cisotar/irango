import { defineConfig, devices } from "@playwright/test";

/**
 * Testes de browser (issue 176) — segundo runner, ao lado do vitest.
 *
 * Fica FORA de `npm test` e do gate do CI de propósito: o app roda contra o
 * Supabase cloud (`.env.local`), e o CI não tem projeto de teste nem credencial.
 * Rodar com `npm run test:e2e`, de uma máquina com `.env.local` e das credenciais
 * da loja de teste em `E2E_EMAIL` / `E2E_SENHA`. Sem elas, os specs que precisam
 * de login são pulados (skip), nunca falham.
 *
 * Emulação de toque NÃO é aparelho real — ver o cabeçalho de
 * `e2e/reordenar-categorias.spec.ts` para o que ela cobre e o que não cobre.
 */
export default defineConfig({
  testDir: "./e2e",
  // Os specs escrevem na loja de teste do cloud: um por vez, sem corrida.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    // Chromium com hasTouch/isMobile: emite toque de verdade (CDP), não clique.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    // Dev server do usuário costuma estar de pé: reaproveita em vez de brigar pela porta.
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
