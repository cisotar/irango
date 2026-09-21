/**
 * Fase RED (TDD) da issue 225 — as quatro superfícies do catálogo recebem
 * `produto: ProdutoVitrine` OBRIGATÓRIO, e o D13 morre por construção.
 *
 * ── Por que este arquivo é diferente dos outros testes do repo ──────────────
 *
 * O critério de aceite da 225 diz, com todas as letras: "a prova é o `tsc`".
 * O repo não tem jsdom (`environment: node`, sem Docker, sem Playwright), então
 * "o modal trata esgotado" não é afirmável por teste de DOM — e, mais
 * importante, a trava que a issue quer NÃO é comportamental: é que campo
 * faltando vire ERRO DE COMPILAÇÃO, o primeiro passo do CI. Um teste de render
 * proibiria o bug de hoje; o tipo obrigatório proíbe a CLASSE do bug.
 *
 * Logo, este arquivo tem dois tipos de asserção, e as duas são executáveis:
 *
 *  1. ASSERÇÕES DE TIPO — colhidas por `npx tsc --noEmit`, não pelo vitest
 *     (o esbuild apaga tipos). Cada `@ts-expect-error` marca uma montagem que
 *     HOJE compila e que depois da 225 deve deixar de compilar; enquanto ela
 *     compilar, o próprio diretivo vira o erro `Unused '@ts-expect-error'`.
 *     É o RED literal pedido pelo plano §5.7.
 *
 *  2. GUARDAS ESTÁTICAS — os dois `grep` do critério de aceite, lidos do disco
 *     e assertados aqui. Vira regressão permanente: ninguém reintroduz o
 *     default silencioso sem derrubar a suíte.
 *
 * O caso de COMPORTAMENTO ("linha textual esgotada não abre o modal") mora em
 * `ItemProdutoLista.test.tsx`, que renderiza de verdade via `renderToStaticMarkup`.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ComponentProps } from "react";

import { describe, it, expect } from "vitest";

import type {
  MotivoNaoCompravel,
  ProdutoVitrine,
} from "@/lib/utils/catalogoVitrine";

import { CardProduto } from "./CardProduto";
import { ItemProdutoLista } from "./ItemProdutoLista";
import { ProdutoModal } from "./ProdutoModal";
import type { CategoriaComProdutos } from "./SecaoCatalogo";

// ───────────────────────────────────────────────────────────────────────────
// Fixture: `ProdutoVitrine` completo — os 12 campos do contrato (issue 224).
// ───────────────────────────────────────────────────────────────────────────
const PRODUTO: ProdutoVitrine = {
  id: "p-1",
  nome: "Suco de laranja 500ml",
  descricao: null,
  foto_url: null,
  categoria_id: "cat-bebidas",
  preco: 9,
  precoEfetivo: 7.2,
  temDesconto: true,
  seloDesconto: "-20%",
  descontoFim: null,
  compravel: false,
  motivoNaoCompravel: "esgotado",
};

// ───────────────────────────────────────────────────────────────────────────
// 1. Asserções de TIPO — o RED que `npx tsc --noEmit` colhe.
// ───────────────────────────────────────────────────────────────────────────

/** O produto como `SecaoCatalogo` o declara — a fonte do bug de hoje. */
type ProdutoDaSecao = CategoriaComProdutos["produtos"][number];

/**
 * ESTE é o RED do plano §5.7. `abrirModal` (SecaoCatalogo.tsx:89-100) monta um
 * objeto PARCIAL à mão a partir deste shape; enquanto o shape for parcial,
 * comprabilidade e preço efetivo caem no chão em silêncio no caminho do modal.
 * Depois da 225 este literal deve ser REJEITADO: faltam `precoEfetivo`,
 * `temDesconto`, `seloDesconto`, `descontoFim`, `compravel` e
 * `motivoNaoCompravel`, e `disponivel` deixa de existir.
 */
