import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 341 — fatia C2 do plano (`plan/loop-cadastro-de-clientes.md`, P27).
 *
 * Autoridade: tasks/341 §RED C2 · specs/cliente-vinculo-pedido.md §"RPC criar_pedido — nova versão",
 * §"cupons — coluna nova", "Respostas do usuário" (P1 revisada: 16 e 17 args DROPADAS na mesma
 * migration; a de 18 tem `p_cliente_id` obrigatório, sem default) · RN-C06..C12.
 *
 * Contrato sob teste:
 *  - `supabase/migrations/<ts>_cupons_limite_por_cliente.sql`: `cupons.limite_por_cliente int null`
 *    + CHECK `limite_por_cliente is null or limite_por_cliente between 1 and 1000`;
 *  - `supabase/migrations/<ts>_rpc_criar_pedido_cliente.sql`: UMA `public.criar_pedido` de 18 args
 *    (17 atuais + `p_cliente_id uuid`, sem default), security invoker, EXECUTE só service_role;
 *    cupom com limite + convidado → desconto 0 / cupom_codigo null / sem consumo;
 *    cupom com limite + cliente → advisory lock + count(pedidos por loja+cliente+cupom_codigo,
 *    TODOS os status) >= limite → desconto 0 (D5); `p_cliente_id` inexistente → `cliente_inexistente`.
 *
 * Por que é RED: as migrations não existem → `novoDb()` falha com `[RED 341]`.
 *
 * Anti-falso-verde: as chamadas rodam como service_role (BYPASSRLS) — a negação vem da LÓGICA
 * da RPC, nunca de RLS. Valores conferidos na linha gravada. Dados fictícios.
 * O lock concorrente (RN-C07) não é provável no pglite (uma conexão só); fica para o `auditar`.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function exigirMigracao(sufixo: string): void {
  const achados = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(sufixo));
  if (achados.length !== 1) {
    throw new Error(
      `[RED 341] esperada exatamente 1 migration \`supabase/migrations/*${sufixo}\`; ` +
        `encontradas ${achados.length} (P25 ainda não escreveu a migration).`,
    );
  }
}

async function novoDb(): Promise<TestDb> {
  exigirMigracao("_pedidos_cliente_id.sql");
  exigirMigracao("_cupons_limite_por_cliente.sql");
  exigirMigracao("_rpc_criar_pedido_cliente.sql");
  return createTestDb();
}

const DONO1 = "d3420000-0000-4000-8000-0000000000d1";
const DONO2 = "d3420000-0000-4000-8000-0000000000d2";
const CA = "c3420000-0000-4000-8000-0000000000ca";
const CB = "c3420000-0000-4000-8000-0000000000cb";
const CC = "c3420000-0000-4000-8000-0000000000cc";
const CD = "c3420000-0000-4000-8000-0000000000cd";
const CE = "c3420000-0000-4000-8000-0000000000ce";
const INEXISTENTE = "f3420000-0000-4000-8000-0000000000ff";

const ENDERECO = {
  rotulo: "Casa",
  cep: "01000-000",
  rua: "Rua Ficticia",
  numero: "10",
  bairro: "Centro",
  cidade: "Cidade Teste",
  uf: "SP",
  complemento: null,
};

type Cenario = {
  l1: string;
  l2: string;
  produto1: string;
  produto2: string;
  lim1: string; // L1, 'LIM1', fixo 5, limite_por_cliente 1
  lim2: string; // L1, 'LIM2', fixo 5, limite_por_cliente 2
  semLim: string; // L1, 'SEMLIM', fixo 5, sem limite por cliente
  lim1L2: string; // L2, 'LIM1', fixo 5, limite_por_cliente 1
};

