import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Issue 063 — bordas de idempotência NÃO cobertas pelos testes I1–I4.
 *
 * [B1] CROSS-LOJA: a mesma idempotency_key usada em DUAS lojas distintas deve
 *      gerar 2 pedidos diferentes. O índice UNIQUE é (loja_id, idempotency_key),
 *      não apenas (idempotency_key). Uma implementação ingênua que indexasse só
 *      a chave bloquearia pedidos legítimos de lojas diferentes.
 *
 * [B2] ITENS DO PEDIDO DEDUPLICADO: quando a 2ª chamada com a mesma chave é
 *      ignorada (dedupe), os itens em `itens_pedido` pertencem APENAS ao
 *      primeiro pedido. Nenhum item órfão é inserido (sem pedido_id duplicado),
 *      e os itens do 1º pedido continuam íntegros (não são duplicados).
 *
 * Anti-falso-verde: asService (BYPASSRLS) — o comportamento observado vem
 * da lógica da RPC, não de RLS. Asserções numéricas concretas.
 */

// Dois donos distintos: constraint lojas_dono_unico impede o mesmo dono ter 2 lojas.
const DONO_BORDA_A = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbba";
const DONO_BORDA_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2";

type CenarioBordas = {
  lojaA: string;
  lojaB: string;
  produtoA: string; // produto da loja A, R$ 10,00
  produtoB: string; // produto da loja B, R$ 15,00
};

async function semearBordas(t: TestDb): Promise<CenarioBordas> {
  // Insere os dois donos na tabela auth.users (fora de transação asService).
  await t.db.query(
    `insert into auth.users (id, email) values ($1, 'dono-borda-a@teste.local')
       on conflict (id) do nothing`,
    [DONO_BORDA_A],
  );
  await t.db.query(
    `insert into auth.users (id, email) values ($1, 'dono-borda-b@teste.local')
       on conflict (id) do nothing`,
    [DONO_BORDA_B],
  );

  return t.asService(async (db) => {
    const ins = async (sql: string, params: unknown[]) => {
      const r = await db.query<{ id: string }>(sql, params);
      return r.rows[0].id;
    };

    // Cada loja tem um dono distinto (constraint lojas_dono_unico: 1 loja/dono).
    const lojaA = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo)
         values ($1, 'loja-borda-a', 'Loja Borda A', true) returning id`,
      [DONO_BORDA_A],
    );
    const lojaB = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo)
         values ($1, 'loja-borda-b', 'Loja Borda B', true) returning id`,
      [DONO_BORDA_B],
    );

    const produtoA = await ins(
      `insert into public.produtos (loja_id, nome, preco, disponivel)
         values ($1, 'Produto A', 10.00, true) returning id`,
      [lojaA],
    );
    const produtoB = await ins(
      `insert into public.produtos (loja_id, nome, preco, disponivel)
         values ($1, 'Produto B', 15.00, true) returning id`,
      [lojaB],
    );

    return { lojaA, lojaB, produtoA, produtoB };
  });
}

async function chamarRpc(
  t: TestDb,
  p: {
    loja_id: string;
    produto_id: string;
    produto_nome: string;
    produto_preco: number;
    idempotency_key: string | null;
  },
): Promise<{ pedido_id: string; token_acesso: string }> {
  return t.asService(async (db) => {
    // Parâmetros: $1=loja_id, $2=preco (numeric), $3=itens_json, $4=chave.
    // produto_id entra apenas dentro do JSON de $3 — não como param avulso.
    const itensJson = JSON.stringify([
      { produto_id: p.produto_id, nome: p.produto_nome, preco: p.produto_preco, quantidade: 1 },
    ]);
    const r = await db.query<{ pedido_id: string; token_acesso: string }>(
      `select * from public.criar_pedido(
         p_loja_id          => $1,
         p_nome_cliente     => 'Cliente Borda',
         p_telefone_cliente => null,
         p_endereco_entrega => '{"cep":"01000-000","rua":"R","numero":"1","bairro":"Centro"}'::jsonb,
         p_forma_pagamento  => 'pix',
         p_observacoes      => null,
         p_subtotal         => $2,
         p_taxa_entrega     => 0,
         p_desconto         => 0,
         p_total            => $2,
         p_cupom_id         => null,
         p_cupom_codigo     => null,
         p_itens            => $3::jsonb,
         p_tipo_entrega     => 'entrega',
         p_troco_para       => null,
         p_idempotency_key  => $4
       )`,
      [p.loja_id, p.produto_preco, itensJson, p.idempotency_key],
    );
    return r.rows[0];
  });
}

