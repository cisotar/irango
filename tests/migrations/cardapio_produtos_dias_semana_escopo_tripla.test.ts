import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Issue 274 — prova em SQL real (pglite) da FORMA EXATA de UPDATE que
 * `definirDiasDoVinculo` / `definirDiasDoVinculoAdmin` emitem:
 *
 *   update cardapio_produtos set dias_semana = …
 *   where loja_id = <derivado> and cardapio_id = <payload> and produto_id = <payload>
 *
 * `cardapio_produtos_dias_semana.test.ts` (272) já prova o CHECK de domínio e a
 * RLS de leitura/escrita — mas todo UPDATE de lá mira a linha por `id`
 * (`where id = $1`), nunca pela TRIPLA. Este arquivo cobre a lacuna: a tripla
 * é o que o código de produção realmente envia, nos dois mundos, e o admin
 * roda sob `service_role` (BYPASSRLS) — ali quem protege não é a policy, é a
 * combinação da tripla com as FKs compostas `(cardapio_id, loja_id)` /
 * `(produto_id, loja_id)` (20260920129000): uma linha só existe se seu
 * `cardapio_id` e `produto_id` pertencerem à MESMA loja que a própria linha
 * declara, então nenhuma combinação cruzada de `loja_id`+`cardapio_id`/
 * `produto_id` de lojas diferentes pode casar uma linha real.
 *
 * Anti-falso-verde: toda recusa (`affectedRows === 0`) é reconferida com
 * `asService` contra a linha real — 0 linhas afetadas só vale se o valor
 * gravado continuar o de antes.
 */

const DONO_A = "a2740000-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "b2740000-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

type LinhaVinculo = { id: string; dias_semana: number[] | null };

type Cenario = {
  lojaA: string;
  lojaB: string;
  cardapioA: string;
  cardapioB: string;
  produtoA: string;
  produtoB: string;
  vinculoA: string;
  vinculoB: string;
};

/** O UPDATE que `definirDiasDoVinculo`/`Admin` emitem — a TRIPLA, nunca `id`. */
const UPDATE_PELA_TRIPLA = `
  update public.cardapio_produtos
     set dias_semana = $4::smallint[]
   where loja_id = $1 and cardapio_id = $2 and produto_id = $3`;

