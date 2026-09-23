import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/**
 * Bootstrap que emula o ambiente Supabase dentro do pglite:
 * - schema `auth` + `auth.users` (subset usado pelas migrations)
 * - `auth.uid()` / `auth.role()` lendo `request.jwt.claims` (igual ao Supabase)
 * - roles `anon`, `authenticated`, `service_role` (esta com BYPASSRLS)
 *
 * O usuário padrão do pglite é superuser (`postgres`), que IGNORA RLS — por isso
 * os testes precisam `SET LOCAL ROLE` para um papel não-privilegiado para que as
 * políticas sejam aplicadas. Ver asAnon/asUser/asService.
 */
const BOOTSTRAP_SQL = `
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
  language sql stable
as $$ select coalesce(
       nullif(current_setting('request.jwt.claim.sub', true), ''),
       (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
     )::uuid $$;

-- Definição FIEL à do Supabase cloud (conferida por supabase db dump --schema
-- auth, issue 215): devolve NULL quando não há JWT. O coalesce(..., 'anon') que
-- estava aqui antes era mais permissivo que a produção e escondia um fail-open
-- na trava T2 das RPCs security definer — harness que mente a favor do código é
-- pior que harness ausente.
create or replace function auth.role() returns text
  language sql stable
as $$ select coalesce(
       nullif(current_setting('request.jwt.claim.role', true), ''),
       (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
     )::text $$;

create or replace function auth.email() returns text
  language sql stable
as $$ select nullif(current_setting('request.jwt.claims', true)::json->>'email', '') $$;

do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant create on schema public to service_role;
-- O Supabase real concede a service_role leitura de auth.users; emulamos isso
-- para que mapeamentos email→loja (e seus anti-falso-verde) funcionem no harness.
grant select on auth.users to service_role;
`;

/**
 * Concede a anon/authenticated a LEITURA que o Supabase dá por padrão, mais os
 * privilégios de service_role e das sequences. RLS continua filtrando LINHAS; o
 * grant só libera a OPERAÇÃO. Rodar DEPOIS das migrations para cobrir as tabelas
 * criadas por elas.
 *
 * ESCRITA (insert/update/delete) NÃO é reconcedida aqui — nem em views, nem em
 * TABELAS BASE (294). Motivo, o mesmo nos dois casos: este bloco roda DEPOIS de
 * todas as migrations, então qualquer `revoke insert, update, delete` feito por
 * migration (ex.: vitrine_lojas SELECT-only; `revoke insert on public.pedidos`)
 * seria desfeito aqui e o teste ficaria falso-verde para sempre.
 *
 * O ACL de escrita do cloud é reproduzido pelas PRÓPRIAS migrations, que rodam
 * dentro do pglite: os roles `anon`/`authenticated`/`service_role` já existem
 * antes delas (BOOTSTRAP_SQL, ver `do $$ ... pg_roles ...`), então
 * `20260614008500_grants_roles_supabase.sql` (`GRANT ALL ON ALL TABLES` +
 * `ALTER DEFAULT PRIVILEGES GRANT ALL`) e `20260702150000` (revoke dos default
 * privileges de TABLES) produzem aqui o mesmo ACL final que em produção. Só um
 * revoke em migration POSTERIOR ao grant deixa o teste verde — como em prod.
 * Consequência desejada: "grant esquecido em tabela nova" vira teste vermelho
 * aqui, em vez de `42501` só no cloud.
 */
const GRANTS_SQL = `
grant select on all tables in schema public to anon, authenticated;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
`;

export type TestDb = {
  db: PGlite;
  /** Roda um callback como anon (sem login). */
  asAnon: <T>(fn: (db: PGlite) => Promise<T>) => Promise<T>;
  /** Roda um callback como usuário logado (RLS via auth.uid()). */
  asUser: <T>(userId: string, fn: (db: PGlite) => Promise<T>, email?: string) => Promise<T>;
  /** Roda um callback como service_role (bypass RLS — uso server-only). */
  asService: <T>(fn: (db: PGlite) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Cria um banco pglite efêmero, aplica o bootstrap Supabase e todas as migrations
 * em ordem. Cada teste deve criar o seu (isolamento total entre testes).
 */
export async function createTestDb(): Promise<TestDb> {
  // Fidelidade ao Supabase/PostgREST: timestamps voltam como STRING ISO (JSON),
  // não como `Date`. Sem isso, duas leituras do mesmo timestamptz produzem
  // objetos `Date` distintos (`toBe`/`Object.is` falha mesmo com valor igual) —
  // divergindo do client real. OIDs: timestamptz=1184, timestamp=1114, date=1082.
  const passthrough = (v: string) => v;
  // (229) MESMA fidelidade para `numeric` (OID 1700): o PostgREST serializa
  // numeric como NÚMERO JSON, e é como `number` que ele chega em
  // `Tables<"produtos">["preco"]`. O default do pglite é string, e string em
  // aritmética monetária passa por coerção silenciosa (`"25.00" * 2`) até
  // encontrar uma guarda que exige número de verdade (`precoEfetivo`) — aí o
  // harness reprova código correto. Harness que mente sobre o tipo do dinheiro
  // é pior que harness ausente.
  const db = new PGlite({
    parsers: { 1184: passthrough, 1114: passthrough, 1082: passthrough, 1700: Number },
  });
  await db.exec(BOOTSTRAP_SQL);

  for (const file of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (err) {
      throw new Error(`Falha aplicando migration ${file}: ${(err as Error).message}`);
    }
  }

  await db.exec(GRANTS_SQL);

  async function withRole<T>(
    role: "anon" | "authenticated" | "service_role",
    claims: Record<string, unknown> | null,
    fn: (db: PGlite) => Promise<T>,
  ): Promise<T> {
    await db.exec("begin");
    try {
      await db.query(`set local role ${role}`);
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [
        claims ? JSON.stringify(claims) : "",
      ]);
      const result = await fn(db);
      await db.exec("commit");
      return result;
    } catch (err) {
      await db.exec("rollback");
      throw err;
    }
  }

  return {
    db,
    asAnon: (fn) => withRole("anon", { role: "anon" }, fn),
    asUser: (userId, fn, email) =>
      withRole("authenticated", { sub: userId, role: "authenticated", email }, fn),
    asService: (fn) => withRole("service_role", { role: "service_role" }, fn),
    close: () => db.close(),
  };
}
