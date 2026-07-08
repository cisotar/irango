import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 146 — migration `admin_acessos` (audit log) + RLS deny-all.
 *
 * A migration `supabase/migrations/20260707122000_admin_acessos.sql` AINDA NÃO
 * EXISTE. `createTestDb()` aplica o bootstrap + todas as migrations atuais, então
 * a tabela `public.admin_acessos` NÃO está presente. Toda operação sobre ela
 * (insert/select/count/cascade) deve FALHAR por relação inexistente — esse é o RED
 * esperado, comprovado pela saída do `npx vitest run`.
 *
 * Quem deixa verde é a fase GREEN (`executar`), escrevendo a migration. Nenhum
 * código de produção é escrito aqui. Contrato para a GREEN: ver final do arquivo.
 *
 * Espelha:
 * - `schema_inicial.test.ts:490-557` (describe "webhook_eventos_hotmart é deny-all"):
 *   anon/authenticated não leem nem inserem; service_role (BYPASSRLS) lê e escreve.
 *
 * `loja_id` é NOT NULL SEM FK (decisão da revisão de auditoria da issue 146 — ver
 * comentário da migration): um audit log deve sobreviver ao hard-delete da loja
 * auditada, senão a exclusão em si vira a única ação não-rastreável.
 */

let t: TestDb;
let lojaId: string;

// Dono da loja seed (lojista que tenta — e deve falhar — ler/escrever o audit log).
const DONO_ID = "aaaaaaaa-aaaa-aaaa-aaaa-000000000146";
// Id do dono do SaaS que aparece em admin_user_id (sem FK, por design).
const ADMIN_ID = "bbbbbbbb-bbbb-bbbb-bbbb-000000000146";
// Loja inexistente para provar a integridade referencial da FK loja_id.
const LOJA_FANTASMA = "99999999-9999-9999-9999-999999999999";

/** Insere o dono em auth.users (superuser) e cria a loja seed via service (bypass RLS). */
async function seedLoja(): Promise<string> {
  await t.db.query(
    `insert into auth.users (id, email) values ($1, 'dono-admin-acessos@teste.local')
       on conflict (id) do nothing`,
    [DONO_ID],
  );
  return t.asService(async (db) => {
    const r = await db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo)
         values ($1, 'loja-admin-acessos', 'Loja Audit', true) returning id`,
      [DONO_ID],
    );
    return r.rows[0].id;
  });
}

/** Conta linhas via service (bypass RLS): mede o estado real do banco, não o filtrado por RLS. */
async function contar(tabela: string, coluna: string, id: string): Promise<number> {
  return t.asService(async (db) => {
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.${tabela} where ${coluna} = $1`,
      [id],
    );
    return r.rows[0].n;
  });
}

beforeEach(async () => {
  t = await createTestDb();
  // A loja seed usa a tabela `lojas` (já existe no schema_inicial), então o seed
  // funciona mesmo no RED — só `admin_acessos` está ausente.
  lojaId = await seedLoja();
});

afterEach(async () => {
  await t?.close?.();
});

