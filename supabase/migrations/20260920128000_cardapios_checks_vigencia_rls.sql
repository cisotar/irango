-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 242 — Migration 1 do Spec B: `produtos_id_loja_unico` + tabela
-- `public.cardapios` (CHECKs de vigência) + RLS.
-- Spec: specs/cardapio-sazonal.md (§Modelos de Dados, §Segurança) ·
--       D2, D3, D3-a, D3-b, D16 · RN-01..RN-04, RN-15.
-- Plano: plan/loop-implementacao-descontos-promocoes-cardapio-sazonal.md (onda 3).
--
-- ADITIVA E REVERSÍVEL. Não altera nenhuma tabela com dado de produção além de
-- acrescentar uma constraint UNIQUE redundante com a PK de `produtos` (sempre
-- satisfeita pelas linhas existentes). Não recria `public.vitrine_lojas`, não
-- recria `public.vitrine_produtos`, não toca em policy existente — em especial,
-- NÃO ressuscita `produtos_leitura_publica`, dropada pela 20260920125000: a
-- leitura pública do catálogo continua saindo exclusivamente por
-- `public.vitrine_produtos`. O ajuste de visibilidade que depende de cardápio
-- (D14) é da issue 244 e projeta na VIEW, não aqui.
--
-- FORA DE ESCOPO (issues 243/244/250): `cardapio_produtos` e as FKs compostas,
-- `produtos.visibilidade` + trigger de órfão, RPC `aplicar_cardapio_em_categoria`.
-- Esta migration entrega só o ALVO da FK composta e a entidade cardápio.
-- ─────────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════ 1) alvo das FKs compostas (243)
-- Redundante com a PK (`id` já é único), portanto sempre satisfeita pelas linhas
-- existentes de `produtos` — não há backfill nem janela de escrita a proteger.
-- Existe só para que `cardapio_produtos (produto_id, loja_id)` possa referenciar
-- o par e tornar o vínculo cross-tenant IMPOSSÍVEL (§Modelos de Dados, RN-09).
alter table public.produtos
  add constraint produtos_id_loja_unico unique (id, loja_id);

-- ═════════════════════════════════════════════════════════════════ 2) cardapios
-- Colunas + CHECK, e não jsonb como `lojas.horarios`: a forma é disjunta por
-- `modo`, o lojista escreve direto nessa linha (PostgREST + anon key) e o erro
-- precisa ser diagnosticável (`23514` com nome de constraint). Convenção de
-- CHECK inline em vez de `CREATE TYPE` — `schema.md` §5, como `cupons.tipo` e
-- `produtos_desconto_tipo_check`.
create table public.cardapios (
  id            uuid primary key default gen_random_uuid(),
  loja_id       uuid not null references public.lojas(id) on delete cascade,
  nome          text not null,
  ativo         boolean not null default true,
  -- D16/RN-15: chave de ordenação das SEÇÕES DE DESTAQUE na vitrine. A Server
  -- Action de criação grava max(ordem)+1 da loja. A UI de reordenar fica fora
  -- da v1 — a coluna existe, a tela não.
  ordem         int not null default 0,

  -- CHECK anônimo (nome gerado: `cardapios_modo_check`), literal do spec.
  modo          text not null check (modo in ('recorrente','prazo_fixo')),

  -- RECORRENTE (D3-a). NULL/vazio num eixo = "sem restrição por esse eixo".
  dias_semana   smallint[],   -- 0=dom .. 6=sab, mesma convenção de partesNoFuso
  dias_mes      smallint[],   -- 1..31
  hora_inicio   time,         -- INCLUSIVO
  hora_fim      time,         -- EXCLUSIVO

  -- PRAZO FIXO (D3-b)
  prazo_inicio  timestamptz,  -- INCLUSIVO
  prazo_fim     timestamptz,  -- EXCLUSIVO
  -- CHECK anônimo (nome gerado: `cardapios_prazo_preset_check`), literal do spec.
  prazo_preset  text check (prazo_preset is null
                            or prazo_preset in ('diario','semanal','mensal','customizado')),

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  -- Alvo da FK composta de `cardapio_produtos` (issue 243), mesmo motivo do
  -- `produtos_id_loja_unico` acima.
  constraint cardapios_id_loja_unico unique (id, loja_id),

  -- Disjunção por modo: os campos do OUTRO modo têm de ser NULL.
  constraint cardapios_recorrente_exclusivo check (
    modo <> 'recorrente'
    or (prazo_inicio is null and prazo_fim is null and prazo_preset is null)
  ),
  constraint cardapios_prazo_exclusivo check (
    modo <> 'prazo_fixo'
    or (dias_semana is null and dias_mes is null and hora_inicio is null and hora_fim is null)
  ),

  -- Recorrente precisa de PELO MENOS UM eixo. `coalesce(cardinality(...), 0) > 0`
  -- recusa NULL **e** `'{}'`: o array vazio passaria por um `is not null` e
  -- produziria um cardápio que não restringe nada — estado que o lojista não
  -- consegue diagnosticar.
  constraint cardapios_recorrente_tem_eixo check (
    modo <> 'recorrente' or (
      coalesce(cardinality(dias_semana), 0) > 0
      or coalesce(cardinality(dias_mes), 0) > 0
      or hora_inicio is not null
    )
  ),

  -- Faixa de horário: par tudo-ou-nada, e NÃO cruza a meia-noite (RN-02).
  -- É a defesa que `lojas.horarios` não tem: "abre 22:00, fecha 02:00" nunca
  -- abre, em silêncio (lojaAberta.ts). Aqui a linha não existe.
  constraint cardapios_hora_par   check ((hora_inicio is null) = (hora_fim is null)),
  constraint cardapios_hora_ordem check (hora_inicio is null or hora_fim > hora_inicio),

  -- Domínio dos dias (array literal: nada de generate_series dentro de CHECK,
  -- que precisa ser IMMUTABLE).
  constraint cardapios_dias_semana_dominio check (
    dias_semana is null or dias_semana <@ array[0,1,2,3,4,5,6]::smallint[]
  ),
  constraint cardapios_dias_mes_dominio check (
    dias_mes is null or dias_mes <@ array[
      1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,
      17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]::smallint[]
  ),

  -- Prazo fixo: par obrigatório e ordenado.
  constraint cardapios_prazo_obrigatorio check (
    modo <> 'prazo_fixo'
    or (prazo_inicio is not null and prazo_fim is not null and prazo_preset is not null)
  ),
  constraint cardapios_prazo_ordem check (
    prazo_inicio is null or prazo_fim is null or prazo_fim > prazo_inicio
  )
);

