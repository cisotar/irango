import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  buscarCatalogoPublico,
  buscarProdutosDoLojista,
  buscarProdutosPorIds,
  buscarOpcionaisPorCategoria,
  // RED (issue 132): variante escopada por loja — AINDA NÃO EXISTE em ./produtos.
  // O import resolve para `undefined` (esbuild não faz type-check); a chamada
  // cai em `TypeError: ... is not a function` — vermelho por asserção, não por
  // erro de compilação que mascararia o resto da suite. Implementação é da GREEN.
  buscarOpcionaisPorCategoriaDaLoja,
  // issue 207: `buscarCatalogoPublico` foi quebrada em fetch (`buscarProdutosPublicos`)
  // + agrupamento puro (`agruparCatalogo`) para permitir Promise.all na vitrine.
  agruparCatalogo,
  buscarProdutosPublicos,
} from "./produtos";

/**
 * Fase RED (TDD) da issue 024 — Queries de `produtos` (camada 2: contrato TS).
 *
 * Importa de `./produtos`, que AINDA NÃO EXISTE — a suite cai vermelha no import.
 * STUB MÍNIMO de assinatura criado em `./produtos.ts` (`throw new Error('TODO: GREEN')`)
 * para que o RED caia na ASSERÇÃO e não num erro de type-check que mascara tudo.
 * A implementação real é da fase GREEN.
 *
 * Contrato que a GREEN precisa satisfazer (ATUALIZADO na issue 086):
 *  - buscarCatalogoPublico: fonte TABELA `produtos`, filtra `loja_id` + `oculto = false`
 *    (defesa em profundidade sobre a RLS produtos_leitura_publica da 083 — o filtro
 *    explícito é a 2ª camada; NÃO substitui a RLS). NÃO filtra mais `disponivel = true`:
 *    produto não-oculto indisponível (esgotado) PASSA a aparecer na vitrine (RN-3/RN-4).
 *    Ordena por `ordem`, e AGRUPA por categoria com produtos sem categoria caindo num
 *    grupo "Outros" no FIM (critério de aceite). O `select("*")` já traz `disponivel`
 *    e `oculto` — a vitrine usa `disponivel` para renderizar o estado "esgotado".
 *  - buscarProdutosDoLojista: fonte TABELA `produtos`, filtra `loja_id`, traz categoria
 *    ANINHADA (select com join `categorias(...)`), inclui indisponíveis (sem filtro
 *    `disponivel`), ordena por `ordem`.
 *  - buscarProdutosPorIds: insumo do recálculo autoritativo (seguranca.md §10) — filtra
 *    por lista de ids (`in`), retorna preco/disponivel/loja_id REAIS. SEM filtro
 *    `disponivel` (o recálculo precisa enxergar item indisponível para RECUSÁ-LO).
 *  - todas: retornam []/agrupamento vazio em "sem linha", PROPAGAM error (§14).
 */

type Client = SupabaseClient<Database>;

type Terminal = { data: unknown; error: unknown };

