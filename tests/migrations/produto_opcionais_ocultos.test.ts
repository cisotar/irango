import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 331 — fatia F1: a tabela de exceção
 * `public.produto_opcionais_ocultos` (plan/loop-ocultar-opcionais-por-produto.md,
 * "Desenho" e "Risco por fatia").
 *
 * Escrito a partir do PLANO, nunca do SQL (a migration
 * `supabase/migrations/20260930140000_produto_opcionais_ocultos.sql` ainda não
 * existe). Invariantes:
 *
 *  1. existência da linha = "grupo oculto neste produto". Alternar é INSERT ou
 *     DELETE; NÃO existe UPDATE (sem policy e sem grant);
 *  2. `unique (produto_id, categoria_opcional_id)` — alvo do
 *     `on conflict do nothing` que torna o lote idempotente;
 *  3. FKs COMPOSTAS com `loja_id`, nomes LITERAIS
 *     `produto_opcionais_ocultos_produto_fk` / `produto_opcionais_ocultos_grupo_fk`.
 *     A asserção exige o NOME no erro (23503 sozinho não diz qual trava caiu) e
 *     vale sob `asService` (BYPASSRLS): o hub admin escreve por service_role;
 *  4. lote multi-linha com UM par alheio não grava NENHUMA linha (é o que a
 *     Server Action em lote herda — F2);
 *  5. RLS: leitura pública via `loja_esta_ativa`; escrita (insert/delete) só do
 *     dono; anon só lê.
 *
 * ── FINDING (mesmo do 103, `rls_opcionais_leitura_propria.test.ts`) ──────────
 * O plano pede "asUser B não lê linha de A". Com leitura PÚBLICA via
 * `loja_esta_ativa`, o dono B enxerga as ocultações de uma loja A ATIVA
 * exatamente como o anon — é o dado que a vitrine de A já revela (quais grupos
 * cada produto mostra). O isolamento de LEITURA que importa é sobre loja
 * INATIVA (privado): esse o dono B não lê, e o anon também não. O teste
 * afirma o invariante correto, não o do rascunho.
 *
 * Anti-falso-verde: nenhuma recusa é aceita por "relation does not exist"
 * (42P01, o erro de hoje). Toda recusa exige o código/mensagem ESPECÍFICO
 * (nome da constraint, `row-level security`, `permission denied for table
 * produto_opcionais_ocultos`) e todo estado é reconferido via `asService`.
 */

const DONO_A = "a3310000-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DONO_B = "b3310000-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DONO_I = "c3310000-cccc-4ccc-8ccc-cccccccccccc"; // dono da loja INATIVA

type Cenario = {
  lojaA: string;
  lojaB: string;
  lojaI: string;
  catA: string; // categoria de PRODUTO da loja A
  catA2: string; // segunda categoria de produto da loja A (D3: troca de categoria)
  produtoA1: string;
  produtoA2: string;
  produtoA3: string; // usado só nos testes de cascata
  produtoB: string;
  produtoI: string;
  grupoA1: string; // opcionais_categorias da loja A
  grupoA2: string;
  grupoA3: string; // usado só nos testes de cascata
  grupoB: string;
  grupoI: string;
};

const INSERT_OCULTO = `
  insert into public.produto_opcionais_ocultos (loja_id, produto_id, categoria_opcional_id)
  values ($1, $2, $3) returning id`;

const CODIGO = (err: unknown) => (err as { code?: string }).code ?? "SEM_CODE";
const MSG = (err: unknown) => (err as Error).message;

type Recusa = { code: string; msg: string };

/** Executa e devolve a recusa; se a escrita PASSAR, o teste falha. */
async function recusa(fn: () => Promise<unknown>, rotulo: string): Promise<Recusa> {
  try {
    await fn();
  } catch (err) {
    return { code: CODIGO(err), msg: MSG(err) };
  }
  throw new Error(`Esperava recusa do banco, mas PASSOU: ${rotulo}`);
}

