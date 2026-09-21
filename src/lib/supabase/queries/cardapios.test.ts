import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

import {
  buscarCardapiosComProdutos,
  buscarCardapiosDoPainel,
  buscarCardapioPorId,
  buscarProdutosQueFicariamOrfaos,
  buscarLinhasDaPrevia,
  COLUNAS_CARDAPIO_VIGENCIA,
} from "./cardapios";

/**
 * [247] Fase RED — `buscarCardapiosComProdutos`, a 5ª query do SSR da vitrine.
 * Contrato TS com client mockado (camada 2, mesmo padrão de `produtos.test.ts`).
 *
 * O que este arquivo prova:
 *  1. select NOMEADO com o embed, 1 round trip (D5), nunca `select("*")`;
 *  2. `.eq("loja_id", …)` EXPLÍCITO — é o que torna a função segura sob
 *     `service_role` (BYPASSRLS) para 249/252 reusarem sem uma 2ª query;
 *  3. SEM `.eq("ativo", true)`: RN-03 é decidida na função pura, e filtrar no
 *     SQL criaria a segunda casa da regra;
 *  4. `modo` fora do domínio ⇒ linha DESCARTADA (fail-closed, D6);
 *  5. o `Map` produto_id → cardápios montado no mesmo passo;
 *  6. erro PROPAGADO (§14) — fail-closed por omissão é proibido: engolir o erro
 *     e seguir com `[]` faria a vitrine vender a temporada inteira em silêncio.
 */

type Client = SupabaseClient<Database>;
type Terminal = { data: unknown; error: unknown };

function makeClient(terminal: Terminal) {
  const calls = { from: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn() };
  const builder: Record<string, unknown> = {};
  builder.select = (...args: unknown[]) => {
    calls.select(...args);
    return builder;
  };
  builder.eq = (...args: unknown[]) => {
    calls.eq(...args);
    return builder;
  };
  builder.order = (...args: unknown[]) => {
    calls.order(...args);
    return builder;
  };
  builder.maybeSingle = () => builder;
  builder.then = (resolve: (v: Terminal) => unknown) => resolve(terminal);

  const client = {
    from: (rel: string) => {
      calls.from(rel);
      return builder as never;
    },
  } as unknown as Client;

  return { client, calls };
}

/**
 * [testar/273] `buscarCardapiosDoPainel` faz DUAS idas ao banco em paralelo
 * (`cardapios` via `buscarCardapiosComProdutos` + `cardapio_produtos` via
 * `buscarVinculosComVisibilidade`) — o `makeClient` de cima devolve o MESMO
 * terminal para qualquer tabela, então não serve para testar esta função.
 * Este mock despacha por nome de relação.
 */
function makeMultiplexClient(porTabela: Record<string, Terminal>) {
  const client = {
    from: (rel: string) => {
      const terminal = porTabela[rel] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.order = () => builder;
      builder.then = (resolve: (v: Terminal) => unknown) => resolve(terminal);
      return builder;
    },
  } as unknown as Client;
  return client;
}

const linha = (over: Record<string, unknown> = {}) => ({
  id: "c0000000-0000-4000-8000-000000000001",
  nome: "Fim de semana",
  ativo: true,
  ordem: 3,
  modo: "recorrente",
  dias_semana: [6, 0],
  dias_mes: null,
  hora_inicio: "11:00:00",
  hora_fim: "15:00:00",
  prazo_inicio: null,
  prazo_fim: null,
  cardapio_produtos: [{ produto_id: "p1" }, { produto_id: "p2" }],
  ...over,
});

