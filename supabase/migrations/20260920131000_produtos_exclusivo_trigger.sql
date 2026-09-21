-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 245 — Migration 4 do Spec B, parte 1/2 (RN-14): o estado ÓRFÃO
-- (`produtos.visibilidade = 'cardapio'` com ZERO linhas em `cardapio_produtos`)
-- passa a ser IMPOSSÍVEL de commitar — constraint trigger DEFERIDO, nas duas
-- pontas da relação.
-- Spec: specs/cardapio-sazonal.md (D14 · RN-13, RN-14).
-- Issue/plano: tasks/245-trigger-do-produto-exclusivo-e-policy-publica-ajustada.md
--              (D4, D5, D6, D7, D8; §Desenho do trigger).
-- Par: 20260920132000_vitrine_produtos_visibilidade_predicado.sql (a VIEW —
--      blast radius de LEITURA; esta é a de ESCRITA). Uma por janela de rollback.
--
-- POR QUE TRIGGER, e não CHECK/FK: CHECK não cruza tabela e a FK aponta na
-- direção errada (o vínculo referencia o produto, não o contrário). A única
-- primitiva que avalia a invariante NO COMMIT — e que vale sob BYPASSRLS — é o
-- CONSTRAINT TRIGGER deferido. O órfão nasce por TRÊS portas, duas delas DENTRO
-- do banco, depois de a Server Action decidir: `on delete cascade` de
-- `cardapios` e de `produtos`. Só o banco fecha as três.
--
-- DEFERIDO (initially deferred): o caminho legítimo da Server Action (255/261)
-- é "marcar 'cardapio' + vincular" na MESMA transação, em qualquer ordem. Um
-- AFTER simples recusaria a ordem update→insert. O statement PASSA; o COMMIT
-- decide.
--
-- SECURITY DEFINER (D4): o veredito NÃO pode depender de quem chama. Invoker
-- faria os SELECTs da função passarem pela RLS do chamador — hoje correto, mas
-- uma policy futura mais estrita faria o EXISTS devolver false e o trigger
-- passar em silêncio (fail-open). Definer enxerga o que existe, como os
-- triggers de RI de FK; independe de role, JWT e policy. Função `returns
-- trigger` não é chamável diretamente (superfície definer = zero); o `revoke`
-- é consistência com as travas T1–T7 do projeto.
--
-- RAMO POR tg_table_name: em `produtos` o id é NEW.id; em `cardapio_produtos`
-- é OLD.produto_id. NÃO usar `coalesce(new.produto_id, old.produto_id)` — na
-- ponta de `produtos` NEW não tem `produto_id` e o plpgsql levanta 42703 em
-- runtime (erro do spec original, achado pelo `arquitetar`).
--
-- LOCK (D5): `for no key update` no produto é o ponto único de serialização.
-- Sem ele, T1 "apaga o último vínculo de P" e T2 "marca P como 'cardapio'"
-- podem ambas checar antes de qualquer commit e ambas passar → órfão. Com o
-- lock quem chega segundo espera o commit do primeiro e relê (READ COMMITTED:
-- cada statement tira snapshot novo). Não conflita com o FOR KEY SHARE do
-- insert de vínculo (FK), então "trocar vínculo" não bloqueia. Deadlock entre
-- transações que travam vários produtos em ordens opostas dá 40P01 — ERRO, não
-- órfão (fail-closed, retry-able). Não testável em pglite (conexão única):
-- garantido por construção. Precedente: `criar_pedido` usa `for update`.
--
-- PONTA 2 cobre `update of produto_id` (D6): re-apontar um vínculo é permitido
-- pela RLS do dono e pelo unique (cardapio_id, produto_id) e orfana o produto
-- antigo sem nenhum DELETE. OLD.produto_id nos dois eventos.
--
-- ERRCODE (D8): `integrity_constraint_violation` (23000), NÃO `check_violation`
-- (23514, que já é o código dos CHECKs de desconto em produto.ts). A Server
-- Action (255/261) mapeia 23000 + o fragmento LITERAL `produto exclusivo sem
-- cardapio` para mensagem legível. Mudar o texto quebra o RED de propósito.
--
-- O QUE NÃO É RECUSADO (RN-14, "o que NÃO é impossível"): vínculo só em
-- cardápio INATIVO (fora de temporada é estado normal); apagar o PRÓPRIO
-- produto (cascade leva o vínculo; no COMMIT o produto não existe → EXISTS
-- falso); trocar vínculo A por B.
--
-- ADITIVA e INERTE hoje: 100% dos produtos em produção são 'menu' (default da
-- 130000) e nenhum caminho escreve 'cardapio' até a 261. Nenhuma linha é
-- tocada; nenhum grant de tabela muda. RLS: nenhuma policy nova/alterada.
--
-- ROLLBACK: bloco comentado no fim.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════ 1) a função (uma, duas pontas)
create or replace function public.checar_produto_exclusivo_tem_cardapio()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_produto uuid;
begin
  -- Ramo por tabela: colunas DIFERENTES em cada ponta (ver cabeçalho).
  if tg_table_name = 'produtos' then
    v_produto := new.id;
  else
    v_produto := old.produto_id;
  end if;

  -- D5: serializa por produto. Se o produto foi apagado nesta transação
  -- (cascade de produtos), não trava nada e o EXISTS abaixo é falso.
  perform 1 from public.produtos where id = v_produto for no key update;

  -- Ordem importa: produto PRIMEIRO. O inverso levantaria erro ao apagar.
  if exists (
       select 1 from public.produtos
        where id = v_produto and visibilidade = 'cardapio'
     )
     and not exists (
       select 1 from public.cardapio_produtos where produto_id = v_produto
     )
  then
    raise exception 'produto exclusivo sem cardapio: %', v_produto
      using errcode = 'integrity_constraint_violation';   -- 23000 (D8)
  end if;

  return null;   -- AFTER: valor ignorado
