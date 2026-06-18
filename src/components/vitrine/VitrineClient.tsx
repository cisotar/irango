"use client";

import { useEffect, useRef, useState } from "react";
import { ShoppingCart } from "lucide-react";

import {
  Carrinho,
  type FormaPagamento,
  type ZonaEntrega,
} from "@/components/vitrine/Carrinho";
import { useCarrinho } from "@/hooks/useCarrinho";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";

type VitrineClientProps = {
  lojaId: string;
  lojaSlug: string;
  zonas: ZonaEntrega[];
  formasPagamento: FormaPagamento[];
};

/**
 * Camada client da vitrine: dona do estado `open` do `Carrinho` (Sheet) e do FAB
 * fixo. O contador/total do FAB vêm de `useCarrinho` — preview de UX (o servidor
 * recalcula no checkout, seguranca.md §10).
 */
export function VitrineClient({
  lojaId,
  lojaSlug,
  zonas,
  formasPagamento,
}: VitrineClientProps) {
  const [open, setOpen] = useState(false);
  const { totalItens, subtotal } = useCarrinho();

  const prevTotalItens = useRef(totalItens);
  useEffect(() => {
    if (totalItens > prevTotalItens.current) {
      setOpen(true);
    }
    prevTotalItens.current = totalItens;
  }, [totalItens]);

  return (
    <>
      {/* Barra de carrinho fixa no rodapé (design-claude/vitrine/barra-carrinho.html):
          cor de destaque, qtd + total à esquerda, "Ver carrinho" à direita. O
          total é preview de UX — o servidor recalcula no checkout (seguranca §10). */}
      {totalItens > 0 && (
        <nav
          aria-label="Resumo do carrinho"
          className="fixed inset-x-0 bottom-0 z-40 mx-auto flex min-h-16 max-w-3xl items-center justify-between gap-3 bg-[var(--cor-destaque)] px-[18px] py-3 text-[#f5f0e6] shadow-[0_-4px_16px_rgba(0,0,0,0.2)]"
        >
          <div className="flex flex-col gap-0.5 leading-tight">
            <span className="text-xs font-medium tracking-wide uppercase opacity-85">
              {totalItens} {totalItens === 1 ? "item" : "itens"}
            </span>
            <span className="text-xl font-black">{formatarMoeda(subtotal)}</span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`Abrir carrinho, ${totalItens} ${
              totalItens === 1 ? "item" : "itens"
            }, ${formatarMoeda(subtotal)}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-white/40 bg-white/15 px-4 text-sm font-bold tracking-wide text-white uppercase focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Ver carrinho
            <ShoppingCart aria-hidden className="size-5" />
          </button>
        </nav>
      )}

      <Carrinho
        open={open}
        onOpenChange={setOpen}
        lojaId={lojaId}
        lojaSlug={lojaSlug}
        zonas={zonas}
        formasPagamento={formasPagamento}
      />
    </>
  );
}
