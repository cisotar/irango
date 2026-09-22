/**
 * [288/D2·D5] O card de um item do cardápio.
 *
 * Herda os casos de `SeletorProdutosDoCardapio.test.tsx` (apagado com o
 * componente que ele cobria): pílulas do vínculo, frase do servidor,
 * `aria-describedby`, aviso âmbar de RN-06, região `aria-live` e o selo de
 * exclusivo. Ambiente: vitest environment=node — sem jsdom,
 * `renderToStaticMarkup`. O que um clique produz está travado em
 * `agendaDoVinculo.test.ts` (puro); o que é observável AQUI é o DOM.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ItensDoCardapio, type ItemDoCardapio } from "./ItensDoCardapio";
import type { AcoesLote } from "./contrato-lote";

const ACOES = {
  aplicarEmProdutos: vi.fn(),
  aplicarEmCategoria: vi.fn(),
  tirarDeCardapio: vi.fn(),
  preverLote: vi.fn(),
  definirVisibilidade: vi.fn(),
  definirDias: vi.fn(),
} as unknown as AcoesLote;

function item(over: Partial<ItemDoCardapio> = {}): ItemDoCardapio {
  return {
    id: "p1",
    nome: "Feijoada da casa",
    exclusivo: false,
    dias: [3, 6],
    fraseAgenda: "Aparece: qua e sáb",
    avisoNuncaAbre: null,
    precoRotulo: "R$ 48,90",
    categoriaNome: "Pratos principais",
    ...over,
  };
}

function montar(
  itens: ItemDoCardapio[],
  hrefEditarProduto: ((id: string) => string) | null = null,
): string {
  return renderToStaticMarkup(
    <ItensDoCardapio
      cardapio={{
        id: "c1",
        nome: "Especiais do Dia",
        descricao: "Aparece todo sábado e domingo.",
      }}
      itens={itens}
      acoes={ACOES}
      hrefEditarProduto={hrefEditarProduto}
      onAdicionar={vi.fn()}
      onTirar={vi.fn()}
      onMudou={vi.fn()}
    />,
  );
}

describe("ItensDoCardapio — a agenda é do VÍNCULO (276)", () => {
  it("o item ganha as 7 pílulas com os dias do vínculo marcados", () => {
    const html = montar([item()]);
    expect(html).toContain(
      'aria-label="Dias em que Feijoada da casa aparece neste cardápio"',
    );
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(2);
    expect((html.match(/aria-pressed="false"/g) ?? []).length).toBe(5);
  });

  it("a frase de agenda vem do servidor e é o aria-describedby do grupo", () => {
    const html = montar([item()]);
    expect(html).toContain("Aparece: qua e sáb");
    expect(html).toContain('id="agenda-p1"');
    expect(html).toContain('aria-describedby="agenda-p1"');
  });

  it("vínculo sem dias lê 'Todos os dias do cardápio' e não marca nenhuma", () => {
    const html = montar([
      item({ dias: null, fraseAgenda: "Todos os dias do cardápio" }),
    ]);
    expect(html).toContain("Todos os dias do cardápio");
    expect(html).not.toContain('aria-pressed="true"');
  });

  it("a faixa de RN-06 só aparece com avisoNuncaAbre, e é role=status", () => {
    expect(montar([item()])).not.toContain('role="status"');
    const html = montar([
      item({
        avisoNuncaAbre:
          "Este item nunca aparece: o cardápio só abre aos sábados e domingos.",
      }),
    ]);
    expect(html).toContain('role="status"');
    expect(html).toContain(
      "Este item nunca aparece: o cardápio só abre aos sábados e domingos.",
    );
    // Avisa, não bloqueia: nada de `aria-invalid="true"` no card.
    expect(html).not.toContain('aria-invalid="true"');
  });

  it("o card tem região aria-live para anunciar a escrita assíncrona", () => {
    expect(montar([item()])).toContain('aria-live="polite"');
  });

  it("as pílulas são as compactas (uma fila de 7 em 360px)", () => {
    const html = montar([item()]);
    expect(html).toContain("min-w-[40px]");
    expect(html).toContain("min-h-[44px]");
  });

  it("o selo de exclusivo só aparece para produto de cardápio (D14)", () => {
    expect(montar([item()])).not.toContain("Exclusivo de cardápio");
    expect(montar([item({ exclusivo: true })])).toContain(
      "Exclusivo de cardápio",
    );
  });
});

describe("ItensDoCardapio — o card do item (288)", () => {
  it("mostra preço e categoria na mesma linha, com o preço já formatado", () => {
    const html = montar([item()]);
    expect(html).toContain("R$ 48,90 · Pratos principais");
  });

  it("produto sem categoria mostra só o preço, sem separador órfão", () => {
    const html = montar([item({ categoriaNome: null })]);
    expect(html).toContain("R$ 48,90");
    expect(html).not.toContain("R$ 48,90 ·");
  });

  it("cada item é um card branco com o kebab nomeado (§10.2 regra 4, §5)", () => {
    const html = montar([item()]);
    expect(html).toContain('data-slot="card"');
    expect(html).toContain('aria-label="Mais ações de Feijoada da casa"');
    // O alvo de toque é literal, nunca `min-h-11`.
    expect(html).not.toContain("min-h-11");
  });

  it("a remoção NÃO redige copy nem conta nada aqui — é o ciclo do lote (D8)", () => {
    // RN-09-a: a contagem e as frases da confirmação vêm da prévia do
    // SERVIDOR, pelo `useLoteDeProdutos`. A trava mecânica é
    // `lote-contagem-do-servidor.test.ts`; aqui a prova é que este componente
    // não importa a copy de lote nem monta diálogo nenhum.
    const fonte = readFileSync(
      join(process.cwd(), "src/components/painel/ItensDoCardapio.tsx"),
      "utf8",
    );
    expect(fonte).not.toContain("copiaLotePromocao");
    expect(fonte).not.toContain("@/components/ui/alert-dialog");
  });

  it("cardápio VAZIO mostra o convite, nunca uma lista vazia", () => {
    const html = montar([]);
    expect(html).toContain("Nenhum item neste cardápio ainda");
    expect(html).toContain("Um cardápio sem item não muda nada na vitrine.");
    expect(html).toContain("Adicionar item");
  });

  it("nenhuma rota do painel é escrita aqui: o href de editar é INJETADO", () => {
    // O menu só existe aberto (portal), então a prova possível no SSR é que o
    // componente não carrega literal de rota nenhuma. A trava mecânica do
    // repositório é `rotaCardapiosInjetada.test.tsx`.
    expect(montar([item()], (id) => `/qualquer/${id}`)).not.toContain(
      "/painel/",
    );
  });
});
