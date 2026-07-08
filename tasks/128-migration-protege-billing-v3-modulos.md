# [128] Migration: estender `lojas_protege_billing()` às colunas de módulo (10→12)

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** [127]
**Spec:** specs/4-impressao-pedido.md

## Objetivo
Impedir no banco que o lojista autenticado ligue seu próprio módulo pago. Estender a
função `public.lojas_protege_billing()` para bloquear alterações de
`modulo_impressao_a4` e `modulo_impressao_termica` por qualquer role que não seja
`service_role`/`postgres`/`supabase_admin` (RN-M3). Backstop de banco, mesmo se o
filtro de código falhar.

## Escopo
- [ ] Nova migration `supabase/migrations/20260707121000_lojas_protege_billing_v3_modulos.sql`.
- [ ] **`CREATE OR REPLACE FUNCTION public.lojas_protege_billing()`** apenas — **NÃO**
  recriar o trigger `lojas_protege_billing_trg` (aponta por nome; espelhar exatamente a
  migration `20260621094000` / issue 074).
- [ ] Adicionar às checagens `is distinct from` (mantendo as 10 atuais):
  ```sql
  or new.modulo_impressao_a4      is distinct from old.modulo_impressao_a4
  or new.modulo_impressao_termica is distinct from old.modulo_impressao_termica
  ```
- [ ] Manter idênticos o bypass (`service_role`/`postgres`/`supabase_admin`), a mensagem
  de exceção e todas as 10 colunas já protegidas.
- [ ] Bloco de rollback comentado (reaplicar a função da 074, sem as 2 colunas novas).

## Fora de escopo
- Filtro de código `CAMPOS_LOJA_SOMENTE_SERVIDOR` (issue 129 — camada complementar).
- Colunas em si (issue 127).

## Reuso esperado
- Migration `20260621094000_lojas_protege_billing_v2.sql` (074) — mesmo esqueleto, aditivo.

## Segurança
- **RN-M3 (backstop de banco):** o dono autenticado que fizer
  `UPDATE lojas SET modulo_impressao_termica = true` via PostgREST direto recebe exceção.
  Camada independente do código (defesa em profundidade). Um bug aqui = lojista
  auto-habilita módulo pago → é o motivo da criticidade.
- `service_role` (webhook/admin) continua escrevendo as flags normalmente (bypass).

## Critério de aceite
- [ ] (RED-first) Teste pglite emulando role autenticado (dono): `UPDATE` que altera
  `modulo_impressao_a4` **ou** `modulo_impressao_termica` levanta exceção.
- [ ] (RED-first) Teste: `service_role` altera as mesmas colunas SEM erro (bypass intacto).
- [ ] (RED-first) Teste de regressão: as 10 colunas já protegidas continuam bloqueadas ao dono.
- [ ] Vermelho escrito e confirmado ANTES da migration; depois verde.
- [ ] `next build` + `vitest run` (incl. pglite) verdes.

## ⚠️ Desvio registrado (auditoria CRÍTICA)
A auditoria encontrou que o trigger v1/v2 era `BEFORE UPDATE` apenas — o INSERT direto
(`POST /rest/v1/lojas` por dono autenticado, ANTES do `garantir_loja_do_dono`) nascia
com módulo pago / `assinatura_status='ativa'` de graça (mass-assignment / BOPLA; gap
pré-existente v1/v2 que as flags de módulo herdaram). Fix aplicado NO MESMO CICLO:
`CREATE OR REPLACE FUNCTION` + `DROP/CREATE TRIGGER` para `BEFORE INSERT OR UPDATE` com
ramo INSERT default-aware (autor não-sistema só cria loja com billing nos defaults
seguros: trial/null/false). O "NÃO recriar o trigger" da issue foi sobreposto pela
correção crítica. Bypass service_role/postgres/supabase_admin intacto; `criarLoja(svc)`
e `garantirLojaDoDono` (SECURITY DEFINER) não quebram (grep confirmou: todo INSERT de
loja é server-side). Testes de regressão [128-9..12] adicionados. Suíte inteira 2263 verde.

## Plano Técnico

### Análise do Codebase

O que já existe e será REUSADO (nada novo além do `.sql` da migration e do teste RED):

