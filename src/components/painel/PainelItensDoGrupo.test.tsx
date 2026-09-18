/**
 * Testes de MARKUP do painel de itens de um grupo de opcional (issue 216).
 *
 * Ambiente: vitest com `environment: node`, sem jsdom. `renderToStaticMarkup`
 * prova DERIVAÇÃO DE ESTADO → HTML, não clique.
 *
 * O que este arquivo NÃO cobre, e o PR deve dizer: a fiação das actions
 * (exige clique), o `Escape`, o movimento de foco pós-remoção e o flush do
 * salvamento coalescido antes de cada mutação — tudo isso precisa de DOM real e
 * de evento real. A regra de coalescência em si já está em
 * `salvamento-coalescido.test.ts`.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PainelItensDoGrupo } from "./PainelItensDoGrupo";
import type { OpcionaisClientAcoes } from "@/app/(painel)/painel/(bloqueavel)/produtos/opcionais/OpcionaisClient";
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

function acoesBase(): OpcionaisClientAcoes {
  return {
    criarCategoriaOpcional: vi.fn(async () => ({ ok: true }) as const),
    atualizarCategoriaOpcional: vi.fn(async () => ({ ok: true }) as const),
    removerCategoriaOpcional: vi.fn(async () => ({ ok: true }) as const),
    criarOpcional: vi.fn(async () => ({ ok: true }) as const),
    atualizarOpcional: vi.fn(async () => ({ ok: true }) as const),
    alternarOpcionalAtivo: vi.fn(async () => ({ ok: true }) as const),
    removerOpcional: vi.fn(async () => ({ ok: true }) as const),
    salvarAssociacaoOpcionais: vi.fn(async () => ({ ok: true }) as const),
    reordenarOpcionaisDaCategoria: vi.fn(async () => ({ ok: true }) as const),
    reordenarItensDoGrupoOpcional: vi.fn(async () => ({ ok: true }) as const),
  };
}

function render(props: { itens?: Opcional[]; alcance?: string[] } = {}): string {
  return renderToStaticMarkup(
    <PainelItensDoGrupo
      id="itens-cp1-co1"
      grupoId="co-1"
      grupoNome="Bordas"
      itens={props.itens ?? [opcional()]}
      alcance={props.alcance ?? []}
      acoes={acoesBase()}
      onSalvo={() => {}}
    />,
  );
}

describe("PainelItensDoGrupo — aviso de alcance", () => {
  it("imprime a frase SÓ a partir de 2 categorias de produto", () => {
    const html = render({ alcance: ["Pizzas", "Esfihas", "Doces"] });
    expect(html).toContain(
      "Itens da biblioteca da loja. Editar ou remover vale para as 3 " +
        "categorias de produto que usam Bordas.",
    );
  });

  it("alcance 0 ou 1: NENHUM texto de alcance — o caso comum não vira ruído", () => {
    expect(render({ alcance: [] })).not.toContain("Itens da biblioteca");
    expect(render({ alcance: ["Pizzas"] })).not.toContain("Itens da biblioteca");
  });
});

describe("PainelItensDoGrupo — estados da lista", () => {
  it("grupo VAZIO: mensagem própria, botão adicionar e NENHUM `<ol>`", () => {
    const html = render({ itens: [] });
    expect(html).toContain("Nenhum opcional neste grupo ainda.");
    expect(html).toContain('aria-label="Adicionar opcional em Bordas"');
    expect(html).not.toContain("<ol");
  });

  it("grupo vazio ainda tem região viva para os eventos de ITEM", () => {
    // Sem a lista montada não há a região do `ModoReordenar`: o fallback local
    // assume, para que "item adicionado" não fique mudo.
    const html = render({ itens: [] });
    expect(html).toContain('role="status"');
    expect((html.match(/aria-live="polite"/g) ?? []).length).toBe(1);
  });

  it("grupo SÓ com inativos: avisa que o cliente não vê nenhuma opção", () => {
    const html = render({
      itens: [
        opcional({ id: "o-1", ativo: false }),
        opcional({ id: "o-2", nome: "Cheddar", ativo: false }),
      ],
    });
    expect(html).toContain(
      "Nenhum opcional ativo — o cliente não vê nenhuma opção aqui.",
    );
  });

  it("com ao menos um ativo, o aviso some", () => {
    const html = render({
      itens: [opcional({ id: "o-1", ativo: false }), opcional({ id: "o-2", nome: "Cheddar" })],
    });
    expect(html).not.toContain("Nenhum opcional ativo");
  });

  it("lista INATIVOS junto dos ativos — a RPC exige a permutação COMPLETA", () => {
    const html = render({
      itens: [opcional(), opcional({ id: "o-2", nome: "Requeijão", ativo: false })],
    });
    expect(html).toContain("Catupiry");
    expect(html).toContain("Requeijão");
    expect(html).toContain("Inativo");
  });

  it("uma só região viva com a lista montada (a do `ModoReordenar`)", () => {
    const html = render({ itens: [opcional(), opcional({ id: "o-2", nome: "Cheddar" })] });
    expect((html.match(/aria-live="polite"/g) ?? []).length).toBe(1);
  });
});

describe("PainelItensDoGrupo — estrutura e alvos", () => {
  it("o `id` do painel é o alvo do `aria-controls` do gatilho do grupo", () => {
    expect(render()).toContain('id="itens-cp1-co1"');
  });

  it("recua por RÉGUA vertical, não por margem de 16px por nível", () => {
    // ~20px em vez dos ~64px que quatro níveis de recuo ingênuo comeriam dos
    // 360px do modal da 217.
    const html = render();
    expect(html).toContain("border-l-2");
    expect(html).toContain("pl-3");
  });

  it("o botão adicionar fica FORA do `<ol>` e é alvo de 44px", () => {
    const html = render();
    const depoisDaLista = html.slice(html.indexOf("</ol>"));
    expect(depoisDaLista).toContain('aria-label="Adicionar opcional em Bordas"');
    expect(depoisDaLista).toContain("min-h-[44px]");
  });
});
