-- ─────────────────────────────────────────────────────────────────────────────
-- [182] taxas_entrega: índice único em zona_id (corrige 42P10 na edição de zona)
--
-- CAUSA RAIZ (tasks/182): `taxas_entrega` nunca teve índice único em `zona_id` —
-- o único índice único é o da PK em `id`. `src/lib/actions/entrega.ts:177` e
-- `src/app/admin/assinantes/actions/admin-entrega.ts:131` fazem
-- `.upsert({...}, { onConflict: "zona_id" })`; sem constraint correspondente o
-- Postgres recusa o `ON CONFLICT (zona_id)` com 42P10 ("there is no unique or
-- exclusion constraint matching the ON CONFLICT specification"). Falha nos DOIS
-- painéis (dono autenticado e service_role — não é RLS). `criarZona` usa
-- `.insert` e por isso sempre funcionou: só a EDIÇÃO de zona já cadastrada
-- quebra.
--
-- A cardinalidade 1:1 zona→taxa é convenção do código (queries/
-- entregaPagamento.ts:55 colapsa o array embutido com `taxa[0]`), nunca foi
-- imposta pelo schema. Este índice passa a impô-la — e de quebra torna
-- determinístico o `taxa[0]`, que hoje escolhe uma taxa arbitrária se houver
-- duplicata.
--
-- ── DEDUP: qual linha sobrevive ────────────────────────────────────────────
-- `taxas_entrega` NÃO tem `created_at` e a PK é `gen_random_uuid()` (v4, sem
-- ordem temporal): "a mais recente" NÃO é derivável do dado. A única ordem
-- observável é a física (`ctid`), que é justamente a que um seq scan — e
-- portanto o PostgREST sem `order` — devolve primeiro.
--
-- REGRA: por `zona_id`, sobrevive a linha de MENOR `ctid`; as demais são
-- ARQUIVADAS e removidas.
--
-- POR QUÊ a de menor ctid, e não a "última": `taxa` é dado monetário em
-- produção. A linha de menor ctid é exatamente a que o `taxa[0]` da vitrine lê
-- hoje, ou seja, o frete que a loja já está cobrando. Escolher qualquer outra
-- mudaria silenciosamente um valor cobrado ao cliente durante uma migration de
-- integridade — efeito colateral inaceitável. Preservar o status quo é a opção
-- conservadora e, além disso, a única deterministicamente definível aqui.
-- (Duplicata só pode ter nascido de `criarZona`/`.insert` repetido: o `.upsert`
-- nunca chegou a executar por causa do 42P10 — não há semântica de "edição mais
-- nova" a preservar.)
--
-- POR QUÊ arquivar em vez de só deletar: DELETE de dado monetário é
-- irreversível. A tabela-arquivo mantém o rollback real (basta reinserir) e a
-- evidência de quanto/quantas duplicatas existiam no cloud. Ela nasce com RLS
-- habilitada e SEM policy (deny-all para anon/authenticated; só service_role,
-- que faz BYPASSRLS, alcança) — mesmo padrão de `admin_acessos` e
-- `webhook_eventos_hotmart`.
--
-- Em banco sem duplicata (caso esperado no cloud) o bloco de dedup é no-op e a
-- tabela-arquivo fica vazia.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Arquivo das duplicatas descartadas ────────────────────────────────────
create table if not exists public.taxas_entrega_duplicadas_182 (
  id           uuid primary key default gen_random_uuid(),
  taxa_id      uuid not null,              -- id original em taxas_entrega (SEM FK: a linha some)
  zona_id      uuid not null,              -- SEM FK: o arquivo sobrevive ao delete da zona
  taxa                 numeric(10,2) not null,
  pedido_minimo_gratis numeric(10,2),
  raio_max_km          numeric(5,2),
  cep_inicio           integer,
  cep_fim              integer,
  arquivado_em timestamptz not null default now()
);

alter table public.taxas_entrega_duplicadas_182 enable row level security; -- deny-all (sem policy)

revoke all on table public.taxas_entrega_duplicadas_182 from anon, authenticated;
grant all on table public.taxas_entrega_duplicadas_182 to service_role;

-- ── 2. Backfill/dedup: arquiva e remove as perdedoras ────────────────────────
with ranqueadas as (
  select id, zona_id,
         row_number() over (partition by zona_id order by ctid) as pos
    from public.taxas_entrega
),
perdedoras as (
  select id from ranqueadas where pos > 1
),
arquivadas as (
  insert into public.taxas_entrega_duplicadas_182
    (taxa_id, zona_id, taxa, pedido_minimo_gratis, raio_max_km, cep_inicio, cep_fim)
  select t.id, t.zona_id, t.taxa, t.pedido_minimo_gratis, t.raio_max_km, t.cep_inicio, t.cep_fim
    from public.taxas_entrega t
    join perdedoras p on p.id = t.id
  returning taxa_id
)
delete from public.taxas_entrega t
 using arquivadas a
 where t.id = a.taxa_id;

-- ── 3. Contract: a constraint que faltava ────────────────────────────────────
-- Índice único (não constraint nomeada): é o que o `ON CONFLICT (zona_id)` do
-- PostgREST precisa, e é revertível com um `drop index`. Sem CONCURRENTLY —
-- CREATE INDEX simples toma lock SHARE (bloqueia escrita, permite leitura
-- concorrente), a migration roda em transação e a tabela é pequena (poucas
-- zonas por loja), então a janela é instantânea.
create unique index if not exists taxas_entrega_zona_id_key
  on public.taxas_entrega (zona_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (manual, migration inversa — nesta ordem):
--   drop index if exists public.taxas_entrega_zona_id_key;
--   insert into public.taxas_entrega
--     (id, zona_id, taxa, pedido_minimo_gratis, raio_max_km, cep_inicio, cep_fim)
--   select taxa_id, zona_id, taxa, pedido_minimo_gratis, raio_max_km, cep_inicio, cep_fim
--     from public.taxas_entrega_duplicadas_182
--    where zona_id in (select id from public.zonas_entrega)   -- zonas ainda existentes
--   on conflict (id) do nothing;
--   drop table if exists public.taxas_entrega_duplicadas_182;
--
-- Janela segura: o rollback restaura o estado exato anterior enquanto NENHUMA
-- taxa nova tiver sido gravada pelo `.upsert` que este índice destrava. Depois
-- disso, derrubar o índice não perde dado (o upsert vira insert-conflitante de
-- novo, com 42P10), mas as duplicatas reinseridas voltariam a competir pelo
-- `taxa[0]` — reinserir só se houver motivo real.
-- ─────────────────────────────────────────────────────────────────────────────
