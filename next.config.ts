import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

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
  // Teto bruto de body de Server Actions (rede/defesa-em-profundidade).
  // Alinha com o limite de 2MB da Server Action de upload (issue 075);
  // a validação autoritativa (tamanho + magic bytes) continua na action/bucket.
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
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

export default withSentryConfig(nextConfig, {
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
