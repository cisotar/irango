import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 355 — funções financeiras do relatório de vendas.
 * Autoridade: plan/tecnico-relatorio-vendas.md §6.5 e §8.3 (T355-01..21);
 * specs RN-V01..V06, V10, V21.
 *
 * Contrato (migration D1 `20261007124000_relatorio_vendas_funcoes.sql`):
 *   status_faturamento(p_so_concluidos boolean) returns text[]  (immutable, strict)
 *   vendas_preparar_consulta(p_loja_id, p_inicio, p_fim, p_tipo_entrega, p_so_concluidos) returns text (fuso)
 *   vendas_por_dia(p_loja_id uuid, p_inicio timestamptz, p_fim timestamptz,
 *                  p_tipo_entrega text default null, p_so_concluidos boolean default false)
 *     returns table (dia date, qtd_pedidos int, bruto, descontos, liquido, frete numeric,
 *                    qtd_frete_a_combinar int)
 *   T1 (forma) → 22023 'vendas: …'; T2 (posse, ANTES de ler pedido) → 42501 'vendas: sem posse da loja'.
 *   SECURITY INVOKER, search_path = public, pg_temp; EXECUTE: authenticated + service_role, nunca anon.
 *
 * Por que é RED: as funções não existem (42883 / asserção). O seed usa só o schema atual.
 * T355-14 PASSA já no RED de propósito: é o anti-falso-verde que prova que a RLS sozinha
 * entregaria ao lojista-cliente os próprios pedidos numa loja alheia (vetor real do T2).
 *
 * Recusas afirmam SQLSTATE E fragmento da mensagem. Dados fictícios.
 */

const DONO_X = "a3550000-0000-4000-8000-00000000000a";
const DONO_Y = "b3550000-0000-4000-8000-00000000000b";
const INEXISTENTE = "f3550000-0000-4000-8000-0000000000ff";

// Dia 2026-10-06 no calendário de São Paulo (-03).
const DIA_INI = "2026-10-06T03:00:00Z";
const DIA_FIM = "2026-10-07T03:00:00Z";
const EM = "2026-10-06T15:00:00Z";

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

type LinhaDia = {
  dia: string;
  qtd_pedidos: number;
  bruto: number;
  descontos: number;
  liquido: number;
  frete: number;
  qtd_frete_a_combinar: number;
};

/** "service" | "anon" | "postgres" (sem JWT) | uuid de usuário autenticado. */
type Quem = string;

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

function como<T>(t: TestDb, quem: Quem, fn: (db: PGlite) => Promise<T>): Promise<T> {
  if (quem === "service") return t.asService(fn);
  if (quem === "anon") return t.asAnon(fn);
  if (quem === "postgres") return fn(t.db);
  return t.asUser(quem, fn);
}

async function porDia(
  t: TestDb,
  quem: Quem,
  loja: string | null,
  inicio: string | null,
  fim: string | null,
  tipo: string | null = null,
  concluidos: boolean | null = false,
): Promise<LinhaDia[]> {
  const r = await como(t, quem, (db) =>
    db.query<LinhaDia>(
      `select * from public.vendas_por_dia(
         p_loja_id       => $1::uuid,
         p_inicio        => $2::timestamptz,
         p_fim           => $3::timestamptz,
         p_tipo_entrega  => $4::text,
         p_so_concluidos => $5::boolean)`,
      [loja, inicio, fim, tipo, concluidos],
    ),
  );
  return r.rows;
}

let seqDono = 0;
async function novaLoja(t: TestDb, slug: string, opts: { dono?: string; timezone?: string } = {}): Promise<string> {
  const dono = opts.dono ?? `d3550000-0000-4000-8000-${String(++seqDono).padStart(12, "0")}`;
  await t.db.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`, [
    dono,
    `${slug}@teste.local`,
  ]);
  const r = await t.asService((db) =>
    db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo, timezone)
       values ($1, $2, 'Loja', true, $3) returning id`,
      [dono, slug, opts.timezone ?? "America/Sao_Paulo"],
    ),
  );
  return r.rows[0].id;
}

type Pedido = {
  subtotal: number;
  desconto?: number;
  /** null = frete a combinar */
  taxa?: number | null;
  total?: number;
  status?: string;
  tipo?: "entrega" | "retirada";
  em?: string;
  cliente?: string | null;
};

