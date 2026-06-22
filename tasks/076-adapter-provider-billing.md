# [076] Adapter do provider de billing (Asaas) — interface agnóstica

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** [075]
**Spec:** specs/cobranca-assinatura-propria.md

## Objetivo
Criar a camada que isola o provider (DA-1: Asaas) do resto do sistema: validação de assinatura do webhook, extração de `evento_id`/tipo/dados, tradução de nome externo cru → "evento lógico" do `eventoBillingParaStatus`, e as chamadas de API (criar assinatura, trocar plano, atualizar meio de pagamento, cancelar). Toda a especificidade do provider mora aqui — schema, gates e telas permanecem agnósticos.

## Escopo
- [ ] Criar `src/lib/billing/providers/asaas.ts` (e um contrato `src/lib/billing/providers/tipos.ts` com a interface do provider).
- [ ] `validarAssinaturaWebhook(headers, rawBody, secret): boolean` via `crypto.timingSafeEqual` (token/assinatura Asaas).
- [ ] `extrairEventoId(payload): string | null`, `extrairTipoExterno(payload): string | null`, `mapearEventoBilling(tipoExterno): string | null` (nome externo → evento lógico do spec).
- [ ] `extrairDadosPagamento(payload)` → `{ provider_payment_id, valor, status, metodo, fatura_url, competencia, provider_subscription_id }`.
- [ ] Funções de API server-only: `criarAssinatura({plano, lojaId, ...})`, `trocarPlano(...)`, `urlAtualizarPagamento(...)`, `cancelarAssinatura(...)` — usando `BILLING_API_KEY` (env server-only).
- [ ] Selecionar adapter por `BILLING_PROVIDER` em um `index.ts` (`getBillingProvider()`), permitindo trocar provider sem tocar consumidores.

## Fora de escopo
A rota do webhook (077) e as Server Actions (078) — elas CONSOMEM este adapter. O mapa evento lógico→status (já é a 075).

## Reuso esperado
- Espelhar `src/lib/utils/hotmart.ts` (`validarHottok`, `extrairEventoId`, `mapearEventoHotmart`, `calcularFimPeriodo`) como modelo.
- `eventoBillingParaStatus` (075) para o passo lógico→status — não duplicar o mapa aqui.

## Segurança
- `validarAssinaturaWebhook` é a autenticidade do webhook (`401` se inválido, antes de qualquer efeito) — invariante. `BILLING_API_KEY`/`BILLING_WEBHOOK_SECRET` são secrets server-only, sem `NEXT_PUBLIC_` (§7). Dados de cartão nunca passam aqui (RN-11) → crítica.

## Critério de aceite
- [ ] Teste RED: `validarAssinaturaWebhook` aceita assinatura correta e rejeita adulterada (timing-safe); `mapearEventoBilling` traduz nomes externos conhecidos e devolve `null` p/ desconhecido; extração de dados monta o objeto correto a partir de um payload de exemplo.
- [ ] Nenhuma env com `NEXT_PUBLIC_`. `next build` passa (adapter é server-only).

---

## Plano Técnico

### Diagnóstico

**Causa raiz:** não há uma causa de bug aqui — é uma issue de arquitetura. A "dor" que ela ataca é o acoplamento que existe hoje: a Hotmart é a única autoridade de billing e sua especificidade (nomes de evento crus, formato de payload, validação de `hottok`) está espalhada entre `src/lib/utils/hotmart.ts` e `src/app/api/webhooks/hotmart/route.ts`. Trocar/adicionar provider hoje significaria duplicar o handler inteiro. A invariante a estabelecer: **toda especificidade de um provider de billing mora atrás de UMA interface estável (`BillingProvider`); o webhook (077), as Server Actions (078) e o schema permanecem 100% agnósticos.** O spec já decidiu isso ("Critério da abstração", linha 33): DA-1 afeta *só* o adapter e o mapa de eventos.

