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
    itens: {
      produto_id: string;
      nome: string;
      preco: number;
      quantidade: number;
      opcionais?: { opcional_id: string; nome_snapshot: string; preco_snapshot: number; quantidade: number }[];
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

// ══════════════════════════════════════════════════════════════════════════════
// 085/086 — Integração DB-real: RPC criar_pedido com OPCIONAIS
// ══════════════════════════════════════════════════════════════════════════════
/**
 * Prove que a RPC persiste snapshots de opcionais na MESMA transação e que
 * atomicidade, ON DELETE SET NULL e CHECK constraints funcionam no banco real.
 *
 * A action (pedido.test.ts) já testa mock-level: validações RN-O3/O4/O5.
 * Aqui focamos no que é RESPONSABILIDADE DA RPC:
 *  - persistência do snapshot (nome_snapshot/preco_snapshot/quantidade)
 *  - recálculo do total com opcionais (a action envia os valores já calculados;
 *    provamos que a RPC persiste o que recebe e os opcionais entram corretos)
 *  - atomicidade total (pedido + itens + opcionais — ou nada)
 *  - ON DELETE SET NULL em opcional_id após deletar o opcional
 *  - regressão: pedido sem opcionais segue criando normalmente
 *  - CHECK constraints reforçadas no banco (preco_snapshot >= 0, quantidade > 0)
 */

type CenarioOpcionais = {
  lojaAtiva: string;
  produto1: string; // preco 25.00
  opcAtivoId: string; // opcional ativo, preco 8.00
};

async function semearOpcionais(t: TestDb): Promise<CenarioOpcionais> {
  const DONO_OPC = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  await t.db.query(
    `insert into auth.users (id, email) values ($1, 'dono-opc@teste.local') on conflict (id) do nothing`,
    [DONO_OPC],
  );

  return t.asService(async (db) => {
    const ins = async (sql: string, params: unknown[]) => {
      const r = await db.query<{ id: string }>(sql, params);
      return r.rows[0].id;
    };

    const lojaAtiva = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-opc','Loja Opcionais',true) returning id`,
      [DONO_OPC],
    );
    const produto1 = await ins(
      `insert into public.produtos (loja_id, nome, preco, disponivel) values ($1,'Pão Artesanal',25.00,true) returning id`,
      [lojaAtiva],
    );
    const opcCat = await ins(
      `insert into public.opcionais_categorias (loja_id, nome) values ($1,'Laticínios') returning id`,
      [lojaAtiva],
    );
    const opcAtivoId = await ins(
      `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco, ativo)
         values ($1,$2,'Brie extra',8.00,true) returning id`,
      [lojaAtiva, opcCat],
    );

    return { lojaAtiva, produto1, opcAtivoId };
  });
}