describe("247 — buscarCardapiosComProdutos: forma da query (D5)", () => {
  it("lê `cardapios` com select NOMEADO e o embed, escopado por loja_id", async () => {
    const { client, calls } = makeClient({ data: [], error: null });

    await buscarCardapiosComProdutos(client, "loja-1");

    expect(calls.from).toHaveBeenCalledWith("cardapios");
    expect(calls.select).toHaveBeenCalledWith(COLUNAS_CARDAPIO_VIGENCIA);
    // Nunca `select("*")`: a view/tabela pode ganhar coluna sem revisão do contrato.
    expect(calls.select).not.toHaveBeenCalledWith("*");
    // Escopo EXPLÍCITO, não herdado da RLS: 249/252 rodam sob service_role.
    expect(calls.eq).toHaveBeenCalledWith("loja_id", "loja-1");
  });

  it("NÃO filtra `ativo` no SQL — RN-03 é da função pura, não da query", async () => {
    const { client, calls } = makeClient({ data: [], error: null });

    await buscarCardapiosComProdutos(client, "loja-1");

    expect(calls.eq).not.toHaveBeenCalledWith("ativo", true);
  });

  it("propaga o erro (§14) em vez de devolver lista vazia", async () => {
    const { client } = makeClient({ data: null, error: { message: "boom" } });

    await expect(buscarCardapiosComProdutos(client, "loja-1")).rejects.toMatchObject({
      message: "boom",
    });
  });
});

describe("247 — buscarCardapiosComProdutos: montagem do Map", () => {
  it("indexa cada cardápio sob TODOS os produtos vinculados, preservando `ordem`", async () => {
    const { client } = makeClient({ data: [linha()], error: null });

    const { cardapios, vinculosPorProduto } = await buscarCardapiosComProdutos(
      client,
      "loja-1",
    );

    expect(cardapios).toHaveLength(1);
    expect(cardapios[0].ordem).toBe(3);
    expect(vinculosPorProduto.get("p1")?.map((v) => v.cardapio.id)).toEqual([cardapios[0].id]);
    expect(vinculosPorProduto.get("p2")?.map((v) => v.cardapio.id)).toEqual([cardapios[0].id]);
    // O embed NÃO vaza para o objeto de vigência.
    expect(Object.keys(cardapios[0])).not.toContain("cardapio_produtos");
  });

  it("dois cardápios no mesmo produto ⇒ os DOIS na lista (a união de RN-05)", async () => {
    const outro = linha({
      id: "c0000000-0000-4000-8000-000000000002",
      nome: "Inverno",
      ordem: 1,
      modo: "prazo_fixo",
      cardapio_produtos: [{ produto_id: "p1" }],
    });
    const { client } = makeClient({ data: [linha(), outro], error: null });

    const { vinculosPorProduto } = await buscarCardapiosComProdutos(client, "loja-1");

    expect(vinculosPorProduto.get("p1")?.map((v) => v.cardapio.id).sort()).toEqual(
      [
        "c0000000-0000-4000-8000-000000000001",
        "c0000000-0000-4000-8000-000000000002",
      ].sort(),
    );
  });

  it("FAIL-CLOSED (D6): linha com `modo` fora do domínio é DESCARTADA", async () => {
    // Todos os eixos NULL: se a linha sobrevivesse com um `modo` normalizado por
    // fallback, ela seria um cardápio SEMPRE ABERTO.
    const invalida = linha({
      id: "c0000000-0000-4000-8000-000000000009",
      modo: "modo_que_nao_existe",
      dias_semana: null,
      hora_inicio: null,
      hora_fim: null,
      cardapio_produtos: [{ produto_id: "p9" }],
    });
    const { client } = makeClient({ data: [linha(), invalida], error: null });

    const { cardapios, vinculosPorProduto } = await buscarCardapiosComProdutos(
      client,
      "loja-1",
    );

    expect(cardapios.map((c) => c.id)).toEqual(["c0000000-0000-4000-8000-000000000001"]);
    // E não sobra vínculo órfão apontando para a linha descartada.
    expect(vinculosPorProduto.has("p9")).toBe(false);
  });

  it("cardápio sem vínculo nenhum entra em `cardapios`, mas não no Map", async () => {
    const { client } = makeClient({
      data: [linha({ cardapio_produtos: [] })],
      error: null,
    });

    const { cardapios, vinculosPorProduto } = await buscarCardapiosComProdutos(
      client,
      "loja-1",
    );

    expect(cardapios).toHaveLength(1);
    expect(vinculosPorProduto.size).toBe(0);
  });

  it("loja SEM cardápio ⇒ lista vazia e Map vazio (100% da produção hoje)", async () => {
    const { client } = makeClient({ data: [], error: null });

    const r = await buscarCardapiosComProdutos(client, "loja-1");

    expect(r.cardapios).toEqual([]);
    expect(r.vinculosPorProduto.size).toBe(0);
  });
});

