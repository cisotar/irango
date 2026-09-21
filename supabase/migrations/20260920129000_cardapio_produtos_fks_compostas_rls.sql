-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 243 — Migration 2 do Spec B: `public.cardapio_produtos` com as
-- **FKs COMPOSTAS** (produto↔cardápio sempre da MESMA loja) + RLS + GRANTs.
-- Spec: specs/cardapio-sazonal.md (§Modelos de Dados, §Segurança) ·
--       D2 · RN-09, RN-10.
-- Plano: plan/loop-implementacao-descontos-promocoes-cardapio-sazonal.md (onda 3).
--
-- DEPENDE de 20260920128000 (issue 242): `public.cardapios`,
-- `cardapios_id_loja_unico` e `produtos_id_loja_unico` são os ALVOS das duas FKs
-- compostas abaixo. Aplicar SEMPRE depois dela; reverter SEMPRE antes dela.
--
-- ADITIVA E REVERSÍVEL. Tabela nova, nasce vazia. Não toca em nenhuma tabela com
-- dado de produção, não altera policy existente e NÃO ressuscita
-- `produtos_leitura_publica` (dropada pela 20260920125000): a leitura pública do
-- catálogo continua saindo exclusivamente pela view `public.vitrine_produtos`.
--
-- FORA DE ESCOPO: a Server Action do lote (251), a RPC
-- `aplicar_cardapio_em_categoria` (250), `produtos.visibilidade` e o trigger de
-- RN-14 (245) — todos dependem só desta tabela EXISTIR. Aqui existe apenas a
-- trava estrutural que eles usam.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════ 1) cardapio_produtos
-- `loja_id` redundante na tabela de junção é a convenção do schema (mesmo
-- desenho de `categoria_produto_opcionais`), mas aqui ele deixa de ser só
-- conveniência de RLS: é a COLUNA QUE AS DUAS FKs COMPOSTAS AMARRAM. A linha só
-- existe se cardápio e produto pertencerem à mesma loja que a própria linha
-- declara — o vetor cross-tenant da ação em lote (lista de ids vinda do
-- cliente) fica IMPOSSÍVEL, não meramente checado (RN-09).
--
-- Por que FK e não checagem na Server Action (como `categoriaPertenceALoja` em
-- `src/lib/actions/produto.ts:38`): pre-check em JS é TOCTOU, e FK **não é RLS**
-- — vale também sob `service_role` (BYPASSRLS), que é por onde o caminho do
-- pedido roda. Melhoria deliberada sobre o precedente, não cópia dele.
create table public.cardapio_produtos (
  id          uuid primary key default gen_random_uuid(),
  loja_id     uuid not null references public.lojas (id) on delete cascade,
  cardapio_id uuid not null,
  produto_id  uuid not null,
  criado_em   timestamptz not null default now(),

  -- Nomes LITERAIS: o teste (fatia crítica 1) afirma o nome da constraint dentro
  -- da mensagem do erro, não só o SQLSTATE `23503` — é o nome que prova QUAL
  -- armadilha disparou. Renomear estas constraints quebra o RED de propósito.
  constraint cardapio_produtos_cardapio_fk
    foreign key (cardapio_id, loja_id)
    references public.cardapios (id, loja_id) on delete cascade,
  constraint cardapio_produtos_produto_fk
    foreign key (produto_id, loja_id)
    references public.produtos (id, loja_id) on delete cascade,

  -- Alvo do `on conflict do nothing` que torna reaplicar o lote idempotente
  -- (RN-10). Nome gerado: `cardapio_produtos_cardapio_id_produto_id_key`.
  unique (cardapio_id, produto_id)
);

comment on table public.cardapio_produtos is
  'Vinculo produto<->cardapio (Spec B). As FKs COMPOSTAS (cardapio_id, loja_id) e (produto_id, loja_id) tornam o vinculo cross-tenant IMPOSSIVEL, inclusive sob service_role (FK nao e RLS) — RN-09. O unique (cardapio_id, produto_id) e o alvo do ON CONFLICT DO NOTHING que torna reaplicar o lote idempotente (RN-10).';

-- Consulta quente: produtos de um cardápio da loja (vitrine e painel).
create index on public.cardapio_produtos (loja_id, cardapio_id);
-- Caminho inverso: é o índice que o EXISTS da policy alterada da issue 245
-- (`produtos_leitura_publica`, D14/RN-14) e o trigger de órfão usam.
create index on public.cardapio_produtos (produto_id);

