import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 335 — fatia B2 do plano (exclusão de conta, camada banco).
 *
 * Autoridade: tasks/335-cliente-schema-rls-anonimizacao.md §RED (anonimizar_cliente.test.ts) ·
 * specs/cliente-identidade.md §Funções novas.
 *
 * Contrato sob teste (`supabase/migrations/<ts>_clientes.sql`):
 *  - `adicionar_papel_cliente(uuid)`, `criar_perfil_cliente(uuid,text,text,date,boolean,text,jsonb)`,
 *    `anonimizar_cliente(uuid)`, `anonimizar_clientes_inativos()`: EXECUTE só service_role;
 *  - `anonimizar_cliente` apaga `clientes` (cascade endereços), não toca papeis_usuario/lojas/auth.users;
 *  - `anonimizar_clientes_inativos` remove só perfis com ultimo_acesso_em < now() - 24 months.
 *
 * Por que é RED: a migration não existe; `novoDb()` falha com `[RED 335]`.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function exigirMigracao(): void {
  const achados = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith("_clientes.sql"));
  if (achados.length !== 1) {
    throw new Error(
      `[RED 335] esperada exatamente 1 migration \`supabase/migrations/*_clientes.sql\`; ` +
        `encontradas ${achados.length} (P12 ainda não escreveu a migration).`,
    );
  }
}

async function novoDb(): Promise<TestDb> {
  exigirMigracao();
  return createTestDb();
}

const A = "a3351000-0000-4000-8000-00000000000a"; // lojista + cliente
const B = "b3351000-0000-4000-8000-00000000000b"; // só-cliente
const VELHO = "c3351000-0000-4000-8000-00000000000c"; // inativo há 25 meses
const LIMITE = "d3351000-0000-4000-8000-00000000000d"; // inativo há 23 meses

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

const FUNCOES = [
  "public.adicionar_papel_cliente(uuid)",
  "public.criar_perfil_cliente(uuid,text,text,date,boolean,text,jsonb)",
  "public.anonimizar_cliente(uuid)",
  "public.anonimizar_clientes_inativos()",
] as const;

async function criarUsuarios(t: TestDb, ids: string[]): Promise<void> {
  for (const id of ids) {
    await t.db.query(`insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`, [
      id,
      `u-${id}@teste.local`,
    ]);
  }
}

function criarPerfil(t: TestDb, id: string) {
  return t.asService((db) =>
    db.query(
      `select public.criar_perfil_cliente($1::uuid, 'Cliente Teste', '(11) 90000-0000', '1990-05-10'::date, false, 'v-teste', $2::jsonb)`,
      [id, JSON.stringify(ENDERECO)],
    ),
  );
}

async function n(t: TestDb, sql: string, params: unknown[]): Promise<number> {
  const r = await t.db.query<{ n: number }>(sql, params);
  return r.rows[0].n;
}

const perfis = (t: TestDb, id: string) =>
  n(t, `select count(*)::int as n from public.clientes where id = $1`, [id]);
const enderecos = (t: TestDb, id: string) =>
  n(t, `select count(*)::int as n from public.clientes_enderecos where cliente_id = $1`, [id]);

