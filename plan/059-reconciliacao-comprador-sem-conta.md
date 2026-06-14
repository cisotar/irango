## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado (não recriar):**

- `src/lib/utils/assinatura.ts`
  - `eventoParaStatus(evento, statusAtual): { status, renova } | { ignorar: true }` — mapa evento lógico → estado. Reusado tal qual no fold de reconciliação. Note: depende SÓ do evento (não do statusAtual), o que torna o fold trivial e idempotente.
  - `StatusAssinatura`, `EventoHotmart` — types reusados.
- `src/lib/utils/hotmart.ts` (funções puras de adaptação do contrato externo)
  - `mapearEventoHotmart(nomeExterno): EventoLogico | null` — traduz o nome externo armazenado em `webhook_eventos_hotmart.evento_tipo` (ex.: `PURCHASE_APPROVED`) para o nome lógico. Reusado.
  - `calcularFimPeriodo(payloadFim, agora): Date` — reusado para derivar `fim_periodo` quando o evento renova.
- `src/lib/supabase/queries/webhookHotmart.ts`
  - `aplicarStatusAssinatura(svc, lojaId, dados)` — ÚNICO caminho legítimo de escrita de `assinatura_*` (service_role + trigger `lojas_protege_billing_trg`). Reusado para aplicar o estado final.
  - `vincularLojaAoEvento(svc, eventoId, lojaId)` — UPDATE `webhook_eventos_hotmart.loja_id = lojaId`. Reusado como marcação de "reconciliado" (ver decisão abaixo).
- `src/lib/supabase/service.ts` — `createServiceClient()` (server-only, BYPASSRLS). Reusado.
- `src/lib/actions/auth.ts` — `cadastrar()`. Ponto de integração: já roda `svc = createServiceClient()` e tem o `email` autenticado e o `lojaId` após `criarLoja`. Já há a nota explícita "reconciliação fica p/ issue 059" em `buscarLojaPorEmailDono`.
- `src/app/api/webhooks/hotmart/route.ts` — referência de como derivar `dados` (subscriber_code, plano, proximaCobranca) a partir do `payload` bruto via `extrairDadosAssinatura`. O extrator hoje é função privada do route; ver "Arquivos" para a decisão de extração.

**O que precisa ser criado (justificado):**

- `buscarEventosOrfaosPorEmail(svc, email)` em `webhookHotmart.ts` — NÃO existe query que leia eventos por `email_comprador` com `loja_id IS NULL`. Toda leitura de Supabase passa por `lib/supabase/queries/` (architecture.md §8 / seguranca.md). Inline em `reconciliar.ts` violaria a regra.
- `src/lib/assinatura/reconciliar.ts` — orquestração nova (fold de eventos órfãos → estado → apply). Não há nada equivalente.

### Decisão: marcar "reconciliado" — coluna nova vs. derivação (SEM migration)

**Decisão: NÃO criar coluna nem migration.** A coluna `webhook_eventos_hotmart.loja_id` (já existente, `NULL` para evento órfão por design — ver `schema_inicial.sql` linha 170 e comentário do spec "null se ainda não reconciliado") É o marcador de reconciliação.

- Evento órfão (registrado, não aplicado) = `loja_id IS NULL`.
- Reconciliar = `vincularLojaAoEvento(svc, eventoId, lojaId)` (função já existente) → `loja_id` deixa de ser NULL.
- Critério de não-reprocessamento: a busca filtra `loja_id IS NULL AND lower(email_comprador) = lower(email)`. Após reconciliar, os eventos têm `loja_id` setado e não voltam à busca → idempotência estrutural.

Justificativa de não migrar: adicionar `reconciliado_em`/`reconciliado bool` duplicaria a semântica que `loja_id IS NULL` já carrega (o spec define essa coluna exatamente assim) e exigiria migration + regen de types — custo sem ganho. O mesmo `loja_id` serve auditoria (qual loja recebeu o efeito) e gate de reprocesso.

### Assinatura da função

