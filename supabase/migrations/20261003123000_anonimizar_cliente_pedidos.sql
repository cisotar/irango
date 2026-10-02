-- Issue 341 / spec specs/cliente-vinculo-pedido.md §"anonimizar_cliente — extensão"
-- e §"expurgar_pedidos_antigos()" (decisões 3, 4, 16; RN-C13..C16).
-- Depende de: 20261003120000_pedidos_cliente_id.sql.
--
--  - anonimizar_cliente(uuid): recusa `pedido_em_aberto` se houver pedido do
--    cliente fora de entregue/cancelado criado há menos de 7 dias (P30); senão
--    apaga o perfil e o trigger BEFORE DELETE apaga a PII dos pedidos dele
--    (nome 'Cliente removido'; telefone, endereço, observações e cliente_id
--    null; itens_pedido.observacao null) mantendo valores, status, itens e
--    cupom_codigo; por fim apaga o perfil (Marco B).
--  - anonimizar_clientes_inativos(): pula quem tem pedido em aberto (o lote não aborta).
--  - expurgar_pedidos_antigos(): apaga pedido final com mais de 5 anos, de
--    cliente ou convidado (itens/opcionais por cascade). Sem agendador.
-- SECURITY DEFINER (owner postgres → os triggers de pedidos deixam passar);
-- EXECUTE só service_role. Idempotente (create or replace).
--
-- Rollback (janela: sempre para as funções; dado já anonimizado/expurgado NÃO volta):
--   drop trigger if exists clientes_anonimizar_pedidos on public.clientes;
--   drop function if exists public.anonimizar_pedidos_do_cliente();
--   drop function if exists public.expurgar_pedidos_antigos();
--   reexecutar as definições de anonimizar_cliente/anonimizar_clientes_inativos
--   de 20261002120000_clientes.sql.

-- Trigger BEFORE DELETE em clientes: anonimiza os pedidos do cliente em QUALQUER
-- caminho de exclusão do perfil (anonimizar_cliente, cascade de auth.users,
-- DELETE do service_role). Sempre anonimiza: a trava de pedido em aberto vale só
-- para a exclusão pedida pelo cliente (anonimizar_cliente / lote de inativos).
create or replace function public.anonimizar_pedidos_do_cliente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.itens_pedido ip
     set observacao = null
    from public.pedidos p
   where p.id = ip.pedido_id
     and p.cliente_id = old.id
     and ip.observacao is not null;

  update public.pedidos
     set nome_cliente = 'Cliente removido',
         telefone_cliente = null,
         endereco_entrega = null,
         observacoes = null,
         cliente_id = null
   where cliente_id = old.id;

  return old;
end
$$;

revoke all on function public.anonimizar_pedidos_do_cliente() from public, anon, authenticated;

drop trigger if exists clientes_anonimizar_pedidos on public.clientes;
create trigger clientes_anonimizar_pedidos
  before delete on public.clientes
  for each row execute function public.anonimizar_pedidos_do_cliente();

-- Trava (P30, altera decisão 16): só pedido não final criado nos últimos 7 dias
-- bloqueia; pedido em aberto mais antigo é anonimizado como os demais.
create or replace function public.anonimizar_cliente(p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.pedidos
     where cliente_id = p_usuario
       and status not in ('entregue', 'cancelado')
       and criado_em > now() - interval '7 days'
  ) then
    raise exception 'pedido_em_aberto';
  end if;

  -- a anonimização dos pedidos é feita pelo trigger clientes_anonimizar_pedidos.
  delete from public.clientes where id = p_usuario;
end
$$;

revoke all on function public.anonimizar_cliente(uuid) from public, anon, authenticated;
grant execute on function public.anonimizar_cliente(uuid) to service_role;

create or replace function public.anonimizar_clientes_inativos()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_total integer := 0;
begin
  for v_id in
    select c.id from public.clientes c
     where c.ultimo_acesso_em < now() - interval '24 months'
       and not exists (
         select 1 from public.pedidos p
          where p.cliente_id = c.id
            and p.status not in ('entregue', 'cancelado')
            and p.criado_em > now() - interval '7 days'
       )
  loop
    begin
      perform public.anonimizar_cliente(v_id);
      v_total := v_total + 1;
    exception when others then
      -- corrida: pedido aberto entre o select e a chamada → pula, o lote segue.
      if sqlerrm <> 'pedido_em_aberto' then
        raise;
      end if;
    end;
  end loop;
  return v_total;
end
$$;

revoke all on function public.anonimizar_clientes_inativos() from public, anon, authenticated;
grant execute on function public.anonimizar_clientes_inativos() to service_role;

create or replace function public.expurgar_pedidos_antigos()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
begin
  delete from public.pedidos
   where criado_em < now() - interval '5 years'
     and status in ('entregue', 'cancelado');
  get diagnostics v_total = row_count;
  return v_total;
end
$$;

revoke all on function public.expurgar_pedidos_antigos() from public, anon, authenticated;
grant execute on function public.expurgar_pedidos_antigos() to service_role;
