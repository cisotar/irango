-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 221 — migration 5: `public.criar_pedido` v17.1 grava
-- `itens_pedido.preco_original`.
-- Spec: specs/desconto-por-produto-e-pratos-promocionais.md §Modelos de Dados
--       (migration 5) · D7 · RN-13.
-- Plano: plan/loop-implementacao-descontos-promocoes-cardapio-sazonal.md, onda 1.
-- Depende de: 20260920126000_itens_pedido_preco_original.sql (coluna + CHECK).
--   Esta migration NUNCA pode ser aplicada antes daquela — os dois arquivos vão
--   no MESMO `db push`, e a ordem de timestamp garante isso.
--
-- ── O QUE MUDA: UMA LINHA ────────────────────────────────────────────────────
-- `CREATE OR REPLACE` da MESMA assinatura de 17 argumentos de
-- `20260913121000_rpc_criar_pedido_frete_a_combinar.sql`. Cópia literal, com
-- uma coluna a mais no `insert into public.itens_pedido` do laço de `p_itens`.
--
-- ── NENHUM OVERLOAD NOVO — E POR QUÊ ISSO É O PONTO ──────────────────────────
-- `preco_original` viaja DENTRO do jsonb `p_itens`, que já carrega `nome`,
-- `preco`, `quantidade`, `observacao` e `opcionais`. Por isso a assinatura NÃO
-- muda e nenhum overload nasce: um 18º argumento (com ou sem default) traria de
-- volta `function public.criar_pedido(...) is not unique`, o erro que o
-- cabeçalho da 20260913121000 documentou e evitou. A assinatura LEGADA de 16
-- args continua intocada, com os grants dela.
-- Precedente de campo que entra por `p_itens` sem tocar a assinatura:
-- 20260614008000_rpc_criar_pedido_opcionais.sql e
-- 20260907120000_itens_pedido_observacao.sql.
--
-- ── JANELA DE DEPLOY DA VERCEL (a razão de ser desta forma) ──────────────────
-- Entre o `db push` e a troca completa das lambdas, código ANTIGO chama esta
-- RPC nova com um jsonb SEM a chave `preco_original`. `->>` em chave ausente
-- devolve NULL — e NULL é exatamente "não houve desconto" (RN-13). Nenhum
-- pedido quebra, nenhuma exceção, nenhum item perdido.
--
-- ── O QUE A RPC NÃO GANHA ────────────────────────────────────────────────────
-- Nenhuma regra de desconto. `preco` e `preco_original` chegam já decididos
-- pela Server Action a partir do BANCO (`seguranca.md` §10): a RPC é
-- transacional, não é oráculo de preço. A derivação dos dois números e a trava
-- de RN-12-a são a issue 229 — fora daqui. O schema zod do pedido continua
-- `.strict()` e continua sem nenhum campo monetário.
-- O recálculo autoritativo continua lendo a TABELA `public.produtos` sob
-- `service_role`; a view `public.vitrine_produtos` (20260920124000) é leitura
-- PÚBLICA do catálogo e não participa de nada aqui.
--
-- ── PRESERVADO INTACTO em relação à 20260913121000 ───────────────────────────
-- dedupe por `idempotency_key` ANTES da trava de cupom; `loja_esta_ativa`;
-- trava atômica de cupom com recomposição `p_subtotal + coalesce(p_taxa_entrega, 0)`;
-- `ON CONFLICT DO NOTHING` + re-SELECT do perdedor da corrida (que NÃO insere
-- itens); snapshot de `nome`/`preco`/`observacao` truncada; INSERT de
-- `itens_pedido_opcionais`; SECURITY INVOKER; `set search_path = public`;
-- `p_frete_a_combinar` sem default. Nada disso é reescrito — a suíte atual de
-- checkout/pedido tem de passar sem uma única edição.
--
-- ── RLS/grants ───────────────────────────────────────────────────────────────
-- SECURITY INVOKER: a RPC roda com a RLS do caller, e o caller é `service_role`
-- (único com EXECUTE). Nenhuma policy nova. A coluna nova entra pelas policies
-- por linha já existentes de `itens_pedido`. `CREATE OR REPLACE` preserva os
-- grants; o bloco de revoke/grant abaixo é reemitido como cinto-e-suspensório,
-- idêntico ao da 20260913121000.
--
-- ── SHAPE de cada item em `p_itens` (após esta migration) ────────────────────
--   { produto_id, nome, preco, quantidade,
--     observacao?: string,
--     preco_original?: number,   -- ausente/null ⇒ item sem desconto
--     opcionais?: [{ opcional_id, nome_snapshot, preco_snapshot, quantidade }] }
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
    insert into public.itens_pedido (pedido_id, produto_id, nome, preco, quantidade, observacao, preco_original)
    values (
      v_pedido_id,
      (v_item->>'produto_id')::uuid,
      v_item->>'nome',
      (v_item->>'preco')::numeric,
      (v_item->>'quantidade')::int,
      left(nullif(trim(v_item->>'observacao'), ''), 200),
      (v_item->>'preco_original')::numeric
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

-- Grants da assinatura de 17 args (reemitidos; `create or replace` já os
-- preserva). A de 16 args continua existindo com os grants dela.
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
-- Janela segura: SEMPRE. Esta migration não toca dado nenhum e não muda
--   assinatura: reverter é reaplicar o corpo anterior. Pedidos já gravados com
--   `preco_original` continuam corretos; só os NOVOS voltam a nascer com a
--   coluna NULL (histórico de promoção perdido a partir daí — por isso reverter
--   junto com o deploy da aplicação, não sozinho).
--
-- Reverter = reexecutar INTEGRALMENTE o `create or replace function` de
--   `20260913121000_rpc_criar_pedido_frete_a_combinar.sql` (a versão sem
--   `preco_original`). NÃO usar `drop function`: isso derrubaria a assinatura de
--   17 args que o código em produção chama.
--
-- Ordem: este rollback vem ANTES do rollback da 20260920126000 — a coluna só
--   pode cair depois que ninguém mais a referencia.
-- ─────────────────────────────────────────────────────────────────────────────
