"use client";

// Indicador de progresso do wizard (issue 076). Stepper simples e acessível:
// 3 passos, etapa atual destacada com a cor de destaque da loja.

import { Check } from "lucide-react";

const PASSOS = ["Carrinho", "Entrega", "Pagamento"] as const;

export type IndicadorEtapasProps = {
  /** Etapa ativa: 1, 2 ou 3. */
  etapaAtual: 1 | 2 | 3;
};

export function IndicadorEtapas({ etapaAtual }: IndicadorEtapasProps) {
  return (
    <ol
      className="flex items-center justify-between gap-1 px-1"
      aria-label={`Etapa ${etapaAtual} de ${PASSOS.length}`}
    >
      {PASSOS.map((rotulo, indice) => {
        const numero = indice + 1;
        const concluida = numero < etapaAtual;
        const ativa = numero === etapaAtual;
        return (
          <li
            key={rotulo}
            className="flex flex-1 flex-col items-center gap-1.5"
            aria-current={ativa ? "step" : undefined}
          >
            <div className="flex w-full items-center">
              <span
                className={[
                  "flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold transition-colors",
                  concluida
                    ? "border-primary bg-primary text-primary-foreground"
                    : ativa
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-muted text-muted-foreground",
                ].join(" ")}
              >
                {concluida ? <Check className="size-4" aria-hidden /> : numero}
              </span>
              {numero < PASSOS.length && (
                <span
                  className={[
                    "mx-1 h-0.5 flex-1 rounded transition-colors",
                    concluida ? "bg-primary" : "bg-border",
                  ].join(" ")}
                  aria-hidden
                />
              )}
            </div>
            <span
              className={[
                "text-center text-xs font-medium",
                ativa ? "text-foreground" : "text-muted-foreground",
              ].join(" ")}
            >
              {rotulo}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
