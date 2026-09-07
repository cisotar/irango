-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 166 — observação por ITEM do pedido.
-- Spec: specs/observacoes-por-item-pedido.md (v0.2.0) §Modelos de Dados.
--
-- Duas partes, na MESMA migration (transação implícita: ou entram as duas ou
-- nenhuma — a RPC nunca fica referenciando coluna inexistente):
--   (1) `itens_pedido.observacao text` nullable + CHECK <= 200 chars;
--   (2) CREATE OR REPLACE de `public.criar_pedido` — ASSINATURA INALTERADA —
--       para o INSERT do loop de `p_itens` gravar a coluna nova.
--
-- ADITIVA / EXPAND-ONLY, SEM BACKFILL:
--   `itens_pedido` é tabela POPULADA em produção. `ADD COLUMN` nullable SEM
--   default não reescreve a tabela (nem no Postgres antigo) e não invalida
--   nenhuma linha existente: `NULL` = item sem observação, que é exatamente a
--   semântica desejada para todo o histórico. Nenhum `SET NOT NULL`, nenhum
--   `DROP`, nenhum `RENAME` — não há fase contract nesta feature.
--
-- CHECK como DEFESA EM PROFUNDIDADE, não como autoridade:
--   a autoridade de tamanho é o zod da Server Action (issue 167). O CHECK
--   existe para o caso de a autoridade falhar. Justamente por isso a RPC
--   TRUNCA (`left(...,200)`) antes de inserir: um payload de 201 caracteres que
--   escapasse do zod não pode abortar o pedido INTEIRO por violação de CHECK —
--   perder o pedido é pior que perder o excedente da observação.
--
-- RLS: NENHUMA política nova. `itens_pedido` já tem RLS habilitada; INSERT é
--   EXCLUSIVO da RPC sob `service_role` (seguranca.md §itens_pedido, achado
--   #3A — o INSERT público foi removido em 20260708130000). A coluna nova cai
--   sob as políticas existentes (SELECT do dono da loja; deny-all de escrita
--   para anon/authenticated) e NÃO abre nenhuma via de escrita nova: a
--   observação entra pelo `p_itens` que já existia.
--
-- Campo NÃO é billing/identidade: fora de qualquer trigger de proteção
--   (protege_billing_v*) e fora de qualquer cálculo monetário.
--
-- Base da RPC: 20260614009500_rpc_criar_pedido_idempotencia.sql (última versão).
--   Preservado INTACTO: dedupe por idempotency_key ANTES da trava de cupom,
--   `loja_esta_ativa`, trava atômica de cupom + recálculo do total, ON CONFLICT
--   DO NOTHING + re-SELECT do perdedor da corrida, INSERT de
--   itens_pedido_opcionais, SECURITY INVOKER, search_path = public, grants.
--   Mudou SÓ o INSERT em `public.itens_pedido` (uma coluna a mais).
--
-- Precedente de campo que viaja dentro de `p_itens` sem mudar a assinatura:
--   20260614008000_rpc_criar_pedido_opcionais.sql.
--
-- Rollback: bloco comentado no fim (DROP COLUMN + revert da RPC).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── (1) coluna ───────────────────────────────────────────────────────────────
alter table public.itens_pedido
  add column if not exists observacao text
    check (observacao is null or char_length(observacao) <= 200);

comment on column public.itens_pedido.observacao is
  'Observação livre do cliente para ESTE item (ex.: "sem cebola"). NULL = sem observação. Snapshot imutável, mesma família de nome/preco. Máx. 200 chars (autoridade real = zod da action; CHECK é defesa em profundidade).';

-- ── (2) RPC — assinatura inalterada (16 args), CREATE OR REPLACE ─────────────
-- Shape de cada item em p_itens:
--   { produto_id, nome, preco, quantidade,
--     observacao?: string,
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
    -- `observacao` (issue 166): texto LIVRE do cliente, input não-confiável.
    --   nullif(trim(...), '') ⇒ ausente / '' / só whitespace viram NULL (o ->>
    --   de chave ausente já é NULL e propaga por trim/nullif/left).
    --   left(...,200) ⇒ truncamento defensivo: mantém o CHECK inviolável sem
    --   deixar um payload fora do contrato abortar o pedido inteiro.
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

-- Grants inalterados (assinatura idêntica à de 20260614009500, 16 args);
-- reafirmados por segurança. CREATE OR REPLACE preserva os grants existentes,
-- este bloco só garante que anon/authenticated continuam SEM execute.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Janela segura: ATÉ o primeiro pedido gravado com observação em produção.
--   Depois disso, `DROP COLUMN` é PERDA DE DADO IRREVERSÍVEL (observações de
--   pedidos reais). Antes disso, o rollback é sem perda: toda linha tem NULL.
--
-- Ordem obrigatória: PRIMEIRO reverter a RPC (senão a função referencia coluna
-- inexistente e todo pedido novo falha), DEPOIS dropar a coluna.
--
--   -- passo 1: reverter a RPC para a versão anterior, na íntegra
--   \i supabase/migrations/20260614009500_rpc_criar_pedido_idempotencia.sql
--   -- (ou copiar dali o bloco `create or replace function public.criar_pedido`;
--   --  o `drop function` de 15 args no topo daquele arquivo é no-op agora.)
--
--   -- passo 2: remover a coluna (drop leva junto o CHECK)
--   alter table public.itens_pedido drop column if exists observacao;
--
-- Rollback PARCIAL, sem perda de dado, se só a RPC estiver com problema:
--   executar apenas o passo 1. A coluna fica no schema, nullable e ignorada —
--   inerte, sem custo e sem quebrar nenhum leitor (`select *` só ganha um campo
--   NULL a mais). Esta é a reversão preferida.
-- ─────────────────────────────────────────────────────────────────────────────