async function linhasDoPar(
  t: TestDb,
  produtoId: string,
  grupoId: string,
): Promise<Array<{ id: string; loja_id: string }>> {
  const r = await t.asService((db) =>
    db.query<{ id: string; loja_id: string }>(
      `select id, loja_id from public.produto_opcionais_ocultos
        where produto_id = $1 and categoria_opcional_id = $2`,
      [produtoId, grupoId],
    ),
  );
  return r.rows;
}

async function semear(t: TestDb): Promise<Cenario> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a-331@teste.local'),
       ($2, 'dono-b-331@teste.local'),
       ($3, 'dono-i-331@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B, DONO_I],
  );
  return t.asService(async (db) => {
    const um = async (sql: string, params: unknown[]) => {
      const r = await db.query<{ id: string }>(sql, params);
      return r.rows[0].id;
    };
    const loja = (dono: string, slug: string, ativo: boolean) =>
      um(
        `insert into public.lojas (dono_id, slug, nome, ativo) values ($1, $2, $2, $3) returning id`,
        [dono, slug, ativo],
      );
    const lojaA = await loja(DONO_A, "loja-a-ocultos-331", true);
    const lojaB = await loja(DONO_B, "loja-b-ocultos-331", true);
    const lojaI = await loja(DONO_I, "loja-i-ocultos-331", false);

    const categoria = (lojaId: string, nome: string) =>
      um(`insert into public.categorias (loja_id, nome) values ($1, $2) returning id`, [
        lojaId,
        nome,
      ]);
    const catA = await categoria(lojaA, "Lanches");
    const catA2 = await categoria(lojaA, "Porções");
    const catB = await categoria(lojaB, "Lanches B");
    const catI = await categoria(lojaI, "Lanches I");

    const produto = (lojaId: string, catId: string, nome: string) =>
      um(
        `insert into public.produtos (loja_id, categoria_id, nome, preco)
         values ($1, $2, $3, 30.00) returning id`,
        [lojaId, catId, nome],
      );
    const grupo = (lojaId: string, nome: string) =>
      um(`insert into public.opcionais_categorias (loja_id, nome) values ($1, $2) returning id`, [
        lojaId,
        nome,
      ]);

    const c: Cenario = {
      lojaA,
      lojaB,
      lojaI,
      catA,
      catA2,
      produtoA1: await produto(lojaA, catA, "X-Burger"),
      produtoA2: await produto(lojaA, catA, "X-Salada"),
      produtoA3: await produto(lojaA, catA, "X-Efêmero"),
      produtoB: await produto(lojaB, catB, "X-Burger B"),
      produtoI: await produto(lojaI, catI, "X-Burger I"),
      grupoA1: await grupo(lojaA, "Adicionais"),
      grupoA2: await grupo(lojaA, "Molhos"),
      grupoA3: await grupo(lojaA, "Efêmero"),
      grupoB: await grupo(lojaB, "Adicionais B"),
      grupoI: await grupo(lojaI, "Adicionais I"),
    };

    // A exceção produto×grupo pressupõe o grupo HERDADO da categoria.
    for (const g of [c.grupoA1, c.grupoA2, c.grupoA3]) {
      await db.query(
        `insert into public.categoria_produto_opcionais (loja_id, categoria_id, categoria_opcional_id)
         values ($1, $2, $3)`,
        [lojaA, catA, g],
      );
    }
    await db.query(
      `insert into public.categoria_produto_opcionais (loja_id, categoria_id, categoria_opcional_id)
       values ($1, $2, $3)`,
      [lojaB, catB, c.grupoB],
    );
    await db.query(
      `insert into public.categoria_produto_opcionais (loja_id, categoria_id, categoria_opcional_id)
       values ($1, $2, $3)`,
      [lojaI, catI, c.grupoI],
    );
    return c;
  });
}

