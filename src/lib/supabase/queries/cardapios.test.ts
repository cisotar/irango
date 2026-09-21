import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

import {
  buscarCardapiosComProdutos,
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
  builder.then = (resolve: (v: Terminal) => unknown) => resolve(terminal);

  const client = {
    from: (rel: string) => {
      calls.from(rel);
      return builder as never;
    },
  } as unknown as Client;

  return { client, calls };
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

    const { cardapios, cardapiosPorProduto } = await buscarCardapiosComProdutos(
      client,
      "loja-1",
    );

    expect(cardapios).toHaveLength(1);
    expect(cardapios[0].ordem).toBe(3);
    expect(cardapiosPorProduto.get("p1")?.map((c) => c.id)).toEqual([cardapios[0].id]);
    expect(cardapiosPorProduto.get("p2")?.map((c) => c.id)).toEqual([cardapios[0].id]);
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

    const { cardapiosPorProduto } = await buscarCardapiosComProdutos(client, "loja-1");

    expect(cardapiosPorProduto.get("p1")?.map((c) => c.id).sort()).toEqual(
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

    const { cardapios, cardapiosPorProduto } = await buscarCardapiosComProdutos(
      client,
      "loja-1",
    );

    expect(cardapios.map((c) => c.id)).toEqual(["c0000000-0000-4000-8000-000000000001"]);
    // E não sobra vínculo órfão apontando para a linha descartada.
    expect(cardapiosPorProduto.has("p9")).toBe(false);
  });

  it("cardápio sem vínculo nenhum entra em `cardapios`, mas não no Map", async () => {
    const { client } = makeClient({
      data: [linha({ cardapio_produtos: [] })],
      error: null,
    });

    const { cardapios, cardapiosPorProduto } = await buscarCardapiosComProdutos(
      client,
      "loja-1",
    );

    expect(cardapios).toHaveLength(1);
    expect(cardapiosPorProduto.size).toBe(0);
  });

  it("loja SEM cardápio ⇒ lista vazia e Map vazio (100% da produção hoje)", async () => {
    const { client } = makeClient({ data: [], error: null });

    const r = await buscarCardapiosComProdutos(client, "loja-1");

    expect(r.cardapios).toEqual([]);
    expect(r.cardapiosPorProduto.size).toBe(0);
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
