/**
 * Fase RED (TDD) da issue 331 — fatia F4 na VITRINE: o produto P mostra os
 * grupos da categoria MENOS os ocultos nele, na ordem da categoria.
 *
 * Hoje a derivação `produto.categoria_id ? opcionaisPorCategoria[...] : undefined`
 * existe em DUAS cópias (`enriquecerParaModal`, em catalogoVitrine.ts, e
 * `abrirModal`, em SecaoCatalogo.tsx). Contrato fixado aqui:
 *
 *   export function gruposOpcionaisParaVitrine(
 *     produto: { id: string; categoria_id: string | null },
 *     opcionaisPorCategoria: Readonly<Record<string, GrupoOpcional[]>>,
 *     ocultosPorProduto?: OcultosPorProduto,       // produto_id → grupo_ids
 *   ): GrupoOpcional[] | undefined
 *
 * é a ÚNICA cópia (card, modal de promoções e modal sazonal), e ela delega a
 * regra a `gruposVisiveisDoProduto` (src/lib/utils/opcionais-do-produto.ts).
 * `derivarPromocionaisParaModal` e `derivarProdutosDoModalSazonal` ganham o mapa
 * de ocultos como ÚLTIMO parâmetro, OPCIONAL (chamada antiga = comportamento de
 * hoje, e os testes de 289/303 seguem verdes).
 *
 * Preview de UX: a autoridade é `criarPedido` (pedido.test.ts, [331]).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import * as catalogo from "./catalogoVitrine";
import type { ProdutoVitrine } from "./catalogoVitrine";
import type { GrupoOpcional } from "@/lib/supabase/queries/produtos";
import type { CategoriaComProdutos } from "@/components/vitrine/SecaoCatalogo";

type OcultosPorProduto = Readonly<Record<string, readonly string[]>>;

type GruposParaVitrine = (
  produto: { id: string; categoria_id: string | null },
  opcionaisPorCategoria: Readonly<Record<string, GrupoOpcional[]>>,
  ocultosPorProduto?: OcultosPorProduto,
) => GrupoOpcional[] | undefined;

/** Acesso tolerante: o símbolo ainda não existe (RED por asserção). */
function gruposOpcionaisParaVitrine(...args: Parameters<GruposParaVitrine>) {
  const fn = (catalogo as unknown as Record<string, unknown>).gruposOpcionaisParaVitrine;
  expect(typeof fn, "gruposOpcionaisParaVitrine não é exportada de catalogoVitrine.ts").toBe(
    "function",
  );
  return (fn as GruposParaVitrine)(...args);
}

// Assinaturas estendidas (último parâmetro opcional, novo).
const derivarPromocionais = catalogo.derivarPromocionaisParaModal as unknown as (
  secoes: readonly CategoriaComProdutos[],
  opcionaisPorCategoria: Readonly<Record<string, GrupoOpcional[]>>,
  rotulosVigencia: Readonly<Record<string, string>>,
  ocultosPorProduto?: OcultosPorProduto,
) => Array<ProdutoVitrine & { gruposOpcionais?: GrupoOpcional[] }>;

const derivarSazonal = catalogo.derivarProdutosDoModalSazonal as unknown as (
  categoriasComProdutos: readonly CategoriaComProdutos[],
  secoesDestaque: readonly CategoriaComProdutos[],
  opcionaisPorCategoria: Readonly<Record<string, GrupoOpcional[]>>,
  rotulosVigencia: Readonly<Record<string, string>>,
  selecao: { categorias: readonly string[]; cardapios: readonly string[] },
  ocultosPorProduto?: OcultosPorProduto,
) => Array<ProdutoVitrine & { gruposOpcionais?: GrupoOpcional[] }>;

const CAT = "cat-lanches";
const A = "grupo-a";
const B = "grupo-b";
const C = "grupo-c";

const g = (id: string, ordem: number): GrupoOpcional => ({
  categoriaOpcionalId: id,
  categoriaOpcionalNome: id.toUpperCase(),
  ordem,
  opcionais: [{ id: `${id}-item`, nome: `Item ${id}`, preco: 3, ordem: 0 }],
});
const GRUPOS_ABC: GrupoOpcional[] = [g(A, 0), g(B, 1), g(C, 2)];
const POR_CATEGORIA = { [CAT]: GRUPOS_ABC };

const prato = (id: string, patch: Partial<ProdutoVitrine> = {}): ProdutoVitrine => ({
  id,
  nome: `Prato ${id}`,
  descricao: null,
  foto_url: null,
  categoria_id: CAT,
  preco: 100,
  precoEfetivo: 80,
  temDesconto: true,
  seloDesconto: "-20%",
  descontoFim: null,
  compravel: true,
  motivoNaoCompravel: null,
  ...patch,
});

const ids = (gs: readonly GrupoOpcional[] | undefined) =>
  (gs ?? []).map((x) => x.categoriaOpcionalId);

