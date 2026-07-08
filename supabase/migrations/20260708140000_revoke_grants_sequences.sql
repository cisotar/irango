-- [SEC] Hardening: revogar default privileges residuais de SEQUENCES p/ anon/authenticated
-- A 20260614008500 fez `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON SEQUENCES`.
-- A 20260702150000 revogou os defaults de TABLES (revoke all + grant select),
-- mas NUNCA os de SEQUENCES. Uma sequence FUTURA criada por postgres nasce com
-- UPDATE (setval/nextval → colisão de PK / DoS de id) concedido a anon.
-- Latente hoje (schema 100% UUID, zero sequences), vira brecha real no dia de
-- um serial/identity. Este fix espelha para SEQUENCES o mesmo padrão que a
-- 20260702150000 aplicou a TABLES: revoke amplo + grant mínimo.
-- service_role NÃO é tocado (segue com o grant do webhook / BYPASSRLS).

alter default privileges in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;
