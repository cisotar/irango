# [077] Webhook de billing `POST /api/webhooks/billing/[provider]` + queries service_role

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** [071], [072], [073], [074], [075], [076]
**Spec:** specs/cobranca-assinatura-propria.md

## Objetivo
Implementar o único caminho que muda billing do provider próprio: rota que valida assinatura, é idempotente, resolve a loja, mapeia evento→status, aplica via `service_role` (passando pelo trigger) e registra o pagamento. Espelha o webhook Hotmart.

## Escopo
- [ ] Criar `src/lib/supabase/queries/webhookBilling.ts`: `registrarEventoBilling(provider, evento_id, tipo, payload)` com `INSERT ... ON CONFLICT (provider, evento_id) DO NOTHING` (idempotência), `buscarLojaPorSubscriptionId(provider, subscriptionId)` (SECURITY DEFINER / service_role, sem expor `lojas` ao anon — padrão `loja_por_email_dono`), `aplicarStatusBilling(...)` (UPDATE `lojas.assinatura_*` + `billing_provider`/`plano_id`) e `registrarPagamento(...)` (INSERT em `pagamentos_assinatura`).
- [ ] Criar `src/app/api/webhooks/billing/[provider]/route.ts` (`runtime = "nodejs"`, `dynamic = "force-dynamic"`), na ordem do spec (Webhook → passos 1–5):
  1. validar assinatura (adapter 076) → `401` sem efeito se inválida;
  2. idempotência via INSERT ON CONFLICT → evento repetido = `200` no-op;
  3. lookup da loja por `provider_subscription_id` (ou email do dono);
  4. mapear evento→status (`mapearEventoBilling` + `eventoBillingParaStatus`); desconhecido → log + `200`;
  5. aplicar via `service_role`; loja `cancelada` NÃO reativa por renovação espúria (RN-10); só toca loja do próprio provider (RN-9).
- [ ] Eventos órfãos / reconciliação: seguir o padrão Hotmart se aplicável (registrar para reprocesso).

## Fora de escopo
Telas. Server Actions do painel/admin (078). Migration das tabelas (já feitas).

## Reuso esperado
- `src/app/api/webhooks/hotmart/route.ts` (estrutura), `src/lib/supabase/queries/webhookHotmart.ts` (queries), `src/lib/assinatura/reconciliar.ts`.
- `createServiceClient()` (`src/lib/supabase/service.ts`).
- Adapter (076) e `eventoBillingParaStatus` (075).
- Trigger `lojas_protege_billing` (074) — o UPDATE passa por ele como `service_role`.

## Segurança
- TODO o invariante de billing converge aqui: autenticidade (HMAC/token, `401` antes de efeito), idempotência (`UNIQUE (provider, evento_id)`), aplicação só via `service_role`, isolamento por provider (RN-9), não-reativação de `cancelada` (RN-10), valor da fatura vindo do webhook e não do cliente (RN-1, §10) → crítica máxima.

## Critério de aceite
- [ ] Teste RED: assinatura inválida → `401`, zero linha tocada; evento duplicado → segundo POST é no-op (status não muda 2x, pagamento não duplica); evento de pagamento aprovado → loja vira `ativa` e renova `fim_periodo` + linha em `pagamentos_assinatura`; reembolso/chargeback → `suspensa`; loja `cancelada` não reativa por renovação espúria; webhook do provider X não altera loja `billing_provider='hotmart'`.
- [ ] `next build` passa.

---

## Plano Técnico

### Diagnóstico

**Causa raiz:** o webhook de billing próprio é o **único** caminho legítimo que escreve `assinatura_*`/`billing_provider`/`plano_id` em `lojas` e insere em `pagamentos_assinatura`. Para implementá-lo de forma fechada, três pré-condições do contrato de dados ainda **não estão satisfeitas** e precisam ser tratadas DENTRO desta issue, não contornadas:

