-- ============================================================
-- iRango — SYNC CLOUD: migrations pendentes (rodar no SQL Editor)
-- Projeto: gdlegxatwylhkjcrusyk
-- A migration 001 (schema) JÁ foi aplicada. Este arquivo aplica o RESTANTE.
-- Rode TUDO de uma vez (a ordem importa: view e helpers antes das policies que os usam).
-- ============================================================


-- ╔══════════════════════════════════════════════════════════
-- ║ 20260614001000_rls_lojas.sql
-- ╚══════════════════════════════════════════════════════════
-- Issue 004 — RLS de `public.lojas` (políticas)
--
-- Migration ADITIVA. A tabela `public.lojas` já teve RLS habilitada na 001
-- (`alter table ... enable row level security`), estado deny-all (zero policies).
-- Esta migration só adiciona as 5 `create policy` de seguranca.md §2 —
-- NÃO reabilita RLS e NÃO toca na 001.
--
-- Limites conhecidos da RLS (filtra LINHA, não COLUNA):
--  - `lojas_leitura_publica` libera a LINHA inteira de lojas ativas ao anon. A
--    seleção de colunas públicas (sem `dono_id`/`assinatura_*`/`hotmart_*`/
--    `consentimento_*`) é responsabilidade da query da vitrine (lista explícita
--    de colunas, nunca `select *`).
--  - `lojas_update_proprio` permite ao dono escrever QUALQUER coluna da própria
--    linha, incluindo `assinatura_*`/`hotmart_*`/`consentimento_*`. O gate dessas
--    colunas é na Server Action de perfil (issue 030/015), que escreve apenas a
--    allowlist de colunas. A RLS garante só o isolamento entre lojas (linha).

-- Vitrine pública: qualquer um lê loja ATIVA (isolamento de linha; colunas escopadas na query)
create policy "lojas_leitura_publica"
  on public.lojas for select
  using (ativo = true);

-- Lojista lê a PRÓPRIA loja mesmo inativa
create policy "lojas_leitura_propria"
  on public.lojas for select
  using (auth.uid() = dono_id);

-- Lojista cria a própria loja (não pode forjar dono_id de outro)
create policy "lojas_insert_proprio"
  on public.lojas for insert
  with check (auth.uid() = dono_id);

-- Lojista edita só a própria. WITH CHECK (divergência intencional vs seguranca.md,
-- que só tem USING) impede transferir a loja trocando `dono_id` num UPDATE.
create policy "lojas_update_proprio"
  on public.lojas for update
  using (auth.uid() = dono_id)
  with check (auth.uid() = dono_id);

-- Lojista deleta só a própria
create policy "lojas_delete_proprio"
  on public.lojas for delete
  using (auth.uid() = dono_id);


-- ╔══════════════════════════════════════════════════════════
-- ║ 20260614001500_vitrine_lojas_view.sql
-- ╚══════════════════════════════════════════════════════════
-- Issue 004 (correção de auditoria MÉDIA) — projeção pública da vitrine de lojas
--
-- Finding: `lojas_leitura_publica USING (ativo = true)` liberava a LINHA INTEIRA
-- de toda loja ativa ao anon. RLS filtra LINHA, não COLUNA — então um
-- `select dono_id, hotmart_subscriber_code, assinatura_status, consentimento_em
--  from public.lojas where ativo = true` vazava dado sensível/de outro tenant.
--
-- FIX (opção a — enforçado no banco, sem mover colunas, sem cascata Hotmart):
--  1. Remove o SELECT público da TABELA BASE (`lojas_leitura_publica`).
--  2. Cria `public.vitrine_lojas` como projeção pública SÓ com as colunas
--     não-sensíveis da vitrine, filtrando `ativo = true`.
--  3. anon/authenticated leem a vitrine pela VIEW, nunca da base.
--
-- `lojas_leitura_propria` (dono lê a própria linha completa) e as policies de
-- insert/update/delete permanecem INTACTAS — o dono continua lendo TUDO da
-- própria loja diretamente na base.

-- 1) Remove o SELECT público da tabela base.
drop policy "lojas_leitura_publica" on public.lojas;