```
// src/lib/assinatura/reconciliar.ts  (import "server-only")
export async function reconciliarAssinaturaPendente(
  svc: SupabaseClient<Database>,   // service_role injetado pelo caller (mesmo padrão das queries)
  email: string,                    // do usuário autenticado (auth.users) — NUNCA do payload do client
  lojaId: string,                   // loja recém-criada
): Promise<void>                     // best-effort; o caller (cadastro) faz try/catch e não quebra
```

Recebe o client por parâmetro (padrão "client injetado" de `queries/`), não cria client nem lê env. `import "server-only"` no topo.

### Nova query

```
// webhookHotmart.ts
export type EventoOrfao = {
  evento_id: string;
  evento_tipo: string | null;   // nome EXTERNO Hotmart (ex.: PURCHASE_APPROVED)
  payload: <jsonb>;             // bruto, para derivar subscriber_code/plano/proximaCobranca
  processado_em: string;        // ordenação cronológica
};

export async function buscarEventosOrfaosPorEmail(
  svc: Client,
  email: string,
): Promise<EventoOrfao[]>
// SELECT evento_id, evento_tipo, payload, processado_em
//   FROM webhook_eventos_hotmart
//  WHERE loja_id IS NULL AND lower(email_comprador) = lower($email)
//  ORDER BY processado_em ASC
// Escopo manual (service_role bypassa RLS). Propaga error do PostgREST.
```
Normalização: o caller normaliza `email` (lower/trim) e a query também aplica `lower()` no filtro (defesa: eventos podem ter sido gravados com casing variado — o webhook já normaliza, mas a query não confia nisso).

### Fluxo de `reconciliarAssinaturaPendente`

1. `email = email.trim().toLowerCase()`.
2. `orfaos = await buscarEventosOrfaosPorEmail(svc, email)`.
3. Se `orfaos.length === 0` → **return** (loja segue trial; nada a fazer).
4. **Fold em ordem cronológica** (`processado_em ASC`): para cada evento, `logico = mapearEventoHotmart(evento.evento_tipo)`; se `null` → ignora (evento desconhecido). `resultado = eventoParaStatus(logico, estadoCorrente.status)`; se `ignorar` → pula. Acumula o estado: `status`, e quando `renova` for true, `fim_periodo = calcularFimPeriodo(proximaCobranca, agora)` e (na 1ª ativação, sem `inicio` ainda) `inicio = agora`; guarda `subscriber_code`/`plano` do evento mais recente que os trouxer.
   - Resultado: o **estado final** reflete a sequência real (compra→cancelamento = cancelada; compra→reembolso = suspensa; só reembolso órfão = suspensa). Ver "Múltiplos eventos" abaixo.
5. Se nenhum evento relevante (todos ignorados/desconhecidos) → vincula os eventos à loja mesmo assim (auditoria) e **não** aplica status (loja segue trial). [decisão: vincular evita reprocesso de evento desconhecido a cada novo login/cadastro — mas como reconciliação só roda no cadastro, é opcional; preferir vincular para fechar o ciclo].
6. `await aplicarStatusAssinatura(svc, lojaId, estadoFinal)` — UMA escrita com o estado consolidado.
7. `for (evento of orfaos) await vincularLojaAoEvento(svc, evento.evento_id, lojaId)` — marca todos como reconciliados (loja_id setado).

Aplicar UMA vez o estado final (em vez de aplicar evento-a-evento) evita escritas intermediárias e é naturalmente idempotente.

### Idempotência e ordem de múltiplos eventos

- **Idempotência:** rodar 2x. 1ª rodada: vincula `loja_id` em todos os órfãos. 2ª rodada: `buscarEventosOrfaosPorEmail` retorna `[]` (todos já têm `loja_id`) → no-op. Estado não regride nem duplica.
- **Ordem (compra + cancelamento):** fold em `processado_em ASC` → estado final = `cancelada` (com `fim_periodo` da compra preservado → carência correta). `assinaturaPermiteAcesso(cancelada, fim, agora)` mantém acesso até o fim do período pago.
- **Reembolso órfão (loja nasce suspensa?):** SIM — aplicar o estado REAL. Reembolso → `suspensa` (corte imediato, RN-A4). Trial NÃO vence reembolso: o webhook é a autoridade de billing (RN-A1); se o comprador foi reembolsado antes de se cadastrar, a loja não deve ganhar trial gratuito. A loja nasce `trial` no INSERT e a reconciliação a rebaixa para `suspensa` — comportamento correto (não há acesso indevido).
- **Sem evento órfão:** loja permanece `trial` (estado do INSERT). Reconciliação retorna cedo no passo 3.

