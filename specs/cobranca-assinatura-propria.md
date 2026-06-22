# Spec: Cobrança de Assinatura Própria (sem dependência da Hotmart)

**Versão:** 0.1.0 | **Atualizado:** 2026-06-19

> **Emenda comercial e arquitetural.** Substitui, na prática, a seção "Modelo de Cobrança (Lojistas)" do `references/modelo-negocio.md` §5 e o tratamento exclusivo da Hotmart como autoridade de billing (`seguranca.md` §9 — "Webhook Hotmart — ÚNICA autoridade de billing"). O iRango passa a cobrar a mensalidade do lojista **diretamente**, via gateway de cobrança recorrente próprio, convivendo com a Hotmart durante a transição. Mantém todos os invariantes de segurança de billing já decididos (trigger `lojas_protege_billing_trg`, deny-all em tabela de eventos, billing só via `service_role`).

---

## Decisões Abertas (resolver antes de `/break`)

São decisões do dono do produto. O spec recomenda um default mas não a impõe.

| # | Decisão | Opções | Recomendação (default) |
|---|---------|--------|------------------------|
| **DA-1** | **Gateway de cobrança recorrente** | Stripe, Asaas, Pagar.me, Mercado Pago, Pix recorrente (cobrança nativa) | **Asaas** como default BR (ver trade-offs abaixo); Stripe se for priorizar cartão internacional. |
| **DA-2** | **Métodos de pagamento aceitos** | Pix avulso recorrente, boleto, cartão recorrente, ou combinação | Cartão recorrente (menor fricção de dunning) + Pix/boleto como fallback manual |
| **DA-3** | **Modelo comercial** | mensalidade fixa única / múltiplos planos / freemium | Plano único mensal fixo na v1; tabela `planos` desde já para crescer |
| **DA-4** | **Trial** | manter 14 dias atuais / mudar / exigir cartão no cadastro | Manter trial de 14 dias **sem cartão** (preserva fluxo de cadastro atual) |
| **DA-5** | **Política de dunning** | nº de retentativas, janela, ação ao falhar | 3 retentativas em 7 dias → `inadimplente` (carência) → `suspensa` |
| **DA-6** | **Migração das lojas Hotmart existentes** | migração forçada na renovação / opt-in / corte de data | Coexistência indefinida: cada loja tem um `provider` que a rege; novas lojas nascem no gateway próprio |
| **DA-7** | **Reembolso** | total automático / manual pelo dono / sem reembolso self-service | Reembolso disparado fora do app (painel do provider); webhook reflete o efeito |

### Trade-offs dos gateways (mercado BR)

| Gateway | Assinatura nativa | Pix recorrente | Boleto | Cartão recorrente | Webhook HMAC | Taxas (ordem) | Observação |
|---------|-------------------|----------------|--------|-------------------|--------------|---------------|------------|
| **Asaas** | Sim | Sim (Pix automático) | Sim | Sim | Sim (token/assinatura) | baixa BR | Forte em BR, suporta cobrança recorrente nativa em Pix/boleto/cartão; doc em PT |
| **Stripe** | Sim (Billing maduro) | Limitado no BR | Não nativo | Sim | Sim (`Stripe-Signature`) | média-alta | Melhor DX e dunning automático; Pix/boleto fracos no BR |
| **Pagar.me** | Sim | Sim | Sim | Sim | Sim | média BR | Brasileiro, bom suporte a recorrência |
| **Mercado Pago** | Sim (Preapproval) | Sim | Sim | Sim | Sim | média BR | Onipresente no BR; API de assinatura (preapproval) mais limitada |
| **Pix recorrente "puro"** | Não (montar dunning à mão) | Sim | — | — | varia (PSP) | mais baixa | Mais barato, mas exige construir todo o ciclo de cobrança/retentativa manualmente |

> **Critério da abstração:** o spec é escrito para ser **agnóstico de provider**. A escolha de DA-1 afeta apenas o adapter (`lib/billing/providers/<x>.ts`) e o mapa de eventos — nunca o schema, os gates de acesso ou as telas.

---

## Visão Geral

Hoje a mensalidade do lojista é cobrada pela **Hotmart**, e o webhook `POST /api/webhooks/hotmart` é a única autoridade de billing. Esta feature introduz um **gateway de cobrança recorrente próprio**: o iRango passa a ser o recebedor da assinatura, gerando cobranças (Pix/boleto/cartão recorrente) e reagindo aos eventos do provider escolhido (DA-1).

