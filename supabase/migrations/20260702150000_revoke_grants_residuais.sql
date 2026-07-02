-- [SEC] Hardening: revogar grants residuais de anon/authenticated
-- A 20260614008500 fez GRANT ALL, a 20260702140000 revogou i/u/d,
-- mas TRUNCATE/TRIGGER/REFERENCES sobraram. Esta fix:
-- (1) revoga tudo de vitrine_lojas, reafirma SELECT
-- (2) altera default privileges pra SELECT-only
-- (3) revoga execute de rls_auto_enable (DO-block guardado)

revoke all on public.vitrine_lojas from anon, authenticated;
grant select on public.vitrine_lojas to anon, authenticated;

alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges in schema public
  grant select on tables to anon, authenticated;

do $$
declare
  proc oid := to_regprocedure('public.rls_auto_enable()');
begin
  if proc is not null then
    execute format('revoke all on function public.rls_auto_enable() from anon, authenticated, public');
  end if;
end
$$;
