-- ─────────────────────────────────────────────────────────────────────────────
-- [074] lojas_protege_billing v2 — estende a proteção às colunas novas de billing
--
-- A issue 073 (20260621093000_lojas_expand_billing) adicionou à tabela `lojas`:
--   billing_provider, provider_subscription_id, plano_id
--
-- Como a RLS filtra LINHA e não COLUNA, a policy lojas_update_proprio concede ao
-- dono autenticado o UPDATE da linha inteira. Sem proteger essas colunas, o lojista
-- faria, via PostgREST direto:
--     UPDATE lojas SET plano_id = <plano caro> / billing_provider = NULL ...
-- e auto-promoveria/trocaria de plano sem passar pelo webhook — vazamento de
-- autorização e burla de cobrança (§9, RN-2, RN-12).
--
-- Correção (aditiva, retrocompatível): apenas SUBSTITUI a função do trigger
-- (CREATE OR REPLACE FUNCTION). O trigger lojas_protege_billing_trg já aponta para
-- public.lojas_protege_billing() por NOME — não precisa ser recriado, e não o
-- recriamos para não alterar a assinatura existente. As colunas já protegidas
-- (assinatura_*, hotmart_*, dono_id) e o bypass de service_role/postgres/
-- supabase_admin permanecem idênticos. O webhook continua escrevendo billing como
-- service_role.
--
-- Rollback: reaplicar a função da migration 20260614004500 (versão sem as três
-- colunas novas). Reversível a qualquer momento — não toca dados, só lógica do
-- trigger. Janela segura: indefinida (sem alteração de schema).
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
     -- [074] colunas novas de billing (issue 073):
     or new.billing_provider          is distinct from old.billing_provider
     or new.provider_subscription_id  is distinct from old.provider_subscription_id
     or new.plano_id                  is distinct from old.plano_id then
    raise exception 'colunas de billing/identidade são somente-servidor (use o webhook de billing)';
  end if;

  return new;
end;
$$;