// [testar/273] Lacuna: `buscarCardapiosComProdutos` já prova que o Map carrega
// `dias_semana` do vínculo (describe "273/RN-09" abaixo), mas
// `buscarCardapiosDoPainel` — a query que ALIMENTA `/painel/cardapios` e o
// hub admin — reexporta o MESMO `vinculosPorProduto` sem teste dedicado
// nenhum: só é exercitada por um MOCK da função inteira em
// `admin/assinantes/[lojaId]/carga-cardapios.test.ts`, que nunca chama a
// implementação real. Se um refactor aqui trocasse `vinculosPorProduto` pelo
// `cardapios` (sem os dias) ou esquecesse de repassar `dias_semana`, nenhum
// teste hoje pegaria — o painel pararia de saber que a Feijoada é só de
// quarta e sábado, e a 275/276 (pílulas + aviso) leriam `undefined` em
// silêncio.
describe("273/RN-09 — buscarCardapiosDoPainel: vinculosPorProduto carrega dias_semana", () => {
  it("o índice devolvido é o VÍNCULO com dias_semana, não uma lista de cardápios crus", async () => {
    const cardapioId = "c0000000-0000-4000-8000-000000000001";
    const client = makeMultiplexClient({
      cardapios: {
        data: [
          linha({
            id: cardapioId,
            cardapio_produtos: [{ produto_id: "feijoada", dias_semana: [3, 6] }],
          }),
        ],
        error: null,
      },
      cardapio_produtos: {
        data: [
          {
            cardapio_id: cardapioId,
            produto_id: "feijoada",
            produtos: { nome: "Feijoada", visibilidade: "cardapio" },
          },
        ],
        error: null,
      },
    });

    const { vinculosPorProduto } = await buscarCardapiosDoPainel(client, "loja-1");

    const vinculos = vinculosPorProduto.get("feijoada");
    expect(vinculos).toHaveLength(1);
    expect(vinculos?.[0].dias_semana).toEqual([3, 6]);
    expect(vinculos?.[0].cardapio.id).toBe(cardapioId);
  });
});

// ═══════════════════ [269] buscarProdutosQueFicariamOrfaos / buscarLinhasDaPrevia
//
// As duas leituras que migraram de dentro de `lib/actions/cardapio.ts` para cá
// (issue 269, D3) quando o hub admin virou um SEGUNDO caminho de escrita sob
// `service_role` (BYPASSRLS). Sem teste dedicado até agora: eram exercitadas só
// por tabela via `admin-cardapios.paridade.test.ts` (mock do client inteiro,
// que não prova a FORMA exata das sub-queries) e via `cardapio.test.ts` do
// lojista. O que este bloco trava é a ÚNICA proteção que sobra sob
// service_role: o `.eq("loja_id", lojaId)` EXPLÍCITO em CADA sub-query — não a
// RLS, que a service_role ignora por completo.

type TerminalMulti = { data: unknown; error: unknown };
type ChamadaMulti = {
  tabela: string;
  colunas?: string;
  eqs: [string, unknown][];
  ins: [string, unknown][];
};

/**
 * Client multi-tabela: cada `.from(tabela)` monta um builder independente, e a
 * resposta de uma tabela é consumida NA ORDEM (fila) — necessário porque
 * `buscarProdutosQueFicariamOrfaos` chama `cardapio_produtos` DUAS vezes com
 * propósitos diferentes (vínculos do cardápio, depois vínculos de TODOS os
 * cardápios da loja).
 */
