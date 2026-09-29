/**
 * Testes do `CartaoAssociacaoOpcionais` (issue 214 — extração de dentro de
 * `OpcionaisClient.tsx`, sem mudança de comportamento).
 *
 * `OpcionaisClient.test.tsx` já cobre boa parte deste componente por via da
 * aba "por categoria" — checkbox, ordem, segmento "Disponíveis", ausência dos
 * botões antigos. Este arquivo cobre só o que ficou de fora de lá: o rótulo
 * "N item(ns)" de `rotuloItens`, que só aparece dentro de cada linha do
 * segmento "Disponíveis" e nunca foi asserido byte-a-byte — nem a
 * singularização (1 item) nem o default de `totalItensPorGrupo` ausente do
 * Map (0 itens, categoria recém-criada sem opcional nenhum).
 *
 * Ambiente: vitest environment=node — sem jsdom. `renderToStaticMarkup`, igual
 * ao resto do módulo (`ReordenarOpcionaisDaCategoria.test.tsx`).
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Accordion } from "@/components/ui/accordion";
import { CartaoAssociacaoOpcionais } from "./CartaoAssociacaoOpcionais";
import type {
  CategoriaProduto,
  OpcionaisClientAcoes,
} from "@/components/painel/contrato-opcionais";
import type { CategoriaOpcional } from "@/lib/supabase/queries/opcionais";

function categoriaOpcional(
  overrides: Partial<CategoriaOpcional> = {},
): CategoriaOpcional {
  return {
    id: "co-1",
    loja_id: "loja-1",
    nome: "Laticínios",
    ordem: 0,
    criado_em: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

const CATEGORIA_PRODUTO: CategoriaProduto = { id: "cp-1", nome: "Pizzas" };

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
    // 11ª (issue 331) — mesma regra.
    salvarOcultacoesOpcionais: vi.fn(async () => ({ ok: true }) as const),
  };
}

/**
 * `AccordionItem` (Base UI) lê `useAccordionRootContext()` — sem o `Accordion`
 * pai por volta, o SSR estático lança. É o mesmo wrapper que
 * `OpcionaisClient` usa ao redor de cada cartão.
 */
function render(props: {
  categoriasOpcional: CategoriaOpcional[];
  totalItensPorGrupo: Map<string, number>;
}): string {
  return renderToStaticMarkup(
    <Accordion multiple defaultValue={[CATEGORIA_PRODUTO.id]}>
      <CartaoAssociacaoOpcionais
        categoriaProduto={CATEGORIA_PRODUTO}
        categoriasOpcional={props.categoriasOpcional}
        selecionadosIniciais={new Set()}
        ordemPorGrupo={new Map()}
        totalItensPorGrupo={props.totalItensPorGrupo}
        // Props da 216 — este arquivo cobre o segmento "Disponíveis", onde
        // nenhum painel de itens abre: mapas vazios bastam.
        opcionaisPorGrupo={new Map()}
        alcancePorGrupo={new Map()}
        onSalvo={() => {}}
        acoes={acoesBase()}
      />
    </Accordion>,
  );
}

describe("rótulo de itens no segmento Disponíveis (issue 214)", () => {
  it("singulariza para exatamente 1 item", () => {
    const html = render({
      categoriasOpcional: [categoriaOpcional({ id: "co-1", nome: "Bordas" })],
      totalItensPorGrupo: new Map([["co-1", 1]]),
    });
    expect(html).toContain("1 item");
    expect(html).not.toContain("1 itens");
  });

  it("pluraliza para 0 e para N > 1", () => {
    const html = render({
      categoriasOpcional: [
        categoriaOpcional({ id: "co-1", nome: "Bordas" }),
        categoriaOpcional({ id: "co-2", nome: "Molhos" }),
      ],
      totalItensPorGrupo: new Map([["co-1", 3]]), // co-2 fica de fora do Map
    });
    // co-1: 3 itens (do Map). co-2: sem entrada no Map — cai no default `?? 0`.
    expect(html).toContain("3 itens");
    expect(html).toContain("0 itens");
  });

  it("categoria de opcional sem nenhum opcional cadastrado não quebra o render", () => {
    // Map vazio inteiro — cenário de uma categoria de opcional recém-criada,
    // antes de qualquer item ser adicionado a ela.
    const html = render({
      categoriasOpcional: [categoriaOpcional({ id: "co-1", nome: "Vazia" })],
      totalItensPorGrupo: new Map(),
    });
    expect(html).toContain("0 itens");
    expect(html).toContain("Vazia");
  });
});

/**
 * A sanfona de itens (issue 216) — o que dá para provar por markup estático: o
 * gatilho do disclosure existe na linha do grupo MARCADO, com `aria-expanded` e
 * `aria-controls`, e o painel só monta com o grupo aberto (o que exige clique e
 * por isso não é asserido aqui; o painel em si está coberto em
 * `PainelItensDoGrupo.test.tsx`).
 */
