-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 269 — Fase 1: conversão de `public.aplicar_cardapio_em_categoria` de
-- `SECURITY INVOKER` para `SECURITY DEFINER` + travas T1–T7 no corpo, com
-- `grant execute` também para `service_role`.
-- Issue: tasks/269-cardapio-no-hub-admin-paridade-com-o-lojista.md (D1).
-- Spec:  specs/arquivo/cardapio-sazonal.md · D2 · RN-09, RN-10.
-- Ref:   references/seguranca.md §2 ("RPC de escrita em lote reusada por
--        lojista E admin"), 3ª aplicação do padrão (as duas anteriores são
--        `reordenar_opcionais_da_categoria` e `reordenar_itens_do_grupo_opcional`,
--        issue 215).
--
-- É LITERALMENTE a conversão que `20260920134000` prescreve no próprio rodapé
-- ("O dia em que o hub admin gerenciar cardápio, a conversão é a de
-- `seguranca.md` §2 — SECURITY DEFINER + T1–T7 … NUNCA só acrescentar o grant").
-- Esse dia é hoje: a issue 269 cria o segundo caminho de escrita (hub admin,
-- `service_role`), que por construção NÃO passa pela RLS.
--
-- `create or replace`, MESMA assinatura, MESMAS mensagens literais. A migration
-- aplicada é imutável: `20260920134000` NÃO é editada.
--
-- ── O que muda de AUTORIDADE ────────────────────────────────────────────────
-- Sob `invoker`, quem barrava o lojista em loja alheia eram DUAS coisas: a RLS
-- de `lojas` (`lojas_leitura_propria`, que esvazia o `exists` de T2) e o próprio
-- predicado de T2. Sob `definer` a RLS deixa de ser avaliada DENTRO da função —
-- sobra T2 sozinha:
--   • para o LOJISTA a garantia é RELOCADA (da policy para o predicado);
--   • para o ADMIN ela é CRIADA (hoje a via de serviço não executa a função;
--     amanhã executa, e T2 é a ÚNICA checagem de tenant que ela encontra,
--     porque `service_role` tem BYPASSRLS).
-- O caso `asUser` (dono da loja B com `p_loja_id` da loja A) é obrigatório no
-- teste exatamente por causa dessa relocação (R2 da issue).
--
-- ── Por que `v_e_servico` tem DOIS sinais ───────────────────────────────────
-- Sinal 1: o claim `role` do JWT, já verificado pelo PostgREST.
-- Sinal 2: o role EFETIVO da sessão. Dentro de uma DEFINER, `current_user` vale
--   o DONO da função e `row_security_active()` é sempre false — nenhum dos dois
--   serve como sinal. `current_setting('role')` continua valendo o que o
--   PostgREST assumiu (`authenticated`, `anon` ou `service_role`).
-- Sozinho, o sinal 1 seria falsificável: qualquer lojista logado poderia pôr
-- `"role": "service_role"` no token e escrever em qualquer loja. Sozinho, o
-- sinal 2 dependeria só da configuração de sessão. A conjunção fecha os dois.
--
-- E `coalesce(auth.role(), '')` NÃO é estético: sem JWT `auth.role()` é NULL,
-- `NULL = 'service_role'` é NULL, `not (NULL or false)` avalia para NULL e o
-- plpgsql trata NULL como ELSE — a T2 viraria fail-OPEN. Achado real, corrigido
-- por `20260918130000`.
--
-- ── Ordem das travas (regra, não estilo) ────────────────────────────────────
-- T1 nulo → T2 autoridade → T3 coerência dos pares → T5 escrita. T3 DEPOIS de
-- T2: a ordem inversa confirmaria a existência de um cardápio ou de uma
-- categoria em loja alheia (oráculo de existência, `seguranca.md` §2/§14).
-- T4 (completude de permutação) não se aplica: isto não é reordenação. O
-- análogo é o `insert … select` ler o conjunto DENTRO da transação (RN-10).
-- T6: `get diagnostics ... row_count` com `on conflict do nothing` — contar
-- MENOS que o esperado é LEGÍTIMO (idempotência), então não há comparação que
-- derrube a transação; quem derruba id cruzado são as FKs compostas de
-- `20260920129000`, que valem sob qualquer role. T7 é a ACL, no rodapé.
--
-- ── Mensagens LITERAIS, byte a byte iguais às de 20260920134000 ─────────────
-- `parametro nulo`, `loja alheia`, `cardapio fora da loja`, `categoria fora da
-- loja`. São de LOG e de TESTE, nunca de tela (`seguranca.md` §14): as Server
-- Actions mapeiam tudo para a genérica. Reescrever o texto quebra os testes de
-- propósito.
--
-- ADITIVA: nenhuma tabela, coluna, índice, policy ou grant de TABELA é criado
-- ou alterado aqui. Só o corpo da função, a ACL dela e o comment.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.aplicar_cardapio_em_categoria(
  p_loja_id      uuid,
  p_cardapio_id  uuid,
  p_categoria_id uuid
) returns integer
language plpgsql
-- era: security invoker (20260920134000)
security definer
-- `pg_temp` EXPLÍCITO e por ÚLTIMO (`seguranca.md` §2, precedente
-- 20260918130000). Sob DEFINER isto deixa de ser defesa em profundidade e passa
-- a ser essencial: um `search_path` que comece pelo schema temporário deixa o
-- CHAMADOR sequestrar qualquer nome não-qualificado do corpo e executá-lo com
-- os privilégios do dono da função.
set search_path = public, pg_temp
as $$
declare
  v_inseridos   int;
  -- Sinal 2: role EFETIVO da sessão (ver cabeçalho). `'none'` quando não há
  -- `SET ROLE` — nunca NULL, para não contaminar a conjunção abaixo.
  v_role_sessao text    := coalesce(nullif(current_setting('role', true), ''), 'none');
  -- Sinal 1 ∧ Sinal 2. `coalesce(auth.role(), '')` é OBRIGATÓRIO (fail-closed).
  v_e_servico   boolean := coalesce(auth.role(), '') = 'service_role'
                           and v_role_sessao not in ('authenticated', 'anon');
begin
  -- ── T1: parâmetros presentes — filtro mais barato, antes de qualquer I/O.
  -- `p_categoria_id` nulo é recusado DE PROPÓSITO: aplicar à "Sem categoria"
  -- (`categoria_id is null`) usa o caminho de seleção explícita, para que o
  -- mesmo parâmetro não tenha dois significados (§Fora de escopo da 250).
  if p_loja_id is null or p_cardapio_id is null or p_categoria_id is null then
    raise exception 'aplicar_cardapio_em_categoria: parametro nulo';
  end if;

  -- ── T2: AUTORIDADE, antes de qualquer contagem ou leitura de catálogo.
  -- Dono da loja OU via de serviço. Substitui a RLS que o DEFINER deixa de
  -- avaliar; para o hub admin é a ÚNICA checagem de tenant que existe.
  if not (
    v_e_servico
    or exists (
      select 1 from public.lojas
       where id = p_loja_id and dono_id = auth.uid()
    )
  ) then
    raise exception 'aplicar_cardapio_em_categoria: loja alheia';
  end if;

  -- ── T3 (1/2): COERÊNCIA do par (loja, cardapio). DEPOIS de T2, senão viraria
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

  -- ── T5: escreve SÓ o vínculo, derivado do SELECT no servidor. NENHUM valor
  -- do cliente entra numa coluna — o cliente manda três ids de escopo, já
  -- provados por T2/T3, e a lista de produtos é lida aqui dentro.
  --
  -- SEM filtro por `oculto` ou `disponivel` (RN-10): participar de um cardápio
  -- é ortogonal a esses dois eixos, e excluir o oculto criaria uma regra que o
  -- lojista só descobriria ao reexibir o produto.
  --
  -- `and p.loja_id = p_loja_id` é escopo explícito ALÉM de T2/T3: sob DEFINER
  -- a RLS não filtra mais nada aqui, então este filtro deixa de ser cinto e
  -- suspensório e passa a ser o escopo local do statement. A terceira camada,
  -- que vale mesmo se a RPC for burlada, são as FKs compostas de 20260920129000.
  insert into public.cardapio_produtos (loja_id, cardapio_id, produto_id)
  select p_loja_id, p_cardapio_id, p.id
    from public.produtos p
   where p.loja_id = p_loja_id
     and p.categoria_id = p_categoria_id
  on conflict (cardapio_id, produto_id) do nothing;
  -- ── T6: conta só o que de fato entrou — reaplicar devolve 0 (RN-10).
  get diagnostics v_inseridos = row_count;

  return v_inseridos;
end;
$$;

comment on function public.aplicar_cardapio_em_categoria(uuid, uuid, uuid) is
  'RN-10 (issues 250 + 269): vincula TODOS os produtos de uma categoria a um cardapio num unico insert...select DENTRO da transacao (sem TOCTOU). SECURITY DEFINER desde 20260921120000 (issue 269, D1): a RLS NAO e avaliada dentro da funcao, e a autoridade e a trava T2 no corpo — dono da loja (lojas.dono_id = auth.uid()) OU via de servico, esta reconhecida por DOIS sinais (claim role do JWT verificado pelo PostgREST E role efetivo de sessao fora de authenticated/anon), com coalesce(auth.role(), '''') para nao virar fail-open por NULL. Ordem T1 nulo, T2 autoridade, T3 coerencia dos pares (loja,cardapio) e (loja,categoria), T5 escrita: T3 depois de T2 para nao virar oraculo de existencia em loja alheia. EXECUTE para authenticated e service_role; revogado de anon e PUBLIC. Inclui produtos oculto e disponivel=false. Idempotente por on conflict do nothing; devolve o numero de vinculos NOVOS.';

-- ════════════════════════════════════════════════════════════════════════ T7
-- ACL. O Postgres concede EXECUTE a PUBLIC por padrão em função nova, E o
-- projeto TEM `alter default privileges ... on routines` concedendo EXECUTE a
-- `anon`, `authenticated` e `service_role` (20260614008500:31). O revoke precisa
-- nomear `anon` EXPLICITAMENTE: revogar só de PUBLIC deixaria `anon` executando
-- pela entrada própria na ACL, com a anon key do bundle público — e agora a
-- função é DEFINER, ou seja, rodaria com os privilégios do dono.
--
-- `create or replace` PRESERVA a ACL existente, então este par revoke/grant é
-- repetido aqui de propósito: ele é o contrato da função, não um efeito
-- colateral da migration anterior.
revoke all on function public.aplicar_cardapio_em_categoria(uuid, uuid, uuid) from public, anon;

-- `service_role` é o grant NOVO (era só `authenticated`). Ele só pode existir
-- junto com a conversão acima: acrescentá-lo sobre o corpo `invoker` seria o
-- afrouxamento que `seguranca.md` §2 proíbe em letra — e acrescentá-lo sem a T2
-- de dois sinais deixaria a via de serviço sem NENHUMA checagem de tenant.
grant execute on function public.aplicar_cardapio_em_categoria(uuid, uuid, uuid)
  to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- A função não guarda estado: reverter não apaga nenhum vínculo já gravado em
-- `cardapio_produtos`. O que a reversão quebra é a APLICAÇÃO — o hub admin
-- (issue 269) chama esta função sob `service_role` e passaria a receber
-- `loja alheia`. Por isso: reverter o deploy da aplicação PRIMEIRO, esta
-- migration DEPOIS.
--
-- Rollback = reaplicar o corpo `invoker` de 20260920134000, na íntegra
-- (create or replace), seguido de:
--
--   revoke all on function public.aplicar_cardapio_em_categoria(uuid, uuid, uuid)
--     from public, anon, service_role;
--   grant execute on function public.aplicar_cardapio_em_categoria(uuid, uuid, uuid)
--     to authenticated;
--
-- O `revoke ... from service_role` é OBRIGATÓRIO no rollback: sem ele a função
-- volta a ser `invoker` mas com o grant novo, e a via de serviço passaria a
-- executar um corpo que a recusa em T2 por `auth.uid()` NULL — fail-closed, mas
-- com a ACL mentindo sobre o contrato.
--
-- Nenhuma tabela, policy, índice ou grant de tabela é tocado por esta migration.
-- ─────────────────────────────────────────────────────────────────────────────
