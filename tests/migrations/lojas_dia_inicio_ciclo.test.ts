import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 354 — ciclo mensal da loja (`lojas.dia_inicio_ciclo`, RN-V08).
 * Autoridade: plan/tecnico-relatorio-vendas.md §6.4 e §8.2 (T354-01..09).
 *
 * Contrato (migration C `20261007123000_lojas_dia_inicio_ciclo.sql`):
 *   dia_inicio_ciclo smallint NOT NULL DEFAULT 1,
 *   CHECK lojas_dia_inicio_ciclo_check (1..28);
 *   gravável pelo dono (lojas_update_proprio), sem abrir billing, fora de vitrine_lojas.
 *
 * Por que é RED: a coluna não existe (42703 em toda leitura/escrita).
 * Recusas afirmam SQLSTATE E fragmento da mensagem. Dados fictícios.
 */

const DONO_A = "a3540000-0000-4000-8000-00000000000a";
const DONO_B = "b3540000-0000-4000-8000-00000000000b";
const DONO_N = "c3540000-0000-4000-8000-00000000000c";

async function erroDe(p: Promise<unknown>): Promise<{ code?: string; message: string } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { code?: string; message: string };
  }
}

async function criarLoja(t: TestDb, dono: string, slug: string): Promise<string> {
  await t.db.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`, [
    dono,
    `${slug}@teste.local`,
  ]);
  const r = await t.asService((db) =>
    db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1, $2, 'Loja', true) returning id`,
      [dono, slug],
    ),
  );
  return r.rows[0].id;
}

async function ciclo(t: TestDb, loja: string): Promise<number> {
  const r = await t.db.query<{ dia_inicio_ciclo: number }>(
    `select dia_inicio_ciclo from public.lojas where id = $1`,
    [loja],
  );
  return r.rows[0].dia_inicio_ciclo;
}

const gravarComoServico = (t: TestDb, loja: string, valor: number | null) =>
  t.asService((db) => db.query(`update public.lojas set dia_inicio_ciclo = $1 where id = $2`, [valor, loja]));

describe("354 lojas.dia_inicio_ciclo — coluna, CHECK, RLS do dono, billing e vitrine (pglite)", () => {
  let t: TestDb;
  let lojaA: string;

  beforeAll(async () => {
    t = await createTestDb();
    lojaA = await criarLoja(t, DONO_A, "loja-a-354");
    await criarLoja(t, DONO_B, "loja-b-354");
  });
  afterAll(async () => {
    await t.close();
  });

  it("T354-01 default 1 em loja nova; smallint NOT NULL", async () => {
    const nova = await criarLoja(t, DONO_N, "loja-n-354");
    expect(await ciclo(t, nova)).toBe(1);
    const r = await t.db.query<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'lojas' and column_name = 'dia_inicio_ciclo'`,
    );
    expect(r.rows).toEqual([{ data_type: "smallint", is_nullable: "NO" }]);
  });

  it("T354-02 0 recusado → 23514 lojas_dia_inicio_ciclo_check", async () => {
    const e = await erroDe(gravarComoServico(t, lojaA, 0));
    expect(e?.code).toBe("23514");
    expect(e?.message).toContain("lojas_dia_inicio_ciclo_check");
  });

  it("T354-03 29 recusado → 23514 lojas_dia_inicio_ciclo_check", async () => {
    const e = await erroDe(gravarComoServico(t, lojaA, 29));
    expect(e?.code).toBe("23514");
    expect(e?.message).toContain("lojas_dia_inicio_ciclo_check");
  });

  it("T354-04 limites 1 e 28 aceitos", async () => {
    await gravarComoServico(t, lojaA, 28);
    expect(await ciclo(t, lojaA)).toBe(28);
    await gravarComoServico(t, lojaA, 1);
    expect(await ciclo(t, lojaA)).toBe(1);
  });

  it("T354-05 NULL recusado → 23502 dia_inicio_ciclo", async () => {
    const e = await erroDe(gravarComoServico(t, lojaA, null));
    expect(e?.code).toBe("23502");
    expect(e?.message).toContain("dia_inicio_ciclo");
  });

  it("T354-06 dono grava o próprio ciclo (1 linha) e lê 5", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`update public.lojas set dia_inicio_ciclo = 5 where id = $1`, [lojaA]),
    );
    expect(r.affectedRows).toBe(1);
    expect(await ciclo(t, lojaA)).toBe(5);
  });

  it("T354-07 outro dono não grava o ciclo de A (0 linhas; A segue 5)", async () => {
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`update public.lojas set dia_inicio_ciclo = 9 where id = $1`, [lojaA]),
    );
    expect(r.affectedRows).toBe(0);
    expect(await ciclo(t, lojaA)).toBe(5);
  });

  it("T354-08 gravar o ciclo não abre billing: com assinatura_status no mesmo UPDATE → trigger recusa; ciclo não muda", async () => {
    const e = await erroDe(
      t.asUser(DONO_A, (db) =>
        db.query(`update public.lojas set dia_inicio_ciclo = 7, assinatura_status = 'ativa' where id = $1`, [
          lojaA,
        ]),
      ),
    );
    expect(e?.code).toBe("P0001");
    expect(e?.message).toContain("colunas de billing/identidade são somente-servidor");
    expect(await ciclo(t, lojaA)).toBe(5);
  });

  it("T354-09 fora da vitrine: lojas tem a coluna, vitrine_lojas não", async () => {
    const col = async (tabela: string) =>
      (
        await t.db.query(
          `select 1 from information_schema.columns
            where table_schema = 'public' and table_name = $1 and column_name = 'dia_inicio_ciclo'`,
          [tabela],
        )
      ).rows.length;
    // Pré-condição: sem a coluna em lojas, "ausente da vitrine" passaria por vácuo.
    expect(await col("lojas")).toBe(1);
    expect(await col("vitrine_lojas")).toBe(0);
  });
});
