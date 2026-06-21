import type { ReactElement } from "react";
import { AlertTriangle } from "lucide-react";

import { ehStatusBloqueado } from "./rotulosAssinatura";

/**
 * Aviso de estado bloqueado (issue 081). Renderiza SOMENTE quando a assinatura
 * está `inadimplente`/`suspensa` (spec §Assinatura) — caso contrário retorna
 * `null`. Reusa o padrão visual de aviso destrutivo já estabelecido no painel
 * (`border-destructive/30 bg-destructive/5`), sem inventar componente `Alert`.
 *
 * O CTA de regularização (atualizar forma de pagamento) vive no
 * `GerenciarAssinaturaClient`; aqui é só o alerta + texto, com `role="alert"`
 * para leitores de tela. Não depende só de cor: ícone + texto explícito.
 */
export function AvisoEstadoBloqueado({
  status,
}: {
  status: string;
}): ReactElement | null {
  if (!ehStatusBloqueado(status)) return null;

  const inadimplente = status === "inadimplente";

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-foreground"
    >
      <AlertTriangle
        className="mt-0.5 size-5 shrink-0 text-destructive"
        aria-hidden="true"
      />
      <div className="space-y-1">
        <p className="font-medium text-destructive">
          {inadimplente
            ? "Pagamento pendente"
            : "Assinatura suspensa"}
        </p>
        <p className="text-muted-foreground">
          {inadimplente
            ? "Identificamos um pagamento em aberto. Regularize a forma de pagamento abaixo para manter sua loja no ar."
            : "Sua loja está fora do ar por falta de pagamento. Atualize a forma de pagamento abaixo para reativá-la."}
        </p>
      </div>
    </div>
  );
}
