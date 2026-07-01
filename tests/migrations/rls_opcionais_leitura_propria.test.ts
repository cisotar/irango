import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 103 — RLS de LEITURA PRÓPRIA do dono nas 3 tabelas de
 * opcionais: `opcionais`, `opcionais_categorias`, `categoria_produto_opcionais`.
 *
 * NATUREZA DESTA ISSUE (verificação, não construção):
 * As policies JÁ EXISTEM em `supabase/migrations/20260614007500_opcionais.sql`:
 *   - opcionais             → `opcionais_leitura_propria` (SELECT, dono via
 *                             lojas.dono_id = auth.uid(); SEM loja_esta_ativa e
 *                             SEM filtro `ativo` → traz inativos).
 *   - opcionais_categorias  → `opc_cat_escrita_propria` (FOR ALL → cobre SELECT).
 *   - categoria_produto_opcionais → `cat_prod_opc_escrita_propria` (FOR ALL).
 * Logo, este teste tende a NASCER VERDE — e isso é o próprio veredito da issue
 * ("policies suficientes → no-op"). Um teste de RLS que nasce verde NÃO prova,
 * por si, que tem poder de detecção.
 *
 * ═══════════════════ FINDING (o teste corrigiu uma premissa do plano) ═══════════
 * O plano pedia "[7][8][9] dono A NÃO lê linhas da loja B → 0 linhas". Isso está
 * ERRADO para opcionais e o teste pegou: as policies são OR-combinadas e a policy
 * PÚBLICA (`opcionais_leitura_publica`: ativo=true AND loja_esta_ativa) expõe o
 * cardápio ATIVO de B a QUALQUER role — dono A inclusive, igual ao anon. Não é
 * vazamento: é a vitrine pública de B. Confirmado por probe (anon e dono A veem
 * o MESMO opcional ativo de B → 1 linha cada). Portanto o isolamento cross-loja
 * que importa é sobre o dado PRIVADO de B: opcional INATIVO (fora da vitrine) e
 * rows de loja INATIVA — e ESSES o dono A não vê ([8],[9],[10],[10b]). O teste
 * reflete o invariante CORRETO, não o do rascunho do plano.
 *
 * ═══════════════════ RED SINTÉTICO COMPROVADO (poder de detecção) ═══════════════
 * O teste nasce verde (as policies já existem). Para provar que tem poder de
 * detecção, derrubei localmente AMBAS as policies de dono em `opcionais` no
 * harness, logo após createTestDb():
 *
 *     await t.db.exec(`drop policy "opcionais_leitura_propria" on public.opcionais`);
 *     await t.db.exec(`drop policy "opcionais_escrita_propria"  on public.opcionais`);
 *
 * (As DUAS porque `opcionais_escrita_propria` é FOR ALL — seu USING também cobre
 * SELECT; dropar só a `_leitura_propria` NÃO produz vermelho, pois a FOR ALL
 * ainda concede a leitura ao dono. Esse próprio fato é registro do teste.)
 *
 * Output real capturado (2026-06-30):
 *   FAIL  ... > [1] dono A LÊ os próprios opcionais ativo E inativo (2 linhas)
 *     AssertionError: expected 1 to be 2   (Expected 2 / Received 1)
 *   FAIL  ... > [4] dono A2 com loja INATIVA ainda lê os próprios opcionais (2 linhas)
 *     AssertionError: expected +0 to be 2  (Expected 2 / Received 0)
 *      Tests  2 failed | 15 passed (17)
 *
 * Leitura: sem as policies de dono, [1] cai para 1 (só o opcional ATIVO sobra,
 * via policy pública) e [4] cai para 0 (loja inativa → a pública não traz nada).
 * Restaurando as policies (estado real do repo), a suite fica 17/17 verde. Esse
 * ciclo vermelho→verde prova que [1] e [4] REALMENTE dependem da leitura própria
 * do dono — não passam por acidente / deny-all / dado ausente. O snippet acima
 * NÃO faz parte da suite verde (foi removido após a captura).
 *
 * Quem mantém verde é o estado atual da migration 080. Nenhum código de produção
 * é escrito aqui (no-op de produção — ver CONTRATO no fim).
 *
 * Padrão anti-falso-verde (herdado de rls_catalogo.test.ts):
 *  - leitura "permitida" confirmada por NÚMERO DE LINHAS visíveis sob o role real.
 *  - negação NUNCA aceita por "relation does not exist" nem por dado ausente: a
 *    linha alvo SEMPRE é reconferida via asService (BYPASSRLS) — negação = RLS,
 *    não falta de dado.
 *  - o harness pglite roda como superuser e IGNORA RLS sem asUser/asAnon/asService
 *    (que fazem `set local role` + claims); por isso toda leitura passa por eles.
 */