-- ═══════════════════════════════════════════════════════════════════════ 2) RLS
-- Tabela nova ⇒ RLS na MESMA migration (`seguranca.md` §2). Não é opcional e não
-- é "depois".
alter table public.cardapio_produtos enable row level security;

-- Leitura pública: vínculo de loja ativa. `public.loja_esta_ativa()` (security
-- definer, 20260614002000) e NÃO um EXISTS direto em `lojas`: a base não tem
-- SELECT público, e o EXISTS sob a RLS do anon devolveria ZERO linhas, quebrando
-- a vitrine em silêncio.
-- O filtro por cardápio ATIVO já mora em `cardapios_leitura_publica` (242): um
-- vínculo cujo cardápio está inativo não revela nada além de "este produto está
-- em algum cardápio", e a policy NÃO avalia a janela de vigência — isso é função
-- pura em TS, nunca SQL (RN-06).
create policy "cardapio_produtos_leitura_publica"
  on public.cardapio_produtos for select
  using (public.loja_esta_ativa(cardapio_produtos.loja_id));

-- Dono lê os PRÓPRIOS vínculos (painel), inclusive os de cardápio inativo.
-- Combinada por OR com a pública.
create policy "cardapio_produtos_leitura_propria"
  on public.cardapio_produtos for select
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = cardapio_produtos.loja_id and lojas.dono_id = auth.uid()
    )
  );

-- FOR ALL com USING (gate de UPDATE/DELETE na linha existente) E WITH CHECK
-- (gate de INSERT/UPDATE na linha resultante). Mesmo par de
-- `produtos`/`categorias`/`cupons`/`cardapios`.
--
-- ATENÇÃO — o que esta policy NÃO cobre, de propósito: ela valida SÓ
-- `cardapio_produtos.loja_id`. Sozinha, deixaria passar
-- `{loja_id: própria, produto_id: de outra loja}` — o IDOR clássico da ação em
-- lote. Quem fecha isso são as FKs compostas acima, por construção. Não tente
-- mover a defesa para cá: RLS não vale sob `service_role`.
create policy "cardapio_produtos_escrita_propria"
  on public.cardapio_produtos for all
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = cardapio_produtos.loja_id and lojas.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.lojas
      where lojas.id = cardapio_produtos.loja_id and lojas.dono_id = auth.uid()
    )
  );

-- ════════════════════════════════════════════════════════════════════ 3) GRANTs
-- OBRIGATÓRIO e NÃO detectável em pglite. A 20260702150000 reduziu os DEFAULT
-- PRIVILEGES de `anon`/`authenticated` a SELECT-only; toda tabela base criada
-- depois disso precisa de grant explícito. Sem estes grants, o lojista
-- autenticado levaria `42501 permission denied for table cardapio_produtos` no
-- PostgREST antes de `cardapio_produtos_escrita_propria` sequer ser avaliada — e
-- o CI não veria nada, porque `tests/helpers/pglite.ts` concede
-- insert/update/delete em TODAS as tabelas base DEPOIS de aplicar as migrations.
-- GRANT e RLS são camadas independentes (20260614008500). Mesmo padrão da 242.
-- `anon` fica com SELECT apenas: a vitrine só lê, e negar a OPERAÇÃO é mais
-- forte do que negar a linha.
grant select on public.cardapio_produtos to anon;
grant select, insert, update, delete on public.cardapio_produtos to authenticated;
grant all    on public.cardapio_produtos to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Janela segura: TOTAL enquanto nenhum lojista tiver vinculado produto a
-- cardápio no cloud — a tabela nasce vazia e nada lê dela antes das issues 244+.
-- Depois que o painel de cardápios estiver em produção, o `drop table` PERDE
-- DADO (os vínculos do lojista): a partir daí, reverter exige dump antes.
--
-- Reverter ANTES de 20260920128000 (242) — esta tabela referencia
-- `cardapios (id, loja_id)` e `produtos (id, loja_id)`. Reverter DEPOIS de
-- 245/250, que dependem desta tabela existir.
--
--   drop table if exists public.cardapio_produtos;   -- leva policies, índices e grants junto
--
-- `DROP TABLE` derruba as policies e os índices junto; os GRANTs somem com o
-- objeto. Nenhuma outra tabela perde dado.
-- ─────────────────────────────────────────────────────────────────────────────
