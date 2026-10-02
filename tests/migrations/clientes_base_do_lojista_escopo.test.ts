import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 346 — base de clientes do lojista (camada banco).
 *
 * Autoridade: tasks/346-base-de-clientes-funcoes-e-lista.md §RED (D1) + §Respostas
 * do usuário (D9) · specs/cliente-base-do-lojista.md §Banco.
 *
 * Contrato sob teste (nasce em `supabase/migrations/<ts>_clientes_da_loja.sql`):
 *  - `public.clientes_da_loja(p_mes smallint default null, p_limite int default 50,
 *      p_apos_ultimo timestamptz default null, p_apos_id uuid default null)` — keyset (D10):
 *      devolve `(ultimo_pedido_em, cliente_id) < cursor` em ordem desc; cursor parcial → 22023; sem p_offset.
 *  - `public.cliente_da_loja(p_cliente_id uuid)`
 *  - SECURITY DEFINER, loja via `lojas.dono_id = auth.uid()` (sem parâmetro de loja),
 *    RETURNS TABLE fechado = allowlist de 10 colunas (8 do spec + D9:
 *    `total_cancelados`, `ultimo_pedido_status`); `total_pedidos` exclui cancelado;
 *    `ultimo_pedido_em`/`ultimo_pedido_status` = pedido mais recente de QUALQUER status.
 *  - EXECUTE revogado de public/anon, concedido a authenticated.
 *
 * Por que é RED: as funções não existem. O seed (beforeAll) só usa tabelas que já
 * existem, então cada caso falha isoladamente (42883 / asserção), sem erro de coleta.
 */

const LX = "a3460000-0000-4000-8000-00000000000a"; // lojista X
const LY = "b3460000-0000-4000-8000-00000000000b"; // lojista Y
const C_Y = "c3460000-0000-4000-8000-000000000001"; // pediu só em Y
const C_OK = "c3460000-0000-4000-8000-000000000002"; // 2 válidos + 1 cancelado em X
const C_CANC = "c3460000-0000-4000-8000-000000000003"; // só cancelados em X (2)
const C_SEM = "c3460000-0000-4000-8000-000000000004"; // perfil, nenhum pedido
const C_ANON = "c3460000-0000-4000-8000-000000000005"; // pediu em X, depois anonimizado
const SOCLI = "c3460000-0000-4000-8000-000000000006"; // só-cliente sem loja (pediu em X)

const ALLOWLIST = [
  "aceita_marketing",
  "cliente_id",
  "dia_aniversario",
  "mes_aniversario",
  "nome",
  "telefone",
  "total_cancelados",
  "total_pedidos",
  "ultimo_pedido_em",
  "ultimo_pedido_status",
];

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

type Linha = Record<string, unknown>;

