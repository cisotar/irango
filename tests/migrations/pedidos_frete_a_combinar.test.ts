import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Issue 180-B — fase EXPAND do frete "a combinar".
 * Migrations: 20260913120000_pedidos_frete_a_combinar.sql
 *             20260913121000_rpc_criar_pedido_frete_a_combinar.sql
 *
 * O que estes testes travam:
 *  - SHAPE: `pedidos.frete_a_combinar` existe, é NOT NULL com DEFAULT false;
 *    `pedidos.taxa_entrega` virou NULLABLE (mantendo o DEFAULT 0).
 *  - CHECK `chk_pedidos_frete_a_combinar`: o par é amarrado nas 4 combinações.
 *    "a combinar com R$ 0,00" e "NULL órfão" são impossíveis de gravar.
 *  - RPC v17 grava a combinar, e a borda do `coalesce(p_taxa_entrega, 0)` na
 *    trava de cupom PERDIDA (sem ele o total viraria NULL).
 *  - ADITIVIDADE: o overload de 16 args continua chamável e NÃO ficou ambíguo
 *    (é o que mantém o código antigo vivo na janela de deploy).
 *  - RLS de `pedidos` segue correta com a coluna nova: anon não lê nada,
 *    lojista lê só a própria loja, lojista de outra loja recebe deny.
 *  - Grants: anon/authenticated continuam sem EXECUTE na RPC nova.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

type Cenario = { lojaA: string; lojaB: string; produtoA: string; cupomUmUso: string };

let t: TestDb;
let c: Cenario;

beforeAll(async () => {
  t = await createTestDb();
  await t.db.query(
    `insert into auth.users (id, email) values ($1,'dono-a@teste.local'), ($2,'dono-b@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B],
  );
  c = await t.asService(async (db) => {
    const ins = async (sql: string, params: unknown[]) =>
      (await db.query<{ id: string }>(sql, params)).rows[0].id;
    const lojaA = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-a','Loja A',true) returning id`,
      [DONO_A],
    );
    const lojaB = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-b','Loja B',true) returning id`,
      [DONO_B],
    );
    const produtoA = await ins(
      `insert into public.produtos (loja_id, nome, preco, disponivel) values ($1,'Pizza',25.00,true) returning id`,
      [lojaA],
    );
    const cupomUmUso = await ins(
      `insert into public.cupons (loja_id, codigo, tipo, valor, usos_maximos, usos_contagem, ativo)
         values ($1,'UMUSO','fixo',5.00,1,0,true) returning id`,
      [lojaA],
    );
    return { lojaA, lojaB, produtoA, cupomUmUso };
  });
});

afterAll(async () => {
  await t.close();
});

/** INSERT direto (service_role) — isola o CHECK da lógica da RPC. */
async function inserirPedido(p: {
  loja?: string;
  taxa: number | null;
  aCombinar?: boolean;
  total?: number;
}): Promise<string> {
  return t.asService(async (db) => {
    const r = await db.query<{ id: string }>(
      `insert into public.pedidos
         (loja_id, nome_cliente, subtotal, desconto, taxa_entrega, total, forma_pagamento, status, frete_a_combinar)
       values ($1,'Cliente',50,0,$2,$3,'pix','pendente',$4)
       returning id`,
      [p.loja ?? c.lojaA, p.taxa, p.total ?? 50, p.aCombinar ?? false],
    );
    return r.rows[0].id;
  });
}

/** RPC v17 — assinatura nova, 17 args nomeados. */
async function criarPedidoV17(p: {
  taxa: number | null;
  aCombinar: boolean;
  total: number;
  cupomId?: string | null;
  idem?: string | null;
}): Promise<{ pedido_id: string }> {
  return t.asService(async (db) => {
    const r = await db.query<{ pedido_id: string }>(
      `select * from public.criar_pedido(
         p_loja_id          => $1,
         p_nome_cliente     => 'Cliente',
         p_telefone_cliente => null,
         p_endereco_entrega => $2::jsonb,
         p_forma_pagamento  => 'pix',
         p_observacoes      => null,
         p_subtotal         => 50,
         p_taxa_entrega     => $3,
         p_desconto         => $4,
         p_total            => $5,
         p_cupom_id         => $6,
         p_cupom_codigo     => $7,
         p_itens            => $8::jsonb,
         p_tipo_entrega     => 'entrega',
         p_troco_para       => null,
         p_idempotency_key  => $9,
         p_frete_a_combinar => $10
       )`,
      [
        c.lojaA,
        JSON.stringify({ cep: "01000-000", rua: "R", numero: "1", bairro: "Centro" }),
        p.taxa,
        p.cupomId ? 5 : 0,
        p.total,
        p.cupomId ?? null,
        p.cupomId ? "UMUSO" : null,
        JSON.stringify([{ produto_id: c.produtoA, nome: "Pizza", preco: 25, quantidade: 2 }]),
        p.idem ?? null,
        p.aCombinar,
      ],
    );
    return r.rows[0];
  });
}

