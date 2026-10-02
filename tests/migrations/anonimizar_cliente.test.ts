import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 335 — fatia B2 do plano (exclusão de conta, camada banco).
 *
 * Autoridade: tasks/335-cliente-schema-rls-anonimizacao.md §RED (anonimizar_cliente.test.ts) ·
 * specs/cliente-identidade.md §Funções novas.
 *
 * Contrato sob teste (`supabase/migrations/<ts>_clientes.sql`):
 *  - `adicionar_papel_cliente(uuid)`, `criar_perfil_cliente(uuid,text,text,date,boolean,text,jsonb)`,
 *    `anonimizar_cliente(uuid)`, `anonimizar_clientes_inativos()`: EXECUTE só service_role;
 *  - `anonimizar_cliente` apaga `clientes` (cascade endereços), não toca papeis_usuario/lojas/auth.users;
 *  - `anonimizar_clientes_inativos` remove só perfis com ultimo_acesso_em < now() - 24 months.
 *
 * Por que é RED: a migration não existe; `novoDb()` falha com `[RED 335]`.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function exigirMigracao(): void {
  const achados = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith("_clientes.sql"));
  if (achados.length !== 1) {
    throw new Error(
      `[RED 335] esperada exatamente 1 migration \`supabase/migrations/*_clientes.sql\`; ` +
        `encontradas ${achados.length} (P12 ainda não escreveu a migration).`,
    );
  }
}

async function novoDb(): Promise<TestDb> {
  exigirMigracao();
  return createTestDb();
}

const A = "a3351000-0000-4000-8000-00000000000a"; // lojista + cliente
const B = "b3351000-0000-4000-8000-00000000000b"; // só-cliente
const VELHO = "c3351000-0000-4000-8000-00000000000c"; // inativo há 25 meses
const LIMITE = "d3351000-0000-4000-8000-00000000000d"; // inativo há 23 meses

const ENDERECO = {
  rotulo: "Casa",
  cep: "01000-000",
  rua: "Rua Ficticia",
  numero: "10",
  bairro: "Centro",
  cidade: "Cidade Teste",
  uf: "SP",
  complemento: null,
};

const FUNCOES = [
  "public.adicionar_papel_cliente(uuid)",
  "public.criar_perfil_cliente(uuid,text,text,date,boolean,text,jsonb)",
  "public.anonimizar_cliente(uuid)",
  "public.anonimizar_clientes_inativos()",
] as const;

async function criarUsuarios(t: TestDb, ids: string[]): Promise<void> {
  for (const id of ids) {
    await t.db.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`, [
      id,
      `u-${id}@teste.local`,
    ]);
  }
}

function criarPerfil(t: TestDb, id: string) {
  return t.asService((db) =>
    db.query(
      `select public.criar_perfil_cliente($1::uuid, 'Cliente Teste', '(11) 90000-0000', '1990-05-10'::date, false, 'v-teste', $2::jsonb)`,
      [id, JSON.stringify(ENDERECO)],
    ),
  );
}

async function n(t: TestDb, sql: string, params: unknown[]): Promise<number> {
  const r = await t.db.query<{ n: number }>(sql, params);
  return r.rows[0].n;
}

const perfis = (t: TestDb, id: string) =>
  n(t, `select count(*)::int as n from public.clientes where id = $1`, [id]);
const enderecos = (t: TestDb, id: string) =>
  n(t, `select count(*)::int as n from public.clientes_enderecos where cliente_id = $1`, [id]);

async function papeis(t: TestDb, id: string): Promise<string[]> {
  const r = await t.db.query<{ papel: string }>(
    `select papel from public.papeis_usuario where usuario_id = $1 order by papel`,
    [id],
  );
  return r.rows.map((x) => x.papel);
}

async function erroDe(p: Promise<unknown>): Promise<{ code?: string; message: string } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { code?: string; message: string };
  }
}

// ===========================================================================
// 1. ACL das quatro funções
// ===========================================================================
describe("335 [B2-1] funções de perfil/anonimização — só service_role", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await novoDb();
    await criarUsuarios(t, [B]);
    await criarPerfil(t, B);
  });
  afterAll(async () => t?.close());

  for (const fn of FUNCOES) {
    for (const role of ["anon", "authenticated", "public"] as const) {
      it(`[1a] has_function_privilege('${role}', ${fn}, EXECUTE) = false`, async () => {
        const sql =
          role === "public"
            ? `select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = $1::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') = false as ok`
            : `select has_function_privilege('${role}', $1, 'EXECUTE') = false as ok`;
        const r = await t.db.query<{ ok: boolean }>(sql, [fn]);
        expect(r.rows[0].ok).toBe(true);
      });
    }
    it(`[1b] has_function_privilege('service_role', ${fn}, EXECUTE) = true`, async () => {
      const r = await t.db.query<{ ok: boolean }>(`select has_function_privilege('service_role', $1, 'EXECUTE') as ok`, [fn]);
      expect(r.rows[0].ok).toBe(true);
    });
  }

  it("[1c] asUser(B) chamando anonimizar_cliente(B) → 42501, perfil intacto", async () => {
    const e = await erroDe(t.asUser(B, (db) => db.query(`select public.anonimizar_cliente($1)`, [B])));
    expect(e?.code).toBe("42501");
    expect(await perfis(t, B)).toBe(1);
  });

  it("[1d] asAnon chamando anonimizar_cliente(B) → 42501, perfil intacto", async () => {
    const e = await erroDe(t.asAnon((db) => db.query(`select public.anonimizar_cliente($1)`, [B])));
    expect(e?.code).toBe("42501");
    expect(await perfis(t, B)).toBe(1);
  });

  it("[1e] asUser(B) anonimizar_clientes_inativos() / adicionar_papel_cliente / criar_perfil_cliente → 42501", async () => {
    for (const sql of [
      `select public.anonimizar_clientes_inativos()`,
      `select public.adicionar_papel_cliente('${B}'::uuid)`,
      `select public.criar_perfil_cliente('${B}'::uuid, 'X', '(11) 90000-0000', '1990-01-01'::date, false, 'v', '{}'::jsonb)`,
    ]) {
      const e = await erroDe(t.asUser(B, (db) => db.query(sql)));
      expect(e?.code, sql).toBe("42501");
    }
  });
});

