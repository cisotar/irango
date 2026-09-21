import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) da issue 251 — as Server Actions de lote do cardápio
 * (`src/lib/actions/cardapio.ts`), a METADE DE SERVER ACTION da fatia crítica 5.
 *
 * Spec: specs/cardapio-sazonal.md · D2, D14 · RN-09, RN-09-a, RN-10, RN-11.
 *
 * Divisão de trabalho entre os arquivos de teste desta fatia:
 *  - `tests/migrations/cardapio_produtos_lote_atomico.test.ts` prova, em SQL
 *    real (pglite), que o lote `[p1, p2, pB, p3]` não grava NENHUMA linha e que
 *    a constraint que dispara é `cardapio_produtos_produto_fk`;
 *  - `tests/migrations/rpc_aplicar_cardapio_em_categoria.test.ts` prova os
 *    fragmentos `loja alheia` / `cardapio fora da loja` / `categoria fora da
 *    loja` da RPC;
 *  - ESTE arquivo prova o CONTRATO DA FRONTEIRA: parse antes de qualquer I/O,
 *    `loja_id` derivado de `buscarLojaDoDono` (nunca do payload), UMA instrução
 *    de escrita (sem pre-check de posse em JS, que seria TOCTOU), a MESMA
 *    mensagem genérica para toda falha, `23503` nunca virando texto na UI,
 *    `revalidatePath` pelo slug da própria loja, e a prévia de RN-09-a que só
 *    mostra o que é seu.
 *
 * Padrão de mocks: espelha `produto.test.ts` / `opcional.test.ts` — client raiz
 * não thenável; só a cadeia `.from(...)` resolve, por TABELA; `rpc(...)` é
 * terminador próprio no client raiz.
 *
 * Nenhum código de produção é escrito aqui.
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";
const LOJA_SLUG = "lanches-base";

const CARDAPIO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CARDAPIO_ALHEIO = "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd";
const CATEGORIA = "cacacaca-caca-4cac-8cac-cacacacacaca";

const P1 = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const P2 = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const P3 = "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3";
/** Produto da LOJA B — o vetor de IDOR do cenário 5. */
const PB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** A única mensagem que o lojista pode ver, para QUALQUER falha (RN-09). */
const MSG_GENERICA = "Não foi possível aplicar o cardápio aos produtos selecionados.";

/** O erro que o Postgres devolve no cenário 5, como o PostgREST o entrega. */
const ERRO_FK_PRODUTO = {
  code: "23503",
  message:
    'insert or update on table "cardapio_produtos" violates foreign key constraint "cardapio_produtos_produto_fk"',
  details: 'Key (produto_id, loja_id)=(...) is not present in table "produtos".',
};
const ERRO_FK_CARDAPIO = {
  code: "23503",
  message:
    'insert or update on table "cardapio_produtos" violates foreign key constraint "cardapio_produtos_cardapio_fk"',
  details: null,
};

type Op = {
  tabela: string;
  upsert?: unknown[];
  upsertOpcoes?: Record<string, unknown>;
  insert?: unknown;
  deleted?: boolean;
  selected?: boolean;
  colunas?: string;
  filtros: Array<[string, unknown]>;
};
let ops: Op[];
let respostaPorTabela: Record<string, { data: unknown; error: unknown; count?: number }>;

type ChamadaRpc = { nome: string; args: Record<string, unknown> };
let chamadasRpc: ChamadaRpc[];
let respostaRpc: { data: unknown; error: unknown };

function makeChain() {
  const client: Record<string, unknown> = {
    from: (tabela: string) => {
      const op: Op = { tabela, filtros: [] };
      ops.push(op);
      const chain: Record<string, unknown> = {};
      const passthrough = (k: string) => {
        chain[k] = (...args: unknown[]) => {
          if (k === "eq" || k === "in") op.filtros.push([args[0] as string, args[1]]);
          if (k === "select") {
            op.selected = true;
            op.colunas = args[0] as string | undefined;
          }
          return chain;
        };
      };
      ["select", "eq", "in", "order", "limit", "single", "maybeSingle", "is"].forEach(passthrough);
      chain.upsert = (linhas: unknown[], opcoes?: Record<string, unknown>) => {
        op.upsert = linhas;
        op.upsertOpcoes = opcoes;
        return chain;
      };
      chain.insert = (linhas: unknown) => {
        op.insert = linhas;
        return chain;
      };
      chain.delete = () => {
        op.deleted = true;
        return chain;
      };
      chain.then = (onF: (v: unknown) => unknown) =>
        Promise.resolve(respostaPorTabela[tabela] ?? { data: null, error: null }).then(onF);
      return chain;
    },
    rpc: (nome: string, args: Record<string, unknown>) => {
      chamadasRpc.push({ nome, args });
      return Promise.resolve(respostaRpc);
    },
  };
  return client;
}

