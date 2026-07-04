import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 131 — Variante de query de cupons escopada por
 * `lojaId` sob `service_role` (camada 1: SQL/RLS real). Gêmeo de
 * `queries_pedidos_por_loja.test.ts` (issue 130).
 *
 * Esta camada NÃO importa `src/lib/supabase/queries/entregaPagamento.ts` (pglite
 * não é PostgREST/supabase-js). Prova o CONTRATO DE SEGURANÇA que
 * `listarCuponsDaLoja(svc, lojaId)` PRECISA respeitar: roda o SQL equivalente sob
 * `asService` (BYPASSRLS) — EXATAMENTE onde a RLS `cupons_acesso_proprio` NÃO
 * protege. A isolação cross-tenant, neste role, vem SÓ do `.eq("loja_id", lojaId)`.
 *
 * Cupom é DADO COMERCIAL SENSÍVEL — nunca tem SELECT público (seguranca.md §2).
 * Quem cai vermelho por falta de código é a camada 2 (mock, função inexistente).
 * Esta camada 1 sustenta o critério de aceite crítico (isolamento) provando, no
 * SQL real, que:
 *   - com o escopo por loja_id, a loja A NUNCA vê o cupom de B (cases 1, 2);
 *   - SEM o escopo, sob service_role, A e B vazam juntas (case 3) — prova que o
 *     bug seria REAL e justifica a existência da função.
 *
 * Anti-falso-verde (padrão de queries_pedidos_por_loja.test.ts): toda ausência é
 * reconferida via `existeId` (a linha REALMENTE existe; a ausência é pelo
 * `.eq("loja_id")`, nunca por dado faltando).
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
// Dono exclusivo da loja vazia (131-SQL-4) — lojas(dono_id) tem UNIQUE INDEX
// (lojas_dono_unico); reusar DONO_A/DONO_B para uma 2ª loja violaria a constraint.
const DONO_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";

type Cenario = {
  lojaA: string;
  lojaB: string;
  cupomA: string; // cupom PROMO_A da loja A
  cupomB: string; // cupom PROMO_B da loja B
};

async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a@teste.local'),
       ($2, 'dono-b@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B],
  );
}

/** Cenário base via service (bypass RLS): loja A com PROMO_A, loja B com PROMO_B. */
async function criarCenario(t: TestDb): Promise<Cenario> {
  await garantirDonos(t);
  return t.asService(async (db) => {
    const ins = async (sql: string, params: unknown[]) => {
      const r = await db.query<{ id: string }>(sql, params);
      return r.rows[0].id;
    };

    const lojaA = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-a','Loja A',true) returning id`,
      [DONO_A],
    );
    const lojaB = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-b','Loja B',true) returning id`,
      [DONO_B],
    );

    const cupomA = await ins(
      `insert into public.cupons (loja_id, codigo, tipo, valor)
         values ($1,'PROMO_A','percentual',10) returning id`,
      [lojaA],
    );
    const cupomB = await ins(
      `insert into public.cupons (loja_id, codigo, tipo, valor)
         values ($1,'PROMO_B','fixo',5) returning id`,
      [lojaB],
    );

    return { lojaA, lojaB, cupomA, cupomB };
  });
}

