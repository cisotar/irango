-- ─────────────────────────────────────────────────────────────────────────────
-- Modalidades de entrega por loja + frete a combinar (fatia A1).
-- Spec: specs/modalidades-entrega-loja.md §Modelo de dados.
-- Plano: plan/loop-modalidades-entrega-loja.md.
--
-- EXPAND só: três colunas novas em `public.lojas`, todas NOT NULL com default.
-- Toda loja que já existe fica com retirada ON, entrega ON e frete automático,
-- que é exatamente o comportamento de hoje. Nenhum backfill necessário.
--
--   aceita_retirada boolean not null default true
--   aceita_entrega  boolean not null default true
--   modo_frete      text    not null default 'automatico'
--                   CHECK modo_frete in ('automatico','a_combinar')
--   CHECK lojas_ao_menos_uma_modalidade (aceita_retirada or aceita_entrega)
--
-- RLS: nenhuma política nova. As colunas vivem em `lojas`, cuja política de
-- UPDATE por dono (lojas_update_proprio) já cobre a escrita do lojista; o
-- admin escreve via service_role escopado por `id` (escopo.atualizarLoja).
-- As colunas NÃO entram em `lojas_protege_billing`: são configuração
-- operacional do lojista, não billing.
--
-- `pedidos` não muda: o par `frete_a_combinar` + `taxa_entrega IS NULL`
-- (`chk_pedidos_frete_a_combinar`) já existe e é reusado.
--
-- ─── vitrine_lojas ──────────────────────────────────────────────────────────
-- A vitrine lê a loja SÓ pela view (seguranca.md §19). As três colunas entram na
-- projeção → `drop` + `create` (create or replace não muda a lista de colunas).
--
-- ⚠ Riscos do drop+create, todos tratados NESTE arquivo:
--   1. Coluna a menos derruba a vitrine em silêncio. A lista abaixo é a da
--      ÚLTIMA recriação (20260920122000, 21 colunas) + as 3 novas.
--   2. `security_barrier = true` foi ligado DEPOIS da 122000, pela 20260920124500
--      (ALTER VIEW). Um drop+create copiado do molde perde a opção sem erro —
--      reaplicada aqui no `with (...)`. Travado por [5c] em
--      tests/migrations/lojas_modalidades_entrega.test.ts.
--   3. Privilégios recriados do zero: `revoke all` + `grant select` reaplicados
--      (forma da 124500, exigida por seguranca.md §19 e pela guarda [G3]).
--
-- AVALIAÇÃO DE EXPOSIÇÃO: as três colunas são preferência operacional pública
-- (a vitrine precisa delas para esconder a modalidade desligada). Não é PII nem
-- billing. Continuam FORA: dono_id, hotmart_*, assinatura_inicio/atualizada_em,
-- consentimento_*, modulo_impressao_*, latitude/longitude.
--
-- MUDANÇA COLUNA A COLUNA (21 → 24):
--   mantidas (21): id, slug, nome, telefone, whatsapp, ativo, endereco_rua,
--     endereco_numero, endereco_bairro, endereco_cidade, endereco_estado,
--     endereco_cep, tema, horarios, timezone, assinatura_status,
--     assinatura_fim_periodo, taxa_entrega_fora_zona, logo_url,
--     whatsapp_envio_automatico, modal_promocoes
--   acrescentadas (3): aceita_retirada, aceita_entrega, modo_frete
--   removida: NENHUMA
--
-- Rollback: bloco comentado no fim.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.lojas
  add column aceita_retirada boolean not null default true,
  add column aceita_entrega  boolean not null default true,
  add column modo_frete      text    not null default 'automatico';

alter table public.lojas
  add constraint lojas_modo_frete_check
    check (modo_frete in ('automatico', 'a_combinar'));

alter table public.lojas
  add constraint lojas_ao_menos_uma_modalidade
    check (aceita_retirada or aceita_entrega);

-- `create or replace view` não permite mudar a lista de colunas → drop + create.
drop view if exists public.vitrine_lojas;

create view public.vitrine_lojas
  with (security_invoker = false, security_barrier = true)
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
    whatsapp_envio_automatico,
    modal_promocoes,
    aceita_retirada,
    aceita_entrega,
    modo_frete
  from public.lojas
  where ativo = true;

-- View pública recriada: SELECT-only para os roles da API (seguranca.md §19).
revoke all on public.vitrine_lojas from anon, authenticated;
grant select on public.vitrine_lojas to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Ordem: primeiro a view (deixa de referenciar as colunas), depois as colunas.
-- Reverta o código junto: a vitrine e o checkout passam a ler `undefined`.
-- Perde a configuração de modalidades gravada pelos lojistas.
--
--   drop view if exists public.vitrine_lojas;
--   create view public.vitrine_lojas
--     with (security_invoker = false, security_barrier = true) as
--     select id, slug, nome, telefone, whatsapp, ativo,
--            endereco_rua, endereco_numero, endereco_bairro, endereco_cidade,
--            endereco_estado, endereco_cep, tema, horarios, timezone,
--            assinatura_status, assinatura_fim_periodo, taxa_entrega_fora_zona,
--            logo_url, whatsapp_envio_automatico, modal_promocoes
--     from public.lojas where ativo = true;
--   revoke all on public.vitrine_lojas from anon, authenticated;
--   grant select on public.vitrine_lojas to anon, authenticated;
--
--   alter table public.lojas drop constraint if exists lojas_ao_menos_uma_modalidade;
--   alter table public.lojas drop constraint if exists lojas_modo_frete_check;
--   alter table public.lojas
--     drop column if exists modo_frete,
--     drop column if exists aceita_entrega,
--     drop column if exists aceita_retirada;
-- ─────────────────────────────────────────────────────────────────────────────
