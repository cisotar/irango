-- ─────────────────────────────────────────────────────────────────────────────
-- [001] lojas.logo_url + projetar na view vitrine_lojas
--
-- Adiciona coluna nullable `logo_url text` à tabela lojas. NULL = loja sem logo.
-- A URL é dado público (aparece na vitrine), não é PII nem campo sensível.
--
-- CHECK de defesa-em-profundidade: aceita NULL ou apenas URL https://. A autoridade
-- real de validação/origem é a Server Action (schemaStorageUrl, seguranca.md §15);
-- o CHECK é a rede final do banco, não a primária. Envolto em bloco DO idempotente
-- porque `add constraint` não é idempotente nativamente.
--
-- A view `vitrine_lojas` é recriada (drop+create — `create or replace view` não
-- permite mudar a lista de colunas) para projetar `logo_url`, a única fonte anon
-- da vitrine pública. Mantém TODAS as colunas da versão anterior (006000) + logo_url.
-- Sem guard pglite: `public.lojas`/`public.vitrine_lojas` existem no pglite de teste
-- (mesmo padrão da migration 20260614006000).
--
-- Rollback: ver bloco no fim do arquivo. Aditivo e seguro — reverter só perde
-- logos preenchidas após esta migration.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.lojas
  add column if not exists logo_url text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lojas_logo_url_https_chk'
  ) then
    alter table public.lojas
      add constraint lojas_logo_url_https_chk
      check (logo_url is null or logo_url like 'https://%');
  end if;
end $$;

-- `create or replace view` não permite mudar a lista de colunas → drop + create.
drop view if exists public.vitrine_lojas;

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
    timezone,
    assinatura_status,
    assinatura_fim_periodo,
    taxa_entrega_fora_zona,
    logo_url
  from public.lojas
  where ativo = true;

grant select on public.vitrine_lojas to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (manual, fora da migration):
--
--   drop view if exists public.vitrine_lojas;
--   create view public.vitrine_lojas with (security_invoker = false) as
--     select id, slug, nome, telefone, whatsapp, ativo,
--            endereco_rua, endereco_numero, endereco_bairro, endereco_cidade,
--            endereco_estado, endereco_cep, tema, horarios, timezone,
--            assinatura_status, assinatura_fim_periodo, taxa_entrega_fora_zona
--     from public.lojas where ativo = true;
--   grant select on public.vitrine_lojas to anon, authenticated;
--   alter table public.lojas drop constraint if exists lojas_logo_url_https_chk;
--   alter table public.lojas drop column if exists logo_url;
-- ─────────────────────────────────────────────────────────────────────────────
