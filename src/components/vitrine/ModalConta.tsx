"use client";

import type { RefObject } from "react";
import Link from "next/link";
import { X } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { nextDaLoja } from "@/components/vitrine/checkout/linkEntrar";
import { marcarDispensa, sessionStorageSeguro } from "@/components/vitrine/decisaoModalConta";
import { OpcoesConta } from "@/components/vitrine/OpcoesConta";

/**
 * "Já é nosso cliente?" — aberto pelo "Finalizar pedido" do carrinho quando o
 * cliente não está logado. Entrar/criar conta voltam para `/loja/<slug>/pedido`;
 * "Prosseguir sem login" segue como convidado e não reabre até a aba fechar.
 * Fechar (✕, ESC, toque fora) deixa o cliente na loja com o carrinho.
 */
export function ModalConta({
  aberto,
  onOpenChange,
  lojaSlug,
  destinoFoco,
}: {
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
  lojaSlug: string;
  /** O "Finalizar pedido" que abriu o aviso some com a gaveta: o foco volta ao `<main>`. */
  destinoFoco: RefObject<HTMLElement | null>;
}) {
  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      {/* ✕ próprio de 44×44: o do shadcn é `icon-sm` (ver ModalPromocoes). */}
      <DialogContent className="max-w-[420px]" showCloseButton={false} finalFocus={destinoFoco}>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Fechar"
          className="absolute top-2 right-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-texto-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[var(--cor-primaria)]"
        >
          <X aria-hidden className="size-5" />
        </button>

        <DialogHeader className="pr-14">
          <DialogTitle className="text-lg font-semibold">Já é nosso cliente?</DialogTitle>
        </DialogHeader>

        <OpcoesConta next={nextDaLoja(lojaSlug, "/pedido")} />

        <Link
          href={`/loja/${lojaSlug}/pedido`}
          onClick={() => marcarDispensa(sessionStorageSeguro(), lojaSlug)}
          className="mx-auto inline-flex min-h-[44px] items-center px-2 text-sm font-semibold text-texto underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Prosseguir sem login
        </Link>
      </DialogContent>
    </Dialog>
  );
}
