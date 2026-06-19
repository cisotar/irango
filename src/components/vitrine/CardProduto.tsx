"use client";

import Image from "next/image";

import { formatarMoeda } from "@/lib/utils/formatarMoeda";

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

/** Só `https:` é renderizado como imagem remota — anti-XSS (seguranca.md §15). */
function fotoSegura(url?: string | null): string | null {
  return url && url.startsWith("https://") ? url : null;
}

/**
 * Card de produto da vitrine — espelha design-claude/vitrine/card-produto.html:
 * foto 4:3, nome em 2 linhas, preço na cor de DESTAQUE da loja e botão "+"
 * quadrado (44×44) também na cor de destaque com texto branco fixo (contraste
 * seguro, design-system §4). Indisponível → ribbon diagonal "Esgotado" + overlay
 * cinza + botão desabilitado. Apresentação pura — o pai decide `onAdicionar`.
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
              className="absolute inset-0 bg-black/40 [backdrop-filter:grayscale(1)]"
            />
            <span className="absolute inset-x-[-10px] top-[40%] z-[2] -rotate-[25deg] border-2 border-white bg-[#8B4513] py-1 text-center text-sm font-black uppercase tracking-widest text-white">
              Esgotado
            </span>
          </>
        ) : null}
      </div>

      <div className="card-body flex flex-1 flex-col gap-2 p-3">
        <h3 className="line-clamp-2 text-sm font-bold leading-tight text-[#111111]">
          {nome}
        </h3>

        <div className="mt-auto flex items-center justify-between gap-2">
          <span className="text-lg font-black text-[var(--cor-destaque)]">
            {formatarMoeda(preco)}
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAdicionar(); }}
            disabled={!disponivel}
            aria-label={
              disponivel ? `Adicionar ${nome} ao carrinho` : `${nome} esgotado`
            }
            className="flex min-h-11 min-w-11 items-center justify-center rounded-[10px] bg-[var(--cor-destaque)] text-xl font-black leading-none text-white focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-white disabled:cursor-not-allowed disabled:bg-[#9a9a9a]"
          >
            +
          </button>
        </div>
      </div>
    </article>
  );
}
