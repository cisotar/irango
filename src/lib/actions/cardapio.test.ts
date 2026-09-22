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
  /** [274 · R2] A LINHA do UPDATE e o 2º argumento (`{ count: "exact" }`). */
  update?: Record<string, unknown>;
  updateOpcoes?: unknown;
  deleted?: boolean;
  deleteOpcoes?: unknown;
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
      // [274 · R2] Sem capturar o 2º argumento, "a action pediu `count:
      // "exact"`" é indistinguível de "o mock devolveu o count que quis".
      chain.update = (valores: Record<string, unknown>, opcoes?: unknown) => {
        op.update = valores;
        op.updateOpcoes = opcoes;
        return chain;
      };
      chain.delete = (opcoes?: unknown) => {
        op.deleted = true;
        op.deleteOpcoes = opcoes;
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
  // [274 · D8] As quatro que passam a LER o `count` (espelho do admin).
  atualizarCardapio,
  ligarDesligarCardapio,
  removerCardapio,
  converterExclusivosParaMenu,
} from "./cardapio";

/** Toda operação que ESCREVE (a soma tem de ser 1 — uma instrução). */
function escritas(): Op[] {
  return ops.filter((o) => o.upsert || o.insert || o.deleted || o.update);
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
    // [270] A prova de POSSE do cardápio (`cardapioPertenceALoja`) lê UMA linha
    // de `cardapios` escopada por `loja_id` + `id`. O default é a loja DONA do
    // cardápio: sem ele, todo caminho feliz de lote seria recusado pelo mock, e
    // o RED dos casos de posse viria afogado em falha espúria. Os casos de
    // cardápio ALHEIO/INEXISTENTE sobrescrevem com `data: null`, que é o que o
    // `.eq("loja_id", <própria>)` produz nos dois.
    cardapios: { data: { id: CARDAPIO }, error: null },
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
    // [287] `dias_semana: null` é a chave SEMPRE escrita: no banco é idêntica
    // à linha de antes (coluna nullable, sem default) e `null` é "todos os dias
    // do cardápio" (RN-11). A agenda em si é provada em
    // `cardapio.dias-no-lote.test.ts`.
    expect(w.upsert).toEqual([
      { loja_id: LOJA_ID, cardapio_id: CARDAPIO, produto_id: P1, dias_semana: null },
      { loja_id: LOJA_ID, cardapio_id: CARDAPIO, produto_id: P2, dias_semana: null },
      { loja_id: LOJA_ID, cardapio_id: CARDAPIO, produto_id: P3, dias_semana: null },
    ]);
    // RN-10: reaplicar é idempotente pelo ON CONFLICT DO NOTHING, não por
    // um SELECT prévio de "quem já está".
    expect(w.upsertOpcoes).toMatchObject({
      onConflict: "cardapio_id,produto_id",
      ignoreDuplicates: true,
    });
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("[RN-09 · 270] a LISTA DE PRODUTOS nunca é lida antes da escrita; a posse é UMA leitura de `cardapios` por id", async () => {
    // O que a 251 proibiu foi o pre-check da LISTA: a diferença entre o que
    // foi pedido e o que foi gravado denunciaria quais ids existem em outra
    // loja (oráculo, §14). Ler UM id de cardápio da PRÓPRIA loja não produz
    // diferença observável — alheio e inexistente saem pela mesma frase — e é
    // a única camada que pega a brecha da 270 (`ON CONFLICT DO NOTHING`
    // descarta a linha ANTES de a FK composta ser avaliada).
    await aplicarCardapioEmProdutos(payload());

    // Nada de `select id from produtos where id in (...)` antes do upsert.
    expect(leituras().some((o) => o.tabela === "produtos")).toBe(false);
    // Nem de "quem já está" — RN-10 é do `ignoreDuplicates`, não de um SELECT.
    expect(leituras().some((o) => o.tabela === "cardapio_produtos")).toBe(false);

    const posse = leituras().filter((o) => o.tabela === "cardapios");
    expect(posse, "a posse do cardápio é UMA leitura, não N").toHaveLength(1);
    expect(posse[0].colunas).toBe("id");
    expect(posse[0].filtros).toContainEqual(["loja_id", LOJA_ID]);
    expect(posse[0].filtros).toContainEqual(["id", CARDAPIO]);

    // E continua havendo UMA única instrução de escrita.
    expect(escritas()).toHaveLength(1);
    expect(ops.indexOf(posse[0])).toBeLessThan(ops.indexOf(escritas()[0]));
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

// ═════════════ [270] posse do cardápio provada ANTES da escrita (lojista) ════
//
// Fase RED da issue 270. A brecha que o `ON CONFLICT (cardapio_id, produto_id)
// DO NOTHING` abre: quando o par já existe na loja DONA do cardápio, a linha é
// descartada ANTES de a FK composta `(cardapio_id, loja_id)` ser avaliada — o
// upsert termina sem erro e a action devolve `{ ok: true }` por uma escrita que
// não aconteceu. `tests/migrations/cardapio_produtos_on_conflict_pula_fk.test.ts`
// já prova essa semântica em SQL real; o fix é a camada de aplicação acima dela.
//
// O mesmo vale para `tirarDeCardapio`: o DELETE escopado por `loja_id` +
// `cardapio_id` apaga 0 linhas com cardápio alheio e devolve `{ ok: true }`.
//
// Nenhuma linha cruza lojas em nenhum dos dois — o que se conserta é o SUCESSO
// MENTIROSO, e no admin (paridade) a entrada de auditoria com entidade alheia.

describe("[270] cardápio alheio/inexistente é recusado antes da escrita", () => {
  /** O que o `.eq("loja_id", <própria>)` devolve para alheio E para inexistente. */
  function semPosse() {
    respostaPorTabela.cardapios = { data: null, error: null };
  }

  const CARDAPIO_INEXISTENTE = "cfcfcfcf-cfcf-4cfc-8cfc-cfcfcfcfcfcf";

  it("aplicarCardapioEmProdutos: cardápio de outra loja ⇒ genérica, ZERO escrita, ZERO revalidate", async () => {
    semPosse();
    const r = await semRuido(() =>
      aplicarCardapioEmProdutos({ cardapio_id: CARDAPIO_ALHEIO, produto_ids: [P1, P2] }),
    );

    expect(r).toEqual({ ok: false, erro: MSG_GENERICA });
    expect(escritas()).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
    // §14: o id alheio nunca volta na resposta.
    expect(JSON.stringify(r)).not.toContain(CARDAPIO_ALHEIO);
  });

  it("aplicarCardapioEmProdutos: alheio e inexistente são byte a byte a MESMA resposta", async () => {
    semPosse();
    const alheio = await semRuido(() =>
      aplicarCardapioEmProdutos({ cardapio_id: CARDAPIO_ALHEIO, produto_ids: [P1] }),
    );
    const opsAlheio = ops.length;
    ops = [];
    const inexistente = await semRuido(() =>
      aplicarCardapioEmProdutos({ cardapio_id: CARDAPIO_INEXISTENTE, produto_ids: [P1] }),
    );

    expect(JSON.stringify(alheio)).toBe(JSON.stringify(inexistente));
    // Nem o número de idas ao banco diferencia os dois casos.
    expect(opsAlheio).toBe(ops.length);
  });

  it("tirarDeCardapio: cardápio de outra loja ⇒ genérica, nenhum DELETE emitido", async () => {
    semPosse();
    const r = await semRuido(() =>
      tirarDeCardapio({ cardapio_id: CARDAPIO_ALHEIO, produto_ids: [P1, P2] }),
    );

    expect(r).toEqual({ ok: false, erro: MSG_GENERICA });
    expect(escritas()).toHaveLength(0);
    expect(ops.some((o) => o.deleted)).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("tirarDeCardapio: alheio e inexistente são byte a byte a MESMA resposta", async () => {
    semPosse();
    const alheio = await semRuido(() =>
      tirarDeCardapio({ cardapio_id: CARDAPIO_ALHEIO, produto_ids: [P1] }),
    );
    const inexistente = await semRuido(() =>
      tirarDeCardapio({ cardapio_id: CARDAPIO_INEXISTENTE, produto_ids: [P1] }),
    );
    expect(JSON.stringify(alheio)).toBe(JSON.stringify(inexistente));
  });

  it("tirarDeCardapio lê a posse com o MESMO escopo explícito do DELETE", async () => {
    await tirarDeCardapio({ cardapio_id: CARDAPIO, produto_ids: [P1] });
    const posse = leituras().filter((o) => o.tabela === "cardapios");
    expect(posse).toHaveLength(1);
    expect(posse[0].filtros).toContainEqual(["loja_id", LOJA_ID]);
    expect(posse[0].filtros).toContainEqual(["id", CARDAPIO]);
  });

  it("falha de banco NA LEITURA de posse é FAIL-CLOSED: recusa genérica e nenhuma escrita", async () => {
    respostaPorTabela.cardapios = {
      data: null,
      error: { code: "57014", message: "statement timeout interno" },
    };
    const r = await semRuido(() =>
      aplicarCardapioEmProdutos({ cardapio_id: CARDAPIO, produto_ids: [P1] }),
    );

    expect(r).toEqual({ ok: false, erro: MSG_GENERICA });
    expect(escritas()).toHaveLength(0);
    expect(JSON.stringify(r)).not.toContain("57014");
    expect(JSON.stringify(r)).not.toContain("statement timeout");
  });

  it("a posse é consultada DEPOIS do zod: payload inválido segue com ZERO I/O", async () => {
    semPosse();
    const r = await aplicarCardapioEmProdutos({
      cardapio_id: CARDAPIO_ALHEIO,
      produto_ids: [],
    });
    expect(r).toEqual({ ok: false, erro: MSG_GENERICA });
    expect(ops).toHaveLength(0);
  });
});

// ════════════════════ [274] `definirDiasDoVinculo` — a agenda do VÍNCULO ════
//
// Fase RED da issue 274 (RN-10, RN-11, RN-12, RN-14). A action ainda não
// existe; o import por caminho em VARIÁVEL mantém `npx tsc --noEmit` limpo e
// faz cada caso falhar com a SUA mensagem, em vez de matar o arquivo na coleta.
//
// O que este bloco prova, e o `admin-cardapios.paridade.test.ts` prova em
// espelho byte a byte do outro lado:
//  - a posse é provada PELA PRÓPRIA ESCRITA: UPDATE `where loja_id ∧
//    cardapio_id ∧ produto_id` com `count: "exact"`, e `count === 0` É a
//    recusa (D5/D6) — sem SELECT prévio, sem TOCTOU, sem oráculo;
//  - `loja_id` vem de `buscarLojaDoDono`, NUNCA do payload (RN-10);
//  - `[]` chega ao banco como `NULL`, `[1,1,3]` como `[1,3]` (RN-11);
//  - alheio e inexistente saem pela MESMA frase, byte a byte (§14).

const MODULO_LOJISTA = "./cardapio";

/** A frase de RN-12, escrita à MÃO (D3) — importá-la provaria só que o símbolo existe. */
const MSG_DIAS_DO_VINCULO = "Não foi possível salvar os dias deste item.";
/** As três de D8, também à mão: o mesmo motivo, os mesmos bytes do contrato. */
const MSG_SALVAR = "Não foi possível salvar o cardápio.";
const MSG_REMOVER = "Não foi possível remover o cardápio.";
const MSG_CONVERTER =
  "Não foi possível converter os produtos deste cardápio para o menu.";

type ResultadoDias = { ok: true } | { ok: false; erro: string };
type Cardapio274 = {
  definirDiasDoVinculo(payload: unknown): Promise<ResultadoDias>;
};

async function acoes274(): Promise<Cardapio274> {
  const m = (await import(/* @vite-ignore */ MODULO_LOJISTA)) as unknown as Partial<Cardapio274>;
  if (typeof m.definirDiasDoVinculo !== "function") {
    throw new Error(
      "[RED 274] `definirDiasDoVinculo` ainda não existe em `src/lib/actions/cardapio.ts` — " +
        "é a fase GREEN da issue 274 (D5 do plano).",
    );
  }
  return m as Cardapio274;
}

const dias = (over: Record<string, unknown> = {}) => ({
  cardapio_id: CARDAPIO,
  produto_id: P1,
  dias_semana: [3],
  ...over,
});

/** A resposta do UPDATE do vínculo, com o `count` que o teste quer provar. */
function vinculoResponde(count: number | null | undefined, error: unknown = null) {
  respostaPorTabela.cardapio_produtos = { data: null, error, count: count ?? undefined };
}

describe("[274 · A] definirDiasDoVinculo — UPDATE escopado pela TRIPLA, count exact", () => {
  it("A1: UMA escrita em `cardapio_produtos`, `count: \"exact\"` e os TRÊS filtros nomeados", async () => {
    vinculoResponde(1);
    const { definirDiasDoVinculo } = await acoes274();
    const r = await definirDiasDoVinculo(dias());

    expect(r).toEqual({ ok: true });
    expect(escritas()).toHaveLength(1);
    const w = escritas()[0];
    expect(w.tabela).toBe("cardapio_produtos");
    expect(w.update).toEqual({ dias_semana: [3] });
    expect(w.updateOpcoes, "sem `count: \"exact\"` a recusa por 0 linhas é decorativa").toEqual({
      count: "exact",
    });
    // Os três, nomeando a coluna — `loja_id` é o DERIVADO, não o do payload.
    expect(w.filtros).toContainEqual(["loja_id", LOJA_ID]);
    expect(w.filtros).toContainEqual(["cardapio_id", CARDAPIO]);
    expect(w.filtros).toContainEqual(["produto_id", P1]);
    expect(w.filtros.map(([c]) => c).sort()).toEqual(["cardapio_id", "loja_id", "produto_id"]);
    // Escrita do lojista é RLS autenticada: service_role nunca aparece.
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("A2 (RN-11): `dias_semana: []` chega ao banco como NULL, nunca como `[]`", async () => {
    vinculoResponde(1);
    const { definirDiasDoVinculo } = await acoes274();
    const r = await definirDiasDoVinculo(dias({ dias_semana: [] }));
    expect(r).toEqual({ ok: true });
    expect(escritas()[0].update).toEqual({ dias_semana: null });
  });

  it("A3/A4 (RN-11): `[1,1,3]` e `[3,1]` gravam `[1,3]` — dedup e ordem no SERVIDOR", async () => {
    vinculoResponde(1);
    const { definirDiasDoVinculo } = await acoes274();

    await definirDiasDoVinculo(dias({ dias_semana: [1, 1, 3] }));
    expect(escritas()[0].update).toEqual({ dias_semana: [1, 3] });

    ops = [];
    await definirDiasDoVinculo(dias({ dias_semana: [3, 1] }));
    expect(escritas()[0].update).toEqual({ dias_semana: [1, 3] });
  });

  it("A1-b: o UPDATE toca SÓ `dias_semana` — nada de `loja_id`, `cardapio_id` ou `produto_id` no patch", async () => {
    vinculoResponde(1);
    const { definirDiasDoVinculo } = await acoes274();
    await definirDiasDoVinculo(dias());
    const patch = escritas()[0].update ?? {};
    expect(Object.keys(patch)).toEqual(["dias_semana"]);
  });

  it("A5 (RN-10): `loja_id` hostil no payload é RECUSADO pelo `.strict()`, com ZERO I/O", async () => {
    const LOJA_B = "99999999-9999-4999-8999-999999999999";
    const { definirDiasDoVinculo } = await acoes274();
    const r = await definirDiasDoVinculo(dias({ loja_id: LOJA_B }));

    expect(r).toEqual({ ok: false, erro: MSG_DIAS_DO_VINCULO });
    expect(ops, "recusa acontece ANTES de qualquer ida ao banco").toHaveLength(0);
    expect(buscarLojaDoDono).not.toHaveBeenCalled();
    expect(JSON.stringify(ops)).not.toContain(LOJA_B);
  });

  it("payload fora da forma (dia 7, 8 itens, id não-uuid) ⇒ a MESMA frase e ZERO I/O", async () => {
    const { definirDiasDoVinculo } = await acoes274();
    for (const payload of [
      dias({ dias_semana: [7] }),
      dias({ dias_semana: [-1] }),
      dias({ dias_semana: [1.5] }),
      dias({ dias_semana: [1, 1, 1, 1, 1, 1, 1, 1] }),
      dias({ cardapio_id: "nao-e-uuid" }),
      dias({ produto_id: "nao-e-uuid" }),
      {},
      null,
    ]) {
      ops = [];
      const r = await definirDiasDoVinculo(payload);
      expect(r, `${JSON.stringify(payload)} deveria ser recusado`).toEqual({
        ok: false,
        erro: MSG_DIAS_DO_VINCULO,
      });
      expect(ops).toHaveLength(0);
    }
  });

  it("A6/A7 (§14): `count: 0` de cardápio ALHEIO e de par INEXISTENTE são a MESMA resposta, byte a byte", async () => {
    vinculoResponde(0);
    const { definirDiasDoVinculo } = await acoes274();

    const alheio = await definirDiasDoVinculo(dias({ cardapio_id: CARDAPIO_ALHEIO }));
    ops = [];
    const inexistente = await definirDiasDoVinculo(
      dias({ cardapio_id: "cfcfcfcf-cfcf-4cfc-8cfc-cfcfcfcfcfcf" }),
    );

    expect(alheio).toEqual({ ok: false, erro: MSG_DIAS_DO_VINCULO });
    expect(JSON.stringify(alheio)).toBe(JSON.stringify(inexistente));
    // §14: nenhum id alheio volta na resposta.
    expect(JSON.stringify(alheio)).not.toContain(CARDAPIO_ALHEIO);
  });

  it("A13/A15: `count: 0` NÃO loga e NÃO revalida nada", async () => {
    vinculoResponde(0);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { definirDiasDoVinculo } = await acoes274();
    const r = await definirDiasDoVinculo(dias());

    expect(r).toEqual({ ok: false, erro: MSG_DIAS_DO_VINCULO });
    expect(spy, "id que não existe NESTA loja não é erro de servidor").not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("A12: `error` do PostgREST ⇒ a mesma frase na UI, detalhe cru SÓ no log", async () => {
    vinculoResponde(null, {
      code: "23514",
      message: 'violates check constraint "cardapio_produtos_dias_semana_dominio"',
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { definirDiasDoVinculo } = await acoes274();
    const r = await definirDiasDoVinculo(dias());

    expect(r).toEqual({ ok: false, erro: MSG_DIAS_DO_VINCULO });
    expect(spy).toHaveBeenCalled();
    const texto = JSON.stringify(r);
    expect(texto).not.toContain("23514");
    expect(texto).not.toContain("cardapio_produtos_dias_semana_dominio");
    expect(revalidatePath).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("R4: `count` ausente (`null`/`undefined`) NÃO recusa — a recusa é em `0` estrito", async () => {
    const { definirDiasDoVinculo } = await acoes274();
    for (const count of [null, undefined]) {
      ops = [];
      vinculoResponde(count);
      expect(await definirDiasDoVinculo(dias()), `count: ${count} não pode recusar`).toEqual({
        ok: true,
      });
    }
  });

  it("A15 (D9): o sucesso revalida o DETALHE concreto do cardápio, além da lista e da vitrine", async () => {
    vinculoResponde(1);
    const { definirDiasDoVinculo } = await acoes274();
    await definirDiasDoVinculo(dias());

    const caminhos = revalidatePath.mock.calls.map((c) => c[0]);
    expect(
      caminhos,
      "`/painel/cardapios` não invalida `/painel/cardapios/[cardapioId]`, que é a tela desta feature",
    ).toContain(`/painel/cardapios/${CARDAPIO}`);
    expect(caminhos).toContain("/painel/cardapios");
    expect(caminhos).toContain(`/loja/${LOJA_SLUG}`);
    // Nem a forma coringa, nem `"layout"` (derrubaria o detalhe de todos).
    expect(caminhos).not.toContain("/loja/[slug]");
    expect(caminhos).not.toContain("/painel/cardapios/[cardapioId]");
    expect(revalidatePath.mock.calls.every((c) => c[1] !== "layout")).toBe(true);
  });

  it("sessão sem loja (`buscarLojaDoDono` → null) ⇒ a mesma frase e ZERO escrita", async () => {
    buscarLojaDoDono.mockResolvedValue(null);
    const { definirDiasDoVinculo } = await acoes274();
    const r = await semRuido(() => definirDiasDoVinculo(dias()));
    expect(r).toEqual({ ok: false, erro: MSG_DIAS_DO_VINCULO });
    expect(escritas()).toHaveLength(0);
  });

  it("D6: a posse NÃO custa uma segunda ida ao banco — nenhum SELECT antes do UPDATE", async () => {
    vinculoResponde(1);
    const { definirDiasDoVinculo } = await acoes274();
    await definirDiasDoVinculo(dias());
    // O `count` do próprio UPDATE é a prova; um `select` de posse seria TOCTOU
    // e um round trip a mais (o UPDATE já é estritamente mais forte).
    expect(leituras()).toHaveLength(0);
    expect(ops).toHaveLength(1);
  });
});

// ══════════ [274 · B] D8 — `count: 0` deixa de ser sucesso mudo no LOJISTA ══
//
// Item absorvido da auditoria da 270, espelho do admin. Hoje as quatro actions
// descartam o `count`: id inexistente ou de outra loja casa ZERO linhas, o
// UPDATE/DELETE termina sem `error` e a UI diz "salvo" por uma escrita que não
// aconteceu. Não é falha de segurança (a RLS + `.eq("loja_id")` já impedem a
// escrita) — é mentira de interface, e a frase de alheio é a MESMA de
// inexistente, então nada vira oráculo.

describe("[274 · B] D8 — as quatro do lojista leem o `count` e recusam em 0", () => {
  const recorrente = {
    nome: "Segunda",
    modo: "recorrente",
    dias_semana: [1],
    dias_mes: null,
    hora_inicio: null,
    hora_fim: null,
  };

  it("atualizarCardapio: `count: 0` ⇒ `{ ok:false, MSG_SALVAR }`, com `count: \"exact\"` pedido", async () => {
    respostaPorTabela.cardapios = { data: null, error: null, count: 0 };
    const r = await semRuido(() => atualizarCardapio(CARDAPIO_ALHEIO, recorrente));

    expect(r).toEqual({ ok: false, erro: MSG_SALVAR });
    expect(escritas()[0]?.updateOpcoes).toEqual({ count: "exact" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("ligarDesligarCardapio: `count: 0` ⇒ `{ ok:false, MSG_SALVAR }`", async () => {
    respostaPorTabela.cardapios = { data: null, error: null, count: 0 };
    const r = await semRuido(() => ligarDesligarCardapio(CARDAPIO_ALHEIO, false));

    expect(r).toEqual({ ok: false, erro: MSG_SALVAR });
    expect(escritas()[0]?.updateOpcoes).toEqual({ count: "exact" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("removerCardapio: `count: 0` ⇒ `{ ok:false, MSG_REMOVER, exclusivos: 0 }`", async () => {
    respostaPorTabela.cardapios = { data: null, error: null, count: 0 };
    const r = await semRuido(() => removerCardapio(CARDAPIO_ALHEIO));

    expect(r).toEqual({ ok: false, erro: MSG_REMOVER, exclusivos: 0 });
    expect(escritas()[0]?.deleteOpcoes).toEqual({ count: "exact" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("converterExclusivosParaMenu: cardápio alheio é recusado ANTES de ler os órfãos", async () => {
    // Sem posse: `cardapioPertenceALoja` devolve `data: null` para alheio E
    // para inexistente — o `.eq("loja_id", <própria>)` produz os dois iguais.
    respostaPorTabela.cardapios = { data: null, error: null };
    const r = await semRuido(() => converterExclusivosParaMenu(CARDAPIO_ALHEIO));

    expect(r).toEqual({ ok: false, erro: MSG_CONVERTER });
    // O gate vem ANTES da leitura: nenhum vínculo de cardápio alheio é lido.
    expect(
      ops.some((o) => o.tabela === "cardapio_produtos"),
      "buscarProdutosQueFicariamOrfaos não pode rodar sem posse provada",
    ).toBe(false);
    expect(escritas()).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("R4 (regressão): `count` ausente continua `{ ok: true }` nas quatro", async () => {
    respostaPorTabela.cardapios = { data: { id: CARDAPIO }, error: null };
    expect(await semRuido(() => atualizarCardapio(CARDAPIO, recorrente))).toEqual({ ok: true });
    expect(await semRuido(() => ligarDesligarCardapio(CARDAPIO, true))).toEqual({ ok: true });
    expect(await semRuido(() => removerCardapio(CARDAPIO))).toEqual({ ok: true });
    expect(await semRuido(() => converterExclusivosParaMenu(CARDAPIO))).toEqual({ ok: true });
  });
});