function makeMultiClient(respostasPorTabela: Record<string, TerminalMulti[]>) {
  const chamadas: ChamadaMulti[] = [];
  const contadores: Record<string, number> = {};

  const client = {
    from: (tabela: string) => {
      const chamada: ChamadaMulti = { tabela, eqs: [], ins: [] };
      chamadas.push(chamada);
      const builder: Record<string, unknown> = {};
      builder.select = (cols?: string) => {
        chamada.colunas = cols;
        return builder;
      };
      builder.eq = (c: string, v: unknown) => {
        chamada.eqs.push([c, v]);
        return builder;
      };
      builder.in = (c: string, v: unknown) => {
        chamada.ins.push([c, v]);
        return builder;
      };
      // [270] `cardapioPertenceALoja` termina em `.maybeSingle()`; os
      // terminadores continuam sendo o `then`, então estes são passthrough.
      builder.maybeSingle = () => builder;
      builder.limit = () => builder;
      builder.then = (resolve: (v: TerminalMulti) => unknown) => {
        const fila = respostasPorTabela[tabela] ?? [];
        const indice = contadores[tabela] ?? 0;
        contadores[tabela] = indice + 1;
        const terminal = fila[indice] ?? fila[fila.length - 1] ?? { data: [], error: null };
        return resolve(terminal);
      };
      return builder;
    },
  } as unknown as Client;

  return { client, chamadas };
}

describe("269 — buscarProdutosQueFicariamOrfaos: escopo por loja_id em CADA sub-query", () => {
  const LOJA = "loja-alvo-269";
  const CARDAPIO = "cardapio-1";

  it("as TRÊS sub-queries (cardapio_produtos, produtos, cardapio_produtos) recebem .eq('loja_id', LOJA)", async () => {
    const { client, chamadas } = makeMultiClient({
      cardapio_produtos: [
        { data: [{ produto_id: "p1" }], error: null }, // vinculados a este cardápio
        { data: [{ produto_id: "p1", cardapio_id: CARDAPIO }], error: null }, // todos os vínculos
      ],
      produtos: [{ data: [{ id: "p1" }], error: null }], // exclusivos
    });

    await buscarProdutosQueFicariamOrfaos(client, LOJA, CARDAPIO);

    expect(chamadas).toHaveLength(3);
    for (const chamada of chamadas) {
      expect(chamada.eqs).toContainEqual(["loja_id", LOJA]);
    }
  });

  it("produto exclusivo com ÚNICO vínculo (este cardápio) é devolvido como órfão", async () => {
    const { client } = makeMultiClient({
      cardapio_produtos: [
        { data: [{ produto_id: "p1" }], error: null },
        { data: [{ produto_id: "p1", cardapio_id: CARDAPIO }], error: null },
      ],
      produtos: [{ data: [{ id: "p1" }], error: null }],
    });

    const orfaos = await buscarProdutosQueFicariamOrfaos(client, LOJA, CARDAPIO);

    expect(orfaos).toEqual(["p1"]);
  });

  it("produto exclusivo vinculado a ESTE E A OUTRO cardápio NÃO é órfão (RN-14 exata)", async () => {
    const { client } = makeMultiClient({
      cardapio_produtos: [
        { data: [{ produto_id: "p1" }, { produto_id: "p2" }], error: null },
        {
          data: [
            { produto_id: "p1", cardapio_id: CARDAPIO },
            { produto_id: "p2", cardapio_id: CARDAPIO },
            { produto_id: "p2", cardapio_id: "outro-cardapio" }, // p2 sobrevive noutro cardápio
          ],
          error: null,
        },
      ],
      produtos: [{ data: [{ id: "p1" }, { id: "p2" }], error: null }],
    });

    const orfaos = await buscarProdutosQueFicariamOrfaos(client, LOJA, CARDAPIO);

    expect(orfaos).toEqual(["p1"]);
  });

  it("sem vínculos nenhum ⇒ [] SEM chamar produtos nem a 2ª cardapio_produtos (early return)", async () => {
    const { client, chamadas } = makeMultiClient({
      cardapio_produtos: [{ data: [], error: null }],
    });

    const orfaos = await buscarProdutosQueFicariamOrfaos(client, LOJA, CARDAPIO);

    expect(orfaos).toEqual([]);
    expect(chamadas).toHaveLength(1);
  });

  it("vínculos existem mas nenhum é exclusivo (visibilidade=menu) ⇒ [] SEM a 3ª query", async () => {
    const { client, chamadas } = makeMultiClient({
      cardapio_produtos: [{ data: [{ produto_id: "p1" }], error: null }],
      produtos: [{ data: [], error: null }], // nenhum exclusivo
    });

    const orfaos = await buscarProdutosQueFicariamOrfaos(client, LOJA, CARDAPIO);

    expect(orfaos).toEqual([]);
    expect(chamadas).toHaveLength(2);
  });

  it("propaga erro da leitura de `produtos` (§14) — nunca engole e segue com []", async () => {
    const { client } = makeMultiClient({
      cardapio_produtos: [{ data: [{ produto_id: "p1" }], error: null }],
      produtos: [{ data: null, error: { message: "boom-produtos" } }],
    });

    await expect(buscarProdutosQueFicariamOrfaos(client, LOJA, CARDAPIO)).rejects.toMatchObject({
      message: "boom-produtos",
    });
  });

  it("propaga erro da leitura de vínculos (1ª cardapio_produtos)", async () => {
    const { client } = makeMultiClient({
      cardapio_produtos: [{ data: null, error: { message: "boom-vinculos" } }],
    });

    await expect(buscarProdutosQueFicariamOrfaos(client, LOJA, CARDAPIO)).rejects.toMatchObject({
      message: "boom-vinculos",
    });
  });
});

