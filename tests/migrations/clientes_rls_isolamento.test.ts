import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 335 — fatia B1 do plano (plan/loop-cadastro-de-clientes.md).
 *
 * Autoridade: tasks/335-cliente-schema-rls-anonimizacao.md §RED · specs/cliente-identidade.md
 * §Modelos de Dados (`clientes`, `clientes_enderecos`, funções novas).
 *
 * Contrato sob teste (nasce em P12, `supabase/migrations/<ts>_clientes.sql`):
 *  - `public.clientes` — SELECT/UPDATE próprio; grant update só em (nome, telefone,
 *    data_nascimento, aceita_marketing); INSERT/DELETE sem grant para authenticated;
 *  - trigger de idade: ≥18 em current_date, não futura, ≤120 anos, mensagem
 *    "Você precisa ter 18 anos ou mais…";
 *  - `public.clientes_enderecos` — CRUD próprio (USING e WITH CHECK), teto 3, índice
 *    único parcial (cliente_id) where padrao, último endereço não sai por usuário final;
 *  - `public.criar_perfil_cliente(uuid, text, text, date, boolean, text, jsonb)` (service_role).
 *
 * Por que é RED: a migration não existe; `novoDb()` falha com `[RED 335]` antes de cada bloco.
 *
 * Borda dos 18 anos: o trigger lê `current_date` do banco (spec). As datas da borda
 * são calculadas NO SQL a partir do mesmo `current_date`, sem `Date` do JS — o caso
 * não depende do relógio do processo nem do dia em que roda.
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

// UUIDs sintéticos (sem dado real).
const A = "a3350000-0000-4000-8000-00000000000a"; // cliente A (3 endereços)
const B = "b3350000-0000-4000-8000-00000000000b"; // cliente B (1 endereço)
const LOJ = "c3350000-0000-4000-8000-00000000000c"; // lojista sem perfil de cliente
const SOLOJ = "d3350000-0000-4000-8000-00000000000d"; // lojista que ativa perfil
const SOCLI = "e3350000-0000-4000-8000-00000000000e"; // conta só-cliente sem perfil ainda
const NOVO = "f3350000-0000-4000-8000-00000000000f"; // conta sem papel (atomicidade)

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

