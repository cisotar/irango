# Plano Técnico — [128] Migration: estender `lojas_protege_billing()` às colunas de módulo (10→12)

### Análise do Codebase

O que já existe e será REUSADO (nada novo além do `.sql` da migration e do teste RED):

- `supabase/migrations/20260621094000_lojas_protege_billing_v2.sql` (issue 074) — **esqueleto exato a espelhar**. Contém `create or replace function public.lojas_protege_billing()` com bypass de role + 10 comparações `is distinct from`. A v3 copia este arquivo e só acrescenta 2 comparações. NÃO recria o trigger.
- `supabase/migrations/20260614004500_lojas_protege_billing.sql` (issue 057) — define o trigger `lojas_protege_billing_trg` (`before update on public.lojas for each row`). Aponta para a função por NOME. **NÃO TOCAR** — é o motivo de a v3 usar só `CREATE OR REPLACE FUNCTION`.
- `supabase/migrations/20260707120000_lojas_modulos_impressao.sql` (issue 127, dependência) — adiciona as colunas `modulo_impressao_a4` e `modulo_impressao_termica` (`boolean not null default false`). Aplicada ANTES da v3 (timestamp menor), então as colunas existem quando o trigger v3 as referencia.
- `tests/migrations/trigger_protege_billing_v2.test.ts` — **harness de teste de role a reusar** pelo `tdd`. Padrão de dono autenticado × service_role, helpers `criarCenario`/`colAtual`/`tentarUpdateComoDono` e anti-falso-verde.
- `tests/helpers/pglite.ts` — `createTestDb()` aplica TODAS as migrations do diretório em ordem (sort por nome) + GRANTS. Expõe `asUser` (`set local role authenticated`) e `asService` (`set local role service_role bypassrls`). É a fonte de emulação de role.

O que precisa ser CRIADO:

- `supabase/migrations/20260707121000_lojas_protege_billing_v3_modulos.sql` — nova migration (só `CREATE OR REPLACE FUNCTION`).
- `tests/migrations/trigger_protege_billing_v3.test.ts` — teste RED (fase `tdd`).

**Confirmação de timestamp:** `20260707121000` está LIVRE. A última migration do diretório é `20260707120000_lojas_modulos_impressao.sql` (issue 127); `20260707121000` vem logo depois, na ordem correta.

### Camada de garantia (cliente ↔ servidor)

| Invariante | Onde é garantida |
|-----------|------------------|
| Dono autenticado NÃO liga `modulo_impressao_a4`/`_termica` via UPDATE direto (PostgREST) | **Trigger de banco `lojas_protege_billing_trg` → função `lojas_protege_billing()`** (esta issue). `current_user = 'authenticated'` → não está no bypass → `raise exception`. Backstop de banco (RN-M3), independente do código. |
| `service_role` (webhook/admin) liga as flags | Bypass explícito no topo da função (`current_user in service_role/postgres/supabase_admin` → `return new`). |
| Escrita admin de perfil de loja não reabre a coluna por engano | Filtro de código `CAMPOS_LOJA_SOMENTE_SERVIDOR` — **issue 129, fora de escopo aqui** (camada complementar; ver Riscos). |

Não há valor monetário recalculado nem RLS nova nesta issue: a proteção é 100% no trigger de banco (roda no Postgres, nunca no cliente).

### Esqueleto EXATO da migration (fase GREEN / `execute`)

Espelha `20260621094000_lojas_protege_billing_v2.sql`, adicionando só as 2 comparações e o cabeçalho/rollback atualizados. Notas de forma confirmadas na v2:
- **Sem `SECURITY DEFINER`** — trigger function invoker (roda como o autor). Não adicionar.
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

- **Dono autenticado:** `t.asUser(DONO_A, db => …)` → `set local role authenticated` +
  `set_config('request.jwt.claims', {sub, role:'authenticated'})`. No trigger,
  `current_user = 'authenticated'` → **fora do bypass** → deve levantar exceção.
- **service_role:** `t.asService(db => …)` → `set local role service_role` (BYPASSRLS) →
  `current_user = 'service_role'` → **no bypass** → escreve sem erro.
- **Anti-falso-verde:** verificação sempre por `colAtual(t, lojaId, col)` (lê via `asService`,
  BYPASSRLS = fonte de verdade). Bloqueio → valor intacto; permissão → valor persistido.
  Reusar `tentarUpdateComoDono` (retorna `{ bloqueou, affected }`; `bloqueou = exceção OU 0 linhas`).
- **Cenário:** reusar `criarCenario`/`garantirDonos` (loja A do DONO_A). Não precisa de plano.

RED genuíno **sem remoção temporária de migration** (diferente da 074): quando o `tdd` escreve o
teste, a migration v3 **ainda não existe**. O harness aplica até a 127 → colunas
`modulo_impressao_*` existem mas o trigger v2 NÃO as compara → o dono CONSEGUE o UPDATE
(`bloqueou === false`, 1 linha) → os testes que exigem `bloqueou === true` ficam **VERMELHOS**.
Ao `execute` adicionar a migration v3, vira **VERDE**. Registrar o output vermelho real antes do `.sql`.

