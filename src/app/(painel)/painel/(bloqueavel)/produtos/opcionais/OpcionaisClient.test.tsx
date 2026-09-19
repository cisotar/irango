/**
 * Testes do OpcionaisClient (issue 128 — prop `acoes` com 8 actions, threadada
 * por 4 subcomponentes: BibliotecaOpcionais, FormCategoriaOpcional,
 * FormOpcional, AssociacaoOpcionais/CartaoAssociacao; issue 160 — a prop e suas
 * 8 chaves passaram a ser OBRIGATÓRIAS, sem default apontando para a action do
 * lojista).
 *
 * Ambiente: vitest environment=node — sem jsdom.
 * Estratégia: renderToStaticMarkup (react-dom/server), mesmo padrão do
 * projeto (AcoesStatus.test.tsx, FormCupom.test.tsx).
 *
 * Limitação honesta e por que ela muda o que é testável aqui: as 8 actions
 * deste componente são chamadas DENTRO dos handlers de clique
 * (`confirmarRemoverCat`, `alternar`, `salvar()` de cada form/cartão) — não no
 * corpo do componente como em FormCupom/ProdutosClient. Isso significa que
 * nenhuma delas é sequer avaliada durante um `renderToStaticMarkup` (a função
 * só é criada, não chamada). Um teste que só afirma "não lançou" não prova nada
 * sobre o threading — é exatamente o padrão vazio proibido. Por isso os testes
 * abaixo têm dois focos honestos:
 *
 *  1. A injeção do LOJISTA (a que a page do painel monta) continua renderizando
 *     o conteúdo real derivado das props de dados (categoria, item, preço,
 *     badge "Inativo") — isso trava regressão se a extração/threading do prop
 *     `acoes` pelos 4 subcomponentes acidentalmente alterar props de DADOS na
 *     mesma assinatura (ex.: trocar a ordem dos parâmetros ao acrescentar
 *     `acoes`).
 *  2. Trocar a injeção do lojista por outra igualmente completa (a via admin)
 *     não pode vazar para o HTML nem alterar QUALQUER ramo condicional de
 *     render — comparação byte-a-byte. Se algum subcomponente um dia passar a
 *     decidir o que mostrar com base na IDENTIDADE de uma action, este teste
 *     quebra.
 *
 * Fora do escopo (não testável sem jsdom): qual das 8 actions é de fato
 * chamada ao clicar em salvar/remover/alternar — está atrás de eventos DOM.
 * Cobertura equivalente do lado do servidor já existe em opcional.test.ts.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Ambos BibliotecaOpcionais e AssociacaoOpcionais chamam useRouter() no topo;
// SSR estático não tem App Router montado (mesmo padrão de ProdutosClient).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { OpcionaisClient, type OpcionaisClientProps } from "./OpcionaisClient";
import type { OpcionaisClientAcoes } from "@/components/painel/contrato-opcionais";

type Associacao = OpcionaisClientProps["associacoes"][number];
import type {
  CategoriaOpcional,
  Opcional,
} from "@/lib/supabase/queries/opcionais";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";

function categoria(overrides: Partial<CategoriaOpcional> = {}): CategoriaOpcional {
  return {
    id: "cat-1",
    loja_id: "loja-1",
    nome: "Laticínios",
    ordem: 0,
    criado_em: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function opcional(overrides: Partial<Opcional> = {}): Opcional {
  return {
    id: "opc-1",
    loja_id: "loja-1",
    categoria_opcional_id: "cat-1",
    nome: "Brie extra",
    preco: 5,
    ativo: true,
    ordem: 0,
    criado_em: "2025-01-01T00:00:00Z",
    atualizado_em: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

const CATEGORIA_PRODUTO = [{ id: "cp-1", nome: "Pizzas" }];

/**
 * Injeção mínima e COMPLETA das 9 actions (issue 160: todas obrigatórias — não
 * há mais default apontando para a action do lojista; a 9ª chegou com a 209).
 */
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
    // 9ª (issues 208/209). Sem ela o arquivo NÃO COMPILA — é essa quebra que
    // prova o critério da 160: omitir uma chave não cai na action do lojista.
    reordenarOpcionaisDaCategoria: vi.fn(async () => ({ ok: true }) as const),
    // 10ª (issues 215/216) — mesma regra da 9ª.
    reordenarItensDoGrupoOpcional: vi.fn(async () => ({ ok: true }) as const),
  };
}

