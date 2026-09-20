import { describe, it, expect } from "vitest";
// RED (issue 227, fatia crítica 3): `derivarBasesCupom` ainda é um STUB que
// lança "TODO: GREEN". A fase GREEN (`executar`) implementa, reusando
// `totalDaLinha`/`calcularSubtotal` (D-2) — nunca uma segunda soma.
import {
  derivarBasesCupom,
  type ComponentesLinha,
} from "./derivarBasesCupom";
import { calcularDesconto, type CupomCalculo } from "./calcularDesconto";
import {
  calcularSubtotal,
  calcularTotal,
  type ItemCalculo,
} from "./calcularTotal";
import { arredondar } from "./arredondar";

// ---------------------------------------------------------------------------
// D5  — cupom não acumula com desconto de produto.
// D9  — a unidade da base é o COMPONENTE, não a linha: o opcional (que nunca
//       recebeu desconto, D8) SEMPRE entra, inclusive grudado numa linha
//       promocional.
// D5-a— o gate de pedido_minimo continua olhando o SUBTOTAL, nunca a base.
//
// Todos os números abaixo vêm do spec (RN-10-a/b/c/d/e), não do código.
// Valor monetário é afirmado com `toBe` — `toBeCloseTo` esconderia o centavo
// de float que separa o estado A do estado B de RN-10-e.
// ---------------------------------------------------------------------------

function linha(over: Partial<ComponentesLinha> = {}): ComponentesLinha {
  return {
    precoProduto: { precoEfetivo: 50, temDesconto: false },
    quantidade: 1,
    opcionais: [],
    ...over,
  };
}

function cupom(over: Partial<CupomCalculo> = {}): CupomCalculo {
  return { tipo: "percentual", valor: 10, pedido_minimo: 0, ...over };
}

/** O mapeamento que `derivarBasesCupom` faz internamente para o subtotal.
 *  Reproduzido aqui só para AFIRMAR a igualdade com `calcularSubtotal`. */
function mapear(linhas: ComponentesLinha[]): ItemCalculo[] {
  return linhas.map((l) => ({
    preco: l.precoProduto.precoEfetivo,
    quantidade: l.quantidade,
    opcionais: l.opcionais,
  }));
}

/** Invariantes que valem em TODOS os cenários (plano técnico §Cenários). */
function afirmarInvariantes(linhas: ComponentesLinha[]) {
  const bases = derivarBasesCupom(linhas);
  // baseElegivel é a soma das duas parcelas — por construção, não coincidência.
  expect(bases.baseElegivel).toBe(
    arredondar(bases.baseProdutos + bases.baseOpcionais),
  );
  // o subtotal NÃO é recalculado: é o mesmo número que o pedido grava.
  expect(bases.subtotal).toBe(calcularSubtotal(mapear(linhas)));
  // a base nunca pode exceder o subtotal nem ser negativa.
  expect(bases.baseElegivel).toBeGreaterThanOrEqual(0);
  expect(bases.baseElegivel).toBeLessThanOrEqual(bases.subtotal);
  return bases;
}

// Carrinho misto canônico de RN-10-a / RN-10-b:
// Feijoada R$ 100,00 a −20% ⇒ efetivo R$ 80,00 ×1 (TEM desconto)
// Refrigerante R$ 50,00 ×1 (sem desconto)
const CARRINHO_MISTO: ComponentesLinha[] = [
  {
      precoProduto: { precoEfetivo: 80, temDesconto: true },
      quantidade: 1,
      opcionais: [],
    },
  {
      precoProduto: { precoEfetivo: 50, temDesconto: false },
      quantidade: 1,
      opcionais: [],
    },
];