async function criarUsuario(t: TestDb, id: string): Promise<void> {
  await t.db.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`, [
    id,
    `u-${id}@teste.local`,
  ]);
}

async function criarPerfil(t: TestDb, id: string, nome = "Cliente Teste"): Promise<void> {
  await t.asService((db) =>
    db.query(
      `select public.criar_perfil_cliente($1::uuid, $2, '(11) 90000-0000', '1990-05-10'::date, true, 'v-teste', $3::jsonb)`,
      [id, nome, JSON.stringify(ENDERECO)],
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

async function pedido(
  t: TestDb,
  loja: string,
  clienteId: string | null,
  status: string,
  criadoEm: string,
): Promise<void> {
  await t.db.query(
    `insert into public.pedidos
       (loja_id, nome_cliente, telefone_cliente, subtotal, desconto, taxa_entrega, total,
        forma_pagamento, tipo_entrega, status, cliente_id, criado_em)
     values ($1, 'Cliente Pedido', '(11) 90000-0000', 50, 0, 5, 55, 'pix', 'entrega', $2, $3, $4::timestamptz)`,
    [loja, status, clienteId, criadoEm],
  );
}

async function erroDe(p: Promise<unknown>): Promise<{ code?: string; message: string } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { code?: string; message: string };
  }
}

const lista = (t: TestDb, quem: string, args = "") =>
  t.asUser(quem, (db) => db.query<Linha>(`select * from public.clientes_da_loja(${args})`));
const detalhe = (t: TestDb, quem: string, cliente: string) =>
  t.asUser(quem, (db) => db.query<Linha>(`select * from public.cliente_da_loja($1::uuid)`, [cliente]));

async function semear(t: TestDb): Promise<{ lojaX: string; lojaY: string }> {
  for (const id of [LX, LY, C_Y, C_OK, C_CANC, C_SEM, C_ANON, SOCLI]) await criarUsuario(t, id);
  for (const id of [C_Y, C_OK, C_CANC, C_SEM, C_ANON, SOCLI]) await criarPerfil(t, id);
  const lojaX = await criarLoja(t, LX, "loja-x-346");
  const lojaY = await criarLoja(t, LY, "loja-y-346");

  await pedido(t, lojaY, C_Y, "entregue", "2026-09-01T12:00:00Z");
  await pedido(t, lojaX, C_OK, "entregue", "2026-09-01T12:00:00Z");
  await pedido(t, lojaX, C_OK, "confirmado", "2026-09-10T12:00:00Z");
  await pedido(t, lojaX, C_OK, "cancelado", "2026-09-20T12:00:00Z"); // mais recente é cancelado
  await pedido(t, lojaX, C_CANC, "cancelado", "2026-09-05T12:00:00Z");
  await pedido(t, lojaX, C_CANC, "cancelado", "2026-09-15T12:00:00Z");
  await pedido(t, lojaX, C_ANON, "entregue", "2026-09-02T12:00:00Z");
  await pedido(t, lojaX, SOCLI, "entregue", "2026-09-03T12:00:00Z");
  await pedido(t, lojaX, null, "entregue", "2026-09-04T12:00:00Z"); // convidado

  // Anonimização (exclusão de conta) zera pedidos.cliente_id do C_ANON.
  await t.asService((db) => db.query(`select public.anonimizar_cliente($1)`, [C_ANON]));
  return { lojaX, lojaY };
}

describe("346 [D1] clientes_da_loja / cliente_da_loja — escopo, allowlist, agregados", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await semear(t);
  });
  afterAll(async () => t?.close());

  it("[0] as duas funções existem com a assinatura do spec", async () => {
    const r = await t.db.query<{ a: string | null; b: string | null }>(
      `select to_regprocedure('public.clientes_da_loja(smallint,integer,timestamp with time zone,uuid)')::text as a,
              to_regprocedure('public.cliente_da_loja(uuid)')::text as b`,
    );
    expect(r.rows[0].a).not.toBeNull();
    expect(r.rows[0].b).not.toBeNull();
  });

  it("[1a] lojista X não vê cliente que só pediu em Y (lista)", async () => {
    const r = await lista(t, LX);
    expect(r.rows.map((l) => l.cliente_id)).not.toContain(C_Y);
  });

  it("[1b] lojista X: cliente_da_loja(<cliente de Y>) → 0 linhas", async () => {
    const r = await detalhe(t, LX, C_Y);
    expect(r.rows).toHaveLength(0);
  });

  it("[1c] lojista Y vê o próprio cliente e nenhum cliente de X", async () => {
    const r = await lista(t, LY);
    expect(r.rows.map((l) => l.cliente_id)).toEqual([C_Y]);
  });

  it("[1d] lista de X = exatamente os clientes com pedido em X, ordem ultimo_pedido_em DESC", async () => {
    const r = await lista(t, LX);
    // C_OK 09-20, C_CANC 09-15, SOCLI 09-03 (convidado, C_SEM, C_ANON e C_Y fora)
    expect(r.rows.map((l) => l.cliente_id)).toEqual([C_OK, C_CANC, SOCLI]);
  });

  it("[2] pedido de convidado (cliente_id null) não gera linha", async () => {
    const r = await lista(t, LX);
    expect(r.rows.some((l) => l.cliente_id === null)).toBe(false);
    expect(r.rows).toHaveLength(3);
  });

  it("[3a] colunas da lista = allowlist exata (sem email/ano/data_nascimento)", async () => {
    const r = await lista(t, LX);
    const cols = r.fields.map((f) => f.name).sort();
    expect(cols).toEqual(ALLOWLIST);
    for (const proibida of ["email", "data_nascimento", "ano_nascimento"]) expect(cols).not.toContain(proibida);
  });

  it("[3b] colunas do detalhe = mesma allowlist exata", async () => {
    const r = await detalhe(t, LX, C_OK);
    expect(r.fields.map((f) => f.name).sort()).toEqual(ALLOWLIST);
  });

  it("[3c] dia/mês do aniversário sem ano, marketing exposto", async () => {
    const r = await detalhe(t, LX, C_OK);
    expect(r.rows).toHaveLength(1);
    expect(Number(r.rows[0].dia_aniversario)).toBe(10);
    expect(Number(r.rows[0].mes_aniversario)).toBe(5);
    expect(r.rows[0].aceita_marketing).toBe(true);
    expect(JSON.stringify(r.rows[0])).not.toContain("1990");
  });

  for (const [nome, sql, params] of [
    ["clientes_da_loja", `select * from public.clientes_da_loja()`, []],
    ["cliente_da_loja", `select * from public.cliente_da_loja($1::uuid)`, [C_OK]],
  ] as const) {
    it(`[4] asAnon → ${nome}: erro de permissão (42501) ou 0 linhas`, async () => {
      let linhas = -1;
      const e = await erroDe(
        t.asAnon(async (db) => {
          linhas = (await db.query(sql, [...params])).rows.length;
        }),
      );
      if (e) expect(e.code).toBe("42501");
      else expect(linhas).toBe(0);
    });

    it(`[4b] EXECUTE de ${nome}: anon false, authenticated true`, async () => {
      const assin = nome === "clientes_da_loja" ? "public.clientes_da_loja(smallint,integer,timestamp with time zone,uuid)" : "public.cliente_da_loja(uuid)";
      const r = await t.db.query<{ anon: boolean; auth: boolean }>(
        `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') as auth`,
        [assin],
      );
      expect(r.rows[0]).toEqual({ anon: false, auth: true });
    });
  }

  it("[5a] usuário só-cliente (sem loja) → clientes_da_loja 0 linhas", async () => {
    const r = await lista(t, SOCLI);
    expect(r.rows).toHaveLength(0);
  });

  it("[5b] usuário só-cliente (sem loja) → cliente_da_loja(si mesmo) 0 linhas", async () => {
    const r = await detalhe(t, SOCLI, SOCLI);
    expect(r.rows).toHaveLength(0);
  });

  it("[6] cliente anonimizado (cliente_id zerado) some da lista e do detalhe", async () => {
    const l = await lista(t, LX);
    expect(l.rows.map((x) => x.cliente_id)).not.toContain(C_ANON);
    const d = await detalhe(t, LX, C_ANON);
    expect(d.rows).toHaveLength(0);
  });

  it("[7] from('clientes') como lojista continua 0 linhas (RLS não ampliada)", async () => {
    // guarda: só tem sentido se as funções existem (senão é verde por acidente)
    const f = await t.db.query<{ a: string | null }>(
      `select to_regprocedure('public.clientes_da_loja(smallint,integer,timestamp with time zone,uuid)')::text as a`,
    );
    expect(f.rows[0].a).not.toBeNull();
    const r = await t.asUser(LX, (db) => db.query(`select id from public.clientes`));
    expect(r.rows).toHaveLength(0);
  });

  it("[8a] total_pedidos exclui cancelados; total_cancelados conta; último = mais recente de qualquer status", async () => {
    const r = await detalhe(t, LX, C_OK);
    expect(r.rows).toHaveLength(1);
    expect(Number(r.rows[0].total_pedidos)).toBe(2);
    expect(Number(r.rows[0].total_cancelados)).toBe(1);
    expect(new Date(r.rows[0].ultimo_pedido_em as string).toISOString()).toBe("2026-09-20T12:00:00.000Z");
    expect(r.rows[0].ultimo_pedido_status).toBe("cancelado");
  });

  it("[8b] (D9) cliente só com cancelados permanece: total_pedidos=0, total_cancelados=2, data e status cancelado", async () => {
    const r = await detalhe(t, LX, C_CANC);
    expect(r.rows).toHaveLength(1);
    expect(Number(r.rows[0].total_pedidos)).toBe(0);
    expect(Number(r.rows[0].total_cancelados)).toBe(2);
    expect(new Date(r.rows[0].ultimo_pedido_em as string).toISOString()).toBe("2026-09-15T12:00:00.000Z");
    expect(r.rows[0].ultimo_pedido_status).toBe("cancelado");
  });

  it("[8c] cliente com pedido válido mais recente → status desse pedido", async () => {
    const r = await detalhe(t, LX, SOCLI);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].ultimo_pedido_status).toBe("entregue");
    expect(Number(r.rows[0].total_cancelados)).toBe(0);
  });

  it("[8d] (D9) cliente sem pedido algum não entra na base (lista e detalhe)", async () => {
    const l = await lista(t, LX);
    expect(l.rows.map((x) => x.cliente_id)).not.toContain(C_SEM);
    const d = await detalhe(t, LX, C_SEM);
    expect(d.rows).toHaveLength(0);
  });

  it("[9a] p_mes = 13 → erro 22023", async () => {
    const e = await erroDe(lista(t, LX, "p_mes => 13::smallint"));
    expect(e?.code).toBe("22023");
  });

  it("[9b] p_mes = 0 → erro 22023", async () => {
    const e = await erroDe(lista(t, LX, "p_mes => 0::smallint"));
    expect(e?.code).toBe("22023");
  });

  it("[9c] p_mes = 5 filtra aniversariantes de maio (todos os seeds nasceram em maio)", async () => {
    const maio = await lista(t, LX, "p_mes => 5::smallint");
    expect(maio.rows).toHaveLength(3);
    const junho = await lista(t, LX, "p_mes => 6::smallint");
    expect(junho.rows).toHaveLength(0);
  });

  it("[9d] (D10) p_offset não existe mais (nem a assinatura antiga)", async () => {
    const e = await erroDe(lista(t, LX, "p_limite => 50, p_offset => 0"));
    expect(e?.code).toBe("42883");
    const r = await t.db.query<{ a: string | null }>(
      `select to_regprocedure('public.clientes_da_loja(smallint,integer,integer)')::text as a`,
    );
    expect(r.rows[0].a).toBeNull();
  });

  it("[9e] (D10) keyset: cursor do 1º devolve o 2º da ordem", async () => {
    const r = await lista(t, LX, "p_limite => 1, p_apos_ultimo => '2026-09-20T12:00:00Z'::timestamptz, p_apos_id => '" + C_OK + "'::uuid");
    expect(r.rows.map((x) => x.cliente_id)).toEqual([C_CANC]);
  });

  it("[9h] (D10) cursor só com p_apos_ultimo → erro 22023", async () => {
    const e = await erroDe(lista(t, LX, "p_apos_ultimo => '2026-09-20T12:00:00Z'::timestamptz"));
    expect(e?.code).toBe("22023");
  });

  it("[9i] (D10) cursor só com p_apos_id → erro 22023", async () => {
    const e = await erroDe(lista(t, LX, "p_apos_id => '" + C_OK + "'::uuid"));
    expect(e?.code).toBe("22023");
  });
});

