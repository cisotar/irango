import { describe, it, expect } from "vitest";
// RED: este módulo ainda NÃO existe — a fase GREEN (executar) cria
// src/lib/utils/calcularTotal.ts com as funções puras + estes tipos.
import {
  calcularSubtotal,
  calcularTotal,
  type ItemCalculo,
} from "./calcularTotal";

// ---------------------------------------------------------------------------
// Peça central do RECÁLCULO SERVER-SIDE (seguranca.md §10): o cliente NUNCA
// define o quanto paga. O subtotal é derivado APENAS de preço (snapshot do
// banco, em itens_pedido.preco) × quantidade. Nenhum subtotal/total vindo do
// cliente é confiável — por isso calcularSubtotal recebe só { preco, quantidade }
// e calcularTotal recebe componentes JÁ RESOLVIDOS no servidor.
//
// DECISÃO DE CONTRATO (documentada):
//   - calcularSubtotal(itens) → number       (soma preco*quantidade, 2 casas)
//   - calcularTotal({ subtotal, desconto, taxaEntrega }) →
//         { subtotal, desconto, taxaEntrega, total }   (objeto, paridade com
//         ResultadoFrete/ResultadoDesconto que já retornam objeto)
//   - total = max(0, subtotal - desconto) + taxaEntrega
//     → desconto incide no SUBTOTAL antes do frete; o frete NUNCA é descontado.
//     → clamp em 0 ANTES de somar o frete: desconto > subtotal => total = frete.
//
// COMPOSIÇÃO (fora do escopo desta issue): calcularTotal recebe `desconto` já
// produzido por calcularDesconto (009) e `taxaEntrega` já produzida por
// calcularFrete (008). Mantém pureza e evita acoplar esta fn às fontes.
//
// quantidade: schema itens_pedido.quantidade é int CHECK (> 0). Só inteiros
// positivos entram; fração não é caso de negócio (não testado como entrada).
// ---------------------------------------------------------------------------

// ItemCalculo é o subconjunto de itens_pedido que entra no cálculo do subtotal.
// `preco` é o snapshot do banco (autoritativo); `quantidade` int > 0.
function item(over: Partial<ItemCalculo> = {}): ItemCalculo {
  return { preco: 10, quantidade: 1, ...over };
}

describe("calcularSubtotal — soma preco × quantidade (preço do banco)", () => {
  it("soma itens variados (2×10 + 1×5,50 = 25,50)", () => {
    const subtotal = calcularSubtotal([
      item({ preco: 10, quantidade: 2 }),
      item({ preco: 5.5, quantidade: 1 }),
    ]);
    expect(subtotal).toBe(25.5);
  });

  it("lista vazia → subtotal 0", () => {
    expect(calcularSubtotal([])).toBe(0);
  });

  it("um item com quantidade > 1 (3×7,90 = 23,70)", () => {
    expect(calcularSubtotal([item({ preco: 7.9, quantidade: 3 })])).toBe(23.7);
  });

  it("arredonda a 2 casas sem float drift (0.1 + 0.2 = 0.30, não 0.30000000000000004)", () => {
    const subtotal = calcularSubtotal([
      item({ preco: 0.1, quantidade: 1 }),
      item({ preco: 0.2, quantidade: 1 }),
    ]);
    expect(subtotal).toBe(0.3);
  });

  it("arredonda o produto preco×quantidade a 2 casas (0.1 × 3 = 0.30)", () => {
    expect(calcularSubtotal([item({ preco: 0.1, quantidade: 3 })])).toBe(0.3);
  });

  it("usa o preco passado (snapshot do banco) — não há campo de preço do cliente para confiar", () => {
    // O shape ItemCalculo só tem preco+quantidade: não há onde injetar um
    // "preço do cliente". Garante que o subtotal vem do valor autoritativo.
    const subtotal = calcularSubtotal([item({ preco: 99.99, quantidade: 1 })]);
    expect(subtotal).toBe(99.99);
  });
});

describe("calcularTotal — composição subtotal − desconto + frete", () => {
  it("desconto e frete zero → total = subtotal", () => {
    const r = calcularTotal({ subtotal: 50, desconto: 0, taxaEntrega: 0 });
    expect(r).toEqual({
      subtotal: 50,
      desconto: 0,
      taxaEntrega: 0,
      total: 50,
    });
  });

  it("total = subtotal − desconto + frete (100 − 10 + 8 = 98)", () => {
    const r = calcularTotal({ subtotal: 100, desconto: 10, taxaEntrega: 8 });
    expect(r.total).toBe(98);
  });

  it("frete NÃO é descontado: desconto incide só no subtotal (50 − 50 + 7 = 7)", () => {
    const r = calcularTotal({ subtotal: 50, desconto: 50, taxaEntrega: 7 });
    expect(r.total).toBe(7);
  });

  it("desconto MAIOR que o subtotal → clamp em 0 antes do frete (total = frete, nunca negativo)", () => {
    const r = calcularTotal({ subtotal: 30, desconto: 100, taxaEntrega: 5 });
    expect(r.total).toBe(5);
  });

  it("desconto > subtotal e frete 0 → total 0 (nunca negativo)", () => {
    const r = calcularTotal({ subtotal: 30, desconto: 100, taxaEntrega: 0 });
    expect(r.total).toBe(0);
  });

  it("arredonda o total a 2 casas sem float drift (0.1 − 0 + 0.2 = 0.30)", () => {
    const r = calcularTotal({ subtotal: 0.1, desconto: 0, taxaEntrega: 0.2 });
    expect(r.total).toBe(0.3);
  });

  it("devolve os componentes recebidos junto do total (eco para persistência em pedidos)", () => {
    const r = calcularTotal({ subtotal: 100, desconto: 15, taxaEntrega: 8.5 });
    expect(r).toEqual({
      subtotal: 100,
      desconto: 15,
      taxaEntrega: 8.5,
      total: 93.5,
    });
  });
});

