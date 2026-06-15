import * as Sentry from "@sentry/nextjs";
import { sentryBeforeSend } from "@/lib/utils/sentryBeforeSend";

// DSN ausente (dev local sem conta Sentry) → `init` vira no-op silencioso.
// O app NUNCA quebra por falta da var (issue 061).
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  // Nunca capturar IP/cookies/headers automaticamente. Scrubbing reforçado no beforeSend.
  sendDefaultPii: false,
  beforeSend: sentryBeforeSend,
});
