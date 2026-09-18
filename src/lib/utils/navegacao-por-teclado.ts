/**
 * Deslocamento de índice por tecla, padrão WAI-ARIA APG de `tablist`/`radiogroup`
 * (roving tabindex). Puro: sem React, sem DOM — roda em `environment: node` sem
 * importar nada.
 *
 * Genérica de propósito: mesmo contrato serve para qualquer grupo de widgets
 * (abas, radiogroup, toolbar) navegado por ←/→/Home/End com volta ao extremo
 * oposto, sem reescrever a aritmética em cada lugar.
 */

export type TeclaNavegacaoHorizontal = "ArrowLeft" | "ArrowRight" | "Home" | "End";

export function ehTeclaDeNavegacaoHorizontal(
  tecla: string,
): tecla is TeclaNavegacaoHorizontal {
  return (
    tecla === "ArrowLeft" ||
    tecla === "ArrowRight" ||
    tecla === "Home" ||
    tecla === "End"
  );
}

/**
 * `total` itens, índice atual `de`. ArrowRight/ArrowLeft dão a VOLTA ao extremo
 * oposto (do último para o primeiro e vice-versa) — é o comportamento do padrão
 * APG, diferente do deslocamento de `moverPorDeslocamento`, que vira no-op na
 * borda.
 *
 * `total <= 0` devolve `de` inalterado (nada para onde ir).
 */
export function proximoIndicePorTecla(
  tecla: TeclaNavegacaoHorizontal,
  de: number,
  total: number,
): number {
  if (total <= 0) return de;
  switch (tecla) {
    case "ArrowRight":
      return (de + 1) % total;
    case "ArrowLeft":
      return (de - 1 + total) % total;
    case "Home":
      return 0;
    case "End":
      return total - 1;
  }
}
