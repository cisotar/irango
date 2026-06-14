# [061] Observabilidade com Sentry

**crítica:** NÃO
**Mundo:** infra
**Depende de:** — (só o scaffold; implementar cedo para capturar erros durante todo o MVP)
**Spec:** specs/spec_irango_mvp.md (observabilidade — não-funcional)

## Objetivo
Instrumentar o app com Sentry (erros + performance) no client, server e edge, para capturar exceções em produção e durante o desenvolvimento do MVP. Instrumentação pura — não altera schema, RLS nem regra de negócio.

## Escopo
- [ ] Instalar `@sentry/nextjs` e rodar o wizard / configurar manualmente para Next.js 16 (App Router): `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` (ou `instrumentation.ts` conforme padrão atual do SDK)
- [ ] DSN via env (`NEXT_PUBLIC_SENTRY_DSN` no client; `SENTRY_AUTH_TOKEN` só em build/CI, nunca commitado) — adicionar ao `.env.example`
- [ ] Error boundary global: `src/app/global-error.tsx` reportando ao Sentry
- [ ] Capturar exceções nas Server Actions críticas e no webhook Hotmart (057) via `Sentry.captureException` em catch — sem engolir o erro
- [ ] `tracesSampleRate` conservador (ex. 0.1) para não estourar cota
- [ ] Source maps no build de produção (upload autenticado via `SENTRY_AUTH_TOKEN`), desabilitado/silencioso se token ausente (dev local não quebra)

## Fora de escopo
Alertas/dashboards customizados no Sentry; logging estruturado de negócio (decisão futura).

## Reuso esperado
- `@sentry/nextjs` (lib madura) — não escrever captura de erro à mão
- Padrão oficial: docs.sentry.io/platforms/javascript/guides/nextjs

## Segurança
- **Scrubbing de PII obrigatório:** email, telefone, WhatsApp, chave Pix e dados de comprador Hotmart NÃO podem ir para o Sentry. Configurar `beforeSend` removendo/mascarando campos sensíveis; `sendDefaultPii: false`.
- `SUPABASE_SERVICE_ROLE_KEY` e demais secrets nunca em breadcrumb/contexto.
- DSN público é aceitável no client; auth token de upload de source map é secreto.

## Critério de aceite
- [ ] Erro forçado (server e client) aparece no projeto Sentry
- [ ] `beforeSend` comprovadamente remove PII (teste unitário do scrubber com payload contendo email/telefone/Pix → saída sem esses campos)
- [ ] Build de produção funciona com e sem `SENTRY_AUTH_TOKEN` presente
- [ ] App continua funcional; nenhum secret exposto no bundle client