function makeClient(terminal: Terminal) {
  const calls = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
  };

  const builder: Record<string, unknown> = {};

  builder.select = (...args: unknown[]) => {
    calls.select(...args);
    return builder;
  };
  builder.eq = (...args: unknown[]) => {
    calls.eq(...args);
    return builder;
  };
  builder.in = (...args: unknown[]) => {
    calls.in(...args);
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

// ───────────────────────── buscarCatalogoPublico
/**
 * 265: a lista EXATA de colunas da projeção pública (§Contratos de Dados da
 * issue). O select passa a ser NOMEADO — `select("*")` numa view definer volta a
 * vazar toda coluna que a 244/245 acrescentarem sem revisão do contrato TS.
 */
const COLUNAS_PRODUTO_PUBLICO =
  "id, loja_id, categoria_id, nome, descricao, preco, disponivel, ordem, foto_url, " +
  "desconto_ativo, desconto_tipo, desconto_valor, desconto_inicio, desconto_fim";

describe("024 buscarCatalogoPublico — contrato TS (camada 2, mock)", () => {
  it("consulta a VIEW vitrine_produtos filtrando por loja_id, ordenado por ordem — 265", async () => {
    const { client, calls } = makeClient({ data: [], error: null });

    await buscarCatalogoPublico(client, "loja-1");

    // MUDANÇA DE CONTRATO (265 · [1]/[2a]): a tabela base perde o SELECT público
    // (`drop policy produtos_leitura_publica`), então ler `produtos` como
    // anon/authenticated devolveria 0 linhas — catálogo vazio, SEM erro.
    expect(calls.from).toHaveBeenCalledWith("vitrine_produtos");
    expect(calls.from).not.toHaveBeenCalledWith("produtos");
    expect(calls.select).toHaveBeenCalledWith(COLUNAS_PRODUTO_PUBLICO);
    expect(calls.eq).toHaveBeenCalledWith("loja_id", "loja-1");
    expect(calls.order).toHaveBeenCalledWith("ordem", { ascending: true });
  });

  it("NÃO filtra mais por oculto=false — a view não projeta a coluna (265 · D6)", async () => {
    const { client, calls } = makeClient({ data: [], error: null });

    await buscarCatalogoPublico(client, "loja-1");

    // `oculto` está AUSENTE da projeção: filtrar por ela pelo PostgREST daria
    // 42703 em runtime. O filtro vive no WHERE da view.
    expect(calls.eq).not.toHaveBeenCalledWith("oculto", false);
  });

  it("NÃO filtra por disponivel=true — esgotado não-oculto entra no catálogo (RN-3, RN-4)", async () => {
    const { client, calls } = makeClient({ data: [], error: null });

    await buscarCatalogoPublico(client, "loja-1");

    // A vitrine mostra "esgotado"; filtrar disponivel esconderia o produto (regressão).
    expect(calls.eq).not.toHaveBeenCalledWith("disponivel", true);
  });

  it("NÃO usa select('*') na view — o contrato de colunas é explícito (265 · D4)", async () => {
    const { client, calls } = makeClient({ data: [], error: null });

    await buscarCatalogoPublico(client, "loja-1");

    expect(calls.select).not.toHaveBeenCalledWith("*");
  });

  it("agrupa produtos por categoria e mantém a ordem das categorias", async () => {
    const produtos = [
      { id: "p1", loja_id: "loja-1", categoria_id: "cat-bebidas", nome: "Coca", preco: 5, disponivel: true, ordem: 0 },
      { id: "p2", loja_id: "loja-1", categoria_id: "cat-bebidas", nome: "Suco", preco: 7, disponivel: true, ordem: 1 },
      { id: "p3", loja_id: "loja-1", categoria_id: "cat-lanches", nome: "X-Burguer", preco: 20, disponivel: true, ordem: 0 },
    ];
    // Categorias do lojista, na ordem definida.
    const categorias = [
      { id: "cat-lanches", loja_id: "loja-1", nome: "Lanches", ordem: 0, criado_em: "2026-01-01T00:00:00Z", exibir_imagens: true },
      { id: "cat-bebidas", loja_id: "loja-1", nome: "Bebidas", ordem: 1, criado_em: "2026-01-01T00:00:00Z", exibir_imagens: true },
    ];
    const { client } = makeClient({ data: produtos, error: null });

    const grupos = await buscarCatalogoPublico(client, "loja-1", categorias);

    // Espera-se uma estrutura agrupada e ordenada pela ordem das categorias.
    expect(grupos.map((g) => g.categoria?.nome ?? g.nome)).toEqual(["Lanches", "Bebidas"]);
    const lanches = grupos.find((g) => (g.categoria?.id ?? g.id) === "cat-lanches")!;
    const bebidas = grupos.find((g) => (g.categoria?.id ?? g.id) === "cat-bebidas")!;
    expect(lanches.produtos.map((p) => p.id)).toEqual(["p3"]);
    expect(bebidas.produtos.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it('produtos SEM categoria caem no grupo "Outros" e ele fica POR ÚLTIMO', async () => {
    const produtos = [
      { id: "p1", loja_id: "loja-1", categoria_id: "cat-bebidas", nome: "Coca", preco: 5, disponivel: true, ordem: 0 },
      { id: "p9", loja_id: "loja-1", categoria_id: null, nome: "Brinde", preco: 0, disponivel: true, ordem: 0 },
    ];
    const categorias = [{ id: "cat-bebidas", loja_id: "loja-1", nome: "Bebidas", ordem: 0, criado_em: "2026-01-01T00:00:00Z", exibir_imagens: true }];
    const { client } = makeClient({ data: produtos, error: null });

    const grupos = await buscarCatalogoPublico(client, "loja-1", categorias);

    const ultimo = grupos[grupos.length - 1];
    expect(ultimo.nome ?? ultimo.categoria?.nome).toBe("Outros");
    expect(ultimo.produtos.map((p) => p.id)).toEqual(["p9"]);
  });

  it("177 — categoria SEM nenhum produto não vira grupo (cabeçalho solto na vitrine)", async () => {
    const produtos = [
      { id: "p1", loja_id: "loja-1", categoria_id: "cat-lanches", nome: "X-Burguer", preco: 20, disponivel: true, ordem: 0 },
    ];
    const categorias = [
      { id: "cat-vazia", loja_id: "loja-1", nome: "Vazia", ordem: 0, criado_em: "2026-01-01T00:00:00Z", exibir_imagens: true },
      { id: "cat-lanches", loja_id: "loja-1", nome: "Lanches", ordem: 1, criado_em: "2026-01-01T00:00:00Z", exibir_imagens: true },
    ];
    const { client } = makeClient({ data: produtos, error: null });

    const grupos = await buscarCatalogoPublico(client, "loja-1", categorias);

    expect(grupos.map((g) => g.nome)).toEqual(["Lanches"]);
  });

  it("177 — categoria só com produto OCULTO some (o oculto nem chega do PostgREST)", async () => {
    // `.eq("oculto", false)` já filtra na query: a categoria fica sem produto.
    const categorias = [
      { id: "cat-so-oculto", loja_id: "loja-1", nome: "Só oculto", ordem: 0, criado_em: "2026-01-01T00:00:00Z", exibir_imagens: true },
    ];
    const { client } = makeClient({ data: [], error: null });

    const grupos = await buscarCatalogoPublico(client, "loja-1", categorias);

    expect(grupos).toEqual([]);
  });

  it("177 — categoria só com produto ESGOTADO CONTINUA aparecendo", async () => {
    const produtos = [
      { id: "p2", loja_id: "loja-1", categoria_id: "cat-bebidas", nome: "Suco", preco: 7, disponivel: false, ordem: 0 },
    ];
    const categorias = [
      { id: "cat-bebidas", loja_id: "loja-1", nome: "Bebidas", ordem: 0, criado_em: "2026-01-01T00:00:00Z", exibir_imagens: true },
    ];
    const { client } = makeClient({ data: produtos, error: null });

    const grupos = await buscarCatalogoPublico(client, "loja-1", categorias);

    expect(grupos.map((g) => g.nome)).toEqual(["Bebidas"]);
    expect(grupos[0].produtos.map((p) => p.disponivel)).toEqual([false]);
  });

  it("PROPAGA o error do PostgREST (não mascara como agrupamento vazio)", async () => {
    const { client } = makeClient({ data: null, error: { message: "db down" } });
    await expect(buscarCatalogoPublico(client, "loja-1")).rejects.toBeTruthy();
  });

  it("preserva `disponivel` por item ao agrupar catálogo misto (086 — anti-regressão de esgotado)", async () => {
    // Mesmo grupo (Bebidas) com produto disponível e produto esgotado juntos.
    // O agrupamento por categoria não pode "achatar" ou perder o campo
    // `disponivel` de cada item — é o dado que a vitrine usa para renderizar
    // o ribbon "Esgotado" por CARD, não por grupo.
    const produtos = [
      { id: "p1", loja_id: "loja-1", categoria_id: "cat-bebidas", nome: "Coca", preco: 5, disponivel: true, ordem: 0 },
      { id: "p2", loja_id: "loja-1", categoria_id: "cat-bebidas", nome: "Suco Esgotado", preco: 7, disponivel: false, ordem: 1 },
      { id: "p3", loja_id: "loja-1", categoria_id: "cat-bebidas", nome: "Água", preco: 3, disponivel: true, ordem: 2 },
    ];
    const categorias = [
      { id: "cat-bebidas", loja_id: "loja-1", nome: "Bebidas", ordem: 0, criado_em: "2026-01-01T00:00:00Z", exibir_imagens: true },
    ];
    const { client } = makeClient({ data: produtos, error: null });

    const grupos = await buscarCatalogoPublico(client, "loja-1", categorias);

    const bebidas = grupos.find((g) => (g.categoria?.id ?? g.id) === "cat-bebidas")!;
    // Todos os 3 permanecem no MESMO grupo (esgotado não é removido nem isolado).
    expect(bebidas.produtos.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    // O campo `disponivel` de CADA item é preservado individualmente.
    expect(bebidas.produtos.map((p) => p.disponivel)).toEqual([true, false, true]);
  });
});

// ───────────────────────── buscarProdutosDoLojista
describe("024 buscarProdutosDoLojista — contrato TS (camada 2, mock)", () => {
  it("consulta a TABELA produtos, filtra por loja_id e traz a categoria ANINHADA no select", async () => {
    const rows = [
      { id: "p1", loja_id: "loja-1", nome: "Coca", disponivel: false, ordem: 0, categorias: { id: "c1", nome: "Bebidas" } },
    ];
    const { client, calls } = makeClient({ data: rows, error: null });

    const out = await buscarProdutosDoLojista(client, "loja-1");

    expect(calls.from).toHaveBeenCalledWith("produtos");
    expect(calls.eq).toHaveBeenCalledWith("loja_id", "loja-1");
    // O select precisa pedir a categoria aninhada (join PostgREST).
    const selectArg = String(calls.select.mock.calls[0]?.[0] ?? "");
    expect(selectArg).toContain("categorias");
    expect(out).toEqual(rows);
  });

  it("inclui produtos INDISPONÍVEIS (NÃO filtra disponivel)", async () => {
    const { client, calls } = makeClient({ data: [], error: null });
    await buscarProdutosDoLojista(client, "loja-1");
    expect(calls.eq).not.toHaveBeenCalledWith("disponivel", true);
  });

  it("ordena por `ordem` ascendente", async () => {
    const { client, calls } = makeClient({ data: [], error: null });
    await buscarProdutosDoLojista(client, "loja-1");
    expect(calls.order).toHaveBeenCalledWith("ordem", { ascending: true });
  });

  it("PROPAGA o error do PostgREST", async () => {
    const { client } = makeClient({ data: null, error: { message: "rls denied" } });
    await expect(buscarProdutosDoLojista(client, "loja-1")).rejects.toBeTruthy();
  });
});

// ───────────────────────── buscarProdutosPorIds (insumo do recálculo §10)
describe("024 buscarProdutosPorIds — contrato TS (camada 2, mock)", () => {
  it("filtra por lista de ids (in) e retorna preco/disponivel/loja_id reais", async () => {
    const rows = [
      { id: "p1", loja_id: "loja-1", preco: 12.5, disponivel: true },
      { id: "p2", loja_id: "loja-1", preco: 8, disponivel: false },
    ];
    const { client, calls } = makeClient({ data: rows, error: null });

    const out = await buscarProdutosPorIds(client, ["p1", "p2"]);

    expect(calls.from).toHaveBeenCalledWith("produtos");
    expect(calls.in).toHaveBeenCalledWith("id", ["p1", "p2"]);
    expect(out).toEqual(rows);
  });

  it("NÃO filtra por disponivel (recálculo precisa ver indisponível para recusá-lo)", async () => {
    const { client, calls } = makeClient({ data: [], error: null });
    await buscarProdutosPorIds(client, ["p1"]);
    expect(calls.eq).not.toHaveBeenCalledWith("disponivel", true);
  });

  it("retorna [] quando recebe lista de ids vazia (não consulta o banco)", async () => {
    const { client, calls } = makeClient({ data: [], error: null });
    const out = await buscarProdutosPorIds(client, []);
    expect(out).toEqual([]);
    expect(calls.from).not.toHaveBeenCalled();
  });

  it("PROPAGA o error do PostgREST (não mascara como [])", async () => {
    const { client } = makeClient({ data: null, error: { message: "boom" } });
    await expect(buscarProdutosPorIds(client, ["p1"])).rejects.toBeTruthy();
  });
});

// ───────────────────────── buscarOpcionaisPorCategoria (issue 081 — vitrine SSR)
/**
 * Contrato que a GREEN precisa satisfazer (issue 081):
 *  - fonte: TABELA `categoria_produto_opcionais`, filtrada por `categoria_id IN (...)`,
 *    com `opcionais_categorias` e seus `opcionais` ANINHADOS no select (join PostgREST);
 *  - a SEGURANÇA é 100% da RLS pública da 080 (loja ativa + ativo=true) — a função
 *    NÃO reimplementa filtro de loja/ativo, só JOIN + agrupamento;
 *  - retorna, por `categoria_id` do produto, grupos de opcional ordenados por `ordem`
 *    com itens ordenados por `ordem`;
 *  - categoria sem associação (ou lista vazia de ids) → mapa sem aquela chave / vazio;
 *  - PROPAGA error (§14). Nenhum preço calculado — só dados de exibição.
 */
describe("081 buscarOpcionaisPorCategoria — contrato TS (camada 2, mock)", () => {
  // Linhas como o PostgREST devolveria: cada associação traz a categoria de opcional
  // aninhada e, dentro dela, os opcionais (já filtrados pela RLS pública).
  function linhasAssoc() {
    return [
      {
        categoria_id: "cat-paes",
        // `ordem` na RAIZ = categoria_produto_opcionais.ordem (208/210), a autoridade.
        ordem: 1,
        opcionais_categorias: {
          id: "oc-laticinios",
          nome: "Laticínios",
          ordem: 1,
          opcionais: [
            { id: "o-catupiry", nome: "Catupiry", preco: 5, ordem: 1 },
            { id: "o-brie", nome: "Brie extra", preco: 8, ordem: 0 },
          ],
        },
      },
      {
        categoria_id: "cat-paes",
        ordem: 0,
        opcionais_categorias: {
          id: "oc-doces",
          nome: "Doces",
          ordem: 0,
          opcionais: [{ id: "o-doce", nome: "Doce de leite", preco: 4, ordem: 0 }],
        },
      },
    ];
  }

  it("consulta categoria_produto_opcionais filtrando categoria_id IN (...) com opcionais aninhados", async () => {
    const { client, calls } = makeClient({ data: linhasAssoc(), error: null });

    await buscarOpcionaisPorCategoria(client, ["cat-paes"]);

    expect(calls.from).toHaveBeenCalledWith("categoria_produto_opcionais");
    expect(calls.in).toHaveBeenCalledWith("categoria_id", ["cat-paes"]);
    const selectArg = String(calls.select.mock.calls[0]?.[0] ?? "");
    expect(selectArg).toContain("opcionais_categorias");
    expect(selectArg).toContain("opcionais");
  });

  it("agrupa por categoria de opcional e ordena grupos por `ordem` e itens por `ordem`", async () => {
    const { client } = makeClient({ data: linhasAssoc(), error: null });

    const mapa = await buscarOpcionaisPorCategoria(client, ["cat-paes"]);
    const grupos = mapa["cat-paes"];

    // Grupos ordenados por ordem: Doces (0) antes de Laticínios (1).
    expect(grupos.map((g) => g.categoriaOpcionalNome)).toEqual(["Doces", "Laticínios"]);
    // Itens de Laticínios ordenados por ordem: Brie (0) antes de Catupiry (1).
    const latic = grupos.find((g) => g.categoriaOpcionalId === "oc-laticinios")!;
    expect(latic.opcionais.map((o) => o.id)).toEqual(["o-brie", "o-catupiry"]);
    // Estrutura de item: id/nome/preco/ordem (dados de exibição, nenhum cálculo).
    expect(latic.opcionais[0]).toEqual({ id: "o-brie", nome: "Brie extra", preco: 8, ordem: 0 });
  });

  it("DESEMPATA itens de MESMA `ordem` por `id` — saída idêntica em qualquer ordem de entrada (216)", async () => {
    // `opcionais.ordem` é `int not null default 0`: toda linha anterior à 215
    // empata em 0. Sem desempate, a vitrine e o painel poderiam listá-las em
    // ordens diferentes e o primeiro movimento na sanfona (216) gravaria uma
    // permutação que ninguém pediu.
    function linhas(itens: { id: string; nome: string; preco: number; ordem: number }[]) {
      return [
        {
          categoria_id: "cat-paes",
          ordem: 0,
          opcionais_categorias: {
            id: "oc-legado",
            nome: "Legado",
            ordem: 0,
            opcionais: itens,
          },
        },
      ];
    }
    const a = { id: "o-aaa", nome: "Azeitona", preco: 1, ordem: 0 };
    const b = { id: "o-bbb", nome: "Bacon", preco: 2, ordem: 0 };

    const um = makeClient({ data: linhas([a, b]), error: null });
    const outro = makeClient({ data: linhas([b, a]), error: null });

    const mapaUm = await buscarOpcionaisPorCategoria(um.client, ["cat-paes"]);
    const mapaOutro = await buscarOpcionaisPorCategoria(outro.client, ["cat-paes"]);

    expect(mapaUm["cat-paes"][0].opcionais.map((o) => o.id)).toEqual([
      "o-aaa",
      "o-bbb",
    ]);
    expect(mapaOutro["cat-paes"][0].opcionais.map((o) => o.id)).toEqual([
      "o-aaa",
      "o-bbb",
    ]);
  });

  it("categoria SEM associação não aparece no mapa (ou mapa vazio)", async () => {
    const { client } = makeClient({ data: [], error: null });
    const mapa = await buscarOpcionaisPorCategoria(client, ["cat-bebidas"]);
    expect(mapa["cat-bebidas"] ?? []).toEqual([]);
  });

  it("lista de categorias vazia → mapa vazio, sem consultar o banco", async () => {
    const { client, calls } = makeClient({ data: [], error: null });
    const mapa = await buscarOpcionaisPorCategoria(client, []);
    expect(mapa).toEqual({});
    expect(calls.from).not.toHaveBeenCalled();
  });

  it("ignora grupo sem opcionais visíveis (RLS escondeu todos / categoria vazia)", async () => {
    const linhas = [
      {
        categoria_id: "cat-paes",
        opcionais_categorias: { id: "oc-vazia", nome: "Vazia", ordem: 0, opcionais: [] },
      },
    ];
    const { client } = makeClient({ data: linhas, error: null });
    const mapa = await buscarOpcionaisPorCategoria(client, ["cat-paes"]);
    expect(mapa["cat-paes"] ?? []).toEqual([]);
  });

  it("PROPAGA o error do PostgREST (não mascara como mapa vazio)", async () => {
    const { client } = makeClient({ data: null, error: { message: "rls denied" } });
    await expect(buscarOpcionaisPorCategoria(client, ["cat-paes"])).rejects.toBeTruthy();
  });
});

// ───────────────────────── buscarOpcionaisPorCategoriaDaLoja (issue 132 — variante service_role escopada)
/**
 * Fase RED (TDD) da issue 132 — variante ESCOPADA POR LOJA de
 * `buscarOpcionaisPorCategoria`, para uso sob `service_role` (BYPASSRLS) no loader
 * admin. A função `buscarOpcionaisPorCategoriaDaLoja(svc, lojaId, categoriaIds)`
 * AINDA NÃO EXISTE → import resolve `undefined`, chamada cai em `TypeError`.
 *
 * Por que a variante existe (diferença crítica vs. a original):
 *  - a original delega 100% a isolação de loja + filtro `ativo` à RLS pública (080);
 *    sob `service_role` essa RLS NÃO se aplica → o JOIN
 *    `categoria_produto_opcionais → opcionais_categorias → opcionais` sem `.eq("loja_id")`
 *    passaria a confiar CEGAMENTE na lista `categoriaIds` recebida. Um `categoria_id`
 *    de outra loja na lista vazaria a biblioteca de opcionais dela.
 *  - a variante adiciona `.eq("loja_id", lojaId)` em `categoria_produto_opcionais`
 *    como ÚNICO ponto de enforcement (isolação por construção), mantendo
 *    `.in("categoria_id", categoriaIds)` e o mesmo agrupamento/ordenação da original.
 *
 * Contrato que a GREEN precisa satisfazer:
 *  1. `.from("categoria_produto_opcionais")` com `.eq("loja_id", lojaId)` E
 *     `.in("categoria_id", categoriaIds)`, e o MESMO select aninhado da original.
 *  2. Agrupa/ordena idêntico à original (grupos por `opcionais_categorias.ordem`,
 *     itens por `opcionais.ordem`) → mesmo shape `OpcionaisPorCategoria`.
 *  3. `categoriaIds` vazio → `{}` sem tocar `.from()`.
 *  4. PROPAGA error (§14) — não mascara como mapa vazio.
 */
describe("132 buscarOpcionaisPorCategoriaDaLoja — contrato TS (camada 2, mock)", () => {
  const LOJA_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  function linhasAssoc() {
    return [
      {
        categoria_id: "cat-paes",
        // `ordem` na RAIZ = categoria_produto_opcionais.ordem (208/210), a autoridade.
        ordem: 1,
        opcionais_categorias: {
          id: "oc-laticinios",
          nome: "Laticínios",
          ordem: 1,
          opcionais: [
            { id: "o-catupiry", nome: "Catupiry", preco: 5, ordem: 1 },
            { id: "o-brie", nome: "Brie extra", preco: 8, ordem: 0 },
          ],
        },
      },
      {
        categoria_id: "cat-paes",
        ordem: 0,
        opcionais_categorias: {
          id: "oc-doces",
          nome: "Doces",
          ordem: 0,
          opcionais: [{ id: "o-doce", nome: "Doce de leite", preco: 4, ordem: 0 }],
        },
      },
    ];
  }

  it("emite .eq(loja_id, lojaId) E .in(categoria_id, ...) na TABELA categoria_produto_opcionais, com opcionais aninhados", async () => {
    const { client, calls } = makeClient({ data: linhasAssoc(), error: null });

    await buscarOpcionaisPorCategoriaDaLoja(client, LOJA_A, ["cat-paes"]);

    expect(calls.from).toHaveBeenCalledWith("categoria_produto_opcionais");
    // GUARD CENTRAL: sem este .eq, a biblioteca de outra loja vaza sob service_role.
    expect(calls.eq).toHaveBeenCalledWith("loja_id", LOJA_A);
    expect(calls.in).toHaveBeenCalledWith("categoria_id", ["cat-paes"]);
    const selectArg = String(calls.select.mock.calls[0]?.[0] ?? "");
    expect(selectArg).toContain("opcionais_categorias");
    expect(selectArg).toContain("opcionais");
  });

  it("agrupa/ordena PARITÁRIO à original (grupos por ordem, itens por ordem) — mesmo shape OpcionaisPorCategoria", async () => {
    const { client } = makeClient({ data: linhasAssoc(), error: null });

    const mapa = await buscarOpcionaisPorCategoriaDaLoja(client, LOJA_A, ["cat-paes"]);
    const grupos = mapa["cat-paes"];

    // Grupos por ordem: Doces (0) antes de Laticínios (1).
    expect(grupos.map((g) => g.categoriaOpcionalNome)).toEqual(["Doces", "Laticínios"]);
    // Itens de Laticínios por ordem: Brie (0) antes de Catupiry (1).
    const latic = grupos.find((g) => g.categoriaOpcionalId === "oc-laticinios")!;
    expect(latic.opcionais.map((o) => o.id)).toEqual(["o-brie", "o-catupiry"]);
    expect(latic.opcionais[0]).toEqual({ id: "o-brie", nome: "Brie extra", preco: 8, ordem: 0 });
  });

  it("categoriaIds vazio → {} sem tocar o banco (não chama .from)", async () => {
    const { client, calls } = makeClient({ data: [], error: null });

    const mapa = await buscarOpcionaisPorCategoriaDaLoja(client, LOJA_A, []);

    expect(mapa).toEqual({});
    expect(calls.from).not.toHaveBeenCalled();
  });

  it("PROPAGA o error do PostgREST (não mascara como mapa vazio)", async () => {
    const { client } = makeClient({ data: null, error: { message: "db down" } });
    await expect(
      buscarOpcionaisPorCategoriaDaLoja(client, LOJA_A, ["cat-paes"]),
    ).rejects.toBeTruthy();
  });

  it("lojaId fora do formato uuid → {} SEM tocar o banco (defesa em profundidade, fail-closed)", async () => {
    // Guarda `schemaUuid.safeParse(lojaId)` interna da variante — não é redundante
    // com a validação do loader (carga-opcionais.ts): esta função pode, em tese,
    // ser chamada por outro caller sem passar por `validarLojaIdAdmin` antes. Sem
    // este teste, remover/inverter a checagem não quebra nenhum caso existente
    // (todos usam LOJA_A válido) e o bug passaria despercebido.
    const { client, calls } = makeClient({ data: linhasAssoc(), error: null });

    const mapa = await buscarOpcionaisPorCategoriaDaLoja(client, "nao-e-uuid", ["cat-paes"]);

    expect(mapa).toEqual({});
    expect(calls.from).not.toHaveBeenCalled();
  });

  it("grupo de opcional SEM nenhum item (opcionais: []) é descartado do mapa — categoria some, não vira grupo vazio", async () => {
    // Cobre o ramo `if (opcionais.length === 0) continue` — sem este teste, remover
    // essa checagem não quebra nenhum caso existente (todos os outros grupos têm
    // ao menos 1 item) e a página admin passaria a renderizar um grupo vazio.
    const linhas = [
      {
        categoria_id: "cat-paes",
        opcionais_categorias: {
          id: "oc-vazio",
          nome: "Grupo sem itens",
          ordem: 0,
          opcionais: [],
        },
      },
      {
        categoria_id: "cat-paes",
        opcionais_categorias: {
          id: "oc-doces",
          nome: "Doces",
          ordem: 1,
          opcionais: [{ id: "o-doce", nome: "Doce de leite", preco: 4, ordem: 0 }],
        },
      },
    ];
    const { client } = makeClient({ data: linhas, error: null });

    const mapa = await buscarOpcionaisPorCategoriaDaLoja(client, LOJA_A, ["cat-paes"]);

    const grupos = mapa["cat-paes"];
    expect(grupos.map((g) => g.categoriaOpcionalId)).toEqual(["oc-doces"]);
    expect(grupos.find((g) => g.categoriaOpcionalId === "oc-vazio")).toBeUndefined();
  });

  it("linha sem opcionais_categorias (join órfão) é ignorada — categoria some do mapa em vez de quebrar", async () => {
    // Cobre o ramo `if (!cat) continue` — join órfão (associação apontando para
    // categoria_opcional inexistente/deletada) não deve lançar nem virar grupo `null`.
    const linhas = [
      { categoria_id: "cat-paes", opcionais_categorias: null },
      {
        categoria_id: "cat-paes",
        opcionais_categorias: {
          id: "oc-doces",
          nome: "Doces",
          ordem: 0,
          opcionais: [{ id: "o-doce", nome: "Doce de leite", preco: 4, ordem: 0 }],
        },
      },
    ];
    const { client } = makeClient({ data: linhas, error: null });

    const mapa = await buscarOpcionaisPorCategoriaDaLoja(client, LOJA_A, ["cat-paes"]);

    expect(mapa["cat-paes"].map((g) => g.categoriaOpcionalId)).toEqual(["oc-doces"]);
  });
});

// ───────────────────────── agruparCatalogo (issue 207 — função pura, novo limite)
/**
 * `agruparCatalogo` nasceu da quebra de `buscarCatalogoPublico` (issue 207, F4):
 * a query virou `buscarProdutosPublicos` e o agrupamento virou esta função PURA,
 * para a vitrine poder buscar produtos e categorias em `Promise.all`. Os testes
 * de `buscarCatalogoPublico` acima já cobrem o comportamento via composição —
 * estes testam a função pura DIRETAMENTE, sem client/mock de Supabase, que é a
 * superfície nova que não existia antes do refactor.
 */
describe("207 agruparCatalogo — função pura (fetch/agrupamento separados)", () => {
  const catBebidas = {
    id: "cat-bebidas",
    loja_id: "loja-1",
    nome: "Bebidas",
    ordem: 0,
    criado_em: "2026-01-01T00:00:00Z",
    exibir_imagens: true,
  };
  const catLanches = {
    id: "cat-lanches",
    loja_id: "loja-1",
    nome: "Lanches",
    ordem: 1,
    criado_em: "2026-01-01T00:00:00Z",
    exibir_imagens: true,
  };

  it('produto SEM categoria_id vai para "Outros", e "Outros" fica por ÚLTIMO mesmo com categorias antes dele', () => {
    const produtos = [
      { id: "p1", loja_id: "loja-1", categoria_id: "cat-bebidas", nome: "Coca", preco: 5, disponivel: true, ordem: 0 },
      { id: "p9", loja_id: "loja-1", categoria_id: null, nome: "Brinde", preco: 0, disponivel: true, ordem: 0 },
    ];

    const grupos = agruparCatalogo(produtos as never, [catBebidas]);

    expect(grupos.map((g) => g.nome)).toEqual(["Bebidas", "Outros"]);
    expect(grupos[grupos.length - 1].id).toBeNull();
    expect(grupos[grupos.length - 1].produtos.map((p) => p.id)).toEqual(["p9"]);
  });

  it('produto com categoria_id que NÃO existe na lista de categorias também cai em "Outros" (join órfão, não é descartado)', () => {
    // Diferente do caso categoria_id=null: aqui o produto TEM categoria_id, mas
    // a categoria não veio em `categorias` (ex.: categoria apagada entre as duas
    // buscas paralelas). Se o código trocasse `?? undefined` por um `.get()` que
    // lança, ou se ignorasse silenciosamente o produto, este teste pegaria: o
    // produto precisa aparecer em algum grupo, nunca sumir.
    const produtos = [
      { id: "p1", loja_id: "loja-1", categoria_id: "cat-fantasma", nome: "X", preco: 10, disponivel: true, ordem: 0 },
    ];

    const grupos = agruparCatalogo(produtos as never, [catBebidas]);

    expect(grupos.map((g) => g.nome)).toEqual(["Outros"]);
    expect(grupos[0].produtos.map((p) => p.id)).toEqual(["p1"]);
  });

  it("categoria que só tem produto ESGOTADO (disponivel:false) continua aparecendo — não filtra por disponivel", () => {
    const produtos = [
      { id: "p2", loja_id: "loja-1", categoria_id: "cat-bebidas", nome: "Suco", preco: 7, disponivel: false, ordem: 0 },
    ];

    const grupos = agruparCatalogo(produtos as never, [catBebidas, catLanches]);

    expect(grupos.map((g) => g.nome)).toEqual(["Bebidas"]);
    expect(grupos[0].produtos[0].disponivel).toBe(false);
  });

  it("177 — grupo de categoria SEM nenhum produto some do resultado (filter)", () => {
    const produtos = [
      { id: "p1", loja_id: "loja-1", categoria_id: "cat-lanches", nome: "X-Burguer", preco: 20, disponivel: true, ordem: 0 },
    ];

    // "Bebidas" não tem nenhum produto: não pode sobrar como grupo vazio.
    const grupos = agruparCatalogo(produtos as never, [catBebidas, catLanches]);

    expect(grupos.map((g) => g.nome)).toEqual(["Lanches"]);
    expect(grupos.find((g) => g.nome === "Bebidas")).toBeUndefined();
  });

  it('categorias=[] (padrão) com produtos → um único grupo "Outros" contendo todos', () => {
    const produtos = [
      { id: "p1", loja_id: "loja-1", categoria_id: "cat-bebidas", nome: "Coca", preco: 5, disponivel: true, ordem: 0 },
      { id: "p2", loja_id: "loja-1", categoria_id: null, nome: "Brinde", preco: 0, disponivel: true, ordem: 1 },
    ];

    const grupos = agruparCatalogo(produtos as never);

    expect(grupos.length).toBe(1);
    expect(grupos[0].nome).toBe("Outros");
    expect(grupos[0].produtos.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("produtos=[] e categorias=[] → [] (nada de 'Outros' vazio sobrando)", () => {
    expect(agruparCatalogo([], [])).toEqual([]);
  });

  it("produtos=[] com categorias definidas → [] (nenhuma categoria vazia vaza para a vitrine)", () => {
    expect(agruparCatalogo([], [catBebidas, catLanches])).toEqual([]);
  });
});

// ───────────────────────── buscarProdutosPublicos (issue 207 — só a query)
describe("207 buscarProdutosPublicos — só a query (sem agrupamento)", () => {
  it("consulta a VIEW vitrine_produtos por loja_id, ordenado por ordem, e devolve a lista CRUA — 265", async () => {
    // As linhas carregam as cinco colunas de desconto JÁ MASCARADAS pela view
    // (265 · [3]): quando a promoção não está vigente, chegam false/NULL.
    const rows = [
      { id: "p1", loja_id: "loja-1", categoria_id: "cat-bebidas", nome: "Coca", descricao: null, preco: 5, disponivel: true, ordem: 0, foto_url: null, desconto_ativo: false, desconto_tipo: null, desconto_valor: null, desconto_inicio: null, desconto_fim: null },
      { id: "p2", loja_id: "loja-1", categoria_id: "cat-lanches", nome: "X-Burguer", descricao: null, preco: 20, disponivel: true, ordem: 1, foto_url: null, desconto_ativo: true, desconto_tipo: "percentual", desconto_valor: 10, desconto_inicio: null, desconto_fim: null },
    ];
    const { client, calls } = makeClient({ data: rows, error: null });

    const out = await buscarProdutosPublicos(client, "loja-1");

    // 265 · [1]/[2a]: a tabela base não tem mais SELECT público.
    expect(calls.from).toHaveBeenCalledWith("vitrine_produtos");
    expect(calls.from).not.toHaveBeenCalledWith("produtos");
    expect(calls.select).toHaveBeenCalledWith(COLUNAS_PRODUTO_PUBLICO);
    expect(calls.eq).toHaveBeenCalledWith("loja_id", "loja-1");
    // 265 · D6: a view não projeta `oculto` — filtrar por ela daria 42703.
    expect(calls.eq).not.toHaveBeenCalledWith("oculto", false);
    expect(calls.order).toHaveBeenCalledWith("ordem", { ascending: true });
    // Sem agrupamento: devolve a lista plana tal como veio do PostgREST.
    expect(out).toEqual(rows);
  });

  it("data=null → [] (não lança, não mascara erro que não existe)", async () => {
    const { client } = makeClient({ data: null, error: null });
    const out = await buscarProdutosPublicos(client, "loja-1");
    expect(out).toEqual([]);
  });

  it("PROPAGA o error do PostgREST — não retorna [] silenciosamente", async () => {
    const { client } = makeClient({ data: null, error: { message: "db down" } });
    await expect(buscarProdutosPublicos(client, "loja-1")).rejects.toBeTruthy();
  });
});

// ───────────────────────── issue 210 — ordem dos grupos vem da ASSOCIAÇÃO
/**
 * Até a 208 a sequência dos grupos de opcional vinha de `opcionais_categorias.ordem`
 * (a ordem da BIBLIOTECA, global à loja). A partir da 210 a autoridade é
 * `categoria_produto_opcionais.ordem` — a ordem que o lojista arrasta DENTRO de cada
 * categoria de produto — com desempate por nome da categoria de opcional (render
 * determinístico entre SSR e hidratação).
 *
 * RN-11: o ganho é UM CAMPO A MAIS no select que já existia. Nenhuma query nova,
 * nenhum round-trip novo — os testes abaixo conferem o select e o `from` único.
 */
describe("210 ordenação dos grupos por categoria_produto_opcionais.ordem", () => {
  // As duas leituras DIVERGEM de propósito: pela ordem da biblioteca sairia
  // [Molhos, Queijos]; pela ordem da associação sai [Queijos, Molhos].
  function linhasDivergentes() {
    return [
      {
        categoria_id: "cat-lanches",
        ordem: 1,
        opcionais_categorias: {
          id: "oc-molhos",
          nome: "Molhos",
          ordem: 0,
          opcionais: [
            { id: "o-barbecue", nome: "Barbecue", preco: 2, ordem: 1 },
            { id: "o-maionese", nome: "Maionese", preco: 1, ordem: 0 },
          ],
        },
      },
      {
        categoria_id: "cat-lanches",
        ordem: 0,
        opcionais_categorias: {
          id: "oc-queijos",
          nome: "Queijos",
          ordem: 1,
          opcionais: [{ id: "o-cheddar", nome: "Cheddar", preco: 3, ordem: 0 }],
        },
      },
    ];
  }

  it("buscarOpcionaisPorCategoria: grupos saem pela ordem da ASSOCIAÇÃO, não pela da biblioteca", async () => {
    const { client } = makeClient({ data: linhasDivergentes(), error: null });

    const mapa = await buscarOpcionaisPorCategoria(client, ["cat-lanches"]);

    expect(mapa["cat-lanches"].map((g) => g.categoriaOpcionalNome)).toEqual([
      "Queijos",
      "Molhos",
    ]);
    // `ordem` exposta no grupo é a da associação (o que o painel arrastou).
    expect(mapa["cat-lanches"].map((g) => g.ordem)).toEqual([0, 1]);
  });

  it("buscarOpcionaisPorCategoriaDaLoja: MESMA chave de ordenação (agrupador único)", async () => {
    const { client } = makeClient({ data: linhasDivergentes(), error: null });

    const mapa = await buscarOpcionaisPorCategoriaDaLoja(
      client,
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      ["cat-lanches"],
    );

    expect(mapa["cat-lanches"].map((g) => g.categoriaOpcionalNome)).toEqual([
      "Queijos",
      "Molhos",
    ]);
  });

  it("empate de ordem desempata por NOME da categoria de opcional (render determinístico)", async () => {
    const linhas = [
      {
        categoria_id: "cat-lanches",
        ordem: 0,
        opcionais_categorias: {
          id: "oc-queijos",
          nome: "Queijos",
          ordem: 0,
          opcionais: [{ id: "o-cheddar", nome: "Cheddar", preco: 3, ordem: 0 }],
        },
      },
      {
        categoria_id: "cat-lanches",
        ordem: 0,
        opcionais_categorias: {
          id: "oc-molhos",
          nome: "Molhos",
          ordem: 9,
          opcionais: [{ id: "o-maionese", nome: "Maionese", preco: 1, ordem: 0 }],
        },
      },
    ];
    const { client } = makeClient({ data: linhas, error: null });

    const mapa = await buscarOpcionaisPorCategoria(client, ["cat-lanches"]);

    expect(mapa["cat-lanches"].map((g) => g.categoriaOpcionalNome)).toEqual([
      "Molhos",
      "Queijos",
    ]);
  });

  it("itens DENTRO do grupo seguem por opcionais.ordem — sem mudança", async () => {
    const { client } = makeClient({ data: linhasDivergentes(), error: null });

    const mapa = await buscarOpcionaisPorCategoria(client, ["cat-lanches"]);
    const molhos = mapa["cat-lanches"].find((g) => g.categoriaOpcionalId === "oc-molhos")!;

    expect(molhos.opcionais.map((o) => o.id)).toEqual(["o-maionese", "o-barbecue"]);
  });

  it("RN-11: a `ordem` da associação entra no select QUE JÁ EXISTIA — um from(), uma query", async () => {
    const { client, calls } = makeClient({ data: linhasDivergentes(), error: null });

    await buscarOpcionaisPorCategoria(client, ["cat-lanches"]);

    expect(calls.from).toHaveBeenCalledTimes(1);
    expect(calls.select).toHaveBeenCalledTimes(1);
    const selectArg = String(calls.select.mock.calls[0]?.[0] ?? "");
    // campo novo na RAIZ (antes do primeiro embed), sem remover nada do que já vinha
    expect(selectArg.split("opcionais_categorias")[0]).toContain("ordem");
    expect(selectArg).toContain("opcionais_categorias(id, nome, ordem");
    expect(selectArg).toContain("opcionais(id, nome, preco, ordem)");
  });
});
