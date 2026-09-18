/**
 * Testes de MARKUP do modo reordenar dos grupos de opcional (issue 209).
 *
 * Ambiente: vitest com `environment: node`, sem jsdom e sem @testing-library
 * (padrão do projeto). `renderToStaticMarkup` prova DERIVAÇÃO DE ESTADO → HTML,
 * não clique. A regra de coalescência/debounce já está coberta por
 * `salvamento-coalescido.test.ts` e o deslocamento por `reordenar.test.ts` —
 * nenhum dos dois é reteste aqui.
 *
 * O que este arquivo NÃO cobre, e o PR deve dizer em vez de "validado em
 * mobile": o GESTO de arrasto (pointer events reais, DragOverlay, colisão, o
 * `touch-action: none` da alça), a TEMPORIZAÇÃO do debounce dentro do
 * componente, o ANÚNCIO real em leitor de tela, o MOVIMENTO DE FOCO
 * pós-reordenação e a ABERTURA do kebab (o popup do Base UI só monta com DOM
 * real). Todos exigem DOM real → verificação manual em iOS Safari e Chrome
 * Android.
 *
 * O componente está SEMPRE em modo reordenar (quem liga/desliga é o cartão da
 * categoria). É isso que torna estes cenários testáveis sem simular o clique.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ReordenarOpcionaisDaCategoria } from "./ReordenarOpcionaisDaCategoria";
import type { GrupoOpcionalReordenavel } from "./ReordenarOpcionaisDaCategoria";

const MOLHOS: GrupoOpcionalReordenavel = {
  id: "co-1",
  nome: "Molhos",
  totalItens: 3,
};
const QUEIJOS: GrupoOpcionalReordenavel = {
  id: "co-2",
  nome: "Queijos",
  totalItens: 1,
};
const BORDAS: GrupoOpcionalReordenavel = {
  id: "co-3",
  nome: "Bordas",
  totalItens: 0,
};

function render(grupos: GrupoOpcionalReordenavel[]): string {
  return renderToStaticMarkup(
    <ReordenarOpcionaisDaCategoria
      categoriaProdutoId="cp-1"
      grupos={grupos}
      onReordenar={async () => ({ ok: true })}
    />,
  );
}

/** Trecho entre `<ol` e `</ol>` — usado para provar o que está FORA da lista. */
function dentroDaLista(html: string): string {
  return html.slice(html.indexOf("<ol"), html.indexOf("</ol>"));
}

/**
 * Tags `<button>` dos controles de mover, COM O `class` REMOVIDO. A remoção não
 * é cosmética: as classes do shadcn incluem `disabled:pointer-events-none`, e
 * procurar a substring "disabled" no markup cru daria falso positivo.
 */
/** O `<p>` do status do próprio modo — vazio enquanto nada está em voo. */
const RODAPE_STATUS = 'class="h-4 text-xs text-muted-foreground"';

function botoesDeMover(html: string): string[] {
  return (html.match(/<button[^>]*aria-label="Mover [^"]*"[^>]*>/g) ?? []).map(
    (tag) => tag.replace(/\sclass="[^"]*"/g, ""),
  );
}

