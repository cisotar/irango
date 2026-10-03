import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 332 — papel explícito por conta (lojista/cliente).
 *
 * Autoridade: tasks/332-gate-de-papel-no-painel.md §RED (casos 1–6) ·
 * plan/tecnico-identidade-cliente.md §2 (b, e, f, g) e §3 "Banco". L1 = (A):
 * conta só-cliente nunca recebe loja por nenhum caminho (decisão do usuário).
 *
 * Contrato sob teste (nasce em P2, `supabase/migrations/<ts>_papel_cliente.sql`):
 *  - tabela `public.papeis_usuario (usuario_id, papel)`, PK composta, CHECK
 *    lojista|cliente, FK `auth.users on delete cascade`, RLS só-leitura-própria,
 *    escrita revogada de anon/authenticated;
 *  - `public.atribuir_papel_inicial(uuid, text) returns text[]`, EXECUTE só
 *    service_role, grava o papel só se a conta não tem nenhum;
 *  - trigger `lojas_exige_dono_lojista_trg` (BEFORE INSERT OR UPDATE OF dono_id);
 *  - backfill: toda conta sem papel recebe `lojista`. Idempotente.
 *
 * Por que é RED: a migration não existe. `beforeAll` falha com mensagem de RED e
 * todos os casos caem vermelhos. Não há import TS de alvo inexistente.
 *
 * O lock por usuário não é provável no pglite (uma conexão só) — ADR §5.3.
 * O revoke de SELECT de `anon` também não (harness reconcede SELECT, tasks/298).
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function caminhoMigracao(): string {
  const achados = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith("_papel_cliente.sql"));
  if (achados.length !== 1) {
    throw new Error(
      `[RED 332] esperada exatamente 1 migration \`supabase/migrations/*_papel_cliente.sql\`; ` +
        `encontradas ${achados.length} (P2 ainda não escreveu a migration).`,
    );
  }
  return join(MIGRATIONS_DIR, achados[0]);
}

// UUIDs sintéticos (sem dado real).
const A = "a3320000-0000-4000-8000-00000000000a";
const B = "b3320000-0000-4000-8000-00000000000b";
const SEM = "c3320000-0000-4000-8000-00000000000c";
const CLI = "d3320000-0000-4000-8000-00000000000d";
const AMBOS = "e3320000-0000-4000-8000-00000000000e";
const INEXISTENTE = "f3320000-0000-4000-8000-00000000000f";

