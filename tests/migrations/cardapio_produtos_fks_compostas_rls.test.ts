import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 243 — `public.cardapio_produtos` com as DUAS FKs
 * COMPOSTAS e a RLS das três políticas (spec `specs/cardapio-sazonal.md`,
 * §Modelos de Dados e §Segurança; RN-09, RN-10).
 *
 * Escrito a partir da ISSUE e do SPEC, nunca do SQL. O coração da issue:
 *
 *  1. um vínculo que mistura lojas é IMPOSSÍVEL, não meramente checado — e a
 *     asserção afirma o NOME da constraint (`cardapio_produtos_produto_fk` /
 *     `cardapio_produtos_cardapio_fk`), não só o SQLSTATE 23503. `23503`
 *     sozinho não distingue "caiu pela FK certa" de "caiu por outra qualquer";
 *  2. **`asService` (BYPASSRLS) TAMBÉM não consegue gravar o vínculo cruzado** —
 *     é a prova de que a trava é de chave estrangeira e não de RLS, e é o motivo
 *     pelo qual esta spec não repete o padrão de `categoria_produto_opcionais`
 *     (que resolve o mesmo problema por checagem na Server Action). O caminho de
 *     `criarPedido` e o do admin rodam sob `service_role`: uma trava que a
 *     `service_role` desliga não existe nos caminhos que decidem;
 *  3. `anon` não faz INSERT/UPDATE/DELETE;
 *  4. o vínculo legítimo (mesma loja nas três pontas) passa, e reinserir o mesmo
 *     par é recusado pelo `unique` — o alvo do `on conflict do nothing` que
 *     torna reaplicar idempotente (RN-10).
 *
 * Anti-falso-verde: nenhuma negação é aceita por "relation does not exist";
 * toda recusa exige o nome literal da constraint, e todo estado é reconferido
 * via `asService` contra a linha real.
 *
 * Nenhum código de produção é escrito aqui. Quem deixa verde é `executar`.
 */

const DONO_A = "a2430000-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "b2430000-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

type Cenario = {
  lojaA: string;
  lojaB: string;
  produtoA: string;
  produtoB: string;
  cardapioA: string;
  cardapioB: string;
};

const INSERT_VINCULO = `
  insert into public.cardapio_produtos (loja_id, cardapio_id, produto_id)
  values ($1, $2, $3) returning id`;

/** Recusa esperada sob `service_role` (BYPASSRLS) — devolve a mensagem. */
async function erroDoService(t: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await t.asService(async (db) => db.query(sql, params));
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error(`Esperava recusa do banco, mas a escrita PASSOU sob service_role: ${sql}`);
}

