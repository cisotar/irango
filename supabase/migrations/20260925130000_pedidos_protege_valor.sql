-- FIX MÉDIO (auditoria de segurança da branch feat/modalidades-entrega-loja):
-- proteger as colunas de valor de pedidos contra UPDATE direto do lojista.
--
-- A RLS filtra LINHA, não COLUNA. A policy pedidos_acesso_lojista (FOR ALL,
-- lojas.dono_id = auth.uid()) concede UPDATE da linha inteira ao dono
-- autenticado — então o lojista, via PostgREST direto (PATCH /rest/v1/pedidos),
-- poderia reescrever subtotal/desconto/taxa_entrega/total e reabrir
-- frete_a_combinar, contornando D1/D2/D3 da spec modalidades-entrega-loja e o
-- recálculo autoritativo de src/lib/actions/freteCombinado.ts.
--
-- Correção: trigger BEFORE UPDATE que REJEITA mudança dessas colunas quando o
-- autor NÃO é sistema (service_role / migrations). A ÚNICA escrita de valor
-- permitida ao dono é a transição do frete combinado (frete_a_combinar
-- true → false) que a Server Action registrarFreteCombinado faz com o client
-- autenticado — e ela é revalidada aqui (D2 lendo OLD, D3, total recalculado
-- com a mesma fórmula de calcularTotal: clamp em 0 antes do frete).
--
-- SECURITY INVOKER (default) de propósito: com SECURITY DEFINER, current_user
-- viraria o dono da função (postgres) e todo autor passaria.
--
-- Aditivo, sem mudança de dados nem de colunas (database.types.ts intacto).

create or replace function public.pedidos_protege_valor()
returns trigger
language plpgsql
as $$
begin
  -- 1. Autor é o sistema (Server Actions admin via service_role, migrations/backfill).
  if current_user = 'service_role'
     or current_user = 'postgres'
     or current_user = 'supabase_admin' then
    return new;
  end if;

  -- 2. Nenhuma coluna de valor mudou (ex.: UPDATE só de status) → libera.
  if new.subtotal         is not distinct from old.subtotal
     and new.desconto         is not distinct from old.desconto
     and new.taxa_entrega     is not distinct from old.taxa_entrega
     and new.total            is not distinct from old.total
     and new.frete_a_combinar is not distinct from old.frete_a_combinar then
    return new;
  end if;

  -- 3. Base do total (subtotal/desconto) nunca muda fora do sistema.
  if new.subtotal is distinct from old.subtotal
     or new.desconto is distinct from old.desconto then
    raise exception 'valores do pedido são somente-servidor (subtotal/desconto)';
  end if;

  -- 4. Única escrita de valor do dono: registro do frete combinado.
  --    Regras de D2 leem OLD — trocar tipo/status no mesmo UPDATE não libera.
  if old.frete_a_combinar = true and new.frete_a_combinar = false then
    if old.tipo_entrega <> 'entrega' then
      raise exception 'frete combinado só vale para entrega';
    end if;

    if old.status = 'cancelado' then
      raise exception 'frete combinado não vale para pedido cancelado';
    end if;

    if new.taxa_entrega is null
       or new.taxa_entrega < 0
       or new.taxa_entrega > 1000 then
      raise exception 'frete combinado fora do intervalo [0, 1000]';
    end if;

    if new.total is distinct from
       greatest(0, old.subtotal - old.desconto) + new.taxa_entrega then
      raise exception 'total do pedido não confere com subtotal - desconto + frete';
    end if;

    return new;
  end if;

  -- 5. Qualquer outra mudança de total/taxa_entrega/frete_a_combinar.
  raise exception 'valores do pedido são somente-servidor (use o registro de frete combinado)';
end;
$$;

create trigger pedidos_protege_valor_trg
  before update on public.pedidos
  for each row
  execute function public.pedidos_protege_valor();

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Remove a defesa em profundidade; o lojista volta a poder reescrever valores
-- do próprio pedido via PostgREST direto. Só reverta junto de outra proteção.
--
--   drop trigger if exists pedidos_protege_valor_trg on public.pedidos;
--   drop function if exists public.pedidos_protege_valor();
-- ─────────────────────────────────────────────────────────────────────────────
