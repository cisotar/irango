"use client";

// Hook de media query SSR-safe. Retorna `false` no servidor e no primeiro paint
// (baseline mobile-first), depois sincroniza com o matchMedia real no client.
// Usado pelo checkout (006) p/ escolher entre o wizard sequencial (mobile) e o
// layout 2 colunas (desktop) renderizando UMA árvore por vez — sem duplicar
// estado nem montar FormEndereco/efeito de frete duas vezes.

import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [corresponde, setCorresponde] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const atualizar = () => setCorresponde(mql.matches);
    atualizar();
    mql.addEventListener("change", atualizar);
    return () => mql.removeEventListener("change", atualizar);
  }, [query]);

  return corresponde;
}