1. **Lookup por `provider_subscription_id` não existe.** RN-9 exige resolver a loja pela assinatura do provider, mas a única função SECURITY DEFINER de lookup é `public.loja_por_email_dono` (resolve por email). Não há `public.loja_por_subscription_id(provider, sub_id)`. Sem ela, ou se expõe `lojas` ao caller (proibido), ou se cai só no email (RN-9 fica sem o vetor principal). **Migration nova obrigatória.**
2. **O adapter não expõe o `provider_subscription_id` do payload.** A interface `BillingProvider` (`src/lib/billing/tipos.ts`) tem `validarWebhook`, `extrairEventoId`, `mapearEvento`, `extrairDados` — **nenhum** método produz o subscription id. O tipo `DadosEventoBilling.providerSubscriptionId` é declarado mas nunca preenchido (dead type). A rota não consegue fazer o lookup do passo 3 sem isso. **Extensão do contrato `BillingProvider` obrigatória.**
3. **`database.types.ts` está desatualizado.** As migrations 070–074 (planos, `webhook_eventos_billing`, `pagamentos_assinatura`, colunas de billing em `lojas`) já existem, mas os tipos gerados NÃO incluem `webhook_eventos_billing`, `pagamentos_assinatura`, `planos` nem as colunas `billing_provider`/`provider_subscription_id`/`plano_id` em `lojas`. As queries novas não compilam até regenerar. **`supabase gen types` obrigatório antes do GREEN.**

**Por que é complexo:** afeta 4 camadas — banco (nova função SQL SECURITY DEFINER + grant), contrato compartilhado (`BillingProvider` consumido por 076/078 além desta), tipos gerados (cross-cutting em todo o app), e a rota com invariante de segurança máxima (autenticidade, idempotência, isolamento por provider, não-reativação, valor autoritativo). É o ponto de convergência de RN-1, RN-2, RN-8, RN-9, RN-10 e `seguranca.md` §9/§10. Um erro aqui é vazamento de billing entre lojas ou burla de cobrança.

### Mapa de Impacto

```
POST /api/webhooks/billing/[provider]/route.ts   (CRIAR)
  │
  ├── rawBody = await request.text()              [extrai ANTES do parse — HMAC futuro]
  │     └── payload = JSON.parse(rawBody)         [400 se inválido]
  │
  ├─1─ getBillingProvider(provider)               [lib/billing/providers/index.ts — JÁ EXISTE]
  │     └── .validarWebhook(headers, rawBody)     [adapter 076 — AUTORITATIVO; 401 sem efeito]
  │
  ├─2─ provider.extrairEventoId(payload)          [400 se ausente]
  │     └── registrarEventoBilling(svc, ...)      [webhookBilling.ts CRIAR]
  │           └── INSERT webhook_eventos_billing ON CONFLICT(provider,evento_id) DO NOTHING
  │                 └── 23505 → 200 no-op         [IDEMPOTÊNCIA — replay nunca reaplica]
  │
  ├─3─ provider.extrairSubscriptionId(payload)    [NOVO método do contrato BillingProvider]
  │     └── buscarLojaPorSubscriptionId(svc, provider, subId)   [webhookBilling.ts CRIAR]
  │           └── RPC loja_por_subscription_id(p_provider, p_sub_id)  [MIGRATION CRIAR — SECURITY DEFINER]
  │                 └── lê lojas WHERE provider_subscription_id=$ AND billing_provider=$  [RN-9 no SQL]
  │     └── fallback: buscarLojaPorEmailDono(svc, email)  [lojas.ts — JÁ EXISTE; só se sub_id não casar]
  │           └── nesse fallback, checar loja.billing_provider===provider em TS  [RN-9 reforço]
  │
  ├─4─ provider.mapearEvento(payload) → EventoBilling|null   [adapter 076 — JÁ EXISTE]
  │     └── eventoBillingParaStatus(provider, tipo)          [lib/utils/assinatura.ts — JÁ EXISTE]
  │           └── {ignorar:true} → 200 no-op (evento desconhecido)
  │
  └─5─ APLICAR (service_role → passa pelo trigger lojas_protege_billing_trg [074]):
        ├── guard RN-10: statusAtual==='cancelada' && !resultado.encerra → 200 sem tocar lojas
        ├── aplicarStatusBilling(svc, lojaId, {status, renova, billing_provider, ...})  [webhookBilling.ts CRIAR]
        │     └── UPDATE lojas.assinatura_* + billing_provider + provider_subscription_id (+plano_id)
        └── registrarPagamento(svc, {loja_id, provider, valor, status, ...})  [webhookBilling.ts CRIAR]
              └── INSERT pagamentos_assinatura ON CONFLICT(provider,provider_payment_id) DO NOTHING
                    └── valor = provider.extrairDados(payload).valor  [AUTORITATIVO §10 — nunca do cliente]
```