describe("331 F1 · produto_opcionais_ocultos: FKs compostas, UNIQUE e RLS", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    c = await semear(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ─────────────────────────────── escrita legítima (a linha = "oculto")

  it("[F1-1] dono A oculta o grupo A1 no produto A1 (INSERT) — a linha nasce com a loja A", async () => {
    const id = await t.asUser(DONO_A, async (db) => {
      const r = await db.query<{ id: string }>(INSERT_OCULTO, [c.lojaA, c.produtoA1, c.grupoA1]);
      return r.rows[0].id;
    });
    expect(id).toBeTruthy();

    const real = await linhasDoPar(t, c.produtoA1, c.grupoA1);
    expect(real).toHaveLength(1);
    expect(real[0].loja_id).toBe(c.lojaA);
  });

  it("[F1-2] `id` e `criado_em` têm default (o lote não precisa mandá-los)", async () => {
    const r = await t.asService((db) =>
      db.query<{ id: string; criado_em: string | null }>(
        `select id, criado_em from public.produto_opcionais_ocultos
          where produto_id = $1 and categoria_opcional_id = $2`,
        [c.produtoA1, c.grupoA1],
      ),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.rows[0].criado_em).not.toBeNull();
  });

  // ─────────────────────────────── UNIQUE e idempotência do lote

  it("[F1-3] reinserir o MESMO par (produto, grupo) é recusado pelo UNIQUE (23505)", async () => {
    const r = await recusa(
      () => t.asService((db) => db.query(INSERT_OCULTO, [c.lojaA, c.produtoA1, c.grupoA1])),
      "par duplicado",
    );
    expect(r.code).toBe("23505");
    expect(r.msg).toContain("produto_opcionais_ocultos");
    expect(await linhasDoPar(t, c.produtoA1, c.grupoA1)).toHaveLength(1);
  });

  it("[F1-4] `on conflict (produto_id, categoria_opcional_id) do nothing` é idempotente (lote repetido)", async () => {
    // É o alvo do `upsert(..., { onConflict, ignoreDuplicates: true })` da
    // Server Action. Sem o UNIQUE exatamente nessas duas colunas o Postgres
    // recusa o ON CONFLICT com 42P10 — o que também é vermelho aqui.
    for (let i = 0; i < 2; i++) {
      await t.asUser(DONO_A, (db) =>
        db.query(
          `insert into public.produto_opcionais_ocultos (loja_id, produto_id, categoria_opcional_id)
           values ($1, $2, $3)
           on conflict (produto_id, categoria_opcional_id) do nothing`,
          [c.lojaA, c.produtoA1, c.grupoA1],
        ),
      );
    }
    expect(await linhasDoPar(t, c.produtoA1, c.grupoA1)).toHaveLength(1);
  });

  // ─────────────────────────────── FKs compostas — lojista (RLS satisfeita)

  it("[F1-5] dono A NÃO oculta, na própria loja, um PRODUTO da loja B — produto_opcionais_ocultos_produto_fk", async () => {
    const r = await recusa(
      () => t.asUser(DONO_A, (db) => db.query(INSERT_OCULTO, [c.lojaA, c.produtoB, c.grupoA1])),
      "produto de B sob dono A",
    );
    expect(r.code).toBe("23503");
    expect(r.msg).toContain("produto_opcionais_ocultos_produto_fk");
    expect(await linhasDoPar(t, c.produtoB, c.grupoA1)).toHaveLength(0);
  });

  it("[F1-6] dono A NÃO oculta, na própria loja, um GRUPO da loja B — produto_opcionais_ocultos_grupo_fk", async () => {
    const r = await recusa(
      () => t.asUser(DONO_A, (db) => db.query(INSERT_OCULTO, [c.lojaA, c.produtoA1, c.grupoB])),
      "grupo de B sob dono A",
    );
    expect(r.code).toBe("23503");
    expect(r.msg).toContain("produto_opcionais_ocultos_grupo_fk");
    expect(await linhasDoPar(t, c.produtoA1, c.grupoB)).toHaveLength(0);
  });

  // ─────────────── O CORAÇÃO: a trava é FK, não RLS — vale sob service_role

  it("[F1-7] asService TAMBÉM não grava produto de outra loja — produto_opcionais_ocultos_produto_fk", async () => {
    const r = await recusa(
      () => t.asService((db) => db.query(INSERT_OCULTO, [c.lojaA, c.produtoB, c.grupoA1])),
      "produto de B sob service_role",
    );
    expect(r.code).toBe("23503");
    expect(r.msg).toContain("produto_opcionais_ocultos_produto_fk");
  });

  it("[F1-8] asService TAMBÉM não grava grupo de outra loja — produto_opcionais_ocultos_grupo_fk", async () => {
    const r = await recusa(
      () => t.asService((db) => db.query(INSERT_OCULTO, [c.lojaA, c.produtoA1, c.grupoB])),
      "grupo de B sob service_role",
    );
    expect(r.code).toBe("23503");
    expect(r.msg).toContain("produto_opcionais_ocultos_grupo_fk");
  });

  it("[F1-9] asService não grava par coerente entre si (ambos de B) declarando loja A", async () => {
    const r = await recusa(
      () => t.asService((db) => db.query(INSERT_OCULTO, [c.lojaA, c.produtoB, c.grupoB])),
      "par de B com loja_id A",
    );
    expect(r.code).toBe("23503");
    expect(r.msg).toMatch(/produto_opcionais_ocultos_(produto|grupo)_fk/);
    const real = await t.asService((db) =>
      db.query(`select 1 from public.produto_opcionais_ocultos where produto_id = $1`, [c.produtoB]),
    );
    expect(real.rows).toHaveLength(0);
  });

  it("[F1-10] lote multi-linha com UM par alheio entre válidos não grava NENHUMA linha (atomicidade)", async () => {
    // Forma exata do `upsert` em lote da action: um único INSERT ... VALUES
    // (...), (...), (...) ON CONFLICT DO NOTHING. O ON CONFLICT NÃO engole
    // violação de FK — o comando inteiro cai.
    const r = await recusa(
      () =>
        t.asUser(DONO_A, (db) =>
          db.query(
            `insert into public.produto_opcionais_ocultos (loja_id, produto_id, categoria_opcional_id)
             values ($1, $2, $3), ($1, $4, $3), ($1, $2, $5)
             on conflict (produto_id, categoria_opcional_id) do nothing`,
            [c.lojaA, c.produtoA2, c.grupoA2, c.produtoB, c.grupoA1],
          ),
        ),
      "lote misto",
    );
    expect(r.code).toBe("23503");
    expect(r.msg).toContain("produto_opcionais_ocultos_produto_fk");
    // Os dois pares LEGÍTIMOS do lote também não ficaram.
    expect(await linhasDoPar(t, c.produtoA2, c.grupoA2)).toHaveLength(0);
    expect(await linhasDoPar(t, c.produtoA2, c.grupoA1)).toHaveLength(0);
  });

  // ─────────────────────────────── RLS · lojista B contra a loja A

  it("[F1-11] dono B NÃO grava linha declarando loja_id da loja A (RLS, antes da FK)", async () => {
    const r = await recusa(
      () => t.asUser(DONO_B, (db) => db.query(INSERT_OCULTO, [c.lojaA, c.produtoA2, c.grupoA1])),
      "dono B com loja_id A",
    );
    expect(r.code).toBe("42501");
    expect(r.msg).toMatch(/row-level security/i);
    expect(r.msg).toContain("produto_opcionais_ocultos");
    expect(await linhasDoPar(t, c.produtoA2, c.grupoA1)).toHaveLength(0);
  });

  it("[F1-12] dono B NÃO apaga a ocultação da loja A (0 linhas; reconferida via service)", async () => {
    const apagadas = await t.asUser(DONO_B, async (db) => {
      const r = await db.query(
        `delete from public.produto_opcionais_ocultos where produto_id = $1`,
        [c.produtoA1],
      );
      return r.affectedRows ?? 0;
    });
    expect(apagadas).toBe(0);
    expect(await linhasDoPar(t, c.produtoA1, c.grupoA1)).toHaveLength(1);
  });

  it("[F1-13] loja A ATIVA: o dono B lê a ocultação de A exatamente como o anon (dado público da vitrine)", async () => {
    const q = (db: import("@electric-sql/pglite").PGlite) =>
      db.query(`select 1 from public.produto_opcionais_ocultos where produto_id = $1`, [
        c.produtoA1,
      ]);
    const donoB = await t.asUser(DONO_B, q);
    const anon = await t.asAnon(q);
    expect(anon.rows).toHaveLength(1);
    expect(donoB.rows).toHaveLength(anon.rows.length);
  });

  it("[F1-14] loja INATIVA: nem o dono B nem o anon leem a ocultação dela (privado)", async () => {
    await t.asService((db) => db.query(INSERT_OCULTO, [c.lojaI, c.produtoI, c.grupoI]));
    const q = (db: import("@electric-sql/pglite").PGlite) =>
      db.query(`select 1 from public.produto_opcionais_ocultos where produto_id = $1`, [
        c.produtoI,
      ]);
    expect((await t.asUser(DONO_B, q)).rows).toHaveLength(0);
    expect((await t.asAnon(q)).rows).toHaveLength(0);
    // anti-falso-verde: a linha EXISTE.
    expect(await linhasDoPar(t, c.produtoI, c.grupoI)).toHaveLength(1);
  });

  it("[F1-15] o dono da loja INATIVA ainda lê a PRÓPRIA ocultação (painel), como em categoria_produto_opcionais", async () => {
    const r = await t.asUser(DONO_I, (db) =>
      db.query(`select 1 from public.produto_opcionais_ocultos where produto_id = $1`, [
        c.produtoI,
      ]),
    );
    expect(r.rows).toHaveLength(1);
  });

  // ─────────────────────────────── sem UPDATE: alternar é INSERT/DELETE

  it("[F1-16] ninguém faz UPDATE: dono A leva 42501 (sem grant de UPDATE) e a linha fica intacta", async () => {
    const r = await recusa(
      () =>
        t.asUser(DONO_A, (db) =>
          db.query(
            `update public.produto_opcionais_ocultos set categoria_opcional_id = $1
              where produto_id = $2 and categoria_opcional_id = $3`,
            [c.grupoA2, c.produtoA1, c.grupoA1],
          ),
        ),
      "update do dono",
    );
    expect(r.code).toBe("42501");
    expect(r.msg).toMatch(/permission denied for table produto_opcionais_ocultos/i);
    expect(await linhasDoPar(t, c.produtoA1, c.grupoA1)).toHaveLength(1);
  });

  it("[F1-17] anon só lê: INSERT, UPDATE e DELETE recusados pelo grant (42501)", async () => {
    const tentar = (sql: string, params: unknown[]) =>
      recusa(() => t.asAnon((db) => db.query(sql, params)), sql);
    const ins = await tentar(INSERT_OCULTO, [c.lojaA, c.produtoA2, c.grupoA1]);
    const up = await tentar(`update public.produto_opcionais_ocultos set loja_id = $1`, [c.lojaB]);
    const del = await tentar(`delete from public.produto_opcionais_ocultos where produto_id = $1`, [
      c.produtoA1,
    ]);
    for (const r of [ins, up, del]) {
      expect(r.code).toBe("42501");
      expect(r.msg).toMatch(/permission denied for table produto_opcionais_ocultos/i);
    }
    expect(await linhasDoPar(t, c.produtoA1, c.grupoA1)).toHaveLength(1);
  });

  it("[F1-18] dono A volta a exibir (DELETE da própria linha) — 1 linha afetada", async () => {
    await t.asUser(DONO_A, (db) => db.query(INSERT_OCULTO, [c.lojaA, c.produtoA2, c.grupoA2]));
    const apagadas = await t.asUser(DONO_A, async (db) => {
      const r = await db.query(
        `delete from public.produto_opcionais_ocultos
          where loja_id = $1 and produto_id = $2 and categoria_opcional_id = $3`,
        [c.lojaA, c.produtoA2, c.grupoA2],
      );
      return r.affectedRows ?? 0;
    });
    expect(apagadas).toBe(1);
    expect(await linhasDoPar(t, c.produtoA2, c.grupoA2)).toHaveLength(0);
  });

  // ─────────────────────────────── D3 e ciclo de vida

  it("[F1-19] (D3) o produto troca de categoria: a ocultação PERSISTE (linha órfã, inerte)", async () => {
    await t.asService((db) =>
      db.query(`update public.produtos set categoria_id = $1 where id = $2`, [c.catA2, c.produtoA1]),
    );
    expect(await linhasDoPar(t, c.produtoA1, c.grupoA1)).toHaveLength(1);
    await t.asService((db) =>
      db.query(`update public.produtos set categoria_id = $1 where id = $2`, [c.catA, c.produtoA1]),
    );
  });

  it("[F1-20] (D3) desassociar o grupo da categoria NÃO apaga a ocultação (inerte até reassociar)", async () => {
    await t.asService((db) => db.query(INSERT_OCULTO, [c.lojaA, c.produtoA2, c.grupoA3]));
    await t.asService((db) =>
      db.query(
        `delete from public.categoria_produto_opcionais
          where loja_id = $1 and categoria_id = $2 and categoria_opcional_id = $3`,
        [c.lojaA, c.catA, c.grupoA3],
      ),
    );
    expect(await linhasDoPar(t, c.produtoA2, c.grupoA3)).toHaveLength(1);
  });

  it("[F1-21] apagar o PRODUTO leva as ocultações dele junto (on delete cascade) — não trava a exclusão", async () => {
    await t.asService((db) => db.query(INSERT_OCULTO, [c.lojaA, c.produtoA3, c.grupoA1]));
    await t.asService((db) => db.query(`delete from public.produtos where id = $1`, [c.produtoA3]));
    expect(await linhasDoPar(t, c.produtoA3, c.grupoA1)).toHaveLength(0);
  });

  it("[F1-22] apagar o GRUPO leva as ocultações dele junto (on delete cascade) — não trava a exclusão", async () => {
    await t.asService((db) =>
      db.query(`delete from public.opcionais_categorias where id = $1`, [c.grupoA3]),
    );
    expect(await linhasDoPar(t, c.produtoA2, c.grupoA3)).toHaveLength(0);
  });
});

