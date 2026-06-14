import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * [074] Storage bucket `pix-qr` — validação da lógica de isolamento (pglite).
 *
 * LIMITAÇÃO: pglite NÃO tem `storage.objects` / `storage.buckets`. As policies
 * reais (INSERT/UPDATE/DELETE ON storage.objects) NÃO podem ser testadas aqui.
 * A migration 20260614006500_storage_pix_qr.sql tem um GUARD DO $$ que detecta
 * a ausência de `storage.objects` e pula silenciosamente (RAISE NOTICE).
 *
 * O que ESTE teste valida (proxy do security contract):
 *   - A subquery que sustenta as policies de escrita:
 *       SELECT id::text FROM public.lojas WHERE dono_id = auth.uid()
 *     só retorna o ID da loja do dono autenticado — não de outra loja.
 *   - Lojista A SÓ tem acesso de escrita à sua pasta ({lojaA_id}/).
 *   - Lojista A NÃO teria permissão de escrever em {lojaB_id}/.
 *   - Anon NÃO teria permissão de escrita (subquery retorna vazio sem uid).
 *
 * Validação em cloud (Supabase real): use o SQL em
 * `supabase/_sync_cloud_pendente.sql` (bloco 074) e verifique via Dashboard
 * > Storage > pix-qr > Policies ou tente upload por cliente anon/autenticado.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aa0000000074";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bb0000000074";

let t: TestDb;
let lojaAId: string;
let lojaBId: string;

beforeAll(async () => {
  t = await createTestDb();

  // Inserir usuários em auth.users (superuser bypassa RLS de auth)
  await t.db.query(
    `INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4) ON CONFLICT (id) DO NOTHING`,
    [DONO_A, "dono-a-074@test.local", DONO_B, "dono-b-074@test.local"],
  );

  // Criar lojas via service_role (bypass RLS)
  const resA = await t.asService(async (db) => {
    return db.query<{ id: string }>(
      `INSERT INTO public.lojas (dono_id, slug, nome)
       VALUES ($1, 'loja-a-074', 'Loja A 074')
       RETURNING id`,
      [DONO_A],
    );
  });
  lojaAId = resA.rows[0].id;

  const resB = await t.asService(async (db) => {
    return db.query<{ id: string }>(
      `INSERT INTO public.lojas (dono_id, slug, nome)
       VALUES ($1, 'loja-b-074', 'Loja B 074')
       RETURNING id`,
      [DONO_B],
    );
  });
  lojaBId = resB.rows[0].id;
});

afterAll(async () => {
  await t.close();
});

describe("[074] storage pix-qr — subquery de isolamento (proxy pglite)", () => {
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

  it("[4] path '{lojaA_id}/qr.png' → primeiro segmento é ID de loja de A (DONO_A aprovado)", async () => {
    // Simula o que a policy faz: (storage.foldername(name))[1] IN (subquery)
    // Aqui testamos a lógica de extração de pasta via split manual (sem storage.foldername)
    const path = `${lojaAId}/qr.png`;
    const segment = path.split("/")[0];

    const res = await t.asUser(DONO_A, async (db) => {
      return db.query<{ owned: boolean }>(
        `SELECT $1 IN (SELECT id::text FROM public.lojas WHERE dono_id = auth.uid()) AS owned`,
        [segment],
      );
    });
    expect(res.rows[0].owned).toBe(true);
  });

  it("[5] ATAQUE — DONO_A tenta escrever em path '{lojaB_id}/qr.png' → segmento NÃO pertence a A", async () => {
    const path = `${lojaBId}/qr.png`;
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
    const path = `${lojaAId}/qr.png`;
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

  it("[7] guard: migration carregou sem erro (storage.objects ausente foi ignorado silenciosamente)", async () => {
    // Se esta linha roda, a migration não jogou EXCEPTION no pglite
    // (o RAISE NOTICE foi silencioso). O banco público está intacto.
    const res = await t.asService(async (db) => {
      return db.query<{ count: string }>(`SELECT count(*)::text FROM public.lojas`);
    });
    // Pelo menos as 2 lojas de setUp existem
    expect(parseInt(res.rows[0].count)).toBeGreaterThanOrEqual(2);
  });
});