**Camada de garantia de cada invariante (cliente ↔ servidor):**

```
Autenticidade do webhook:
  └── provider.validarWebhook(headers, rawBody) — [Route Handler — AUTORITATIVO, 401 antes de efeito]
Idempotência de evento:
  └── UNIQUE(provider, evento_id) + ON CONFLICT DO NOTHING — [banco — AUTORITATIVO]
Idempotência de cobrança:
  └── UNIQUE(provider, provider_payment_id) + ON CONFLICT DO NOTHING — [banco — AUTORITATIVO]
Isolamento por provider (RN-9):
  ├── RPC loja_por_subscription_id filtra billing_provider=$provider — [banco/SQL — AUTORITATIVO]
  └── checagem TS loja.billing_provider===provider no fallback por email — [defesa-em-profundidade]
Não-reativação de cancelada (RN-10):
  └── guard de statusAtual antes do UPDATE — [Route Handler — AUTORITATIVO]
Valor da fatura (RN-1, §10):
  └── valor = provider.extrairDados(payload).valor (payload do provider) — [server — AUTORITATIVO; cliente nunca envia]
Escrita de assinatura_*/billing_*:
  └── service_role via createServiceClient() passando pelo trigger lojas_protege_billing_trg — [banco — AUTORITATIVO]
```

> Não há nenhum arquivo de cliente nesta issue — feature 100% server-only (Route Handler + queries service_role + migration). Assimetria cliente/servidor inexistente: nada é renderizado nem submetido pelo browser.

### Análise do Codebase

| Arquivo | Papel atual | O que muda |
|---|---|---|
| `src/app/api/webhooks/hotmart/route.ts` | Webhook Hotmart — padrão a espelhar | Não toca. Referência estrutural. |
| `src/lib/supabase/queries/webhookHotmart.ts` | Queries do webhook Hotmart | Não toca. Referência estrutural. |
| `src/lib/billing/providers/asaas.ts` | Adapter Asaas (puro) | **Adicionar** `extrairSubscriptionIdAsaas(payload)` (lê `payment.subscription`) e ligar no objeto `asaasProvider`. |
| `src/lib/billing/tipos.ts` | Contrato `BillingProvider` | **Adicionar** método `extrairSubscriptionId(payload): string \| null` à interface. |
| `src/lib/billing/providers/index.ts` | `getBillingProvider(provider)` (fail-closed) | Não toca. Reusado direto. |
| `src/lib/utils/assinatura.ts` | `eventoBillingParaStatus(provider, tipo)` | Não toca. Reusado direto. Ver Decisão D-3 sobre `renova`/`encerra`. |
| `src/lib/supabase/queries/lojas.ts` | `buscarLojaPorEmailDono` (RPC), `LojaCompleta` | Não toca. `buscarLojaPorEmailDono` reusado como fallback. |
| `src/lib/supabase/service.ts` | `createServiceClient()` (BYPASSRLS) | Não toca. Reusado. |
| `src/lib/database.types.ts` | Tipos gerados | **Regenerar** (faltam 3 tabelas + 3 colunas de `lojas` + a nova função). |
| `supabase/migrations/` | Migrations 070–074 já aplicadas | **Adicionar** migration da função `loja_por_subscription_id`. |
| `src/lib/supabase/queries/webhookBilling.ts` | — | **CRIAR.** |
| `src/app/api/webhooks/billing/[provider]/route.ts` | — | **CRIAR.** |

### Decisões de Design

