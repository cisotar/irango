import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 014 — RPC transacional `public.criar_pedido`
 * (camada 1: SQL/transação real em pglite).
 *
 * A RPC ainda NÃO existe (será uma migration nova na fase GREEN —
 * `2026XXXXXXXXXX_rpc_criar_pedido.sql`). Logo, TODA chamada a
 * `select * from public.criar_pedido(...)` aqui falha com
 * "function public.criar_pedido(...) does not exist" — esse é o RED.
 *
 * O que estes testes provam que a RPC PRECISA garantir (D1/D3/D5 do plano):
 *  - ATOMICIDADE: pedido + itens são inseridos na MESMA transação (ambos ou nada);
 *  - SNAPSHOT: itens_pedido grava nome/preco passados (vindos do banco, não do cliente);
 *  - token_acesso é gerado (DEFAULT) e RETORNADO junto do id num só round-trip;
 *  - TRAVA ATÔMICA de cupom (anti over-use, RN-06): com usos_maximos=1, duas chamadas
 *    sequenciais → só a 1ª consome o cupom; a 2ª vê esgotado e grava o pedido SEM
 *    desconto (D5: não rejeita o pedido), com cupom_codigo NULL e total recomputado;
 *  - DEFESA EM PROFUNDIDADE: loja inativa → a RPC dá RAISE mesmo via service_role
 *    (não confia só no guard TS da action).
 *
 * Anti-falso-verde: a chamada roda via asService (BYPASSRLS) — então a negação
 * vista nos testes vem da LÓGICA da RPC (RAISE / WHERE da trava), nunca de RLS.
 *
 * NB: a RPC é declarada SECURITY INVOKER + GRANT só a service_role (D4). O teste
 * de grant (anon NÃO pode EXECUTE) é da fase GREEN/auditoria; aqui focamos a
 * semântica transacional que é o coração da criticidade.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
// RN-01: lojaInativa pertence a DONO_A2 (conta separada) para satisfazer 1 conta = 1 loja.
const DONO_A2 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab";

type Cenario = {
  lojaAtiva: string;
  lojaInativa: string;
  produto1: string; // produto da loja ativa, preço 25.00
  produto2: string; // produto da loja ativa, preço 10.00
  cupomUmUso: string; // cupom da loja ativa, usos_maximos=1, usos_contagem=0
};

async function garantirDono(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a@teste.local'),
       ($2, 'dono-a2@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_A2],
  );
}

async function semearCenario(t: TestDb): Promise<Cenario> {
  await garantirDono(t);
  return t.asService(async (db) => {
    const ins = async (sql: string, params: unknown[]) => {
      const r = await db.query<{ id: string }>(sql, params);
      return r.rows[0].id;
    };

    const lojaAtiva = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-ativa','Loja Ativa',true) returning id`,
      [DONO_A],
    );
    const lojaInativa = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-inativa','Loja Inativa',false) returning id`,
      [DONO_A2],
    );

    const produto1 = await ins(
      `insert into public.produtos (loja_id, nome, preco, disponivel) values ($1,'Pizza',25.00,true) returning id`,
      [lojaAtiva],
    );
    const produto2 = await ins(
      `insert into public.produtos (loja_id, nome, preco, disponivel) values ($1,'Refri',10.00,true) returning id`,
      [lojaAtiva],
    );

    const cupomUmUso = await ins(
      `insert into public.cupons (loja_id, codigo, tipo, valor, usos_maximos, usos_contagem, ativo)
         values ($1,'UMUSO','fixo',5.00,1,0,true) returning id`,
      [lojaAtiva],
    );

    return { lojaAtiva, lojaInativa, produto1, produto2, cupomUmUso };
  });
}