describe("180-B expand — shape de pedidos", () => {
  it("frete_a_combinar é boolean NOT NULL default false", async () => {
    const r = await t.db.query<{ data_type: string; is_nullable: string; column_default: string }>(
      `select data_type, is_nullable, column_default from information_schema.columns
        where table_schema='public' and table_name='pedidos' and column_name='frete_a_combinar'`,
    );
    expect(r.rows[0]).toMatchObject({ data_type: "boolean", is_nullable: "NO" });
    expect(r.rows[0].column_default).toBe("false");
  });

  it("taxa_entrega virou NULLABLE e manteve o DEFAULT 0", async () => {
    const r = await t.db.query<{ is_nullable: string; column_default: string }>(
      `select is_nullable, column_default from information_schema.columns
        where table_schema='public' and table_name='pedidos' and column_name='taxa_entrega'`,
    );
    expect(r.rows[0].is_nullable).toBe("YES");
    expect(r.rows[0].column_default).toContain("0");
  });

  it("o CHECK entrou NOT VALID (não varre a tabela no deploy)", async () => {
    const r = await t.db.query<{ convalidated: boolean }>(
      `select convalidated from pg_constraint
        where conname='chk_pedidos_frete_a_combinar' and conrelid='public.pedidos'::regclass`,
    );
    expect(r.rows[0].convalidated).toBe(false);
  });
});

describe("180-B expand — CHECK chk_pedidos_frete_a_combinar", () => {
  it("aceita false + taxa numérica (frete conhecido, inclusive 0 = grátis)", async () => {
    await expect(inserirPedido({ taxa: 7.5 })).resolves.toBeTruthy();
    await expect(inserirPedido({ taxa: 0 })).resolves.toBeTruthy();
  });

  it("aceita true + taxa NULL (a combinar)", async () => {
    await expect(inserirPedido({ taxa: null, aCombinar: true })).resolves.toBeTruthy();
  });

  it("REJEITA true + taxa 0 — 'a combinar' nunca pode virar R$ 0,00", async () => {
    await expect(inserirPedido({ taxa: 0, aCombinar: true })).rejects.toThrow(
      /chk_pedidos_frete_a_combinar/,
    );
  });

  it("REJEITA true + taxa numérica", async () => {
    await expect(inserirPedido({ taxa: 12, aCombinar: true })).rejects.toThrow(
      /chk_pedidos_frete_a_combinar/,
    );
  });

  it("REJEITA false + taxa NULL — NULL órfão sem intenção declarada", async () => {
    await expect(inserirPedido({ taxa: null, aCombinar: false })).rejects.toThrow(
      /chk_pedidos_frete_a_combinar/,
    );
  });
});

describe("180-B expand — RPC criar_pedido v17", () => {
  it("grava taxa_entrega NULL + frete_a_combinar true", async () => {
    const { pedido_id } = await criarPedidoV17({ taxa: null, aCombinar: true, total: 50 });
    const r = await t.asService((db) =>
      db.query<{ taxa_entrega: string | null; frete_a_combinar: boolean; total: string }>(
        `select taxa_entrega, frete_a_combinar, total from public.pedidos where id=$1`,
        [pedido_id],
      ),
    );
    expect(r.rows[0].taxa_entrega).toBeNull();
    expect(r.rows[0].frete_a_combinar).toBe(true);
    expect(Number(r.rows[0].total)).toBe(50);
  });

  it("caminho normal continua gravando a taxa e false", async () => {
    const { pedido_id } = await criarPedidoV17({ taxa: 8, aCombinar: false, total: 58 });
    const r = await t.asService((db) =>
      db.query<{ taxa_entrega: string; frete_a_combinar: boolean }>(
        `select taxa_entrega, frete_a_combinar from public.pedidos where id=$1`,
        [pedido_id],
      ),
    );
    expect(Number(r.rows[0].taxa_entrega)).toBe(8);
    expect(r.rows[0].frete_a_combinar).toBe(false);
  });

  it("coalesce(p_taxa_entrega, 0): cupom perdido na corrida + taxa NULL não produz total NULL", async () => {
    // 1ª chamada consome o cupom de uso único (usos_maximos = 1).
    await criarPedidoV17({ taxa: null, aCombinar: true, total: 45, cupomId: c.cupomUmUso });
    // 2ª chamada PERDE a corrida: desconto anulado, total recomposto.
    // Sem o coalesce, `p_subtotal + NULL` = NULL e a linha nem seria gravável.
    const { pedido_id } = await criarPedidoV17({
      taxa: null,
      aCombinar: true,
      total: 45,
      cupomId: c.cupomUmUso,
    });
    const r = await t.asService((db) =>
      db.query<{ total: string; desconto: string; cupom_codigo: string | null }>(
        `select total, desconto, cupom_codigo from public.pedidos where id=$1`,
        [pedido_id],
      ),
    );
    expect(r.rows[0].total).not.toBeNull();
    expect(Number(r.rows[0].total)).toBe(50); // subtotal 50 + frete 0
    expect(Number(r.rows[0].desconto)).toBe(0);
    expect(r.rows[0].cupom_codigo).toBeNull();
  });

  it("a RPC não fura o CHECK: true com taxa numérica aborta a transação", async () => {
    await expect(criarPedidoV17({ taxa: 8, aCombinar: true, total: 58 })).rejects.toThrow(
      /chk_pedidos_frete_a_combinar/,
    );
  });
});

