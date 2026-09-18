/**
 * Testes de MARKUP da linha de ITEM do painel de opcionais (issue 216).
 *
 * Ambiente: vitest com `environment: node`, sem jsdom e sem @testing-library
 * (padrão do projeto). `renderToStaticMarkup` prova DERIVAÇÃO DE ESTADO → HTML,
 * não clique.
 *
 * O que este arquivo NÃO cobre, e o PR deve dizer em vez de "validado no
 * mobile": gesto de toque, a ABERTURA do kebab (o popup do Base UI só monta com
 * DOM real), o MOVIMENTO DE FOCO (`autoFocus`, retorno ao kebab, ida ao
 * "Adicionar"), o `Escape` e o `stopPropagation` (exigem evento real) e o
 * anúncio em leitor de tela. Todos exigem DOM real → verificação manual em iOS
 * Safari e Chrome Android.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { LinhaItemOpcional, type ModoLinhaItem } from "./LinhaItemOpcional";
import type { Opcional } from "@/lib/supabase/queries/opcionais";

function opcional(overrides: Partial<Opcional> = {}): Opcional {
  return {
    id: "o-1",
    loja_id: "loja-1",
    categoria_opcional_id: "co-1",
    nome: "Catupiry",
    preco: 4,
    ativo: true,
    ordem: 0,
    criado_em: "2025-01-01T00:00:00Z",
    atualizado_em: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function render(props: {
  item?: Opcional;
  indice?: number;
  total?: number;
  modo?: ModoLinhaItem;
  emVoo?: boolean;
  alcance?: string[];
}): string {
  return renderToStaticMarkup(
    <LinhaItemOpcional
      item={props.item ?? opcional()}
      indice={props.indice ?? 0}
      total={props.total ?? 3}
      modo={props.modo ?? "leitura"}
      emVoo={props.emVoo ?? false}
      alcance={props.alcance ?? []}
      grupoNome="Bordas"
      onMover={() => {}}
      onEditar={() => {}}
      onSalvarEdicao={() => {}}
      onAlternarAtivo={() => {}}
      onPedirRemocao={() => {}}
      onConfirmarRemocao={() => {}}
      onCancelar={() => {}}
    />,
  );
}

/**
 * Tags `<button>` COM O `class` REMOVIDO. A remoção não é cosmética: as classes
 * do shadcn incluem `disabled:pointer-events-none`, e procurar a substring
 * "disabled" no markup cru daria falso positivo.
 */
function botoesSemClasse(html: string): string[] {
  return (html.match(/<button[^>]*>/g) ?? []).map((tag) =>
    tag.replace(/\sclass="[^"]*"/g, ""),
  );
}

/**
 * Classes do `<li>` e dos `<span>` de texto — os elementos que ESTE componente
 * estiliza. Exclui os `<button>`/`<input>` do shadcn, cujas classes trazem
 * `disabled:opacity-50` e dariam falso positivo em "a linha não usa opacity".
 */
function classesDaLinha(html: string): string {
  const tags = html.match(/<(?:li|span)[^>]*>/g) ?? [];
  return tags
    .map((t) => /\sclass="([^"]*)"/.exec(t)?.[1] ?? "")
    .join(" ");
}

describe("LinhaItemOpcional — leitura", () => {
  it("mostra posição, nome e preço formatado num alvo único de 44px", () => {
    const html = render({ indice: 1 });
    expect(html).toContain("2.");
    expect(html).toContain("Catupiry");
    // `formatarMoeda` usa Intl → espaço RÍGIDO (U+00A0) entre "R$" e o número.
    expect(html).toContain("+R$\u00A04,00");
    expect(html).toContain('aria-label="Editar Catupiry, R$\u00A04,00"');
    expect(html).toContain("min-h-[44px]");
  });

  it("item INATIVO leva o badge de texto e NADA de opacity/tachado", () => {
    // Cor sozinha falharia a 1.4.1; `opacity-` derrubaria o contraste abaixo de
    // 4.5:1; tachado, em comércio, significa "de/por". O item inativo ocupa
    // posição REAL na ordem — uma linha apagada mentiria sobre isso.
    const html = render({ item: opcional({ ativo: false }) });
    expect(html).toContain("Inativo");
    // Só as classes que ESTE componente escreve: as do `Button` do shadcn
    // trazem `disabled:opacity-50` e dariam falso positivo.
    expect(classesDaLinha(html)).not.toMatch(/opacity-|line-through/);
  });

  it("item ATIVO não imprime o badge", () => {
    expect(render({})).not.toContain("Inativo");
  });

  it("setas ↑↓ só aparecem a partir de `sm` e têm gêmeas no kebab", () => {
    // Em 360px, com as setas visíveis sobrariam ~134px para o nome.
    const html = render({});
    expect(html).toContain('aria-label="Mover Catupiry para cima"');
    expect(html).toContain("hidden sm:inline-flex");
    const setas = html.match(/hidden sm:inline-flex/g) ?? [];
    expect(setas.length).toBe(2);
  });

  it("limites usam `aria-disabled`, NUNCA `disabled`", () => {
    const html = render({ indice: 0, total: 3 });
    const subir = botoesSemClasse(html).find((t) =>
      t.includes('aria-label="Mover Catupiry para cima"'),
    );
    expect(subir).toContain('aria-disabled="true"');
    expect(botoesSemClasse(html).join("\n")).not.toMatch(/\sdisabled/);
  });

  it("nenhum alvo usa `size=\"icon-sm\"` (33,6px) nem `min-h-11` (52,8px)", () => {
    const html = render({});
    expect(html).not.toContain("size-7");
    expect(html).not.toContain("min-h-11");
  });
});

