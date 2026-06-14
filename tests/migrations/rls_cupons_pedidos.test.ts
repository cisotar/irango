import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 006 — RLS de cupons, pedidos e itens_pedido.
 *
 * Tabelas: cupons, pedidos, itens_pedido. Todas já têm RLS habilitada pela 001
 * (schema_inicial) e ZERO policies → deny-all. A migration de policies
 * (`20260614002500_rls_cupons_pedidos.sql`) AINDA NÃO EXISTE.
 *
 * Consequência (o RED esperado): com deny-all, anon/authenticated não leem NEM
 * escrevem NADA dessas 3 tabelas. Logo, os cenários que DEVERIAM SER PERMITIDOS
 * falham hoje:
 *  - dono A NÃO lê o próprio cupom                                    → FALHA agora
 *  - dono A NÃO faz CRUD do próprio cupom                             → FALHA agora
 *  - anon NÃO insere pedido (deveria, WITH CHECK true)               → FALHA agora
 *  - anon NÃO insere item de pedido (deveria, WITH CHECK true)       → FALHA agora
 *  - dono A NÃO lê os pedidos da própria loja                        → FALHA agora
 *  - dono A NÃO atualiza status do próprio pedido                    → FALHA agora
 *  - dono A NÃO lê itens dos próprios pedidos                        → FALHA agora
 *  - os testes de NEGAÇÃO (anon não lê cupom/pedido/item; B não vê A;
 *    WITH CHECK de cupom; anon não altera pedido) passam por excesso de
 *    deny-all — não provam o RED, mas ficam registrados contra regressão.
 *
 * Leitura por token (cenário 10) NÃO é policy: é o caminho service_role
 * (BYPASSRLS) `select where id=$1 and token_acesso=$2`. Documenta o mecanismo
 * (issue 011/026/028) — passa hoje e depois do GREEN, pois não depende de policy.
 *
 * Quem deixa verde é a fase GREEN (`executar`), escrevendo a migration com as
 * 5 policies de seguranca.md §2 (ver CONTRATO no fim do arquivo). Nenhum código
 * de produção é escrito aqui.
 *
 * Padrão anti-falso-verde (herdado de rls_catalogo.test.ts):
 *  - leitura "permitida" confirmada por NÚMERO DE LINHAS visíveis.
 *  - escrita "permitida" confirmada por LINHAS AFETADAS + reconferência via
 *    asService (BYPASSRLS) de que o dado REALMENTE mudou/persistiu.
 *  - negação NUNCA aceita por "relation does not exist": a tabela existe.
 *    Negação = 0 linhas / 0 afetadas / rejeição de WITH CHECK, sempre reconferida
 *    via asService.
 */

// IDs fixos para asserts determinísticos.
const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

type Cenario = {
  lojaA: string; // dono A
  lojaB: string; // dono B
  cupomA: string; // cupom da loja A
  pedidoA: string; // pedido da loja A
  pedidoB: string; // pedido da loja B
  itemA: string; // item do pedidoA
  itemB: string; // item do pedidoB
  tokenA: string; // token_acesso do pedidoA (capturado)
};

/** Cria os dois donos em auth.users via superuser (service_role não tem grant em auth). */
async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a@teste.local'),
       ($2, 'dono-b@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B],
  );
}

/** Monta o cenário base via asService (bypass RLS) e retorna todos os ids + token. */
async function criarCenario(t: TestDb): Promise<Cenario> {
  await garantirDonos(t);
  return t.asService(async (db) => {
    const ins = async (sql: string, params: unknown[]) => {
      const r = await db.query<{ id: string }>(sql, params);
      return r.rows[0].id;
    };

    // lojas
    const lojaA = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-a','Loja A',true) returning id`,
      [DONO_A],
    );
    const lojaB = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-b','Loja B',true) returning id`,
      [DONO_B],
    );

    // cupom da loja A
    const cupomA = await ins(
      `insert into public.cupons (loja_id, codigo, tipo, valor) values ($1,'PROMO10','percentual',10.00) returning id`,
      [lojaA],
    );

    // pedidos (capturando token do pedido A)
    const pedidoARow = await db.query<{ id: string; token_acesso: string }>(
      `insert into public.pedidos (loja_id, nome_cliente, subtotal, total)
         values ($1,'Cliente A',50.00,50.00) returning id, token_acesso`,
      [lojaA],
    );
    const pedidoA = pedidoARow.rows[0].id;
    const tokenA = pedidoARow.rows[0].token_acesso;

    const pedidoB = await ins(
      `insert into public.pedidos (loja_id, nome_cliente, subtotal, total)
         values ($1,'Cliente B',30.00,30.00) returning id`,
      [lojaB],
    );

    // itens
    const itemA = await ins(
      `insert into public.itens_pedido (pedido_id, nome, preco, quantidade) values ($1,'Item A',50.00,1) returning id`,
      [pedidoA],
    );
    const itemB = await ins(
      `insert into public.itens_pedido (pedido_id, nome, preco, quantidade) values ($1,'Item B',30.00,1) returning id`,
      [pedidoB],
    );

    return { lojaA, lojaB, cupomA, pedidoA, pedidoB, itemA, itemB, tokenA };
  });
}