**D-1 — Lookup por subscription_id: função SQL nova vs. reusar `loja_por_email_dono`.**
- (a) Reusar só email: viola RN-9 (o vínculo principal do provider próprio é o `provider_subscription_id`, não o email; nem todo evento traz email). Rejeitada.
- (b) Query `.from("lojas").eq("provider_subscription_id", …)` com service_role: funciona (BYPASSRLS), mas espalha o filtro de RN-9 em TS e não segue o padrão `loja_por_email_dono` (SECURITY DEFINER, sem expor `lojas`). Inconsistente com `seguranca.md` §9.
- **(c) Escolhida — migration `public.loja_por_subscription_id(p_provider text, p_sub_id text) → uuid`**, SECURITY DEFINER, `SET search_path=public`, `REVOKE ALL FROM public,anon,authenticated` + `GRANT EXECUTE TO service_role`. O filtro `billing_provider=p_provider AND provider_subscription_id=p_sub_id` fica no SQL — RN-9 vira invariante de banco, espelhando exatamente `loja_por_email_dono`. Retorna a linha completa da loja (precisa de `assinatura_status`/`assinatura_inicio` para os guards RN-10 e "primeira ativação"); usar `RETURNS SETOF lojas` + `.maybeSingle()` no caller, como faz `buscarLojaPorEmailDono`.

**D-2 — Como obter `provider_subscription_id` do payload: novo método na interface vs. extrator local na rota.**
- (a) Extrator ad-hoc na rota lendo `payload.payment.subscription`: acopla a rota ao formato Asaas — quebra a agnosticidade que 076 construiu (a rota não pode conhecer o provider). Rejeitada.
- **(b) Escolhida — `extrairSubscriptionId(payload): string | null` no contrato `BillingProvider`**, implementado em cada adapter. Para Asaas: `payment.subscription` (string ou null). Fecha o `DadosEventoBilling.providerSubscriptionId` hoje órfão. Custo: 1 método na interface + 1 função no adapter Asaas; trade-off correto (mantém a rota agnóstica).

**D-3 — Detectar "encerramento" (RN-10) a partir de `ResultadoEvento`.**
`eventoBillingParaStatus` retorna `{status, renova}` ou `{ignorar:true}`. RN-10 diz: loja `cancelada` não reativa por renovação espúria. O guard é: se `statusAtual==='cancelada'` e o evento NÃO é de cancelamento/suspensão (ou seja, é uma renovação/cobrança que tentaria reativar), retorna 200 sem aplicar.
- (a) Adicionar campo `encerra` ao `ResultadoEvento`: muda assinatura de `assinatura.ts` (issue 075, fora de escopo). Rejeitada.
- **(b) Escolhida — derivar na rota:** o evento "reativa" quando `resultado.status` é um status de acesso (`'ativa'`/`'cortesia'`) — só nesses casos o guard RN-10 bloqueia se `statusAtual==='cancelada'`. Eventos que levam a `cancelada`/`suspensa`/`inadimplente` sempre aplicam (não há reativação a impedir). Predicado local explícito: `const reativaria = resultado.status === 'ativa' || resultado.status === 'cortesia';` `if (statusAtual === 'cancelada' && reativaria) return ok();`. Espelha a intenção do guard Hotmart (que verifica status atual antes de aplicar).

**D-4 — `rawBody` antes do `JSON.parse`.**
Asaas valida por token de header (ignora corpo), mas a interface fixa `validarWebhook(headers, rawBody: string)` para providers HMAC futuros (Stripe assina o corpo cru — re-serializar o JSON após parse muda bytes e invalida a assinatura). **A rota lê `const rawBody = await request.text()` UMA vez, valida com `rawBody`, e só então `JSON.parse(rawBody)`.** Corpo inválido (parse falha) → 400. Espelha o §0/§1 do Hotmart mas com ordem invertida: rawBody → validar → parse (Hotmart parseia antes porque o hottok está no header e o payload é necessário no fallback; aqui a assinatura HMAC futura exige rawBody intacto, então parse vem depois).

**D-5 — `provider` da URL: validar contra `getBillingProvider` (fail-closed).**
O segmento `[provider]` é input não confiável. `getBillingProvider(provider)` já lança para nome desconhecido (fail-closed). Envolver em try/catch: provider inválido → 404 (não 500 — recurso inexistente), sem efeito. O `provider` validado é a string gravada em `webhook_eventos_billing.provider` e usada no filtro RN-9 — fonte única, nunca derivada do payload.

