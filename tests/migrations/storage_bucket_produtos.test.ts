import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * [003] Storage bucket `produtos` — validação da lógica de isolamento (pglite).
 *
 * LIMITAÇÃO: pglite NÃO tem `storage.objects` / `storage.buckets`. As policies
 * reais (INSERT/UPDATE/DELETE ON storage.objects) NÃO podem ser testadas aqui.
 * A migration 20260614010500_storage_bucket_produtos.sql tem um GUARD DO $$ que
 * detecta a ausência de `storage.objects` e pula silenciosamente (RAISE NOTICE).
 *
 * O que ESTE teste valida (proxy do security contract):
 *   - A subquery que sustenta as policies de escrita:
 *       SELECT id::text FROM public.lojas WHERE dono_id = auth.uid()
 *     só retorna o ID da loja do dono autenticado — não de outra loja.
 *   - Lojista A SÓ tem acesso de escrita à sua pasta ({lojaA_id}/).
 *   - Lojista A NÃO teria permissão de escrever em {lojaB_id}/.
 *   - Anon NÃO teria permissão de escrita (subquery retorna vazio sem uid).
 *   - A migration `produtos` existe e contém o contrato de isolamento
 *     (anti-falso-verde: sem a migration, a subquery pura passaria sozinha).
 *
 * Validação em cloud (Supabase real): aplique o SQL da migration e verifique via
 * Dashboard > Storage > produtos > Policies, ou tente upload cross-loja por
 * cliente autenticado.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aa0000000003";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bb0000000003";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function lerMigrationProdutos(): string {
  const arquivo = readdirSync(MIGRATIONS_DIR).find(
    (f) => f.endsWith(".sql") && f.includes("storage_bucket_produtos"),
  );
  if (!arquivo) {
    throw new Error(
      "Migration de storage do bucket `produtos` não encontrada " +
        "(esperado supabase/migrations/*storage_bucket_produtos*.sql). " +
        "Fase GREEN ainda não implementou.",
    );
  }
  return readFileSync(join(MIGRATIONS_DIR, arquivo), "utf8");
}

let t: TestDb;
let lojaAId: string;
let lojaBId: string;

beforeAll(async () => {
  t = await createTestDb();

  // Inserir usuários em auth.users (superuser bypassa RLS de auth)
  await t.db.query(
    `INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4) ON CONFLICT (id) DO NOTHING`,
    [DONO_A, "dono-a-003@test.local", DONO_B, "dono-b-003@test.local"],
  );

  // Criar lojas via service_role (bypass RLS)
  const resA = await t.asService(async (db) => {
    return db.query<{ id: string }>(
      `INSERT INTO public.lojas (dono_id, slug, nome)
       VALUES ($1, 'loja-a-003', 'Loja A 003')
       RETURNING id`,
      [DONO_A],
    );
  });
  lojaAId = resA.rows[0].id;

  const resB = await t.asService(async (db) => {
    return db.query<{ id: string }>(
      `INSERT INTO public.lojas (dono_id, slug, nome)
       VALUES ($1, 'loja-b-003', 'Loja B 003')
       RETURNING id`,
      [DONO_B],
    );
  });
  lojaBId = resB.rows[0].id;
});

afterAll(async () => {
  await t.close();
});