// ─────────────────────────────────────────── RLS deny-all admin_acessos
describe("admin_acessos é deny-all (RLS sem policy)", () => {
  it("anon não lê linha inserida via service (0 linhas ou negado)", async () => {
    await t.asService((db) =>
      db.query(
        `insert into public.admin_acessos (admin_user_id, loja_id, acao)
         values ($1, $2, 'criar_loja')`,
        [ADMIN_ID, lojaId],
      ),
    );
    const rows = await t
      .asAnon((db) => db.query(`select * from public.admin_acessos`))
      .then((r) => r.rows)
      .catch(() => [] as unknown[]); // negado também é deny-all aceitável
    expect(rows.length).toBe(0);
  });

  it("anon não consegue inserir (deny-all)", async () => {
    const inseriu = await t
      .asAnon(async (db) => {
        await db.query(
          `insert into public.admin_acessos (admin_user_id, loja_id, acao)
           values ($1, $2, 'burla-anon')`,
          [ADMIN_ID, lojaId],
        );
        return true;
      })
      .catch(() => false);
    // anon não pode inserir: ou a operação lança, ou (RLS) nenhuma linha persiste.
    const persistiu = await t.asService((db) =>
      db.query(`select 1 from public.admin_acessos where acao = 'burla-anon'`),
    );
    expect(inseriu && persistiu.rows.length > 0).toBe(false);
  });

  it("authenticated (lojista dono da loja seed) não lê admin_acessos", async () => {
    await t.asService((db) =>
      db.query(
        `insert into public.admin_acessos (admin_user_id, loja_id, acao)
         values ($1, $2, 'salvar_tema')`,
        [ADMIN_ID, lojaId],
      ),
    );
    const rows = await t
      .asUser(DONO_ID, (db) => db.query(`select * from public.admin_acessos`))
      .then((r) => r.rows)
      .catch(() => [] as unknown[]);
    // Não vaza PII cross-tenant: nem a própria loja do lojista aparece no audit log.
    expect(rows.length).toBe(0);
  });

  it("authenticated (lojista dono da loja seed) não consegue inserir (deny-all)", async () => {
    const inseriu = await t
      .asUser(DONO_ID, async (db) => {
        await db.query(
          `insert into public.admin_acessos (admin_user_id, loja_id, acao)
           values ($1, $2, 'burla-user')`,
          [ADMIN_ID, lojaId],
        );
        return true;
      })
      .catch(() => false);
    const persistiu = await t.asService((db) =>
      db.query(`select 1 from public.admin_acessos where acao = 'burla-user'`),
    );
    expect(inseriu && persistiu.rows.length > 0).toBe(false);
  });

  it("service_role insere (com loja seed p/ FK) e lê de volta (bypass RLS)", async () => {
    const inserido = await t.asService((db) =>
      db.query<{ id: string }>(
        `insert into public.admin_acessos (admin_user_id, loja_id, acao, entidade_id, metadados)
         values ($1, $2, 'alternar_modulo', $3, $4::jsonb) returning id`,
        [ADMIN_ID, lojaId, lojaId, JSON.stringify({ modulo: "impressao", ativo: true })],
      ),
    );
    expect(inserido.rows.length).toBe(1);

    const lido = await t.asService((db) =>
      db.query(`select 1 from public.admin_acessos where id = $1`, [inserido.rows[0].id]),
    );
    expect(lido.rows.length).toBe(1);
  });
});

// ───────────── loja_id SEM FK — trilha sobrevive ao hard delete da loja
// Decisão da revisão de auditoria (issue 146): audit log não pode se
// autodestruir junto com o sujeito auditado — senão a ação de maior
// privilégio (excluir a loja) vira a única não-auditável. Ver comentário
// da migration para o raciocínio completo.
describe("admin_acessos.loja_id — SEM FK (trilha sobrevive ao hard delete da loja)", () => {
  it("deletar a loja NÃO apaga as linhas de admin_acessos (evidência preservada)", async () => {
    await t.asService((db) =>
      db.query(
        `insert into public.admin_acessos (admin_user_id, loja_id, acao)
         values ($1, $2, 'salvar_tema')`,
        [ADMIN_ID, lojaId],
      ),
    );
    expect(await contar("admin_acessos", "loja_id", lojaId)).toBe(1);

    // Hard delete admin (issue 084): sem FK, nada impede nem cascateia.
    await expect(
      t.asService((db) => db.query(`delete from public.lojas where id = $1`, [lojaId])),
    ).resolves.toBeDefined();

    // Loja apagada, mas a linha de auditoria PERMANECE (órfã, de propósito).
    expect(await contar("lojas", "id", lojaId)).toBe(0);
    expect(await contar("admin_acessos", "loja_id", lojaId)).toBe(1);
  });

  it("nenhuma constraint de FK nomeada 'admin_acessos_loja_id_fkey' existe (sem FK, por design)", async () => {
    const r = await t.asService((db) =>
      db.query<{ delete_rule: string }>(
        `select rc.delete_rule
           from information_schema.referential_constraints rc
          where rc.constraint_name = 'admin_acessos_loja_id_fkey'`,
      ),
    );
    expect(r.rows.length).toBe(0);
  });

  it("insert com loja_id inexistente é ACEITO (sem FK — integridade fica na aplicação)", async () => {
    const r = await t.asService((db) =>
      db.query<{ id: string }>(
        `insert into public.admin_acessos (admin_user_id, loja_id, acao)
         values ($1, $2, 'criar_loja') returning id`,
        [ADMIN_ID, LOJA_FANTASMA],
      ),
    );
    expect(r.rows.length).toBe(1);
  });
});

