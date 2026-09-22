import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) da issue 287 — `dias_semana` no LOTE de produtos do cardápio,
 * lado LOJISTA (`aplicarCardapioEmProdutos`).
 *
 * Plano: `plan/tecnico-cardapio-detalhe-refat.md` · FASE 1 · §"Propagação".
 * A forma do payload é provada em `src/lib/validacoes/cardapio.test.ts`; ESTE
 * arquivo prova a PROPAGAÇÃO: o valor normalizado tem de chegar a CADA linha do
 * `upsert`, sem afrouxar nada do que a 251/270 já travaram — `loja_id` derivado
 * de `auth.uid()`, posse do cardápio provada ANTES da escrita, UMA instrução,
 * mensagem genérica única.
 *
 * Arquivo separado de `cardapio.test.ts` de propósito: aquele é o contrato de
 * fronteira das cinco actions de lote e não deve ganhar um eixo novo de
 * variação no meio. Mesmo molde de mocks (só I/O), com captura das linhas.
 *
 * Nenhum código de produção aqui. Quem deixa verde é `executar`.
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";
const LOJA_SLUG = "lanches-base";

const CARDAPIO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CARDAPIO_ALHEIO = "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd";

const P1 = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const P2 = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";

/**
 * A única mensagem que o lojista pode ver, para QUALQUER falha do lote —
 * escrita à MÃO, byte a byte, em vez de importada de `cardapio-contrato.ts`.
 * Importá-la provaria só que a action usa o mesmo símbolo, não que o símbolo
 * continua dizendo a mesma coisa (memória do projeto: SQLSTATE/identidade de
 * símbolo não basta em teste de escopo — o fragmento literal é afirmado).
 */
const MSG_GENERICA_LOTE =
  "Não foi possível aplicar o cardápio aos produtos selecionados.";

// ── Captura do que cada operação manda ao banco ──────────────────────────────
type Op = {
  tabela: string;
  upsert?: Record<string, unknown>[];
  upsertOpcoes?: Record<string, unknown>;
  insert?: unknown;
  update?: Record<string, unknown>;
  deleted?: boolean;
  selected?: boolean;
  colunas?: string;
  filtros: Array<[string, unknown]>;
};

let ops: Op[];
let respostaPorTabela: Record<string, { data: unknown; error: unknown }>;

function makeChain() {
  return {
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
      ["select", "eq", "in", "order", "limit", "single", "maybeSingle", "is"].forEach(
        passthrough,
      );
      chain.upsert = (linhas: Record<string, unknown>[], opcoes?: Record<string, unknown>) => {
        op.upsert = linhas;
        op.upsertOpcoes = opcoes;
        return chain;
      };
      chain.insert = (linhas: unknown) => {
        op.insert = linhas;
        return chain;
      };
      chain.update = (valores: Record<string, unknown>) => {
        op.update = valores;
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
    rpc: vi.fn(async () => ({ data: null, error: null })),
  };
}

const authClient = makeChain();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => authClient }));

// Escrita do lojista é RLS autenticada — service_role NUNCA deveria aparecer.
const createServiceClient = vi.fn(() => ({ __fake: "service" }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const buscarLojaDoDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
}));

/**
 * [270] A posse do cardápio é mockada no nível da QUERY, não do client: é a
 * trava que o campo novo não pode afrouxar, e ela precisa ser controlável em
 * um caso só sem mexer nas respostas de tabela dos outros.
 */
