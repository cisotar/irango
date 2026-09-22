import { describe, it, expect } from "vitest";

import {
  ESCOLHA_PADRAO,
  MOTIVO_CATEGORIA_SEM_DIAS,
  MOTIVO_SEM_DIA,
  diasDaEscolha,
  escolhaValida,
  type EscolhaDeDias,
} from "./escolhaDeDias";


describe("[288/D3] escolhaDeDias — a regra da escolha, sem jsdom", () => {
  it("o padrão é 'todos os dias do cardápio' — zero clique para o caso comum", () => {
    expect(ESCOLHA_PADRAO).toEqual({ modo: "cardapio" });
    expect(escolhaValida(ESCOLHA_PADRAO)).toBe(true);
    expect(diasDaEscolha(ESCOLHA_PADRAO)).toEqual([]);
  });

  it("'escolher dias' ordena e não muta o array de entrada", () => {
    const dias = [6, 1, 3];
    const escolha: EscolhaDeDias = { modo: "dias", dias };
    expect(diasDaEscolha(escolha)).toEqual([1, 3, 6]);
    expect(dias, "o array recebido foi mutado").toEqual([6, 1, 3]);
  });

  it("'escolher dias' com zero dia é INVÁLIDO — o CTA não promete escrita", () => {
    expect(escolhaValida({ modo: "dias", dias: [] })).toBe(false);
    expect(escolhaValida({ modo: "dias", dias: [0] })).toBe(true);
  });

  it("no modo 'cardapio' a escolha vira `[]` — quem traduz para NULL é o SERVIDOR", () => {
    expect(diasDaEscolha(ESCOLHA_PADRAO)).toEqual([]);
  });

  it("os dois motivos são frases completas, não fragmentos de tooltip", () => {
    expect(MOTIVO_SEM_DIA).toBe("Marque pelo menos um dia para continuar.");
    expect(MOTIVO_CATEGORIA_SEM_DIAS).toContain("todos os dias do cardápio");
    expect(MOTIVO_CATEGORIA_SEM_DIAS).toContain("marque os produtos um a um");
  });
});

// ════════════════════════════════════ [289] RED — a pílula do produto vence ═══
//
// Fase RED da issue 289. Nada abaixo existe ainda em `./escolhaDeDias`:
//
//  - `resolverDiasDoProduto(rodape, doProduto)` — a REGRA, isolada: o produto
//    com pílula própria usa a dele; o produto sem pílula herda o rodapé.
//  - `montarDiasDoLote(produtoIds, rodape, porProduto)` — a mesma regra aplicada
//    à seleção inteira, devolvendo o FRAGMENTO do payload que a action recebe
//    (`dias_semana` do rodapé + `dias_por_produto` opcional).
//
// A regra mora aqui, e não num handler de clique, porque o projeto não tem
// jsdom: regra em `onClick` não é observável em teste (memória do projeto,
// "não testável? torne impossível").
//
// Import por caminho em VARIÁVEL: os símbolos ainda não existem e um import
// estático quebraria `npx tsc --noEmit` e a coleta do arquivo inteiro.

const MODULO_ESCOLHA_DE_DIAS = "./escolhaDeDias";

type DiasDoLote = {
  dias_semana: number[];
  dias_por_produto?: Record<string, number[]>;
};

type Escolha289 = { modo: "cardapio" } | { modo: "dias"; dias: number[] };

type Modulo289 = {
  resolverDiasDoProduto(
    rodape: Escolha289,
    doProduto: Escolha289 | undefined,
  ): number[];
  montarDiasDoLote(
    produtoIds: string[],
    rodape: Escolha289,
    porProduto: Record<string, Escolha289 | undefined>,
  ): DiasDoLote;
};

async function modulo289(): Promise<Modulo289> {
  const m = (await import(/* @vite-ignore */ MODULO_ESCOLHA_DE_DIAS)) as unknown as Partial<Modulo289>;
  const faltando = (["resolverDiasDoProduto", "montarDiasDoLote"] as const).filter(
    (nome) => typeof m[nome] !== "function",
  );
  if (faltando.length > 0) {
    throw new Error(
      `[RED 289] \`src/components/painel/escolhaDeDias.ts\` ainda não exporta: ${faltando.join(", ")}. ` +
        "É a fase GREEN da issue 289: a resolução pura 'pílula do produto vence rodapé'.",
    );
  }
  return m as Modulo289;
}

const TODOS_OS_DIAS: Escolha289 = { modo: "cardapio" };
const P1_289 = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const P2_289 = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const P3_289 = "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3";

