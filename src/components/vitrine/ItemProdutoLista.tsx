"use client";

import type { KeyboardEvent } from "react";

import {
  ROTULO_ESGOTADO,
  rotuloAcessivelEsgotado,
} from "@/components/vitrine/rotuloEsgotado";
import { TextoRealcado } from "@/components/vitrine/TextoRealcado";
import type { ProdutoVitrine } from "@/lib/utils/catalogoVitrine";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";

type ItemProdutoListaProps = {
  /**
   * Contrato de catálogo (224/225): o MESMO objeto obrigatório que o
   * `CardProduto` recebe. É o que apaga a assimetria grid/lista que produziu o
   * D13 — a linha textual não pode mais compilar sem saber se o produto é
   * comprável.
   */
  produto: ProdutoVitrine;
  /** Termo de busca ativo (200). Ausente/vazio → nome renderiza como antes. */
  termo?: string;
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
 * Produto COMPRÁVEL: a linha inteira é o alvo de toque (role="button", ≥44px de
 * altura) e abre o mesmo modal de detalhe do produto que o `CardProduto` abre —
 * o pai (`SecaoCatalogo`) passa o mesmo handler `abrirModal` usado pelo grid.
 *
 * Produto NÃO comprável (D13): a linha deixa de ser alvo de clique por inteiro —
 * some `role="button"`, `tabIndex`, `onClick`, `onKeyDown` e `cursor-pointer`. O
 * modal não é uma saída; entrar nele era o beco sem saída de UX (escolher
 * opcionais, montar o carrinho e só ser recusado no fim pelo servidor). O par
 * textual do estado é o MESMO do `CardProduto` (`rotuloEsgotado.ts`).
 *
 * O preço exibido é o EFETIVO. Selo e preço riscado são das issues 232/233.
 */
export function ItemProdutoLista({
  produto,
  termo,
  onSelecionar,
}: ItemProdutoListaProps) {
  const { nome, precoEfetivo, compravel } = produto;
  const precoFormatado = formatarMoeda(precoEfetivo);

  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelecionar();
    }
  };

  // `alt`/`aria-label` e o texto do leitor de tela continuam com o nome CRU: o
  // realce é visual e o leitor deve ouvir o nome inteiro.
  const nomeRealcado = <TextoRealcado texto={nome} termo={termo} />;

  const tracejado = (
    <span
      aria-hidden
      className="mb-1 min-w-4 flex-1 border-b-2 border-dotted border-borda-nav"
    />
  );

  if (!compravel) {
    return (
      <div className="flex min-h-11 items-baseline gap-2 border-b border-cinza-medio px-4 py-3 last:border-b-0">
        {/* O visual fica marcado como decorativo e a linha inteira é anunciada
            uma vez só, pelo texto acessível — sem repetir nome + "Esgotado". */}
        <span
          aria-hidden
          className="max-w-[60%] flex-shrink-0 truncate text-sm font-semibold text-texto opacity-60"
        >
          {nomeRealcado}
        </span>
        {tracejado}
        <span
          aria-hidden
          className="flex-shrink-0 text-sm font-extrabold text-texto-muted opacity-60 [font-variant-numeric:tabular-nums]"
        >
          {precoFormatado}
        </span>
        <span
          aria-hidden
          className="flex-shrink-0 whitespace-nowrap rounded-full bg-[#111111] px-2.5 py-0.5 text-[0.625rem] font-extrabold tracking-wide text-white uppercase"
        >
          {ROTULO_ESGOTADO}
        </span>
        <span className="sr-only">{rotuloAcessivelEsgotado(nome)}</span>
      </div>
    );
  }

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
        {nomeRealcado}
      </span>
      {tracejado}
      <span className="flex-shrink-0 text-sm font-extrabold text-destaque [font-variant-numeric:tabular-nums]">
        {precoFormatado}
      </span>
    </div>
  );
}