describe("269 — buscarLinhasDaPrevia: escopo por loja_id + forma da query por tipo de lote", () => {
  const LOJA = "loja-alvo-269";

  it("escopo por produto_ids: usa .in('id', ids) + .eq('loja_id', LOJA)", async () => {
    const { client, chamadas } = makeMultiClient({
      produtos: [{ data: [{ id: "p1", nome: "X", visibilidade: "menu", oculto: false }], error: null }],
    });

    await buscarLinhasDaPrevia(client, LOJA, { produto_ids: ["p1", "p2"] });

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].eqs).toContainEqual(["loja_id", LOJA]);
    expect(chamadas[0].ins).toContainEqual(["id", ["p1", "p2"]]);
    // select nomeado com só as 4 colunas que resumirPrevia consome.
    expect(chamadas[0].colunas).toBe("id, nome, visibilidade, oculto");
  });

  it("escopo por categoria_id: usa .eq('categoria_id', …) + .eq('loja_id', LOJA), SEM .in", async () => {
    const { client, chamadas } = makeMultiClient({
      produtos: [{ data: [], error: null }],
    });

    await buscarLinhasDaPrevia(client, LOJA, { categoria_id: "cat-1" });

    expect(chamadas[0].eqs).toContainEqual(["loja_id", LOJA]);
    expect(chamadas[0].eqs).toContainEqual(["categoria_id", "cat-1"]);
    expect(chamadas[0].ins).toHaveLength(0);
  });

  it("produto_ids vazio: ainda chama .in('id', []) — não é tratado como 'sem filtro'", async () => {
    const { client, chamadas } = makeMultiClient({ produtos: [{ data: [], error: null }] });

    await buscarLinhasDaPrevia(client, LOJA, { produto_ids: [] });

    expect(chamadas[0].ins).toContainEqual(["id", []]);
  });

  it("data null ⇒ [] (nunca lança por linha ausente)", async () => {
    const { client } = makeMultiClient({ produtos: [{ data: null, error: null }] });

    const linhas = await buscarLinhasDaPrevia(client, LOJA, { categoria_id: "cat-1" });

    expect(linhas).toEqual([]);
  });

  it("propaga erro (§14) em vez de devolver [] silenciosamente", async () => {
    const { client } = makeMultiClient({
      produtos: [{ data: null, error: { message: "boom-previa" } }],
    });

    await expect(
      buscarLinhasDaPrevia(client, LOJA, { categoria_id: "cat-1" }),
    ).rejects.toMatchObject({ message: "boom-previa" });
  });
});

describe("247 — nenhum `as CardapioVigencia` no projeto (R3)", () => {
  it("o estreitamento vive em `vigenciaCardapio.ts`, não em cast no call-site", async () => {
    const { execSync } = await import("node:child_process");
    const saida = execSync(
      // Só código de PRODUÇÃO: um `as` dentro de um teste é andaime, não o
      // estreitamento divergente que R3 proíbe.
      'grep -rn "as CardapioVigencia" src/ --include=*.ts --include=*.tsx | grep -v "\\.test\\." || true',
      { encoding: "utf8" },
    ).trim();
    expect(saida).toBe("");
  });
});

