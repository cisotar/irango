"use client";

// Indicador de progresso do wizard (issue 076). Stepper simples e acessível:
// 3 passos, etapa atual destacada com a cor de destaque da loja.

import { Check } from "lucide-react";

const PASSOS = ["Itens", "Entrega", "Pagamento"] as const;

export type IndicadorEtapasProps = {
  /** Etapa ativa: 1, 2 ou 3. */
  etapaAtual: 1 | 2 | 3;
};

export function IndicadorEtapas({ etapaAtual }: IndicadorEtapasProps) {
  return (
    <ol
      className="flex items-center justify-center px-1"
      aria-label={`Etapa ${etapaAtual} de ${PASSOS.length}`}
    >
      {PASSOS.map((rotulo, indice) => {
        const numero = indice + 1;
        const concluida = numero < etapaAtual;
        const ativa = numero === etapaAtual;
        return (
          <li
            key={rotulo}
            className="flex shrink-0 items-center gap-1.5"
            aria-current={ativa ? "step" : undefined}
          >
            <span
              className={[
                "flex size-[26px] shrink-0 items-center justify-center rounded-full border-2 text-xs font-black transition-colors",
                concluida || ativa
                  ? "border-[var(--cor-destaque)] bg-[var(--cor-destaque)] text-white"
                  : "border-cinza-medio bg-cinza-medio text-texto-muted",
              ].join(" ")}
            >
              {concluida ? <Check className="size-4" aria-hidden /> : numero}
            </span>
            <span
              className={[
                "text-xs font-bold",
                ativa
                  ? "inline text-[var(--cor-destaque)]"
                  : "hidden text-texto-muted md:inline",
              ].join(" ")}
            >
              {rotulo}
            </span>
            {numero < PASSOS.length && (
              <span
                className={[
                  "mx-1.5 h-0.5 w-4 min-w-[16px] max-w-[48px] flex-1 rounded transition-colors sm:w-12",
                  concluida ? "bg-[var(--cor-destaque)]" : "bg-cinza-medio",
                ].join(" ")}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
