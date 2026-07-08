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
-- ── FIX AUDITORIA 128 (INSERT também protegido) ──────────────────────────────
-- O trigger v1/v2 era só BEFORE UPDATE. A policy `lojas_insert_proprio` concede
-- INSERT ao dono autenticado (WITH CHECK auth.uid() = dono_id, SEM guarda de
-- coluna), e a loja NEM SEMPRE já existe: um usuário recém-cadastrado (JWT
-- `authenticated` válido) pode, ANTES de o app auto-provisionar sua loja via
-- `garantir_loja_do_dono` (service_role), fazer POST /rest/v1/lojas com
-- modulo_impressao_*/assinatura_status já setados — nascendo com módulo pago /
-- assinatura ativa DE GRAÇA. O `garantir_loja_do_dono` posterior é idempotente
-- (no-op) e devolve a loja forjada. Vetor confirmado empiricamente na auditoria.
-- Correção: o trigger passa a cobrir BEFORE INSERT OR UPDATE; no INSERT por autor
-- NÃO-sistema, as colunas de billing/identidade só podem nascer nos DEFAULTS
-- seguros (trial / null / false). Fecha o mesmo vetor no caminho de criação.
--
-- Caminhos legítimos de criação de loja NÃO quebram: `garantir_loja_do_dono`
-- (SECURITY DEFINER, owner postgres) e `criarLoja(svc, ...)` (service_role) caem
-- no bypass (current_user postgres/service_role). Seed e migrations rodam como
-- postgres. Só o INSERT direto por `authenticated`/`anon` (sem uso legítimo no
-- app) é filtrado — e mesmo esse só é BLOQUEADO se tentar setar billing.
--
-- Correção (aditiva, retrocompatível): SUBSTITUI a função do trigger
-- (CREATE OR REPLACE FUNCTION) e RECRIA o trigger para incluir o evento INSERT.
-- Bypass de service_role/postgres/supabase_admin e as 10 colunas já protegidas no
-- UPDATE permanecem idênticos. O billing continua escrevendo as flags como
-- service_role.
--
-- Rollback: reaplicar a função + trigger da migration 20260621094000 (v2, só
-- BEFORE UPDATE, sem as duas flags de módulo). Reversível a qualquer momento —
-- não toca dados, só lógica do trigger.
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
       or new.modulo_impressao_termica  is distinct from false then
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
     or new.modulo_impressao_termica  is distinct from old.modulo_impressao_termica then
    raise exception 'colunas de billing/identidade são somente-servidor (use o webhook de billing)';
  end if;

  return new;
end;
$$;

-- Recria o trigger para cobrir também o evento INSERT (antes era só UPDATE).
-- Idempotente: drop-if-exists + create. Aponta para a mesma função por NOME.
drop trigger if exists lojas_protege_billing_trg on public.lojas;
create trigger lojas_protege_billing_trg
  before insert or update on public.lojas
  for each row
  execute function public.lojas_protege_billing();

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (manual, fora da migration): reaplicar a função + trigger da v2 (074),
-- só BEFORE UPDATE, sem as duas flags de módulo — cola o corpo de 20260621094000
-- e recria o trigger `before update on public.lojas`.
-- ─────────────────────────────────────────────────────────────────────────────
