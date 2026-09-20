/**
 * [237/238] Ambiente: vitest `environment: node`, sem jsdom — `renderToStaticMarkup`
 * e asserção sobre o HTML, mesma estratégia de `SeloDesconto.test.tsx`. O que
 * se prova aqui é o que o componente NÃO renderiza em cada estado: é onde o
 * cliente perderia dinheiro de confiança ("Desconto R$ 0,00") ou seria
 * tratado como culpado por uma promoção que acabou.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ResumoValores } from "./ResumoValores";
import type { EstadoCupom } from "@/lib/actions/revisarCarrinho-contrato";

const CHEIO: EstadoCupom = { estado: "cheio", codigo: "PROMO10", desconto: 14 };
const PARCIAL: EstadoCupom = {
  estado: "parcial",
  codigo: "PROMO10",
  desconto: 6,
  baseElegivel: 60,
  baseProdutos: 50,
  baseOpcionais: 10,
};
const ZERO: EstadoCupom = { estado: "zero", codigo: "PROMO10" };

function render(props: Partial<React.ComponentProps<typeof ResumoValores>>) {
  return renderToStaticMarkup(
    <ResumoValores subtotal={140} frete={0} total={134} {...props} />,
  );
}

describe("[237] estado A — desconto cheio", () => {
  const html = render({ cupom: CHEIO, total: 126 });

  it("linha com valor, SEM frase explicativa", () => {
    expect(html).toContain("Cupom PROMO10");
    expect(html).toContain("R$ 14,00");
    expect(html).not.toContain("Não acumula com promoção");
  });

  it("sem disclosure — não há o que explicar", () => {
    expect(html).not.toContain("Como calculamos");
  });
});

describe("[237] estado B — desconto parcial", () => {
  const html = render({ cupom: PARCIAL });

  it("a frase obrigatória de RN-10-e aparece, com `adicionais incluídos`", () => {
    expect(html).toContain("Não acumula com promoção");
    expect(html).toContain("adicionais incluídos");
  });

  it("disclosure FECHADO por padrão, botão de 44px com aria-expanded", () => {
    expect(html).toContain("Como calculamos");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("min-h-11");
    // Fechado ⇒ as parcelas não estão no DOM.
    expect(html).not.toContain("Itens fora da promoção");
  });
});

describe("[237] estado C — desconto zero", () => {
  // `mostrarFrete: false` para isolar o bloco do cupom: um frete de
  // R$ 0,00 (retirada) é outra linha, e não o desconto.
  const html = render({
    cupom: ZERO,
    subtotal: 80,
    total: 80,
    mostrarFrete: false,
  });

  it("NENHUMA linha de valor de desconto — `R$ 0,00` não existe", () => {
    expect(html).toContain("Cupom PROMO10 aplicado");
    expect(html).not.toContain("R$ 0,00");
    expect(html).not.toContain("− R$");
  });

  it("a frase de estado explica por que não houve desconto", () => {
    expect(html).toContain("não há nada fora da promoção para descontar");
  });
});

describe("[237] linha `Você economizou`", () => {
  it("sem o número do servidor, a linha NÃO é renderizada", () => {
    expect(render({ economiaProdutos: null })).not.toContain("Você economizou");
    expect(render({ economiaProdutos: 0 })).not.toContain("Você economizou");
  });

  it("com o número pronto do servidor, aparece com o token de promoção", () => {
    const html = render({ economiaProdutos: 20 });
    expect(html).toContain("Você economizou");
    expect(html).toContain("R$ 20,00");
    expect(html).toContain("text-promo-texto");
  });
});

describe("[237] só o bloco do cupom é live region", () => {
  it('o resumo inteiro NÃO é aria-live; o bloco do cupom é role="status"', () => {
    const html = render({ cupom: PARCIAL });
    expect(html.match(/aria-live="polite"/g)?.length).toBe(1);
    expect(html).toContain('role="status"');
  });
});

describe('[238/D11] faixa de "preço caiu"', () => {
  const html = render({
    avisoPrecoCaiu: {
      titulo: "Boa notícia: a Feijoada completa entrou em promoção.",
      corpo: "De R$ 100,00 por R$ 80,00. Novo total estimado: R$ 130,00.",
    },
  });

  it("persistente no topo do resumo, com os tokens de promoção", () => {
    expect(html).toContain("Boa notícia");
    expect(html).toContain("bg-promo-fundo");
    expect(html).toContain("border-promo-borda");
  });

  it("anunciada sem interromper e SEM linguagem de erro", () => {
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
    for (const palavra of ["erro", "falha", "desculpe", "não foi possível"]) {
      expect(html.toLowerCase()).not.toContain(palavra);
    }
  });
});
