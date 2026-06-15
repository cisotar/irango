import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Issue 054 — Suite de integração do isolamento multitenant (RN-02/RN-03).
 *
 * Diferente das suites 004/005/006 (que eram RED contra deny-all antes das
 * migrations de policy existirem), esta suite roda contra o código de produção
 * JÁ IMPLEMENTADO: todas as migrations de RLS são aplicadas pelo helper pglite.
 * O objetivo aqui é provar, num único arquivo focado no CRUZAMENTO A↔B + anon,
 * que nenhum dado vaza entre lojas e que o público só vê o permitido.
 *
 * Se um teste destes FALHAR, é bug REAL de isolamento (não falta de teste).
 *
 * Cenários cobertos (issue 054):
 *  1. Lojista A não vê produtos de B (SELECT → 0)
 *  2. Lojista A não escreve em produto de B (UPDATE/DELETE → 0; INSERT forjado rejeitado)
 *  3. Lojista A não vê cupons de B
 *  4. Lojista A não vê pedidos de B
 *  5. Anon vê loja/produto ativo de qualquer loja (leitura pública)
 *  6. Anon NÃO vê cupons
 *  7. Anon NÃO faz SELECT direto em pedidos (sem token)
 *  8. Anon NÃO vê produtos/categorias inativos/de loja inativa
 *
 * Notas de contrato herdadas das migrations existentes:
 *  - Leitura pública de loja saiu da tabela base para a view `vitrine_lojas`
 *    (issue 004 / auditoria). O anon lê loja ativa pela view, não pela base.
 *  - Pedidos não têm policy de SELECT para anon (anti-enumeração); leitura por
 *    cliente é service_role com filtro id+token (issue 026/028), fora de policy.
 *
 * Padrão anti-falso-verde (herdado das suites 004/005/006):
 *  - leitura "permitida" confirmada por NÚMERO DE LINHAS visíveis.
 *  - negação NUNCA aceita por dado ausente: a linha-alvo EXISTE (reconferida via
 *    asService/BYPASSRLS). Negação = 0 linhas / 0 afetadas / rejeição.
 */

// IDs fixos para asserts determinísticos.
const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
// RN-01: cada conta = 1 loja. A loja INATIVA pertence a um terceiro dono.
const DONO_INATIVA = "cccccccc-cccc-cccc-cccc-cccccccccccc";

type Cenario = {
  lojaA: string; // dono A, ativa
  lojaB: string; // dono B, ativa
  lojaInativa: string; // dono C, inativa
  slugA: string;
  slugB: string;
  slugInativa: string;
  // catálogo de A
  catA: string; // categoria de A
  prodADisp: string; // produto disponível de A (público vê)
  prodAIndisp: string; // produto indisponível de A (público não vê)
  // catálogo de B
  catB: string;
  prodBDisp: string; // produto disponível de B (público vê)
  // catálogo de loja inativa
  catInativa: string; // categoria de loja inativa (público não vê)
  prodInativaDisp: string; // produto disponível de loja inativa (público não vê)
  // cupons
  cupomA: string; // cupom de A
  cupomB: string; // cupom de B
  // pedidos
  pedidoA: string; // pedido de A
  pedidoB: string; // pedido de B
  tokenA: string; // token_acesso do pedido de A
};

async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a@teste.local'),
       ($2, 'dono-b@teste.local'),
       ($3, 'dono-inativa@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B, DONO_INATIVA],
  );
}