const authClient = makeChain();
const createClient = vi.fn(async () => authClient);
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

// Escrita do lojista é RLS autenticada — service_role NUNCA deveria aparecer.
const createServiceClient = vi.fn(() => ({ __fake: "service" }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const buscarLojaDoDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import {
  aplicarCardapioEmProdutos,
  aplicarCardapioEmCategoria,
  tirarDeCardapio,
  preverLoteAction,
} from "./cardapio";

/** Toda operação que ESCREVE (a soma tem de ser 1 — uma instrução). */
function escritas(): Op[] {
  return ops.filter((o) => o.upsert || o.insert || o.deleted);
}
function leituras(): Op[] {
  return ops.filter((o) => o.selected && !o.upsert && !o.insert && !o.deleted);
}

function semRuido<T>(fn: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  return fn().finally(() => spy.mockRestore());
}

beforeEach(() => {
  vi.clearAllMocks();
  ops = [];
  chamadasRpc = [];
  respostaRpc = { data: 3, error: null };
  respostaPorTabela = {
    cardapio_produtos: { data: null, error: null },
    produtos: { data: [], error: null },
  };
  buscarLojaDoDono.mockResolvedValue({ id: LOJA_ID, slug: LOJA_SLUG });
});

// ══════════════════════════════════ aplicarCardapioEmProdutos (RN-09) ═══════

describe("aplicarCardapioEmProdutos — lista de ids do cliente (RN-09)", () => {
  const payload = (over: Record<string, unknown> = {}) => ({
    cardapio_id: CARDAPIO,
    produto_ids: [P1, P2, P3],
    ...over,
  });

  it("caminho feliz: UM upsert homogêneo, ignoreDuplicates, loja_id derivado — nunca do payload", async () => {
    const r = await aplicarCardapioEmProdutos(payload());
    expect(r).toEqual({ ok: true });

    expect(escritas()).toHaveLength(1);
    const w = escritas()[0];
    expect(w.tabela).toBe("cardapio_produtos");
    expect(w.upsert).toEqual([
      { loja_id: LOJA_ID, cardapio_id: CARDAPIO, produto_id: P1 },
      { loja_id: LOJA_ID, cardapio_id: CARDAPIO, produto_id: P2 },
      { loja_id: LOJA_ID, cardapio_id: CARDAPIO, produto_id: P3 },
    ]);
    // RN-10: reaplicar é idempotente pelo ON CONFLICT DO NOTHING, não por
    // um SELECT prévio de "quem já está".
    expect(w.upsertOpcoes).toMatchObject({
      onConflict: "cardapio_id,produto_id",
      ignoreDuplicates: true,
    });
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("[RN-09] NENHUM pre-check de posse em JS antes da escrita — seria TOCTOU", async () => {
    await aplicarCardapioEmProdutos(payload());
    // Nada de `select id from produtos where id in (...)` antes do insert.
    expect(leituras().some((o) => o.tabela === "produtos")).toBe(false);
    expect(leituras().some((o) => o.tabela === "cardapio_produtos")).toBe(false);
  });

  it("[RN-09 · cenário 5] `pB` derruba a operação inteira: UMA escrita tentada, mensagem genérica, 23503 nunca vira texto", async () => {
    respostaPorTabela.cardapio_produtos = { data: null, error: ERRO_FK_PRODUTO };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await aplicarCardapioEmProdutos(payload({ produto_ids: [P1, P2, PB, P3] }));

    expect(r).toEqual({ ok: false, erro: MSG_GENERICA });
    // Tudo ou nada: uma única instrução, com os QUATRO ids — jamais um upsert
    // por id, que gravaria os válidos e denunciaria qual é alheio.
    expect(escritas()).toHaveLength(1);
    expect(escritas()[0].upsert).toHaveLength(4);
    // §14: nem o SQLSTATE, nem o nome da constraint, nem o id alheio na UI.
    const texto = JSON.stringify(r);
    expect(texto).not.toContain("23503");
    expect(texto).not.toContain("cardapio_produtos_produto_fk");
    expect(texto).not.toContain(PB);
    // O detalhe vai para o log do servidor.
    expect(spy).toHaveBeenCalled();
    // Falhou ⇒ nada de revalidar cache.
    expect(revalidatePath).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("[RN-09] cardápio alheio (cardapio_produtos_cardapio_fk) ⇒ EXATAMENTE a mesma mensagem — sem oráculo", async () => {
    respostaPorTabela.cardapio_produtos = { data: null, error: ERRO_FK_CARDAPIO };
    const r = await semRuido(() =>
      aplicarCardapioEmProdutos(payload({ cardapio_id: CARDAPIO_ALHEIO })),
    );
    expect(r).toEqual({ ok: false, erro: MSG_GENERICA });
    expect(JSON.stringify(r)).not.toContain("cardapio_produtos_cardapio_fk");
  });

  it("[RN-10] reaplicar o MESMO lote continua { ok: true } — idempotente, sem erro ao lojista", async () => {
    await aplicarCardapioEmProdutos(payload());
    ops = [];
    const r = await aplicarCardapioEmProdutos(payload());
    expect(r).toEqual({ ok: true });
    expect(escritas()).toHaveLength(1);
  });

  it("[CWE-770] 201 ids ⇒ { ok:false } e ZERO I/O (teto de 200 no zod, antes de qualquer ida ao banco)", async () => {
    const muitos = Array.from(
      { length: 201 },
      (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`,
    );
    const r = await aplicarCardapioEmProdutos(payload({ produto_ids: muitos }));
    expect(r).toEqual({ ok: false, erro: MSG_GENERICA });
    expect(ops).toHaveLength(0);
    expect(buscarLojaDoDono).not.toHaveBeenCalled();
  });

  it("[CWE-770] exatamente 200 ids é ACEITO — o teto é 200, não 199", async () => {
    const duzentos = Array.from(
      { length: 200 },
      (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`,
    );
    const r = await aplicarCardapioEmProdutos(payload({ produto_ids: duzentos }));
    expect(r).toEqual({ ok: true });
    expect(escritas()[0].upsert).toHaveLength(200);
  });

  it("id duplicado na lista ⇒ { ok:false } e ZERO I/O", async () => {
    const r = await aplicarCardapioEmProdutos(payload({ produto_ids: [P1, P1, P2] }));
    expect(r).toEqual({ ok: false, erro: MSG_GENERICA });
    expect(ops).toHaveLength(0);
  });

  it("lista vazia, não-uuid, payload sem cardapio_id ⇒ { ok:false } e ZERO I/O", async () => {
    for (const lixo of [
      payload({ produto_ids: [] }),
      payload({ produto_ids: ["nao-e-uuid"] }),
      { produto_ids: [P1] },
      {},
      null,
    ]) {
      ops = [];
      const r = await aplicarCardapioEmProdutos(lixo);
      expect(r.ok).toBe(false);
      expect(ops).toHaveLength(0);
    }
  });

  it("propriedade hostil (`loja_id`) no payload não sobrevive ao parse e não chega em coluna nenhuma", async () => {
    const LOJA_B = "99999999-9999-4999-8999-999999999999";
    const r = await aplicarCardapioEmProdutos(payload({ loja_id: LOJA_B }));
    // Ou o `.strict()` recusa, ou o array novo do parse simplesmente descarta.
    // O que NÃO pode, em nenhuma das duas leituras, é `LOJA_B` virar dado.
    expect(JSON.stringify(ops)).not.toContain(LOJA_B);
    if (r.ok) expect(escritas()[0].upsert).toEqual(
      [P1, P2, P3].map((id) => ({ loja_id: LOJA_ID, cardapio_id: CARDAPIO, produto_id: id })),
    );
  });

  it("buscarLojaDoDono → null ⇒ { ok:false } e ZERO escrita", async () => {
    buscarLojaDoDono.mockResolvedValue(null);
    const r = await semRuido(() => aplicarCardapioEmProdutos(payload()));
    expect(r.ok).toBe(false);
    expect(escritas()).toHaveLength(0);
  });

  it("[RN-11] revalida os três caminhos pelo SLUG da própria loja — nunca a forma coringa", async () => {
    await aplicarCardapioEmProdutos(payload());
    const caminhos = revalidatePath.mock.calls.map((c) => c[0]);
    expect(caminhos).toContain("/painel/cardapios");
    expect(caminhos).toContain("/painel/produtos");
    expect(caminhos).toContain(`/loja/${LOJA_SLUG}`);
    expect(caminhos).not.toContain("/loja/[slug]");
    // `/painel/cardapio` (singular) não existe como rota — débito de produto.ts.
    expect(caminhos).not.toContain("/painel/cardapio");
    expect(revalidatePath.mock.calls.every((c) => c[1] !== "page")).toBe(true);
  });
});

// ═══════════════════════════ aplicarCardapioEmCategoria (RN-10, via RPC) ════

describe("aplicarCardapioEmCategoria — a categoria expandida DENTRO da transação (RN-10)", () => {
  const payload = (over: Record<string, unknown> = {}) => ({
    cardapio_id: CARDAPIO,
    categoria_id: CATEGORIA,
    ...over,
  });

  it("chama a RPC UMA vez com p_loja_id derivado, p_cardapio_id e p_categoria_id — e não expande a lista em JS", async () => {
    const r = await aplicarCardapioEmCategoria(payload());
    expect(r).toEqual({ ok: true });
    expect(chamadasRpc).toEqual([
      {
        nome: "aplicar_cardapio_em_categoria",
        args: { p_loja_id: LOJA_ID, p_cardapio_id: CARDAPIO, p_categoria_id: CATEGORIA },
      },
    ]);
    // RN-10: a lista de produtos NUNCA é lida em JS para ser reenviada.
    expect(leituras().some((o) => o.tabela === "produtos")).toBe(false);
    expect(escritas()).toHaveLength(0);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("os fragmentos da RPC (`loja alheia`, `cardapio fora da loja`, `categoria fora da loja`) viram UMA mensagem genérica e vão para o log", async () => {
    for (const fragmento of ["loja alheia", "cardapio fora da loja", "categoria fora da loja"]) {
      chamadasRpc = [];
      respostaRpc = {
        data: null,
        error: { code: "P0001", message: `aplicar_cardapio_em_categoria: ${fragmento}` },
      };
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const r = await aplicarCardapioEmCategoria(payload());
      expect(r).toEqual({ ok: false, erro: MSG_GENERICA });
      expect(JSON.stringify(r)).not.toContain(fragmento);
      expect(JSON.stringify(r)).not.toContain("P0001");
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  it("categoria_id ausente ou não-uuid ⇒ { ok:false } e ZERO RPC", async () => {
    for (const lixo of [payload({ categoria_id: "nao-e-uuid" }), { cardapio_id: CARDAPIO }]) {
      chamadasRpc = [];
      const r = await aplicarCardapioEmCategoria(lixo);
      expect(r.ok).toBe(false);
      expect(chamadasRpc).toHaveLength(0);
    }
  });
});

// ═══════════════════════════════════════════════ tirarDeCardapio (D2) ══════

describe("tirarDeCardapio — o DELETE também é escopado pela loja do dono", () => {
  const payload = () => ({ cardapio_id: CARDAPIO, produto_ids: [P1, P2] });

  it("delete escopado por loja_id (derivado), cardapio_id e a lista — uma instrução", async () => {
    const r = await tirarDeCardapio(payload());
    expect(r).toEqual({ ok: true });
    expect(escritas()).toHaveLength(1);
    const w = escritas()[0];
    expect(w.tabela).toBe("cardapio_produtos");
    expect(w.deleted).toBe(true);
    expect(w.filtros).toContainEqual(["loja_id", LOJA_ID]);
    expect(w.filtros).toContainEqual(["cardapio_id", CARDAPIO]);
    expect(w.filtros).toContainEqual(["produto_id", [P1, P2]]);
  });

  it("usa o MESMO zod da gravação: duplicata e 201 ids ⇒ { ok:false } e ZERO I/O", async () => {
    for (const ids of [
      [P1, P1],
      Array.from({ length: 201 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`),
    ]) {
      ops = [];
      const r = await tirarDeCardapio({ cardapio_id: CARDAPIO, produto_ids: ids });
      expect(r.ok).toBe(false);
      expect(ops).toHaveLength(0);
    }
  });
});

// ════════════════════════════════════ preverLoteAction (RN-09-a) ═══════════

describe("preverLoteAction — a prévia vem do servidor e só mostra o que é seu (RN-09-a)", () => {
  it("[RN-09-a] `[p1, pB]` ⇒ total = 1 e SÓ o nome de p1: o id da loja B não aparece e não muda nada", async () => {
    // O servidor lê `where id in (...) and loja_id = <própria>`: `pB`
    // simplesmente NÃO volta. Nenhuma contagem de "ignorados", nenhuma
    // mensagem distinta — senão a prévia vira oráculo de existência (§14).
    respostaPorTabela.produtos = {
      data: [{ id: P1, nome: "Sopa de cebola", visibilidade: "menu" }],
      error: null,
    };

    const r = await preverLoteAction({ produto_ids: [P1, PB] });

    expect(r).toMatchObject({ ok: true, total: 1, nomes: ["Sopa de cebola"] });
    const texto = JSON.stringify(r);
    expect(texto).not.toContain(PB);
    expect(texto).not.toContain("ignorado");
    expect(texto.toLowerCase()).not.toContain("outra loja");
    // E nada de erro/aviso: a resposta é indistinguível da de uma lista de 1.
    if (r.ok) expect(Object.keys(r)).not.toContain("erro");
  });

  it("[RN-09-a] a prévia de `[p1, pB]` é IDÊNTICA à de `[p1]` — não dá para inferir que pB existe", async () => {
    respostaPorTabela.produtos = {
      data: [{ id: P1, nome: "Sopa de cebola", visibilidade: "menu" }],
      error: null,
    };
    const comAlheio = await preverLoteAction({ produto_ids: [P1, PB] });
    ops = [];
    const soProprio = await preverLoteAction({ produto_ids: [P1] });
    expect(comAlheio).toEqual(soProprio);
  });

  it("[RN-09-a] a leitura é escopada pela PRÓPRIA loja e NÃO grava nada", async () => {
    respostaPorTabela.produtos = {
      data: [{ id: P1, nome: "Sopa de cebola", visibilidade: "menu" }],
      error: null,
    };
    await preverLoteAction({ produto_ids: [P1, PB] });

    expect(escritas()).toHaveLength(0);
    expect(chamadasRpc).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();

    const leitura = leituras().find((o) => o.tabela === "produtos");
    expect(leitura).toBeDefined();
    expect(leitura!.filtros).toContainEqual(["loja_id", LOJA_ID]);
    expect(leitura!.filtros).toContainEqual(["id", [P1, PB]]);
  });

  it("[design §10.3] `nomes` para em 6; `total` é a contagem INTEIRA", async () => {
    const sete = Array.from({ length: 7 }, (_, i) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`,
      nome: `Produto ${i}`,
      visibilidade: "menu",
    }));
    respostaPorTabela.produtos = { data: sete, error: null };

    const r = await preverLoteAction({ produto_ids: sete.map((p) => p.id) });
    expect(r).toMatchObject({ ok: true, total: 7 });
    if (r.ok) {
      expect(r.nomes).toHaveLength(6);
      expect(r.nomes[0]).toBe("Produto 0");
    }
  });

  it("[D14] a prévia devolve os DOIS números — quantos são 'menu' e quantos 'cardapio' — pela MESMA leitura", async () => {
    respostaPorTabela.produtos = {
      data: [
        { id: P1, nome: "Sopa de cebola", visibilidade: "menu" },
        { id: P2, nome: "Sopa exclusiva", visibilidade: "cardapio" },
        { id: P3, nome: "Caldo verde", visibilidade: "cardapio" },
      ],
      error: null,
    };
    const r = await preverLoteAction({ produto_ids: [P1, P2, P3] });
    expect(r).toMatchObject({ ok: true, total: 3, menu: 1, cardapio: 2 });
    // Uma leitura só: o cliente não conta nada e o servidor não lê duas vezes.
    expect(leituras().filter((o) => o.tabela === "produtos")).toHaveLength(1);
  });

  it("[RN-10] por categoria: conta os produtos da categoria AGORA, escopado pela própria loja", async () => {
    respostaPorTabela.produtos = {
      data: [
        { id: P1, nome: "Sopa de cebola", visibilidade: "menu" },
        { id: P2, nome: "Caldo verde", visibilidade: "menu" },
      ],
      error: null,
    };
    const r = await preverLoteAction({ categoria_id: CATEGORIA });
    expect(r).toMatchObject({ ok: true, total: 2 });

    const leitura = leituras().find((o) => o.tabela === "produtos");
    expect(leitura!.filtros).toContainEqual(["categoria_id", CATEGORIA]);
    expect(leitura!.filtros).toContainEqual(["loja_id", LOJA_ID]);
    expect(escritas()).toHaveLength(0);
  });

  it("usa o MESMO zod da gravação: 201 ids e duplicata ⇒ { ok:false } e ZERO I/O", async () => {
    for (const ids of [
      [P1, P1],
      Array.from({ length: 201 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`),
    ]) {
      ops = [];
      const r = await preverLoteAction({ produto_ids: ids });
      expect(r.ok).toBe(false);
      expect(ops).toHaveLength(0);
    }
  });

  it("erro de banco na leitura ⇒ { ok:false } com mensagem genérica, sem vazar detalhe", async () => {
    respostaPorTabela.produtos = {
      data: null,
      error: { code: "42P01", message: "detalhe interno do postgres" },
    };
    const r = await semRuido(() => preverLoteAction({ produto_ids: [P1] }));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("detalhe interno");
    expect(JSON.stringify(r)).not.toContain("42P01");
  });
});
