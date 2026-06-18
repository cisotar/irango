"use client";

// Indicador de progresso do checkout (issues 076/007). Dois comportamentos via
// prop `modo` (breakpoint decidido no CheckoutWizard, sem useMediaQuery aqui):
// - "stepper" (mobile, default): 3 passos sequenciais, etapa atual destacada.
// - "ancoras" (desktop): barra "Ir para:" com atalhos às seções empilhadas.

import { Check } from "lucide-react";

const PASSOS = ["Itens", "Entrega", "Pagamento"] as const;

const ANCORAS = ["#secao-itens", "#secao-entrega", "#secao-pagamento"] as const;

export type IndicadorEtapasProps = {
  /** Etapa ativa: 1, 2 ou 3. Usada apenas no modo "stepper". */
  etapaAtual: 1 | 2 | 3;
  /** "stepper" (mobile, default) ou "ancoras" (desktop). */
  modo?: "stepper" | "ancoras";
};

export function IndicadorEtapas({
  etapaAtual,
  modo = "stepper",
}: IndicadorEtapasProps) {
  if (modo === "ancoras") {
    return (
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-2.5">
        <span className="mr-1 text-[0.72rem] font-bold uppercase tracking-[0.5px] text-texto-muted">
          Ir para:
        </span>
        {PASSOS.map((rotulo, indice) => (
          <a
            key={rotulo}
            href={ANCORAS[indice]}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-cinza-medio px-3 py-1.5 text-[0.8rem] font-bold text-texto-muted transition-colors hover:border-[var(--cor-destaque)] hover:text-[var(--cor-destaque)]"
          >
            <span className="flex size-5 items-center justify-center rounded-full bg-[var(--cor-destaque)] text-[0.68rem] font-black text-white">
              {indice + 1}
            </span>
            {rotulo}
          </a>
        ))}
      </div>
    );
  }

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
