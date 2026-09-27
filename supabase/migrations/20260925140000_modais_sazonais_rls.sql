-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 300 — Migration 1 do modal sazonal: tabela `public.modais_sazonais` +
-- as duas junções (`modal_sazonal_categorias`, `modal_sazonal_cardapios`), com
-- RLS, GRANTs, CHECK de janela ordenada, FKs COMPOSTAS cross-tenant e o índice
-- único PARCIAL "um ativo por loja".
-- Spec: specs/modal-divulgacao-sazonal.md (§Modelos de Dados, §Segurança) ·
--       RN-02, RN-03, RN-05, RN-06, RN-08, RN-11.
--
-- ADITIVA E REVERSÍVEL. Não altera nenhuma tabela com dado de produção — só
-- CRIA três tabelas novas. NÃO toca `cardapios`, `cardapio_produtos`,
-- `categorias`, `lojas`, nem recria `vitrine_lojas`/`vitrine_produtos`. O toggle
-- de precedência mora AQUI (`modais_sazonais.mostrar_promocoes_junto`), não em
-- `lojas` (decisão (c) do plano — RN-09), então nenhuma coluna nova em `lojas`.
--
-- Reuso: `categorias` já tem `categorias_id_loja_unique (id, loja_id)`
-- (20260614007500) e `cardapios` já tem `cardapios_id_loja_unico`
-- (20260920128000) — ambos são o alvo das FKs compostas das junções. Esta
-- migration NÃO recria essas constraints. `public.loja_esta_ativa()` (security
-- definer, 20260614002000) é reusada nas policies públicas.
--
-- FORA DE ESCOPO (issues 301/302/303): queries TS, Server Actions, painel,
-- vitrine. Esta migration entrega só a CAMADA DE DADOS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════════ 1) modais_sazonais
-- A janela de exibição (`exibicao_inicio`/`exibicao_fim`) é coisa PRÓPRIA do
-- overlay, separada da vigência do cardápio (RN-08): a spec NÃO cria
-- `vigencia_inicio`/`vigencia_fim` em lugar nenhum e não lê o prazo do cardápio
-- para decidir a exibição. INCLUSIVO/EXCLUSIVO como o prazo de cardápio.
create table public.modais_sazonais (
  id                        uuid primary key default gen_random_uuid(),
  loja_id                   uuid not null references public.lojas(id) on delete cascade,
  titulo                    text not null,
  ativo                     boolean not null default false,

  -- JANELA DE EXIBIÇÃO DO OVERLAY (RN-02/RN-08). A AVALIAÇÃO da janela é do SSR
  -- (função pura no fuso da loja), nunca da policy — a RLS pública NÃO filtra a
  -- janela, só `ativo = true` (mesma decisão de `cardapios_leitura_publica`).
  exibicao_inicio           timestamptz not null,   -- INCLUSIVO
  exibicao_fim              timestamptz not null,   -- EXCLUSIVO

  -- Toggle de precedência (RN-09): com este modal ativo, o ModalPromocoes também
  -- abre? Mora AQUI, não em `lojas`: é preferência POR MODAL, some com o modal
  -- (ON DELETE CASCADE) e não polui a linha de `lojas` nem `vitrine_lojas`.
  mostrar_promocoes_junto   boolean not null default false,

  criado_em                 timestamptz not null default now(),
  atualizado_em             timestamptz not null default now(),

  -- Alvo das FKs compostas das junções (mesmo padrão de `cardapios_id_loja_unico`).
  constraint modais_sazonais_id_loja_unico unique (id, loja_id),

  -- Janela ordenada: fim depois do início. `23514` com nome de constraint →
  -- mensagem genérica na UI, detalhe no log (`seguranca.md` §14).
  constraint modais_sazonais_janela_ordem check (exibicao_fim > exibicao_inicio)
);

comment on table public.modais_sazonais is
  'Modal de divulgacao sazonal curado pelo lojista (spec modal-divulgacao-sazonal). A janela exibicao_inicio/exibicao_fim e do OVERLAY, separada da vigencia do cardapio (RN-08); a AVALIACAO da janela e do SSR no fuso da loja, nunca da policy (RN-02).';

