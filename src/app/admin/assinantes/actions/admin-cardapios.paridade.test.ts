import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Fase RED (TDD) da issue 269, Fase 0 — PARIDADE do caminho admin de CARDÁPIO
 * com o caminho do lojista (`src/lib/actions/cardapio.ts`).
 *
 * Espelha em forma `admin-produtos.paridade.test.ts` (issue 241): mocks só de
 * I/O, chamada da Server Action admin REAL e inspeção da linha/patch
 * capturados. O que muda é o objeto — aqui a fatia crítica é DATA e ESCOPO, não
 * dinheiro: `prazo_fim` sob preset é recalculado no servidor (RN-04), a
 * travessia hora local → instante usa `lojas.timezone` da LOJA-ALVO lido do
 * banco, e `loja_id` vem SEMPRE do `lojaId` da URL.
 *
 * Por que paridade é a prova principal: o hub admin escreve com `service_role`,
 * que tem BYPASSRLS. `cardapios_escrita_propria` e
 * `cardapio_produtos_escrita_propria` NÃO protegem esta via. O que protege é a
 * paridade com o caminho do lojista — mesmo `schemaCardapio`, mesmas frases,
 * mesmo reconhecedor do trigger de RN-14 — mais o escopo do wrapper e as FKs
 * compostas.
 *
 * ── Por que o módulo é importado DINAMICAMENTE ───────────────────────────────
 * `./admin-cardapios` nasce na Fase 4. Um `import` estático faria o arquivo
 * inteiro morrer na coleta (zero `it()` executado, um erro de resolução no
 * lugar de asserções) e quebraria `npx tsc --noEmit` durante toda a fase RED.
 * O import por caminho em VARIÁVEL mantém a suíte tipável e faz cada caso
 * falhar com a sua PRÓPRIA mensagem — inclusive a primeira, que é o contrato
 * de assinatura que a fase GREEN tem de satisfazer.
 *
 * NENHUMA lógica de produção aqui. Quem deixa verde é `executar`.
 */

const LOJA_ALVO = "11111111-1111-1111-1111-111111111111"; // loja da URL admin
const LOJA_OUTRA = "22222222-2222-2222-2222-222222222222"; // loja alheia
const CARDAPIO_ID = "33333333-3333-3333-3333-333333333333";
const CARDAPIO_OUTRO = "44444444-4444-4444-4444-444444444444";
const PRODUTO_1 = "55555555-5555-5555-5555-555555555555";
const PRODUTO_2 = "66666666-6666-6666-6666-666666666666";
const CATEGORIA_ID = "77777777-7777-7777-7777-777777777777";

// ── As SEIS frases, byte a byte, copiadas à mão de `src/lib/actions/cardapio.ts`
// e `src/lib/validacoes/cardapio.ts`. Escritas à mão DE PROPÓSITO: importá-las
// do módulo neutro provaria só que o admin importa o mesmo símbolo, não que o
// símbolo continua dizendo a mesma coisa. Se qualquer uma delas mudar de um
// lado só, este arquivo fica vermelho.
const MSG_INVALIDO = "Cardápio inválido.";
const MSG_SEM_EIXO =
  "Escolha pelo menos um dia da semana, um dia do mês ou um horário. Sem nada marcado, este cardápio aparece sempre e não é sazonal.";
const MSG_PRAZO_ORDEM = "A data de fim precisa ser depois da de início.";
const MSG_EXCLUSIVOS_1 =
  "1 produto só aparece por causa deste cardápio e sumiria da vitrine. Converta esse produto para o menu antes de remover o cardápio.";
const MSG_EXCLUSIVOS_SEM_NUMERO =
  "Alguns produtos só aparecem por causa deste cardápio e sumiriam da vitrine. Converta esses produtos para o menu antes de remover o cardápio.";
const MSG_GENERICA_LOTE =
  "Não foi possível aplicar o cardápio aos produtos selecionados.";
const MSG_ORFAO_NO_LOTE =
  "Um dos produtos selecionados só aparece por causa deste cardápio e sumiria da vitrine. Devolva-o ao menu antes de tirá-lo do cardápio.";
const MSG_LOJA = "Loja não encontrada.";
const MSG_LOJA_INVALIDA = "Loja inválida.";

/** O erro que o constraint trigger de `20260920131000` levanta no COMMIT. */
const ERRO_TRIGGER_RN14 = {
  code: "23000",
  message:
    'produto exclusivo sem cardapio (produto "…", loja "…") — recusado no commit',
};

// ── Captura do que cada operação manda ao banco ──────────────────────────────
type Resposta = { data: unknown; error: unknown; count?: number };
type Op = {
  tabela: string;
  colunas?: string;
  insert?: Record<string, unknown>;
  /** `upsert` de N linhas (`escopo.inserirVarios`). */
  upsert?: Record<string, unknown>[];
  update?: Record<string, unknown>;
  /**
   * [274 · R2] O 2º argumento do `update`/`delete` (`{ count: "exact" }`).
   * Sem capturá-lo, "a action checa o `count`" é indistinguível de "a action
   * recebeu `count: 1` do mock por default" — e D8 inteiro vira decoração.
   */
  updateOpts?: unknown;
  deleted?: boolean;
  deleteOpts?: unknown;
  filtros: Array<[string, unknown]>;
};
type ChamadaRpc = { nome: string; args: Record<string, unknown> };

let ops: Op[];
let rpcs: ChamadaRpc[];
let respostaRpc: Resposta;
/** Resposta por tabela; função recebe a `op` para discriminar por colunas/filtros. */
let respostaPorTabela: Record<string, Resposta | ((op: Op) => Resposta)>;

function respostaDe(op: Op): Resposta {
  const r = respostaPorTabela[op.tabela];
  if (r == null) return { data: null, error: null, count: 1 };
  return typeof r === "function" ? r(op) : r;
}