describe("calcularTotal — paridade preview (cliente) ↔ recálculo (servidor)", () => {
  // Caso-espelho: o MESMO input deve dar o MESMO resultado nas duas pontas
  // (preview do carrinho na vitrine e Server Action de criar pedido). Pega
  // drift entre o que o cliente mostra e o que o servidor cobra.
  it("mesmo input → mesmo total nas duas chamadas", () => {
    const entrada = { subtotal: 73.4, desconto: 7.34, taxaEntrega: 9.9 };
    const preview = calcularTotal(entrada);
    const servidor = calcularTotal(entrada);
    expect(preview).toEqual(servidor);
    expect(servidor.total).toBe(75.96); // 73.40 − 7.34 + 9.90
  });
});

// ---------------------------------------------------------------------------
// Opcionais de produto (issue 082, revisado em 090)
// Um item pode ter opcionais (adicionais, extras) com preco e quantidade
// próprios. O subtotal do item é:
//   (preco_produto × quantidade_item) + Σ(preco_opcional × qtd_opcional)
// REGRA (090): o opcional é POR LINHA do item — soma UMA vez, NÃO multiplica
// pela quantidade do produto. A qtd do produto multiplica só o preço do produto;
// a qtd do opcional (escolhida pelo cliente) multiplica só o preço do opcional.
// Ex.: 2 pães de 40 + 1 opcional de 20 → (40×2) + (20×1) = 100 (não 120).
// ---------------------------------------------------------------------------

describe("calcularSubtotal — opcionais (adicionais)", () => {
  it("exemplo de negócio (090): 2 pães de 40 + 1 opcional de 20 = 100 (não 120)", () => {
    // opcional é por linha: (40×2) + (20×1) = 80 + 20 = 100
    const subtotal = calcularSubtotal([
      {
        preco: 40,
        quantidade: 2,
        opcionais: [{ preco: 20, quantidade: 1 }],
      },
    ]);
    expect(subtotal).toBe(100);
  });

  it("item com 2 opcionais: (preco × qtd) + Σ(opcional × qtd_opcional)", () => {
    // item: preco=20, qtd=1; opcionais: [3×1, 2×1] → (20×1)+(3+2) = 25
    const subtotal = calcularSubtotal([
      {
        preco: 20,
        quantidade: 1,
        opcionais: [
          { preco: 3, quantidade: 1 },
          { preco: 2, quantidade: 1 },
        ],
      },
    ]);
    expect(subtotal).toBe(25);
  });

  it("item sem opcionais → resultado idêntico ao cálculo original (retrocompat)", () => {
    // Garante que a extensão não quebra o comportamento anterior
    expect(calcularSubtotal([{ preco: 10, quantidade: 2 }])).toBe(20);
    expect(calcularSubtotal([item({ preco: 7.9, quantidade: 3 })])).toBe(23.7);
  });

  it("arredondamento 2 casas sem float drift com opcionais (0.1+0.2 = 0.30)", () => {
    // preco=0, qtd=1; opcional preco=0.1 qtd=1 + opcional preco=0.2 qtd=1
    // → (0×1) + 0.1 + 0.2 = 0.30 (não 0.30000000000000004)
    const subtotal = calcularSubtotal([
      {
        preco: 0,
        quantidade: 1,
        opcionais: [
          { preco: 0.1, quantidade: 1 },
          { preco: 0.2, quantidade: 1 },
        ],
      },
    ]);
    expect(subtotal).toBe(0.3);
  });

  it("qtd do item NÃO multiplica os opcionais — só o preço do produto (090)", () => {
    // item: preco=15, qtd=2; opcionais: [preco=5, qtd=1]
    // → (15×2) + (5×1) = 35  (antes era (15+5)×2 = 40)
    const subtotal = calcularSubtotal([
      {
        preco: 15,
        quantidade: 2,
        opcionais: [{ preco: 5, quantidade: 1 }],
      },
    ]);
    expect(subtotal).toBe(35);
  });

  it("opcional com quantidade > 1: preco_opcional × qtd_opcional (2 queijos extras)", () => {
    // item: preco=10, qtd=1; opcional preco=2 qtd=3 → (10×1) + (2×3) = 16
    const subtotal = calcularSubtotal([
      {
        preco: 10,
        quantidade: 1,
        opcionais: [{ preco: 2, quantidade: 3 }],
      },
    ]);
    expect(subtotal).toBe(16);
  });

  it("múltiplos itens, alguns com e alguns sem opcionais", () => {
    // item1: preco=10, qtd=1, sem opcionais → 10
    // item2: preco=5, qtd=2, opcional [preco=1, qtd=2] → (5×2) + (1×2) = 12
    // total = 22
    const subtotal = calcularSubtotal([
      { preco: 10, quantidade: 1 },
      {
        preco: 5,
        quantidade: 2,
        opcionais: [{ preco: 1, quantidade: 2 }],
      },
    ]);
    expect(subtotal).toBe(22);
  });
});
