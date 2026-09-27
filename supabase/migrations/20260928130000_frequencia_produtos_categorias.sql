-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 320 — Frequência de exibição por produto e por categoria (schema, policy,
-- view pública). Substitui o cardápio sazonal como fonte da janela de venda.
-- Spec: specs/frequencia-exibicao.md (§Banco, RN-2, RN-7, RN-8).
-- Plano: plan/tecnico-frequencia-exibicao.md (C1, D1, D2, D3, D4, D5, D12, D13).
--
-- O QUE MUDA:
--   (1) `produtos` e `categorias` ganham os 5 eixos da frequência (nullable, sem
--       default, sem backfill): dias_semana, hora_inicio, hora_fim,
--       periodo_inicio, periodo_fim. NULL = sem restrição; todos NULL =
--       permanente. Mesmos nomes e tipos de `cardapios` (D1).
--   (2) `categorias.oculta boolean not null default false`.
--   (3) 8 CHECKs NOMEADOS (os testes afirmam o nome na mensagem do 23514).
--   (4) policy `categorias_leitura_publica` passa a exigir `oculta = false`: o
--       nome da categoria oculta deixa de sair em /rest/v1/categorias para anon.
--       O dono segue vendo tudo pela `categorias_escrita_propria` (FOR ALL) (D5).
--   (5) `vitrine_produtos` recriada: as 15 colunas da 20260920132000 na MESMA
--       ordem + as 5 de frequência NO FIM (16..20); WHERE literal da 132000 +
--       `not exists` de categoria oculta. A view é DEFINER e não passa pela RLS
--       de `categorias`, por isso o termo explícito (D5).
--
-- A JANELA NUNCA VIRA SQL (D12, mesma razão da RN-06 do cardápio): dia da
-- semana, hora e período são avaliados em TS no fuso da loja
-- (`src/lib/utils/frequencia.ts`). `current_date` aqui seria o dia do servidor
-- (UTC), não o da loja. A view expõe as colunas; quem decide é o TS.
--
-- O predicado de cardápio (`visibilidade = 'menu' or exists(...)`) FICA (D4):
-- a view decide existência pública da linha, não comprabilidade. Depois da
-- 20260928132000 todo produto é 'menu' e o 1º braço curto-circuita.
--
-- `create or replace view` SUBSTITUI o conjunto de reloptions: as duas opções
-- são declaradas explícitas (omitir `security_barrier` reabre o vazamento por
-- erro de cast, 124500). Revoke/grant reemitidos neste arquivo ([G4]).
--
-- COMPATÍVEL COM O CÓDIGO EM PRODUÇÃO: as 15 colunas nomeadas por
-- `COLUNAS_PRODUTO_PUBLICO` continuam; nenhuma categoria nasce oculta. Deve ir
-- ao cloud ANTES do merge do código que lê as colunas novas (senão 42703).
--
-- ROLLBACK: bloco comentado no fim.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── (1)/(2) colunas ─────────────────────────────────────────────────────────
alter table public.produtos
  add column dias_semana    smallint[],
  add column hora_inicio    time,
  add column hora_fim       time,
  add column periodo_inicio date,
  add column periodo_fim    date;

alter table public.categorias
  add column dias_semana    smallint[],
  add column hora_inicio    time,
  add column hora_fim       time,
  add column periodo_inicio date,
  add column periodo_fim    date,
  add column oculta         boolean not null default false;

-- ─── (3) CHECKs ──────────────────────────────────────────────────────────────
-- `'{}'` PASSA de propósito no domínio (RN-8: nenhum dia marcado = nunca). `<@`
-- é verdadeiro para o array vazio. Proibido cardinality/coalesce aqui (D13).
alter table public.produtos
  add constraint produtos_dias_semana_dominio
    check (dias_semana is null or dias_semana <@ array[0,1,2,3,4,5,6]::smallint[]),
  add constraint produtos_hora_par
    check ((hora_inicio is null) = (hora_fim is null)),
  add constraint produtos_hora_ordem
    check (hora_inicio is null or hora_fim > hora_inicio),
  add constraint produtos_periodo_ordem
    check (periodo_inicio is null or periodo_fim is null or periodo_fim >= periodo_inicio);

alter table public.categorias
  add constraint categorias_dias_semana_dominio
    check (dias_semana is null or dias_semana <@ array[0,1,2,3,4,5,6]::smallint[]),
  add constraint categorias_hora_par
    check ((hora_inicio is null) = (hora_fim is null)),
  add constraint categorias_hora_ordem
    check (hora_inicio is null or hora_fim > hora_inicio),
  add constraint categorias_periodo_ordem
    check (periodo_inicio is null or periodo_fim is null or periodo_fim >= periodo_inicio);

