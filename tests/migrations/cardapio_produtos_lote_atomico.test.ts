import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 251 — a METADE DE BANCO do cenário 5 (RN-09).
 *
 * `tests/migrations/cardapio_produtos_fks_compostas_rls.test.ts` (issue 243)
 * prova as FKs compostas UMA LINHA POR VEZ. O que falta, e é o critério de
 * aceite literal da 251, é a propriedade de LOTE:
 *
 *   o lojista da Loja A manda `[p1, p2, pB, p3]` — um `insert ... values` com
 *   as QUATRO linhas, uma instrução, uma transação, como o
 *   `.upsert(linhas, { onConflict: "cardapio_id,produto_id",
 *                      ignoreDuplicates: true })` do PostgREST emite —
 *   e NENHUMA linha nova aparece, nem para `p1`, `p2`, `p3`. É tudo ou nada,
 *   não "grava os válidos": gravar parcialmente confirmaria, pela diferença
 *   entre pedido e resultado, QUAIS ids existem em outra loja.
 *
 * A asserção afirma o NOME da constraint (`cardapio_produtos_produto_fk`) e não
 * só o SQLSTATE `23503` — uma trava de escopo passa por acidente quando só se
 * checa o código do erro (lição "SQLSTATE não basta em teste de escopo").
 *
 * O `on conflict do nothing` está PRESENTE no statement de propósito: é preciso
 * provar que ele NÃO engole o `23503`. Ele só absorve violação de UNIQUE.
 *
 * Nenhum código de produção é escrito aqui.
 */

const DONO_A = "a5100000-0000-4000-8000-000000000001";
const DONO_B = "b5100000-0000-4000-8000-000000000002";

/** O statement que o `.upsert(...)` homogêneo do PostgREST produz. */
const UPSERT_LOTE = `
  insert into public.cardapio_produtos (loja_id, cardapio_id, produto_id)
  select $1, $2, x from unnest($3::uuid[]) as x
  on conflict (cardapio_id, produto_id) do nothing
`;

type Cenario = {
  lojaA: string;
  cardapioA: string;
  cardapioB: string;
  p1: string;
  p2: string;
  p3: string;
  pB: string;
};

async function erroAoChamar(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("O lote foi ACEITO — esperava-se recusa da operação inteira.");
}

