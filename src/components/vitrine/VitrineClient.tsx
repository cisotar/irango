"use client";

import { useEffect, useRef, useState } from "react";
import { ShoppingCart } from "lucide-react";

import { Carrinho } from "@/components/vitrine/Carrinho";
import { ID_MAIN_VITRINE } from "@/components/vitrine/layoutVitrine";
import { ModalPromocoes } from "@/components/vitrine/ModalPromocoes";
import { useCarrinho } from "@/hooks/useCarrinho";
import type { ProdutoModalDados } from "@/components/vitrine/ProdutoModal";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";

type VitrineClientProps = {
  lojaSlug: string;
  /** [237] Id da loja — a gaveta revisa o carrinho no servidor (economia). */
  lojaId: string;
  /**
   * Pratos em promoção, derivados do catálogo no SSR (RN-15) e já enriquecidos
   * para o detalhe (289): repasse puro ao `ModalPromocoes`.
   */
  promocoes: ProdutoModalDados[];
  /** `lojas.modal_promocoes` (SSR, via `vitrine_lojas`). */
  modalPromocoes: boolean;
  /** "YYYY-MM-DD" no fuso da LOJA, derivado no servidor (RN-16). */
  diaDeHojeNaLoja: string;
};

/**
 * Camada client da vitrine: dona do estado `open` do `Carrinho` (Sheet) e do FAB
 * fixo. O contador/total do FAB vêm de `useCarrinho` — preview de UX (o servidor
 * recalcula no checkout, seguranca.md §10). O Sheet só abre por clique explícito
 * em "Ver carrinho" — adicionar item nunca abre sozinho.
 */
export function VitrineClient({
  lojaSlug,
  lojaId,
  promocoes,
  modalPromocoes,
  diaDeHojeNaLoja,
}: VitrineClientProps) {
  const [open, setOpen] = useState(false);
  const { totalItens, subtotal } = useCarrinho();

  // Destino do foco quando o `ModalPromocoes` fecha (234, design §5.3). O
  // `<main>` é renderizado por um IRMÃO client, então a referência é resolvida
  // pelo `id` compartilhado (`layoutVitrine.ts`) depois da montagem — nunca
  // durante o render, e nunca no SSR.
  const destinoFoco = useRef<HTMLElement | null>(null);
  useEffect(() => {
    destinoFoco.current = document.getElementById(ID_MAIN_VITRINE);
  }, []);

  return (
    <>
      {/* Barra de carrinho fixa no rodapé (design-claude/vitrine/barra-carrinho.html):
          cor de destaque, qtd + total à esquerda, "Ver carrinho" à direita. O
          total é preview de UX — o servidor recalcula no checkout (seguranca §10). */}
      {totalItens > 0 && (
        <nav
          aria-label="Resumo do carrinho"
          className="fixed inset-x-0 bottom-0 z-40 mx-auto flex min-h-16 max-w-3xl items-center justify-between gap-3 bg-[var(--cor-destaque)] px-[18px] py-3 text-[#f5f0e6] shadow-[0_-4px_16px_rgba(0,0,0,0.2)] md:max-w-5xl lg:max-w-6xl xl:max-w-7xl"
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
        lojaSlug={lojaSlug}
        lojaId={lojaId}
      />

      {/* Trava 7 (design §5.2): renderizado INCONDICIONALMENTE — quem devolve
          `null` quando não há promoção ou o lojista desligou o modal é o
          próprio componente. Duas guardas seria uma a mais para alguém
          remover. `localStorage` só é tocado dentro do `ModalPromocoes`, por
          `decisaoModalPromocoes`, sempre em try/catch (RN-18). */}
      <ModalPromocoes
        promocoes={promocoes}
        lojaSlug={lojaSlug}
        toggleDaLoja={modalPromocoes}
        diaDeHojeNaLoja={diaDeHojeNaLoja}
        storage={typeof window === "undefined" ? null : window.localStorage}
        destinoFoco={destinoFoco}
      />
    </>
  );
}
