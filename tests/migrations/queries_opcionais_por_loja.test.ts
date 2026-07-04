import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 132 — variante ESCOPADA POR LOJA de opcionais por
 * categoria, sob `service_role` (camada 1: SQL real). Mesmo padrão de
 * queries_opcionais.test.ts (081): NÃO importa a função (pglite ≠ PostgREST).
 * Roda o SQL equivalente que `buscarOpcionaisPorCategoriaDaLoja(svc, lojaId, ...)`
 * PRECISA emitir — o JOIN
 *   categoria_produto_opcionais → opcionais_categorias → opcionais
 * sob a role `service_role` (BYPASSRLS), onde a RLS pública da 080 NÃO se aplica.
 *
 * O ponto crítico desta issue: sob `service_role` a segurança da 081 (que era
 * 100% da RLS anon) DESAPARECE. A isolação cross-tenant passa a depender
 * EXCLUSIVAMENTE do `.eq("loja_id", lojaId)` explícito na query. Estes testes
 * provam:
 *   [5] categoria de opcional de B nunca vem no filtro por lojaA;
 *   [6] opcional de B (ativo ou inativo) nunca vem no filtro por lojaA;
 *   [7] o JOIN filtrado por `cpo.loja_id = lojaA` nunca traz associação/grupo/
 *       opcional de B;
 *   [8] CONTRASTE — o MESMO JOIN SEM `.eq("loja_id")`, recebendo na lista de
 *       categoriaIds um id de B (contaminação por bug/malícia na derivação),
 *       VAZA o opcional de B. Prova que o bug é real e que o `.eq("loja_id")` é
 *       o único enforcement sob service_role.
 *
 * Anti-falso-verde: cada ausência é reconferida via asService (BYPASSRLS) de que
 * a linha de B REALMENTE existe — a omissão é pelo filtro de loja, nunca por dado
 * ausente.
 *
 * Nota sobre a FK composta: `categoria_produto_opcionais (categoria_id, loja_id)`
 * referencia `categorias (id, loja_id)` — o banco impede uma associação onde
 * `categoria_id` seja de A e `loja_id` seja de B (cross-loja no nível do banco).
 * Por isso o CONTRASTE [8] injeta a contaminação por onde a variante NÃO valida
 * o banco: a própria LISTA `categoriaIds` recebida (mistura id de A + id de B).
 * É exatamente o vetor que o `.eq("loja_id")` neutraliza.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

type Cenario = {
  lojaA: string;
  lojaB: string;
  // loja A
  catProdA: string; // categoria de PRODUTO da loja A
  opcCatA: string; // categoria de OPCIONAL da loja A (Laticínios)
  opcA1: string; // opcional ativo de A (Brie)
  opcA2Inativo: string; // opcional INATIVO de A (paridade: dono vê inativo)
  // loja B
  catProdB: string; // categoria de PRODUTO da loja B
  opcCatB: string; // categoria de OPCIONAL da loja B (Embalagens)
  opcB: string; // opcional de B (Caixa presente)
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
    const lojaB = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-b','Loja B',true) returning id`,
      [DONO_B],
    );

    // ── loja A
    const catProdA = await ins(
      `insert into public.categorias (loja_id, nome) values ($1,'Pães') returning id`,
      [lojaA],
    );
    const opcCatA = await ins(
      `insert into public.opcionais_categorias (loja_id, nome, ordem) values ($1,'Laticínios',0) returning id`,
      [lojaA],
    );
    const opcA1 = await ins(
      `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco, ativo, ordem)
         values ($1,$2,'Brie extra',8.00,true,0) returning id`,
      [lojaA, opcCatA],
    );
    const opcA2Inativo = await ins(
      `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco, ativo, ordem)
         values ($1,$2,'Geleia (off)',6.00,false,1) returning id`,
      [lojaA, opcCatA],
    );
    await ins(
      `insert into public.categoria_produto_opcionais (loja_id, categoria_id, categoria_opcional_id)
         values ($1,$2,$3) returning id`,
      [lojaA, catProdA, opcCatA],
    );

    // ── loja B (biblioteca própria; NUNCA deve vazar para A)
    const catProdB = await ins(
      `insert into public.categorias (loja_id, nome) values ($1,'Salgados') returning id`,
      [lojaB],
    );
    const opcCatB = await ins(
      `insert into public.opcionais_categorias (loja_id, nome, ordem) values ($1,'Embalagens',0) returning id`,
      [lojaB],
    );
    const opcB = await ins(
      `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco, ativo, ordem)
         values ($1,$2,'Caixa presente',3.00,true,0) returning id`,
      [lojaB, opcCatB],
    );
    await ins(
      `insert into public.categoria_produto_opcionais (loja_id, categoria_id, categoria_opcional_id)
         values ($1,$2,$3) returning id`,
      [lojaB, catProdB, opcCatB],
    );

    return { lojaA, lojaB, catProdA, opcCatA, opcA1, opcA2Inativo, catProdB, opcCatB, opcB };
  });
}

