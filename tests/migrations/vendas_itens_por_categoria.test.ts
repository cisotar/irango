import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, type TestDb } from "../helpers/pglite";
import { calcularSubtotal, totalDaLinha, type ItemCalculo } from "@/lib/utils/calcularTotal";

/**
 * Fase RED (TDD) da issue 355 — `vendas_itens_por_categoria` (RN-V13..V16, V21).
 * Autoridade: plan/tecnico-relatorio-vendas.md §6.5 e §8.4 (T355-30..38).
 *
 * Contrato (migration D1 `20261007124000_relatorio_vendas_funcoes.sql`):
 *   vendas_itens_por_categoria(p_loja_id uuid, p_inicio timestamptz, p_fim timestamptz,
 *     p_tipo_entrega text default null, p_so_concluidos boolean default false)
 *   returns table (categoria_id uuid, categoria_nome text, item_nome text, quantidade int,
 *     valor_bruto numeric, categoria_quantidade int, categoria_valor_bruto numeric)
 *   valor_bruto da linha = espelho de totalDaLinha (opcional soma UMA vez por linha, regra 090);
 *   categoria = snapshot do item (RN-V14), NULL ("Sem categoria") por último;
 *   mesmo T1/T2 de vendas_por_dia (42501 'sem posse da loja').
 *
 * Por que é RED: a função e as colunas de snapshot não existem. Cada caso semeia a
 * própria loja dentro do `it`, para que cada um falhe isolado pelo motivo certo.
 * Dados fictícios.
 */

const DONO_X = "a3550000-0000-4000-8000-00000000003a";
const DONO_Y = "b3550000-0000-4000-8000-00000000003b";

const DIA_INI = "2026-10-06T03:00:00Z";
const DIA_FIM = "2026-10-07T03:00:00Z";
const EM = "2026-10-06T15:00:00Z";

const CAT_LANCHES = "c3550000-0000-4000-8000-000000000001";
const CAT_BEBIDAS = "c3550000-0000-4000-8000-000000000002";
const CAT_REFRI = "c3550000-0000-4000-8000-000000000003";

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

type LinhaItem = {
  categoria_id: string | null;
  categoria_nome: string | null;
  item_nome: string;
  quantidade: number;
  valor_bruto: number;
  categoria_quantidade: number;
  categoria_valor_bruto: number;
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

async function itens(
  t: TestDb,
  quem: string,
  loja: string,
  inicio = DIA_INI,
  fim = DIA_FIM,
  tipo: string | null = null,
  concluidos = false,
): Promise<LinhaItem[]> {
  const r = await como(t, quem, (db) =>
    db.query<LinhaItem>(
      `select * from public.vendas_itens_por_categoria(
         p_loja_id => $1::uuid, p_inicio => $2::timestamptz, p_fim => $3::timestamptz,
         p_tipo_entrega => $4::text, p_so_concluidos => $5::boolean)`,
      [loja, inicio, fim, tipo, concluidos],
    ),
  );
  return r.rows;
}

let seqDono = 0;
async function novaLoja(t: TestDb, slug: string, dono?: string): Promise<string> {
  const d = dono ?? `d3550000-0000-4000-8000-${String(100 + ++seqDono).padStart(12, "0")}`;
  await t.db.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`, [
    d,
    `${slug}@teste.local`,
  ]);
  const r = await t.asService((db) =>
    db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1, $2, 'Loja', true) returning id`,
      [d, slug],
    ),
  );
  return r.rows[0].id;
}

async function pedido(
  t: TestDb,
  loja: string,
  p: { subtotal: number; desconto?: number; status?: string; tipo?: "entrega" | "retirada"; em?: string; cliente?: string | null },
): Promise<string> {
  const desconto = p.desconto ?? 0;
  const r = await t.db.query<{ id: string }>(
    `insert into public.pedidos
       (loja_id, nome_cliente, telefone_cliente, subtotal, desconto, taxa_entrega, total,
        forma_pagamento, tipo_entrega, status, cliente_id, criado_em)
     values ($1, 'Cliente Teste', '(11) 90000-0000', $2, $3, 0, $4, 'pix', $5, $6, $7, $8::timestamptz)
     returning id`,
    [
      loja,
      p.subtotal,
      desconto,
      Math.max(0, p.subtotal - desconto),
      p.tipo ?? "retirada",
      p.status ?? "entregue",
      p.cliente ?? null,
      p.em ?? EM,
    ],
  );
  return r.rows[0].id;
}

