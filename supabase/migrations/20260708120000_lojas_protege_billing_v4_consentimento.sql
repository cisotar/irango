-- ─────────────────────────────────────────────────────────────────────────────
-- lojas_protege_billing v4 — estende a proteção às colunas de consentimento LGPD
--
-- ── FIX PENTEST ÁREA 3 (consentimento somente-servidor no BANCO) ──────────────
-- As colunas `consentimento_versao` / `consentimento_em` (registro da prova legal
-- LGPD) eram protegidas SÓ por código — a allowlist CAMPOS_LOJA_SOMENTE_SERVIDOR
-- em src/lib/actions/admin-loja.ts, que só roda dentro de `atualizarLoja`. Como a
-- policy RLS `lojas_update_proprio` concede ao dono autenticado o UPDATE da LINHA
-- INTEIRA, e a anon key + o JWT do lojista permitem falar com o PostgREST DIRETO
-- (sem passar por nenhuma Server Action), o dono reescrevia o próprio consentimento:
--     PATCH /rest/v1/lojas?id=eq.<propria>
--       { "consentimento_versao": "FORJADO", "consentimento_em": "2000-01-01" }
-- → backdata / forja o consentimento, quebrando integridade e não-repúdio da prova
-- legal LGPD. Vetor confirmado empiricamente no pglite. O banco (trigger) é a
-- última linha de defesa; a allowlist de código não é, porque o cliente tem a key.
--
-- Correção (aditiva, retrocompatível, como a v3 fez sobre a v2): SUBSTITUI a função
-- do trigger (CREATE OR REPLACE FUNCTION) e RECRIA o trigger. O bypass de
-- service_role/postgres/supabase_admin e as 12 colunas de billing/identidade já
-- protegidas permanecem IDÊNTICOS. Somam-se `consentimento_versao` /
-- `consentimento_em`:
--   • INSERT (autor não-sistema): as duas colunas só podem nascer no DEFAULT seguro
--     (NULL — ambas nullable sem default). Dono legítimo nunca cria a própria loja
--     via INSERT direto: a criação legítima é `garantir_loja_do_dono` (service_role,
--     cai no bypass e continua gravando o consentimento). Cobre C-4.
--   • UPDATE (autor não-sistema): não pode TOCAR as duas colunas (NEW vs OLD).
--     Cobre C-1, C-2, C-3.
-- Mantém o estilo da função (qualifica objetos por schema; NÃO declara search_path).
--
-- Rollback: reaplicar a função + trigger da v3 (20260707121000), sem as duas
-- colunas de consentimento. Reversível a qualquer momento — não toca dados, só
-- lógica do trigger.
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

  -- ── INSERT: OLD não existe. Autor não-sistema (dono autenticado) só pode CRIAR
  --    a loja com billing/identidade nos DEFAULTS seguros — não pode nascer com
  --    módulo pago ligado nem assinatura ativa. Fecha, no caminho de criação, o
  --    mesmo vetor que o UPDATE fecha na edição (auditoria 128). Defaults espelham
  --    o schema: assinatura_status 'trial'; hotmart_*/billing_*/plano_id/assinatura_
  --    inicio/fim/atualizada_em NULL; modulo_impressao_* false. `dono_id` não é
  --    checado aqui — a policy lojas_insert_proprio já o amarra a auth.uid().
  if tg_op = 'INSERT' then
    if new.assinatura_status         is distinct from 'trial'
       or new.assinatura_inicio         is not null
       or new.assinatura_fim_periodo    is not null
       or new.assinatura_atualizada_em  is not null
       or new.hotmart_subscriber_code   is not null
       or new.hotmart_plano             is not null
       or new.billing_provider          is not null
       or new.provider_subscription_id  is not null
       or new.plano_id                  is not null
       or new.modulo_impressao_a4       is distinct from false
       or new.modulo_impressao_termica  is distinct from false
       -- consentimento LGPD — backstop de banco (pentester ÁREA 3):
       or new.consentimento_versao      is not null
       or new.consentimento_em          is not null then
      raise exception 'colunas de billing/identidade são somente-servidor (use o webhook de billing)';
    end if;
    return new;
  end if;

  -- ── UPDATE: autor não-sistema (dono autenticado etc.) não pode TOCAR billing/
  --    identidade (compara NEW vs OLD).
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
     or new.modulo_impressao_termica  is distinct from old.modulo_impressao_termica
     -- consentimento LGPD — backstop de banco (pentester ÁREA 3):
     or new.consentimento_versao      is distinct from old.consentimento_versao
     or new.consentimento_em          is distinct from old.consentimento_em then
    raise exception 'colunas de billing/identidade são somente-servidor (use o webhook de billing)';
  end if;

  return new;
end;
$$;

-- Recria o trigger (idempotente: drop-if-exists + create). Cobre BEFORE INSERT OR
-- UPDATE, como a v3. Aponta para a mesma função por NOME.
drop trigger if exists lojas_protege_billing_trg on public.lojas;
create trigger lojas_protege_billing_trg
  before insert or update on public.lojas
  for each row
  execute function public.lojas_protege_billing();

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (manual, fora da migration): reaplicar a função + trigger da v3
-- (20260707121000_lojas_protege_billing_v3_modulos.sql), sem as duas colunas de
-- consentimento — cola o corpo v3 e recria o trigger `before insert or update`.
-- ─────────────────────────────────────────────────────────────────────────────