**Por que é complexo:**
- Define um **contrato compartilhado** (`tipos.ts`) consumido por 077 (webhook) e 078 (Server Actions) — errar a interface agora propaga retrabalho para duas issues críticas downstream.
- Cruza a fronteira **função pura vs. I/O**: tradução de evento e cálculo de `fim_periodo` são puras e testáveis sem mock; validação de token e chamadas de API são server-only com efeito externo e segredo. Misturá-las quebra a testabilidade e arrisca vazar a chave no bundle.
- Toca **segurança de autenticidade de billing** (`seguranca.md` §9): `validarAssinaturaWebhook` é o gate `401` antes de qualquer efeito. Implementação ingênua (`===`) reabre timing attack.
- Tem **assimetria deliberada cliente↔servidor**: o adapter é integralmente server-only. Qualquer import acidental de Client Component deve quebrar o build (`import "server-only"`).

### Mapa de Impacto

```
Tradução de evento externo (autoridade de billing):
  Asaas → POST /api/webhooks/billing/asaas (issue 077)
    └── chama → src/lib/billing/index.ts  getBillingProvider(BILLING_PROVIDER)
          └── retorna → asaasProvider (src/lib/billing/providers/asaas.ts)  [server-only — AUTORITATIVO]
                ├── validarAssinaturaWebhook(headers, rawBody) [GATE 401 — timingSafeEqual, contornável=NÃO]
                ├── extrairEventoId(payload) ────────────────→ idempotência (077 INSERT ON CONFLICT)
                ├── extrairTipoExterno(payload) ──┐
                ├── mapearEventoBilling(tipoExt) ─┴→ EventoBilling [pura]
                │        └── 077 passa a → eventoBillingParaStatus(provider, tipo)  [src/lib/utils/assinatura.ts — 075, FONTE ÚNICA status]
                ├── extrairDadosPagamento(payload) → {provider_payment_id, valor, status, metodo, fatura_url, competencia, provider_subscription_id}
                │        └── 077 grava em → tabela pagamentos_assinatura (valor AUTORITATIVO do provider, nunca do cliente)
                └── calcularFimPeriodo(payloadFim, agora) [pura] → lojas.assinatura_fim_periodo (via service_role/trigger)

Chamadas de API (intenções do lojista, issue 078):
  Server Action iniciarAssinatura/trocarPlano/... (078)
    └── chama → getBillingProvider().criarAssinatura/trocarPlano/urlAtualizarPagamento/cancelarAssinatura
          └── asaasProvider → fetch api.asaas.com  [Authorization: BILLING_API_KEY — server-only, §9]
                preço SEMPRE lido de planos.preco no banco pela ACTION (RN-1) — o adapter recebe valor já resolvido, nunca o calcula do cliente.
```

**Camada onde cada invariante é garantida (cliente↔servidor):**

```
Autenticidade do webhook:
  └── asaas.validarAssinaturaWebhook — [SERVER-ONLY — AUTORITATIVO, gate 401, timingSafeEqual]
        (não há contraparte no cliente: webhook não tem UI)

Valor da fatura (dinheiro):
  ├── TabelaFaturas.tsx (painel) — [cliente — só exibição, lê do banco]
  └── asaas.extrairDadosPagamento → 077 grava — [SERVER — AUTORITATIVO, valor vem do provider, ignora cliente]

Evento → status da assinatura:
  └── mapearEventoBilling (asaas) → eventoBillingParaStatus (075) — [SERVER-ONLY — AUTORITATIVO]
        (único caminho que muda assinatura_status; passa pelo trigger via service_role no 077)

Segredo do provider (BILLING_API_KEY / BILLING_WEBHOOK_SECRET):
  └── só lido dentro de src/lib/billing/** com import "server-only" — [nunca NEXT_PUBLIC_, §7]
```

Nenhuma regra de valor/permissão desta issue tem caminho no cliente — o adapter inteiro é server-only. Assimetria justificada: webhook e API de provider não têm UI.

### Análise do Codebase

**Reuso primeiro (inventário):**