function makeChain() {
  return {
    from: (tabela: string) => {
      const op: Op = { tabela, filtros: [] };
      ops.push(op);
      const queryChain: Record<string, unknown> = {};
      const passthrough = (k: string) => {
        queryChain[k] = (...args: unknown[]) => {
          if (k === "eq" || k === "in") op.filtros.push([args[0] as string, args[1]]);
          if (k === "select" && typeof args[0] === "string") op.colunas = args[0];
          return queryChain;
        };
      };
      ["select", "eq", "in", "single", "maybeSingle", "limit", "order"].forEach(
        passthrough,
      );
      queryChain.insert = (row: Record<string, unknown>) => {
        op.insert = row;
        return queryChain;
      };
      queryChain.upsert = (linhas: Record<string, unknown>[]) => {
        op.upsert = linhas;
        return queryChain;
      };
      queryChain.update = (row: Record<string, unknown>, opts?: unknown) => {
        op.update = row;
        op.updateOpts = opts;
        return queryChain;
      };
      queryChain.delete = (opts?: unknown) => {
        op.deleted = true;
        op.deleteOpts = opts;
        return queryChain;
      };
      queryChain.then = (onF: (v: unknown) => unknown) =>
        Promise.resolve(respostaDe(op)).then(onF);
      return queryChain;
    },
    rpc: (nome: string, args: Record<string, unknown>) => {
      rpcs.push({ nome, args });
      return Promise.resolve(respostaRpc);
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

// ── O módulo que a Fase 4 vai criar, e o contrato que ele deve cumprir ───────
type Resultado = { ok: true } | { ok: false; erro: string };
type ResultadoRemocao = { ok: true } | { ok: false; erro: string; exclusivos: number };
type Previa =
  | { ok: true; total: number; nomes: string[]; menu: number; cardapio: number; ocultos: number }
  | { ok: false; erro: string };

type AdminCardapios = {
  criarCardapioAdmin(lojaId: string, payload: unknown): Promise<Resultado>;
  atualizarCardapioAdmin(lojaId: string, id: string, payload: unknown): Promise<Resultado>;
  ligarDesligarCardapioAdmin(lojaId: string, id: string, ativo: boolean): Promise<Resultado>;
  removerCardapioAdmin(lojaId: string, id: string): Promise<ResultadoRemocao>;
  converterExclusivosParaMenuAdmin(lojaId: string, cardapioId: string): Promise<Resultado>;
  aplicarCardapioEmProdutosAdmin(lojaId: string, payload: unknown): Promise<Resultado>;
  aplicarCardapioEmCategoriaAdmin(lojaId: string, payload: unknown): Promise<Resultado>;
  tirarDeCardapioAdmin(lojaId: string, payload: unknown): Promise<Resultado>;
  preverLoteAdmin(lojaId: string, entrada: unknown): Promise<Previa>;
  /** [274] A agenda do VÍNCULO — a única via de escrita de `dias_semana` por item. */
  definirDiasDoVinculoAdmin(lojaId: string, payload: unknown): Promise<Resultado>;
};

/** Caminho em VARIÁVEL: ver o cabeçalho. */
const MODULO_ADMIN = "./admin-cardapios";

async function acoes(): Promise<AdminCardapios> {
  try {
    return (await import(/* @vite-ignore */ MODULO_ADMIN)) as unknown as AdminCardapios;
  } catch (e) {
    throw new Error(
      `[RED 269 · fase 0] \`src/app/admin/assinantes/actions/admin-cardapios.ts\` ainda não existe — ` +
        `é a Fase 4 da issue. Causa: ${(e as Error).message}`,
    );
  }
}

// ── Payloads ────────────────────────────────────────────────────────────────
function cardapioRecorrente(over: Record<string, unknown> = {}) {
  return {
    nome: "Segunda",
    modo: "recorrente",
    dias_semana: [1],
    dias_mes: null,
    hora_inicio: null,
    hora_fim: null,
    ...over,
  };
}

function cardapioPrazoFixo(over: Record<string, unknown> = {}) {
  return {
    nome: "Festival de inverno",
    modo: "prazo_fixo",
    prazo_inicio: "2026-01-31T10:00",
    prazo_fim: null,
    prazo_preset: "mensal",
    ...over,
  };
}

function opEscrita(tabela: string): Op | undefined {
  return ops.find(
    (o) => o.tabela === tabela && (o.insert || o.upsert || o.update || o.deleted),
  );
}

/** O log admin é fire-and-forget; um tick garante que a op já foi registrada. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

function logouAcesso(): boolean {
  return ops.some((o) => o.tabela === "admin_acessos" && o.insert != null);
}

beforeEach(() => {
  ops = [];
  rpcs = [];
  respostaRpc = { data: 3, error: null };
  // A LOJA-ALVO (não a do payload, não a do admin) dá o fuso de RN-04.
  respostaPorTabela = {
    lojas: {
      data: { id: LOJA_ALVO, slug: "loja-alvo", timezone: "America/Sao_Paulo" },
      error: null,
      count: 1,
    },
    // [270] A prova de POSSE (`cardapioPertenceALoja`) é o ÚNICO `select("id")`
    // em `cardapios`, e ela só responde pela LOJA-ALVO: é o que o
    // `.eq("loja_id", …)` EXPLÍCITO produz sob service_role, onde a RLS não
    // vale. Modelado aqui, e não caso a caso, porque `respostaDe` devolve
    // `{ data: null }` para tabela não configurada — e `data: null` no
    // `maybeSingle` significa POSSE NEGADA, o que afogaria os caminhos felizes
    // de lote em falha espúria. Qualquer outro `select` em `cardapios`
    // (`ordem`, a leitura da vigência) cai no default antigo, intocado.
    cardapios: (op) =>
      op.colunas === "id" &&
      op.filtros.some(([c, v]) => c === "loja_id" && v === LOJA_ALVO) &&
      op.filtros.some(([c, v]) => c === "id" && v === CARDAPIO_ID)
        ? { data: { id: CARDAPIO_ID }, error: null, count: 1 }
        : { data: null, error: null, count: 1 },
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ═══════════════════════════════ 0 · contrato de assinatura (o RED mais básico)

describe("269 — o módulo admin de cardápio existe e exporta as 9 actions", () => {
  it("exporta as 9 Server Actions admin com assinatura `(lojaId, …)`", async () => {
    const a = await acoes();
    for (const nome of [
      "criarCardapioAdmin",
      "atualizarCardapioAdmin",
      "ligarDesligarCardapioAdmin",
      "removerCardapioAdmin",
      "converterExclusivosParaMenuAdmin",
      "aplicarCardapioEmProdutosAdmin",
      "aplicarCardapioEmCategoriaAdmin",
      "tirarDeCardapioAdmin",
      "preverLoteAdmin",
    ] as const) {
      expect(typeof a[nome], `${nome} não é função`).toBe("function");
    }
  });
});

// ═════════════════════════ 1 · o MESMO `schemaCardapio`, com as frases de §9.6

describe("269 — paridade de validação: admin usa o mesmo `schemaCardapio`", () => {
  it("recorrente SEM EIXO é recusado com a frase literal de §9.6, sem tocar no banco", async () => {
    const { criarCardapioAdmin } = await acoes();
    const r = await criarCardapioAdmin(
      LOJA_ALVO,
      cardapioRecorrente({ dias_semana: [], dias_mes: [], hora_inicio: null, hora_fim: null }),
    );
    expect(r).toEqual({ ok: false, erro: MSG_SEM_EIXO });
    expect(opEscrita("cardapios")).toBeUndefined();
  });

  it("prazo `customizado` com fim <= início é recusado com a frase literal de §9.6", async () => {
    const { criarCardapioAdmin } = await acoes();
    const r = await criarCardapioAdmin(
      LOJA_ALVO,
      cardapioPrazoFixo({
        prazo_preset: "customizado",
        prazo_inicio: "2026-03-10T22:30",
        prazo_fim: "2026-03-01T08:00",
      }),
    );
    expect(r).toEqual({ ok: false, erro: MSG_PRAZO_ORDEM });
    expect(opEscrita("cardapios")).toBeUndefined();
  });

  it("parse inválido que NÃO é de vigência continua na genérica `Cardápio inválido.`", async () => {
    const { criarCardapioAdmin } = await acoes();
    const r = await criarCardapioAdmin(LOJA_ALVO, cardapioRecorrente({ nome: "" }));
    expect(r).toEqual({ ok: false, erro: MSG_INVALIDO });
    expect(opEscrita("cardapios")).toBeUndefined();
  });

  it("a mesma promoção de frase vale no UPDATE admin", async () => {
    const { atualizarCardapioAdmin } = await acoes();
    const r = await atualizarCardapioAdmin(
      LOJA_ALVO,
      CARDAPIO_ID,
      cardapioRecorrente({ dias_semana: [], dias_mes: [] }),
    );
    expect(r).toEqual({ ok: false, erro: MSG_SEM_EIXO });
    expect(opEscrita("cardapios")).toBeUndefined();
  });

  it("`id` de cardápio que não é UUID é recusado com `Cardápio inválido.`", async () => {
    const { atualizarCardapioAdmin, ligarDesligarCardapioAdmin } = await acoes();
    expect(await atualizarCardapioAdmin(LOJA_ALVO, "nao-uuid", cardapioRecorrente())).toEqual({
      ok: false,
      erro: MSG_INVALIDO,
    });
    expect(await ligarDesligarCardapioAdmin(LOJA_ALVO, "nao-uuid", true)).toEqual({
      ok: false,
      erro: MSG_INVALIDO,
    });
    expect(opEscrita("cardapios")).toBeUndefined();
  });
});

// ══════════════════════ 2 · RN-04 — `prazo_fim` recalculado no fuso da loja-alvo

describe("269 — paridade de prazo (RN-04): o servidor recalcula e descarta o `fim` do cliente", () => {
  it("preset `mensal` com início 31/01 grava fim 28/02 (clamp), ignorando o `prazo_fim` enviado", async () => {
    const { criarCardapioAdmin } = await acoes();
    const r = await criarCardapioAdmin(
      LOJA_ALVO,
      // O cliente manda um fim MENTIROSO, um ano à frente: tem de ser jogado fora.
      cardapioPrazoFixo({ prazo_fim: "2027-12-31T23:59" }),
    );
    expect(r).toEqual({ ok: true });
    const insert = opEscrita("cardapios")?.insert;
    expect(insert?.prazo_inicio).toBe("2026-01-31T13:00:00.000Z");
    expect(insert?.prazo_fim).toBe("2026-02-28T13:00:00.000Z");
  });

  it("o fuso é o da LOJA-ALVO, não um offset fixo (America/Manaus)", async () => {
    respostaPorTabela.lojas = {
      data: { id: LOJA_ALVO, slug: "loja-alvo", timezone: "America/Manaus" },
      error: null,
      count: 1,
    };
    const { criarCardapioAdmin } = await acoes();
    await criarCardapioAdmin(LOJA_ALVO, cardapioPrazoFixo());
    const insert = opEscrita("cardapios")?.insert;
    expect(insert?.prazo_inicio).toBe("2026-01-31T14:00:00.000Z");
    expect(insert?.prazo_fim).toBe("2026-02-28T14:00:00.000Z");
  });

  it("`customizado` é o ÚNICO preset em que o fim digitado é aceito", async () => {
    const { criarCardapioAdmin } = await acoes();
    const r = await criarCardapioAdmin(
      LOJA_ALVO,
      cardapioPrazoFixo({
        prazo_preset: "customizado",
        prazo_inicio: "2026-03-01T08:00",
        prazo_fim: "2026-03-10T22:30",
      }),
    );
    expect(r).toEqual({ ok: true });
    expect(opEscrita("cardapios")?.insert).toMatchObject({
      prazo_inicio: "2026-03-01T11:00:00.000Z",
      prazo_fim: "2026-03-11T01:30:00.000Z",
    });
  });

  it("recorrente não ganha prazo inventado: os dois campos vão NULL", async () => {
    const { criarCardapioAdmin } = await acoes();
    await criarCardapioAdmin(LOJA_ALVO, cardapioRecorrente());
    const insert = opEscrita("cardapios")?.insert;
    expect(insert?.prazo_inicio).toBeNull();
    expect(insert?.prazo_fim).toBeNull();
    expect(insert?.prazo_preset).toBeNull();
  });

  it("a conversão vale igual no UPDATE admin", async () => {
    const { atualizarCardapioAdmin } = await acoes();
    const r = await atualizarCardapioAdmin(
      LOJA_ALVO,
      CARDAPIO_ID,
      cardapioPrazoFixo({ prazo_fim: "2027-12-31T23:59" }),
    );
    expect(r).toEqual({ ok: true });
    expect(opEscrita("cardapios")?.update).toMatchObject({
      prazo_inicio: "2026-01-31T13:00:00.000Z",
      prazo_fim: "2026-02-28T13:00:00.000Z",
    });
  });
});

// ═══════════════════ 3 · escopo: `loja_id` da URL, `ordem` da loja-alvo, `ativo`

describe("269 — escopo cross-tenant do caminho admin de cardápio", () => {
  it("`lojaId` não-UUID é recusado com a literal, SEM tocar no banco", async () => {
    const { criarCardapioAdmin, preverLoteAdmin } = await acoes();
    expect(await criarCardapioAdmin("loja-b", cardapioRecorrente())).toEqual({
      ok: false,
      erro: MSG_LOJA_INVALIDA,
    });
    expect(await preverLoteAdmin("loja-b", { produto_ids: [PRODUTO_1] })).toEqual({
      ok: false,
      erro: MSG_LOJA_INVALIDA,
    });
    expect(ops).toHaveLength(0);
  });

  it("ATAQUE: `loja_id` hostil no payload — a LINHA GRAVADA é a da URL", async () => {
    const { criarCardapioAdmin } = await acoes();
    const r = await criarCardapioAdmin(LOJA_ALVO, {
      ...cardapioRecorrente(),
      loja_id: LOJA_OUTRA,
    });
    // `schemaCardapio` é `.strict()`: a chave hostil nem sobrevive ao parse.
    // A asserção que importa é sobre a LINHA, não sobre o erro — se a fase
    // GREEN afrouxar o `.strict()`, este caso continua exigindo `LOJA_ALVO`.
    if (r.ok) {
      const insert = opEscrita("cardapios")?.insert ?? {};
      expect(insert.loja_id).toBe(LOJA_ALVO);
    } else {
      expect(r).toEqual({ ok: false, erro: MSG_INVALIDO });
      expect(opEscrita("cardapios")).toBeUndefined();
    }
    // Em nenhum dos dois ramos a loja alheia é tocada.
    expect(ops.some((o) => o.filtros.some(([, v]) => v === LOJA_OUTRA))).toBe(false);
    expect(
      ops.some((o) => (o.insert ?? {}).loja_id === LOJA_OUTRA),
    ).toBe(false);
  });

  it("RN-15: `ordem = max(ordem) + 1` lido da LOJA-ALVO", async () => {
    respostaPorTabela.cardapios = (op) =>
      op.colunas === "ordem"
        ? { data: { ordem: 6 }, error: null, count: 1 }
        : { data: null, error: null, count: 1 };
    const { criarCardapioAdmin } = await acoes();
    const r = await criarCardapioAdmin(LOJA_ALVO, cardapioRecorrente());
    expect(r).toEqual({ ok: true });
    expect(opEscrita("cardapios")?.insert?.ordem).toBe(7);
    // A leitura do máximo é escopada pela loja-alvo.
    const leitura = ops.find((o) => o.tabela === "cardapios" && o.colunas === "ordem");
    expect(leitura?.filtros).toEqual(
      expect.arrayContaining([["loja_id", LOJA_ALVO]]),
    );
  });

  it("`atualizarCardapioAdmin` NUNCA escreve `ativo` (quem liga/desliga é a outra action)", async () => {
    const { atualizarCardapioAdmin } = await acoes();
    await atualizarCardapioAdmin(LOJA_ALVO, CARDAPIO_ID, cardapioRecorrente());
    const update = opEscrita("cardapios")?.update ?? {};
    expect("ativo" in update).toBe(false);
    expect("loja_id" in update).toBe(false);
    expect("id" in update).toBe(false);
    expect("ordem" in update).toBe(false);
  });

  it("o UPDATE e o DELETE são escopados por `loja_id` + `id`, nunca só por `id`", async () => {
    const { atualizarCardapioAdmin } = await acoes();
    await atualizarCardapioAdmin(LOJA_ALVO, CARDAPIO_ID, cardapioRecorrente());
    expect(opEscrita("cardapios")?.filtros).toEqual(
      expect.arrayContaining([
        ["loja_id", LOJA_ALVO],
        ["id", CARDAPIO_ID],
      ]),
    );
  });

  it("a RPC de categoria recebe `p_loja_id` da URL, nunca o do payload", async () => {
    const { aplicarCardapioEmCategoriaAdmin } = await acoes();
    const r = await aplicarCardapioEmCategoriaAdmin(LOJA_ALVO, {
      cardapio_id: CARDAPIO_ID,
      categoria_id: CATEGORIA_ID,
    });
    expect(r).toEqual({ ok: true });
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0]).toEqual({
      nome: "aplicar_cardapio_em_categoria",
      args: {
        p_loja_id: LOJA_ALVO,
        p_cardapio_id: CARDAPIO_ID,
        p_categoria_id: CATEGORIA_ID,
      },
    });
  });

  it("o lote de produtos grava `loja_id` da URL em CADA linha do upsert", async () => {
    const { aplicarCardapioEmProdutosAdmin } = await acoes();
    const r = await aplicarCardapioEmProdutosAdmin(LOJA_ALVO, {
      cardapio_id: CARDAPIO_ID,
      produto_ids: [PRODUTO_1, PRODUTO_2],
    });
    expect(r).toEqual({ ok: true });
    const linhas = opEscrita("cardapio_produtos")?.upsert ?? [];
    expect(linhas).toHaveLength(2);
    expect(linhas.every((l) => l.loja_id === LOJA_ALVO)).toBe(true);
    expect(linhas.map((l) => l.produto_id)).toEqual([PRODUTO_1, PRODUTO_2]);
  });
});

// ════════════════════════════ 4 · as SEIS frases, byte a byte, iguais às do lojista

describe("269 — as seis mensagens do caminho admin são byte a byte as do lojista", () => {
  it("RN-14 COM número: remover cardápio com 1 exclusivo órfão devolve a frase e a contagem", async () => {
    respostaPorTabela.cardapio_produtos = (op) =>
      op.colunas?.includes("cardapio_id")
        ? { data: [{ produto_id: PRODUTO_1, cardapio_id: CARDAPIO_ID }], error: null }
        : { data: [{ produto_id: PRODUTO_1 }], error: null };
    respostaPorTabela.produtos = { data: [{ id: PRODUTO_1 }], error: null };

    const { removerCardapioAdmin } = await acoes();
    const r = await removerCardapioAdmin(LOJA_ALVO, CARDAPIO_ID);
    expect(r).toEqual({ ok: false, erro: MSG_EXCLUSIVOS_1, exclusivos: 1 });
    // Recusa ANTES de apagar: nenhuma linha de `cardapios` é removida.
    expect(ops.some((o) => o.tabela === "cardapios" && o.deleted)).toBe(false);
  });

  it("RN-14 SEM número: o backstop do trigger no COMMIT vira a frase sem contagem", async () => {
    respostaPorTabela.cardapio_produtos = { data: [], error: null };
    respostaPorTabela.cardapios = { data: null, error: ERRO_TRIGGER_RN14, count: 0 };

    const { removerCardapioAdmin } = await acoes();
    const r = await removerCardapioAdmin(LOJA_ALVO, CARDAPIO_ID);
    expect(r).toEqual({ ok: false, erro: MSG_EXCLUSIVOS_SEM_NUMERO, exclusivos: 0 });
  });

  it("lote GENÉRICO: payload sem forma devolve a única mensagem de RN-09", async () => {
    const { aplicarCardapioEmProdutosAdmin, aplicarCardapioEmCategoriaAdmin, tirarDeCardapioAdmin } =
      await acoes();
    for (const r of [
      await aplicarCardapioEmProdutosAdmin(LOJA_ALVO, { cardapio_id: CARDAPIO_ID, produto_ids: [] }),
      await aplicarCardapioEmCategoriaAdmin(LOJA_ALVO, { cardapio_id: CARDAPIO_ID }),
      await tirarDeCardapioAdmin(LOJA_ALVO, { produto_ids: [PRODUTO_1] }),
    ]) {
      expect(r).toEqual({ ok: false, erro: MSG_GENERICA_LOTE });
    }
    expect(opEscrita("cardapio_produtos")).toBeUndefined();
  });

  it("ÓRFÃO NO LOTE: tirar o último cardápio de um exclusivo devolve a frase própria", async () => {
    respostaPorTabela.cardapio_produtos = { data: null, error: ERRO_TRIGGER_RN14, count: 0 };
    const { tirarDeCardapioAdmin } = await acoes();
    const r = await tirarDeCardapioAdmin(LOJA_ALVO, {
      cardapio_id: CARDAPIO_ID,
      produto_ids: [PRODUTO_1],
    });
    expect(r).toEqual({ ok: false, erro: MSG_ORFAO_NO_LOTE });
  });

  it("erro de banco que NÃO é o trigger continua genérico (o par 23000+fragmento é exigido)", async () => {
    respostaPorTabela.cardapio_produtos = {
      data: null,
      error: { code: "23503", message: "cardapio_produtos_produto_fk" },
      count: 0,
    };
    const { tirarDeCardapioAdmin } = await acoes();
    const r = await tirarDeCardapioAdmin(LOJA_ALVO, {
      cardapio_id: CARDAPIO_ID,
      produto_ids: [PRODUTO_1],
    });
    expect(r).toEqual({ ok: false, erro: MSG_GENERICA_LOTE });
  });

  it("loja-alvo apagada entre o load e o submit ⇒ `Loja não encontrada.`, sem gravar", async () => {
    respostaPorTabela.lojas = { data: null, error: null, count: 0 };
    const { criarCardapioAdmin } = await acoes();
    const r = await criarCardapioAdmin(LOJA_ALVO, cardapioPrazoFixo());
    expect(r).toEqual({ ok: false, erro: MSG_LOJA });
    expect(opEscrita("cardapios")).toBeUndefined();
  });
});

// ═══════════════════════════ 5 · D7 — log admin nas 8 escritas, nunca na leitura

describe("269 — D7: `registrarAcessoAdmin` nas 8 escritas e NUNCA em `preverLoteAdmin`", () => {
  beforeEach(() => {
    // Sem órfãos: a remoção e a conversão seguem o caminho feliz.
    respostaPorTabela.cardapio_produtos = { data: [], error: null };
    respostaPorTabela.produtos = { data: [], error: null };
  });

  const escritas: Array<[string, (a: AdminCardapios) => Promise<unknown>]> = [
    ["criarCardapioAdmin", (a) => a.criarCardapioAdmin(LOJA_ALVO, cardapioRecorrente())],
    [
      "atualizarCardapioAdmin",
      (a) => a.atualizarCardapioAdmin(LOJA_ALVO, CARDAPIO_ID, cardapioRecorrente()),
    ],
    [
      "ligarDesligarCardapioAdmin",
      (a) => a.ligarDesligarCardapioAdmin(LOJA_ALVO, CARDAPIO_ID, false),
    ],
    ["removerCardapioAdmin", (a) => a.removerCardapioAdmin(LOJA_ALVO, CARDAPIO_ID)],
    [
      "converterExclusivosParaMenuAdmin",
      (a) => a.converterExclusivosParaMenuAdmin(LOJA_ALVO, CARDAPIO_ID),
    ],
    [
      "aplicarCardapioEmProdutosAdmin",
      (a) =>
        a.aplicarCardapioEmProdutosAdmin(LOJA_ALVO, {
          cardapio_id: CARDAPIO_ID,
          produto_ids: [PRODUTO_1],
        }),
    ],
    [
      "aplicarCardapioEmCategoriaAdmin",
      (a) =>
        a.aplicarCardapioEmCategoriaAdmin(LOJA_ALVO, {
          cardapio_id: CARDAPIO_ID,
          categoria_id: CATEGORIA_ID,
        }),
    ],
    [
      "tirarDeCardapioAdmin",
      (a) =>
        a.tirarDeCardapioAdmin(LOJA_ALVO, {
          cardapio_id: CARDAPIO_ID,
          produto_ids: [PRODUTO_1],
        }),
    ],
  ];

  for (const [nome, executar] of escritas) {
    it(`${nome} registra o acesso em \`admin_acessos\``, async () => {
      const a = await acoes();
      await executar(a);
      await flush();
      expect(logouAcesso(), `${nome} não registrou acesso admin`).toBe(true);
    });
  }

  it("`preverLoteAdmin` é LEITURA: não loga, não escreve — mas passa pela prova de admin", async () => {
    const { verificarAdminSaaS } = await import("@/lib/auth/admin");
    respostaPorTabela.produtos = {
      data: [{ id: PRODUTO_1, nome: "Bife", visibilidade: "menu", oculto: false }],
      error: null,
    };
    const { preverLoteAdmin } = await acoes();
    const r = await preverLoteAdmin(LOJA_ALVO, { produto_ids: [PRODUTO_1] });
    await flush();
    expect(r).toMatchObject({ ok: true, total: 1 });
    expect(logouAcesso()).toBe(false);
    expect(ops.some((o) => o.insert || o.update || o.upsert || o.deleted)).toBe(false);
    expect(verificarAdminSaaS).toHaveBeenCalled();
  });

  it("nenhum log admin carrega PII: só contagem e ids de entidade", async () => {
    const a = await acoes();
    await a.aplicarCardapioEmProdutosAdmin(LOJA_ALVO, {
      cardapio_id: CARDAPIO_ID,
      produto_ids: [PRODUTO_1, PRODUTO_2],
    });
    await flush();
    const log = ops.find((o) => o.tabela === "admin_acessos")?.insert ?? {};
    const texto = JSON.stringify(log.metadados ?? {});
    for (const proibido of ["nome", "Bife", "Segunda", "email", "telefone"]) {
      expect(texto, `metadados vazaram "${proibido}"`).not.toContain(proibido);
    }
  });
});

// ═════════════════ 6 · sem oráculo de existência na prévia (`seguranca.md` §14)

describe("269 — `preverLoteAdmin` não é oráculo de existência", () => {
  beforeEach(() => {
    // A leitura é `where loja_id = <alvo> and id in (...)`: o id de outra loja
    // simplesmente NÃO volta — e é o mesmo que acontece com um id inexistente.
    respostaPorTabela.produtos = (op) => {
      const pedidos = (op.filtros.find(([col]) => col === "id")?.[1] ?? []) as string[];
      const daLoja = pedidos.filter((id) => id === PRODUTO_1);
      return {
        data: daLoja.map((id) => ({ id, nome: "Bife", visibilidade: "menu", oculto: false })),
        error: null,
      };
    };
  });

  it("id de OUTRA loja e id INEXISTENTE devolvem a mesma resposta, byte a byte", async () => {
    const { preverLoteAdmin } = await acoes();
    const comAlheio = await preverLoteAdmin(LOJA_ALVO, {
      produto_ids: [PRODUTO_1, "88888888-8888-8888-8888-888888888888"],
    });
    const comInexistente = await preverLoteAdmin(LOJA_ALVO, {
      produto_ids: [PRODUTO_1, "99999999-9999-9999-9999-999999999999"],
    });
    expect(comAlheio).toEqual(comInexistente);
    // E nenhuma contagem de "ignorados" denuncia a diferença.
    expect(comAlheio).toMatchObject({ ok: true, total: 1, menu: 1, cardapio: 0, ocultos: 0 });
  });

  it("a leitura da prévia é escopada por `loja_id` da URL", async () => {
    const { preverLoteAdmin } = await acoes();
    await preverLoteAdmin(LOJA_ALVO, { produto_ids: [PRODUTO_1] });
    const leitura = ops.find((o) => o.tabela === "produtos");
    expect(leitura?.filtros).toEqual(
      expect.arrayContaining([["loja_id", LOJA_ALVO]]),
    );
  });

  it("[270] cardápio de outra loja no payload de lote é RECUSADO — e nada sai do escopo da URL", async () => {
    // Reescrito na 270. A intenção original continua inteira (o caminho admin
    // não pode ser desviado pelo `cardapio_id` do payload), mas a asserção
    // "o DELETE acontece escopado" descrevia o defeito: com cardápio alheio o
    // DELETE apaga 0 linhas, a action devolve `{ ok: true }` e o log de
    // auditoria grava `entidade_id` de outra loja. O desfecho correto é a
    // recusa ANTES da escrita.
    const { tirarDeCardapioAdmin } = await acoes();
    const r = await tirarDeCardapioAdmin(LOJA_ALVO, {
      cardapio_id: CARDAPIO_OUTRO,
      produto_ids: [PRODUTO_1],
    });
    expect(r).toEqual({ ok: false, erro: MSG_GENERICA_LOTE });
    expect(opEscrita("cardapio_produtos")).toBeUndefined();
    // E a única ida ao banco que menciona o cardápio alheio é a leitura de
    // posse, escopada pela LOJA-ALVO — nunca pela loja dona dele.
    expect(
      ops.every((o) =>
        o.filtros.every(([c, v]) => c !== "loja_id" || v === LOJA_ALVO),
      ),
    ).toBe(true);
  });
});

// ══════════════ 7 · D2 — UMA cópia das frases, dois callers (anti-drift de fonte)

describe("269 — D2: as frases têm UMA fonte; o admin importa, não copia", () => {
  const RAIZ = process.cwd();
  const CONTRATO = join(RAIZ, "src/lib/actions/cardapio-contrato.ts");
  const ADMIN = join(RAIZ, "src/app/admin/assinantes/actions/admin-cardapios.ts");
  const LOJISTA = join(RAIZ, "src/lib/actions/cardapio.ts");

  const LITERAIS = [
    MSG_INVALIDO,
    MSG_EXCLUSIVOS_SEM_NUMERO,
    MSG_GENERICA_LOTE,
    MSG_ORFAO_NO_LOTE,
    MSG_LOJA,
  ];

  it("o módulo neutro `src/lib/actions/cardapio-contrato.ts` existe (Fase 2)", () => {
    expect(existsSync(CONTRATO)).toBe(true);
  });

  it("as frases moram no contrato neutro, e NÃO são redeclaradas no lojista nem no admin", () => {
    const contrato = readFileSync(CONTRATO, "utf8");
    const admin = readFileSync(ADMIN, "utf8");
    const lojista = readFileSync(LOJISTA, "utf8");
    for (const frase of LITERAIS) {
      expect(contrato, `"${frase.slice(0, 32)}…" não está no contrato`).toContain(frase);
      expect(admin, `admin-cardapios.ts redeclara "${frase.slice(0, 32)}…"`).not.toContain(frase);
      expect(lojista, `cardapio.ts redeclara "${frase.slice(0, 32)}…"`).not.toContain(frase);
    }
  });

  it("o admin importa do contrato neutro e NÃO de `@/lib/actions/cardapio` (arquivo 'use server')", () => {
    const admin = readFileSync(ADMIN, "utf8");
    expect(admin).toContain("@/lib/actions/cardapio-contrato");
    expect(admin).not.toMatch(/from\s+["']@\/lib\/actions\/cardapio["']/);
  });

  it("o admin não monta um `schemaCardapio` paralelo: importa o zod isomórfico", () => {
    const admin = readFileSync(ADMIN, "utf8");
    expect(admin).toContain("@/lib/validacoes/cardapio");
    expect(admin).not.toContain("z.object(");
  });
});

// ═══ 8 · [270] posse do cardápio ANTES da escrita E ANTES do log de auditoria ══
//
// Fase RED da issue 270, o caso com o efeito (b): o hub admin escreve com
// `service_role` (BYPASSRLS), então nem a RLS nem a FK composta seguram este
// caminho quando o par `(cardapio_id, produto_id)` JÁ EXISTE na loja dona do
// cardápio — o `ON CONFLICT (cardapio_id, produto_id) DO NOTHING` descarta a
// linha ANTES de a FK `(cardapio_id, loja_id)` ser avaliada
// (`tests/migrations/cardapio_produtos_on_conflict_pula_fk.test.ts` prova a
// semântica em SQL real). Resultado hoje: `{ ok: true }` por uma escrita que
// não aconteceu, e uma linha em `admin_acessos` com `loja_id = <A>` e
// `entidade_id = <cardápio da B>`.
//
// A frase da recusa é a MESMA de id inexistente, byte a byte (`seguranca.md`
// §14) — comparada aqui com a constante escrita à mão no topo do arquivo, não
// importada, pelo mesmo motivo das outras seis.

describe("270 — cardápio alheio ou inexistente não escreve e não vira log admin", () => {
  const CARDAPIO_INEXISTENTE = "5a5a5a5a-5a5a-5a5a-5a5a-5a5a5a5a5a5a";

  for (const [rotulo, idHostil] of [
    ["ALHEIO (cardápio da loja B, par já existente lá)", CARDAPIO_OUTRO],
    ["INEXISTENTE", CARDAPIO_INEXISTENTE],
  ] as const) {
    it(`aplicarCardapioEmProdutosAdmin com cardápio ${rotulo} ⇒ recusa, zero escrita, zero log`, async () => {
      const { revalidatePath } = await import("next/cache");
      vi.mocked(revalidatePath).mockClear();

      const { aplicarCardapioEmProdutosAdmin } = await acoes();
      const r = await aplicarCardapioEmProdutosAdmin(LOJA_ALVO, {
        cardapio_id: idHostil,
        produto_ids: [PRODUTO_1, PRODUTO_2],
      });
      await flush();

      expect(r).toEqual({ ok: false, erro: MSG_GENERICA_LOTE });
      expect(opEscrita("cardapio_produtos")).toBeUndefined();
      // Efeito (b): nenhuma entrada de auditoria apontando para entidade alheia.
      expect(logouAcesso(), "registrarAcessoAdmin foi chamado mesmo sem posse").toBe(
        false,
      );
      // NENHUMA escrita, em tabela nenhuma — nem o log, nem a linha do lote.
      expect(
        ops.some((o) => o.insert || o.upsert || o.update || o.deleted),
      ).toBe(false);
      expect(revalidatePath).not.toHaveBeenCalled();
      // §14: o id alheio nunca volta na resposta.
      expect(JSON.stringify(r)).not.toContain(idHostil);
    });

    it(`tirarDeCardapioAdmin com cardápio ${rotulo} ⇒ recusa, nenhum DELETE, zero log`, async () => {
      const { tirarDeCardapioAdmin } = await acoes();
      const r = await tirarDeCardapioAdmin(LOJA_ALVO, {
        cardapio_id: idHostil,
        produto_ids: [PRODUTO_1],
      });
      await flush();

      expect(r).toEqual({ ok: false, erro: MSG_GENERICA_LOTE });
      expect(opEscrita("cardapio_produtos")).toBeUndefined();
      expect(logouAcesso()).toBe(false);
      expect(
        ops.some((o) => o.insert || o.upsert || o.update || o.deleted),
      ).toBe(false);
    });
  }

  it("alheio e inexistente são byte a byte a MESMA resposta, com o MESMO número de idas ao banco", async () => {
    const { aplicarCardapioEmProdutosAdmin } = await acoes();

    const alheio = await aplicarCardapioEmProdutosAdmin(LOJA_ALVO, {
      cardapio_id: CARDAPIO_OUTRO,
      produto_ids: [PRODUTO_1],
    });
    await flush();
    const idasAlheio = ops.length;

    ops = [];
    const inexistente = await aplicarCardapioEmProdutosAdmin(LOJA_ALVO, {
      cardapio_id: CARDAPIO_INEXISTENTE,
      produto_ids: [PRODUTO_1],
    });
    await flush();

    expect(JSON.stringify(alheio)).toBe(JSON.stringify(inexistente));
    // Nem um round trip a mais denuncia que o cardápio alheio EXISTE.
    expect(idasAlheio).toBe(ops.length);
  });

  it("a posse é lida da LOJA-ALVO, por `id`, ANTES de qualquer escrita", async () => {
    const { aplicarCardapioEmProdutosAdmin } = await acoes();
    const r = await aplicarCardapioEmProdutosAdmin(LOJA_ALVO, {
      cardapio_id: CARDAPIO_ID,
      produto_ids: [PRODUTO_1],
    });
    expect(r).toEqual({ ok: true });

    const posse = ops.find((o) => o.tabela === "cardapios" && o.colunas === "id");
    expect(posse, "nenhuma leitura de posse foi emitida").toBeDefined();
    expect(posse!.filtros).toEqual(
      expect.arrayContaining([
        ["loja_id", LOJA_ALVO],
        ["id", CARDAPIO_ID],
      ]),
    );
    const escrita = opEscrita("cardapio_produtos");
    expect(escrita).toBeDefined();
    expect(ops.indexOf(posse!)).toBeLessThan(ops.indexOf(escrita!));
  });

  it("falha de banco NA LEITURA de posse é fail-closed: recusa genérica, sem escrita e sem log", async () => {
    respostaPorTabela.cardapios = (op) =>
      op.colunas === "id"
        ? { data: null, error: { code: "57014", message: "detalhe interno" }, count: 0 }
        : { data: null, error: null, count: 1 };

    const { aplicarCardapioEmProdutosAdmin } = await acoes();
    const r = await aplicarCardapioEmProdutosAdmin(LOJA_ALVO, {
      cardapio_id: CARDAPIO_ID,
      produto_ids: [PRODUTO_1],
    });
    await flush();

    expect(r).toEqual({ ok: false, erro: MSG_GENERICA_LOTE });
    expect(opEscrita("cardapio_produtos")).toBeUndefined();
    expect(logouAcesso()).toBe(false);
    expect(JSON.stringify(r)).not.toContain("57014");
    expect(JSON.stringify(r)).not.toContain("detalhe interno");
  });
});

// ═══════════════ 9 · [274] `definirDiasDoVinculoAdmin` — a agenda do VÍNCULO ══
//
// Fase RED da issue 274 (RN-10, RN-11, RN-12, RN-14). Espelho byte a byte de
// `src/lib/actions/cardapio.test.ts` §[274 · A]: mesma frase, mesma linha,
// mesmos filtros — o que muda é de onde vem o `loja_id` (aqui, o `lojaId` da
// URL validado, injetado POR ÚLTIMO pelo wrapper) e que aqui existe log.
//
// Por que a prova importa mais deste lado: `service_role` tem BYPASSRLS.
// `cardapio_produtos_escrita_propria` NÃO protege este caminho. Quem protege
// são as FKs compostas `(cardapio_id, loja_id)`/`(produto_id, loja_id)`, o
// escopo explícito por `loja_id` e a recusa por `count === 0` — que é a posse
// provada PELA PRÓPRIA ESCRITA, sem SELECT prévio nem janela TOCTOU (D6).

/** A frase de RN-12 (D3), escrita à MÃO como as outras seis do topo. */
const MSG_DIAS_DO_VINCULO = "Não foi possível salvar os dias deste item.";
const MSG_SALVAR = "Não foi possível salvar o cardápio.";
const MSG_REMOVER = "Não foi possível remover o cardápio.";
const MSG_CONVERTER =
  "Não foi possível converter os produtos deste cardápio para o menu.";

async function definirDias(): Promise<AdminCardapios["definirDiasDoVinculoAdmin"]> {
  const a = await acoes();
  if (typeof a.definirDiasDoVinculoAdmin !== "function") {
    throw new Error(
      "[RED 274] `definirDiasDoVinculoAdmin` ainda não existe em " +
        "`src/app/admin/assinantes/actions/admin-cardapios.ts` — é a fase GREEN (D5).",
    );
  }
  return a.definirDiasDoVinculoAdmin;
}

const diasDo = (over: Record<string, unknown> = {}) => ({
  cardapio_id: CARDAPIO_ID,
  produto_id: PRODUTO_1,
  dias_semana: [3],
  ...over,
});

/** A resposta do UPDATE do vínculo, com o `count` que o caso quer provar. */
function vinculoResponde(count: number | null | undefined, error: unknown = null) {
  respostaPorTabela.cardapio_produtos = { data: null, error, count: count ?? undefined };
}

describe("[274] definirDiasDoVinculoAdmin — escopo pela TRIPLA e recusa por count", () => {
  it("A1: UMA escrita em `cardapio_produtos`, `count: \"exact\"` e os TRÊS filtros nomeados", async () => {
    vinculoResponde(1);
    const definir = await definirDias();
    const r = await definir(LOJA_ALVO, diasDo());

    expect(r).toEqual({ ok: true });
    const w = opEscrita("cardapio_produtos");
    expect(w, "nenhum UPDATE em cardapio_produtos foi emitido").toBeDefined();
    expect(w!.update).toEqual({ dias_semana: [3] });
    expect(w!.updateOpts).toEqual({ count: "exact" });
    expect(w!.filtros).toContainEqual(["loja_id", LOJA_ALVO]);
    expect(w!.filtros).toContainEqual(["cardapio_id", CARDAPIO_ID]);
    expect(w!.filtros).toContainEqual(["produto_id", PRODUTO_1]);
    expect(w!.filtros.map(([c]) => c).sort()).toEqual([
      "cardapio_id",
      "loja_id",
      "produto_id",
    ]);
    // O patch toca SÓ a agenda: o `.eq` escopa QUAL linha, nunca O QUE se grava.
    expect(Object.keys(w!.update ?? {})).toEqual(["dias_semana"]);
  });

  it("A2/A3/A4 (RN-11): `[]` → NULL, `[1,1,3]` → `[1,3]`, `[3,1]` → `[1,3]`", async () => {
    vinculoResponde(1);
    const definir = await definirDias();

    await definir(LOJA_ALVO, diasDo({ dias_semana: [] }));
    expect(opEscrita("cardapio_produtos")?.update).toEqual({ dias_semana: null });

    ops = [];
    await definir(LOJA_ALVO, diasDo({ dias_semana: [1, 1, 3] }));
    expect(opEscrita("cardapio_produtos")?.update).toEqual({ dias_semana: [1, 3] });

    ops = [];
    await definir(LOJA_ALVO, diasDo({ dias_semana: [3, 1] }));
    expect(opEscrita("cardapio_produtos")?.update).toEqual({ dias_semana: [1, 3] });
  });

  it("A5 (RN-10): `loja_id` hostil no payload ⇒ recusa com ZERO I/O — nada vai para a loja alheia", async () => {
    const definir = await definirDias();
    const r = await definir(LOJA_ALVO, diasDo({ loja_id: LOJA_OUTRA }));
    await flush();

    expect(r).toEqual({ ok: false, erro: MSG_DIAS_DO_VINCULO });
    expect(ops, "o `.strict()` recusa antes de tocar o banco").toHaveLength(0);
    expect(logouAcesso()).toBe(false);
    expect(JSON.stringify(ops)).not.toContain(LOJA_OUTRA);
  });

  it("payload fora da forma (dia 7, 8 itens, id não-uuid) ⇒ a MESMA frase e ZERO I/O", async () => {
    const definir = await definirDias();
    for (const payload of [
      diasDo({ dias_semana: [7] }),
      diasDo({ dias_semana: [1.5] }),
      diasDo({ dias_semana: [1, 1, 1, 1, 1, 1, 1, 1] }),
      diasDo({ cardapio_id: "nao-e-uuid" }),
      diasDo({ produto_id: "nao-e-uuid" }),
      {},
      null,
    ]) {
      ops = [];
      const r = await definir(LOJA_ALVO, payload);
      expect(r, `${JSON.stringify(payload)} deveria ser recusado`).toEqual({
        ok: false,
        erro: MSG_DIAS_DO_VINCULO,
      });
      expect(ops).toHaveLength(0);
    }
  });

  it("A6/A7/A8 (§14): `count: 0` alheio e inexistente ⇒ MESMA resposta, sem log, sem revalidate", async () => {
    const { revalidatePath } = await import("next/cache");
    vi.mocked(revalidatePath).mockClear();
    vinculoResponde(0);
    const definir = await definirDias();

    const alheio = await definir(LOJA_ALVO, diasDo({ cardapio_id: CARDAPIO_OUTRO }));
    await flush();
    expect(alheio).toEqual({ ok: false, erro: MSG_DIAS_DO_VINCULO });
    expect(logouAcesso(), "id-probe não pode virar linha em admin_acessos").toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();

    ops = [];
    const inexistente = await definir(
      LOJA_ALVO,
      diasDo({ cardapio_id: "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a" }),
    );
    await flush();
    expect(JSON.stringify(alheio)).toBe(JSON.stringify(inexistente));
    expect(JSON.stringify(alheio)).not.toContain(CARDAPIO_OUTRO);
  });

  it("A9: sucesso loga `cardapio.definir_dias` com a CONTAGEM de dias — nunca o nome nem o array", async () => {
    vinculoResponde(1);
    const definir = await definirDias();
    await definir(LOJA_ALVO, diasDo({ dias_semana: [3, 1, 1] }));
    await flush();

    const log = ops.find((o) => o.tabela === "admin_acessos")?.insert ?? {};
    expect(log.acao).toBe("cardapio.definir_dias");
    expect(log.loja_id).toBe(LOJA_ALVO);
    expect(log.entidade_id).toBe(CARDAPIO_ID);
    const metadados = (log.metadados ?? {}) as Record<string, unknown>;
    expect(Object.keys(metadados)).toEqual(["produto_id", "dias"]);
    expect(metadados.produto_id).toBe(PRODUTO_1);
    // A CONTAGEM (já normalizada), não o conteúdo: `[3,1,1]` são 2 dias.
    expect(metadados.dias).toBe(2);
    expect(JSON.stringify(metadados)).not.toContain("nome");
  });

  it("A10: `lojaId` não-UUID ⇒ `Loja inválida.` ANTES de elevar — nenhuma ida ao banco", async () => {
    const definir = await definirDias();
    const r = await definir("loja-b", diasDo());
    await flush();
    expect(r).toEqual({ ok: false, erro: MSG_LOJA_INVALIDA });
    expect(ops).toHaveLength(0);
  });

  it("A11 (fail-closed D-4): `verificarAdminSaaS` lançando REJEITA a action, não devolve `{ok:false}`", async () => {
    const { verificarAdminSaaS } = await import("@/lib/auth/admin");
    vi.mocked(verificarAdminSaaS).mockRejectedValueOnce(new Error("acesso negado"));
    const definir = await definirDias();
    await expect(definir(LOJA_ALVO, diasDo())).rejects.toThrow("acesso negado");
    expect(ops).toHaveLength(0);
  });

  it("A12/A13: `error` do banco ⇒ frase + `console.error`; `count: 0` ⇒ SEM `console.error`", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vinculoResponde(null, {
      code: "23514",
      message: 'violates check constraint "cardapio_produtos_dias_semana_dominio"',
    });
    const definir = await definirDias();
    const comErro = await definir(LOJA_ALVO, diasDo());
    expect(comErro).toEqual({ ok: false, erro: MSG_DIAS_DO_VINCULO });
    expect(spy).toHaveBeenCalled();
    expect(JSON.stringify(comErro)).not.toContain("23514");
    expect(JSON.stringify(comErro)).not.toContain("dias_semana_dominio");

    spy.mockClear();
    ops = [];
    vinculoResponde(0);
    await definir(LOJA_ALVO, diasDo());
    expect(spy, "`count: 0` é id que não existe NESTA loja, não erro de servidor").not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("R4: `count` ausente (`null`/`undefined`) NÃO recusa — a recusa é em `0` estrito", async () => {
    const definir = await definirDias();
    for (const count of [null, undefined]) {
      ops = [];
      vinculoResponde(count);
      expect(await definir(LOJA_ALVO, diasDo()), `count: ${count} não pode recusar`).toEqual({
        ok: true,
      });
    }
  });

  it("A15 (D9): o sucesso revalida o DETALHE concreto do cardápio na loja-alvo", async () => {
    const { revalidatePath } = await import("next/cache");
    vi.mocked(revalidatePath).mockClear();
    vinculoResponde(1);
    const definir = await definirDias();
    await definir(LOJA_ALVO, diasDo());

    const caminhos = vi.mocked(revalidatePath).mock.calls.map((c) => c[0]);
    expect(
      caminhos,
      "`/admin/assinantes/<loja>/cardapios` não invalida o detalhe, que é a tela desta feature",
    ).toContain(`/admin/assinantes/${LOJA_ALVO}/cardapios/${CARDAPIO_ID}`);
    // A vitrine continua coberta por `revalidarLojaAdmin`.
    expect(caminhos).toContain("/loja/[slug]");
    // Nenhum caminho do painel do LOJISTA: o admin edita a loja de um terceiro.
    expect(caminhos.some((c) => String(c).startsWith("/painel"))).toBe(false);
  });

  it("D6: a posse NÃO custa uma segunda ida ao banco — o UPDATE é a única op", async () => {
    vinculoResponde(1);
    const definir = await definirDias();
    await definir(LOJA_ALVO, diasDo());
    const semLog = ops.filter((o) => o.tabela !== "admin_acessos");
    expect(semLog).toHaveLength(1);
    expect(semLog[0].tabela).toBe("cardapio_produtos");
  });

  it("D3: `MSG_DIAS_DO_VINCULO` mora no contrato neutro e NÃO é redeclarada nos dois mundos", () => {
    const RAIZ = process.cwd();
    const contrato = readFileSync(join(RAIZ, "src/lib/actions/cardapio-contrato.ts"), "utf8");
    const admin = readFileSync(
      join(RAIZ, "src/app/admin/assinantes/actions/admin-cardapios.ts"),
      "utf8",
    );
    const lojista = readFileSync(join(RAIZ, "src/lib/actions/cardapio.ts"), "utf8");
    expect(contrato, "a frase de RN-12 não está no contrato neutro").toContain(
      MSG_DIAS_DO_VINCULO,
    );
    expect(admin).not.toContain(MSG_DIAS_DO_VINCULO);
    expect(lojista).not.toContain(MSG_DIAS_DO_VINCULO);
    // E os dois importam a MESMA normalização, não uma cópia local.
    expect(admin).toContain("normalizarDiasDoVinculo");
    expect(lojista).toContain("normalizarDiasDoVinculo");
  });
});

// ═══ 10 · [274 · B] item ABSORVIDO da auditoria da 270: `count` nas 4 admin ══
//
// Hoje as quatro descartam o `count` de `escopo.atualizar`/`escopo.remover`:
// cardápio alheio ou inexistente casa ZERO linhas, a action devolve
// `{ ok: true }` e `registrarAcessoAdmin` grava `entidade_id` de OUTRO tenant.
// Nenhuma escrita cruza lojas — o defeito é o sucesso mentiroso e o log sujo.
// A frase de alheio é a MESMA de inexistente (`MSG_SALVAR`/`MSG_REMOVER`/
// `MSG_CONVERTER`), então nada disto vira oráculo.

describe("[274 · B] D8 — as quatro actions admin leem o `count` e recusam ANTES do log", () => {
  const recorrente = {
    nome: "Segunda",
    modo: "recorrente",
    dias_semana: [1],
    dias_mes: null,
    hora_inicio: null,
    hora_fim: null,
  };

  beforeEach(() => {
    // Sem órfãos: a remoção e a conversão chegam à escrita.
    respostaPorTabela.cardapio_produtos = { data: [], error: null, count: 1 };
    respostaPorTabela.produtos = { data: [], error: null, count: 1 };
  });

  it("atualizarCardapioAdmin: `count: 0` ⇒ `{ok:false, MSG_SALVAR}` e NENHUM log", async () => {
    const { revalidatePath } = await import("next/cache");
    vi.mocked(revalidatePath).mockClear();
    respostaPorTabela.cardapios = { data: null, error: null, count: 0 };

    const { atualizarCardapioAdmin } = await acoes();
    const r = await atualizarCardapioAdmin(LOJA_ALVO, CARDAPIO_OUTRO, recorrente);
    await flush();

    expect(r).toEqual({ ok: false, erro: MSG_SALVAR });
    expect(opEscrita("cardapios")?.updateOpts).toEqual({ count: "exact" });
    expect(logouAcesso(), "entidade_id de outro tenant não pode virar auditoria").toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("ligarDesligarCardapioAdmin: `count: 0` ⇒ `{ok:false, MSG_SALVAR}` e NENHUM log", async () => {
    respostaPorTabela.cardapios = { data: null, error: null, count: 0 };
    const { ligarDesligarCardapioAdmin } = await acoes();
    const r = await ligarDesligarCardapioAdmin(LOJA_ALVO, CARDAPIO_OUTRO, false);
    await flush();

    expect(r).toEqual({ ok: false, erro: MSG_SALVAR });
    expect(opEscrita("cardapios")?.updateOpts).toEqual({ count: "exact" });
    expect(logouAcesso()).toBe(false);
  });

  it("removerCardapioAdmin: `count: 0` ⇒ `{ok:false, MSG_REMOVER, exclusivos: 0}` e NENHUM log", async () => {
    respostaPorTabela.cardapios = { data: null, error: null, count: 0 };
    const { removerCardapioAdmin } = await acoes();
    const r = await removerCardapioAdmin(LOJA_ALVO, CARDAPIO_OUTRO);
    await flush();

    expect(r).toEqual({ ok: false, erro: MSG_REMOVER, exclusivos: 0 });
    expect(opEscrita("cardapios")?.deleteOpts).toEqual({ count: "exact" });
    expect(logouAcesso()).toBe(false);
  });

  it("converterExclusivosParaMenuAdmin: cardápio ALHEIO é recusado ANTES de ler os órfãos", async () => {
    const { revalidatePath } = await import("next/cache");
    vi.mocked(revalidatePath).mockClear();

    const { converterExclusivosParaMenuAdmin } = await acoes();
    // `respostaPorTabela.cardapios` do beforeEach global só devolve posse para
    // CARDAPIO_ID na LOJA_ALVO: para CARDAPIO_OUTRO o gate tem de negar.
    const r = await converterExclusivosParaMenuAdmin(LOJA_ALVO, CARDAPIO_OUTRO);
    await flush();

    expect(r).toEqual({ ok: false, erro: MSG_CONVERTER });
    expect(
      ops.some((o) => o.tabela === "cardapio_produtos"),
      "buscarProdutosQueFicariamOrfaos não pode rodar sem posse provada",
    ).toBe(false);
    expect(opEscrita("produtos")).toBeUndefined();
    expect(logouAcesso()).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("regressão: com posse e ZERO órfãos, a conversão continua `{ok:true}` E continua logando", async () => {
    const { converterExclusivosParaMenuAdmin } = await acoes();
    const r = await converterExclusivosParaMenuAdmin(LOJA_ALVO, CARDAPIO_ID);
    await flush();

    expect(r).toEqual({ ok: true });
    expect(
      logouAcesso(),
      "o rastro que explica por que a tela não mudou é intencional (269 · D7)",
    ).toBe(true);
  });

  it("R4 (regressão): `count` ausente continua `{ok:true}` nas três de escopo", async () => {
    respostaPorTabela.cardapios = { data: null, error: null };
    const { atualizarCardapioAdmin, ligarDesligarCardapioAdmin, removerCardapioAdmin } =
      await acoes();
    expect(await atualizarCardapioAdmin(LOJA_ALVO, CARDAPIO_ID, recorrente)).toEqual({ ok: true });
    expect(await ligarDesligarCardapioAdmin(LOJA_ALVO, CARDAPIO_ID, true)).toEqual({ ok: true });
    expect(await removerCardapioAdmin(LOJA_ALVO, CARDAPIO_ID)).toEqual({ ok: true });
  });
});

// ═══ 11 · [284] RED — remoção com escolha no HUB ADMIN: manter/arquivar/cascata
//
// Spec: `specs/remocao-cardapio-exclusivos.md`. Os 12 critérios mecânicos, lado
// ADMIN, em paridade com `src/lib/actions/cardapio.crud.test.ts`.
//
// Por que a paridade É a prova principal aqui: `service_role` tem BYPASSRLS.
// `produtos_escrita_propria` NÃO alcança este caminho. O que protege a escrita
// em lote — e um DELETE em lote é IRREVERSÍVEL — é, nesta ordem:
// `verificarAdminSaaS` antes de elevar, `lojaId` da URL validado,
// `cardapioPertenceALoja` (RN-04), `.eq("loja_id")` explícito em toda escrita,
// as FKs compostas e o trigger.
//
// O `modo` ainda não existe na assinatura: o módulo continua sendo alcançado
// por `acoes()` (import por caminho em VARIÁVEL), e o tipo local abaixo é o
// contrato que a fase GREEN tem de satisfazer. `tsc --noEmit` fica limpo.

type ModoRemocaoExclusivos = "manter" | "arquivar" | "cascata";

type RemocaoComModo = {
  removerCardapioAdmin(
    lojaId: string,
    id: string,
    modo?: ModoRemocaoExclusivos,
  ): Promise<ResultadoRemocao>;
};

async function removerComModo(): Promise<
  RemocaoComModo["removerCardapioAdmin"]
> {
  const mod = (await acoes()) as unknown as RemocaoComModo;
  return mod.removerCardapioAdmin;
}

const MSG_REMOVER_284 = "Não foi possível remover o cardápio.";

describe("[284] removerCardapioAdmin(lojaId, id, modo) — os três modos", () => {
  /**
   * Modela o banco da LOJA-ALVO para `buscarProdutosQueFicariamOrfaos`, que
   * roda de verdade aqui (três leituras): vínculos DESTE cardápio → quais são
   * exclusivos → TODOS os vínculos desses exclusivos.
   *
   * `produtos` discrimina pelo `select("id")` da leitura; a ESCRITA (update ou
   * delete) não tem colunas e cai no `count: 1`.
   */
  function bancoDaLojaAlvo(
    vinculadosAqui: string[],
    exclusivos: string[],
    todosOsVinculos: Array<{ produto_id: string; cardapio_id: string }>,
  ): void {
    respostaPorTabela.cardapio_produtos = (op) =>
      op.colunas?.includes("cardapio_id")
        ? { data: todosOsVinculos, error: null }
        : { data: vinculadosAqui.map((id) => ({ produto_id: id })), error: null };
    respostaPorTabela.produtos = (op) =>
      op.colunas === "id"
        ? { data: exclusivos.map((id) => ({ id })), error: null }
        : { data: null, error: null, count: 1 };
  }

  /** O log admin, já materializado (fire-and-forget). */
  function logAdmin(): Record<string, unknown> | undefined {
    return ops.find((o) => o.tabela === "admin_acessos" && o.insert != null)?.insert;
  }

  function escritaEmProdutos(): Op | undefined {
    return ops.find((o) => o.tabela === "produtos" && (o.update || o.deleted));
  }

  function deleteDoCardapio(): Op | undefined {
    return ops.find((o) => o.tabela === "cardapios" && o.deleted);
  }

  // ════════════════════════════════════════ critério 7 · modo inválido, 0 I/O ═
  describe("critério 7 — modo fora do domínio ⇒ MSG_INVALIDO, sem NENHUM I/O", () => {
    const LIXO: unknown[] = ["apagar", "", "cascade", "CASCATA", null, 0, {}, []];

    it.each(LIXO.map((m) => [JSON.stringify(m) ?? String(m), m] as const))(
      "modo %s não abre contexto admin, não lê a loja e não escreve",
      async (_rotulo, modo) => {
        const remover = await removerComModo();
        const r = await remover(LOJA_ALVO, CARDAPIO_ID, modo as ModoRemocaoExclusivos);
        await flush();
        expect(r).toEqual({ ok: false, erro: MSG_INVALIDO, exclusivos: 0 });
        expect(ops, "parse do modo é ANTES de qualquer I/O (RN-01)").toHaveLength(0);
        expect(logouAcesso()).toBe(false);
      },
    );
  });

  // ══════════════════════════ critério 1 (RN-10) · a linha de base do admin ══
  describe("critério 1 (RN-10) — `manter` e a ausência do parâmetro são o de hoje", () => {
    it("mesma resposta e mesma sequência de ops, sem escrita em produtos", async () => {
      bancoDaLojaAlvo([PRODUTO_1], [PRODUTO_1], [
        { produto_id: PRODUTO_1, cardapio_id: CARDAPIO_ID },
      ]);
      const remover = await removerComModo();

      const semModo = await remover(LOJA_ALVO, CARDAPIO_ID);
      await flush();
      const tabelasSemModo = ops.map((o) => o.tabela);

      ops = [];
      const comManter = await remover(LOJA_ALVO, CARDAPIO_ID, "manter");
      await flush();
      const tabelasComManter = ops.map((o) => o.tabela);

      expect(semModo).toEqual({ ok: false, erro: MSG_EXCLUSIVOS_1, exclusivos: 1 });
      expect(comManter).toEqual(semModo);
      expect(tabelasComManter).toEqual(tabelasSemModo);
      expect(escritaEmProdutos()).toBeUndefined();
      expect(deleteDoCardapio()).toBeUndefined();
    });

    /**
     * RN-04 é explícita: o gate de posse NÃO entra no `manter`. Uma leitura a
     * mais mudaria a sequência e quebraria a preservação byte a byte.
     */
    it("`manter` NÃO ganha o gate de posse — a 1ª ida ao banco continua a dos vínculos", async () => {
      respostaPorTabela.cardapio_produtos = { data: [], error: null };
      const remover = await removerComModo();
      expect(await remover(LOJA_ALVO, CARDAPIO_ID, "manter")).toEqual({ ok: true });
      expect(ops[0].tabela).toBe("cardapio_produtos");
    });
  });

  // ════════════════════════ critério 2 · `arquivar` — RN-05, RN-06, RN-13 ════
  describe("critério 2 — `arquivar` grava { oculto, visibilidade } e SÓ isso", () => {
    it("um UPDATE com o objeto INTEIRO, escopado pelo lojaId da URL, ANTES do DELETE", async () => {
      bancoDaLojaAlvo([PRODUTO_1, PRODUTO_2], [PRODUTO_1, PRODUTO_2], [
        { produto_id: PRODUTO_1, cardapio_id: CARDAPIO_ID },
        { produto_id: PRODUTO_2, cardapio_id: CARDAPIO_ID },
      ]);
      const remover = await removerComModo();
      const r = await remover(LOJA_ALVO, CARDAPIO_ID, "arquivar");
      await flush();
      expect(r).toEqual({ ok: true });

      const w = escritaEmProdutos();
      // RN-05: o objeto INTEIRO. `disponivel` é "esgotado" (CONTINUA visível na
      // vitrine) e não pode entrar aqui — §Ressalva de vocabulário.
      expect(w?.update).toEqual({ oculto: true, visibilidade: "menu" });
      expect(w?.update).not.toHaveProperty("disponivel");
      expect(w?.update).not.toHaveProperty("loja_id");
      // Critério 5: `loja_id` da URL validada + 2º cinto de visibilidade.
      expect(w?.filtros).toEqual([
        ["loja_id", LOJA_ALVO],
        ["visibilidade", "cardapio"],
        ["id", [PRODUTO_1, PRODUTO_2]],
      ]);

      // RN-06: produtos PRIMEIRO, cardápio DEPOIS.
      const semLog = ops.filter((o) => o.tabela !== "admin_acessos");
      expect(semLog.indexOf(w as Op)).toBeLessThan(
        semLog.indexOf(deleteDoCardapio() as Op),
      );
      expect(deleteDoCardapio()?.deleteOpts).toEqual({ count: "exact" });

      // RN-13: o rastro do gesto de OUTRA pessoa, com modo e contagem.
      expect(logAdmin()).toMatchObject({
        loja_id: LOJA_ALVO,
        acao: "cardapio.remover",
        entidade_id: CARDAPIO_ID,
        metadados: { modo: "arquivar", produtos: 2 },
      });
    });
  });

  // ═══════════════════════════════════════════════════ critério 3 · `cascata` ═
  describe("critério 3 — `cascata` apaga os órfãos e SÓ depois o cardápio", () => {
    it("DELETE em produtos escopado, depois o DELETE do cardápio, com log do modo", async () => {
      bancoDaLojaAlvo([PRODUTO_1, PRODUTO_2], [PRODUTO_1, PRODUTO_2], [
        { produto_id: PRODUTO_1, cardapio_id: CARDAPIO_ID },
        { produto_id: PRODUTO_2, cardapio_id: CARDAPIO_ID },
      ]);
      const remover = await removerComModo();
      const r = await remover(LOJA_ALVO, CARDAPIO_ID, "cascata");
      await flush();
      expect(r).toEqual({ ok: true });

      const w = escritaEmProdutos();
      expect(w?.deleted).toBe(true);
      expect(w?.update).toBeUndefined();
      expect(w?.filtros).toEqual([
        ["loja_id", LOJA_ALVO],
        ["visibilidade", "cardapio"],
        ["id", [PRODUTO_1, PRODUTO_2]],
      ]);
      const semLog = ops.filter((o) => o.tabela !== "admin_acessos");
      expect(semLog.indexOf(w as Op)).toBeLessThan(
        semLog.indexOf(deleteDoCardapio() as Op),
      );
      expect(logAdmin()).toMatchObject({
        acao: "cardapio.remover",
        metadados: { modo: "cascata", produtos: 2 },
      });
    });
  });

  // ══════════════ critério 4 (RN-02) · a lista é do SERVIDOR, nunca do cliente
  describe("critério 4 (RN-02) — o in() é o recálculo do servidor", () => {
    /**
     * Conjunto DIFERENTE do "esperado ingênuo": PRODUTO_1 é exclusivo e está
     * neste cardápio, mas TAMBÉM em outro — não ficaria órfão. Só PRODUTO_2
     * pode entrar no `in()`. Uma implementação que apagasse "todos os
     * exclusivos vinculados" (o que um cliente mandaria) destruiria um prato
     * que continua vivo em outro cardápio — e sem desfazer.
     */
    it("o exclusivo com OUTRO vínculo NÃO entra no in(), e o log conta 1, não 2", async () => {
      bancoDaLojaAlvo([PRODUTO_1, PRODUTO_2], [PRODUTO_1, PRODUTO_2], [
        { produto_id: PRODUTO_1, cardapio_id: CARDAPIO_ID },
        { produto_id: PRODUTO_1, cardapio_id: CARDAPIO_OUTRO },
        { produto_id: PRODUTO_2, cardapio_id: CARDAPIO_ID },
      ]);
      const remover = await removerComModo();
      expect(await remover(LOJA_ALVO, CARDAPIO_ID, "cascata")).toEqual({ ok: true });
      await flush();

      const w = escritaEmProdutos();
      expect(w?.filtros.at(-1)).toEqual(["id", [PRODUTO_2]]);
      expect(JSON.stringify(w?.filtros)).not.toContain(PRODUTO_1);
      expect(logAdmin()).toMatchObject({ metadados: { produtos: 1 } });
    });

    it("um 3º argumento com ids do cliente é ignorado — o in() continua o do servidor", async () => {
      bancoDaLojaAlvo([PRODUTO_2], [PRODUTO_2], [
        { produto_id: PRODUTO_2, cardapio_id: CARDAPIO_ID },
      ]);
      const remover = await removerComModo();
      const hostil = remover as unknown as (...a: unknown[]) => Promise<unknown>;
      expect(
        await hostil(LOJA_ALVO, CARDAPIO_ID, "cascata", [PRODUTO_1, CARDAPIO_OUTRO]),
      ).toEqual({ ok: true });
      await flush();
      expect(escritaEmProdutos()?.filtros.at(-1)).toEqual(["id", [PRODUTO_2]]);
    });
  });

  // ═══════════════ critério 5 · o escopo é o `lojaId` da URL, sempre ═════════
  describe("critério 5 — isolamento entre lojas", () => {
    it("`lojaId` de OUTRA loja não vira escopo: sem posse, MSG_REMOVER e zero escrita", async () => {
      bancoDaLojaAlvo([PRODUTO_1], [PRODUTO_1], [
        { produto_id: PRODUTO_1, cardapio_id: CARDAPIO_ID },
      ]);
      const remover = await removerComModo();
      // A posse do `beforeEach` global só é concedida ao par
      // (CARDAPIO_ID, LOJA_ALVO): a loja hostil da URL não alcança o cardápio.
      const r = await remover(LOJA_OUTRA, CARDAPIO_ID, "cascata");
      await flush();

      expect(r).toEqual({ ok: false, erro: MSG_REMOVER_284, exclusivos: 0 });
      expect(escritaEmProdutos()).toBeUndefined();
      expect(deleteDoCardapio()).toBeUndefined();
      expect(logouAcesso()).toBe(false);
      // E nenhuma leitura de órfãos rodou sobre a loja alheia.
      expect(ops.every((o) => o.tabela !== "cardapio_produtos")).toBe(true);
    });

    it("`lojaId` que não é UUID é recusado antes de tudo, nos modos novos", async () => {
      const remover = await removerComModo();
      for (const modo of ["arquivar", "cascata"] as const) {
        ops = [];
        const r = await remover("nao-uuid", CARDAPIO_ID, modo);
        expect(r).toEqual({ ok: false, erro: MSG_LOJA_INVALIDA, exclusivos: 0 });
        expect(ops).toHaveLength(0);
      }
    });
  });

  // ══════════════════ critério 6 (RN-04) · posse ANTES da leitura E do log ═══
  describe("critério 6 (RN-04) — cardápio alheio/inexistente nos modos novos", () => {
    it.each(["arquivar", "cascata"] as const)(
      "%s sem posse ⇒ MSG_REMOVER, zero leitura de órfãos, zero escrita, zero log",
      async (modo) => {
        const remover = await removerComModo();
        const r = await remover(LOJA_ALVO, CARDAPIO_OUTRO, modo);
        await flush();

        expect(r).toEqual({ ok: false, erro: MSG_REMOVER_284, exclusivos: 0 });
        expect(
          ops.some((o) => o.tabela === "cardapio_produtos"),
          "sob service_role, ler órfãos sem posse roda sobre OUTRO tenant (RN-04)",
        ).toBe(false);
        expect(escritaEmProdutos()).toBeUndefined();
        expect(deleteDoCardapio()).toBeUndefined();
        expect(
          logouAcesso(),
          "entidade_id de outro tenant não pode virar auditoria desta loja",
        ).toBe(false);
      },
    );

    it("a recusa de alheio é byte a byte a de inexistente — nenhum oráculo (§14)", async () => {
      const remover = await removerComModo();
      const alheio = await remover(LOJA_ALVO, CARDAPIO_OUTRO, "cascata");
      const inexistente = await remover(LOJA_ALVO, CARDAPIO_OUTRO, "arquivar");
      expect(alheio).toEqual({ ok: false, erro: MSG_REMOVER_284, exclusivos: 0 });
      expect(inexistente).toEqual(alheio);
    });
  });

  // ══════ critério 8 · falha no request 1 não segue para o 2, e não loga ═════
  describe("critério 8 (RN-06) — erro na escrita dos produtos aborta antes do DELETE", () => {
    it.each(["arquivar", "cascata"] as const)(
      "%s: erro no request 1 ⇒ MSG_REMOVER, nenhum DELETE de cardápio, nenhum log",
      async (modo) => {
        bancoDaLojaAlvo([PRODUTO_1], [PRODUTO_1], [
          { produto_id: PRODUTO_1, cardapio_id: CARDAPIO_ID },
        ]);
        const leitura = respostaPorTabela.produtos as (op: Op) => Resposta;
        respostaPorTabela.produtos = (op) =>
          op.colunas === "id"
            ? leitura(op)
            : {
                data: null,
                error: { code: "42501", message: "permission denied for table produtos" },
                count: 0,
              };

        const remover = await removerComModo();
        const r = await remover(LOJA_ALVO, CARDAPIO_ID, modo);
        await flush();

        expect(r).toEqual({ ok: false, erro: MSG_REMOVER_284, exclusivos: 0 });
        expect(
          deleteDoCardapio(),
          "o cardápio tem de sobreviver — estado reconciliável, não corrompido",
        ).toBeUndefined();
        expect(logouAcesso()).toBe(false);
        expect(JSON.stringify(r)).not.toContain("42501");
        expect(JSON.stringify(r)).not.toContain("permission denied");
      },
    );
  });

  // ═════════════════════ critério 9 · backstop da corrida nos modos novos ════
  describe("critério 9 (RN-09) — o 23000 do trigger vira a frase SEM número", () => {
    it.each(["arquivar", "cascata"] as const)(
      "%s: DELETE do cardápio com 23000 + fragmento ⇒ MSG_EXCLUSIVOS_SEM_NUMERO",
      async (modo) => {
        bancoDaLojaAlvo([PRODUTO_1], [PRODUTO_1], [
          { produto_id: PRODUTO_1, cardapio_id: CARDAPIO_ID },
        ]);
        const posse = respostaPorTabela.cardapios as (op: Op) => Resposta;
        respostaPorTabela.cardapios = (op) =>
          op.deleted ? { data: null, error: ERRO_TRIGGER_RN14, count: 0 } : posse(op);

        const remover = await removerComModo();
        const r = await remover(LOJA_ALVO, CARDAPIO_ID, modo);
        await flush();

        expect(r).toEqual({
          ok: false,
          erro: MSG_EXCLUSIVOS_SEM_NUMERO,
          exclusivos: 0,
        });
        expect(JSON.stringify(r)).not.toContain("23000");
      },
    );
  });

  // ══════════════════════ critérios 11 e 12 · paridade e anti-drift de fonte ═
  describe("critérios 11 e 12 — paridade de fonte", () => {
    const RAIZ = process.cwd();
    const CONTRATO = join(RAIZ, "src/lib/actions/cardapio-contrato.ts");
    const ADMIN = join(RAIZ, "src/app/admin/assinantes/actions/admin-cardapios.ts");
    const LOJISTA = join(RAIZ, "src/lib/actions/cardapio.ts");
    const VALIDACOES = join(RAIZ, "src/lib/validacoes/cardapio.ts");

    it("`ModoRemocaoExclusivos` mora no contrato NEUTRO e os dois mundos o importam", () => {
      const contrato = readFileSync(CONTRATO, "utf8");
      expect(contrato).toMatch(/export type ModoRemocaoExclusivos\s*=/);
      for (const arquivo of [ADMIN, LOJISTA]) {
        const texto = readFileSync(arquivo, "utf8");
        expect(texto).toContain("ModoRemocaoExclusivos");
        expect(
          texto,
          "o tipo não pode ser redeclarado em nenhum dos dois mundos",
        ).not.toMatch(/type ModoRemocaoExclusivos\s*=/);
      }
    });

    it("`schemaModoRemocao` é UM zod isomórfico em `lib/validacoes/cardapio.ts`", () => {
      expect(readFileSync(VALIDACOES, "utf8")).toMatch(
        /export const schemaModoRemocao\s*=/,
      );
      for (const arquivo of [ADMIN, LOJISTA]) {
        const texto = readFileSync(arquivo, "utf8");
        expect(texto).toContain("schemaModoRemocao");
        expect(
          texto,
          "um enum/union paralelo aqui é o drift que a paridade fecha",
        ).not.toMatch(/const schemaModoRemocao\s*=/);
      }
    });

    /**
     * Critério 12: D1 resolveu sem RPC. Se `tests/migrations/` ganhar cenário
     * novo, a decisão foi revertida — e aí T1–T7 voltam à mesa. Esta é a
     * asserção que força a conversa em vez de deixar a RPC entrar calada.
     */
    it("nenhuma RPC nova: os dois mundos escrevem com statement direto", () => {
      for (const arquivo of [ADMIN, LOJISTA]) {
        const texto = readFileSync(arquivo, "utf8");
        expect(texto).not.toContain("remover_cardapio_com_exclusivos");
      }
    });
  });
});
