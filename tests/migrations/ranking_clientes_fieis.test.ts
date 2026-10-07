import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 356 — ranking de clientes fiéis (RN-V17..V21).
 * Autoridade: plan/tecnico-relatorio-vendas.md §6.6 e §8.5 (T356-01..15).
 *
 * Contrato (migration D2 `20261007125000_ranking_clientes_fieis.sql`):
 *   ranking_clientes_da_loja(p_inicio timestamptz default null, p_fim timestamptz default null,
 *     p_ordem text default 'pedidos', p_limite integer default 20)
 *   returns table (cliente_id uuid, nome text, total_pedidos int, total_gasto numeric,
 *     ultimo_pedido_em timestamptz, itens_top jsonb)
 *   pedidos_convidados_da_loja(p_inicio timestamptz default null, p_fim timestamptz default null) returns int
 *   Escopo = loja de auth.uid() (sem parâmetro de loja); status = status_faturamento(false);
 *   ordena e corta no banco; 22023 nas entradas inválidas; SECURITY DEFINER, search_path '';
 *   EXECUTE só authenticated.
 *
 * Por que é RED: as funções e o arquivo da migration não existem. O seed (beforeAll) usa
 * só o schema atual, então cada caso falha isolado (42883 / asserção / migration ausente).
 * Recusas afirmam SQLSTATE E fragmento da mensagem. Dados fictícios.
 */

const LX = "a3560000-0000-4000-8000-00000000000a"; // dono de X (também cliente em Y)
const LY = "b3560000-0000-4000-8000-00000000000b";
const LW = "c3560000-0000-4000-8000-00000000000c";
const LV = "d3560000-0000-4000-8000-00000000000d";
const LU = "e3560000-0000-4000-8000-00000000000e";
const A = "f3560000-0000-4000-8000-000000000001";
const B = "f3560000-0000-4000-8000-000000000002";
const C_ANON = "f3560000-0000-4000-8000-000000000003";
const C_Y = "f3560000-0000-4000-8000-000000000004";
/** Clientes 1..25 da loja V. */
const V = (k: number) => `f3560000-0000-4000-8000-0000000001${String(k).padStart(2, "0")}`;

const FIM = "2026-10-08T03:00:00Z";
const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

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

type LinhaRanking = {
  cliente_id: string;
  nome: string;
  total_pedidos: number;
  total_gasto: number;
  ultimo_pedido_em: string;
  itens_top: { nome: string; quantidade: number }[];
};

type Erro = { code?: string; message: string };

async function erroDe(p: Promise<unknown>): Promise<Erro | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as Erro;
  }
}

function esperarRecusa(e: Erro | null, code: string, fragmento: string): void {
  expect(e, `esperava recusa ${code} "${fragmento}"`).not.toBeNull();
  expect(e?.code).toBe(code);
  expect(e?.message).toContain(fragmento);
}

function como<T>(t: TestDb, quem: string, fn: (db: PGlite) => Promise<T>): Promise<T> {
  if (quem === "service") return t.asService(fn);
  if (quem === "anon") return t.asAnon(fn);
  return t.asUser(quem, fn);
}

type ArgsRanking = { inicio?: string | null; fim?: string | null; ordem?: string; limite?: number };

function argsNomeados(a: ArgsRanking, comOrdem: boolean): { sql: string; params: unknown[] } {
  const partes: string[] = [];
  const params: unknown[] = [];
  const add = (nome: string, tipo: string, v: unknown) => {
    params.push(v);
    partes.push(`${nome} => $${params.length}::${tipo}`);
  };
  if ("inicio" in a) add("p_inicio", "timestamptz", a.inicio);
  add("p_fim", "timestamptz", "fim" in a ? a.fim : FIM);
  if (comOrdem && a.ordem !== undefined) add("p_ordem", "text", a.ordem);
  if (comOrdem && a.limite !== undefined) add("p_limite", "integer", a.limite);
  return { sql: partes.join(", "), params };
}

async function ranking(t: TestDb, quem: string, a: ArgsRanking = {}): Promise<LinhaRanking[]> {
  const { sql, params } = argsNomeados(a, true);
  const r = await como(t, quem, (db) =>
    db.query<LinhaRanking>(`select * from public.ranking_clientes_da_loja(${sql})`, params),
  );
  return r.rows;
}

async function convidados(t: TestDb, quem: string, a: ArgsRanking = {}): Promise<number> {
  const { sql, params } = argsNomeados(a, false);
  const r = await como(t, quem, (db) =>
    db.query<{ n: number }>(`select public.pedidos_convidados_da_loja(${sql}) as n`, params),
  );
  return r.rows[0].n;
}

