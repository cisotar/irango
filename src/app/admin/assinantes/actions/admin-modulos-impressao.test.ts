import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — issue 142 (crítica: SIM). Server Action
 * `alternarModuloImpressao(lojaId, modulo, ativo)` em `./admin-modulos-impressao`
 * — ÚNICA via legítima de o dono do SaaS ligar/desligar as flags pagas
 * `lojas.modulo_impressao_a4` / `lojas.modulo_impressao_termica` de uma loja-alvo.
 * Escreve por UPDATE CRU via service_role (NÃO `escopo.atualizarLoja`, que
 * descartaria essas colunas por `CAMPOS_LOJA_SOMENTE_SERVIDOR`), após provar admin.
 *
 * RED de HOJE: o módulo `./admin-modulos-impressao` AINDA NÃO EXISTE (a fase
 * GREEN/`executar` o cria) → o import falha e a suíte inteira reprova com
 * ERR_MODULE_NOT_FOUND. Output vermelho literal anexado à issue 142.
 *
 * Invariantes provadas (Plano Técnico §142 + specs/6-toggle-admin-modulos-impressao.md):
 *  - Mapa módulo→coluna por constante server-side: `"a4"` grava SÓ
 *    `modulo_impressao_a4`; `"termica"` grava SÓ `modulo_impressao_termica`
 *    (nunca a coluna errada, nunca as duas).
 *  - Vetor de INJEÇÃO de nome de coluna: `modulo` fora do union fixo
 *    (`"dono_id"`, `"'; drop"`, `""`, nome de coluna cru) → `{ ok:false }` ANTES
 *    de `prepararContextoAdmin` → admin/service/DB INTOCADOS (zero update).
 *  - `lojaId` não-UUID → `{ ok:false, erro:"Loja inválida." }` sem tocar admin/service.
 *  - Fail-closed (D-4): `verificarAdminSaaS()` lança → a exceção PROPAGA (não vira
 *    `{ ok:false }`), service client NUNCA nasce, zero update.
 *  - `count === 0` (loja inexistente) → `{ ok:false, erro:"Loja não encontrada." }`.
 *  - `error != null` no UPDATE → `{ ok:false, erro:"Não foi possível alterar o módulo." }`.
 *  - Escopo `eq("id", lojaId)` obrigatório + `{ count: "exact" }` no MESMO statement.
 *
 * CONTRATO que o GREEN deve satisfazer:
 *   alternarModuloImpressao(lojaId: string, modulo: string, ativo: boolean):
 *     Promise<{ ok:true } | { ok:false; erro:string }>
 *   em src/app/admin/assinantes/actions/admin-modulos-impressao.ts
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";

// ── next/cache: revalidatePath fora de request scope → mock. ──────────────────
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

// ── verificarAdminSaaS: prova de admin. Default passa; negação via mockRejected. ─
const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
}));

// ── createServiceClient: server-only → mock. Captura tabela, patch, opts
//    (`{ count:"exact" }`) e escopo `.eq()`; devolve `{ error, count }`. ────────
type UpdateCall = {
  tabela: string;
  patch: Record<string, unknown>;
  opts: unknown;
  eqCol: string;
  eqVal: unknown;
};
const updateCalls: UpdateCall[] = [];
let updateError: unknown = null;
let updateCount: number | null = 1;

const clientServico = {
  from: (tabela: string) => ({
    update: (patch: Record<string, unknown>, opts?: unknown) => ({
      eq: async (eqCol: string, eqVal: unknown) => {
        updateCalls.push({ tabela, patch, opts, eqCol, eqVal });
        return { error: updateError, count: updateCount };
      },
    }),
  }),
};
const createServiceClient = vi.fn(() => clientServico);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// admin-loja REAL (validarLojaIdAdmin/prepararContextoAdmin/revalidarLojaAdmin),
// só espiona o no-op `registrarAcessoAdmin`. O `z.guid()` e o fail-closed reais são
// exercitados — não mockamos a lógica sob teste dessa borda.
vi.mock("@/lib/actions/admin-loja", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, registrarAcessoAdmin: vi.fn() };
});

// 'use server' é só diretiva; o módulo é importável no runner node. HOJE ele não
// existe → ERR_MODULE_NOT_FOUND (RED). GREEN cria o arquivo com a assinatura acima.
import { alternarModuloImpressao } from "./admin-modulos-impressao";

beforeEach(() => {
  vi.clearAllMocks();
  updateCalls.length = 0;
  updateError = null;
  updateCount = 1;
  verificarAdminSaaS.mockResolvedValue(undefined);
});

// ─────────────── Caso 1: happy path liga módulo "a4" ─────────────────────────
describe("alternarModuloImpressao — happy path liga módulo a4", () => {
  it("('a4', true) → UPDATE { modulo_impressao_a4: true } escopado .eq('id', lojaId), count:exact → { ok:true }", async () => {
    const r = await alternarModuloImpressao(LOJA_ID, "a4", true);

    expect(r).toEqual({ ok: true });
    expect(updateCalls).toHaveLength(1);

    const { tabela, patch, opts, eqCol, eqVal } = updateCalls[0];
    expect(tabela).toBe("lojas");
    // Patch EXATO: só a coluna a4. Igualdade estrita pega qualquer coluna extra.
    expect(patch).toEqual({ modulo_impressao_a4: true });
    expect(patch).not.toHaveProperty("modulo_impressao_termica");
    // count:"exact" precisa estar presente (a action decide "não encontrada" por count).
    expect(opts).toEqual({ count: "exact" });
    // Escopo cross-tenant: só a loja-alvo é tocada.
    expect(eqCol).toBe("id");
    expect(eqVal).toBe(LOJA_ID);
  });
});

