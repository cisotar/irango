import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Issue 325 (escrito na fase RED do TDD) — forma de frete ATIVA como coluna, com as zonas
 * das três formas guardadas lado a lado. Prova de BANCO (pglite) de:
 *
 *   F1. `lojas.forma_frete text not null default 'raio_km'
 *        check (forma_frete in ('raio_km','faixa_cep','bairro'))` + backfill
 *       por loja (D1/D2);
 *   F5. `salvar_faixas_entrega(uuid, integer, jsonb)` (legado) passa a marcar
 *       `forma_frete = 'raio_km'` (D4).
 *
 * Migration: supabase/migrations/20261018130000_lojas_forma_frete_ativa.sql
 *
 * BACKFILL — escolha do harness: `createTestDb({ antesDaMigration })` aplica as
 * migrations até a 20261018130000 (exclusive), roda `semear` como postgres e
 * só então aplica a 20261018130000 e as seguintes. É o estado do cloud no
 * momento do `db push`: zonas já gravadas, coluna ainda inexistente. Sem a
 * migration, o próprio `createTestDb` lança (nunca verde por vácuo). Rodar o
 * bloco de backfill "à mão" num banco já migrado foi descartado: testaria uma
 * cópia do SQL, não o arquivo que vai ao cloud.
 *
 * Regra do backfill (D2), por loja, contando só zonas `ativo = true` COM linha
 * em `taxas_entrega`:
 *   - 1 tipo        → esse tipo;
 *   - 0 tipos       → o tipo único entre TODAS as zonas da loja, senão raio_km;
 *   - ≥ 2 tipos     → raio_km (mista).
 */

const MIGRATION = "20261018130000";

type Forma = "raio_km" | "faixa_cep" | "bairro";
type ZonaSemente = { tipo: Forma; ativo: boolean; comTaxa?: boolean };

/** Uma loja por cenário de backfill (`lojas_dono_unico`: um dono por loja). */
const CENARIOS: Array<{ slug: string; nome: string; zonas: ZonaSemente[]; esperado: Forma }> = [
  { slug: "bf-so-km", nome: "backfill: só km → raio_km", zonas: [{ tipo: "raio_km", ativo: true }, { tipo: "raio_km", ativo: true }], esperado: "raio_km" },
  { slug: "bf-so-bairro", nome: "só bairro → bairro", zonas: [{ tipo: "bairro", ativo: true }], esperado: "bairro" },
  { slug: "bf-so-cep", nome: "só cep → faixa_cep", zonas: [{ tipo: "faixa_cep", ativo: true }, { tipo: "faixa_cep", ativo: true }], esperado: "faixa_cep" },
  { slug: "bf-sem-zona", nome: "sem zona → raio_km", zonas: [], esperado: "raio_km" },
  {
    slug: "bf-bairro-ativo-km-inativo",
    nome: "bairro ativo + km inativo → bairro",
    zonas: [{ tipo: "bairro", ativo: true }, { tipo: "raio_km", ativo: false }],
    esperado: "bairro",
  },
  {
    slug: "bf-mista-ativa",
    nome: "mista ativa → raio_km",
    zonas: [{ tipo: "bairro", ativo: true }, { tipo: "raio_km", ativo: true }],
    esperado: "raio_km",
  },
  // Bordas de D2 que o Pedido não nomeou mas a regra decide:
  {
    slug: "bf-so-bairro-inativo",
    nome: "0 ativas, só bairro inativo → bairro (tipo único entre todas)",
    zonas: [{ tipo: "bairro", ativo: false }],
    esperado: "bairro",
  },
  {
    slug: "bf-inativas-mistas",
    nome: "0 ativas, cep e bairro inativos → raio_km",
    zonas: [{ tipo: "faixa_cep", ativo: false }, { tipo: "bairro", ativo: false }],
    esperado: "raio_km",
  },
  {
    slug: "bf-km-ativo-sem-taxa",
    nome: "km ativo SEM taxa não conta; cep ativo com taxa → faixa_cep",
    zonas: [{ tipo: "raio_km", ativo: true, comTaxa: false }, { tipo: "faixa_cep", ativo: true }],
    esperado: "faixa_cep",
  },
];

