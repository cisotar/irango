/**
 * Testes para `ProdutosClient` (issue 089) — badge combinado Oculto > Esgotado >
 * Disponível e rótulos dos dois controles de linha (visibilidade x
 * disponibilidade).
 *
 * Ambiente: vitest com environment=node (padrão do projeto — ver
 * StatusAssinatura.test.tsx). `renderToStaticMarkup` basta aqui porque
 * `useMediaQuery` é SSR-safe (retorna o baseline mobile-first quando `window`
 * não existe) e o que queremos provar é DERIVAÇÃO DE ESTADO → HTML, não clique.
 *
 * Fora do escopo deste arquivo (lacuna registrada, não coberta): provar que o
 * clique em "Ocultar/Exibir" invoca `alternarOculto` e o clique em
 * "Marcar esgotado/Disponibilizar" invoca `alternarDisponibilidade` — isso
 * exigiria simular eventos DOM reais (jsdom/happy-dom + @testing-library/react),
 * infraestrutura que o projeto não usa em nenhum teste hoje (confirmado: nem
 * jsdom nem @testing-library/react estão instalados). Essa invocação correta é
 * o ponto mais arriscado da issue 089 ("os dois handlers não se cruzam") e deve
 * ser verificada manualmente (`verificar`) até essa infra existir. A garantia
 * equivalente do lado do SERVIDOR já existe em
 * src/lib/actions/produto.test.ts ("alternarDisponibilidade NÃO escreve
 * oculto"), que cobre a metade que dinheiro/RLS de fato protege.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// ProdutosClient chama useRouter() no topo (client component); SSR estático
// não tem um App Router montado. Mesmo padrão de FormProduto.test.tsx.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { ProdutosClient } from "./ProdutosClient";
import type { Produto } from "@/lib/supabase/queries/produtos";

function produtoBase(overrides: Partial<Produto> = {}): Produto {
  return {
    id: "prod-1",
    loja_id: "loja-1",
    categoria_id: null,
    nome: "Pizza Margherita",
    descricao: null,
    preco: 42,
    foto_url: null,
    ordem: 0,
    disponivel: true,
    oculto: false,
    criado_em: "2025-01-01T00:00:00Z",
    atualizado_em: "2025-01-01T00:00:00Z",
    ...overrides,
  } as Produto;
}

function renderLista(produtos: Produto[]): string {
  return renderToStaticMarkup(
    <ProdutosClient
      lojaSlug="loja-teste"
      lojaId="loja-1"
      produtos={produtos}
      categorias={[]}
      opcionaisPorCategoria={{}}
      categoriasOpcional={[]}
    />,
  );
}

describe("badgeStatus — precedência Oculto > Esgotado > Disponível", () => {
  it("oculto=true, disponivel=true → badge 'Oculto' (nunca 'Disponível')", () => {
    const html = renderLista([produtoBase({ oculto: true, disponivel: true })]);
    expect(html).toContain("Oculto");
    expect(html).not.toContain(">Disponível<");
  });

  it("oculto=true, disponivel=false → badge 'Oculto' (nunca 'Esgotado')", () => {
    const html = renderLista([produtoBase({ oculto: true, disponivel: false })]);
    expect(html).toContain("Oculto");
    expect(html).not.toContain(">Esgotado<");
  });

  it("oculto=false, disponivel=false → badge 'Esgotado' (nunca 'Oculto')", () => {
    const html = renderLista([produtoBase({ oculto: false, disponivel: false })]);
    expect(html).toContain("Esgotado");
    expect(html).not.toContain("Oculto");
  });

  it("oculto=false, disponivel=true → badge 'Disponível' (nunca 'Oculto' nem 'Esgotado')", () => {
    const html = renderLista([produtoBase({ oculto: false, disponivel: true })]);
    expect(html).toContain("Disponível");
    expect(html).not.toContain("Oculto");
    expect(html).not.toContain("Esgotado");
  });
});

describe("rótulos dos dois controles — independentes por eixo", () => {
  it("produto visível (oculto=false) mostra botão 'Ocultar', não 'Exibir'", () => {
    const html = renderLista([produtoBase({ oculto: false })]);
    expect(html).toContain("Ocultar");
    expect(html).not.toContain(">Exibir<");
  });

  it("produto oculto (oculto=true) mostra botão 'Exibir', não 'Ocultar'", () => {
    const html = renderLista([produtoBase({ oculto: true })]);
    expect(html).toContain(">Exibir<");
    expect(html).not.toContain(">Ocultar<");
  });

  it("produto disponível mostra 'Marcar esgotado', não 'Disponibilizar'", () => {
    const html = renderLista([produtoBase({ disponivel: true })]);
    expect(html).toContain("Marcar esgotado");
    expect(html).not.toContain(">Disponibilizar<");
  });

  it("produto esgotado mostra 'Disponibilizar', não 'Marcar esgotado'", () => {
    const html = renderLista([produtoBase({ disponivel: false })]);
    expect(html).toContain(">Disponibilizar<");
    expect(html).not.toContain("Marcar esgotado");
  });

  it("produto oculto E esgotado mostra os DOIS rótulos de ação (eixos não se anulam)", () => {
    // Prova que os dois controles continuam presentes e corretos mesmo quando
    // o badge já mostra "Oculto" — a precedência é só visual do badge, os
    // controles de ação continuam refletindo cada eixo independentemente.
    const html = renderLista([
      produtoBase({ oculto: true, disponivel: false }),
    ]);
    expect(html).toContain(">Exibir<"); // ação de visibilidade
    expect(html).toContain(">Disponibilizar<"); // ação de disponibilidade
  });

  it("aria-label dos dois botões inclui o nome do produto e não se confundem entre si", () => {
    const html = renderLista([
      produtoBase({ nome: "Coxinha", oculto: false, disponivel: true }),
    ]);
    expect(html).toContain('aria-label="Ocultar Coxinha da vitrine"');
    expect(html).toContain('aria-label="Marcar Coxinha como esgotado"');
  });
});

describe("múltiplos produtos com estados distintos não vazam rótulo entre linhas", () => {
  it("cada produto exibe o badge e os rótulos do SEU próprio estado", () => {
    const html = renderLista([
      produtoBase({ id: "p1", nome: "Pizza", oculto: true, disponivel: true }),
      produtoBase({ id: "p2", nome: "Suco", oculto: false, disponivel: false }),
    ]);
    expect(html).toContain('aria-label="Exibir Pizza na vitrine"');
    expect(html).toContain('aria-label="Ocultar Suco da vitrine"');
    expect(html).toContain('aria-label="Disponibilizar Suco"');
  });
});

/**
 * Testes do slot `acoes.salvarAssociacaoOpcionais` (issue 129).
 *
 * A resolução `const salvarAssociacao = acoes?.salvarAssociacaoOpcionais ??
 * salvarAssociacaoOpcionais` roda no CORPO de `ProdutosClient` — a cada
 * render, incondicionalmente (não dentro de um handler de clique). Ou seja,
 * ao contrário da maioria das actions deste arquivo (resolvidas dentro de
 * handlers), um bug aqui — por exemplo trocar `acoes?.salvarAssociacaoOpcionais`
 * por `acoes!.salvarAssociacaoOpcionais` — lançaria em TODO render do painel
 * do lojista (que sempre renderiza sem `acoes`), o mesmo padrão de regressão
 * do commit 0bb5864 ("escopo admin perdia o binding do client — toda escrita
 * admin quebrava em prod"). Os testes existentes acima já renderizam sem
 * `acoes` e cobrem isso incidentalmente; os dois abaixo tornam essa garantia
 * explícita para o 10º slot acrescentado por esta issue.
 */
