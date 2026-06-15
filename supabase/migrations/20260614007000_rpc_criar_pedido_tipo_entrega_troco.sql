-- Issue 071 — recria `public.criar_pedido` com `tipo_entrega` e `troco_para`.
--
-- A RPC original (20260614003000) não persistia os campos do checkout
-- introduzidos nas migrations 067 (pedidos.tipo_entrega + troco_para). Esta
-- migration adiciona dois parâmetros à assinatura e os grava no INSERT do
-- pedido, mantendo INTACTO todo o resto (atomicidade pedido+itens, trava
-- atômica de cupom WHERE usos<max, SECURITY INVOKER, search_path, grants).
--
-- RN-C2/C3: a action é a autoridade — força taxa_entrega=0 em retirada e só
-- envia troco_para quando o pagamento é dinheiro. A RPC apenas persiste; troco
-- fica FORA de qualquer cálculo (informativo ao lojista).
--
-- A assinatura muda (novos parâmetros) → DROP da função antiga antes do CREATE.
-- A assinatura antiga é referenciada pelos tipos de parâmetro (PG identifica
-- função por nome+args).

drop function if exists public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric, uuid, text, jsonb
);

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
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric, uuid, text, jsonb, text, numeric
) from public;
revoke all on function public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric, uuid, text, jsonb, text, numeric
) from anon, authenticated;
grant execute on function public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric, uuid, text, jsonb, text, numeric
) to service_role;