O problema que resolve: remover a dependência de uma plataforma de terceiros (taxas, lock-in, falta de controle sobre dunning/upgrade), mantendo a robustez do fluxo Hotmart já provado (idempotência, deny-all RLS, validação de assinatura, reconciliação de órfãos).

**Mundo:** majoritariamente **painel** (auth obrigatório — telas de assinatura/fatura) + **infraestrutura server-only** (webhook do provider, sem mundo de UI). Nada nesta feature vive na vitrine pública.

**Invariante central (mantido):** o cliente/lojista **nunca** define seu próprio `assinatura_status`, plano ou valor pago. A única autoridade de billing é o webhook do provider (server) aplicando via `service_role` — exatamente como hoje com a Hotmart (`seguranca.md` §9, §2 trigger).

---

## Atores Envolvidos

| Ator | Papel nesta feature |
|------|---------------------|
| **iRango (SaaS)** | É o **recebedor** da mensalidade. Gera cobranças via gateway, recebe webhooks, aplica status via `service_role`, exibe fatura/histórico no painel. Define planos. |
| **Lojista** | Vê o plano, inicia/troca assinatura, atualiza cartão, consulta faturas. **Nunca** escreve status nem valor — apenas dispara intenções (ex: "assinar plano X") que o servidor traduz em cobrança no provider. |
| **Provider de cobrança (externo)** | Processa a cobrança recorrente real, emite Pix/boleto/cartão, e notifica o iRango por webhook assinado. Fonte de verdade do pagamento. |
| **Hotmart (legado, em transição)** | Continua regendo lojas marcadas com `provider = 'hotmart'`. Não recebe novas lojas. |

---

## Páginas e Rotas

### Assinatura — `/painel/configuracoes/assinatura`

**Mundo:** painel (auth obrigatório)
**Descrição:** Central de assinatura do lojista. Mostra o estado atual da assinatura (status, plano, próximo vencimento, valor), permite assinar/trocar de plano, atualizar forma de pagamento e ver faturas. Todo valor exibido vem do **servidor** (lido do banco, que é alimentado só por webhook) — nada é calculado no cliente.

**Componentes:** (reuso de shadcn/ui)
- `CartaoStatusAssinatura` — `Card` + `Badge` (shadcn) com status (`trial`/`ativa`/`inadimplente`/`suspensa`/`cancelada`/`cortesia`), data de fim de período, plano e valor. **Valor autoritativo (servidor).**
- `SeletorPlano` — `RadioGroup` + `Card` listando planos da tabela `planos` (lidos server-side). Preço exibido é do banco, não editável.
- `BotaoAssinar` / `BotaoTrocarPlano` — dispara Server Action que cria/atualiza assinatura no provider.
- `FormaPagamentoAssinatura` — exibe método atual mascarado (ex: "cartão final 1234" / "Pix"); botão "Atualizar" leva ao fluxo do provider (redirect/checkout hospedado ou tokenização).
- `TabelaFaturas` — `Table` (shadcn) com histórico de `pagamentos_assinatura` (data, valor, status, link 2ª via). **Valor autoritativo (servidor).**
- `AvisoEstadoBloqueado` — `Alert` (shadcn) quando `suspensa`/`inadimplente`, com CTA de regularização.
- Reusa: `formatarMoeda` (`lib/utils/formatarMoeda.ts`), sonner `toast`.

