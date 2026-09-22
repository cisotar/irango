/**
 * [288/D3·D4·D6·D7] O sheet de adicionar itens.
 *
 * Ambiente: vitest environment=node — sem jsdom. Um `Sheet` ABERTO renderiza em
 * portal, e portal não existe em `react-dom/server` (o SSR devolve string
 * vazia): por isso o conteúdo é um componente exportado à parte
 * (`ConteudoAdicionarItens`) e é ele que estes casos montam. O shell — `side`,
 * `showCloseButton={false}` — é travado por leitura da FONTE, no último bloco.
 *
 * A regra de D3 em si (o que cada escolha vira no payload) vive em
 * `escolhaDeDias.test.ts`, que é puro.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ConteudoAdicionarItens,
  type GrupoDoSheet,
} from "./SheetAdicionarItens";

const LOTE = {
  abrirCardapio: vi.fn(),
  prevendo: false,
  pendente: false,
  pedido: null,
  confirmar: vi.fn(),
  cancelar: vi.fn(),
};

const GRUPOS: GrupoDoSheet[] = [
  {
    id: "cat-1",
    nome: "Pratos principais",
    produtos: [
      {
        id: "p1",
        nome: "Feijoada da casa",
        noCardapio: false,
        precoRotulo: "R$ 48,90",
      },
      {
        id: "p2",
        nome: "Picanha na chapa",
        noCardapio: true,
        precoRotulo: "R$ 90,00",
      },
    ],
  },
];

function montar(
  grupos: GrupoDoSheet[] = GRUPOS,
  hrefProdutos: string | null = "/qualquer/produtos",
): string {
  return renderToStaticMarkup(
    <ConteudoAdicionarItens
      cardapio={{
        id: "c1",
        nome: "Especiais do Dia",
        descricao: "Aparece todo sábado e domingo.",
      }}
      grupos={grupos}
      lote={LOTE}
      hrefProdutos={hrefProdutos}
      ehDesktop={false}
      onFechar={vi.fn()}
    />,
  );
}

describe("SheetAdicionarItens — seleção, busca e categorias (D4, D6)", () => {
  it("as categorias nascem FECHADAS, com a contagem no gatilho", () => {
    const html = montar();
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('aria-expanded="true"');
    expect(html).toContain("2 produtos");
    expect(html).toContain("1 já no cardápio");
  });

  it("[D4] produto JÁ vinculado aparece esmaecido e SEM checkbox", () => {
    const html = montar();
    expect(html).toContain("Picanha na chapa");
    expect(html).toContain("Já está neste cardápio");
    // O único checkbox é o do produto que ainda não está no cardápio.
    expect(html).toContain('aria-label="Selecionar Feijoada da casa"');
    expect(html).not.toContain('aria-label="Selecionar Picanha na chapa"');
  });

  it("[D6] a busca existe e é rotulada, mesmo sem rótulo visível", () => {
    const html = montar();
    expect(html).toContain('type="search"');
    expect(html).toContain("Buscar produto pelo nome");
  });

  it("loja sem produto nenhum convida a cadastrar, com href INJETADO", () => {
    const html = montar([]);
    expect(html).toContain("Você ainda não tem produtos.");
    expect(html).toContain('href="/qualquer/produtos"');
  });

  it("sem href (mundo admin) o convite permanece, sem link para o painel", () => {
    const html = montar([], null);
    expect(html).toContain("Você ainda não tem produtos.");
    expect(html).not.toContain("/painel/");
  });

  it("o rótulo do gesto de categoria é curto no botão e completo no aria-label", () => {
    const html = montar();
    expect(html).toContain("+ o 1");
    expect(html).toContain(
      'aria-label="Adicionar o 1 produto de Pratos principais que falta"',
    );
  });
});

describe("SheetAdicionarItens — a escolha de dias (D3)", () => {
  it("o rádio nasce em 'Todos os dias do cardápio' — zero clique no caso comum", () => {
    const html = montar();
    expect(html).toContain("Todos os dias do cardápio");
    expect(html).toContain("Escolher dias");
    expect(html).toContain('data-checked=""');
  });

  it("as pílulas só existem depois de 'Escolher dias' (não nascem na tela)", () => {
    expect(montar()).not.toContain("aria-pressed");
  });

  it("sem seleção o CTA não promete escrita, e usa aria-disabled (o foco fica)", () => {
    const html = montar();
    expect(html).toContain("Adicionar ao cardápio");
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("Nenhum produto selecionado");
    expect(html).toContain('aria-live="polite"');
  });

  it("nenhum motivo é escondido em `title` — a regra da issue 288", () => {
    expect(montar()).not.toContain("title=");
  });

  it("o diálogo tem nome acessível próprio, ligado por id", () => {
    const html = montar();
    expect(html).toContain('id="sheet-adicionar-itens-titulo"');
    expect(html).toContain('id="sheet-adicionar-itens-descricao"');
    expect(html).toContain("Adicionar itens");
  });

  it("o close é nosso, de 44px, e nada usa o `icon-sm` do sheet padrão", () => {
    const html = montar();
    expect(html).toContain('aria-label="Fechar"');
    expect(html).toContain("min-h-[44px]");
    expect(html).not.toContain("icon-sm");
    expect(html).not.toContain("min-h-11");
  });
});

/**
 * O shell do `Sheet` não é observável no SSR (portal), então o que garante as
 * duas decisões de acessibilidade é a leitura da fonte — a mesma forma da
 * trava de paridade das Server Actions.
 */
describe("SheetAdicionarItens — o shell, lido da FONTE", () => {
  const FONTE = readFileSync(
    join(process.cwd(), "src/components/painel/SheetAdicionarItens.tsx"),
    "utf8",
  );

  it("desliga o close padrão do shadcn (que é `icon-sm`, 33,6px)", () => {
    expect(FONTE).toContain("showCloseButton={false}");
  });

  it("`components/ui/sheet.tsx` continua intocado: o consumidor é que adapta", () => {
    const sheet = readFileSync(
      join(process.cwd(), "src/components/ui/sheet.tsx"),
      "utf8",
    );
    expect(sheet).toContain('size="icon-sm"');
    expect(sheet).toContain("showCloseButton = true");
  });

  it("`side` é passada UMA vez (o mockup escrevia duas, o que é JSX inválido)", () => {
    expect((FONTE.match(/\bside=/g) ?? []).length).toBe(1);
  });

  it("a confirmação do lote é um passo DAQUI, não um AlertDialog por cima (§6)", () => {
    expect(FONTE).not.toContain("@/components/ui/alert-dialog");
  });
});