-- 2) View de projeção pública.
--
-- EXCEÇÃO DELIBERADA a seguranca.md §19 (que exige security_invoker = true para
-- views sobre tabelas com RLS):
--   Aqui a view é INTENCIONALMENTE `security_invoker = false` (definer). Sem o
--   SELECT público na base, uma view security_invoker=true rodaria com as
--   permissões do anon e retornaria ZERO linhas. A view definer roda com as
--   permissões do owner e expõe APENAS as colunas projetadas abaixo — todas já
--   públicas (loja ativa). Não há isolamento de tenant a violar: a projeção não
--   inclui NENHUMA coluna sensível nem de outro tenant (sem dono_id,
--   assinatura_*, hotmart_*, consentimento_*). É uma vitrine pública por design.
create view public.vitrine_lojas
  with (security_invoker = false)
as
  select
    id,
    slug,
    nome,
    telefone,
    whatsapp,
    ativo,
    endereco_rua,
    endereco_numero,
    endereco_bairro,
    endereco_cidade,
    endereco_estado,
    endereco_cep,
    tema,
    horarios,
    timezone
  from public.lojas
  where ativo = true;

-- 3) Acesso público de leitura à projeção.
grant select on public.vitrine_lojas to anon, authenticated;


-- ╔══════════════════════════════════════════════════════════
-- ║ 20260614002000_rls_catalogo.sql
-- ╚══════════════════════════════════════════════════════════
-- Issue 005 — RLS de catálogo, entrega e pagamento (políticas)
--
-- Migration ADITIVA. As tabelas `produtos`, `categorias`, `zonas_entrega`,
-- `taxas_entrega`, `bairros_zona`, `formas_pagamento` já tiveram RLS habilitada
-- na 001 (`alter table ... enable row level security`), estado deny-all (zero
-- policies). Esta migration só adiciona as 13 `create policy` de seguranca.md §2
-- — NÃO reabilita RLS e NÃO toca na 001, na 004 (rls_lojas) nem na view (001500).
--
-- Decisões (ver plano da issue 005):
--  - Leitura pública é DIRETA na tabela base (nenhuma das 6 tem coluna sensível;
--    `formas_pagamento.config` guarda a chave Pix que é pública por design). Sem view.
--  - O filtro de loja ativa é aplicado NA POLICY via EXISTS contra `lojas` — o banco
--    é a última linha de defesa: produto/categoria de loja inativa não vaza nem se a
--    query da vitrine esquecer o join.
--  - `taxas_entrega`/`bairros_zona` não têm flag própria nem `loja_id`: visibilidade e
--    propriedade resolvem via zona (`zona.ativo` para leitura; `zona → loja → dono_id`
--    para escrita).
--  - Toda *_escrita_propria usa FOR ALL com USING (gate de UPDATE/DELETE na linha
--    existente) E WITH CHECK (gate de INSERT/UPDATE na linha resultante) — o WITH CHECK
--    impede INSERT forjando `loja_id` de outro dono.
--
-- Conflito resolvido (seguranca.md §2 vs. correção de auditoria 001500):
--   §2 prescreve, para a leitura pública de produtos/categorias,
--   `EXISTS (SELECT 1 FROM lojas WHERE lojas.id = X.loja_id AND lojas.ativo = true)`.
--   Esse DDL assumia a policy `lojas_leitura_publica USING (ativo = true)`, que a
--   migration 001500 DROPOU (a vitrine de lojas virou a view `vitrine_lojas`). Sem
--   SELECT público na base `lojas`, o EXISTS rodando sob a RLS do anon retorna ZERO
--   linhas e o catálogo público fica invisível (quebra o contrato dos testes [1]/[12]).
--   Fix mínimo e localizado: a função `security definer` `public.loja_esta_ativa`
--   responde "a loja está ativa?" sem expor a LINHA de `lojas` (não vaza dono_id/
--   assinatura_*/hotmart_*). Mantém o filtro de loja ativa enforçado no BANCO (§1,
--   última linha de defesa) sem reabrir SELECT público da base. As policies de
--   escrita/leitura própria continuam idênticas a §2 — só dependem de
--   `lojas_leitura_propria`, que a 001500 deixou intacta.

-- Helper SECURITY DEFINER: a loja está ativa? Não expõe a linha de `lojas`.
-- STABLE: resultado não muda dentro da mesma instrução; permite cache do planner.
create function public.loja_esta_ativa(p_loja_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.lojas
    where lojas.id = p_loja_id and lojas.ativo = true
  );
$$;