async function semear(t: TestDb): Promise<Cenario> {
  for (const u of [DONO1, DONO2, CA, CB, CC, CD, CE]) {
    await t.db.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`, [
      u,
      `u-${u}@teste.local`,
    ]);
  }
  for (const c of [CA, CB, CC, CD, CE]) {
    await t.asService((db) =>
      db.query(
        `select public.criar_perfil_cliente($1::uuid, 'Cliente Teste', '(11) 90000-0000', '1990-05-10'::date, false, 'v-teste', $2::jsonb)`,
        [c, JSON.stringify(ENDERECO)],
      ),
    );
  }
  return t.asService(async (db) => {
    const ins = async (sql: string, params: unknown[]) => (await db.query<{ id: string }>(sql, params)).rows[0].id;
    const l1 = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'p341-c2-loja1','Loja 1',true) returning id`,
      [DONO1],
    );
    const l2 = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'p341-c2-loja2','Loja 2',true) returning id`,
      [DONO2],
    );
    const produto1 = await ins(
      `insert into public.produtos (loja_id, nome, preco, disponivel) values ($1,'Pizza',25.00,true) returning id`,
      [l1],
    );
    const produto2 = await ins(
      `insert into public.produtos (loja_id, nome, preco, disponivel) values ($1,'Pizza',25.00,true) returning id`,
      [l2],
    );
    const cupom = (loja: string, codigo: string, limite: number | null) =>
      ins(
        `insert into public.cupons (loja_id, codigo, tipo, valor, usos_maximos, usos_contagem, ativo, limite_por_cliente)
         values ($1,$2,'fixo',5.00,null,0,true,$3) returning id`,
        [loja, codigo, limite],
      );
    return {
      l1,
      l2,
      produto1,
      produto2,
      lim1: await cupom(l1, "LIM1", 1),
      lim2: await cupom(l1, "LIM2", 2),
      semLim: await cupom(l1, "SEMLIM", null),
      lim1L2: await cupom(l2, "LIM1", 1),
    };
  });
}

type Chamada = {
  loja: string;
  produto: string;
  clienteId: string | null;
  cupomId?: string | null;
  cupomCodigo?: string | null;
  idempotencyKey?: string | null;
};

/** Chamada à RPC com os 18 argumentos NOMEADOS. Subtotal 50 + frete 5; com cupom, desconto 5 / total 50. */
async function criar(t: TestDb, c: Chamada): Promise<{ pedido_id: string; token_acesso: string }> {
  const comCupom = c.cupomId != null;
  return t.asService(async (db) => {
    const r = await db.query<{ pedido_id: string; token_acesso: string }>(
      `select * from public.criar_pedido(
         p_loja_id          => $1,
         p_nome_cliente     => 'Cliente Pedido',
         p_telefone_cliente => null,
         p_endereco_entrega => '{"cep":"01000-000","rua":"Rua X","numero":"1","bairro":"Centro"}'::jsonb,
         p_forma_pagamento  => 'pix',
         p_observacoes      => null,
         p_subtotal         => 50,
         p_taxa_entrega     => 5,
         p_desconto         => $2,
         p_total            => $3,
         p_cupom_id         => $4,
         p_cupom_codigo     => $5,
         p_itens            => $6::jsonb,
         p_tipo_entrega     => 'entrega',
         p_troco_para       => null,
         p_idempotency_key  => $7,
         p_frete_a_combinar => false,
         p_cliente_id       => $8
       )`,
      [
        c.loja,
        comCupom ? 5 : 0,
        comCupom ? 50 : 55,
        c.cupomId ?? null,
        c.cupomCodigo ?? null,
        JSON.stringify([{ produto_id: c.produto, nome: "Pizza", preco: 25, quantidade: 2 }]),
        c.idempotencyKey ?? null,
        c.clienteId,
      ],
    );
    return r.rows[0];
  });
}

type Gravado = {
  desconto: number;
  total: number;
  cupom_codigo: string | null;
  cliente_id: string | null;
};

async function gravado(t: TestDb, id: string): Promise<Gravado> {
  const r = await t.db.query<Gravado>(
    `select desconto, total, cupom_codigo, cliente_id from public.pedidos where id = $1`,
    [id],
  );
  return r.rows[0];
}

async function usos(t: TestDb, cupom: string): Promise<number> {
  const r = await t.db.query<{ n: number }>(`select usos_contagem as n from public.cupons where id = $1`, [cupom]);
  return r.rows[0].n;
}

async function erroDe(p: Promise<unknown>): Promise<{ code?: string; message: string } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { code?: string; message: string };
  }
}

// ===========================================================================
describe("341 [C2-1] assinatura única de criar_pedido (18 args, p_cliente_id sem default)", () => {
  let t: TestDb;
  let c: Cenario;
  beforeAll(async () => {
    t = await novoDb();
    c = await semear(t);
  });
  afterAll(async () => t?.close());

  it("[1a] existe exatamente UMA public.criar_pedido, com 18 argumentos (16 e 17 dropadas)", async () => {
    const r = await t.db.query<{ nargs: number }>(
      `select pronargs as nargs from pg_proc where proname = 'criar_pedido' and pronamespace = 'public'::regnamespace`,
    );
    expect(r.rows).toEqual([{ nargs: 18 }]);
  });

  it("[1b] o 18º argumento é p_cliente_id uuid e NÃO tem default", async () => {
    const r = await t.db.query<{ ultimo: string; tipo: string; defaults: number }>(
      `select (proargnames)[18] as ultimo, format_type(proargtypes[17], null) as tipo, pronargdefaults::int as defaults
         from pg_proc where proname = 'criar_pedido' and pronamespace = 'public'::regnamespace`,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].ultimo).toBe("p_cliente_id");
    expect(r.rows[0].tipo).toBe("uuid");
    expect(r.rows[0].defaults).toBe(0);
  });

  it("[1c] chamada com os 17 nomes antigos (sem p_cliente_id) → erro, nada gravado (não cai em overload antigo)", async () => {
    const antes = await t.db.query<{ n: number }>(`select count(*)::int as n from public.pedidos`);
    const e = await erroDe(
      t.asService((db) =>
        db.query(
          `select * from public.criar_pedido(
             p_loja_id => $1, p_nome_cliente => 'X', p_telefone_cliente => null,
             p_endereco_entrega => null, p_forma_pagamento => 'pix', p_observacoes => null,
             p_subtotal => 50, p_taxa_entrega => 0, p_desconto => 0, p_total => 50,
             p_cupom_id => null, p_cupom_codigo => null,
             p_itens => '[]'::jsonb, p_tipo_entrega => 'retirada', p_troco_para => null,
             p_idempotency_key => null, p_frete_a_combinar => false
           )`,
          [c.l1],
        ),
      ),
    );
    expect(e).not.toBeNull();
    const depois = await t.db.query<{ n: number }>(`select count(*)::int as n from public.pedidos`);
    expect(depois.rows[0].n).toBe(antes.rows[0].n);
  });

  it("[1d] EXECUTE da de 18 args: service_role sim; anon/authenticated não", async () => {
    const sig =
      "public.criar_pedido(uuid,text,text,jsonb,text,text,numeric,numeric,numeric,numeric,uuid,text,jsonb,text,numeric,uuid,boolean,uuid)";
    const r = await t.db.query<{ svc: boolean; anon: boolean; auth: boolean }>(
      `select has_function_privilege('service_role', $1, 'EXECUTE') as svc,
              has_function_privilege('anon', $1, 'EXECUTE') as anon,
              has_function_privilege('authenticated', $1, 'EXECUTE') as auth`,
      [sig],
    );
    expect(r.rows[0]).toEqual({ svc: true, anon: false, auth: false });
  });

  it("[1e] convidado com p_cliente_id null EXPLÍCITO e sem cupom → pedido como hoje (cliente_id null)", async () => {
    const p = await criar(t, { loja: c.l1, produto: c.produto1, clienteId: null });
    expect(await gravado(t, p.pedido_id)).toEqual({ desconto: 0, total: 55, cupom_codigo: null, cliente_id: null });
  });

  it("[1f] cliente logado → pedido nasce com cliente_id = p_cliente_id", async () => {
    const p = await criar(t, { loja: c.l1, produto: c.produto1, clienteId: CE });
    expect((await gravado(t, p.pedido_id)).cliente_id).toBe(CE);
  });

  it("[1g] p_cliente_id inexistente em clientes → raise cliente_inexistente, nada gravado", async () => {
    const antes = await t.db.query<{ n: number }>(`select count(*)::int as n from public.pedidos`);
    const e = await erroDe(criar(t, { loja: c.l1, produto: c.produto1, clienteId: INEXISTENTE }));
    expect(e?.message ?? "").toContain("cliente_inexistente");
    const depois = await t.db.query<{ n: number }>(`select count(*)::int as n from public.pedidos`);
    expect(depois.rows[0].n).toBe(antes.rows[0].n);
  });
});

// ===========================================================================
describe("341 [C2-2] cupom com limite_por_cliente (RN-C06/C08/C10/C11)", () => {
  let t: TestDb;
  let c: Cenario;
  beforeAll(async () => {
    t = await novoDb();
    c = await semear(t);
  });
  afterAll(async () => t?.close());

  it("[2a] CA 1º pedido com LIM1 → desconto 5, cupom_codigo LIM1, usos_contagem 1", async () => {
    const p = await criar(t, { loja: c.l1, produto: c.produto1, clienteId: CA, cupomId: c.lim1, cupomCodigo: "LIM1" });
    expect(await gravado(t, p.pedido_id)).toEqual({ desconto: 5, total: 50, cupom_codigo: "LIM1", cliente_id: CA });
    expect(await usos(t, c.lim1)).toBe(1);
  });

  it("[2b] CA 2º pedido com LIM1 (limite 1) → desconto 0, cupom_codigo null, total recomposto, usos_contagem NÃO incrementa", async () => {
    const p = await criar(t, { loja: c.l1, produto: c.produto1, clienteId: CA, cupomId: c.lim1, cupomCodigo: "LIM1" });
    expect(await gravado(t, p.pedido_id)).toEqual({ desconto: 0, total: 55, cupom_codigo: null, cliente_id: CA });
    expect(await usos(t, c.lim1)).toBe(1);
  });

  it("[2c] CB (outro cliente) com LIM1 → desconto aplicado (limite é por cliente)", async () => {
    const p = await criar(t, { loja: c.l1, produto: c.produto1, clienteId: CB, cupomId: c.lim1, cupomCodigo: "LIM1" });
    expect(await gravado(t, p.pedido_id)).toEqual({ desconto: 5, total: 50, cupom_codigo: "LIM1", cliente_id: CB });
    expect(await usos(t, c.lim1)).toBe(2);
  });

  it("[2d] convidado com LIM1 (defesa em profundidade, 9-A) → pedido criado, desconto 0, cupom_codigo null, usos_contagem intacto", async () => {
    const antes = await usos(t, c.lim1);
    const p = await criar(t, { loja: c.l1, produto: c.produto1, clienteId: null, cupomId: c.lim1, cupomCodigo: "LIM1" });
    expect(p.pedido_id).toBeTruthy();
    expect(await gravado(t, p.pedido_id)).toEqual({ desconto: 0, total: 55, cupom_codigo: null, cliente_id: null });
    expect(await usos(t, c.lim1)).toBe(antes);
  });

  it("[2e] convidado com cupom SEM limite por cliente → regra global de hoje (desconto 5, consome 1 uso)", async () => {
    const p = await criar(t, { loja: c.l1, produto: c.produto1, clienteId: null, cupomId: c.semLim, cupomCodigo: "SEMLIM" });
    expect(await gravado(t, p.pedido_id)).toEqual({ desconto: 5, total: 50, cupom_codigo: "SEMLIM", cliente_id: null });
    expect(await usos(t, c.semLim)).toBe(1);
  });

  it("[2f] contagem filtrada por loja_id: CA já usou LIM1 na L1, mas o LIM1 da L2 ainda vale para CA", async () => {
    const p = await criar(t, { loja: c.l2, produto: c.produto2, clienteId: CA, cupomId: c.lim1L2, cupomCodigo: "LIM1" });
    expect(await gravado(t, p.pedido_id)).toEqual({ desconto: 5, total: 50, cupom_codigo: "LIM1", cliente_id: CA });
  });

  it("[2g] pedido CANCELADO conta como uso: CC usa LIM1, cancela, e o 2º pedido sai sem desconto", async () => {
    const p1 = await criar(t, { loja: c.l1, produto: c.produto1, clienteId: CC, cupomId: c.lim1, cupomCodigo: "LIM1" });
    expect((await gravado(t, p1.pedido_id)).desconto).toBe(5);
    await t.db.query(`update public.pedidos set status = 'cancelado' where id = $1`, [p1.pedido_id]);
    const p2 = await criar(t, { loja: c.l1, produto: c.produto1, clienteId: CC, cupomId: c.lim1, cupomCodigo: "LIM1" });
    expect(await gravado(t, p2.pedido_id)).toEqual({ desconto: 0, total: 55, cupom_codigo: null, cliente_id: CC });
  });

  it("[2h] mudar o limite vale para os próximos pedidos: CB (1 uso) com limite elevado a 2 volta a ter desconto", async () => {
    await t.db.query(`update public.cupons set limite_por_cliente = 2 where id = $1`, [c.lim1]);
    const p = await criar(t, { loja: c.l1, produto: c.produto1, clienteId: CB, cupomId: c.lim1, cupomCodigo: "LIM1" });
    expect((await gravado(t, p.pedido_id)).desconto).toBe(5);
  });
});

// ===========================================================================
describe("341 [C2-3] idempotência não conta outro uso (RN-C12)", () => {
  let t: TestDb;
  let c: Cenario;
  beforeAll(async () => {
    t = await novoDb();
    c = await semear(t);
  });
  afterAll(async () => t?.close());

  it("[3a] CD com LIM2 (limite 2): chave K, retry K, nova chave → o 3º pedido ainda tem desconto", async () => {
    const K = "1d341000-0000-4000-8000-00000000000a";
    const K2 = "1d341000-0000-4000-8000-00000000000b";
    const p1 = await criar(t, { loja: c.l1, produto: c.produto1, clienteId: CD, cupomId: c.lim2, cupomCodigo: "LIM2", idempotencyKey: K });
    const retry = await criar(t, { loja: c.l1, produto: c.produto1, clienteId: CD, cupomId: c.lim2, cupomCodigo: "LIM2", idempotencyKey: K });
    expect(retry.pedido_id).toBe(p1.pedido_id);
    expect(await usos(t, c.lim2)).toBe(1);
    const p3 = await criar(t, { loja: c.l1, produto: c.produto1, clienteId: CD, cupomId: c.lim2, cupomCodigo: "LIM2", idempotencyKey: K2 });
    expect(await gravado(t, p3.pedido_id)).toEqual({ desconto: 5, total: 50, cupom_codigo: "LIM2", cliente_id: CD });
    expect(await usos(t, c.lim2)).toBe(2);
  });
});

// ===========================================================================
describe("341 [C2-4] CHECK de cupons.limite_por_cliente (1..1000 ou null)", () => {
  let t: TestDb;
  let c: Cenario;
  beforeAll(async () => {
    t = await novoDb();
    c = await semear(t);
  });
  afterAll(async () => t?.close());

  for (const invalido of [0, 1001, -1]) {
    it(`[4a] limite_por_cliente = ${invalido} → 23514`, async () => {
      const e = await erroDe(
        t.asService((db) => db.query(`update public.cupons set limite_por_cliente = $1 where id = $2`, [invalido, c.semLim])),
      );
      expect(e?.code).toBe("23514");
    });
  }

  for (const valido of [1, 1000, null]) {
    it(`[4b] limite_por_cliente = ${valido} → aceito`, async () => {
      await t.asService((db) => db.query(`update public.cupons set limite_por_cliente = $1 where id = $2`, [valido, c.semLim]));
      const r = await t.db.query<{ v: number | null }>(`select limite_por_cliente as v from public.cupons where id = $1`, [c.semLim]);
      expect(r.rows[0].v).toBe(valido);
    });
  }

  it("[4c] coluna é int nullable", async () => {
    const r = await t.db.query<{ tipo: string; nulo: string }>(
      `select data_type as tipo, is_nullable as nulo from information_schema.columns
        where table_schema = 'public' and table_name = 'cupons' and column_name = 'limite_por_cliente'`,
    );
    expect(r.rows).toEqual([{ tipo: "integer", nulo: "YES" }]);
  });
});
