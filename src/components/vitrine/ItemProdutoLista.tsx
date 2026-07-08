"use client";

import type { KeyboardEvent } from "react";

import { formatarMoeda } from "@/lib/utils/formatarMoeda";

type ItemProdutoListaProps = {
  nome: string;
  preco: number;
  /** Abre o mesmo modal de produto que o CardProduto usa (reuso, sem duplicar lógica). */
  onSelecionar: () => void;
};

/**
 * Linha de produto em lista estilo cardápio — espelha
 * design-claude/vitrine/toggle-imagens-categoria-mockup.html (seção "Categoria
 * ocultar → lista"). Usada por `SecaoCatalogo` para categorias com
 * `exibir_imagens = false` (specs/toggle-imagens-por-categoria.md, RN-3/RN-4):
 * nome à esquerda (trunca com ellipsis), linha pontilhada preenchendo o meio,
 * preço à direita. Sem imagem, sem placeholder — layout inteiro é textual.
 *
 * A linha inteira é o alvo de toque (role="button", ≥44px de altura) e abre o
 * mesmo modal de detalhe do produto que o `CardProduto` abre — o pai
 * (`SecaoCatalogo`) passa o mesmo handler `abrirModal` usado pelo grid; não há
 * lógica de carrinho/modal nova aqui.
 */
export function ItemProdutoLista({
  nome,
  preco,
  onSelecionar,
}: ItemProdutoListaProps) {
  const precoFormatado = formatarMoeda(preco);

  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelecionar();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Ver detalhes de ${nome}, ${precoFormatado}`}
      onClick={onSelecionar}
      onKeyDown={aoTeclar}
      className="flex min-h-11 cursor-pointer items-baseline gap-2 border-b border-cinza-medio px-4 py-3 last:border-b-0 hover:bg-cinza-claro focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-destaque"
    >
      <span className="max-w-[60%] flex-shrink-0 truncate text-sm font-semibold text-texto">
        {nome}
      </span>
      <span
        aria-hidden
        className="mb-1 min-w-4 flex-1 border-b-2 border-dotted border-borda-nav"
      />
      <span className="flex-shrink-0 text-sm font-extrabold text-destaque [font-variant-numeric:tabular-nums]">
        {precoFormatado}
      </span>
    </div>
  );
}
