import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 063 — idempotência da RPC `public.criar_pedido`.
 *
 * Comportamento que ainda NÃO existe (será a fase GREEN — duas migrations:
 * coluna `pedidos.idempotency_key uuid` + índice UNIQUE parcial
 * `(loja_id, idempotency_key) WHERE idempotency_key is not null`, e a RPC
 * ganhando o 16º parâmetro `p_idempotency_key uuid default null` com dedupe
 * ANTES da trava de cupom):
 *
 *  - DEDUP SEQUENCIAL: duas chamadas com a MESMA p_idempotency_key (mesma loja)
 *    retornam o MESMO pedido_id e token_acesso; só 1 INSERT em pedidos.
 *  - CUPOM USO ÚNICO não consome 2x: a 2ª chamada deduplicada NÃO incrementa
 *    usos_contagem (fica 1, não 2).
 *  - CHAVES DIFERENTES → pedidos distintos (idempotência não funde legítimos).
 *  - CHAVE NULL preserva comportamento atual (NULLs não colidem no índice
 *    parcial → 2 pedidos distintos).
 *
 * Por que é RED HOJE: a RPC atual tem 15 args (sem p_idempotency_key) e a coluna
 * `idempotency_key` não existe. Chamar a RPC com `p_idempotency_key => ...` falha
 * com "function ... does not exist", e o `select ... where idempotency_key = ...`
 * falha com "column ... does not exist". Output FAIL capturado abaixo (§RED).
 *
 * Anti-falso-verde: tudo roda via asService (BYPASSRLS) — a dedup observada vem
 * da LÓGICA da RPC/índice, nunca de RLS. As asserções afirmam o resultado
 * CONCRETO esperado (mesmo id, contagem 1), não a fórmula da produção.
 */

const DONO_IDEMP = "dddddddd-dddd-dddd-dddd-dddddddddddd";

type CenarioIdemp = {
  loja: string;
  produto: string; // preço 25.00
  cupomUmUso: string; // usos_maximos=1, usos_contagem=0
};

async function semearIdemp(t: TestDb): Promise<CenarioIdemp> {
  await t.db.query(
    `insert into auth.users (id, email) values ($1, 'dono-idemp@teste.local')
       on conflict (id) do nothing`,
    [DONO_IDEMP],
  );

  return t.asService(async (db) => {
    const ins = async (sql: string, params: unknown[]) => {
      const r = await db.query<{ id: string }>(sql, params);
      return r.rows[0].id;
    };

    const loja = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-idemp','Loja Idemp',true) returning id`,
      [DONO_IDEMP],
    );
    const produto = await ins(
      `insert into public.produtos (loja_id, nome, preco, disponivel) values ($1,'Pizza',25.00,true) returning id`,
      [loja],
    );
    const cupomUmUso = await ins(
      `insert into public.cupons (loja_id, codigo, tipo, valor, usos_maximos, usos_contagem, ativo)
         values ($1,'UMUSO','fixo',5.00,1,0,true) returning id`,
      [loja],
    );

    return { loja, produto, cupomUmUso };
  });
}

/**
 * Chama a RPC `public.criar_pedido` com os 15 args atuais MAIS o novo
 * `p_idempotency_key` (16º arg), por parâmetros nomeados. Executada como
 * service_role (único caller permitido).
 */
async function chamarCriarPedido(
  t: TestDb,
  p: {
    loja_id: string;
    nome_cliente?: string;
    telefone_cliente?: string | null;
    endereco_entrega?: unknown;
    forma_pagamento?: string;
    observacoes?: string | null;
    subtotal: number;
    taxa_entrega: number;
    desconto: number;
    total: number;
    cupom_id?: string | null;
    cupom_codigo?: string | null;
    tipo_entrega?: string;
    troco_para?: number | null;
    idempotency_key?: string | null;
    itens: {
      produto_id: string;
      nome: string;
      preco: number;
      quantidade: number;
    }[];
  },
): Promise<{ pedido_id: string; token_acesso: string }> {
  return t.asService(async (db) => {
    const r = await db.query<{ pedido_id: string; token_acesso: string }>(
      `select * from public.criar_pedido(
         p_loja_id          => $1,
         p_nome_cliente     => $2,
         p_telefone_cliente => $3,
         p_endereco_entrega => $4::jsonb,
         p_forma_pagamento  => $5,
         p_observacoes      => $6,
         p_subtotal         => $7,
         p_taxa_entrega     => $8,
         p_desconto         => $9,
         p_total            => $10,
         p_cupom_id         => $11,
         p_cupom_codigo     => $12,
         p_itens            => $13::jsonb,
         p_tipo_entrega     => $14,
         p_troco_para       => $15,
         p_idempotency_key  => $16
       )`,
      [
        p.loja_id,
        p.nome_cliente ?? "Cliente Teste",
        p.telefone_cliente ?? null,
        JSON.stringify(p.endereco_entrega ?? { cep: "01000-000", rua: "R", numero: "1", bairro: "Centro" }),
        p.forma_pagamento ?? "pix",
        p.observacoes ?? null,
        p.subtotal,
        p.taxa_entrega,
        p.desconto,
        p.total,
        p.cupom_id ?? null,
        p.cupom_codigo ?? null,
        JSON.stringify(p.itens),
        p.tipo_entrega ?? "entrega",
        p.troco_para ?? null,
        p.idempotency_key ?? null,
      ],
    );
    return r.rows[0];
  });
}

async function contar(t: TestDb, sql: string, params: unknown[]): Promise<number> {
  const r = await t.asService((db) =>
    db.query<{ n: string }>(`select count(*)::int as n from (${sql}) s`, params),
  );
  return Number(r.rows[0].n);
}