describe("[003] storage produtos — subquery de isolamento (proxy pglite)", () => {
  it("[1] subquery retorna ID da própria loja para dono A", async () => {
    const res = await t.asUser(DONO_A, async (db) => {
      return db.query<{ id: string }>(
        `SELECT id::text FROM public.lojas WHERE dono_id = auth.uid()`,
      );
    });
    expect(res.rows.map((r) => r.id)).toContain(lojaAId);
    expect(res.rows.map((r) => r.id)).not.toContain(lojaBId);
  });

  it("[2] subquery retorna ID da própria loja para dono B", async () => {
    const res = await t.asUser(DONO_B, async (db) => {
      return db.query<{ id: string }>(
        `SELECT id::text FROM public.lojas WHERE dono_id = auth.uid()`,
      );
    });
    expect(res.rows.map((r) => r.id)).toContain(lojaBId);
    expect(res.rows.map((r) => r.id)).not.toContain(lojaAId);
  });

  it("[3] anon (sem uid) → subquery retorna vazio (sem acesso de escrita)", async () => {
    const res = await t.asAnon(async (db) => {
      return db.query<{ id: string }>(
        `SELECT id::text FROM public.lojas WHERE dono_id = auth.uid()`,
      );
    });
    // auth.uid() retorna NULL quando não há sub no JWT → nenhuma loja casa
    expect(res.rows).toHaveLength(0);
  });

  it("[4] path '{lojaA_id}/foto.webp' → primeiro segmento é ID de loja de A (DONO_A aprovado)", async () => {
    // Simula o que a policy faz: (storage.foldername(name))[1] IN (subquery)
    // Aqui testamos a lógica de extração de pasta via split manual (sem storage.foldername)
    const path = `${lojaAId}/foto.webp`;
    const segment = path.split("/")[0];

    const res = await t.asUser(DONO_A, async (db) => {
      return db.query<{ owned: boolean }>(
        `SELECT $1 IN (SELECT id::text FROM public.lojas WHERE dono_id = auth.uid()) AS owned`,
        [segment],
      );
    });
    expect(res.rows[0].owned).toBe(true);
  });

  it("[5] ATAQUE — DONO_A tenta escrever em path '{lojaB_id}/foto.webp' → segmento NÃO pertence a A", async () => {
    const path = `${lojaBId}/foto.webp`;
    const segment = path.split("/")[0];

    const res = await t.asUser(DONO_A, async (db) => {
      return db.query<{ owned: boolean }>(
        `SELECT $1 IN (SELECT id::text FROM public.lojas WHERE dono_id = auth.uid()) AS owned`,
        [segment],
      );
    });
    // DONO_A NÃO possui loja B → a policy de storage negaria o INSERT/UPDATE/DELETE
    expect(res.rows[0].owned).toBe(false);
  });

  it("[6] ATAQUE — anon tenta escrever em qualquer path → subquery vazia → negado", async () => {
    const path = `${lojaAId}/foto.webp`;
    const segment = path.split("/")[0];

    const res = await t.asAnon(async (db) => {
      return db.query<{ owned: boolean }>(
        `SELECT $1 IN (SELECT id::text FROM public.lojas WHERE dono_id = auth.uid()) AS owned`,
        [segment],
      );
    });
    // auth.uid() = NULL → subquery vazia → IN () = false
    expect(res.rows[0].owned).toBe(false);
  });

  it("[7] ANTI-FALSO-VERDE: migration `produtos` existe e codifica o contrato de isolamento", () => {
    // Sem este caso, os casos 1–6 passariam SEM a migration existir (testam só a
    // subquery pura). Este caso é o que torna a suíte vermelha HOJE: a migration
    // 20260614010500_storage_bucket_produtos.sql ainda não foi criada (fase GREEN).
    const sql = lerMigrationProdutos();

    // Guard pglite presente (no-op no harness, executa no cloud)
    expect(sql).toContain("to_regclass('storage.objects')");

    // Bucket produtos público para leitura da vitrine
    expect(sql).toMatch(/storage\.buckets[\s\S]*'produtos'/);
    expect(sql).toMatch(/'produtos'[\s\S]*true/);

    // Leitura pública isolada ao bucket
    expect(sql).toMatch(/produtos_leitura_publica/);
    expect(sql).toMatch(/FOR SELECT[\s\S]*bucket_id = 'produtos'/i);

    // As três operações de escrita escopadas por dono
    expect(sql).toMatch(/produtos_insert_propria/);
    expect(sql).toMatch(/produtos_update_propria/);
    expect(sql).toMatch(/produtos_delete_propria/);

    // A subquery de isolamento por dono — coração da autorização cross-tenant.
    // Se a fase GREEN afrouxar (remover `WHERE dono_id = auth.uid()`), este
    // expect fica vermelho.
    expect(sql).toMatch(
      /id::text FROM public\.lojas WHERE dono_id = auth\.uid\(\)/,
    );

    // UPDATE precisa de USING **e** WITH CHECK (impede mover objeto para pasta de
    // outra loja). Ambas as cláusulas devem mencionar a subquery do dono.
    const usingCount = (sql.match(/dono_id = auth\.uid\(\)/g) ?? []).length;
    // leitura(0) + insert(1) + update USING(1) + update WITH CHECK(1) + delete(1) = 4
    expect(usingCount).toBeGreaterThanOrEqual(4);
  });
});
