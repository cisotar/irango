import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 341 — fatia C1 do plano (`plan/loop-cadastro-de-clientes.md`, P27).
 *
 * Autoridade: tasks/341 §RED C1 · specs/cliente-vinculo-pedido.md §Modelos de Dados
 * ("pedidos — coluna nova", "RLS nova — leitura do cliente") · RN-C03/C04/C05.
 *
 * Contrato sob teste (`supabase/migrations/<ts>_pedidos_cliente_id.sql`):
 *  - `pedidos.cliente_id uuid null references public.clientes(id) on delete set null`;
 *  - índice parcial `pedidos_cliente_id_criado_em_idx (cliente_id, criado_em desc) where cliente_id is not null`;
 *  - trigger BEFORE UPDATE (SECURITY INVOKER, whitelist service_role/postgres/supabase_admin)
 *    recusando `new.cliente_id is distinct from old.cliente_id`;
 *  - policies SÓ SELECT `to authenticated`: `pedidos_select_cliente`, `itens_pedido_select_cliente`,
 *    `itens_pedido_opcionais_select_cliente`. Nada de escrita nova; `anon` sem leitura.
 *
 * Por que é RED: a migration não existe → `novoDb()` falha com `[RED 341]` e todos os casos caem.
 *
 * Anti-falso-verde: os pedidos são semeados como superuser (fora de RLS/trigger); toda
 * recusa é reconferida pela fonte da verdade (superuser), nunca só pelo erro.
 * Dados fictícios; e-mails únicos com o id inteiro.
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
  return createTestDb();
}

// UUIDs sintéticos.
const LOJ1 = "a3410000-0000-4000-8000-0000000000a1"; // dono da loja L1
const LOJ2 = "a3410000-0000-4000-8000-0000000000a2"; // dono da loja L2 E cliente (decisão 15)
const CA = "c3410000-0000-4000-8000-0000000000ca"; // cliente A
const CB = "c3410000-0000-4000-8000-0000000000cb"; // cliente B

const TEL_A = "(11) 90000-0001";

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

async function criarUsuario(t: TestDb, id: string): Promise<void> {
  await t.db.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`, [
    id,
    `u-${id}@teste.local`,
  ]);
}

async function criarPerfil(t: TestDb, id: string, telefone: string): Promise<void> {
  await t.asService((db) =>
    db.query(
      `select public.criar_perfil_cliente($1::uuid, 'Cliente Teste', $2, '1990-05-10'::date, false, 'v-teste', $3::jsonb)`,
      [id, telefone, JSON.stringify(ENDERECO)],
    ),
  );
}

async function criarLoja(t: TestDb, dono: string, slug: string): Promise<string> {
  const r = await t.asService((db) =>
    db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1, $2, 'Loja', true) returning id`,
      [dono, slug],
    ),
  );
  return r.rows[0].id;
}

/** Pedido + 1 item + 1 opcional, semeado como superuser (fora de RLS e trigger). */
async function semearPedido(
  t: TestDb,
  loja: string,
  clienteId: string | null,
  telefone: string | null,
): Promise<{ pedido: string; item: string; opcional: string }> {
  const p = await t.db.query<{ id: string }>(
    `insert into public.pedidos
       (loja_id, nome_cliente, telefone_cliente, subtotal, desconto, taxa_entrega, total,
        forma_pagamento, tipo_entrega, status, cliente_id)
     values ($1, 'Cliente Pedido', $2, 50, 0, 5, 55, 'pix', 'entrega', 'pendente', $3)
     returning id`,
    [loja, telefone, clienteId],
  );
  const pedido = p.rows[0].id;
  const i = await t.db.query<{ id: string }>(
    `insert into public.itens_pedido (pedido_id, nome, preco, quantidade) values ($1, 'Pizza', 25, 2) returning id`,
    [pedido],
  );
  const item = i.rows[0].id;
  const o = await t.db.query<{ id: string }>(
    `insert into public.itens_pedido_opcionais (item_pedido_id, nome_snapshot, preco_snapshot, quantidade)
     values ($1, 'Borda', 3, 1) returning id`,
    [item],
  );
  return { pedido, item, opcional: o.rows[0].id };
}