const _montagemParcialDeveFalhar: ProdutoDaSecao = {
  id: "p-1",
  nome: "Suco de laranja 500ml",
  descricao: null,
  preco: 9,
  foto_url: null,
  categoria_id: "cat-bebidas",
  // O diretivo fica AQUI, e não sobre o `const`: propriedade em excesso é
  // reportada na linha da propriedade (TS2353), não na da declaração. A trava
  // vale nos dois sentidos — se `disponivel` voltar ao contrato, o diretivo
  // vira `TS2578: Unused`; se o tipo afrouxar de outro jeito, o erro de campo
  // faltante cai na linha do `const`, fora do alcance desta supressão.
  // @ts-expect-error — 225: a montagem PARCIAL deve deixar de compilar.
  disponivel: true,
};

/** E o objeto INTEIRO, que hoje é recusado, passa a ser o único aceito. */
const _secaoAceitaProdutoVitrine: ProdutoDaSecao = PRODUTO;

/** `CardProduto`: um objeto obrigatório, zero campo avulso com default. */
const _propsCard: ComponentProps<typeof CardProduto> = {
  produto: PRODUTO,
  onAdicionar: () => {},
};

/** `ItemProdutoLista`: o mesmo objeto — é o que apaga a assimetria grid/lista. */
const _propsLinha: ComponentProps<typeof ItemProdutoLista> = {
  produto: PRODUTO,
  onSelecionar: () => {},
};

/** `ProdutoModal`: `null` segue sendo "modal fechado"; o resto é o objeto inteiro. */
type ProdutoDoModal = NonNullable<
  ComponentProps<typeof ProdutoModal>["produto"]
>;

/**
 * O shape reduzido de hoje (`ProdutoModalDados`) é exatamente o que permite o
 * `produto.disponivel ?? true` de `ProdutoModal.tsx:139` — o default silencioso
 * É o bug. Depois da 225 ele não compila mais.
 */
const _modalParcialDeveFalhar: ProdutoDoModal = {
  id: "p-1",
  nome: "Suco de laranja 500ml",
  descricao: null,
  preco: 9,
  // @ts-expect-error — 225: o shape reduzido do modal deve deixar de compilar.
  fotoUrl: null,
};

/**
 * O modal precisa conhecer comprabilidade E preço efetivo sem inferir nada:
 * sem `compravel` não há como recusar o esgotado, e sem `precoEfetivo` o total
 * com opcionais parte do preço de tabela (cobraria a mais no preview).
 */
type ModalConheceOContrato = ProdutoDoModal extends {
  precoEfetivo: number;
  compravel: boolean;
  motivoNaoCompravel: MotivoNaoCompravel | null;
}
  ? true
  : false;
const _modalConheceOContrato: ModalConheceOContrato = true;

