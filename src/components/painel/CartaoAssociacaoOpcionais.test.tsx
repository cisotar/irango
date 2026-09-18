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
} from "@/app/(painel)/painel/(bloqueavel)/produtos/opcionais/OpcionaisClient";
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
