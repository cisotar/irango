// Carrega a init do Sentry no client. O SDK do Next.js (>= v9) usa este arquivo
// como ponto de entrada do browser. A config real fica em sentry.client.config.ts
// (filename pedido pela issue 061), reexportada aqui.
import "../sentry.client.config";

export { captureRouterTransitionStart as onRouterTransitionStart } from "@sentry/nextjs";
