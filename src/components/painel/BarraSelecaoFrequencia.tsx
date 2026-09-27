"use client";

import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";

/** A régua de `design-system.md` §5: valor LITERAL, a mesma da `BarraSelecaoLote`. */
const ALVO = "min-h-[44px] min-w-[44px]";

export type BarraSelecaoFrequenciaProps = {
  /** Só a CONTAGEM LOCAL da intenção. */
  selecionados: readonly string[];
  /** Abre o `DialogoFrequencia` variante seleção. */
  onDefinirFrequencia: () => void;
  onLimpar: () => void;
  onCancelar: () => void;
};

/**
 * [323/C8] A barra do modo de seleção para "aplicar a mesma frequência a
 * vários produtos" (mockup §4). Casca fina e SEPARADA: copia as classes e a
 * régua da `BarraSelecaoLote` (que fica como código morto de cardápio, S5) em
 * vez de generalizá-la.
 *
 * Mobile: `fixed` no rodapé, ≥64px. A partir de `sm`: `sticky top-0`.
 *
 * 🔴 `selecionados` é INTENÇÃO, não permissão: a escrita é escopada no
 * servidor (RLS + `p_loja_id` + contagem de linhas na RPC, RN-5).
 */
export function BarraSelecaoFrequencia({
  selecionados,
  onDefinirFrequencia,
  onLimpar,
  onCancelar,
}: BarraSelecaoFrequenciaProps): ReactElement {
  const vazia = selecionados.length === 0;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 min-h-[64px] border-t bg-background p-3 shadow-lg sm:sticky sm:top-0 sm:bottom-auto sm:z-30 sm:mb-4 sm:rounded-xl sm:border sm:shadow-sm">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2">
        <p aria-live="polite" className="text-sm font-medium">
          {vazia
            ? "Nenhum produto selecionado"
            : `${selecionados.length} ${selecionados.length === 1 ? "produto selecionado" : "produtos selecionados"}`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" className={ALVO} disabled={vazia} onClick={onDefinirFrequencia}>
            Definir frequência…
          </Button>
          <Button
            type="button"
            variant="ghost"
            className={ALVO}
            disabled={vazia}
            onClick={onLimpar}
          >
            Limpar
          </Button>
          <Button type="button" variant="ghost" className={ALVO} onClick={onCancelar}>
            Cancelar
          </Button>
        </div>
      </div>
    </div>
  );
}
