-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 250 — Migration 4 do Spec B: a RPC `public.aplicar_cardapio_em_categoria`
-- (`SECURITY INVOKER`, travas T1–T4).
-- Spec: specs/cardapio-sazonal.md (§`public.aplicar_cardapio_em_categoria`) ·
--       D2 · RN-09, RN-10.
-- Issue: tasks/250-migration-rpc-aplicar-cardapio-em-categoria.md
-- Plano: plan/loop-implementacao-descontos-promocoes-cardapio-sazonal.md (onda 3).
--
-- DEPENDE de 20260920128000 (`cardapios`) e 20260920129000 (`cardapio_produtos`,
-- com as FKs compostas e o `unique (cardapio_id, produto_id)`). Aplicar SEMPRE
-- depois delas; reverter SEMPRE antes delas.
--
-- ── Por que uma função, e não supabase-js ────────────────────────────────────
-- "Aplicar o cardápio a uma CATEGORIA INTEIRA" é um `insert ... select`, que o
-- PostgREST não faz. Ler a lista de produtos em JS e mandá-la de volta seria
-- TOCTOU (RN-10): produto criado na categoria entre a leitura e a escrita
-- ficaria de fora, produto movido para fora entraria. Dentro da transação, a
-- janela simplesmente não existe.
--
-- ── Modelo de segurança: SECURITY INVOKER + grant só para `authenticated` ────
-- Primeira variante do padrão de `seguranca.md` §2 ("RPC de escrita em lote do
-- lojista"), mesma de `reordenar_categorias` (20260908120000): só o lojista
-- autenticado escreve, então a RLS dele (`produtos_leitura_propria`,
-- `categorias_escrita_propria`, `cardapio_produtos_escrita_propria`) continua
-- sendo avaliada DENTRO da função e é a primeira autoridade. NÃO é a variante
-- `SECURITY DEFINER` + T1–T7, porque não existe via admin: acrescentar o grant
-- de `service_role` sem converter seria exatamente o afrouxamento que a §2
-- proíbe ("não basta acrescentar o grant").
--
-- **A trava T2 não é a RLS.** `service_role` tem `BYPASSRLS` — a RLS não é
-- reavaliada para ele em nenhum dos dois modos. Quem recusa a via de serviço é o
-- predicado EXPLÍCITO de T2: sob `service_role` não há JWT, `auth.uid()` é NULL,
-- o `exists` é falso e a função levanta `loja alheia`. FAIL-CLOSED por
-- construção, testado (`asService` no RED da 250), e independente de policy.
-- Por isso T2 usa `dono_id = auth.uid()` e não `row_security_active()` nem
-- `current_user`.
--
-- ── Ordem das travas (regra, não estilo) ────────────────────────────────────
-- T1 nulo → T2 autoridade → T3 coerência dos pares → T4 escrita. T3 DEPOIS de
-- T2: a ordem inversa confirmaria a existência de um cardápio ou de uma
-- categoria em loja alheia (oráculo de existência, `seguranca.md` §2).
--
-- ── Mensagens LITERAIS ──────────────────────────────────────────────────────
-- `parametro nulo`, `loja alheia`, `cardapio fora da loja`, `categoria fora da
-- loja`. Os três últimos são afirmados por fragmento no RED (não só o SQLSTATE
-- — ver a lição "SQLSTATE não basta em teste de escopo"). Reescrever o texto
-- quebra o teste de propósito. `raise exception` é para o log e para o teste,
-- NUNCA para a tela (`seguranca.md` §14): a Server Action da 251/255 mapeia.
--
-- ── Convivência com o trigger deferido da 245 ───────────────────────────────
-- `produtos_exclusivo_tem_cardapio` e `cardapio_produtos_exclusivo_tem_cardapio`
-- são `deferrable initially deferred` e disparam no COMMIT. Esta RPC só faz
-- INSERT em `cardapio_produtos` — evento que NENHUMA das duas pontas escuta
-- (ponta 1 é `insert or update of visibilidade on produtos`; ponta 2 é
-- `after delete or update of produto_id`). Inserir vínculo nunca cria órfão; e
-- se a MESMA transação da Server Action marcar produtos como
-- `visibilidade = 'cardapio'` antes ou depois desta chamada, o deferimento
-- garante que o veredito só é dado no commit, com os vínculos já gravados.
--
-- ── Idempotência ────────────────────────────────────────────────────────────
-- `on conflict (cardapio_id, produto_id) do nothing` sobre o UNIQUE nomeado em
-- 20260920129000. `get diagnostics ... row_count` após um `do nothing` conta
-- SÓ as linhas de fato inseridas: a segunda chamada seguida devolve 0 e não
-- duplica linha.
--
-- ADITIVA E REVERSÍVEL: nenhuma tabela, coluna, índice, policy ou grant de
-- tabela é criado ou alterado aqui. Só uma função nova e a ACL dela.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.aplicar_cardapio_em_categoria(
  p_loja_id      uuid,
  p_cardapio_id  uuid,
  p_categoria_id uuid
) returns integer
language plpgsql
security invoker
-- `pg_temp` EXPLÍCITO e por ÚLTIMO (`seguranca.md` §2, precedente
-- 20260918130000): `set search_path = public` sozinho deixa o Postgres buscar
-- `pg_temp` ANTES de public. Todo nome no corpo já é schema-qualificado, então
-- isso é defesa em profundidade contra uma edição futura, não correção de um
-- vetor ativo. Único ponto em que este arquivo diverge do trecho da spec.
set search_path = public, pg_temp
as $$
declare
  v_inseridos int;
begin
  -- ── T1: parâmetros presentes — filtro mais barato, antes de qualquer I/O.
  -- `p_categoria_id` nulo é recusado DE PROPÓSITO: aplicar à "Sem categoria"
  -- (`categoria_id is null`) usa o caminho de seleção explícita, para que o
  -- mesmo parâmetro não tenha dois significados (§Fora de escopo da 250).
  if p_loja_id is null or p_cardapio_id is null or p_categoria_id is null then
    raise exception 'aplicar_cardapio_em_categoria: parametro nulo';
  end if;

  -- ── T2: AUTORIDADE, antes de qualquer contagem ou leitura de catálogo.
  -- Sob invoker, `lojas_leitura_propria` (20260614001000) já limita esta linha
  -- ao dono; o predicado explícito é a SEGUNDA camada — e é a ÚNICA que vale
  -- sob `service_role` (BYPASSRLS), onde `auth.uid()` é NULL e o exists é
  -- falso. Fail-closed para a via de serviço, que ainda não existe.
  if not exists (
    select 1 from public.lojas
     where id = p_loja_id and dono_id = auth.uid()
  ) then
    raise exception 'aplicar_cardapio_em_categoria: loja alheia';
  end if;

  -- ── T3: COERÊNCIA do par (loja, cardapio). DEPOIS de T2, senão viraria
  -- oráculo de existência de cardápio em loja alheia.
  if not exists (
    select 1 from public.cardapios
     where id = p_cardapio_id and loja_id = p_loja_id
  ) then
    raise exception 'aplicar_cardapio_em_categoria: cardapio fora da loja';
  end if;

  -- ── T3 (2/2): COERÊNCIA do par (loja, categoria). Mesma razão de ordem.
  if not exists (
    select 1 from public.categorias
     where id = p_categoria_id and loja_id = p_loja_id
  ) then
    raise exception 'aplicar_cardapio_em_categoria: categoria fora da loja';
  end if;

  -- ── T4: escreve SÓ o vínculo, derivado do SELECT no servidor. NENHUM valor
  -- do cliente entra numa coluna — o cliente manda três ids de escopo, já
  -- provados por T2/T3, e a lista de produtos é lida aqui dentro.
  --
  -- SEM filtro por `oculto` ou `disponivel` (RN-10): participar de um cardápio
  -- é ortogonal a esses dois eixos, e excluir o oculto criaria uma regra que o
  -- lojista só descobriria ao reexibir o produto.
  --
  -- `and p.loja_id = p_loja_id` é escopo explícito ALÉM de T2/T3 e da RLS: a
  -- categoria já foi provada da loja, mas o filtro duplo mantém a invariante
  -- local ao statement. A terceira camada, que vale mesmo se a RPC for
  -- burlada, são as FKs compostas de 20260920129000.
  insert into public.cardapio_produtos (loja_id, cardapio_id, produto_id)
  select p_loja_id, p_cardapio_id, p.id
    from public.produtos p
   where p.loja_id = p_loja_id
     and p.categoria_id = p_categoria_id
  on conflict (cardapio_id, produto_id) do nothing;
  get diagnostics v_inseridos = row_count;

  -- Conta só o que de fato entrou: reaplicar devolve 0 (RN-10).
  return v_inseridos;
end;
$$;

comment on function public.aplicar_cardapio_em_categoria(uuid, uuid, uuid) is
  'RN-10 (Spec B, issue 250): vincula TODOS os produtos de uma categoria a um cardapio num unico insert...select DENTRO da transacao (sem TOCTOU). SECURITY INVOKER: a RLS do lojista continua valendo, e a trava T2 (lojas.dono_id = auth.uid()) e explicita, de modo que service_role — que tem BYPASSRLS e auth.uid() NULL — e recusado com "loja alheia" (fail-closed; nao ha via admin na v1). Ordem T1 nulo, T2 autoridade, T3 coerencia dos pares (loja,cardapio) e (loja,categoria), T4 escrita: T3 depois de T2 para nao virar oraculo de existencia em loja alheia. Inclui produtos oculto e disponivel=false. Idempotente por on conflict do nothing; devolve o numero de vinculos NOVOS.';

-- ════════════════════════════════════════════════════════════════════════ ACL
-- O Postgres concede EXECUTE a PUBLIC por padrão em função nova, E o projeto
-- TEM `alter default privileges ... on routines` concedendo EXECUTE a `anon`,
-- `authenticated` e `service_role` (20260614008500:31, `GRANT ALL ON ROUTINES`).
-- Por isso o revoke precisa nomear `anon` EXPLICITAMENTE: revogar só de PUBLIC
-- deixaria `anon` executando pela entrada própria na ACL, com a anon key do
-- bundle público. E `service_role` NÃO é alcançado por este revoke — ele só é
-- barrado pelo predicado no corpo da função.
revoke all on function public.aplicar_cardapio_em_categoria(uuid, uuid, uuid) from public, anon;

-- `authenticated` e NÃO `service_role`, de propósito (spec §RPC, issue 250
-- §Segurança e §Fora de escopo): não há via admin na v1, e a função fail-closes
-- em T2 para ela. O dia em que o hub admin gerenciar cardápio, a conversão é a
-- de `seguranca.md` §2 — `SECURITY DEFINER` + T1–T7, `coalesce(auth.role(), '')`
-- na conjunção de autoridade, `set search_path = public, pg_temp` — NUNCA só
-- acrescentar o grant, que deixaria a via de serviço sem nenhuma checagem de
-- tenant.
grant execute on function public.aplicar_cardapio_em_categoria(uuid, uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Janela segura: SEMPRE do ponto de vista de DADO — a função não guarda estado,
--   e dropá-la não apaga nenhum vínculo já gravado em `cardapio_produtos`.
--   Do ponto de vista de APLICAÇÃO, a janela fecha quando a Server Action da
--   issue 251/255 estiver em produção: a partir daí, dropar a função faz o
--   painel chamar uma RPC inexistente (`42883`). Só reverter junto com (ou
--   depois de) reverter o deploy da aplicação.
--
--   drop function if exists public.aplicar_cardapio_em_categoria(uuid, uuid, uuid);
--
-- `DROP FUNCTION` leva a ACL junto. Nenhuma tabela, policy, índice ou grant de
-- tabela é tocado por esta migration, então não há mais nada a desfazer.
--
-- Ordem: este rollback vem ANTES do rollback de 20260920129000 (a função
-- referencia `cardapio_produtos`) e, por consequência, antes do de
-- 20260920128000.
-- ─────────────────────────────────────────────────────────────────────────────