const ids = (linhas: LinhaRanking[]) => linhas.map((l) => l.cliente_id);

async function usuario(t: TestDb, id: string): Promise<void> {
  await t.db.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`, [
    id,
    `u-${id}@teste.local`,
  ]);
}

async function perfil(t: TestDb, id: string, nome: string): Promise<void> {
  await t.asService((db) =>
    db.query(
      `select public.criar_perfil_cliente($1::uuid, $2, '(11) 90000-0000', '1990-05-10'::date, true, 'v-teste', $3::jsonb)`,
      [id, nome, JSON.stringify(ENDERECO)],
    ),
  );
}

async function loja(t: TestDb, dono: string, slug: string): Promise<string> {
  const r = await t.asService((db) =>
    db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1, $2, 'Loja', true) returning id`,
      [dono, slug],
    ),
  );
  return r.rows[0].id;
}

async function pedido(
  t: TestDb,
  lojaId: string,
  cliente: string | null,
  status: string,
  total: number,
  criadoEm: string,
): Promise<string> {
  const r = await t.db.query<{ id: string }>(
    `insert into public.pedidos
       (loja_id, nome_cliente, telefone_cliente, subtotal, desconto, taxa_entrega, total,
        forma_pagamento, tipo_entrega, status, cliente_id, criado_em)
     values ($1, 'Cliente Pedido', '(11) 90000-0000', $2, 0, 0, $2, 'pix', 'retirada', $3, $4, $5::timestamptz)
     returning id`,
    [lojaId, total, status, cliente, criadoEm],
  );
  return r.rows[0].id;
}

async function item(t: TestDb, pedidoId: string, nome: string, quantidade: number): Promise<void> {
  await t.db.query(
    `insert into public.itens_pedido (pedido_id, produto_id, nome, preco, quantidade) values ($1, null, $2, 1, $3)`,
    [pedidoId, nome, quantidade],
  );
}

