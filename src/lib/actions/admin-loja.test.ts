import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — issue 083 (crítica: SIM). Helper neutro compartilhado
 * `src/lib/actions/admin-loja.ts` (sem `'use server'`) que padroniza o início de
 * TODA Server Action admin desta feature.
 *
 * Por que é RED de verdade HOJE: o módulo `./admin-loja` AINDA NÃO EXISTE
 * (a fase GREEN/`executar` o cria). O `import` abaixo aponta para um arquivo
 * inexistente → o módulo não resolve → todo o suite quebra a importar
 * `validarLojaIdAdmin`, `prepararContextoAdmin`, `registrarAcessoAdmin`.
 *
 * Invariantes provadas (issue 083, specs/admin-onboarding-assistido.md):
 *  - validarLojaIdAdmin: safeParse de `lojaIdSchema` (z.guid()). Não-UUID →
 *    { ok:false }. UUID válido → { ok:true, lojaId }.
 *  - prepararContextoAdmin: prova `verificarAdminSaaS()` ANTES de elevar a
 *    service_role. Se a prova lança, a exceção PROPAGA (fail-closed, D-4) e
 *    `createServiceClient` NUNCA é chamado — nunca vira `{ ok:false }` amigável.
 *    Ordem: verificarAdminSaaS antes de createServiceClient.
 *  - registrarAcessoAdmin: no-op (ponto de extensão de log futuro). Nunca lança,
 *    retorna void/undefined. Best-effort por design.
 *
 * CONTRATO que o GREEN deve satisfazer (arquivo: src/lib/actions/admin-loja.ts):
 *   validarLojaIdAdmin(lojaId: unknown): { ok:true; lojaId:string } | { ok:false }
 *   prepararContextoAdmin(lojaId: string): Promise<{ svc: <service client> }>
 *     (ou retorno equivalente que exponha o service client; o teste só exige que
 *      verificarAdminSaaS rode ANTES, e que a falha de admin propague)
 *   registrarAcessoAdmin(svc, { adminId?, lojaId, acao, entidadeId?, metadados? }):
 *     void  (no-op com TODO)
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";

// ── verificarAdminSaaS: prova de admin. Default passa; teste de negação faz
//    mockRejectedValueOnce. Ordem capturada via array `ordemChamadas`. ──────────
const ordemChamadas: string[] = [];
const verificarAdminSaaS = vi.fn(async () => {
  ordemChamadas.push("verificarAdminSaaS");
});
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
}));

// ── createServiceClient: server-only → mock. Registra ordem ao ser chamado. ────
const clientServico = { marker: "svc-fake" };
const createServiceClient = vi.fn(() => {
  ordemChamadas.push("createServiceClient");
  return clientServico;
});
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// Módulo alvo AINDA NÃO EXISTE → import quebra o suite inteiro (RED).
import {
  validarLojaIdAdmin,
  prepararContextoAdmin,
  registrarAcessoAdmin,
} from "./admin-loja";

beforeEach(() => {
  vi.clearAllMocks();
  ordemChamadas.length = 0;
  verificarAdminSaaS.mockImplementation(async () => {
    ordemChamadas.push("verificarAdminSaaS");
  });
});

// ─────────────────── validarLojaIdAdmin (validação UUID) ─────────────────────
describe("validarLojaIdAdmin", () => {
  it("string não-UUID → { ok:false }", () => {
    expect(validarLojaIdAdmin("nao-e-uuid")).toEqual({ ok: false });
  });

  it("valores não-string também rejeitados → { ok:false }", () => {
    expect(validarLojaIdAdmin(undefined)).toEqual({ ok: false });
    expect(validarLojaIdAdmin(123)).toEqual({ ok: false });
    expect(validarLojaIdAdmin(null)).toEqual({ ok: false });
  });

  it("UUID válido → { ok:true, lojaId }", () => {
    expect(validarLojaIdAdmin(LOJA_ID)).toEqual({ ok: true, lojaId: LOJA_ID });
  });
});

// ─────────────── prepararContextoAdmin (prova de admin + escopo) ─────────────
describe("prepararContextoAdmin — prova admin antes de elevar (fail-closed D-4)", () => {
  it("admin ok → chama verificarAdminSaaS ANTES de createServiceClient", async () => {
    await prepararContextoAdmin(LOJA_ID);

    expect(verificarAdminSaaS).toHaveBeenCalledTimes(1);
    expect(createServiceClient).toHaveBeenCalledTimes(1);
    // Ordem importa: prova antes de elevar.
    expect(ordemChamadas).toEqual(["verificarAdminSaaS", "createServiceClient"]);
  });

  it("verificarAdminSaaS lança → PROPAGA (rejeita) e NÃO chama createServiceClient", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));

    await expect(prepararContextoAdmin(LOJA_ID)).rejects.toThrow("acesso negado");

    // Fail-closed: nunca elevou para service_role após a prova falhar.
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(ordemChamadas).not.toContain("createServiceClient");
  });
});

// ─────────────────── registrarAcessoAdmin (no-op best-effort) ────────────────
describe("registrarAcessoAdmin — no-op, nunca lança", () => {
  it("retorna void/undefined sem lançar", () => {
    const r = registrarAcessoAdmin(clientServico, {
      lojaId: LOJA_ID,
      acao: "leitura",
    });
    expect(r).toBeUndefined();
  });

  it("com metadados completos ainda é no-op silencioso", () => {
    expect(() =>
      registrarAcessoAdmin(clientServico, {
        adminId: "admin-1",
        lojaId: LOJA_ID,
        acao: "edicao",
        entidadeId: "prod-1",
        metadados: { campo: "preco" },
      }),
    ).not.toThrow();
  });
});
