"use client";

import Image from "next/image";

import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import { fotoSegura } from "@/lib/utils/fotoSegura";

type CardProdutoProps = {
  id: string;
  nome: string;
  /** Mantido no contrato; o design-claude não exibe descrição no card. */
  descricao?: string | null;
  preco: number;
  fotoUrl?: string | null;
  /** false → ribbon "Esgotado" + botão desabilitado. Default true. */
  disponivel?: boolean;
  onAdicionar: () => void;
};

/**
 * Card de produto da vitrine — espelha design-claude/vitrine/card-produto.html:
 * foto 4:3, nome em 2 linhas, preço na cor de DESTAQUE da loja e botão "+"
 * quadrado (44×44) também na cor de destaque com texto branco fixo (contraste
 * seguro, design-system §4). Indisponível → pill "Esgotado" no rodapé da imagem
 * + overlay cinza + botão desabilitado. Apresentação pura — o pai decide `onAdicionar`.
 */
export function CardProduto({
  nome,
  preco,
  fotoUrl,
  disponivel = true,
  onAdicionar,
}: CardProdutoProps) {
  const foto = fotoSegura(fotoUrl);

  return (
    <article
      onClick={disponivel ? onAdicionar : undefined}
      className={`relative flex flex-col overflow-hidden rounded-xl border border-[#eeeeee] bg-white shadow-[0_4px_12px_rgba(0,0,0,0.1)] ${
        disponivel ? "cursor-pointer" : "[&_.card-body]:opacity-60"
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
        {!disponivel ? (
          <>
            <span
              aria-hidden
              className="absolute inset-0 bg-black/35 [backdrop-filter:grayscale(1)]"
            />
            <span className="absolute bottom-[10px] left-1/2 z-[2] -translate-x-1/2 whitespace-nowrap rounded-full bg-[#111111] px-[18px] py-2 text-sm font-extrabold uppercase tracking-wide text-white shadow-[0_2px_10px_rgba(0,0,0,0.35)]">
              Esgotado
            </span>
          </>
        ) : null}
      </div>

      <div className="card-body flex flex-1 flex-col gap-2 p-3 lg:gap-1.5 lg:p-2.5">
        <h3 className="line-clamp-2 text-sm font-bold leading-tight text-[#111111] lg:text-xs">
          {nome}
        </h3>

        <div className="mt-auto flex items-center justify-between gap-2">
          <span className="text-lg font-black text-[var(--cor-destaque)] lg:text-sm">
            {formatarMoeda(preco)}
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAdicionar(); }}
            disabled={!disponivel}
            aria-label={
              disponivel ? `Adicionar ${nome} ao carrinho` : `${nome} esgotado`
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