**Behaviors:**
- [ ] Exibir status e plano atual — lê de `lojas.assinatura_*` + `assinaturas` + `planos` via Server Component. Garantido em: Server Action/RLS (leitura escopada por `dono_id`) + valor autoritativo (servidor).
- [ ] Listar planos disponíveis — lê `planos` (ativos) server-side. Garantido em: servidor (preço nunca vem do cliente).
- [ ] Iniciar assinatura de um plano — Server Action `iniciarAssinatura(plano_id)`: valida posse da loja, lê o **preço do plano no banco**, cria a assinatura/cobrança no provider via `service_role`, persiste `provider_subscription_id`. **O cliente envia só `plano_id`, nunca o valor.** Garantido em: Server Action + RLS + recálculo de preço no servidor (preço lido do banco).
- [ ] Trocar de plano (upgrade/downgrade) — Server Action `trocarPlano(plano_id)`: idem, atualiza a assinatura no provider; status final só muda quando o webhook confirmar. Garantido em: Server Action + RLS + valor do banco.
- [ ] Atualizar forma de pagamento — Server Action `atualizarMeioPagamentoAssinatura()` retorna URL/token do checkout hospedado do provider (tokenização do cartão acontece **no provider**, nunca toca o servidor do iRango). Garantido em: Server Action (chave do provider só no servidor) + dados de cartão nunca trafegam pelo iRango.
- [ ] Consultar histórico de faturas — lê `pagamentos_assinatura` escopado por `loja_id`. Garantido em: RLS + servidor.
- [ ] Cancelar assinatura — Server Action `cancelarAssinatura()`: solicita cancelamento no provider; `assinatura_status` só vira `cancelada` quando o webhook de cancelamento chegar (não otimista). Garantido em: Server Action + webhook (autoridade real) + trigger de billing.
- [ ] Ver estado bloqueado — quando `suspensa` (corte imediato) ou `inadimplente`/`cancelada` fora da carência, exibe `AvisoEstadoBloqueado`. Garantido em: servidor (`assinaturaPermiteAcesso` em `lib/utils/assinatura.ts`).

---

### Estado Bloqueado do Painel — `/painel/*` (interceptação existente)

**Mundo:** painel (auth obrigatório)
**Descrição:** Não é página nova. O gate de acesso ao painel já existe em `decidirAcessoPainel` (`src/lib/utils/acessoPainel.ts`) + `(painel)/painel/layout.tsx`. Esta feature **não muda a lógica de gate** — apenas garante que ela continue lendo `assinatura_status`/`assinatura_fim_periodo` (que agora podem ser alimentados pelo gateway próprio em vez da Hotmart). Quando bloqueado, redireciona/limita o lojista a `/painel/configuracoes/assinatura` para regularizar.

**Behaviors:**
- [ ] Bloquear painel quando assinatura não permite acesso — reusa `assinaturaPermiteAcesso(status, fimPeriodo, agora)` (já existe, `lib/utils/assinatura.ts:48-65`). Garantido em: servidor (gate de painel) + RLS/trigger no banco.
- [ ] Liberar painel quando `ativa` — sempre permitido. Garantido em: servidor.

---

### Painel Admin do SaaS — `/admin/assinantes`

**Mundo:** painel server-only (auth obrigatório — **exclusivo ao dono do SaaS**). Sem acesso de lojistas.
**Descrição:** Lista todos os assinantes (lojas) com status de assinatura, plano e datas. Permite ao administrador do SaaS conceder ou revogar cortesia individualmente via toggle. Ação usa `service_role` (mesmo caminho que o webhook), garantindo que passe pelo trigger de billing.

**Auth do admin:** Server Component/Action verifica `auth.uid() === process.env.SAAS_ADMIN_USER_ID` (env server-only). Qualquer outra identidade → `redirect('/painel')`. Sem tabela de admins — dono único do SaaS identificado por UUID fixo em env.

**Componentes:** (reuso de shadcn/ui)
- `TabelaAssinantes` — `Table` (shadcn) com colunas: nome da loja, email do dono, status (`Badge`), plano, `fim_periodo`, `billing_provider`, toggle de cortesia, botão de suspensão/reativação.
- `ToggleCortesia` — `Switch` (shadcn) por linha. ON = conceder `cortesia`; OFF = revogar (volta a `cancelada` + `fim_periodo = now()`). Desabilitado quando loja está `suspensa`.
- `BotaoSuspender` / `BotaoReativar` — `Button` destrutivo (variante `destructive` shadcn) quando loja não está `suspensa`; `Button` primário "Reativar" quando está `suspensa`. Nunca exibido para loja com `status = 'cortesia'` (toggle basta). Pede confirmação via `AlertDialog` antes de executar.
- Filtros: por status (`Select`) e busca por nome/email (`Input`).

