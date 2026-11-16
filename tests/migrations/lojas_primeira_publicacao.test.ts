import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Issue 368 (fase RED do TDD) — marcador `lojas.primeira_publicacao_em`.
 *
 *   D1. Roteamento do painel usa "já publicada ao menos uma vez"
 *       (`primeira_publicacao_em IS NOT NULL`), nunca o `ativo` atual.
 *   D2. Backfill: preenche toda loja com `ativo = true` OU com ≥1 pedido.
 *   D3. Só o banco grava (trigger BEFORE INSERT/UPDATE), quando `ativo`
 *       nasce/vira `true`. Write-once para QUALQUER papel de aplicação.
 *   DD11. O trigger ignora o valor que o escritor manda (não lança): o teste
 *       afirma "valor intacto" relendo pela fonte de verdade (postgres), não
 *       SQLSTATE.
 *
 * Migration: supabase/migrations/20261116120000_lojas_primeira_publicacao.sql
 *
 * Backfill via `createTestDb({ antesDaMigration })`: o estado do cloud no
 * momento do `db push` (lojas e pedidos já existem, coluna não). Sem a
 * migration, o próprio `createTestDb` lança — nunca verde por vácuo.
 */

const MIGRATION = "20261116120000_lojas_primeira_publicacao";

const dono = (n: number) => `36800000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function criarDono(db: PGlite, n: number) {
  await db.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`, [
    dono(n),
    `dono-368-${n}@teste.local`,
  ]);
}

/** Lê o marcador como postgres (superuser, sem RLS) — fonte de verdade. */
async function marcador(t: TestDb, lojaId: string): Promise<string | null> {
  const r = await t.db.query<{ v: string | null }>(
    `select primeira_publicacao_em as v from public.lojas where id = $1`,
    [lojaId],
  );
  expect(r.rows.length, "loja deveria existir").toBe(1);
  return r.rows[0].v;
}