const donoDe = (i: number) => `f0f0f0f0-0000-4000-8000-${String(325000 + i).padStart(12, "0")}`;

async function semearCenarios(db: PGlite) {
  for (const [i, c] of CENARIOS.entries()) {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [donoDe(i), `${c.slug}@teste.local`]);
    const loja = await db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1, $2, $3, true) returning id`,
      [donoDe(i), c.slug, c.slug],
    );
    const lojaId = loja.rows[0].id;
    for (const [j, z] of c.zonas.entries()) {
      const zr = await db.query<{ id: string }>(
        `insert into public.zonas_entrega (loja_id, nome, tipo, ativo) values ($1, $2, $3, $4) returning id`,
        [lojaId, `${z.tipo} ${j}`, z.tipo, z.ativo],
      );
      if (z.comTaxa === false) continue;
      const zonaId = zr.rows[0].id;
      if (z.tipo === "raio_km") {
        await db.query(`insert into public.taxas_entrega (zona_id, taxa, raio_max_km) values ($1, 5, $2)`, [zonaId, j + 1]);
      } else if (z.tipo === "faixa_cep") {
        const ini = 1000000 + j * 100000;
        await db.query(
          `insert into public.taxas_entrega (zona_id, taxa, cep_inicio, cep_fim) values ($1, 5, $2, $3)`,
          [zonaId, ini, ini + 99999],
        );
      } else {
        await db.query(`insert into public.taxas_entrega (zona_id, taxa) values ($1, 5)`, [zonaId]);
        await db.query(`insert into public.bairros_zona (zona_id, nome) values ($1, $2)`, [zonaId, `Bairro ${j}`]);
      }
    }
  }
}

type ErroPg = { code?: string; message?: string };
async function erroDe(p: Promise<unknown>): Promise<ErroPg | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as ErroPg;
  }
}
function esperarErro(e: ErroPg | null, code: string, fragmento: string) {
  expect(e, `esperava ${code} "${fragmento}", mas não lançou`).not.toBeNull();
  expect(e?.code, `mensagem recebida: ${e?.message}`).toBe(code);
  expect(e?.message).toContain(fragmento);
}

// ═══════════════════════════════════════════════════════════ F1 · backfill
describe("[325/F1] backfill de lojas.forma_frete a partir das zonas gravadas", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb({ antesDaMigration: { migration: MIGRATION, semear: semearCenarios } });
  }, 60_000);
  afterAll(async () => {
    await t?.close();
  });

  it.each(CENARIOS.map((c) => [c.nome, c.slug, c.esperado] as const))("%s", async (_nome, slug, esperado) => {
    const r = await t.asService((s) =>
      s.query<{ forma_frete: string }>(`select forma_frete from public.lojas where slug = $1`, [slug]),
    );
    expect(r.rows).toEqual([{ forma_frete: esperado }]);
  });

  it("backfill não apaga nem desliga zona nenhuma (as das outras formas ficam guardadas)", async () => {
    const r = await t.asService((s) =>
      s.query<{ slug: string; n: number; ativas: number }>(
        `select l.slug, count(z.id)::int as n, count(z.id) filter (where z.ativo)::int as ativas
           from public.lojas l left join public.zonas_entrega z on z.loja_id = l.id
          group by l.slug order by l.slug`,
      ),
    );
    const esperado = CENARIOS.map((c) => ({
      slug: c.slug,
      n: c.zonas.length,
      ativas: c.zonas.filter((z) => z.ativo).length,
    })).sort((a, b) => a.slug.localeCompare(b.slug));
    expect(r.rows).toEqual(esperado);
  });
});

// ═══════════════════════════════════════ F1 · coluna  ·  F5 · RPC legada
describe("[325/F1·F5] coluna forma_frete e salvar_faixas_entrega (legado)", () => {
  let t: TestDb;
  const DONO = "f1f1f1f1-0000-4000-8000-000000325001";
  let lojaId: string;

  beforeAll(async () => {
    t = await createTestDb();
    await t.db.query(`insert into auth.users (id, email) values ($1, 'dono-forma-325@teste.local')`, [DONO]);
    const r = await t.asService((s) =>
      s.query<{ id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo) values ($1, 'loja-forma-325', 'Loja forma 325', true) returning id`,
        [DONO],
      ),
    );
    lojaId = r.rows[0].id;
  }, 60_000);
  afterAll(async () => {
    await t?.close();
  });

  it("coluna: text not null default 'raio_km'; loja nova nasce raio_km", async () => {
    const col = await t.db.query<{ data_type: string; is_nullable: string; column_default: string | null }>(
      `select data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'lojas' and column_name = 'forma_frete'`,
    );
    expect(col.rows).toHaveLength(1);
    expect(col.rows[0].data_type).toBe("text");
    expect(col.rows[0].is_nullable).toBe("NO");
    expect(col.rows[0].column_default).toContain("'raio_km'");

    const r = await t.asService((s) =>
      s.query<{ forma_frete: string }>(`select forma_frete from public.lojas where id = $1`, [lojaId]),
    );
    expect(r.rows[0].forma_frete).toBe("raio_km");
  });

  it("CHECK aceita as três formas e recusa forma fora do enum (23514 nomeando forma_frete)", async () => {
    for (const forma of ["faixa_cep", "bairro", "raio_km"]) {
      await t.asService((s) => s.query(`update public.lojas set forma_frete = $2 where id = $1`, [lojaId, forma]));
    }
    esperarErro(
      await erroDe(t.asService((s) => s.query(`update public.lojas set forma_frete = 'cidade' where id = $1`, [lojaId]))),
      "23514",
      "forma_frete",
    );
    esperarErro(
      await erroDe(t.asService((s) => s.query(`update public.lojas set forma_frete = null where id = $1`, [lojaId]))),
      "23502",
      "forma_frete",
    );
  });

  it("salvar_faixas_entrega em loja bairro → forma_frete = raio_km", async () => {
    await t.asService((s) => s.query(`update public.lojas set forma_frete = 'bairro' where id = $1`, [lojaId]));

    await t.asUser(DONO, (s) =>
      s.query(`select public.salvar_faixas_entrega($1::uuid, 1, $2::jsonb)`, [
        lojaId,
        JSON.stringify([{ taxa: 4, pedido_minimo_gratis: null, ativo: true }]),
      ]),
    );

    const r = await t.asService((s) =>
      s.query<{ forma_frete: string }>(`select forma_frete from public.lojas where id = $1`, [lojaId]),
    );
    expect(r.rows[0].forma_frete).toBe("raio_km");
  });

  it("salvar_faixas_entrega recusada (sem posse) não muda forma_frete da loja alheia", async () => {
    const OUTRO = "f1f1f1f1-0000-4000-8000-000000325002";
    await t.db.query(`insert into auth.users (id, email) values ($1, 'outro-forma-325@teste.local')`, [OUTRO]);
    await t.asService((s) => s.query(`update public.lojas set forma_frete = 'bairro' where id = $1`, [lojaId]));

    esperarErro(
      await erroDe(
        t.asUser(OUTRO, (s) =>
          s.query(`select public.salvar_faixas_entrega($1::uuid, 1, '[]'::jsonb)`, [lojaId]),
        ),
      ),
      "P0001",
      "salvar_faixas_entrega: sem posse",
    );
    const r = await t.asService((s) =>
      s.query<{ forma_frete: string }>(`select forma_frete from public.lojas where id = $1`, [lojaId]),
    );
    expect(r.rows[0].forma_frete).toBe("bairro");
  });
});
