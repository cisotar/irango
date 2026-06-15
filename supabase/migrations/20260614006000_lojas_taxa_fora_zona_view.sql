-- Issue 068 — lojas.taxa_entrega_fora_zona + view vitrine_lojas
--
-- Adiciona coluna nullable `taxa_entrega_fora_zona numeric(10,2)` à tabela lojas.
-- NULL = entrega fora de zona indisponível (RN-C4 do spec_checkout_pagamento).
-- Um valor numérico = frete fixo fallback quando o bairro não casa nenhuma zona.
--
-- A view `vitrine_lojas` é recriada para incluir a nova coluna, necessária para
-- o preview de frete no checkout antes de o pedido ser enviado ao servidor.
-- `taxa_entrega_fora_zona` não é PII — é informação de frete pública.
--
-- Rollback: DROP COLUMN lojas.taxa_entrega_fora_zona (perda apenas de dados
-- inseridos após esta migration; seguro até o primeiro lojista preencher o campo).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.lojas
  add column taxa_entrega_fora_zona numeric(10,2);

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
    taxa_entrega_fora_zona
  from public.lojas
  where ativo = true;

grant select on public.vitrine_lojas to anon, authenticated;
