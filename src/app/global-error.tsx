"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Error boundary global do App Router. Captura erros não tratados em qualquer
// rota e reporta ao Sentry (DSN ausente → no-op). Substitui o <html>/<body>,
// então precisa renderizá-los.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body>
        <main style={{ display: "flex", minHeight: "100vh", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", padding: "2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Algo deu errado</h1>
          <p style={{ color: "#666", maxWidth: "32rem" }}>
            Tivemos um problema inesperado. Já fomos notificados — tente novamente em instantes.
          </p>
        </main>
      </body>
    </html>
  );
}