### Integração no cadastro (015)

Em `src/lib/actions/auth.ts`, dentro do `try`, **após** `criarLoja` retornar a loja, antes do `return { ok: true }`:

```
const loja = await criarLoja(svc, { ... });   // criarLoja já retorna LojaCompleta
try {
  await reconciliarAssinaturaPendente(svc, email, loja.id);
} catch (e) {
  console.error("[cadastrar] reconciliacao falhou (best-effort)", e);
  // NÃO propaga: cadastro concluído; loja segue trial até reconciliar no futuro.
}
return { ok: true };
```

- `email` vem de `parsed.data` (validado, do signUp autenticado) — não de campo arbitrário. Atende RN-A1: vínculo por email só é confiável porque o email é o da sessão/auth, não input forjável.
- Best-effort: falha de rede na reconciliação NÃO derruba o cadastro (loja já existe, trial vigente). Reconciliação pode ser re-tentada (idempotente) — mas como hoje só roda no cadastro, a falha aqui significa "fica trial até intervenção/novo evento"; aceitável para MVP (documentar como dívida: gancho de re-tentativa fora de escopo).

### Segurança (camada server-side por invariante)

| Invariante | Onde é garantida |
|-----------|------------------|
| Ler `webhook_eventos_hotmart` (deny-all RLS, PII) | Só `service_role` (BYPASSRLS) — `svc` injetado, nunca anon/authenticated. `reconciliar.ts` é `server-only`. |
| Escrever `assinatura_*` na loja | `aplicarStatusAssinatura` via service_role → passa pelo trigger `lojas_protege_billing_trg`; nenhum outro role escreve (RN-A5). |
| Vínculo por email só do email autenticado | `email` vem do `signUp`/`auth.users`, nunca do payload do client. `cadastrar` usa `parsed.data.email`. (RN-A1) |
| Não reivindicar evento de outro email | Filtro `lower(email_comprador) = lower(email)`; email diferente → 0 órfãos → nada reconciliado. |
| Estado de billing autoritativo só do webhook/eventos | Reconciliação só TRADUZ eventos já gravados pelo webhook (RN-A1) — não inventa estado. |

Tratamento de erro (seguranca.md §14): `reconciliar.ts` propaga `error` do PostgREST (padrão das queries); o caller (`cadastrar`) faz `console.error` no servidor e não vaza detalhe ao client (cadastro retorna `{ ok: true }` mesmo com reconciliação falha).

### Schema de Banco

Sem mudança. Usa `webhook_eventos_hotmart` (já existe, RLS deny-all = estado final correto) e `lojas` (colunas `assinatura_*` já existem). Nenhuma migration, nenhuma policy nova, nenhum regen de types.

### Cenários

**Caminho feliz:** comprador paga (webhook grava evento `PURCHASE_APPROVED` com `loja_id NULL`) → comprador se cadastra com mesmo email → `cadastrar` cria loja trial → `reconciliarAssinaturaPendente` acha 1 órfão → fold → `ativa` (com `inicio`/`fim_periodo`/`subscriber_code`/`plano`) → `aplicarStatusAssinatura` → `vincularLojaAoEvento`. Loja nasce efetivamente `ativa`.

**Casos de borda:**
- Sem órfão → loja segue `trial`.
- Email diferente do evento → 0 órfãos → nada reconciliado, loja `trial`.
- Múltiplos eventos (compra + cancelamento) → estado final `cancelada`, `fim_periodo` preservado.
- Reembolso/chargeback órfão → `suspensa` (corte imediato; trial não prevalece).
- Evento de tipo desconhecido (`evento_tipo` fora do mapa) → ignorado no fold; vinculado para auditoria; loja `trial` se for o único.
- Rodar 2x → 2ª rodada não acha órfão → no-op.
- Falha de rede na reconciliação → cadastro conclui (best-effort), loja `trial`.

