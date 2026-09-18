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

import {
  OpcionaisClient,
  type OpcionaisClientAcoes,
  type OpcionaisClientProps,
} from "./OpcionaisClient";

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
  };
}

function render(props: {
  categoriasOpcional?: CategoriaOpcional[];
  opcionais?: Opcional[];
  associacoes?: Associacao[];
  acoes?: OpcionaisClientAcoes;
} = {}): string {
  return renderToStaticMarkup(
    <OpcionaisClient
      categoriasOpcional={props.categoriasOpcional ?? [categoria()]}
      opcionais={props.opcionais ?? [opcional()]}
      categoriasProduto={CATEGORIA_PRODUTO}
      associacoes={props.associacoes ?? []}
      acoes={props.acoes ?? acoesBase()}
    />,
  );
}

/** Tag do `<button>` "Reordenar" do cartão, com o `class` removido — as classes
 *  do shadcn incluem `disabled:pointer-events-none` e dariam falso positivo. */
function botaoReordenar(html: string): string {
  const i = html.indexOf(">Reordenar<");
  const inicio = html.lastIndexOf("<button", i);
  return html.slice(inicio, i + 1).replace(/\sclass="[^"]*"/g, "");
}

function associacao(categoriaOpcionalId: string, ordem: number): Associacao {
  return {
    categoria_id: "cp-1",
    categoria_opcional_id: categoriaOpcionalId,
    ordem,
  };
}

describe("injeção do painel do lojista — critério de aceite da 128", () => {
  it("renderiza categoria, item, preço e checkbox de associação com os dados reais", () => {
    const html = render();
    expect(html).toContain("Laticínios");
    expect(html).toContain("Brie extra");
    expect(html).toContain(`+${formatarMoeda(5)}`);
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

describe("gate do botão 'Reordenar' do cartão (issue 209)", () => {
  const DOIS_GRUPOS = [
    categoria({ id: "cat-1", nome: "Laticínios" }),
    categoria({ id: "cat-2", nome: "Molhos" }),
  ];

  it("com 0 ou 1 grupo PERSISTIDO o botão fica desabilitado e o motivo aparece", () => {
    // Um botão inerte sem explicação vira chamado de suporte. E com <2 ids a
    // action recusaria de todo jeito: o `.min(2)` do zod é a contraparte no
    // servidor deste gate de UX.
    const htmlZero = render({ categoriasOpcional: DOIS_GRUPOS });
    expect(botaoReordenar(htmlZero)).toMatch(/\sdisabled\b/);
    expect(htmlZero).toContain("Marque pelo menos 2 grupos");

    const htmlUm = render({
      categoriasOpcional: DOIS_GRUPOS,
      associacoes: [associacao("cat-1", 0)],
    });
    expect(botaoReordenar(htmlUm)).toMatch(/\sdisabled\b/);
    expect(htmlUm).toContain("Marque pelo menos 2 grupos");
  });

  it("com 2 grupos persistidos o botão fica ativo e sem motivo na tela", () => {
    const html = render({
      categoriasOpcional: DOIS_GRUPOS,
      associacoes: [associacao("cat-1", 0), associacao("cat-2", 1)],
    });
    expect(botaoReordenar(html)).not.toMatch(/\sdisabled\b/);
    expect(html).not.toContain("Marque pelo menos 2 grupos");
    expect(html).not.toContain("Salve a associação antes de reordenar.");
  });

  it("fora do modo, o cartão mostra a grade de checkboxes e nenhuma lista arrastável", () => {
    // Os dois modos nunca coexistem (RN-12): é isso que impede alterar a
    // associação no meio de um arrasto. O SSR entra sempre fora do modo.
    const html = render({
      categoriasOpcional: DOIS_GRUPOS,
      associacoes: [associacao("cat-1", 0), associacao("cat-2", 1)],
    });
    expect(html).toContain(">Salvar<");
    expect(html).not.toContain(">Concluir<");
    expect(html).not.toContain('aria-label="Reordenar Molhos"');
  });
});