// IDs fixos para asserts determinísticos.
const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
// RN-01: cada conta só tem 1 loja. A loja INATIVA pertence a DONO_A2 (conta separada).
const DONO_A2 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab";

type Cenario = {
  // lojas
  lojaA: string; // dono A, ATIVA
  lojaInativa: string; // dono A2, INATIVA (trial/inadimplente)
  lojaB: string; // dono B, ATIVA
  // categorias de produto (necessárias para a associação categoria_produto_opcionais)
  catProdA: string;
  catProdInativa: string;
  catProdB: string;
  // categorias de opcional (opcionais_categorias)
  ocA: string; // loja A
  ocInativa: string; // loja inativa
  ocB: string; // loja B
  // opcionais
  opcAAtivo: string; // opcional ATIVO da loja A
  opcAInativo: string; // opcional INATIVO da loja A (prova que dono lê inativo)
  opcInativaAtivo: string; // opcional ativo de loja inativa
  opcInativaInativo: string; // opcional inativo de loja inativa
  opcB: string; // opcional ATIVO da loja B (público — visível a todos, inclusive dono A)
  opcBInativo: string; // opcional INATIVO da loja B (PRIVADO — só o dono B vê)
  // associações categoria_produto ⋈ categoria_opcional
  cpoA: string; // loja A
  cpoInativa: string; // loja inativa
  cpoB: string; // loja B
};

/** Cria os donos em auth.users via superuser (service_role não tem grant em auth). */
async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a@teste.local'),
       ($2, 'dono-b@teste.local'),
       ($3, 'dono-a2@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B, DONO_A2],
  );
}

