/**
 * Testes de MARKUP do modo reordenar (issue 175) — cenários 5, 8 e 10.
 *
 * Ambiente: vitest com `environment: node`, sem jsdom e sem @testing-library
 * (padrão do projeto — ver o cabeçalho de ProdutosClient.test.tsx).
 * `renderToStaticMarkup` prova DERIVAÇÃO DE ESTADO → HTML, não clique.
 *
 * O que este arquivo NÃO cobre, e o PR deve dizer em vez de "validado em
 * mobile": o GESTO de arrasto (pointer events reais, DragOverlay, colisão, o
 * `touch-action: none` da alça), a TEMPORIZAÇÃO do debounce e o MOVIMENTO DE
 * FOCO pós-reordenação. Todos exigem DOM real → verificação manual em iOS
 * Safari e Chrome Android.
 *
 * `ReordenarCategorias` está SEMPRE em modo reordenar (quem liga/desliga é o
 * pai). É isso que torna estes cenários testáveis sem simular o clique que
 * ligaria o modo.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ReordenarCategorias } from "./ReordenarCategorias";
import type { Categoria } from "@/components/painel/FormProduto";

function categoria(id: string, nome: string): Categoria {
  return { id, nome, exibir_imagens: true };
}

const PIZZAS = categoria("cat-1", "Pizzas");
const BEBIDAS = categoria("cat-2", "Bebidas");
const SOBREMESAS = categoria("cat-3", "Sobremesas");

function render(
  categorias: Categoria[],
  contagem: Record<string, number> = {},
  temSemCategoria = false,
): string {
  return renderToStaticMarkup(
    <ReordenarCategorias
      categorias={categorias}
      contagemPorCategoria={contagem}
      temSemCategoria={temSemCategoria}
      onReordenar={async () => ({ ok: true })}
    />,
  );
}

/** Trecho entre `<ol` e `</ol>` — usado para provar o que está FORA da lista. */
function dentroDaLista(html: string): string {
  return html.slice(html.indexOf("<ol"), html.indexOf("</ol>"));
}

/**
 * Tags `<button>` dos controles de mover, COM O `class` REMOVIDO.
 *
 * A remoção não é cosmética: as classes do shadcn incluem
 * `disabled:pointer-events-none`, então procurar a substring "disabled" no
 * markup cru daria um falso positivo e a asserção "nunca usa `disabled` real"
 * passaria a reprovar código correto.
 */
function botoesDeMover(html: string): string[] {
  return (html.match(/<button[^>]*aria-label="Mover [^"]*"[^>]*>/g) ?? []).map(
    (tag) => tag.replace(/\sclass="[^"]*"/g, ""),
  );
}