// ───────────────────────────── reconferências (fonte de verdade via service)
async function existeId(t: TestDb, tabela: string, id: string): Promise<boolean> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.${tabela} where id = $1`, [id]),
  );
  return r.rows.length > 0;
}

async function statusAtual(t: TestDb, id: string): Promise<string | null> {
  const r = await t.asService((db) =>
    db.query<{ status: string }>(`select status from public.pedidos where id = $1`, [id]),
  );
  return r.rows[0]?.status ?? null;
}

async function codigoExiste(t: TestDb, codigo: string): Promise<boolean> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.cupons where codigo = $1`, [codigo]),
  );
  return r.rows.length > 0;
}

/**
 * Confere via service_role (BYPASSRLS) que existe exatamente 1 linha numa coluna
 * marcadora única — espelha o fluxo real (seguranca.md §2 linhas 213-223): o anon
 * INSERE, e quem LÊ a linha de volta é o service_role, nunca o anon.
 */
async function existePorMarcador(
  t: TestDb,
  tabela: string,
  coluna: string,
  valor: string,
): Promise<number> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.${tabela} where ${coluna} = $1`, [valor]),
  );
  return r.rows.length;
}

describe("006 RLS de cupons, pedidos e itens_pedido", () => {
  let t: TestDb;
  let ids: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    ids = await criarCenario(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ═══════════════════════════ CUPONS
  it("[1] dono A LÊ o próprio cupom (1 linha)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(`select id from public.cupons where id = $1`, [ids.cupomA]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.cupomA);
  });

  it("[2] anon NÃO lê cupom, nem por id conhecido (0 linhas; existe via service) — anti-enumeração", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.cupons where id = $1`, [ids.cupomA]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "cupons", ids.cupomA)).toBe(true);
  });

  it("[3] dono B NÃO lê cupom de A (isolamento — 0 linhas; existe via service)", async () => {
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`select id from public.cupons where id = $1`, [ids.cupomA]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "cupons", ids.cupomA)).toBe(true);
  });

  it("[4] dono A INSERE cupom na própria loja (aceito, persistiu)", async () => {
    let inseriu = false;
    try {
      await t.asUser(DONO_A, (db) =>
        db.query(`insert into public.cupons (loja_id, codigo, tipo, valor) values ($1,'NOVO15','fixo',15.00)`, [
          ids.lojaA,
        ]),
      );
      inseriu = true;
    } catch {
      inseriu = false;
    }
    expect(inseriu).toBe(true);
    expect(await codigoExiste(t, "NOVO15")).toBe(true);
  });

  it("[5] dono A ATUALIZA o próprio cupom (1 linha afetada + persistiu)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`update public.cupons set ativo = false where id = $1`, [ids.cupomA]),
    );
    expect(r.affectedRows).toBe(1);
    const conf = await t.asService((db) =>
      db.query<{ ativo: boolean }>(`select ativo from public.cupons where id = $1`, [ids.cupomA]),
    );
    expect(conf.rows[0].ativo).toBe(false);
  });

  it("[6] dono A DELETA cupom próprio (1 linha afetada; não existe mais)", async () => {
    // cupom descartável, criado só para este teste
    const id = await t.asService(async (db) => {
      const r = await db.query<{ id: string }>(
        `insert into public.cupons (loja_id, codigo, tipo, valor) values ($1,'DEL20','fixo',20.00) returning id`,
        [ids.lojaA],
      );
      return r.rows[0].id;
    });
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`delete from public.cupons where id = $1`, [id]),
    );
    expect(r.affectedRows).toBe(1);
    expect(await existeId(t, "cupons", id)).toBe(false);
  });

  it("[7] dono B NÃO insere cupom forjando loja_id de A (WITH CHECK, nada persiste)", async () => {
    let rejeitou = false;
    try {
      await t.asUser(DONO_B, (db) =>
        db.query(`insert into public.cupons (loja_id, codigo, tipo, valor) values ($1,'FORJADO','fixo',5.00)`, [
          ids.lojaA, // loja de outro dono
        ]),
      );
    } catch {
      rejeitou = true;
    }
    expect(rejeitou).toBe(true);
    expect(await codigoExiste(t, "FORJADO")).toBe(false);
  });

  it("[8] dono B NÃO atualiza nem deleta cupom de A (0 afetadas; intacto)", async () => {
    const upd = await t.asUser(DONO_B, (db) =>
      db.query(`update public.cupons set valor = 0.01 where id = $1`, [ids.cupomA]),
    );
    expect(upd.affectedRows).toBe(0);
    const del = await t.asUser(DONO_B, (db) =>
      db.query(`delete from public.cupons where id = $1`, [ids.cupomA]),
    );
    expect(del.affectedRows).toBe(0);
    expect(await existeId(t, "cupons", ids.cupomA)).toBe(true);
  });

  it("[9] anon NÃO insere cupom (nada persiste)", async () => {
    let rejeitou = false;
    try {
      await t.asAnon((db) =>
        db.query(`insert into public.cupons (loja_id, codigo, tipo, valor) values ($1,'ANONCUP','fixo',5.00)`, [
          ids.lojaA,
        ]),
      );
    } catch {
      rejeitou = true;
    }
    expect(rejeitou).toBe(true);
    expect(await codigoExiste(t, "ANONCUP")).toBe(false);
  });

  // ═══════════════════════════ PEDIDOS
  it("[10] anon INSERE pedido sem login (aceito; persistiu via service)", async () => {
    // SEM `returning`: no Postgres o RETURNING é avaliado contra a policy de
    // SELECT da linha, e o design PROÍBE SELECT anon em pedidos (anti-enumeração
    // — testes [11]/[15]). O fluxo real (seguranca.md §2 linhas 213-223): anon
    // INSERE (WITH CHECK true autoriza a operação) e a leitura do id/token_acesso
    // é feita depois por service_role (`where id=$1 and token_acesso=$2`), nunca
    // pelo anon. Provamos a permissão por affectedRows e reconferimos a linha via
    // service_role por um marcador único (nome_cliente).
    const MARCADOR = "Cliente Anon [10]";
    let inseriu = false;
    try {
      const r = await t.asAnon((db) =>
        db.query(
          `insert into public.pedidos (loja_id, nome_cliente, subtotal, total)
             values ($1,$2,25.00,25.00)`,
          [ids.lojaA, MARCADOR],
        ),
      );
      inseriu = r.affectedRows === 1;
    } catch {
      inseriu = false;
    }
    expect(inseriu).toBe(true);
    expect(await existePorMarcador(t, "pedidos", "nome_cliente", MARCADOR)).toBe(1);
  });

  it("[11] anon NÃO lê pedidos via SELECT (0 linhas; existem via service) — anti-listagem", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.pedidos where id = $1`, [ids.pedidoA]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "pedidos", ids.pedidoA)).toBe(true);
  });

  it("[12] leitura por token (service_role): id+token correto → 1 linha; token errado → 0 linhas (mecanismo, não policy)", async () => {
    // Caminho real da confirmação (issue 011/026/028): service_role com filtro id+token.
    const certo = await t.asService((db) =>
      db.query(`select id from public.pedidos where id = $1 and token_acesso = $2`, [
        ids.pedidoA,
        ids.tokenA,
      ]),
    );
    expect(certo.rows.length).toBe(1);

    const errado = await t.asService((db) =>
      db.query(`select id from public.pedidos where id = $1 and token_acesso = $2`, [
        ids.pedidoA,
        "00000000-0000-0000-0000-000000000000",
      ]),
    );
    expect(errado.rows.length).toBe(0);
  });

  it("[13] dono A LÊ os pedidos da própria loja (1 linha)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(`select id from public.pedidos where id = $1`, [ids.pedidoA]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.pedidoA);
  });

  it("[14] dono A ATUALIZA status do próprio pedido (1 afetada + persistiu)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`update public.pedidos set status = 'confirmado' where id = $1`, [ids.pedidoA]),
    );
    expect(r.affectedRows).toBe(1);
    expect(await statusAtual(t, ids.pedidoA)).toBe("confirmado");
  });

  it("[15] dono B NÃO lê pedidos de A (isolamento — 0 linhas; existe via service)", async () => {
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`select id from public.pedidos where id = $1`, [ids.pedidoA]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "pedidos", ids.pedidoA)).toBe(true);
  });

  it("[16] dono A NÃO troca loja_id de um pedido próprio para a loja de B (WITH CHECK; loja_id intacto)", async () => {
    let rejeitouOuZero = false;
    try {
      const r = await t.asUser(DONO_A, (db) =>
        db.query(`update public.pedidos set loja_id = $1 where id = $2`, [ids.lojaB, ids.pedidoA]),
      );
      // se não lançar, deve ter afetado 0 (USING/WITH CHECK barra) — nunca reescrever para B
      rejeitouOuZero = r.affectedRows === 0;
    } catch {
      rejeitouOuZero = true; // WITH CHECK rejeita com erro
    }
    expect(rejeitouOuZero).toBe(true);
    // o pedido continua pertencendo à loja A
    const conf = await t.asService((db) =>
      db.query<{ loja_id: string }>(`select loja_id from public.pedidos where id = $1`, [
        ids.pedidoA,
      ]),
    );
    expect(conf.rows[0].loja_id).toBe(ids.lojaA);
  });

  it("[17] dono B NÃO atualiza nem deleta pedido de A (0 afetadas; intacto)", async () => {
    const upd = await t.asUser(DONO_B, (db) =>
      db.query(`update public.pedidos set status = 'cancelado' where id = $1`, [ids.pedidoA]),
    );
    expect(upd.affectedRows).toBe(0);
    const del = await t.asUser(DONO_B, (db) =>
      db.query(`delete from public.pedidos where id = $1`, [ids.pedidoA]),
    );
    expect(del.affectedRows).toBe(0);
    expect(await statusAtual(t, ids.pedidoA)).not.toBe("cancelado");
    expect(await existeId(t, "pedidos", ids.pedidoA)).toBe(true);
  });

  it("[18] anon NÃO atualiza nem deleta pedido (0 afetadas; intacto)", async () => {
    const upd = await t.asAnon((db) =>
      db.query(`update public.pedidos set status = 'entregue' where id = $1`, [ids.pedidoA]),
    );
    expect(upd.affectedRows).toBe(0);
    const del = await t.asAnon((db) =>
      db.query(`delete from public.pedidos where id = $1`, [ids.pedidoA]),
    );
    expect(del.affectedRows).toBe(0);
    expect(await statusAtual(t, ids.pedidoA)).not.toBe("entregue");
    expect(await existeId(t, "pedidos", ids.pedidoA)).toBe(true);
  });

  // ═══════════════════════════ ITENS_PEDIDO
  it("[19] anon INSERE item do pedido (aceito; persistiu via service)", async () => {
    // SEM `returning`: idem [10]. O design proíbe SELECT anon em itens_pedido
    // (testes [20]/[22]), então RETURNING como anon falharia sempre. Fluxo real
    // (seguranca.md §2 linhas 213-223, policy itens_pedido_insert_publico): anon
    // INSERE (WITH CHECK true) e o service_role lê depois. Permissão provada por
    // affectedRows; linha reconferida via service_role por marcador único (nome).
    const MARCADOR = "Item Anon [19]";
    // Pedido pendente DEDICADO (via service) — não reusa pedidoA, cujo status o
    // teste [14] muda. A policy itens_pedido_insert_publico (hardening auditoria
    // 006) só aceita item de pedido 'pendente' de loja ativa.
    const pedFresco = await t.asService((db) =>
      db.query<{ id: string }>(
        `insert into public.pedidos (loja_id, nome_cliente, subtotal, total)
           values ($1,'Cliente Fresco',10,10) returning id`,
        [ids.lojaA],
      ),
    );
    const pedFrescoId = pedFresco.rows[0].id;
    let inseriu = false;
    try {
      const r = await t.asAnon((db) =>
        db.query(
          `insert into public.itens_pedido (pedido_id, nome, preco, quantidade)
             values ($1,$2,25.00,1)`,
          [pedFrescoId, MARCADOR],
        ),
      );
      inseriu = r.affectedRows === 1;
    } catch {
      inseriu = false;
    }
    expect(inseriu).toBe(true);
    expect(await existePorMarcador(t, "itens_pedido", "nome", MARCADOR)).toBe(1);
  });

  it("[19b] anon NÃO insere pedido em loja INATIVA (hardening auditoria 006)", async () => {
    const lojaInativa = await t.asService((db) =>
      db.query<{ id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-off','Off',false) returning id`,
        [DONO_A],
      ),
    );
    const MARCADOR = "Pedido Loja Inativa";
    let inseriu = false;
    try {
      const r = await t.asAnon((db) =>
        db.query(
          `insert into public.pedidos (loja_id, nome_cliente, subtotal, total) values ($1,$2,1,1)`,
          [lojaInativa.rows[0].id, MARCADOR],
        ),
      );
      inseriu = r.affectedRows === 1;
    } catch {
      inseriu = false;
    }
    expect(inseriu).toBe(false);
    expect(await existePorMarcador(t, "pedidos", "nome_cliente", MARCADOR)).toBe(0);
  });

  it("[19c] anon NÃO anexa item a pedido NÃO-pendente de terceiro (hardening auditoria 006)", async () => {
    // pedido confirmado (não-pendente) de loja ativa — anon conhece o id mas não pode anexar item.
    const ped = await t.asService((db) =>
      db.query<{ id: string }>(
        `insert into public.pedidos (loja_id, nome_cliente, subtotal, total, status)
           values ($1,'Vítima',10,10,'confirmado') returning id`,
        [ids.lojaA],
      ),
    );
    const MARCADOR = "Item Injetado";
    let inseriu = false;
    try {
      const r = await t.asAnon((db) =>
        db.query(
          `insert into public.itens_pedido (pedido_id, nome, preco, quantidade) values ($1,$2,0,99)`,
          [ped.rows[0].id, MARCADOR],
        ),
      );
      inseriu = r.affectedRows === 1;
    } catch {
      inseriu = false;
    }
    expect(inseriu).toBe(false);
    expect(await existePorMarcador(t, "itens_pedido", "nome", MARCADOR)).toBe(0);
  });

  it("[20] anon NÃO lê itens_pedido via SELECT (0 linhas; existem via service)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.itens_pedido where id = $1`, [ids.itemA]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "itens_pedido", ids.itemA)).toBe(true);
  });

  it("[21] dono A LÊ itens dos próprios pedidos (1 linha)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(`select id from public.itens_pedido where id = $1`, [ids.itemA]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.itemA);
  });

  it("[22] dono B NÃO lê itens de pedido de A (herança de isolamento — 0 linhas; existe via service)", async () => {
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`select id from public.itens_pedido where id = $1`, [ids.itemA]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "itens_pedido", ids.itemA)).toBe(true);
  });

  // ═══════════════════════════ Sanity do BYPASSRLS
  it("[23] service_role lê cupom, pedido e item (bypass RLS)", async () => {
    const cup = await t.asService((db) =>
      db.query(`select id from public.cupons where id = $1`, [ids.cupomA]),
    );
    expect(cup.rows.length).toBe(1);
    const ped = await t.asService((db) =>
      db.query(`select id from public.pedidos where id = $1`, [ids.pedidoA]),
    );
    expect(ped.rows.length).toBe(1);
    const item = await t.asService((db) =>
      db.query(`select id from public.itens_pedido where id = $1`, [ids.itemB]),
    );
    expect(item.rows.length).toBe(1);
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 006:
 *
 * Criar `supabase/migrations/20260614002500_rls_cupons_pedidos.sql` (timestamp >
 * 20260614002000), puramente aditivo (RLS já habilitada na 001), com as 5
 * policies de seguranca.md §2 / plan/006:
 *
 *   cupons_acesso_proprio        ALL    USING/WITH CHECK (EXISTS loja onde dono_id=auth.uid())
 *                                       — NENHUMA policy de SELECT para anon (deny-all)
 *   pedidos_insert_publico       INSERT WITH CHECK (true)
 *   pedidos_acesso_lojista       ALL    USING/WITH CHECK (EXISTS loja do dono)
 *                                       — NENHUMA policy de SELECT para anon
 *   itens_pedido_insert_publico  INSERT WITH CHECK (true)
 *   itens_pedido_lojista         SELECT USING (EXISTS pedido JOIN loja do dono)
 *                                       — NENHUMA policy de SELECT para anon
 *
 * Casos que precisam passar após a migration: [1]..[23].
 *  - [1][5][6][13][14][21] (leitura/CRUD do dono) só passam com as policies do lojista.
 *  - [4] cupom INSERT do dono pela cupons_acesso_proprio (FOR ALL cobre INSERT).
 *  - [10][19] anon INSERE pedido/item pelas *_insert_publico WITH CHECK (true).
 *  - [7] cupom forjado e [16] troca de loja_id rejeitados pelo WITH CHECK.
 *  - [2][3][11][15][18][20][22] (negações) já passam por deny-all hoje — o GREEN
 *    NÃO pode regredi-los criando SELECT anon em cupons/pedidos/itens.
 *  - [12] leitura por token é service_role (mecanismo, fora de policy) — passa sempre.
 */