describe("331 F4 — gruposOpcionaisParaVitrine (fonte única card + modais)", () => {
  it("categoria A,B,C com B oculto no produto P → P recebe A,C (ordem preservada)", () => {
    const r = gruposOpcionaisParaVitrine({ id: "p", categoria_id: CAT }, POR_CATEGORIA, {
      p: [B],
    });
    expect(ids(r)).toEqual([A, C]);
  });

  it("outro produto da MESMA categoria recebe A,B,C — pela MESMA referência (payload RSC)", () => {
    const r = gruposOpcionaisParaVitrine({ id: "q", categoria_id: CAT }, POR_CATEGORIA, {
      p: [B],
    });
    expect(ids(r)).toEqual([A, B, C]);
    expect(r).toBe(GRUPOS_ABC);
  });

  it("produto sem categoria → undefined, como hoje (mesmo com ocultos)", () => {
    const r = gruposOpcionaisParaVitrine({ id: "p", categoria_id: null }, POR_CATEGORIA, {
      p: [A],
    });
    expect(r).toBeUndefined();
  });

  it("sem mapa de ocultos → comportamento de hoje (mesma referência)", () => {
    const r = gruposOpcionaisParaVitrine({ id: "p", categoria_id: CAT }, POR_CATEGORIA);
    expect(r).toBe(GRUPOS_ABC);
  });

  it("todos os grupos ocultos no produto → nenhum grupo no modal", () => {
    const r = gruposOpcionaisParaVitrine({ id: "p", categoria_id: CAT }, POR_CATEGORIA, {
      p: [A, B, C],
    });
    expect(ids(r)).toEqual([]);
  });

  it("não muta a lista compartilhada da categoria", () => {
    gruposOpcionaisParaVitrine({ id: "p", categoria_id: CAT }, POR_CATEGORIA, { p: [B] });
    expect(ids(POR_CATEGORIA[CAT])).toEqual([A, B, C]);
  });
});

describe("331 F4 — os dois modais aplicam os ocultos do produto", () => {
  const secao = (produtos: ProdutoVitrine[]): CategoriaComProdutos => ({
    id: CAT,
    nome: "Lanches",
    produtos,
  });

  it("derivarPromocionaisParaModal: P recebe A,C e Q recebe A,B,C", () => {
    const [p, q] = derivarPromocionais(
      [secao([prato("p"), prato("q")])],
      POR_CATEGORIA,
      {},
      { p: [B] },
    );
    expect(ids(p.gruposOpcionais)).toEqual([A, C]);
    expect(ids(q.gruposOpcionais)).toEqual([A, B, C]);
  });

  it("derivarProdutosDoModalSazonal: P recebe A,C e Q recebe A,B,C", () => {
    const [p, q] = derivarSazonal(
      [secao([prato("p"), prato("q")])],
      [],
      POR_CATEGORIA,
      {},
      { categorias: [CAT], cardapios: [] },
      { p: [B] },
    );
    expect(ids(p.gruposOpcionais)).toEqual([A, C]);
    expect(ids(q.gruposOpcionais)).toEqual([A, B, C]);
  });
});

// ── Trava de fonte: a derivação produto → grupos existe UMA vez ─────────────

const RAIZ = process.cwd();

function arquivosFonte(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...arquivosFonte(p));
    else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.(ts|tsx)$/.test(nome)) out.push(p);
  }
  return out;
}

describe("331 F4 — fonte única da derivação na vitrine (anti-drift)", () => {
  it("`opcionaisPorCategoria[produto.categoria_id]` aparece no máximo UMA vez em src/, dentro de catalogoVitrine.ts", () => {
    const ocorrencias: string[] = [];
    for (const arq of arquivosFonte(join(RAIZ, "src"))) {
      const fonte = readFileSync(arq, "utf8");
      const n = (fonte.match(/opcionaisPorCategoria\[\s*produto\.categoria_id\s*\]/g) ?? []).length;
      for (let i = 0; i < n; i++) ocorrencias.push(relative(RAIZ, arq));
    }
    expect(ocorrencias.length).toBeLessThanOrEqual(1);
    for (const o of ocorrencias) expect(o).toBe("src/lib/utils/catalogoVitrine.ts");
  });

  it("SecaoCatalogo.tsx abre o modal por gruposOpcionaisParaVitrine (não deriva inline)", () => {
    const fonte = readFileSync(join(RAIZ, "src/components/vitrine/SecaoCatalogo.tsx"), "utf8");
    expect(fonte).toContain("gruposOpcionaisParaVitrine(");
  });

  it("gruposOpcionaisParaVitrine delega a regra a gruposVisiveisDoProduto (util única)", () => {
    const fonte = readFileSync(join(RAIZ, "src/lib/utils/catalogoVitrine.ts"), "utf8");
    expect(fonte).toContain("gruposVisiveisDoProduto");
  });
});
