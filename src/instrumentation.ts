import * as Sentry from "@sentry/nextjs";

// Carrega a config certa por runtime. Em ambos os casos o DSN ausente torna o
// init um no-op — nada quebra em dev local (issue 061).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// Captura erros de render/data-fetching no servidor (App Router).
export const onRequestError = Sentry.captureRequestError;