| Item existente | Onde | Reuso nesta issue |
|---|---|---|
| `EventoBilling` (union lógico provider-agnóstico) | `src/lib/utils/assinatura.ts:16` | **Tipo de retorno** de `mapearEventoBilling`. NÃO redefinir. |
| `eventoBillingParaStatus(provider, tipo)` | `src/lib/utils/assinatura.ts:74` | **NÃO chamado pelo adapter** — é o passo lógico→status do webhook (077). O adapter só produz o `EventoBilling`; o 077 encadeia. Fronteira do spec linha 132. |
| Padrão `validarHottok` (timingSafeEqual + guarda de comprimento) | `src/lib/utils/hotmart.ts:20` | **Espelhado** em `validarAssinaturaWebhook` (token estático no header, mesmo algoritmo). |
| Padrão `mapearEventoHotmart` (mapa `Record` + `?? null`) | `src/lib/utils/hotmart.ts:74` | **Espelhado** em `mapearEventoBilling`. |
| Padrão `calcularFimPeriodo` (data do provider ou fallback +30d, `agora` injetado) | `src/lib/utils/hotmart.ts:84` | **Espelhado/quase idêntico** em `calcularFimPeriodo` do adapter. |
| Padrão `extrairEventoId` + helper `asObjeto` | `src/lib/utils/hotmart.ts:32,42` | **Espelhado** — navegação defensiva do payload. |
| `import "server-only"` | `src/lib/supabase/service.ts:1`, `rateLimit.ts:15` | **Aplicado** no topo de `asaas.ts` e `index.ts`. |
| `crypto.timingSafeEqual` (Node) | nativo | Comparação do token. Exige runtime `nodejs` no handler (já é, 077). |

**Por que NÃO reusar `hotmart.ts` diretamente** (criar arquivo novo, não estender): `hotmart.ts` traduz para `EventoHotmart` (union diferente, com `inadimplencia`/`compra_aprovada`), espera payload Hotmart (`data.purchase.*`, `data.subscription.*`) e valida `hottok`. O Asaas usa `EventoBilling`, payload `{event, payment:{...}}` e token no header `asaas-access-token`. Zero sobreposição de dados — só sobreposição de *padrão*. Compartilhar código forçaria genéricos prematuros; o padrão é replicado, não abstraído (a abstração comum é a interface `BillingProvider`, não a implementação).

**Por que NÃO usar SDK oficial do Asaas:** não há SDK Node oficial mantido pelo Asaas; a API é REST simples (Bearer-style header `access_token`). Adicionar wrapper de terceiro = superfície de ataque sem ganho (`seguranca.md` §16). `fetch` nativo basta. As funções de API ficam como stubs nesta issue (escopo real de chamada é exercido em 078) — assinatura fixada aqui.

### Decisões de Design

**D1 — Localização do arquivo: `providers/` vs `adapters/`.**
- (a) `src/lib/billing/providers/asaas.ts` — **escolhida**. O spec usa literalmente `lib/billing/providers/<x>.ts` (linhas 33, 297) e a issue 077 referencia esse caminho. Consistência com o vocabulário já fixado.
- (b) `src/lib/billing/adapters/asaas.ts` — sinônimo válido, mas diverge do spec/077. Rejeitada por gerar atrito de nomenclatura entre issues.

**D2 — Forma da interface: objeto `BillingProvider` vs. funções soltas exportadas.**
- (a) **Objeto que implementa `interface BillingProvider`** (`export const asaasProvider: BillingProvider = {...}`) selecionado por `getBillingProvider()` — **escolhida**. O escopo da issue exige `getBillingProvider()` selecionando por `BILLING_PROVIDER` (linha 17 da issue); isso só fecha se o provider é um *valor* (objeto) trocável em runtime. Webhook 077 faz `const p = getBillingProvider(); p.validarAssinaturaWebhook(...)` sem saber qual é.
- (b) Funções soltas (`export function validarAssinaturaWebhook`) como em `hotmart.ts` — funcionam para Hotmart porque o handler é hardcoded ao provider. Aqui o handler é `[provider]` dinâmico; funções soltas não permitem seleção em runtime sem um `switch` no handler (vaza especificidade para o consumidor — o que esta issue existe para evitar). Rejeitada.
- **Consequência:** funções PURAS (tradução, cálculo, extração) ficam como funções nomeadas no módulo E são referenciadas pelo objeto — assim o teste RED importa a função pura direto (`import { mapearEventoBilling } from "./asaas"`) sem instanciar o objeto, preservando testabilidade do estilo `hotmart.test.ts`.