const cardapioPertenceALoja = vi.fn(async () => true);
const buscarLinhasDaPrevia = vi.fn(async () => []);
const buscarProdutosQueFicariamOrfaos = vi.fn(async () => []);
vi.mock("@/lib/supabase/queries/cardapios", () => ({
  cardapioPertenceALoja: (...a: unknown[]) => cardapioPertenceALoja(...(a as [])),
  buscarLinhasDaPrevia: (...a: unknown[]) => buscarLinhasDaPrevia(...(a as [])),
  buscarProdutosQueFicariamOrfaos: (...a: unknown[]) =>
    buscarProdutosQueFicariamOrfaos(...(a as [])),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import { aplicarCardapioEmProdutos, tirarDeCardapio } from "./cardapio";

function escritas(): Op[] {
  return ops.filter((o) => o.upsert || o.insert || o.deleted || o.update);
}
function upserts(): Op[] {
  return ops.filter((o) => o.upsert != null);
}

const payload = (over: Record<string, unknown> = {}) => ({
  cardapio_id: CARDAPIO,
  produto_ids: [P1, P2],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  ops = [];
  respostaPorTabela = {
    cardapio_produtos: { data: null, error: null },
    produtos: { data: [], error: null },
    cardapios: { data: { id: CARDAPIO }, error: null },
  };
  buscarLojaDoDono.mockResolvedValue({ id: LOJA_ID, slug: LOJA_SLUG });
  cardapioPertenceALoja.mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("[287] aplicarCardapioEmProdutos — `dias_semana` em CADA linha do upsert", () => {
  it("com dias válidos: as DUAS linhas carregam a agenda, e só as quatro chaves", async () => {
    const r = await aplicarCardapioEmProdutos(payload({ dias_semana: [1, 3] }));
    expect(r).toEqual({ ok: true });

    expect(escritas()).toHaveLength(1);
    const w = escritas()[0];
    expect(w.tabela).toBe("cardapio_produtos");
    // `toEqual` ESTRITO: nenhuma quinta chave, e `loja_id` é o DERIVADO de
    // `buscarLojaDoDono` — nunca um que viesse pendurado no payload.
    expect(w.upsert).toEqual([
      { loja_id: LOJA_ID, cardapio_id: CARDAPIO, produto_id: P1, dias_semana: [1, 3] },
      { loja_id: LOJA_ID, cardapio_id: CARDAPIO, produto_id: P2, dias_semana: [1, 3] },
    ]);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("normaliza NA LINHA, não só no schema: `[3,1,3]` grava `[1,3]` nas duas", async () => {
    await aplicarCardapioEmProdutos(payload({ dias_semana: [3, 1, 3] }));
    const linhas = upserts()[0]?.upsert ?? [];
    expect(linhas.map((l) => l.dias_semana)).toEqual([
      [1, 3],
      [1, 3],
    ]);
  });

  it("SEM o campo: a linha é a de hoje mais `dias_semana: null` — a chave é SEMPRE escrita", async () => {
    // Plano §"Propagação": no banco é idêntico à linha de hoje (coluna nullable
    // sem default), mas a chave explícita é o que o teste de paridade compara.
    // `null` é "todos os dias do cardápio" (RN-11), a representação única.
    const r = await aplicarCardapioEmProdutos(payload());
    expect(r).toEqual({ ok: true });
    expect(upserts()[0]?.upsert).toEqual([
      { loja_id: LOJA_ID, cardapio_id: CARDAPIO, produto_id: P1, dias_semana: null },
      { loja_id: LOJA_ID, cardapio_id: CARDAPIO, produto_id: P2, dias_semana: null },
    ]);
  });

  it("`[]` e `null` explícitos também gravam `null` — nunca `'{}'`", async () => {
    for (const dias of [[], null]) {
      ops = [];
      const r = await aplicarCardapioEmProdutos(payload({ dias_semana: dias }));
      expect(r, `dias_semana: ${JSON.stringify(dias)}`).toEqual({ ok: true });
      const linhas = upserts()[0]?.upsert ?? [];
      expect(linhas.map((l) => l.dias_semana)).toEqual([null, null]);
    }
  });

  it("valor fora do domínio é recusado pelo parse, com ZERO I/O", async () => {
    for (const dias of [[7], [-1], [1.5], ["3"], [1, 1, 1, 1, 1, 1, 1, 1]]) {
      ops = [];
      vi.mocked(buscarLojaDoDono).mockClear();
      const r = await aplicarCardapioEmProdutos(payload({ dias_semana: dias }));
      expect(r, `dias_semana: ${JSON.stringify(dias)}`).toEqual({
        ok: false,
        erro: MSG_GENERICA_LOTE,
      });
      // Parse ANTES de qualquer I/O: nem a loja é buscada.
      expect(buscarLojaDoDono).not.toHaveBeenCalled();
      expect(ops).toHaveLength(0);
    }
  });

  it("chave desconhecida junto com `dias_semana` continua barrada pelo `.strict()`", async () => {
    const r = await aplicarCardapioEmProdutos(
      payload({ dias_semana: [1], loja_id: "99999999-9999-4999-8999-999999999999" }),
    );
    expect(r).toEqual({ ok: false, erro: MSG_GENERICA_LOTE });
    expect(ops).toHaveLength(0);
  });

  it("[287 · risco] produto JÁ vinculado: `ignoreDuplicates` continua, então os dias dele NÃO são reescritos", async () => {
    // Comportamento DELIBERADO, travado aqui para não virar surpresa em
    // produção (plano §Riscos): adicionar não é editar. O `on conflict do
    // nothing` descarta a linha cujo par já existe — com a agenda nova junto.
    // Quem edita a agenda de um vínculo existente é `definirDiasDoVinculo`.
    //
    // A prova possível nesta camada é negativa e é a que importa: a action
    // manda UMA instrução com `ignoreDuplicates: true` e NÃO faz fan-out de
    // update/upsert de `dias_semana` para os pares já existentes (nem lê
    // `cardapio_produtos` antes, o que seria o pre-check que a 251 proibiu).
    await aplicarCardapioEmProdutos(payload({ dias_semana: [1, 3] }));

    expect(escritas()).toHaveLength(1);
    expect(escritas()[0].upsertOpcoes).toEqual({
      onConflict: "cardapio_id,produto_id",
      ignoreDuplicates: true,
    });
    expect(
      ops.some((o) => o.tabela === "cardapio_produtos" && o.selected),
      "nenhuma leitura prévia de 'quem já está' — RN-10 é do ON CONFLICT",
    ).toBe(false);
    expect(
      ops.some((o) => o.tabela === "cardapio_produtos" && o.update != null),
      "nenhum UPDATE de dias por cima do lote: adicionar não é editar",
    ).toBe(false);
  });
});

describe("[287] a trava de posse (270) não é afrouxada pelo campo novo", () => {
  it("cardápio de OUTRA loja: recusa com o fragmento LITERAL e ZERO upsert capturado", async () => {
    cardapioPertenceALoja.mockResolvedValue(false);

    const r = await aplicarCardapioEmProdutos(
      payload({ cardapio_id: CARDAPIO_ALHEIO, dias_semana: [1, 3] }),
    );

    // Fragmento literal, não só "ok: false": a memória do projeto é explícita
    // — trava de escopo passa por acidente quando só o formato é afirmado.
    expect(r).toEqual({ ok: false, erro: MSG_GENERICA_LOTE });
    expect((r as { erro: string }).erro).toContain(
      "Não foi possível aplicar o cardápio aos produtos selecionados.",
    );
    // A recusa veio da POSSE, não do parse: sem esta asserção o caso passaria
    // hoje (o `dias_semana` que o schema ainda não conhece já derruba tudo) e
    // não provaria nada sobre a trava.
    expect(
      cardapioPertenceALoja,
      "o payload nem chegou à prova de posse — a recusa foi do parse",
    ).toHaveBeenCalledTimes(1);
    // E a recusa é ANTES de qualquer escrita: nenhum upsert capturado.
    expect(upserts(), "o lote alheio chegou ao banco").toHaveLength(0);
    expect(escritas()).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("a posse é provada ANTES do upsert, e com o cardápio do PAYLOAD contra a loja DERIVADA", async () => {
    await aplicarCardapioEmProdutos(payload({ dias_semana: [1, 3] }));
    expect(cardapioPertenceALoja).toHaveBeenCalledTimes(1);
    const args = cardapioPertenceALoja.mock.calls[0] as unknown as unknown[];
    expect(args[1]).toBe(LOJA_ID);
    expect(args[2]).toBe(CARDAPIO);
    expect(upserts()).toHaveLength(1);
  });

  it("erro de banco no lote COM dias sai pela mesma frase genérica; o 23503 fica no log", async () => {
    respostaPorTabela.cardapio_produtos = {
      data: null,
      error: {
        code: "23503",
        message:
          'insert or update on table "cardapio_produtos" violates foreign key constraint "cardapio_produtos_produto_fk"',
      },
    };
    const r = await aplicarCardapioEmProdutos(payload({ dias_semana: [1, 3] }));
    expect(r).toEqual({ ok: false, erro: MSG_GENERICA_LOTE });
    const texto = JSON.stringify(r);
    expect(texto).not.toContain("23503");
    expect(texto).not.toContain("cardapio_produtos_produto_fk");
    // A tentativa EXISTIU: uma instrução, com os dois ids — senão este caso
    // passaria por recusa de parse, não por tratamento de erro do banco.
    expect(upserts()).toHaveLength(1);
    expect(upserts()[0].upsert).toHaveLength(2);
  });
});

describe("[287] `tirarDeCardapio` continua RECUSANDO `dias_semana`", () => {
  it("o DELETE não aceita agenda: chave desconhecida, recusa antes de qualquer I/O", async () => {
    // É o motivo de o schema ser DERIVADO e não mutado: um `dias_semana`
    // aceito-e-ignorado aqui seria payload confuso que o `.strict()` hoje
    // recusa. Este caso reprova a implementação que soma o campo ao
    // `schemaLoteDeProdutos`.
    const r = await tirarDeCardapio(payload({ dias_semana: [1, 3] }));
    expect(r).toEqual({ ok: false, erro: MSG_GENERICA_LOTE });
    expect(ops).toHaveLength(0);
    expect(buscarLojaDoDono).not.toHaveBeenCalled();
  });

  it("e continua aceitando o payload de hoje, sem o campo", async () => {
    const r = await tirarDeCardapio(payload());
    expect(r).toEqual({ ok: true });
    expect(escritas().filter((o) => o.deleted)).toHaveLength(1);
  });
});

// ══════════ [289] RED — `dias_por_produto`: agenda DIFERENTE por linha ═══════
//
// Fase RED da issue 289, lado LOJISTA. O harness é o MESMO deste arquivo
// (mock de I/O com captura das linhas do upsert), deliberadamente: montar um
// segundo padrão em pglite só para esta fatia criaria dois lugares onde a
// mesma propagação é afirmada — e é a captura das LINHAS que prova o critério
// de aceite ("dois produtos, dias diferentes, um gesto").

const P3 = "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3";

describe("[289] aplicarCardapioEmProdutos — linha por produto", () => {
  it("o MESMO gesto grava `dias_semana` DIFERENTES por linha", async () => {
    const r = await aplicarCardapioEmProdutos({
      cardapio_id: CARDAPIO,
      produto_ids: [P1, P2],
      dias_semana: [1],
      dias_por_produto: { [P1]: [2], [P2]: [5, 3] },
    });
    expect(r).toEqual({ ok: true });

    expect(escritas()).toHaveLength(1);
    // UMA instrução, duas linhas, agendas distintas e normalizadas NA LINHA.
    expect(escritas()[0].upsert).toEqual([
      { loja_id: LOJA_ID, cardapio_id: CARDAPIO, produto_id: P1, dias_semana: [2] },
      { loja_id: LOJA_ID, cardapio_id: CARDAPIO, produto_id: P2, dias_semana: [3, 5] },
    ]);
  });

  it("produto FORA do mapa grava o valor do RODAPÉ; quem está nele, o próprio", async () => {
    await aplicarCardapioEmProdutos({
      cardapio_id: CARDAPIO,
      produto_ids: [P1, P2],
      dias_semana: [4, 4, 0],
      dias_por_produto: { [P2]: [6] },
    });
    expect(upserts()[0]?.upsert).toEqual([
      { loja_id: LOJA_ID, cardapio_id: CARDAPIO, produto_id: P1, dias_semana: [0, 4] },
      { loja_id: LOJA_ID, cardapio_id: CARDAPIO, produto_id: P2, dias_semana: [6] },
    ]);
  });

  it("rodapé em 'todos os dias' grava `null` em quem herda, e a agenda em quem escolheu", async () => {
    for (const rodape of [{}, { dias_semana: [] }, { dias_semana: null }]) {
      ops = [];
      const r = await aplicarCardapioEmProdutos({
        cardapio_id: CARDAPIO,
        produto_ids: [P1, P2],
        ...rodape,
        dias_por_produto: { [P2]: [1, 3] },
      });
      expect(r, JSON.stringify(rodape)).toEqual({ ok: true });
      expect(upserts()[0]?.upsert, JSON.stringify(rodape)).toEqual([
        { loja_id: LOJA_ID, cardapio_id: CARDAPIO, produto_id: P1, dias_semana: null },
        { loja_id: LOJA_ID, cardapio_id: CARDAPIO, produto_id: P2, dias_semana: [1, 3] },
      ]);
    }
  });

  it("`[]` NO MAPA é 'todos os dias' daquele produto — grava `null`, mesmo com rodapé restrito", async () => {
    await aplicarCardapioEmProdutos({
      cardapio_id: CARDAPIO,
      produto_ids: [P1, P2],
      dias_semana: [1],
      dias_por_produto: { [P1]: [] },
    });
    expect(upserts()[0]?.upsert).toEqual([
      { loja_id: LOJA_ID, cardapio_id: CARDAPIO, produto_id: P1, dias_semana: null },
      { loja_id: LOJA_ID, cardapio_id: CARDAPIO, produto_id: P2, dias_semana: [1] },
    ]);
  });

  it("id FORA de `produto_ids` no mapa: recusa com a frase genérica e ZERO I/O", async () => {
    // A trava contra enumeração: nada de podar a chave e escrever o resto.
    const r = await aplicarCardapioEmProdutos({
      cardapio_id: CARDAPIO,
      produto_ids: [P1, P2],
      dias_semana: [1],
      dias_por_produto: { [P1]: [2], [P3]: [5] },
    });
    expect(r).toEqual({ ok: false, erro: MSG_GENERICA_LOTE });
    expect((r as { erro: string }).erro).toContain(
      "Não foi possível aplicar o cardápio aos produtos selecionados.",
    );
    // Parse ANTES de qualquer I/O: nem a loja é buscada, nem uma linha vai.
    expect(buscarLojaDoDono).not.toHaveBeenCalled();
    expect(ops).toHaveLength(0);
  });

  it("valor fora do domínio DENTRO do mapa é recusado, com ZERO I/O", async () => {
    for (const dias of [[7], [-1], [1.5], ["3"], [1, 1, 1, 1, 1, 1, 1, 1]]) {
      ops = [];
      vi.mocked(buscarLojaDoDono).mockClear();
      const r = await aplicarCardapioEmProdutos({
        cardapio_id: CARDAPIO,
        produto_ids: [P1, P2],
        dias_por_produto: { [P1]: dias },
      });
      expect(r, JSON.stringify(dias)).toEqual({ ok: false, erro: MSG_GENERICA_LOTE });
      expect(buscarLojaDoDono).not.toHaveBeenCalled();
      expect(ops).toHaveLength(0);
    }
  });

  it("o mapa NÃO vira canal de escrita: só os ids de `produto_ids` viram linha", async () => {
    await aplicarCardapioEmProdutos({
      cardapio_id: CARDAPIO,
      produto_ids: [P1],
      dias_por_produto: { [P1]: [2] },
    });
    const linhas = upserts()[0]?.upsert ?? [];
    expect(linhas).toHaveLength(1);
    expect(linhas.map((l) => l.produto_id)).toEqual([P1]);
    expect(JSON.stringify(linhas)).not.toContain(P3);
  });
});

describe("[289] a trava de posse (270) não é afrouxada pelo MAPA", () => {
  it("cardápio de OUTRA loja COM mapa: fragmento LITERAL e ZERO upsert capturado", async () => {
    cardapioPertenceALoja.mockResolvedValue(false);

    const r = await aplicarCardapioEmProdutos({
      cardapio_id: CARDAPIO_ALHEIO,
      produto_ids: [P1, P2],
      dias_semana: [1],
      dias_por_produto: { [P1]: [2], [P2]: [5] },
    });

    expect(r).toEqual({ ok: false, erro: MSG_GENERICA_LOTE });
    expect((r as { erro: string }).erro).toContain(
      "Não foi possível aplicar o cardápio aos produtos selecionados.",
    );
    // A recusa veio da POSSE, não do parse: sem esta asserção o caso passaria
    // hoje (o `dias_por_produto` que o schema ainda não conhece derruba tudo)
    // e não provaria nada sobre a trava.
    expect(
      cardapioPertenceALoja,
      "o payload nem chegou à prova de posse — a recusa foi do parse",
    ).toHaveBeenCalledTimes(1);
    expect(upserts(), "o lote alheio chegou ao banco").toHaveLength(0);
    expect(escritas()).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("[289] `tirarDeCardapio` continua RECUSANDO `dias_por_produto`", () => {
  it("o DELETE não ganha mapa de agenda: recusa antes de qualquer I/O", async () => {
    const r = await tirarDeCardapio({
      cardapio_id: CARDAPIO,
      produto_ids: [P1, P2],
      dias_por_produto: { [P1]: [1] },
    });
    expect(r).toEqual({ ok: false, erro: MSG_GENERICA_LOTE });
    expect(ops).toHaveLength(0);
    expect(buscarLojaDoDono).not.toHaveBeenCalled();
  });
});