/**
 * [331] A2 (auditoria, BAIXA) — a leitura PÚBLICA não pode revelar ocultação de
 * produto que a vitrine não publica. Com o `using` só de `loja_esta_ativa`, o
 * anon enumerava (`?loja_id=eq.<loja>`) os ids de produto OCULTO e de produto em
 * CATEGORIA OCULTA — ids que `vitrine_produtos` nega. A policy pública passa a
 * exigir também o produto na view (mesma classe da 20260920133000). O dono segue
 * lendo tudo pela `prod_opc_ocultos_leitura_propria` (F1-15).
 */
describe("331 A2 · leitura pública só de ocultação de produto publicado na vitrine", () => {
  let t: TestDb;
  let c: Cenario;
  let produtoOculto: string;
  let produtoCatOculta: string;

  beforeAll(async () => {
    t = await createTestDb();
    c = await semear(t);
    ({ produtoOculto, produtoCatOculta } = await t.asService(async (db) => {
      const um = async (sql: string, params: unknown[]) =>
        (await db.query<{ id: string }>(sql, params)).rows[0].id;
      const catOculta = await um(
        `insert into public.categorias (loja_id, nome, oculta) values ($1, 'Bastidores', true) returning id`,
        [c.lojaA],
      );
      await db.query(
        `insert into public.categoria_produto_opcionais (loja_id, categoria_id, categoria_opcional_id)
         values ($1, $2, $3)`,
        [c.lojaA, catOculta, c.grupoA1],
      );
      const ids = {
        produtoOculto: await um(
          `insert into public.produtos (loja_id, categoria_id, nome, preco, oculto)
           values ($1, $2, 'X-Rascunho', 30.00, true) returning id`,
          [c.lojaA, c.catA],
        ),
        produtoCatOculta: await um(
          `insert into public.produtos (loja_id, categoria_id, nome, preco)
           values ($1, $2, 'X-Bastidor', 30.00) returning id`,
          [c.lojaA, catOculta],
        ),
      };
      for (const produto of [c.produtoA1, ids.produtoOculto, ids.produtoCatOculta]) {
        await db.query(INSERT_OCULTO, [c.lojaA, produto, c.grupoA1]);
      }
      return ids;
    }));
  });
  afterAll(async () => {
    await t.close();
  });

  const daLojaA = (db: import("@electric-sql/pglite").PGlite) =>
    db.query<{ produto_id: string }>(
      `select produto_id from public.produto_opcionais_ocultos where loja_id = $1 order by produto_id`,
      [c.lojaA],
    );

  it("[A2-1] anon enumera a loja ATIVA e só recebe a ocultação do produto PUBLICADO", async () => {
    const r = await t.asAnon(daLojaA);
    expect(r.rows.map((x) => x.produto_id)).toEqual([c.produtoA1]);
  });

  it("[A2-2] anon NÃO lê a ocultação de produto oculto nem de produto em categoria oculta", async () => {
    for (const produto of [produtoOculto, produtoCatOculta]) {
      const r = await t.asAnon((db) =>
        db.query(`select 1 from public.produto_opcionais_ocultos where produto_id = $1`, [produto]),
      );
      expect(r.rows, produto).toHaveLength(0);
      // anti-falso-verde: a linha EXISTE.
      expect(await linhasDoPar(t, produto, c.grupoA1), produto).toHaveLength(1);
    }
  });

  it("[A2-3] outro dono (B) também não lê a de produto não publicado — mesma regra do anon", async () => {
    const r = await t.asUser(DONO_B, daLojaA);
    expect(r.rows.map((x) => x.produto_id)).toEqual([c.produtoA1]);
  });

  it("[A2-4] o DONO A continua lendo as três (painel), pela policy própria", async () => {
    const r = await t.asUser(DONO_A, daLojaA);
    expect(r.rows.map((x) => x.produto_id).sort()).toEqual(
      [c.produtoA1, produtoOculto, produtoCatOculta].sort(),
    );
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 331, F1:
 *
 * `supabase/migrations/20260930140000_produto_opcionais_ocultos.sql`
 *   create table public.produto_opcionais_ocultos (
 *     id uuid primary key default gen_random_uuid(),
 *     loja_id uuid not null references public.lojas (id) on delete cascade,
 *     produto_id uuid not null,
 *     categoria_opcional_id uuid not null,
 *     criado_em timestamptz not null default now(),
 *     constraint produto_opcionais_ocultos_produto_fk
 *       foreign key (produto_id, loja_id) references public.produtos (id, loja_id) on delete cascade,
 *     constraint produto_opcionais_ocultos_grupo_fk
 *       foreign key (categoria_opcional_id, loja_id)
 *       references public.opcionais_categorias (id, loja_id) on delete cascade,
 *     unique (produto_id, categoria_opcional_id)
 *   );
 *   índice (loja_id, produto_id); RLS ligada; policies:
 *     select público  → public.loja_esta_ativa(loja_id)                      [F1-13, F1-14]
 *     select próprio  → exists lojas.dono_id = auth.uid()                    [F1-15]
 *     insert próprio  → with check exists lojas.dono_id = auth.uid()         [F1-1, F1-11]
 *     delete próprio  → using exists lojas.dono_id = auth.uid()              [F1-12, F1-18]
 *     NENHUMA policy de UPDATE.
 *   GRANTs: anon select; authenticated select, insert, delete (SEM update);
 *     service_role all.                                                      [F1-16, F1-17]
 */
