import type { Tema } from "@/app/(painel)/painel/(bloqueavel)/configuracoes/tema/TemaClient";

/**
 * Tema padrão da vitrine e montagem defensiva do jsonb `tema` da loja.
 *
 * Extraído da lógica `lerCor`/`TEMA_PADRAO`/`reHex` antes duplicada na page
 * consolidada admin (`configuracoes/page.tsx`) e na page de tema do lojista
 * (`(painel)/.../tema/page.tsx`). Helper único → sem duplicação (issue 152).
 *
 * O import de `Tema` é type-only (erased em runtime): não puxa o `'use client'`
 * do `TemaClient` para dentro deste util server-safe.
 */
export const TEMA_PADRAO: Tema = {
  primaria: "#e11d48",
  fundo: "#ffffff",
  destaque: "#f59e0b",
};

const reHex = /^#[0-9a-fA-F]{6}$/;

/** Lê uma cor do jsonb `tema` com fallback seguro se ausente/inválida. */
function lerCor(tema: Record<string, unknown>, chave: keyof Tema): string {
  const v = tema[chave];
  return typeof v === "string" && reHex.test(v) ? v : TEMA_PADRAO[chave];
}

/**
 * Monta o `Tema` inicial a partir do jsonb `tema` da loja (ou de qualquer valor),
 * sanitizando cada cor (mesma regex `#RRGGBB` de antes) e caindo em `TEMA_PADRAO`
 * quando ausente/inválida. Sem injeção de CSS: só cores hex válidas atravessam.
 */
export function montarTemaInicial(tema: unknown): Tema {
  const t = (tema ?? {}) as Record<string, unknown>;
  return {
    primaria: lerCor(t, "primaria"),
    fundo: lerCor(t, "fundo"),
    destaque: lerCor(t, "destaque"),
  };
}
