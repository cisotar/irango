# [057] Webhook Hotmart — Route Handler `POST /api/webhooks/hotmart`

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** 001, 016, 017, 056
**Spec:** specs/spec_irango_mvp.md (Adendo — Webhook Hotmart; RN-A1, RN-A2, RN-A3, RN-A4, RN-A5)

## Objetivo
Route Handler server-only que recebe os eventos de assinatura da Hotmart, valida autenticidade, garante idempotência, mapeia comprador→loja por email e aplica o novo `assinatura_status` (via util 056) — única fonte que escreve o estado autoritativo de assinatura, rodando com `service_role`.

## Escopo
- [ ] Criar `src/app/api/webhooks/hotmart/route.ts` (`POST`, server-only, sem auth de sessão)
- [ ] **Validar autenticidade** — conferir o segredo da Hotmart (campo/header `hottok` e/ou HMAC — **confirmar mecanismo na doc oficial Hotmart**). Segredo só em env server-side (`HOTMART_WEBHOOK_TOKEN`/`HOTMART_HOTTOK`), **nunca** `NEXT_PUBLIC_`. Segredo inválido → `401`, nada gravado (RN-A2)
- [ ] **Idempotência** — extrair `evento_id` do payload (**confirmar caminho na doc Hotmart**); INSERT em `webhook_eventos_hotmart` (UNIQUE `evento_id`). Se violar UNIQUE (já processado) → `200` no-op, nenhum efeito reaplicado (RN-A3)
- [ ] Gravar `payload` bruto, `evento_tipo`, `email_comprador` normalizado (lowercase/trim) em `webhook_eventos_hotmart` para auditoria
- [ ] **Mapear comprador → loja** — ler email do comprador (**confirmar caminho, ex.: `data.buyer.email`**), normalizar, localizar `lojas` cujo dono tem esse email em `auth.users`. Se não houver loja → gravar evento com `loja_id = null` (ramo de reconciliação, issue 059) e `200`
- [ ] **Aplicar efeito** via `traduzirEvento` (056): UPDATE de `assinatura_status`, `hotmart_subscriber_code`, `hotmart_plano`, `assinatura_inicio`, `assinatura_fim_periodo`, `assinatura_atualizada_em` na loja mapeada — só com `service_role`
- [ ] Nada de efeito antes de (1) validar token e (2) checar idempotência (RN-A1)
- [ ] Respostas: `200` em sucesso e em duplicado; `401` em segredo inválido; `2xx` em evento desconhecido/ignorado (registrar, não falhar — evita re-tentativa em loop); `5xx` só em erro interno real (Hotmart re-tenta; idempotência cobre)
- [ ] Usar client Supabase `service_role` server-only (criar helper `src/lib/supabase/service-role.ts` se não existir) — key só em env, nunca exposta

## Fora de escopo
Tradução evento→status e regra de carência (já em 056). Vínculo de compra pré-cadastro no momento do signup (059). Página de status (060). Gate na vitrine/checkout (058).

## Reuso esperado
- `traduzirEvento` (056) — não recriar o mapa de eventos
- `webhook_eventos_hotmart` + colunas `assinatura_*` (001), tipos gerados (017)
- helper `service_role` Supabase

## Segurança
- 🔴 Replay malicioso poderia reativar assinatura suspensa → coberto por UNIQUE `evento_id` + checagem antes do efeito (Adendo Segurança)
- Segredo Hotmart só server-side; PII (email comprador) só em tabela com RLS fechada (só `service_role`)
- Nunca confiar no corpo sem validar token + idempotência (RN-A1)
- Considerar rate limit por IP/origem (seguranca.md §12)

## Critério de aceite
- [ ] (crítica) Teste vermelho: request sem token válido → `401`, nada gravado; mesmo `evento_id` enviado 2x → segundo é `200` no-op sem reaplicar; compra aprovada → loja vira `ativa` com datas; recorrência → estende `assinatura_fim_periodo`; cancelamento → `cancelada`; reembolso → `suspensa`; comprador sem loja → evento gravado com `loja_id null` e `200`; evento desconhecido → `2xx` sem mudar estado
