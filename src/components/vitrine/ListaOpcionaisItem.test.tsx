/**
 * Testes do ListaOpcionaisItem (issue 131).
 *
 * Ambiente: vitest environment=node — sem jsdom.
 * Estratégia: renderToStaticMarkup (react-dom/server) para asserções sobre o
 * HTML gerado, idêntica ao padrão de HeaderLoja.test.tsx.
 *
 * Foco: provar a prop aditiva `ocultarPreco`:
 *   - omitida/false → mantém o preço (comportamento dos callers atuais).
 *   - true          → nenhum valor monetário no DOM (via da cozinha).
 * A formatação BRL em si é da fonte única formatarMoeda.test.ts — aqui só
 * provamos que o componente EXIBE ou OCULTA o <span> do valor.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ListaOpcionaisItem,
  type OpcionalExibicao,
} from "@/components/vitrine/ListaOpcionaisItem";

const OPCIONAIS: OpcionalExibicao[] = [
  { id: "op-1", nome: "Bacon", preco: 3.5, quantidade: 2 },
  { id: "op-2", nome: "Cheddar", preco: 2, quantidade: 1 },
];

function render(
  overrides: Partial<Parameters<typeof ListaOpcionaisItem>[0]> = {},
): string {
  return renderToStaticMarkup(
    <ListaOpcionaisItem opcionais={OPCIONAIS} {...overrides} />,
  );
}

describe("ocultarPreco omitido/false — comportamento dos callers atuais", () => {
  it("renderiza o valor do opcional (preco * quantidade) por default", () => {
    const html = render();
    // 3,50 × 2 = R$ 7,00 e 2,00 × 1 = R$ 2,00
    expect(html).toContain("7,00");
    expect(html).toContain("2,00");
  });

  it("ocultarPreco={false} explícito é idêntico ao default (mantém o preço)", () => {
    expect(render({ ocultarPreco: false })).toBe(render());
  });

  it("mostra nome e quantidade de cada opcional", () => {
    const html = render();
    expect(html).toContain("Bacon");
    expect(html).toContain("Cheddar");
    expect(html).toContain("2×");
  });
});

describe("ocultarPreco={true} — via da cozinha", () => {
  it("não renderiza nenhum valor monetário no DOM", () => {
    const html = render({ ocultarPreco: true });
    expect(html).not.toContain("R$");
    expect(html).not.toContain("7,00");
    expect(html).not.toContain("2,00");
  });

  it("ainda exibe nome e quantidade de cada opcional", () => {
    const html = render({ ocultarPreco: true });
    expect(html).toContain("Bacon");
    expect(html).toContain("Cheddar");
    expect(html).toContain("2×");
  });
});

describe("lista vazia — invariante mantida", () => {
  it("não renderiza nada, independente de ocultarPreco", () => {
    expect(
      renderToStaticMarkup(<ListaOpcionaisItem opcionais={[]} />),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <ListaOpcionaisItem opcionais={[]} ocultarPreco />,
      ),
    ).toBe("");
  });
});