describe("274 · cardapio_produtos: UPDATE pela TRIPLA (loja_id ∧ cardapio_id ∧ produto_id)", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();

    await t.db.query(
      `insert into auth.users (id, email) values
         ($1, 'dono-a-274-tripla@teste.local'),
         ($2, 'dono-b-274-tripla@teste.local')
       on conflict (id) do nothing`,
      [DONO_A, DONO_B],
    );

    c = await t.asService(async (db) => {
      const lojas = await db.query<{ id: string; dono_id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo) values
           ($1, 'loja-a-tripla-274', 'Loja A 274 Tripla', true),
           ($2, 'loja-b-tripla-274', 'Loja B 274 Tripla', true)
         returning id, dono_id`,
        [DONO_A, DONO_B],
      );
      const lojaA = lojas.rows.find((l) => l.dono_id === DONO_A)!.id;
      const lojaB = lojas.rows.find((l) => l.dono_id === DONO_B)!.id;

      const produtos = await db.query<{ id: string; loja_id: string }>(
        `insert into public.produtos (loja_id, nome, preco) values
           ($1, 'Feijoada A 274', 30.00),
           ($2, 'Feijoada B 274', 30.00)
         returning id, loja_id`,
        [lojaA, lojaB],
      );
      const produtoA = produtos.rows.find((p) => p.loja_id === lojaA)!.id;
      const produtoB = produtos.rows.find((p) => p.loja_id === lojaB)!.id;

      const cardapios = await db.query<{ id: string; loja_id: string }>(
        `insert into public.cardapios (loja_id, nome, modo, dias_semana, hora_inicio, hora_fim, ativo)
         values
           ($1, 'Semana A 274', 'recorrente', array[1,2,3,4,5]::smallint[], time '11:00', time '15:00', true),
           ($2, 'Semana B 274', 'recorrente', array[1,2,3,4,5]::smallint[], time '11:00', time '15:00', true)
         returning id, loja_id`,
        [lojaA, lojaB],
      );
      const cardapioA = cardapios.rows.find((r) => r.loja_id === lojaA)!.id;
      const cardapioB = cardapios.rows.find((r) => r.loja_id === lojaB)!.id;

      const vinculos = await db.query<{ id: string; loja_id: string }>(
        `insert into public.cardapio_produtos (loja_id, cardapio_id, produto_id, dias_semana)
         values
           ($1, $3, $5, array[1]::smallint[]),
           ($2, $4, $6, array[2]::smallint[])
         returning id, loja_id`,
        [lojaA, lojaB, cardapioA, cardapioB, produtoA, produtoB],
      );
      const vinculoA = vinculos.rows.find((v) => v.loja_id === lojaA)!.id;
      const vinculoB = vinculos.rows.find((v) => v.loja_id === lojaB)!.id;

      return { lojaA, lojaB, cardapioA, cardapioB, produtoA, produtoB, vinculoA, vinculoB };
    });
  });

  afterAll(async () => {
    await t.close();
  });

  async function diasReais(id: string): Promise<number[] | null> {
    const r = await t.asService(async (db) =>
      db.query<LinhaVinculo>(`select dias_semana from public.cardapio_produtos where id = $1`, [
        id,
      ]),
    );
    return r.rows[0].dias_semana;
  }

  // ────────────────────── caminho feliz: a mesma forma do lojista e do admin

  it("[lojista] dono grava a PRÓPRIA agenda pela tripla — 1 linha, valor gravado", async () => {
    const antes = await diasReais(c.vinculoA);
    expect(antes).toEqual([1]);

    const afetadas = await t.asUser(DONO_A, async (db) => {
      const up = await db.query(UPDATE_PELA_TRIPLA, [c.lojaA, c.cardapioA, c.produtoA, [3, 5]]);
      return up.affectedRows ?? 0;
    });
    expect(afetadas).toBe(1);
    expect(await diasReais(c.vinculoA)).toEqual([3, 5]);
  });

  it("[admin/service_role] a MESMA tripla, sob BYPASSRLS — 1 linha, valor gravado", async () => {
    const afetadas = await t.asService(async (db) => {
      const up = await db.query(UPDATE_PELA_TRIPLA, [c.lojaB, c.cardapioB, c.produtoB, [0, 6]]);
      return up.affectedRows ?? 0;
    });
    expect(afetadas).toBe(1);
    expect(await diasReais(c.vinculoB)).toEqual([0, 6]);
  });

  // ─────────────── RLS: a tripla sob outro dono não casa nada (rede de trás)

  it("[lojista] OUTRO dono, mesma tripla completa (com o loja_id verdadeiro do vínculo) — RLS barra, 0 linhas", async () => {
    const antes = await diasReais(c.vinculoA);
    const afetadas = await t.asUser(DONO_B, async (db) => {
      const up = await db.query(UPDATE_PELA_TRIPLA, [c.lojaA, c.cardapioA, c.produtoA, [4]]);
      return up.affectedRows ?? 0;
    });
    expect(afetadas).toBe(0);
    expect(await diasReais(c.vinculoA)).toEqual(antes);
  });

  // ─────── service_role: a FK composta, não a RLS, é o que protege aqui ────
  //
  // Reproduz a única forma de erro/ataque que sobrevive sob BYPASSRLS: o
  // `lojaId` da URL admin (verdadeiro, validado) combinado com um
  // `cardapio_id`/`produto_id` que o cliente conhece de OUTRA loja. Nenhuma
  // linha real satisfaz essa combinação — as FKs compostas garantem que toda
  // linha de `cardapio_produtos` tem `cardapio_id` e `produto_id` da MESMA
  // loja que ela própria declara.

  it("[admin] loja_id correto (lojaA) + cardapio_id/produto_id de OUTRA loja (B) — 0 linhas, nada muda em B", async () => {
    const antesB = await diasReais(c.vinculoB);
    const afetadas = await t.asService(async (db) => {
      const up = await db.query(UPDATE_PELA_TRIPLA, [c.lojaA, c.cardapioB, c.produtoB, [1, 2, 3]]);
      return up.affectedRows ?? 0;
    });
    expect(afetadas).toBe(0);
    // A linha de B, que a tripla hostil mirava, continua intacta.
    expect(await diasReais(c.vinculoB)).toEqual(antesB);
  });

  it("[admin] loja_id correto (lojaB) + cardapio_id de A + produto_id de B (mistura) — 0 linhas", async () => {
    const antesB = await diasReais(c.vinculoB);
    const afetadas = await t.asService(async (db) => {
      const up = await db.query(UPDATE_PELA_TRIPLA, [c.lojaB, c.cardapioA, c.produtoB, [1]]);
      return up.affectedRows ?? 0;
    });
    expect(afetadas).toBe(0);
    expect(await diasReais(c.vinculoB)).toEqual(antesB);
  });

  it("[admin] par (cardapio_id, produto_id) existe mas NÃO está vinculado (cardapioA + produtoB) — 0 linhas", async () => {
    // produtoB nunca foi vinculado a cardapioA: não existe linha nenhuma com
    // esse par, vinculado ou não — é o caso "par inexistente" da spec (A7),
    // provado aqui em SQL real, não só no mock da action.
    const afetadas = await t.asService(async (db) => {
      const up = await db.query(UPDATE_PELA_TRIPLA, [c.lojaA, c.cardapioA, c.produtoB, [1]]);
      return up.affectedRows ?? 0;
    });
    expect(afetadas).toBe(0);
  });
});