revoke all on function public.loja_esta_ativa(uuid) from public;
grant execute on function public.loja_esta_ativa(uuid) to anon, authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════ produtos
-- Vitrine: público lê produto DISPONÍVEL de loja ATIVA
create policy "produtos_leitura_publica"
  on public.produtos for select
  using (
    disponivel = true
    and public.loja_esta_ativa(produtos.loja_id)
  );

-- Dono lê os PRÓPRIOS produtos (inclusive indisponíveis). Combinada por OR com a pública.
create policy "produtos_leitura_propria"
  on public.produtos for select
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = produtos.loja_id and lojas.dono_id = auth.uid()
    )
  );

-- Dono faz CRUD só nos próprios produtos (WITH CHECK barra loja_id alheio)
create policy "produtos_escrita_propria"
  on public.produtos for all
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = produtos.loja_id and lojas.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.lojas
      where lojas.id = produtos.loja_id and lojas.dono_id = auth.uid()
    )
  );

-- ════════════════════════════════════════════════════════════════ categorias
-- Pública se a loja estiver ativa (categoria não tem flag própria — herda do pai)
create policy "categorias_leitura_publica"
  on public.categorias for select
  using (public.loja_esta_ativa(categorias.loja_id));

create policy "categorias_escrita_propria"
  on public.categorias for all
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = categorias.loja_id and lojas.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.lojas
      where lojas.id = categorias.loja_id and lojas.dono_id = auth.uid()
    )
  );

-- ═════════════════════════════════════════════════════════════ zonas_entrega
-- Pública se ATIVA
create policy "zonas_leitura_publica"
  on public.zonas_entrega for select
  using (ativo = true);

create policy "zonas_escrita_propria"
  on public.zonas_entrega for all
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = zonas_entrega.loja_id and lojas.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.lojas
      where lojas.id = zonas_entrega.loja_id and lojas.dono_id = auth.uid()
    )
  );

-- ═════════════════════════════════════════════════════════════ taxas_entrega
-- Visibilidade e propriedade via zona (sem flag/loja_id próprios)
create policy "taxas_leitura_publica"
  on public.taxas_entrega for select
  using (
    exists (
      select 1 from public.zonas_entrega z
      where z.id = taxas_entrega.zona_id and z.ativo = true
    )
  );

create policy "taxas_escrita_propria"
  on public.taxas_entrega for all
  using (
    exists (
      select 1 from public.zonas_entrega z
      join public.lojas l on l.id = z.loja_id
      where z.id = taxas_entrega.zona_id and l.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.zonas_entrega z
      join public.lojas l on l.id = z.loja_id
      where z.id = taxas_entrega.zona_id and l.dono_id = auth.uid()
    )
  );

-- ══════════════════════════════════════════════════════════════ bairros_zona
-- Visibilidade e propriedade via zona (idem taxas)
create policy "bairros_leitura_publica"
  on public.bairros_zona for select
  using (
    exists (
      select 1 from public.zonas_entrega z
      where z.id = bairros_zona.zona_id and z.ativo = true
    )
  );

create policy "bairros_escrita_propria"
  on public.bairros_zona for all
  using (
    exists (
      select 1 from public.zonas_entrega z
      join public.lojas l on l.id = z.loja_id
      where z.id = bairros_zona.zona_id and l.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.zonas_entrega z
      join public.lojas l on l.id = z.loja_id
      where z.id = bairros_zona.zona_id and l.dono_id = auth.uid()
    )
  );

-- ═══════════════════════════════════════════════════════════ formas_pagamento
-- Cliente precisa ver as formas para escolher; config (chave Pix) é pública por design.
-- Divergência deliberada vs seguranca.md §2 (que prescrevia USING(true)): filtra por
-- loja ativa como as demais tabelas. Sem isso, forma de pagamento + jsonb config de
-- loja INATIVA vazaria ao anon (finding MÉDIA da auditoria 005).
create policy "pagamentos_leitura_publica"
  on public.formas_pagamento for select
  using (public.loja_esta_ativa(formas_pagamento.loja_id));

create policy "pagamentos_escrita_propria"
  on public.formas_pagamento for all
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = formas_pagamento.loja_id and lojas.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.lojas
      where lojas.id = formas_pagamento.loja_id and lojas.dono_id = auth.uid()
    )
  );


-- ╔══════════════════════════════════════════════════════════
-- ║ 20260614002500_rls_cupons_pedidos.sql
-- ╚══════════════════════════════════════════════════════════
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

