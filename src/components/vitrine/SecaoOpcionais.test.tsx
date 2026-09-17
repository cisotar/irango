/**
 * Testes da seção "Opcionais" do ProdutoModal (issue 210).
 *
 * Ambiente: vitest environment=node — sem jsdom. Estratégia: renderToStaticMarkup,
 * mesmo padrão de ListaOpcionaisItem.test.tsx / HeaderLoja.test.tsx.
 *
 * Por que `SecaoOpcionais` e não `ProdutoModal`: o `Dialog` (base-ui) monta em
 * portal e `renderToStaticMarkup(<ProdutoModal open .../>)` devolve string VAZIA —
 * a seção foi extraída justamente para ficar testável sem browser. Abrir/fechar por
 * toque, leitor de tela e animação continuam CHECKPOINT HUMANO (não há Playwright
 * nem MCP de browser nesta máquina).
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SecaoOpcionais } from "@/components/vitrine/SecaoOpcionais";
import {
  achatarOpcionaisEscolhidos,
  contarEscolhidosDoGrupo,
  rotuloGrupoOpcional,
} from "@/components/vitrine/escolhasOpcionais";
import { calcularSubtotal } from "@/lib/utils/calcularTotal";
import type { GrupoOpcional } from "@/lib/supabase/queries/produtos";

const MOLHOS: GrupoOpcional = {
  categoriaOpcionalId: "g-molhos",
  categoriaOpcionalNome: "Molhos",
  ordem: 0,
  opcionais: [
    { id: "o-maionese", nome: "Maionese", preco: 1, ordem: 0 },
    { id: "o-barbecue", nome: "Barbecue", preco: 2, ordem: 1 },
  ],
};

const QUEIJOS: GrupoOpcional = {
  categoriaOpcionalId: "g-queijos",
  categoriaOpcionalNome: "Queijos",
  ordem: 1,
  opcionais: [{ id: "o-cheddar", nome: "Cheddar", preco: 3, ordem: 0 }],
};

function render(grupos: GrupoOpcional[], qtds: Record<string, number> = {}) {
  return renderToStaticMarkup(
    <SecaoOpcionais grupos={grupos} qtdOpcionais={qtds} onAjustar={() => {}} />,
  );
}

describe("D-3 — limiar literal grupos.length > 1", () => {
  it("2+ grupos: cada grupo vira um gatilho de sanfona, NA ORDEM RECEBIDA", () => {
    const html = render([QUEIJOS, MOLHOS]);
    // Gatilhos são <button> com aria-expanded (WCAG AA).
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-expanded="false"');
    // ordem recebida (o servidor ordenou; o cliente não reordena nada)
    expect(html.indexOf("Queijos")).toBeLessThan(html.indexOf("Molhos"));
  });

  it("exatamente 1 grupo: lista plana, sem gatilho de sanfona", () => {
    const html = render([MOLHOS]);
    // `aria-expanded="` com o sinal de igual: a classe do Button traz a VARIANTE
    // Tailwind `aria-expanded:bg-muted`, que não é atributo.
    expect(html).not.toContain('aria-expanded="');
    expect(html).not.toContain('data-slot="accordion-trigger"');
    // os itens aparecem todos, sem clique extra
    expect(html).toContain("Maionese");
    expect(html).toContain("Barbecue");
  });

  it("0 grupos: a seção não existe", () => {
    expect(render([])).toBe("");
  });
});

describe("D-2 — estado inicial da sanfona", () => {
  it("o 1º grupo nasce ABERTO e os demais FECHADOS", () => {
    const html = render([MOLHOS, QUEIJOS]);
    const primeiro = html.indexOf('aria-expanded="true"');
    const segundo = html.indexOf('aria-expanded="false"');
    expect(primeiro).toBeGreaterThanOrEqual(0);
    expect(segundo).toBeGreaterThan(primeiro);
    // itens do grupo aberto estão no DOM inicial
    expect(html).toContain("Maionese");
  });
});

describe("Badge e rótulo acessível do cabeçalho (RN-9)", () => {
  it("cabeçalho nomeia a categoria e o total escolhido, em pt-BR", () => {
    const html = render([MOLHOS, QUEIJOS], { "o-maionese": 2 });
    expect(html).toContain('aria-label="Molhos, 2 escolhidos"');
    // grupo sem escolha nenhuma: só o nome
    expect(html).toContain('aria-label="Queijos"');
  });

  it("Badge mostra a SOMA das quantidades do grupo", () => {
    expect(
      contarEscolhidosDoGrupo(MOLHOS, { "o-maionese": 2, "o-barbecue": 1 }),
    ).toBe(3);
    expect(contarEscolhidosDoGrupo(MOLHOS, {})).toBe(0);
  });

  it("rotuloGrupoOpcional: singular, plural e sem escolha", () => {
    expect(rotuloGrupoOpcional("Molhos", 0)).toBe("Molhos");
    expect(rotuloGrupoOpcional("Molhos", 1)).toBe("Molhos, 1 escolhido");
    expect(rotuloGrupoOpcional("Molhos", 2)).toBe("Molhos, 2 escolhidos");
  });

  it("recolher NÃO limpa quantidade: o stepper do grupo aberto continua refletindo o estado", () => {
    const html = render([MOLHOS, QUEIJOS], { "o-maionese": 2 });
    expect(html).toContain('aria-label="Maionese: 2"');
  });
});

describe("REGRESSÃO DE VALOR — o achatamento é sobre `grupos`, não sobre a tela", () => {
  // O risco real da 210: se `opcionaisEscolhidos` passasse a varrer só o que está
  // visível, o opcional escolhido num grupo depois RECOLHIDO sumiria do carrinho.
  const qtds = { "o-maionese": 2, "o-cheddar": 1 };

  it("opcional de grupo FECHADO com qtd > 0 continua no payload de onAdicionar", () => {
    // MOLHOS nasce aberto; QUEIJOS nasce FECHADO — e o Cheddar dele está escolhido.
    const html = render([MOLHOS, QUEIJOS], qtds);
    expect(html).not.toContain("Cheddar"); // painel fechado não está no DOM

    const escolhidos = achatarOpcionaisEscolhidos([MOLHOS, QUEIJOS], qtds);
    expect(escolhidos.map((o) => o.opcionalId)).toEqual(["o-maionese", "o-cheddar"]);
    expect(escolhidos.find((o) => o.opcionalId === "o-cheddar")?.quantidade).toBe(1);
  });

  it("opcional de grupo FECHADO com qtd > 0 continua no subtotal PREVIEW", () => {
    const escolhidos = achatarOpcionaisEscolhidos([MOLHOS, QUEIJOS], qtds);
    const subtotal = calcularSubtotal([
      {
        preco: 10,
        quantidade: 1,
        opcionais: escolhidos.map((o) => ({ preco: o.preco, quantidade: o.quantidade })),
      },
    ]);
    // 10 + (1,00 × 2 maionese) + (3,00 × 1 cheddar) = 15,00
    expect(subtotal).toBe(15);
  });

  it("opcional com qtd 0 fica FORA (comportamento inalterado)", () => {
    expect(achatarOpcionaisEscolhidos([MOLHOS], { "o-maionese": 0 })).toEqual([]);
    expect(achatarOpcionaisEscolhidos([MOLHOS], {})).toEqual([]);
  });
});

describe("mini-stepper inalterado", () => {
  it("mantém rótulos de Remover/Adicionar e o grupo de quantidade por opcional", () => {
    const html = render([MOLHOS]);
    expect(html).toContain('aria-label="Quantidade de Maionese"');
    expect(html).toContain('aria-label="Remover Maionese"');
    expect(html).toContain('aria-label="Adicionar Maionese"');
    expect(html).toContain('aria-label="Maionese: 0"');
  });

  it("exibe o preço PREVIEW de cada opcional em BRL", () => {
    expect(render([MOLHOS])).toContain("2,00");
  });
});