**D3 — Validação de assinatura: token estático (header) vs. HMAC de corpo.**
- Pesquisa na doc oficial Asaas: a autenticação do webhook Asaas é por **token estático** enviado no header `asaas-access-token`, comparado contra o segredo configurado — **não** é HMAC do corpo (diferente de Stripe `Stripe-Signature`). Fonte: docs.asaas.com/docs/sobre-os-webhooks e /docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook.
- (a) **`validarAssinaturaWebhook(headers, rawBody, secret)` comparando `headers.get("asaas-access-token")` contra `secret` via `timingSafeEqual`** — **escolhida**. `rawBody` entra na assinatura por **contrato estável** (provider HMAC futuro — ex. Stripe — precisará do corpo cru; manter o parâmetro evita quebrar a interface depois). No Asaas o corpo é ignorado.
- (b) Interface só com `(headers, secret)` — mais enxuta hoje, mas força mudança de assinatura quando entrar um provider HMAC, propagando edição ao 077. Rejeitada: a interface `BillingProvider` deve absorver os dois modelos sem mudar.
- Comportamento idêntico a `validarHottok`: ausente → `false`; comprimento diferente → `false` sem throw; sem segredo → `false` (nunca autoriza às cegas).

**D4 — `extrairEventoId`: usar o `id` do envelope.**
- A doc Asaas confirma top-level `"id": "evt_..."` único por evento ("se repete caso se trate do mesmo evento") — é o id ideal de idempotência. Fallback determinístico `${payment.id}:${event}` quando ausente (webhooks legados de conta antiga podem não trazer `id`). Espelha `extrairEventoId` do Hotmart exatamente.

**D5 — Nomes externos cobertos no mapa (e os deliberadamente ignorados).** Ver tabela abaixo. Eventos de ciclo intermediário (`PAYMENT_CREATED`, `PAYMENT_AWAITING_RISK_ANALYSIS`, `PAYMENT_BANK_SLIP_VIEWED`, `PAYMENT_CHECKOUT_VIEWED`, `PAYMENT_UPDATED`, etc.) → `null` (o 077 loga p/ auditoria e responde 2xx, não muda estado). Mapear só o que altera `assinatura_status`.

### Mapa de eventos externos Asaas → `EventoBilling`