-- ─── comentários de coluna (semântica S1–S3, RN-7, RN-8) ─────────────────────
comment on column public.produtos.dias_semana is
  'Frequencia de exibicao: dias da semana (0=dom..6=sab). NULL = todo dia; ''{}'' = nunca (RN-8); 7 dias sao gravados como NULL pela Server Action. Avaliada em TS (src/lib/utils/frequencia.ts), nunca em SQL.';
comment on column public.produtos.hora_inicio is
  'Frequencia de exibicao: inicio da faixa de horario, INCLUSIVO, no fuso da loja. Par com hora_fim; inicio < fim (nao vira a meia-noite). Avaliada em TS (src/lib/utils/frequencia.ts), nunca em SQL.';
comment on column public.produtos.hora_fim is
  'Frequencia de exibicao: fim da faixa de horario, EXCLUSIVO, no fuso da loja. Par com hora_inicio. Avaliada em TS (src/lib/utils/frequencia.ts), nunca em SQL.';
comment on column public.produtos.periodo_inicio is
  'Frequencia de exibicao: primeiro dia do periodo (date, INCLUSIVO, dia civil da loja). Antes dele o item aparece indisponivel. NULL = sem inicio. Avaliada em TS (src/lib/utils/frequencia.ts), nunca em SQL. Nao confundir com desconto_inicio.';
comment on column public.produtos.periodo_fim is
  'Frequencia de exibicao: ultimo dia do periodo (date, INCLUSIVO). Depois dele, no dia civil da loja, o item/categoria some da vitrine (RN-7) — decidido em TS (src/lib/utils/frequencia.ts), nunca em SQL. Nao confundir com desconto_fim.';

comment on column public.categorias.dias_semana is
  'Frequencia de exibicao da categoria: dias da semana (0=dom..6=sab). NULL = todo dia; ''{}'' = nunca (RN-8); 7 dias sao gravados como NULL pela Server Action. Avaliada em TS (src/lib/utils/frequencia.ts), nunca em SQL.';
comment on column public.categorias.hora_inicio is
  'Frequencia de exibicao da categoria: inicio da faixa de horario, INCLUSIVO, no fuso da loja. Par com hora_fim. Avaliada em TS, nunca em SQL.';
comment on column public.categorias.hora_fim is
  'Frequencia de exibicao da categoria: fim da faixa de horario, EXCLUSIVO, no fuso da loja. Par com hora_inicio. Avaliada em TS, nunca em SQL.';
comment on column public.categorias.periodo_inicio is
  'Frequencia de exibicao da categoria: primeiro dia do periodo (date, INCLUSIVO, dia civil da loja). Avaliada em TS, nunca em SQL.';
comment on column public.categorias.periodo_fim is
  'Frequencia de exibicao da categoria: ultimo dia do periodo (date, INCLUSIVO). Depois dele, no dia civil da loja, a categoria some da vitrine com seus produtos (RN-7) — decidido em TS (src/lib/utils/frequencia.ts), nunca em SQL.';
comment on column public.categorias.oculta is
  'Categoria oculta some da vitrine com seus produtos (RN-2): a policy categorias_leitura_publica e a view vitrine_produtos a excluem para anon; o dono segue vendo pela policy propria.';

-- ─── (4) policy de leitura pública de categorias ─────────────────────────────
alter policy "categorias_leitura_publica" on public.categorias
  using (oculta = false and public.loja_esta_ativa(categorias.loja_id));

-- ─── (5) view pública ────────────────────────────────────────────────────────
create or replace view public.vitrine_produtos
  with (security_invoker = false, security_barrier = true)
as
  select
    p.id,
    p.loja_id,
    p.categoria_id,
    p.nome,
    p.descricao,
    p.preco,
    p.disponivel,
    p.ordem,
    p.foto_url,
    public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now())
      as desconto_ativo,
    case when public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now())
         then p.desconto_tipo   end as desconto_tipo,
    case when public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now())
         then p.desconto_valor  end as desconto_valor,
    case when public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now())
         then p.desconto_inicio end as desconto_inicio,
    case when public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now())
         then p.desconto_fim    end as desconto_fim,
    p.visibilidade,                                            -- 15ª (245)
    p.dias_semana,                                             -- 16..20: frequência (320), NO FIM
    p.hora_inicio,
    p.hora_fim,
    p.periodo_inicio,
    p.periodo_fim
  from public.produtos p
  where p.oculto = false                                       -- literal 124000
    and public.loja_esta_ativa(p.loja_id)                      -- literal 124000
    and (
      p.visibilidade = 'menu'                                  -- 1º braço: curto-circuito (245/D3)
      or exists (
        select 1
          from public.cardapio_produtos cp
          join public.cardapios c
            on c.id = cp.cardapio_id
           and c.loja_id = cp.loja_id
         where cp.produto_id = p.id
           and cp.loja_id    = p.loja_id
           and c.ativo = true                                  -- EXPLÍCITO: definer não passa pela policy de cardapios
      )
    )
    and not exists (                                           -- 320/D5: categoria oculta some com seus produtos
      select 1
        from public.categorias cat
       where cat.id = p.categoria_id
         and cat.oculta = true                                 -- EXPLÍCITO: definer não passa pela policy de categorias
    );                                                         -- produto sem categoria (NULL) passa

