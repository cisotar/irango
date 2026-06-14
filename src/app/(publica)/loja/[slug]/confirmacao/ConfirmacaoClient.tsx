"use client";

// Issue 037 — client boundary MÍNIMO da confirmação: só limpa o carrinho do
// sessionStorage ao montar. O pedido já foi criado no servidor (036), então o
// estado do carrinho não tem mais uso e deve sumir para não reenviar no F5.
// Chaves espelham useCarrinho.ts ("irango:carrinho") e Carrinho.tsx
// ("irango:checkout"). Não renderiza nada.

import { useEffect } from "react";

export function ConfirmacaoClient() {
  useEffect(() => {
    try {
      window.sessionStorage.removeItem("irango:carrinho");
      window.sessionStorage.removeItem("irango:checkout");
    } catch {
      // sessionStorage indisponível (modo restrito) — limpeza é best-effort.
    }
  }, []);

  return null;
}