async function ids(t: TestDb, quem: string | null, sql: string): Promise<string[]> {
  const run = (db: Parameters<Parameters<TestDb["asAnon"]>[0]>[0]) => db.query<{ id: string }>(sql);
  const r = quem === null ? await t.asAnon(run) : await t.asUser(quem, run);
  return r.rows.map((x) => x.id).sort();
}

async function clienteIdDe(t: TestDb, pedido: string): Promise<string | null> {
  const r = await t.db.query<{ cliente_id: string | null }>(
    `select cliente_id from public.pedidos where id = $1`,
    [pedido],
  );
  return r.rows[0].cliente_id;
}

type Tentativa = { affected: number | null; erro: string | null };
async function tentar(t: TestDb, quem: string, sql: string, params: unknown[]): Promise<Tentativa> {
  try {
    const r = await t.asUser(quem, (db) => db.query(sql, params));
    return { affected: r.affectedRows ?? null, erro: null };
  } catch (e) {
    return { affected: null, erro: (e as Error).message };
  }
}

let t: TestDb;
let L1: string;
let L2: string;
let PA: { pedido: string; item: string; opcional: string }; // CA na L1
let PB: { pedido: string; item: string; opcional: string }; // CB na L2
let PG: { pedido: string; item: string; opcional: string }; // convidado na L1, MESMO telefone de CA
let PC: { pedido: string; item: string; opcional: string }; // LOJ2 (como cliente) na L1

beforeAll(async () => {
  t = await novoDb();
  for (const u of [LOJ1, LOJ2, CA, CB]) await criarUsuario(t, u);
  L1 = await criarLoja(t, LOJ1, "p341-c1-loja1");
  L2 = await criarLoja(t, LOJ2, "p341-c1-loja2");
  await criarPerfil(t, CA, TEL_A);
  await criarPerfil(t, CB, "(11) 90000-0002");
  await criarPerfil(t, LOJ2, "(11) 90000-0003");
  PA = await semearPedido(t, L1, CA, TEL_A);
  PB = await semearPedido(t, L2, CB, "(11) 90000-0002");
  PG = await semearPedido(t, L1, null, TEL_A);
  PC = await semearPedido(t, L1, LOJ2, "(11) 90000-0003");
});

afterAll(async () => t?.close());

// ===========================================================================
describe("341 [C1-1] schema de pedidos.cliente_id", () => {
  it("[1a] coluna uuid nullable com FK para clientes ON DELETE SET NULL", async () => {
    const r = await t.db.query<{ tipo: string; nulo: string; regra: string; alvo: string }>(
      `select c.data_type as tipo, c.is_nullable as nulo, rc.delete_rule as regra, ccu.table_name as alvo
         from information_schema.columns c
         join information_schema.key_column_usage k
           on k.table_schema = 'public' and k.table_name = 'pedidos' and k.column_name = 'cliente_id'
         join information_schema.referential_constraints rc on rc.constraint_name = k.constraint_name
         join information_schema.constraint_column_usage ccu on ccu.constraint_name = k.constraint_name
        where c.table_schema = 'public' and c.table_name = 'pedidos' and c.column_name = 'cliente_id'`,
    );
    expect(r.rows).toEqual([{ tipo: "uuid", nulo: "YES", regra: "SET NULL", alvo: "clientes" }]);
  });

  it("[1b] índice parcial pedidos_cliente_id_criado_em_idx (cliente_id, criado_em desc) where cliente_id is not null", async () => {
    const r = await t.db.query<{ def: string }>(
      `select indexdef as def from pg_indexes where schemaname = 'public' and indexname = 'pedidos_cliente_id_criado_em_idx'`,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].def).toMatch(/\(cliente_id, criado_em DESC\)/);
    expect(r.rows[0].def).toMatch(/WHERE \(cliente_id IS NOT NULL\)/);
  });
});