describe("ReordenarCategorias — markup do modo (issue 175)", () => {
  // ───────────────────────────────────────────────────────── cenário 10
  it("[C10] categoria VAZIA aparece no modo, com '0 produtos'", () => {
    // Ela não aparece na listagem normal (ProdutosClient filtra grupos vazios).
    // Se não aparecesse aqui, o lojista não conseguiria posicionar a categoria
    // recém-criada — que nasce vazia, e é justamente quando ele quer posicioná-la.
    const html = render([PIZZAS, BEBIDAS], { "cat-1": 4 });
    expect(html).toContain("Pizzas");
    expect(html).toContain("4 produtos");
    expect(html).toContain("Bebidas");
    expect(html).toContain("0 produtos");
  });

  it("singulariza a contagem de 1 produto", () => {
    const html = render([PIZZAS, BEBIDAS], { "cat-1": 1 });
    expect(html).toContain("1 produto<");
  });

  it("renderiza uma <li> por categoria, com a posição VISÍVEL", () => {
    // Sem o número, "deslocamento" e "troca de pares" ficam indistinguíveis
    // para quem só olha o resultado.
    const html = render([PIZZAS, BEBIDAS, SOBREMESAS]);
    expect(html).toContain("1.");
    expect(html).toContain("2.");
    expect(html).toContain("3.");
  });

  // ───────────────────────────────────────────────────────── cenário 8
  it("[C8] ↑ da PRIMEIRA e ↓ da ÚLTIMA usam aria-disabled, NUNCA disabled", () => {
    // `disabled` real remove o botão da ordem de foco: ao mover um item para o
    // topo, o foco estaria no ↑ que acaba de desabilitar e se perderia para o
    // <body>. É o bug nº 1 deste padrão.
    const html = render([PIZZAS, BEBIDAS, SOBREMESAS]);

    expect(html).toMatch(
      /aria-label="Mover Pizzas para cima"[^>]*aria-disabled="true"|aria-disabled="true"[^>]*aria-label="Mover Pizzas para cima"/,
    );
    expect(html).toMatch(
      /aria-label="Mover Sobremesas para baixo"[^>]*aria-disabled="true"|aria-disabled="true"[^>]*aria-label="Mover Sobremesas para baixo"/,
    );
    // Nenhum controle de mover pode carregar o atributo `disabled` do HTML.
    const botoes = botoesDeMover(html);
    expect(botoes.length).toBeGreaterThan(0);
    for (const tag of botoes) {
      expect(tag).not.toMatch(/\sdisabled\b/);
    }
  });

  it("[C8] no MEIO da lista as duas setas ficam ativas (aria-disabled=false)", () => {
    const html = render([PIZZAS, BEBIDAS, SOBREMESAS]);
    expect(html).toMatch(
      /aria-label="Mover Bebidas para cima"[^>]*aria-disabled="false"|aria-disabled="false"[^>]*aria-label="Mover Bebidas para cima"/,
    );
    expect(html).toMatch(
      /aria-label="Mover Bebidas para baixo"[^>]*aria-disabled="false"|aria-disabled="false"[^>]*aria-label="Mover Bebidas para baixo"/,
    );
  });

  it("a aria-label NÃO carrega a posição (mudaria a cada render → re-anúncio)", () => {
    const html = render([PIZZAS, BEBIDAS]);
    expect(html).toContain('aria-label="Mover Pizzas para cima"');
    expect(html).not.toMatch(/aria-label="Mover Pizzas[^"]*posição/);
  });

  // ───────────────────────────────────────────────────────── cenário 5
  it("[C5] 'Sem categoria' aparece no fim, SEM alça e SEM setas (nem desabilitadas)", () => {
    const html = render([PIZZAS, BEBIDAS], { "cat-1": 2 }, true);

    expect(html).toContain("Sem categoria");
    expect(html).toContain("Sempre por último");
    // Nunca renderizar um controle que não faz nada: nenhuma seta, nenhuma alça.
    expect(html).not.toContain('aria-label="Reordenar Sem categoria"');
    expect(html).not.toContain('aria-label="Mover Sem categoria para cima"');
    expect(html).not.toContain('aria-label="Mover Sem categoria para baixo"');
    // Fixo no FIM: aparece depois da última categoria de verdade.
    expect(html.indexOf("Sem categoria")).toBeGreaterThan(html.indexOf("Bebidas"));
  });

  it("[C5] sem produtos soltos, 'Sem categoria' não é renderizada", () => {
    const html = render([PIZZAS, BEBIDAS], { "cat-1": 2 }, false);
    expect(html).not.toContain("Sem categoria");
  });

  // ─────────────────────────────────────────────── região viva e alvos
  it("a região viva é ÚNICA, sr-only e fica FORA do <ol>", () => {
    // Um live region dentro do <li> que se move é remontado a cada reordenação
    // e o anúncio silencia ou duplica (precedente: LinhaTempoStatus).
    const html = render([PIZZAS, BEBIDAS]);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    // Exatamente UMA região viva.
    expect(html.match(/aria-live="polite"/g)).toHaveLength(1);
    // E ela não está dentro da lista.
    expect(dentroDaLista(html)).not.toContain('role="status"');
    expect(html.indexOf('role="status"')).toBeLessThan(html.indexOf("<ol"));
  });

  it("anuncia a entrada no modo com o total de categorias", () => {
    const html = render([PIZZAS, BEBIDAS, SOBREMESAS]);
    expect(html).toContain("Modo reordenar ativado. 3 categorias.");
  });

  it("alça e setas têm alvo de toque de 44px LITERAL", () => {
    // `min-h-11` seria 52,8px e `size=&quot;icon-sm&quot;` 33,6px na base de
    // 120% do projeto — nenhum dos dois é a régua desta tela.
    const html = render([PIZZAS, BEBIDAS]);
    expect(html).toContain("min-h-[44px]");
    expect(html).toContain("min-w-[44px]");
    expect(html).not.toContain("min-h-11");
  });

  it("a alça é um controle nomeado por categoria", () => {
    const html = render([PIZZAS, BEBIDAS]);
    expect(html).toContain('aria-label="Reordenar Pizzas"');
    expect(html).toContain('aria-label="Reordenar Bebidas"');
  });

  it("cada linha expõe o kebab que abriga 'Mover para o topo/fim'", () => {
    // LIMITE DO AMBIENTE, não do código: o Base UI só monta o popup do Menu
    // quando ele abre (MenuPortal), e abrir exige DOM real — que este projeto
    // não tem no vitest (`environment: node`, sem jsdom). Logo o que dá para
    // provar aqui é o TRIGGER por categoria; que os itens "Mover para o topo" e
    // "Mover para o fim" aparecem e movem fica para a verificação manual,
    // junto do gesto de arrasto.
    const html = render([PIZZAS, BEBIDAS, SOBREMESAS]);
    expect(html).toContain('aria-label="Mais ações de Pizzas"');
    expect(html).toContain('aria-label="Mais ações de Bebidas"');
    expect(html).toContain('aria-label="Mais ações de Sobremesas"');
    expect(html).toContain('aria-haspopup="menu"');
  });
});