describe("180-B expand — o overload de 16 args sobrevive (janela de deploy)", () => {
  it("as duas assinaturas coexistem", async () => {
    const r = await t.db.query<{ n: number }>(
      `select count(*)::int as n from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='criar_pedido'`,
    );
    expect(r.rows[0].n).toBe(2);
  });

  it("chamada de 16 args (código ANTIGO) continua resolvendo sem ambiguidade", async () => {
    // Se `p_frete_a_combinar` tivesse DEFAULT, isto falharia com
    // "function public.criar_pedido(...) is not unique" — exatamente o código
    // antigo que a fase expand precisa manter vivo.
    const r = await t.asService((db) =>
      db.query<{ pedido_id: string }>(
        `select * from public.criar_pedido(
           p_loja_id => $1, p_nome_cliente => 'Antigo', p_telefone_cliente => null,
           p_endereco_entrega => $2::jsonb, p_forma_pagamento => 'pix', p_observacoes => null,
           p_subtotal => 50, p_taxa_entrega => 9, p_desconto => 0, p_total => 59,
           p_cupom_id => null, p_cupom_codigo => null, p_itens => $3::jsonb,
           p_tipo_entrega => 'entrega', p_troco_para => null, p_idempotency_key => null
         )`,
        [
          c.lojaA,
          JSON.stringify({ cep: "01000-000", rua: "R", numero: "1", bairro: "Centro" }),
          JSON.stringify([{ produto_id: c.produtoA, nome: "Pizza", preco: 25, quantidade: 2 }]),
        ],
      ),
    );
    const pedidoId = r.rows[0].pedido_id;
    const lido = await t.asService((db) =>
      db.query<{ frete_a_combinar: boolean; taxa_entrega: string }>(
        `select frete_a_combinar, taxa_entrega from public.pedidos where id=$1`,
        [pedidoId],
      ),
    );
    // a função antiga não conhece a coluna: cai no DEFAULT false, coerente com o CHECK.
    expect(lido.rows[0].frete_a_combinar).toBe(false);
    expect(Number(lido.rows[0].taxa_entrega)).toBe(9);
  });

  it("anon e authenticated continuam sem EXECUTE na RPC de 17 args", async () => {
    const r = await t.db.query<{ anon: boolean; auth: boolean; svc: boolean }>(
      `select has_function_privilege('anon',   p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('service_role',  p.oid, 'execute') as svc
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public' and p.proname='criar_pedido' and p.pronargs = 17`,
    );
    expect(r.rows[0]).toEqual({ anon: false, auth: false, svc: true });
  });
});

describe("180-B expand — RLS de pedidos com a coluna nova", () => {
  it("anon não lê pedido nenhum (deny-all de SELECT), nem o a combinar", async () => {
    await inserirPedido({ taxa: null, aCombinar: true });
    const r = await t.asAnon((db) =>
      db.query<{ n: number }>(`select count(*)::int as n from public.pedidos`),
    );
    expect(r.rows[0].n).toBe(0);
  });

  it("lojista lê frete_a_combinar dos PRÓPRIOS pedidos", async () => {
    const id = await inserirPedido({ loja: c.lojaA, taxa: null, aCombinar: true });
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ frete_a_combinar: boolean }>(
        `select frete_a_combinar from public.pedidos where id=$1`,
        [id],
      ),
    );
    expect(r.rows[0].frete_a_combinar).toBe(true);
  });

  it("lojista de OUTRA loja não enxerga a linha (isolamento multitenant)", async () => {
    const id = await inserirPedido({ loja: c.lojaA, taxa: null, aCombinar: true });
    const r = await t.asUser(DONO_B, (db) =>
      db.query<{ n: number }>(`select count(*)::int as n from public.pedidos where id=$1`, [id]),
    );
    expect(r.rows[0].n).toBe(0);
  });

  it("lojista de OUTRA loja não consegue marcar o pedido alheio como a combinar", async () => {
    const id = await inserirPedido({ loja: c.lojaA, taxa: 10 });
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`update public.pedidos set frete_a_combinar = true, taxa_entrega = null where id=$1`, [
        id,
      ]),
    );
    expect(r.affectedRows ?? 0).toBe(0);
    const lido = await t.asService((db) =>
      db.query<{ frete_a_combinar: boolean }>(
        `select frete_a_combinar from public.pedidos where id=$1`,
        [id],
      ),
    );
    expect(lido.rows[0].frete_a_combinar).toBe(false);
  });
});
