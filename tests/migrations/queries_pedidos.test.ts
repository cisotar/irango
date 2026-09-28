import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { buscarStatusPedidoPorToken } from "@/lib/supabase/queries/pedidos";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 026 — Queries de `pedidos` (camada 1: SQL/RLS real).
 *
 * Esta camada NÃO importa `src/lib/supabase/queries/pedidos.ts` (pglite não é
 * PostgREST/supabase-js). Prova o CONTRATO DE SEGURANÇA que cada função PRECISA
 * respeitar: roda o SQL equivalente sob a role correta (asAnon/asUser/asService),
 * confirmando o isolamento de seguranca.md §2 (pedidos):
 *
 *  - NÃO há SELECT anon em `pedidos` nem em `itens_pedido` (anti-enumeração);
 *  - a leitura do cliente é por id + token_acesso via SERVICE_ROLE (a função
 *    `buscarPedidoPorToken` recebe um client service_role injetado pelo caller —
 *    seguranca.md §2 linhas 260-263); token errado → 0 linhas;
 *  - o lojista lê os pedidos da PRÓPRIA loja + itens (RLS pedidos_acesso_lojista
 *    e itens_pedido_lojista);
 *  - o lojista NÃO lê pedidos de OUTRA loja (isolamento entre tenants).
 *
 * Por que é RED de verdade e não cosmético: a asserção é sobre o COMPORTAMENTO
 * esperado da query de cada função. A camada 2 (unidade/mock) cai vermelha por
 * ausência de implementação (stub `throw 'TODO: GREEN'`). Rodadas juntas, provam
 * o RED. As policies já existem (migration 20260614002500), então a camada 1
 * passa pelo SQL — é a prova de SEGURANÇA que sustenta o critério de aceite
 * crítico; quem cai vermelho por falta de código é a camada 2.
 *
 * Anti-falso-verde (padrão de rls_cupons_pedidos.test.ts): toda negação por RLS é
 * reconferida via asService (BYPASSRLS) de que a linha REALMENTE existe — a
 * negação é por policy, nunca por "dado ausente".
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

type Cenario = {
  lojaA: string;
  lojaB: string;
  pedidoA: string; // pedido da loja A (com 1 item)
  pedidoB: string; // pedido da loja B
  tokenA: string; // token_acesso do pedido A (capturado)
  itemA: string; // item do pedido A
};

async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a@teste.local'),
       ($2, 'dono-b@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B],
  );
}

/** Cenário base via service (bypass RLS): loja A com pedido+item, loja B com pedido. */
async function criarCenario(t: TestDb): Promise<Cenario> {
  await garantirDonos(t);
  return t.asService(async (db) => {
    const ins = async (sql: string, params: unknown[]) => {
      const r = await db.query<{ id: string }>(sql, params);
      return r.rows[0].id;
    };

    const lojaA = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-a','Loja A',true) returning id`,
      [DONO_A],
    );
    const lojaB = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-b','Loja B',true) returning id`,
      [DONO_B],
    );

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

    const itemA = await ins(
      `insert into public.itens_pedido (pedido_id, nome, preco, quantidade) values ($1,'Item A',50.00,1) returning id`,
      [pedidoA],
    );

    return { lojaA, lojaB, pedidoA, pedidoB, tokenA, itemA };
  });
}