**Behaviors:**
- [ ] Listar todas as lojas com dados de assinatura — Server Component lê `lojas` + `planos` via `service_role` (sem RLS de dono). Garantido em: `service_role` server-only + verificação `SAAS_ADMIN_USER_ID`.
- [ ] Conceder cortesia — Server Action `concederCortesia(loja_id)`: verifica admin, usa `createServiceClient()` (service_role), aplica `assinatura_status = 'cortesia'`, `assinatura_fim_periodo = NULL`, `billing_provider = NULL`. Garantido em: `service_role` passa pelo trigger + verificação de admin server-side.
- [ ] Revogar cortesia — Server Action `revogarCortesia(loja_id)`: verifica admin, usa `createServiceClient()`, aplica `assinatura_status = 'cancelada'`, `assinatura_fim_periodo = now()` (corte imediato). Garantido em: `service_role` + verificação de admin server-side.
- [ ] Suspender loja — Server Action `suspenderLoja(loja_id)`: verifica admin, usa `createServiceClient()`, aplica `assinatura_status = 'suspensa'`, `assinatura_fim_periodo = now()` (corte imediato, sem carência). Uso: violação de termos, fraude, contenção de emergência. Garantido em: `service_role` + verificação de admin server-side.
- [ ] Reativar loja — Server Action `reativarLoja(loja_id)`: verifica admin, usa `createServiceClient()`, aplica `assinatura_status = 'ativa'` (override explícito — admin decide conscientemente restaurar acesso independente de billing). Garantido em: `service_role` + verificação de admin server-side.
- [ ] Feedback visual imediato — `revalidatePath('/admin/assinantes')` após cada ação + toast de confirmação.

**Nova env necessária:** `SAAS_ADMIN_USER_ID` (UUID do usuário Supabase Auth do dono do SaaS — server-only, sem `NEXT_PUBLIC_`).

---

### Webhook de Billing (Genérico) — `POST /api/webhooks/billing/[provider]`

**Mundo:** infraestrutura server-only (Route Handler, runtime `nodejs`). Sem UI. Não há behaviors de usuário — é o **único** caminho que muda billing do provider próprio, espelhando `POST /api/webhooks/hotmart`.

**Descrição:** Endpoint público (recebe POST do provider), mas autenticado por **assinatura HMAC/token** do provider antes de qualquer efeito. Espelha a robustez do Hotmart:
1. **Validação de assinatura antes de qualquer efeito** — verifica o header de assinatura do provider (ex: `Stripe-Signature`, token Asaas) contra o segredo em env, via `timingSafeEqual`. Inválido → `401`, zero efeito colateral.
2. **Idempotência via trava de INSERT** — `INSERT INTO webhook_eventos_billing (provider, evento_id, ...) ON CONFLICT (provider, evento_id) DO NOTHING`. Replay/entrega dupla = no-op. Evento já visto → `200` imediato.
3. **Lookup loja** — resolve a loja pelo `provider_subscription_id` (ou email do dono) via função `SECURITY DEFINER`, sem expor `lojas` ao anon (mesmo padrão de `loja_por_email_dono`).
4. **Mapeamento evento → status** — função pura `eventoBillingParaStatus(provider, tipo)` (espelha `eventoParaStatus` de `lib/utils/assinatura.ts`). Evento desconhecido → log + `200` (não rejeita, evita retry infinito).
5. **Aplicação via `service_role`** — UPDATE em `lojas.assinatura_*` + INSERT em `pagamentos_assinatura`, único role que passa pelo trigger `lojas_protege_billing_trg`. Loja `cancelada` não é reativada por renovação espúria (verifica status atual antes de aplicar, como no Hotmart).

**Mapa evento provider → status (a preencher por provider em DA-1; semântica espelha o Hotmart):**

| Evento lógico | `assinatura_status` resultante | renova `fim_periodo`? |
|---|---|---|
| cobrança aprovada / primeira compra | `ativa` | sim |
| recorrência aprovada | `ativa` | sim |
| pagamento falhou (em dunning) | `inadimplente` | não |
| assinatura cancelada | `cancelada` | não |
| reembolso | `suspensa` | não |
| chargeback | `suspensa` | não |

---

## Modelos de Dados

> Toda tabela/coluna nova exige migration em `supabase/migrations/` e política RLS antes de produção (`seguranca.md` §2). Valores monetários são `numeric(10,2)` (convenção `schema.md` §6).

### Generalizar `lojas` — colunas agnósticas de provider (migration `expand`)

Sequência segura **expand → backfill → contract** (tabela com dados em produção):

