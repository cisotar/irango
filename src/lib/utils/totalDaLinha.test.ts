import { describe, it, expect } from "vitest";
import { arredondar } from "./arredondar";
import {
  calcularSubtotal,
  totalDaLinha,
  type ItemCalculo,
} from "./calcularTotal";

// ---------------------------------------------------------------------------
// RED da issue 226 (fatia crítica 8 — D15 / RN-20).
//
// `totalDaLinha` é o trecho que `calcularSubtotal` JÁ calcula por linha,
// extraído para que as quatro superfícies de exibição (ReciboCliente,
// DetalhePedido, whatsappPedido, confirmação) passem a mostrar o que é
// COBRADO, e não `(preco + Σ opcionais) × qtd`.
//
//   cobrado:  (preco × qtd) + Σ(opcional.preco × opcional.qtd)
//   exibido:  (preco + Σ opcionais) × qtd        ← fórmula errada, a corrigir
//
// As duas contas COINCIDEM quando `quantidade = 1` — por isso todo caso que
// prova alguma coisa aqui tem `quantidade > 1` E opcional na mesma linha.
//
// Contrato (spec §RN-20):
//   totalDaLinha(item: ItemCalculo): number
//   arredondar(arredondar(preco × qtd) + Σ arredondar(op.preco × op.qtd))
//
// NÃO edite `calcularTotal.test.ts`: aquela suíte é a régua do refactor. Se ela
// precisar mudar, o refactor mudou comportamento e está errado.
// ---------------------------------------------------------------------------

function item(over: Partial<ItemCalculo> = {}): ItemCalculo {
  return { preco: 10, quantidade: 1, ...over };
}

/** A fórmula ERRADA que hoje vive nas quatro telas. Existe só para provar que
 *  `totalDaLinha` NÃO concorda com ela quando qtd > 1 e há opcional. */
function formulaAntigaDaTela(i: ItemCalculo): number {
  const somaOpcionais = (i.opcionais ?? []).reduce(
    (s, op) => s + op.preco * op.quantidade,
    0,
  );
  return arredondar((i.preco + somaOpcionais) * i.quantidade);
}

describe("totalDaLinha — o total de linha EXIBIDO é o total de linha COBRADO (RN-20)", () => {
  it("caso literal de RN-20: 2 pizzas de R$ 50,00 + borda de R$ 10,00 ⇒ R$ 110,00", () => {
    const pizza = item({
      preco: 50,
      quantidade: 2,
      opcionais: [{ preco: 10, quantidade: 1 }],
    });

    expect(totalDaLinha(pizza)).toBe(110);
  });

  it("nunca R$ 120,00 — a fórmula da tela ((preco + Σ op) × qtd) é rejeitada", () => {
    const pizza = item({
      preco: 50,
      quantidade: 2,
      opcionais: [{ preco: 10, quantidade: 1 }],
    });

    expect(formulaAntigaDaTela(pizza)).toBe(120); // o defeito, documentado
    expect(totalDaLinha(pizza)).not.toBe(120);
  });

  it("quantidade = 1 continua dando exatamente o mesmo de antes (R$ 60,00)", () => {
    const pizza = item({
      preco: 50,
      quantidade: 1,
      opcionais: [{ preco: 10, quantidade: 1 }],
    });

    expect(totalDaLinha(pizza)).toBe(60);
    expect(totalDaLinha(pizza)).toBe(formulaAntigaDaTela(pizza));
  });

  it("qtd do item NÃO multiplica os opcionais, e o opcional tem qtd própria (090)", () => {
    // preco 15 × qtd 3 = 45; opcionais: 2×2 = 4 e 1.5×1 = 1.5 → 45 + 5.5 = 50.50
    const linha = item({
      preco: 15,
      quantidade: 3,
      opcionais: [
        { preco: 2, quantidade: 2 },
        { preco: 1.5, quantidade: 1 },
      ],
    });

    expect(totalDaLinha(linha)).toBe(50.5);
  });

  it("item sem opcionais: preco × quantidade", () => {
    expect(totalDaLinha(item({ preco: 8.9, quantidade: 2 }))).toBe(17.8);
  });

  it("opcionais ausentes e lista vazia dão o mesmo resultado", () => {
    expect(totalDaLinha(item({ preco: 12.5, quantidade: 2, opcionais: [] }))).toBe(
      totalDaLinha(item({ preco: 12.5, quantidade: 2 })),
    );
  });

  it("arredonda a 2 casas sem float drift (0.1 × 3 + 0.2 = 0.50)", () => {
    const linha = item({
      preco: 0.1,
      quantidade: 3,
      opcionais: [{ preco: 0.2, quantidade: 1 }],
    });

    expect(totalDaLinha(linha)).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// A invariante de dinheiro: o que se EXIBE por linha soma exatamente o que se
// COBRA no subtotal. É a trava que pega o dia em que alguém reescrever uma das
// quatro telas com a fórmula antiga — sem jsdom, sem Playwright.
// ---------------------------------------------------------------------------

const carrinhos: Array<{ nome: string; itens: ItemCalculo[] }> = [
  {
    nome: "RN-20 — qtd > 1 COM opcional (o único caso em que as fórmulas divergem)",
    itens: [
      item({ preco: 50, quantidade: 2, opcionais: [{ preco: 10, quantidade: 1 }] }),
    ],
  },
  {
    nome: "vários itens, todos com qtd > 1 e opcionais de quantidade própria",
    itens: [
      item({
        preco: 15,
        quantidade: 3,
        opcionais: [
          { preco: 2, quantidade: 2 },
          { preco: 1.5, quantidade: 1 },
        ],
      }),
      item({ preco: 8.9, quantidade: 2 }),
      item({ preco: 33.9, quantidade: 4, opcionais: [{ preco: 4.5, quantidade: 3 }] }),
    ],
  },
  {
    nome: "mistura de qtd = 1 e qtd > 1, com e sem opcional",
    itens: [
      item({ preco: 19.9, quantidade: 1, opcionais: [{ preco: 3.5, quantidade: 2 }] }),
      item({ preco: 7, quantidade: 5 }),
      item({ preco: 12.35, quantidade: 3, opcionais: [{ preco: 0.99, quantidade: 1 }] }),
    ],
  },
  {
    nome: "centavos que provocam float drift",
    itens: [
      item({ preco: 0.1, quantidade: 3, opcionais: [{ preco: 0.2, quantidade: 1 }] }),
      item({ preco: 0.07, quantidade: 7, opcionais: [{ preco: 0.03, quantidade: 3 }] }),
    ],
  },
  { nome: "carrinho vazio", itens: [] },
];

describe("invariante Σ totalDaLinha(item) === calcularSubtotal(itens)", () => {
  for (const { nome, itens } of carrinhos) {
    it(`fecha em: ${nome}`, () => {
      const somaDasLinhas = arredondar(
        itens.reduce((acc, i) => acc + totalDaLinha(i), 0),
      );

      expect(somaDasLinhas).toBe(calcularSubtotal(itens));
    });
  }

  it("a soma das linhas do carrinho de RN-20 é 110,00 no subtotal cobrado", () => {
    const itens = [
      item({ preco: 50, quantidade: 2, opcionais: [{ preco: 10, quantidade: 1 }] }),
    ];

    expect(calcularSubtotal(itens)).toBe(110);
    expect(totalDaLinha(itens[0])).toBe(110);
  });
});