### Cenários

- **Caminho feliz (cobrança aprovada):** assinatura válida → INSERT evento OK → `extrairSubscriptionId` casa loja por `provider_subscription_id`+provider → `mapearEvento`→`cobranca_aprovada`→`{ativa, renova:true}` → UPDATE `lojas` (`assinatura_status='ativa'`, `assinatura_fim_periodo` estendido via `calcularFimPeriodoBilling`, `assinatura_inicio` só se nulo, `assinatura_atualizada_em=now()`) → INSERT `pagamentos_assinatura` (status `pago`, valor do payload) → 200.
- **Assinatura inválida:** `validarWebhook`→false → 401, **zero** efeito (nenhum INSERT de evento, nenhuma query). Verificado por contagem de linhas no teste RED.
- **Evento duplicado (replay):** INSERT bate em `UNIQUE(provider,evento_id)` → 23505 → 200 no-op. Status não muda 2x; `pagamentos_assinatura` não duplica (segunda barreira: `UNIQUE(provider,provider_payment_id)`).
- **Evento desconhecido / ciclo intermediário:** `mapearEvento`→null ou `eventoBillingParaStatus`→`{ignorar:true}` → log + 200 (não rejeita — evita retry infinito do provider). Evento fica registrado em `webhook_eventos_billing` para auditoria.
- **Loja não encontrada:** sub_id não casa nenhuma loja e sem email/email sem loja → 200 (evento já registrado; reconciliação futura, como no Hotmart). Nenhum UPDATE.
- **RN-9 — provider X vs. loja Hotmart:** loja tem `billing_provider='hotmart'`; chega webhook `/billing/asaas`. A RPC filtra `billing_provider='asaas'` → não retorna a loja Hotmart → 200 sem efeito. **A loja Hotmart nunca é tocada.** Reforço no fallback por email: `if (loja.billing_provider !== provider) return ok();`.
- **RN-10 — cancelada + renovação espúria:** `statusAtual==='cancelada'`, evento `recorrencia_aprovada` (`reativaria=true`) → guard → 200 sem UPDATE. Loja permanece `cancelada`. (Evento `assinatura_cancelada` chegando numa loja já cancelada: `reativaria=false`, aplica idempotente `cancelada` — sem dano.)
- **Reembolso/chargeback:** `{suspensa, renova:false}` → UPDATE `assinatura_status='suspensa'` (corte imediato, sem mexer em `fim_periodo`). INSERT pagamento status `estornado`.
- **Race de duplo submit (entrega concorrente):** o INSERT do evento é a trava atômica — a primeira transação grava, a segunda colide no UNIQUE → 23505 → no-op. Sem janela de dupla aplicação.
- **Corpo inválido (não-JSON):** 400 (não re-tentável, não 500).
- **Tratamento de erro:** qualquer exceção inesperada → `console.error("[webhook-billing]", e)` (server, scrubbed §21) + corpo genérico `{erro:"erro interno"}` 500. O provider re-tenta; idempotência cobre o reprocesso. Nunca vaza detalhe do Postgres (§14).

### Contratos de Dados

**Tabelas (já criadas — migrations 071/072; esta issue só LÊ/ESCREVE):**
- `webhook_eventos_billing(id, provider, evento_id, tipo, payload jsonb, processado, criado_em)`, `UNIQUE(provider,evento_id)`, RLS deny-all (só service_role).
- `pagamentos_assinatura(id, loja_id, provider, provider_payment_id, valor numeric(10,2), status CHECK('pendente','pago','falhou','estornado'), metodo, fatura_url, competencia, criado_em)`, `UNIQUE(provider,provider_payment_id)`, RLS SELECT por dono / escrita só service_role.
- `lojas` — colunas `billing_provider`, `provider_subscription_id`, `plano_id` (migration 073) protegidas pelo trigger v2 (074).

