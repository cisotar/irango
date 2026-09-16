/**
 * Issue 202 — o campo de busca e os dois acessórios do modo-busca.
 * `environment: node`, sem jsdom: `renderToStaticMarkup` não dispara eventos,
 * então o que se prova aqui é a MARCAÇÃO (papéis ARIA, alvos de 44px literais,
 * 16px em ambos os breakpoints, presença condicional do ✕). Foco, `Esc` e os
 * quatro caminhos de limpar são verificação manual em 360×640.
 *
 * Os três componentes são controlados — recebem `termo` por prop — e é
 * exatamente isso que torna o modo-busca cobrível sem DOM.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { BuscaProdutos, EstadoVazioBusca, ResumoBusca } from "./BuscaProdutos";

const inertes = {
  aoMudar: () => {},
  aoLimpar: () => {},
  inputRef: { current: null },
  idRegiaoViva: "regiao-viva",
};

function renderizarBusca(termo: string): string {
  return renderToStaticMarkup(<BuscaProdutos termo={termo} {...inertes} />);
}

describe("202 BuscaProdutos — marcação do campo", () => {
  it("é um <form role=\"search\"> com label sr-only e input type=search", () => {
    const html = renderizarBusca("");

    expect(html).toContain('role="search"');
    expect(html).toContain('type="search"');
    expect(html).toContain('class="sr-only"');
    expect(html).toContain("Buscar produto no cardápio");
  });

  it("o input tem 44px literais e 16px nos DOIS breakpoints", () => {
    const html = renderizarBusca("");

    expect(html).toContain("min-h-[44px]");
    // `md:text-[16px]` é o que vence o `md:text-sm` de `ui/input.tsx` — sem
    // ele o Safari iOS volta a dar zoom no focus a partir do breakpoint md.
    expect(html).toContain("text-[16px]");
    expect(html).toContain("md:text-[16px]");
    // A régua é 44px literal: `min-h-11` são 52,8px na base 120% do projeto.
    expect(html).not.toContain(["min", "h", "11"].join("-"));
  });

  it("derruba o h-8 do Input do shadcn em vez de editar ui/input.tsx", () => {
    const html = renderizarBusca("");

    expect(html).toContain("h-auto");
    expect(html).not.toContain(["h", "8"].join("-") + " ");
  });

  it("aponta o aria-describedby para a região viva do pai", () => {
    expect(renderizarBusca("")).toContain('aria-describedby="regiao-viva"');
  });

  it("teclado virtual de busca: inputmode, enterkeyhint e autocomplete off", () => {
    // Minúsculas: o Base UI emite estes atributos em camelCase no SSR e nome de
    // atributo HTML é case-insensitive — o browser lê os três igual.
    const html = renderizarBusca("").toLowerCase();

    expect(html).toContain('inputmode="search"');
    expect(html).toContain('enterkeyhint="search"');
    expect(html).toContain('autocomplete="off"');
  });
});

describe("202 BuscaProdutos — botão de limpar", () => {
  it("com o campo vazio, o ✕ não existe", () => {
    expect(renderizarBusca("")).not.toContain('aria-label="Limpar busca"');
  });

  it("com texto, o ✕ aparece com alvo de 44px nas duas direções", () => {
    const html = renderizarBusca("pao");

    expect(html).toContain('aria-label="Limpar busca"');
    expect(html).toContain("min-w-[44px]");
    // `size="icon-sm"` do Button são 33,6px — proibido aqui (D7).
    expect(html).not.toContain("icon-sm");
  });

  it("reflete o termo controlado, sem estado próprio", () => {
    expect(renderizarBusca("pao")).toContain('value="pao"');
  });
});

describe("202 ResumoBusca — linha que ocupa o lugar do trilho", () => {
  it("mostra a contagem flexionada e o termo entre aspas curvas", () => {
    const html = renderToStaticMarkup(
      <ResumoBusca total={3} termo="pao" aoLimpar={() => {}} />,
    );

    expect(html).toContain("3 produtos encontrados para “pao”");
  });

  it("com um único resultado usa o singular", () => {
    const html = renderToStaticMarkup(
      <ResumoBusca total={1} termo="pao" aoLimpar={() => {}} />,
    );

    expect(html).toContain("1 produto encontrado para");
  });

  it("o botão Limpar tem alvo de 44px", () => {
    const html = renderToStaticMarkup(
      <ResumoBusca total={0} termo="xyz" aoLimpar={() => {}} />,
    );

    expect(html).toContain("Limpar");
    expect(html).toContain("min-h-[44px]");
  });
});

describe("202 EstadoVazioBusca — nunca tela em branco", () => {
  it("traz ícone, o termo buscado e o CTA de 44px", () => {
    const html = renderToStaticMarkup(
      <EstadoVazioBusca termo="xyz" aoLimpar={() => {}} />,
    );

    expect(html).toContain("<svg");
    expect(html).toContain("Nenhum produto encontrado para “xyz”.");
    expect(html).toContain("Ver cardápio completo");
    expect(html).toContain("min-h-[44px]");
  });

  it("o termo vai como TEXTO — o React escapa, nunca vira HTML (RN-9)", () => {
    const html = renderToStaticMarkup(
      <EstadoVazioBusca termo="<img src=x onerror=alert(1)>" aoLimpar={() => {}} />,
    );

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
