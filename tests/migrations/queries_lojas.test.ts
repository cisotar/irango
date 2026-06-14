import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 023 — Queries de `lojas` (camada 1: SQL/RLS real).
 *
 * Esta camada NÃO importa `src/lib/supabase/queries/lojas.ts` (pglite não é
 * PostgREST/supabase-js — não dá pra apontar o client do supabase-js pro pglite).
 * O que ela prova é o CONTRATO DE SEGURANÇA que cada função PRECISA respeitar:
 * roda o SQL equivalente que cada função emite, sob a role correta
 * (asAnon/asUser/asService), confirmando que a FONTE (view vs tabela base) e a
 * ROLE (anon vs service_role) respeitam a RLS de seguranca.md §2 / §19.
 *
 * Por que isto é RED de verdade e não cosmético:
 *   A asserção é sobre o COMPORTAMENTO esperado da query da função (ex.:
 *   `buscarLojaPorSlug` deve ler da VIEW e nunca da base; `slugExiste` precisa
 *   ver loja inativa, o que só service_role consegue). Mas a fase GREEN ainda
 *   não escreveu `queries/lojas.ts`, então a suite do projeto FALHA NO IMPORT do
 *   arquivo de unidade (camada 2). Esta camada 1 é a prova de segurança que
 *   sustenta o critério de aceite crítico; a camada 2 é a que cai vermelha por
 *   ausência da implementação. Rodadas juntas, provam o RED.
 *
 * Anti-falso-verde (padrão de rls_lojas.test.ts): toda negação por RLS é
 * reconferida via asService (BYPASSRLS) de que a linha REALMENTE existe — a
 * negação é por policy/filtro, nunca por "dado ausente".
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
// DONO_A2 é um dono distinto que possui a loja inativa (RN-01: 1 conta = 1 loja).
const DONO_A2 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const DONO_C = "cccccccc-cccc-cccc-cccc-cccccccccccc"; // dono sem loja (RN-01 = 0)

const SLUG_A = "loja-a-ativa"; // dono A, ativa
const SLUG_A2 = "loja-a2-inativa"; // dono A2, INATIVA — só visível via base (dono) / service
const SLUG_B = "loja-b-ativa"; // dono B, ativa
const SLUG_LIVRE = "slug-que-ninguem-usa";

type Lojas = { lojaA: string; lojaA2: string; lojaB: string };

async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a@teste.local'),
       ($2, 'dono-a2@teste.local'),
       ($3, 'dono-b@teste.local'),
       ($4, 'dono-c@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_A2, DONO_B, DONO_C],
  );
}

/**
 * Cenário base via service (bypass RLS):
 *   A  ativa  (dono A),
 *   A2 inativa (dono A2 — RN-01: cada conta tem no máximo 1 loja),
 *   B  ativa  (dono B).
 */
async function criarCenario(t: TestDb): Promise<Lojas> {
  await garantirDonos(t);
  return t.asService(async (db) => {
    const a = await db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo)
       values ($1, $2, 'Loja A', true) returning id`,
      [DONO_A, SLUG_A],
    );
    const a2 = await db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo)
       values ($1, $2, 'Loja A2', false) returning id`,
      [DONO_A2, SLUG_A2],
    );
    const b = await db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo)
       values ($1, $2, 'Loja B', true) returning id`,
      [DONO_B, SLUG_B],
    );
    return { lojaA: a.rows[0].id, lojaA2: a2.rows[0].id, lojaB: b.rows[0].id };
  });
}

async function existeSlugViaService(t: TestDb, slug: string): Promise<boolean> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.lojas where slug = $1`, [slug]),
  );
  return r.rows.length > 0;
}

