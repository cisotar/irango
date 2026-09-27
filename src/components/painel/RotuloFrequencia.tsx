import type { ReactElement } from "react";
import { AlertTriangle, Ban, Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ROTULO_NUNCA_DISPONIVEL } from "@/lib/utils/descreverVigencia";

/**
 * [323 → P6] Chip de frequência de exibição do painel (produto e categoria).
 * O texto vem PRONTO do servidor (`rotuloFrequencia`); aqui só se escolhe o
 * ícone. `null`/`undefined` = permanente ⇒ nada é renderizado.
 *
 * Extraído de `ProdutosClient` e `GerenciarCategorias`, onde a mesma marcação
 * se repetia três vezes.
 */
export function ChipFrequencia({
  rotulo,
}: {
  rotulo: string | null | undefined;
}): ReactElement | null {
  if (rotulo == null) return null;
  return (
    <Badge variant="outline" className="font-normal whitespace-normal">
      {rotulo === ROTULO_NUNCA_DISPONIVEL ? (
        <Ban aria-hidden className="size-3" />
      ) : (
        <Clock aria-hidden className="size-3" />
      )}
      {rotulo}
    </Badge>
  );
}

/**
 * Aviso RN-1/RN-7/RN-8 (texto do servidor). Âmbar e SEM `role="alert"`: é
 * estático desde o primeiro paint, e o leitor anunciaria a lista inteira ao
 * carregar (mockup §1.1). `null`/`undefined` ⇒ nada.
 */
export function AvisoFrequencia({
  aviso,
  className,
}: {
  aviso: string | null | undefined;
  /** Espaçamento extra do contexto (ex.: `mt-1` na linha do produto). */
  className?: string;
}): ReactElement | null {
  if (aviso == null) return null;
  return (
    <p
      className={`${className ? `${className} ` : ""}flex items-start gap-1.5 text-xs text-amber-700`}
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      {aviso}
    </p>
  );
}