function render(props: {
  categoriasOpcional?: CategoriaOpcional[];
  opcionais?: Opcional[];
  associacoes?: Associacao[];
  acoes?: OpcionaisClientAcoes;
  secaoInicial?: "biblioteca" | "por-categoria";
} = {}): string {
  return renderToStaticMarkup(
    <OpcionaisClient
      categoriasOpcional={props.categoriasOpcional ?? [categoria()]}
      opcionais={props.opcionais ?? [opcional()]}
      categoriasProduto={CATEGORIA_PRODUTO}
      associacoes={props.associacoes ?? []}
      acoes={props.acoes ?? acoesBase()}
      secaoInicial={props.secaoInicial}
    />,
  );
}

function associacao(categoriaOpcionalId: string, ordem: number): Associacao {
  return {
    categoria_id: "cp-1",
    categoria_opcional_id: categoriaOpcionalId,
    ordem,
  };
}

describe("injeção do painel do lojista — critério de aceite da 128", () => {
  it("renderiza categoria, item e preço na Biblioteca com os dados reais", () => {
    const html = render();
    expect(html).toContain("Laticínios");
    expect(html).toContain("Brie extra");
    expect(html).toContain(`+${formatarMoeda(5)}`);
  });

  it("renderiza a categoria de PRODUTO na aba de associação", () => {
    // Separado do caso acima desde a 213: as duas seções deixaram de coexistir,
    // então "Pizzas" (categoria de produto) só existe na outra aba.
    const html = render({ secaoInicial: "por-categoria" });
    expect(html).toContain("Pizzas");
  });

  it("opcional inativo mostra o badge 'Inativo'; ativo não mostra", () => {
    const htmlInativo = render({ opcionais: [opcional({ ativo: false })] });
    expect(htmlInativo).toContain("Inativo");

    const htmlAtivo = render({ opcionais: [opcional({ ativo: true })] });
    expect(htmlAtivo).not.toContain("Inativo");
  });
});