/**
 * Chama a RPC `public.criar_pedido` com parâmetros nomeados (assinatura do plano,
 * §Contratos de Dados). Executada como service_role (o único caller permitido).
 * Retorna a linha { pedido_id, token_acesso }.
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
    // [071] tipo_entrega + troco_para persistidos pela RPC.
    tipo_entrega?: string;
    troco_para?: number | null;
    itens: { produto_id: string; nome: string; preco: number; quantidade: number }[];
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
         p_troco_para       => $15
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

describe("014 RPC public.criar_pedido — atomicidade + trava de cupom (camada 1, pglite)", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    c = await semearCenario(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ──────────────────────── atomicidade pedido + itens + token
  it("[1] insere pedido + itens na MESMA transação e retorna { pedido_id, token_acesso }", async () => {
    const r = await chamarCriarPedido(t, {
      loja_id: c.lojaAtiva,
      subtotal: 60.0, // 25*2 + 10*1
      taxa_entrega: 5.0,
      desconto: 0,
      total: 65.0,
      itens: [
        { produto_id: c.produto1, nome: "Pizza", preco: 25.0, quantidade: 2 },
        { produto_id: c.produto2, nome: "Refri", preco: 10.0, quantidade: 1 },
      ],
    });

    expect(r.pedido_id).toBeTruthy();
    expect(r.token_acesso).toBeTruthy(); // gerado pelo DEFAULT gen_random_uuid()

    const pedidos = await contar(t, `select 1 from public.pedidos where id = $1`, [r.pedido_id]);
    const itens = await contar(t, `select 1 from public.itens_pedido where pedido_id = $1`, [r.pedido_id]);
    expect(pedidos).toBe(1);
    expect(itens).toBe(2); // os dois itens vieram juntos — atômico
  });

  it("[2] itens_pedido gravam SNAPSHOT de nome/preco recebido (não relê do banco)", async () => {
    const r = await chamarCriarPedido(t, {
      loja_id: c.lojaAtiva,
      subtotal: 25.0,
      taxa_entrega: 0,
      desconto: 0,
      total: 25.0,
      itens: [{ produto_id: c.produto1, nome: "Pizza (snapshot)", preco: 25.0, quantidade: 1 }],
    });
    const row = await t.asService((db) =>
      db.query<{ nome: string; preco: string }>(
        `select nome, preco from public.itens_pedido where pedido_id = $1`,
        [r.pedido_id],
      ),
    );
    expect(row.rows[0].nome).toBe("Pizza (snapshot)");
    expect(Number(row.rows[0].preco)).toBe(25.0);
  });

  // ──────────────────────── trava atômica de cupom (RN-06, D5)
  it("[3] cupom usos_maximos=1: 1ª chamada CONSOME (usos_contagem 0→1) e grava com desconto", async () => {
    const r = await chamarCriarPedido(t, {
      loja_id: c.lojaAtiva,
      subtotal: 25.0,
      taxa_entrega: 0,
      desconto: 5.0,
      total: 20.0,
      cupom_id: c.cupomUmUso,
      cupom_codigo: "UMUSO",
      itens: [{ produto_id: c.produto1, nome: "Pizza", preco: 25.0, quantidade: 1 }],
    });
    const cupom = await t.asService((db) =>
      db.query<{ usos_contagem: number }>(`select usos_contagem from public.cupons where id = $1`, [
        c.cupomUmUso,
      ]),
    );
    expect(cupom.rows[0].usos_contagem).toBe(1);

    const ped = await t.asService((db) =>
      db.query<{ desconto: string; total: string; cupom_codigo: string | null }>(
        `select desconto, total, cupom_codigo from public.pedidos where id = $1`,
        [r.pedido_id],
      ),
    );
    expect(Number(ped.rows[0].desconto)).toBe(5.0);
    expect(Number(ped.rows[0].total)).toBe(20.0);
    expect(ped.rows[0].cupom_codigo).toBe("UMUSO");
  });

  it("[4] (ANTI OVER-USE) 2ª chamada com cupom já esgotado: NÃO incrementa de novo; grava pedido SEM desconto (D5)", async () => {
    // O cupom já foi consumido em [3] (usos_contagem=1, usos_maximos=1). A 2ª
    // chamada deve cair no ramo `IF NOT FOUND` da trava: desconto=0,
    // cupom_codigo=NULL, total recomputado = subtotal + taxa_entrega.
    // A action ainda passa desconto=5/total=20 (o que ela viu na leitura), mas a
    // RPC é a autoridade final e DEVE ignorar o desconto morto.
    const r = await chamarCriarPedido(t, {
      loja_id: c.lojaAtiva,
      subtotal: 25.0,
      taxa_entrega: 0,
      desconto: 5.0, // a action achava que ainda valia
      total: 20.0,
      cupom_id: c.cupomUmUso,
      cupom_codigo: "UMUSO",
      itens: [{ produto_id: c.produto1, nome: "Pizza", preco: 25.0, quantidade: 1 }],
    });

    // contagem do cupom NÃO subiu além de 1 (a trava WHERE usos<usos_maximos barrou)
    const cupom = await t.asService((db) =>
      db.query<{ usos_contagem: number }>(`select usos_contagem from public.cupons where id = $1`, [
        c.cupomUmUso,
      ]),
    );
    expect(cupom.rows[0].usos_contagem).toBe(1);

    // pedido criado, mas sem desconto e com total recomputado (subtotal+frete)
    const ped = await t.asService((db) =>
      db.query<{ desconto: string; total: string; cupom_codigo: string | null }>(
        `select desconto, total, cupom_codigo from public.pedidos where id = $1`,
        [r.pedido_id],
      ),
    );
    expect(Number(ped.rows[0].desconto)).toBe(0);
    expect(Number(ped.rows[0].total)).toBe(25.0); // 25 subtotal + 0 frete
    expect(ped.rows[0].cupom_codigo).toBeNull();
  });

  // ──────────────────────── [071] persistência de tipo_entrega + troco_para
  it("[6] persiste p_tipo_entrega e p_troco_para nas colunas do pedido (RN-C2/C3)", async () => {
    const r = await chamarCriarPedido(t, {
      loja_id: c.lojaAtiva,
      forma_pagamento: "dinheiro",
      subtotal: 25.0,
      taxa_entrega: 0,
      desconto: 0,
      total: 25.0,
      tipo_entrega: "retirada",
      troco_para: 50.0,
      itens: [{ produto_id: c.produto1, nome: "Pizza", preco: 25.0, quantidade: 1 }],
    });
    const ped = await t.asService((db) =>
      db.query<{ tipo_entrega: string; troco_para: string | null }>(
        `select tipo_entrega, troco_para from public.pedidos where id = $1`,
        [r.pedido_id],
      ),
    );
    expect(ped.rows[0].tipo_entrega).toBe("retirada");
    expect(Number(ped.rows[0].troco_para)).toBe(50.0);
  });

  it("[7] troco_para NULL persiste como NULL (entrega sem troco)", async () => {
    const r = await chamarCriarPedido(t, {
      loja_id: c.lojaAtiva,
      subtotal: 25.0,
      taxa_entrega: 0,
      desconto: 0,
      total: 25.0,
      tipo_entrega: "entrega",
      troco_para: null,
      itens: [{ produto_id: c.produto1, nome: "Pizza", preco: 25.0, quantidade: 1 }],
    });
    const ped = await t.asService((db) =>
      db.query<{ tipo_entrega: string; troco_para: string | null }>(
        `select tipo_entrega, troco_para from public.pedidos where id = $1`,
        [r.pedido_id],
      ),
    );
    expect(ped.rows[0].tipo_entrega).toBe("entrega");
    expect(ped.rows[0].troco_para).toBeNull();
  });

  // ──────────────────────── defesa em profundidade: loja inativa
  it("[5] (DEFESA EM PROFUNDIDADE) loja inativa → RPC dá RAISE e NÃO cria pedido, mesmo via service_role", async () => {
    const antes = await contar(t, `select 1 from public.pedidos where loja_id = $1`, [c.lojaInativa]);

    // Assertamos a MENSAGEM específica do RAISE (`loja_inativa`) — não um throw
    // genérico. Isso evita FALSO VERDE: hoje a chamada lança "function ... does
    // not exist" (RPC ausente), que NÃO casa com /loja_inativa/, então o teste é
    // RED de verdade. Na GREEN, a RPC com `RAISE EXCEPTION 'loja_inativa'` casa.
    await expect(
      chamarCriarPedido(t, {
        loja_id: c.lojaInativa,
        subtotal: 25.0,
        taxa_entrega: 0,
        desconto: 0,
        total: 25.0,
        itens: [{ produto_id: c.produto1, nome: "Pizza", preco: 25.0, quantidade: 1 }],
      }),
    ).rejects.toThrow(/loja_inativa/);

    const depois = await contar(t, `select 1 from public.pedidos where loja_id = $1`, [c.lojaInativa]);
    expect(depois).toBe(antes); // nada inserido (transação abortou)
  });
});