describe("063 RPC — bordas de idempotência (cross-loja + itens)", () => {
  let t: TestDb;
  let c: CenarioBordas;

  beforeAll(async () => {
    t = await createTestDb();
    c = await semearBordas(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ───────── [B1] CROSS-LOJA: mesma chave em lojas distintas → 2 pedidos distintos
  it("[B1] CROSS-LOJA: a MESMA idempotency_key em DUAS lojas distintas → 2 pedidos distintos (chave escopada por loja_id)", async () => {
    // Esta é a borda de isolamento mais importante: um índice UNIQUE sem loja_id
    // impediria o pedido da loja B quando a chave já existe na loja A.
    const CHAVE_CROSS = "cccccccc-0063-4000-8000-000000000001";

    const rA = await chamarRpc(t, {
      loja_id: c.lojaA,
      produto_id: c.produtoA,
      produto_nome: "Produto A",
      produto_preco: 10.0,
      idempotency_key: CHAVE_CROSS,
    });

    const rB = await chamarRpc(t, {
      loja_id: c.lojaB,
      produto_id: c.produtoB,
      produto_nome: "Produto B",
      produto_preco: 15.0,
      idempotency_key: CHAVE_CROSS, // MESMA chave, loja diferente
    });

    // Devem ser pedidos distintos — a chave é escopada pela loja.
    expect(rB.pedido_id).not.toBe(rA.pedido_id);
    expect(rB.token_acesso).not.toBe(rA.token_acesso);

    // Ambos existem no banco com suas respectivas lojas.
    const pedidos = await t.asService((db) =>
      db.query<{ id: string; loja_id: string }>(
        `select id, loja_id from public.pedidos
          where idempotency_key = $1
          order by criado_em`,
        [CHAVE_CROSS],
      ),
    );

    expect(pedidos.rows).toHaveLength(2);
    const lojas = new Set(pedidos.rows.map((p) => p.loja_id));
    expect(lojas.has(c.lojaA)).toBe(true);
    expect(lojas.has(c.lojaB)).toBe(true);
  });

  // ───────── [B2] ITENS: dedup não cria itens órfãos nem duplica itens do 1º pedido
  it("[B2] ITENS DEDUPLICADOS: 2ª chamada com mesma chave não cria itens_pedido extras (sem órfãos, sem duplicatas)", async () => {
    // Se a RPC tivesse um bug que inserisse itens antes de checar ON CONFLICT,
    // a 2ª chamada criaria itens_pedido com pedido_id = null (órfão) ou duplicaria
    // os itens do 1º pedido. Este teste pegaria esse bug.
    const CHAVE_ITENS = "cccccccc-0063-4000-8000-000000000002";

    const r1 = await chamarRpc(t, {
      loja_id: c.lojaA,
      produto_id: c.produtoA,
      produto_nome: "Produto A",
      produto_preco: 10.0,
      idempotency_key: CHAVE_ITENS,
    });

    // 2ª chamada com exatamente a mesma chave — deve deduplicar
    const r2 = await chamarRpc(t, {
      loja_id: c.lojaA,
      produto_id: c.produtoA,
      produto_nome: "Produto A",
      produto_preco: 10.0,
      idempotency_key: CHAVE_ITENS,
    });

    // Confirma que deduplicou (mesmo pedido retornado).
    expect(r2.pedido_id).toBe(r1.pedido_id);

    // Conta itens_pedido vinculados ao pedido deduplicado.
    const itens = await t.asService((db) =>
      db.query<{ n: string }>(
        `select count(*)::int as n from public.itens_pedido where pedido_id = $1`,
        [r1.pedido_id],
      ),
    );
    // Apenas 1 item (do 1º INSERT); a 2ª chamada não inseriu mais.
    expect(Number(itens.rows[0].n)).toBe(1);

    // Nenhum item órfão (sem pedido_id referenciando o pedido deduplicado com
    // dados da 2ª chamada — que nunca devem existir).
    // Como pedido_id é FK NOT NULL em itens_pedido, "órfão" aqui significa
    // qualquer item extra além dos da 1ª chamada. Já verificado pelo count = 1.

    // Garantia adicional: o único item tem os dados corretos do 1º INSERT.
    const itemRow = await t.asService((db) =>
      db.query<{ produto_id: string; preco: number; quantidade: number }>(
        `select produto_id, preco::float as preco, quantidade
           from public.itens_pedido
          where pedido_id = $1`,
        [r1.pedido_id],
      ),
    );
    expect(itemRow.rows).toHaveLength(1);
    expect(itemRow.rows[0].produto_id).toBe(c.produtoA);
    expect(itemRow.rows[0].preco).toBe(10.0);
    expect(itemRow.rows[0].quantidade).toBe(1);
  });
});