describe("derivarBasesCupom — RN-10-a (carrinho misto, D5)", () => {
  it("subtotal 130 e base elegível 50 (só o refrigerante entra)", () => {
    const bases = afirmarInvariantes(CARRINHO_MISTO);
    expect(bases.subtotal).toBe(130);
    expect(bases.baseProdutos).toBe(50);
    expect(bases.baseOpcionais).toBe(0);
    expect(bases.baseElegivel).toBe(50);
  });

  it("cupom de 10% desconta 5 (não 13) e o total fica 125", () => {
    const bases = derivarBasesCupom(CARRINHO_MISTO);
    const r = calcularDesconto(
      cupom({ tipo: "percentual", valor: 10, pedido_minimo: 100 }),
      bases,
    );
    expect(r.aplicado).toBe(true);
    expect(r.desconto).toBe(5);
    expect(r.baseElegivel).toBe(50);
    const { total } = calcularTotal({
      subtotal: bases.subtotal,
      desconto: r.desconto,
      taxaEntrega: 0,
    });
    expect(total).toBe(125);
  });
});

describe("derivarBasesCupom — RN-10-b (clamp pela BASE, não pelo subtotal)", () => {
  it("cupom fixo de 80 sobre base de 50 desconta 50 (não 80) e o total fica 80", () => {
    const bases = afirmarInvariantes(CARRINHO_MISTO);
    const r = calcularDesconto(cupom({ tipo: "fixo", valor: 80, pedido_minimo: 0 }), bases);
    expect(r.aplicado).toBe(true);
    // Com o clamp antigo (teto no subtotal) seriam 80 — R$ 30,00 de prejuízo
    // do lojista por pedido.
    expect(r.desconto).toBe(50);
    expect(r.desconto).toBeLessThanOrEqual(bases.baseElegivel);
    const { total } = calcularTotal({
      subtotal: bases.subtotal,
      desconto: r.desconto,
      taxaEntrega: 0,
    });
    expect(total).toBe(80);
  });
});

describe("derivarBasesCupom — RN-10-c (caso puro: base zero)", () => {
  it("só a Feijoada 100 a 20%, sem adicional: base 0, desconto 0, total 80", () => {
    const linhas: ComponentesLinha[] = [
      {
      precoProduto: { precoEfetivo: 80, temDesconto: true },
      quantidade: 1,
      opcionais: [],
    },
    ];
    const bases = afirmarInvariantes(linhas);
    expect(bases.subtotal).toBe(80);
    expect(bases.baseProdutos).toBe(0);
    expect(bases.baseOpcionais).toBe(0);
    expect(bases.baseElegivel).toBe(0);

    const r = calcularDesconto(cupom({ tipo: "percentual", valor: 10 }), bases);
    // `aplicado` = "passou no gate de pedido mínimo", NUNCA "descontou dinheiro".
    expect(r.aplicado).toBe(true);
    expect(r.motivo).toBe(null);
    expect(r.desconto).toBe(0);
    expect(r.baseElegivel).toBe(0);
    const { total } = calcularTotal({
      subtotal: bases.subtotal,
      desconto: r.desconto,
      taxaEntrega: 0,
    });
    expect(total).toBe(80);
  });
});

describe("derivarBasesCupom — RN-10-d (D9: o opcional de linha promocional ENTRA)", () => {
  // Linha 1: pizza R$ 80,00 (de 100, −20%) + borda recheada R$ 10,00 ⇒ 90
  // Linha 2: refrigerante R$ 50,00, sem desconto, sem adicional     ⇒ 50
  const linhas: ComponentesLinha[] = [
    {
      precoProduto: { precoEfetivo: 80, temDesconto: true },
      quantidade: 1,
      opcionais: [{ preco: 10, quantidade: 1 }],
    },
    {
      precoProduto: { precoEfetivo: 50, temDesconto: false },
      quantidade: 1,
      opcionais: [],
    },
  ];

  it("subtotal 140, baseProdutos 50, baseOpcionais 10, baseElegivel 60", () => {
    const bases = afirmarInvariantes(linhas);
    expect(bases.subtotal).toBe(140);
    expect(bases.baseProdutos).toBe(50);
    // a borda de R$ 10,00 está DENTRO da base apesar da linha ser promocional.
    expect(bases.baseOpcionais).toBe(10);
    expect(bases.baseElegivel).toBe(60);
  });

  it("cupom de 10% desconta 6 (não 14, não 5) e o total fica 134", () => {
    const bases = derivarBasesCupom(linhas);
    const r = calcularDesconto(cupom({ tipo: "percentual", valor: 10 }), bases);
    expect(r.desconto).toBe(6);
    expect(r.baseElegivel).toBe(60);
    const { total } = calcularTotal({
      subtotal: bases.subtotal,
      desconto: r.desconto,
      taxaEntrega: 0,
    });
    expect(total).toBe(134);
  });
});

