"use client";

import Image from "next/image";

import {
  ROTULO_ESGOTADO,
  rotuloAcessivelEsgotado,
} from "@/components/vitrine/rotuloEsgotado";
import { PrecoProduto } from "@/components/vitrine/PrecoProduto";
import { SeloDesconto } from "@/components/vitrine/SeloDesconto";
import { TextoRealcado } from "@/components/vitrine/TextoRealcado";
import type { ProdutoVitrine } from "@/lib/utils/catalogoVitrine";
import { fotoSegura } from "@/lib/utils/fotoSegura";
import { rotuloPrecoAcessivel } from "@/lib/utils/rotuloPrecoAcessivel";

type CardProdutoProps = {
  /**
   * Contrato de catálogo (224/225): UM objeto obrigatório, produzido no
   * servidor. Sem campo avulso com default — campo faltando é erro de
   * compilação, não "disponível" silencioso (D13).
   *
   * A `descricao` segue no contrato, mas o design-claude não a exibe no card —
   * por isso o realce da busca (200) cobre só o `nome`.
   */
  produto: ProdutoVitrine;
  /** Termo de busca ativo (200). Ausente/vazio → nome renderiza como antes. */
  termo?: string;
  onAdicionar: () => void;
};

/**
 * Card de produto da vitrine — espelha design-claude/vitrine/card-produto.html:
 * foto 4:3, nome em 2 linhas, preço na cor de DESTAQUE da loja e botão "+"
 * quadrado (44×44) também na cor de destaque com texto branco fixo (contraste
 * seguro, design-system §4). Não comprável → pill "Esgotado" no rodapé da imagem
 * + overlay cinza + botão desabilitado. Apresentação pura — o pai decide `onAdicionar`.
 *
 * O preço exibido é o EFETIVO (o que o cliente paga agora), impresso por
 * `PrecoProduto` — o card NÃO formata preço por conta própria (M1). Em promoção
 * o par riscado/efetivo empilha e o selo entra no canto superior esquerdo da
 * foto (233, design §3.2): nunca colide com a pílula "Esgotado", que mora no
 * rodapé-centro — os dois podem coexistir.
 *
 * Nada de monetário é decidido aqui: `temDesconto` e `seloDesconto` chegam
 * prontos do servidor (regra 6 do contrato de catálogo).
 */
export function CardProduto({ produto, termo, onAdicionar }: CardProdutoProps) {
  const { nome, foto_url, compravel, seloDesconto } = produto;
  const foto = fotoSegura(foto_url);

  return (
    <article
      onClick={compravel ? onAdicionar : undefined}
      className={`relative flex flex-col overflow-hidden rounded-xl border border-[#eeeeee] bg-white shadow-[0_4px_12px_rgba(0,0,0,0.1)] ${
        compravel ? "cursor-pointer" : "[&_.card-body]:opacity-60"
      }`}
    >
      <div className="relative aspect-[4/3] w-full">
        {foto ? (
          <Image
            src={foto}
            alt={nome}
            width={400}
            height={300}
            unoptimized
            className="size-full object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="size-full bg-[linear-gradient(135deg,#e8dcc4,#d8c4a0)]"
          />
        )}
        {!compravel ? (
          <>
            <span
              aria-hidden
              className="absolute inset-0 bg-black/35 [backdrop-filter:grayscale(1)]"
            />
            <span className="absolute bottom-[10px] left-1/2 z-[2] -translate-x-1/2 whitespace-nowrap rounded-full bg-[#111111] px-[18px] py-2 text-sm font-extrabold uppercase tracking-wide text-white shadow-[0_2px_10px_rgba(0,0,0,0.35)]">
              {ROTULO_ESGOTADO}
            </span>
          </>
        ) : null}
        {/* Canto SUPERIOR ESQUERDO: o wrapper dá a posição, o selo dá a forma
            (o componente não expõe `className` — posição é do consumidor). O
            wrapper só existe COM promoção: sem desconto a árvore do card é
            exatamente a de hoje, nem um nó a mais. */}
        {seloDesconto ? (
          <div className="absolute left-2 top-2 z-[2]">
            <SeloDesconto rotulo={seloDesconto} ancoragem="foto" />
          </div>
        ) : null}
      </div>

      <div className="card-body flex flex-1 flex-col gap-2 p-3 lg:gap-1.5 lg:p-2.5">
        {/* `alt` da imagem e `aria-label` do botão continuam a string CRUA:
            atributo não aceita nó React, e é o nome inteiro que o leitor de
            tela deve ouvir. O realce é estritamente visual. */}
        <h3 className="line-clamp-2 text-sm font-bold leading-tight text-[#111111] lg:text-xs">
          <TextoRealcado texto={nome} termo={termo} />
        </h3>

        {/* `items-end`: com desconto o bloco de preço ganha DUAS linhas e o "+"
            fica alinhado ao final da coluna. Sem desconto a árvore é a de
            hoje — a altura do card não muda. */}
        <div className="mt-auto flex items-end justify-between gap-2">
          <PrecoProduto produto={produto} tamanho="card" />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAdicionar(); }}
            disabled={!compravel}
            aria-label={
              compravel
                ? `Adicionar ${nome} ao carrinho, ${rotuloPrecoAcessivel(produto)}`
                : rotuloAcessivelEsgotado(nome)
            }
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--cor-destaque)] text-base font-black leading-none text-white focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-white disabled:cursor-not-allowed disabled:bg-[#9a9a9a] lg:h-7 lg:w-7 lg:text-sm"
          >
            +
          </button>
        </div>
      </div>
    </article>
  );
}
