import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { withSerwist } from "@serwist/turbopack";

// §11 references/seguranca.md — defesa contra clickjacking, MIME sniffing, injeção.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

// CSP em report-only: Next usa inline scripts; endurecer depois antes de bloquear.
const cspReportOnly = [
  "default-src 'self'",
  "img-src 'self' https: data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self' https://gdlegxatwylhkjcrusyk.supabase.co wss://gdlegxatwylhkjcrusyk.supabase.co",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "gdlegxatwylhkjcrusyk.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  // Teto bruto de body de Server Actions (rede/defesa-em-profundidade).
  // Alinha com o limite de 2MB da Server Action de upload (issue 075);
  // a validação autoritativa (tamanho + magic bytes) continua na action/bucket.
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
    // Router Cache do cliente (achado acelerar 2026-09-16, F1). O default de
    // rota dinâmica é 0s: sem isto o payload prefetchado NÃO é reusado e voltar
    // do checkout para a vitrine refaz o render no servidor toda vez.
    //
    // Cache de CLIENTE, não ISR — não vale como fonte de verdade. Produto
    // esgotado pode aparecer disponível por até 30s no card, mas quem decide é
    // `criarPedido`, que revalida disponibilidade e recalcula valor no servidor
    // (mandato 1 / seguranca.md §10). A janela custa um card stale, nunca um
    // pedido errado.
    //
    // A config é GLOBAL e alcança o painel. Aceitável: o painel não tem
    // realtime nem polling, então já depende de navegação/reload para ver
    // pedido novo — e toda mutação do lojista chama `revalidatePath`, que
    // invalida este cache. Se a espera por pedido novo apertar, baixar aqui.
    staleTimes: {
      dynamic: 30,
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...securityHeaders,
          { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
        ],
      },
    ];
  },
};

// Upload de source maps só quando há SENTRY_AUTH_TOKEN (build de produção/CI).
// Sem token (dev local) o plugin fica silencioso e o build não quebra (issue 061).
const temAuthToken = !!process.env.SENTRY_AUTH_TOKEN;

// withSerwist DENTRO de withSentryConfig (RN-7 / Decisão D2): o Sentry precisa
// enxergar a config final (com a integração do SW de @serwist/turbopack já
// aplicada) para instrumentar e subir source maps do bundle completo. O SW é
// compilado por esbuild e servido via route handler — não toca em webpack, e
// portanto não quebra o `next build` (Turbopack) do Next 16.
export default withSentryConfig(withSerwist(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Sem token: não tenta subir source maps (evita falha de build em dev).
  sourcemaps: { disable: !temAuthToken },
  silent: !temAuthToken,
  // Não falhar o build por erro de telemetria/upload do Sentry.
  telemetry: false,
  widenClientFileUpload: true,
});