async function papeis(t: TestDb, id: string): Promise<string[]> {
  const r = await t.db.query<{ papel: string }>(
    `select papel from public.papeis_usuario where usuario_id = $1 order by papel`,
    [id],
  );
  return r.rows.map((x) => x.papel);
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
// 1. ACL das quatro funções
// ===========================================================================
describe("335 [B2-1] funções de perfil/anonimização — só service_role", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await novoDb();
    await criarUsuarios(t, [B]);
    await criarPerfil(t, B);
  });
  afterAll(async () => t?.close());

  for (const fn of FUNCOES) {
    for (const role of ["anon", "authenticated", "public"] as const) {
      it(`[1a] has_function_privilege('${role}', ${fn}, EXECUTE) = false`, async () => {
        const sql =
          role === "public"
            ? `select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid = $1::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') = false as ok`
            : `select has_function_privilege('${role}', $1, 'EXECUTE') = false as ok`;
        const r = await t.db.query<{ ok: boolean }>(sql, [fn]);
        expect(r.rows[0].ok).toBe(true);
      });
    }
    it(`[1b] has_function_privilege('service_role', ${fn}, EXECUTE) = true`, async () => {
      const r = await t.db.query<{ ok: boolean }>(`select has_function_privilege('service_role', $1, 'EXECUTE') as ok`, [fn]);
      expect(r.rows[0].ok).toBe(true);
    });
  }

  it("[1c] asUser(B) chamando anonimizar_cliente(B) → 42501, perfil intacto", async () => {
    const e = await erroDe(t.asUser(B, (db) => db.query(`select public.anonimizar_cliente($1)`, [B])));
    expect(e?.code).toBe("42501");
    expect(await perfis(t, B)).toBe(1);
  });

  it("[1d] asAnon chamando anonimizar_cliente(B) → 42501, perfil intacto", async () => {
    const e = await erroDe(t.asAnon((db) => db.query(`select public.anonimizar_cliente($1)`, [B])));
    expect(e?.code).toBe("42501");
    expect(await perfis(t, B)).toBe(1);
  });

  it("[1e] asUser(B) anonimizar_clientes_inativos() / adicionar_papel_cliente / criar_perfil_cliente → 42501", async () => {
    for (const sql of [
      `select public.anonimizar_clientes_inativos()`,
      `select public.adicionar_papel_cliente('${B}'::uuid)`,
      `select public.criar_perfil_cliente('${B}'::uuid, 'X', '(11) 90000-0000', '1990-01-01'::date, false, 'v', '{}'::jsonb)`,
    ]) {
      const e = await erroDe(t.asUser(B, (db) => db.query(sql)));
      expect(e?.code, sql).toBe("42501");
    }
  });
});

// ===========================================================================
// 2. anonimizar_cliente — efeito
// ===========================================================================
describe("335 [B2-2] anonimizar_cliente — apaga só o perfil", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await novoDb();
    await criarUsuarios(t, [A, B]);
    await t.asService((db) =>
      db.query(`insert into public.lojas (dono_id, slug, nome) values ($1, 'p335-anon-a', 'X')`, [A]),
    );
    await criarPerfil(t, A);
    await criarPerfil(t, B);
  });
  afterAll(async () => t?.close());

  it("[2a] pré-condição: A {cliente, lojista} com loja; B {cliente}", async () => {
    expect(await papeis(t, A)).toEqual(["cliente", "lojista"]);
    expect(await papeis(t, B)).toEqual(["cliente"]);
  });

  it("[2b] anonimizar_cliente(A) → 0 perfil/endereços; papéis, loja e auth.users intactos; B intacto", async () => {
    await t.asService((db) => db.query(`select public.anonimizar_cliente($1)`, [A]));
    expect(await perfis(t, A)).toBe(0);
    expect(await enderecos(t, A)).toBe(0);
    expect(await papeis(t, A)).toEqual(["cliente", "lojista"]);
    expect(await n(t, `select count(*)::int as n from public.lojas where dono_id = $1`, [A])).toBe(1);
    expect(await n(t, `select count(*)::int as n from auth.users where id = $1`, [A])).toBe(1);
    expect(await perfis(t, B)).toBe(1);
    expect(await enderecos(t, B)).toBe(1);
  });

  it("[2c] anonimizar_cliente(B) só-cliente → perfil some, papel {cliente} e auth.users ficam", async () => {
    await t.asService((db) => db.query(`select public.anonimizar_cliente($1)`, [B]));
    expect(await perfis(t, B)).toBe(0);
    expect(await enderecos(t, B)).toBe(0);
    expect(await papeis(t, B)).toEqual(["cliente"]);
    expect(await n(t, `select count(*)::int as n from auth.users where id = $1`, [B])).toBe(1);
  });
});

