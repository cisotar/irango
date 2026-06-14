import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 025 — Queries de entrega, pagamento e cupom
 * (camada 1: SQL/RLS real).
 *
 * Esta camada NÃO importa `src/lib/supabase/queries/entregaPagamento.ts` (pglite
 * não é PostgREST/supabase-js). O que ela prova é o CONTRATO DE SEGURANÇA que
 * cada função PRECISA respeitar: roda o SQL equivalente que cada função emite,
 * sob a role correta (asAnon/asUser/asService), confirmando que a FONTE e a ROLE
 * respeitam a RLS de seguranca.md §2.
 *
 * REGRA CRÍTICA (seguranca.md §2 — cupons): NÃO há SELECT público em cupons
 * (policy `cupons_acesso_proprio` = só o dono). O cliente NUNCA lê cupom direto;
 * a validação é Server Action (013) que roda com SERVICE_ROLE. Os cenários abaixo
 * provam:
 *   - anon NÃO lê cupom (deny)                                  → buscarCupomPorCodigo NUNCA via anon
 *   - dono A lê os PRÓPRIOS cupons                              → buscar/listarCuponsDoDono
 *   - dono A NÃO lê cupom de B (isolamento)
 *   - service_role lê cupom por (loja_id, codigo)              → caminho da Server Action 013
 *   - anon LÊ zonas/taxas/bairros/formas de loja/zona ATIVA    → listarZonasComTaxas/listarFormasPagamento
 *   - anon NÃO lê zona inativa / forma de loja inativa
 *
 * As migrations de RLS já existem (000129..002500), então o SQL-contrato desta
 * camada PASSA. O RED da issue cai na CAMADA 2 (entregaPagamento.test.ts), que
 * importa o módulo de unidade ainda não implementado e falha nas asserções (stub
 * `throw 'TODO: GREEN'`). Rodadas juntas, provam o RED; esta camada é a prova de
 * segurança que sustenta o critério de aceite crítico.
 *
 * Anti-falso-verde (padrão de rls_cupons_pedidos.test.ts): toda negação por RLS é
 * reconferida via asService (BYPASSRLS) de que a linha REALMENTE existe — a
 * negação é por policy, nunca por "dado ausente".
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

type Cenario = {
  lojaA: string; // dono A, ATIVA
  lojaInativa: string; // dono A, INATIVA (config não deve vazar a anon)
  lojaB: string; // dono B, ATIVA
  cupomA: string; // cupom da loja A (PROMO10)
  cupomB: string; // cupom da loja B
  zonaAtivaA: string; // zona ATIVA da loja A
  zonaInativaA: string; // zona INATIVA da loja A (filhas não vazam a anon)
  formaA: string; // forma de pagamento da loja A
  formaInativa: string; // forma de pagamento da loja INATIVA
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
    const lojaInativa = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-inativa','Loja Inativa',false) returning id`,
      [DONO_A],
    );
    const lojaB = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-b','Loja B',true) returning id`,
      [DONO_B],
    );

    // cupons (sem SELECT público — só o dono lê)
    const cupomA = await ins(
      `insert into public.cupons (loja_id, codigo, tipo, valor) values ($1,'PROMO10','percentual',10.00) returning id`,
      [lojaA],
    );
    const cupomB = await ins(
      `insert into public.cupons (loja_id, codigo, tipo, valor) values ($1,'SECRETOB','fixo',5.00) returning id`,
      [lojaB],
    );

    // zonas (leitura pública só de ativas) + taxa + bairro
    const zonaAtivaA = await ins(
      `insert into public.zonas_entrega (loja_id, nome, tipo, ativo) values ($1,'Centro','bairro',true) returning id`,
      [lojaA],
    );
    await db.query(
      `insert into public.taxas_entrega (zona_id, taxa) values ($1, 5.00)`,
      [zonaAtivaA],
    );
    await db.query(
      `insert into public.bairros_zona (zona_id, nome) values ($1, 'Centro')`,
      [zonaAtivaA],
    );

    const zonaInativaA = await ins(
      `insert into public.zonas_entrega (loja_id, nome, tipo, ativo) values ($1,'Zona Off','bairro',false) returning id`,
      [lojaA],
    );
    await db.query(
      `insert into public.taxas_entrega (zona_id, taxa) values ($1, 9.00)`,
      [zonaInativaA],
    );

    // formas de pagamento (leitura pública só de loja ativa)
    const formaA = await ins(
      `insert into public.formas_pagamento (loja_id, tipo, config) values ($1,'pix','{"chave":"x"}') returning id`,
      [lojaA],
    );
    const formaInativa = await ins(
      `insert into public.formas_pagamento (loja_id, tipo, config) values ($1,'pix','{"chave":"secreta"}') returning id`,
      [lojaInativa],
    );

    return {
      lojaA,
      lojaInativa,
      lojaB,
      cupomA,
      cupomB,
      zonaAtivaA,
      zonaInativaA,
      formaA,
      formaInativa,
    };
  });
}

