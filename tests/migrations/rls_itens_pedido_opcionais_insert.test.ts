import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 110 — remover a policy órfã `ipo_insert_publico` de
 * ESCRITA anon em `itens_pedido_opcionais` (defesa em profundidade).
 *
 * Cobre ESCRITA (INSERT). NÃO se mistura com `rls_itens_pedido_opcionais.test.ts`,
 * que cobre LEITURA (SELECT) da issue 108.
 *
 * ═══════════════════ POR QUE ESTE RED É REAL (não sintético) ═══════════════════
 * HOJE a policy `ipo_insert_publico` (20260614007500_opcionais.sql:207-209) está
 * VIVA: `for insert with check (item_pedido_aceita_opcionais(...))`, sem cláusula
 * de role → vale para anon E authenticated. O harness pglite concede `insert` em
 * todas as tabelas a anon (helpers/pglite.ts:59). Logo, um anon com o
 * `item_pedido_id` (que vaza na URL de confirmação) de um item de pedido
 * `pendente` de loja ATIVA passa pelo `with check` do helper e o INSERT É ACEITO.
 *
 * Portanto o caso [1] ("anon NÃO insere") NASCE VERMELHO: o INSERT do anon tem
 * SUCESSO hoje, e `await expect(...).rejects` quebra (não houve rejeição).
 *
 * ═══════════════════════════ CICLO ESPERADO VERMELHO → VERDE ═══════════════════
 *   VERMELHO (agora):  policy `ipo_insert_publico` viva → anon insere → caso [1] FALHA.
 *   VERDE   (depois):  migration `20260621098000_ipo_remove_insert_publico.sql`
 *                      (`drop policy if exists "ipo_insert_publico" ...`) →
 *                      INSERT anon fica deny-all (sem policy) → caso [1] passa.
 *
 * Casos [2] (service_role insere — caminho legítimo da RPC, que roda sob
 * service_role/BYPASSRLS) e [3] (authenticated também negado pós-drop) servem de
 * trilhos: [2] é não-regressão (verde antes e depois — service_role ignora RLS);
 * [3] é sanity da deny-all geral pós-drop (vermelho hoje pela mesma policy, verde
 * depois). O foco do RED capturado é o [1].
 *
 * NENHUM código de produção / migration é escrito aqui (isso é da fase GREEN —
 * ver CONTRATO no fim). beforeEach recria o banco por teste (isolamento total),
 * espelhando o padrão de criarCenario do teste 108.
 *
 * Padrão anti-falso-verde (herdado de rls_itens_pedido_opcionais.test.ts):
 *  - escrita "negada" reconferida via asService (BYPASSRLS): nenhuma linha
 *    "Fantasma" foi gravada → negação é por RLS, não por constraint/dado ausente.
 *  - escrita "permitida" (service_role) confirmada por NÚMERO DE LINHAS via service.
 *  - o harness pglite roda como superuser e IGNORA RLS sem asUser/asAnon/asService.
 */

const DONO = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

type Cenario = {
  loja: string; // dono, ATIVA (lojas.ativo default true; helper exige loja_esta_ativa)
  itemPedido: string; // itens_pedido de pedido 'pendente' → o que vaza na URL de confirmação
};