```sql
-- EXPAND: adicionar colunas genéricas, nullable
ALTER TABLE lojas
  ADD COLUMN billing_provider        text,        -- 'hotmart' | '<gateway>' (DA-1); NULL = sem provider (trial puro)
  ADD COLUMN provider_subscription_id text,        -- id da assinatura no provider (genérico)
  ADD COLUMN plano_id                uuid REFERENCES planos(id);

-- Atualizar CHECK de assinatura_status: incluir 'suspensa'
-- (schema.md §5 lista 4 valores; código já usa 'suspensa' — lib/utils/assinatura.ts.
--  Esta migration ALINHA o CHECK do banco ao domínio do código.)
ALTER TABLE lojas DROP CONSTRAINT lojas_assinatura_status_check;
ALTER TABLE lojas ADD CONSTRAINT lojas_assinatura_status_check
  CHECK (assinatura_status IN ('trial','ativa','inadimplente','cancelada','suspensa','cortesia'));
```

```sql
-- BACKFILL: lojas Hotmart existentes
UPDATE lojas SET billing_provider = 'hotmart',
                 provider_subscription_id = hotmart_subscriber_code
 WHERE hotmart_subscriber_code IS NOT NULL;
```

```sql
-- CONTRACT (fase futura, pós-migração total): manter hotmart_subscriber_code/hotmart_plano
-- como histórico read-only. NÃO dropar enquanto houver loja com billing_provider='hotmart'.
```

- `assinatura_status`, `assinatura_inicio`, `assinatura_fim_periodo`, `assinatura_atualizada_em` — **mantidas**, agora alimentadas por qualquer provider. **Autoritativas do servidor** (só `service_role` via trigger).
- `hotmart_subscriber_code`, `hotmart_plano` — **mantidas** (legado/coexistência), não usadas para novos providers.

### Nova tabela `planos`

```sql
CREATE TABLE planos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         text NOT NULL,
  preco        numeric(10,2) NOT NULL CHECK (preco >= 0),  -- AUTORITATIVO: única fonte do valor cobrado
  intervalo    text NOT NULL DEFAULT 'mensal' CHECK (intervalo IN ('mensal','anual')),
  provider_price_id text,        -- id do preço/plano no provider (ex: Stripe price_xxx); por provider
  ativo        boolean NOT NULL DEFAULT true,
  criado_em    timestamptz NOT NULL DEFAULT now()
);
```
- **RLS:** SELECT permitido a `authenticated` apenas onde `ativo = true` (catálogo de planos é semipúblico ao lojista logado); INSERT/UPDATE/DELETE deny-all (só `service_role`/dono do SaaS via migration/admin). Preço **nunca** editável pelo lojista.

### Nova tabela `pagamentos_assinatura` (histórico de cobranças)

```sql
CREATE TABLE pagamentos_assinatura (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id          uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  provider         text NOT NULL,
  provider_payment_id text,                 -- id da cobrança no provider
  valor            numeric(10,2) NOT NULL,  -- AUTORITATIVO: valor efetivamente cobrado (vem do webhook)
  status           text NOT NULL CHECK (status IN ('pendente','pago','falhou','estornado')),
  metodo           text,                    -- 'pix' | 'boleto' | 'cartao'
  fatura_url       text,                    -- 2ª via / recibo do provider
  competencia      timestamptz,             -- período coberto
  criado_em        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id)    -- idempotência de cobrança
);
```
- **RLS:** SELECT só onde `auth.uid() = lojas.dono_id` (lojista vê só as próprias faturas). INSERT/UPDATE deny-all para `anon`/`authenticated` — **apenas `service_role`** (via webhook). Valor e status nunca escritos pelo lojista.

### Nova tabela `webhook_eventos_billing` (espelha `webhook_eventos_hotmart`)

```sql
-- Registro imutável de eventos do gateway próprio. RLS deny-all permanente; só service_role.
CREATE TABLE webhook_eventos_billing (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text NOT NULL,
  evento_id   text NOT NULL,           -- id único do evento no provider
  tipo        text NOT NULL,
  payload     jsonb NOT NULL,
  processado  boolean NOT NULL DEFAULT false,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, evento_id)         -- idempotência (espelha UNIQUE evento_id do Hotmart)
);
```
- **RLS:** deny-all permanente — acesso exclusivo via `service_role` (idêntico a `webhook_eventos_hotmart`, `schema.md`/`seguranca.md`).

---

## Regras de Negócio

