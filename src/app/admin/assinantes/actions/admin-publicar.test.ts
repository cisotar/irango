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

// Issue 368 (D7): o gate conta produtos/formas sob o MESMO `svc` (sem RLS). O fake
// ganha `select(cols, opts)` com `.eq` encadeado que conta linhas de `tabelas`
// filtradas por TODO `.eq` recebido — sem `eq("loja_id")`, a loja vizinha conta.
type Linha = Record<string, unknown>;
const tabelas: Record<string, Linha[]> = {};
const selectFiltros: Array<{ tabela: string; filtros: Array<[string, unknown]> }> = [];
const clientServico = {
  from: (tabela: string) => ({
    update: (patch: Record<string, unknown>) => ({
      eq: async (eqCol: string, eqVal: unknown) => {
        updateCalls.push({ patch, eqCol, eqVal });
        return { error: updateError };
      },
    }),
    select: (_colunas: string, _opcoes?: unknown) => {
      const registro = { tabela, filtros: [] as Array<[string, unknown]> };
      selectFiltros.push(registro);
      const chain = {
        eq: (c: string, v: unknown) => {
          registro.filtros.push([c, v]);
          return chain;
        },
        then: (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          const n = (tabelas[tabela] ?? []).filter((l) => registro.filtros.every(([c, v]) => l[c] === v)).length;
          return Promise.resolve({ data: null, count: n, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  }),
};
const createServiceClient = vi.fn(() => clientServico);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// `registrarAcessoAdmin` (best-effort: INSERT em admin_acessos) é espionado aqui;
// `lojaIdSchema` é o validador real reusado da feature. Mantemos o schema REAL
// (z.guid) e só espionamos a chamada de auditoria.
vi.mock("@/lib/actions/admin-loja", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, registrarAcessoAdmin: vi.fn() };
});

// `buscarLojaAdminPorId`: usado pelo gate de publicação ao PUBLICAR. Default =
// loja COMPLETA (passa no gate D7: perfil + endereço + par). Preserva o resto do
// módulo (admin-loja e outros consumidores reais dependem dele).
const OUTRA_LOJA = "22222222-2222-2222-2222-222222222222";
const LOJA_PRONTA = {
  id: LOJA_ID,
  nome: "Loja Teste" as string | null,
  whatsapp: "5511999999999" as string | null,
  endereco_cep: "01310-100" as string | null,
  endereco_rua: "Avenida Paulista" as string | null,
  endereco_numero: "1000" as string | null,
  endereco_bairro: "Bela Vista" as string | null,
  endereco_cidade: "São Paulo" as string | null,
  endereco_estado: "SP" as string | null,
  latitude: -23.56 as number | null,
  longitude: -46.65 as number | null,
};
const buscarLojaAdminPorId = vi.fn(
  async (..._a: unknown[]): Promise<Partial<typeof LOJA_PRONTA>> => ({ ...LOJA_PRONTA }),
);
vi.mock("@/lib/supabase/queries/lojas", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, buscarLojaAdminPorId: (...a: unknown[]) => buscarLojaAdminPorId(...a) };
});

// 'use server' é só diretiva; o módulo é importável no runner node. O STUB lança
// "TODO: GREEN" → RED ao invocar (asserção, não compilação).
import { publicarLojaAdmin } from "./admin-publicar";

beforeEach(() => {
  vi.clearAllMocks();
  updateCalls.length = 0;
  updateError = null;
  verificarAdminSaaS.mockResolvedValue(undefined);
  // Default: loja COMPLETA (passa no gate D7).
  buscarLojaAdminPorId.mockResolvedValue({ ...LOJA_PRONTA });
  selectFiltros.length = 0;
  // Issue 368: a loja-alvo tem 1 produto disponível e 1 forma de pagamento.
  tabelas.produtos = [{ loja_id: LOJA_ID, disponivel: true, oculto: false }];
  tabelas.formas_pagamento = [{ loja_id: LOJA_ID }];
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

// ─────── Caso 5: gate de perfil mínimo revalidado no SERVIDOR (RN-8) ─────────
describe("publicarLojaAdmin — gate de perfil mínimo (nome + WhatsApp)", () => {
  it("publicar=true com WhatsApp vazio → { ok:false } e ZERO update (gate barra no servidor)", async () => {
    buscarLojaAdminPorId.mockResolvedValue({ ...LOJA_PRONTA, nome: "Loja Teste", whatsapp: null });

    const r = await publicarLojaAdmin(LOJA_ID, true);

    // Issue 368: afirma o fragmento de ERRO_PERFIL_INCOMPLETO, não só ok:false.
    expect(r).toEqual({ ok: false, erro: expect.stringContaining("Complete nome e WhatsApp") });
    expect(updateCalls).toHaveLength(0);
  });

  it("publicar=true com nome só de espaços → { ok:false } e ZERO update", async () => {
    buscarLojaAdminPorId.mockResolvedValue({ ...LOJA_PRONTA, nome: "   ", whatsapp: "5511999999999" });

    const r = await publicarLojaAdmin(LOJA_ID, true);

    // Issue 368: afirma o fragmento de ERRO_PERFIL_INCOMPLETO, não só ok:false.
    expect(r).toEqual({ ok: false, erro: expect.stringContaining("Complete nome e WhatsApp") });
    expect(updateCalls).toHaveLength(0);
  });

  it("DESPUBLICAR (publicar=false) NÃO passa pelo gate — sempre pode, mesmo perfil incompleto", async () => {
    buscarLojaAdminPorId.mockResolvedValue({ nome: null, whatsapp: null });

    const r = await publicarLojaAdmin(LOJA_ID, false);

    expect(r).toEqual({ ok: true });
    expect(buscarLojaAdminPorId).not.toHaveBeenCalled();
    expect(updateCalls[0].patch).toEqual({ ativo: false });
  });

  it("publicar=true com perfil completo → publica (1 update)", async () => {
    const r = await publicarLojaAdmin(LOJA_ID, true);

    expect(r).toEqual({ ok: true });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].patch).toEqual({ ativo: true });
  });
});

// ─────── Issue 368/193 — gate ÚNICO D7 também no admin, sem exceção ─────
describe("publicarLojaAdmin — gate único de publicação (issue 368)", () => {
  it("loja-alvo sem produto e outra loja com produto sob o mesmo svc → recusa com 'produto', zero update", async () => {
    tabelas.produtos = [
      { loja_id: OUTRA_LOJA, disponivel: true, oculto: false },
      { loja_id: OUTRA_LOJA, disponivel: true, oculto: false },
    ];
    const r = await publicarLojaAdmin(LOJA_ID, true);
    expect(r).toEqual({
      ok: false,
      erro: "Cadastre ao menos um produto disponível antes de publicar a loja.",
    });
    expect(updateCalls).toHaveLength(0);
    const contagem = selectFiltros.find((x) => x.tabela === "produtos");
    expect(contagem?.filtros).toContainEqual(["loja_id", LOJA_ID]);
  });

  it("loja-alvo sem forma de pagamento → recusa, zero update", async () => {
    tabelas.formas_pagamento = [{ loja_id: OUTRA_LOJA }];
    const r = await publicarLojaAdmin(LOJA_ID, true);
    expect(r).toEqual({
      ok: false,
      erro: "Cadastre ao menos uma forma de pagamento antes de publicar a loja.",
    });
    expect(updateCalls).toHaveLength(0);
  });

  it("loja-alvo sem par → recusa com ROTULO_LOCALIZAR_DE_NOVO", async () => {
    buscarLojaAdminPorId.mockResolvedValue({ ...LOJA_PRONTA, latitude: null, longitude: null });
    const r = await publicarLojaAdmin(LOJA_ID, true);
    expect(r.ok).toBe(false);
    expect((r as { erro: string }).erro).toContain("Localizar meu endereço de novo");
    expect(updateCalls).toHaveLength(0);
  });

  it("loja-alvo com endereço incompleto → recusa listando os campos", async () => {
    buscarLojaAdminPorId.mockResolvedValue({ ...LOJA_PRONTA, endereco_cep: null, endereco_numero: null });
    const r = await publicarLojaAdmin(LOJA_ID, true);
    expect(r).toEqual({
      ok: false,
      erro: "Preencha CEP e número do endereço da loja antes de publicar.",
    });
    expect(updateCalls).toHaveLength(0);
  });

  it("nenhum parâmetro pula o gate: publicarLojaAdmin.length === 2", async () => {
    expect(publicarLojaAdmin.length).toBe(2);
    // E um 3º argumento (ex.: "forçar") não muda nada: loja sem produto segue recusada.
    tabelas.produtos = [];
    const forcar = publicarLojaAdmin as unknown as (...a: unknown[]) => Promise<{ ok: boolean }>;
    const r = await forcar(LOJA_ID, true, true, { forcar: true });
    expect(r.ok).toBe(false);
    expect(updateCalls).toHaveLength(0);
  });
});