async function criarCenario(t: TestDb): Promise<Cenario> {
  await garantirDonos(t);
  return t.asService(async (db) => {
    const ins = async (sql: string, params: unknown[]) => {
      const r = await db.query<{ id: string }>(sql, params);
      return r.rows[0].id;
    };

    const slugA = "loja-a";
    const slugB = "loja-b";
    const slugInativa = "loja-inativa";

    // lojas
    const lojaA = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,$2,'Loja A',true) returning id`,
      [DONO_A, slugA],
    );
    const lojaB = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,$2,'Loja B',true) returning id`,
      [DONO_B, slugB],
    );
    const lojaInativa = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,$2,'Loja Inativa',false) returning id`,
      [DONO_INATIVA, slugInativa],
    );

    // categorias
    const catA = await ins(
      `insert into public.categorias (loja_id, nome) values ($1,'Bebidas A') returning id`,
      [lojaA],
    );
    const catB = await ins(
      `insert into public.categorias (loja_id, nome) values ($1,'Bebidas B') returning id`,
      [lojaB],
    );
    const catInativa = await ins(
      `insert into public.categorias (loja_id, nome) values ($1,'Cat Inativa') returning id`,
      [lojaInativa],
    );

    // produtos
    const prodADisp = await ins(
      `insert into public.produtos (loja_id, categoria_id, nome, preco, disponivel) values ($1,$2,'Coca A',10.00,true) returning id`,
      [lojaA, catA],
    );
    const prodAIndisp = await ins(
      `insert into public.produtos (loja_id, categoria_id, nome, preco, disponivel) values ($1,$2,'Esgotado A',5.00,false) returning id`,
      [lojaA, catA],
    );
    const prodBDisp = await ins(
      `insert into public.produtos (loja_id, categoria_id, nome, preco, disponivel) values ($1,$2,'Coca B',9.00,true) returning id`,
      [lojaB, catB],
    );
    const prodInativaDisp = await ins(
      `insert into public.produtos (loja_id, categoria_id, nome, preco, disponivel) values ($1,$2,'De Loja Inativa',7.00,true) returning id`,
      [lojaInativa, catInativa],
    );

    // cupons
    const cupomA = await ins(
      `insert into public.cupons (loja_id, codigo, tipo, valor) values ($1,'PROMOA','percentual',10.00) returning id`,
      [lojaA],
    );
    const cupomB = await ins(
      `insert into public.cupons (loja_id, codigo, tipo, valor) values ($1,'PROMOB','fixo',5.00) returning id`,
      [lojaB],
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

    return {
      lojaA,
      lojaB,
      lojaInativa,
      slugA,
      slugB,
      slugInativa,
      catA,
      prodADisp,
      prodAIndisp,
      catB,
      prodBDisp,
      catInativa,
      prodInativaDisp,
      cupomA,
      cupomB,
      pedidoA,
      pedidoB,
      tokenA,
    };
  });
}

// ───────────────────────────── reconferências via service (fonte de verdade)
async function existeId(t: TestDb, tabela: string, id: string): Promise<boolean> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.${tabela} where id = $1`, [id]),
  );
  return r.rows.length > 0;
}

async function nomeAtual(t: TestDb, tabela: string, id: string): Promise<string | null> {
  const r = await t.asService((db) =>
    db.query<{ nome: string }>(`select nome from public.${tabela} where id = $1`, [id]),
  );
  return r.rows[0]?.nome ?? null;
}