/** Monta o cenário base via asService (bypass RLS) e retorna todos os ids. */
async function criarCenario(t: TestDb): Promise<Cenario> {
  await garantirDonos(t);
  return t.asService(async (db) => {
    const ins = async (sql: string, params: unknown[]) => {
      const r = await db.query<{ id: string }>(sql, params);
      return r.rows[0].id;
    };

    // ── lojas
    const lojaA = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-a','Loja A',true) returning id`,
      [DONO_A],
    );
    const lojaInativa = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-inativa','Loja Inativa',false) returning id`,
      [DONO_A2],
    );
    const lojaB = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-b','Loja B',true) returning id`,
      [DONO_B],
    );

    // ── categorias de PRODUTO (ponta da associação categoria_produto_opcionais)
    const catProdA = await ins(
      `insert into public.categorias (loja_id, nome) values ($1,'Lanches A') returning id`,
      [lojaA],
    );
    const catProdInativa = await ins(
      `insert into public.categorias (loja_id, nome) values ($1,'Lanches Inativa') returning id`,
      [lojaInativa],
    );
    const catProdB = await ins(
      `insert into public.categorias (loja_id, nome) values ($1,'Lanches B') returning id`,
      [lojaB],
    );

    // ── categorias de OPCIONAL (opcionais_categorias)
    const ocA = await ins(
      `insert into public.opcionais_categorias (loja_id, nome) values ($1,'Adicionais A') returning id`,
      [lojaA],
    );
    const ocInativa = await ins(
      `insert into public.opcionais_categorias (loja_id, nome) values ($1,'Adicionais Inativa') returning id`,
      [lojaInativa],
    );
    const ocB = await ins(
      `insert into public.opcionais_categorias (loja_id, nome) values ($1,'Adicionais B') returning id`,
      [lojaB],
    );

    // ── opcionais (loja A: 1 ativo + 1 INATIVO; loja inativa: 1 ativo + 1 inativo; loja B: 1)
    const opcAAtivo = await ins(
      `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco, ativo) values ($1,$2,'Bacon A',3.00,true) returning id`,
      [lojaA, ocA],
    );
    const opcAInativo = await ins(
      `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco, ativo) values ($1,$2,'Cheddar A Off',2.00,false) returning id`,
      [lojaA, ocA],
    );
    const opcInativaAtivo = await ins(
      `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco, ativo) values ($1,$2,'Bacon Inativa',3.00,true) returning id`,
      [lojaInativa, ocInativa],
    );
    const opcInativaInativo = await ins(
      `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco, ativo) values ($1,$2,'Cheddar Inativa Off',2.00,false) returning id`,
      [lojaInativa, ocInativa],
    );
    const opcB = await ins(
      `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco, ativo) values ($1,$2,'Bacon B',3.00,true) returning id`,
      [lojaB, ocB],
    );
    const opcBInativo = await ins(
      `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco, ativo) values ($1,$2,'Cheddar B Off',2.00,false) returning id`,
      [lojaB, ocB],
    );

    // ── associações categoria_produto ⋈ categoria_opcional (FK composta: mesma loja)
    const cpoA = await ins(
      `insert into public.categoria_produto_opcionais (loja_id, categoria_id, categoria_opcional_id) values ($1,$2,$3) returning id`,
      [lojaA, catProdA, ocA],
    );
    const cpoInativa = await ins(
      `insert into public.categoria_produto_opcionais (loja_id, categoria_id, categoria_opcional_id) values ($1,$2,$3) returning id`,
      [lojaInativa, catProdInativa, ocInativa],
    );
    const cpoB = await ins(
      `insert into public.categoria_produto_opcionais (loja_id, categoria_id, categoria_opcional_id) values ($1,$2,$3) returning id`,
      [lojaB, catProdB, ocB],
    );

    return {
      lojaA,
      lojaInativa,
      lojaB,
      catProdA,
      catProdInativa,
      catProdB,
      ocA,
      ocInativa,
      ocB,
      opcAAtivo,
      opcAInativo,
      opcInativaAtivo,
      opcInativaInativo,
      opcB,
      opcBInativo,
      cpoA,
      cpoInativa,
      cpoB,
    };
  });
}

