/**
 * Fase RED (TDD) da issue 331 — fatia F5: FONTE ÚNICA no `ProdutosClient`.
 *
 * Critério do plano: "alternar no card reflete no FormProduto aberto sem
 * refetch". Sem jsdom não há clique; o que garante esse comportamento é
 * ESTRUTURAL e é o que este arquivo prova:
 *
 *  1. o `ProdutosClient` chama `useOcultacoesOpcionais` UMA vez por render
 *     (uma instância, um mapa otimista), semeado com `ocultosOpcionais` (prop
 *     nova, linhas do servidor) e a action injetada `acoes.salvarOcultacoesOpcionais`;
 *  2. as pílulas do CARD (`PilulasOpcionaisDoProduto`, variante "card") e o
 *     `FormProduto` recebem o MESMO objeto `ocultacoes` (identidade `toBe`).
 *
 * Com 1+2, o `alternar` do card muda o estado que o form lê no mesmo render —
 * não existe segunda cópia para ficar velha até um `router.refresh()`.
 *
 * Mocks deste arquivo (isolados aqui para não tocar os 60+ casos de
 * `ProdutosClient.test.tsx`):
 *  - o hook devolve uma SENTINELA e conta as chamadas;
 *  - `PilulasOpcionaisDoProduto` e `FormProduto` só registram as props;
 *  - `Sheet*` renderiza os filhos (o form do mobile fica montado no SSR — o
 *    Sheet fechado, sem isso, não chama o `FormProduto`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const SENTINELA = {
  __sentinela: "ocultacoes-do-produtos-client",
  oculto: () => false,
  alternar: async () => true,
  aplicarLote: async () => true,
};
const useOcultacoesOpcionais = vi.fn((..._a: unknown[]) => SENTINELA);
vi.mock("@/components/painel/useOcultacoesOpcionais", async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  useOcultacoesOpcionais: (...a: unknown[]) => useOcultacoesOpcionais(...a),
}));

const propsPilulas: Array<Record<string, unknown>> = [];
vi.mock("@/components/painel/PilulasOpcionaisDoProduto", () => ({
  PilulasOpcionaisDoProduto: (props: Record<string, unknown>) => {
    propsPilulas.push(props);
    return null;
  },
}));

const propsForm: Array<Record<string, unknown>> = [];
vi.mock("@/components/painel/FormProduto", async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  FormProduto: (props: Record<string, unknown>) => {
    propsForm.push(props);
    return null;
  },
}));

vi.mock("@/components/ui/sheet", () => {
  const Passa = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Sheet: Passa,
    SheetContent: Passa,
    SheetDescription: Passa,
    SheetHeader: Passa,
    SheetTitle: Passa,
    SheetTrigger: Passa,
    SheetFooter: Passa,
    SheetClose: Passa,
  };
});

// As sanfonas de categoria abrem fechadas; sem `keepMounted` as linhas de
// produto não montam e as pílulas do card nunca seriam capturadas.
vi.mock("@/components/ui/accordion", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/ui/accordion")>();
  return {
    ...original,
    AccordionContent: (props: React.ComponentProps<typeof original.AccordionContent>) => (
      <original.AccordionContent keepMounted {...props} />
    ),
  };
});

import { ProdutosClient } from "./ProdutosClient";
import type { AcoesProdutosClient, ProdutosClientProps } from "./ProdutosClient";
import type { Produto } from "@/lib/supabase/queries/produtos";

const salvarOcultacoesOpcionais = vi.fn(async () => ({ ok: true }) as const);

function acoes(): AcoesProdutosClient {
  const ok = () => vi.fn(async () => ({ ok: true }) as const);
  return {
    removerProduto: ok(),
    alternarDisponibilidade: ok(),
    alternarOculto: ok(),
    criarProduto: ok(),
    atualizarProduto: ok(),
    enviarFotoProduto: vi.fn(async () => ({ ok: true, url: "" }) as never),
    listarImagensGaleria: vi.fn(async () => ({ ok: true as const, imagens: [], proximo_cursor: null })),
    enviarImagemGaleria: vi.fn(async () => ({ ok: false as const, erro: "" })),
    criarCategoria: ok(),
    atualizarCategoria: ok(),
    removerCategoria: ok(),
    alternarExibirImagens: ok(),
    reordenarCategorias: ok(),
    salvarAssociacaoOpcionais: ok(),
    criarCategoriaOpcional: ok(),
    atualizarCategoriaOpcional: ok(),
    removerCategoriaOpcional: ok(),
    criarOpcional: ok(),
    atualizarOpcional: ok(),
    alternarOpcionalAtivo: ok(),
    removerOpcional: ok(),
    reordenarOpcionaisDaCategoria: ok(),
    reordenarItensDoGrupoOpcional: ok(),
    aplicarFrequenciaEmProdutos: ok(),
    salvarGradeDeDias: ok(),
    alternarOcultaCategoria: ok(),
    definirFrequenciaCategoria: ok(),
    // [331] a chave nova do contrato.
    salvarOcultacoesOpcionais,
  } as unknown as AcoesProdutosClient;
}

const FREQUENCIAS: ProdutosClientProps["frequencias"] = {
  produtos: {},
  categorias: {},
  agora: "2026-09-27T12:00:00.000Z",
  timezone: "America/Sao_Paulo",
};

function produto(id: string, nome: string): Produto {
  return {
    id,
    loja_id: "loja-1",
    categoria_id: "c1",
    nome,
    descricao: null,
    preco: 30,
    foto_url: null,
    ordem: 0,
    disponivel: true,
    oculto: false,
    criado_em: "2025-01-01T00:00:00Z",
    atualizado_em: "2025-01-01T00:00:00Z",
  } as Produto;
}

const OPCIONAIS_POR_CATEGORIA = {
  c1: [
    { categoriaOpcionalId: "g-adic", categoriaOpcionalNome: "Adicionais", ordem: 0, opcionais: [] },
    { categoriaOpcionalId: "g-molhos", categoriaOpcionalNome: "Molhos", ordem: 1, opcionais: [] },
  ],
};
const OCULTOS = [{ produto_id: "p1", categoria_opcional_id: "g-molhos" }];

function render(): string {
  // `ocultosOpcionais` via spread: prop nova, o tipo ainda não a declara (RED).
  const extras: Record<string, unknown> = { ocultosOpcionais: OCULTOS };
  return renderToStaticMarkup(
    <ProdutosClient
      lojaSlug="loja-teste"
      lojaId="loja-1"
      produtos={[produto("p1", "X-Burger"), produto("p2", "X-Salada")]}
      categorias={[{ id: "c1", nome: "Lanches", exibir_imagens: true }]}
      opcionaisPorCategoria={OPCIONAIS_POR_CATEGORIA}
      hrefCardapios="/painel/cardapios"
      vinculosPorProduto={{}}
      promocoes={{}}
      fusoLojaRotulo="America/Sao_Paulo (GMT-3)"
      frequencias={FREQUENCIAS}
      categoriasOpcional={[]}
      opcionais={[]}
      associacoes={[]}
      acoes={acoes()}
      {...extras}
    />,
  );
}

beforeEach(() => {
  useOcultacoesOpcionais.mockClear();
  propsPilulas.length = 0;
  propsForm.length = 0;
});

describe("331 F5 · ProdutosClient — UMA instância de ocultações para card e modal", () => {
  it("chama useOcultacoesOpcionais UMA vez, com as linhas do servidor e a action injetada", () => {
    render();
    expect(useOcultacoesOpcionais).toHaveBeenCalledTimes(1);
    const [ocultos, salvar] = useOcultacoesOpcionais.mock.calls[0];
    expect(ocultos).toBe(OCULTOS);
    expect(salvar).toBe(salvarOcultacoesOpcionais);
  });

  it("cada linha de produto monta as pílulas (variante card) com a MESMA instância", () => {
    render();
    const doCard = propsPilulas.filter((p) => p.variante === "card");
    expect(doCard.map((p) => p.produtoId).sort()).toEqual(["p1", "p2"]);
    for (const p of doCard) expect(p.ocultacoes).toBe(SENTINELA);
    // os grupos da categoria do produto, repassados sem filtro próprio.
    expect(doCard[0].grupos).toEqual(OPCIONAIS_POR_CATEGORIA.c1);
  });

  it("o FormProduto recebe a MESMA instância e os grupos por categoria (D3: o form recalcula pela categoria do estado)", () => {
    render();
    expect(propsForm.length).toBeGreaterThan(0);
    for (const f of propsForm) {
      expect(f.ocultacoes).toBe(SENTINELA);
      expect(f.opcionaisPorCategoria).toBe(OPCIONAIS_POR_CATEGORIA);
    }
  });

  it("o Badge estático some: a linha não desenha mais o nome do grupo fora das pílulas", () => {
    // Com as pílulas mockadas (null), sobra no HTML só o que o ProdutosClient
    // desenha por conta própria. Se o Badge antigo ficasse, "Molhos" apareceria.
    const html = render();
    expect(html).not.toContain("Molhos");
  });
});
