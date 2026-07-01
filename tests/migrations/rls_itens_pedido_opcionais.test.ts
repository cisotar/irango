import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 108 — RLS de ISOLAMENTO da tabela
 * `itens_pedido_opcionais` (snapshot de opcionais escolhidos num pedido).
 *
 * NATUREZA DESTA ISSUE (verificação, não construção):
 * As policies JÁ EXISTEM em `supabase/migrations/20260614007500_opcionais.sql:207-222`:
 *   - `ipo_insert_publico`  — INSERT anon via helper definer (não dá SELECT ao anon).
 *   - `ipo_leitura_lojista` — SELECT só do dono, via
 *        itens_pedido → pedidos → lojas → dono_id = auth.uid().
 *   - NÃO existe nenhuma policy de SELECT para anon → anon é deny-all em leitura.
 * Logo, este teste NASCE VERDE — e isso é o próprio veredito da issue ("policy
 * suficiente → no-op"). Um teste de RLS que nasce verde NÃO prova, por si, que
 * tem poder de detecção; por isso o RED abaixo é SINTÉTICO.
 *
 * Diferença vs. issue 103 (`opcionais`): aqui NÃO há policy pública de SELECT.
 * Então o isolamento cross-loja é direto: dono A vê 0 linhas do opcional de
 * pedido da loja B, e anon vê 0 de qualquer linha. `ipo_leitura_lojista` NÃO
 * chama `loja_esta_ativa` → não há caso de "loja inativa" relevante (ambas ativas).
 *
 * ═══════════════════ RED SINTÉTICO COMPROVADO (poder de detecção) ═══════════════
 * O teste nasce verde (a policy já existe). Para provar que tem poder de detecção,
 * derrubei localmente a policy de leitura do dono logo após createTestDb():
 *
 *     await t.db.exec(`drop policy "ipo_leitura_lojista" on public.itens_pedido_opcionais`);
 *
 * Sem ela, `itens_pedido_opcionais` fica SEM nenhuma policy de SELECT → deny-all
 * para authenticated → o dono deixa de ler o próprio. Output real capturado
 * (2026-06-30, com o snippet acima ativo):
 *
 *   FAIL  tests/migrations/rls_itens_pedido_opcionais.test.ts > 108 RLS isolamento
 *         itens_pedido_opcionais > [1] dono A LÊ o próprio opcional de pedido (1 linha)
 *     AssertionError: expected +0 to be 1 // Object.is equality
 *     - Expected   1
 *     + Received   0
 *   FAIL  tests/migrations/rls_itens_pedido_opcionais.test.ts > 108 RLS isolamento
 *         itens_pedido_opcionais > [2] dono B LÊ o próprio opcional de pedido (1 linha)
 *     AssertionError: expected +0 to be 1 // Object.is equality
 *     - Expected   1
 *     + Received   0
 *      Test Files  1 failed (1)
 *           Tests  2 failed | 5 passed (7)
 *
 * Leitura: sem a policy, [1] e [2] caem para 0 (dono perde a leitura própria) e
 * falham; os 5 demais (negações [3][3b][4][5] e o bypass [6]) seguem verdes —
 * negar continua negando. Restaurando a policy (estado real do repo), a suite
 * fica 7/7 verde. Esse ciclo vermelho→verde prova que [1]/[2] REALMENTE dependem
 * de `ipo_leitura_lojista`, não passam por acidente / deny-all / dado ausente.
 * O snippet do drop NÃO faz parte da suite verde (foi removido após a captura).
 *
 * Quem mantém verde é o estado atual da migration 080. Nenhum código de produção
 * é escrito aqui (no-op de produção — ver CONTRATO no fim).
 *
 * Padrão anti-falso-verde (herdado de rls_opcionais_leitura_propria.test.ts):
 *  - leitura "permitida" confirmada por NÚMERO DE LINHAS visíveis sob o role real.
 *  - negação NUNCA aceita por "relation does not exist" nem por dado ausente: a
 *    linha alvo SEMPRE é reconferida via asService (BYPASSRLS) — negação = RLS,
 *    não falta de dado.
 *  - o harness pglite roda como superuser e IGNORA RLS sem asUser/asAnon/asService.
 */

// IDs fixos para asserts determinísticos.
const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

type Cenario = {
  lojaA: string; // dono A, ATIVA
  lojaB: string; // dono B, ATIVA
  ipoA: string; // itens_pedido_opcionais do pedido da loja A
  ipoB: string; // itens_pedido_opcionais do pedido da loja B
};

/** Cria os donos em auth.users via superuser (service_role não tem grant em auth). */
async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a@teste.local'),
       ($2, 'dono-b@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B],
  );
}

