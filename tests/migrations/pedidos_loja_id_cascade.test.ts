import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 083 — `pedidos.loja_id` → ON DELETE CASCADE.
 *
 * Hoje a FK `pedidos.loja_id` nasce no schema_inicial como
 *   `loja_id uuid not null references public.lojas(id)`  (schema_inicial:135)
 * SEM `on delete` ⇒ NO ACTION/RESTRICT. Logo `DELETE FROM lojas` numa loja com
 * pedidos LANÇA violação de FK e o hard delete (issue 084) é impossível.
 *
 * A fase GREEN cria `supabase/migrations/<ts>_pedidos_loja_id_cascade.sql`:
 *   alter table public.pedidos drop constraint if exists pedidos_loja_id_fkey;
 *   alter table public.pedidos add constraint pedidos_loja_id_fkey
 *     foreign key (loja_id) references public.lojas(id) on delete cascade;
 *
 * Estes testes rodam o SQL REAL das migrations no pglite. RED hoje:
 *   - DELETE da loja com pedidos lança erro de FK (regra ainda é RESTRICT).
 *   - information_schema.referential_constraints.delete_rule = 'NO ACTION'.
 *
 * Anti-falso-verde: inserções via asService (BYPASSRLS) — o foco é a regra da
 * FK, não política de linha. E o cenário com 2 lojas prova que o cascade é
 * escopado: apagar A não derruba pedidos de B.
 */

let t: TestDb;

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-000000000001";
const DONO_B = "aaaaaaaa-aaaa-aaaa-aaaa-000000000002";

type Cenario = {
  lojaA: string;
  lojaB: string;
  pedidoA1: string;
  pedidoA2: string;
  pedidoB: string;
  itemA1: string;
  itemB: string;
};

/** Cenário base via service (bypass RLS): loja A com 2 pedidos (+item), loja B com 1 pedido (+item). */
async function criarCenario(): Promise<Cenario> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-cascade-a@teste.local'),
       ($2, 'dono-cascade-b@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B],
  );

  return t.asService(async (db) => {
    const ins = async (sql: string, params: unknown[]) => {
      const r = await db.query<{ id: string }>(sql, params);
      return r.rows[0].id;
    };

    const lojaA = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo)
         values ($1,'loja-cascade-a','Loja A',true) returning id`,
      [DONO_A],
    );
    const lojaB = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo)
         values ($1,'loja-cascade-b','Loja B',true) returning id`,
      [DONO_B],
    );

    const pedidoA1 = await ins(
      `insert into public.pedidos (loja_id, nome_cliente, subtotal, total)
         values ($1,'Cliente A1',50.00,50.00) returning id`,
      [lojaA],
    );
    const pedidoA2 = await ins(
      `insert into public.pedidos (loja_id, nome_cliente, subtotal, total)
         values ($1,'Cliente A2',20.00,20.00) returning id`,
      [lojaA],
    );
    const pedidoB = await ins(
      `insert into public.pedidos (loja_id, nome_cliente, subtotal, total)
         values ($1,'Cliente B',30.00,30.00) returning id`,
      [lojaB],
    );

    const itemA1 = await ins(
      `insert into public.itens_pedido (pedido_id, nome, preco, quantidade)
         values ($1,'Item A1',50.00,1) returning id`,
      [pedidoA1],
    );
    const itemB = await ins(
      `insert into public.itens_pedido (pedido_id, nome, preco, quantidade)
         values ($1,'Item B',30.00,1) returning id`,
      [pedidoB],
    );

    return { lojaA, lojaB, pedidoA1, pedidoA2, pedidoB, itemA1, itemB };
  });
}

async function contar(tabela: string, coluna: string, id: string): Promise<number> {
  return t.asService(async (db) => {
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.${tabela} where ${coluna} = $1`,
      [id],
    );
    return r.rows[0].n;
  });
}

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t?.close?.();
});

describe("083 pedidos.loja_id — ON DELETE CASCADE", () => {
  it("DELETE da loja com pedidos NÃO lança e apaga pedidos + itens da loja", async () => {
    const c = await criarCenario();

    // RED hoje: a FK é RESTRICT, então este DELETE lança violação de FK.
    await expect(
      t.asService((db) => db.query(`delete from public.lojas where id = $1`, [c.lojaA])),
    ).resolves.toBeDefined();

    // Loja apagada.
    expect(await contar("lojas", "id", c.lojaA)).toBe(0);
    // Pedidos da loja A cascateados.
    expect(await contar("pedidos", "loja_id", c.lojaA)).toBe(0);
    // Itens dos pedidos da loja A cascateados (via itens_pedido.pedido_id → pedidos).
    expect(await contar("itens_pedido", "pedido_id", c.pedidoA1)).toBe(0);
  });

  it("information_schema confirma delete_rule = 'CASCADE' para pedidos_loja_id_fkey", async () => {
    const r = await t.asService((db) =>
      db.query<{ delete_rule: string }>(
        `select rc.delete_rule
           from information_schema.referential_constraints rc
          where rc.constraint_name = 'pedidos_loja_id_fkey'`,
      ),
    );

    // RED hoje: delete_rule = 'NO ACTION' (RESTRICT) enquanto a migration não existe.
    expect(r.rows[0]?.delete_rule).toBe("CASCADE");
  });

  it("loja SEM pedidos é deletada via service_role sem erro (caminho feliz do hard delete)", async () => {
    // Garante que o hard delete administrativo (issue 084) funciona quando a loja
    // não tem histórico de pedidos — sem pedidos não há cascade, mas a própria
    // remoção da loja deve ser permitida ao service_role (BYPASSRLS).
    // Bug potencial: constraint ou trigger que bloqueie DELETE mesmo sem filhos.
    const DONO_VAZIO = "cccccccc-cccc-cccc-cccc-000000000001";

    // auth.users requer superuser (service_role só tem SELECT em auth).
    await t.db.query(
      `insert into auth.users (id, email) values ($1, 'dono-vazio@teste.local') on conflict (id) do nothing`,
      [DONO_VAZIO],
    );

    const lojaVazia = await t.asService(async (db) => {
      const r = await db.query<{ id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo)
           values ($1,'loja-vazia-cascade','Loja Vazia',true) returning id`,
        [DONO_VAZIO],
      );
      return r.rows[0].id;
    });

    // Confirma que a loja existe e não tem pedidos antes de deletar.
    expect(await contar("lojas", "id", lojaVazia)).toBe(1);
    expect(await contar("pedidos", "loja_id", lojaVazia)).toBe(0);

    // DELETE via service_role deve resolver sem violação de constraint.
    await expect(
      t.asService((db) => db.query(`delete from public.lojas where id = $1`, [lojaVazia])),
    ).resolves.toBeDefined();

    expect(await contar("lojas", "id", lojaVazia)).toBe(0);
  });

  it("anti-falso-verde: apagar loja A NÃO derruba pedidos/itens da loja B", async () => {
    const c = await criarCenario();

    await t.asService((db) => db.query(`delete from public.lojas where id = $1`, [c.lojaA]));

    // Loja B e seus filhos intactos — o cascade é escopado à FK de pedidos.loja_id.
    expect(await contar("lojas", "id", c.lojaB)).toBe(1);
    expect(await contar("pedidos", "loja_id", c.lojaB)).toBe(1);
    expect(await contar("pedidos", "id", c.pedidoB)).toBe(1);
    expect(await contar("itens_pedido", "pedido_id", c.pedidoB)).toBe(1);
  });
});