> Fonte: [docs.asaas.com/docs/payment-events](https://docs.asaas.com/docs/payment-events). `EventoBilling` é o union de `assinatura.ts:16`. O destino de status final (coluna informativa) é o de `eventoBillingParaStatus` (075), aplicado no 077 — não pelo adapter.

| Nome externo Asaas | `EventoBilling` | (status final via 075) | Racional |
|---|---|---|---|
| `PAYMENT_CONFIRMED` | `cobranca_aprovada` | `ativa` / renova | Pagamento efetuado (saldo ainda não liberado) — já garante acesso; é o sinal mais cedo de sucesso. |
| `PAYMENT_RECEIVED` | `recorrencia_aprovada` | `ativa` / renova | Cobrança recebida (recorrência liquidada). Idempotência do 077 absorve o par CONFIRMED→RECEIVED da mesma fatura. |
| `PAYMENT_OVERDUE` | `pagamento_falhou` | `inadimplente` | Cobrança vencida → entra em dunning (carência até `fim_periodo`, RN-5). |
| `PAYMENT_DELETED` | `assinatura_cancelada` | `cancelada` | Cobrança removida (assinatura encerrada no provider). |
| `PAYMENT_REFUNDED` | `reembolso` | `suspensa` (corte) | Estorno → corte imediato (RN-8), espelha mapa Hotmart. |
| `PAYMENT_PARTIALLY_REFUNDED` | `reembolso` | `suspensa` (corte) | Reembolso parcial trata como reembolso — conservador (corte). |
| `PAYMENT_CHARGEBACK_REQUESTED` | `chargeback` | `suspensa` (corte) | Chargeback recebido → corte imediato (RN-8). |
| qualquer outro (`PAYMENT_CREATED`, `PAYMENT_UPDATED`, `PAYMENT_AWAITING_*`, `PAYMENT_*_VIEWED`, `PAYMENT_RESTORED`, `PAYMENT_CHARGEBACK_DISPUTE`, `PAYMENT_AWAITING_CHARGEBACK_REVERSAL`, `PAYMENT_DUNNING_*`, `PAYMENT_BANK_SLIP_CANCELLED`, `PAYMENT_RECEIVED_IN_CASH_UNDONE`, `PAYMENT_REFUND_*`, `PAYMENT_ANTICIPATED`, `PAYMENT_SPLIT_*`, `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED`) | `null` | — (ignorar, 2xx) | Não altera status de assinatura. // TODO GREEN: reavaliar `PAYMENT_RESTORED`/`PAYMENT_AWAITING_CHARGEBACK_REVERSAL` se surgir caso de reativação real. |

> **Nota de cobertura (`PAYMENT_DELETED` vs cancelamento de assinatura):** o webhook de *cobrança* (payment) do Asaas não emite um evento "assinatura cancelada" — o cancelamento da `subscription` se reflete como ausência de novas cobranças e/ou `PAYMENT_DELETED` da cobrança pendente. O cancelamento solicitado pelo lojista (078) chama a API de cancelar `subscription`; o efeito no status local chega via `PAYMENT_DELETED`/parada de renovação (RN-7 — não otimista). // TODO GREEN: confirmar se a conta usará também webhook de *subscription events*; se sim, adicionar `SUBSCRIPTION_*` ao mapa numa issue de follow-up.

### Cenários

**Caminho feliz (webhook):** Asaas envia `PAYMENT_RECEIVED` com `asaas-access-token` correto → `validarAssinaturaWebhook` true → `extrairEventoId` retorna `evt_x` → `mapearEventoBilling` → `recorrencia_aprovada` → 077 aplica `ativa`+renova e grava pagamento `pago`.

**Bordas:**
- **Token ausente/errado/comprimento diferente:** `validarAssinaturaWebhook` → `false` sem throw (077 responde 401, zero efeito). Coberto no RED.
- **Segredo `BILLING_WEBHOOK_SECRET` não configurado:** → `false` (nunca autoriza às cegas). Coberto no RED.
- **Evento desconhecido / intermediário:** `mapearEventoBilling` → `null` (077 loga, 2xx, não muda estado).
- **Payload sem `id` de evento:** `extrairEventoId` cai no fallback `${payment.id}:${event}`; sem ambos → `null` (077 responde 400 — sem id não há trava de idempotência).
- **Payload sem `payment.subscription`:** `extrairDadosPagamento.provider_subscription_id` → `null` (077 não encontra loja → 2xx no-op, reconciliação fica para follow-up — padrão Hotmart).
- **`value` ausente/não numérico:** `valor` → `null`; 077 decide (não grava pagamento sem valor, ou grava `pendente`). O adapter não inventa valor.
- **`payment.billingType = UNDEFINED`:** `metodo` → `null` (campo opcional na tabela). Mapear `BOLETO→boleto`, `CREDIT_CARD→cartao`, `PIX→pix`, resto → `null`.
- **`dueDate`/`paymentDate` ausentes ou inválidos:** `calcularFimPeriodo` cai no fallback `agora + 30 dias` (nunca Invalid Date / data no passado). `agora` injetado (pura).
- **Race de duplo submit / entrega dupla ("at least once" do Asaas):** tratado no 077 via `UNIQUE (provider, evento_id)` — o adapter só fornece o `evento_id` estável que torna a trava possível.
- **Sessão expirada:** N/A — webhook não tem sessão; API de provider usa `BILLING_API_KEY` (não sessão de usuário).

**Tratamento de erro:** funções puras nunca lançam por input malformado (retornam `null`/fallback) — espelha `hotmart.ts`. Funções de API (`criarAssinatura` etc.): em falha de rede/HTTP não-2xx, **lançam** erro tipado/genérico para a Server Action 078 capturar — a 078 loga no servidor e devolve mensagem genérica ao lojista (`seguranca.md` §14). O adapter nunca loga PII do payload (`seguranca.md` §21).

### Contratos de Dados

Esta issue **não cria tabela nem coluna nem RLS** (migrations são 071–074, já feitas conforme dependências de 077/078). Define apenas **tipos TypeScript** (o "shape" que o 077 grava em `pagamentos_assinatura`). Sem `supabase gen types`.

`interface BillingProvider` (em `src/lib/billing/providers/tipos.ts`):

```ts
export interface DadosPagamentoBilling {
  provider_payment_id: string | null;
  provider_subscription_id: string | null;
  valor: number | null;          // do provider (payment.value) — AUTORITATIVO, nunca do cliente
  status: "pendente" | "pago" | "falhou" | "estornado" | null; // CHECK de pagamentos_assinatura
  metodo: "pix" | "boleto" | "cartao" | null;
  fatura_url: string | null;     // payment.invoiceUrl
  competencia: Date | null;      // payment.dueDate / paymentDate
}

export interface BillingProvider {
  readonly nome: string; // 'asaas' — deve casar com lojas.billing_provider / pagamentos_assinatura.provider

  // --- Webhook (puras quando possível) ---
  validarAssinaturaWebhook(headers: Headers, rawBody: string, secret: string | undefined): boolean;
  extrairEventoId(payload: unknown): string | null;
  extrairTipoExterno(payload: unknown): string | null;
  mapearEventoBilling(tipoExterno: string): EventoBilling | null;
  extrairDadosPagamento(payload: unknown): DadosPagamentoBilling;
  calcularFimPeriodo(payloadFim: unknown, agora: Date): Date;

  // --- API server-only (stubs nesta issue; corpo real exercido em 078) ---
  criarAssinatura(args: { lojaId: string; planoId: string; valor: number; providerPriceId: string | null; emailDono: string }): Promise<{ provider_subscription_id: string }>;
  trocarPlano(args: { providerSubscriptionId: string; valor: number; providerPriceId: string | null }): Promise<void>;
  urlAtualizarPagamento(args: { providerSubscriptionId: string }): Promise<{ url: string }>;
  cancelarAssinatura(args: { providerSubscriptionId: string }): Promise<void>;
}
```

> `valor` em `criarAssinatura`/`trocarPlano` é resolvido pela Server Action (078) lendo `planos.preco` do banco (RN-1) — o adapter recebe valor já confiável; **não** o lê do cliente.

### Recálculo no Servidor (dinheiro)

- **Webhook:** o `valor` da fatura vem **exclusivamente** de `payment.value` do payload Asaas (autoridade do provider, `seguranca.md` §10/RN-1). O cliente final nunca participa. O adapter não recebe nem confia em valor do browser.
- **API (intenções):** o adapter recebe `valor` já resolvido do banco pela 078; nunca aceita preço do cliente. O cliente, no máximo, manda `plano_id` (validado e precificado server-side na 078).

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/lib/billing/providers/tipos.ts` — `interface BillingProvider`, `interface DadosPagamentoBilling`. Importa `EventoBilling` de `@/lib/utils/assinatura`. ~40 linhas.
- `src/lib/billing/providers/asaas.ts` — `import "server-only"` no topo. Funções puras nomeadas (`validarAssinaturaWebhook`, `extrairEventoId`, `extrairTipoExterno`, `mapearEventoBilling`, `extrairDadosPagamento`, `calcularFimPeriodo`) + funções de API (stubs com assinatura fixada) + `export const asaasProvider: BillingProvider = {...}` referenciando-as. Mapa `MAPA_EVENTO_ASAAS: Record<string, EventoBilling>`. Helper `asObjeto` (copiado de hotmart.ts — trivial, <5 linhas; não vale extrair util compartilhado nesta issue).
- `src/lib/billing/index.ts` — `import "server-only"`. `getBillingProvider(nome?: string): BillingProvider` — seleciona por `nome ?? process.env.BILLING_PROVIDER`; `'asaas'` → `asaasProvider`; desconhecido → `throw` (fail-closed: provider mal configurado não silencia). NÃO importa nem expõe Hotmart aqui (Hotmart segue no caminho legado próprio).
- `src/lib/billing/providers/asaas.test.ts` — **fase RED (tdd)**: espelha `hotmart.test.ts`. Cobre `validarAssinaturaWebhook` (igual/errado/comprimento/ausente/sem-segredo), `mapearEventoBilling` (cada nome conhecido + desconhecido + `''`), `extrairEventoId` (`id` envelope / fallback / null), `extrairDadosPagamento` (payload exemplo → objeto correto, incl. `billingType` → `metodo` e ausências → `null`), `calcularFimPeriodo` (data válida / fallback +30d / inválida / `agora` injetado).

**Modificar:**
- `.env.example` — adicionar bloco comentado `BILLING_PROVIDER`, `BILLING_API_KEY`, `BILLING_WEBHOOK_SECRET` (server-only, sem `NEXT_PUBLIC_`, sem valor real), no padrão dos blocos existentes (Hotmart/Upstash). **Não** commitar valores.

**NÃO tocar (com motivo):**
- `src/lib/utils/assinatura.ts` — fonte de `EventoBilling`/`eventoBillingParaStatus` (075). Só importado, nunca alterado aqui.
- `src/lib/utils/hotmart.ts` e `src/app/api/webhooks/hotmart/route.ts` — caminho legado Hotmart, intocado (coexistência DA-6). Servem de modelo, não de alvo de edição.
- `src/app/api/webhooks/billing/[provider]/route.ts` e `queries/webhookBilling.ts` — são a **issue 077** (consomem este adapter). Fora de escopo.
- Server Actions de assinatura — **issue 078**.
- Migrations / RLS / trigger — issues 071–074.

### Dependências Externas

Nenhuma nova dependência npm. Usa: `node:crypto` (`timingSafeEqual`, nativo), `fetch` global (Node 18+/Next runtime). API Asaas REST: produção `https://api.asaas.com/v3`, sandbox `https://sandbox.asaas.com/api/v3` (selecionável por env numa issue futura, não aqui). Doc: [docs.asaas.com/docs/payment-events](https://docs.asaas.com/docs/payment-events), [docs.asaas.com/docs/sobre-os-webhooks](https://docs.asaas.com/docs/sobre-os-webhooks).

### Ordem de Implementação

1. **`tipos.ts`** — fixa o contrato `BillingProvider`/`DadosPagamentoBilling`. Tudo depende dele. Sem I/O.
2. **fase RED (`tdd`)** — `asaas.test.ts` com as funções puras importadas direto do módulo (que ainda não existe / é stub). Confirmar VERMELHO real (falha de asserção, não de import — criar `asaas.ts` como stub que `throw` em cada corpo, igual ao padrão de `assinatura.ts`/`hotmart.ts`). **Issue crítica → RED antes de GREEN.**
3. **GREEN: `asaas.ts`** — implementar funções puras (passam o RED) + funções de API como stubs com assinatura fixada (corpo real exercido na 078; marcar `// TODO 078`).
4. **`index.ts`** — `getBillingProvider()`. Depende de `asaas.ts` exportar `asaasProvider`.
5. **`.env.example`** — bloco de envs.
6. `next build` — confirmar que `import "server-only"` não vazou para client e que nenhuma `const` não-async escapou de um arquivo `'use server'` (N/A aqui — adapter não é `'use server'`, mas validar build é mandato).

Justificativa de ordem: contrato (1) trava a interface antes de qualquer implementação; RED (2) antes de GREEN é mandato de issue crítica; `index.ts` (4) só compila depois de existir `asaasProvider`.

### Checklist de Validação Pós-Implementação
- [ ] `pnpm build` (`next build`) sem warnings novos; `import "server-only"` presente em `asaas.ts` e `index.ts`.
- [ ] `validarAssinaturaWebhook` rejeita token adulterado e de comprimento diferente **sem throw** (timing-safe); sem segredo → `false`.
- [ ] `mapearEventoBilling` traduz os 7 nomes mapeados e devolve `null` para qualquer outro (incl. `''` e eventos de ciclo intermediário).
- [ ] `extrairDadosPagamento` monta o objeto a partir de payload Asaas exemplo; `valor`/`metodo`/`subscription` ausentes → `null` (nunca inventa valor).
- [ ] Nenhuma env com prefixo `NEXT_PUBLIC_`; `BILLING_API_KEY`/`BILLING_WEBHOOK_SECRET` não aparecem no bundle do cliente.
- [ ] Nenhum secret nem PII hardcoded; adapter não loga payload com dado pessoal.
- [ ] Suite RED→GREEN: `asaas.test.ts` passa; espelha cobertura de `hotmart.test.ts`.
