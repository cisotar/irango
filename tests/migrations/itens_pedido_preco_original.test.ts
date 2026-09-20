import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 221 — `itens_pedido.preco_original` (migration 4) +
 * nova versão de `public.criar_pedido` que grava a coluna (migration 5).
 * Spec `desconto-por-produto-e-pratos-promocionais.md`, D7 / RN-13, fatias
 * críticas 5 (snapshot) e 6 (CHECK `preco_original >= preco`).
 *
 * Escrito a partir da ISSUE e do SPEC, nunca do SQL das migrations. O que fica
 * provado aqui:
 *
 *  1. RPC, caso "houve desconto": jsonb COM `preco_original` ⇒ coluna gravada,
 *     lado a lado com o `preco` pago (RN-13);
 *  2. RPC, caso "misto" (o pedido de RN-10-a do spec): no MESMO pedido, o item
 *     com desconto grava `preco_original = 100.00` e o item sem desconto grava
 *     NULL — a coluna é por item, não por pedido;
 *  3. RPC, caso "janela de deploy": jsonb SEM a chave `preco_original` ⇒ coluna
 *     NULL, **sem erro**. É a lambda antiga da Vercel chamando a RPC nova
 *     durante o deploy; se isso levantar exceção, o checkout cai em produção;
 *  4. CHECK `itens_pedido_preco_original_check` recusa o par invertido
 *     (`preco_original < preco`, "de R$ 80 por R$ 100"), e a asserção afirma o
 *     NOME LITERAL da constraint — SQLSTATE 23514 sozinho não distingue
 *     "recusou pelo motivo certo" de "recusou por outra regra qualquer";
 *  5. `preco_original = preco` é ACEITO (a borda do `>=`), e a coluna é
 *     opcional: NULL continua sendo estado válido para todo item legado;
 *  6. a assinatura de 17 argumentos não ganha overload novo e a legada de 16
 *     continua intocada (`function is not unique` é o erro que a issue manda
 *     evitar);
 *  7. a armadilha de overload descoberta nesta fase RED: uma chamada que OMITE
 *     `p_idempotency_key`/`p_frete_a_combinar` resolve para a legada de 16 args
 *     e perde `preco_original` em silêncio, sem erro nenhum. A Server Action
 *     passa os 17 — o teste existe para que a armadilha fique visível.
 *
 * Anti-falso-verde:
 *  - toda gravação "aceita" é RELIDA via asService contra o estado real da linha;
 *  - a negação do CHECK exige o nome da constraint na mensagem: se a coluna
 *     sumir, "column does not exist" NÃO satisfaz a asserção;
 *  - a RPC roda via asService (BYPASSRLS, o único caller com GRANT EXECUTE),
 *     então nada aqui é decidido por RLS.
 *
 * Nenhum código de produção e nenhuma migration são escritos aqui. Quem deixa
 * verde é `executar`.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const PRECO_TABELA = "100.00";
const PRECO_PAGO = "80.00";

type Cenario = {
  loja: string;
  /** Feijoada — preço de tabela R$ 100,00, é a que entra em promoção. */
  produtoComDesconto: string;
  /** Refrigerante — R$ 10,00, nunca em promoção. */
  produtoSemDesconto: string;
};