async function criarUsuarios(t: TestDb, ids: string[]): Promise<void> {
  for (const id of ids) {
    await t.db.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`, [
      id,
      `u-${id}@teste.local`,
    ]);
  }
}

async function papeis(t: TestDb, id: string): Promise<string[]> {
  const r = await t.asService((db) =>
    db.query<{ papel: string }>(
      `select papel from public.papeis_usuario where usuario_id = $1 order by papel`,
      [id],
    ),
  );
  return r.rows.map((x) => x.papel);
}

function atribuir(t: TestDb, id: string, papel: string) {
  return t.asService((db) =>
    db.query<{ p: string[] }>(`select public.atribuir_papel_inicial($1, $2) as p`, [id, papel]),
  );
}

async function contarLojas(t: TestDb, dono: string): Promise<number> {
  const r = await t.asService((db) =>
    db.query<{ n: number }>(`select count(*)::int as n from public.lojas where dono_id = $1`, [dono]),
  );
  return r.rows[0].n;
}

/** Executa e devolve o erro capturado (ou null se não lançou). */
async function erroDe(p: Promise<unknown>): Promise<{ code?: string; message: string } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { code?: string; message: string };
  }
}

async function novoDb(): Promise<TestDb> {
  caminhoMigracao(); // RED explícito: falha antes de qualquer caso se P2 não existe
  return createTestDb();
}

// ===========================================================================
// 1. Schema
// ===========================================================================
describe("332 [1] papeis_usuario — schema", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await novoDb();
    await criarUsuarios(t, [A, B]);
  });
  afterAll(async () => t?.close());

  it("[1a] papel aceita só lojista/cliente: 'admin' via service → 23514", async () => {
    const e = await erroDe(
      t.asService((db) =>
        db.query(`insert into public.papeis_usuario (usuario_id, papel) values ($1, 'admin')`, [A]),
      ),
    );
    expect(e?.code).toBe("23514");
    expect(await papeis(t, A)).toEqual([]);
  });

  it("[1b] PK (usuario_id, papel) impede duplicado → 23505", async () => {
    await t.asService((db) =>
      db.query(`insert into public.papeis_usuario (usuario_id, papel) values ($1, 'lojista')`, [A]),
    );
    const e = await erroDe(
      t.asService((db) =>
        db.query(`insert into public.papeis_usuario (usuario_id, papel) values ($1, 'lojista')`, [A]),
      ),
    );
    expect(e?.code).toBe("23505");
    expect(await papeis(t, A)).toEqual(["lojista"]);
  });

  it("[1c] excluir a conta em auth.users apaga os papéis (on delete cascade)", async () => {
    await t.asService((db) =>
      db.query(`insert into public.papeis_usuario (usuario_id, papel) values ($1, 'cliente')`, [B]),
    );
    expect(await papeis(t, B)).toEqual(["cliente"]);
    await t.db.query(`delete from auth.users where id = $1`, [B]);
    expect(await papeis(t, B)).toEqual([]);
  });
});

// ===========================================================================
// 2. RLS e grants
// ===========================================================================
describe("332 [2] papeis_usuario — RLS e grants", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await novoDb();
    await criarUsuarios(t, [A, B]);
    await atribuir(t, A, "lojista");
    await atribuir(t, B, "cliente");
  });
  afterAll(async () => t?.close());

  it("[2a] asUser(A) lê só as próprias linhas e 0 linhas de B", async () => {
    const proprias = await t.asUser(A, (db) =>
      db.query<{ papel: string }>(`select papel from public.papeis_usuario where usuario_id = $1`, [A]),
    );
    expect(proprias.rows.map((r) => r.papel)).toEqual(["lojista"]);

    const alheias = await t.asUser(A, (db) =>
      db.query(`select * from public.papeis_usuario where usuario_id = $1`, [B]),
    );
    expect(alheias.rows).toHaveLength(0);

    const todas = await t.asUser(A, (db) =>
      db.query<{ usuario_id: string }>(`select usuario_id from public.papeis_usuario`),
    );
    expect(todas.rows.every((r) => r.usuario_id === A)).toBe(true);
  });

  it("[2b] asAnon → 0 linhas", async () => {
    const r = await t.asAnon((db) => db.query(`select * from public.papeis_usuario`));
    expect(r.rows).toHaveLength(0);
  });

  it("[2c] asUser(A) INSERT da própria linha ('A','cliente') → 42501, nada gravado", async () => {
    const e = await erroDe(
      t.asUser(A, (db) =>
        db.query(`insert into public.papeis_usuario (usuario_id, papel) values ($1, 'cliente')`, [A]),
      ),
    );
    expect(e?.code).toBe("42501");
    expect(await papeis(t, A)).toEqual(["lojista"]);
  });

  it("[2d] asUser(B) só-cliente INSERT ('B','lojista') → 42501, B continua só cliente", async () => {
    const e = await erroDe(
      t.asUser(B, (db) =>
        db.query(`insert into public.papeis_usuario (usuario_id, papel) values ($1, 'lojista')`, [B]),
      ),
    );
    expect(e?.code).toBe("42501");
    expect(await papeis(t, B)).toEqual(["cliente"]);
  });

  it("[2e] asUser(B) UPDATE do próprio papel → 42501, nada muda", async () => {
    const e = await erroDe(
      t.asUser(B, (db) =>
        db.query(`update public.papeis_usuario set papel = 'lojista' where usuario_id = $1`, [B]),
      ),
    );
    expect(e?.code).toBe("42501");
    expect(await papeis(t, B)).toEqual(["cliente"]);
  });

  it("[2f] asUser(A) DELETE do próprio papel → 42501, nada apagado", async () => {
    const e = await erroDe(
      t.asUser(A, (db) => db.query(`delete from public.papeis_usuario where usuario_id = $1`, [A])),
    );
    expect(e?.code).toBe("42501");
    expect(await papeis(t, A)).toEqual(["lojista"]);
  });

  for (const op of ["INSERT", "UPDATE", "DELETE"] as const) {
    it(`[2g] has_table_privilege('authenticated', papeis_usuario, '${op}') = false`, async () => {
      const r = await t.db.query<{ ok: boolean }>(
        `select has_table_privilege('authenticated', 'public.papeis_usuario', $1) as ok`,
        [op],
      );
      expect(r.rows[0].ok).toBe(false);
    });
  }
});

// ===========================================================================
// 3. ACL da RPC
// ===========================================================================
describe("332 [3] atribuir_papel_inicial — ACL", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await novoDb();
    await criarUsuarios(t, [A]);
  });
  afterAll(async () => t?.close());

  for (const role of ["anon", "authenticated"] as const) {
    it(`[3a] has_function_privilege('${role}', atribuir_papel_inicial(uuid,text), EXECUTE) = false`, async () => {
      const r = await t.db.query<{ ok: boolean }>(
        `select has_function_privilege($1, 'public.atribuir_papel_inicial(uuid,text)', 'EXECUTE') as ok`,
        [role],
      );
      expect(r.rows[0].ok).toBe(false);
    });

    it(`[3c] has_function_privilege('${role}', lojas_exige_dono_lojista(), EXECUTE) = false`, async () => {
      const r = await t.db.query<{ ok: boolean }>(
        `select has_function_privilege($1, 'public.lojas_exige_dono_lojista()', 'EXECUTE') as ok`,
        [role],
      );
      expect(r.rows[0].ok).toBe(false);
    });
  }

  it("[3b] asUser chamando a função → 42501, nenhum papel gravado", async () => {
    const e = await erroDe(
      t.asUser(A, (db) => db.query(`select public.atribuir_papel_inicial($1, 'lojista')`, [A])),
    );
    expect(e?.code).toBe("42501");
    expect(await papeis(t, A)).toEqual([]);
  });
});

// ===========================================================================
// 4. Primeiro papel
// ===========================================================================
describe("332 [4] atribuir_papel_inicial — só o primeiro papel", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await novoDb();
    await criarUsuarios(t, [CLI, A]);
  });
  afterAll(async () => t?.close());

  it("[4a] conta sem papel + 'cliente' → {cliente}; depois 'lojista' → continua {cliente}", async () => {
    const r1 = await atribuir(t, CLI, "cliente");
    expect(r1.rows[0].p).toEqual(["cliente"]);
    const r2 = await atribuir(t, CLI, "lojista");
    expect(r2.rows[0].p).toEqual(["cliente"]);
    expect(await papeis(t, CLI)).toEqual(["cliente"]);
  });

  it("[4b] conta 'lojista' + 'cliente' → continua {lojista}", async () => {
    expect((await atribuir(t, A, "lojista")).rows[0].p).toEqual(["lojista"]);
    expect((await atribuir(t, A, "cliente")).rows[0].p).toEqual(["lojista"]);
    expect(await papeis(t, A)).toEqual(["lojista"]);
  });

  it("[4c] usuário inexistente → erro de FK (23503), nada gravado", async () => {
    const e = await erroDe(atribuir(t, INEXISTENTE, "lojista"));
    expect(e?.code).toBe("23503");
    expect(await papeis(t, INEXISTENTE)).toEqual([]);
  });
});

// ===========================================================================
// 5. Trigger em lojas (L1 = A)
// ===========================================================================
describe("332 [5] lojas_exige_dono_lojista_trg", () => {
  let t: TestDb;
  const SEM_U = "13320000-0000-4000-8000-000000000001"; // asUser sem papel
  const CLI_U = "13320000-0000-4000-8000-000000000002"; // asUser só-cliente
  const ALVO = "13320000-0000-4000-8000-000000000003"; // vítima de loja alheia
  const ATACANTE = "13320000-0000-4000-8000-000000000004";
  const TROCA = "13320000-0000-4000-8000-000000000005"; // dono original da troca

  beforeAll(async () => {
    t = await novoDb();
    await criarUsuarios(t, [SEM, CLI, AMBOS, SEM_U, CLI_U, ALVO, ATACANTE, TROCA]);
    await atribuir(t, CLI, "cliente");
    await atribuir(t, CLI_U, "cliente");
    // lojista + cliente: a migration do Marco A não tem adicionar_papel_cliente;
    // o segundo papel entra por escrita direta de superuser (setup, não caminho).
    await atribuir(t, AMBOS, "lojista");
    await t.db.query(`insert into public.papeis_usuario (usuario_id, papel) values ($1, 'cliente')`, [AMBOS]);
  });
  afterAll(async () => t?.close());

  const insereLojaSvc = (dono: string, slug: string) =>
    t.asService((db) =>
      db.query(`insert into public.lojas (dono_id, slug, nome) values ($1, $2, 'X')`, [dono, slug]),
    );

  it("[5a] asService cria loja para conta sem papel → loja criada e papel {lojista}", async () => {
    await insereLojaSvc(SEM, "p332-sem");
    expect(await contarLojas(t, SEM)).toBe(1);
    expect(await papeis(t, SEM)).toEqual(["lojista"]);
  });

  it("[5b] asService cria loja para conta só-cliente → erro 'conta de cliente', 0 lojas, papéis iguais", async () => {
    const e = await erroDe(insereLojaSvc(CLI, "p332-cli"));
    expect(e).not.toBeNull();
    expect(e?.message).toContain("conta de cliente");
    expect(await contarLojas(t, CLI)).toBe(0);
    expect(await papeis(t, CLI)).toEqual(["cliente"]);
  });

  it("[5c] asService cria loja para conta lojista+cliente → loja criada (decisão 15)", async () => {
    await insereLojaSvc(AMBOS, "p332-ambos");
    expect(await contarLojas(t, AMBOS)).toBe(1);
    expect(await papeis(t, AMBOS)).toEqual(["cliente", "lojista"]);
  });

  it("[5d] asUser só-cliente criando a própria loja → erro e nada gravado", async () => {
    const e = await erroDe(
      t.asUser(CLI_U, (db) =>
        db.query(`insert into public.lojas (dono_id, slug, nome) values ($1, 'p332-cli-u', 'X')`, [CLI_U]),
      ),
    );
    expect(e).not.toBeNull();
    expect(e?.message).toContain("conta de cliente");
    expect(await contarLojas(t, CLI_U)).toBe(0);
    expect(await papeis(t, CLI_U)).toEqual(["cliente"]);
  });

  it("[5e] asUser sem papel criando a própria loja (defaults) → loja e {lojista} (documentado)", async () => {
    await t.asUser(SEM_U, (db) =>
      db.query(`insert into public.lojas (dono_id, slug, nome) values ($1, 'p332-sem-u', 'X')`, [SEM_U]),
    );
    expect(await contarLojas(t, SEM_U)).toBe(1);
    expect(await papeis(t, SEM_U)).toEqual(["lojista"]);
  });

  it("[5f] asUser(B) criando loja com dono_id = A sem papel → recusado (trigger desde a 334, e a policy); A continua sem papel", async () => {
    const e = await erroDe(
      t.asUser(ATACANTE, (db) =>
        db.query(`insert into public.lojas (dono_id, slug, nome) values ($1, 'p332-alheia', 'X')`, [ALVO]),
      ),
    );
    expect(e?.code).toBe("42501");
    expect(await contarLojas(t, ALVO)).toBe(0);
    expect(await papeis(t, ALVO)).toEqual([]);
    // O trigger não pode ter gravado papel no atacante nem na vítima.
    expect(await papeis(t, ATACANTE)).toEqual([]);
  });

  it("[5g] asService trocando dono_id para conta só-cliente → erro, dono original mantido", async () => {
    await insereLojaSvc(TROCA, "p332-troca");
    const e = await erroDe(
      t.asService((db) =>
        db.query(`update public.lojas set dono_id = $1 where dono_id = $2`, [CLI, TROCA]),
      ),
    );
    expect(e).not.toBeNull();
    expect(e?.message).toContain("conta de cliente");
    expect(await contarLojas(t, TROCA)).toBe(1);
    expect(await contarLojas(t, CLI)).toBe(0);
    expect(await papeis(t, CLI)).toEqual(["cliente"]);
  });
});

// ===========================================================================
// 6. Backfill (decisão 14) — reexecução idempotente da migration
// ===========================================================================
describe("332 [6] backfill — reexecutando a migration", () => {
  let t: TestDb;
  const U1 = "23320000-0000-4000-8000-000000000001"; // tem loja, papel apagado
  const U2 = "23320000-0000-4000-8000-000000000002"; // sem loja, sem papel
  const U3 = "23320000-0000-4000-8000-000000000003"; // cliente

  beforeAll(async () => {
    t = await novoDb();
    await criarUsuarios(t, [U1, U2, U3]);
    await t.asService((db) =>
      db.query(`insert into public.lojas (dono_id, slug, nome) values ($1, 'p332-u1', 'X')`, [U1]),
    );
    // Simula estado anterior à migration: superuser apaga o papel que o trigger deu.
    await t.db.query(`delete from public.papeis_usuario where usuario_id = $1`, [U1]);
    await atribuir(t, U3, "cliente");
  });
  afterAll(async () => t?.close());

  async function semPapel(): Promise<number> {
    const r = await t.db.query<{ n: number }>(
      `select count(*)::int as n from auth.users u
        where not exists (select 1 from public.papeis_usuario p where p.usuario_id = u.id)`,
    );
    return r.rows[0].n;
  }

  it("[6a] pré-condição do cenário: U1 e U2 sem papel, U3 {cliente}", async () => {
    expect(await papeis(t, U1)).toEqual([]);
    expect(await papeis(t, U2)).toEqual([]);
    expect(await papeis(t, U3)).toEqual(["cliente"]);
  });

  it("[6b] 1ª reexecução: U1={lojista}, U2={lojista}, U3={cliente}, ninguém sem papel", async () => {
    await t.db.exec(readFileSync(caminhoMigracao(), "utf8"));
    expect(await papeis(t, U1)).toEqual(["lojista"]);
    expect(await papeis(t, U2)).toEqual(["lojista"]);
    expect(await papeis(t, U3)).toEqual(["cliente"]);
    expect(await semPapel()).toBe(0);
  });

  it("[6c] 2ª reexecução: mesmo resultado, sem erro (idempotente)", async () => {
    await t.db.exec(readFileSync(caminhoMigracao(), "utf8"));
    expect(await papeis(t, U1)).toEqual(["lojista"]);
    expect(await papeis(t, U2)).toEqual(["lojista"]);
    expect(await papeis(t, U3)).toEqual(["cliente"]);
    expect(await semPapel()).toBe(0);
  });
});