describe("085/086 RPC criar_pedido — integração com opcionais (pglite)", () => {
  let t: TestDb;
  let co: CenarioOpcionais;

  beforeAll(async () => {
    t = await createTestDb();
    co = await semearOpcionais(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ──────────────────────── [O1] snapshot persistido com valores exatos
  it("[O1] item com 2 opcionais → itens_pedido_opcionais tem 2 linhas com snapshot correto", async () => {
    // preco do produto: 25.00 | opcionais: Brie extra 8.00 × 2 e Geleia 6.00 × 1
    // Criamos um segundo opcional inline via service antes do teste
    const opcId2 = await t.asService(async (db) => {
      // Pega a categoria de opcional já criada para reusar
      const catR = await db.query<{ id: string }>(
        `select id from public.opcionais_categorias where loja_id = $1 limit 1`,
        [co.lojaAtiva],
      );
      const r = await db.query<{ id: string }>(
        `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco, ativo)
           values ($1,$2,'Geleia artesanal',6.00,true) returning id`,
        [co.lojaAtiva, catR.rows[0].id],
      );
      return r.rows[0].id;
    });

    // subtotal = (25 + 8×2 + 6×1) × 1 = 47
    const r = await chamarCriarPedido(t, {
      loja_id: co.lojaAtiva,
      subtotal: 47.0,
      taxa_entrega: 0,
      desconto: 0,
      total: 47.0,
      itens: [
        {
          produto_id: co.produto1,
          nome: "Pão Artesanal",
          preco: 25.0,
          quantidade: 1,
          opcionais: [
            { opcional_id: co.opcAtivoId, nome_snapshot: "Brie extra", preco_snapshot: 8.0, quantidade: 2 },
            { opcional_id: opcId2, nome_snapshot: "Geleia artesanal", preco_snapshot: 6.0, quantidade: 1 },
          ],
        },
      ],
    });

    expect(r.pedido_id).toBeTruthy();

    // localiza o item gerado
    const itemRow = await t.asService((db) =>
      db.query<{ id: string }>(
        `select id from public.itens_pedido where pedido_id = $1`,
        [r.pedido_id],
      ),
    );
    const itemPedidoId = itemRow.rows[0].id;

    // verifica as 2 linhas de opcionais
    const opRows = await t.asService((db) =>
      db.query<{ nome_snapshot: string; preco_snapshot: string; quantidade: number; item_pedido_id: string }>(
        `select nome_snapshot, preco_snapshot, quantidade, item_pedido_id
           from public.itens_pedido_opcionais
          where item_pedido_id = $1
          order by nome_snapshot`,
        [itemPedidoId],
      ),
    );

    expect(opRows.rows.length).toBe(2);

    // linha "Brie extra"
    const brie = opRows.rows.find((r) => r.nome_snapshot === "Brie extra");
    expect(brie).toBeDefined();
    expect(Number(brie!.preco_snapshot)).toBe(8.0);
    expect(brie!.quantidade).toBe(2);
    expect(brie!.item_pedido_id).toBe(itemPedidoId);

    // linha "Geleia artesanal"
    const geleia = opRows.rows.find((r) => r.nome_snapshot === "Geleia artesanal");
    expect(geleia).toBeDefined();
    expect(Number(geleia!.preco_snapshot)).toBe(6.0);
    expect(geleia!.quantidade).toBe(1);
    expect(geleia!.item_pedido_id).toBe(itemPedidoId);
  });

  // ──────────────────────── [O2] total recalculado com opcionais bate
  it("[O2] total persistido pelo servidor bate com (produto + Σ op×qtd) × qtd_item + frete − desconto", async () => {
    // 1 item, quantidade 2: produto 25 + opcional Brie 8×3 = 49; × 2 = 98; + frete 7 − desconto 0 = 105
    const r = await chamarCriarPedido(t, {
      loja_id: co.lojaAtiva,
      subtotal: 98.0, // (25 + 8×3) × 2 = 49 × 2
      taxa_entrega: 7.0,
      desconto: 0,
      total: 105.0,
      itens: [
        {
          produto_id: co.produto1,
          nome: "Pão Artesanal",
          preco: 25.0,
          quantidade: 2,
          opcionais: [
            { opcional_id: co.opcAtivoId, nome_snapshot: "Brie extra", preco_snapshot: 8.0, quantidade: 3 },
          ],
        },
      ],
    });

    const ped = await t.asService((db) =>
      db.query<{ subtotal: string; taxa_entrega: string; total: string }>(
        `select subtotal, taxa_entrega, total from public.pedidos where id = $1`,
        [r.pedido_id],
      ),
    );

    expect(Number(ped.rows[0].subtotal)).toBe(98.0);
    expect(Number(ped.rows[0].taxa_entrega)).toBe(7.0);
    expect(Number(ped.rows[0].total)).toBe(105.0);

    // os opcionais do item foram persistidos com quantidade=3
    const opRows = await t.asService((db) =>
      db.query<{ quantidade: number }>(
        `select ipo.quantidade
           from public.itens_pedido_opcionais ipo
           join public.itens_pedido ip on ip.id = ipo.item_pedido_id
          where ip.pedido_id = $1`,
        [r.pedido_id],
      ),
    );
    expect(opRows.rows.length).toBe(1);
    expect(opRows.rows[0].quantidade).toBe(3);
  });

  // ──────────────────────── [O3] atomicidade (RN-O6): falha no INSERT de opcional → rollback total
  it("[O3] falha no opcional (preco_snapshot = -1) → rollback total: pedidos/itens/opcionais intocados", async () => {
    const antesPedidos = await contar(t, `select 1 from public.pedidos where loja_id = $1`, [co.lojaAtiva]);
    const antesItens = await contar(t, `select 1 from public.itens_pedido ip join public.pedidos p on p.id = ip.pedido_id where p.loja_id = $1`, [co.lojaAtiva]);
    const antesOpcionais = await contar(t, `select 1 from public.itens_pedido_opcionais ipo join public.itens_pedido ip on ip.id = ipo.item_pedido_id join public.pedidos p on p.id = ip.pedido_id where p.loja_id = $1`, [co.lojaAtiva]);

    // preco_snapshot = -1 viola CHECK → a RPC deve lançar e abortar toda a transação
    let lançou = false;
    try {
      await chamarCriarPedido(t, {
        loja_id: co.lojaAtiva,
        subtotal: 25.0,
        taxa_entrega: 0,
        desconto: 0,
        total: 25.0,
        itens: [
          {
            produto_id: co.produto1,
            nome: "Pão Artesanal",
            preco: 25.0,
            quantidade: 1,
            opcionais: [
              { opcional_id: co.opcAtivoId, nome_snapshot: "Brie extra", preco_snapshot: -1, quantidade: 1 },
            ],
          },
        ],
      });
    } catch {
      lançou = true;
    }

    expect(lançou).toBe(true);

    // contagens inalteradas — rollback total
    const depoisPedidos = await contar(t, `select 1 from public.pedidos where loja_id = $1`, [co.lojaAtiva]);
    const depoisItens = await contar(t, `select 1 from public.itens_pedido ip join public.pedidos p on p.id = ip.pedido_id where p.loja_id = $1`, [co.lojaAtiva]);
    const depoisOpcionais = await contar(t, `select 1 from public.itens_pedido_opcionais ipo join public.itens_pedido ip on ip.id = ipo.item_pedido_id join public.pedidos p on p.id = ip.pedido_id where p.loja_id = $1`, [co.lojaAtiva]);

    expect(depoisPedidos).toBe(antesPedidos);
    expect(depoisItens).toBe(antesItens);
    expect(depoisOpcionais).toBe(antesOpcionais);
  });

  // ──────────────────────── [O4] ON DELETE SET NULL em opcional_id
  it("[O4] deletar opcional após pedido → opcional_id vira NULL mas nome/preco_snapshot imutáveis", async () => {
    // cria pedido com o opcional ativo
    const r = await chamarCriarPedido(t, {
      loja_id: co.lojaAtiva,
      subtotal: 33.0, // 25 + 8×1
      taxa_entrega: 0,
      desconto: 0,
      total: 33.0,
      itens: [
        {
          produto_id: co.produto1,
          nome: "Pão Artesanal",
          preco: 25.0,
          quantidade: 1,
          opcionais: [
            { opcional_id: co.opcAtivoId, nome_snapshot: "Brie extra", preco_snapshot: 8.0, quantidade: 1 },
          ],
        },
      ],
    });

    // localiza a linha em itens_pedido_opcionais
    const itemId = await t.asService(async (db) => {
      const row = await db.query<{ id: string }>(
        `select id from public.itens_pedido where pedido_id = $1`,
        [r.pedido_id],
      );
      return row.rows[0].id;
    });

    const ipoAntes = await t.asService((db) =>
      db.query<{ opcional_id: string | null; nome_snapshot: string; preco_snapshot: string }>(
        `select opcional_id, nome_snapshot, preco_snapshot
           from public.itens_pedido_opcionais
          where item_pedido_id = $1`,
        [itemId],
      ),
    );
    expect(ipoAntes.rows[0].opcional_id).toBe(co.opcAtivoId);
    expect(ipoAntes.rows[0].nome_snapshot).toBe("Brie extra");
    expect(Number(ipoAntes.rows[0].preco_snapshot)).toBe(8.0);

    // deleta o opcional (como service)
    await t.asService((db) =>
      db.query(`delete from public.opcionais where id = $1`, [co.opcAtivoId]),
    );

    // a linha do snapshot persiste mas opcional_id = NULL (ON DELETE SET NULL)
    const ipoDepois = await t.asService((db) =>
      db.query<{ opcional_id: string | null; nome_snapshot: string; preco_snapshot: string }>(
        `select opcional_id, nome_snapshot, preco_snapshot
           from public.itens_pedido_opcionais
          where item_pedido_id = $1`,
        [itemId],
      ),
    );
    expect(ipoDepois.rows.length).toBe(1); // linha não foi removida com cascata
    expect(ipoDepois.rows[0].opcional_id).toBeNull(); // ON DELETE SET NULL aplicou
    expect(ipoDepois.rows[0].nome_snapshot).toBe("Brie extra"); // snapshot imutável
    expect(Number(ipoDepois.rows[0].preco_snapshot)).toBe(8.0); // snapshot imutável
  });

  // ──────────────────────── [O5] regressão: pedido sem opcionais segue normal
  it("[O5] pedido sem opcionais: cria pedido + itens sem linhas em itens_pedido_opcionais (regressão)", async () => {
    const r = await chamarCriarPedido(t, {
      loja_id: co.lojaAtiva,
      subtotal: 25.0,
      taxa_entrega: 0,
      desconto: 0,
      total: 25.0,
      itens: [{ produto_id: co.produto1, nome: "Pão Artesanal", preco: 25.0, quantidade: 1 }],
    });

    expect(r.pedido_id).toBeTruthy();
    expect(r.token_acesso).toBeTruthy();

    const itens = await contar(t, `select 1 from public.itens_pedido where pedido_id = $1`, [r.pedido_id]);
    expect(itens).toBe(1);

    const opcionais = await contar(
      t,
      `select 1 from public.itens_pedido_opcionais ipo
         join public.itens_pedido ip on ip.id = ipo.item_pedido_id
        where ip.pedido_id = $1`,
      [r.pedido_id],
    );
    expect(opcionais).toBe(0); // nenhum opcional → 0 linhas
  });

  // ──────────────────────── [O6] CHECK constraints diretas no banco
  it("[O6a] INSERT direto com preco_snapshot = -1 viola CHECK (rejeitado; nada persiste)", async () => {
    // Cria um item_pedido válido para usar como FK
    const itemId = await t.asService(async (db) => {
      const ped = await db.query<{ id: string }>(
        `insert into public.pedidos (loja_id, nome_cliente, subtotal, total)
           values ($1,'Cli CHECK',25,25) returning id`,
        [co.lojaAtiva],
      );
      const item = await db.query<{ id: string }>(
        `insert into public.itens_pedido (pedido_id, nome, preco, quantidade)
           values ($1,'Pão',25,1) returning id`,
        [ped.rows[0].id],
      );
      return item.rows[0].id;
    });

    // Precisa de um opcional válido — cria novo pois o anterior foi deletado em [O4]
    const opcNovo = await t.asService(async (db) => {
      const cat = await db.query<{ id: string }>(
        `select id from public.opcionais_categorias where loja_id = $1 limit 1`,
        [co.lojaAtiva],
      );
      const r = await db.query<{ id: string }>(
        `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco, ativo)
           values ($1,$2,'Queijo fresco',5.00,true) returning id`,
        [co.lojaAtiva, cat.rows[0].id],
      );
      return r.rows[0].id;
    });

    let rejeitou = false;
    try {
      await t.asService((db) =>
        db.query(
          `insert into public.itens_pedido_opcionais
             (item_pedido_id, opcional_id, nome_snapshot, preco_snapshot, quantidade)
             values ($1,$2,'Queijo fresco',-1,1)`,
          [itemId, opcNovo],
        ),
      );
    } catch {
      rejeitou = true;
    }
    expect(rejeitou).toBe(true);

    const n = await contar(
      t,
      `select 1 from public.itens_pedido_opcionais where item_pedido_id = $1`,
      [itemId],
    );
    expect(n).toBe(0);
  });

  it("[O6b] INSERT direto com quantidade = 0 viola CHECK (rejeitado; nada persiste)", async () => {
    const itemId = await t.asService(async (db) => {
      const ped = await db.query<{ id: string }>(
        `insert into public.pedidos (loja_id, nome_cliente, subtotal, total)
           values ($1,'Cli CHECK2',25,25) returning id`,
        [co.lojaAtiva],
      );
      const item = await db.query<{ id: string }>(
        `insert into public.itens_pedido (pedido_id, nome, preco, quantidade)
           values ($1,'Pão',25,1) returning id`,
        [ped.rows[0].id],
      );
      return item.rows[0].id;
    });

    const opcNovo2 = await t.asService(async (db) => {
      const cat = await db.query<{ id: string }>(
        `select id from public.opcionais_categorias where loja_id = $1 limit 1`,
        [co.lojaAtiva],
      );
      const r = await db.query<{ id: string }>(
        `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco, ativo)
           values ($1,$2,'Manteiga',3.00,true) returning id`,
        [co.lojaAtiva, cat.rows[0].id],
      );
      return r.rows[0].id;
    });

    let rejeitou = false;
    try {
      await t.asService((db) =>
        db.query(
          `insert into public.itens_pedido_opcionais
             (item_pedido_id, opcional_id, nome_snapshot, preco_snapshot, quantidade)
             values ($1,$2,'Manteiga',3.00,0)`,
          [itemId, opcNovo2],
        ),
      );
    } catch {
      rejeitou = true;
    }
    expect(rejeitou).toBe(true);

    const n = await contar(
      t,
      `select 1 from public.itens_pedido_opcionais where item_pedido_id = $1`,
      [itemId],
    );
    expect(n).toBe(0);
  });
});
