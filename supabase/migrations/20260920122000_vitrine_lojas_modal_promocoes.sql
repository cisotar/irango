-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 220 (migration 3 de 5 do Spec A) — recriação de `public.vitrine_lojas`
-- projetando `modal_promocoes`.
-- Spec: specs/desconto-por-produto-e-pratos-promocionais.md §Modelos de Dados
--       (migration 3) · D6 · RN-16.
-- Plano: plan/loop-implementacao-descontos-promocoes-cardapio-sazonal.md, onda 1.
--
-- POR QUE RECRIAR: a vitrine pública (`/loja/[slug]`, SSR anon) lê a loja
-- EXCLUSIVAMENTE por esta view (`buscarLojaPorSlug`/`buscarLojaPublicaPorId`,
-- queries/lojas.ts; `seguranca.md` §19, exceção aprovada) — nunca `public.lojas`.
-- Para RN-16 (o modal só abre se `loja.modal_promocoes === true`, decidido no
-- SSR), a coluna precisa entrar na projeção. `create or replace view` NÃO
-- permite mudar a lista de colunas → `drop` + `create`, como em 005000, 006000,
-- 013000 e 20260704120000.
--
-- ⚠ ESTE É O PONTO DE MAIOR RISCO DO SPEC A — risco de DISPONIBILIDADE:
--   1. `drop` + `create` reescreve a view INTEIRA. Uma coluna a menos derruba a
--      vitrine em silêncio: sem erro de migration, sem erro de CI, e o `tsc`
--      não pega porque `LojaPublica = Tables<"vitrine_lojas">` é gerado DEPOIS.
--      A lista abaixo foi levantada da ÚLTIMA migration que recriou a view
--      (`20260704120000_lojas_whatsapp_envio_automatico.sql`, 20 colunas) e
--      conferida contra `src/lib/database.types.ts`. A 20260707120000 (módulos
--      de impressão) NÃO tocou a view de propósito, e nenhuma migration
--      posterior a tocou. NOTA: o snippet do spec omite
--      `whatsapp_envio_automatico` — o spec é autoridade de REGRA, o arquivo é
--      autoridade de SCHEMA; a coluna FICA.
--   2. `drop` + `create` recria os privilégios do zero: sem o `grant select`
--      reaplicado NESTE arquivo, a vitrine para de carregar para todo mundo.
--   3. Escrita pela view definer auto-atualizável (`seguranca.md` §19): os
--      default privileges já são SELECT-only desde 20260702140000/150000, então
--      a view nova NÃO reganha escrita sozinha. O `revoke` explícito abaixo é
--      cinto-e-suspensórios e satisfaz a guarda estática [G3] de
--      tests/migrations/vitrine_lojas_select_only.test.ts.
--
-- AVALIAÇÃO DE EXPOSIÇÃO (aceita no spec): `modal_promocoes` revela só uma
--   preferência de UI da loja. Não é PII, não é billing, não revela nada sobre
--   dono, plano ou cliente. Risco de tenant: nenhum. Continuam FORA da
--   projeção, como antes: dono_id, hotmart_*, assinatura_inicio/atualizado,
--   consentimento_*, modulo_impressao_*, latitude/longitude.
--
-- A view segue `security_invoker = false` (definer) e `where ativo = true`,
-- pelos motivos da 001500 (sem SELECT público na base, uma view invoker
-- retornaria zero linhas; a definer expõe SÓ as colunas projetadas).
--
-- MUDANÇA COLUNA A COLUNA (20 → 21):
--   mantidas (20): id, slug, nome, telefone, whatsapp, ativo, endereco_rua,
--     endereco_numero, endereco_bairro, endereco_cidade, endereco_estado,
--     endereco_cep, tema, horarios, timezone, assinatura_status,
--     assinatura_fim_periodo, taxa_entrega_fora_zona, logo_url,
--     whatsapp_envio_automatico
--   acrescentada (1): modal_promocoes
--   removida: NENHUMA
--
-- Rollback: bloco comentado no fim.
-- ─────────────────────────────────────────────────────────────────────────────

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
    whatsapp_envio_automatico,
    modal_promocoes
  from public.lojas
  where ativo = true;

-- View pública recriada: SELECT-only para os roles da API (reafirma o hardening
-- das migrations 20260702140000/150000; a recriação não reintroduz escrita
-- porque os default privileges do schema já são SELECT-only).
revoke insert, update, delete on public.vitrine_lojas from anon, authenticated;
grant select on public.vitrine_lojas to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Reverter ESTA migration antes da 20260920121000 (a coluna só pode cair
-- depois que a view deixar de referenciá-la). Janela segura: a qualquer
-- momento — recriar a view com a lista anterior não perde dado; só o SSR que
-- já leia `modal_promocoes` (issue 234) passaria a receber `undefined`, então
-- reverta o código junto.
--
--   drop view if exists public.vitrine_lojas;
--   create view public.vitrine_lojas with (security_invoker = false) as
--     select id, slug, nome, telefone, whatsapp, ativo,
--            endereco_rua, endereco_numero, endereco_bairro, endereco_cidade,
--            endereco_estado, endereco_cep, tema, horarios, timezone,
--            assinatura_status, assinatura_fim_periodo, taxa_entrega_fora_zona,
--            logo_url, whatsapp_envio_automatico
--     from public.lojas where ativo = true;
--   revoke insert, update, delete on public.vitrine_lojas from anon, authenticated;
--   grant select on public.vitrine_lojas to anon, authenticated;
-- ─────────────────────────────────────────────────────────────────────────────