// ===========================================================================
describe("341 [C1-2] cliente lê só os próprios pedidos/itens/opcionais (RN-C05)", () => {
  it("[2a] asUser(CA) em pedidos → só PA (nada de CB, do convidado nem de LOJ2)", async () => {
    expect(await ids(t, CA, `select id from public.pedidos`)).toEqual([PA.pedido]);
  });

  it("[2b] asUser(CA) em itens_pedido → só o item de PA", async () => {
    expect(await ids(t, CA, `select id from public.itens_pedido`)).toEqual([PA.item]);
  });

  it("[2c] asUser(CA) em itens_pedido_opcionais → só o opcional de PA", async () => {
    expect(await ids(t, CA, `select id from public.itens_pedido_opcionais`)).toEqual([PA.opcional]);
  });

  it("[2d] asUser(CB) → só PB e os filhos de PB", async () => {
    expect(await ids(t, CB, `select id from public.pedidos`)).toEqual([PB.pedido]);
    expect(await ids(t, CB, `select id from public.itens_pedido`)).toEqual([PB.item]);
    expect(await ids(t, CB, `select id from public.itens_pedido_opcionais`)).toEqual([PB.opcional]);
  });

  it("[2e] pedido de convidado com o MESMO telefone de CA é invisível a CA (decisão 20)", async () => {
    const visiveis = await ids(t, CA, `select id from public.pedidos where telefone_cliente = '${TEL_A}'`);
    expect(visiveis).toEqual([PA.pedido]);
    expect(visiveis).not.toContain(PG.pedido);
  });
});

// ===========================================================================
describe("341 [C1-3] lojista continua só na própria loja; lojista+cliente soma os próprios (decisão 15)", () => {
  it("[3a] LOJ1 lê PA, PG e PC (todos da L1) e nunca PB", async () => {
    expect(await ids(t, LOJ1, `select id from public.pedidos`)).toEqual(
      [PA.pedido, PG.pedido, PC.pedido].sort(),
    );
  });

  it("[3b] LOJ2 (dono da L2 + cliente) lê PB (loja) e PC (cliente), nunca PA/PG", async () => {
    expect(await ids(t, LOJ2, `select id from public.pedidos`)).toEqual([PB.pedido, PC.pedido].sort());
  });

  it("[3c] anon → 0 linhas em pedidos, itens_pedido e itens_pedido_opcionais", async () => {
    expect(await ids(t, null, `select id from public.pedidos`)).toEqual([]);
    expect(await ids(t, null, `select id from public.itens_pedido`)).toEqual([]);
    expect(await ids(t, null, `select id from public.itens_pedido_opcionais`)).toEqual([]);
  });
});

