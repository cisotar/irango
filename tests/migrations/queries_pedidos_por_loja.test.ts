import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 130 — Variantes de query de pedidos escopadas por
 * `lojaId` sob `service_role` (camada 1: SQL/RLS real).
 *
 * Esta camada NÃO importa `src/lib/supabase/queries/pedidos.ts` (pglite não é
 * PostgREST/supabase-js). Prova o CONTRATO DE SEGURANÇA que
 * `listarPedidosDaLoja(svc, lojaId)` / `buscarPedidoDaLoja(svc, lojaId, id)`
 * PRECISAM respeitar: roda o SQL equivalente sob `asService` (BYPASSRLS) — que é
 * EXATAMENTE onde a RLS NÃO protege. A isolação cross-tenant, neste role, vem
 * SÓ do `.eq("loja_id", lojaId)` na query.
 *
 * Quem cai vermelho por falta de código é a camada 2 (mock, funções inexistentes).
 * Esta camada 1 sustenta o critério de aceite crítico (isolamento) provando, no
 * SQL real, que:
 *   - com o escopo por loja_id, a loja A NUNCA vê o pedido de B (cases 6, 7);
 *   - SEM o escopo, sob service_role, A e B vazam juntas (case 8) — prova que o
 *     bug seria REAL e justifica a existência da função.
 *
 * Anti-falso-verde (padrão de queries_pedidos.test.ts): toda ausência é
 * reconferida via `existeId` (a linha REALMENTE existe; a ausência é pelo
 * `.eq("loja_id")`, nunca por dado faltando).
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
// Dono exclusivo da loja vazia (130-SQL-7) — lojas(dono_id) tem UNIQUE INDEX
// (lojas_dono_unico); reusar DONO_A/DONO_B para uma 2ª loja violaria a constraint.
const DONO_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";

type Cenario = {
  lojaA: string;
  lojaB: string;
  pedidoA: string; // pedido da loja A (com 1 item)
  pedidoB: string; // pedido da loja B
  itemA: string; // item do pedido A
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

/** Cenário base via service (bypass RLS): loja A com pedido+item, loja B com pedido. */
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

    const pedidoA = await ins(
      `insert into public.pedidos (loja_id, nome_cliente, subtotal, total)
         values ($1,'Cliente A',50.00,50.00) returning id`,
      [lojaA],
    );
    const pedidoB = await ins(
      `insert into public.pedidos (loja_id, nome_cliente, subtotal, total)
         values ($1,'Cliente B',30.00,30.00) returning id`,
      [lojaB],
    );
    const itemA = await ins(
      `insert into public.itens_pedido (pedido_id, nome, preco, quantidade) values ($1,'Item A',50.00,1) returning id`,
      [pedidoA],
    );

    return { lojaA, lojaB, pedidoA, pedidoB, itemA };
  });
}

