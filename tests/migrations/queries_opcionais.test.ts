import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 081 — Query pública de OPCIONAIS por produto/categoria
 * (camada 1: SQL/RLS real). Mesmo padrão de queries_catalogo.test.ts: NÃO importa
 * a função (pglite não é PostgREST). Roda o SQL equivalente que a função
 * `buscarOpcionaisPorCategoria` PRECISA emitir — o JOIN
 *   categoria_produto_opcionais → opcionais_categorias → opcionais
 * sob a role anon (vitrine pública), provando que a SEGURANÇA da leitura é 100%
 * delegada à RLS da 080:
 *   - opcionais_leitura_publica: ativo = true AND loja_esta_ativa(loja_id)
 *   - opc_cat_leitura_publica / cat_prod_opc_leitura_publica: loja_esta_ativa
 *
 * Critério de aceite (issue 081):
 *   - produto da categoria X retorna só opcionais das categorias de opcional
 *     associadas a X;
 *   - opcional ativo=false NÃO aparece (RLS pública);
 *   - opcional de loja INATIVA NÃO aparece (RLS pública);
 *   - produto sem categoria_id → lista vazia;
 *   - grupos e itens ordenados por `ordem`.
 *
 * Anti-falso-verde: toda ausência por RLS é reconferida via asService (BYPASSRLS)
 * de que a linha REALMENTE existe — a omissão é por policy, nunca por dado ausente.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_OFF = "ffffffff-ffff-ffff-ffff-ffffffffffff";

type Cenario = {
  lojaA: string; // dono A, ATIVA
  lojaOff: string; // INATIVA
  catProdA: string; // categoria de PRODUTO (Pães) da loja A
  catProdSemOpc: string; // categoria de PRODUTO da loja A SEM associação
  // categorias de OPCIONAL da loja A (ordem: Doces=0, Laticínios=1)
  opcCatDoces: string;
  opcCatLaticinios: string;
  // categoria de OPCIONAL NÃO associada a catProdA (não deve aparecer)
  opcCatNaoAssoc: string;
  // categoria de OPCIONAL da loja INATIVA
  opcCatOff: string;
  // opcionais de Laticínios (ordem: Brie=0, Catupiry=1) — ativos
  opcBrie: string;
  opcCatupiry: string;
  // opcional INATIVO de Laticínios
  opcInativo: string;
  // opcional de Doces (ativo)
  opcDoce: string;
  // opcional da categoria não associada (ativo, mas não permitido p/ catProdA)
  opcNaoAssoc: string;
  // opcional da loja INATIVA (ativo, mas loja off)
  opcOff: string;
};

async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a@teste.local'),
       ($2, 'dono-off@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_OFF],
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
    const lojaOff = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-off','Loja Off',false) returning id`,
      [DONO_OFF],
    );

    // categorias de PRODUTO
    const catProdA = await ins(
      `insert into public.categorias (loja_id, nome) values ($1,'Pães') returning id`,
      [lojaA],
    );
    const catProdSemOpc = await ins(
      `insert into public.categorias (loja_id, nome) values ($1,'Bebidas') returning id`,
      [lojaA],
    );

    // categorias de OPCIONAL da loja A (ordem importa: Doces=0 vem antes de Laticínios=1)
    const opcCatDoces = await ins(
      `insert into public.opcionais_categorias (loja_id, nome, ordem) values ($1,'Doces',0) returning id`,
      [lojaA],
    );
    const opcCatLaticinios = await ins(
      `insert into public.opcionais_categorias (loja_id, nome, ordem) values ($1,'Laticínios',1) returning id`,
      [lojaA],
    );
    const opcCatNaoAssoc = await ins(
      `insert into public.opcionais_categorias (loja_id, nome, ordem) values ($1,'Charcutaria',2) returning id`,
      [lojaA],
    );
    const opcCatOff = await ins(
      `insert into public.opcionais_categorias (loja_id, nome, ordem) values ($1,'Embalagens',0) returning id`,
      [lojaOff],
    );

    // opcionais de Laticínios: Brie (ordem 0), Catupiry (ordem 1), Inativo
    const opcBrie = await ins(
      `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco, ativo, ordem)
         values ($1,$2,'Brie extra',8.00,true,0) returning id`,
      [lojaA, opcCatLaticinios],
    );
    const opcCatupiry = await ins(
      `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco, ativo, ordem)
         values ($1,$2,'Catupiry',5.00,true,1) returning id`,
      [lojaA, opcCatLaticinios],
    );
    const opcInativo = await ins(
      `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco, ativo, ordem)
         values ($1,$2,'Geleia (off)',6.00,false,2) returning id`,
      [lojaA, opcCatLaticinios],
    );
    // opcional de Doces
    const opcDoce = await ins(
      `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco, ativo, ordem)
         values ($1,$2,'Doce de leite',4.00,true,0) returning id`,
      [lojaA, opcCatDoces],
    );
    // opcional da categoria NÃO associada a catProdA
    const opcNaoAssoc = await ins(
      `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco, ativo, ordem)
         values ($1,$2,'Presunto',7.00,true,0) returning id`,
      [lojaA, opcCatNaoAssoc],
    );
    // opcional da loja INATIVA
    const opcOff = await ins(
      `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco, ativo, ordem)
         values ($1,$2,'Caixa presente',3.00,true,0) returning id`,
      [lojaOff, opcCatOff],
    );

    // ASSOCIAÇÕES: catProdA ⋈ {Laticínios, Doces}. catProdSemOpc fica sem associação.
    await ins(
      `insert into public.categoria_produto_opcionais (loja_id, categoria_id, categoria_opcional_id)
         values ($1,$2,$3) returning id`,
      [lojaA, catProdA, opcCatLaticinios],
    );
    await ins(
      `insert into public.categoria_produto_opcionais (loja_id, categoria_id, categoria_opcional_id)
         values ($1,$2,$3) returning id`,
      [lojaA, catProdA, opcCatDoces],
    );

    return {
      lojaA,
      lojaOff,
      catProdA,
      catProdSemOpc,
      opcCatDoces,
      opcCatLaticinios,
      opcCatNaoAssoc,
      opcCatOff,
      opcBrie,
      opcCatupiry,
      opcInativo,
      opcDoce,
      opcNaoAssoc,
      opcOff,
    };
  });
}