describe("LinhaItemOpcional — editando", () => {
  it("troca o miolo por dois campos rotulados, sem `<label>` visível", () => {
    const html = render({ modo: "editando" });
    expect(html).toContain('aria-label="Nome do opcional"');
    expect(html).toContain('aria-label="Preço de Catupiry em reais"');
    expect(html).toMatch(/inputmode="decimal"/i);
    expect(html).toContain("Salvar");
    expect(html).toContain("Cancelar");
  });

  it("liga os campos à frase de alcance por `aria-describedby` quando alcance ≥ 2", () => {
    const html = render({ modo: "editando", alcance: ["Pizzas", "Esfihas"] });
    expect(html).toContain("Vale para 2 categorias de produto.");
    const idDescrito = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(idDescrito).toBeTruthy();
    expect(html).toContain(`id="${idDescrito}"`);
  });

  it("alcance 0 ou 1: NENHUMA frase e NENHUM `aria-describedby`", () => {
    // O aviso que dispara sempre vira papel de parede.
    for (const alcance of [[], ["Pizzas"]]) {
      const html = render({ modo: "editando", alcance });
      expect(html).not.toContain("Vale para");
      expect(html).not.toContain("aria-describedby");
    }
  });

  it("em voo, Salvar e Cancelar usam `aria-disabled`, nunca `disabled`", () => {
    // O foco está EM CIMA de um desses botões: `disabled` o jogaria no <body>.
    const html = render({ modo: "editando", emVoo: true });
    expect(html).toContain('aria-disabled="true"');
    expect(botoesSemClasse(html).join("\n")).not.toMatch(/\sdisabled/);
  });

  it("o preço abre com vírgula decimal (UX pt-BR)", () => {
    const html = render({ modo: "editando", item: opcional({ preco: 3.5 }) });
    expect(html).toContain('value="3,5"');
  });
});

describe("LinhaItemOpcional — confirmando remoção", () => {
  it("é `role=\"group\"` rotulado pela pergunta, NUNCA `alertdialog`", () => {
    // `alertdialog` promete modalidade e foco preso; aqui a tabulação continua
    // saindo da linha. Declarar o papel sem a trapa é mentir para a TA.
    const html = render({ modo: "confirmando", alcance: ["Pizzas", "Esfihas"] });
    expect(html).toContain('role="group"');
    expect(html).not.toContain("alertdialog");
    const idPergunta = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(idPergunta).toBeTruthy();
    expect(html).toContain(`id="${idPergunta}"`);
  });

  it("imprime o alcance com a régua de `rotuloAlcance`", () => {
    expect(
      render({ modo: "confirmando", alcance: ["Pizzas", "Esfihas", "Doces"] }),
    ).toContain("Ele sai de 3 categorias de produto.");
    expect(
      render({ modo: "confirmando", alcance: ["Pizzas", "Esfihas"] }),
    ).toContain("Ele sai de Pizzas e Esfihas.");
  });

  it("último item do grupo: acrescenta a segunda sentença", () => {
    const html = render({ modo: "confirmando", total: 1, alcance: ["Pizzas"] });
    expect(html).toContain("É o último opcional de Bordas.");
  });

  it("some com número, setas e kebab — o `<li>` continua sendo o mesmo", () => {
    const html = render({ modo: "confirmando" });
    expect(html).not.toContain("Mover Catupiry para cima");
    expect(html).not.toContain("Mais ações de Catupiry");
    expect(html.startsWith("<li")).toBe(true);
  });

  it("os dois botões são alvos de 44px e usam `aria-disabled` em voo", () => {
    const html = render({ modo: "confirmando", emVoo: true });
    expect(html).toContain("Remover");
    expect(html).toContain("Cancelar");
    expect(html).toContain("min-h-[44px]");
    expect(botoesSemClasse(html).join("\n")).not.toMatch(/\sdisabled/);
  });
});