async function existeId(t: TestDb, tabela: string, id: string): Promise<boolean> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.${tabela} where id = $1`, [id]),
  );
  return r.rows.length > 0;
}

describe("026 queries de pedidos — contrato SQL/RLS (camada 1)", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    c = await criarCenario(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ───────────────────────── ausência de SELECT anon (anti-enumeração)
  it("[1] anon NÃO lista pedidos → 0 linhas (não há policy de SELECT público em pedidos)", async () => {
    const r = await t.asAnon((db) => db.query(`select * from public.pedidos`));
    expect(r.rows.length).toBe(0);
    // anti-falso-verde: os pedidos REALMENTE existem
    expect(await existeId(t, "pedidos", c.pedidoA)).toBe(true);
    expect(await existeId(t, "pedidos", c.pedidoB)).toBe(true);
  });

  it("[2] anon NÃO lê um pedido específico nem com o token correto → 0 linhas (sem SELECT anon)", async () => {
    // Mesmo com id + token corretos, o anon não tem policy de SELECT: a leitura
    // por token é via SERVICE_ROLE, nunca via anon (seguranca.md §2 linha 263).
    const r = await t.asAnon((db) =>
      db.query(`select * from public.pedidos where id = $1 and token_acesso = $2`, [
        c.pedidoA,
        c.tokenA,
      ]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "pedidos", c.pedidoA)).toBe(true);
  });

  it("[3] anon NÃO lê itens de pedido → 0 linhas (sem SELECT anon em itens_pedido)", async () => {
    const r = await t.asAnon((db) => db.query(`select * from public.itens_pedido`));
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "itens_pedido", c.itemA)).toBe(true);
  });

  // ───────────────────────── buscarPedidoPorToken → SERVICE_ROLE, id + token
  it("[4] buscarPedidoPorToken: service lê o pedido pelo par id + token correto (1 linha)", async () => {
    // SQL equivalente: from('pedidos').select('*, itens_pedido(*)').eq('id').eq('token_acesso').maybeSingle()
    const r = await t.asService((db) =>
      db.query<{ id: string }>(`select * from public.pedidos where id = $1 and token_acesso = $2`, [
        c.pedidoA,
        c.tokenA,
      ]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(c.pedidoA);
  });

  it("[5] buscarPedidoPorToken (PONTO CRÍTICO): token ERRADO → 0 linhas (null), mesmo id válido", async () => {
    const tokenErrado = "99999999-9999-9999-9999-999999999999";
    const r = await t.asService((db) =>
      db.query(`select * from public.pedidos where id = $1 and token_acesso = $2`, [
        c.pedidoA,
        tokenErrado,
      ]),
    );
    expect(r.rows.length).toBe(0); // maybeSingle → null
    // anti-falso-verde: o pedido existe; a negação é pelo token, não por dado ausente
    expect(await existeId(t, "pedidos", c.pedidoA)).toBe(true);
  });

  it("[6] buscarPedidoPorToken: service traz os itens do pedido (join itens_pedido) — 1 item", async () => {
    const r = await t.asService((db) =>
      db.query<{ id: string }>(
        `select i.* from public.itens_pedido i
           join public.pedidos p on p.id = i.pedido_id
          where p.id = $1 and p.token_acesso = $2`,
        [c.pedidoA, c.tokenA],
      ),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(c.itemA);
  });

  // ───────────────────────── listarPedidosDoDono / buscarPedidoDoDono → RLS lojista
  it("[7] listarPedidosDoDono: dono A lista o PRÓPRIO pedido (RLS pedidos_acesso_lojista) → 1 linha", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(`select * from public.pedidos order by criado_em desc`),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(c.pedidoA);
  });

  it("[8] listarPedidosDoDono (ISOLAMENTO): dono A NÃO vê o pedido de B → não aparece na lista", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(`select id from public.pedidos`),
    );
    const ids = r.rows.map((x) => x.id);
    expect(ids).not.toContain(c.pedidoB);
    // anti-falso-verde: o pedido de B realmente existe
    expect(await existeId(t, "pedidos", c.pedidoB)).toBe(true);
  });

  it("[9] buscarPedidoDoDono: dono A lê o PRÓPRIO pedido por id → 1 linha", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(`select * from public.pedidos where id = $1`, [c.pedidoA]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(c.pedidoA);
  });

  it("[10] buscarPedidoDoDono (ISOLAMENTO): dono A lendo pedido de B por id → 0 linhas (null)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`select * from public.pedidos where id = $1`, [c.pedidoB]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "pedidos", c.pedidoB)).toBe(true);
  });

  it("[11] buscarPedidoDoDono: dono A lê os itens do próprio pedido (itens_pedido_lojista) → 1 item", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(`select * from public.itens_pedido where pedido_id = $1`, [
        c.pedidoA,
      ]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(c.itemA);
  });

  it("[12] ISOLAMENTO de itens: dono B NÃO vê itens do pedido de A → 0 linhas", async () => {
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`select * from public.itens_pedido where pedido_id = $1`, [c.pedidoA]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "itens_pedido", c.itemA)).toBe(true);
  });
});

// ═══════════════════════ issue 329 — buscarStatusPedidoPorToken (leitura enxuta)
//
// Fase RED (RN-SC9, spec status-pedido-clicavel-e-latencia.md Frente 2 item 2).
// Diferente da camada 1 acima, aqui a FUNÇÃO REAL é exercitada: um adaptador
// mínimo traduz o builder `from().select(cols).eq().eq().maybeSingle()` para SQL
// e o executa SOB `asService` no Postgres do pglite (as migrations reais). O
// adaptador só aceita projeção de colunas simples — `*` ou embed
// (`itens_pedido(...)`) lançam, então uma regressão para a leitura completa
// cai aqui. `consultas` conta as idas ao banco (prova do "sem query").

type Contador = { consultas: number };
type Filtro = [coluna: string, valor: unknown];
const IDENT = /^[a-z_]+$/;

function clientePgliteService(t: TestDb, contador: Contador) {
  const from = (tabela: string) => {
    if (!IDENT.test(tabela)) throw new Error(`adaptador pglite: tabela inválida: ${tabela}`);
    let colunas = "*";
    const filtros: Filtro[] = [];
    const executar = async (modo: "single" | "maybeSingle") => {
      const cols = colunas.split(",").map((c) => c.trim());
      if (cols.some((c) => !IDENT.test(c))) {
        throw new Error(`adaptador pglite: projeção não suportada: "${colunas}"`);
      }
      if (filtros.some(([c]) => !IDENT.test(c))) throw new Error("adaptador pglite: filtro inválido");
      contador.consultas++;
      const where = filtros.map(([c], i) => `${c} = $${i + 1}`).join(" and ");
      const r = await t.asService((db) =>
        db.query<Record<string, unknown>>(
          `select ${cols.join(", ")} from public.${tabela}${where ? ` where ${where}` : ""}`,
          filtros.map(([, v]) => v),
        ),
      );
      if (r.rows.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows" } };
      if (r.rows.length === 0) {
        return modo === "single"
          ? { data: null, error: { code: "PGRST116", message: "0 rows" } }
          : { data: null, error: null };
      }
      return { data: r.rows[0], error: null };
    };
    const b = {
      select(c: string) {
        colunas = c;
        return b;
      },
      eq(c: string, v: unknown) {
        filtros.push([c, v]);
        return b;
      },
      maybeSingle: () => executar("maybeSingle"),
      single: () => executar("single"),
    };
    return b;
  };
  return { from } as unknown as SupabaseClient<Database>;
}

describe("329 buscarStatusPedidoPorToken — leitura enxuta sob service_role (pglite)", () => {
  let t: TestDb;
  let c: Cenario;
  let tokenB: string;

  beforeAll(async () => {
    t = await createTestDb();
    c = await criarCenario(t);
    const r = await t.asService((db) =>
      db.query<{ token_acesso: string }>(`select token_acesso from public.pedidos where id = $1`, [
        c.pedidoB,
      ]),
    );
    tokenB = r.rows[0].token_acesso;
    // Pedido A em retirada/confirmado: valores distintos dos defaults, para a
    // leitura não passar por coincidência.
    await t.asService((db) =>
      db.query(`update public.pedidos set status = 'confirmado', tipo_entrega = 'retirada' where id = $1`, [
        c.pedidoA,
      ]),
    );
  });
  afterAll(async () => {
    await t.close();
  });

  it("[13] par (id, token) correto → objeto com chaves EXATAS [status, tipo_entrega] e os valores do banco", async () => {
    const contador = { consultas: 0 };
    const r = await buscarStatusPedidoPorToken(clientePgliteService(t, contador), c.pedidoA, c.tokenA);

    expect(r).not.toBeNull();
    expect(Object.keys(r as object).sort()).toEqual(["status", "tipo_entrega"]);
    // leitura de conferência via asService (BYPASSRLS): mesmos valores
    const conf = await t.asService((db) =>
      db.query<{ status: string; tipo_entrega: string }>(
        `select status, tipo_entrega from public.pedidos where id = $1`,
        [c.pedidoA],
      ),
    );
    expect(r).toEqual({ status: conf.rows[0].status, tipo_entrega: conf.rows[0].tipo_entrega });
    expect(r).toEqual({ status: "confirmado", tipo_entrega: "retirada" });
    expect(contador.consultas).toBe(1);
  });

  it("[14] token ERRADO → null (e o pedido existe: a negação é pelo token)", async () => {
    const contador = { consultas: 0 };
    const r = await buscarStatusPedidoPorToken(
      clientePgliteService(t, contador),
      c.pedidoA,
      "99999999-9999-9999-9999-999999999999",
    );
    expect(r).toBeNull();
    expect(contador.consultas).toBe(1);
    expect(await existeId(t, "pedidos", c.pedidoA)).toBe(true);
  });

  it("[15] token de OUTRO pedido (token de B com id de A) → null (anti-enumeração)", async () => {
    const contador = { consultas: 0 };
    const r = await buscarStatusPedidoPorToken(clientePgliteService(t, contador), c.pedidoA, tokenB);
    expect(r).toBeNull();
    expect(await existeId(t, "pedidos", c.pedidoA)).toBe(true);
    expect(await existeId(t, "pedidos", c.pedidoB)).toBe(true);
  });

  it.each([
    ["pedidoId não-uuid", "nao-uuid", "TOKEN_OK"],
    ["token não-uuid", "PEDIDO_A", "token-invalido"],
    ["pedidoId vazio", "", "TOKEN_OK"],
  ])("[16] %s → null SEM query", async (_rotulo, id, token) => {
    const contador = { consultas: 0 };
    const pedidoId = id === "PEDIDO_A" ? c.pedidoA : id;
    const tk = token === "TOKEN_OK" ? c.tokenA : token;
    const r = await buscarStatusPedidoPorToken(clientePgliteService(t, contador), pedidoId, tk);
    expect(r).toBeNull();
    expect(contador.consultas).toBe(0);
  });
});

