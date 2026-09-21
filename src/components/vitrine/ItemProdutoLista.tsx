"use client";

import type { KeyboardEvent } from "react";

import {
  rotuloAcessivelNaoCompravel,
  rotuloNaoCompravel,
} from "@/components/vitrine/rotuloEsgotado";
import { PrecoProduto } from "@/components/vitrine/PrecoProduto";
import { SeloDesconto } from "@/components/vitrine/SeloDesconto";
import { TextoRealcado } from "@/components/vitrine/TextoRealcado";
import type { ProdutoVitrine } from "@/lib/utils/catalogoVitrine";
import { rotuloPrecoAcessivel } from "@/lib/utils/rotuloPrecoAcessivel";

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
  /**
   * [262] A frase de "quando volta", pronta do servidor
   * (`rotulosVigencia[produto.id]`). Chave ausente ⇒ "Indisponível no momento"
   * (design §4.1) — nunca pílula em branco.
   */
  rotuloIndisponivel?: string;
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
 * O preço exibido é o EFETIVO e vem de `PrecoProduto` — a linha NÃO formata
 * preço por conta própria (M1). Em promoção o par riscado/efetivo empilha à
 * direita (`text-right`) e o selo entra numa SEGUNDA linha sob o nome, nunca
 * espremido entre o nome e a linha pontilhada, que é a identidade visual desta
 * variante (233, design §3.3). Produto esgotado E em promoção mostra os dois —
 * o selo herda a mesma opacidade do resto da linha.
 *
 * Alvo de toque `min-h-[44px]` LITERAL: a base do projeto é `font-size: 120%`,
 * onde `min-h-11` viraria 52,8px acidentais (design-system §5).
 */
export function ItemProdutoLista({
  produto,
  termo,
  rotuloIndisponivel,
  onSelecionar,
}: ItemProdutoListaProps) {
  const { nome, compravel, motivoNaoCompravel, seloDesconto } = produto;

  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelecionar();
    }
  };

  // `alt`/`aria-label` e o texto do leitor de tela continuam com o nome CRU: o
  // realce é visual e o leitor deve ouvir o nome inteiro.
  const nomeRealcado = <TextoRealcado texto={nome} termo={termo} />;

  // Segunda linha da linha: só existe quando há promoção (o próprio
  // `SeloDesconto` devolve `null` sem rótulo — M3, uma decisão num lugar só).
  const segundaLinha = seloDesconto ? (
    <div className="mt-1 flex">
      <SeloDesconto rotulo={seloDesconto} ancoragem="inline" />
    </div>
  ) : null;

  const tracejado = (
    <span
      aria-hidden
      className="mb-1 min-w-4 flex-1 border-b-2 border-dotted border-borda-nav"
    />
  );

  if (!compravel) {
    return (
      <div className="flex min-h-[44px] flex-col justify-center border-b border-cinza-medio px-4 py-3 last:border-b-0">
        {/* O visual fica marcado como decorativo e a linha inteira é anunciada
            uma vez só, pelo texto acessível — sem repetir nome + "Esgotado".
            `flex-wrap` (262): a frase de vigência é longa e, em 360px, cai para
            a linha de baixo INTEIRA em vez de truncar. Aqui não há modal para
            onde mandar o cliente ler o resto (a linha não comprável não abre,
            D13) — então nada pode ser cortado. Com "Esgotado" nada quebra e a
            linha é exatamente a de 225. */}
        <div aria-hidden className="flex flex-wrap items-baseline gap-2 opacity-60">
          <span className="max-w-[60%] flex-shrink-0 truncate text-sm font-semibold text-texto">
            {nomeRealcado}
          </span>
          {tracejado}
          <span className="flex-shrink-0">
            <PrecoProduto produto={produto} tamanho="lista" />
          </span>
          {/* MESMA pílula de 225, MESMOS tokens `--indisponivel-*` — só o
              texto muda (D4). Nunca a cor do tema da loja. */}
          <span className="flex-shrink-0 whitespace-nowrap rounded-full bg-indisponivel-fundo px-2.5 py-0.5 text-[0.625rem] font-extrabold tracking-wide text-indisponivel-texto uppercase">
            {rotuloNaoCompravel(motivoNaoCompravel, rotuloIndisponivel)}
          </span>
        </div>
        {segundaLinha ? (
          <div aria-hidden className="opacity-60">
            {segundaLinha}
          </div>
        ) : null}
        <span className="sr-only">
          {rotuloAcessivelNaoCompravel(nome, motivoNaoCompravel, rotuloIndisponivel)}
        </span>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      // Sem `rotuloPrecoAcessivel` o cliente cego ouviria SÓ o preço cheio e
      // nunca saberia da promoção (233).
      aria-label={`Ver detalhes de ${nome}, ${rotuloPrecoAcessivel(produto)}`}
      onClick={onSelecionar}
      onKeyDown={aoTeclar}
      className="flex min-h-[44px] cursor-pointer flex-col justify-center border-b border-cinza-medio px-4 py-3 last:border-b-0 hover:bg-cinza-claro focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-destaque"
    >
      <div className="flex items-baseline gap-2">
        <span className="max-w-[60%] flex-shrink-0 truncate text-sm font-semibold text-texto">
          {nomeRealcado}
        </span>
        {tracejado}
        <span className="flex-shrink-0">
          <PrecoProduto produto={produto} tamanho="lista" />
        </span>
      </div>
      {segundaLinha}
    </div>
  );
}