describe("[289] resolverDiasDoProduto — a pílula do produto vence o rodapé", () => {
  it("produto COM pílula própria usa a DELE, não a do rodapé", async () => {
    const { resolverDiasDoProduto } = await modulo289();
    expect(
      resolverDiasDoProduto({ modo: "dias", dias: [1, 2] }, { modo: "dias", dias: [5] }),
    ).toEqual([5]);
  });

  it("produto SEM pílula própria herda o rodapé — `undefined` é 'não escolheu'", async () => {
    const { resolverDiasDoProduto } = await modulo289();
    expect(resolverDiasDoProduto({ modo: "dias", dias: [3, 1] }, undefined)).toEqual([1, 3]);
    expect(resolverDiasDoProduto(TODOS_OS_DIAS, undefined)).toEqual([]);
  });

  it("rodapé em 'todos os dias do cardápio' + pílula própria restringe SÓ aquele produto", async () => {
    const { resolverDiasDoProduto } = await modulo289();
    expect(resolverDiasDoProduto(TODOS_OS_DIAS, { modo: "dias", dias: [6, 0] })).toEqual([0, 6]);
    // …e o vizinho, sem pílula, continua em "todos os dias".
    expect(resolverDiasDoProduto(TODOS_OS_DIAS, undefined)).toEqual([]);
  });

  it("as 7 pílulas marcadas NÃO são `{modo:'cardapio'}` — a intenção é distinguível", async () => {
    const { resolverDiasDoProduto } = await modulo289();
    const sete = resolverDiasDoProduto(TODOS_OS_DIAS, {
      modo: "dias",
      dias: [6, 5, 4, 3, 2, 1, 0],
    });
    // Agenda FIXA de 0..6: deixa de seguir a vigência se ela mudar depois.
    expect(sete).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(sete).not.toEqual(resolverDiasDoProduto(TODOS_OS_DIAS, TODOS_OS_DIAS));
    // "Segue o cardápio" é `[]` — quem traduz para NULL é o SERVIDOR.
    expect(resolverDiasDoProduto(TODOS_OS_DIAS, TODOS_OS_DIAS)).toEqual([]);
  });

  it("não muta o array de entrada em nenhum dos dois lados", async () => {
    const { resolverDiasDoProduto } = await modulo289();
    const doProduto = [6, 1];
    const doRodape = [5, 2];
    resolverDiasDoProduto({ modo: "dias", dias: doRodape }, { modo: "dias", dias: doProduto });
    resolverDiasDoProduto({ modo: "dias", dias: doRodape }, undefined);
    expect(doProduto).toEqual([6, 1]);
    expect(doRodape).toEqual([5, 2]);
  });
});

describe("[289] montarDiasDoLote — o fragmento de payload que a sheet manda", () => {
  it("dois produtos com pílulas DIFERENTES saem com agendas diferentes no mapa", async () => {
    const { montarDiasDoLote } = await modulo289();
    expect(
      montarDiasDoLote([P1_289, P2_289], TODOS_OS_DIAS, {
        [P1_289]: { modo: "dias", dias: [1] },
        [P2_289]: { modo: "dias", dias: [2] },
      }),
    ).toEqual({
      dias_semana: [],
      dias_por_produto: { [P1_289]: [1], [P2_289]: [2] },
    });
  });

  it("produto sem pílula NÃO entra no mapa — ele herda `dias_semana` no servidor", async () => {
    const { montarDiasDoLote } = await modulo289();
    const r = montarDiasDoLote([P1_289, P2_289], { modo: "dias", dias: [4, 4, 2] }, {
      [P2_289]: { modo: "dias", dias: [0] },
    });
    // O rodapé chega normalizado como intenção (ordenado); a dedup final é do servidor.
    expect(r.dias_semana).toEqual([2, 4, 4].sort((a, b) => a - b));
    expect(r.dias_por_produto).toEqual({ [P2_289]: [0] });
    expect(Object.keys(r.dias_por_produto ?? {})).not.toContain(P1_289);
  });

  it("NINGUÉM com pílula própria: o mapa é OMITIDO — é o payload de hoje, intacto", async () => {
    const { montarDiasDoLote } = await modulo289();
    // Compatibilidade da barra de lote de `/painel/produtos`, que não tem
    // pílula por item e não pode passar a mandar chave nova.
    expect(montarDiasDoLote([P1_289, P2_289], { modo: "dias", dias: [3] }, {})).toEqual({
      dias_semana: [3],
    });
    expect(montarDiasDoLote([P1_289], TODOS_OS_DIAS, {})).toEqual({ dias_semana: [] });
  });

  it("escolha órfã (produto DESMARCADO depois) não vaza para o mapa", async () => {
    const { montarDiasDoLote } = await modulo289();
    // O servidor RECUSA o lote inteiro quando o mapa tem id fora de
    // `produto_ids`; a tela não pode produzir esse payload por descuido de
    // estado residual.
    const r = montarDiasDoLote([P1_289], TODOS_OS_DIAS, {
      [P1_289]: { modo: "dias", dias: [1] },
      [P3_289]: { modo: "dias", dias: [5] },
    });
    expect(Object.keys(r.dias_por_produto ?? {})).toEqual([P1_289]);
  });

  it("produto que escolheu EXPLICITAMENTE 'todos os dias' entra no mapa como `[]`", async () => {
    const { montarDiasDoLote } = await modulo289();
    // Distingue "escolheu seguir o cardápio" de "não escolheu nada": com o
    // rodapé restrito, só o segundo herda os dias do rodapé.
    expect(
      montarDiasDoLote([P1_289, P2_289], { modo: "dias", dias: [1] }, {
        [P1_289]: TODOS_OS_DIAS,
      }),
    ).toEqual({ dias_semana: [1], dias_por_produto: { [P1_289]: [] } });
  });
});
