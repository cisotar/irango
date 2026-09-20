import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — issue 241 (crítica: SIM). Arquivo NOVO: a suíte existente
 * `admin-produtos.test.ts` (issue 089) NÃO é editada aqui.
 *
 * PARIDADE DO CAMINHO ADMIN. O hub admin escreve na loja-alvo com `service_role`,
 * que tem BYPASSRLS: nenhuma regra que more só na RLS protege esta via. O que
 * protege é a PARIDADE com o caminho do lojista (`src/lib/actions/produto.ts`) —
 * mesmo `schemaProduto`, mesma mensagem de D10, mesma conversão de prazo pelo
 * fuso da loja, e patch por allowlist/schema (nunca `{ ...payload }`).
 *
 * Provado por COMPORTAMENTO: chama a Server Action admin real com mocks só de
 * I/O e inspeciona a linha/patch capturados. O `grep` do critério de aceite é
 * complemento (ver `admin-paridade-monetaria.test.ts`), não a prova principal.
 *
 * Espelha caso a caso `criarProduto/atualizarProduto — desconto (issue 230)` de
 * `src/lib/actions/produto.test.ts`: mesmo input, mesmo resultado esperado.
 *
 * NENHUMA lógica de produção aqui.
 */

const LOJA_ALVO = "11111111-1111-1111-1111-111111111111"; // loja da URL admin
const LOJA_OUTRA = "22222222-2222-2222-2222-222222222222"; // loja alheia
const PRODUTO_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

// Mensagem literal de D10, byte a byte, IDÊNTICA à afirmada no caminho do
// lojista (produto.test.ts, MSG_D10_8_10 com outros números). Escrita à mão de
// propósito: se o admin devolver a genérica, ou um texto "parecido", falha.
const MSG_D10_20_30 =
  "Não dá para salvar: o preço novo (R$ 20,00) é menor que o desconto " +
  "configurado (R$ 30,00). Reduza o desconto para no máximo R$ 20,00 " +
  "ou desligue a promoção deste produto.";

// ── Captura do que cada operação manda ao banco, por TABELA tocada ────────────
type Op = {
  tabela: string;
  insert?: Record<string, unknown>;
  update?: Record<string, unknown>;
  deleted?: boolean;
  filtros: Array<[string, unknown]>;
};
let ops: Op[];
let respostaPorTabela: Record<string, { data: unknown; error: unknown; count?: number }>;

function makeChain() {
  return {
    from: (tabela: string) => {
      const op: Op = { tabela, filtros: [] };
      ops.push(op);
      const queryChain: Record<string, unknown> = {};
      const passthrough = (k: string) => {
        queryChain[k] = (...args: unknown[]) => {
          if (k === "eq" || k === "in") op.filtros.push([args[0] as string, args[1]]);
          return queryChain;
        };
      };
      ["select", "eq", "in", "single", "maybeSingle", "limit", "order"].forEach(passthrough);
      queryChain.insert = (row: Record<string, unknown>) => {
        op.insert = row;
        return queryChain;
      };
      queryChain.update = (row: Record<string, unknown>) => {
        op.update = row;
        return queryChain;
      };
      queryChain.delete = () => {
        op.deleted = true;
        return queryChain;
      };
      queryChain.then = (onF: (v: unknown) => unknown) =>
        Promise.resolve(
          respostaPorTabela[tabela] ?? { data: null, error: null, count: 1 },
        ).then(onF);
      return queryChain;
    },
  };
}

const servico = makeChain();
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => servico }));

vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: vi.fn(async () => undefined),
  obterAdminUserId: vi.fn(() => "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { criarProdutoAdmin, atualizarProdutoAdmin } from "./admin-produtos";

function payloadProduto(over: Record<string, unknown> = {}) {
  return {
    nome: "Feijoada",
    descricao: "delícia",
    preco: 100,
    categoria_id: null,
    disponivel: true,
    oculto: false,
    ordem: 0,
    ...over,
  };
}

function payloadComDesconto(over: Record<string, unknown> = {}) {
  return payloadProduto({
    desconto_ativo: true,
    desconto_tipo: "percentual",
    desconto_valor: 20,
    desconto_inicio: null,
    desconto_fim: null,
    ...over,
  });
}

function opEscrita(tabela: string): Op | undefined {
  return ops.find((o) => o.tabela === tabela && (o.insert || o.update || o.deleted));
}

beforeEach(() => {
  ops = [];
  // A loja-ALVO (não a do payload) é quem dá o fuso de RN-03. Qualquer rota que
  // o GREEN use para lê-la (`buscarLojaAdminPorId`, select direto no `svc`)
  // cai aqui.
  respostaPorTabela = {
    lojas: {
      data: { id: LOJA_ALVO, slug: "loja-alvo", timezone: "America/Sao_Paulo" },
      error: null,
      count: 1,
    },
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ── PARIDADE 1: o MESMO schemaProduto estendido, nos dois mundos ─────────────
describe("241 — paridade de validação: admin usa o mesmo schemaProduto estendido", () => {
  it("percentual 101 é RECUSADO SEM tocar no banco (criar e atualizar)", async () => {
    const r1 = await criarProdutoAdmin(LOJA_ALVO, payloadComDesconto({ desconto_valor: 101 }));
    expect(r1.ok).toBe(false);
    expect(opEscrita("produtos")).toBeUndefined();

    const r2 = await atualizarProdutoAdmin(
      LOJA_ALVO,
      PRODUTO_ID,
      payloadComDesconto({ desconto_valor: 101 }),
    );
    expect(r2.ok).toBe(false);
    expect(opEscrita("produtos")).toBeUndefined();
  });

  it("D10: fixo > preço é recusado com a MESMA mensagem literal do lojista", async () => {
    const r = await criarProdutoAdmin(
      LOJA_ALVO,
      payloadComDesconto({ preco: 20, desconto_tipo: "fixo", desconto_valor: 30 }),
    );
    expect(r).toEqual({ ok: false, erro: MSG_D10_20_30 });
    expect(opEscrita("produtos")).toBeUndefined();
  });

  it("D10 vale também no UPDATE admin (baixar o preço abaixo do fixo configurado)", async () => {
    const r = await atualizarProdutoAdmin(
      LOJA_ALVO,
      PRODUTO_ID,
      payloadComDesconto({ preco: 20, desconto_tipo: "fixo", desconto_valor: 30 }),
    );
    expect(r).toEqual({ ok: false, erro: MSG_D10_20_30 });
    expect(opEscrita("produtos")).toBeUndefined();
  });

  it("desconto_ativo = true sem tipo/valor é RECUSADO SEM tocar no banco", async () => {
    const r = await criarProdutoAdmin(
      LOJA_ALVO,
      payloadComDesconto({ desconto_tipo: null, desconto_valor: null }),
    );
    expect(r.ok).toBe(false);
    expect(opEscrita("produtos")).toBeUndefined();
  });

  it("desconto_fim <= desconto_inicio é RECUSADO SEM tocar no banco", async () => {
    const r = await criarProdutoAdmin(
      LOJA_ALVO,
      payloadComDesconto({
        desconto_inicio: "2026-12-31T23:59",
        desconto_fim: "2026-12-01T00:00",
      }),
    );
    expect(r.ok).toBe(false);
    expect(opEscrita("produtos")).toBeUndefined();
  });

  it("só D10 é promovida: o resto do parse falho continua genérico", async () => {
    const r = await criarProdutoAdmin(LOJA_ALVO, payloadComDesconto({ desconto_valor: 101 }));
    expect(r).toEqual({ ok: false, erro: "Produto inválido." });
  });
});

// ── PARIDADE 2: RN-03, prazo convertido pelo fuso da LOJA-ALVO ───────────────
describe("241 — paridade de prazo (RN-03): admin converte hora local pelo fuso da loja-alvo", () => {
  it("'31/12 23:59' numa loja America/Sao_Paulo grava o instante correto (criar)", async () => {
    const r = await criarProdutoAdmin(
      LOJA_ALVO,
      payloadComDesconto({
        desconto_inicio: "2026-12-01T00:00",
        desconto_fim: "2026-12-31T23:59",
      }),
    );
    expect(r).toEqual({ ok: true });
    const insert = opEscrita("produtos")?.insert;
    expect(insert?.desconto_inicio).toBe("2026-12-01T03:00:00.000Z");
    expect(insert?.desconto_fim).toBe("2027-01-01T02:59:00.000Z");
  });

  it("o fuso é o da LOJA-ALVO, não um offset fixo (America/Manaus)", async () => {
    respostaPorTabela.lojas = {
      data: { id: LOJA_ALVO, slug: "loja-alvo", timezone: "America/Manaus" },
      error: null,
      count: 1,
    };
    await criarProdutoAdmin(
      LOJA_ALVO,
      payloadComDesconto({ desconto_fim: "2026-12-31T23:59" }),
    );
    expect(opEscrita("produtos")?.insert?.desconto_fim).toBe("2027-01-01T03:59:00.000Z");
  });

  it("ATAQUE: `timezone` no payload admin é IGNORADO (vale o da loja-alvo)", async () => {
    const r = await criarProdutoAdmin(LOJA_ALVO, {
      ...payloadComDesconto({ desconto_fim: "2026-12-31T23:59" }),
      timezone: "UTC",
    });
    expect(r).toEqual({ ok: true });
    const insert = opEscrita("produtos")?.insert;
    expect(insert?.desconto_fim).toBe("2027-01-01T02:59:00.000Z");
    expect(insert?.timezone).toBeUndefined();
  });

  it("a conversão vale também no UPDATE admin", async () => {
    const r = await atualizarProdutoAdmin(
      LOJA_ALVO,
      PRODUTO_ID,
      payloadComDesconto({
        desconto_inicio: "2026-12-01T00:00",
        desconto_fim: "2026-12-31T23:59",
      }),
    );
    expect(r).toEqual({ ok: true });
    expect(opEscrita("produtos")?.update).toMatchObject({
      desconto_inicio: "2026-12-01T03:00:00.000Z",
      desconto_fim: "2027-01-01T02:59:00.000Z",
    });
  });

  it("prazo null continua null (sem conversão, sem data inventada)", async () => {
    await criarProdutoAdmin(LOJA_ALVO, payloadComDesconto());
    const insert = opEscrita("produtos")?.insert;
    expect(insert?.desconto_inicio).toBeNull();
    expect(insert?.desconto_fim).toBeNull();
  });

  it("RN-07: desligar PRESERVA tipo, valor e prazo no UPDATE admin", async () => {
    const r = await atualizarProdutoAdmin(
      LOJA_ALVO,
      PRODUTO_ID,
      payloadComDesconto({
        desconto_ativo: false,
        desconto_tipo: "fixo",
        desconto_valor: 5,
        desconto_inicio: "2026-12-01T00:00",
        desconto_fim: "2026-12-31T23:59",
      }),
    );
    expect(r).toEqual({ ok: true });
    expect(opEscrita("produtos")?.update).toMatchObject({
      desconto_ativo: false,
      desconto_tipo: "fixo",
      desconto_valor: 5,
      desconto_inicio: "2026-12-01T03:00:00.000Z",
      desconto_fim: "2027-01-01T02:59:00.000Z",
    });
  });
});

// ── PARIDADE 3: nenhum patch por spread do payload ───────────────────────────
describe("241 — nenhum patch admin montado por spread do payload", () => {
  // Conjunto FECHADO de chaves que podem chegar ao banco: as do schemaProduto
  // (+ `loja_id`, injetado por último pelo wrapper no INSERT). Uma chave a mais
  // no INSERT/UPDATE = spread do payload cru.
  const CHAVES_PERMITIDAS = new Set([
    "nome",
    "descricao",
    "preco",
    "categoria_id",
    "disponivel",
    "oculto",
    "ordem",
    "foto_url",
    "desconto_ativo",
    "desconto_tipo",
    "desconto_valor",
    "desconto_inicio",
    "desconto_fim",
    "loja_id",
  ]);

  const HOSTIL = {
    loja_id: LOJA_OUTRA,
    id: "99999999-9999-9999-9999-999999999999",
    timezone: "UTC",
    preco_original: 1,
    ativo: true,
    dono_id: "00000000-0000-0000-0000-000000000000",
  };

  it("INSERT admin só carrega chaves do schema; lixo hostil não entra", async () => {
    const r = await criarProdutoAdmin(LOJA_ALVO, {
      ...payloadComDesconto(),
      ...HOSTIL,
    });
    expect(r).toEqual({ ok: true });
    const insert = opEscrita("produtos")?.insert ?? {};
    for (const chave of Object.keys(insert)) {
      expect(CHAVES_PERMITIDAS.has(chave)).toBe(true);
    }
    // `loja_id` gravado é o da URL admin, nunca o do payload.
    expect(insert.loja_id).toBe(LOJA_ALVO);
    expect(insert.id).toBeUndefined();
    expect(insert.preco_original).toBeUndefined();
  });

  it("UPDATE admin não re-parenteia nem re-chaveia a linha", async () => {
    const r = await atualizarProdutoAdmin(LOJA_ALVO, PRODUTO_ID, {
      ...payloadComDesconto(),
      ...HOSTIL,
    });
    expect(r).toEqual({ ok: true });
    const update = opEscrita("produtos")?.update ?? {};
    for (const chave of Object.keys(update)) {
      expect(CHAVES_PERMITIDAS.has(chave)).toBe(true);
    }
    expect("loja_id" in update).toBe(false);
    expect("id" in update).toBe(false);
  });
});

// ── PARIDADE 4: escopo cross-tenant ──────────────────────────────────────────
describe("241 — escopo cross-tenant do caminho admin", () => {
  it("lojaId não-UUID é recusado com a mensagem literal, SEM tocar no banco", async () => {
    const r = await criarProdutoAdmin("loja-b", payloadComDesconto());
    expect(r).toEqual({ ok: false, erro: "Loja inválida." });
    expect(ops).toHaveLength(0);
  });

  it("loja_id de OUTRA loja no payload não desvia o UPDATE: escopo duplo loja_id+id", async () => {
    const r = await atualizarProdutoAdmin(LOJA_ALVO, PRODUTO_ID, {
      ...payloadComDesconto(),
      loja_id: LOJA_OUTRA,
    });
    expect(r).toEqual({ ok: true });
    const escrita = opEscrita("produtos");
    expect(escrita?.filtros).toEqual(
      expect.arrayContaining([
        ["loja_id", LOJA_ALVO],
        ["id", PRODUTO_ID],
      ]),
    );
    // Nenhum filtro aponta para a loja alheia.
    expect(escrita?.filtros.some(([, v]) => v === LOJA_OUTRA)).toBe(false);
  });
});