// ===========================================================================
describe("341 [C1-4] cliente_id imutável para usuário (RN-C03/C04)", () => {
  it("[4a] CA tenta se apropriar do pedido de convidado (UPDATE cliente_id) → 0 linhas/erro, cliente_id segue null", async () => {
    const r = await tentar(t, CA, `update public.pedidos set cliente_id = $1 where id = $2`, [CA, PG.pedido]);
    expect(r.erro !== null || r.affected === 0).toBe(true);
    expect(await clienteIdDe(t, PG.pedido)).toBeNull();
  });

  it("[4b] CA não escreve no próprio pedido (sem policy de UPDATE/DELETE para o cliente)", async () => {
    const up = await tentar(t, CA, `update public.pedidos set nome_cliente = 'X' where id = $1`, [PA.pedido]);
    expect(up.erro !== null || up.affected === 0).toBe(true);
    const del = await tentar(t, CA, `delete from public.pedidos where id = $1`, [PA.pedido]);
    expect(del.erro !== null || del.affected === 0).toBe(true);
    const r = await t.db.query<{ n: number }>(
      `select count(*)::int as n from public.pedidos where id = $1 and nome_cliente = 'Cliente Pedido'`,
      [PA.pedido],
    );
    expect(r.rows[0].n).toBe(1);
  });

  it("[4c] LOJ1 reescreve cliente_id de pedido da própria loja (CA → CB) → recusado pelo TRIGGER", async () => {
    const r = await tentar(t, LOJ1, `update public.pedidos set cliente_id = $1 where id = $2`, [CB, PA.pedido]);
    // Recusa por exceção (trigger), não por 0 linhas: a policy FOR ALL do lojista ALCANÇA a linha.
    expect(r.erro).not.toBeNull();
    expect(await clienteIdDe(t, PA.pedido)).toBe(CA);
  });

  it("[4d] LOJ1 vincula pedido de convidado a um cliente (null → CA) → recusado pelo TRIGGER", async () => {
    const r = await tentar(t, LOJ1, `update public.pedidos set cliente_id = $1 where id = $2`, [CA, PG.pedido]);
    expect(r.erro).not.toBeNull();
    expect(await clienteIdDe(t, PG.pedido)).toBeNull();
  });

  it("[4e] LOJ1 zera cliente_id (CA → null) → recusado pelo TRIGGER", async () => {
    const r = await tentar(t, LOJ1, `update public.pedidos set cliente_id = null where id = $1`, [PA.pedido]);
    expect(r.erro).not.toBeNull();
    expect(await clienteIdDe(t, PA.pedido)).toBe(CA);
  });

  it("[4f] controle positivo: LOJ1 ainda atualiza outra coluna permitida (trigger não bloqueia demais)", async () => {
    const r = await tentar(t, LOJ1, `update public.pedidos set status = 'confirmado' where id = $1`, [PC.pedido]);
    expect(r.erro).toBeNull();
    expect(r.affected).toBe(1);
    expect(await clienteIdDe(t, PC.pedido)).toBe(LOJ2);
  });

  it("[4g] service_role (anonimização) PODE zerar cliente_id", async () => {
    await t.asService((db) => db.query(`update public.pedidos set cliente_id = null where id = $1`, [PB.pedido]));
    expect(await clienteIdDe(t, PB.pedido)).toBeNull();
  });
});

// ===========================================================================
describe("341 [C1-5] policies novas são só SELECT e não ampliam a 330", () => {
  const ESPERADAS = [
    ["pedidos", "pedidos_select_cliente"],
    ["itens_pedido", "itens_pedido_select_cliente"],
    ["itens_pedido_opcionais", "itens_pedido_opcionais_select_cliente"],
  ] as const;

  for (const [tabela, nome] of ESPERADAS) {
    it(`[5a] ${tabela}.${nome} existe, FOR SELECT, TO authenticated, permissiva`, async () => {
      const r = await t.db.query<{ cmd: string; roles: string; permissive: string }>(
        `select cmd, roles::text as roles, permissive from pg_policies
          where schemaname = 'public' and tablename = $1 and policyname = $2`,
        [tabela, nome],
      );
      expect(r.rows).toEqual([{ cmd: "SELECT", roles: "{authenticated}", permissive: "PERMISSIVE" }]);
    });
  }

  it("[5b] nenhuma policy com 'cliente' no nome dá escrita em pedidos/itens", async () => {
    const r = await t.db.query<{ n: number }>(
      `select count(*)::int as n from pg_policies
        where schemaname = 'public'
          and tablename in ('pedidos','itens_pedido','itens_pedido_opcionais')
          and policyname ilike '%cliente%'
          and cmd <> 'SELECT'`,
    );
    expect(r.rows[0].n).toBe(0);
  });

  it("[5c] nenhuma policy de pedidos/itens alcança anon", async () => {
    const r = await t.db.query<{ n: number }>(
      `select count(*)::int as n from pg_policies
        where schemaname = 'public'
          and tablename in ('pedidos','itens_pedido','itens_pedido_opcionais')
          and ('anon' = any(roles) or 'public' = any(roles))
          and policyname ilike '%cliente%'`,
    );
    expect(r.rows[0].n).toBe(0);
  });
});