**Tratamento de erros:** detalhe só em `console.error` no servidor; cadastro nunca falha por causa da reconciliação.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/lib/assinatura/reconciliar.ts` — `reconciliarAssinaturaPendente` (server-only).
- `tests/migrations/reconciliacao_assinatura.test.ts` — fase RED (pglite, camada SQL/RLS) + camada de unidade do fold.

**Modificar:**
- `src/lib/supabase/queries/webhookHotmart.ts` — adicionar `buscarEventosOrfaosPorEmail` + type `EventoOrfao`.
- `src/lib/actions/auth.ts` — chamar `reconciliarAssinaturaPendente` após `criarLoja` (best-effort try/catch). Capturar o retorno de `criarLoja` em `const loja`.

**NÃO tocar:**
- `src/lib/utils/assinatura.ts`, `src/lib/utils/hotmart.ts` — reuso puro, sem alteração.
- `webhookHotmart.aplicarStatusAssinatura` / `vincularLojaAoEvento` — reuso sem alteração.
- `src/app/api/webhooks/hotmart/route.ts` — webhook é 057, fora de escopo.
- Migrations / `database.types.ts` — sem mudança de schema.

**Decisão sobre o extrator de `subscriber_code`/`plano`/`proximaCobranca`:** hoje é privado em `route.ts` (`extrairDadosAssinatura`). Para a reconciliação derivar os mesmos campos do `payload` bruto sem duplicar, extrair `extrairDadosAssinatura` para `src/lib/utils/hotmart.ts` (funções puras de adaptação já vivem lá) e reusar tanto no route quanto em `reconciliar.ts`. Alternativa mínima (se evitar mexer no route): reconciliar grava só `status` (+ `fim_periodo`/`inicio` via `calcularFimPeriodo`) e deixa `subscriber_code`/`plano` nulos até a próxima recorrência atualizar — aceitável, mas perde dado de auditoria. **Preferir a extração para `hotmart.ts`** (DRY, sem reinventar).

### Dependências Externas

Nenhuma nova. Tudo com supabase-js + libs já no projeto.

### Ordem de Implementação (crítica → RED primeiro)

1. **`/tdd` (RED):** escrever `tests/migrations/reconciliacao_assinatura.test.ts` cobrindo: (a) evento órfão `PURCHASE_APPROVED` + email igual → após reconciliar, loja `ativa` e evento ganha `loja_id`; (b) email diferente → nada reconciliado; (c) idempotência (rodar 2x não muda além do correto); (d) ordem (compra+cancelamento → `cancelada`); (e) reembolso órfão → `suspensa`; (f) sem evento → `trial`. Confirmar vermelho (import de `reconciliar.ts`/query inexistente falha) com output real. PARAR.
2. **`/execute` (GREEN):** `buscarEventosOrfaosPorEmail` → extrair `extrairDadosAssinatura` para `hotmart.ts` → `reconciliar.ts` → integrar em `auth.ts`. Mínimo para passar, depois refatorar.

### Cenários RED (para o `tdd`)

- Camada SQL/RLS (pglite, padrão de `tests/migrations/queries_lojas.test.ts`): provar que a busca de órfãos só funciona sob service_role e filtra por `loja_id IS NULL` + `lower(email)`; que `aplicarStatusAssinatura` (via SQL equivalente sob service_role) escreve `assinatura_status` e que o estado final do fold corresponde à sequência de eventos.
- Camada de unidade: o fold `eventoParaStatus`/`mapearEventoHotmart` sobre uma lista de eventos órfãos produz o estado final esperado (compra→ativa; compra+cancelamento→cancelada; reembolso→suspensa; desconhecido→ignorado; vazio→sem efeito).
- Anti-falso-verde: toda negação por RLS reconferida via service_role (a linha existe; a negação é por policy, não por dado ausente) — mesmo padrão de `rls_lojas.test.ts`.