describe("slot acoes.salvarAssociacaoOpcionais (issue 129)", () => {
  it("sem acoes: painel do lojista renderiza normalmente (a resolução no corpo do componente não lança)", () => {
    const html = renderLista([produtoBase()]);
    expect(html).toContain("Produtos");
  });

  it("com as 10 actions de acoes injetadas (incluindo salvarAssociacaoOpcionais): HTML idêntico ao sem acoes, nenhuma é chamada", () => {
    const acoesMock = {
      removerProduto: vi.fn(async () => ({ ok: true }) as const),
      alternarDisponibilidade: vi.fn(async () => ({ ok: true }) as const),
      alternarOculto: vi.fn(async () => ({ ok: true }) as const),
      criarProduto: vi.fn(async () => ({ ok: true }) as const),
      atualizarProduto: vi.fn(async () => ({ ok: true }) as const),
      enviarFotoProduto: vi.fn(async () => ({ ok: true, url: "" }) as never),
      criarCategoria: vi.fn(async () => ({ ok: true }) as const),
      atualizarCategoria: vi.fn(async () => ({ ok: true }) as const),
      removerCategoria: vi.fn(async () => ({ ok: true }) as const),
      salvarAssociacaoOpcionais: vi.fn(async () => ({ ok: true }) as const),
    } as unknown as NonNullable<
      Parameters<typeof ProdutosClient>[0]["acoes"]
    >;

    const produtos = [produtoBase()];
    const semAcoes = renderToStaticMarkup(
      <ProdutosClient
        lojaSlug="loja-teste"
        lojaId="loja-1"
        produtos={produtos}
        categorias={[]}
        opcionaisPorCategoria={{}}
        categoriasOpcional={[]}
      />,
    );
    const comAcoes = renderToStaticMarkup(
      <ProdutosClient
        lojaSlug="loja-teste"
        lojaId="loja-1"
        produtos={produtos}
        categorias={[]}
        opcionaisPorCategoria={{}}
        categoriasOpcional={[]}
        acoes={acoesMock}
      />,
    );

    expect(comAcoes).toBe(semAcoes);
    for (const fn of Object.values(acoesMock)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

describe("botão '+ Novo produto' por card de categoria (spec botao-novo-produto-por-categoria)", () => {
  const CATEGORIAS = [
    { id: "c1", nome: "Lanches", exibir_imagens: true },
    { id: "c2", nome: "Bebidas", exibir_imagens: true },
  ];

  function renderComCategorias(produtos: Produto[]): string {
    return renderToStaticMarkup(
      <ProdutosClient
        lojaSlug="loja-teste"
        lojaId="loja-1"
        produtos={produtos}
        categorias={CATEGORIAS}
        opcionaisPorCategoria={{}}
        categoriasOpcional={[]}
      />,
    );
  }

  it("cada card de categoria real exibe o botão, identificado pela categoria no aria-label", () => {
    const html = renderComCategorias([
      produtoBase({ categoria_id: "c1" }),
      produtoBase({ id: "prod-2", nome: "Guaraná", categoria_id: "c2" }),
    ]);
    expect(html).toContain('aria-label="Novo produto em Lanches"');
    expect(html).toContain('aria-label="Novo produto em Bebidas"');
  });

  it("grupo 'Sem categoria' (id null) NÃO recebe o botão (RN-2), mesma guarda do 'Opcionais'", () => {
    const html = renderComCategorias([
      produtoBase({ categoria_id: "c1" }),
      produtoBase({ id: "prod-2", nome: "Avulso", categoria_id: null }),
    ]);
    expect(html).toContain("Sem categoria");
    // Só a categoria real ganha o botão: exatamente 1 aria-label no HTML.
    expect(html.match(/aria-label="Novo produto em /g)?.length).toBe(1);
    expect(html).toContain('aria-label="Novo produto em Lanches"');
  });

  it("botão global 'Novo produto' do topo continua presente mesmo sem nenhum botão de card", () => {
    // Só produto sem categoria => zero botões de card; o "Novo produto"
    // encontrado é necessariamente o global do topo.
    const html = renderComCategorias([produtoBase({ categoria_id: null })]);
    expect(html.match(/aria-label="Novo produto em /g)).toBeNull();
    expect(html).toContain(">Novo produto<");
  });
});