/** Cria o dono em auth.users via superuser (service_role não tem grant em auth). */
async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values ($1, 'dono@teste.local')
     on conflict (id) do nothing`,
    [DONO],
  );
}

/** Monta loja ATIVA → pedido 'pendente' → itens_pedido via asService (bypass RLS). */
async function criarCenario(t: TestDb): Promise<Cenario> {
  await garantirDonos(t);
  return t.asService(async (db) => {
    const ins = async (sql: string, params: unknown[]) => {
      const r = await db.query<{ id: string }>(sql, params);
      return r.rows[0].id;
    };

    // loja ATIVA (ativo default true → loja_esta_ativa() = true)
    const loja = await ins(
      `insert into public.lojas (dono_id, slug, nome) values ($1,'loja-a','Loja A') returning id`,
      [DONO],
    );

    // pedido 'pendente' (NOT NULL: loja_id, nome_cliente, subtotal, total; status default 'pendente')
    const pedido = await ins(
      `insert into public.pedidos (loja_id, nome_cliente, subtotal, total) values ($1,'Cliente A',10.00,10.00) returning id`,
      [loja],
    );

    // itens_pedido (NOT NULL: pedido_id, nome, preco, quantidade; produto_id omitido)
    const itemPedido = await ins(
      `insert into public.itens_pedido (pedido_id, nome, preco, quantidade) values ($1,'Lanche A',10.00,1) returning id`,
      [pedido],
    );

    return { loja, itemPedido };
  });
}

/** Conta linhas "Fantasma" anexadas a um item de pedido — fonte de verdade via service. */
async function contarFantasmas(t: TestDb, itemPedidoId: string): Promise<number> {
  const r = await t.asService((db) =>
    db.query(
      `select 1 from public.itens_pedido_opcionais
       where item_pedido_id = $1 and nome_snapshot = 'Fantasma'`,
      [itemPedidoId],
    ),
  );
  return r.rows.length;
}

describe("110 RLS escrita itens_pedido_opcionais (drop ipo_insert_publico)", () => {
  let t: TestDb;
  let ids: Cenario;

  beforeEach(async () => {
    t = await createTestDb();
    ids = await criarCenario(t);
  });
  afterEach(async () => {
    await t.close();
  });

  // ═══════════════════════ [1] RED→GREEN: anon NÃO insere opcional ═══════════════════════
  it("[1] anon NÃO insere opcional em item de pedido pendente de loja ativa (RLS nega)", async () => {
    // HOJE (policy viva): este INSERT TEM SUCESSO → o rejects abaixo NÃO dispara → FALHA (vermelho).
    // PÓS-DROP: INSERT vira deny-all (sem policy de INSERT) → rejeita → passa.
    await expect(
      t.asAnon((db) =>
        db.query(
          `insert into public.itens_pedido_opcionais
             (item_pedido_id, nome_snapshot, preco_snapshot, quantidade)
           values ($1,'Fantasma',99.00,1)`,
          [ids.itemPedido],
        ),
      ),
    ).rejects.toThrow();

    // Anti-falso-verde: a negação tem de ser por RLS, não por constraint/dado.
    // Reconfere via service que NENHUMA linha "Fantasma" entrou.
    expect(await contarFantasmas(t, ids.itemPedido)).toBe(0);
  });

  // ═══════════════════ [2] não-regressão: service_role INSERE normalmente ═══════════════════
  it("[2] service_role INSERE opcional normalmente (caminho legítimo da RPC, BYPASSRLS)", async () => {
    // service_role tem BYPASSRLS → não avalia ipo_insert_publico. Passa ANTES e DEPOIS do drop:
    // prova que remover a policy NÃO afeta o único caminho de escrita real (RPC criar_pedido).
    await t.asService((db) =>
      db.query(
        `insert into public.itens_pedido_opcionais
           (item_pedido_id, nome_snapshot, preco_snapshot, quantidade)
         values ($1,'Bacon legítimo',3.00,1)`,
        [ids.itemPedido],
      ),
    );

    const r = await t.asService((db) =>
      db.query(
        `select id from public.itens_pedido_opcionais where item_pedido_id = $1`,
        [ids.itemPedido],
      ),
    );
    expect(r.rows.length).toBe(1);
  });

  // ═══════════════════ [3] sanity: authenticated também NÃO insere pós-drop ═══════════════════
  it("[3] authenticated (lojista logado) NÃO insere opcional direto (RLS nega)", async () => {
    // A policy ipo_insert_publico também cobria authenticated → vermelho hoje, verde pós-drop.
    await expect(
      t.asUser(DONO, (db) =>
        db.query(
          `insert into public.itens_pedido_opcionais
             (item_pedido_id, nome_snapshot, preco_snapshot, quantidade)
           values ($1,'Fantasma',99.00,1)`,
          [ids.itemPedido],
        ),
      ),
    ).rejects.toThrow();

    expect(await contarFantasmas(t, ids.itemPedido)).toBe(0);
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 110:
 *
 * Criar a migration ADITIVA:
 *   supabase/migrations/20260621098000_ipo_remove_insert_publico.sql
 * Conteúdo (uma instrução, idempotente):
 *   drop policy if exists "ipo_insert_publico" on public.itens_pedido_opcionais;
 *
 * Restrições:
 *  - NUNCA editar 20260614007500_opcionais.sql (migration histórica imutável).
 *  - NUNCA recriar com using(true) nem cláusula service_role (service_role já bypassa RLS).
 *  - NÃO dropar o helper item_pedido_aceita_opcionais — só a policy que o invocava sai.
 *
 * Casos que precisam passar após a migration: [1], [2], [3]. (Hoje: [1] e [3]
 * vermelhos por causa da policy viva; [2] verde nos dois momentos.)
 *
 * Deploy cloud (passo 6b½) obrigatório antes de /verificar — ver plan/110.
 */
