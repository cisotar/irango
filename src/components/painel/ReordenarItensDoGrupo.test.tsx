/**
 * Testes de MARKUP da lista de ITENS de um grupo de opcional (issue 216).
 *
 * Ambiente: vitest com `environment: node`, sem jsdom. `renderToStaticMarkup`
 * prova DERIVAÇÃO DE ESTADO → HTML, não clique. A coalescência/debounce está em
 * `salvamento-coalescido.test.ts` e o deslocamento em `reordenar.test.ts` —
 * nenhum dos dois é reteste aqui.
 *
 * O foco deste arquivo é a diferença que justifica a casca existir: `semArrasto`
 * e a `mensagemInicial` que NÃO promete um gesto inexistente.
 *
 * LIMITE CONHECIDO, e é honesto declará-lo: o `<Accessibility>` do dnd-kit (as
 * instruções "pressione espaço para arrastar" e a `aria-live` própria dele) é
 * renderizado em PORTAL para `document.body`, que não existe em
 * `renderToStaticMarkup`. Logo ele NÃO aparece no HTML aqui nem com o
 * `DndContext` montado — conferido contra a lista de grupos, que é arrastável.
 * A garantia de que `semArrasto` não monta o contexto é ESTRUTURAL (o
 * `ModoReordenar` renderiza o `<ol>` direto) e o efeito no leitor de tela é item
 * de verificação manual, não de asserção de markup. O que dá para provar aqui, e
 * está provado abaixo, é que NADA na copy desta lista promete arrastar e que a
 * alça não é renderizada.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ReordenarItensDoGrupo } from "./ReordenarItensDoGrupo";
import { ReordenarOpcionaisDaCategoria } from "./ReordenarOpcionaisDaCategoria";

const ITENS = [
  { id: "o-1", nome: "Catupiry" },
  { id: "o-2", nome: "Cheddar" },
  { id: "o-3", nome: "Requeijão" },
];

function render(itens = ITENS): string {
  return renderToStaticMarkup(
    <ReordenarItensDoGrupo
      grupoId="co-1"
      grupoNome="Bordas"
      itens={itens}
      onReordenar={async () => ({ ok: true })}
      renderLinha={({ item, indice, total }) => (
        <li>
          {indice + 1}. {item.nome} de {total}
        </li>
      )}
    />,
  );
}

describe("ReordenarItensDoGrupo — sem arrasto (issue 216)", () => {
  it("NÃO emite a alça de arrasto", () => {
    // Uma alça aqui seria DndContext dentro de DndContext, com o `pointerdown`
    // da alça interna borbulhando para o sensor externo.
    expect(render()).not.toContain("Reordenar ");
  });

  it("NADA na copy desta lista promete arrastar", () => {
    // Descrever um gesto que não existe é bug de acessibilidade, não detalhe de
    // copy. Pega a `mensagemInicial`, `aria-label` e qualquer texto visível.
    expect(render()).not.toMatch(/arrast/i);
  });

  it("emite UMA só região viva neste subtree", () => {
    // Guarda contra alguém acrescentar uma segunda `aria-live` nossa: duas para
    // a mesma classe de evento silenciam ou duplicam o anúncio.
    const html = render();
    expect((html.match(/aria-live="polite"/g) ?? []).length).toBe(1);
  });

  it("a mensagem inicial fala em BOTÕES, nunca em arrastar, e singulariza", () => {
    expect(render()).toContain(
      "3 opcionais no grupo Bordas, na ordem da vitrine. " +
        "Use os botões mover para cima e mover para baixo.",
    );
    expect(render()).not.toContain("arrast");
    expect(render([ITENS[0]])).toContain("1 opcional no grupo Bordas");
  });

  it("delega o desenho da linha ao `renderLinha`, dentro de um `<ol>`", () => {
    const html = render();
    expect(html).toContain("<ol");
    expect(html).toContain("1. Catupiry de 3");
    expect(html).toContain("3. Requeijão de 3");
  });

  it("esconde o próprio status: quem mostra é o cartão, agregado", () => {
    expect(render()).not.toContain("Salvando ordem…");
    expect(render()).not.toContain('class="h-4 text-xs text-muted-foreground"');
  });
});

describe("não-regressão: SEM `semArrasto` a alça continua lá", () => {
  it("a lista de GRUPOS (209) segue com alça de arrasto", () => {
    // Prova que `semArrasto` é opt-in: se ele vazasse para o default, esta
    // asserção cairia e a tela já entregue perderia o arrasto.
    const html = renderToStaticMarkup(
      <ReordenarOpcionaisDaCategoria
        categoriaProdutoId="cp-1"
        grupos={[{ id: "co-1", nome: "Bordas", totalItens: 3 }]}
        onReordenar={async () => ({ ok: true })}
      />,
    );
    expect(html).toContain("Reordenar Bordas");
  });
});