describe("gatilho do disclosure na linha do grupo (issue 216)", () => {
  function renderComMarcado(): string {
    return renderToStaticMarkup(
      <Accordion multiple defaultValue={[CATEGORIA_PRODUTO.id]}>
        <CartaoAssociacaoOpcionais
          categoriaProduto={CATEGORIA_PRODUTO}
          categoriasOpcional={[categoriaOpcional({ id: "co-1", nome: "Bordas" })]}
          selecionadosIniciais={new Set(["co-1"])}
          ordemPorGrupo={new Map([["co-1", 0]])}
          totalItensPorGrupo={new Map([["co-1", 2]])}
          opcionaisPorGrupo={new Map()}
          alcancePorGrupo={new Map()}
          onSalvo={() => {}}
          acoes={acoesBase()}
        />
      </Accordion>,
    );
  }

  it("o bloco do nome vira o gatilho, com `aria-expanded` e `aria-controls`", () => {
    // Não é um botão novo: em 360px a linha já está no teto de largura, e um 5º
    // alvo de 44px estouraria. O nome é o maior alvo de toque da tela de graça.
    const html = renderComMarcado();
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="itens-cp-1-co-1"');
    expect(html).toContain("Bordas");
    expect(html).toContain("2 itens");
  });

  it("nasce FECHADO e sem painel: cinco abertos virariam um rolo infinito", () => {
    // O `aria-expanded="true"` do cartão (o `AccordionTrigger` da categoria de
    // produto) é outro controle — o que se assere aqui é o painel de ITENS.
    const html = renderComMarcado();
    expect(html).not.toContain('id="itens-cp-1-co-1"');
    expect(html).not.toContain("Nenhum opcional neste grupo ainda.");
  });

  it("a alça de arrasto do GRUPO continua lá — só os itens perdem o arrasto", () => {
    expect(renderComMarcado()).toContain('aria-label="Reordenar Bordas"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// [331] F5 — "Por produto" em cada grupo MARCADO e SALVO do cartão. Abre o
// `ProdutosDoGrupoOpcional` (lista de produtos desta categoria). Props novas,
// OPCIONAIS: `produtos` e `ocultacoes` (o hook do OpcionaisClient). Sem elas,
// nada novo aparece (as outras telas que montam o cartão seguem iguais).
// ═══════════════════════════════════════════════════════════════════════════
describe("[331] CartaoAssociacaoOpcionais — botão 'Por produto'", () => {
  const PRODUTOS = [
    { id: "p1", nome: "Margherita", categoria_id: CATEGORIA_PRODUTO.id },
    { id: "p2", nome: "Calabresa", categoria_id: CATEGORIA_PRODUTO.id },
  ];
  const OCULTACOES = {
    oculto: () => false,
    alternar: vi.fn(async () => true),
    aplicarLote: vi.fn(async () => true),
  };

  function renderMarcado(extras: Record<string, unknown> | null): string {
    return renderToStaticMarkup(
      <Accordion multiple defaultValue={[CATEGORIA_PRODUTO.id]}>
        <CartaoAssociacaoOpcionais
          categoriaProduto={CATEGORIA_PRODUTO}
          categoriasOpcional={[
            categoriaOpcional({ id: "co-1", nome: "Bordas" }),
            categoriaOpcional({ id: "co-2", nome: "Molhos" }),
          ]}
          // Bordas marcado E salvo; Molhos disponível (não marcado).
          selecionadosIniciais={new Set(["co-1"])}
          ordemPorGrupo={new Map([["co-1", 0]])}
          totalItensPorGrupo={new Map([["co-1", 2], ["co-2", 1]])}
          opcionaisPorGrupo={new Map()}
          alcancePorGrupo={new Map()}
          onSalvo={() => {}}
          acoes={acoesBase()}
          {...(extras ?? {})}
        />
      </Accordion>,
    );
  }

  it("grupo marcado e salvo ganha 'Por produto', nomeado pelo grupo", () => {
    const html = renderMarcado({ produtos: PRODUTOS, ocultacoes: OCULTACOES });
    expect(html).toContain("Por produto");
    expect(html).toMatch(/aria-label="[^"]*Por produto[^"]*Bordas[^"]*"|aria-label="[^"]*Bordas[^"]*Por produto[^"]*"/i);
  });

  it("grupo só DISPONÍVEL (não marcado) não ganha o botão — um por grupo marcado", () => {
    const html = renderMarcado({ produtos: PRODUTOS, ocultacoes: OCULTACOES });
    expect((html.match(/Por produto/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(html).not.toMatch(/aria-label="[^"]*Por produto[^"]*Molhos[^"]*"/i);
    expect(html).not.toMatch(/aria-label="[^"]*Molhos[^"]*Por produto[^"]*"/i);
  });

  it("sem `produtos`/`ocultacoes` (quem não injeta) → nenhum 'Por produto'", () => {
    const html = renderMarcado(null);
    expect(html).toContain("Bordas");
    expect(html).not.toContain("Por produto");
  });
});