// ── Caso 2: mapa por constante — "termica" grava a OUTRA coluna, nunca a errada ─
describe("alternarModuloImpressao — mapa módulo→coluna por constante server-side", () => {
  it("('termica', true) → UPDATE { modulo_impressao_termica: true } e NUNCA modulo_impressao_a4", async () => {
    const r = await alternarModuloImpressao(LOJA_ID, "termica", true);

    expect(r).toEqual({ ok: true });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].patch).toEqual({ modulo_impressao_termica: true });
    // Prova que o mapa não "vaza" para a coluna do outro módulo.
    expect(updateCalls[0].patch).not.toHaveProperty("modulo_impressao_a4");
  });
});

// ─────────────── Caso 3: desligar (ativo:false) → patch false ────────────────
describe("alternarModuloImpressao — desligar módulo (ativo:false)", () => {
  it("('a4', false) → patch { modulo_impressao_a4: false } → { ok:true }", async () => {
    const r = await alternarModuloImpressao(LOJA_ID, "a4", false);

    expect(r).toEqual({ ok: true });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].patch).toEqual({ modulo_impressao_a4: false });
  });

  it("('termica', false) → patch { modulo_impressao_termica: false } → { ok:true }", async () => {
    const r = await alternarModuloImpressao(LOJA_ID, "termica", false);

    expect(r).toEqual({ ok: true });
    expect(updateCalls[0].patch).toEqual({ modulo_impressao_termica: false });
  });
});

// ── Caso 4: VETOR DE INJEÇÃO — modulo fora do union → sem tocar o banco ───────
describe("alternarModuloImpressao — injeção de nome de coluna (modulo fora do union)", () => {
  it.each([
    ["dono_id"], // tentar re-mapear para coluna sensível
    ["modulo_impressao_a4"], // nome de coluna cru NÃO é um `modulo` válido
    ["'; drop table lojas; --"], // SQL-injection-shaped
    [""], // vazio
    ["A4"], // case não bate o union fixo
    ["termicaX"], // prefixo válido, sufixo hostil
  ])("modulo=%j → { ok:false, erro:'Módulo inválido.' } SEM tocar admin/service/DB", async (modulo) => {
    const r = await alternarModuloImpressao(LOJA_ID, modulo, true);

    expect(r).toEqual({ ok: false, erro: "Módulo inválido." });
    // Validação vem ANTES de prepararContextoAdmin → nada é elevado nem escrito.
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });
});

// ─────────────── Caso 5: lojaId inválido → rejeitado antes de tudo ───────────
describe("alternarModuloImpressao — lojaId inválido (não-UUID)", () => {
  it("lojaId não-UUID → { ok:false, erro:'Loja inválida.' } SEM tocar admin/service/DB", async () => {
    const r = await alternarModuloImpressao("nao-e-uuid", "a4", true);

    expect(r).toEqual({ ok: false, erro: "Loja inválida." });
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });
});

// ── Caso 6: prova de admin falha → exceção PROPAGA, zero efeito (fail-closed D-4)─
describe("alternarModuloImpressao — fail-closed quando admin é negado (D-4)", () => {
  it("verificarAdminSaaS lança → REJEITA (propaga), NÃO cria service nem faz update", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));

    await expect(alternarModuloImpressao(LOJA_ID, "a4", true)).rejects.toThrow("acesso negado");

    expect(createServiceClient).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });
});

// ─────────────── Caso 7: loja inexistente (count === 0) ──────────────────────
describe("alternarModuloImpressao — loja inexistente (count === 0)", () => {
  it("count === 0 → { ok:false, erro:'Loja não encontrada.' } (UPDATE tentado, 0 linhas)", async () => {
    updateCount = 0;

    const r = await alternarModuloImpressao(LOJA_ID, "a4", true);

    expect(r).toEqual({ ok: false, erro: "Loja não encontrada." });
    expect(updateCalls).toHaveLength(1);
  });
});

// ─────────────── Caso extra: falha de banco no UPDATE (error != null) ────────
describe("alternarModuloImpressao — falha de banco no UPDATE", () => {
  it("error != null → { ok:false, erro:'Não foi possível alterar o módulo.' } (detalhe só no log)", async () => {
    updateError = { message: "boom" };

    const r = await alternarModuloImpressao(LOJA_ID, "a4", true);

    expect(r).toEqual({ ok: false, erro: "Não foi possível alterar o módulo." });
  });
});

// ── Caso 9 (borda descoberta): `ativo` não-booleano — critério de aceite do
//    plano ("`ativo` não-booleano → entradaSchema falha → { ok:false } sem
//    banco.") NUNCA tinha teste. Prova real: se `z.boolean()` virar
//    `z.coerce.boolean()` por engano num refactor futuro, "false" (string
//    truthy em JS) LIGARIA o módulo pago em vez de recusar — nenhum teste
//    existente pegaria essa regressão, porque Caso 4 só varia `modulo`,
//    sempre com `ativo: true` fixo. ────────────────────────────────────────
describe("alternarModuloImpressao — ativo não-booleano (borda faltante: tipo de ativo nunca testado)", () => {
  it.each([
    ["true"], // string truthy — não é o boolean `true`; Boolean("true") também é true
    ["false"], // CRÍTICO: string "false" é truthy em JS puro — sem checagem estrita, ligaria o módulo
    [1],
    [0],
    [null],
    [undefined],
    [{}],
  ])("ativo=%j → { ok:false, erro:'Módulo inválido.' } SEM tocar admin/service/DB", async (ativo) => {
    const r = await alternarModuloImpressao(LOJA_ID, "a4", ativo as unknown as boolean);

    expect(r).toEqual({ ok: false, erro: "Módulo inválido." });
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });
});
