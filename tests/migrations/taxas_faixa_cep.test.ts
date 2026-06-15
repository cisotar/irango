import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 064 — habilitar `faixa_cep` no schema.
 *
 * Hoje `taxas_entrega` NÃO tem colunas de faixa; `tipo='faixa_cep'` está no CHECK
 * de `zonas_entrega` mas é letra morta (calcularFrete retorna não-atendido). A
 * fase GREEN cria a migration:
 *
 *   ALTER TABLE public.taxas_entrega
 *     ADD COLUMN cep_inicio integer,
 *     ADD COLUMN cep_fim    integer;
 *   ALTER TABLE public.taxas_entrega
 *     ADD CONSTRAINT taxas_faixa_cep_coerente CHECK (
 *       (cep_inicio IS NULL AND cep_fim IS NULL)
 *       OR (cep_inicio BETWEEN 0 AND 99999999
 *           AND cep_fim BETWEEN 0 AND 99999999
 *           AND cep_inicio <= cep_fim)
 *     );
 *
 * Estes testes rodam o SQL REAL das migrations no pglite. RED hoje:
 *   - INSERT com cep_inicio/cep_fim falha (coluna não existe).
 *   - O CHECK de coerência ainda não recusa faixa invertida.
 *
 * Anti-falso-verde: as inserções rodam via asService (BYPASSRLS) — provamos o
 * CONTRATO DE SCHEMA (coluna + CHECK), não política de linha.
 */

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
});

let seq = 0;

/**
 * Cria um dono novo (auth.users via superuser) por chamada — RN-01: cada conta
 * só pode ter 1 loja (constraint lojas_dono_unico). Cada cenário precisa do seu.
 */
async function novoDono(): Promise<string> {
  const n = seq++;
  const id = `aaaaaaaa-aaaa-aaaa-aaaa-${String(n).padStart(12, "0")}`;
  await t.db.query(
    `insert into auth.users (id, email) values ($1, 'dono-${n}@teste.local')
       on conflict (id) do nothing`,
    [id],
  );
  return id;
}

afterAll(async () => {
  await t?.close?.();
});

/** Cria loja + zona faixa_cep e devolve o id da zona (via service / BYPASSRLS). */
async function criarZonaFaixa(): Promise<string> {
  const dono = await novoDono();
  return t.asService(async (db) => {
    const loja = await db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo)
         values ($1, 'loja-faixa-${seq++}', 'Loja Faixa', true)
       returning id`,
      [dono],
    );
    const zona = await db.query<{ id: string }>(
      `insert into public.zonas_entrega (loja_id, nome, tipo, ativo)
         values ($1, 'Faixa Sul', 'faixa_cep', true)
       returning id`,
      [loja.rows[0].id],
    );
    return zona.rows[0].id;
  });
}

describe("064 taxas_entrega.cep_inicio/cep_fim — schema de faixa de CEP", () => {
  it("aceita INSERT de taxa com cep_inicio e cep_fim (colunas existem)", async () => {
    const zonaId = await criarZonaFaixa();
    await t.asService(async (db) => {
      await db.query(
        `insert into public.taxas_entrega (zona_id, taxa, cep_inicio, cep_fim)
           values ($1, 8.00, 1000000, 1099999)`,
        [zonaId],
      );
      const r = await db.query<{ cep_inicio: number; cep_fim: number }>(
        `select cep_inicio, cep_fim from public.taxas_entrega where zona_id = $1`,
        [zonaId],
      );
      expect(r.rows[0].cep_inicio).toBe(1000000);
      expect(r.rows[0].cep_fim).toBe(1099999);
    });
  });

  it("permite ambos NULL (zona bairro/raio_km não usa faixa)", async () => {
    const zonaId = await criarZonaFaixa();
    await expect(
      t.asService((db) =>
        db.query(
          `insert into public.taxas_entrega (zona_id, taxa, cep_inicio, cep_fim)
             values ($1, 5.00, null, null)`,
          [zonaId],
        ),
      ),
    ).resolves.toBeDefined();
  });

  it("CHECK recusa faixa invertida (cep_inicio > cep_fim)", async () => {
    const zonaId = await criarZonaFaixa();
    await expect(
      t.asService((db) =>
        db.query(
          `insert into public.taxas_entrega (zona_id, taxa, cep_inicio, cep_fim)
             values ($1, 8.00, 1099999, 1000000)`,
          [zonaId],
        ),
      ),
    ).rejects.toThrow();
  });

  it("CHECK recusa CEP acima de 99999999 (fora do range de 8 dígitos)", async () => {
    const zonaId = await criarZonaFaixa();
    await expect(
      t.asService((db) =>
        db.query(
          `insert into public.taxas_entrega (zona_id, taxa, cep_inicio, cep_fim)
             values ($1, 8.00, 0, 100000000)`,
          [zonaId],
        ),
      ),
    ).rejects.toThrow();
  });

  it("CHECK recusa faixa parcial (um lado NULL e o outro preenchido)", async () => {
    const zonaId = await criarZonaFaixa();
    await expect(
      t.asService((db) =>
        db.query(
          `insert into public.taxas_entrega (zona_id, taxa, cep_inicio, cep_fim)
             values ($1, 8.00, 1000000, null)`,
          [zonaId],
        ),
      ),
    ).rejects.toThrow();
  });
});