// ───────────────────────────── reconferência (fonte de verdade via service)
async function existeId(t: TestDb, tabela: string, id: string): Promise<boolean> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.${tabela} where id = $1`, [id]),
  );
  return r.rows.length > 0;
}

describe("103 RLS leitura própria do dono (opcionais)", () => {
  let t: TestDb;
  let ids: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    ids = await criarCenario(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ═══════════════════════════ DONO A — leitura própria nas 3 tabelas (loja ATIVA)
  it("[1] dono A LÊ os próprios opcionais ativo E inativo (2 linhas)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(
        `select id from public.opcionais where id = any($1::uuid[])`,
        [[ids.opcAAtivo, ids.opcAInativo]],
      ),
    );
    expect(r.rows.length).toBe(2);
  });

  it("[2] dono A LÊ a própria categoria de opcional (1 linha)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(`select id from public.opcionais_categorias where id = $1`, [
        ids.ocA,
      ]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.ocA);
  });

  it("[3] dono A LÊ a própria associação categoria_produto_opcionais (1 linha)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(
        `select id from public.categoria_produto_opcionais where id = $1`,
        [ids.cpoA],
      ),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.cpoA);
  });

  // ═══════════════════════════ LOJA INATIVA — caminho do dono não passa por loja_esta_ativa
  it("[4] dono A2 com loja INATIVA ainda lê os próprios opcionais ativo E inativo (2 linhas)", async () => {
    const r = await t.asUser(DONO_A2, (db) =>
      db.query<{ id: string }>(
        `select id from public.opcionais where id = any($1::uuid[])`,
        [[ids.opcInativaAtivo, ids.opcInativaInativo]],
      ),
    );
    expect(r.rows.length).toBe(2);
  });

  it("[5] dono A2 com loja INATIVA ainda lê a própria categoria de opcional (1 linha)", async () => {
    const r = await t.asUser(DONO_A2, (db) =>
      db.query<{ id: string }>(`select id from public.opcionais_categorias where id = $1`, [
        ids.ocInativa,
      ]),
    );
    expect(r.rows.length).toBe(1);
  });

  it("[6] dono A2 com loja INATIVA ainda lê a própria associação cat_prod_opc (1 linha)", async () => {
    const r = await t.asUser(DONO_A2, (db) =>
      db.query<{ id: string }>(
        `select id from public.categoria_produto_opcionais where id = $1`,
        [ids.cpoInativa],
      ),
    );
    expect(r.rows.length).toBe(1);
  });

  // ═══════════════════════════ ISOLAMENTO CROSS-LOJA — só o dado PRIVADO é isolado
  //
  // ⚠️ DISTINÇÃO QUE O TESTE DESCOBRIU (ver cabeçalho "FINDING"):
  // Cross-loja em opcionais NÃO é "dono A vê 0 linhas de B". As policies são
  // OR-combinadas; a policy PÚBLICA (`opcionais_leitura_publica`: ativo=true AND
  // loja_esta_ativa) expõe o conteúdo PÚBLICO de B a QUALQUER role — inclusive
  // dono A — exatamente como expõe ao anon (é a vitrine). Isso NÃO é vazamento:
  // é o cardápio público de B. O invariante real de isolamento é sobre o dado
  // PRIVADO de B: opcional INATIVO (fora da vitrine) e rows de loja INATIVA.

  it("[7] dado PÚBLICO de B (opcional ATIVO de loja ATIVA) é visível a dono A — é a vitrine, anon também vê (sanity, NÃO é vazamento)", async () => {
    const donoA = await t.asUser(DONO_A, (db) =>
      db.query(`select id from public.opcionais where id = $1`, [ids.opcB]),
    );
    const anon = await t.asAnon((db) =>
      db.query(`select id from public.opcionais where id = $1`, [ids.opcB]),
    );
    // Mesma visibilidade pública para os dois: prova que dono A vê via policy
    // PÚBLICA (cardápio de B), não por leitura "própria" indevida.
    expect(anon.rows.length).toBe(1);
    expect(donoA.rows.length).toBe(1);
  });

  it("[8] dono A NÃO lê opcional PRIVADO de B (INATIVO, fora da vitrine) — 0 linhas; existe via service", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`select id from public.opcionais where id = $1`, [ids.opcBInativo]),
    );
    expect(r.rows.length).toBe(0);
    // anti-falso-verde: nem mesmo o anon vê (é privado), e a linha EXISTE.
    const anon = await t.asAnon((db) =>
      db.query(`select id from public.opcionais where id = $1`, [ids.opcBInativo]),
    );
    expect(anon.rows.length).toBe(0);
    expect(await existeId(t, "opcionais", ids.opcBInativo)).toBe(true);
  });

  it("[9] dono A NÃO lê categoria de opcional PRIVADA (de loja INATIVA, conta alheia) — 0 linhas; existe via service", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`select id from public.opcionais_categorias where id = $1`, [ids.ocInativa]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "opcionais_categorias", ids.ocInativa)).toBe(true);
  });

  it("[10] dono A NÃO lê associação cat_prod_opc PRIVADA (de loja INATIVA, conta alheia) — 0 linhas; existe via service", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`select id from public.categoria_produto_opcionais where id = $1`, [
        ids.cpoInativa,
      ]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "categoria_produto_opcionais", ids.cpoInativa)).toBe(true);
  });

  // Reverso: dono B não vê o dado PRIVADO de A (opcional INATIVO de A).
  it("[10b] dono B NÃO lê opcional INATIVO (privado) da loja A — 0 linhas; existe via service", async () => {
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`select id from public.opcionais where id = $1`, [ids.opcAInativo]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "opcionais", ids.opcAInativo)).toBe(true);
  });

  // ═══════════════════════════ ANON (sanity de não-regressão da vitrine)
  it("[11] anon NÃO lê opcional de loja INATIVA, mesmo ATIVO (0 linhas; existe via service)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.opcionais where id = $1`, [ids.opcInativaAtivo]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "opcionais", ids.opcInativaAtivo)).toBe(true);
  });

  it("[12] anon NÃO lê opcional INATIVO de loja ATIVA (0 linhas; existe via service)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.opcionais where id = $1`, [ids.opcAInativo]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "opcionais", ids.opcAInativo)).toBe(true);
  });

  it("[13] anon NÃO lê categoria de opcional de loja INATIVA (0 linhas; existe via service)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.opcionais_categorias where id = $1`, [ids.ocInativa]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "opcionais_categorias", ids.ocInativa)).toBe(true);
  });

  it("[14] anon NÃO lê associação cat_prod_opc de loja INATIVA (0 linhas; existe via service)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.categoria_produto_opcionais where id = $1`, [
        ids.cpoInativa,
      ]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "categoria_produto_opcionais", ids.cpoInativa)).toBe(true);
  });

  // anon AINDA lê o que é público (contrato da vitrine intacto): opcional ATIVO de loja ATIVA.
  it("[15] anon LÊ opcional ATIVO de loja ATIVA (1 linha — contrato público intacto)", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(`select id from public.opcionais where id = $1`, [ids.opcAAtivo]),
    );
    expect(r.rows.length).toBe(1);
  });

  // ═══════════════════════════ service_role sanity (bypass RLS)
  it("[16] service_role lê tudo (bypass) — confirma que os 0-linhas acima são por RLS", async () => {
    const r = await t.asService((db) =>
      db.query(
        `select id from public.opcionais where id = any($1::uuid[])`,
        [
          [
            ids.opcAAtivo,
            ids.opcAInativo,
            ids.opcInativaAtivo,
            ids.opcInativaInativo,
            ids.opcB,
            ids.opcBInativo,
          ],
        ],
      ),
    );
    expect(r.rows.length).toBe(6);
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 103:
 *
 * Caminho ESPERADO (no-op): NENHUMA migration. As policies de
 * `20260614007500_opcionais.sql` já cobrem a leitura própria do dono nas três
 * tabelas (opcionais_leitura_propria; opc_cat_escrita_propria FOR ALL;
 * cat_prod_opc_escrita_propria FOR ALL), por caminho de ownership que NÃO usa
 * loja_esta_ativa. Se a suite roda verde → marcar o topo da issue
 * "policies suficientes → no-op documentado". FIM.
 *
 * Caminho de CONTINGÊNCIA (só se algum caso [1]..[6] do dono falhar de verdade):
 * criar migration ADITIVA `<ts > 20260621097000>_opcionais_leitura_propria.sql`
 * com as policies `_leitura_propria` faltantes (SELECT por dono_id = auth.uid()),
 * NUNCA editando a 080 e NUNCA relaxando para service_role / using(true).
 * Casos que precisam passar após a migration: [1]..[16].
 */
