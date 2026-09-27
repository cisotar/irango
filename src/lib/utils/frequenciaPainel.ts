/**
 * [323/C8] A frequência de exibição PROJETADA para o painel do lojista e para o
 * hub admin — UM helper para os dois mundos, chamado no Server Component com o
 * `agora` da página e o fuso da LOJA (o browser nunca decide "encerrado").
 *
 * Preview de UX: nada aqui decide compra. A autoridade é `criarPedido`
 * (`avaliarFrequenciaNaLoja`, `seguranca.md` §10).
 *
 * `aviso`: o de período encerrado vence (o item já sumiu da vitrine, e é isso
 * que importa); senão o de "nunca vai ficar disponível" (RN-1/RN-8).
 */

import {
  avisoCategoriaQueNuncaAbre,
  avisoFrequenciaQueNuncaAbre,
  avisoPeriodoEncerrado,
  rotuloFrequencia,
} from "./descreverVigencia";
import { frequenciaDe, type CategoriaFrequencia, type Frequencia } from "./frequencia";

export type FrequenciaDoProdutoNoPainel = {
  /** Chip da linha; `null` = permanente. */
  rotulo: string | null;
  aviso: string | null;
};

export type FrequenciaDaCategoriaNoPainel = {
  oculta: boolean;
  /**
   * Os 5 eixos crus da categoria: o editor e a grade usam para o aviso RN-1
   * AO VIVO sobre o rascunho (função pura, sem `agora`).
   */
  frequencia: Frequencia;
  rotulo: string | null;
  aviso: string | null;
};

export type FrequenciasDoPainel = {
  produtos: Record<string, FrequenciaDoProdutoNoPainel>;
  categorias: Record<string, FrequenciaDaCategoriaNoPainel>;
  /**
   * O instante da PÁGINA (ISO) e o fuso da LOJA. O editor avalia o aviso de
   * período encerrado sobre o RASCUNHO com eles — nunca com o relógio do
   * dispositivo, que a loja não controla.
   */
  agora: string;
  timezone: string;
};

export function projetarFrequenciasDoPainel(
  produtos: readonly (Frequencia & { id: string; categoria_id: string | null })[],
  categorias: readonly (CategoriaFrequencia & { id: string })[],
  agora: Date,
  timezone: string,
): FrequenciasDoPainel {
  const categoriasPorId = new Map(categorias.map((c) => [c.id, frequenciaDe(c)]));

  const resultadoCategorias: Record<string, FrequenciaDaCategoriaNoPainel> = {};
  for (const c of categorias) {
    const frequencia = frequenciaDe(c);
    resultadoCategorias[c.id] = {
      oculta: c.oculta,
      frequencia,
      rotulo: rotuloFrequencia(frequencia),
      aviso:
        avisoPeriodoEncerrado(frequencia, agora, timezone) ??
        avisoCategoriaQueNuncaAbre(frequencia),
    };
  }

  const resultadoProdutos: Record<string, FrequenciaDoProdutoNoPainel> = {};
  for (const p of produtos) {
    const frequencia = frequenciaDe(p);
    const daCategoria =
      p.categoria_id === null ? null : (categoriasPorId.get(p.categoria_id) ?? null);
    resultadoProdutos[p.id] = {
      rotulo: rotuloFrequencia(frequencia),
      aviso:
        avisoPeriodoEncerrado(frequencia, agora, timezone) ??
        avisoFrequenciaQueNuncaAbre(frequencia, daCategoria),
    };
  }

  return {
    produtos: resultadoProdutos,
    categorias: resultadoCategorias,
    agora: agora.toISOString(),
    timezone,
  };
}
