import { describe, it, expect } from "vitest";
import { createTestDb } from "./pglite";

// Smoke test da infra de teste em si (não depende de migrations).
// Cria uma tabela com RLS e prova que anon vê só a própria linha via auth.uid().
describe("harness pglite + RLS", () => {
  it("auth.uid() e RLS isolam linhas por usuário", async () => {
    const t = await createTestDb();
    const uA = "11111111-1111-1111-1111-111111111111";
    const uB = "22222222-2222-2222-2222-222222222222";

    await t.asService(async (db) => {
      await db.exec(`
        create table public.nota (id serial primary key, dono uuid not null, txt text);
        alter table public.nota enable row level security;
        create policy nota_self on public.nota
          for all using (dono = auth.uid()) with check (dono = auth.uid());
        grant select, insert, update, delete on public.nota to authenticated;
        grant usage, select on sequence public.nota_id_seq to authenticated;
      `);
    });

    await t.asUser(uA, async (db) => {
      await db.query(`insert into public.nota (dono, txt) values ($1, 'a')`, [uA]);
    });
    await t.asUser(uB, async (db) => {
      await db.query(`insert into public.nota (dono, txt) values ($1, 'b')`, [uB]);
    });

    // Usuário A só enxerga a própria linha.
    const visiveis = await t.asUser(uA, (db) =>
      db.query<{ txt: string }>(`select txt from public.nota`),
    );
    expect(visiveis.rows.map((r) => r.txt)).toEqual(["a"]);

    // service_role ignora RLS — vê as duas.
    const todas = await t.asService((db) =>
      db.query<{ txt: string }>(`select txt from public.nota order by txt`),
    );
    expect(todas.rows.map((r) => r.txt)).toEqual(["a", "b"]);

    await t.close();
  });
});