async function existeViaService(t: TestDb, rel: string, id: string): Promise<boolean> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.${rel} where id = $1`, [id]),
  );
  return r.rows.length > 0;
}

describe("025 queries entrega/pagamento/cupom — contrato SQL/RLS (camada 1)", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    c = await criarCenario(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ───────────────────────── CUPONS — sem SELECT público (CRÍTICO)
  it("[1] CRÍTICO: anon NÃO lê cupom (cupons_acesso_proprio não dá SELECT anon) → 0 linhas", async () => {
    // Mesma forma de buscarCupomPorCodigo, mas via anon: deve negar.
    const r = await t.asAnon((db) =>
      db.query(`select * from public.cupons where loja_id = $1 and codigo = $2`, [
        c.lojaA,
        "PROMO10",
      ]),
    );
    expect(r.rows.length).toBe(0); // anon nunca enxerga cupom
    // anti-falso-verde: o cupom REALMENTE existe (negação é por policy).
    expect(await existeViaService(t, "cupons", c.cupomA)).toBe(true);
  });

  it("[2] CRÍTICO: anon NÃO consegue LISTAR cupons de loja ativa (vazaria estratégia) → 0 linhas", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select * from public.cupons where loja_id = $1`, [c.lojaA]),
    );
    expect(r.rows.length).toBe(0);
  });

  it("[3] buscarCupomDoDono/listar: dono A lê os PRÓPRIOS cupons → 1 linha (PROMO10)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string; codigo: string }>(
        `select * from public.cupons where codigo = $1`,
        ["PROMO10"],
      ),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(c.cupomA);
  });

  it("[4] isolamento: dono A NÃO lê cupom da loja B → 0 linhas", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`select * from public.cupons where id = $1`, [c.cupomB]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeViaService(t, "cupons", c.cupomB)).toBe(true);
  });

  it("[5] buscarCupomPorCodigo (Server Action 013): service_role lê cupom por (loja_id, codigo) → 1 linha", async () => {
    // É o caminho legítimo de validação: SERVICE_ROLE escopado por loja + código.
    const r = await t.asService((db) =>
      db.query<{ id: string; ativo: boolean }>(
        `select * from public.cupons where loja_id = $1 and codigo = $2`,
        [c.lojaA, "PROMO10"],
      ),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(c.cupomA);
  });

  it("[6] buscarCupomPorCodigo: service_role com código de OUTRA loja não casa → 0 linhas (escopo por loja)", async () => {
    // Garante que o escopo loja_id no SQL impede usar cupom de B na loja A.
    const r = await t.asService((db) =>
      db.query(`select * from public.cupons where loja_id = $1 and codigo = $2`, [
        c.lojaA,
        "SECRETOB",
      ]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeViaService(t, "cupons", c.cupomB)).toBe(true);
  });

  // ───────────────────────── ZONAS / TAXAS / BAIRROS — leitura pública (só ativas)
  it("[7] listarZonasComTaxas: anon LÊ zona ATIVA da loja → 1 linha", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(`select * from public.zonas_entrega where loja_id = $1 and ativo = true`, [
        c.lojaA,
      ]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(c.zonaAtivaA);
  });

  it("[8] listarZonasComTaxas: anon NÃO lê zona INATIVA (zonas_leitura_publica USING ativo=true) → some", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select * from public.zonas_entrega where id = $1`, [c.zonaInativaA]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeViaService(t, "zonas_entrega", c.zonaInativaA)).toBe(true);
  });

  it("[9] listarZonasComTaxas: anon LÊ taxa da zona ATIVA (join zona→taxa) → 1 linha", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ taxa: string }>(`select * from public.taxas_entrega where zona_id = $1`, [
        c.zonaAtivaA,
      ]),
    );
    expect(r.rows.length).toBe(1);
  });

  it("[10] listarZonasComTaxas: anon NÃO lê taxa de zona INATIVA (filha filtra pela zona) → 0 linhas", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select * from public.taxas_entrega where zona_id = $1`, [c.zonaInativaA]),
    );
    expect(r.rows.length).toBe(0);
  });

  it("[11] listarZonasComTaxas: anon LÊ bairros da zona ATIVA (shape p/ calcularFrete) → 1 linha", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ nome: string }>(`select * from public.bairros_zona where zona_id = $1`, [
        c.zonaAtivaA,
      ]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].nome).toBe("Centro");
  });

  // ───────────────────────── FORMAS DE PAGAMENTO — leitura pública (só loja ativa)
  it("[12] listarFormasPagamento: anon LÊ forma de pagamento de loja ATIVA → 1 linha", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(`select * from public.formas_pagamento where loja_id = $1`, [
        c.lojaA,
      ]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(c.formaA);
  });

  it("[13] listarFormasPagamento: anon NÃO lê forma de pagamento de loja INATIVA (config Pix não vaza) → 0 linhas", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select * from public.formas_pagamento where loja_id = $1`, [c.lojaInativa]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeViaService(t, "formas_pagamento", c.formaInativa)).toBe(true);
  });
});