- `supabase/migrations/20260621094000_lojas_protege_billing_v2.sql` (issue 074) — **esqueleto exato a espelhar**. Contém `create or replace function public.lojas_protege_billing()` com bypass de role + 10 comparações `is distinct from`. A v3 copia este arquivo e só acrescenta 2 comparações. NÃO recria o trigger.
- `supabase/migrations/20260614004500_lojas_protege_billing.sql` (issue 057) — define o trigger `lojas_protege_billing_trg` (`before update on public.lojas for each row`). Aponta para a função por NOME. **NÃO TOCAR** — é o motivo de a v3 usar só `CREATE OR REPLACE FUNCTION`.
- `supabase/migrations/20260707120000_lojas_modulos_impressao.sql` (issue 127, dependência) — adiciona as colunas `modulo_impressao_a4` e `modulo_impressao_termica` (`boolean not null default false`). Aplicada ANTES da v3 (timestamp menor), então as colunas existem quando o trigger v3 as referencia.
- `tests/migrations/trigger_protege_billing_v2.test.ts` — **harness de teste de role a reusar** pelo `tdd`. Padrão de dono autenticado × service_role, helpers `criarCenario`/`colAtual`/`tentarUpdateComoDono` e anti-falso-verde. Ver seção "Padrão de teste de role".
- `tests/helpers/pglite.ts` — `createTestDb()` aplica TODAS as migrations do diretório em ordem (sort por nome) + GRANTS. Expõe `asUser` (`set local role authenticated`) e `asService` (`set local role service_role bypassrls`). É a fonte de emulação de role.

O que precisa ser CRIADO:

- `supabase/migrations/20260707121000_lojas_protege_billing_v3_modulos.sql` — nova migration (só `CREATE OR REPLACE FUNCTION`).
- `tests/migrations/trigger_protege_billing_v3.test.ts` — teste RED (fase `tdd`).

**Confirmação de timestamp:** `20260707121000` está LIVRE. A última migration do diretório é `20260707120000_lojas_modulos_impressao.sql` (issue 127); `20260707121000` vem logo depois, na ordem correta.

### Camada de garantia (cliente ↔ servidor)

| Invariante | Onde é garantida |
|-----------|------------------|
| Dono autenticado NÃO liga `modulo_impressao_a4`/`_termica` via UPDATE direto (PostgREST) | **Trigger de banco `lojas_protege_billing_trg` → função `lojas_protege_billing()`** (esta issue). `current_user = 'authenticated'` → não está no bypass → `raise exception`. É o backstop de banco (RN-M3), independente do código. |
| `service_role` (webhook/admin) liga as flags | Bypass explícito no topo da função (`current_user in service_role/postgres/supabase_admin` → `return new`). |
| Escrita admin de perfil de loja não reabre a coluna por engano | Filtro de código `CAMPOS_LOJA_SOMENTE_SERVIDOR` — **issue 129, fora de escopo aqui** (camada complementar; ver Riscos). |

Não há valor monetário recalculado nem RLS nova nesta issue: a proteção é 100% no trigger de banco. A regra é enforced no servidor (função do trigger roda no Postgres), nunca no cliente.

### Esqueleto EXATO da migration (a produzir na fase GREIN/`execute`)

