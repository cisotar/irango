-- Grants padrão Supabase para os roles da API (anon, authenticated, service_role).
--
-- PROBLEMA: as migrations de schema criaram tabelas + habilitaram RLS + criaram
-- policies, mas NUNCA emitiram os GRANTs de tabela. No Postgres, GRANT e RLS são
-- camadas independentes: sem GRANT, o role nem chega na policy — recebe
-- `42501 permission denied for table ...`. Em pglite (testes) não há esses roles,
-- então o problema só aparece no cloud (cadastro via service_role, vitrine via anon).
--
-- MODELO SUPABASE: os três roles recebem GRANT amplo; a CONTENÇÃO real é a RLS
-- (já habilitada em todas as tabelas pelas migrations anteriores). service_role
-- adicionalmente faz BYPASSRLS — por isso precisa do GRANT para o INSERT do
-- cadastro/criar_pedido funcionar.
--
-- Idempotente: GRANT/ALTER DEFAULT PRIVILEGES podem ser reaplicados sem erro.

-- Acesso ao schema.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Tabelas e sequences existentes.
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

-- Default privileges: tabelas/sequences/rotinas FUTURAS criadas pelo postgres
-- já nascem com os grants (evita repetir esse problema na próxima migration).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