type Item = {
  nome: string;
  preco: number;
  quantidade: number;
  cat?: { id: string; nome: string } | null;
  opcionais?: { nome: string; preco: number; quantidade: number }[];
};

/** Item com snapshot de categoria gravado direto (postgres) + opcionais. */
async function item(t: TestDb, pedidoId: string, i: Item): Promise<void> {
  const r = await t.db.query<{ id: string }>(
    `insert into public.itens_pedido
       (pedido_id, produto_id, nome, preco, quantidade, categoria_id_snapshot, categoria_nome_snapshot)
     values ($1, null, $2, $3, $4, $5, $6) returning id`,
    [pedidoId, i.nome, i.preco, i.quantidade, i.cat?.id ?? null, i.cat?.nome ?? null],
  );
  for (const o of i.opcionais ?? []) {
    await t.db.query(
      `insert into public.itens_pedido_opcionais (item_pedido_id, opcional_id, nome_snapshot, preco_snapshot, quantidade)
       values ($1, null, $2, $3, $4)`,
      [r.rows[0].id, o.nome, o.preco, o.quantidade],
    );
  }
}

const LANCHES = { id: CAT_LANCHES, nome: "Lanches" };
const BEBIDAS = { id: CAT_BEBIDAS, nome: "Bebidas" };
const REFRI = { id: CAT_REFRI, nome: "Refrigerantes" };

const X_BURGER: Item = {
  nome: "X-Burger",
  preco: 20,
  quantidade: 2,
  cat: LANCHES,
  opcionais: [{ nome: "Bacon", preco: 3, quantidade: 1 }],
};

