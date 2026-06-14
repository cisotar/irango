-- FIX CRÍTICO (auditoria 057): proteger colunas de billing/identidade de lojas.
--
-- A RLS filtra LINHA, não COLUNA. A policy lojas_update_proprio concede UPDATE
-- da linha inteira ao dono autenticado — então o lojista, via PostgREST direto,
-- poderia reescrever assinatura_status/hotmart_*/dono_id e auto-promover sua
-- assinatura (acesso grátis ao produto pago). Vazamento de autorização.
--
-- Correção: trigger BEFORE UPDATE que REJEITA mudança dessas colunas quando o
-- autor NÃO é sistema (service_role / migrations). O webhook Hotmart roda como
-- service_role e CONTINUA escrevendo billing. Aditivo, sem rollback de dados.

create or replace function public.lojas_protege_billing()
returns trigger
language plpgsql
as $$
begin
  -- Autor é o sistema (webhook Hotmart via service_role, ou migrations/backfill).
  if current_user = 'service_role'
     or current_user = 'postgres'
     or current_user = 'supabase_admin' then
    return new;
  end if;

  -- Demais autores (dono autenticado etc.) não podem tocar billing/identidade.
  if new.assinatura_status        is distinct from old.assinatura_status
     or new.assinatura_inicio         is distinct from old.assinatura_inicio
     or new.assinatura_fim_periodo    is distinct from old.assinatura_fim_periodo
     or new.assinatura_atualizada_em  is distinct from old.assinatura_atualizada_em
     or new.hotmart_subscriber_code   is distinct from old.hotmart_subscriber_code
     or new.hotmart_plano             is distinct from old.hotmart_plano
     or new.dono_id                   is distinct from old.dono_id then
    raise exception 'colunas de billing/identidade são somente-servidor (use o webhook Hotmart)';
  end if;

  return new;
end;
$$;

create trigger lojas_protege_billing_trg
  before update on public.lojas
  for each row
  execute function public.lojas_protege_billing();
