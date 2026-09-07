// RED (TDD red-first) — issue 168: a observação entra na CHAVE DE DEDUP da
// linha do carrinho.
//
// Por que é crítico (plan/168 §Recálculo no Servidor): `linhaCarrinhoId` governa
// a QUANTIDADE de cada linha. `adicionar` soma quantidade quando as chaves batem;
// `incrementar`/`decrementar`/`remover` casam a linha por essa mesma chave. Uma
// fusão indevida some com uma linha (cliente paga MENOS do que pediu); uma cisão
// indevida multiplica linhas (cliente paga MAIS). O servidor recalcula fielmente
// em cima do payload, não da intenção — então toda asserção aqui cobre
// CONTAGEM DE LINHAS **e** `quantidade` POR LINHA, nunca só uma das duas.
//
// environment: node (vitest.config.ts), sem jsdom. `linhaCarrinhoId` é pura e
// exportada. Os mutadores são privados do módulo: são alcançados pela API
// pública do hook, obtida com um render SSR (`renderToStaticMarkup`) — o
// `useSyncExternalStore` devolve o snapshot de servidor (VAZIO), mas os
// callbacks retornados por `useCallback` são os reais e mutam a store de módulo.
// O estado é observado pelo `sessionStorage` falso instalado abaixo (é o que
// `emitir` escreve), o que de quebra prova o formato persistido.

import { describe, it, expect, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ItemCarrinho } from "@/types/dominio";
import { linhaCarrinhoId, useCarrinho, type UseCarrinhoReturn } from "./useCarrinho";