describe("346 [D1-9/D10] teto 100 e paginação keyset", () => {
  let t: TestDb;
  const DONO = "a3461000-0000-4000-8000-00000000000a";
  beforeAll(async () => {
    t = await createTestDb();
    await criarUsuario(t, DONO);
    const loja = await criarLoja(t, DONO, "loja-limite-346");
    for (let i = 0; i < 101; i++) {
      const id = `d3461000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      await criarUsuario(t, id);
      await criarPerfil(t, id, `Cliente ${i}`);
      // 3 timestamps distintos com muitos empates → desempate por cliente_id é obrigatório
      await pedido(t, loja, id, "entregue", `2026-09-0${(i % 3) + 1}T12:00:00Z`);
    }
  }, 120_000);
  afterAll(async () => t?.close());

  it("[9f] p_limite => 500 devolve 100 linhas (101 existem)", async () => {
    const r = await lista(t, DONO, "p_limite => 500");
    expect(r.rows).toHaveLength(100);
  });

  it("[9g] default (sem p_limite) devolve 50", async () => {
    const r = await lista(t, DONO);
    expect(r.rows).toHaveLength(50);
  });

  type Cur = { ultimo_pedido_em: string | Date; cliente_id: string };
  const cursor = (c: Cur) =>
    `p_apos_ultimo => '${new Date(c.ultimo_pedido_em).toISOString()}'::timestamptz, p_apos_id => '${c.cliente_id}'::uuid`;
  const esperado = () => {
    const ids = Array.from({ length: 101 }, (_, i) => ({
      id: `d3461000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      dia: (i % 3) + 1,
    }));
    return ids
      .sort((a, b) => b.dia - a.dia || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .map((x) => x.id);
  };

  it("[10a] (D10) 1ª página sem cursor = os 50 primeiros da ordem (ultimo desc, cliente_id desc)", async () => {
    const r = await lista(t, DONO, "p_limite => 50, p_apos_ultimo => null, p_apos_id => null");
    expect(r.rows.map((x) => x.cliente_id)).toEqual(esperado().slice(0, 50));
  });

  it("[10b] (D10) páginas encadeadas por cursor: sem repetição nem buraco, concatenação = lista completa", async () => {
    const todos: string[] = [];
    let args = "p_limite => 50";
    for (let pag = 0; pag < 5; pag++) {
      const r = await lista(t, DONO, args);
      todos.push(...r.rows.map((x) => x.cliente_id as string));
      if (r.rows.length < 50) break;
      args = "p_limite => 50, " + cursor(r.rows[r.rows.length - 1] as unknown as Cur);
    }
    expect(new Set(todos).size).toBe(todos.length);
    expect(todos).toEqual(esperado());
  });

  it("[10c] (D10) empate de ultimo_pedido_em desempatado por cliente_id (cursor no meio do empate)", async () => {
    const ord = esperado();
    // ord[0..33] são do dia 03; cursor no 10º do empate deve devolver o 11º em diante
    const r = await lista(t, DONO, `p_limite => 3, p_apos_ultimo => '2026-09-03T12:00:00Z'::timestamptz, p_apos_id => '${ord[9]}'::uuid`);
    expect(r.rows.map((x) => x.cliente_id)).toEqual(ord.slice(10, 13));
  });
});