comment on column public.modais_sazonais.mostrar_promocoes_junto is
  'RN-09: com este modal ativo, o ModalPromocoes tambem abre? Preferencia POR MODAL — mora aqui e nao em lojas.';

-- INVARIANTE "um ativo por loja" (RN-05): índice único PARCIAL. Defesa
-- ESTRUTURAL — vale inclusive sob `service_role` (BYPASSRLS). A Server Action
-- (issue 301) desativa o anterior na mesma transação; o índice é o backstop
-- contra corrida. Rascunhos (`ativo = false`) NÃO entram no índice, então
-- múltiplos rascunhos por loja convivem.
create unique index modais_sazonais_um_ativo_por_loja
  on public.modais_sazonais (loja_id)
  where ativo = true;

-- Consulta quente da vitrine: o modal ativo da loja.
create index modais_sazonais_loja_ativo_idx
  on public.modais_sazonais (loja_id, ativo);

-- ═════════════════════════════════════════════════════════════════════ 1) RLS
-- Tabela nova ⇒ RLS na MESMA migration (`seguranca.md` §2). Molde: as policies
-- de `cardapios` (20260920128000).
alter table public.modais_sazonais enable row level security;

-- Leitura pública: só modal ATIVO de loja ativa. Rascunho (`ativo = false`) é
-- estratégia do lojista e NÃO vaza para `anon` (RN-03). `public.loja_esta_ativa()`
-- (security definer) e NÃO um EXISTS direto em `lojas`: a base não tem SELECT
-- público, e o EXISTS sob a RLS do anon devolveria ZERO. A policy NÃO filtra a
-- janela de exibição — isso é do SSR (RN-02).
create policy "modais_sazonais_leitura_publica"
  on public.modais_sazonais for select
  using (
    ativo = true
    and public.loja_esta_ativa(modais_sazonais.loja_id)
  );

-- Dono lê os PRÓPRIOS modais, inclusive rascunhos (painel). OR com a pública.
create policy "modais_sazonais_leitura_propria"
  on public.modais_sazonais for select
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = modais_sazonais.loja_id and lojas.dono_id = auth.uid()
    )
  );

-- FOR ALL com USING (gate de UPDATE/DELETE) E WITH CHECK (gate de INSERT/UPDATE
-- na linha resultante) — o WITH CHECK impede INSERT/UPDATE forjando `loja_id`
-- alheio. Mesmo par de `cardapios`/`produtos`/`categorias`.
create policy "modais_sazonais_escrita_propria"
  on public.modais_sazonais for all
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = modais_sazonais.loja_id and lojas.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.lojas
      where lojas.id = modais_sazonais.loja_id and lojas.dono_id = auth.uid()
    )
  );

-- GRANTs (OBRIGATÓRIO e NÃO detectável em pglite; ver nota da 20260920128000).
grant select on public.modais_sazonais to anon;
grant select, insert, update, delete on public.modais_sazonais to authenticated;
grant all    on public.modais_sazonais to service_role;

-- ═══════════════════════════════════════════════════ 2) modal_sazonal_categorias
-- FKs COMPOSTAS `(modal_sazonal_id, loja_id)` e `(categoria_id, loja_id)`: a
-- linha só existe se modal e categoria forem da MESMA loja que ela declara — o
-- vetor cross-tenant vira IMPOSSÍVEL, não checado (RN-11, mesmo padrão de
-- `cardapio_produtos`).
create table public.modal_sazonal_categorias (
  id                uuid primary key default gen_random_uuid(),
  loja_id           uuid not null references public.lojas(id) on delete cascade,
  modal_sazonal_id  uuid not null,
  categoria_id      uuid not null,
  criado_em         timestamptz not null default now(),

  constraint msc_modal_fk
    foreign key (modal_sazonal_id, loja_id)
    references public.modais_sazonais (id, loja_id) on delete cascade,
  constraint msc_categoria_fk
    foreign key (categoria_id, loja_id)
    references public.categorias (id, loja_id) on delete cascade,

  unique (modal_sazonal_id, categoria_id)
);

