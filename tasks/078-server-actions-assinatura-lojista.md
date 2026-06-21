# [078] Server Actions de assinatura do lojista (iniciar/trocar/atualizar pagamento/cancelar)

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** [070], [072], [073], [076]
**Spec:** specs/cobranca-assinatura-propria.md

## Objetivo
Implementar as intenções do lojista — `iniciarAssinatura`, `trocarPlano`, `atualizarMeioPagamentoAssinatura`, `cancelarAssinatura` — que validam posse da loja, leem o preço do plano NO BANCO, falam com o provider via adapter e NUNCA escrevem `assinatura_status` (isso é só do webhook).

## Escopo
- [ ] Criar `src/lib/validacoes/assinatura.ts` (zod) — schema de entrada que aceita SÓ `plano_id: uuid` (nunca valor/preço). Reutilizável no form e na action.
- [ ] Criar as Server Actions (ex: `src/app/(painel)/painel/configuracoes/assinatura/actions.ts`):
  - `iniciarAssinatura(plano_id)`: valida posse (loja do `auth.uid()`), lê `planos.preco` do banco, cria assinatura/cobrança no provider (adapter 076), persiste `provider_subscription_id`/`plano_id`/`billing_provider` via `service_role` (passa pelo trigger). Cliente envia só `plano_id`.
  - `trocarPlano(plano_id)`: idem; status efetivo só muda quando o webhook confirmar (RN-6).
  - `atualizarMeioPagamentoAssinatura()`: retorna URL/token do checkout hospedado do provider (tokenização no provider — dados de cartão nunca tocam o iRango, RN-11).
  - `cancelarAssinatura()`: só solicita ao provider; `cancelada` aplicada quando o webhook chegar — NÃO otimista (RN-7).
- [ ] `revalidatePath` da página de assinatura + `toast` de feedback.

## Fora de escopo
Escrever `assinatura_status` diretamente (proibido — só webhook). UI/componentes (081). Ações de admin (079/080).

## Reuso esperado
- `src/lib/validacoes/` padrão zod (architecture §8).
- `createServiceClient()` para a parte que persiste `provider_subscription_id`/`plano_id` (passa pelo trigger).
- Adapter do provider (076).
- `src/lib/supabase/queries/lojas.ts` para validar posse.

## Segurança
- RN-1: preço lido de `planos.preco` no banco; cliente só manda `plano_id` (recálculo no servidor). Posse da loja validada server-side (vazamento entre lojas). Nenhuma dessas actions escreve `assinatura_status` (RN-2). Dados de cartão nunca trafegam (RN-11). → crítica.
- Lembrar do mandato `'use server'`: arquivo de action só exporta funções `async`; rodar `next build` antes de fechar.

## Critério de aceite
- [ ] Teste RED: `iniciarAssinatura` com `plano_id` de plano inativo/inexistente falha; valor enviado a mais pelo cliente é ignorado (preço sempre do banco); action chamada por usuário que não é dono da loja é rejeitada; nenhuma action altera `assinatura_status` no banco.
- [ ] `cancelarAssinatura` não muda o status localmente (espera webhook).
- [ ] `next build` passa.

---


## Plano Técnico

> **Revisão (2026-06-21):** plano anterior pedia coluna `lojas.asaas_customer_id` + trigger v3. **Revertido para v1** — ver D1 abaixo. A decisão foi reavaliada contra a doc oficial do Asaas e contra o spec (que NÃO contém `asaas_customer_id`). Conclusão: o customer id do Asaas é necessário em runtime mas **só no momento da criação da assinatura**; nunca precisa ser relido. Logo **NÃO há nova coluna nem migration nesta issue** — o escopo encolhe para 1 camada (Server Actions + adapter), não 5.

### Diagnóstico

