"use client";

import { useEffect } from "react";

// Registra o Service Worker no client (issue 006). O Serwist em App Router não
// auto-injeta o registro — é preciso este componente. A URL same-origin
// /serwist/sw.js é servida pelo route handler do @serwist/turbopack (RN-8).
//
// Em desenvolvimento o SW fica desligado (route handler retorna nada útil e o
// hot reload do Turbopack não deve competir com um SW grudado) — feature-detect
// + guarda de ambiente. Falha de registro nunca derruba a página: só loga.
export function RegistrarSW() {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    navigator.serviceWorker.register("/serwist/sw.js").catch((erro) => {
      // Sem PII; apenas diagnóstico no console do cliente.
      console.error("Falha ao registrar o Service Worker:", erro);
    });
  }, []);

  return null;
}
