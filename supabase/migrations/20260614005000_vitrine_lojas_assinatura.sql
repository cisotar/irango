-- Issue 058 — expor estado de assinatura na vitrine pública
--
-- A vitrine (`/loja/[slug]`, Server Component anon) precisa checar
-- `assinaturaPermiteAcesso(status, fim_periodo)` para renderizar "Loja
-- temporariamente indisponível" quando a assinatura do lojista é inválida.
-- Para isso a projeção pública `vitrine_lojas` passa a expor DOIS campos novos:
--   - assinatura_status      (text: trial/ativa/inadimplente/suspensa/cancelada)
--   - assinatura_fim_periodo (timestamptz)
--
-- AVALIAÇÃO DE SEGURANÇA (aceitável):
--   Nenhum dos dois é PII nem dado de pagamento. Revelam apenas se a loja está
--   operante — informação que a própria vitrine já comunica ao cliente via
--   "Loja temporariamente indisponível". NÃO incluem código Hotmart, plano,
--   valor, email, dono_id, consentimento nem datas de início/atualização da
--   assinatura. Continuam de fora da projeção. Risco de tenant/PII: nenhum.
--
-- A view segue `security_invoker = false` (definer) e `where ativo = true`,
-- pelos mesmos motivos da migration 001500 (sem SELECT público na base, uma
-- view invoker retornaria zero linhas; a definer expõe SÓ as colunas abaixo).
--
-- `create or replace view` não permite mudar a LISTA de colunas, então
-- fazemos drop + create.
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
    assinatura_fim_periodo
  from public.lojas
  where ativo = true;

grant select on public.vitrine_lojas to anon, authenticated;