async function existeId(t: TestDb, tabela: string, id: string): Promise<boolean> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.${tabela} where id = $1`, [id]),
  );
  return r.rows.length > 0;
}

/**
 * JOIN escopado, sob service_role, espelhando o que a variante
 * `buscarOpcionaisPorCategoriaDaLoja` PRECISA emitir:
 *   .from("categoria_produto_opcionais")
 *   .eq("loja_id", lojaId)       ← enforcement (quando escoparPorLoja = true)
 *   .in("categoria_id", categoriaIds)
 * Retorna uma linha por opcional alcançado.
 */
async function lerOpcionaisEscopado(
  t: TestDb,
  lojaId: string | null, // null = SEM `.eq("loja_id")` (cenário de contraste / bug)
  categoriaIds: string[],
) {
  return t.asService((db) =>
    db.query<{ opcional_id: string; loja_opcional: string; categoria_opcional_id: string }>(
      `select o.id     as opcional_id,
              o.loja_id as loja_opcional,
              oc.id     as categoria_opcional_id
         from public.categoria_produto_opcionais cpo
         join public.opcionais_categorias oc on oc.id = cpo.categoria_opcional_id
         join public.opcionais o on o.categoria_opcional_id = oc.id
        where cpo.categoria_id = any($1)
          and ($2::uuid is null or cpo.loja_id = $2)
        order by oc.ordem asc, o.ordem asc`,
      [categoriaIds, lojaId],
    ),
  );
}

describe("132 variante escopada de opcionais por loja — isolamento cross-tenant sob service_role (camada 1)", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    c = await criarCenario(t);
  });
  afterAll(async () => {
    await t.close();
  });

  it("[5] categoria de opcional: `WHERE loja_id = lojaA` não traz nenhuma categoria de opcional de B (mas B existe via service)", async () => {
    const r = await t.asService((db) =>
      db.query<{ id: string }>(
        `select id from public.opcionais_categorias where loja_id = $1`,
        [c.lojaA],
      ),
    );
    const ids = r.rows.map((x) => x.id);
    expect(ids).toContain(c.opcCatA);
    expect(ids).not.toContain(c.opcCatB);
    // anti-falso-verde: a categoria de opcional de B REALMENTE existe.
    expect(await existeId(t, "opcionais_categorias", c.opcCatB)).toBe(true);
  });

  it("[6] opcional: `WHERE loja_id = lojaA` nunca traz opcional de B (nem ativo nem inativo); B existe via service", async () => {
    const r = await t.asService((db) =>
      db.query<{ id: string }>(`select id from public.opcionais where loja_id = $1`, [c.lojaA]),
    );
    const ids = r.rows.map((x) => x.id);
    expect(ids).toContain(c.opcA1);
    expect(ids).toContain(c.opcA2Inativo); // paridade: dono vê inativo (sem filtro `ativo`)
    expect(ids).not.toContain(c.opcB);
    // anti-falso-verde: o opcional de B REALMENTE existe.
    expect(await existeId(t, "opcionais", c.opcB)).toBe(true);
  });

  it("[7] JOIN com `cpo.loja_id = lojaA` nunca traz associação/grupo/opcional de B; associação de B existe via service", async () => {
    const r = await lerOpcionaisEscopado(t, c.lojaA, [c.catProdA]);
    const ids = r.rows.map((x) => x.opcional_id);
    expect(ids).toContain(c.opcA1);
    expect(ids).not.toContain(c.opcB);
    // nenhuma linha retornada pertence a outra loja
    expect(r.rows.every((x) => x.loja_opcional === c.lojaA)).toBe(true);
    // anti-falso-verde: a associação de B REALMENTE existe.
    const assocB = await t.asService((db) =>
      db.query(
        `select 1 from public.categoria_produto_opcionais where loja_id = $1 and categoria_id = $2`,
        [c.lojaB, c.catProdB],
      ),
    );
    expect(assocB.rows.length).toBe(1);
  });

  it("[8] CONTRASTE: MESMO JOIN SEM `.eq(loja_id)`, com categoriaIds contendo um id de B, VAZA o opcional de B (prova que o bug é real)", async () => {
    // Vetor: a lista `categoriaIds` chega contaminada com uma categoria de B.
    // A FK composta impede associação cross-loja no banco, então a contaminação
    // entra pela ÚNICA porta que a query não valida contra o banco: a lista.
    const categoriaIdsContaminada = [c.catProdA, c.catProdB];

    // SEM enforcement de loja (lojaId = null) → o opcional de B VAZA.
    const semFiltro = await lerOpcionaisEscopado(t, null, categoriaIdsContaminada);
    expect(semFiltro.rows.map((x) => x.opcional_id)).toContain(c.opcB);

    // COM `.eq("loja_id", lojaA)` → mesmo com a lista contaminada, B NÃO vaza.
    const comFiltro = await lerOpcionaisEscopado(t, c.lojaA, categoriaIdsContaminada);
    expect(comFiltro.rows.map((x) => x.opcional_id)).not.toContain(c.opcB);
    expect(comFiltro.rows.map((x) => x.opcional_id)).toContain(c.opcA1);
  });

  it("[8b] CONTRASTE direto: `SELECT * FROM opcionais` sem filtro de loja traz A E B sob service_role (RLS não protege)", async () => {
    const r = await t.asService((db) =>
      db.query<{ id: string }>(`select id from public.opcionais`),
    );
    const ids = r.rows.map((x) => x.id);
    // service_role bypassa a RLS pública → sem `.eq("loja_id")` ambas as lojas aparecem.
    expect(ids).toContain(c.opcA1);
    expect(ids).toContain(c.opcB);
  });
});