// ─────────────────────────────────────────── colunas opcionais + jsonb complexo
describe("admin_acessos — colunas opcionais (entidade_id/metadados) e jsonb complexo", () => {
  it("entidade_id e metadados omitidos no INSERT nascem NULL (ações sem entidade específica, ex.: 'criar_loja')", async () => {
    const r = await t.asService((db) =>
      db.query<{ entidade_id: string | null; metadados: unknown }>(
        `insert into public.admin_acessos (admin_user_id, loja_id, acao)
         values ($1, $2, 'criar_loja') returning entidade_id, metadados`,
        [ADMIN_ID, lojaId],
      ),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].entidade_id).toBeNull();
    expect(r.rows[0].metadados).toBeNull();
  });

  it("metadados aceita jsonb aninhado (array + objeto + número) e faz round-trip exato", async () => {
    const payload = {
      modulo: "impressao",
      ativo: true,
      colunas_alteradas: ["modulo_impressao_a4", "modulo_impressao_termica"],
      anterior: { a4: false, termica: false },
      contagem: 2,
    };
    const inserido = await t.asService((db) =>
      db.query<{ id: string }>(
        `insert into public.admin_acessos (admin_user_id, loja_id, acao, metadados)
         values ($1, $2, 'alternar_modulo', $3::jsonb) returning id`,
        [ADMIN_ID, lojaId, JSON.stringify(payload)],
      ),
    );
    const lido = await t.asService((db) =>
      db.query<{ metadados: unknown }>(
        `select metadados from public.admin_acessos where id = $1`,
        [inserido.rows[0].id],
      ),
    );
    // Round-trip exato: se a coluna fosse `text`/`json` mal serializado ou o cast
    // achatasse a estrutura, este `toEqual` profundo (array + objeto aninhado) falha.
    expect(lido.rows[0].metadados).toEqual(payload);
  });
});

// ─────────────────────────────────────────── NOT NULL fail-closed (trilha não nasce incompleta)
describe("admin_acessos — NOT NULL fail-closed (acao/admin_user_id/loja_id)", () => {
  it("NOT NULL: acao = NULL explícito é rejeitado (23502) — auditoria não registra ação anônima", async () => {
    await expect(
      t.asService((db) =>
        db.query(
          `insert into public.admin_acessos (admin_user_id, loja_id, acao) values ($1, $2, null)`,
          [ADMIN_ID, lojaId],
        ),
      ),
    ).rejects.toMatchObject({ code: "23502" }); // not_null_violation
  });

  it("NOT NULL: admin_user_id = NULL explícito é rejeitado (23502) — auditoria não registra admin anônimo", async () => {
    await expect(
      t.asService((db) =>
        db.query(
          `insert into public.admin_acessos (admin_user_id, loja_id, acao) values (null, $1, 'criar_loja')`,
          [lojaId],
        ),
      ),
    ).rejects.toMatchObject({ code: "23502" });
  });

  it("NOT NULL: loja_id = NULL explícito é rejeitado (23502) — distinto do foreign_key_violation da loja fantasma", async () => {
    await expect(
      t.asService((db) =>
        db.query(
          `insert into public.admin_acessos (admin_user_id, loja_id, acao) values ($1, null, 'criar_loja')`,
          [ADMIN_ID],
        ),
      ),
    ).rejects.toMatchObject({ code: "23502" });
  });
});

/**
 * ─────────────────────────────────────────── Nota de schema (pós-revisão)
 *
 * `admin_acessos.loja_id` é `uuid not null` SEM FK a `lojas(id)` — decisão da
 * revisão de auditoria da issue 146 (ver cabeçalho da migration
 * `20260707122000_admin_acessos.sql` para o raciocínio completo). Um audit log
 * sobrevive ao hard-delete do sujeito auditado; integridade referencial de
 * `loja_id` é garantida na aplicação (issue 147, `registrarAcessoAdmin`
 * recebe `lojaId` já validado por `validarLojaIdAdmin`/`verificarAdminSaaS`
 * antes de logar), não no banco.
 */