// ── window/sessionStorage falsos ────────────────────────────────────────────
// O módulo só consulta `typeof window` em tempo de CHAMADA (`emitir`/`lerStorage`),
// nunca no topo além da hidratação inicial — instalar aqui basta.
const CHAVE_STORAGE = "irango:carrinho";
const mapa = new Map<string, string>();
(globalThis as unknown as Record<string, unknown>).window = {
  sessionStorage: {
    getItem: (k: string) => mapa.get(k) ?? null,
    setItem: (k: string, v: string) => void mapa.set(k, v),
    removeItem: (k: string) => void mapa.delete(k),
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

/** Captura a API real do hook via render SSR (sem DOM). */
function api(): UseCarrinhoReturn {
  let capturada: UseCarrinhoReturn | undefined;
  function Sonda() {
    capturada = useCarrinho();
    return null;
  }
  renderToStaticMarkup(createElement(Sonda));
  if (!capturada) throw new Error("hook não renderizou");
  return capturada;
}

/** Estado observado pelo que o `emitir` persistiu. */
function linhas(): ItemCarrinho[] {
  const bruto = mapa.get(CHAVE_STORAGE);
  return bruto ? (JSON.parse(bruto) as ItemCarrinho[]) : [];
}

const A = "11111111-1111-4111-8111-111111111111";
const OPC_X = "22222222-2222-4222-8222-222222222222";
const OPC_Y = "33333333-3333-4333-8333-333333333333";

const NBSP = "\u00A0";
const ZWSP = "\u200B";
const BOM = "\uFEFF";

const OPC = (opcionalId: string, quantidade = 1) => ({
  opcionalId,
  nome: "extra",
  preco: 2,
  quantidade,
});

/** Item base do produto A — cada teste sobrescreve o que interessa. */
function item(
  patch: Partial<Omit<ItemCarrinho, "quantidade">> = {},
): Omit<ItemCarrinho, "quantidade"> {
  return { produtoId: A, nome: "X-Burguer", preco: 25, ...patch };
}

beforeEach(() => {
  api().limpar();
  mapa.clear();
});

// ────────────────────────────────────────────────────────────────────────────
//  linhaCarrinhoId — forma da chave
// ────────────────────────────────────────────────────────────────────────────

describe("linhaCarrinhoId — retrocompat de FORMATO (não pode mudar)", () => {
  // [1] Forma 1. O comentário de useCarrinho.ts promete que `incrementar` & cia.
  // aceitam `produtoId` puro, e há código de produção apoiado nisso.
  it("[1] sem opcionais e sem observação → produtoId puro, byte a byte", () => {
    expect(linhaCarrinhoId(A)).toBe(A);
    expect(linhaCarrinhoId(A, [])).toBe(A);
    expect(linhaCarrinhoId(A, undefined, undefined)).toBe(A);
  });

  // [2] Forma 2 — e estável sob reordenação dos opcionais.
  it("[2] com opcionais e sem observação → `produtoId|assinatura` inalterado", () => {
    expect(linhaCarrinhoId(A, [OPC(OPC_X, 1)])).toBe(`${A}|${OPC_X}:1`);
    const ordemUm = linhaCarrinhoId(A, [OPC(OPC_X, 1), OPC(OPC_Y, 2)]);
    const ordemOutra = linhaCarrinhoId(A, [OPC(OPC_Y, 2), OPC(OPC_X, 1)]);
    expect(ordemUm).toBe(ordemOutra);
    expect(ordemUm).toBe(`${A}|${OPC_X}:1,${OPC_Y}:2`);
  });
});

describe("linhaCarrinhoId — observação faz parte da identidade da linha", () => {
  // [3] O núcleo da issue.
  it("[3] observações diferentes → chaves diferentes; observação ≠ ausência dela", () => {
    const semObs = linhaCarrinhoId(A);
    const cebola = linhaCarrinhoId(A, undefined, "sem cebola");
    const tomate = linhaCarrinhoId(A, undefined, "sem tomate");

    expect(cebola).not.toBe(semObs);
    expect(tomate).not.toBe(semObs);
    expect(cebola).not.toBe(tomate);
    // Forma 3: `produtoId|assinatura|obs` — assinatura vazia quando não há opcionais.
    expect(cebola).toBe(`${A}||sem cebola`);
  });

  // [4] Observação "vazia de conteúdo" cai de volta na forma 1 (retrocompat).
  it("[4] observação vazia / só espaço / só quebra de linha → produtoId puro", () => {
    for (const obs of ["", " ", "   ", "\n", "\r\n", "\t", NBSP, ZWSP, BOM, undefined]) {
      expect(linhaCarrinhoId(A, undefined, obs)).toBe(A);
    }
  });

  // [5] A chave usa o texto CANÔNICO (decisão do plan/168 §Forma exata da chave):
  // sem isso `"sem  cebola"` e `"sem cebola"` viram 2 linhas no carrinho e 2
  // itens IDÊNTICOS em itens_pedido (o servidor normaliza antes de gravar).
  it("[5] mesma observação com espaçamento diferente → MESMA chave (canonização)", () => {
    const canonica = linhaCarrinhoId(A, undefined, "sem cebola");
    expect(canonica).toBe(`${A}||sem cebola`);
    for (const variante of [
      "sem  cebola",
      " sem cebola ",
      `sem${NBSP}cebola`,
      "sem\tcebola",
      `${ZWSP}sem cebola${BOM}`,
      "sem cebola\r\n",
    ]) {
      expect(linhaCarrinhoId(A, undefined, variante)).toBe(canonica);
    }
  });

  // [5b] `\n` é preservado pela normalização e NÃO colapsa em espaço — então
  // "a\nb" e "a b" são linhas distintas, coerente com o que o servidor grava.
  it("[5b] quebra de linha interna é significativa na chave", () => {
    expect(linhaCarrinhoId(A, undefined, "a\nb")).not.toBe(
      linhaCarrinhoId(A, undefined, "a b"),
    );
  });

  // [6] Injetividade sob texto adverso: nenhuma observação pode forjar a chave
  // de outra linha (é o que impede fusão/cisão indevida de quantidade).
  it("[6] observação com `|`, `,` ou `uuid:qtd` não colide com nenhuma outra chave", () => {
    const adversas = [
      `${OPC_X}:1`,
      "|",
      "a|b",
      ",",
      `|${OPC_X}:1`,
      `${OPC_X}:1,${OPC_Y}:2`,
    ];
    const chaves = [
      linhaCarrinhoId(A),
      linhaCarrinhoId(A, [OPC(OPC_X, 1)]),
      linhaCarrinhoId(A, [OPC(OPC_X, 1), OPC(OPC_Y, 2)]),
      ...adversas.map((o) => linhaCarrinhoId(A, undefined, o)),
      ...adversas.map((o) => linhaCarrinhoId(A, [OPC(OPC_X, 1)], o)),
    ];
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  adicionar — contagem de linhas E quantidade por linha
// ────────────────────────────────────────────────────────────────────────────

describe("adicionar — dedup por (produto, opcionais, observação)", () => {
  // [7] O cenário que a issue existe para garantir.
  it("[7] mesmo produto + mesmos opcionais + observações DIFERENTES → 2 linhas, qtd 1 cada", () => {
    const { adicionar } = api();
    adicionar(item({ opcionais: [OPC(OPC_X, 1)], observacao: "sem cebola" }), 1);
    adicionar(item({ opcionais: [OPC(OPC_X, 1)], observacao: "sem tomate" }), 1);

    const atual = linhas();
    expect(atual).toHaveLength(2);
    expect(atual.map((i) => i.quantidade)).toEqual([1, 1]);
    expect(atual.map((i) => i.observacao)).toEqual(["sem cebola", "sem tomate"]);
    // Quantidade TOTAL enviada ao servidor: 2 unidades em 2 linhas — não 1 linha
    // de 2 (fusão) nem 2 linhas de 2 (cisão).
    expect(atual.reduce((acc, i) => acc + i.quantidade, 0)).toBe(2);
  });

  // [8] O inverso: mesma observação NÃO pode virar duas linhas.
  it("[8] mesma observação em duas adições → 1 linha com quantidade SOMADA", () => {
    const { adicionar } = api();
    adicionar(item({ observacao: "sem cebola" }), 1);
    adicionar(item({ observacao: "sem cebola" }), 2);

    const atual = linhas();
    expect(atual).toHaveLength(1);
    expect(atual[0].quantidade).toBe(3);
    expect(atual[0].observacao).toBe("sem cebola");
  });

  // [8b] Anti-padding: variação só de espaçamento é a MESMA linha.
  it("[8b] observações que só diferem em espaçamento → 1 linha, quantidade somada", () => {
    const { adicionar } = api();
    adicionar(item({ observacao: "sem  cebola" }), 1); // não canônica PRIMEIRO
    adicionar(item({ observacao: " sem cebola " }), 1);
    adicionar(item({ observacao: "sem cebola" }), 1);

    const atual = linhas();
    expect(atual).toHaveLength(1);
    expect(atual[0].quantidade).toBe(3);
    // A linha guarda o texto CANÔNICO (paridade com o que a RPC persiste).
    expect(atual[0].observacao).toBe("sem cebola");
  });

  // [8c] Observação em branco é equivalente a não ter observação.
  it("[8c] observação vazia/só espaço funde com o item sem observação", () => {
    const { adicionar } = api();
    adicionar(item({ observacao: "   " }), 1); // em branco PRIMEIRO
    adicionar(item({ observacao: "" }), 1);
    adicionar(item(), 1);

    const atual = linhas();
    expect(atual).toHaveLength(1);
    expect(atual[0].quantidade).toBe(3);
    // "" não vai para o estado: campo omitido (plan/168 §Invariante de fronteira).
    expect(atual[0].observacao ?? "").toBe("");
  });

  // [9] Uma com observação, outra sem → duas linhas.
  it("[9] adicionar com observação e depois SEM → 2 linhas, qtd 1 cada", () => {
    const { adicionar } = api();
    adicionar(item({ observacao: "bem passado" }), 1);
    adicionar(item(), 1);

    const atual = linhas();
    expect(atual).toHaveLength(2);
    expect(atual.map((i) => i.quantidade)).toEqual([1, 1]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  incrementar / decrementar / remover — a linha irmã não pode ser afetada
// ────────────────────────────────────────────────────────────────────────────

describe("mutadores por chave — isolamento entre linhas do MESMO produto", () => {
  /** Duas linhas do produto A: uma "sem cebola", outra "sem tomate". */
  function duasLinhas() {
    const { adicionar } = api();
    adicionar(item({ observacao: "sem cebola" }), 2);
    adicionar(item({ observacao: "sem tomate" }), 5);
  }

  // [10a]
  it("[10a] incrementar pela chave de forma 3 mexe SÓ na linha certa", () => {
    duasLinhas();
    api().incrementar(linhaCarrinhoId(A, undefined, "sem cebola"));

    const atual = linhas();
    expect(atual).toHaveLength(2);
    expect(atual.find((i) => i.observacao === "sem cebola")?.quantidade).toBe(3);
    expect(atual.find((i) => i.observacao === "sem tomate")?.quantidade).toBe(5);
  });

  // [10b]
  it("[10b] decrementar pela chave de forma 3 mexe SÓ na linha certa", () => {
    duasLinhas();
    api().decrementar(linhaCarrinhoId(A, undefined, "sem tomate"));

    const atual = linhas();
    expect(atual).toHaveLength(2);
    expect(atual.find((i) => i.observacao === "sem cebola")?.quantidade).toBe(2);
    expect(atual.find((i) => i.observacao === "sem tomate")?.quantidade).toBe(4);
  });

  // [10c] O caso que mais dói: remover uma e a irmã sumir junto.
  it("[10c] remover uma linha NÃO remove a irmã de mesmo produtoId", () => {
    duasLinhas();
    api().remover(linhaCarrinhoId(A, undefined, "sem cebola"));

    const atual = linhas();
    expect(atual).toHaveLength(1);
    expect(atual[0].observacao).toBe("sem tomate");
    expect(atual[0].quantidade).toBe(5);
  });

  // [10d] A chave usada pela UI é derivada do item — o round-trip precisa fechar.
  it("[10d] chave derivada do item persistido casa com a linha (round-trip)", () => {
    duasLinhas();
    for (const linha of linhas()) {
      const chave = linhaCarrinhoId(linha.produtoId, linha.opcionais, linha.observacao);
      api().remover(chave);
    }
    expect(linhas()).toHaveLength(0);
  });

  // [13]
  it("[13] decrementar até 0 remove só aquela linha", () => {
    const { adicionar, decrementar } = api();
    adicionar(item({ observacao: "sem cebola" }), 1);
    adicionar(item({ observacao: "sem tomate" }), 2);
    decrementar(linhaCarrinhoId(A, undefined, "sem cebola"));

    const atual = linhas();
    expect(atual).toHaveLength(1);
    expect(atual[0].observacao).toBe("sem tomate");
    expect(atual[0].quantidade).toBe(2);
  });
});

describe("retrocompat de COMPORTAMENTO — chave `produtoId` puro", () => {
  // [11]
  it("[11] incrementar/remover com produtoId puro seguem funcionando", () => {
    const { adicionar, incrementar, remover } = api();
    adicionar(item(), 1);

    incrementar(A);
    expect(linhas()[0].quantidade).toBe(2);

    remover(A);
    expect(linhas()).toHaveLength(0);
  });

  // [11b] E a chave pura NÃO pode alcançar a linha com observação.
  it("[11b] produtoId puro não mexe na linha que tem observação", () => {
    const { adicionar, incrementar } = api();
    adicionar(item(), 1);
    adicionar(item({ observacao: "sem cebola" }), 1);

    incrementar(A);

    const atual = linhas();
    expect(atual).toHaveLength(2);
    expect(atual.find((i) => !i.observacao)?.quantidade).toBe(2);
    expect(atual.find((i) => i.observacao === "sem cebola")?.quantidade).toBe(1);
  });

  // [12] Item vindo de um sessionStorage de versão ANTERIOR: objeto sem a
  // propriedade `observacao`. A retrocompat é estrutural (plan/168 §Retrocompat)
  // — nenhum bump de CHAVE_STORAGE, nenhuma migração.
  it("[12] item sem a propriedade `observacao` → chave de hoje e incrementar funciona", () => {
    const antigo = { produtoId: A, nome: "X-Burguer", preco: 25 };
    expect("observacao" in antigo).toBe(false);

    api().adicionar(antigo, 1);
    expect(linhaCarrinhoId(antigo.produtoId, undefined, undefined)).toBe(A);

    api().incrementar(A);
    const atual = linhas();
    expect(atual).toHaveLength(1);
    expect(atual[0].quantidade).toBe(2);
  });
});
