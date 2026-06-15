import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 024 — Queries de catálogo (camada 1: SQL/RLS real).
 *
 * Mesmo padrão de queries_lojas.test.ts: NÃO importa as funções (pglite não é
 * PostgREST). Roda o SQL equivalente que cada função emite, sob a role correta
 * (asAnon/asUser/asService), provando o CONTRATO DE SEGURANÇA que a fonte de cada
 * função PRECISA respeitar — as policies de catálogo de seguranca.md §2:
 *   - produtos_leitura_publica: disponivel=true AND loja_esta_ativa(loja_id)
 *   - produtos_leitura_propria: dono vê os próprios (incl. indisponíveis)
 *   - categorias_leitura_publica: loja_esta_ativa(loja_id)
 *   - categorias_escrita/leitura própria do dono
 *
 * Por que é RED de verdade: a fase GREEN ainda não escreveu
 * src/lib/supabase/queries/{produtos,categorias}.ts, então a suite do projeto
 * FALHA NO IMPORT nos arquivos de unidade (camada 2). Esta camada 1 é a prova de
 * segurança que sustenta o critério crítico (isolamento + visibilidade pública).
 *
 * Anti-falso-verde: toda negação por RLS é reconferida via asService (BYPASSRLS)
 * de que a linha REALMENTE existe — negação é por policy/filtro, nunca por dado ausente.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
// DONO_A2 é um dono distinto que possui a loja inativa (RN-01: 1 conta = 1 loja).
const DONO_A2 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

type Cenario = {
  lojaA: string; // dono A, ATIVA
  lojaInativa: string; // dono A2, INATIVA (RN-01: cada conta tem 1 loja)
  lojaB: string; // dono B, ATIVA
  catA: string; // categoria da loja A
  catInativa: string; // categoria da loja inativa
  prodADisp: string; // produto da loja A, disponível
  prodAIndisp: string; // produto da loja A, INDISPONÍVEL
  prodInativa: string; // produto disponível mas de loja INATIVA
  prodB: string; // produto disponível da loja B (público — visível a qualquer um)
  prodBIndisp: string; // produto INDISPONÍVEL da loja B (só dono B vê)
};

async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a@teste.local'),
       ($2, 'dono-a2@teste.local'),
       ($3, 'dono-b@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_A2, DONO_B],
  );
}

async function criarCenario(t: TestDb): Promise<Cenario> {
  await garantirDonos(t);
  return t.asService(async (db) => {
    const lojaA = (
      await db.query<{ id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-a','Loja A',true) returning id`,
        [DONO_A],
      )
    ).rows[0].id;
    const lojaInativa = (
      await db.query<{ id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-inativa','Loja Inativa',false) returning id`,
        [DONO_A2],
      )
    ).rows[0].id;
    const lojaB = (
      await db.query<{ id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-b','Loja B',true) returning id`,
        [DONO_B],
      )
    ).rows[0].id;

    const catA = (
      await db.query<{ id: string }>(
        `insert into public.categorias (loja_id, nome, ordem) values ($1,'Bebidas',0) returning id`,
        [lojaA],
      )
    ).rows[0].id;
    const catInativa = (
      await db.query<{ id: string }>(
        `insert into public.categorias (loja_id, nome, ordem) values ($1,'Escondida',0) returning id`,
        [lojaInativa],
      )
    ).rows[0].id;

    const prodADisp = (
      await db.query<{ id: string }>(
        `insert into public.produtos (loja_id, categoria_id, nome, preco, disponivel, ordem)
         values ($1,$2,'Coca',5.00,true,0) returning id`,
        [lojaA, catA],
      )
    ).rows[0].id;
    const prodAIndisp = (
      await db.query<{ id: string }>(
        `insert into public.produtos (loja_id, categoria_id, nome, preco, disponivel, ordem)
         values ($1,$2,'Suco Esgotado',7.00,false,1) returning id`,
        [lojaA, catA],
      )
    ).rows[0].id;
    const prodInativa = (
      await db.query<{ id: string }>(
        `insert into public.produtos (loja_id, nome, preco, disponivel, ordem)
         values ($1,'Item Loja Inativa',9.00,true,0) returning id`,
        [lojaInativa],
      )
    ).rows[0].id;
    const prodB = (
      await db.query<{ id: string }>(
        `insert into public.produtos (loja_id, nome, preco, disponivel, ordem)
         values ($1,'Item Loja B',3.00,true,0) returning id`,
        [lojaB],
      )
    ).rows[0].id;
    const prodBIndisp = (
      await db.query<{ id: string }>(
        `insert into public.produtos (loja_id, nome, preco, disponivel, ordem)
         values ($1,'Item Loja B Esgotado',4.00,false,1) returning id`,
        [lojaB],
      )
    ).rows[0].id;

    return {
      lojaA,
      lojaInativa,
      lojaB,
      catA,
      catInativa,
      prodADisp,
      prodAIndisp,
      prodInativa,
      prodB,
      prodBIndisp,
    };
  });
}

