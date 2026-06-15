-- Issue 006 — RLS de `cupons`, `pedidos` e `itens_pedido` (políticas)
--
-- Migration ADITIVA. As 3 tabelas já tiveram RLS habilitada na 001
-- (`schema_inicial`), estado deny-all (zero policies). Esta migration só adiciona
-- as 5 `create policy` de seguranca.md §2 / plan/006 — NÃO reabilita RLS e NÃO
-- toca em nenhuma migration anterior (001, 001000, 001500, 002000).
--
-- Padrão de propriedade herdado da 002000: `exists (select 1 from public.lojas
-- where lojas.id = X.loja_id and lojas.dono_id = auth.uid())`, e `for all` com
-- USING (gate de leitura/UPDATE/DELETE na linha existente) + WITH CHECK (gate de
-- INSERT/UPDATE na linha resultante, barra forjar loja_id alheio).
--
-- AUSÊNCIAS DELIBERADAS (parte do design — não esquecimento):
--  - cupons: SEM SELECT anon (anti-enumeração — concorrente não baixa a tabela).
--  - pedidos: SEM SELECT anon (não vaza nome/telefone/endereço de clientes). A
--    leitura da confirmação é por `id + token_acesso` via service_role (BYPASSRLS),
--    issue 011/026/028 — isolamento garantido NA QUERY, não na RLS.
--  - itens_pedido: SEM SELECT anon (herda isolamento do pedido pai).
--  - Em todas, deny-all (RLS ON + zero policy cobrindo o caso) é a garantia.
-- INSERT público (anon) de pedido/item autoriza só a OPERAÇÃO; o recálculo de
-- valor monetário e o snapshot de itens são da Server Action de checkout
-- (seguranca.md §10, issue 013/026), camada independente desta RLS.

-- ══════════════════════════════════════════════════════════════════════ cupons
-- Só o dono lê/escreve os próprios cupons. NENHUMA policy de SELECT para anon.
create policy "cupons_acesso_proprio"
  on public.cupons for all
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = cupons.loja_id and lojas.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.lojas
      where lojas.id = cupons.loja_id and lojas.dono_id = auth.uid()
    )
  );

-- ═════════════════════════════════════════════════════════════════════ pedidos
-- Cliente sem login cria pedido (anon key, via Server Action de checkout).
-- Defesa em profundidade (auditoria 006): só aceita pedido em loja ATIVA — barra
-- pedido em loja inativa/suspensa. Recálculo de valor continua na Server Action (§10);
-- rate limit anti-spam idem. A RLS não valida valor nem faz rate limit.
create policy "pedidos_insert_publico"
  on public.pedidos for insert
  with check (public.loja_esta_ativa(pedidos.loja_id));

-- Dono lê/gerencia (status) só os pedidos das próprias lojas. WITH CHECK impede,
-- num UPDATE, reescrever loja_id para outra loja. NENHUMA policy de SELECT anon.
create policy "pedidos_acesso_lojista"
  on public.pedidos for all
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = pedidos.loja_id and lojas.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.lojas
      where lojas.id = pedidos.loja_id and lojas.dono_id = auth.uid()
    )
  );

-- ════════════════════════════════════════════════════════════════ itens_pedido
-- Helper security definer: "este pedido aceita novos itens?" (existe, está
-- 'pendente' e a loja está ativa). Definer porque o anon NÃO tem SELECT em pedidos
-- (anti-enumeração) — o EXISTS direto rodaria sob a RLS do anon e retornaria false
-- sempre. Retorna só boolean, não vaza linha de pedidos. Mesmo padrão de loja_esta_ativa.
create or replace function public.pedido_aceita_itens(p_pedido_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.pedidos p
    where p.id = p_pedido_id
      and p.status = 'pendente'
      and public.loja_esta_ativa(p.loja_id)
  );
$$;

revoke all on function public.pedido_aceita_itens(uuid) from public;
grant execute on function public.pedido_aceita_itens(uuid) to anon, authenticated, service_role;

-- Cliente sem login insere itens junto com o pedido.
-- Defesa em profundidade (auditoria 006): pedido_id NÃO é segredo (vai na URL de
-- confirmação), então WITH CHECK(true) deixava qualquer anon anexar item a pedido
-- alheio. Amarra a item de pedido 'pendente' de loja ativa — no checkout legítimo o
-- pedido pai é criado pendente na mesma transação, então o fluxo real passa.
create policy "itens_pedido_insert_publico"
  on public.itens_pedido for insert
  with check (public.pedido_aceita_itens(itens_pedido.pedido_id));

-- Dono vê itens só dos próprios pedidos, via pedido → loja → dono.
-- NENHUMA policy de SELECT para anon.
create policy "itens_pedido_lojista"
  on public.itens_pedido for select
  using (
    exists (
      select 1 from public.pedidos p
      join public.lojas l on l.id = p.loja_id
      where p.id = itens_pedido.pedido_id and l.dono_id = auth.uid()
    )
  );