// ═══════════════ [270] cardapioPertenceALoja — a prova de POSSE do cardápio ══
//
// Fase RED da issue 270. A brecha: `ON CONFLICT (cardapio_id, produto_id) DO
// NOTHING` descarta a linha ANTES de a FK composta `(cardapio_id, loja_id)` ser
// avaliada, então um cardápio de OUTRA loja cujos pares já existem lá faz o
// upsert terminar sem erro — sucesso reportado por escrita que não aconteceu, e
// (no admin) uma linha de `admin_acessos` apontando para entidade alheia.
//
// A camada que falta é esta leitura: UM id de cardápio, na loja-alvo, com
// `.eq("loja_id")` EXPLÍCITO — o que a torna válida sob `service_role`
// (BYPASSRLS), onde a RLS não vale. Não é o pre-check que a 251 proibiu: aquele
// era da LISTA DE PRODUTOS, e a diferença entre pedido e gravado denunciaria
// quais ids existem em outra loja. Aqui alheio e inexistente saem pela MESMA
// resposta (`false`), então não há oráculo.
//
// Import DINÂMICO por caminho em variável: o símbolo nasce na fase GREEN. Um
// `import` estático mataria o arquivo inteiro na coleta e quebraria
// `npx tsc --noEmit` durante toda a fase RED.

type CardapioPertenceALoja = (
  client: Client,
  lojaId: string,
  cardapioId: string,
) => Promise<boolean>;

const MODULO_QUERIES = "./cardapios";

async function pertence(): Promise<CardapioPertenceALoja> {
  const mod = (await import(/* @vite-ignore */ MODULO_QUERIES)) as Record<string, unknown>;
  const fn = mod.cardapioPertenceALoja;
  if (typeof fn !== "function") {
    throw new Error(
      "[RED 270] `cardapioPertenceALoja` ainda não é exportada de " +
        "`src/lib/supabase/queries/cardapios.ts` — é a fase GREEN da issue 270. " +
        "Contrato: (client, lojaId, cardapioId) => Promise<boolean>, " +
        '`select("id")` + `.eq("loja_id", lojaId)` + `.eq("id", cardapioId)` + `.maybeSingle()`.',
    );
  }
  return fn as CardapioPertenceALoja;
}

