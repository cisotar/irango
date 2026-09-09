import { afterAll, beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDb, type TestDb } from "../helpers/pglite";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t?.close();
});

let seq = 0;
async function zonaFixture() {
  seq += 1;
  const u = await t.db.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id",
    [`dono182-${seq}@example.test`],
  );
  const l = await t.db.query<{ id: string }>(
    "insert into public.lojas (dono_id, nome, slug) values ($1, 'Loja 182', $2) returning id",
    [u.rows[0].id, `loja-182-${seq}`],
  );
  const z = await t.db.query<{ id: string }>(
    "insert into public.zonas_entrega (loja_id, nome, tipo) values ($1, 'Centro', 'bairro') returning id",
    [l.rows[0].id],
  );
  return { lojaId: l.rows[0].id, zonaId: z.rows[0].id };
}

it("índice único existe em taxas_entrega(zona_id)", async () => {
  const r = await t.db.query<{ indexdef: string }>(
    "select indexdef from pg_indexes where schemaname='public' and tablename='taxas_entrega'",
  );
  expect(r.rows.map((x) => x.indexdef).join("\n")).toContain(
    "UNIQUE INDEX taxas_entrega_zona_id_key",
  );
});

it("ON CONFLICT (zona_id) deixa de dar 42P10 e atualiza a taxa", async () => {
  const { zonaId } = await zonaFixture();
  await t.db.query("insert into public.taxas_entrega (zona_id, taxa) values ($1, 5.00)", [zonaId]);
  await t.db.query(
    `insert into public.taxas_entrega (zona_id, taxa) values ($1, 9.90)
     on conflict (zona_id) do update set taxa = excluded.taxa`,
    [zonaId],
  );
  const r = await t.db.query<{ taxa: string }>(
    "select taxa from public.taxas_entrega where zona_id = $1",
    [zonaId],
  );
  expect(r.rows).toHaveLength(1);
  expect(Number(r.rows[0].taxa)).toBe(9.9);
});

it("segunda taxa na mesma zona é rejeitada", async () => {
  const { zonaId } = await zonaFixture();
  await t.db.query("insert into public.taxas_entrega (zona_id, taxa) values ($1, 5.00)", [zonaId]);
  await expect(
    t.db.query("insert into public.taxas_entrega (zona_id, taxa) values ($1, 7.00)", [zonaId]),
  ).rejects.toThrow(/duplicate key|unique/i);
});

it("dedup: com duplicatas, sobrevive a primeira e a perdedora vai para o arquivo", async () => {
  const { zonaId } = await zonaFixture();
  // Recria o estado pré-migration (sem constraint) para exercitar o bloco de dedup.
  await t.db.exec("drop index public.taxas_entrega_zona_id_key");
  const a = await t.db.query<{ id: string }>(
    "insert into public.taxas_entrega (zona_id, taxa) values ($1, 5.00) returning id",
    [zonaId],
  );
  const b = await t.db.query<{ id: string }>(
    "insert into public.taxas_entrega (zona_id, taxa) values ($1, 7.00) returning id",
    [zonaId],
  );

  // Roda o MESMO SQL da migration (bloco de dedup + índice), copiado do arquivo.
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/20260909120000_taxas_entrega_zona_id_unique.sql"),
    "utf8",
  );
  await t.db.exec(sql);

  const viva = await t.db.query<{ id: string; taxa: string }>(
    "select id, taxa from public.taxas_entrega where zona_id = $1",
    [zonaId],
  );
  expect(viva.rows).toHaveLength(1);
  expect(viva.rows[0].id).toBe(a.rows[0].id); // menor ctid = a primeira inserida
  expect(Number(viva.rows[0].taxa)).toBe(5);

  const arq = await t.db.query<{ taxa_id: string; taxa: string }>(
    "select taxa_id, taxa from public.taxas_entrega_duplicadas_182 where zona_id = $1",
    [zonaId],
  );
  expect(arq.rows).toHaveLength(1);
  expect(arq.rows[0].taxa_id).toBe(b.rows[0].id);
  expect(Number(arq.rows[0].taxa)).toBe(7);
});

it("arquivo de duplicatas: RLS deny-all esconde as linhas de anon e authenticated", async () => {
  // Banco próprio: o teste de dedup reaplica a migration (e o seu revoke), o que
  // mudaria os grants deste. Aqui vale o estado real do harness: GRANTS_SQL
  // reabre o GRANT depois das migrations, então a contenção observada é a RLS.
  const t2 = await createTestDb();
  try {
    await t2.db.query(
      "insert into public.taxas_entrega_duplicadas_182 (taxa_id, zona_id, taxa) values (gen_random_uuid(), gen_random_uuid(), 3.00)",
    );
    // Superuser (postgres) ignora RLS e enxerga a linha.
    const total = await t2.db.query("select * from public.taxas_entrega_duplicadas_182");
    expect(total.rows.length).toBeGreaterThan(0);

    // RLS habilitada SEM policy → 0 linhas para anon/authenticated.
    const anon = await t2.asAnon((db) =>
      db.query("select * from public.taxas_entrega_duplicadas_182"),
    );
    expect(anon.rows).toHaveLength(0);
    const user = await t2.asUser("00000000-0000-0000-0000-000000000001", (db) =>
      db.query("select * from public.taxas_entrega_duplicadas_182"),
    );
    expect(user.rows).toHaveLength(0);
  } finally {
    await t2.close();
  }
});