end;
$$;

comment on function public.checar_produto_exclusivo_tem_cardapio() is
  'RN-14 (Spec B, issue 245): produto com visibilidade = cardapio NUNCA fica sem linha em cardapio_produtos. Constraint trigger DEFERIDO nas duas pontas (produtos: NEW.id; cardapio_produtos: OLD.produto_id). SECURITY DEFINER: o veredito nao depende de role/RLS/JWT — vale sob service_role. FOR NO KEY UPDATE no produto serializa a corrida entre apagar o ultimo vinculo e marcar exclusivo. Erro: 23000 + fragmento "produto exclusivo sem cardapio" (mapeado pela Server Action). Vinculo so em cardapio INATIVO e permitido.';

-- Função de trigger não é chamável diretamente; o revoke é consistência com T1–T7.
revoke all on function public.checar_produto_exclusivo_tem_cardapio() from public;

-- ════════════════════════ 2) ponta 1: o produto vira 'cardapio' (INSERT/UPDATE)
-- Nome LITERAL: o teste [m] faz `alter table ... disable trigger
-- produtos_exclusivo_tem_cardapio` para fabricar um órfão pré-existente.
create constraint trigger produtos_exclusivo_tem_cardapio
  after insert or update of visibilidade on public.produtos
  deferrable initially deferred
  for each row
  when (new.visibilidade = 'cardapio')
  execute function public.checar_produto_exclusivo_tem_cardapio();

-- ═══ 3) ponta 2: o vínculo some (DELETE direto, CASCADE de cardapios, CASCADE
--       de produtos) ou é re-apontado (UPDATE OF produto_id, D6).
create constraint trigger cardapio_produtos_exclusivo_tem_cardapio
  after delete or update of produto_id on public.cardapio_produtos
  deferrable initially deferred
  for each row
  execute function public.checar_produto_exclusivo_tem_cardapio();

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Janela segura: a QUALQUER momento enquanto não houver produto
--   `visibilidade = 'cardapio'` em produção (o painel só ganha o campo na 261).
--   Depois disso, reverter não perde dado, mas reabre as três portas do órfão:
--   só reverter junto com o código que escreve 'cardapio'.
-- Independe da 132000 (a view não referencia o trigger); pode reverter só esta.
--
--   drop trigger if exists cardapio_produtos_exclusivo_tem_cardapio on public.cardapio_produtos;
--   drop trigger if exists produtos_exclusivo_tem_cardapio on public.produtos;
--   drop function if exists public.checar_produto_exclusivo_tem_cardapio();
--
-- Não perde dado: nenhuma coluna/linha é tocada aqui.
-- ─────────────────────────────────────────────────────────────────────────────