async function existeId(t: TestDb, tabela: string, id: string): Promise<boolean> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.${tabela} where id = $1`, [id]),
  );
  return r.rows.length > 0;
}

/**
 * Espelha o JOIN que `buscarOpcionaisPorCategoria` emite via PostgREST, mas em SQL
 * plano, sob a role anon — para provar que a RLS sozinha entrega o conjunto certo.
 * Retorna uma linha por opcional visível, com a categoria de opcional e a ordem.
 */
async function lerOpcionaisDaCategoria(t: TestDb, categoriaId: string) {
  return t.asAnon((db) =>
    db.query<{
      categoria_opcional_id: string;
      categoria_opcional_nome: string;
      categoria_opcional_ordem: number;
      opcional_id: string;
      opcional_nome: string;
      opcional_ordem: number;
    }>(
      `select oc.id   as categoria_opcional_id,
              oc.nome as categoria_opcional_nome,
              oc.ordem as categoria_opcional_ordem,
              o.id    as opcional_id,
              o.nome  as opcional_nome,
              o.ordem as opcional_ordem
         from public.categoria_produto_opcionais cpo
         join public.opcionais_categorias oc on oc.id = cpo.categoria_opcional_id
         join public.opcionais o on o.categoria_opcional_id = oc.id
        where cpo.categoria_id = $1
        order by oc.ordem asc, o.ordem asc`,
      [categoriaId],
    ),
  );
}

describe("081 query pública de opcionais por produto/categoria — contrato SQL/RLS (camada 1)", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    c = await criarCenario(t);
  });
  afterAll(async () => {
    await t.close();
  });

  it("[1] anon vê só os opcionais das categorias de opcional associadas à categoria X (não os de outra categoria)", async () => {
    const r = await lerOpcionaisDaCategoria(t, c.catProdA);
    const ids = r.rows.map((x) => x.opcional_id);
    // Brie, Catupiry (Laticínios) e Doce (Doces) — associados a catProdA
    expect(ids).toContain(c.opcBrie);
    expect(ids).toContain(c.opcCatupiry);
    expect(ids).toContain(c.opcDoce);
    // Presunto (Charcutaria) NÃO está associado a catProdA
    expect(ids).not.toContain(c.opcNaoAssoc);
  });

  it("[2] opcional ativo=false NÃO aparece para o anon (opcionais_leitura_publica), mas existe via service", async () => {
    const r = await lerOpcionaisDaCategoria(t, c.catProdA);
    expect(r.rows.map((x) => x.opcional_id)).not.toContain(c.opcInativo);
    expect(await existeId(t, "opcionais", c.opcInativo)).toBe(true);
  });

  it("[3] opcional de loja INATIVA NÃO aparece para o anon (RLS pública), mas existe via service", async () => {
    // A loja off não tem associação com catProdA; ainda assim provamos que nem
    // consultando a categoria de produto da loja off (que o anon nem enxerga) o
    // opcional vaza. Consulta direta ao opcional sob anon = 0 linhas.
    const direto = await t.asAnon((db) =>
      db.query(`select id from public.opcionais where id = $1`, [c.opcOff]),
    );
    expect(direto.rows.length).toBe(0);
    expect(await existeId(t, "opcionais", c.opcOff)).toBe(true);
  });

  it("[4] categoria de produto SEM associação → lista vazia", async () => {
    const r = await lerOpcionaisDaCategoria(t, c.catProdSemOpc);
    expect(r.rows.length).toBe(0);
  });

  it("[5] grupos ordenados por opcionais_categorias.ordem e itens por opcionais.ordem", async () => {
    const r = await lerOpcionaisDaCategoria(t, c.catProdA);
    // Grupos: Doces (ordem 0) antes de Laticínios (ordem 1).
    const nomesGruposNaOrdem = r.rows.map((x) => x.categoria_opcional_nome);
    const primeiroLaticinios = nomesGruposNaOrdem.indexOf("Laticínios");
    const ultimoDoces = nomesGruposNaOrdem.lastIndexOf("Doces");
    expect(ultimoDoces).toBeLessThan(primeiroLaticinios);
    // Itens de Laticínios: Brie (0) antes de Catupiry (1).
    const latic = r.rows.filter((x) => x.categoria_opcional_id === c.opcCatLaticinios);
    expect(latic.map((x) => x.opcional_id)).toEqual([c.opcBrie, c.opcCatupiry]);
  });
});