async function existeId(t: TestDb, tabela: string, id: string): Promise<boolean> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.${tabela} where id = $1`, [id]),
  );
  return r.rows.length > 0;
}

describe("131 listarCuponsDaLoja escopada por lojaId — contrato SQL sob service_role (camada 1)", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    c = await criarCenario(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ───────────────────────── isolamento (crítico)
  it("[131-SQL-1] ISOLAMENTO (crítico): service com WHERE loja_id = lojaA traz SÓ o cupom de A — o cupom de B NUNCA aparece", async () => {
    // SQL equivalente: from('cupons').select('*').eq('loja_id', lojaA)
    const r = await t.asService((db) =>
      db.query<{ id: string }>(`select id from public.cupons where loja_id = $1`, [c.lojaA]),
    );
    const ids = r.rows.map((x) => x.id);
    expect(ids).toContain(c.cupomA);
    expect(ids).not.toContain(c.cupomB);
    // anti-falso-verde: o cupom de B REALMENTE existe; a ausência é pelo .eq('loja_id')
    expect(await existeId(t, "cupons", c.cupomB)).toBe(true);
  });

  it("[131-SQL-2] PARIDADE: a loja A vê EXATAMENTE seu(s) cupom(ns), nem a mais nem a menos", async () => {
    const r = await t.asService((db) =>
      db.query<{ id: string }>(`select id from public.cupons where loja_id = $1`, [c.lojaA]),
    );
    expect(r.rows.map((x) => x.id)).toEqual([c.cupomA]);
  });

  // ───────────────────────── mesmo código em lojas diferentes (UNIQUE é por loja, não global)
  it("[131-SQL-5] cupons com o MESMO código em lojas DIFERENTES (UNIQUE(loja_id, codigo), não global) — o isolamento por loja_id segura mesmo com código coincidente", async () => {
    // `unique (loja_id, codigo)` (schema_inicial) é composta, NÃO global: duas
    // lojas podem ter, ao mesmo tempo, um cupom com o MESMO código (ex.: as duas
    // rodam uma campanha "BLACKFRIDAY"). Se o isolamento desta query dependesse,
    // por acidente, do código em vez do loja_id, este cenário vazaria o cupom da
    // loja errada. Os cenários anteriores (PROMO_A/PROMO_B) usam códigos
    // DIFERENTES e não pegariam esse bug — este teste cobre exatamente a lacuna.
    const { cupomAMesmo, cupomBMesmo } = await t.asService(async (db) => {
      const ins = async (sql: string, params: unknown[]) => {
        const r = await db.query<{ id: string }>(sql, params);
        return r.rows[0].id;
      };
      const cupomAMesmo = await ins(
        `insert into public.cupons (loja_id, codigo, tipo, valor)
           values ($1,'MESMO','percentual',15) returning id`,
        [c.lojaA],
      );
      const cupomBMesmo = await ins(
        `insert into public.cupons (loja_id, codigo, tipo, valor)
           values ($1,'MESMO','fixo',7) returning id`,
        [c.lojaB],
      );
      return { cupomAMesmo, cupomBMesmo };
    });

    const r = await t.asService((db) =>
      db.query<{ id: string }>(`select id from public.cupons where loja_id = $1`, [c.lojaA]),
    );
    const ids = r.rows.map((x) => x.id);
    expect(ids).toContain(cupomAMesmo);
    expect(ids).not.toContain(cupomBMesmo);
    // anti-falso-verde: o cupom "MESMO" de B REALMENTE existe (a constraint composta
    // permitiu o mesmo código em lojas diferentes) — a ausência acima é pelo
    // loja_id, não porque o insert de B falhou ou o código colidiu globalmente.
    expect(await existeId(t, "cupons", cupomBMesmo)).toBe(true);
  });

  // ───────────────────────── contraste: prova que o bug seria REAL
  it("[131-SQL-3] CONTRASTE (prova que o bug é real): SEM .eq('loja_id'), service lê A E B (≥2 linhas) — sob service_role a isolação depende SÓ do .eq", async () => {
    // Comportamento perigoso que a função existe para PREVENIR: sob service_role
    // (BYPASSRLS) um select amplo em `cupons` enxerga TODAS as lojas — vazamento
    // de estratégia comercial cross-tenant.
    const r = await t.asService((db) =>
      db.query<{ id: string }>(`select id from public.cupons`),
    );
    const ids = r.rows.map((x) => x.id);
    expect(ids).toContain(c.cupomA);
    expect(ids).toContain(c.cupomB); // ← o vazamento que o .eq('loja_id') impede
    expect(r.rows.length).toBeGreaterThanOrEqual(2);
  });

  // ───────────────────────── lista vazia (borda)
  it("[131-SQL-4] loja sem NENHUM cupom → 0 linhas (lista vazia, nunca erro nem cupom de outra loja)", async () => {
    // auth.users só tem GRANT SELECT para service_role (bootstrap do harness) —
    // o insert do dono precisa do client superuser (t.db), igual a garantirDonos.
    await t.db.query(
      `insert into auth.users (id, email) values ($1, 'dono-c@teste.local')
         on conflict (id) do nothing`,
      [DONO_C],
    );
    const lojaVazia = await t.asService(async (db) => {
      const r = await db.query<{ id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo)
           values ($1,'loja-vazia','Loja Vazia',true) returning id`,
        [DONO_C],
      );
      return r.rows[0].id;
    });
    const r = await t.asService((db) =>
      db.query<{ id: string }>(`select id from public.cupons where loja_id = $1`, [lojaVazia]),
    );
    expect(r.rows).toEqual([]);
    // anti-falso-verde: a loja recém-criada existe de fato (a lista vazia é por
    // ausência real de cupons, não porque a loja não foi persistida)
    expect(await existeId(t, "lojas", lojaVazia)).toBe(true);
  });
});
