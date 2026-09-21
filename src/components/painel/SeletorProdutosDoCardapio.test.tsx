/**
 * [276] Markup da linha do vínculo no detalhe do cardápio.
 *
 * Ambiente: vitest environment=node — sem jsdom. `renderToStaticMarkup`, o
 * mesmo padrão de `FormVigencia.test.tsx`. O que um clique produz está travado
 * em `agendaDoVinculo.test.ts` (puro); o que é observável AQUI é o DOM: quem
 * ganha pílulas, quem não ganha, a frase redigida no servidor e a faixa do
 * aviso de RN-06.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import {
  SeletorProdutosDoCardapio,
  type ProdutoDoSeletor,
} from "./SeletorProdutosDoCardapio";
import type { AcoesLote } from "./contrato-lote";

const ACOES = {
  aplicarEmProdutos: vi.fn(),
  aplicarEmCategoria: vi.fn(),
  tirarDeCardapio: vi.fn(),
  preverLote: vi.fn(),
  definirVisibilidade: vi.fn(),
  definirDias: vi.fn(),
} as unknown as AcoesLote;

function produto(over: Partial<ProdutoDoSeletor> = {}): ProdutoDoSeletor {
  return {
    id: "p1",
    nome: "Feijoada da casa",
    exclusivo: false,
    noCardapio: true,
    dias: [3, 6],
    fraseAgenda: "Aparece: qua e sáb",
    avisoNuncaAbre: null,
    ...over,
  };
}

function montar(produtos: ProdutoDoSeletor[]): string {
  return renderToStaticMarkup(
    <SeletorProdutosDoCardapio
      cardapio={{
        id: "c1",
        nome: "Especiais do Dia",
        descricao: "Aparece todo sábado e domingo.",
      }}
      grupos={[{ id: "cat-1", nome: "Pratos executivos", produtos }]}
      acoes={ACOES}
    />,
  );
}

describe("SeletorProdutosDoCardapio — a agenda é do VÍNCULO (276)", () => {
  it("produto vinculado ganha as 7 pílulas e a frase do servidor", () => {
    const html = montar([produto()]);
    expect(html).toContain("Aparece: qua e sáb");
    expect(html).toContain(
      'aria-label="Dias em que Feijoada da casa aparece neste cardápio"',
    );
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(2);
    expect((html.match(/aria-pressed="false"/g) ?? []).length).toBe(5);
  });

  it("produto NÃO vinculado não mostra pílulas, frase nem placeholder", () => {
    const html = montar([
      produto({
        id: "p2",
        nome: "Dobradinha",
        noCardapio: false,
        dias: null,
        fraseAgenda: null,
        avisoNuncaAbre: null,
      }),
    ]);
    expect(html).toContain("Dobradinha");
    expect(html).not.toContain("aria-pressed");
    expect(html).not.toContain("aparece neste cardápio");
  });

  it("vínculo sem dias lê 'Todos os dias do cardápio' e não marca nenhuma", () => {
    const html = montar([
      produto({ dias: null, fraseAgenda: "Todos os dias do cardápio" }),
    ]);
    expect(html).toContain("Todos os dias do cardápio");
    expect(html).not.toContain('aria-pressed="true"');
  });

  it("a frase é o aria-describedby do grupo (nunca um grupo mudo)", () => {
    const html = montar([produto()]);
    expect(html).toContain('id="agenda-p1"');
    expect(html).toContain('aria-describedby="agenda-p1"');
  });

  it("a faixa de RN-06 só aparece com avisoNuncaAbre, e é role=status", () => {
    expect(montar([produto()])).not.toContain('role="status"');
    const html = montar([
      produto({
        avisoNuncaAbre:
          "Este item nunca aparece: o cardápio só abre aos sábados e domingos.",
      }),
    ]);
    expect(html).toContain('role="status"');
    expect(html).toContain(
      "Este item nunca aparece: o cardápio só abre aos sábados e domingos.",
    );
    // Avisa, não bloqueia: nada de `aria-invalid="true"` na linha (as classes
    // `aria-invalid:*` do shadcn são estilo, não estado).
    expect(html).not.toContain('aria-invalid="true"');
  });

  it("a linha tem região aria-live para anunciar a escrita assíncrona", () => {
    const html = montar([produto()]);
    expect(html).toContain('aria-live="polite"');
  });

  it("as pílulas da linha são as compactas (uma fila de 7 em 360px)", () => {
    const html = montar([produto()]);
    expect(html).toContain("min-w-[40px]");
    expect(html).toContain("min-h-[44px]");
  });
});

/**
 * [277] O gatilho do lote. A decisão B (só com a seleção inteira vinculada) é
 * afirmada em `agendaDoVinculo.test.ts`, que é puro; aqui o que se observa é
 * que o botão existe e nasce desabilitado — sem seleção não há alcance.
 */
describe("SeletorProdutosDoCardapio — gatilho de 'Definir dias' (277)", () => {
  it("o botão existe na barra de seleção", () => {
    expect(montar([produto()])).toContain("Definir dias");
  });

  it("sem seleção, nasce desabilitado (não há alcance a prometer)", () => {
    const html = montar([produto()]);
    expect(html).toMatch(/disabled=""[^>]*>Definir dias</);
  });

  it("nenhum número é calculado nesta tela: o rótulo do botão não conta nada", () => {
    // A contagem do lote é do SERVIDOR (`preverLoteAction`) e aparece no
    // rótulo do botão de CONFIRMAÇÃO, dentro do diálogo — nunca aqui.
    expect(montar([produto()])).not.toContain("Definir dias em");
  });
});