describe("225 — o tipo é a trava (asserções colhidas por `npx tsc --noEmit`)", () => {
  it("as montagens acima compilam se, e somente se, a 225 estiver implementada", () => {
    // Guarda de runtime trivial: o valor do teste está nas asserções de tipo
    // do topo do arquivo, que o vitest não avalia. O `tsc` é o juiz — e ele é
    // o 1º passo do CI (`npx tsc --noEmit` → lint → test → build).
    expect(_secaoAceitaProdutoVitrine.compravel).toBe(false);
    expect(_propsCard.produto.motivoNaoCompravel).toBe("esgotado");
    expect(_propsLinha.produto.precoEfetivo).toBe(7.2);
    expect(_modalConheceOContrato).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Guardas estáticas — os dois `grep` do critério de aceite, permanentes.
// ───────────────────────────────────────────────────────────────────────────

const DIR_VITRINE = join(process.cwd(), "src/components/vitrine");

function fontesDaVitrine(): { arquivo: string; texto: string }[] {
  return readdirSync(DIR_VITRINE)
    .filter((n) => /\.tsx?$/.test(n) && !n.includes(".test."))
    .map((arquivo) => ({
      arquivo,
      texto: readFileSync(join(DIR_VITRINE, arquivo), "utf8"),
    }));
}

/** `grep -n <agulha> <arquivo>` — devolve "arquivo:linha: conteúdo". */
function ocorrencias(agulha: string): string[] {
  return fontesDaVitrine().flatMap(({ arquivo, texto }) =>
    texto
      .split("\n")
      .map((linha, i) => ({ linha, n: i + 1 }))
      .filter(({ linha }) => linha.includes(agulha))
      .map(({ linha, n }) => `${arquivo}:${n}: ${linha.trim()}`),
  );
}

/**
 * O critério de aceite da 225 escreveu `grep -rn "disponivel?:"`, mas o que ele
 * PROÍBE é um CAMPO chamado `disponivel` declarado opcional. A fronteira de
 * palavra entra porque a issue 262 estreou a prop `rotuloIndisponivel?:`, cujo
 * final casa a agulha crua por acidente de substring — e um falso positivo que
 * obriga a renomear prop legítima é uma guarda que treina a equipe a afrouxá-la.
 * A proibição original continua exata: `disponivel?:` com qualquer coisa que
 * não seja letra antes (início de linha, espaço, `{`) ainda derruba a suíte.
 */
function ocorrenciasDeCampoOpcional(campo: string): string[] {
  const padrao = new RegExp(`(?:^|[^A-Za-z])${campo}\\?:`);
  return fontesDaVitrine().flatMap(({ arquivo, texto }) =>
    texto
      .split("\n")
      .map((linha, i) => ({ linha, n: i + 1 }))
      .filter(({ linha }) => padrao.test(linha))
      .map(({ linha, n }) => `${arquivo}:${n}: ${linha.trim()}`),
  );
}

describe("225 — guardas estáticas do critério de aceite", () => {
  it('`grep -rn "disponivel?:" src/components/vitrine/` não devolve nada', () => {
    // Campo opcional é o que deixa a superfície compilar sem o dado. Nenhuma
    // das quatro superfícies pode voltar a declará-lo.
    expect(ocorrenciasDeCampoOpcional("disponivel")).toEqual([]);
  });

  it('`grep -rn "?? true" src/components/vitrine/ProdutoModal.tsx` não devolve nada', () => {
    // O default silencioso É o bug do D13: campo ausente virava "disponível".
    const noModal = ocorrencias("?? true").filter((o) =>
      o.startsWith("ProdutoModal.tsx:"),
    );
    expect(noModal).toEqual([]);
  });

  it("nenhuma superfície da vitrine reintroduz `?? true` para comprabilidade", () => {
    expect(ocorrencias("?? true")).toEqual([]);
  });

  it("o total do modal parte do PREÇO EFETIVO, não do preço de tabela", () => {
    // Sem jsdom não dá para abrir o modal e ler o subtotal renderizado. A
    // invariante afirmável é a fonte do número: `ProdutoModal` tem de ler
    // `precoEfetivo` do objeto — aritmética nova no modal é proibida pela issue
    // (o `calcularSubtotal` que ele já chama é que passa a receber o efetivo).
    const modal = fontesDaVitrine().find(
      (f) => f.arquivo === "ProdutoModal.tsx",
    );
    expect(modal?.texto).toContain("precoEfetivo");
  });

  it("`page.tsx` não mantém o adaptador temporário `disponivel: p.compravel` (224)", () => {
    const page = readFileSync(
      join(process.cwd(), "src/app/(publica)/loja/[slug]/page.tsx"),
      "utf8",
    );
    expect(page).not.toContain("disponivel: p.compravel");
  });

  it("`filtrarCatalogo` é verificado, não reescrito: repassa o objeto inteiro", () => {
    // A única exigência da issue sobre o caminho da busca — nada de re-montar
    // um shape reduzido no filtro (seria a terceira cópia do bug).
    const busca = readFileSync(
      join(process.cwd(), "src/lib/utils/buscarProdutos.ts"),
      "utf8",
    );
    expect(busca).toContain("...categoria");
  });
});
