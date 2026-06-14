-- Issue 085 — emenda `public.criar_pedido` para persistir opcionais por item.
--
-- A RPC de 071 (20260614007000) já insere pedido + itens + trava de cupom na
-- mesma transação, com tipo_entrega/troco_para. Esta migration EMENDA a função
-- para, após inserir cada `itens_pedido`, gravar as linhas de
-- `itens_pedido_opcionais` (snapshot imutável: nome_snapshot/preco_snapshot/
-- quantidade) na MESMA transação (RN-O6).
--
-- A action é a autoridade do valor (RN-O1/O2): preço/nome do opcional já vêm do
-- banco dentro de p_itens[*].opcionais; a RPC apenas persiste o snapshot. As
-- validações cross-loja/categoria/ativo (RN-O3/O4/O5) acontecem na action ANTES
-- de chamar a RPC.
--
-- A assinatura NÃO muda (opcionais viajam dentro do jsonb p_itens já existente),
-- então usamos CREATE OR REPLACE. Mantém INTACTO todo o resto (atomicidade,
-- trava atômica de cupom, SECURITY INVOKER, search_path, grants service_role).
--
-- Shape de cada item em p_itens:
--   { produto_id, nome, preco, quantidade,
--     opcionais?: [{ opcional_id, nome_snapshot, preco_snapshot, quantidade }] }

create or replace function public.criar_pedido(
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
  p_itens            jsonb,
  p_tipo_entrega     text,
  p_troco_para       numeric
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
  v_item         jsonb;
  v_item_id      uuid;
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
  --     tipo_entrega/troco_para persistidos como recebidos da action (RN-C2/C3).
  insert into public.pedidos (
    loja_id, nome_cliente, telefone_cliente, endereco_entrega,
    subtotal, desconto, taxa_entrega, total, forma_pagamento,
    cupom_codigo, observacoes, status, tipo_entrega, troco_para
  )
  values (
    p_loja_id, p_nome_cliente, p_telefone_cliente, p_endereco_entrega,
    p_subtotal, v_desconto, p_taxa_entrega, v_total, p_forma_pagamento,
    v_cupom_codigo, p_observacoes, 'pendente', p_tipo_entrega, p_troco_para
  )
  returning id, public.pedidos.token_acesso into v_pedido_id, v_token;

  -- (4) INSERT itens com SNAPSHOT (nome/preco vêm do banco via action, não do
  --     cliente) + seus opcionais (RN-O6), na MESMA transação. Itera item a item
  --     para amarrar cada opcional ao id do `itens_pedido` recém-inserido.
  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    insert into public.itens_pedido (pedido_id, produto_id, nome, preco, quantidade)
    values (
      v_pedido_id,
      (v_item->>'produto_id')::uuid,
      v_item->>'nome',
      (v_item->>'preco')::numeric,
      (v_item->>'quantidade')::int
    )
    returning id into v_item_id;

    -- Opcionais do item (snapshot imutável). Ausente/[] ⇒ nada a inserir.
    if jsonb_typeof(v_item->'opcionais') = 'array' then
      insert into public.itens_pedido_opcionais (
        item_pedido_id, opcional_id, nome_snapshot, preco_snapshot, quantidade
      )
      select v_item_id,
             (o->>'opcional_id')::uuid,
             o->>'nome_snapshot',
             (o->>'preco_snapshot')::numeric,
             (o->>'quantidade')::int
      from jsonb_array_elements(v_item->'opcionais') as o;
    end if;
  end loop;

  return query select v_pedido_id, v_token;
end;
$$;

-- Grants inalterados (assinatura idêntica à de 071); reafirmados por segurança.
revoke all on function public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric, uuid, text, jsonb, text, numeric
) from public;
revoke all on function public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric, uuid, text, jsonb, text, numeric
) from anon, authenticated;
grant execute on function public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric, uuid, text, jsonb, text, numeric
) to service_role;
