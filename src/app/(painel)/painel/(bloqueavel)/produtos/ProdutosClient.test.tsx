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

// As sanfonas de categoria abrem fechadas; sem `keepMounted` o painel fechado
// não entra no HTML e as asserções sobre o conteúdo dos grupos não o veriam.
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
import type {
  AcoesProdutosClient,
  ProdutosClientProps,
} from "./ProdutosClient";
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
    // [217] `AcoesProdutosClient` virou interseção com `OpcionaisClientAcoes`:
    // o modal do cardápio monta o mesmo cartão de associação da página irmã.
    criarCategoriaOpcional: vi.fn(async () => ({ ok: true }) as const),
    atualizarCategoriaOpcional: vi.fn(async () => ({ ok: true }) as const),
    removerCategoriaOpcional: vi.fn(async () => ({ ok: true }) as const),
    criarOpcional: vi.fn(async () => ({ ok: true }) as const),
    atualizarOpcional: vi.fn(async () => ({ ok: true }) as const),
    alternarOpcionalAtivo: vi.fn(async () => ({ ok: true }) as const),
    removerOpcional: vi.fn(async () => ({ ok: true }) as const),
    reordenarOpcionaisDaCategoria: vi.fn(async () => ({ ok: true }) as const),
    reordenarItensDoGrupoOpcional: vi.fn(async () => ({ ok: true }) as const),
    // [323] As 4 da frequência de exibição.
    aplicarFrequenciaEmProdutos: vi.fn(async () => ({ ok: true }) as const),
    salvarGradeDeDias: vi.fn(async () => ({ ok: true }) as const),
    alternarOcultaCategoria: vi.fn(async () => ({ ok: true }) as const),
    definirFrequenciaCategoria: vi.fn(async () => ({ ok: true }) as const),
  } as unknown as AcoesProdutosClient;
}

/** [323] Projeção de frequência vazia: nenhum chip, nenhum aviso. */
const FREQUENCIAS_VAZIAS: ProdutosClientProps["frequencias"] = {
  produtos: {},
  categorias: {},
  agora: "2026-09-27T12:00:00.000Z",
  timezone: "America/Sao_Paulo",
};

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

