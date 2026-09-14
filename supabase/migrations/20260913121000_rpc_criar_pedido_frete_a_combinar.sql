-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 180-B — RPC `public.criar_pedido` v17: sabe gravar frete a combinar.
-- Plano: plan/180-B-geocoding-cep-frete-errado.md §Contratos de Dados.
-- Depende de: 20260913120000_pedidos_frete_a_combinar.sql (coluna + CHECK).
--
-- FASE EXPAND. Aditiva: cria um OVERLOAD de 17 args e NÃO dropa o de 16.
--
-- ── DIVERGÊNCIA DELIBERADA DO PRECEDENTE DA 20260614009500 ───────────────────
-- Aquela migration DROPou o overload antigo no mesmo passo, para não deixar uma
-- porta sem dedupe. Aqui NÃO dropamos o de 16 args, por dois motivos:
--   1. Janela de deploy: o código ANTIGO continua em produção até a Vercel
--      terminar de trocar as lambdas, e ele chama a assinatura de 16 args.
--      Dropar agora derruba todo pedido nesse intervalo.
--   2. A de 16 args não fura nenhuma invariante de VALOR — ela só não sabe
--      gravar "a combinar" (grava o default false da coluna, coerente com o
--      CHECK) e continua exposta apenas a `service_role`.
-- O `drop function` do overload de 16 args vai para a fase CONTRACT, junto com
-- o `validate constraint`, em issue própria pós-produção.
--
-- ── POR QUE `p_frete_a_combinar` NÃO TEM DEFAULT ─────────────────────────────
-- O plano escreveu `p_frete_a_combinar boolean default false`. Verificado em
-- pglite: com DEFAULT, uma chamada de 16 args passa a casar com AS DUAS funções
-- e o Postgres aborta com `function public.criar_pedido(...) is not unique` —
-- ou seja, o DEFAULT quebraria exatamente o código antigo que decidimos
-- preservar. Sem default, a resolução é determinística e cada assinatura tem um
-- dono: 15 ou 16 argumentos ⇒ função antiga; 17 ⇒ esta. Vale igual para o
-- PostgREST, que escolhe o overload pelo conjunto de chaves do JSON.
-- Pelo mesmo motivo `p_idempotency_key` aqui é OBRIGATÓRIO (a action sempre o
-- envia, `?? null`): um parâmetro com default não pode preceder um sem default.
--
-- ── A BORDA MAIS FÁCIL DE ESQUECER ───────────────────────────────────────────
-- Na trava atômica de cupom, quando a corrida é PERDIDA, o total é recomposto
-- com `v_total := p_subtotal + p_taxa_entrega`. Com `p_taxa_entrega` NULL (que
-- é justamente o caso "a combinar") isso viraria NULL silenciosamente e a linha
-- seria rejeitada pelo NOT NULL de `total` — ou pior, num schema mais frouxo,
-- gravaria total nulo. Vira `coalesce(p_taxa_entrega, 0)`: frete a combinar
-- entra na conta como 0, exatamente como o `total` calculado pela action (D7).
--
-- Preservado INTACTO em relação a 20260907120000 (última versão): dedupe por
-- idempotency_key ANTES da trava de cupom, `loja_esta_ativa`, trava atômica de
-- cupom, ON CONFLICT DO NOTHING + re-SELECT do perdedor da corrida, snapshot de
-- itens + observação + opcionais, SECURITY INVOKER, search_path = public.
--
-- RLS/grants: SECURITY INVOKER — a RPC roda com a RLS do caller, e o caller é
-- `service_role` (único com EXECUTE). Nenhuma policy nova; a coluna nova entra
-- pelas policies por linha já existentes de `pedidos`.
--
-- Rollback: bloco comentado no fim.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.criar_pedido(
  p_loja_id          uuid,
  p_nome_cliente     text,
  p_telefone_cliente text,
  p_endereco_entrega jsonb,
  p_forma_pagamento  text,
  p_observacoes      text,
  p_subtotal         numeric,
  p_taxa_entrega     numeric,   -- NULL <=> p_frete_a_combinar = true
  p_desconto         numeric,
  p_total            numeric,
  p_cupom_id         uuid,
  p_cupom_codigo     text,
  p_itens            jsonb,
  p_tipo_entrega     text,
  p_troco_para       numeric,
  p_idempotency_key  uuid,
  p_frete_a_combinar boolean
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
  --     inserir nada. Um retry cujo geocoding voltou a funcionar NÃO reescreve
  --     um pedido já gravado como "a combinar" — é a idempotência correta; a
  --     divergência é resolvida no chat com a loja.
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
  --     `coalesce(p_taxa_entrega, 0)`: ver cabeçalho — sem ele, o caminho
  --     "a combinar" + cupom perdido produziria total NULL.
  if p_cupom_id is not null then
    update public.cupons
       set usos_contagem = usos_contagem + 1
     where id = p_cupom_id
       and (usos_maximos is null or usos_contagem < usos_maximos);
    if not found then
      v_desconto := 0;
      v_cupom_codigo := null;
      v_total := p_subtotal + coalesce(p_taxa_entrega, 0);
    end if;
  end if;

  -- (3) INSERT pedido (token_acesso via DEFAULT gen_random_uuid()).
  --     `frete_a_combinar` é decidido 100% no servidor (classificarFrete) —
  --     nunca vem do payload do cliente. O CHECK
  --     `chk_pedidos_frete_a_combinar` é a última linha: um par incoerente
  --     (true com taxa, ou false com NULL) aborta a transação inteira.
  insert into public.pedidos (
    loja_id, nome_cliente, telefone_cliente, endereco_entrega,
    subtotal, desconto, taxa_entrega, total, forma_pagamento,
    cupom_codigo, observacoes, status, tipo_entrega, troco_para,
    idempotency_key, frete_a_combinar
  )
  values (
    p_loja_id, p_nome_cliente, p_telefone_cliente, p_endereco_entrega,
    p_subtotal, v_desconto, p_taxa_entrega, v_total, p_forma_pagamento,
    v_cupom_codigo, p_observacoes, 'pendente', p_tipo_entrega, p_troco_para,
    p_idempotency_key, coalesce(p_frete_a_combinar, false)
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
  --     cliente) + seus opcionais (RN-O6), na MESMA transação.
  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    -- `observacao` (issue 166): texto LIVRE do cliente, input não-confiável.
    insert into public.itens_pedido (pedido_id, produto_id, nome, preco, quantidade, observacao)
    values (
      v_pedido_id,
      (v_item->>'produto_id')::uuid,
      v_item->>'nome',
      (v_item->>'preco')::numeric,
      (v_item->>'quantidade')::int,
      left(nullif(trim(v_item->>'observacao'), ''), 200)
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

-- Grants da NOVA assinatura (17 args). A de 16 args continua existindo com os
-- grants dela (só service_role) — ver cabeçalho.
revoke all on function public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric,
  uuid, text, jsonb, text, numeric, uuid, boolean
) from public;
revoke all on function public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric,
  uuid, text, jsonb, text, numeric, uuid, boolean
) from anon, authenticated;
grant execute on function public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric,
  uuid, text, jsonb, text, numeric, uuid, boolean
) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Janela segura: SEMPRE — esta migration é puramente aditiva (um overload novo).
--   Nenhum dado é tocado; a função de 16 args nunca deixou de existir.
--
-- Reverter é dropar o overload de 17 args:
--
--   drop function if exists public.criar_pedido(
--     uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric,
--     uuid, text, jsonb, text, numeric, uuid, boolean
--   );
--
-- Ordem: este rollback vem ANTES do rollback da 20260913120000 (a coluna só
-- pode cair depois que ninguém mais a referencia).
-- Depois dele, todo pedido volta a nascer com frete conhecido — o código novo
-- em produção passaria a chamar uma função inexistente, então só reverta a RPC
-- junto com (ou depois de) reverter o deploy da aplicação.
-- ─────────────────────────────────────────────────────────────────────────────