| # | Regra | Camada que garante |
|---|-------|--------------------|
| RN-1 | **Valor cobrado = preço do plano no banco**, nunca o que o cliente enviar. Cliente só manda `plano_id`. | Server Action (lê `planos.preco`) + `seguranca.md` §10 |
| RN-2 | **`assinatura_status` só muda por webhook do provider** (próprio ou Hotmart), via `service_role`. Nenhuma Server Action do painel escreve status. | Webhook (server) + trigger `lojas_protege_billing_trg` (banco) |
| RN-3 | **Trial:** loja nasce `trial`, `assinatura_fim_periodo = now()+14 dias` (DA-4), decidido server-side no cadastro (já existe, `seguranca.md` §17). | Função SQL de cadastro (server) |
| RN-4 | **Carência:** `trial`/`inadimplente`/`cancelada` mantêm acesso até `now() <= fim_periodo`; `suspensa` corta na hora; `ativa`/`cortesia` sempre. Reusa `assinaturaPermiteAcesso` — **estender com `cortesia`, não reescrever.** | `lib/utils/assinatura.ts` (server) |
| RN-5 | **Dunning (DA-5):** pagamento falho → `inadimplente` (carência até fim_periodo). Esgotadas as retentativas do provider sem sucesso → evento de cancelamento/suspensão → corte. As retentativas são executadas **pelo provider**, não reimplementadas no iRango. | Provider + webhook → status (server) |
| RN-6 | **Upgrade/downgrade:** muda `plano_id` e a assinatura no provider; status/valor efetivos só após webhook confirmar. Proração (se houver) é responsabilidade do provider. | Server Action + webhook |
| RN-7 | **Cancelamento não é otimista:** Server Action só solicita ao provider; `cancelada` aplicada quando o webhook chegar. | Server Action + webhook |
| RN-8 | **Reembolso/chargeback → `suspensa`** (corte imediato, sem carência), espelhando o mapa Hotmart atual. | Webhook + `eventoBillingParaStatus` (server) |
| RN-9 | **Coexistência (DA-6):** `lojas.billing_provider` determina qual webhook rege a loja. Webhook Hotmart só toca lojas `billing_provider='hotmart'` (ou NULL legado); webhook próprio só toca as do seu provider. Um webhook nunca altera loja de outro provider. | Lookup por `provider_subscription_id` + filtro de provider (server) |
| RN-10 | **Loja `cancelada` não reativa** por evento de renovação espúrio (verifica status atual antes de aplicar). | Webhook (server) |
| RN-11 | **Dados de cartão nunca tocam o iRango** — tokenização/checkout sempre hospedado no provider. | Server Action retorna URL/token do provider; PCI fica no provider |
| RN-12 | **Cortesia:** acesso pleno sem cobrança, sem `fim_periodo` (NULL), sem `billing_provider`. Concedida/revogada **exclusivamente pelo admin do SaaS** via Server Action com `service_role`. Lojista não vê nem dispara esse status. Revogação → `cancelada` + `fim_periodo = now()` (corte imediato). | Server Action admin (`service_role`) + verificação `SAAS_ADMIN_USER_ID` + trigger |
| RN-13 | **Admin do SaaS não é lojista:** `/admin/*` verifica `auth.uid() === SAAS_ADMIN_USER_ID` server-side. Qualquer outro usuário (inclusive lojistas autenticados) → redirect. Sem tabela de admins — dono único, UUID fixo em env. | Server Component/Action (verificação server-side) |
| RN-14 | **Suspensão por admin:** `suspenderLoja` aplica `suspensa` + `fim_periodo=now()` (corte imediato). Uso para violação de termos/fraude. Admin pode reverter com `reativarLoja` → `ativa` (override explícito de billing — admin decide conscientemente). | Server Action admin (`service_role`) |
| RN-15 | **Precedência de ações admin:** `ToggleCortesia` fica desabilitado enquanto loja está `suspensa`. `BotaoSuspender` não aparece para loja `cortesia` (toggle basta). `reativarLoja` sempre leva a `ativa` — sem restaurar status anterior. | UI (server) |

---

## Segurança (obrigatório)

- **Dado sensível que entra/sai:**
  - Email do dono (PII) → usado só server-side para lookup de loja (função `SECURITY DEFINER`, nunca expõe `lojas` ao anon — padrão `loja_por_email_dono`).
  - **Dados de cartão NUNCA trafegam pelo iRango** (RN-11) — tokenização no provider. Sem PCI scope no servidor do iRango.
  - Método de pagamento exibido sempre **mascarado** ("cartão final 1234").
