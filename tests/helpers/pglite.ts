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
as $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $$;

create or replace function auth.role() returns text
  language sql stable
as $$ select coalesce(current_setting('request.jwt.claims', true)::json->>'role', 'anon') $$;

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
`;

/**
 * Concede a anon/authenticated os privilégios de tabela que o Supabase dá por
 * padrão. RLS continua filtrando LINHAS; o grant só libera a OPERAÇÃO. Rodar
 * DEPOIS das migrations para cobrir as tabelas criadas por elas.
 */
const GRANTS_SQL = `
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to anon;
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
  const db = new PGlite();
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
