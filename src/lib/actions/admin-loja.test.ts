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
// Builder-espião: captura tabela/op/payload/eqs das escritas feitas pelo wrapper
// `escopo` (usado só nos testes do wrapper; os demais não tocam `.from`).
type OpEspia = { tabela: string; tipo: string; payload?: unknown; eqs: { c: string; v: unknown }[] };
let opsEspia: OpEspia[] = [];
function builderEspia(tabela: string) {
  const op: OpEspia = { tabela, tipo: "select", eqs: [] };
  opsEspia.push(op);
  const b: Record<string, unknown> = {
    insert(p: unknown) { op.tipo = "insert"; op.payload = p; return b; },
    update(p: unknown) { op.tipo = "update"; op.payload = p; return b; },
    delete() { op.tipo = "delete"; return b; },
    select() { return b; },
    maybeSingle() { return b; },
    eq(c: string, v: unknown) { op.eqs.push({ c, v }); return b; },
    then(res: (v: { data: null; error: null; count: number }) => unknown) {
      return Promise.resolve({ data: null, error: null, count: 1 }).then(res);
    },
  };
  return b;
}
const clientServico = { marker: "svc-fake", from: (t: string) => builderEspia(t) };
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

// ─────────────── escopo (wrapper camada 1: amarra o tenant por construção) ───
describe("prepararContextoAdmin → escopo — injeta o tenant em TODA escrita", () => {
  const ID_RECURSO = "33333333-3333-3333-3333-333333333333";

  it("inserir injeta loja_id do PARÂMETRO por último — payload hostil não sobrescreve", async () => {
    opsEspia = [];
    const { escopo } = await prepararContextoAdmin(LOJA_ID);
    await escopo.inserir("categorias", { nome: "x", ordem: 0, loja_id: "hostil" } as never);
    const op = opsEspia.find((o) => o.tipo === "insert")!;
    expect((op.payload as Record<string, unknown>).loja_id).toBe(LOJA_ID);
  });

  it("atualizar escopa por loja_id E id", async () => {
    opsEspia = [];
    const { escopo } = await prepararContextoAdmin(LOJA_ID);
    await escopo.atualizar("categorias", ID_RECURSO, { nome: "y" });
    const op = opsEspia.find((o) => o.tipo === "update")!;
    expect(op.eqs).toContainEqual({ c: "loja_id", v: LOJA_ID });
    expect(op.eqs).toContainEqual({ c: "id", v: ID_RECURSO });
  });

  it("remover escopa por loja_id E id", async () => {
    opsEspia = [];
    const { escopo } = await prepararContextoAdmin(LOJA_ID);
    await escopo.remover("categorias", ID_RECURSO);
    const op = opsEspia.find((o) => o.tipo === "delete")!;
    expect(op.eqs).toContainEqual({ c: "loja_id", v: LOJA_ID });
    expect(op.eqs).toContainEqual({ c: "id", v: ID_RECURSO });
  });

  it("atualizarLoja escopa a tabela lojas por id", async () => {
    opsEspia = [];
    const { escopo } = await prepararContextoAdmin(LOJA_ID);
    await escopo.atualizarLoja({ nome: "Nova" });
    const op = opsEspia.find((o) => o.tabela === "lojas")!;
    expect(op.tipo).toBe("update");
    expect(op.eqs).toContainEqual({ c: "id", v: LOJA_ID });
  });

  // Letalidade do filtro de runtime (issue 115): o `Omit` protege só chamadores que
  // passam object-literal; `as`/width-subtyping o derrotam, e `service_role` BYPASSA o
  // trigger lojas_protege_billing_v2. O filtro é o backstop real — descarta as chaves
  // somente-servidor mesmo quando o tipo é burlado por `as never`.
  it("atualizarLoja descarta chaves somente-servidor mesmo sob cast (backstop de runtime)", async () => {
    opsEspia = [];
    const { escopo } = await prepararContextoAdmin(LOJA_ID);
    await escopo.atualizarLoja({ dono_id: "atacante", nome: "ok" } as never);
    const op = opsEspia.find((o) => o.tabela === "lojas")!;
    const payload = op.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("dono_id");
    expect(payload.nome).toBe("ok");
  });

  // Issue 115 — completude do filtro: a blocklist tem 13 colunas (espelhando o
  // trigger lojas_protege_billing_v2 + id + consentimento_*), não só `dono_id`.
  // Lista hardcoded AQUI (não importada de admin-loja.ts): se alguém remover uma
  // entrada de CAMPOS_LOJA_SOMENTE_SERVIDOR por engano, este teste pega — importar
  // a mesma constante do módulo sob teste esconderia a regressão.
  it("atualizarLoja descarta TODAS as colunas da blocklist, não só dono_id (letalidade completa)", async () => {
    opsEspia = [];
    const { escopo } = await prepararContextoAdmin(LOJA_ID);
    const colunasBloqueadas = [
      "id",
      "dono_id",
      "assinatura_status",
      "assinatura_inicio",
      "assinatura_fim_periodo",
      "assinatura_atualizada_em",
      "hotmart_subscriber_code",
      "hotmart_plano",
      "billing_provider",
      "provider_subscription_id",
      "plano_id",
      "consentimento_versao",
      "consentimento_em",
    ];
    const payloadHostil = {
      ...Object.fromEntries(colunasBloqueadas.map((c) => [c, `forjado-${c}`])),
      nome: "ok",
    } as never;

    await escopo.atualizarLoja(payloadHostil);

    const op = opsEspia.find((o) => o.tabela === "lojas")!;
    const payload = op.payload as Record<string, unknown>;
    for (const col of colunasBloqueadas) {
      expect(payload, `coluna '${col}' deveria ter sido descartada`).not.toHaveProperty(col);
    }
    expect(payload.nome).toBe("ok");
  });

  // Issue 115 — payload SÓ com chaves bloqueadas (nenhuma legítima sobra). O
  // filtro deve produzir um UPDATE com objeto vazio, não lançar nem enviar
  // undefined/null que quebre o builder do PostgREST.
  it("atualizarLoja com payload SÓ de chaves bloqueadas → UPDATE vazio, não explode", async () => {
    opsEspia = [];
    const { escopo } = await prepararContextoAdmin(LOJA_ID);
    const somenteBloqueadas = {
      dono_id: "atacante",
      plano_id: "premium-forjado",
      consentimento_versao: "v999",
    } as never;

    const resultado = await escopo.atualizarLoja(somenteBloqueadas);

    expect(resultado.error).toBeNull();
    const op = opsEspia.find((o) => o.tabela === "lojas")!;
    expect(op.tipo).toBe("update");
    expect(op.payload).toEqual({});
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
