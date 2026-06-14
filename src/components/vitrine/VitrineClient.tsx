"use client";

import { useState } from "react";
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

  return (
    <>
      {totalItens > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Abrir carrinho, ${totalItens} ${
            totalItens === 1 ? "item" : "itens"
          }, ${formatarMoeda(subtotal)}`}
          className="fixed bottom-4 right-4 z-40 flex min-h-11 items-center gap-2 rounded-full bg-[var(--cor-primaria)] px-5 py-3 text-white shadow-lg hover:bg-[var(--cor-primaria)]/90"
        >
          <ShoppingCart aria-hidden className="size-5" />
          <span className="font-medium">
            {totalItens} · {formatarMoeda(subtotal)}
          </span>
        </button>
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
