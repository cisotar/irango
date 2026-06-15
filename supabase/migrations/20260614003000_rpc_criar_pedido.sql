-- Issue 014 — RPC transacional `public.criar_pedido` (recálculo autoritativo).
--
-- O coração anti-fraude do marketplace (seguranca.md §10). A Server Action
-- `criarPedido` recalcula TODO valor monetário a partir do banco (utils puros) e
-- delega à esta RPC a parte que PRECISA ser atômica:
--   1. defesa em profundidade: barra loja inativa mesmo via service_role (RAISE);
--   2. trava atômica de cupom (anti over-use, RN-06): UPDATE ... WHERE usos<max
--      RETURNING — se NOT FOUND, esgotou na corrida → anula desconto e recomputa
--      total (D5: NÃO rejeita o pedido — a RPC é a autoridade FINAL do total);
--   3. INSERT pedido + INSERT itens (snapshot nome/preco) na MESMA transação.
--
-- Role (D3/D4): SECURITY INVOKER — o único caller é a action via service_role
-- (já BYPASSRLS). REVOKE de public/anon/authenticated (anon NUNCA cria pedido
-- sem passar pela action que recalcula); GRANT EXECUTE só a service_role.
-- `set search_path = public` é hygiene contra search_path hijack (mesmo padrão
-- de loja_esta_ativa).

create function public.criar_pedido(
  p_loja_id          uuid,
  p_nome_cliente     text,
  p_telefone_cliente text,
  p_endereco_entrega jsonb,
  p_forma_pagamento  text,
  p_observacoes      text,
  p_subtotal         numeric,
  p_taxa_entrega     numeric,
  p_desconto         numeric,
  p_total            numeric,
  p_cupom_id         uuid,
  p_cupom_codigo     text,
  p_itens            jsonb
)
  returns table (pedido_id uuid, token_acesso uuid)
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  v_desconto     numeric := p_desconto;
  v_total        numeric := p_total;
  v_cupom_codigo text    := p_cupom_codigo;
  v_pedido_id    uuid;
  v_token        uuid;
begin
  -- (1) defesa em profundidade: loja inativa abortada no banco, não só na action.
  if not public.loja_esta_ativa(p_loja_id) then
    raise exception 'loja_inativa';
  end if;

  -- (2) trava atômica de cupom (anti over-use / race). 0 linhas ⇒ esgotou na
  --     corrida ⇒ anula desconto, zera código e recomputa total (D5).
  if p_cupom_id is not null then
    update public.cupons
       set usos_contagem = usos_contagem + 1
     where id = p_cupom_id
       and (usos_maximos is null or usos_contagem < usos_maximos);
    if not found then
      v_desconto := 0;
      v_cupom_codigo := null;
      v_total := p_subtotal + p_taxa_entrega;
    end if;
  end if;

  -- (3) INSERT pedido (token_acesso via DEFAULT gen_random_uuid()).
  insert into public.pedidos (
    loja_id, nome_cliente, telefone_cliente, endereco_entrega,
    subtotal, desconto, taxa_entrega, total, forma_pagamento,
    cupom_codigo, observacoes, status
  )
  values (
    p_loja_id, p_nome_cliente, p_telefone_cliente, p_endereco_entrega,
    p_subtotal, v_desconto, p_taxa_entrega, v_total, p_forma_pagamento,
    v_cupom_codigo, p_observacoes, 'pendente'
  )
  returning id, public.pedidos.token_acesso into v_pedido_id, v_token;

  -- (4) INSERT itens com SNAPSHOT (nome/preco vêm do banco via action, não do cliente).
  insert into public.itens_pedido (pedido_id, produto_id, nome, preco, quantidade)
  select v_pedido_id,
         (i->>'produto_id')::uuid,
         i->>'nome',
         (i->>'preco')::numeric,
         (i->>'quantidade')::int
  from jsonb_array_elements(p_itens) as i;

  return query select v_pedido_id, v_token;
end;
$$;

revoke all on function public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric, uuid, text, jsonb
) from public;
revoke all on function public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric, uuid, text, jsonb
) from anon, authenticated;
grant execute on function public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric, uuid, text, jsonb
) to service_role;
