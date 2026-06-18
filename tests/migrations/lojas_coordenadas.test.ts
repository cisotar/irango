import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 001 — colunas latitude/longitude em `lojas`.
 *
 * Hoje `lojas` NÃO tem colunas de coordenadas. A fase GREEN cria a migration
 * `<timestamp>_lojas_coordenadas.sql`:
 *
 *   ALTER TABLE public.lojas
 *     ADD COLUMN latitude  float8,
 *     ADD COLUMN longitude float8;
 *   ALTER TABLE public.lojas
 *     ADD CONSTRAINT lojas_coords_par_check
 *       CHECK ((latitude IS NULL) = (longitude IS NULL)),
 *     ADD CONSTRAINT lojas_latitude_range_check
 *       CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
 *     ADD CONSTRAINT lojas_longitude_range_check
 *       CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
 *
 * Estes testes rodam o SQL REAL das migrations no pglite. RED hoje:
 *   - INSERT com latitude/longitude falha (coluna não existe).
 *   - Os CHECKs de par/faixa ainda não existem para recusar dados inválidos.
 *
 * Anti-falso-verde: as inserções rodam via asService (BYPASSRLS) — provamos o
 * CONTRATO DE SCHEMA (coluna + CHECK), não política de linha.
 */

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t?.close?.();
});

let seq = 0;

/** Cria um dono novo (auth.users via superuser) — RN-01: 1 loja por conta. */
async function novoDono(): Promise<string> {
  const n = seq++;
  const id = `bbbbbbbb-bbbb-bbbb-bbbb-${String(n).padStart(12, "0")}`;
  await t.db.query(
    `insert into auth.users (id, email) values ($1, 'dono-coord-${n}@teste.local')
       on conflict (id) do nothing`,
    [id],
  );
  return id;
}

/** Insere uma loja com as coords dadas; retorna a Promise da query (via service / BYPASSRLS). */
async function inserirLojaComCoords(latitude: number | null, longitude: number | null) {
  const dono = await novoDono();
  return t.asService((db) =>
    db.query(
      `insert into public.lojas (dono_id, slug, nome, ativo, latitude, longitude)
         values ($1, 'loja-coord-${seq++}', 'Loja Coord', true, $2, $3)`,
      [dono, latitude, longitude],
    ),
  );
}

describe("001 lojas.latitude/longitude — schema de coordenadas", () => {
  it("aceita INSERT com par (lat,lng) válido (colunas existem)", async () => {
    const dono = await novoDono();
    const slug = `loja-coord-${seq++}`;
    await t.asService(async (db) => {
      await db.query(
        `insert into public.lojas (dono_id, slug, nome, ativo, latitude, longitude)
           values ($1, $2, 'Loja Coord', true, -23.55052, -46.633308)`,
        [dono, slug],
      );
      const r = await db.query<{ latitude: number; longitude: number }>(
        `select latitude, longitude from public.lojas where slug = $1`,
        [slug],
      );
      expect(r.rows[0].latitude).toBeCloseTo(-23.55052);
      expect(r.rows[0].longitude).toBeCloseTo(-46.633308);
    });
  });

  it("aceita INSERT com ambos NULL (loja sem coords — RN-3)", async () => {
    await expect(inserirLojaComCoords(null, null)).resolves.toBeDefined();
  });

  it("CHECK lojas_coords_par_check recusa só latitude (longitude NULL)", async () => {
    await expect(inserirLojaComCoords(-23.55052, null)).rejects.toThrow();
  });

  it("CHECK lojas_latitude_range_check recusa latitude=200", async () => {
    await expect(inserirLojaComCoords(200, -46.633308)).rejects.toThrow();
  });

  it("CHECK lojas_longitude_range_check recusa longitude=-181", async () => {
    await expect(inserirLojaComCoords(-23.55052, -181)).rejects.toThrow();
  });

  // Bordas adicionais: limites exatos do BETWEEN (inclusive) e violações mínimas:

  it("aceita latitude exatamente no limite superior (90)", async () => {
    // BETWEEN -90 AND 90 é inclusivo — 90 é o polo Norte válido.
    await expect(inserirLojaComCoords(90, 0)).resolves.toBeDefined();
  });

  it("aceita latitude exatamente no limite inferior (-90)", async () => {
    // BETWEEN -90 AND 90 é inclusivo — -90 é o polo Sul válido.
    await expect(inserirLojaComCoords(-90, 0)).resolves.toBeDefined();
  });

  it("aceita longitude exatamente no limite superior (180)", async () => {
    // BETWEEN -180 AND 180 é inclusivo — 180 é o meridiano internacional.
    await expect(inserirLojaComCoords(0, 180)).resolves.toBeDefined();
  });

  it("CHECK lojas_latitude_range_check recusa latitude=90.000001 (acima do limite)", async () => {
    // Verifica que o CHECK não usa > 90 (rejeita só > 90.5 por exemplo) mas sim BETWEEN.
    await expect(inserirLojaComCoords(90.000001, 0)).rejects.toThrow();
  });

  it("CHECK lojas_coords_par_check recusa só longitude (latitude NULL)", async () => {
    // Simetria do CHECK de par: só longitude também é inválido.
    await expect(inserirLojaComCoords(null, -46.633308)).rejects.toThrow();
  });
});

/**
 * Fase RED (TDD) da issue 005 — invariante de privacidade: a view PÚBLICA
 * `vitrine_lojas` NÃO expõe coords (spec §Modelos de Dados, seguranca.md §19).
 *
 * As coords são server-only (lidas só via service_role na tabela base `lojas`).
 * Se a view tivesse `latitude`/`longitude`, um caller "esperto" leria coords via
 * anon/view — exatamente o vetor que a issue 005 fecha. Este teste roda o SQL
 * REAL das migrations no pglite e prova, na fonte, que a coluna não existe.
 *
 * RED hoje: a issue 001 adicionou as colunas à TABELA `lojas`; se a view tiver
 * sido (ou vier a ser) redefinida com `select *` ou incluindo coords, este SELECT
 * teria sucesso e o teste falharia — protegendo a invariante contra regressão.
 */
describe("005 vitrine_lojas — invariante de privacidade (sem coords)", () => {
  it("vitrine_lojas NÃO contém a coluna latitude (SELECT deve falhar)", async () => {
    await expect(
      t.asAnon((db) => db.query(`select latitude from public.vitrine_lojas limit 1`)),
    ).rejects.toThrow();
  });

  it("vitrine_lojas NÃO contém a coluna longitude (SELECT deve falhar)", async () => {
    await expect(
      t.asAnon((db) => db.query(`select longitude from public.vitrine_lojas limit 1`)),
    ).rejects.toThrow();
  });

  it("information_schema confirma: vitrine_lojas tem 0 colunas de coords", async () => {
    const r = await t.asService((db) =>
      db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
           where table_schema = 'public' and table_name = 'vitrine_lojas'
             and column_name in ('latitude', 'longitude')`,
      ),
    );
    expect(r.rows).toHaveLength(0);
  });
});