describe("355 vendas_itens_por_categoria — RN-V13..V16 + paridade com calcularTotal (pglite)", () => {
  let t: TestDb;
  let lojaX: string;
  let lojaY: string;

  beforeAll(async () => {
    t = await createTestDb();
    lojaX = await novaLoja(t, "loja-x-355i", DONO_X);
    lojaY = await novaLoja(t, "loja-y-355i", DONO_Y);
    await t.asService((db) =>
      db.query(
        `select public.criar_perfil_cliente($1::uuid, 'Dono X Cliente', '(11) 90000-0000', '1990-05-10'::date, true, 'v-teste', $2::jsonb)`,
        [DONO_X, JSON.stringify(ENDERECO)],
      ),
    );
    // Lojista X comprou em Y (vetor RN-V21). Só colunas do schema atual.
    await pedido(t, lojaY, { subtotal: 40, cliente: DONO_X });
  });
  afterAll(async () => {
    await t.close();
  });

  it("T355-30 RN-V16: X-Burger 20 × 2 + bacon 3 × 1 → valor_bruto 43 (opcional não multiplica), quantidade 2", async () => {
    const loja = await novaLoja(t, "loja-30-355i");
    await item(t, await pedido(t, loja, { subtotal: 43 }), X_BURGER);
    const linhas = await itens(t, "service", loja);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ item_nome: "X-Burger", quantidade: 2, valor_bruto: 43 });
  });

  it("T355-31 RN-V16: desconto do pedido não é rateado — itens 43; vendas_por_dia bruto 43, líquido 33", async () => {
    const loja = await novaLoja(t, "loja-31-355i");
    await item(t, await pedido(t, loja, { subtotal: 43, desconto: 10 }), X_BURGER);
    const linhas = await itens(t, "service", loja);
    expect(linhas.map((l) => l.valor_bruto)).toEqual([43]);
    const dia = await t.asService((db) =>
      db.query<{ bruto: number; liquido: number }>(
        `select bruto, liquido from public.vendas_por_dia($1::uuid, $2::timestamptz, $3::timestamptz)`,
        [loja, DIA_INI, DIA_FIM],
      ),
    );
    expect(dia.rows).toEqual([{ bruto: 43, liquido: 33 }]);
  });

  const LINHAS_PARIDADE: (ItemCalculo & { nome: string; opcionaisNomeados: Item["opcionais"] })[] = [
    {
      nome: "Pastel",
      preco: 4.35,
      quantidade: 3,
      opcionais: [
        { preco: 0.1, quantidade: 3 },
        { preco: 1.15, quantidade: 7 },
      ],
      opcionaisNomeados: [
        { nome: "Op A", preco: 0.1, quantidade: 3 },
        { nome: "Op B", preco: 1.15, quantidade: 7 },
      ],
    },
    { nome: "Bala", preco: 0.1, quantidade: 3, opcionais: [], opcionaisNomeados: [] },
    {
      nome: "Pizza",
      preco: 19.99,
      quantidade: 7,
      opcionais: [{ preco: 2.5, quantidade: 2 }],
      opcionaisNomeados: [{ nome: "Borda", preco: 2.5, quantidade: 2 }],
    },
  ];

  async function semearParidade(loja: string, subtotal: number): Promise<void> {
    const ped = await pedido(t, loja, { subtotal });
    for (const l of LINHAS_PARIDADE) {
      await item(t, ped, { nome: l.nome, preco: l.preco, quantidade: l.quantidade, cat: LANCHES, opcionais: l.opcionaisNomeados });
    }
  }

  it("T355-32 paridade TS: valor_bruto de cada linha = totalDaLinha (calcularTotal.ts)", async () => {
    const loja = await novaLoja(t, "loja-32-355i");
    await semearParidade(loja, calcularSubtotal(LINHAS_PARIDADE));
    const linhas = await itens(t, "service", loja);
    const porNome = Object.fromEntries(linhas.map((l) => [l.item_nome, l.valor_bruto]));
    expect(Object.keys(porNome).sort()).toEqual(["Bala", "Pastel", "Pizza"]);
    for (const l of LINHAS_PARIDADE) {
      expect(porNome[l.nome], l.nome).toBe(
        totalDaLinha({ preco: l.preco, quantidade: l.quantidade, opcionais: l.opcionais }),
      );
    }
  });

  it("T355-33 Σ valor_bruto = bruto de vendas_por_dia quando subtotal = calcularSubtotal(itens)", async () => {
    const loja = await novaLoja(t, "loja-33-355i");
    const subtotal = calcularSubtotal(LINHAS_PARIDADE);
    await semearParidade(loja, subtotal);
    const r = await t.asService((db) =>
      db.query<{ itens: number; bruto: number }>(
        `select (select sum(valor_bruto) from public.vendas_itens_por_categoria($1::uuid, $2::timestamptz, $3::timestamptz)) as itens,
                (select sum(bruto) from public.vendas_por_dia($1::uuid, $2::timestamptz, $3::timestamptz)) as bruto`,
        [loja, DIA_INI, DIA_FIM],
      ),
    );
    expect(r.rows[0].bruto).toBe(subtotal);
    expect(r.rows[0].itens).toBe(r.rows[0].bruto);
  });

  it("T355-34 Sem categoria: snapshot NULL → categoria_id e categoria_nome NULL, por último", async () => {
    const loja = await novaLoja(t, "loja-34-355i");
    const ped = await pedido(t, loja, { subtotal: 100 });
    await item(t, ped, { nome: "Avulso", preco: 90, quantidade: 1, cat: null }); // maior valor, ainda assim por último
    await item(t, ped, { nome: "Coca", preco: 10, quantidade: 1, cat: BEBIDAS });
    const linhas = await itens(t, "service", loja);
    expect(linhas.map((l) => [l.categoria_id, l.categoria_nome, l.item_nome])).toEqual([
      [CAT_BEBIDAS, "Bebidas", "Coca"],
      [null, null, "Avulso"],
    ]);
  });

  it("T355-35 Coca congelada: março só 'Bebidas', abril só 'Refrigerantes'", async () => {
    const loja = await novaLoja(t, "loja-35-355i");
    await item(t, await pedido(t, loja, { subtotal: 6, em: "2026-03-10T15:00:00Z" }), {
      nome: "Coca",
      preco: 6,
      quantidade: 1,
      cat: BEBIDAS,
    });
    await item(t, await pedido(t, loja, { subtotal: 6, em: "2026-04-10T15:00:00Z" }), {
      nome: "Coca",
      preco: 6,
      quantidade: 1,
      cat: REFRI,
    });
    const marco = await itens(t, "service", loja, "2026-03-01T03:00:00Z", "2026-04-01T03:00:00Z");
    const abril = await itens(t, "service", loja, "2026-04-01T03:00:00Z", "2026-05-01T03:00:00Z");
    expect(marco.map((l) => [l.categoria_nome, l.item_nome])).toEqual([["Bebidas", "Coca"]]);
    expect(abril.map((l) => [l.categoria_nome, l.item_nome])).toEqual([["Refrigerantes", "Coca"]]);
  });

  it("T355-36 agregação por categoria: as duas linhas carregam a soma da categoria", async () => {
    const loja = await novaLoja(t, "loja-36-355i");
    const ped = await pedido(t, loja, { subtotal: 52 });
    await item(t, ped, { nome: "X-Burger", preco: 20, quantidade: 2, cat: LANCHES });
    await item(t, ped, { nome: "X-Salada", preco: 12, quantidade: 1, cat: LANCHES });
    const linhas = await itens(t, "service", loja);
    expect(linhas).toHaveLength(2);
    for (const l of linhas) {
      expect(l).toMatchObject({ categoria_quantidade: 3, categoria_valor_bruto: 52 });
    }
    expect(linhas.map((l) => [l.item_nome, l.quantidade, l.valor_bruto])).toEqual([
      ["X-Burger", 2, 40],
      ["X-Salada", 1, 12],
    ]);
  });

  it("T355-37 status e tipo: cancelado fora; so_concluidos e tipo_entrega filtram como vendas_por_dia", async () => {
    const loja = await novaLoja(t, "loja-37-355i");
    await item(t, await pedido(t, loja, { subtotal: 10, status: "cancelado" }), { nome: "Cancelado", preco: 10, quantidade: 1, cat: LANCHES });
    await item(t, await pedido(t, loja, { subtotal: 10, status: "em_preparo" }), { nome: "Em preparo", preco: 10, quantidade: 1, cat: LANCHES });
    await item(t, await pedido(t, loja, { subtotal: 10, status: "entregue", tipo: "retirada" }), { nome: "Retirada", preco: 10, quantidade: 1, cat: LANCHES });
    await item(t, await pedido(t, loja, { subtotal: 10, status: "entregue", tipo: "entrega" }), { nome: "Entrega", preco: 10, quantidade: 1, cat: LANCHES });

    const nomes = async (tipo: string | null, concluidos: boolean) =>
      (await itens(t, "service", loja, DIA_INI, DIA_FIM, tipo, concluidos)).map((l) => l.item_nome).sort();
    expect(await nomes(null, false)).toEqual(["Em preparo", "Entrega", "Retirada"]);
    expect(await nomes(null, true)).toEqual(["Entrega", "Retirada"]);
    expect(await nomes("entrega", false)).toEqual(["Entrega"]);
    expect(await nomes("retirada", true)).toEqual(["Retirada"]);
  });

  it("T355-38 RN-V21: lojista-cliente em loja alheia → 42501 sem posse da loja; anon → permission denied", async () => {
    esperarRecusa(await erroDe(itens(t, DONO_X, lojaY)), "42501", "sem posse da loja");
    esperarRecusa(await erroDe(itens(t, "anon", lojaX)), "42501", "permission denied for function");
  });
});