describe("ReordenarOpcionaisDaCategoria — markup do modo (issue 209)", () => {
  it("renderiza uma <li> por grupo marcado, com a posição VISÍVEL", () => {
    // Sem o número, "deslocamento" e "troca de pares" ficam indistinguíveis
    // para quem só olha o resultado.
    const html = render([MOLHOS, QUEIJOS, BORDAS]);
    expect(html).toContain("Molhos");
    expect(html).toContain("Queijos");
    expect(html).toContain("Bordas");
    expect(html).toContain("1.");
    expect(html).toContain("2.");
    expect(html).toContain("3.");
  });

  it("singulariza a contagem de itens do grupo", () => {
    const html = render([MOLHOS, QUEIJOS, BORDAS]);
    expect(html).toContain("3 itens<");
    expect(html).toContain("1 item<");
    // 0 é legítimo: um grupo pode estar associado e ainda não ter item.
    expect(html).toContain("0 itens<");
  });

  it("↑ do PRIMEIRO e ↓ do ÚLTIMO usam aria-disabled, NUNCA disabled", () => {
    // `disabled` real remove o botão da ordem de foco: ao mover um item para o
    // topo, o foco estaria no ↑ que acaba de desabilitar e se perderia.
    const html = render([MOLHOS, QUEIJOS, BORDAS]);

    expect(html).toMatch(
      /aria-label="Mover Molhos para cima"[^>]*aria-disabled="true"|aria-disabled="true"[^>]*aria-label="Mover Molhos para cima"/,
    );
    expect(html).toMatch(
      /aria-label="Mover Bordas para baixo"[^>]*aria-disabled="true"|aria-disabled="true"[^>]*aria-label="Mover Bordas para baixo"/,
    );
    // No meio, as duas setas ficam ativas.
    expect(html).toMatch(
      /aria-label="Mover Queijos para cima"[^>]*aria-disabled="false"|aria-disabled="false"[^>]*aria-label="Mover Queijos para cima"/,
    );

    const botoes = botoesDeMover(html);
    expect(botoes.length).toBeGreaterThan(0);
    for (const tag of botoes) {
      expect(tag).not.toMatch(/\sdisabled\b/);
    }
  });

  it("a região viva é ÚNICA, sr-only e fica FORA do <ol>", () => {
    // Um live region dentro do <li> que se move é remontado a cada reordenação
    // e o anúncio silencia ou duplica (precedente: LinhaTempoStatus).
    const html = render([MOLHOS, QUEIJOS]);

    expect(html).toContain('role="status"');
    expect(html.match(/aria-live="polite"/g)).toHaveLength(1);
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain("sr-only");
    expect(dentroDaLista(html)).not.toContain('role="status"');
    expect(html.indexOf('role="status"')).toBeLessThan(html.indexOf("<ol"));
  });

  it("anuncia o total de grupos na ordem da vitrine", () => {
    // Desde a 213 não existe mais "entrar no modo": a lista está sempre visível
    // dentro do cartão da categoria de produto.
    const html = render([MOLHOS, QUEIJOS, BORDAS]);
    expect(html).toContain("3 grupos de opcional na ordem da vitrine.");
    expect(html).not.toContain("Modo reordenar ativado");
  });

  it("o `prefixo` do grupo é renderizado ANTES da alça (slot do checkbox, 213)", () => {
    // É onde o cartão encaixa o checkbox "remover deste cartão". Sem o slot, o
    // checkbox só caberia fora da linha e a ordem de tabulação viraria
    // alça → setas → kebab → checkbox, com a ação MAIS frequente por último.
    const html = renderToStaticMarkup(
      <ReordenarOpcionaisDaCategoria
        categoriaProdutoId="cp-1"
        grupos={[{ ...MOLHOS, prefixo: <span>PREFIXO-MOLHOS</span> }]}
        onReordenar={async () => ({ ok: true })}
      />,
    );
    expect(html).toContain("PREFIXO-MOLHOS");
    expect(html.indexOf("PREFIXO-MOLHOS")).toBeLessThan(
      html.indexOf('aria-label="Reordenar Molhos"'),
    );
  });

  it("embutida no cartão do pai: sem `<Card>` próprio e sem status próprio", () => {
    // Dois cartões aninhados desenhariam borda sobre borda, e dois textos de
    // status diriam a mesma coisa duas vezes (o do pai é AGREGADO).
    const html = renderToStaticMarkup(
      <ReordenarOpcionaisDaCategoria
        categoriaProdutoId="cp-1"
        grupos={[MOLHOS, QUEIJOS]}
        onReordenar={async () => ({ ok: true })}
        semCartao
        ocultarStatus
      />,
    );
    expect(html).not.toContain('data-slot="card"');
    expect(html).not.toContain(RODAPE_STATUS);
    // O markup padrão continua trazendo os dois.
    const padrao = render([MOLHOS, QUEIJOS]);
    expect(padrao).toContain('data-slot="card"');
    expect(padrao).toContain(RODAPE_STATUS);
  });

  it("alça e setas têm alvo de toque de 44px LITERAL", () => {
    // `min-h-11` seria 52,8px na base de 120% do projeto — não é a régua aqui.
    const html = render([MOLHOS, QUEIJOS]);
    expect(html).toContain("min-h-[44px]");
    expect(html).toContain("min-w-[44px]");
    expect(html).not.toContain("min-h-11");
  });

  it("a alça é um controle nomeado por grupo, e o kebab também", () => {
    const html = render([MOLHOS, QUEIJOS]);
    expect(html).toContain('aria-label="Reordenar Molhos"');
    expect(html).toContain('aria-label="Reordenar Queijos"');
    expect(html).toContain('aria-label="Mais ações de Molhos"');
    expect(html).toContain('aria-haspopup="menu"');
  });

  it("não renderiza rodapé fixo: todo item da lista é ordenável", () => {
    // O "Sem categoria" é exclusivo do modo de categorias de produto; aqui não
    // existe grupo sintético, e nunca renderizar um controle que não faz nada
    // vale nos dois sentidos.
    const html = render([MOLHOS, QUEIJOS]);
    expect(html).not.toContain("Sempre por último");
    const alcas = html.match(/aria-label="Reordenar [^"]*"/g) ?? [];
    expect(alcas).toHaveLength(2);
  });
});
