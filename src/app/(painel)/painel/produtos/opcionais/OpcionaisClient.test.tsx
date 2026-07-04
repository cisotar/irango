/**
 * Testes do OpcionaisClient (issue 128 — prop `acoes?` com 8 actions,
 * threadada por 4 subcomponentes: BibliotecaOpcionais, FormCategoriaOpcional,
 * FormOpcional, AssociacaoOpcionais/CartaoAssociacao).
 *
 * Ambiente: vitest environment=node — sem jsdom.
 * Estratégia: renderToStaticMarkup (react-dom/server), mesmo padrão do
 * projeto (AcoesStatus.test.tsx, FormCupom.test.tsx).
 *
 * Limitação honesta e por que ela muda o que é testável aqui: nas 8 actions
 * deste componente, a resolução `acoes?.X ?? Xlojista` roda DENTRO dos
 * handlers de clique (`confirmarRemoverCat`, `alternar`, `salvar()` de cada
 * form/cartão) — não no corpo do componente como em FormCupom/ProdutosClient.
 * Isso significa que nenhum desses `acoes?.X` é sequer avaliado durante um
 * `renderToStaticMarkup` (a função só é criada, não chamada). Um teste que só
 * afirma "não lançou" não prova nada sobre o threading — é exatamente o
 * padrão vazio proibido. Por isso os testes abaixo têm dois focos honestos:
 *
 *  1. O caminho DEFAULT do painel (sem `acoes`, o único caminho que roda em
 *     produção hoje) continua renderizando o conteúdo real derivado das
 *     props de dados (categoria, item, preço, badge "Inativo") — isso trava
 *     regressão se a extração/threading do prop `acoes` pelos 4
 *     subcomponentes acidentalmente alterar props de DADOS na mesma
 *     assinatura (ex.: trocar a ordem dos parâmetros ao acrescentar `acoes`).
 *  2. Passar um objeto `acoes` totalmente preenchido não pode vazar para o
 *     HTML nem alterar QUALQUER ramo condicional de render — comparação
 *     byte-a-byte contra o render sem `acoes`. Se algum subcomponente um dia
 *     passar a decidir o que mostrar com base na PRESENÇA de `acoes` (ex.:
 *     `{acoes && <BadgeAdmin/>}`), este teste quebra.
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
} from "./OpcionaisClient";
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

function render(props: {
  categoriasOpcional?: CategoriaOpcional[];
  opcionais?: Opcional[];
  acoes?: OpcionaisClientAcoes;
} = {}): string {
  return renderToStaticMarkup(
    <OpcionaisClient
      categoriasOpcional={props.categoriasOpcional ?? [categoria()]}
      opcionais={props.opcionais ?? [opcional()]}
      categoriasProduto={CATEGORIA_PRODUTO}
      associacoes={[]}
      acoes={props.acoes}
    />,
  );
}

describe("caminho default do painel (sem acoes) — critério de aceite da 128", () => {
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

describe("prop `acoes` injetada não vaza para o render nem muda ramos condicionais", () => {
  it("as 8 actions mockadas: HTML idêntico ao render sem `acoes`, nenhuma é chamada", () => {
    const acoes: OpcionaisClientAcoes = {
      criarCategoriaOpcional: vi.fn(async () => ({ ok: true }) as const),
      atualizarCategoriaOpcional: vi.fn(async () => ({ ok: true }) as const),
      removerCategoriaOpcional: vi.fn(async () => ({ ok: true }) as const),
      criarOpcional: vi.fn(async () => ({ ok: true }) as const),
      atualizarOpcional: vi.fn(async () => ({ ok: true }) as const),
      alternarOpcionalAtivo: vi.fn(async () => ({ ok: true }) as const),
      removerOpcional: vi.fn(async () => ({ ok: true }) as const),
      salvarAssociacaoOpcionais: vi.fn(async () => ({ ok: true }) as const),
    };

    const semAcoes = render();
    const comAcoes = render({ acoes });

    expect(comAcoes).toBe(semAcoes);
    for (const fn of Object.values(acoes)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});