- **Valor monetário:** sim, em todo o fluxo. **Recálculo no servidor obrigatório:** o preço cobrado é sempre lido de `planos.preco` no banco (RN-1); o valor das faturas vem do webhook do provider, nunca do cliente (`seguranca.md` §10). O cliente envia no máximo `plano_id`.
- **Autoridade de billing (mantida de `seguranca.md` §9):** `assinatura_status` e colunas de billing mudam **só** via webhook (Hotmart ou próprio) com `service_role`, passando pelo trigger `lojas_protege_billing_trg`. Nenhuma Server Action de lojista escreve status. **Exceção única e explícita:** Server Actions de admin (`concederCortesia` / `revogarCortesia`) usam `createServiceClient()` (service_role) — **não PostgREST autenticado** — e verificam `SAAS_ADMIN_USER_ID` antes de qualquer efeito. Esse é o único caminho não-webhook que pode escrever `assinatura_status`.
- **Tabelas novas → políticas RLS necessárias:**
  - `planos` — SELECT `authenticated` onde `ativo=true`; escrita deny-all (só `service_role`).
  - `pagamentos_assinatura` — SELECT só `dono_id`; INSERT/UPDATE deny-all p/ anon+authenticated, só `service_role`.
  - `webhook_eventos_billing` — **deny-all permanente** (idêntico a `webhook_eventos_hotmart`).
- **Painel admin (`/admin/*`):** rota protegida server-side por `SAAS_ADMIN_USER_ID`. RLS das tabelas continua inalterada — o admin acessa via `service_role` nas Server Actions, nunca via PostgREST autenticado como lojista.
- **Webhook do provider:** validação de assinatura HMAC/token via `timingSafeEqual` **antes de qualquer efeito** (`401` se inválido); idempotência por `UNIQUE (provider, evento_id)`; runtime `nodejs`.
- **API externa com key:** chave secreta do gateway é **só servidor** (`seguranca.md` §7 — sem prefixo `NEXT_PUBLIC_`, em `createServiceClient`-style server-only). Nova env: `BILLING_PROVIDER`, `BILLING_API_KEY`, `BILLING_WEBHOOK_SECRET`.
- **Trigger `lojas_protege_billing_trg` mantido** — `billing_provider`, `provider_subscription_id`, `plano_id` e os `assinatura_*` devem entrar na lista de colunas protegidas do trigger (migration de atualização do trigger), para que o lojista não consiga PATCH direto via PostgREST.

---

## Fora do Escopo (v1)

- **Gestão de planos pela UI do admin** — planos são criados/editados via migration/script por enquanto. A tela `/admin/assinantes` mostra planos mas não os edita.
- **Proração custom** no iRango — delegada ao provider (RN-6).
- **Cobrança por comissão/uso** — modelo continua mensalidade fixa (`modelo-negocio.md` §3).
- **Reembolso self-service** pelo lojista (DA-7) — disparado fora do app; webhook só reflete.
- **Split de pagamento** entre iRango e lojista — fora do modelo (o SaaS não intermedia pagamento do cliente; `modelo-negocio.md` §3).
- **Múltiplas lojas por conta** — segue RN-01 (1 conta = 1 loja).
- **Migração forçada das lojas Hotmart** — coexistência indefinida (DA-6); só a decisão de cortar a Hotmart muda isso.
- **Reescrever `assinaturaPermiteAcesso` / gate de painel** — reuso obrigatório do que existe.

---

## Notas de Reuso (não reinventar a roda)

- `assinaturaPermiteAcesso`, `eventoParaStatus`, tipos `StatusAssinatura`/`ResultadoEvento` — `src/lib/utils/assinatura.ts` (estender com `'cortesia'`, não recriar; criar `eventoBillingParaStatus` no mesmo padrão).
- `decidirAcessoPainel` — `src/lib/utils/acessoPainel.ts` (gate de painel — reusar).
- Padrão de webhook robusto — espelhar `src/app/api/webhooks/hotmart/route.ts`, queries `src/lib/supabase/queries/webhookHotmart.ts`, utils `src/lib/utils/hotmart.ts`, reconciliação `src/lib/assinatura/reconciliar.ts`.
- `formatarMoeda` — `src/lib/utils/formatarMoeda.ts`.
- shadcn/ui (`Card`, `Badge`, `Table`, `RadioGroup`, `Alert`, `Button`), zod + react-hook-form, sonner — já na stack (`architecture.md` §7).
- Trigger de billing — `20260614004500_lojas_protege_billing.sql` (estender colunas protegidas).