async function existeId(t: TestDb, tabela: string, id: string): Promise<boolean> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.${tabela} where id = $1`, [id]),
  );
  return r.rows.length > 0;
}

describe("130 queries de pedidos escopadas por lojaId — contrato SQL sob service_role (camada 1)", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    c = await criarCenario(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ───────────────────────── listarPedidosDaLoja → escopo por loja_id
  it("[130-SQL-1] listarPedidosDaLoja (ISOLAMENTO, crítico): service com WHERE loja_id = lojaA traz SÓ o pedido de A — o pedido de B NUNCA aparece", async () => {
    // SQL equivalente: from('pedidos').select('*, itens_pedido(*)')
    //   .eq('loja_id', lojaA).order('criado_em', desc)
    const r = await t.asService((db) =>
      db.query<{ id: string }>(
        `select id from public.pedidos where loja_id = $1 order by criado_em desc`,
        [c.lojaA],
      ),
    );
    const ids = r.rows.map((x) => x.id);
    expect(ids).toContain(c.pedidoA);
    expect(ids).not.toContain(c.pedidoB);
    // anti-falso-verde: o pedido de B REALMENTE existe; a ausência é pelo .eq('loja_id')
    expect(await existeId(t, "pedidos", c.pedidoB)).toBe(true);
  });

  it("[130-SQL-2] listarPedidosDaLoja: paridade — a loja A vê EXATAMENTE seu(s) pedido(s), nem a mais nem a menos", async () => {
    const r = await t.asService((db) =>
      db.query<{ id: string }>(`select id from public.pedidos where loja_id = $1`, [c.lojaA]),
    );
    expect(r.rows.map((x) => x.id)).toEqual([c.pedidoA]);
  });

  // ───────────────────────── buscarPedidoDaLoja → duplo escopo loja_id + id
  it("[130-SQL-3] buscarPedidoDaLoja (DETALHE cross-loja, crítico): WHERE loja_id = lojaA AND id = <pedido de B> → 0 linhas (null)", async () => {
    // Um id VÁLIDO de B não pode vazar pelo detalhe de A: o .eq('loja_id') filtra antes.
    const r = await t.asService((db) =>
      db.query(`select * from public.pedidos where loja_id = $1 and id = $2`, [
        c.lojaA,
        c.pedidoB,
      ]),
    );
    expect(r.rows.length).toBe(0); // maybeSingle → null
    // anti-falso-verde: o pedido de B existe; a negação é pelo par (loja_id, id)
    expect(await existeId(t, "pedidos", c.pedidoB)).toBe(true);
  });

  it("[130-SQL-4] buscarPedidoDaLoja: WHERE loja_id = lojaA AND id = <pedido de A> → 1 linha (o próprio pedido)", async () => {
    const r = await t.asService((db) =>
      db.query<{ id: string }>(
        `select * from public.pedidos where loja_id = $1 and id = $2`,
        [c.lojaA, c.pedidoA],
      ),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(c.pedidoA);
  });

  // ───────────────────────── contraste: prova que o bug seria REAL
  it("[130-SQL-5] CONTRASTE (prova que o bug é real): SEM .eq('loja_id'), service lê A E B (2 linhas) — sob service_role a isolação depende SÓ do .eq", async () => {
    // Este é o comportamento perigoso que a função existe para PREVENIR: sob
    // service_role (BYPASSRLS) um select amplo enxerga TODAS as lojas.
    const r = await t.asService((db) =>
      db.query<{ id: string }>(`select id from public.pedidos`),
    );
    const ids = r.rows.map((x) => x.id);
    expect(ids).toContain(c.pedidoA);
    expect(ids).toContain(c.pedidoB); // ← o vazamento que o .eq('loja_id') impede
    expect(r.rows.length).toBeGreaterThanOrEqual(2);
  });

  // ───────────────────────── filtro de status COMBINADO com isolamento
  it("[130-SQL-6] listarPedidosDaLoja (ISOLAMENTO + FILTRO combinados, crítico): loja_id=lojaA AND status='pendente' NÃO traz o pedido de B mesmo com o MESMO status", async () => {
    // Ambos os pedidos nascem com status default 'pendente' (schema). Isto prova
    // que o AND do filtro por status não abre uma segunda via de vazamento: a
    // loja A não vê o pedido de B mesmo quando o filtro de status BATE nos dois.
    // O mock da camada 2 (pedidos.test.ts) NÃO consegue provar isto: ele só
    // registra QUE `.eq('loja_id',...)` e `.eq('status',...)` foram chamados
    // (o builder mockado é um único objeto compartilhado), não que ambos filtram
    // a MESMA query real no Postgres — só o SQL real prova a combinação AND.
    const r = await t.asService((db) =>
      db.query<{ id: string }>(
        `select id from public.pedidos where loja_id = $1 and status = $2 order by criado_em desc`,
        [c.lojaA, "pendente"],
      ),
    );
    const ids = r.rows.map((x) => x.id);
    expect(ids).toContain(c.pedidoA);
    expect(ids).not.toContain(c.pedidoB);
    // anti-falso-verde: confirma que B REALMENTE compartilha o mesmo status — a
    // ausência acima é pelo .eq('loja_id'), não porque os status divergem.
    const statusB = await t.asService((db) =>
      db.query<{ status: string }>(`select status from public.pedidos where id = $1`, [
        c.pedidoB,
      ]),
    );
    expect(statusB.rows[0].status).toBe("pendente");
  });

  // ───────────────────────── lista vazia (borda)
  it("[130-SQL-7] listarPedidosDaLoja: loja sem NENHUM pedido → 0 linhas (lista vazia, nunca erro nem linha de outra loja)", async () => {
    // auth.users só tem GRANT SELECT para service_role (bootstrap do harness) —
    // o insert do dono precisa do client superuser (t.db), igual a garantirDonos.
    await t.db.query(
      `insert into auth.users (id, email) values ($1, 'dono-c@teste.local')
         on conflict (id) do nothing`,
      [DONO_C],
    );
    const lojaVazia = await t.asService(async (db) => {
      const r = await db.query<{ id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo)
           values ($1,'loja-vazia','Loja Vazia',true) returning id`,
        [DONO_C],
      );
      return r.rows[0].id;
    });
    const r = await t.asService((db) =>
      db.query<{ id: string }>(`select id from public.pedidos where loja_id = $1`, [lojaVazia]),
    );
    expect(r.rows).toEqual([]);
    // anti-falso-verde: a loja recém-criada existe de fato (a lista vazia é por
    // ausência real de pedidos, não porque a loja não foi persistida)
    expect(await existeId(t, "lojas", lojaVazia)).toBe(true);
  });
});