// ===========================================================================
// 2. anonimizar_cliente — efeito
// ===========================================================================
describe("335 [B2-2] anonimizar_cliente — apaga só o perfil", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await novoDb();
    await criarUsuarios(t, [A, B]);
    await t.asService((db) =>
      db.query(`insert into public.lojas (dono_id, slug, nome) values ($1, 'p335-anon-a', 'X')`, [A]),
    );
    await criarPerfil(t, A);
    await criarPerfil(t, B);
  });
  afterAll(async () => t?.close());

  it("[2a] pré-condição: A {cliente, lojista} com loja; B {cliente}", async () => {
    expect(await papeis(t, A)).toEqual(["cliente", "lojista"]);
    expect(await papeis(t, B)).toEqual(["cliente"]);
  });

  it("[2b] anonimizar_cliente(A) → 0 perfil/endereços; papéis, loja e auth.users intactos; B intacto", async () => {
    await t.asService((db) => db.query(`select public.anonimizar_cliente($1)`, [A]));
    expect(await perfis(t, A)).toBe(0);
    expect(await enderecos(t, A)).toBe(0);
    expect(await papeis(t, A)).toEqual(["cliente", "lojista"]);
    expect(await n(t, `select count(*)::int as n from public.lojas where dono_id = $1`, [A])).toBe(1);
    expect(await n(t, `select count(*)::int as n from auth.users where id = $1`, [A])).toBe(1);
    expect(await perfis(t, B)).toBe(1);
    expect(await enderecos(t, B)).toBe(1);
  });

  it("[2c] anonimizar_cliente(B) só-cliente → perfil some, papel {cliente} e auth.users ficam", async () => {
    await t.asService((db) => db.query(`select public.anonimizar_cliente($1)`, [B]));
    expect(await perfis(t, B)).toBe(0);
    expect(await enderecos(t, B)).toBe(0);
    expect(await papeis(t, B)).toEqual(["cliente"]);
    expect(await n(t, `select count(*)::int as n from auth.users where id = $1`, [B])).toBe(1);
  });
});

// ===========================================================================
// 3. anonimizar_clientes_inativos — 24 meses
// ===========================================================================
describe("335 [B2-3] anonimizar_clientes_inativos — corte de 24 meses", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await novoDb();
    await criarUsuarios(t, [VELHO, LIMITE, B]);
    await criarPerfil(t, VELHO);
    await criarPerfil(t, LIMITE);
    await criarPerfil(t, B);
    // Setup como superuser (fora do grant de coluna): tempos relativos ao now() do banco.
    await t.db.query(`update public.clientes set ultimo_acesso_em = now() - interval '25 months' where id = $1`, [VELHO]);
    await t.db.query(`update public.clientes set ultimo_acesso_em = now() - interval '23 months' where id = $1`, [LIMITE]);
  });
  afterAll(async () => t?.close());

  it("[3a] remove só o perfil inativo há >24 meses; os demais ficam", async () => {
    await t.asService((db) => db.query(`select public.anonimizar_clientes_inativos()`));
    expect(await perfis(t, VELHO)).toBe(0);
    expect(await enderecos(t, VELHO)).toBe(0);
    expect(await perfis(t, LIMITE)).toBe(1);
    expect(await perfis(t, B)).toBe(1);
    expect(await papeis(t, VELHO)).toEqual(["cliente"]);
    expect(await n(t, `select count(*)::int as n from auth.users where id = $1`, [VELHO])).toBe(1);
  });
});