describe("356 ranking_clientes_da_loja + pedidos_convidados_da_loja (pglite)", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
    const todos = [LX, LY, LW, LV, LU, A, B, C_ANON, C_Y];
    for (let k = 1; k <= 25; k++) todos.push(V(k));
    for (const id of todos) await usuario(t, id);

    // Lojas ANTES do perfil de cliente do LX (conta de cliente não pode virar dona).
    const lojaX = await loja(t, LX, "loja-x-356");
    const lojaY = await loja(t, LY, "loja-y-356");
    const lojaW = await loja(t, LW, "loja-w-356");
    const lojaV = await loja(t, LV, "loja-v-356");
    const lojaU = await loja(t, LU, "loja-u-356");

    await perfil(t, LX, "Lojista X Cliente");
    await perfil(t, A, "Cliente A");
    await perfil(t, B, "Cliente B");
    await perfil(t, C_ANON, "Cliente Anon");
    await perfil(t, C_Y, "Cliente Y");
    for (let k = 1; k <= 25; k++) await perfil(t, V(k), `Cliente V${k}`);

    // ── X (T356-01/10): A com 3 válidos, 2 convidados, 1 entregue de C_ANON (depois anonimizado).
    await pedido(t, lojaX, A, "confirmado", 30, "2026-10-02T12:00:00Z");
    await pedido(t, lojaX, A, "em_preparo", 30, "2026-10-03T12:00:00Z");
    await pedido(t, lojaX, A, "entregue", 30, "2026-10-04T12:00:00Z");
    await pedido(t, lojaX, null, "entregue", 25, "2026-10-04T13:00:00Z");
    await pedido(t, lojaX, null, "confirmado", 25, "2026-10-04T14:00:00Z");
    await pedido(t, lojaX, C_ANON, "entregue", 40, "2026-10-05T12:00:00Z");
    await t.asService((db) => db.query(`select public.anonimizar_cliente($1)`, [C_ANON]));

    // ── Y (T356-10): C_Y só comprou em Y; LX é cliente em Y.
    await pedido(t, lojaY, C_Y, "entregue", 50, "2026-10-03T12:00:00Z");
    await pedido(t, lojaY, LX, "entregue", 60, "2026-10-04T12:00:00Z");

    // ── W (T356-02..05/07): A 5 × 20; B 2 × 150; A pendente/cancelado de 500 (mais recentes).
    const a1 = await pedido(t, lojaW, A, "entregue", 20, "2026-10-01T12:00:00Z");
    const a2 = await pedido(t, lojaW, A, "entregue", 20, "2026-10-02T12:00:00Z");
    const a3 = await pedido(t, lojaW, A, "confirmado", 20, "2026-10-03T12:00:00Z");
    await pedido(t, lojaW, A, "em_preparo", 20, "2026-10-04T12:00:00Z");
    await pedido(t, lojaW, A, "saiu_entrega", 20, "2026-10-05T12:00:00Z");
    await pedido(t, lojaW, B, "entregue", 150, "2026-10-06T12:00:00Z");
    await pedido(t, lojaW, B, "entregue", 150, "2026-10-07T12:00:00Z");
    await pedido(t, lojaW, A, "pendente", 500, "2026-10-07T20:00:00Z");
    const aCanc = await pedido(t, lojaW, A, "cancelado", 500, "2026-10-07T21:00:00Z");
    await item(t, a1, "Coca", 2);
    await item(t, a1, "X-Burger", 3);
    await item(t, a2, "Coca", 3);
    await item(t, a2, "Batata", 2);
    await item(t, a3, "Suco", 1);
    await item(t, aCanc, "Coca", 10);

    // ── V (T356-06): 1..5 com 3 pedidos de R$ 1; 6..25 com 1 pedido de 100 + k.
    for (let k = 1; k <= 5; k++) {
      for (let n = 0; n < 3; n++) await pedido(t, lojaV, V(k), "entregue", 1, `2026-10-0${n + 1}T12:00:00Z`);
    }
    for (let k = 6; k <= 25; k++) await pedido(t, lojaV, V(k), "entregue", 100 + k, "2026-10-04T12:00:00Z");

    // ── U (T356-08): A com 1 pedido em 2020 e 1 em outubro/2026.
    await pedido(t, lojaU, A, "entregue", 10, "2020-01-01T12:00:00Z");
    await pedido(t, lojaU, A, "entregue", 10, "2026-10-02T12:00:00Z");
  });
  afterAll(async () => {
    await t.close();
  });

  it("T356-01 RN-V17: convidado e anonimizado fora do ranking; ranking [A] com 3 pedidos; convidados 3", async () => {
    const linhas = await ranking(t, LX);
    expect(ids(linhas)).toEqual([A]);
    expect(linhas[0].total_pedidos).toBe(3);
    expect(await convidados(t, LX)).toBe(3);
  });

  it("T356-02 RN-V19 ordem padrão 'pedidos' → [A, B]", async () => {
    expect(ids(await ranking(t, LW, { ordem: "pedidos" }))).toEqual([A, B]);
    expect(ids(await ranking(t, LW))).toEqual([A, B]);
  });

  it("T356-03 ordem 'total' → [B, A]", async () => {
    expect(ids(await ranking(t, LW, { ordem: "total" }))).toEqual([B, A]);
  });

  it("T356-04 ordem 'ultimo' → [B, A]; ultimo_pedido_em = max dos pedidos que contam", async () => {
    const linhas = await ranking(t, LW, { ordem: "ultimo" });
    expect(ids(linhas)).toEqual([B, A]);
    expect(linhas.map((l) => new Date(l.ultimo_pedido_em).toISOString())).toEqual([
      "2026-10-07T12:00:00.000Z",
      "2026-10-05T12:00:00.000Z",
    ]);
  });

  it("T356-05 pendente e cancelado de A não contam: 5 pedidos, total 100", async () => {
    const a = (await ranking(t, LW)).find((l) => l.cliente_id === A);
    expect(a).toMatchObject({ total_pedidos: 5, total_gasto: 100 });
  });

  it("T356-06 corta DEPOIS de ordenar: 'total' limite 20 → clientes 25..6, totais 125..106", async () => {
    const linhas = await ranking(t, LV, { ordem: "total", limite: 20 });
    const esperados = Array.from({ length: 20 }, (_, i) => 25 - i);
    expect(ids(linhas)).toEqual(esperados.map(V));
    expect(linhas.map((l) => l.total_gasto)).toEqual(esperados.map((k) => 100 + k));
    for (let k = 1; k <= 5; k++) expect(ids(linhas)).not.toContain(V(k));
  });

  it("T356-07 itens_top: 3 mais comprados somados entre pedidos válidos (cancelado fora)", async () => {
    const a = (await ranking(t, LW)).find((l) => l.cliente_id === A);
    expect(a?.itens_top).toEqual([
      { nome: "Coca", quantidade: 5 },
      { nome: "X-Burger", quantidade: 3 },
      { nome: "Batata", quantidade: 2 },
    ]);
  });

  it("T356-08 período: p_inicio NULL conta o pedido de 2020; p_inicio 2026-10-01 não", async () => {
    expect((await ranking(t, LU, { inicio: null }))[0]?.total_pedidos).toBe(2);
    expect((await ranking(t, LU, { inicio: "2026-10-01T03:00:00Z" }))[0]?.total_pedidos).toBe(1);
  });

  it("T356-09 RN-V20 allowlist: 6 colunas; resultado sem telefone nem email", async () => {
    const linhas = await ranking(t, LW);
    expect(Object.keys(linhas[0]).sort()).toEqual([
      "cliente_id",
      "itens_top",
      "nome",
      "total_gasto",
      "total_pedidos",
      "ultimo_pedido_em",
    ]);
    const r = await t.db.query<{ res: string }>(
      `select pg_get_function_result(p.oid) as res from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'ranking_clientes_da_loja'`,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].res).not.toContain("telefone");
    expect(r.rows[0].res).not.toContain("email");
  });

  it("T356-10 RN-V21 escopo: LX não vê cliente só de Y nem as próprias compras em Y; LY vê os seus", async () => {
    const x = ids(await ranking(t, LX));
    expect(x).not.toContain(C_Y);
    expect(x).not.toContain(LX);
    expect(x).toEqual([A]);
    // Anti-falso-verde: os dados de Y existem e aparecem para o dono de Y.
    expect(ids(await ranking(t, LY)).sort()).toEqual([LX, C_Y].sort());
  });

  it("T356-11 service_role (auth.uid() NULL) → ranking [] e convidados 0", async () => {
    expect(await ranking(t, "service")).toEqual([]);
    expect(await convidados(t, "service")).toBe(0);
  });

  it("T356-12 anon → 42501 permission denied for function (ranking e convidados)", async () => {
    esperarRecusa(await erroDe(ranking(t, "anon")), "42501", "permission denied for function");
    esperarRecusa(await erroDe(convidados(t, "anon")), "42501", "permission denied for function");
  });

  it("T356-13 entradas inválidas → 22023 (ranking e convidados)", async () => {
    esperarRecusa(await erroDe(ranking(t, LW, { ordem: "nome" })), "22023", "p_ordem inválido");
    esperarRecusa(await erroDe(ranking(t, LW, { limite: 21 })), "22023", "p_limite fora de 1..20");
    esperarRecusa(await erroDe(ranking(t, LW, { limite: 0 })), "22023", "p_limite fora de 1..20");
    esperarRecusa(await erroDe(ranking(t, LW, { fim: null })), "22023", "p_fim obrigatório");
    esperarRecusa(await erroDe(ranking(t, LW, { inicio: FIM, fim: FIM })), "22023", "faixa invertida");
    esperarRecusa(await erroDe(convidados(t, LW, { fim: null })), "22023", "p_fim obrigatório");
    esperarRecusa(await erroDe(convidados(t, LW, { inicio: FIM, fim: FIM })), "22023", "faixa invertida");
  });

  it("T356-14 fonte única: a migration não lista status à mão e usa public.status_faturamento", async () => {
    const nome = readdirSync(MIGRATIONS).find((f) => f.startsWith("20261007125000_"));
    if (!nome) throw new Error("[RED 356] migration ausente: 20261007125000_ranking_clientes_fieis.sql");
    const semComentarios = readFileSync(join(MIGRATIONS, nome), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/--.*$/gm, "");
    expect(semComentarios).not.toMatch(/'em_preparo'/);
    expect(semComentarios).toContain("public.status_faturamento");
  });

  it("T356-15 SECURITY DEFINER, search_path vazio; EXECUTE só authenticated", async () => {
    const r = await t.db.query<{
      proname: string;
      prosecdef: boolean;
      proconfig: string[] | null;
      anon: boolean;
      auth: boolean;
    }>(
      `select p.proname, p.prosecdef, p.proconfig,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('ranking_clientes_da_loja', 'pedidos_convidados_da_loja')
        order by p.proname`,
    );
    expect(r.rows).toEqual([
      { proname: "pedidos_convidados_da_loja", prosecdef: true, proconfig: ['search_path=""'], anon: false, auth: true },
      { proname: "ranking_clientes_da_loja", prosecdef: true, proconfig: ['search_path=""'], anon: false, auth: true },
    ]);
  });
});