**Nova função SQL (CRIAR nesta issue):**
```sql
-- migration: <timestamp>_loja_por_subscription_id.sql
CREATE FUNCTION public.loja_por_subscription_id(p_provider text, p_sub_id text)
  RETURNS SETOF public.lojas
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT l.* FROM public.lojas l
  WHERE l.billing_provider = p_provider          -- RN-9 no banco
    AND l.provider_subscription_id = p_sub_id
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.loja_por_subscription_id(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.loja_por_subscription_id(text, text) TO service_role;
```
Espelha `loja_por_email_dono` (SECURITY DEFINER, search_path fixo, grant só service_role, sem expor `lojas` a anon). Bloco de rollback comentado no fim. Documentar em `seguranca.md` §9 (delegar ao agente `documentar`).

**Tipos gerados:** após a migration, rodar `npx supabase gen types typescript` (memória: `npx`, nunca `pnpm`; nunca redirecionar comando direto para `.ts` — gerar para arquivo temp e mover) regravando `src/lib/database.types.ts`. Sem isso, `webhook_eventos_billing`, `pagamentos_assinatura`, `loja_por_subscription_id` e as colunas novas de `lojas` não tipam.

### Recálculo no Servidor (dinheiro)

| Campo de `pagamentos_assinatura` | Origem | Autoridade |
|---|---|---|
| `valor` | `provider.extrairDados(payload).valor` (`payment.value` do provider) | **provider — §10/RN-1; cliente nunca envia** |
| `provider_payment_id` | `extrairDados(...).provider_payment_id` | provider (chave de idempotência de cobrança) |
| `metodo` | `extrairDados(...).metodo` (mapeado `PIX/BOLETO/CREDIT_CARD`) | provider |
| `fatura_url` | `extrairDados(...).fatura_url` | provider |
| `competencia` | `extrairDados(...).competencia` | provider |
| `status` | derivado do `EventoBilling` (aprovada→`pago`, falhou→`falhou`, reembolso/chargeback→`estornado`) | server (mapa) |
| `loja_id` | resolvido pelo lookup (sub_id) | server |
| `provider` | segmento `[provider]` validado da URL | server |

O cliente (lojista) não participa deste fluxo: webhook é máquina-a-máquina. Não há payload de cliente; o "input não confiável" é o próprio provider, contido por `validarWebhook` (autenticidade) antes de qualquer leitura de valor.

### Arquivos a Criar / Modificar / NÃO tocar

**CRIAR:**
- `supabase/migrations/<ts>_loja_por_subscription_id.sql` — função SECURITY DEFINER (D-1) + grants + rollback comentado.
- `src/lib/supabase/queries/webhookBilling.ts`:
  - `registrarEventoBilling(client, {provider, evento_id, tipo, payload})` — INSERT; propaga 23505 (throw) para a rota detectar replay (espelha `registrarEventoWebhook`).
  - `buscarLojaPorSubscriptionId(client, provider, subId): Promise<LojaCompleta|null>` — `.rpc("loja_por_subscription_id", {p_provider, p_sub_id}).maybeSingle()`.
  - `aplicarStatusBilling(client, lojaId, dados)` — UPDATE `lojas` (`assinatura_status`, `assinatura_atualizada_em=now()` sempre; `assinatura_fim_periodo`/`assinatura_inicio` condicionais; `billing_provider`, `provider_subscription_id`, e `plano_id` quando aplicável). Espelha `aplicarStatusAssinatura`.
  - `registrarPagamento(client, {loja_id, provider, provider_payment_id, valor, status, metodo, fatura_url, competencia})` — INSERT `pagamentos_assinatura` com `onConflict("provider,provider_payment_id")` ignoreDuplicates (no-op em replay).
  - Cabeçalho de doc igual ao de `webhookHotmart.ts` (client injetado, propaga error §14, exige service_role).
- `src/app/api/webhooks/billing/[provider]/route.ts` — `runtime="nodejs"`, `dynamic="force-dynamic"`; `POST(request, { params }: { params: Promise<{ provider: string }> })` (padrão Next 16 — params é Promise, `await params`); fluxo D-1..D-5 + cenários acima.