/** Recusa esperada sob um lojista logado (RLS ligada). */
async function erroDoLojista(
  t: TestDb,
  userId: string,
  sql: string,
  params: unknown[] = [],
): Promise<string> {
  try {
    await t.asUser(userId, async (db) => db.query(sql, params));
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error(`Esperava recusa, mas a escrita PASSOU como lojista: ${sql}`);
}

describe("243 · cardapio_produtos: FKs compostas e RLS", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();

    await t.db.query(
      `insert into auth.users (id, email) values
         ($1, 'dono-a-243@teste.local'),
         ($2, 'dono-b-243@teste.local')
       on conflict (id) do nothing`,
      [DONO_A, DONO_B],
    );

    c = await t.asService(async (db) => {
      const lojas = await db.query<{ id: string; dono_id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo) values
           ($1, 'loja-a-vinculo-243', 'Loja A', true),
           ($2, 'loja-b-vinculo-243', 'Loja B', true)
         returning id, dono_id`,
        [DONO_A, DONO_B],
      );
      const lojaA = lojas.rows.find((l) => l.dono_id === DONO_A)!.id;
      const lojaB = lojas.rows.find((l) => l.dono_id === DONO_B)!.id;

      const produtos = await db.query<{ id: string; loja_id: string }>(
        `insert into public.produtos (loja_id, nome, preco) values
           ($1, 'Feijoada A', 100.00),
           ($2, 'Feijoada B', 100.00)
         returning id, loja_id`,
        [lojaA, lojaB],
      );
      const cardapios = await db.query<{ id: string; loja_id: string }>(
        `insert into public.cardapios (loja_id, nome, modo, dias_semana, hora_inicio, hora_fim)
         values
           ($1, 'Sabado A', 'recorrente', array[6]::smallint[], time '11:00', time '15:00'),
           ($2, 'Sabado B', 'recorrente', array[6]::smallint[], time '11:00', time '15:00')
         returning id, loja_id`,
        [lojaA, lojaB],
      );

      return {
        lojaA,
        lojaB,
        produtoA: produtos.rows.find((p) => p.loja_id === lojaA)!.id,
        produtoB: produtos.rows.find((p) => p.loja_id === lojaB)!.id,
        cardapioA: cardapios.rows.find((r) => r.loja_id === lojaA)!.id,
        cardapioB: cardapios.rows.find((r) => r.loja_id === lojaB)!.id,
      };
    });
  });

  afterAll(async () => {
    await t.close();
  });

  // ───────────────────────────────── vínculo legítimo e idempotência (RN-10)

  it("vínculo legítimo (mesma loja nas três pontas) é aceito", async () => {
    const id = await t.asUser(DONO_A, async (db) => {
      const r = await db.query<{ id: string }>(INSERT_VINCULO, [c.lojaA, c.cardapioA, c.produtoA]);
      return r.rows[0].id;
    });
    expect(id).toBeTruthy();

    const real = await t.asService(async (db) =>
      db.query(`select 1 from public.cardapio_produtos where id = $1`, [id]),
    );
    expect(real.rows).toHaveLength(1);
  });

  it("[RN-10] reinserir o MESMO par (cardapio_id, produto_id) é recusado pelo unique", async () => {
    const msg = await erroDoService(t, INSERT_VINCULO, [c.lojaA, c.cardapioA, c.produtoA]);
    expect(msg).toMatch(/duplicate key|already exists/i);
    expect(msg).toContain("cardapio_produtos_cardapio_id_produto_id_key");
  });

  it("[RN-10] o mesmo par com `on conflict do nothing` é silenciosamente idempotente", async () => {
    await t.asUser(DONO_A, async (db) =>
      db.query(
        `insert into public.cardapio_produtos (loja_id, cardapio_id, produto_id)
         values ($1, $2, $3) on conflict do nothing`,
        [c.lojaA, c.cardapioA, c.produtoA],
      ),
    );
    const real = await t.asService(async (db) =>
      db.query(`select 1 from public.cardapio_produtos where cardapio_id = $1 and produto_id = $2`, [
        c.cardapioA,
        c.produtoA,
      ]),
    );
    expect(real.rows).toHaveLength(1);
  });

  // ───────────────────── FKs compostas · lojista A (§Seg 3 e 4)

  it("[§Seg 3] lojista A NÃO grava vínculo com produto_id da loja B — cardapio_produtos_produto_fk", async () => {
    // loja_id e cardapio_id próprios (a RLS está satisfeita); só o produto é de B.
    // É exatamente o IDOR da ação em lote, e quem fecha é a FK composta.
    const msg = await erroDoLojista(t, DONO_A, INSERT_VINCULO, [
      c.lojaA,
      c.cardapioA,
      c.produtoB,
    ]);
    expect(msg).toContain("cardapio_produtos_produto_fk");

    const real = await t.asService(async (db) =>
      db.query(`select 1 from public.cardapio_produtos where produto_id = $1`, [c.produtoB]),
    );
    expect(real.rows).toHaveLength(0);
  });

  it("[§Seg 4] lojista A NÃO grava vínculo com cardapio_id da loja B — cardapio_produtos_cardapio_fk", async () => {
    const msg = await erroDoLojista(t, DONO_A, INSERT_VINCULO, [
      c.lojaA,
      c.cardapioB,
      c.produtoA,
    ]);
    expect(msg).toContain("cardapio_produtos_cardapio_fk");

    const real = await t.asService(async (db) =>
      db.query(`select 1 from public.cardapio_produtos where cardapio_id = $1`, [c.cardapioB]),
    );
    expect(real.rows).toHaveLength(0);
  });

  it("[§Seg 3/4] lojista A NÃO troca o produto de um vínculo próprio por um da loja B (UPDATE)", async () => {
    const msg = await erroDoLojista(
      t,
      DONO_A,
      `update public.cardapio_produtos set produto_id = $1
        where cardapio_id = $2 and produto_id = $3`,
      [c.produtoB, c.cardapioA, c.produtoA],
    );
    expect(msg).toContain("cardapio_produtos_produto_fk");
  });

  // ───────── O CORAÇÃO DA ISSUE: a trava é FK, não RLS — vale sob service_role

  it("[critério de aceite] asService TAMBÉM não grava vínculo com produto de outra loja", async () => {
    // `service_role` tem BYPASSRLS: se a trava fosse RLS, esta escrita passaria.
    // O caminho autoritativo (criarPedido / admin) roda assim.
    const msg = await erroDoService(t, INSERT_VINCULO, [c.lojaA, c.cardapioA, c.produtoB]);
    expect(msg).toContain("cardapio_produtos_produto_fk");
  });

  it("[critério de aceite] asService TAMBÉM não grava vínculo com cardápio de outra loja", async () => {
    const msg = await erroDoService(t, INSERT_VINCULO, [c.lojaA, c.cardapioB, c.produtoA]);
    expect(msg).toContain("cardapio_produtos_cardapio_fk");
  });

  it("[critério de aceite] asService não grava vínculo coerente entre si mas com loja_id de terceiro", async () => {
    // cardápio e produto ambos de B, mas a linha declara loja A: as duas FKs caem.
    const msg = await erroDoService(t, INSERT_VINCULO, [c.lojaA, c.cardapioB, c.produtoB]);
    expect(msg).toMatch(/cardapio_produtos_(cardapio|produto)_fk/);

    const real = await t.asService(async (db) =>
      db.query(`select 1 from public.cardapio_produtos where loja_id = $1`, [c.lojaB]),
    );
    expect(real.rows).toHaveLength(0);
  });

  // ───────────────────────────────── RLS · anon (§Seg 6)

  it("[§Seg 6] anon LÊ vínculo de loja ativa", async () => {
    const r = await t.asAnon(async (db) =>
      db.query(`select 1 from public.cardapio_produtos where cardapio_id = $1`, [c.cardapioA]),
    );
    expect(r.rows).toHaveLength(1);
  });

  it("[§Seg 6] anon NÃO faz INSERT em cardapio_produtos", async () => {
    let msg = "";
    try {
      await t.asAnon(async (db) => db.query(INSERT_VINCULO, [c.lojaA, c.cardapioA, c.produtoA]));
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toMatch(/row-level security/i);
  });

  it("[§Seg 6] anon NÃO faz UPDATE nem DELETE em cardapio_produtos", async () => {
    const r = await t.asAnon(async (db) => {
      const up = await db.query(`update public.cardapio_produtos set loja_id = $1`, [c.lojaB]);
      const del = await db.query(`delete from public.cardapio_produtos`);
      return { up: up.affectedRows ?? 0, del: del.affectedRows ?? 0 };
    });
    expect(r).toEqual({ up: 0, del: 0 });

    const real = await t.asService(async (db) =>
      db.query(`select 1 from public.cardapio_produtos where cardapio_id = $1`, [c.cardapioA]),
    );
    expect(real.rows).toHaveLength(1);
  });

  // ───────────────────────────────── RLS · lojista A vs loja B

  it("lojista A NÃO cria vínculo declarando loja_id da loja B (RLS, antes da FK)", async () => {
    const msg = await erroDoLojista(t, DONO_A, INSERT_VINCULO, [c.lojaB, c.cardapioB, c.produtoB]);
    expect(msg).toMatch(/row-level security/i);
  });

  it("lojista A NÃO remove vínculo da loja B", async () => {
    const vinculoB = await t.asService(async (db) => {
      const r = await db.query<{ id: string }>(INSERT_VINCULO, [c.lojaB, c.cardapioB, c.produtoB]);
      return r.rows[0].id;
    });

    const apagadas = await t.asUser(DONO_A, async (db) => {
      const del = await db.query(`delete from public.cardapio_produtos where id = $1`, [vinculoB]);
      return del.affectedRows ?? 0;
    });
    expect(apagadas).toBe(0);

    const real = await t.asService(async (db) =>
      db.query(`select 1 from public.cardapio_produtos where id = $1`, [vinculoB]),
    );
    expect(real.rows).toHaveLength(1);
  });

  // ───────────────────────────────── cascata

  it("apagar o cardápio leva os vínculos junto (on delete cascade)", async () => {
    const { cardapio, vinculo } = await t.asService(async (db) => {
      const cd = await db.query<{ id: string }>(
        `insert into public.cardapios (loja_id, nome, modo, dias_mes)
         values ($1, 'Efemero A', 'recorrente', array[1]::smallint[]) returning id`,
        [c.lojaA],
      );
      const v = await db.query<{ id: string }>(INSERT_VINCULO, [
        c.lojaA,
        cd.rows[0].id,
        c.produtoA,
      ]);
      return { cardapio: cd.rows[0].id, vinculo: v.rows[0].id };
    });

    await t.asService(async (db) =>
      db.query(`delete from public.cardapios where id = $1`, [cardapio]),
    );

    const real = await t.asService(async (db) =>
      db.query(`select 1 from public.cardapio_produtos where id = $1`, [vinculo]),
    );
    expect(real.rows).toHaveLength(0);
  });

  it("apagar o produto leva os vínculos junto (on delete cascade)", async () => {
    const { produto, vinculo } = await t.asService(async (db) => {
      const p = await db.query<{ id: string }>(
        `insert into public.produtos (loja_id, nome, preco)
         values ($1, 'Efemero produto A', 10.00) returning id`,
        [c.lojaA],
      );
      const v = await db.query<{ id: string }>(INSERT_VINCULO, [
        c.lojaA,
        c.cardapioA,
        p.rows[0].id,
      ]);
      return { produto: p.rows[0].id, vinculo: v.rows[0].id };
    });

    await t.asService(async (db) => db.query(`delete from public.produtos where id = $1`, [produto]));

    const real = await t.asService(async (db) =>
      db.query(`select 1 from public.cardapio_produtos where id = $1`, [vinculo]),
    );
    expect(real.rows).toHaveLength(0);
  });

  // ───────────────────────────────── índices declarados na issue

  it("os dois índices da issue existem (loja_id+cardapio_id e produto_id)", async () => {
    const r = await t.asService(async (db) =>
      db.query<{ indexdef: string }>(
        `select indexdef from pg_indexes
          where schemaname = 'public' and tablename = 'cardapio_produtos'`,
      ),
    );
    const defs = r.rows.map((x) => x.indexdef.replace(/\s+/g, " "));
    expect(defs.some((d) => /\(loja_id, cardapio_id\)/.test(d))).toBe(true);
    expect(defs.some((d) => /\(produto_id\)/.test(d))).toBe(true);
  });

  it("[§Seg 6b] anon NÃO lê vínculo de cardápio INATIVO — o rascunho não vaza", async () => {
    // Achado do `auditar`: a policy exigia só loja ativa, e policy de OUTRA
    // tabela não restringe esta — cada tabela avalia a sua. Com a anon key do
    // bundle dava para listar os vínculos do cardápio que o lojista ainda não
    // lançou (quantos pratos, desde quando, os ids), enquanto `cardapios` e
    // `produtos` negavam as mesmas linhas. Mesma classe do vazamento da 265.
    const rascunho = await t.asService(async (db) => {
      const c2 = await db.query<{ id: string }>(
        `insert into public.cardapios (loja_id, nome, modo, dias_semana, hora_inicio, hora_fim, ativo)
         values ($1, 'Rascunho de Natal', 'recorrente', array[6]::smallint[],
                 time '11:00', time '15:00', false)
         returning id`,
        [c.lojaA],
      );
      const id = c2.rows[0].id;
      await db.query(INSERT_VINCULO, [c.lojaA, id, c.produtoA]);
      return id;
    });

    const vistos = await t.asAnon((db) =>
      db.query(`select cardapio_id from public.cardapio_produtos where cardapio_id = $1`, [
        rascunho,
      ]),
    );
    expect(vistos.rows).toHaveLength(0);

    // A linha existe: o que mudou é quem enxerga.
    const naBase = await t.asService((db) =>
      db.query(`select 1 from public.cardapio_produtos where cardapio_id = $1`, [rascunho]),
    );
    expect(naBase.rows.length).toBeGreaterThan(0);

    // E o DONO continua lendo o próprio rascunho, pela policy de leitura própria.
    const doDono = await t.asUser(DONO_A, (db) =>
      db.query(`select cardapio_id from public.cardapio_produtos where cardapio_id = $1`, [
        rascunho,
      ]),
    );
    expect(doDono.rows.length).toBeGreaterThan(0);
  });
});