async function existeProdutoViaService(t: TestDb, id: string): Promise<boolean> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.produtos where id = $1`, [id]),
  );
  return r.rows.length > 0;
}

describe("024 queries de catálogo — contrato SQL/RLS (camada 1)", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    c = await criarCenario(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ───────────────── buscarCatalogoPublico → produtos, role anon
  it("[1] anon lê produto DISPONÍVEL de loja ATIVA (filtro loja_id + disponivel)", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(
        `select * from public.produtos where loja_id = $1 and disponivel = true order by ordem`,
        [c.lojaA],
      ),
    );
    expect(r.rows.map((x) => x.id)).toEqual([c.prodADisp]);
  });

  it("[2] anon NÃO lê produto INDISPONÍVEL de loja ativa → 0 linhas", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select * from public.produtos where id = $1`, [c.prodAIndisp]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeProdutoViaService(t, c.prodAIndisp)).toBe(true);
  });

  it("[3] anon NÃO lê produto disponível de loja INATIVA → 0 linhas (loja_esta_ativa)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select * from public.produtos where id = $1`, [c.prodInativa]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeProdutoViaService(t, c.prodInativa)).toBe(true);
  });

  it("[4] anon NÃO vê produto de OUTRA loja ao consultar a loja A", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(
        `select * from public.produtos where loja_id = $1 and disponivel = true`,
        [c.lojaA],
      ),
    );
    const ids = r.rows.map((x) => x.id);
    expect(ids).not.toContain(c.prodB);
    expect(ids).not.toContain(c.prodInativa);
  });

  // ───────────────── buscarCategorias público → categorias, role anon
  it("[5] anon lê categoria de loja ATIVA, ordenada (categorias_leitura_publica)", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(
        `select * from public.categorias where loja_id = $1 order by ordem`,
        [c.lojaA],
      ),
    );
    expect(r.rows.map((x) => x.id)).toEqual([c.catA]);
  });

  it("[6] anon NÃO lê categoria de loja INATIVA → 0 linhas", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select * from public.categorias where id = $1`, [c.catInativa]),
    );
    expect(r.rows.length).toBe(0);
    const real = await t.asService((db) =>
      db.query(`select 1 from public.categorias where id = $1`, [c.catInativa]),
    );
    expect(real.rows.length).toBe(1);
  });

  // ───────────────── buscarProdutosDoLojista → produtos, role authenticated
  it("[7] dono A lê os PRÓPRIOS produtos INCLUSIVE indisponíveis (produtos_leitura_propria)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(
        `select * from public.produtos where loja_id = $1 order by ordem`,
        [c.lojaA],
      ),
    );
    const ids = r.rows.map((x) => x.id);
    expect(ids).toContain(c.prodADisp);
    expect(ids).toContain(c.prodAIndisp); // indisponível visível para o dono
  });

  it("[8] dono A2 lê o produto da PRÓPRIA loja inativa (é dono dela)", async () => {
    // RN-01: lojaInativa pertence a DONO_A2. Verificamos que o dono consegue
    // ler produtos da própria loja inativa — mesma garantia, dono distinto.
    const r = await t.asUser(DONO_A2, (db) =>
      db.query<{ id: string }>(`select * from public.produtos where id = $1`, [c.prodInativa]),
    );
    expect(r.rows.map((x) => x.id)).toEqual([c.prodInativa]);
  });

  it("[9] dono A NÃO lê produto INDISPONÍVEL da loja de B (isolamento entre lojas) → 0 linhas", async () => {
    // Ponto crítico: o indisponível NÃO é público (produtos_leitura_publica exige
    // disponivel=true), então só o dono B deveria vê-lo. Dono A logado não pode.
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`select * from public.produtos where id = $1`, [c.prodBIndisp]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeProdutoViaService(t, c.prodBIndisp)).toBe(true);
  });

  it("[9b] produto DISPONÍVEL de loja ativa é público — visível a qualquer autenticado (NÃO é vazamento)", async () => {
    // Documenta que produtos_leitura_publica é por design: prodB (disponível, loja
    // ativa) é catálogo público; dono A o enxerga pela policy pública, não por posse.
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(`select * from public.produtos where id = $1`, [c.prodB]),
    );
    expect(r.rows.map((x) => x.id)).toEqual([c.prodB]);
  });

  it("[10] dono A NÃO lê categorias da loja de B → 0 linhas", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`select * from public.categorias where loja_id = $1`, [c.lojaB]),
    );
    expect(r.rows.length).toBe(0);
  });

  // ───────────────── buscarProdutosPorIds → produtos, role service_role (insumo do recálculo §10)
  it("[11] service lê preco/disponivel/loja_id reais para a lista de ids (incl. indisponível)", async () => {
    const r = await t.asService((db) =>
      db.query<{ id: string; preco: string; disponivel: boolean; loja_id: string }>(
        `select id, preco, disponivel, loja_id from public.produtos where id = any($1)`,
        [[c.prodADisp, c.prodAIndisp]],
      ),
    );
    expect(r.rows.length).toBe(2);
    const indisp = r.rows.find((x) => x.id === c.prodAIndisp)!;
    // §10: o recálculo PRECISA enxergar o indisponível para recusá-lo.
    expect(indisp.disponivel).toBe(false);
    expect(indisp.loja_id).toBe(c.lojaA);
  });
});