// ===========================================================================
// 3. anonimizar_clientes_inativos — 24 meses
// ===========================================================================
describe("335 [B2-3] anonimizar_clientes_inativos — corte de 24 meses", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await novoDb();
    await criarUsuarios(t, [VELHO, LIMITE, B]);
    await criarPerfil(t, VELHO);
    await criarPerfil(t, LIMITE);
    await criarPerfil(t, B);
    // Setup como superuser (fora do grant de coluna): tempos relativos ao now() do banco.
    await t.db.query(`update public.clientes set ultimo_acesso_em = now() - interval '25 months' where id = $1`, [VELHO]);
    await t.db.query(`update public.clientes set ultimo_acesso_em = now() - interval '23 months' where id = $1`, [LIMITE]);
  });
  afterAll(async () => t?.close());

  it("[3a] remove só o perfil inativo há >24 meses; os demais ficam", async () => {
    await t.asService((db) => db.query(`select public.anonimizar_clientes_inativos()`));
    expect(await perfis(t, VELHO)).toBe(0);
    expect(await enderecos(t, VELHO)).toBe(0);
    expect(await perfis(t, LIMITE)).toBe(1);
    expect(await perfis(t, B)).toBe(1);
    expect(await papeis(t, VELHO)).toEqual(["cliente"]);
    expect(await n(t, `select count(*)::int as n from auth.users where id = $1`, [VELHO])).toBe(1);
  });
});

// ===========================================================================
// ===========================================================================
// Marco C — issue 341, fatia C4 (P27). SÓ ADIÇÃO: nenhum caso acima foi tocado.
//
// Autoridade: tasks/341 §RED C4 · specs/cliente-vinculo-pedido.md
// §"anonimizar_cliente(p_usuario uuid) — extensão" e §"expurgar_pedidos_antigos()" ·
// RN-C13..C16 · decisões 3, 4 e 16.
//
// Contrato: `anonimizar_cliente` (1) recusa com `pedido_em_aberto` se houver pedido do
// cliente fora de entregue/cancelado; (2) anonimiza os pedidos (nome 'Cliente removido';
// telefone, endereço, observações e cliente_id null; itens_pedido.observacao null; valores,
// status, itens, cupom_codigo intactos); (3) apaga o perfil. `anonimizar_clientes_inativos`
// pula quem tem pedido em aberto. `expurgar_pedidos_antigos()` apaga pedido final > 5 anos
// (cliente OU convidado), retorna a quantidade, EXECUTE só service_role.
//
// Por que é RED: exige `*_pedidos_cliente_id.sql` (coluna cliente_id) → `[RED 341]`.
// ===========================================================================

function exigirMigracaoC(sufixo: string): void {
  const achados = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(sufixo));
  if (achados.length !== 1) {
    throw new Error(
      `[RED 341] esperada exatamente 1 migration \`supabase/migrations/*${sufixo}\`; ` +
        `encontradas ${achados.length} (P25 ainda não escreveu a migration).`,
    );
  }
}

async function novoDbC(): Promise<TestDb> {
  exigirMigracao();
  exigirMigracaoC("_pedidos_cliente_id.sql");
  return createTestDb();
}

const DONO_C = "d3414000-0000-4000-8000-0000000000d1";
const CLI_FIM = "c3414000-0000-4000-8000-0000000000f1"; // só pedidos finais
const CLI_ABERTO = "c3414000-0000-4000-8000-0000000000a1"; // tem pedido em preparo
const INATIVO_FIM = "c3414000-0000-4000-8000-0000000000e1"; // inativo, só finais
const INATIVO_ABERTO = "c3414000-0000-4000-8000-0000000000e2"; // inativo, com pedido em aberto

const TEL_FIM = "(11) 90000-0011";

type LinhaPedido = {
  nome_cliente: string;
  telefone_cliente: string | null;
  endereco_entrega: unknown;
  observacoes: string | null;
  cliente_id: string | null;
  subtotal: number;
  desconto: number;
  taxa_entrega: number | null;
  total: number;
  status: string;
  cupom_codigo: string | null;
  forma_pagamento: string;
  criado_em: string;
};