function renderLista(
  produtos: Produto[],
  vinculosPorProduto: ProdutosClientProps["vinculosPorProduto"] = {},
): string {
  return renderToStaticMarkup(
    <ProdutosClient
      lojaSlug="loja-teste"
      lojaId="loja-1"
      produtos={produtos}
      categorias={[]}
      opcionaisPorCategoria={{}}
      hrefCardapios="/painel/cardapios"
      vinculosPorProduto={vinculosPorProduto}
      promocoes={{}}
      fusoLojaRotulo="America/Sao_Paulo (GMT-3)"
      frequencias={FREQUENCIAS_VAZIAS}
      categoriasOpcional={[]}
      opcionais={[]}
      associacoes={[]}
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
    const html = renderLista([
      produtoBase({ oculto: true, disponivel: false }),
    ]);
    expect(html).toContain("Oculto");
    expect(html).not.toContain(">Esgotado<");
  });

  it("oculto=false, disponivel=false → badge 'Esgotado' (nunca 'Oculto')", () => {
    const html = renderLista([
      produtoBase({ oculto: false, disponivel: false }),
    ]);
    expect(html).toContain("Esgotado");
    expect(html).not.toContain("Oculto");
  });

  it("oculto=false, disponivel=true → badge 'Disponível' (nunca 'Oculto' nem 'Esgotado')", () => {
    const html = renderLista([
      produtoBase({ oculto: false, disponivel: true }),
    ]);
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
          hrefCardapios="/painel/cardapios"
          vinculosPorProduto={{}}
          promocoes={{}}
          fusoLojaRotulo="America/Sao_Paulo (GMT-3)"
          frequencias={FREQUENCIAS_VAZIAS}
          categoriasOpcional={[]}
          opcionais={[]}
          associacoes={[]}
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

  function renderComCategorias(
    produtos: Produto[],
    categorias = CATEGORIAS,
  ): string {
    return renderToStaticMarkup(
      <ProdutosClient
        lojaSlug="loja-teste"
        lojaId="loja-1"
        produtos={produtos}
        categorias={categorias}
        opcionaisPorCategoria={{}}
        hrefCardapios="/painel/cardapios"
        vinculosPorProduto={{}}
        promocoes={{}}
        fusoLojaRotulo="America/Sao_Paulo (GMT-3)"
        frequencias={FREQUENCIAS_VAZIAS}
        categoriasOpcional={[]}
        opcionais={[]}
        associacoes={[]}
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
    // Só as categorias REAIS ganham o botão — as duas de `CATEGORIAS`, já que
    // categoria vazia também é card desde a issue 261. O resíduo "Sem
    // categoria" continua de fora.
    expect(html).not.toContain('aria-label="Novo produto em Sem categoria"');
    expect(html.match(/aria-label="Novo produto em /g)?.length).toBe(2);
    expect(html).toContain('aria-label="Novo produto em Lanches"');
  });

  it("botão global 'Novo produto' do topo continua presente mesmo sem nenhum botão de card", () => {
    // Sem nenhuma categoria e só produto órfão => zero botões de card; o
    // "Novo produto" encontrado é necessariamente o global do topo.
    const html = renderComCategorias([produtoBase({ categoria_id: null })], []);
    expect(html.match(/aria-label="Novo produto em /g)).toBeNull();
    expect(html).toContain(">Novo produto<");
  });
});

/**
 * Cenário 11 da issue 175 — GATE do botão "Reordenar categorias".
 *
 * O gate é sobre `categorias.length` (TODAS), nunca sobre os grupos
 * renderizados: `grupos` carrega o grupo sintético "Sem categoria", que não é
 * ordenável, então contar grupos acenderia o botão para uma loja com uma
 * categoria só e produtos órfãos.
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
        hrefCardapios="/painel/cardapios"
        vinculosPorProduto={{}}
        promocoes={{}}
        fusoLojaRotulo="America/Sao_Paulo (GMT-3)"
        frequencias={FREQUENCIAS_VAZIAS}
        categoriasOpcional={[]}
        opcionais={[]}
        associacoes={[]}
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
    const html = renderComNCategorias(
      [],
      [produtoBase({ categoria_id: null })],
    );
    expect(html).toContain("Sem categoria");
    expect(html).not.toContain("Reordenar categorias");
  });
});

/**
 * Issue 261 — INVERSÃO da asserção do cenário 10 da issue 175. O teste antigo
 * ("categoria sem nenhum produto não vira card") afirmava `not.toContain
 * ("Bebidas")` e codificava a regra errada: "categoria vazia fica oculta" foi
 * decidido pensando só na VITRINE, e o painel herdou por acidente. A regra
 * esclarecida pelo dono do produto: o CLIENTE não vê categoria vazia (vitrine,
 * `projetarCatalogoVitrine`, intocada); o LOJISTA e o dono do SaaS sempre veem
 * (este componente, reusado pelo painel e pelo hub admin). Uma categoria
 * recém-criada nasce vazia e sumia da lista logo após ser criada.
 *
 * A outra metade do cenário 10 ("aparece no modo reordenar com 0 produtos")
 * segue em ReordenarCategorias.test.tsx ([C10]).
 */
describe("categoria vazia APARECE na listagem normal do painel (issue 261)", () => {
  function renderComVazia(): string {
    return renderToStaticMarkup(
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
        hrefCardapios="/painel/cardapios"
        vinculosPorProduto={{}}
        promocoes={{}}
        fusoLojaRotulo="America/Sao_Paulo (GMT-3)"
        frequencias={FREQUENCIAS_VAZIAS}
        categoriasOpcional={[]}
        opcionais={[]}
        associacoes={[]}
      />,
    );
  }

  it("categoria sem nenhum produto vira card, com cabeçalho e estado vazio", () => {
    const html = renderComVazia();
    expect(html).toContain("Lanches");
    expect(html).toContain("Bebidas");
    expect(html).toContain("Nenhum produto nesta categoria ainda.");
  });

  it("o card da categoria vazia traz o botão 'Novo produto em {nome}'", () => {
    // É o caminho de saída do estado vazio: `abrirCriarNaCategoria(grupo.id)`
    // pré-seleciona a categoria no formulário.
    const html = renderComVazia();
    expect(html).toContain('aria-label="Novo produto em Bebidas"');
  });

  it("ordem das categorias preservada: a vazia não vai para o fim", () => {
    const html = renderComVazia();
    expect(html.indexOf("Lanches")).toBeLessThan(html.indexOf("Bebidas"));
  });

  it("'Sem categoria' NÃO aparece quando não há produto órfão", () => {
    // O resíduo dos órfãos não é categoria: sem órfão, não existe grupo.
    expect(renderComVazia()).not.toContain("Sem categoria");
  });
});

describe("ProdutosClient — chip de promoção vigente (issue 235, design §8.4)", () => {
  function renderComPromocoes(
    produtos: Produto[],
    promocoes: ProdutosClientProps["promocoes"],
  ): string {
    return renderToStaticMarkup(
      <ProdutosClient
        lojaSlug="loja-teste"
        lojaId="loja-1"
        produtos={produtos}
        categorias={[]}
        opcionaisPorCategoria={{}}
        hrefCardapios="/painel/cardapios"
        vinculosPorProduto={{}}
        promocoes={promocoes}
        fusoLojaRotulo="America/Sao_Paulo (GMT-3)"
        frequencias={FREQUENCIAS_VAZIAS}
        categoriasOpcional={[]}
        opcionais={[]}
        associacoes={[]}
        acoes={acoesBase()}
      />,
    );
  }

  const produto = produtoBase({ id: "p1", nome: "Feijoada" });

  it("imprime o rótulo tal como o servidor o projetou, com a cor de promoção", () => {
    const markup = renderComPromocoes([produto], {
      p1: {
        vigente: true,
        rotulo: "-20% até 30/09",
        inicioLocal: null,
        fimLocal: "2026-09-30T23:59",
      },
    });
    expect(markup).toContain("-20% até 30/09");
    expect(markup).toContain("text-promo-texto");
  });

  it("sem promoção vigente, nenhum chip — o cliente não inventa vigência", () => {
    const markup = renderComPromocoes([produto], {
      p1: {
        vigente: false,
        rotulo: null,
        inicioLocal: null,
        fimLocal: "2026-09-30T23:59",
      },
    });
    expect(markup).not.toContain("text-promo-texto");
  });

  it("produto ausente do mapa não quebra o render", () => {
    expect(() => renderComPromocoes([produto], {})).not.toThrow();
  });
});

/**
 * [261] D14 na lista (design §13.5, regra 5). O badge é a única coisa que
 * distingue, na linha, o produto que vai SUMIR da vitrine quando o cardápio
 * dele fechar — e o produto do menu não ganha ruído nenhum.
 */
describe("ProdutosClient — badge de D14 (issue 261)", () => {
  it("produto exclusivo de cardápio ganha o badge literal", () => {
    const html = renderLista([
      produtoBase({ visibilidade: "cardapio" } as Partial<Produto>),
    ]);
    expect(html).toContain("Exclusivo de cardápio");
  });

  it("produto do menu NÃO ganha badge — o default não merece ruído", () => {
    const html = renderLista([
      produtoBase({ visibilidade: "menu" } as Partial<Produto>),
    ]);
    expect(html).not.toContain("Exclusivo de cardápio");
  });

  /**
   * FAIL-OPEN de `visibilidadeDe` (247/D6): valor fora do domínio lê como
   * `menu`. A alternativa (tratar como exclusivo) anunciaria na tela uma
   * exclusividade que o projeto não sabe avaliar.
   */
  it("visibilidade desconhecida lê como menu, não como exclusivo", () => {
    const html = renderLista([
      produtoBase({ visibilidade: "vigencia-do-futuro" } as Partial<Produto>),
    ]);
    expect(html).not.toContain("Exclusivo de cardápio");
  });

  // [323] Invertido: o "Selecionar" dependia de `lote` (cardápio, sem variante
  // admin). A seleção agora aplica FREQUÊNCIA, que tem variante admin com o
  // `lojaId` da URL — então existe nos dois mundos, sempre que há produto.
  it("[323] sem a prop `lote`, com produto, a tela oferece 'Selecionar' e 'Dias da semana'", () => {
    const html = renderLista([produtoBase()]);
    expect(html).toContain("Selecionar");
    expect(html).toContain("Dias da semana");
  });

  it("[323] sem produto nenhum, nem 'Selecionar' nem 'Dias da semana'", () => {
    const html = renderLista([]);
    expect(html).not.toContain("Selecionar");
    expect(html).not.toContain("Dias da semana");
  });
});

/**
 * [264/RN-12 · design §13.4 item 5] O aviso reduzido na linha do produto. É o
 * mesmo estado de `/painel/cardapios`, visto do lado do produto — e é o único
 * lugar onde o lojista descobre que um prato sumiu da vitrine.
 */
describe("264 — aviso de sumiço na linha do produto", () => {
  function comSumico(sumicos: ProdutosClientProps["sumicos"]): string {
    return renderToStaticMarkup(
      <ProdutosClient
        lojaSlug="loja-teste"
        lojaId="loja-1"
        produtos={[
          produtoBase({ visibilidade: "cardapio" } as Partial<Produto>),
        ]}
        categorias={[]}
        opcionaisPorCategoria={{}}
        hrefCardapios="/painel/cardapios"
        vinculosPorProduto={{}}
        promocoes={{}}
        fusoLojaRotulo="America/Sao_Paulo (GMT-3)"
        frequencias={FREQUENCIAS_VAZIAS}
        categoriasOpcional={[]}
        opcionais={[]}
        associacoes={[]}
        sumicos={sumicos}
        acoes={acoesBase()}
      />,
    );
  }

  it("sem sumiço, a linha não ganha aviso nenhum", () => {
    expect(comSumico({})).not.toContain("sumiu da vitrine");
  });

  it("cardápio expirado: a frase literal do design, em âmbar", () => {
    const html = comSumico({
      "prod-1": { cardapio: "Cardápio de Inverno", ativo: true },
    });

    expect(html).toContain(
      "sumiu da vitrine — o cardápio Cardápio de Inverno expirou",
    );
    expect(html).toContain("text-amber-700");
    expect(html).toContain("lucide-triangle-alert");
  });

  it("cardápio desligado: o mesmo aviso, com o verbo verdadeiro", () => {
    expect(
      comSumico({
        "prod-1": { cardapio: "Cardápio de Inverno", ativo: false },
      }),
    ).toContain(
      "sumiu da vitrine — o cardápio Cardápio de Inverno foi desligado",
    );
  });

  it("sem a prop (hub admin), nenhum aviso é inventado", () => {
    expect(renderLista([produtoBase()])).not.toContain("sumiu da vitrine");
  });
});

/**
 * [278/RN-13] O chip de cardápio passa a dizer EM QUE DIAS. A redação vem do
 * SERVIDOR (`rotuloDiasDoItem`); o que se afirma aqui é a ORDEM dos trechos —
 * nome · dias · estado —, porque o estado é consequência e vem por último.
 */
describe("ProdutosClient — dias do vínculo no chip (278)", () => {
  const produto = produtoBase({ id: "p1", nome: "Feijoada" });

  it("com dias, o chip acumula nome e dias", () => {
    const html = renderLista([produto], {
      p1: [
        {
          id: "c1",
          nome: "Especiais do Dia",
          abertoAgora: true,
          rotuloDias: "qua e sáb",
        },
      ],
    });
    expect(html).toContain("Especiais do Dia");
    expect(html).toContain("qua e sáb");
    expect(html).not.toContain("fora da janela agora");
  });

  it("sem dias, nada é anexado antes do estado", () => {
    const html = renderLista([produto], {
      p1: [
        {
          id: "c1",
          nome: "Especiais do Dia",
          abertoAgora: false,
          rotuloDias: null,
        },
      ],
    });
    expect(html).toContain("fora da janela agora");
    expect(html).not.toContain("todos os dias");
  });

  it("a ordem é nome · dias · estado", () => {
    const html = renderLista([produto], {
      p1: [
        {
          id: "c1",
          nome: "Especiais do Dia",
          abertoAgora: false,
          rotuloDias: "qua e sáb",
        },
      ],
    });
    expect(html.indexOf("Especiais do Dia")).toBeLessThan(
      html.indexOf("qua e sáb"),
    );
    expect(html.indexOf("qua e sáb")).toBeLessThan(
      html.indexOf("fora da janela agora"),
    );
    // Em 360px o chip quebra em duas linhas em vez de esticar a linha.
    expect(html).toContain("whitespace-normal");
  });
});

/**
 * [323/C8] Frequência de exibição na lista: o texto vem PRONTO do servidor
 * (`projetarFrequenciasDoPainel`); aqui se afirma só que a tela o imprime, e
 * onde.
 */
describe("323 — chip, aviso e estado da categoria na lista", () => {
  const CATEGORIAS = [{ id: "c1", nome: "Sobremesas", exibir_imagens: true }];

  function render(frequencias: ProdutosClientProps["frequencias"], produtos: Produto[]): string {
    return renderToStaticMarkup(
      <ProdutosClient
        lojaSlug="loja-teste"
        lojaId="loja-1"
        produtos={produtos}
        categorias={CATEGORIAS}
        opcionaisPorCategoria={{}}
        hrefCardapios="/painel/cardapios"
        vinculosPorProduto={{}}
        promocoes={{}}
        fusoLojaRotulo="America/Sao_Paulo (GMT-3)"
        frequencias={frequencias}
        categoriasOpcional={[]}
        opcionais={[]}
        associacoes={[]}
        acoes={acoesBase()}
      />,
    );
  }

  const PERMANENTE = {
    dias_semana: null,
    hora_inicio: null,
    hora_fim: null,
    periodo_inicio: null,
    periodo_fim: null,
  };

  it("chip do produto e aviso RN-1 em âmbar, SEM role=alert", () => {
    const aviso =
      "Este item nunca vai ficar disponível: os dias e horários dele não batem com os da categoria. Ajuste a frequência do item ou da categoria.";
    const html = render(
      {
        ...FREQUENCIAS_VAZIAS,
        produtos: { "prod-1": { rotulo: "sáb", aviso } },
      },
      [produtoBase({ categoria_id: "c1" })],
    );
    expect(html).toContain("sáb");
    expect(html).toContain(aviso);
    expect(html).toContain("text-amber-700");
    const trecho = html.slice(html.lastIndexOf("<p", html.indexOf(aviso)), html.indexOf(aviso));
    expect(trecho).not.toContain('role="alert"');
  });

  it("produto permanente não ganha chip", () => {
    const html = render(
      { ...FREQUENCIAS_VAZIAS, produtos: { "prod-1": { rotulo: null, aviso: null } } },
      [produtoBase()],
    );
    expect(html).not.toContain("lucide-clock");
  });

  it("'Nunca disponível' usa o ícone de bloqueio, não o relógio", () => {
    const html = render(
      { ...FREQUENCIAS_VAZIAS, produtos: { "prod-1": { rotulo: "Nunca disponível", aviso: null } } },
      [produtoBase()],
    );
    expect(html).toContain("Nunca disponível");
    expect(html).toContain("lucide-ban");
  });

  it("categoria oculta: faixa 'Oculta da vitrine' com a instrução imperativa", () => {
    const html = render(
      {
        ...FREQUENCIAS_VAZIAS,
        categorias: {
          c1: { oculta: true, frequencia: PERMANENTE, rotulo: null, aviso: null },
        },
      },
      [produtoBase({ id: "a", categoria_id: "c1" }), produtoBase({ id: "b", categoria_id: "c1" })],
    );
    expect(html).toContain("Oculta da vitrine");
    expect(html).toContain("Os 2 produtos desta categoria não aparecem para o cliente.");
    expect(html).toContain("Mostre a categoria em");
  });

  it("categoria visível e permanente: nenhuma faixa de estado", () => {
    const html = render(
      {
        ...FREQUENCIAS_VAZIAS,
        categorias: {
          c1: { oculta: false, frequencia: PERMANENTE, rotulo: null, aviso: null },
        },
      },
      [produtoBase({ categoria_id: "c1" })],
    );
    expect(html).not.toContain("Oculta da vitrine");
    expect(html).not.toContain("não aparecem para o cliente");
  });
});

describe("323 — botão 'Dias' no cabeçalho de cada categoria", () => {
  const CATEGORIAS = [
    { id: "c1", nome: "Sobremesas", exibir_imagens: true },
    { id: "c2", nome: "Bebidas", exibir_imagens: true },
  ];

  function render(produtos: Produto[]): string {
    return renderToStaticMarkup(
      <ProdutosClient
        lojaSlug="loja-teste"
        lojaId="loja-1"
        produtos={produtos}
        categorias={CATEGORIAS}
        opcionaisPorCategoria={{}}
        hrefCardapios="/painel/cardapios"
        vinculosPorProduto={{}}
        promocoes={{}}
        fusoLojaRotulo="America/Sao_Paulo (GMT-3)"
        frequencias={FREQUENCIAS_VAZIAS}
        categoriasOpcional={[]}
        opcionais={[]}
        associacoes={[]}
        acoes={acoesBase()}
      />,
    );
  }

  it("categoria com produto ganha o botão, nomeado por ela", () => {
    const html = render([produtoBase({ categoria_id: "c1" })]);
    expect(html).toContain('id="abrir-grade-c1"');
    expect(html).toContain("Dias da semana dos produtos de Sobremesas");
  });

  it("categoria VAZIA não ganha o botão (grade de zero produto)", () => {
    const html = render([produtoBase({ categoria_id: "c1" })]);
    expect(html).not.toContain('id="abrir-grade-c2"');
    expect(html).not.toContain("Dias da semana dos produtos de Bebidas");
  });

  it("'Sem categoria' com um único produto ganha o botão", () => {
    const html = render([produtoBase({ categoria_id: null })]);
    expect(html).toContain('id="abrir-grade-sem-categoria"');
  });

  it("o botão global do topo continua existindo (os dois convivem)", () => {
    const html = render([produtoBase({ categoria_id: "c1" })]);
    expect(html).toContain(">Dias da semana</button>");
    expect(html).toContain('id="abrir-grade-c1"');
  });
});

describe("323 — pílulas de dia editáveis na linha do produto", () => {
  function render(produtos: Produto[]): string {
    return renderToStaticMarkup(
      <ProdutosClient
        lojaSlug="loja-teste"
        lojaId="loja-1"
        produtos={produtos}
        categorias={[{ id: "c1", nome: "Sobremesas", exibir_imagens: true }]}
        opcionaisPorCategoria={{}}
        hrefCardapios="/painel/cardapios"
        vinculosPorProduto={{}}
        promocoes={{}}
        fusoLojaRotulo="America/Sao_Paulo (GMT-3)"
        frequencias={FREQUENCIAS_VAZIAS}
        categoriasOpcional={[]}
        opcionais={[]}
        associacoes={[]}
        acoes={acoesBase()}
      />,
    );
  }

  /** Quantos botões de dia estão marcados dentro do grupo do produto. */
  function marcados(html: string, nomeDoProduto: string): number {
    const inicio = html.indexOf(`aria-label="Dias de ${nomeDoProduto}"`);
    expect(inicio).toBeGreaterThan(-1);
    const grupo = html.slice(inicio, html.indexOf("</div>", inicio));
    return grupo.split('aria-pressed="true"').length - 1;
  }

  it("a linha traz o grupo das 7 pílulas, nomeado pelo produto", () => {
    const html = render([
      produtoBase({ categoria_id: "c1", dias_semana: [1] } as Partial<Produto>),
    ]);
    expect(html).toContain('aria-label="Dias de Pizza Margherita"');
    const inicio = html.indexOf('aria-label="Dias de Pizza Margherita"');
    const grupo = html.slice(inicio, html.indexOf("</div>", inicio));
    expect(grupo.split("aria-pressed=").length - 1).toBe(7);
  });

  /*
    As duas metades do fix de encavalamento no mobile, que nenhum outro teste
    pega (não há jsdom, e largura não se mede em `renderToStaticMarkup`):

      1. linha PRÓPRIA (`basis-full`; `sm:order-last` só decide QUAL linha, já
         que as ações sobem para a primeira no desktop) — na coluna de texto
         sobram ~240px;
      2. modo NORMAL, não `compacto` — as 7 numa linha só pedem ~304px e a
         linha tem ~262px; `min-w-[40px]` não encolhe junto com a coluna e uma
         pílula subia por cima da outra. 4+3 no mobile cabe.

    Reaninhar na coluna de texto, ou devolver o `compacto`, traz o bug de volta.
  */
  it("as pílulas ficam em linha própria e em 4+3 no mobile (sem encavalar)", () => {
    const html = render([
      produtoBase({ categoria_id: "c1", dias_semana: [1] } as Partial<Produto>),
    ]);
    expect(html).toContain(
      '<div class="w-full basis-full sm:order-last"><div role="group" aria-label="Dias de Pizza Margherita"',
    );
    const inicio = html.indexOf('aria-label="Dias de Pizza Margherita"');
    const grupo = html.slice(inicio, html.indexOf(">", inicio));
    expect(grupo).toContain("grid-cols-4");
    expect(grupo).toContain("sm:grid-cols-7");
  });

  it("produto de um dia só mostra UMA pílula marcada", () => {
    const html = render([
      produtoBase({ categoria_id: "c1", dias_semana: [1] } as Partial<Produto>),
    ]);
    expect(marcados(html, "Pizza Margherita")).toBe(1);
  });

  it("produto permanente (dias_semana null) mostra as 7 marcadas", () => {
    const html = render([
      produtoBase({ categoria_id: "c1", dias_semana: null } as Partial<Produto>),
    ]);
    expect(marcados(html, "Pizza Margherita")).toBe(7);
  });

  it("produto 'nunca' (dias_semana []) mostra NENHUMA marcada — [] nao vira todo dia", () => {
    const html = render([
      produtoBase({ categoria_id: "c1", dias_semana: [] } as Partial<Produto>),
    ]);
    expect(marcados(html, "Pizza Margherita")).toBe(0);
  });
});

/*
  Arrasto direto na listagem — o botão "Reordenar" do cabeçalho continua, mas a
  linha ganha uma alça que move o produto sem entrar em modo nenhum.

  O que este arquivo consegue provar sem jsdom: QUEM ganha alça e quem não
  ganha, e que o markup do arrasto é determinístico entre renders. O gesto em
  si (soltar sobre outra linha → `reordenarProdutos` com a sequência nova) não
  é simulável aqui e fica para o `verificar`.
*/
describe("alça de arrasto na listagem de produtos", () => {
  const CATEGORIAS = [
    { id: "c1", nome: "Lanches", exibir_imagens: true },
    { id: "c2", nome: "Bebidas", exibir_imagens: true },
  ];

  function render(produtos: Produto[], categorias = CATEGORIAS): string {
    return renderToStaticMarkup(
      <ProdutosClient
        lojaSlug="loja-teste"
        lojaId="loja-1"
        produtos={produtos}
        categorias={categorias}
        opcionaisPorCategoria={{}}
        hrefCardapios="/painel/cardapios"
        vinculosPorProduto={{}}
        promocoes={{}}
        fusoLojaRotulo="America/Sao_Paulo (GMT-3)"
        frequencias={FREQUENCIAS_VAZIAS}
        categoriasOpcional={[]}
        opcionais={[]}
        associacoes={[]}
        acoes={acoesBase()}
      />,
    );
  }

  it("categoria com dois produtos dá alça a cada linha, nomeada pelo produto", () => {
    const html = render([
      produtoBase({ id: "p1", categoria_id: "c1", nome: "X-Burguer" }),
      produtoBase({ id: "p2", categoria_id: "c1", nome: "X-Salada" }),
    ]);
    expect(html).toContain('aria-label="Reordenar X-Burguer"');
    expect(html).toContain('aria-label="Reordenar X-Salada"');
  });

  it("categoria de UM produto não ganha alça — mesmo gate do botão do cabeçalho", () => {
    const html = render([
      produtoBase({ id: "p1", categoria_id: "c1", nome: "X-Burguer" }),
    ]);
    expect(html).not.toContain('aria-label="Reordenar X-Burguer"');
  });

  it("o gate é POR categoria: a de dois ganha alça, a de um não", () => {
    const html = render([
      produtoBase({ id: "p1", categoria_id: "c1", nome: "X-Burguer" }),
      produtoBase({ id: "p2", categoria_id: "c1", nome: "X-Salada" }),
      produtoBase({ id: "p3", categoria_id: "c2", nome: "Guaraná" }),
    ]);
    expect(html).toContain('aria-label="Reordenar X-Burguer"');
    expect(html).toContain('aria-label="Reordenar X-Salada"');
    expect(html).not.toContain('aria-label="Reordenar Guaraná"');
  });

  it("'Sem categoria' com dois produtos também arrasta (categoria_id NULL é grupo)", () => {
    const html = render(
      [
        produtoBase({ id: "p1", categoria_id: null, nome: "Avulso 1" }),
        produtoBase({ id: "p2", categoria_id: null, nome: "Avulso 2" }),
      ],
      [],
    );
    expect(html).toContain('aria-label="Reordenar Avulso 1"');
    expect(html).toContain('aria-label="Reordenar Avulso 2"');
  });

  /*
    O `aria-describedby` que o dnd-kit põe em cada alça sai de um CONTADOR DE
    MÓDULO quando o `DndContext` não recebe `id`. Esse contador sobrevive entre
    requisições no servidor Node, então o segundo render divergiria do primeiro
    — e do que o browser gera na hidratação. O `id` fixo no contexto é o que
    trava isso.
  */
  it("dois renders com arrasto produzem HTML idêntico (id fixo no DndContext)", () => {
    const produtos = [
      produtoBase({ id: "p1", categoria_id: "c1", nome: "X-Burguer" }),
      produtoBase({ id: "p2", categoria_id: "c1", nome: "X-Salada" }),
    ];
    expect(render(produtos)).toBe(render(produtos));
  });
});
