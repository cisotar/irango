-- Issue 004 (correção de auditoria MÉDIA) — projeção pública da vitrine de lojas
--
-- Finding: `lojas_leitura_publica USING (ativo = true)` liberava a LINHA INTEIRA
-- de toda loja ativa ao anon. RLS filtra LINHA, não COLUNA — então um
-- `select dono_id, hotmart_subscriber_code, assinatura_status, consentimento_em
--  from public.lojas where ativo = true` vazava dado sensível/de outro tenant.
--
-- FIX (opção a — enforçado no banco, sem mover colunas, sem cascata Hotmart):
--  1. Remove o SELECT público da TABELA BASE (`lojas_leitura_publica`).
--  2. Cria `public.vitrine_lojas` como projeção pública SÓ com as colunas
--     não-sensíveis da vitrine, filtrando `ativo = true`.
--  3. anon/authenticated leem a vitrine pela VIEW, nunca da base.
--
-- `lojas_leitura_propria` (dono lê a própria linha completa) e as policies de
-- insert/update/delete permanecem INTACTAS — o dono continua lendo TUDO da
-- própria loja diretamente na base.

-- 1) Remove o SELECT público da tabela base.
drop policy "lojas_leitura_publica" on public.lojas;

-- 2) View de projeção pública.
--
-- EXCEÇÃO DELIBERADA a seguranca.md §19 (que exige security_invoker = true para
-- views sobre tabelas com RLS):
--   Aqui a view é INTENCIONALMENTE `security_invoker = false` (definer). Sem o
--   SELECT público na base, uma view security_invoker=true rodaria com as
--   permissões do anon e retornaria ZERO linhas. A view definer roda com as
--   permissões do owner e expõe APENAS as colunas projetadas abaixo — todas já
--   públicas (loja ativa). Não há isolamento de tenant a violar: a projeção não
--   inclui NENHUMA coluna sensível nem de outro tenant (sem dono_id,
--   assinatura_*, hotmart_*, consentimento_*). É uma vitrine pública por design.
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
    timezone
  from public.lojas
  where ativo = true;

-- 3) Acesso público de leitura à projeção.
grant select on public.vitrine_lojas to anon, authenticated;