comment on table public.cardapios is
  'Cardapio sazonal (Spec B). Vigencia por modo: recorrente (dias_semana/dias_mes/hora_*) ou prazo_fixo (prazo_*). Os CHECKs tornam a vigencia incoerente IMPOSSIVEL de gravar; a AVALIACAO da janela (relogio + fuso da loja) e da funcao pura em TS, nunca da policy (RN-06).';

comment on column public.cardapios.ordem is
  'D16/RN-15: ordem das secoes de destaque na vitrine. Criacao grava max(ordem)+1 da loja; UI de reordenar fora da v1.';

-- Consulta quente: cardápios ativos de uma loja (vitrine e painel).
create index if not exists cardapios_loja_id_ativo_idx
  on public.cardapios (loja_id, ativo);

-- ═══════════════════════════════════════════════════════════════════════ 3) RLS
-- Tabela nova ⇒ RLS na MESMA migration (`seguranca.md` §2). Não é opcional e
-- não é "depois".
alter table public.cardapios enable row level security;

-- Leitura pública: só cardápio ATIVO de loja ativa. Cardápio inativo é
-- estratégia comercial do lojista (o rascunho "Cardápio de Natal" em setembro)
-- e não vaza para `anon` — mesma preocupação que impede SELECT público em
-- `cupons`.
-- `public.loja_esta_ativa()` (security definer, 20260614002000) e NÃO um EXISTS
-- direto em `lojas`: a base não tem SELECT público, e o EXISTS sob a RLS do
-- anon devolveria ZERO linhas, quebrando a vitrine em silêncio.
-- A policy NÃO é a autoridade da janela e não tenta ser: replicar aritmética de
-- dia/hora/fuso em SQL seria a segunda implementação da regra e a primeira a
-- divergir (RN-06). Além disso, o caminho do pedido roda sob `service_role`
-- (BYPASSRLS) — regra que morasse só aqui não existiria lá.
create policy "cardapios_leitura_publica"
  on public.cardapios for select
  using (
    ativo = true
    and public.loja_esta_ativa(cardapios.loja_id)
  );

-- Dono lê os PRÓPRIOS cardápios, inclusive os inativos (painel). Combinada por
-- OR com a pública.
create policy "cardapios_leitura_propria"
  on public.cardapios for select
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = cardapios.loja_id and lojas.dono_id = auth.uid()
    )
  );

-- FOR ALL com USING (gate de UPDATE/DELETE na linha existente) E WITH CHECK
-- (gate de INSERT/UPDATE na linha resultante) — o WITH CHECK impede INSERT
-- forjando `loja_id` de outro dono. Mesmo par de `produtos`/`categorias`/`cupons`.
create policy "cardapios_escrita_propria"
  on public.cardapios for all
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = cardapios.loja_id and lojas.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.lojas
      where lojas.id = cardapios.loja_id and lojas.dono_id = auth.uid()
    )
  );

-- ════════════════════════════════════════════════════════════════════ 4) GRANTs
-- OBRIGATÓRIO e NÃO detectável em pglite. A 20260702150000 reduziu os DEFAULT
-- PRIVILEGES de `anon`/`authenticated` a SELECT-only; `cardapios` é a primeira
-- tabela base criada DEPOIS disso. Sem estes grants, o lojista autenticado
-- levaria `42501 permission denied for table cardapios` no PostgREST antes de a
-- policy `cardapios_escrita_propria` sequer ser avaliada — e o harness de teste
-- não veria nada, porque `tests/helpers/pglite.ts` concede insert/update/delete
-- em TODAS as tabelas base DEPOIS de aplicar as migrations. GRANT e RLS são
-- camadas independentes (20260614008500).
-- `anon` fica com SELECT apenas: a vitrine só lê, e negar a operação é mais
-- forte do que negar a linha.
grant select on public.cardapios to anon;
grant select, insert, update, delete on public.cardapios to authenticated;
grant all    on public.cardapios to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Janela segura: TOTAL enquanto nenhum cardápio real tiver sido criado por
-- lojista no cloud — a tabela nasce vazia e nada lê dela antes das issues
-- 243+. Depois que o painel de cardápios estiver em produção, o `drop table`
-- PERDE DADO (os cardápios do lojista) e a cascata leva junto
-- `cardapio_produtos` (243): a partir daí, reverter exige dump antes.
-- Reverter esta migration ANTES de reverter 243/244/250, que dependem dela.
--
--   drop table if exists public.cardapios;                    -- leva policies e índice junto
--   alter table public.produtos drop constraint if exists produtos_id_loja_unico;
--
-- O `drop constraint` só é seguro enquanto `cardapio_produtos` (243) não
-- existir: ela referencia esse par. Não perde dado de `produtos` — a constraint
-- é redundante com a PK.
-- ─────────────────────────────────────────────────────────────────────────────
