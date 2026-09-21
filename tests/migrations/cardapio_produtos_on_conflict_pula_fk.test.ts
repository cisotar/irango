import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * [AUDITORIA 269 — prova; o fix é a issue 270] `aplicarCardapioEmProdutosAdmin` afirma que
 * "id alheio ou inexistente derruba o lote inteiro pelas FKs compostas". A
 * afirmação falha num caso: quando o par (cardapio_id, produto_id) JÁ EXISTE
 * na loja dona dele. O `ON CONFLICT (cardapio_id, produto_id) DO NOTHING` que
 * `ignoreDuplicates: true` gera descarta a linha ANTES de a FK composta ser
 * avaliada — o upsert termina sem erro, a action devolve `ok: true` e
 * `registrarAcessoAdmin` grava `cardapio.aplicar_produtos` com `entidade_id` =
 * cardápio de OUTRA loja sob `loja_id` = loja-alvo.
 *
 * Nada é gravado em `cardapio_produtos` (a invariante multitenant segue
 * intacta); o efeito é (a) sucesso reportado por escrita que não aconteceu e
 * (b) linha de auditoria apontando para entidade alheia.
 */
const DONO_A = "a9000000-0000-4000-8000-000000000011";
const DONO_B = "b9000000-0000-4000-8000-000000000012";

const UPSERT_COMO_SUPABASE_JS = `
  insert into public.cardapio_produtos (cardapio_id, produto_id, loja_id)
  values ($1, $2, $3)
  on conflict (cardapio_id, produto_id) do nothing`;

describe("auditoria 269 · ON CONFLICT DO NOTHING pula a FK composta quando o par alheio já existe", () => {
  let t: TestDb;
  let lojaA: string;
  let lojaB: string;
  let cardapioB: string;
  let produtoB1: string;
  let produtoB2: string;

  beforeAll(async () => {
    t = await createTestDb();
    await t.db.query(
      `insert into auth.users (id, email) values ($1, 'a-aud269@teste.local'), ($2, 'b-aud269@teste.local')
       on conflict (id) do nothing`,
      [DONO_A, DONO_B],
    );
    await t.asService(async (db) => {
      const lojas = await db.query<{ id: string; dono_id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo) values
           ($1, 'loja-a-aud269', 'Loja A', true), ($2, 'loja-b-aud269', 'Loja B', true)
         returning id, dono_id`,
        [DONO_A, DONO_B],
      );
      lojaA = lojas.rows.find((l) => l.dono_id === DONO_A)!.id;
      lojaB = lojas.rows.find((l) => l.dono_id === DONO_B)!.id;

      const prods = await db.query<{ id: string }>(
        `insert into public.produtos (loja_id, nome, preco) values ($1, 'B1', 10), ($1, 'B2', 10) returning id`,
        [lojaB],
      );
      [produtoB1, produtoB2] = prods.rows.map((r) => r.id);

      const card = await db.query<{ id: string }>(
        `insert into public.cardapios (loja_id, nome, modo, dias_semana)
         values ($1, 'Card B', 'recorrente', array[1]::smallint[]) returning id`,
        [lojaB],
      );
      cardapioB = card.rows[0].id;

      // O par (cardapioB, produtoB1) existe LEGITIMAMENTE na loja B.
      await db.query(
        `insert into public.cardapio_produtos (cardapio_id, produto_id, loja_id) values ($1, $2, $3)`,
        [cardapioB, produtoB1, lojaB],
      );
    });
  }, 120_000);

  afterAll(async () => {
    await t.close();
  });

  it("CONTROLE: par alheio que NÃO existe é derrubado pela FK composta (23503)", async () => {
    let code = "";
    try {
      await t.asService((db) =>
        db.query(UPSERT_COMO_SUPABASE_JS, [cardapioB, produtoB2, lojaA]),
      );
    } catch (e) {
      code = (e as { code: string }).code;
    }
    expect(code).toBe("23503");
  });

  it("BRECHA: par alheio que JÁ existe passa sem erro sob service_role — a FK nunca é avaliada", async () => {
    const r = await t.asService((db) =>
      db.query(UPSERT_COMO_SUPABASE_JS, [cardapioB, produtoB1, lojaA]),
    );
    // Sem exceção ⇒ a action devolveria `ok: true` e logaria o acesso.
    expect(r.affectedRows ?? 0).toBe(0);

    const vinculo = await t.asService(async (db) => {
      const q = await db.query<{ loja_id: string }>(
        `select loja_id from public.cardapio_produtos where cardapio_id = $1 and produto_id = $2`,
        [cardapioB, produtoB1],
      );
      return q.rows;
    });
    // Invariante intacta: a linha continua da loja B; nada foi gravado na A.
    expect(vinculo).toHaveLength(1);
    expect(vinculo[0].loja_id).toBe(lojaB);
  });

  it("o MESMO vale para o LOJISTA (RLS só olha cardapio_produtos.loja_id): sucesso mudo, nada gravado", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(UPSERT_COMO_SUPABASE_JS, [cardapioB, produtoB1, lojaA]),
    );
    expect(r.affectedRows ?? 0).toBe(0);
  });
});