create index modal_sazonal_categorias_modal_idx
  on public.modal_sazonal_categorias (modal_sazonal_id);

alter table public.modal_sazonal_categorias enable row level security;

create policy "modal_sazonal_categorias_leitura_publica"
  on public.modal_sazonal_categorias for select
  using (public.loja_esta_ativa(modal_sazonal_categorias.loja_id));

create policy "modal_sazonal_categorias_leitura_propria"
  on public.modal_sazonal_categorias for select
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = modal_sazonal_categorias.loja_id and lojas.dono_id = auth.uid()
    )
  );

create policy "modal_sazonal_categorias_escrita_propria"
  on public.modal_sazonal_categorias for all
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = modal_sazonal_categorias.loja_id and lojas.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.lojas
      where lojas.id = modal_sazonal_categorias.loja_id and lojas.dono_id = auth.uid()
    )
  );

grant select on public.modal_sazonal_categorias to anon;
grant select, insert, update, delete on public.modal_sazonal_categorias to authenticated;
grant all    on public.modal_sazonal_categorias to service_role;

-- ═══════════════════════════════════════════════════ 3) modal_sazonal_cardapios
-- `cardapios` já tem `cardapios_id_loja_unico` (20260920128000) — alvo da FK
-- composta. Mesmo isolamento cross-tenant de `modal_sazonal_categorias` (RN-11).
create table public.modal_sazonal_cardapios (
  id                uuid primary key default gen_random_uuid(),
  loja_id           uuid not null references public.lojas(id) on delete cascade,
  modal_sazonal_id  uuid not null,
  cardapio_id       uuid not null,
  criado_em         timestamptz not null default now(),

  constraint mscard_modal_fk
    foreign key (modal_sazonal_id, loja_id)
    references public.modais_sazonais (id, loja_id) on delete cascade,
  constraint mscard_cardapio_fk
    foreign key (cardapio_id, loja_id)
    references public.cardapios (id, loja_id) on delete cascade,

  unique (modal_sazonal_id, cardapio_id)
);

create index modal_sazonal_cardapios_modal_idx
  on public.modal_sazonal_cardapios (modal_sazonal_id);

alter table public.modal_sazonal_cardapios enable row level security;

create policy "modal_sazonal_cardapios_leitura_publica"
  on public.modal_sazonal_cardapios for select
  using (public.loja_esta_ativa(modal_sazonal_cardapios.loja_id));

create policy "modal_sazonal_cardapios_leitura_propria"
  on public.modal_sazonal_cardapios for select
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = modal_sazonal_cardapios.loja_id and lojas.dono_id = auth.uid()
    )
  );

create policy "modal_sazonal_cardapios_escrita_propria"
  on public.modal_sazonal_cardapios for all
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = modal_sazonal_cardapios.loja_id and lojas.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.lojas
      where lojas.id = modal_sazonal_cardapios.loja_id and lojas.dono_id = auth.uid()
    )
  );

grant select on public.modal_sazonal_cardapios to anon;
grant select, insert, update, delete on public.modal_sazonal_cardapios to authenticated;
grant all    on public.modal_sazonal_cardapios to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Janela segura: TOTAL enquanto nenhum modal real tiver sido criado por lojista
-- no cloud — as três tabelas nascem vazias e nada lê delas antes das issues
-- 301+. Depois que o painel do modal sazonal estiver em produção, o `drop table`
-- PERDE DADO (os modais do lojista); a partir daí, reverter exige dump antes.
--
-- Ordem REVERSA da criação (as junções dependem de modais_sazonais):
--
--   drop table if exists public.modal_sazonal_cardapios;   -- leva policies e índice junto
--   drop table if exists public.modal_sazonal_categorias;  -- leva policies e índice junto
--   drop table if exists public.modais_sazonais;           -- leva policies e índices junto
--
-- Nada a reverter em `categorias`/`cardapios`/`lojas`: esta migration NÃO os
-- altera (as constraints unique compostas alvo das FKs já existiam antes).
-- ─────────────────────────────────────────────────────────────────────────────