**MODIFICAR:**
- `src/lib/billing/tipos.ts` — adicionar `extrairSubscriptionId(payload: unknown): string | null` à interface `BillingProvider` (D-2).
- `src/lib/billing/providers/asaas.ts` — adicionar `export function extrairSubscriptionIdAsaas(payload)` (lê `payment.subscription`, defensivo) e referenciar em `asaasProvider`.
- `src/lib/database.types.ts` — regenerar (não editar à mão).

**NÃO tocar:**
- `src/app/api/webhooks/hotmart/route.ts` e `webhookHotmart.ts` — referência; mexer arrisca regressão no billing Hotmart em produção.
- `src/lib/utils/assinatura.ts` — `eventoBillingParaStatus`/`ResultadoEvento` ficam como estão (D-3 deriva na rota; não muda assinatura da issue 075).
- Migrations 070–074 — já aplicadas em cloud; alterar quebra o histórico remoto (memória: migration repair antes de push).

### Dependências Externas

Nenhum pacote novo. Reusa `@supabase/supabase-js`, `@supabase/ssr`, `node:crypto` (já em uso via adapter). Docs de referência:
- Asaas webhook payload (campo `payment.subscription`): https://docs.asaas.com/docs/webhook-for-payments
- Next.js 16 Route Handler dynamic params (`params: Promise<…>`): https://nextjs.org/docs/app/api-reference/file-conventions/route
- Supabase `gen types`: https://supabase.com/docs/reference/cli/supabase-gen-types

### Ordem de Implementação

1. **Migration `loja_por_subscription_id`** + aplicar local (`npx supabase`). Dependência: as queries e a RPC do caller não existem sem ela.
2. **Regenerar `database.types.ts`** (`npx supabase gen types typescript` → arquivo temp → mover). Dependência: sem os tipos das tabelas/função, nada do TS abaixo compila.
3. **Estender contrato:** `BillingProvider.extrairSubscriptionId` (tipos.ts) + `extrairSubscriptionIdAsaas` (asaas.ts). Dependência: a rota chama `provider.extrairSubscriptionId`.
4. **Fase RED (`tdd`) — issue crítica, teste vermelho PRIMEIRO** (cobre o Critério de Aceite): 401 sem efeito; replay no-op; cobrança aprovada → `ativa`+`fim_periodo`+linha de pagamento; reembolso/chargeback → `suspensa`; RN-10 (cancelada não reativa); RN-9 (provider X não toca loja Hotmart); idempotência de pagamento. Confirmar falha real com output e PARAR.
5. **GREEN — queries** `webhookBilling.ts` (mínimo para os testes passarem).
6. **GREEN — rota** `[provider]/route.ts` (fluxo completo).
7. **`next build`** (memória `use-server`/Route Handler: const exportada quebra só no build; rodar antes de fechar).
8. Acionar `documentar` para `seguranca.md` §9 (nova função de lookup + nota RN-9) e `schema.md` (nova função).

### Checklist de Validação Pós-Implementação
- [ ] `npx supabase gen types` rodado; `webhook_eventos_billing`, `pagamentos_assinatura`, `planos`, `loja_por_subscription_id` e colunas novas de `lojas` presentes em `database.types.ts`.
- [ ] `pnpm build` / `next build` sem warnings novos (Route Handler exporta só `POST`/`runtime`/`dynamic`).
- [ ] RLS/role testado: `webhook_eventos_billing` e `pagamentos_assinatura` permanecem deny-all para anon/authenticated; só `service_role` escreve.
- [ ] RN-9 testado: webhook `asaas` com loja `billing_provider='hotmart'` → zero efeito.
- [ ] RN-10 testado: loja `cancelada` + `recorrencia_aprovada` → permanece `cancelada`.
- [ ] Valor da fatura vem de `payment.value` do payload; payload sem `value` → `valor=0` (não inventado), nunca de campo de cliente.
- [ ] 401 (assinatura inválida) deixa `webhook_eventos_billing` e `lojas` intactas (contagem de linhas).
- [ ] Idempotência: 2º POST idêntico não duplica linha em `webhook_eventos_billing` nem `pagamentos_assinatura`.
- [ ] Nenhum secret no client; `route.ts` e `webhookBilling.ts` server-only; nenhum dado pessoal logado (§21).