Casos de teste mínimos:
1. Dono NÃO pode `modulo_impressao_a4 = true` → bloqueou, valor segue `false`.
2. Dono NÃO pode `modulo_impressao_termica = true` → bloqueou, valor segue `false`.
3. Vetor de evasão: `set nome='x', modulo_impressao_termica=true` no mesmo UPDATE → bloqueia tudo; `nome` intacto, flag `false`.
4. Regressão: dono ainda bloqueado em `assinatura_status`/`plano_id` (uma das 10).
5. `service_role` PODE ligar `modulo_impressao_a4` e `modulo_impressao_termica` → persistiu (bypass intacto).
6. Dono PODE atualizar coluna comum (`nome`) → não over-block.

### Cenários

**Caminho feliz:** billing (service_role) `UPDATE lojas SET modulo_impressao_termica = true` → bypass → grava. Dono altera perfil (nome, endereço, whatsapp) → colunas comuns passam.

**Casos de borda:**
- Dono tenta `UPDATE ... SET modulo_impressao_a4 = true` direto no PostgREST → exceção (RN-M3).
- Dono esconde a flag junto de coluna legítima no mesmo UPDATE → transação inteira falha (trigger BEFORE UPDATE por linha).
- Dono faz UPDATE sem tocar as flags (mesmo valor `false`) → `is distinct from` falso → passa (não é over-block).
- `service_role` grava a mesma flag → bypass, sem erro.

**Tratamento de erros:** a exceção do trigger sobe como erro do Postgres; NÃO é para o usuário final — a Server Action/PostgREST captura e o painel exibe erro genérico; o detalhe fica só no log do servidor (`seguranca.md` §14). Nenhuma string sensível nova introduzida.

### Schema de Banco

Sem alteração de schema (colunas já existem, issue 127). A migration só troca o corpo da função
(`CREATE OR REPLACE FUNCTION`). **RLS:** nenhuma política nova — o gate de coluna é o trigger, não
RLS. Seed/`popular` não muda (sem coluna nova).

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `supabase/migrations/20260707121000_lojas_protege_billing_v3_modulos.sql` — só `CREATE OR REPLACE FUNCTION` (esqueleto acima).
- `tests/migrations/trigger_protege_billing_v3.test.ts` — RED.

**NÃO tocar:**
- `supabase/migrations/20260614004500_lojas_protege_billing.sql` — cria o trigger `lojas_protege_billing_trg`.
- `20260621094000_lojas_protege_billing_v2.sql` e `20260707120000_lojas_modulos_impressao.sql` — migrations imutáveis já aplicadas.
- `src/lib/actions/admin-loja.ts` (`CAMPOS_LOJA_SOMENTE_SERVIDOR`) — issue 129 (filtro de código). Fora de escopo.

### Dependências Externas

Nenhuma nova. Testes usam `@electric-sql/pglite` (já no `package.json` / `tests/helpers/pglite.ts`).

### Ordem de Implementação (crítica — TDD red-first)

1. **RED (`/tdd`):** escrever `tests/migrations/trigger_protege_billing_v3.test.ts`; rodar `vitest run` e capturar o vermelho real (dono consegue ligar a flag porque o trigger ainda é v2). NÃO criar o `.sql` antes.
2. **GREEN (`/execute`):** criar `20260707121000_...v3_modulos.sql` (esqueleto acima); `vitest run` fica verde.
3. **Verde total:** `next build` + `vitest run` (incl. pglite).
4. Deploy da migration no cloud segue o protocolo de `MEMORY.md` (`migration repair` → `npx supabase db push`) — fora desta issue de código.

### Riscos

- **Drift trigger ↔ `CAMPOS_LOJA_SOMENTE_SERVIDOR` (issue 129):** `seguranca.md` §1094 registra que a constante TS espelha manualmente as colunas do trigger e não há teste que force as duas listas a andarem juntas. Esta issue eleva o trigger para 12 colunas; enquanto a 129 não atualizar a constante, a allowlist de código fica atrás do banco (o banco protege, o código ainda não). Mitigado pela ordem 128→129 e por serem camadas independentes (o trigger sozinho já é o backstop primário).
- **Fidelidade ao esqueleto:** qualquer desvio de forma (adicionar `SET search_path`/`SECURITY DEFINER`, mudar a mensagem, reordenar/realinhar colunas ou recriar o trigger) viola a restrição travada. O executor deve espelhar a v2 e apenas somar as 2 linhas.
- **`current_user` vs `current_role`:** `seguranca.md` diz "verifica current_role", mas o código real usa `current_user` (equivalentes no Postgres para o papel efetivo). Manter `current_user` como na v2 — não "corrigir" para `current_role`.