describe("trocar a injeção de `acoes` não vaza para o render nem muda ramos condicionais", () => {
  it("duas injeções distintas das 8 actions: HTML idêntico, nenhuma é chamada", () => {
    const acoesLojista = acoesBase();
    const acoesAdmin = acoesBase();

    const comLojista = render({ acoes: acoesLojista });
    const comAdmin = render({ acoes: acoesAdmin });

    expect(comAdmin).toBe(comLojista);
    for (const fn of [
      ...Object.values(acoesLojista),
      ...Object.values(acoesAdmin),
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

describe("cartão de associação — checkbox e ordem fundidos (issue 213)", () => {
  const DOIS_GRUPOS = [
    categoria({ id: "cat-1", nome: "Laticínios" }),
    categoria({ id: "cat-2", nome: "Molhos" }),
  ];

  function renderDois(associacoes: Associacao[] = []) {
    // O cartão de associação vive na aba "por categoria"; desde a 213 a outra
    // aba não é renderizada, então o teste abre direto na certa.
    return render({
      categoriasOpcional: DOIS_GRUPOS,
      associacoes,
      secaoInicial: "por-categoria",
    });
  }

  it("não existe mais botão 'Reordenar' nem 'Salvar': o cartão salva sozinho", () => {
    // O autosave aposentou os dois botões JUNTO com o gate de ≥2 marcados —
    // era o gate que exigia salvar antes de poder ordenar.
    const html = renderDois([associacao("cat-1", 0), associacao("cat-2", 1)]);
    expect(html).not.toContain(">Reordenar<");
    expect(html).not.toContain(">Salvar<");
    expect(html).not.toContain("Marque pelo menos 2 grupos");
    expect(html).not.toContain("Salve a associação antes de reordenar.");
  });

  it("os MARCADOS vêm na ordem gravada, numerados e com alça de arrasto", () => {
    // A lista já nasce na ordem da vitrine — não há mais um modo para entrar.
    const html = renderDois([associacao("cat-2", 0), associacao("cat-1", 1)]);
    expect(html).toContain('aria-label="Reordenar Molhos"');
    expect(html).toContain('aria-label="Reordenar Laticínios"');
    expect(html.indexOf('aria-label="Reordenar Molhos"')).toBeLessThan(
      html.indexOf('aria-label="Reordenar Laticínios"'),
    );
  });

  it("o checkbox do marcado diz o EFEITO e a categoria de produto", () => {
    // Num cartão com 15 checkboxes, "Laticínios, caixa de seleção" 15 vezes não
    // diz a quem o marcado pertence nem o que o clique vai fazer.
    const html = renderDois([associacao("cat-1", 0)]);
    expect(html).toContain(
      'aria-label="Remover Laticínios dos opcionais de Pizzas"',
    );
    expect(html).toContain(
      'aria-label="Incluir Molhos nos opcionais de Pizzas"',
    );
  });

  it("o checkbox do marcado fica ANTES da alça na ordem de tabulação", () => {
    // checkbox → alça → ↑ → ↓ → kebab: a ação mais frequente vem primeiro.
    const html = renderDois([associacao("cat-1", 0)]);
    const checkbox = html.indexOf(
      'aria-label="Remover Laticínios dos opcionais de Pizzas"',
    );
    const alca = html.indexOf('aria-label="Reordenar Laticínios"');
    expect(checkbox).toBeGreaterThan(-1);
    expect(checkbox).toBeLessThan(alca);
  });

  it("os DISPONÍVEIS ficam num segmento à parte, contados e SEM alça", () => {
    // É o que impede o `closestCenter` do dnd-kit de aceitar soltura na região
    // dos desmarcados e produzir posição para um grupo sem linha em
    // `categoria_produto_opcionais` (a RPC confere `row_count`).
    const html = renderDois([associacao("cat-1", 0)]);
    expect(html).toContain("Disponíveis (1)");
    expect(html).not.toContain('aria-label="Reordenar Molhos"');
  });

  it("sem nenhum marcado, a lista arrastável não é renderizada", () => {
    const html = renderDois();
    expect(html).toContain("Disponíveis (2)");
    expect(html).toContain("Nenhum grupo incluído ainda.");
    expect(html).not.toContain('aria-label="Reordenar Laticínios"');
    expect(html).not.toContain('aria-label="Reordenar Molhos"');
  });
});

describe("hierarquia e navegação da página (issue 213)", () => {
  it("o toggle é um tablist: SÓ o painel da aba ativa existe no DOM", () => {
    // Mudou na 213 a pedido do usuário: era `<nav>` de âncoras com as duas
    // seções coexistindo. Agora é aba de verdade — selecionar uma ESCONDE a
    // outra —, então a semântica correta é tablist/tab/tabpanel.
    const html = render();
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Seções desta página"');
    expect(html).toContain('id="aba-biblioteca"');
    expect(html).toContain('id="aba-por-categoria"');
    // Biblioteca é a aba inicial: o painel dela existe, o outro NÃO.
    expect(html).toContain('id="biblioteca"');
    expect(html).not.toContain('id="por-categoria"');
    // Sem âncora: não há para onde navegar quando o painel nem existe.
    expect(html).not.toContain('href="#por-categoria"');
  });

  it("a aba ativa é a única preenchida e a única na ordem de tabulação", () => {
    const html = render();
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-selected="false"');
    expect(html).toContain('tabindex="-1"');
  });

  it("abrindo em 'por categoria', o painel da Biblioteca some", () => {
    const html = render({ secaoInicial: "por-categoria" });
    expect(html).toContain('id="por-categoria"');
    expect(html).not.toContain('id="biblioteca"');
    // A busca é da Biblioteca — some junto com ela.
    expect(html).not.toContain("Buscar opcional por nome");
  });

  it("o nome da categoria de opcional virou header do Card, com a contagem", () => {
    // Antes o pai era `text-sm text-muted-foreground` FORA do Card e o filho
    // `font-medium text-foreground` DENTRO: o filho pesava mais que o pai.
    const html = render({ opcionais: [opcional(), opcional({ id: "opc-2" })] });
    const card = html.indexOf('data-slot="card"');
    expect(card).toBeGreaterThan(-1);
    expect(html.indexOf("Laticínios")).toBeGreaterThan(card);
    expect(html).toContain("2 itens");
  });

  it("as ações da categoria viraram kebab (44px), não ícones de 33,6px", () => {
    // `size="icon-sm"` dá 33,6px na base de 120% do projeto — abaixo da régua
    // de 44px do design-system §5.
    const html = render();
    expect(html).toContain('aria-label="Mais ações da categoria Laticínios"');
    expect(html).toContain('aria-label="Mais ações de Brie extra"');
    expect(html).not.toContain('aria-label="Editar categoria Laticínios"');
    expect(html).not.toContain('aria-label="Remover categoria Laticínios"');
    expect(html).toContain("min-h-[44px]");
  });
});