/** Monta a cadeia loja → pedido → item → ipo via asService (bypass RLS). */
async function criarCenario(t: TestDb): Promise<Cenario> {
  await garantirDonos(t);
  return t.asService(async (db) => {
    const ins = async (sql: string, params: unknown[]) => {
      const r = await db.query<{ id: string }>(sql, params);
      return r.rows[0].id;
    };

    // ── lojas (ambas ATIVAS — a policy de leitura do dono não usa loja_esta_ativa)
    const lojaA = await ins(
      `insert into public.lojas (dono_id, slug, nome) values ($1,'loja-a','Loja A') returning id`,
      [DONO_A],
    );
    const lojaB = await ins(
      `insert into public.lojas (dono_id, slug, nome) values ($1,'loja-b','Loja B') returning id`,
      [DONO_B],
    );

    // ── pedidos (NOT NULL: loja_id, nome_cliente, subtotal, total; resto default)
    const pedidoA = await ins(
      `insert into public.pedidos (loja_id, nome_cliente, subtotal, total) values ($1,'Cliente A',10.00,10.00) returning id`,
      [lojaA],
    );
    const pedidoB = await ins(
      `insert into public.pedidos (loja_id, nome_cliente, subtotal, total) values ($1,'Cliente B',20.00,20.00) returning id`,
      [lojaB],
    );

    // ── itens_pedido (NOT NULL: pedido_id, nome, preco, quantidade; produto_id omitido)
    const itemA = await ins(
      `insert into public.itens_pedido (pedido_id, nome, preco, quantidade) values ($1,'Lanche A',10.00,1) returning id`,
      [pedidoA],
    );
    const itemB = await ins(
      `insert into public.itens_pedido (pedido_id, nome, preco, quantidade) values ($1,'Lanche B',20.00,1) returning id`,
      [pedidoB],
    );

    // ── itens_pedido_opcionais (NOT NULL: item_pedido_id, nome_snapshot,
    //    preco_snapshot, quantidade; opcional_id nullable → omitido)
    const ipoA = await ins(
      `insert into public.itens_pedido_opcionais (item_pedido_id, nome_snapshot, preco_snapshot, quantidade) values ($1,'Bacon A',3.00,1) returning id`,
      [itemA],
    );
    const ipoB = await ins(
      `insert into public.itens_pedido_opcionais (item_pedido_id, nome_snapshot, preco_snapshot, quantidade) values ($1,'Bacon B',3.00,1) returning id`,
      [itemB],
    );

    return { lojaA, lojaB, ipoA, ipoB };
  });
}

// ───────────────────────────── reconferência (fonte de verdade via service)
async function existeId(t: TestDb, tabela: string, id: string): Promise<boolean> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.${tabela} where id = $1`, [id]),
  );
  return r.rows.length > 0;
}

describe("108 RLS isolamento itens_pedido_opcionais", () => {
  let t: TestDb;
  let ids: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    ids = await criarCenario(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ═══════════════════════════ LEITURA PRÓPRIA DO DONO (caminho feliz)
  it("[1] dono A LÊ o próprio opcional de pedido (1 linha)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(
        `select id from public.itens_pedido_opcionais where id = $1`,
        [ids.ipoA],
      ),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.ipoA);
  });

  it("[2] dono B LÊ o próprio opcional de pedido (1 linha) — sanity de que a policy não é deny-all geral", async () => {
    const r = await t.asUser(DONO_B, (db) =>
      db.query<{ id: string }>(
        `select id from public.itens_pedido_opcionais where id = $1`,
        [ids.ipoB],
      ),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.ipoB);
  });

  // ═══════════════════════════ ISOLAMENTO CROSS-LOJA (negação reconferida via service)
  it("[3] dono A NÃO lê o opcional de pedido da loja B (0 linhas; existe via service)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`select id from public.itens_pedido_opcionais where id = $1`, [ids.ipoB]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "itens_pedido_opcionais", ids.ipoB)).toBe(true);
  });

  it("[3b] dono B NÃO lê o opcional de pedido da loja A (0 linhas; existe via service)", async () => {
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`select id from public.itens_pedido_opcionais where id = $1`, [ids.ipoA]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "itens_pedido_opcionais", ids.ipoA)).toBe(true);
  });

  // ═══════════════════════════ ANON DENY-ALL (sem policy de SELECT público)
  it("[4] anon NÃO lê o opcional de pedido da loja A, mesmo ATIVA (0 linhas; existe via service)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.itens_pedido_opcionais where id = $1`, [ids.ipoA]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "itens_pedido_opcionais", ids.ipoA)).toBe(true);
  });

  it("[5] anon NÃO lê o opcional de pedido da loja B (0 linhas; existe via service)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.itens_pedido_opcionais where id = $1`, [ids.ipoB]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "itens_pedido_opcionais", ids.ipoB)).toBe(true);
  });

  // ═══════════════════════════ service_role sanity (bypass RLS)
  it("[6] service_role lê ambas (bypass) — confirma que os 0-linhas acima são por RLS, não dado ausente", async () => {
    const r = await t.asService((db) =>
      db.query(
        `select id from public.itens_pedido_opcionais where id = any($1::uuid[])`,
        [[ids.ipoA, ids.ipoB]],
      ),
    );
    expect(r.rows.length).toBe(2);
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 108:
 *
 * Caminho ESPERADO (no-op): NENHUMA migration. A policy `ipo_leitura_lojista` de
 * `20260614007500_opcionais.sql:207-222` já cobre a leitura própria do dono
 * (SELECT por dono_id = auth.uid() via itens_pedido → pedidos → lojas), e a
 * ausência de policy SELECT para anon garante deny-all público. Se a suite roda
 * verde → marcar o topo da issue "policy suficiente → no-op documentado". FIM.
 *
 * Caminho de CONTINGÊNCIA (só se [1] ou [2] falhar de verdade SEM o drop sintético):
 * criar migration ADITIVA `<ts > 20260614007500>_ipo_leitura_lojista.sql`
 * recriando a policy de SELECT do dono (mesmo USING via item→pedido→loja),
 * NUNCA editando a 080 e NUNCA relaxando para service_role / using(true).
 * Casos que precisam passar após a migration: [1]..[6].
 */