describe("251 · ação em lote: o upsert homogêneo é tudo-ou-nada (RN-09, cenário 5)", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();

    await t.db.query(
      `insert into auth.users (id, email) values
         ($1, 'dono-a-251@teste.local'),
         ($2, 'dono-b-251@teste.local')
       on conflict (id) do nothing`,
      [DONO_A, DONO_B],
    );

    c = await t.asService(async (db) => {
      const lojas = await db.query<{ id: string; dono_id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo) values
           ($1, 'loja-a-lote-251', 'Loja A', true),
           ($2, 'loja-b-lote-251', 'Loja B', true)
         returning id, dono_id`,
        [DONO_A, DONO_B],
      );
      const lojaA = lojas.rows.find((l) => l.dono_id === DONO_A)!.id;
      const lojaB = lojas.rows.find((l) => l.dono_id === DONO_B)!.id;

      const pa = await db.query<{ id: string }>(
        `insert into public.produtos (loja_id, nome, preco) values
           ($1, 'P1', 10.00), ($1, 'P2', 10.00), ($1, 'P3', 10.00)
         returning id`,
        [lojaA],
      );
      const pb = await db.query<{ id: string }>(
        `insert into public.produtos (loja_id, nome, preco) values ($1, 'PB', 10.00) returning id`,
        [lojaB],
      );
      const cardapios = await db.query<{ id: string; loja_id: string }>(
        `insert into public.cardapios (loja_id, nome, modo, dias_semana, hora_inicio, hora_fim)
         values
           ($1, 'Inverno A', 'recorrente', array[6]::smallint[], time '11:00', time '15:00'),
           ($2, 'Inverno B', 'recorrente', array[6]::smallint[], time '11:00', time '15:00')
         returning id, loja_id`,
        [lojaA, lojaB],
      );

      return {
        lojaA,
        cardapioA: cardapios.rows.find((r) => r.loja_id === lojaA)!.id,
        cardapioB: cardapios.rows.find((r) => r.loja_id === lojaB)!.id,
        p1: pa.rows[0].id,
        p2: pa.rows[1].id,
        p3: pa.rows[2].id,
        pB: pb.rows[0].id,
      };
    });
  });

  afterAll(async () => {
    await t.close();
  });

  /** Todos os vínculos existentes para os 4 ids, em qualquer cardápio/loja. */
  async function vinculosDosQuatro(): Promise<string[]> {
    return t.asService(async (db) => {
      const r = await db.query<{ produto_id: string }>(
        `select produto_id from public.cardapio_produtos where produto_id = any($1::uuid[])`,
        [[c.p1, c.p2, c.pB, c.p3]],
      );
      return r.rows.map((x) => x.produto_id);
    });
  }

  it("[cenário 5] [p1, p2, pB, p3] ⇒ 23503 com `cardapio_produtos_produto_fk` e ZERO linha nova para os QUATRO ids", async () => {
    expect(await vinculosDosQuatro()).toHaveLength(0);

    const msg = await erroAoChamar(() =>
      t.asUser(DONO_A, async (db) =>
        db.query(UPSERT_LOTE, [c.lojaA, c.cardapioA, [c.p1, c.p2, c.pB, c.p3]]),
      ),
    );
    // O NOME da constraint prova QUAL armadilha disparou — não só que algo falhou.
    expect(msg).toContain("cardapio_produtos_produto_fk");
    expect(msg).toMatch(/foreign key|violates/i);
    // `on conflict do nothing` NÃO engole o 23503.
    expect(await vinculosDosQuatro()).toHaveLength(0);
  });

  it("[cenário 5 · controle] o MESMO lote sem `pB` grava os três — a recusa acima foi do id alheio, não do statement", async () => {
    const r = await t.asUser(DONO_A, async (db) =>
      db.query(UPSERT_LOTE, [c.lojaA, c.cardapioA, [c.p1, c.p2, c.p3]]),
    );
    expect(r.affectedRows).toBe(3);
    expect((await vinculosDosQuatro()).sort()).toEqual([c.p1, c.p2, c.p3].sort());
  });

  it("[RN-10] reaplicar o MESMO lote é idempotente: 0 linhas novas, nenhuma duplicata", async () => {
    const r = await t.asUser(DONO_A, async (db) =>
      db.query(UPSERT_LOTE, [c.lojaA, c.cardapioA, [c.p1, c.p2, c.p3]]),
    );
    expect(r.affectedRows).toBe(0);
    expect(await vinculosDosQuatro()).toHaveLength(3);
  });

  it("[cardápio alheio] lote com `cardapio_id` da loja B ⇒ `cardapio_produtos_cardapio_fk`, nada gravado", async () => {
    const antes = (await vinculosDosQuatro()).length;
    const msg = await erroAoChamar(() =>
      t.asUser(DONO_A, async (db) =>
        db.query(UPSERT_LOTE, [c.lojaA, c.cardapioB, [c.p1, c.p2, c.p3]]),
      ),
    );
    expect(msg).toContain("cardapio_produtos_cardapio_fk");
    expect(await vinculosDosQuatro()).toHaveLength(antes);
  });

  it("[cenário 5 · sob service_role] BYPASSRLS não salva: o lote com `pB` continua caindo na FK", async () => {
    // A FK NÃO é RLS. Mesmo a via de serviço (que não existe na v1) seria
    // recusada por construção — a garantia não depende de policy.
    const antes = (await vinculosDosQuatro()).length;
    const msg = await erroAoChamar(() =>
      t.asService(async (db) =>
        db.query(UPSERT_LOTE, [c.lojaA, c.cardapioA, [c.p1, c.pB]]),
      ),
    );
    expect(msg).toContain("cardapio_produtos_produto_fk");
    expect(await vinculosDosQuatro()).toHaveLength(antes);
  });
});
