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
import type { AcoesProdutosClient } from "./ProdutosClient";
import type { Produto } from "@/lib/supabase/queries/produtos";

/**
 * Injeção mínima e COMPLETA das actions (issue 160: as 12 chaves de `acoes`
 * são obrigatórias — não há mais default apontando para a action do lojista).
 * Cada chamada devolve stubs novos, para que dois renders possam ser comparados
 * por identidade de função quando o teste precisa disso.
 */
function acoesBase(): AcoesProdutosClient {
  return {
    removerProduto: vi.fn(async () => ({ ok: true }) as const),
    alternarDisponibilidade: vi.fn(async () => ({ ok: true }) as const),
    alternarOculto: vi.fn(async () => ({ ok: true }) as const),
    criarProduto: vi.fn(async () => ({ ok: true }) as const),
    atualizarProduto: vi.fn(async () => ({ ok: true }) as const),
    enviarFotoProduto: vi.fn(async () => ({ ok: true, url: "" }) as never),
    criarCategoria: vi.fn(async () => ({ ok: true }) as const),
    atualizarCategoria: vi.fn(async () => ({ ok: true }) as const),
    removerCategoria: vi.fn(async () => ({ ok: true }) as const),
    alternarExibirImagens: vi.fn(async () => ({ ok: true }) as const),
    reordenarCategorias: vi.fn(async () => ({ ok: true }) as const),
    salvarAssociacaoOpcionais: vi.fn(async () => ({ ok: true }) as const),
  } as unknown as AcoesProdutosClient;
}

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
      acoes={acoesBase()}
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
 * Testes da injeção de `acoes` (issue 129 — slot
 * `salvarAssociacaoOpcionais`; issue 160 — a prop e suas 12 chaves passaram a
 * ser OBRIGATÓRIAS, sem default apontando para a action do lojista).
 *
 * A desestruturação `const { removerProduto, …, salvarAssociacaoOpcionais }
 * = acoes` roda no CORPO de `ProdutosClient` — a cada render,
 * incondicionalmente (não dentro de um handler de clique). Ou seja, ao
 * contrário da maioria das actions deste arquivo (resolvidas dentro de
 * handlers), um bug aqui lançaria em TODO render, o mesmo padrão de regressão
 * do commit 0bb5864 ("escopo admin perdia o binding do client — toda escrita
 * admin quebrava em prod").
 *
 * Com o default removido, as duas vias (page do lojista e wrapper admin) são
 * estruturalmente idênticas: ambas passam as 12 chaves, mudando só QUAIS
 * funções. O teste abaixo prova que a origem da injeção não altera o HTML —
 * se o markup dependesse da identidade de uma action, o wrapper admin
 * renderizaria uma tela diferente da do lojista.
 */
describe("injeção de acoes (issues 129 e 160)", () => {
  it("a via do lojista renderiza a tela normalmente (a desestruturação no corpo do componente não lança)", () => {
    const html = renderLista([produtoBase()]);
    expect(html).toContain("Produtos");
  });

  it("duas injeções distintas das 12 actions produzem HTML idêntico e nenhuma é chamada no render", () => {
    const acoesLojista = acoesBase();
    const acoesAdmin = acoesBase();
    const produtos = [produtoBase()];

    function render(acoes: AcoesProdutosClient): string {
      return renderToStaticMarkup(
        <ProdutosClient
          lojaSlug="loja-teste"
          lojaId="loja-1"
          produtos={produtos}
          categorias={[]}
          opcionaisPorCategoria={{}}
          categoriasOpcional={[]}
          acoes={acoes}
        />,
      );
    }

    expect(render(acoesAdmin)).toBe(render(acoesLojista));
    for (const fn of [
      ...Object.values(acoesLojista),
      ...Object.values(acoesAdmin),
    ]) {
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
        acoes={acoesBase()}
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

/**
 * Cenário 11 da issue 175 — GATE do botão "Reordenar categorias".
 *
 * O gate é sobre `categorias.length` (TODAS), nunca sobre os grupos
 * renderizados: `agruparPorCategoria` descarta categoria vazia, então contar
 * grupos faria o botão sumir justamente para a loja que acabou de criar
 * categorias e ainda não cadastrou produto — o momento em que ela mais quer
 * ordenar o cardápio.
 */
describe("gate do botão 'Reordenar categorias' (issue 175, cenário 11)", () => {
  function renderComNCategorias(
    categorias: Array<{ id: string; nome: string }>,
    produtos: Produto[] = [],
  ): string {
    return renderToStaticMarkup(
      <ProdutosClient
        lojaSlug="loja-teste"
        lojaId="loja-1"
        produtos={produtos}
        categorias={categorias.map((c) => ({ ...c, exibir_imagens: true }))}
        opcionaisPorCategoria={{}}
        categoriasOpcional={[]}
        acoes={acoesBase()}
      />,
    );
  }

  it("0 categorias → botão NÃO renderiza (nada a ordenar)", () => {
    expect(renderComNCategorias([])).not.toContain("Reordenar categorias");
  });

  it("1 categoria → botão NÃO renderiza (lista de 1 não tem ordem)", () => {
    // Um botão desabilitado aqui só produziria "por que não funciona?" sem
    // resposta na tela; ausência de controle para operação impossível não
    // precisa de explicação.
    const html = renderComNCategorias([{ id: "c1", nome: "Lanches" }]);
    expect(html).not.toContain("Reordenar categorias");
  });

  it("2 categorias → botão RENDERIZA", () => {
    const html = renderComNCategorias([
      { id: "c1", nome: "Lanches" },
      { id: "c2", nome: "Bebidas" },
    ]);
    expect(html).toContain("Reordenar categorias");
  });

  it("2 categorias SEM NENHUM produto → botão RENDERIZA (gate não olha grupos)", () => {
    // Se o gate usasse `grupos.length`, aqui daria 0 e o botão sumiria — mas
    // ordenar antes de cadastrar é legítimo e é quando o lojista monta o cardápio.
    const html = renderComNCategorias(
      [
        { id: "c1", nome: "Lanches" },
        { id: "c2", nome: "Bebidas" },
      ],
      [],
    );
    expect(html).toContain("Reordenar categorias");
  });

  it("só produtos soltos, 0 categorias → botão NÃO renderiza", () => {
    // O grupo sintético "Sem categoria" não é ordenável.
    const html = renderComNCategorias([], [produtoBase({ categoria_id: null })]);
    expect(html).toContain("Sem categoria");
    expect(html).not.toContain("Reordenar categorias");
  });
});

/**
 * Metade "listagem normal" do cenário 10 da issue 175 — a outra metade
 * ("aparece no modo com 0 produtos") é provada em ReordenarCategorias.test.tsx
 * ([C10]), o único lugar onde o modo reordenar é observável sem simular clique
 * (ele está SEMPRE ligado nesse componente). Aqui o modo está sempre DESLIGADO
 * (render inicial estático), então é o lugar certo para provar a outra metade:
 * a categoria sem produto não pode aparecer como card na tela normal.
 */
describe("categoria vazia NÃO aparece na listagem normal (issue 175, cenário 10)", () => {
  it("categoria sem nenhum produto não vira card (agruparPorCategoria descarta grupo vazio)", () => {
    const html = renderToStaticMarkup(
      <ProdutosClient
        lojaSlug="loja-teste"
        lojaId="loja-1"
        produtos={[produtoBase({ categoria_id: "c1" })]}
        categorias={[
          { id: "c1", nome: "Lanches", exibir_imagens: true },
          { id: "c2", nome: "Bebidas", exibir_imagens: true }, // sem produto
        ]}
        acoes={acoesBase()}
        opcionaisPorCategoria={{}}
        categoriasOpcional={[]}
      />,
    );
    expect(html).toContain("Lanches");
    // "Bebidas" não pode aparecer em lugar NENHUM do HTML: nem como card, nem
    // vazando por engano do modo reordenar (que aqui está desligado).
    expect(html).not.toContain("Bebidas");
  });
});