comment on view public.vitrine_produtos is
  'Projecao PUBLICA do catalogo (seguranca.md §19, view definer). WHERE = oculto = false AND loja_esta_ativa AND (visibilidade = menu OR existe vinculo em cardapio ATIVO) AND categoria nao oculta (320). NAO avalia janela de vigencia nem frequencia (dias/hora/periodo): funcao pura em TS no fuso da loja (src/lib/utils/frequencia.ts) — inclusive o periodo encerrado (RN-7) fica DENTRO da view. desconto_ativo significa "VIGENTE NESTE INSTANTE" (D5/265); desconto_tipo/valor/inicio/fim so saem quando vigente, senao NULL. NAO calcula preco: precoEfetivo() em TS e a unica fonte. 20 colunas, ordem fixa (COLUNAS_PRODUTO_PUBLICO). service_role e o painel leem a TABELA.';

-- SELECT-only para os roles da API (§19; guarda estática [G4]).
revoke all on public.vitrine_produtos from anon, authenticated;
grant select on public.vitrine_produtos to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Ordem: reverter PRIMEIRO o código que nomeia as colunas novas
--   (COLUNAS_PRODUTO_PUBLICO, frequencia.ts), senão 42703 em toda vitrine.
--   Reverter antes a 20260928131000 (as RPCs escrevem nessas colunas).
-- `create or replace view` não remove coluna (42P16): drop + create literal da
--   20260920132000 (15 colunas):
--
--   drop view if exists public.vitrine_produtos;
--   create view public.vitrine_produtos
--     with (security_invoker = false, security_barrier = true)
--   as
--     select p.id, p.loja_id, p.categoria_id, p.nome, p.descricao, p.preco,
--            p.disponivel, p.ordem, p.foto_url,
--            public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now()) as desconto_ativo,
--            case when public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now()) then p.desconto_tipo   end as desconto_tipo,
--            case when public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now()) then p.desconto_valor  end as desconto_valor,
--            case when public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now()) then p.desconto_inicio end as desconto_inicio,
--            case when public.desconto_vigente(p.desconto_ativo, p.desconto_inicio, p.desconto_fim, now()) then p.desconto_fim    end as desconto_fim,
--            p.visibilidade
--       from public.produtos p
--      where p.oculto = false
--        and public.loja_esta_ativa(p.loja_id)
--        and (p.visibilidade = 'menu'
--             or exists (select 1 from public.cardapio_produtos cp
--                          join public.cardapios c on c.id = cp.cardapio_id and c.loja_id = cp.loja_id
--                         where cp.produto_id = p.id and cp.loja_id = p.loja_id and c.ativo = true));
--   revoke all on public.vitrine_produtos from anon, authenticated;
--   grant select on public.vitrine_produtos to anon, authenticated;
--
--   alter policy "categorias_leitura_publica" on public.categorias
--     using (public.loja_esta_ativa(categorias.loja_id));
--
--   alter table public.produtos
--     drop constraint produtos_dias_semana_dominio, drop constraint produtos_hora_par,
--     drop constraint produtos_hora_ordem, drop constraint produtos_periodo_ordem,
--     drop column dias_semana, drop column hora_inicio, drop column hora_fim,
--     drop column periodo_inicio, drop column periodo_fim;
--   alter table public.categorias
--     drop constraint categorias_dias_semana_dominio, drop constraint categorias_hora_par,
--     drop constraint categorias_hora_ordem, drop constraint categorias_periodo_ordem,
--     drop column dias_semana, drop column hora_inicio, drop column hora_fim,
--     drop column periodo_inicio, drop column periodo_fim, drop column oculta;
--
-- Efeito: perde as frequências e o "oculta" gravados depois do deploy.
-- ─────────────────────────────────────────────────────────────────────────────
