/**
 * [260][261] Contrato do MODO DE SELEÇÃO — fonte única das formas que as duas
 * superfícies de lote compartilham: a barra de `/painel/produtos` e o
 * `SeletorProdutosDoCardapio` de `/painel/cardapios/[cardapioId]` (RN-09).
 *
 * Módulo NEUTRO (sem `'use client'`, sem `'use server'`): é só tipo. As Server
 * Actions reais moram em `lib/actions/cardapio.ts` e `lib/actions/produto.ts`,
 * e chegam por injeção — o mesmo desenho de `AcoesProdutosClient` (issue 160),
 * pelo mesmo motivo: nenhuma action cai em default, então esquecer uma quebra o
 * build em vez de gravar na loja errada.
 */

import type {
  aplicarCardapioEmProdutos,
  aplicarCardapioEmCategoria,
  tirarDeCardapio,
  preverLoteAction,
} from "@/lib/actions/cardapio";
import type { definirVisibilidadeEmProdutos } from "@/lib/actions/produto";

/** O que a prévia do SERVIDOR devolve quando dá certo (RN-09-a). */
export type PreviaDoLote = Extract<
  Awaited<ReturnType<typeof preverLoteAction>>,
  { ok: true }
>;

/** As cinco actions do modo de seleção. Todas OBRIGATÓRIAS. */
export type AcoesLote = {
  aplicarEmProdutos: typeof aplicarCardapioEmProdutos;
  aplicarEmCategoria: typeof aplicarCardapioEmCategoria;
  tirarDeCardapio: typeof tirarDeCardapio;
  preverLote: typeof preverLoteAction;
  definirVisibilidade: typeof definirVisibilidadeEmProdutos;
};

/**
 * Um cardápio na lista de destino da barra. `descricao` vem pronta de
 * `descreverVigencia` no SERVIDOR (issue 254) — o browser nunca redige janela
 * de vigência nem decide se um cardápio está aberto.
 */
export type CardapioParaLote = {
  id: string;
  nome: string;
  /** A frase de vigência, já no fuso da loja. */
  descricao: string;
};

/**
 * De quais cardápios um produto participa, e se ele está DENTRO da janela
 * agora — os dois derivados no Server Component, com o relógio do servidor.
 */
export type VinculoDoProduto = {
  id: string;
  nome: string;
  abertoAgora: boolean;
};

/** Tudo que `/painel/produtos` precisa para oferecer o modo de seleção. */
export type LoteDeProdutos = {
  cardapios: CardapioParaLote[];
  acoes: AcoesLote;
};

/**
 * `produto.id → cardápios dele`. Produto ausente = não está em nenhum.
 *
 * NÃO mora em `LoteDeProdutos` (que é opcional, porque o hub admin não tem as
 * actions de lote): é LEITURA, existe nos DOIS mundos e o `FormProduto` decide
 * por ela se mostra "este produto não está em nenhum cardápio". Pendurada no
 * lote, o admin lia `{}` e afirmava isso de um produto que está em dois.
 */
export type VinculosPorProduto = Record<string, VinculoDoProduto[]>;
