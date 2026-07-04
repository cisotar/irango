-- ─────────────────────────────────────────────────────────────────────────────
-- [121] lojas.whatsapp_envio_automatico + projetar na view vitrine_lojas
--
-- Adiciona a preferência da loja `whatsapp_envio_automatico boolean NOT NULL
-- DEFAULT true`: quando ligada, o checkout dispara a abertura do WhatsApp assim
-- que o cliente confirma o pedido (spec 5 / RN-A1). Default `true` = comportamento
-- atual (notificar); lojas existentes ficam ligadas automaticamente.
--
-- SEGURO SEM EXPAND/BACKFILL/CONTRACT (aditivo puro):
--   `ADD COLUMN ... DEFAULT` em Postgres >= 11 NÃO reescreve a tabela: o default
--   constante é gravado no catálogo (pg_attribute.atthasmissing/attmissingval) e
--   materializado só na próxima escrita de cada linha. Como o default é a
--   constante `true`, o NOT NULL é satisfeito para toda linha existente sem
--   table rewrite e sem backfill. É a mesma classe de mudança de `ativo`/`logo_url`
--   (schema.md §lojas). Nenhuma escrita concorrente é perdida.
--
-- Naming: snake_case, `boolean NOT NULL DEFAULT` — padrão de `ativo`.
--
-- RLS: NENHUMA política nova. A coluna cai sob as políticas existentes de `lojas`:
--   UPDATE do dono (`lojas_update_proprio`) e escrita admin via service_role
--   escopada por `id` (`escopo.atualizarLoja`). Não é billing → fora da blocklist
--   `CAMPOS_LOJA_SOMENTE_SERVIDOR`; é gravada por allowlist em `montarPatchPerfil`.
--
-- VIEW vitrine_lojas: `buscarLojaPorSlug`/`buscarLojaPublicaPorId` leem a view
-- (queries/lojas.ts). O checkout precisa do valor client-side só para pré-abrir a
-- aba do WhatsApp (RN-A5, preview de UX). A flag NÃO é PII nem billing — o
-- `whatsapp` da loja já é público — logo expor na vitrine é aceitável (Segurança
-- do spec 5). A view segue `security_invoker = false` (definer) e `where ativo =
-- true`, iguais à 001500/005000/013000. `create or replace view` não permite mudar
-- a lista de colunas → drop + create. Mantém TODAS as colunas da versão anterior
-- (013000) + whatsapp_envio_automatico.
--
-- Rollback: bloco comentado no fim. Aditivo e reversível: reverter só perde o
-- valor não-default definido por lojistas após esta migration (ver janela abaixo).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.lojas
  add column if not exists whatsapp_envio_automatico boolean not null default true;

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
    logo_url,
    whatsapp_envio_automatico
  from public.lojas
  where ativo = true;

-- View pública recriada: SELECT-only para os roles da API (reafirma o hardening
-- das migrations 140000/150000; a recriação não reintroduz escrita porque o
-- GRANT ALL da 008500 foi one-shot e os default privileges já são SELECT-only).
revoke insert, update, delete on public.vitrine_lojas from anon, authenticated;
grant select on public.vitrine_lojas to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (manual, fora da migration):
--
--   drop view if exists public.vitrine_lojas;
--   create view public.vitrine_lojas with (security_invoker = false) as
--     select id, slug, nome, telefone, whatsapp, ativo,
--            endereco_rua, endereco_numero, endereco_bairro, endereco_cidade,
--            endereco_estado, endereco_cep, tema, horarios, timezone,
--            assinatura_status, assinatura_fim_periodo, taxa_entrega_fora_zona,
--            logo_url
--     from public.lojas where ativo = true;
--   revoke insert, update, delete on public.vitrine_lojas from anon, authenticated;
--   grant select on public.vitrine_lojas to anon, authenticated;
--   alter table public.lojas drop column if exists whatsapp_envio_automatico;
-- ─────────────────────────────────────────────────────────────────────────────