describe("023 queries de lojas — contrato SQL/RLS (camada 1)", () => {
  let t: TestDb;
  let ids: Lojas;

  beforeAll(async () => {
    t = await createTestDb();
    ids = await criarCenario(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ───────────────────────── buscarLojaPorSlug → VIEW vitrine_lojas, role anon
  it("[1] buscarLojaPorSlug: anon lê loja ATIVA pela view vitrine_lojas (1 linha)", async () => {
    // SQL equivalente da função: from('vitrine_lojas').select('*').eq('slug',slug).maybeSingle()
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(`select * from public.vitrine_lojas where slug = $1`, [SLUG_A]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.lojaA);
  });

  it("[2] buscarLojaPorSlug: resultado da view NÃO contém colunas sensíveis", async () => {
    // LojaPublica = Row da VIEW: dono_id/hotmart_*/consentimento_* e datas
    // internas de assinatura ausentes. EXCEÇÃO (issue 058): assinatura_status e
    // assinatura_fim_periodo SÃO expostos (estado operante, não PII/pagamento).
    const r = await t.asAnon((db) =>
      db.query<Record<string, unknown>>(`select * from public.vitrine_lojas where slug = $1`, [
        SLUG_A,
      ]),
    );
    const chaves = Object.keys(r.rows[0]);
    for (const proibida of [
      "dono_id",
      "assinatura_inicio",
      "assinatura_atualizada_em",
      "hotmart_subscriber_code",
      "hotmart_plano",
      "consentimento_em",
      "consentimento_versao",
    ]) {
      expect(chaves).not.toContain(proibida);
    }
    // colunas públicas esperadas presentes
    expect(chaves).toContain("id");
    expect(chaves).toContain("slug");
    expect(chaves).toContain("nome");
    // issue 058 — estado de assinatura exposto para checagem de disponibilidade.
    expect(chaves).toContain("assinatura_status");
    expect(chaves).toContain("assinatura_fim_periodo");
    // issue 068 — frete fora-de-zona exposto para preview no checkout.
    expect(chaves).toContain("taxa_entrega_fora_zona");
  });

  it("[3] buscarLojaPorSlug: anon NÃO vê loja INATIVA pela view → 0 linhas (null)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select * from public.vitrine_lojas where slug = $1`, [SLUG_A2]),
    );
    expect(r.rows.length).toBe(0); // maybeSingle → null
    // anti-falso-verde: a loja inativa REALMENTE existe (negação é por filtro ativo=true)
    expect(await existeSlugViaService(t, SLUG_A2)).toBe(true);
  });

  it("[4] buscarLojaPorSlug: slug inexistente → 0 linhas (null)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select * from public.vitrine_lojas where slug = $1`, [SLUG_LIVRE]),
    );
    expect(r.rows.length).toBe(0);
  });

  it("[5] buscarLojaPorSlug PRECISA da view: anon lendo a TABELA base → 0 linhas", async () => {
    // Prova por que a fonte é a view: ler a base como anon não retorna nada.
    const r = await t.asAnon((db) =>
      db.query(`select * from public.lojas where slug = $1`, [SLUG_A]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeSlugViaService(t, SLUG_A)).toBe(true);
  });

  // ───────────────────────── buscarLojaDoDono → TABELA lojas, RLS própria
  it("[6] buscarLojaDoDono: dono A lê a PRÓPRIA loja completa da tabela (com dono_id/assinatura)", async () => {
    // SQL equivalente: from('lojas').select('*').maybeSingle() sob auth.uid()=A.
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string; dono_id: string; assinatura_status: string }>(
        `select * from public.lojas where dono_id = $1`,
        [DONO_A],
      ),
    );
    // RN-01: A tem exatamente 1 loja (lojaA ativa). O ponto crítico: a linha
    // completa É visível ao dono e traz colunas sensíveis (que a view não traz).
    expect(r.rows.length).toBeGreaterThanOrEqual(1);
    const chaves = Object.keys(r.rows[0]);
    expect(chaves).toContain("dono_id");
    expect(chaves).toContain("assinatura_status");
  });

  it("[7] buscarLojaDoDono: dono A2 vê a própria loja INATIVA pela tabela (1 linha)", async () => {
    // RN-01: lojaA2 (inativa) pertence a DONO_A2. Verificamos que o dono consegue
    // ler a própria loja inativa — mesma garantia de negócio, apenas dono distinto.
    const r = await t.asUser(DONO_A2, (db) =>
      db.query<{ id: string }>(`select * from public.lojas where id = $1`, [ids.lojaA2]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.lojaA2);
  });

  it("[8] buscarLojaDoDono: dono A NÃO lê loja de B (isolamento entre lojas) → 0 linhas", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`select * from public.lojas where id = $1`, [ids.lojaB]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeSlugViaService(t, SLUG_B)).toBe(true);
  });

  it("[9] buscarLojaDoDono: dono C sem loja → 0 linhas (null)", async () => {
    const r = await t.asUser(DONO_C, (db) =>
      db.query(`select * from public.lojas where dono_id = $1`, [DONO_C]),
    );
    expect(r.rows.length).toBe(0);
  });

  // ───────────────────────── slugExiste → TABELA lojas, role service_role
  it("[10] slugExiste: service vê slug ocupado por loja ATIVA → true", async () => {
    const r = await t.asService((db) =>
      db.query(`select 1 from public.lojas where slug = $1`, [SLUG_A]),
    );
    expect(r.rows.length > 0).toBe(true);
  });

  it("[11] slugExiste (PONTO CRÍTICO): service vê slug ocupado por loja INATIVA → true", async () => {
    // É o que prova a necessidade de service_role: a loja inativa some da view,
    // então anon/authenticated diriam "slug livre" (false) e o UNIQUE estouraria.
    const r = await t.asService((db) =>
      db.query(`select 1 from public.lojas where slug = $1`, [SLUG_A2]),
    );
    expect(r.rows.length > 0).toBe(true);
  });

  it("[12] slugExiste: slug livre → false", async () => {
    const r = await t.asService((db) =>
      db.query(`select 1 from public.lojas where slug = $1`, [SLUG_LIVRE]),
    );
    expect(r.rows.length > 0).toBe(false);
  });

  it("[13] slugExiste com `exceto` = id da própria loja → false (ignora a própria)", async () => {
    // SQL equivalente: ...where slug = $1 and id <> $2 (neq quando exceto presente)
    const r = await t.asService((db) =>
      db.query(`select 1 from public.lojas where slug = $1 and id <> $2`, [SLUG_A, ids.lojaA]),
    );
    expect(r.rows.length > 0).toBe(false);
  });

  it("[14] DOCUMENTA O LIMITE: anon NÃO enxerga slug de loja inativa → diria false (por isso service_role)", async () => {
    // Mesma query de slugExiste, mas sob anon: a loja inativa não existe na base p/ anon.
    const r = await t.asAnon((db) =>
      db.query(`select 1 from public.lojas where slug = $1`, [SLUG_A2]),
    );
    expect(r.rows.length).toBe(0); // false → checagem de unicidade FURADA sem service_role
    expect(await existeSlugViaService(t, SLUG_A2)).toBe(true);
  });

  // ───────────────────────── contarLojasDoDono → TABELA lojas, role service_role
  it("[15] contarLojasDoDono: service conta 1 loja do dono A (RN-01: 1 conta = 1 loja)", async () => {
    // SQL equivalente: select count(*) from lojas where dono_id = $1 (head:true, count:exact)
    // RN-01: DONO_A tem exatamente 1 loja (lojaA ativa). A loja inativa pertence a DONO_A2.
    const r = await t.asService((db) =>
      db.query<{ n: number }>(`select count(*)::int as n from public.lojas where dono_id = $1`, [
        DONO_A,
      ]),
    );
    expect(r.rows[0].n).toBe(1);
  });

  it("[16] contarLojasDoDono: service conta 1 loja do dono B", async () => {
    const r = await t.asService((db) =>
      db.query<{ n: number }>(`select count(*)::int as n from public.lojas where dono_id = $1`, [
        DONO_B,
      ]),
    );
    expect(r.rows[0].n).toBe(1);
  });

  it("[17] contarLojasDoDono: service conta 0 para dono sem loja (RN-01 base)", async () => {
    const r = await t.asService((db) =>
      db.query<{ n: number }>(`select count(*)::int as n from public.lojas where dono_id = $1`, [
        DONO_C,
      ]),
    );
    expect(r.rows[0].n).toBe(0);
  });

  it("[18] DOCUMENTA O LIMITE: authenticated de OUTRO dono contaria 0 lojas de A (por isso service_role)", async () => {
    // Dono B logado tentando contar lojas de A vê 0 (RLS lojas_leitura_propria) →
    // RN-01 furaria sem service_role.
    const r = await t.asUser(DONO_B, (db) =>
      db.query<{ n: number }>(`select count(*)::int as n from public.lojas where dono_id = $1`, [
        DONO_A,
      ]),
    );
    expect(r.rows[0].n).toBe(0);
    // fonte de verdade: A realmente tem 1 loja (RN-01: 1 conta = 1 loja).
    const real = await t.asService((db) =>
      db.query<{ n: number }>(`select count(*)::int as n from public.lojas where dono_id = $1`, [
        DONO_A,
      ]),
    );
    expect(real.rows[0].n).toBe(1);
  });
});