const CHAVE_A = "11111111-1111-1111-1111-111111111111";
const CHAVE_B = "22222222-2222-2222-2222-222222222222";

describe("063 RPC public.criar_pedido — idempotência (camada 1, pglite)", () => {
  let t: TestDb;
  let c: CenarioIdemp;

  beforeAll(async () => {
    t = await createTestDb();
    c = await semearIdemp(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ──────────────────────── [I1] dedup sequencial: mesma chave → mesmo pedido
  it("[I1] duas chamadas com a MESMA p_idempotency_key → MESMO pedido_id/token e só 1 INSERT", async () => {
    const r1 = await chamarCriarPedido(t, {
      loja_id: c.loja,
      subtotal: 25.0,
      taxa_entrega: 0,
      desconto: 0,
      total: 25.0,
      idempotency_key: CHAVE_A,
      itens: [{ produto_id: c.produto, nome: "Pizza", preco: 25.0, quantidade: 1 }],
    });
    const r2 = await chamarCriarPedido(t, {
      loja_id: c.loja,
      subtotal: 25.0,
      taxa_entrega: 0,
      desconto: 0,
      total: 25.0,
      idempotency_key: CHAVE_A,
      itens: [{ produto_id: c.produto, nome: "Pizza", preco: 25.0, quantidade: 1 }],
    });

    // dedupe: a 2ª chamada retorna o pedido da 1ª, idêntico
    expect(r2.pedido_id).toBe(r1.pedido_id);
    expect(r2.token_acesso).toBe(r1.token_acesso);

    // só 1 INSERT em pedidos para essa chave
    const n = await contar(
      t,
      `select 1 from public.pedidos where loja_id = $1 and idempotency_key = $2`,
      [c.loja, CHAVE_A],
    );
    expect(n).toBe(1);
  });

  // ──────────────────────── [I2] cupom uso único não consome 2x
  it("[I2] cupom usos_maximos=1 + mesma chave: 2ª chamada NÃO incrementa usos_contagem (fica 1)", async () => {
    const chave = "33333333-3333-3333-3333-333333333333";

    const r1 = await chamarCriarPedido(t, {
      loja_id: c.loja,
      subtotal: 25.0,
      taxa_entrega: 0,
      desconto: 5.0,
      total: 20.0,
      cupom_id: c.cupomUmUso,
      cupom_codigo: "UMUSO",
      idempotency_key: chave,
      itens: [{ produto_id: c.produto, nome: "Pizza", preco: 25.0, quantidade: 1 }],
    });
    const r2 = await chamarCriarPedido(t, {
      loja_id: c.loja,
      subtotal: 25.0,
      taxa_entrega: 0,
      desconto: 5.0,
      total: 20.0,
      cupom_id: c.cupomUmUso,
      cupom_codigo: "UMUSO",
      idempotency_key: chave,
      itens: [{ produto_id: c.produto, nome: "Pizza", preco: 25.0, quantidade: 1 }],
    });

    // mesmo pedido retornado
    expect(r2.pedido_id).toBe(r1.pedido_id);

    // o cupom foi consumido UMA vez (a 2ª chamada deduplicou ANTES da trava)
    const cupom = await t.asService((db) =>
      db.query<{ usos_contagem: number }>(`select usos_contagem from public.cupons where id = $1`, [
        c.cupomUmUso,
      ]),
    );
    expect(cupom.rows[0].usos_contagem).toBe(1);
  });

  // ──────────────────────── [I3] chaves diferentes → pedidos distintos
  it("[I3] mesma loja, p_idempotency_key DISTINTAS → 2 pedidos diferentes (não funde legítimos)", async () => {
    const ra = await chamarCriarPedido(t, {
      loja_id: c.loja,
      subtotal: 25.0,
      taxa_entrega: 0,
      desconto: 0,
      total: 25.0,
      idempotency_key: CHAVE_B,
      itens: [{ produto_id: c.produto, nome: "Pizza", preco: 25.0, quantidade: 1 }],
    });
    const chaveC = "44444444-4444-4444-4444-444444444444";
    const rc = await chamarCriarPedido(t, {
      loja_id: c.loja,
      subtotal: 25.0,
      taxa_entrega: 0,
      desconto: 0,
      total: 25.0,
      idempotency_key: chaveC,
      itens: [{ produto_id: c.produto, nome: "Pizza", preco: 25.0, quantidade: 1 }],
    });

    expect(rc.pedido_id).not.toBe(ra.pedido_id);

    const n = await contar(
      t,
      `select 1 from public.pedidos where loja_id = $1 and idempotency_key in ($2, $3)`,
      [c.loja, CHAVE_B, chaveC],
    );
    expect(n).toBe(2);
  });

  // ──────────────────────── [I4] chave NULL preserva comportamento atual
  it("[I4] duas chamadas com p_idempotency_key = NULL → 2 pedidos distintos (NULLs não colidem)", async () => {
    const r1 = await chamarCriarPedido(t, {
      loja_id: c.loja,
      subtotal: 25.0,
      taxa_entrega: 0,
      desconto: 0,
      total: 25.0,
      idempotency_key: null,
      itens: [{ produto_id: c.produto, nome: "Pizza", preco: 25.0, quantidade: 1 }],
    });
    const r2 = await chamarCriarPedido(t, {
      loja_id: c.loja,
      subtotal: 25.0,
      taxa_entrega: 0,
      desconto: 0,
      total: 25.0,
      idempotency_key: null,
      itens: [{ produto_id: c.produto, nome: "Pizza", preco: 25.0, quantidade: 1 }],
    });

    expect(r2.pedido_id).not.toBe(r1.pedido_id);

    const n = await contar(
      t,
      `select 1 from public.pedidos where loja_id = $1 and idempotency_key is null`,
      [c.loja],
    );
    expect(n).toBe(2);
  });
});