**Causa raiz:** a issue 078 é a **fronteira de intenção do lojista** num fluxo de billing cujo invariante central (`seguranca.md` §9, RN-1/RN-2) é: *o lojista dispara intenções, mas nunca define valor nem status*. As 4 actions são o único ponto onde o painel toca o provider de cobrança próprio. Hoje esse ponto não existe e o adapter (076) entregou `criarAssinaturaAsaas` como **stub que lança** e que exige um `customerId` que ninguém produz. O problema real não é "escrever 4 funções": é fechar essa fronteira **sem** vazar o invariante de segurança (preço do banco, status só do webhook, escrita das colunas billing só via service_role + trigger).

**Por que é complexo:** cruza um contrato de segurança já decidido e protegido por trigger no banco (`lojas_protege_billing_trg`, migration 074). As actions escrevem `provider_subscription_id`/`plano_id`/`billing_provider` — colunas que o trigger **bloqueia para o role autenticado** — logo a escrita é obrigatoriamente via `service_role`, com escopo manual por `id` derivado da loja do `auth.uid()`. Errar a fronteira aqui reabre o vetor de auto-promoção de plano descrito na migration 074. Além disso o adapter precisa de um `customerId` que o Asaas exige (`POST /v3/subscriptions` → `customer` obrigatório, [doc](https://docs.asaas.com/reference/create-new-subscription)) — decidir ONDE esse id vive é a decisão arquitetural central (D1).

**Pré-condição já satisfeita (077):** `src/lib/database.types.ts` **já contém** `planos`, `pagamentos_assinatura` e as colunas `billing_provider`/`provider_subscription_id`/`plano_id` em `lojas` (patch manual da 077, confirmado no arquivo). O plano anterior listava "regenerar types" como bloqueio — **não é mais bloqueio**. Verificado: `grep planos: src/lib/database.types.ts` retorna a tabela; `asaas_customer_id` NÃO existe (coerente com D1).

### Decisão central reavaliada — `asaas_customer_id` é necessário na v1?

**Fatos verificados na doc oficial Asaas:**
- `POST /v3/subscriptions` exige `customer` (id de cliente pré-existente). Não aceita dados inline de cliente. [doc](https://docs.asaas.com/reference/create-new-subscription).
- `POST /v3/customers` **não tem idempotência** — a doc afirma explicitamente: *"The API allows duplicate customer creation. It is the integration's responsibility to implement duplicate prevention strategies."* [doc](https://docs.asaas.com/reference/create-new-customer).
- `trocarPlano` → `POST /v3/subscriptions/{id}`, `cancelar` → `DELETE /v3/subscriptions/{id}`, `atualizarMeioPagamento` → URL da assinatura/fatura. **Todas keyed pelo `provider_subscription_id`, nenhuma pelo customer id.**

**Conclusão:** o customer id é necessário **somente no instante de criar a assinatura** e **nunca é relido** depois. O único risco de não persistir o customer id é criar clientes duplicados no Asaas em **chamadas separadas** de `iniciarAssinatura` — e isso já é barrado pelo guard de double-init (RN abaixo: se `provider_subscription_id` já existe, `iniciarAssinatura` retorna `'Assinatura já iniciada.'` sem tocar o provider). Portanto **na v1 não se persiste customer id, não se cria coluna, não se mexe no trigger.** O escopo encolhe de 5 camadas para 2 (adapter + actions).

### D1 — Onde mora o customer id do Asaas? (decisão revisada)

- **(a) Nova coluna `lojas.asaas_customer_id text` + trigger v3** (plano anterior). Prós: customer reusável entre chamadas. Contras: **coluna provider-específica numa tabela agnóstica** (uma loja Stripe carregaria coluna morta — fere o mandato "trocar provider = mudar só o adapter"); +1 migration + reescrita do trigger (074→v3); **o spec não tem essa coluna** (`grep -i customer specs/...` → 0 ocorrências na seção de `lojas`); aumenta a superfície da issue para 5 camadas.
- **(b) Criar o customer inline dentro de `iniciarAssinatura` e descartá-lo após criar a assinatura.** Prós: zero schema novo, adapter 100% Asaas-encapsulado, alinhado ao spec agnóstico, escopo mínimo. Contras: re-criaria customer se `iniciarAssinatura` rodasse 2x para a mesma loja — **mitigado pelo guard de double-init** (já exigido por RN-3 abaixo). Aceitável na v1 (1 loja = no máx. 1 assinatura ativa).
- **(c) Recriar customer a cada chamada de qualquer action.** Contras: `trocar`/`cancelar`/`atualizar` nem precisam de customer; cria lixo no provider. Rejeitada.
- **Escolhida: (b).** O adapter expõe `criarAssinatura(params)` agnóstico; **internamente** o `asaasProvider` faz `POST /v3/customers` (com `externalReference = loja.id` para rastreabilidade) e em seguida `POST /v3/subscriptions`, devolvendo só `{ subscriptionId }`. A action persiste **somente** `provider_subscription_id`/`plano_id`/`billing_provider` via service_role. **Se em uma issue futura o reuso de customer virar necessário (ex.: trial→pago sem recriar), aí sim entra a coluna — com migration própria. `// TODO(v2):` documentado no adapter.**

### Mapa de Impacto

```
SeletorPlano.tsx (UI 081, cliente — só dispara plano_id)
   └─ chama → iniciarAssinatura(plano_id)              [Server Action — AUTORITATIVO]
        ├─ createClient() [autenticado] → buscarLojaDoDono()  → lojas (RLS dono_id) — POSSE
        ├─ createServiceClient() → buscarPlanoAtivo(svc, plano_id) → planos (preço AUTORITATIVO, RN-1)
        ├─ getBillingProvider(BILLING_PROVIDER) → provider.criarAssinatura({ value, plano, loja })
        │     └─ [asaasProvider, interno] POST /v3/customers (externalReference=loja.id)
        │                                  → POST /v3/subscriptions → { subscriptionId }
        └─ persistirAssinaturaLoja(svc, loja.id, {...}) via SERVICE_ROLE
                                            → lojas.{provider_subscription_id, plano_id, billing_provider}
                                              (passa pelo trigger lojas_protege_billing_trg;
                                               NÃO toca assinatura_status — RN-2)

Preço cobrado aplicado em:
  ├── SeletorPlano.tsx (exibe planos.preco lido server-side) — [cliente — só display, contornável]
  ├── planos.preco no banco                                  — [FONTE ÚNICA DE VERDADE, RN-1]
  └── iniciarAssinatura/trocarPlano                          — [Server Action — lê do banco, ignora qualquer valor do client]

assinatura_status mudado em:
  └── SOMENTE webhook /api/webhooks/billing/[provider] (077) via service_role — [AUTORITATIVO]
      (nenhuma das 4 actions desta issue escreve assinatura_status — RN-2/RN-7)
```

### Análise do Codebase

| Arquivo | Papel atual | O que muda |
|---|---|---|
| `src/lib/billing/tipos.ts` | `BillingProvider` só tem métodos de webhook | **Estender** com métodos de intenção: `criarAssinatura`, `atualizarAssinatura`, `cancelarAssinatura`, `urlMeioPagamento`. Tipos de retorno agnósticos: `{ subscriptionId }`, `{ url }`. Webhook (077) intocado. |
| `src/lib/billing/providers/asaas.ts` | `asaasProvider` (webhook) + `criarAssinaturaAsaas` **stub que lança** e exige `customerId` | **Reescrever** `criarAssinaturaAsaas` sem exigir `customerId` externo (cria o customer internamente). **Criar** `atualizarAssinaturaAsaas`, `cancelarAssinaturaAsaas`, `urlMeioPagamentoAsaas`. Anexar os 4 ao objeto `asaasProvider`. `ASAAS_API_KEY`/`ASAAS_API_BASE_URL` server-only. |
| `src/lib/billing/providers/index.ts` | `getBillingProvider(provider)` | Sem mudança estrutural — passa a expor os métodos novos da interface. |
| `src/lib/validacoes/assinatura.ts` (novo) | inexistente | **Criar** `schemaIniciarAssinatura = z.object({ plano_id: z.guid() }).strict()`. `.strict()` rejeita `preco`/`value` injetado (§10). Espelha `auth.ts`/`opcional.ts`. |
| `src/lib/supabase/queries/planos.ts` (novo) | inexistente | **Criar** `buscarPlanoAtivo(client, planoId)` → `from('planos').select('*').eq('id',planoId).eq('ativo',true).maybeSingle()`. Preço autoritativo (RN-1). |
| `src/lib/supabase/queries/lojas.ts` | queries de loja | **Adicionar** `persistirAssinaturaLoja(client, lojaId, dados)` (UPDATE escopado por `id`, service_role, das 3 colunas billing-intent). Reusar `buscarLojaDoDono`. NUNCA `.from('lojas')` inline na action. |
| `src/lib/actions/assinatura.ts` (novo) | inexistente | **Criar** `'use server'` — as 4 actions. Padrão de `cupom.ts` (validar→client autenticado→derivar loja→service_role para escrita protegida→erro genérico). Só funções `async` exportadas (mandato `use-server-export-constraint`). |
| `src/lib/actions/assinatura.test.ts` (novo) | inexistente | **Criar** — fase RED (tdd), esta entrega. |
| `src/lib/database.types.ts` | **já atualizado** (077) | **NÃO tocar** — já contém `planos`/`pagamentos_assinatura`/colunas billing. |

### Decisões de Design

**D2 — Escrita das colunas billing-intent: service_role obrigatório.** O trigger `lojas_protege_billing` (v2, migration 074) **bloqueia** `billing_provider`/`provider_subscription_id`/`plano_id` para qualquer role ≠ service_role/postgres/supabase_admin. UPDATE via client autenticado (PostgREST) **levanta exception**. Logo `persistirAssinaturaLoja` recebe um client **service_role**, com escopo manual `WHERE id = lojaId`, e `lojaId` é derivado da loja do `auth.uid()` (lida antes pelo client autenticado via RLS) — **nunca** do payload. Não é furo: a posse já foi validada; o service_role só executa o UPDATE escopado (mesmo padrão aprovado do webhook, §9).

**D3 — `assinatura_status` NÃO é tocado (RN-2/RN-7).** `persistirAssinaturaLoja` só faz `.update({ billing_provider, provider_subscription_id, plano_id })` — `assinatura_status` não está no objeto. `cancelarAssinatura` chama `DELETE /v3/subscriptions/{id}` e retorna `{ ok: true }` **sem** UPDATE de status (não otimista). O status efetivo muda só quando o webhook (077) confirmar. Teste RED asevera que nenhuma action escreve `assinatura_status`.

**D4 — `atualizarMeioPagamentoAssinatura()` = URL, não dados de cartão (RN-11).** Retorna a URL de checkout/fatura hospedada do Asaas (campo da assinatura/payment) — dados de cartão **nunca** trafegam pelo iRango. Sem `provider_subscription_id` → erro genérico. PCI scope é do provider.

**D5 — Validação: zod `.strict()` com SÓ `plano_id`.** `schemaIniciarAssinatura`/`schemaTrocarPlano` aceitam só `{ plano_id: z.guid() }`; campo monetário não declarado → `.strict()` rejeita antes do código rodar. `cancelarAssinatura`/`atualizarMeioPagamentoAssinatura` não recebem payload (operam sobre a loja do `auth.uid()`).

**D6 — Provider via env `BILLING_PROVIDER` (default `'asaas'`).** A action chama `getBillingProvider(process.env.BILLING_PROVIDER ?? 'asaas')` — agnóstica. Nos testes RED o provider é **mockado** (não bate na rede Asaas real).

### Cenários

- **Caminho feliz `iniciarAssinatura`:** loja do dono existe → `plano_id` casa plano ativo → `provider.criarAssinatura({ value: planos.preco })` → persiste 3 colunas via service_role → `revalidatePath('/painel/configuracoes/assinatura')` + `toast` (na UI 081) → `{ ok: true }`. `assinatura_status` permanece o que estava (muda só no webhook).
- **Plano inativo/inexistente:** `buscarPlanoAtivo` → `null` → `{ ok: false, erro: 'Plano indisponível.' }` sem tocar o provider.
- **Usuário não-dono / sem loja / sessão expirada:** `buscarLojaDoDono` (client autenticado) → `null` (RLS) → `{ ok: false, erro: 'Loja não encontrada.' }`. Não há `loja_id` de payload para vazar entre lojas.
- **`plano_id` de outro dono:** irrelevante — `planos` é catálogo global (não tem `dono_id`); o que se valida é (i) posse da **loja** (do `auth.uid()`) e (ii) plano **ativo**. O teste "plano de outro dono" reduz-se a "loja não é do `auth.uid()`" → rejeitado por `buscarLojaDoDono` retornar `null`.
- **Valor adulterado pelo client:** `.strict()` rejeita o campo extra; mesmo que passasse, a action usa `planos.preco`. Preço cobrado = banco.
- **`trocarPlano` sem assinatura:** `provider_subscription_id` null → `{ ok: false, erro: 'Nenhuma assinatura ativa para trocar.' }` (a UI 081 só mostra "trocar" quando há assinatura).
- **`cancelarAssinatura` sem assinatura:** `provider_subscription_id` null → `{ ok: false, erro: 'Nenhuma assinatura para cancelar.' }`.
- **Race de duplo submit (iniciar 2x):** a action relê `provider_subscription_id` da loja; se já houver uma, retorna `{ ok: false, erro: 'Assinatura já iniciada.' }` sem tocar o provider (impede customer duplicado no Asaas — fecha o contra de D1-b). Trava forte de concorrência fica fora do escopo — `// TODO:` se virar problema.
- **Provider fora do ar / `ASAAS_API_KEY` ausente:** adapter lança → action `catch` → `console.error('[iniciarAssinatura]', e)` + `{ ok: false, erro: 'Não foi possível iniciar a assinatura. Tente novamente.' }` (genérico, §14). Nada persistido.

### Recálculo no Servidor (dinheiro)

| Campo | Cliente envia? | Servidor |
|---|---|---|
| `plano_id` | ✅ (único campo) | valida existe e `ativo=true` em `planos` |
| `preco`/`value`/qualquer valor | ❌ `.strict()` rejeita | lido EXCLUSIVAMENTE de `planos.preco` (RN-1), passado ao adapter como `value` |
| `assinatura_status` | ❌ nunca | não escrito por nenhuma action (RN-2) — só webhook |
| `provider_subscription_id` | ❌ nunca | gerado pelo provider, persistido via service_role |
| customer id Asaas | ❌ nunca | criado e descartado dentro do adapter (D1-b) |

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/lib/validacoes/assinatura.ts` — `schemaIniciarAssinatura`/`schemaTrocarPlano` (`z.object({ plano_id: z.guid() }).strict()`).
- `src/lib/supabase/queries/planos.ts` — `buscarPlanoAtivo(client, planoId)`.
- `src/lib/actions/assinatura.ts` — `'use server'`; `iniciarAssinatura`, `trocarPlano`, `atualizarMeioPagamentoAssinatura`, `cancelarAssinatura`.
- `src/lib/actions/assinatura.test.ts` — fase RED (esta entrega).

**Modificar (nível função):**
- `src/lib/billing/tipos.ts` — estender `BillingProvider` com `criarAssinatura`/`atualizarAssinatura`/`cancelarAssinatura`/`urlMeioPagamento`.
- `src/lib/billing/providers/asaas.ts` — implementar os 4 métodos (customer criado internamente); anexar ao `asaasProvider`.
- `src/lib/supabase/queries/lojas.ts` — `persistirAssinaturaLoja(client, lojaId, { billing_provider, provider_subscription_id, plano_id })` (UPDATE escopado por id, service_role).

**NÃO tocar:**
- `src/lib/database.types.ts` — já atualizado em 077 (`planos`/`pagamentos_assinatura`/colunas billing presentes). **Sem `asaas_customer_id` — proposital (D1).**
- `supabase/migrations/` — **nenhuma migration nova nesta issue** (D1-b reverte a coluna/trigger v3 do plano anterior).
- `lojas_protege_billing` v2 — não editar.
- Webhook `/api/webhooks/billing/[provider]` (077) — autoridade de status, fora desta issue.
- `src/lib/utils/assinatura.ts` — mapa de status/eventos é do webhook (077).
- `src/app/(painel)/.../assinatura/page.tsx` — UI é issue 081.

### Dependências Externas

- API Asaas v3 — `POST /v3/customers`, `POST /v3/subscriptions`, `POST /v3/subscriptions/{id}`, `DELETE /v3/subscriptions/{id}`. Docs: [criar assinatura](https://docs.asaas.com/reference/create-new-subscription), [criar cliente](https://docs.asaas.com/reference/create-new-customer), [remover assinatura](https://docs.asaas.com/reference/remove-subscription). `customer` é obrigatório na assinatura e `POST /v3/customers` **não é idempotente** (cabe à integração evitar duplicata — fechado pelo guard de double-init). Sem novo pacote npm — `fetch` nativo. Campos obrigatórios da assinatura: `customer`, `billingType`, `value`, `nextDueDate`, `cycle`.
- Envs server-only (sem `NEXT_PUBLIC_`): `ASAAS_API_KEY` (já referenciada no adapter), `ASAAS_API_BASE_URL` (sandbox vs prod), `BILLING_PROVIDER` (default `'asaas'`). Documentar em `.env.example`.

### Ordem de Implementação

Issue **crítica** → fase RED do `tdd` antes da GREEN. **Nenhuma migration / regeneração de types** (D1 + pré-condição 077).

1. **Validação** `assinatura.ts` (zod `.strict()`). Independente.
2. **Query** `buscarPlanoAtivo` + `persistirAssinaturaLoja`. Independente dos tipos (já atualizados).
3. **Adapter** (`tipos.ts` + `asaas.ts`): estender a interface e implementar os 4 métodos (customer interno).
4. **FASE RED (`tdd`) — `assinatura.test.ts`** (ESTA ENTREGA): plano inativo/inexistente falha; valor a mais ignorado (preço do banco); não-dono rejeitado; nenhuma action escreve `assinatura_status`; `cancelarAssinatura` não muda status local. Mocka `buscarLojaDoDono`/`buscarPlanoAtivo`/`persistirAssinaturaLoja`/`getBillingProvider`/`createServiceClient`/`createClient`. Confirmar vermelho real.
5. **FASE GREEN (`executar`)** — `src/lib/actions/assinatura.ts`: 4 actions, mínimo para passar; depois refatorar.
6. **`next build`** (mandato `use-server-export-constraint`).

### Checklist de Validação Pós-Implementação
- [ ] `next build` sem warnings novos (e sem export não-async em `'use server'`).
- [ ] `database.types.ts` NÃO foi modificado (já estava correto — D1).
- [ ] Nenhuma migration nova / trigger não tocado.
- [ ] RLS/trigger: UPDATE de `billing_provider`/`plano_id` via client autenticado recebe exception; via service_role passa (coberto por testes de migration 074).
- [ ] Preço cobrado = `planos.preco` do banco mesmo com `value` adulterado no payload (`.strict()` + recálculo).
- [ ] Nenhuma das 4 actions escreve `assinatura_status` (grep + teste).
- [ ] `cancelarAssinatura` não muda status local (só `DELETE` no provider).
- [ ] `ASAAS_API_KEY`/segredos sem `NEXT_PUBLIC_`; nenhum dado de cartão no servidor (RN-11); erro genérico ao usuário, detalhe só em `console.error`.