async function lojaC(t: TestDb, slug: string): Promise<string> {
  const r = await t.asService((db) =>
    db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1, $2, 'Loja C4', true) returning id`,
      [DONO_C, slug],
    ),
  );
  return r.rows[0].id;
}

/** Pedido com PII + 2 itens (um com observação), semeado como superuser. */
async function pedidoC(
  t: TestDb,
  loja: string,
  clienteId: string | null,
  status: string,
  telefone: string | null = TEL_FIM,
): Promise<string> {
  const r = await t.db.query<{ id: string }>(
    `insert into public.pedidos
       (loja_id, nome_cliente, telefone_cliente, endereco_entrega, observacoes,
        subtotal, desconto, taxa_entrega, total, forma_pagamento, tipo_entrega, status, cupom_codigo, cliente_id)
     values ($1, 'Fulana Ficticia', $2, '{"cep":"01000-000","rua":"Rua X","numero":"1","bairro":"Centro"}'::jsonb,
             'portão azul, falar com Fulana', 60, 5, 7, 62, 'pix', 'entrega', $3, 'PROMO5', $4)
     returning id`,
    [loja, telefone, status, clienteId],
  );
  const id = r.rows[0].id;
  await t.db.query(
    `insert into public.itens_pedido (pedido_id, nome, preco, quantidade, observacao)
     values ($1, 'Pizza', 25, 2, 'sem cebola para a Fulana'), ($1, 'Refri', 10, 1, null)`,
    [id],
  );
  return id;
}

async function linhaC(t: TestDb, id: string): Promise<LinhaPedido | undefined> {
  const r = await t.db.query<LinhaPedido>(
    `select nome_cliente, telefone_cliente, endereco_entrega, observacoes, cliente_id, subtotal, desconto,
            taxa_entrega, total, status, cupom_codigo, forma_pagamento, criado_em
       from public.pedidos where id = $1`,
    [id],
  );
  return r.rows[0];
}

async function itensC(t: TestDb, id: string): Promise<{ nome: string; preco: number; quantidade: number; observacao: string | null }[]> {
  const r = await t.db.query<{ nome: string; preco: number; quantidade: number; observacao: string | null }>(
    `select nome, preco, quantidade, observacao from public.itens_pedido where pedido_id = $1 order by nome`,
    [id],
  );
  return r.rows;
}

// ---------------------------------------------------------------------------
describe("341 [C4-1] anonimizar_cliente anonimiza os pedidos e mantém valores (decisão 3, RN-C15)", () => {
  let t: TestDb;
  let loja: string;
  let pEntregue: string;
  let pCancelado: string;
  let pConvidado: string;
  let antes: LinhaPedido;

  beforeAll(async () => {
    t = await novoDbC();
    await criarUsuarios(t, [DONO_C, CLI_FIM]);
    loja = await lojaC(t, "p341-c4-anon");
    await criarPerfil(t, CLI_FIM);
    pEntregue = await pedidoC(t, loja, CLI_FIM, "entregue");
    pCancelado = await pedidoC(t, loja, CLI_FIM, "cancelado");
    pConvidado = await pedidoC(t, loja, null, "entregue"); // mesmo telefone, sem vínculo
    antes = (await linhaC(t, pEntregue))!;
    await t.asService((db) => db.query(`select public.anonimizar_cliente($1)`, [CLI_FIM]));
  });
  afterAll(async () => t?.close());

  it("[C4-1a] PII do pedido apagada: nome 'Cliente removido'; telefone, endereço, observações e cliente_id null", async () => {
    for (const id of [pEntregue, pCancelado]) {
      const l = (await linhaC(t, id))!;
      expect(l.nome_cliente).toBe("Cliente removido");
      expect(l.telefone_cliente).toBeNull();
      expect(l.endereco_entrega).toBeNull();
      expect(l.observacoes).toBeNull();
      expect(l.cliente_id).toBeNull();
    }
  });

  it("[C4-1b] valores, status, cupom_codigo, forma_pagamento e criado_em intactos (faturamento não muda)", async () => {
    const l = (await linhaC(t, pEntregue))!;
    expect({
      subtotal: l.subtotal,
      desconto: l.desconto,
      taxa_entrega: l.taxa_entrega,
      total: l.total,
      status: l.status,
      cupom_codigo: l.cupom_codigo,
      forma_pagamento: l.forma_pagamento,
      criado_em: l.criado_em,
    }).toEqual({
      subtotal: antes.subtotal,
      desconto: antes.desconto,
      taxa_entrega: antes.taxa_entrega,
      total: antes.total,
      status: "entregue",
      cupom_codigo: "PROMO5",
      forma_pagamento: "pix",
      criado_em: antes.criado_em,
    });
  });

  it("[C4-1c] itens_pedido intactos (nome, preço, quantidade) e observacao do item zerada", async () => {
    expect(await itensC(t, pEntregue)).toEqual([
      { nome: "Pizza", preco: 25, quantidade: 2, observacao: null },
      { nome: "Refri", preco: 10, quantidade: 1, observacao: null },
    ]);
  });

  it("[C4-1d] perfil apagado (comportamento do Marco B preservado)", async () => {
    expect(await perfis(t, CLI_FIM)).toBe(0);
  });

  it("[C4-1e] pedido de convidado com o mesmo telefone NÃO é tocado (decisão 20)", async () => {
    const l = (await linhaC(t, pConvidado))!;
    expect(l.nome_cliente).toBe("Fulana Ficticia");
    expect(l.telefone_cliente).toBe(TEL_FIM);
    expect(l.observacoes).toBe("portão azul, falar com Fulana");
    expect((await itensC(t, pConvidado))[0].observacao).toBe("sem cebola para a Fulana");
  });
});

// ---------------------------------------------------------------------------
describe("341 [C4-2] anonimizar_cliente com pedido em aberto → pedido_em_aberto (decisão 16, RN-C14)", () => {
  let t: TestDb;
  let pAberto: string;
  let pFinal: string;

  beforeAll(async () => {
    t = await novoDbC();
    await criarUsuarios(t, [DONO_C, CLI_ABERTO]);
    const loja = await lojaC(t, "p341-c4-aberto");
    await criarPerfil(t, CLI_ABERTO);
    pFinal = await pedidoC(t, loja, CLI_ABERTO, "entregue");
    pAberto = await pedidoC(t, loja, CLI_ABERTO, "em_preparo");
  });
  afterAll(async () => t?.close());

  it("[C4-2a] recusa com exceção contendo 'pedido_em_aberto'", async () => {
    const e = await erroDe(t.asService((db) => db.query(`select public.anonimizar_cliente($1)`, [CLI_ABERTO])));
    expect(e?.message ?? "").toContain("pedido_em_aberto");
  });

  it("[C4-2b] nada muda: perfil, endereços e PII dos dois pedidos intactos", async () => {
    expect(await perfis(t, CLI_ABERTO)).toBe(1);
    expect(await enderecos(t, CLI_ABERTO)).toBe(1);
    for (const id of [pFinal, pAberto]) {
      const l = (await linhaC(t, id))!;
      expect(l.nome_cliente).toBe("Fulana Ficticia");
      expect(l.cliente_id).toBe(CLI_ABERTO);
    }
  });

  it("[C4-2c] quando o pedido termina, a exclusão volta a funcionar (checagem no momento da chamada)", async () => {
    await t.db.query(`update public.pedidos set status = 'saiu_entrega' where id = $1`, [pAberto]);
    await t.db.query(`update public.pedidos set status = 'entregue' where id = $1`, [pAberto]);
    await t.asService((db) => db.query(`select public.anonimizar_cliente($1)`, [CLI_ABERTO]));
    expect(await perfis(t, CLI_ABERTO)).toBe(0);
    expect((await linhaC(t, pAberto))!.nome_cliente).toBe("Cliente removido");
  });
});

// ---------------------------------------------------------------------------
describe("341 [C4-3] anonimizar_clientes_inativos pula quem tem pedido em aberto", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await novoDbC();
    await criarUsuarios(t, [DONO_C, INATIVO_FIM, INATIVO_ABERTO]);
    const loja = await lojaC(t, "p341-c4-inativos");
    await criarPerfil(t, INATIVO_FIM);
    await criarPerfil(t, INATIVO_ABERTO);
    await pedidoC(t, loja, INATIVO_FIM, "entregue");
    await pedidoC(t, loja, INATIVO_ABERTO, "pendente");
    await t.db.query(
      `update public.clientes set ultimo_acesso_em = now() - interval '25 months' where id = any($1::uuid[])`,
      [[INATIVO_FIM, INATIVO_ABERTO]],
    );
  });
  afterAll(async () => t?.close());

  it("[C4-3a] o lote não aborta: anonimiza o inativo sem pendência e mantém o que tem pedido em aberto", async () => {
    const e = await erroDe(t.asService((db) => db.query(`select public.anonimizar_clientes_inativos()`)));
    expect(e).toBeNull();
    expect(await perfis(t, INATIVO_FIM)).toBe(0);
    expect(await perfis(t, INATIVO_ABERTO)).toBe(1);
    const r = await t.db.query<{ n: number }>(
      `select count(*)::int as n from public.pedidos where cliente_id = $1 and nome_cliente = 'Fulana Ficticia'`,
      [INATIVO_ABERTO],
    );
    expect(r.rows[0].n).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("341 [C4-4] expurgar_pedidos_antigos — final > 5 anos, cliente ou convidado (decisão 4, RN-C16)", () => {
  let t: TestDb;
  let velhoEntregue: string;
  let velhoCancelado: string;
  let velhoConvidado: string;
  let velhoAberto: string;
  let recenteEntregue: string;

  beforeAll(async () => {
    t = await novoDbC();
    await criarUsuarios(t, [DONO_C, CLI_FIM]);
    const loja = await lojaC(t, "p341-c4-expurgo");
    await criarPerfil(t, CLI_FIM);
    velhoEntregue = await pedidoC(t, loja, CLI_FIM, "entregue");
    velhoCancelado = await pedidoC(t, loja, CLI_FIM, "cancelado");
    velhoConvidado = await pedidoC(t, loja, null, "entregue");
    velhoAberto = await pedidoC(t, loja, null, "pendente");
    recenteEntregue = await pedidoC(t, loja, null, "entregue");
    await t.db.query(
      `update public.pedidos set criado_em = now() - interval '5 years 1 day' where id = any($1::uuid[])`,
      [[velhoEntregue, velhoCancelado, velhoConvidado, velhoAberto]],
    );
    await t.db.query(`update public.pedidos set criado_em = now() - interval '4 years 11 months' where id = $1`, [
      recenteEntregue,
    ]);
  });
  afterAll(async () => t?.close());

  it("[C4-4a] EXECUTE só service_role (anon/authenticated/public não)", async () => {
    const fn = "public.expurgar_pedidos_antigos()";
    const r = await t.db.query<{ svc: boolean; anon: boolean; auth: boolean }>(
      `select has_function_privilege('service_role', $1, 'EXECUTE') as svc,
              has_function_privilege('anon', $1, 'EXECUTE') as anon,
              has_function_privilege('authenticated', $1, 'EXECUTE') as auth`,
      [fn],
    );
    expect(r.rows[0]).toEqual({ svc: true, anon: false, auth: false });
  });

  it("[C4-4b] asUser → 42501, nada apagado", async () => {
    const e = await erroDe(t.asUser(CLI_FIM, (db) => db.query(`select public.expurgar_pedidos_antigos()`)));
    expect(e?.code).toBe("42501");
    const r = await t.db.query<{ n: number }>(`select count(*)::int as n from public.pedidos`);
    expect(r.rows[0].n).toBe(5);
  });

  it("[C4-4c] service_role apaga só os 3 finais com mais de 5 anos (de cliente e de convidado) e retorna 3", async () => {
    const r = await t.asService((db) => db.query<{ n: number }>(`select public.expurgar_pedidos_antigos() as n`));
    expect(Number(r.rows[0].n)).toBe(3);
    const restantes = await t.db.query<{ id: string }>(`select id from public.pedidos order by id`);
    expect(restantes.rows.map((x) => x.id).sort()).toEqual([velhoAberto, recenteEntregue].sort());
  });

  it("[C4-4d] itens dos pedidos expurgados não ficam órfãos", async () => {
    const r = await t.db.query<{ n: number }>(
      `select count(*)::int as n from public.itens_pedido where pedido_id = any($1::uuid[])`,
      [[velhoEntregue, velhoCancelado, velhoConvidado]],
    );
    expect(r.rows[0].n).toBe(0);
  });
});

// ===========================================================================
// P30 — trava de 7 dias (altera decisão 16) e PII órfã via trigger
// ===========================================================================
const CLI_6D = "c3430000-0000-4000-8000-000000000061";
const CLI_8D = "c3430000-0000-4000-8000-000000000081";
const INAT_8D = "c3430000-0000-4000-8000-0000000000e8";
const CLI_CASC = "c3430000-0000-4000-8000-0000000000c5";

const obsItens = (t: TestDb, pedido: string) =>
  n(t, `select count(*)::int as n from public.itens_pedido where pedido_id = $1 and observacao is not null`, [pedido]);

describe("P30 [7d] pedido em aberto só bloqueia nos últimos 7 dias", () => {
  let t: TestDb;
  let p6: string;
  let p8: string;
  let pInat: string;
  beforeAll(async () => {
    t = await novoDbC();
    await criarUsuarios(t, [DONO_C, CLI_6D, CLI_8D, INAT_8D]);
    const loja = await lojaC(t, "p30-7d");
    for (const c of [CLI_6D, CLI_8D, INAT_8D]) await criarPerfil(t, c);
    p6 = await pedidoC(t, loja, CLI_6D, "pendente");
    p8 = await pedidoC(t, loja, CLI_8D, "pendente");
    pInat = await pedidoC(t, loja, INAT_8D, "pendente");
    await t.db.query(`update public.pedidos set criado_em = now() - interval '6 days' where id = $1`, [p6]);
    await t.db.query(`update public.pedidos set criado_em = now() - interval '8 days' where id = any($1::uuid[])`, [
      [p8, pInat],
    ]);
    await t.db.query(`update public.clientes set ultimo_acesso_em = now() - interval '25 months' where id = $1`, [
      INAT_8D,
    ]);
  });
  afterAll(async () => t?.close());

  it("[7d-a] pendente de 6 dias → pedido_em_aberto", async () => {
    const e = await erroDe(t.asService((db) => db.query(`select public.anonimizar_cliente($1)`, [CLI_6D])));
    expect(e?.message ?? "").toContain("pedido_em_aberto");
    expect(await perfis(t, CLI_6D)).toBe(1);
  });

  it("[7d-b] pendente de 8 dias → passa, 'Cliente removido', valores intactos", async () => {
    await t.asService((db) => db.query(`select public.anonimizar_cliente($1)`, [CLI_8D]));
    const l = (await linhaC(t, p8))!;
    expect(l.nome_cliente).toBe("Cliente removido");
    expect(l.telefone_cliente).toBeNull();
    expect(l.endereco_entrega).toBeNull();
    expect(l.observacoes).toBeNull();
    expect(l.cliente_id).toBeNull();
    expect(Number(l.subtotal)).toBe(60);
    expect(Number(l.desconto)).toBe(5);
    expect(await obsItens(t, p8)).toBe(0);
    expect(await perfis(t, CLI_8D)).toBe(0);
  });

  it("[7d-c] anonimizar_clientes_inativos não pula pendente de 8 dias", async () => {
    await t.asService((db) => db.query(`select public.anonimizar_clientes_inativos()`));
    expect(await perfis(t, INAT_8D)).toBe(0);
    expect((await linhaC(t, pInat))!.nome_cliente).toBe("Cliente removido");
  });
});

describe("P30 [orfa] delete de clientes fora da RPC anonimiza os pedidos (trigger)", () => {
  let t: TestDb;
  let p: string;
  beforeAll(async () => {
    t = await novoDbC();
    await criarUsuarios(t, [DONO_C, CLI_CASC]);
    const loja = await lojaC(t, "p30-orfa");
    await criarPerfil(t, CLI_CASC);
    p = await pedidoC(t, loja, CLI_CASC, "em_preparo");
    await t.db.query(`delete from auth.users where id = $1`, [CLI_CASC]);
  });
  afterAll(async () => t?.close());

  it("[orfa-a] pedido anonimizado, cliente_id null, valores intactos", async () => {
    const l = (await linhaC(t, p))!;
    expect(l.nome_cliente).toBe("Cliente removido");
    expect(l.telefone_cliente).toBeNull();
    expect(l.endereco_entrega).toBeNull();
    expect(l.observacoes).toBeNull();
    expect(l.cliente_id).toBeNull();
    expect(Number(l.subtotal)).toBe(60);
    expect(await obsItens(t, p)).toBe(0);
  });

  it("[orfa-b] função do trigger sem EXECUTE para anon/authenticated/public", async () => {
    const r = await t.db.query<{ fn: string }>(
      `select p.oid::regprocedure::text as fn from pg_trigger g join pg_proc p on p.oid = g.tgfoid
        where g.tgrelid = 'public.clientes'::regclass and not g.tgisinternal and g.tgtype & 8 = 8`,
    );
    expect(r.rows.length).toBeGreaterThan(0);
    for (const { fn } of r.rows) {
      for (const role of ["anon", "authenticated", "public"]) {
        const x = await t.db.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'EXECUTE') as ok`, [role, fn]);
        expect(x.rows[0].ok).toBe(false);
      }
    }
  });
});
