import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — issue 095 (crítica: SIM). Server Action
 * `publicarLojaAdmin(lojaId, publicar)` em `./admin-publicar` — alterna a coluna
 * `ativo` da loja-alvo (publicar/despublicar a vitrine), gate dedicado e SEPARADO
 * do salvar-perfil (RN-8). `ativo` é UPDATE comum via service_role após admin
 * provado; `assinatura_status`/billing JAMAIS tocados aqui (§9).
 *
 * Por que é RED de verdade HOJE: `publicarLojaAdmin` é um STUB que lança
 * "TODO: GREEN" (a fase GREEN/`executar` escreve a lógica). A asserção — não a
 * compilação — é quem reprova. Output real anexado na issue 095.
 *
 * Invariantes provadas (Plano Técnico §095 + specs/admin-onboarding-assistido.md):
 *  - D-4/fail-closed: `verificarAdminSaaS()` lança ANTES de qualquer efeito → a
 *    exceção PROPAGA (não vira `{ ok:false }`), NENHUM service client / update roda
 *    → `ativo` inalterado (zero update capturado).
 *  - Validação: `lojaId` não-UUID → `{ ok:false }` SEM tocar admin/service/update.
 *  - O patch do UPDATE é EXATAMENTE `{ ativo: publicar }` — nenhuma coluna de
 *    billing/assinatura (RN-8/§9). Provado inspecionando o patch capturado.
 *  - Escopo `eq("id", lojaId)` obrigatório (RN-3): só a loja-alvo é tocada.
 *
 * CONTRATO que o GREEN deve satisfazer:
 *   publicarLojaAdmin(lojaId: string, publicar: boolean):
 *     Promise<{ ok:true } | { ok:false; erro:string }>
 *   em src/app/admin/assinantes/actions/admin-publicar.ts
 *   Fluxo: lojaIdSchema → verificarAdminSaaS() (fora do try) → createServiceClient()
 *          → .from("lojas").update({ ativo: publicar }).eq("id", lojaId)
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";

// Chaves de billing/assinatura que NÃO podem aparecer no patch (RN-8/§9).
const CHAVES_PROIBIDAS = [
  "assinatura_status",
  "billing_provider",
  "plano_id",
  "fim_periodo_atual",
  "dono_id",
  "id",
];

// ── next/cache: revalidatePath fora de request scope → mock. ──────────────────
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

// ── verificarAdminSaaS: prova de admin. Default passa; negação via mockRejected. ─
const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
}));

// ── createServiceClient: server-only → mock. Captura o patch do UPDATE e o
//    escopo .eq() do client `lojas`. ──────────────────────────────────────────
type UpdateCall = { patch: Record<string, unknown>; eqCol: string; eqVal: unknown };
const updateCalls: UpdateCall[] = [];
let updateError: unknown = null;

const clientServico = {
  from: (_tabela: string) => ({
    update: (patch: Record<string, unknown>) => ({
      eq: async (eqCol: string, eqVal: unknown) => {
        updateCalls.push({ patch, eqCol, eqVal });
        return { error: updateError };
      },
    }),
  }),
};
const createServiceClient = vi.fn(() => clientServico);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// `registrarAcessoAdmin` é no-op (best-effort); `lojaIdSchema` é o validador real
// reusado da feature. Mantemos o schema REAL (z.guid) e só espionamos o no-op.
vi.mock("@/lib/actions/admin-loja", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, registrarAcessoAdmin: vi.fn() };
});

// 'use server' é só diretiva; o módulo é importável no runner node. O STUB lança
// "TODO: GREEN" → RED ao invocar (asserção, não compilação).
import { publicarLojaAdmin } from "./admin-publicar";

beforeEach(() => {
  vi.clearAllMocks();
  updateCalls.length = 0;
  updateError = null;
  verificarAdminSaaS.mockResolvedValue(undefined);
});

// ─────────────── Caso 1: admin negado → exceção propaga, zero update ─────────
describe("publicarLojaAdmin — fail-closed quando admin é negado (D-4)", () => {
  it("verificarAdminSaaS lança → REJEITA (propaga), NÃO cria service nem faz update (ativo inalterado)", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));

    await expect(publicarLojaAdmin(LOJA_ID, true)).rejects.toThrow("acesso negado");

    expect(createServiceClient).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });
});

// ─────────────────── Caso 2: lojaId inválido → rejeitado, sem efeito ─────────
describe("publicarLojaAdmin — validação de lojaId (UUID)", () => {
  it("lojaId não-UUID → { ok:false } SEM tocar admin/service/update", async () => {
    const r = await publicarLojaAdmin("nao-e-uuid", true);

    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });
});

// ───────── Caso 3: patch é EXATAMENTE { ativo } — nenhuma coluna de billing ──
describe("publicarLojaAdmin — patch isolado a `ativo` (RN-8/§9)", () => {
  it("publicar=true → patch === { ativo: true }, sem coluna de billing/assinatura", async () => {
    const r = await publicarLojaAdmin(LOJA_ID, true);

    expect(r).toEqual({ ok: true });
    expect(updateCalls).toHaveLength(1);
    const { patch } = updateCalls[0];

    // Patch EXATO: só `ativo`. Igualdade estrita pega qualquer coluna extra.
    expect(patch).toEqual({ ativo: true });
    // Defesa redundante e explícita: nenhuma chave proibida.
    for (const chave of CHAVES_PROIBIDAS) {
      expect(patch).not.toHaveProperty(chave);
    }
  });

  it("despublicar=false → patch === { ativo: false }, idem", async () => {
    const r = await publicarLojaAdmin(LOJA_ID, false);

    expect(r).toEqual({ ok: true });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].patch).toEqual({ ativo: false });
  });
});

// ─────────────────── Caso 4: escopo .eq("id", lojaId) obrigatório ───────────
describe("publicarLojaAdmin — escopo na loja-alvo (RN-3)", () => {
  it("UPDATE escopado por eq('id', lojaId) — só a loja-alvo é tocada", async () => {
    await publicarLojaAdmin(LOJA_ID, true);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].eqCol).toBe("id");
    expect(updateCalls[0].eqVal).toBe(LOJA_ID);
  });
});