async function pedido(t: TestDb, loja: string, p: Pedido): Promise<string> {
  const desconto = p.desconto ?? 0;
  const taxa = p.taxa === undefined ? 0 : p.taxa;
  const total = p.total ?? Math.max(0, p.subtotal - desconto) + (taxa ?? 0);
  const r = await t.db.query<{ id: string }>(
    `insert into public.pedidos
       (loja_id, nome_cliente, telefone_cliente, subtotal, desconto, taxa_entrega, total,
        frete_a_combinar, forma_pagamento, tipo_entrega, status, cliente_id, criado_em)
     values ($1, 'Cliente Teste', '(11) 90000-0000', $2, $3, $4, $5, $6, 'pix', $7, $8, $9, $10::timestamptz)
     returning id`,
    [
      loja,
      p.subtotal,
      desconto,
      taxa,
      total,
      taxa === null,
      p.tipo ?? "retirada",
      p.status ?? "entregue",
      p.cliente ?? null,
      p.em ?? EM,
    ],
  );
  return r.rows[0].id;
}

describe("355 status_faturamento + vendas_por_dia — RN-V01..V06/V10/V21 e segurança (pglite)", () => {
  let t: TestDb;
  let lojaX: string;
  let lojaY: string;

  beforeAll(async () => {
    t = await createTestDb();
    // Loja X ANTES do perfil de cliente do DONO_X (conta de cliente não pode virar dona).
    lojaX = await novaLoja(t, "loja-x-355", { dono: DONO_X });
    lojaY = await novaLoja(t, "loja-y-355", { dono: DONO_Y });
    await t.asService((db) =>
      db.query(
        `select public.criar_perfil_cliente($1::uuid, 'Dono X Cliente', '(11) 90000-0000', '1990-05-10'::date, true, 'v-teste', $2::jsonb)`,
        [DONO_X, JSON.stringify(ENDERECO)],
      ),
    );
    // DONO_X comprou 2x em Y (é o vetor RN-V21).
    await pedido(t, lojaY, { subtotal: 40, cliente: DONO_X });
    await pedido(t, lojaY, { subtotal: 25, cliente: DONO_X });
    // Movimento próprio de X.
    await pedido(t, lojaX, { subtotal: 70, status: "entregue" });
    await pedido(t, lojaX, { subtotal: 15, status: "confirmado" });
  });
  afterAll(async () => {
    await t.close();
  });

  it("T355-01 status_faturamento: false → 4 status; true → {entregue}; null → null", async () => {
    const r = await t.db.query<{ f: string[] | null; v: string[] | null; n: string[] | null }>(
      `select public.status_faturamento(false) as f, public.status_faturamento(true) as v,
              public.status_faturamento(null) as n`,
    );
    expect(r.rows[0].f).toEqual(["confirmado", "em_preparo", "saiu_entrega", "entregue"]);
    expect(r.rows[0].v).toEqual(["entregue"]);
    expect(r.rows[0].n).toBeNull();
  });

  describe("RN-V01/V02 status", () => {
    let loja: string;
    beforeAll(async () => {
      loja = await novaLoja(t, "loja-v01-355");
      await pedido(t, loja, { subtotal: 50, status: "entregue" });
      await pedido(t, loja, { subtotal: 30, status: "em_preparo" });
      await pedido(t, loja, { subtotal: 20, status: "pendente" });
      await pedido(t, loja, { subtotal: 40, status: "cancelado" });
    });

    it("T355-02 RN-V01: entregue 50 + em_preparo 30 (pendente e cancelado fora) → bruto 80, 2 pedidos", async () => {
      const linhas = await porDia(t, "service", loja, DIA_INI, DIA_FIM);
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toMatchObject({ dia: "2026-10-06", bruto: 80, qtd_pedidos: 2 });
    });

    it("T355-03 RN-V02: só concluídos → bruto 50, 1 pedido", async () => {
      const linhas = await porDia(t, "service", loja, DIA_INI, DIA_FIM, null, true);
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toMatchObject({ bruto: 50, qtd_pedidos: 1 });
    });
  });

  it("T355-04 RN-V03: subtotal 100, desconto 10, taxa 8, total 98 → bruto 100, descontos 10, líquido 90, frete 8", async () => {
    const loja = await novaLoja(t, "loja-v03-355");
    await pedido(t, loja, { subtotal: 100, desconto: 10, taxa: 8, total: 98, tipo: "entrega" });
    const linhas = await porDia(t, "service", loja, DIA_INI, DIA_FIM);
    expect(linhas).toEqual([
      {
        dia: "2026-10-06",
        qtd_pedidos: 1,
        bruto: 100,
        descontos: 10,
        liquido: 90,
        frete: 8,
        qtd_frete_a_combinar: 0,
      },
    ]);
  });

  describe("RN-V05 frete a combinar", () => {
    let loja: string;
    let pedidoB: string;
    beforeAll(async () => {
      loja = await novaLoja(t, "loja-v05-355");
      await pedido(t, loja, { subtotal: 50, taxa: 5, total: 55, tipo: "entrega" });
      pedidoB = await pedido(t, loja, { subtotal: 30, taxa: null, total: 30, tipo: "entrega" });
    });

    it("T355-05 a combinar não soma frete e é contado: bruto 80, líquido 80, frete 5, 1 a combinar", async () => {
      const linhas = await porDia(t, "service", loja, DIA_INI, DIA_FIM);
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toMatchObject({ bruto: 80, liquido: 80, frete: 5, qtd_frete_a_combinar: 1 });
    });

    it("T355-06 registro posterior do frete (7) → frete 12, 0 a combinar", async () => {
      await t.db.query(
        `update public.pedidos set frete_a_combinar = false, taxa_entrega = 7, total = 37 where id = $1`,
        [pedidoB],
      );
      const linhas = await porDia(t, "service", loja, DIA_INI, DIA_FIM);
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toMatchObject({ frete: 12, qtd_frete_a_combinar: 0 });
    });
  });

  it("T355-07 RN-V04 (D8): Σ líquido + Σ frete = Σ total do mesmo filtro (148)", async () => {
    const loja = await novaLoja(t, "loja-v04-355");
    await pedido(t, loja, { subtotal: 100, desconto: 10, taxa: 8, total: 98, tipo: "entrega", status: "entregue" });
    await pedido(t, loja, { subtotal: 50, taxa: null, total: 50, tipo: "entrega", status: "confirmado" });
    await pedido(t, loja, { subtotal: 20, desconto: 25, taxa: 0, total: 0, status: "entregue" }); // líquido 0
    await pedido(t, loja, { subtotal: 40, status: "cancelado" });

    const linhas = await porDia(t, "service", loja, DIA_INI, DIA_FIM);
    const soma = linhas.reduce((s, l) => s + l.liquido + l.frete, 0);
    const r = await t.db.query<{ s: number }>(
      `select sum(total) as s from public.pedidos
        where loja_id = $1 and criado_em >= $2::timestamptz and criado_em < $3::timestamptz
          and status in ('confirmado', 'em_preparo', 'saiu_entrega', 'entregue')`,
      [loja, DIA_INI, DIA_FIM],
    );
    expect(r.rows[0].s).toBe(148);
    expect(soma).toBe(148);
  });

  it("T355-08 RN-V06 SP: pedido 2026-10-06T02:30Z cai no dia local 2026-10-05", async () => {
    const loja = await novaLoja(t, "loja-v06sp-355");
    await pedido(t, loja, { subtotal: 10, em: "2026-10-06T02:30:00Z" });
    const linhas = await porDia(t, "service", loja, "2026-10-05T03:00:00Z", "2026-10-07T03:00:00Z");
    expect(linhas.map((l) => l.dia)).toEqual(["2026-10-05"]);
  });

  it("T355-09 RN-V06 Manaus: 03:30Z → 2026-10-05; 04:30Z → 2026-10-06", async () => {
    const loja = await novaLoja(t, "loja-v06mao-355", { timezone: "America/Manaus" });
    await pedido(t, loja, { subtotal: 10, em: "2026-10-06T03:30:00Z" });
    await pedido(t, loja, { subtotal: 20, em: "2026-10-06T04:30:00Z" });
    const linhas = await porDia(t, "service", loja, "2026-10-05T04:00:00Z", "2026-10-08T04:00:00Z");
    expect(linhas.map((l) => [l.dia, l.bruto])).toEqual([
      ["2026-10-05", 10],
      ["2026-10-06", 20],
    ]);
  });

  it("T355-10 RN-V10: entrega 60 + retirada 20 → 'entrega' 60, 'retirada' 20, NULL 80", async () => {
    const loja = await novaLoja(t, "loja-v10-355");
    await pedido(t, loja, { subtotal: 60, tipo: "entrega", taxa: 0 });
    await pedido(t, loja, { subtotal: 20, tipo: "retirada" });
    const bruto = async (tipo: string | null) =>
      (await porDia(t, "service", loja, DIA_INI, DIA_FIM, tipo)).map((l) => l.bruto);
    expect(await bruto("entrega")).toEqual([60]);
    expect(await bruto("retirada")).toEqual([20]);
    expect(await bruto(null)).toEqual([80]);
  });

  it("T355-11 tipo_entrega inválido → 22023", async () => {
    esperarRecusa(await erroDe(porDia(t, "service", lojaX, DIA_INI, DIA_FIM, "x")), "22023", "tipo_entrega inválido");
  });

  it("T355-12 faixa: obrigatória, invertida, teto de 367 dias (367 aceito, 368 não), loja e so_concluidos obrigatórios", async () => {
    esperarRecusa(await erroDe(porDia(t, "service", lojaX, null, DIA_FIM)), "22023", "faixa obrigatória");
    esperarRecusa(await erroDe(porDia(t, "service", lojaX, DIA_INI, DIA_INI)), "22023", "faixa invertida");
    esperarRecusa(
      await erroDe(porDia(t, "service", lojaX, "2026-01-01T03:00:00Z", "2027-01-04T03:00:00Z")),
      "22023",
      "faixa acima do teto",
    );
    expect(
      Array.isArray(await porDia(t, "service", lojaX, "2026-01-01T03:00:00Z", "2027-01-03T03:00:00Z")),
    ).toBe(true);
    esperarRecusa(await erroDe(porDia(t, "service", null, DIA_INI, DIA_FIM)), "22023", "loja obrigatória");
    esperarRecusa(
      await erroDe(porDia(t, "service", lojaX, DIA_INI, DIA_FIM, null, null)),
      "22023",
      "so_concluidos obrigatório",
    );
  });

  it("T355-13 dono vê a própria loja: linhas iguais às do service_role", async () => {
    const doDono = await porDia(t, DONO_X, lojaX, DIA_INI, DIA_FIM);
    const doServico = await porDia(t, "service", lojaX, DIA_INI, DIA_FIM);
    expect(doServico).toHaveLength(1);
    expect(doServico[0]).toMatchObject({ bruto: 85, qtd_pedidos: 2 });
    expect(doDono).toEqual(doServico);
  });

  it("T355-14 vetor real (anti-falso-verde): pela RLS, DONO_X lê 2 pedidos de Y como cliente", async () => {
    const r = await t.asUser(DONO_X, (db) =>
      db.query<{ n: number }>(`select count(*)::int as n from public.pedidos where loja_id = $1`, [lojaY]),
    );
    expect(r.rows[0].n).toBe(2);
  });

  it("T355-15 RN-V21: lojista-cliente pedindo a loja onde comprou → 42501 sem posse da loja", async () => {
    esperarRecusa(await erroDe(porDia(t, DONO_X, lojaY, DIA_INI, DIA_FIM)), "42501", "sem posse da loja");
  });

  it("T355-16 outro dono → 42501 sem posse da loja", async () => {
    esperarRecusa(await erroDe(porDia(t, DONO_Y, lojaX, DIA_INI, DIA_FIM)), "42501", "sem posse da loja");
  });

  it("T355-17 claim forjado (role authenticated + claim service_role) → 42501 sem posse da loja", async () => {
    const e = await erroDe(
      (async () => {
        await t.db.exec("begin");
        try {
          await t.db.query("set local role authenticated");
          await t.db.query(`select set_config('request.jwt.claims', $1, true)`, [
            JSON.stringify({ sub: DONO_Y, role: "service_role" }),
          ]);
          await t.db.query(`select * from public.vendas_por_dia($1::uuid, $2::timestamptz, $3::timestamptz)`, [
            lojaX,
            DIA_INI,
            DIA_FIM,
          ]);
          await t.db.exec("commit");
        } catch (err) {
          await t.db.exec("rollback");
          throw err;
        }
      })(),
    );
    esperarRecusa(e, "42501", "sem posse da loja");
  });

  it("T355-18 sem JWT (sessão postgres sem claims) → 42501 sem posse da loja", async () => {
    esperarRecusa(await erroDe(porDia(t, "postgres", lojaX, DIA_INI, DIA_FIM)), "42501", "sem posse da loja");
  });

  it("T355-19 anon → 42501 permission denied for function", async () => {
    esperarRecusa(
      await erroDe(porDia(t, "anon", lojaX, DIA_INI, DIA_FIM)),
      "42501",
      "permission denied for function",
    );
  });

  it("T355-20 service_role: X → linhas; loja inexistente → []", async () => {
    expect((await porDia(t, "service", lojaX, DIA_INI, DIA_FIM)).length).toBeGreaterThan(0);
    expect(await porDia(t, "service", INEXISTENTE, DIA_INI, DIA_FIM)).toEqual([]);
  });

  it("T355-21 ACL e segurança: anon sem EXECUTE; authenticated e service_role com; vendas_* invoker com search_path fixo", async () => {
    const nomes = ["status_faturamento", "vendas_itens_por_categoria", "vendas_por_dia", "vendas_preparar_consulta"];
    const r = await t.db.query<{
      proname: string;
      prosecdef: boolean;
      proconfig: string[] | null;
      anon: boolean;
      auth: boolean;
      svc: boolean;
    }>(
      `select p.proname, p.prosecdef, p.proconfig,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('service_role', p.oid, 'execute') as svc
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1::text[])
        order by p.proname`,
      [nomes],
    );
    expect(r.rows.map((x) => x.proname)).toEqual(nomes);
    for (const f of r.rows) {
      expect({ f: f.proname, anon: f.anon, auth: f.auth, svc: f.svc }).toEqual({
        f: f.proname,
        anon: false,
        auth: true,
        svc: true,
      });
      if (f.proname.startsWith("vendas_")) {
        expect(f.prosecdef, f.proname).toBe(false);
        expect(f.proconfig ?? [], f.proname).toContain("search_path=public, pg_temp");
      }
    }
  });
});