Espelha `20260621094000_lojas_protege_billing_v2.sql` byte a byte, adicionando só as 2 comparações e o cabeçalho/rollback atualizados. Notas de forma confirmadas na v2:
- **Sem `SECURITY DEFINER`** — é trigger function invoker (confirmado; roda como o autor). Não adicionar.
- **Sem `set search_path`** — a v2 não tem (débito conhecido em `seguranca.md` §1092, mas a restrição manda espelhar EXATAMENTE; NÃO introduzir aqui).
- **Detecção de role via `current_user`** (não `auth.role()`), comparado a `'service_role'`/`'postgres'`/`'supabase_admin'`.
- **Mensagem idêntica à v2:** `'colunas de billing/identidade são somente-servidor (use o webhook de billing)'`.
- Alinhamento das colunas por espaços (como na v2).

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- [128] lojas_protege_billing v3 — estende a proteção às flags de módulo pago
--
-- A issue 127 (20260707120000_lojas_modulos_impressao) adicionou à tabela `lojas`:
--   modulo_impressao_a4, modulo_impressao_termica (entitlement, boolean).
--
-- Como a RLS filtra LINHA e não COLUNA, a policy lojas_update_proprio concede ao
-- dono autenticado o UPDATE da linha inteira. Sem proteger essas flags, o lojista
-- faria, via PostgREST direto:
--     UPDATE lojas SET modulo_impressao_termica = true ...
-- e auto-habilitaria um módulo PAGO sem passar pelo billing (RN-M3) — burla de
-- cobrança. Backstop de banco independente do filtro de código (issue 129).
--
-- Correção (aditiva, retrocompatível): apenas SUBSTITUI a função do trigger
-- (CREATE OR REPLACE FUNCTION). O trigger lojas_protege_billing_trg já aponta para
-- public.lojas_protege_billing() por NOME — não é recriado. Bypass de
-- service_role/postgres/supabase_admin e as 10 colunas já protegidas permanecem
-- idênticos. O billing continua escrevendo as flags como service_role.
--
-- Rollback: reaplicar a função da migration 20260621094000 (v2, sem as duas flags
-- de módulo). Reversível a qualquer momento — não toca dados, só lógica do trigger.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.lojas_protege_billing()
returns trigger
language plpgsql
as $$
begin
  -- Autor é o sistema (webhook de billing via service_role, ou migrations/backfill).
  if current_user = 'service_role'
     or current_user = 'postgres'
     or current_user = 'supabase_admin' then
    return new;
  end if;

  -- Demais autores (dono autenticado etc.) não podem tocar billing/identidade.
  if new.assinatura_status         is distinct from old.assinatura_status
     or new.assinatura_inicio         is distinct from old.assinatura_inicio
     or new.assinatura_fim_periodo    is distinct from old.assinatura_fim_periodo
     or new.assinatura_atualizada_em  is distinct from old.assinatura_atualizada_em
     or new.hotmart_subscriber_code   is distinct from old.hotmart_subscriber_code
     or new.hotmart_plano             is distinct from old.hotmart_plano
     or new.dono_id                   is distinct from old.dono_id
     -- [074] colunas de billing (issue 073):
     or new.billing_provider          is distinct from old.billing_provider
     or new.provider_subscription_id  is distinct from old.provider_subscription_id
     or new.plano_id                  is distinct from old.plano_id
     -- [128] flags de módulo pago (issue 127) — RN-M3 backstop de banco:
     or new.modulo_impressao_a4       is distinct from old.modulo_impressao_a4
     or new.modulo_impressao_termica  is distinct from old.modulo_impressao_termica then
    raise exception 'colunas de billing/identidade são somente-servidor (use o webhook de billing)';
  end if;

  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (manual, fora da migration): reaplicar a função da v2 (074), sem as