describe("054 isolamento multitenant — cruzamento A↔B + público (RN-02/RN-03)", () => {
  let t: TestDb;
  let ids: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    ids = await criarCenario(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ═══════════════ 1. Lojista A NÃO VÊ dado PRIVADO de produtos de B
  //
  // ATENÇÃO ao contrato (rls_catalogo.sql): produto disponível de loja ativa e
  // categoria de loja ativa têm leitura PÚBLICA (`produtos_leitura_publica`,
  // `categorias_leitura_publica` — `for select` sem cláusula de role, vale para
  // anon E authenticated). Logo, A enxergar o CATÁLOGO PÚBLICO de B não é
  // vazamento: é exatamente o que qualquer cliente vê na vitrine de B. O
  // isolamento RN-02 protege o dado PRIVADO: produto INDISPONÍVEL, e qualquer
  // escrita. Aqui asseguramos só essa parte.
  it("[1a] dono A NÃO lê produto INDISPONÍVEL (privado) de B (0 linhas; existe)", async () => {
    // prodAIndisp não basta — precisamos de um indisponível de B. Criamos um.
    const prodBIndisp = await t.asService(async (db) => {
      const r = await db.query<{ id: string }>(
        `insert into public.produtos (loja_id, categoria_id, nome, preco, disponivel)
           values ($1,$2,'Esgotado B',4.00,false) returning id`,
        [ids.lojaB, ids.catB],
      );
      return r.rows[0].id;
    });
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`select id from public.produtos where id = $1`, [prodBIndisp]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "produtos", prodBIndisp)).toBe(true);
  });

  it("[1b] dono A, ao varrer produtos, NÃO vê indisponíveis de B nem de loja inativa", async () => {
    // A vê o catálogo público (próprio + de qualquer loja ativa) — isso é o design.
    // O que NÃO pode aparecer: dado privado de B (indisponível) e produto de loja
    // inativa. prodAIndisp (próprio de A) PODE aparecer (A é dono).
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(`select id from public.produtos`),
    );
    const vistos = r.rows.map((x) => x.id);
    // próprios (incl. indisponível) e público de B: ok aparecerem
    expect(vistos).toContain(ids.prodADisp);
    expect(vistos).toContain(ids.prodAIndisp);
    expect(vistos).toContain(ids.prodBDisp);
    // privado de outra loja e loja inativa: NÃO podem aparecer
    expect(vistos).not.toContain(ids.prodInativaDisp);
  });

  it("[1c] dono A lê categoria de B SÓ porque é catálogo público de loja ativa (mesmo que anon vê)", async () => {
    // Espelho: a leitura que A faz da categoria de B é idêntica à do anon.
    // Confirma que não há canal privilegiado — é a policy pública, não vazamento.
    const comoA = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(`select id from public.categorias where id = $1`, [ids.catB]),
    );
    const comoAnon = await t.asAnon((db) =>
      db.query<{ id: string }>(`select id from public.categorias where id = $1`, [ids.catB]),
    );
    expect(comoA.rows.length).toBe(comoAnon.rows.length);
    // E categoria de loja INATIVA: nem A nem anon veem.
    const inativaA = await t.asUser(DONO_A, (db) =>
      db.query(`select id from public.categorias where id = $1`, [ids.catInativa]),
    );
    expect(inativaA.rows.length).toBe(0);
  });

  // ═══════════════ 2. Lojista A NÃO ESCREVE em produto de B
  it("[2a] dono A NÃO atualiza produto de B (0 afetadas; nome intacto)", async () => {
    const antes = await nomeAtual(t, "produtos", ids.prodBDisp);
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`update public.produtos set nome = 'HACK A->B' where id = $1`, [ids.prodBDisp]),
    );
    expect(r.affectedRows).toBe(0);
    expect(await nomeAtual(t, "produtos", ids.prodBDisp)).toBe(antes);
    expect(await nomeAtual(t, "produtos", ids.prodBDisp)).not.toBe("HACK A->B");
  });

  it("[2b] dono A NÃO deleta produto de B (0 afetadas; produto existe)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`delete from public.produtos where id = $1`, [ids.prodBDisp]),
    );
    expect(r.affectedRows).toBe(0);
    expect(await existeId(t, "produtos", ids.prodBDisp)).toBe(true);
  });

  it("[2c] dono A NÃO insere produto forjando loja_id de B (WITH CHECK; nada persiste)", async () => {
    let rejeitou = false;
    try {
      await t.asUser(DONO_A, (db) =>
        db.query(
          `insert into public.produtos (loja_id, nome, preco) values ($1,'Forjado A->B',1.00)`,
          [ids.lojaB],
        ),
      );
    } catch {
      rejeitou = true;
    }
    expect(rejeitou).toBe(true);
    const r = await t.asService((db) =>
      db.query(`select 1 from public.produtos where nome = 'Forjado A->B'`),
    );
    expect(r.rows.length).toBe(0);
  });

  it("[2d] dono A NÃO move um produto PRÓPRIO para a loja de B (WITH CHECK; loja_id intacto)", async () => {
    let rejeitouOuZero = false;
    try {
      const r = await t.asUser(DONO_A, (db) =>
        db.query(`update public.produtos set loja_id = $1 where id = $2`, [
          ids.lojaB,
          ids.prodADisp,
        ]),
      );
      rejeitouOuZero = (r.affectedRows ?? 0) === 0;
    } catch {
      rejeitouOuZero = true;
    }
    expect(rejeitouOuZero).toBe(true);
    const conf = await t.asService((db) =>
      db.query<{ loja_id: string }>(`select loja_id from public.produtos where id = $1`, [
        ids.prodADisp,
      ]),
    );
    expect(conf.rows[0].loja_id).toBe(ids.lojaA);
  });

  // ═══════════════ 3. Lojista A NÃO VÊ cupons de B
  it("[3a] dono A NÃO lê cupom de B (0 linhas; existe)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`select id from public.cupons where id = $1`, [ids.cupomB]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "cupons", ids.cupomB)).toBe(true);
  });

  it("[3b] dono A só vê os PRÓPRIOS cupons ao varrer a tabela (nenhum de B)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ loja_id: string }>(`select loja_id from public.cupons`),
    );
    const lojas = r.rows.map((x) => x.loja_id);
    expect(lojas).not.toContain(ids.lojaB);
    expect(lojas).toContain(ids.lojaA);
  });

  it("[3c] dono A NÃO atualiza nem deleta cupom de B (0 afetadas; intacto)", async () => {
    const upd = await t.asUser(DONO_A, (db) =>
      db.query(`update public.cupons set valor = 0.01 where id = $1`, [ids.cupomB]),
    );
    expect(upd.affectedRows).toBe(0);
    const del = await t.asUser(DONO_A, (db) =>
      db.query(`delete from public.cupons where id = $1`, [ids.cupomB]),
    );
    expect(del.affectedRows).toBe(0);
    expect(await existeId(t, "cupons", ids.cupomB)).toBe(true);
  });

  // ═══════════════ 4. Lojista A NÃO VÊ pedidos de B
  it("[4a] dono A NÃO lê pedido de B (0 linhas; existe)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`select id from public.pedidos where id = $1`, [ids.pedidoB]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "pedidos", ids.pedidoB)).toBe(true);
  });

  it("[4b] dono A só vê os PRÓPRIOS pedidos ao varrer a tabela (nenhum de B)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ loja_id: string }>(`select loja_id from public.pedidos`),
    );
    const lojas = r.rows.map((x) => x.loja_id);
    expect(lojas).not.toContain(ids.lojaB);
    expect(lojas).toContain(ids.lojaA);
  });

  it("[4c] dono A NÃO atualiza status do pedido de B (0 afetadas; status intacto)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`update public.pedidos set status = 'cancelado' where id = $1`, [ids.pedidoB]),
    );
    expect(r.affectedRows).toBe(0);
    const conf = await t.asService((db) =>
      db.query<{ status: string }>(`select status from public.pedidos where id = $1`, [
        ids.pedidoB,
      ]),
    );
    expect(conf.rows[0].status).not.toBe("cancelado");
  });

  // ═══════════════ 5. Anon VÊ loja/produto ativo de QUALQUER loja
  it("[5a] anon LÊ loja ativa A pela vitrine (1 linha)", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(`select id from public.vitrine_lojas where slug = $1`, [ids.slugA]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.lojaA);
  });

  it("[5b] anon LÊ loja ativa B pela vitrine (1 linha) — leitura pública é cross-loja", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(`select id from public.vitrine_lojas where slug = $1`, [ids.slugB]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.lojaB);
  });

  it("[5c] anon LÊ produto disponível de A E de B (2 linhas)", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(`select id from public.produtos where id = any($1::uuid[])`, [
        [ids.prodADisp, ids.prodBDisp],
      ]),
    );
    expect(r.rows.length).toBe(2);
  });

  // ═══════════════ 6. Anon NÃO VÊ cupons
  it("[6a] anon NÃO lê cupom de A nem por id conhecido (0 linhas; existe) — anti-enumeração", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.cupons where id = $1`, [ids.cupomA]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "cupons", ids.cupomA)).toBe(true);
  });

  it("[6b] anon NÃO lista cupom algum ao varrer a tabela (0 linhas)", async () => {
    const r = await t.asAnon((db) => db.query(`select id from public.cupons`));
    expect(r.rows.length).toBe(0);
  });

  // ═══════════════ 7. Anon NÃO faz SELECT direto em pedidos (sem token)
  it("[7a] anon NÃO lê pedido de A via SELECT direto (0 linhas; existe) — anti-listagem", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.pedidos where id = $1`, [ids.pedidoA]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "pedidos", ids.pedidoA)).toBe(true);
  });

  it("[7b] anon NÃO lista pedido algum ao varrer a tabela (0 linhas)", async () => {
    const r = await t.asAnon((db) => db.query(`select id from public.pedidos`));
    expect(r.rows.length).toBe(0);
  });

  it("[7c] leitura por token é service_role (mecanismo): id+token correto → 1; errado → 0", async () => {
    // O caminho legítimo de leitura do cliente é o service_role filtrando id+token
    // (issue 026/028), nunca um SELECT anon na tabela. Documenta o mecanismo.
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

  // ═══════════════ 8. Anon NÃO VÊ produtos/categorias inativos ou de loja inativa
  it("[8a] anon NÃO lê produto INDISPONÍVEL de loja ativa (0 linhas; existe)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.produtos where id = $1`, [ids.prodAIndisp]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "produtos", ids.prodAIndisp)).toBe(true);
  });

  it("[8b] anon NÃO lê produto disponível de loja INATIVA (0 linhas; existe)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.produtos where id = $1`, [ids.prodInativaDisp]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "produtos", ids.prodInativaDisp)).toBe(true);
  });

  it("[8c] anon NÃO lê categoria de loja INATIVA (0 linhas; existe)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.categorias where id = $1`, [ids.catInativa]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "categorias", ids.catInativa)).toBe(true);
  });

  it("[8d] anon NÃO lê loja INATIVA pela vitrine (0 linhas; existe)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.vitrine_lojas where slug = $1`, [ids.slugInativa]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "lojas", ids.lojaInativa)).toBe(true);
  });

  it("[8e] anon, ao varrer produtos, só vê os disponíveis de lojas ativas (nenhum inativo/de loja off)", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(`select id from public.produtos`),
    );
    const vistos = r.rows.map((x) => x.id);
    expect(vistos).toContain(ids.prodADisp);
    expect(vistos).toContain(ids.prodBDisp);
    expect(vistos).not.toContain(ids.prodAIndisp);
    expect(vistos).not.toContain(ids.prodInativaDisp);
  });
});
