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
