-- Issue 063 — idempotência em `public.criar_pedido`.
--
-- Migration B: recria a RPC ganhando o 16º parâmetro `p_idempotency_key uuid
-- default null`, com DEDUPE ANTES da trava de cupom + `ON CONFLICT DO NOTHING`
-- no INSERT como rede de segurança contra corrida.
--
-- Por que DROP da função de 15 args: adicionar um parâmetro muda a aridade →
-- o Postgres criaria um OVERLOAD, deixando a função de 15 args órfã mas ainda
-- chamável (e ainda com grant) — uma porta de entrada sem dedupe. DROPamos a de
-- 15 args para sobrar UMA única `criar_pedido` no banco.
--
-- `p_idempotency_key uuid default null` preserva chamadas legadas de 15 args
-- nomeados (o default cobre o 16º) sem reintroduzir overload. Caminho "chave
-- nula" = comportamento atual, sem dedupe.
--
-- Mantém INTACTO: loja_esta_ativa, trava atômica de cupom, INSERT itens +
-- itens_pedido_opcionais, SECURITY INVOKER, search_path=public.

-- (1) remove o overload antigo de 15 args (evita função órfã chamável sem dedupe)
drop function if exists public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric,
  uuid, text, jsonb, text, numeric
);

-- (2) (re)cria a função com 16 args
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
  p_troco_para       numeric,
  p_idempotency_key  uuid default null
)
  returns table (pedido_id uuid, token_acesso uuid)
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  v_desconto        numeric := p_desconto;
  v_total           numeric := p_total;
  v_cupom_codigo    text    := p_cupom_codigo;
  v_pedido_id       uuid;
  v_token           uuid;
  v_item            jsonb;
  v_item_id         uuid;
  v_existente_id    uuid;
  v_existente_token uuid;
begin
  -- (0) DEDUPE — ANTES da trava de cupom e do INSERT. Se já existe pedido com
  --     (loja, chave), retorna o MESMO id/token e SAI. Sem consumir cupom, sem
  --     inserir nada. É o caminho principal do duplo-submit/retry sequencial.
  if p_idempotency_key is not null then
    select public.pedidos.id, public.pedidos.token_acesso
      into v_existente_id, v_existente_token
      from public.pedidos
     where public.pedidos.loja_id = p_loja_id
       and public.pedidos.idempotency_key = p_idempotency_key;
    if found then
      return query select v_existente_id, v_existente_token;
      return;
    end if;
  end if;

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
  --     Grava idempotency_key + ON CONFLICT como rede de segurança contra
  --     corrida: duas requisições simultâneas passam pelo SELECT do passo 0 sem
  --     se ver; a 2ª colide no índice UNIQUE parcial.
  insert into public.pedidos (
    loja_id, nome_cliente, telefone_cliente, endereco_entrega,
    subtotal, desconto, taxa_entrega, total, forma_pagamento,
    cupom_codigo, observacoes, status, tipo_entrega, troco_para,
    idempotency_key
  )
  values (
    p_loja_id, p_nome_cliente, p_telefone_cliente, p_endereco_entrega,
    p_subtotal, v_desconto, p_taxa_entrega, v_total, p_forma_pagamento,
    v_cupom_codigo, p_observacoes, 'pendente', p_tipo_entrega, p_troco_para,
    p_idempotency_key
  )
  on conflict (loja_id, idempotency_key) where idempotency_key is not null
  do nothing
  returning id, public.pedidos.token_acesso into v_pedido_id, v_token;

  -- (3b) Se o INSERT não retornou linha, a corrida foi perdida: o vencedor já
  --      inseriu. RE-SELECT pelo (loja, chave) e retorna o pedido dele. Não
  --      inserimos itens (o vencedor já inseriu os dele na SUA transação).
  if v_pedido_id is null then
    select public.pedidos.id, public.pedidos.token_acesso into v_pedido_id, v_token
      from public.pedidos
     where public.pedidos.loja_id = p_loja_id
       and public.pedidos.idempotency_key = p_idempotency_key;
    return query select v_pedido_id, v_token;
    return;
  end if;

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

-- Grants — reafirmados com a NOVA assinatura de 16 args. A função de 15 args foi
-- DROPada acima, então não há overload órfão a revogar.
revoke all on function public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric,
  uuid, text, jsonb, text, numeric, uuid
) from public;
revoke all on function public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric,
  uuid, text, jsonb, text, numeric, uuid
) from anon, authenticated;
grant execute on function public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric,
  uuid, text, jsonb, text, numeric, uuid
) to service_role;
