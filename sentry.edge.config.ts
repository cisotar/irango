import * as Sentry from "@sentry/nextjs";
import { sentryBeforeSend } from "@/lib/utils/sentryBeforeSend";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  beforeSend: sentryBeforeSend,
});