describe("backfill de primeira_publicacao_em (D2)", () => {
  let t: TestDb;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestDb({
      antesDaMigration: {
        migration: MIGRATION,
        semear: async (db) => {
          const cenarios: Array<[string, number, boolean, boolean]> = [
            ["ativa", 1, true, false],
            ["inativaComPedido", 2, false, true],
            ["inativaSemPedido", 3, false, false],
          ];
          for (const [chave, n, ativo, comPedido] of cenarios) {
            await criarDono(db, n);
            const r = await db.query<{ id: string }>(
              `insert into public.lojas (dono_id, slug, nome, ativo) values ($1, $2, $3, $4) returning id`,
              [dono(n), `bf-368-${n}`, `Loja ${chave}`, ativo],
            );
            ids[chave] = r.rows[0].id;
            if (comPedido) {
              await db.query(
                `insert into public.pedidos (loja_id, nome_cliente, subtotal, total) values ($1, 'Cliente 368', 10, 10)`,
                [ids[chave]],
              );
            }
          }
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await t?.close();
  });

  it("backfill: loja ativo=true ganha primeira_publicacao_em", async () => {
    expect(await marcador(t, ids.ativa)).not.toBeNull();
  });

  it("backfill: loja ativo=false com pedido ganha primeira_publicacao_em", async () => {
    expect(await marcador(t, ids.inativaComPedido)).not.toBeNull();
  });

  it("backfill: loja ativo=false sem pedido fica nula", async () => {
    expect(await marcador(t, ids.inativaSemPedido)).toBeNull();
  });
});

describe("trigger lojas_marca_primeira_publicacao (D3, DD11)", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
    await criarDono(t.db, 10);
  }, 60_000);

  afterEach(async () => {
    await t?.close();
  });

  async function inserirComo(ativo: boolean, valorEnviado: string | null): Promise<string> {
    return t.asService(async (db) => {
      const r = await db.query<{ id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo, primeira_publicacao_em)
         values ($1, 'trg-368', 'Loja trigger', $2, $3) returning id`,
        [dono(10), ativo, valorEnviado],
      );
      return r.rows[0].id;
    });
  }

  async function definirAtivo(lojaId: string, ativo: boolean, como: "service" | "dono") {
    const sql = `update public.lojas set ativo = $2 where id = $1`;
    if (como === "service") {
      await t.asService((db) => db.query(sql, [lojaId, ativo]));
    } else {
      await t.asUser(dono(10), (db) => db.query(sql, [lojaId, ativo]));
    }
  }

  it("INSERT ativo=false nasce nula mesmo enviando valor (asService)", async () => {
    const id = await inserirComo(false, "2020-01-01T00:00:00Z");
    expect(await marcador(t, id)).toBeNull();
  });

  it("INSERT ativo=true nasce preenchida ignorando o valor enviado (asService)", async () => {
    const id = await inserirComo(true, "2020-01-01T00:00:00Z");
    const v = await marcador(t, id);
    expect(v).not.toBeNull();
    expect(new Date(v!).getUTCFullYear()).not.toBe(2020);
  });

  it("false→true via asService preenche", async () => {
    const id = await inserirComo(false, null);
    await definirAtivo(id, true, "service");
    expect(await marcador(t, id)).not.toBeNull();
  });

  it("false→true via asUser (PATCH do dono) preenche — débito 140", async () => {
    const id = await inserirComo(false, null);
    await definirAtivo(id, true, "dono");
    const ativo = await t.db.query<{ ativo: boolean }>(`select ativo from public.lojas where id = $1`, [id]);
    expect(ativo.rows[0].ativo, "o PATCH do dono em `ativo` deveria ter passado (D17)").toBe(true);
    expect(await marcador(t, id)).not.toBeNull();
  });

  it("despublicar mantém o marcador", async () => {
    const id = await inserirComo(true, null);
    const antes = await marcador(t, id);
    await definirAtivo(id, false, "service");
    expect(antes).not.toBeNull();
    expect(await marcador(t, id)).toBe(antes);
  });

  it("republicar mantém o timestamp original", async () => {
    const id = await inserirComo(true, null);
    const original = await marcador(t, id);
    await definirAtivo(id, false, "dono");
    await definirAtivo(id, true, "dono");
    await definirAtivo(id, false, "service");
    await definirAtivo(id, true, "service");
    expect(original).not.toBeNull();
    expect(await marcador(t, id)).toBe(original);
  });

  it("asUser tentando limpar ou alterar → valor intacto", async () => {
    const id = await inserirComo(true, null);
    const original = await marcador(t, id);
    expect(original).not.toBeNull();
    for (const valor of [null, "2020-01-01T00:00:00Z", "2999-01-01T00:00:00Z"]) {
      await t.asUser(dono(10), (db) =>
        db.query(`update public.lojas set primeira_publicacao_em = $2 where id = $1`, [id, valor]),
      );
      expect(await marcador(t, id), `após tentar gravar ${String(valor)}`).toBe(original);
    }
  });

  it("asService tentando limpar ou alterar → valor intacto", async () => {
    const id = await inserirComo(true, null);
    const original = await marcador(t, id);
    expect(original).not.toBeNull();
    for (const valor of [null, "2020-01-01T00:00:00Z", "2999-01-01T00:00:00Z"]) {
      await t.asService((db) =>
        db.query(`update public.lojas set primeira_publicacao_em = $2 where id = $1`, [id, valor]),
      );
      expect(await marcador(t, id), `após tentar gravar ${String(valor)}`).toBe(original);
    }
  });

  it("asUser gravando marcador em loja ativo=false → segue nula", async () => {
    const id = await inserirComo(false, null);
    await t.asUser(dono(10), (db) =>
      db.query(`update public.lojas set primeira_publicacao_em = now() where id = $1`, [id]),
    );
    expect(await marcador(t, id)).toBeNull();
  });
});
