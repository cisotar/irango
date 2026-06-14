"use client";

// Resumo financeiro do wizard (issues 076/077/078).
//
// CRÍTICO (seguranca.md §10): todos os valores aqui são PREVIEW de UX. O servidor
// (criarPedido — 071) recalcula subtotal, desconto, frete e total a partir do
// banco. O cliente NUNCA envia valor monetário. O aviso "estimado" deixa isso
// explícito para o usuário.

import { Info } from "lucide-react";

import { Separator } from "@/components/ui/separator";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";

export type ResumoValoresProps = {
  subtotal: number;
  desconto: number;
  /** frete preview; em retirada é sempre 0. */
  frete: number;
  total: number;
  /** false na Etapa 1 (frete ainda não escolhido) — oculta a linha de frete. */
  mostrarFrete?: boolean;
};

export function ResumoValores({
  subtotal,
  desconto,
  frete,
  total,
  mostrarFrete = true,
}: ResumoValoresProps) {
  return (
    <div className="space-y-1 text-sm">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Subtotal</span>
        <span className="text-foreground">{formatarMoeda(subtotal)}</span>
      </div>

      {desconto > 0 && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Desconto (cupom)</span>
          <span className="font-medium text-green-700">
            − {formatarMoeda(desconto)}
          </span>
        </div>
      )}

      {mostrarFrete && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Entrega</span>
          <span className="text-foreground">{formatarMoeda(frete)}</span>
        </div>
      )}

      <Separator className="my-2" />

      <div className="flex justify-between font-semibold">
        <span className="text-foreground">Total estimado</span>
        <span className="text-primary">{formatarMoeda(total)}</span>
      </div>

      <div
        role="note"
        className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800"
      >
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          <strong>Valores estimados.</strong> O total final é calculado e
          confirmado pela loja no servidor.
        </span>
      </div>
    </div>
  );
}