async function criarCenario(t: TestDb): Promise<Cenario> {
  await t.db.query(
    `insert into auth.users (id, email) values ($1, 'dono-221@teste.local')
     on conflict (id) do nothing`,
    [DONO_A],
  );
  return t.asService(async (db) => {
    const loja = (
      await db.query<{ id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo)
           values ($1, 'loja-221-preco-original', 'Loja 221', true) returning id`,
        [DONO_A],
      )
    ).rows[0].id;

    const produtos = await db.query<{ id: string; nome: string }>(
      `insert into public.produtos (loja_id, nome, preco, disponivel) values
         ($1, 'Feijoada', $2, true),
         ($1, 'Refrigerante', '10.00', true)
       returning id, nome`,
      [loja, PRECO_TABELA],
    );

    return {
      loja,
      produtoComDesconto: produtos.rows.find((p) => p.nome === "Feijoada")!.id,
      produtoSemDesconto: produtos.rows.find((p) => p.nome === "Refrigerante")!.id,
    };
  });
}

type ItemJsonb = {
  produto_id: string;
  nome: string;
  preco: number;
  quantidade: number;
  observacao?: string;
  /** AUSENTE de propósito no caso "lambda antiga" (janela de deploy). */
  preco_original?: number | null;
};

/**
 * Chama `public.criar_pedido` com os MESMOS 17 argumentos nomeados de
 * `20260913121000_rpc_criar_pedido_frete_a_combinar.sql`. A issue 221 é
 * explícita: a assinatura não muda; `preco_original` viaja DENTRO do jsonb
 * `p_itens`. Se esta chamada quebrar por aridade, o contrato foi violado.
 */
async function chamarCriarPedido(
  t: TestDb,
  p: { loja: string; subtotal: number; total: number; itens: ItemJsonb[]; legada16?: boolean },
): Promise<{ pedido_id: string; token_acesso: string }> {
  // A Server Action (`src/lib/actions/pedido.ts`) passa os 17 argumentos
  // nomeados, incluindo `p_frete_a_combinar`. Omitir o 17º NÃO é um atalho
  // inofensivo: a resolução de overload cai na assinatura LEGADA de 16 args.
  const arg17 = p.legada16
    ? ""
    : ",\n         p_idempotency_key  => $16::uuid,\n         p_frete_a_combinar => $17::boolean";
  return t.asService(async (db) => {
    const r = await db.query<{ pedido_id: string; token_acesso: string }>(
      `select * from public.criar_pedido(
         p_loja_id          => $1::uuid,
         p_nome_cliente     => $2::text,
         p_telefone_cliente => $3::text,
         p_endereco_entrega => $4::jsonb,
         p_forma_pagamento  => $5::text,
         p_observacoes      => $6::text,
         p_subtotal         => $7::numeric,
         p_taxa_entrega     => $8::numeric,
         p_desconto         => $9::numeric,
         p_total            => $10::numeric,
         p_cupom_id         => $11::uuid,
         p_cupom_codigo     => $12::text,
         p_itens            => $13::jsonb,
         p_tipo_entrega     => $14::text,
         p_troco_para       => $15::numeric${arg17}
       )`,
      [
        p.loja,
        "Cliente 221",
        null,
        JSON.stringify({ cep: "01000-000", rua: "R", numero: "1", bairro: "Centro" }),
        "pix",
        null,
        p.subtotal,
        0,
        0,
        p.total,
        null,
        null,
        JSON.stringify(p.itens),
        "entrega",
        null,
        ...(p.legada16 ? [] : [null, false]),
      ],
    );
    return r.rows[0];
  });
}

type LinhaItem = { nome: string; preco: string; preco_original: string | null; quantidade: number };

/** Relê os itens gravados via service_role (BYPASSRLS) — estado real da tabela. */
async function itensDoPedido(t: TestDb, pedidoId: string): Promise<LinhaItem[]> {
  const r = await t.asService((db) =>
    db.query<LinhaItem>(
      `select nome, preco::text as preco, preco_original::text as preco_original, quantidade
         from public.itens_pedido where pedido_id = $1 order by nome`,
      [pedidoId],
    ),
  );
  return r.rows;
}

/** Escrita que DEVE ser recusada pelo banco — devolve a mensagem do erro. */
async function erroDe(t: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await t.asService((db) => db.query(sql, params));
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error(`Esperava recusa do banco, mas a escrita PASSOU: ${sql}`);
}

describe("221 · itens_pedido.preco_original + criar_pedido que grava o snapshot", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    c = await criarCenario(t);
  });

  afterAll(async () => {
    await t.close();
  });

  // ───────────────────────────────────────────── os três casos da RPC (fatia 5)

  it("[RN-13 · caso 1] jsonb COM preco_original ⇒ coluna gravada ao lado do preço pago", async () => {
    const { pedido_id } = await chamarCriarPedido(t, {
      loja: c.loja,
      subtotal: 80.0,
      total: 80.0,
      itens: [
        {
          produto_id: c.produtoComDesconto,
          nome: "Feijoada",
          preco: 80.0,
          quantidade: 1,
          preco_original: 100.0,
        },
      ],
    });

    const itens = await itensDoPedido(t, pedido_id);
    expect(itens).toHaveLength(1);
    expect(itens[0].preco).toBe(PRECO_PAGO);
    expect(itens[0].preco_original).toBe(PRECO_TABELA);
  });

  it("[RN-13 · caso 2] pedido misto: item com desconto grava 100.00 e item sem desconto grava NULL", async () => {
    const { pedido_id } = await chamarCriarPedido(t, {
      loja: c.loja,
      subtotal: 90.0, // 80 (Feijoada com desconto) + 10 (Refrigerante)
      total: 90.0,
      itens: [
        {
          produto_id: c.produtoComDesconto,
          nome: "Feijoada",
          preco: 80.0,
          quantidade: 1,
          preco_original: 100.0,
        },
        { produto_id: c.produtoSemDesconto, nome: "Refrigerante", preco: 10.0, quantidade: 1 },
      ],
    });

    const itens = await itensDoPedido(t, pedido_id);
    expect(itens.map((i) => i.nome)).toEqual(["Feijoada", "Refrigerante"]);
    expect(itens[0].preco_original).toBe(PRECO_TABELA);
    expect(itens[0].preco).toBe(PRECO_PAGO);
    // A coluna é POR ITEM: o refrigerante do mesmo pedido continua sem par de preços.
    expect(itens[1].preco_original).toBeNull();
    expect(itens[1].preco).toBe("10.00");
  });

  it("[RN-13 · caso 3 · janela de deploy] jsonb SEM a chave preco_original ⇒ NULL, sem erro", async () => {
    // Lambda ANTIGA da Vercel chamando a RPC NOVA: o jsonb não tem a chave.
    // Isso não pode levantar exceção — seria o checkout caindo durante o deploy.
    const item: ItemJsonb = {
      produto_id: c.produtoSemDesconto,
      nome: "Refrigerante",
      preco: 10.0,
      quantidade: 2,
    };
    expect(Object.keys(item)).not.toContain("preco_original");

    const { pedido_id } = await chamarCriarPedido(t, {
      loja: c.loja,
      subtotal: 20.0,
      total: 20.0,
      itens: [item],
    });

    const itens = await itensDoPedido(t, pedido_id);
    expect(itens).toHaveLength(1);
    expect(itens[0].preco_original).toBeNull();
    expect(itens[0].preco).toBe("10.00");
    expect(itens[0].quantidade).toBe(2);
  });

  it("[D7] preco_original explicitamente null no jsonb ⇒ NULL, sem erro", async () => {
    const { pedido_id } = await chamarCriarPedido(t, {
      loja: c.loja,
      subtotal: 10.0,
      total: 10.0,
      itens: [
        {
          produto_id: c.produtoSemDesconto,
          nome: "Refrigerante",
          preco: 10.0,
          quantidade: 1,
          preco_original: null,
        },
      ],
    });

    expect((await itensDoPedido(t, pedido_id))[0].preco_original).toBeNull();
  });

  // ──────────────────────────────────── CHECK preco_original >= preco (fatia 6)

  it("[RN-13 · CHECK] par invertido (preco_original < preco) é recusado por itens_pedido_preco_original_check", async () => {
    const pedidoId = (
      await chamarCriarPedido(t, {
        loja: c.loja,
        subtotal: 10.0,
        total: 10.0,
        itens: [
          { produto_id: c.produtoSemDesconto, nome: "Refrigerante", preco: 10.0, quantidade: 1 },
        ],
      })
    ).pedido_id;

    // "de R$ 80,00 por R$ 100,00" — snapshot sem sentido, promoção nunca sobe preço.
    const msg = await erroDe(
      t,
      `insert into public.itens_pedido (pedido_id, produto_id, nome, preco, quantidade, preco_original)
         values ($1, $2, 'Feijoada', 100.00, 1, 80.00)`,
      [pedidoId, c.produtoComDesconto],
    );

    // NOME LITERAL da constraint: SQLSTATE 23514 sozinho não prova o motivo certo.
    expect(msg).toContain("itens_pedido_preco_original_check");
  });

  it("[RN-13 · borda do >=] preco_original IGUAL a preco é aceito", async () => {
    const pedidoId = (
      await chamarCriarPedido(t, {
        loja: c.loja,
        subtotal: 10.0,
        total: 10.0,
        itens: [
          { produto_id: c.produtoSemDesconto, nome: "Refrigerante", preco: 10.0, quantidade: 1 },
        ],
      })
    ).pedido_id;

    await t.asService((db) =>
      db.query(
        `insert into public.itens_pedido (pedido_id, produto_id, nome, preco, quantidade, preco_original)
           values ($1, $2, 'Feijoada', 100.00, 1, 100.00)`,
        [pedidoId, c.produtoComDesconto],
      ),
    );

    const feijoada = (await itensDoPedido(t, pedidoId)).find((i) => i.nome === "Feijoada")!;
    expect(feijoada.preco_original).toBe(PRECO_TABELA);
  });

  it("[RN-13 · snapshot imutável] editar o preço do produto depois NÃO muda o item gravado", async () => {
    const { pedido_id } = await chamarCriarPedido(t, {
      loja: c.loja,
      subtotal: 80.0,
      total: 80.0,
      itens: [
        {
          produto_id: c.produtoComDesconto,
          nome: "Feijoada",
          preco: 80.0,
          quantidade: 1,
          preco_original: 100.0,
        },
      ],
    });

    await t.asService((db) =>
      db.query(`update public.produtos set preco = 55.00 where id = $1`, [c.produtoComDesconto]),
    );

    const itens = await itensDoPedido(t, pedido_id);
    expect(itens[0].preco).toBe(PRECO_PAGO);
    expect(itens[0].preco_original).toBe(PRECO_TABELA);

    await t.asService((db) =>
      db.query(`update public.produtos set preco = $2 where id = $1`, [
        c.produtoComDesconto,
        PRECO_TABELA,
      ]),
    );
  });

  // ───────────────────────────────────── assinatura: nenhum overload novo (17 args)

  it("[221 · contrato] criar_pedido continua com UMA única versão de 17 argumentos", async () => {
    const r = await t.asService((db) =>
      db.query<{ n: number }>(
        `select count(*)::int as n
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'criar_pedido'
            and p.pronargs = 17`,
      ),
    );
    // Overload novo de 17 args ⇒ "function public.criar_pedido(...) is not unique"
    // na chamada nomeada — o erro que a issue manda evitar.
    expect(r.rows[0].n).toBe(1);
  });

  it("[221 · contrato] a assinatura LEGADA de 16 args continua existindo, intocada", async () => {
    const r = await t.asService((db) =>
      db.query<{ n: number }>(
        `select count(*)::int as n
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'criar_pedido'
            and p.pronargs = 16`,
      ),
    );
    expect(r.rows[0].n).toBe(1);
  });

  it("[221 · armadilha de overload] omitir p_frete_a_combinar cai na LEGADA de 16 args, que NÃO grava preco_original", async () => {
    // Descoberto na fase RED: com as duas assinaturas vivas, uma chamada de 15
    // argumentos nomeados NÃO dá "is not unique" — o Postgres resolve para a
    // legada de 16 (menos defaults a preencher), e ela ignora `preco_original`
    // silenciosamente, sem erro. A Server Action passa os 17 e por isso está
    // correta; este teste existe para que a armadilha fique VISÍVEL e para
    // quebrar o dia em que alguém "simplificar" a chamada.
    const { pedido_id } = await chamarCriarPedido(t, {
      loja: c.loja,
      subtotal: 80.0,
      total: 80.0,
      legada16: true,
      itens: [
        {
          produto_id: c.produtoComDesconto,
          nome: "Feijoada",
          preco: 80.0,
          quantidade: 1,
          preco_original: 100.0,
        },
      ],
    });

    const itens = await itensDoPedido(t, pedido_id);
    expect(itens[0].preco).toBe(PRECO_PAGO);
    expect(itens[0].preco_original).toBeNull(); // o par de preços se PERDE por aqui
  });
});