describe("derivarBasesCupom — RN-10-d variação B (× qtd DO OPCIONAL)", () => {
  // 2 pizzas promocionais + 1 borda: o opcional é POR LINHA, soma UMA vez e
  // multiplica pela quantidade DO OPCIONAL, não pela do produto.
  const linhas: ComponentesLinha[] = [
    {
      precoProduto: { precoEfetivo: 80, temDesconto: true },
      quantidade: 2,
      opcionais: [{ preco: 10, quantidade: 1 }],
    },
  ];

  it("base da linha é 10,00 — não 20,00 (multiplicar pela qtd do produto infla o desconto)", () => {
    const bases = afirmarInvariantes(linhas);
    expect(bases.subtotal).toBe(170);
    expect(bases.baseProdutos).toBe(0);
    expect(bases.baseOpcionais).toBe(10);
    expect(bases.baseElegivel).toBe(10);
  });

  it("cupom de 10% desconta 1 e o total fica 169", () => {
    const bases = derivarBasesCupom(linhas);
    const r = calcularDesconto(cupom({ tipo: "percentual", valor: 10 }), bases);
    expect(r.desconto).toBe(1);
    const { total } = calcularTotal({
      subtotal: bases.subtotal,
      desconto: r.desconto,
      taxaEntrega: 0,
    });
    expect(total).toBe(169);
  });
});

describe("derivarBasesCupom — D5-a: a régua do pedido mínimo é o SUBTOTAL", () => {
  it("ACEITA com subtotal 130 >= mínimo 100, embora a base seja só 50", () => {
    const bases = derivarBasesCupom(CARRINHO_MISTO);
    expect(bases.subtotal).toBe(130);
    expect(bases.baseElegivel).toBe(50);
    const r = calcularDesconto(
      cupom({ tipo: "percentual", valor: 10, pedido_minimo: 100 }),
      bases,
    );
    // Se o gate olhasse a base (50 < 100) este cupom seria recusado.
    expect(r.aplicado).toBe(true);
    expect(r.motivo).toBe(null);
    expect(r.desconto).toBe(5);
  });

  it("RECUSA com subtotal 130 < mínimo 130.01 (sentido inverso)", () => {
    const bases = derivarBasesCupom(CARRINHO_MISTO);
    const r = calcularDesconto(
      cupom({ tipo: "percentual", valor: 10, pedido_minimo: 130.01 }),
      bases,
    );
    expect(r.aplicado).toBe(false);
    expect(r.desconto).toBe(0);
    expect(r.motivo).toBe("pedido_minimo");
    // D-4: o eco descreve a BASE, não o veredito.
    expect(r.baseElegivel).toBe(50);
  });
});

describe("derivarBasesCupom — bordas", () => {
  it("nada em promoção: baseElegivel === subtotal por igualdade EXATA (estado A, RN-10-e)", () => {
    const linhas: ComponentesLinha[] = [
      linha({
        precoProduto: { precoEfetivo: 33.33, temDesconto: false },
        quantidade: 3,
        opcionais: [{ preco: 7.77, quantidade: 2 }],
      }),
      linha({
        precoProduto: { precoEfetivo: 19.99, temDesconto: false },
        quantidade: 1,
        opcionais: [],
      }),
    ];
    const bases = afirmarInvariantes(linhas);
    expect(bases.baseElegivel).toBe(bases.subtotal);
    expect(bases.baseOpcionais).toBe(15.54);
  });

  it("carrinho vazio: tudo zero", () => {
    const bases = afirmarInvariantes([]);
    expect(bases.subtotal).toBe(0);
    expect(bases.baseProdutos).toBe(0);
    expect(bases.baseOpcionais).toBe(0);
    expect(bases.baseElegivel).toBe(0);
  });
});