-- duas flags de módulo — cola aqui o corpo de 20260621094000, terminando o `if`
-- em `... or new.plano_id is distinct from old.plano_id then`.
-- ─────────────────────────────────────────────────────────────────────────────
```

(10 colunas → 12. Bypass, mensagem e as 10 originais permanecem intactos.)

### Padrão de teste de role a reusar (fase RED / `tdd`)

Novo arquivo: `tests/migrations/trigger_protege_billing_v3.test.ts`, clonando o padrão de
`trigger_protege_billing_v2.test.ts`. Emulação de role (via `tests/helpers/pglite.ts`):

- **Dono autenticado:** `t.asUser(DONO_A, db => …)` → helper faz `set local role authenticated` +
  `set_config('request.jwt.claims', {sub, role:'authenticated'})`. Dentro do trigger,
  `current_user = 'authenticated'` → **fora do bypass** → deve levantar exceção.
- **service_role:** `t.asService(db => …)` → `set local role service_role` (BYPASSRLS) →
  `current_user = 'service_role'` → **no bypass** → escreve sem erro.
- **Anti-falso-verde:** toda leitura de verificação usa `colAtual(t, lojaId, col)` que lê via
  `asService` (BYPASSRLS = fonte de verdade). Bloqueio confirma valor intacto; permissão confirma
  valor persistido. Reusar `tentarUpdateComoDono` (retorna `{ bloqueou, affected }`;
  `bloqueou = exceção OU 0 linhas`).
- **Cenário:** reusar `criarCenario`/`garantirDonos` (cria loja A do DONO_A). Não precisa de plano.

RED genuíno **sem remoção temporária de migration** (diferente da 074): quando o `tdd` escreve o
teste, a migration v3 **ainda não existe**. O harness aplica até a 127 → colunas
`modulo_impressao_*` existem mas o trigger v2 NÃO as compara → o dono CONSEGUE o UPDATE
(`bloqueou === false`, 1 linha) → os testes que exigem `bloqueou === true` ficam **VERMELHOS**.
Ao `execute` adicionar a migration v3, o harness a aplica → vira **VERDE**. Registrar o output
vermelho real antes de escrever o `.sql`.

Casos de teste mínimos:
1. Dono NÃO pode `modulo_impressao_a4 = true` → bloqueou, valor segue `false`.
2. Dono NÃO pode `modulo_impressao_termica = true` → bloqueou, valor segue `false`.
3. Vetor de evasão: `set nome='x', modulo_impressao_termica=true` no mesmo UPDATE → bloqueia tudo; `nome` intacto, flag `false`.
4. Regressão: dono ainda bloqueado em `assinatura_status`/`plano_id` (uma das 10).
5. `service_role` PODE `modulo_impressao_a4 = true` e `modulo_impressao_termica = true` → persistiu (bypass intacto).
6. Dono PODE atualizar coluna comum (`nome`) → não over-block.

### Cenários

**Caminho feliz:** billing (service_role) faz `UPDATE lojas SET modulo_impressao_termica = true` → bypass → grava. Dono no painel altera perfil (nome, endereço, whatsapp) → colunas comuns passam normalmente.

**Casos de borda:**
- Dono tenta `UPDATE ... SET modulo_impressao_a4 = true` direto no PostgREST → exceção (RN-M3).
- Dono esconde a flag junto de coluna legítima no mesmo UPDATE → transação inteira falha (trigger é BEFORE UPDATE por linha).
- Dono faz UPDATE que NÃO toca as flags (grava o mesmo valor `false`) → `is distinct from` é falso → passa (não é over-block).
- `service_role` grava a mesma flag → bypass, sem erro.

**Tratamento de erros:** a exceção do trigger sobe como erro do Postgres. Mensagem NÃO é para o usuário final — a Server Action/PostgREST captura e o painel exibe erro genérico; o detalhe (`raise exception …`) fica só no log do servidor (`seguranca.md` §14). Nenhuma string sensível nova é introduzida.

### Schema de Banco

Sem alteração de schema. As colunas já existem (issue 127). Esta migration só troca o corpo da
função do trigger (`CREATE OR REPLACE FUNCTION`). **RLS:** nenhuma política nova — as flags caem
sob as policies existentes de `lojas`; o gate de coluna é o trigger, não RLS. Seed/`popular` não
precisa mudar (sem coluna nova).

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `supabase/migrations/20260707121000_lojas_protege_billing_v3_modulos.sql` — só `CREATE OR REPLACE FUNCTION` (esqueleto acima).
- `tests/migrations/trigger_protege_billing_v3.test.ts` — RED.

**NÃO tocar:**
- `supabase/migrations/20260614004500_lojas_protege_billing.sql` — cria o trigger `lojas_protege_billing_trg`. Recriar mudaria a assinatura por nada.
- `20260621094000_lojas_protege_billing_v2.sql` e `20260707120000_lojas_modulos_impressao.sql` — migrations imutáveis já aplicadas.
- `src/lib/actions/admin-loja.ts` (`CAMPOS_LOJA_SOMENTE_SERVIDOR`) — é a issue 129 (filtro de código). Fora de escopo.

### Dependências Externas

Nenhuma nova. Testes usam `@electric-sql/pglite` (já no `package.json` / `tests/helpers/pglite.ts`).

### Ordem de Implementação (crítica — TDD red-first)

1. **RED (`/tdd`):** escrever `tests/migrations/trigger_protege_billing_v3.test.ts`; rodar `vitest run` e capturar o vermelho real (dono consegue ligar a flag porque o trigger ainda é v2). NÃO criar o `.sql` antes.
2. **GREEN (`/execute`):** criar a migration `20260707121000_...v3_modulos.sql` (esqueleto acima); `vitest run` fica verde.
3. **Verde total:** `next build` + `vitest run` (incl. pglite).
4. Deploy da migration no cloud segue o protocolo de `MEMORY.md` (`migration repair` → `npx supabase db push`) — fora desta issue de código.