async function criarUsuarios(t: TestDb, ids: string[]): Promise<void> {
  for (const id of ids) {
    await t.db.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`, [
      id,
      `u-${id}@teste.local`,
    ]);
  }
}

function criarPerfil(
  t: TestDb,
  id: string,
  opts: { endereco?: unknown; versao?: string | null } = {},
) {
  const endereco = "endereco" in opts ? opts.endereco : ENDERECO;
  const versao = "versao" in opts ? opts.versao : "v-teste";
  return t.asService((db) =>
    db.query(
      `select public.criar_perfil_cliente($1::uuid, $2::text, $3::text, $4::date, $5::boolean, $6::text, $7::jsonb)`,
      [id, "Cliente Teste", "(11) 90000-0000", "1990-05-10", false, versao, endereco === null ? null : JSON.stringify(endereco)],
    ),
  );
}

function inserirEndereco(t: TestDb, autor: string, clienteId: string, rotulo: string, padrao = false) {
  return t.asUser(autor, (db) =>
    db.query(
      `insert into public.clientes_enderecos (cliente_id, rotulo, cep, rua, numero, bairro, cidade, uf, padrao)
       values ($1, $2, '01000-000', 'Rua Ficticia', '20', 'Centro', 'Cidade Teste', 'SP', $3)`,
      [clienteId, rotulo, padrao],
    ),
  );
}

async function papeis(t: TestDb, id: string): Promise<string[]> {
  const r = await t.db.query<{ papel: string }>(
    `select papel from public.papeis_usuario where usuario_id = $1 order by papel`,
    [id],
  );
  return r.rows.map((x) => x.papel);
}

async function contar(t: TestDb, tabela: "clientes" | "clientes_enderecos", id: string): Promise<number> {
  const col = tabela === "clientes" ? "id" : "cliente_id";
  const r = await t.db.query<{ n: number }>(`select count(*)::int as n from public.${tabela} where ${col} = $1`, [id]);
  return r.rows[0].n;
}

async function erroDe(p: Promise<unknown>): Promise<{ code?: string; message: string } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { code?: string; message: string };
  }
}

/** Banco com A (perfil + 3 endereços), B (perfil + 1 endereço) e um lojista sem perfil. */
async function cenarioBase(): Promise<TestDb> {
  const t = await novoDb();
  await criarUsuarios(t, [A, B, LOJ]);
  await criarPerfil(t, A);
  await criarPerfil(t, B);
  await inserirEndereco(t, A, A, "Trabalho");
  await inserirEndereco(t, A, A, "Mae");
  await t.asService((db) =>
    db.query(`insert into public.lojas (dono_id, slug, nome) values ($1, 'p335-loj', 'X')`, [LOJ]),
  );
  return t;
}

// ===========================================================================
// 1. Leitura isolada
// ===========================================================================
describe("335 [1] clientes — SELECT isolado", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await cenarioBase();
  });
  afterAll(async () => t?.close());

  it("[1a] asUser(A) SELECT clientes → só a própria linha", async () => {
    const r = await t.asUser(A, (db) => db.query<{ id: string }>(`select id from public.clientes`));
    expect(r.rows.map((x) => x.id)).toEqual([A]);
  });

  it("[1b] asUser(B) SELECT de A → 0 linhas (clientes e endereços)", async () => {
    const c = await t.asUser(B, (db) => db.query(`select * from public.clientes where id = $1`, [A]));
    expect(c.rows).toHaveLength(0);
    const e = await t.asUser(B, (db) =>
      db.query(`select * from public.clientes_enderecos where cliente_id = $1`, [A]),
    );
    expect(e.rows).toHaveLength(0);
  });

  it("[1c] asAnon → 0 linhas em clientes e clientes_enderecos (ou permission denied)", async () => {
    for (const tabela of ["clientes", "clientes_enderecos"]) {
      const r = await erroDe(
        t.asAnon(async (db) => {
          const q = await db.query(`select * from public.${tabela}`);
          if (q.rows.length > 0) throw new Error(`anon leu ${q.rows.length} linhas de ${tabela}`);
        }),
      );
      // Aceito: 0 linhas (null) ou 42501. Nunca linhas.
      if (r) expect(r.code).toBe("42501");
    }
  });

  it("[1d] lojista autenticado → 0 linhas em clientes e clientes_enderecos", async () => {
    const c = await t.asUser(LOJ, (db) => db.query(`select * from public.clientes`));
    expect(c.rows).toHaveLength(0);
    const e = await t.asUser(LOJ, (db) => db.query(`select * from public.clientes_enderecos`));
    expect(e.rows).toHaveLength(0);
  });
});

// ===========================================================================
// 2. Escrita cross-cliente e colunas protegidas
// ===========================================================================
describe("335 [2] escrita cross-cliente e grants por coluna", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await cenarioBase();
  });
  afterAll(async () => t?.close());

  it("[2a] asUser(B) UPDATE clientes de A → 0 rows, nome intacto", async () => {
    const r = await t.asUser(B, (db) => db.query(`update public.clientes set nome = 'Invasor' where id = $1`, [A]));
    expect(r.affectedRows ?? 0).toBe(0);
    const n = await t.db.query<{ nome: string }>(`select nome from public.clientes where id = $1`, [A]);
    expect(n.rows[0].nome).toBe("Cliente Teste");
  });

  it("[2b] asUser(B) UPDATE/DELETE clientes_enderecos de A → 0 rows, 3 endereços intactos", async () => {
    const u = await t.asUser(B, (db) =>
      db.query(`update public.clientes_enderecos set rua = 'Invasor' where cliente_id = $1`, [A]),
    );
    expect(u.affectedRows ?? 0).toBe(0);
    const d = await t.asUser(B, (db) => db.query(`delete from public.clientes_enderecos where cliente_id = $1`, [A]));
    expect(d.affectedRows ?? 0).toBe(0);
    expect(await contar(t, "clientes_enderecos", A)).toBe(3);
    const rua = await t.db.query(`select 1 from public.clientes_enderecos where cliente_id = $1 and rua = 'Invasor'`, [A]);
    expect(rua.rows).toHaveLength(0);
  });

  it("[2c] asUser(B) DELETE clientes de A → 0 rows ou 42501; A continua existindo", async () => {
    const e = await erroDe(t.asUser(B, (db) => db.query(`delete from public.clientes where id = $1`, [A])));
    if (e) expect(e.code).toBe("42501");
    expect(await contar(t, "clientes", A)).toBe(1);
  });

  it("[2d] asUser(A) DELETE do próprio perfil → 42501 (só via anonimizar_cliente)", async () => {
    const e = await erroDe(t.asUser(A, (db) => db.query(`delete from public.clientes where id = $1`, [A])));
    expect(e?.code).toBe("42501");
    expect(await contar(t, "clientes", A)).toBe(1);
  });

  for (const [col, valor] of [
    ["id", `'${B}'::uuid`],
    ["criado_em", "now() - interval '1 day'"],
    ["ultimo_acesso_em", "now() + interval '10 years'"],
    ["consentimento_em", "now() - interval '1 day'"],
    ["consentimento_versao", "'forjada'"],
  ] as const) {
    it(`[2e] asUser(A) UPDATE de ${col} → 42501`, async () => {
      const e = await erroDe(
        t.asUser(A, (db) => db.query(`update public.clientes set ${col} = ${valor} where id = $1`, [A])),
      );
      expect(e?.code).toBe("42501");
    });
  }

  it("[2f] asUser(A) UPDATE de colunas permitidas (nome, telefone, aceita_marketing) → aceito", async () => {
    const r = await t.asUser(A, (db) =>
      db.query(
        `update public.clientes set nome = 'Novo Nome', telefone = '(11) 91111-1111', aceita_marketing = true where id = $1`,
        [A],
      ),
    );
    expect(r.affectedRows).toBe(1);
  });

  it("[2g] asUser INSERT direto em clientes → 42501 (só RPC)", async () => {
    await criarUsuarios(t, [SOCLI]);
    const e = await erroDe(
      t.asUser(SOCLI, (db) =>
        db.query(
          `insert into public.clientes (id, nome, telefone, data_nascimento, consentimento_em, consentimento_versao)
           values ($1, 'X', '(11) 90000-0000', '1990-01-01', now(), 'v')`,
          [SOCLI],
        ),
      ),
    );
    expect(e?.code).toBe("42501");
    expect(await contar(t, "clientes", SOCLI)).toBe(0);
  });

  for (const op of ["INSERT", "DELETE"] as const) {
    it(`[2h] has_table_privilege('authenticated', clientes, '${op}') = false`, async () => {
      const r = await t.db.query<{ ok: boolean }>(
        `select has_table_privilege('authenticated', 'public.clientes', $1) as ok`,
        [op],
      );
      expect(r.rows[0].ok).toBe(false);
    });
  }

  it("[2i] asUser(B) INSERT em clientes_enderecos com cliente_id = A → 42501, A segue com 3", async () => {
    const e = await erroDe(inserirEndereco(t, B, A, "Intruso"));
    expect(e?.code).toBe("42501");
    expect(await contar(t, "clientes_enderecos", A)).toBe(3);
  });

  it("[2j] asUser(B) UPDATE do próprio endereço movendo cliente_id para A → 42501", async () => {
    const e = await erroDe(
      t.asUser(B, (db) => db.query(`update public.clientes_enderecos set cliente_id = $1 where cliente_id = $2`, [A, B])),
    );
    expect(e?.code).toBe("42501");
    expect(await contar(t, "clientes_enderecos", B)).toBe(1);
  });
});

// ===========================================================================
// 3. Teto de 3, padrão único, último endereço
// ===========================================================================
describe("335 [3] clientes_enderecos — teto, padrão e último", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await cenarioBase();
  });
  afterAll(async () => t?.close());

  it("[3a] o primeiro endereço (via criar_perfil_cliente) nasce padrao = true", async () => {
    const r = await t.db.query<{ padrao: boolean }>(
      `select padrao from public.clientes_enderecos where cliente_id = $1`,
      [B],
    );
    expect(r.rows.map((x) => x.padrao)).toEqual([true]);
  });

  it("[3b] 4º INSERT do mesmo cliente → erro, continua com 3", async () => {
    expect(await contar(t, "clientes_enderecos", A)).toBe(3);
    const e = await erroDe(inserirEndereco(t, A, A, "Quarto"));
    expect(e).not.toBeNull();
    expect(await contar(t, "clientes_enderecos", A)).toBe(3);
  });

  it("[3c] 4º INSERT também é recusado para service_role (teto é do banco, não da RLS)", async () => {
    const e = await erroDe(
      t.asService((db) =>
        db.query(
          `insert into public.clientes_enderecos (cliente_id, rotulo, cep, rua, numero, bairro, cidade, uf)
           values ($1, 'Quarto', '01000-000', 'Rua', '1', 'Centro', 'Cidade', 'SP')`,
          [A],
        ),
      ),
    );
    expect(e).not.toBeNull();
    expect(await contar(t, "clientes_enderecos", A)).toBe(3);
  });

  it("[3d] 2º endereço com padrao = true → 23505, um só padrão", async () => {
    const e = await erroDe(inserirEndereco(t, B, B, "Outro", true));
    expect(e?.code).toBe("23505");
    const r = await t.db.query<{ n: number }>(
      `select count(*)::int as n from public.clientes_enderecos where cliente_id = $1 and padrao`,
      [B],
    );
    expect(r.rows[0].n).toBe(1);
  });

  it("[3e] asUser(B) DELETE do último endereço → erro, B continua com 1", async () => {
    expect(await contar(t, "clientes_enderecos", B)).toBe(1);
    const e = await erroDe(t.asUser(B, (db) => db.query(`delete from public.clientes_enderecos where cliente_id = $1`, [B])));
    expect(e).not.toBeNull();
    expect(await contar(t, "clientes_enderecos", B)).toBe(1);
  });

  it("[3f] asUser(A) DELETE de um entre 3 endereços não padrão → aceito (2 restantes)", async () => {
    const r = await t.asUser(A, (db) =>
      db.query(`delete from public.clientes_enderecos where cliente_id = $1 and rotulo = 'Mae'`, [A]),
    );
    expect(r.affectedRows).toBe(1);
    expect(await contar(t, "clientes_enderecos", A)).toBe(2);
  });

  it("[3g] cascade de anonimizar_cliente remove o último endereço → passa", async () => {
    await t.asService((db) => db.query(`select public.anonimizar_cliente($1)`, [B]));
    expect(await contar(t, "clientes", B)).toBe(0);
    expect(await contar(t, "clientes_enderecos", B)).toBe(0);
  });

  it("[3h] rótulo com quebra de linha → 23514", async () => {
    const e = await erroDe(inserirEndereco(t, A, A, "Linha\nDupla"));
    expect(e?.code).toBe("23514");
  });
});

// ===========================================================================
// 4. Idade (decisão 17) — datas relativas ao current_date do próprio banco
// ===========================================================================
describe("335 [4] clientes — trigger de idade", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await cenarioBase();
  });
  afterAll(async () => t?.close());

  const atualizarNasc = (exprSql: string) =>
    t.asUser(A, (db) => db.query(`update public.clientes set data_nascimento = ${exprSql} where id = $1`, [A]));

  async function nasc(): Promise<string> {
    const r = await t.db.query<{ d: string }>(`select data_nascimento::text as d from public.clientes where id = $1`, [A]);
    return r.rows[0].d;
  }

  it("[4a] 17 anos e 364 dias → erro com 'Você precisa ter 18 anos ou mais', data intacta", async () => {
    const antes = await nasc();
    const e = await erroDe(atualizarNasc(`((current_date - interval '18 years')::date + 1)`));
    expect(e).not.toBeNull();
    expect(e?.message).toContain("Você precisa ter 18 anos ou mais");
    expect(await nasc()).toBe(antes);
  });

  it("[4b] exatamente 18 anos hoje → aceito", async () => {
    const r = await atualizarNasc(`(current_date - interval '18 years')::date`);
    expect(r.affectedRows).toBe(1);
    const ok = await t.db.query<{ ok: boolean }>(
      `select data_nascimento = (current_date - interval '18 years')::date as ok from public.clientes where id = $1`,
      [A],
    );
    expect(ok.rows[0].ok).toBe(true);
  });

  it("[4c] data futura → erro", async () => {
    const e = await erroDe(atualizarNasc(`(current_date + 1)`));
    expect(e).not.toBeNull();
  });

  it("[4d] mais de 120 anos → erro", async () => {
    const e = await erroDe(atualizarNasc(`((current_date - interval '120 years')::date - 1)`));
    expect(e).not.toBeNull();
  });

  it("[4e] criar_perfil_cliente com menor de idade → mesma mensagem, 0 linhas", async () => {
    await criarUsuarios(t, [SOCLI]);
    const e = await erroDe(
      t.asService((db) =>
        db.query(
          `select public.criar_perfil_cliente($1::uuid, 'X', '(11) 90000-0000',
             ((current_date - interval '18 years')::date + 1), false, 'v-teste', $2::jsonb)`,
          [SOCLI, JSON.stringify(ENDERECO)],
        ),
      ),
    );
    expect(e?.message).toContain("Você precisa ter 18 anos ou mais");
    expect(await contar(t, "clientes", SOCLI)).toBe(0);
  });
});

// ===========================================================================
// 5. criar_perfil_cliente — atomicidade e papéis
// ===========================================================================
describe("335 [5] criar_perfil_cliente — atomicidade e papéis", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await novoDb();
    await criarUsuarios(t, [NOVO, SOLOJ, SOCLI]);
    await t.asService((db) =>
      db.query(`insert into public.lojas (dono_id, slug, nome) values ($1, 'p335-soloj', 'X')`, [SOLOJ]),
    );
    await t.asService((db) => db.query(`select public.atribuir_papel_inicial($1, 'cliente')`, [SOCLI]));
  });
  afterAll(async () => t?.close());

  it("[5a] sem endereço → erro, 0 linhas em clientes e nenhum papel novo", async () => {
    const e = await erroDe(criarPerfil(t, NOVO, { endereco: null }));
    expect(e).not.toBeNull();
    expect(await contar(t, "clientes", NOVO)).toBe(0);
    expect(await contar(t, "clientes_enderecos", NOVO)).toBe(0);
    expect(await papeis(t, NOVO)).toEqual([]);
  });

  it("[5b] sem versão de termos → erro, 0 linhas e nenhum papel novo", async () => {
    const e = await erroDe(criarPerfil(t, NOVO, { versao: null }));
    expect(e).not.toBeNull();
    expect(await contar(t, "clientes", NOVO)).toBe(0);
    expect(await papeis(t, NOVO)).toEqual([]);
  });

  it("[5c] conta só-lojista → papéis {cliente, lojista}, perfil e 1 endereço padrão", async () => {
    await criarPerfil(t, SOLOJ);
    expect(await papeis(t, SOLOJ)).toEqual(["cliente", "lojista"]);
    expect(await contar(t, "clientes", SOLOJ)).toBe(1);
    expect(await contar(t, "clientes_enderecos", SOLOJ)).toBe(1);
  });

  it("[5d] conta só-cliente → continua só {cliente} (nunca ganha lojista)", async () => {
    await criarPerfil(t, SOCLI);
    expect(await papeis(t, SOCLI)).toEqual(["cliente"]);
  });

  it("[5e] perfil já existente → erro, continua 1 perfil", async () => {
    const e = await erroDe(criarPerfil(t, SOCLI));
    expect(e).not.toBeNull();
    expect(await contar(t, "clientes", SOCLI)).toBe(1);
    expect(await contar(t, "clientes_enderecos", SOCLI)).toBe(1);
  });

  it("[5f] adicionar_papel_cliente em conta só-cliente é idempotente e não dá lojista", async () => {
    await t.asService((db) => db.query(`select public.adicionar_papel_cliente($1)`, [SOCLI]));
    await t.asService((db) => db.query(`select public.adicionar_papel_cliente($1)`, [SOCLI]));
    expect(await papeis(t, SOCLI)).toEqual(["cliente"]);
  });
});