describe("270 — cardapioPertenceALoja: forma da query", () => {
  const LOJA = "loja-alvo-270";
  const CARDAPIO = "cardapio-proprio-270";

  it("lê `cardapios` com select estreito e escopo EXPLÍCITO por loja_id + id", async () => {
    const fn = await pertence();
    const { client, chamadas } = makeMultiClient({
      cardapios: [{ data: { id: CARDAPIO }, error: null }],
    });

    await fn(client, LOJA, CARDAPIO);

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].tabela).toBe("cardapios");
    // Um booleano não precisa de 10 colunas: `select("id")`, nunca `select("*")`.
    expect(chamadas[0].colunas).toBe("id");
    expect(chamadas[0].eqs).toContainEqual(["loja_id", LOJA]);
    expect(chamadas[0].eqs).toContainEqual(["id", CARDAPIO]);
  });

  it("cardápio da PRÓPRIA loja ⇒ true", async () => {
    const fn = await pertence();
    const { client } = makeMultiClient({
      cardapios: [{ data: { id: CARDAPIO }, error: null }],
    });

    await expect(fn(client, LOJA, CARDAPIO)).resolves.toBe(true);
  });

  it("cardápio de OUTRA loja e cardápio INEXISTENTE devolvem o MESMO `false` — sem oráculo", async () => {
    const fn = await pertence();
    // O `.eq("loja_id", LOJA)` faz o id alheio simplesmente NÃO voltar; é
    // exatamente o que acontece com um id que não existe em lugar nenhum.
    const alheio = makeMultiClient({ cardapios: [{ data: null, error: null }] });
    const inexistente = makeMultiClient({ cardapios: [{ data: null, error: null }] });

    const rAlheio = await fn(alheio.client, LOJA, "cardapio-da-loja-b");
    const rInexistente = await fn(inexistente.client, LOJA, "cardapio-que-nao-existe");

    expect(rAlheio).toBe(false);
    expect(rInexistente).toBe(false);
    expect(rAlheio).toEqual(rInexistente);
    // E a FORMA da ida ao banco é idêntica nos dois: nem o número de round
    // trips diferencia alheio de inexistente.
    expect(alheio.chamadas).toHaveLength(inexistente.chamadas.length);
  });

  it("erro do banco é PROPAGADO (§14) — nunca vira `false` silencioso nem `true`", async () => {
    const fn = await pertence();
    const { client } = makeMultiClient({
      cardapios: [{ data: null, error: { code: "57014", message: "boom-posse" } }],
    });

    // Propagar é o que deixa a Server Action cair no `catch` e responder a
    // mensagem genérica (fail-closed). Devolver `false` seria a mesma recusa,
    // mas apagaria a causa do log do servidor.
    await expect(fn(client, LOJA, CARDAPIO)).rejects.toMatchObject({
      message: "boom-posse",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// [273] RED — a query passa a produzir VÍNCULOS, não cardápios.
//
// Autoridade: specs/vigencia-por-item-do-cardapio.md RN-09 (mudança de
// contrato de dados) e §Contrato de dados em TypeScript.
//
// ⚠️ SEAM 273 → GREEN. O contrato que este RED impõe:
//   1. `COLUNAS_CARDAPIO_VIGENCIA` embute `cardapio_produtos(produto_id, dias_semana)`
//      — UMA coluna escalar a mais no embed que já existe: nenhuma ida nova ao banco;
//   2. `buscarCardapiosComProdutos` devolve
//      `{ cardapios, vinculosPorProduto: Map<string, VinculoVigencia<CardapioDaLoja>[]> }`,
//      com o índice legado por CARDÁPIO removido (gate: `grep -rn` do nome antigo vazio);
//   3. `dias_semana` do embed NÃO é saneado aqui: `itemAberto` trata `null` e `[]`
//      igual e o CHECK `cardapio_produtos_dias_semana_dominio` (272) é o backstop.
//
// O resultado é lido por um cast local: o tipo de retorno de produção ainda não
// tem `vinculosPorProduto`, e desestruturar direto deixaria `tsc` vermelho.
// ═══════════════════════════════════════════════════════════════════════════

type VinculoLido = { cardapio: { id: string; ordem: number }; dias_semana: number[] | null };
type RetornoComVinculos = {
  cardapios: { id: string; ordem: number }[];
  vinculosPorProduto: Map<string, VinculoLido[]>;
};

async function comVinculos(client: Client, lojaId: string): Promise<RetornoComVinculos> {
  const r = (await buscarCardapiosComProdutos(client, lojaId)) as unknown as Record<string, unknown>;
  const indice = r.vinculosPorProduto;
  if (!(indice instanceof Map)) {
    throw new Error(
      "[RED 273] `buscarCardapiosComProdutos` ainda devolve o índice legado por " +
        "CARDÁPIO — " +
        "é a fase GREEN da issue 273. Contrato: `{ cardapios: CardapioDaLoja[]; " +
        "vinculosPorProduto: Map<string, VinculoVigencia<CardapioDaLoja>[]> }`, " +
        "cada vínculo `{ cardapio, dias_semana }` montado a partir do embed " +
        "`cardapio_produtos(produto_id, dias_semana)`.",
    );
  }
  return r as unknown as RetornoComVinculos;
}

describe("273/RN-09 — o embed carrega `dias_semana` do vínculo", () => {
  it("`COLUNAS_CARDAPIO_VIGENCIA` pede `cardapio_produtos(produto_id, dias_semana)`", () => {
    // Sem a coluna no select, a coluna que a 272 criou não tem por onde chegar
    // a quem decide a venda — e o motor venderia o prato fora do dia.
    expect(COLUNAS_CARDAPIO_VIGENCIA).toContain("cardapio_produtos(produto_id, dias_semana)");
    // E continua sendo UM round trip: nenhum segundo `from("cardapio_produtos")`.
    expect(COLUNAS_CARDAPIO_VIGENCIA).not.toContain("*");
  });

  it("indexa VÍNCULOS por produto, cada um com os dias do ITEM", async () => {
    const { client } = makeClient({
      data: [
        linha({
          cardapio_produtos: [
            { produto_id: "feijoada", dias_semana: [3, 6] },
            { produto_id: "virado", dias_semana: [1] },
            { produto_id: "coca", dias_semana: null },
          ],
        }),
      ],
      error: null,
    });

    const { cardapios, vinculosPorProduto } = await comVinculos(client, "loja-1");

    expect(vinculosPorProduto.get("feijoada")?.[0].dias_semana).toEqual([3, 6]);
    expect(vinculosPorProduto.get("virado")?.[0].dias_semana).toEqual([1]);
    // NULL chega NULL: `itemAberto` é quem lê "vazio = todos os dias do cardápio".
    expect(vinculosPorProduto.get("coca")?.[0].dias_semana).toBeNull();
    // O cardápio continua inteiro dentro do vínculo, com `ordem` preservada.
    expect(vinculosPorProduto.get("feijoada")?.[0].cardapio.id).toBe(cardapios[0].id);
    expect(vinculosPorProduto.get("feijoada")?.[0].cardapio.ordem).toBe(3);
  });

  it("o MESMO produto em dois cardápios vira DOIS vínculos, com dias diferentes", async () => {
    const { client } = makeClient({
      data: [
        linha({
          id: "c0000000-0000-4000-8000-00000000000a",
          cardapio_produtos: [{ produto_id: "feijoada", dias_semana: [3] }],
        }),
        linha({
          id: "c0000000-0000-4000-8000-00000000000b",
          nome: "Especiais do Dia",
          cardapio_produtos: [{ produto_id: "feijoada", dias_semana: [6] }],
        }),
      ],
      error: null,
    });

    const { vinculosPorProduto } = await comVinculos(client, "loja-1");
    const vinculos = vinculosPorProduto.get("feijoada") ?? [];

    // Duas agendas independentes: é a união de RN-02 que as combina, não a query.
    expect(vinculos).toHaveLength(2);
    expect(vinculos.map((v) => v.dias_semana)).toEqual([[3], [6]]);
    expect(new Set(vinculos.map((v) => v.cardapio.id)).size).toBe(2);
  });

  it("linha com `modo` fora do domínio é descartada — e os VÍNCULOS dela também (D6)", async () => {
    const { client } = makeClient({
      data: [
        linha({
          modo: "modo_do_futuro",
          cardapio_produtos: [{ produto_id: "orfao", dias_semana: [3] }],
        }),
      ],
      error: null,
    });

    const { cardapios, vinculosPorProduto } = await comVinculos(client, "loja-1");

    expect(cardapios).toHaveLength(0);
    expect(vinculosPorProduto.has("orfao")).toBe(false);
  });
});

describe("271 — buscarCardapioPorId: id malformado é fail-closed", () => {
  const LOJA = "5ec21485-e58a-4071-a41c-f8963076ae00";

  it('id "abc" ⇒ null SEM tocar o banco (nenhum `.from()`)', async () => {
    const { client, calls } = makeClient({ data: { id: "x" }, error: null });
    await expect(buscarCardapioPorId(client, LOJA, "abc")).resolves.toBeNull();
    expect(calls.from).not.toHaveBeenCalled();
  });

  it("id vazio e id com espaço também não chegam ao banco", async () => {
    const { client, calls } = makeClient({ data: null, error: null });
    await buscarCardapioPorId(client, LOJA, "");
    await buscarCardapioPorId(client, LOJA, " 5ec21485-e58a-4071-a41c-f8963076ae00");
    expect(calls.from).not.toHaveBeenCalled();
  });

  it("uuid válido segue ao banco escopado por loja_id e id", async () => {
    const { client, calls } = makeClient({ data: null, error: null });
    const ID = "a1b2c3d4-0000-4000-8000-000000000001";
    await expect(buscarCardapioPorId(client, LOJA, ID)).resolves.toBeNull();
    expect(calls.from).toHaveBeenCalledWith("cardapios");
    expect(calls.eq.mock.calls).toEqual([
      ["loja_id", LOJA],
      ["id", ID],
    ]);
  });
});
