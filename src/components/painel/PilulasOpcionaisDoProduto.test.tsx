/**
 * Fase RED (TDD) da issue 331 — fatia F5: `PilulasOpcionaisDoProduto`, as
 * pílulas clicáveis que hoje são `Badge` estático em `ProdutosClient.tsx`
 * (a lista "Opcionais da categoria …" de cada linha de produto).
 *
 * Só apresentação: quem responde "está oculto?" é `ocultacoes.oculto` (o hook,
 * fonte única) e quem grava é `ocultacoes.alternar`. Nenhuma regra aqui.
 *
 * Ambiente: vitest environment=node, sem jsdom — `renderToStaticMarkup`, mesmo
 * padrão de `PilulasDeDias.test.tsx` (o precedente de pílula `aria-pressed`).
 * O clique não é observável aqui; o DOM de saída é.
 *
 * Contrato do estado na pílula:
 *   aria-pressed="true"  → o grupo APARECE neste produto;
 *   aria-pressed="false" → oculto: esmaecida, riscada (`line-through`) e com o
 *                          texto "oculto" (a cor/risco não carregam o estado sozinhos).
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PilulasOpcionaisDoProduto } from "./PilulasOpcionaisDoProduto";

const P = "prod-1";
const NOME = "X-Burger";
const GRUPOS = [
  // Fora de ordem de propósito: a pílula segue `ordem` da categoria.
  { categoriaOpcionalId: "g-molhos", categoriaOpcionalNome: "Molhos", ordem: 2 },
  { categoriaOpcionalId: "g-adic", categoriaOpcionalNome: "Adicionais", ordem: 0 },
  { categoriaOpcionalId: "g-bebida", categoriaOpcionalNome: "Bebidas", ordem: 1 },
];

function ocultacoes(ocultos: string[] = []) {
  return {
    oculto: (produtoId: string, grupoId: string) =>
      produtoId === P && ocultos.includes(grupoId),
    alternar: vi.fn(async () => true),
  };
}

function montar(
  props: Partial<React.ComponentProps<typeof PilulasOpcionaisDoProduto>> = {},
): string {
  return renderToStaticMarkup(
    <PilulasOpcionaisDoProduto
      produtoId={P}
      produtoNome={NOME}
      grupos={GRUPOS}
      ocultacoes={ocultacoes()}
      variante="card"
      {...props}
    />,
  );
}

/** O trecho `<button ...>...</button>` que contém o nome do grupo. */
function botaoDo(html: string, grupoNome: string): string {
  const botoes = html.split("<button").slice(1).map((b) => `<button${b.split("</button>")[0]}`);
  const achado = botoes.find((b) => b.includes(grupoNome));
  if (!achado) throw new Error(`pílula de ${grupoNome} não encontrada`);
  return achado;
}

describe("331 F5 · PilulasOpcionaisDoProduto — variante card", () => {
  it("uma pílula por grupo da categoria, cada uma um <button type=button> com aria-pressed", () => {
    const html = montar();
    expect((html.match(/<button/g) ?? []).length).toBe(3);
    expect((html.match(/type="button"/g) ?? []).length).toBe(3);
    expect((html.match(/aria-pressed="/g) ?? []).length).toBe(3);
  });

  it("pílulas na ORDEM da categoria (`ordem`), não na ordem de chegada", () => {
    const html = montar();
    const iA = html.indexOf("Adicionais");
    const iB = html.indexOf("Bebidas");
    const iM = html.indexOf("Molhos");
    expect(iA).toBeGreaterThan(-1);
    expect(iA).toBeLessThan(iB);
    expect(iB).toBeLessThan(iM);
  });

  it("nada oculto → todas aria-pressed=true, sem risco e sem a palavra 'oculto'", () => {
    const html = montar();
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(3);
    expect(html).not.toContain("line-through");
    expect(html.toLowerCase()).not.toContain("oculto");
  });

  it("grupo oculto no produto → aria-pressed=false, riscado e com o texto 'oculto'; os outros intactos", () => {
    const html = montar({ ocultacoes: ocultacoes(["g-bebida"]) });
    const bebida = botaoDo(html, "Bebidas");
    expect(bebida).toContain('aria-pressed="false"');
    expect(bebida).toContain("line-through");
    expect(bebida.toLowerCase()).toContain("oculto");

    const adic = botaoDo(html, "Adicionais");
    expect(adic).toContain('aria-pressed="true"');
    expect(adic).not.toContain("line-through");
  });

  it("o nome acessível de cada pílula diz o GRUPO e o PRODUTO (várias linhas têm as mesmas pílulas)", () => {
    const html = montar();
    const adic = botaoDo(html, "Adicionais");
    const label = adic.match(/aria-label="([^"]*)"/)?.[1] ?? "";
    expect(label).toContain("Adicionais");
    expect(label).toContain(NOME);
  });

  it("render não grava: `alternar` não é chamado", () => {
    const o = ocultacoes();
    montar({ ocultacoes: o });
    expect(o.alternar).not.toHaveBeenCalled();
  });

  it("categoria sem grupo → não renderiza nada (como o Badge de hoje)", () => {
    expect(montar({ grupos: [] })).toBe("");
  });
});

describe("331 F5 · PilulasOpcionaisDoProduto — variante form (modal do produto)", () => {
  it("as mesmas pílulas e o mesmo estado da variante card (uma fonte, duas vistas)", () => {
    const o = ocultacoes(["g-molhos"]);
    const card = montar({ ocultacoes: o, variante: "card" });
    const form = montar({ ocultacoes: o, variante: "form" });
    for (const html of [card, form]) {
      expect((html.match(/<button/g) ?? []).length).toBe(3);
      expect(botaoDo(html, "Molhos")).toContain('aria-pressed="false"');
      expect(botaoDo(html, "Adicionais")).toContain('aria-pressed="true"');
    }
  });
});
