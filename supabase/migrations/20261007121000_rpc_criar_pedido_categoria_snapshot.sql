-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 353 — migration B: `criar_pedido` grava o snapshot da categoria.
-- Spec: specs/relatorio-vendas.md (RN-V14, RN-V15).
-- Plano: plan/tecnico-relatorio-vendas.md §6.2 · D9 (ordem A1 → B → A2).
-- Depende de: 20261007120000_itens_pedido_categoria_snapshot.sql (A1, colunas).
--
-- `create or replace` da MESMA função de 18 argumentos de
-- 20261003122000_rpc_criar_pedido_cliente.sql, SEM `drop function`: assinatura,
-- `returns table`, SECURITY INVOKER, `search_path = public` e ACL iguais. O
-- payload não muda, então o checkout não fica indisponível em momento nenhum.
--
-- Corpo: cópia LITERAL das linhas 35-228 de 20261003122000 com só duas edições,
-- ambas marcadas `[353]` (o teste T353-15 compara o prosrc aplicado com o
-- arquivo antigo):
--   1. duas variáveis no `declare` (`v_categoria_id`, `v_categoria_nome`);
--   2. o INSERT de `itens_pedido` substituído pelo bloco `-- >>> [353]` …
--      `-- <<< [353]`, que resolve a categoria a partir de `produto_id` +
--      `p_loja_id` (nunca do jsonb) e grava as duas colunas de snapshot.
-- A RPC continua NÃO validando que `produto_id` pertence à loja (quem valida é
-- `criarPedido`, src/lib/actions/pedido.ts); o bloco novo só garante que
-- produto ou categoria de outra loja gera snapshot NULL.
--
-- Grants reemitidos (o `create or replace` preserva o ACL; reemitir é defesa).
-- Idempotente.
--
-- Rollback: reexecutar integralmente as linhas 35-237 de
--   20261003122000_rpc_criar_pedido_cliente.sql (`create or replace` + grants).
--   Fazer ANTES de reverter A1.
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
  p_frete_a_combinar boolean,
  p_cliente_id       uuid
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
  v_cupom_id        uuid    := p_cupom_id;
  v_limite          integer;
  v_codigo_cupom    text;
  v_usos_cliente    bigint;
  v_categoria_id    uuid;    -- [353]
  v_categoria_nome  text;    -- [353]
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

  -- (1b) defesa em profundidade: cliente_id vem do getUser() da action, nunca
  --      do payload; ainda assim, inexistente aborta antes de qualquer efeito.
  if p_cliente_id is not null
     and not exists (select 1 from public.clientes where public.clientes.id = p_cliente_id) then
    raise exception 'cliente_inexistente';
  end if;

  -- (1c) cupom com limite por cliente (decisões 9 e 9-A; RN-C06..C11).
  --      Convidado → sem desconto, nada consumido. Cliente → advisory lock por
  --      (cupom, cliente) e contagem em TODOS os status (cancelado conta) na
  --      mesma loja; limite atingido → sem desconto, como o esgotamento (D5).
  --      Em ambos os casos o cupom sai do pedido e a trava global (2) é pulada.
  if v_cupom_id is not null then
    select public.cupons.limite_por_cliente, public.cupons.codigo
      into v_limite, v_codigo_cupom
      from public.cupons
     where public.cupons.id = v_cupom_id;
    if v_limite is not null then
      if p_cliente_id is null then
        v_cupom_id := null;
      else
        perform pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtext(v_cupom_id::text || p_cliente_id::text)
        );
        select count(*) into v_usos_cliente
          from public.pedidos
         where public.pedidos.loja_id = p_loja_id
           and public.pedidos.cliente_id = p_cliente_id
           and public.pedidos.cupom_codigo = v_codigo_cupom;
        if v_usos_cliente >= v_limite then
          v_cupom_id := null;
        end if;
      end if;
      if v_cupom_id is null then
        v_desconto := 0;
        v_cupom_codigo := null;
        v_total := p_subtotal + coalesce(p_taxa_entrega, 0);
      end if;
    end if;
  end if;

  -- (2) trava atômica de cupom (anti over-use / race). 0 linhas ⇒ esgotou na
  --     corrida ⇒ anula desconto, zera código e recomputa total (D5).
  --     `coalesce(p_taxa_entrega, 0)`: ver cabeçalho — sem ele, o caminho
  --     "a combinar" + cupom perdido produziria total NULL.
  if v_cupom_id is not null then
    update public.cupons
       set usos_contagem = usos_contagem + 1
     where id = v_cupom_id
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
    idempotency_key, frete_a_combinar, cliente_id
  )
  values (
    p_loja_id, p_nome_cliente, p_telefone_cliente, p_endereco_entrega,
    p_subtotal, v_desconto, p_taxa_entrega, v_total, p_forma_pagamento,
    v_cupom_codigo, p_observacoes, 'pendente', p_tipo_entrega, p_troco_para,
    p_idempotency_key, coalesce(p_frete_a_combinar, false), p_cliente_id
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

  -- (4) INSERT itens com SNAPSHOT (nome/preco/preco_original vêm do banco via
  --     action, não do cliente) + seus opcionais (RN-O6), na MESMA transação.
  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    -- `observacao` (issue 166): texto LIVRE do cliente, input não-confiável.
    -- `preco_original` (issue 221 / D7): preço de TABELA, quando houve desconto.
    -- `->>` em chave AUSENTE devolve NULL, e NULL é exatamente "não houve
    -- desconto" — por isso a lambda antiga da janela de deploy da Vercel,
    -- que manda um jsonb SEM a chave, continua gravando pedido válido.
    -- Nenhuma regra de desconto aqui: os dois números chegam já decididos pela
    -- Server Action a partir do banco (seguranca.md §10). A RPC é transacional,
    -- não é oráculo de preço. O CHECK `itens_pedido_preco_original_check` é a
    -- última linha contra o par invertido ("de R$ 80 por R$ 100").
    -- >>> [353] RN-V14: categoria CONGELADA na venda, resolvida aqui a partir de
    -- produto_id + p_loja_id. Nenhuma chave de categoria do jsonb é lida: payload
    -- forjado não escolhe categoria, e produto/categoria de outra loja dá NULL.
    v_categoria_id := null;
    v_categoria_nome := null;
    select c.id, c.nome
      into v_categoria_id, v_categoria_nome
      from public.produtos pr
      join public.categorias c
        on c.id = pr.categoria_id
       and c.loja_id = p_loja_id
     where pr.id = (v_item->>'produto_id')::uuid
       and pr.loja_id = p_loja_id;
    insert into public.itens_pedido (
      pedido_id, produto_id, nome, preco, quantidade, observacao, preco_original,
      categoria_id_snapshot, categoria_nome_snapshot
    )
    values (
      v_pedido_id,
      (v_item->>'produto_id')::uuid,
      v_item->>'nome',
      (v_item->>'preco')::numeric,
      (v_item->>'quantidade')::int,
      left(nullif(trim(v_item->>'observacao'), ''), 200),
      (v_item->>'preco_original')::numeric,
      v_categoria_id,
      v_categoria_nome
    )
    returning id into v_item_id;
    -- <<< [353]

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

revoke all on function public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric,
  uuid, text, jsonb, text, numeric, uuid, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric,
  uuid, text, jsonb, text, numeric, uuid, boolean, uuid
) to service_role;
