import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 353 — snapshot de categoria em `itens_pedido` (RN-V14/V15).
 * Autoridade: plan/tecnico-relatorio-vendas.md §6.1–§6.3 e §8.1 (T353-01..16).
 *
 * Contrato sob teste (nasce em supabase/migrations/):
 *  - A1 `20261007120000_itens_pedido_categoria_snapshot.sql`: colunas
 *    `categoria_id_snapshot uuid` / `categoria_nome_snapshot text`, nullable, SEM FK,
 *    CHECK `itens_pedido_categoria_snapshot_par_check` (as duas nulas ou as duas preenchidas);
 *  - B `20261007121000_rpc_criar_pedido_categoria_snapshot.sql`: `criar_pedido` (18 args,
 *    mesma assinatura/ACL) resolve a categoria a partir de `produto_id + p_loja_id` —
 *    nunca do payload jsonb; produto/categoria de outra loja → NULL;
 *  - A2 `20261007122000_itens_pedido_categoria_backfill.sql`: UPDATE reexecutável que
 *    só preenche linhas com snapshot NULL, com a categoria ATUAL do produto da MESMA loja.
 *
 * Por que é RED: as colunas não existem (42703), o arquivo de backfill não existe e o
 * `prosrc` de `criar_pedido` ainda não tem o bloco `-- >>> [353]`. T353-14 já passa:
 * é guarda de regressão de assinatura/ACL (mantida de propósito).
 *
 * Anti-falso-verde: recusas afirmam SQLSTATE E nome da constraint; a RPC roda como
 * service_role (único caller com EXECUTE), então nada aqui é decidido por RLS.
 * Dados fictícios.
 */

const DONO_A = "a3530000-0000-4000-8000-00000000000a";
const DONO_B = "b3530000-0000-4000-8000-00000000000b";
const UUID_QUALQUER = "f3530000-0000-4000-8000-0000000000ff";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

type Cenario = {
  lojaA: string;
  lojaB: string;
  bebidas: string;
  refrigerantes: string;
  bebidasB: string;
  coca: string;
  semCat: string;
  cocaB: string;
};

type Snapshot = { categoria_id_snapshot: string | null; categoria_nome_snapshot: string | null };

async function semear(t: TestDb): Promise<Cenario> {
  await t.db.query(
    `insert into auth.users (id, email) values ($1, 'dono-a-353@teste.local'), ($2, 'dono-b-353@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B],
  );
  return t.asService(async (db) => {
    const ins = async (sql: string, params: unknown[]) =>
      (await db.query<{ id: string }>(sql, params)).rows[0].id;
    const lojaA = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1, 'loja-a-353', 'Loja A', true) returning id`,
      [DONO_A],
    );
    const lojaB = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1, 'loja-b-353', 'Loja B', true) returning id`,
      [DONO_B],
    );
    const bebidas = await ins(
      `insert into public.categorias (loja_id, nome) values ($1, 'Bebidas') returning id`,
      [lojaA],
    );
    const refrigerantes = await ins(
      `insert into public.categorias (loja_id, nome) values ($1, 'Refrigerantes') returning id`,
      [lojaA],
    );
    const bebidasB = await ins(
      `insert into public.categorias (loja_id, nome) values ($1, 'Bebidas B') returning id`,
      [lojaB],
    );
    const coca = await ins(
      `insert into public.produtos (loja_id, categoria_id, nome, preco, disponivel) values ($1, $2, 'Coca', 6.00, true) returning id`,
      [lojaA, bebidas],
    );
    const semCat = await ins(
      `insert into public.produtos (loja_id, categoria_id, nome, preco, disponivel) values ($1, null, 'Sem Cat', 9.00, true) returning id`,
      [lojaA],
    );
    const cocaB = await ins(
      `insert into public.produtos (loja_id, categoria_id, nome, preco, disponivel) values ($1, $2, 'Coca B', 7.00, true) returning id`,
      [lojaB, bebidasB],
    );
    return { lojaA, lojaB, bebidas, refrigerantes, bebidasB, coca, semCat, cocaB };
  });
}

/** `criar_pedido` com os 18 argumentos nomeados (molde rpc_criar_pedido.test.ts), como service_role. */
async function chamarCriarPedido(
  t: TestDb,
  lojaId: string,
  itens: Record<string, unknown>[],
  subtotal: number,
): Promise<string> {
  const r = await t.asService((db) =>
    db.query<{ pedido_id: string }>(
      `select * from public.criar_pedido(
         p_loja_id          => $1,
         p_nome_cliente     => 'Cliente Teste',
         p_telefone_cliente => '(11) 90000-0000',
         p_endereco_entrega => null,
         p_forma_pagamento  => 'pix',
         p_observacoes      => null,
         p_subtotal         => $2,
         p_taxa_entrega     => 0,
         p_desconto         => 0,
         p_total            => $2,
         p_cupom_id         => null,
         p_cupom_codigo     => null,
         p_itens            => $3::jsonb,
         p_tipo_entrega     => 'retirada',
         p_troco_para       => null,
         p_idempotency_key  => null,
         p_frete_a_combinar => false,
         p_cliente_id       => null
       )`,
      [lojaId, subtotal, JSON.stringify(itens)],
    ),
  );
  return r.rows[0].pedido_id;
}

async function snapshotsDoPedido(t: TestDb, pedidoId: string): Promise<Snapshot[]> {
  const r = await t.db.query<Snapshot>(
    `select categoria_id_snapshot, categoria_nome_snapshot
       from public.itens_pedido where pedido_id = $1 order by nome`,
    [pedidoId],
  );
  return r.rows;
}

async function erroDe(p: Promise<unknown>): Promise<{ code?: string; message: string } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { code?: string; message: string };
  }
}

/** Pedido mínimo inserido direto como postgres (para seed de itens fora da RPC). */
async function pedidoDireto(t: TestDb, lojaId: string): Promise<string> {
  const r = await t.db.query<{ id: string }>(
    `insert into public.pedidos
       (loja_id, nome_cliente, telefone_cliente, subtotal, desconto, taxa_entrega, total,
        forma_pagamento, tipo_entrega, status)
     values ($1, 'Cliente Teste', '(11) 90000-0000', 10, 0, 0, 10, 'pix', 'retirada', 'entregue')
     returning id`,
    [lojaId],
  );
  return r.rows[0].id;
}

async function itemDireto(t: TestDb, pedidoId: string, produtoId: string | null, nome: string): Promise<string> {
  const r = await t.db.query<{ id: string }>(
    `insert into public.itens_pedido (pedido_id, produto_id, nome, preco, quantidade)
     values ($1, $2, $3, 6.00, 1) returning id`,
    [pedidoId, produtoId, nome],
  );
  return r.rows[0].id;
}

async function snapshotDoItem(t: TestDb, itemId: string): Promise<Snapshot> {
  const r = await t.db.query<Snapshot>(
    `select categoria_id_snapshot, categoria_nome_snapshot from public.itens_pedido where id = $1`,
    [itemId],
  );
  return r.rows[0];
}

function arquivoMigration(prefixo: string, sufixo: string): string {
  const nome = readdirSync(MIGRATIONS).find((f) => f.startsWith(prefixo) && f.endsWith(sufixo));
  if (!nome) throw new Error(`[RED 353] migration ausente: ${prefixo}…${sufixo}`);
  return readFileSync(join(MIGRATIONS, nome), "utf8");
}

async function reexecutarBackfill(t: TestDb): Promise<void> {
  const sql = arquivoMigration("20261007122000_", "backfill.sql");
  await t.db.exec(sql);
}

async function prosrcCriarPedido(t: TestDb): Promise<string> {
  const r = await t.db.query<{ prosrc: string }>(
    `select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'criar_pedido'`,
  );
  expect(r.rows).toHaveLength(1);
  return r.rows[0].prosrc;
}

describe("353 itens_pedido.categoria_*_snapshot + criar_pedido + backfill (pglite)", () => {
  let t: TestDb;
  let c: Cenario;
  let pedido1: string;

  beforeAll(async () => {
    t = await createTestDb();
    c = await semear(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ─────────────────────────────────────────────── A1: colunas + CHECK
  it("T353-01 colunas existem: categoria_id_snapshot uuid YES, categoria_nome_snapshot text YES", async () => {
    const r = await t.db.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `select column_name, data_type, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'itens_pedido'
          and column_name in ('categoria_id_snapshot', 'categoria_nome_snapshot')
        order by column_name`,
    );
    expect(r.rows).toEqual([
      { column_name: "categoria_id_snapshot", data_type: "uuid", is_nullable: "YES" },
      { column_name: "categoria_nome_snapshot", data_type: "text", is_nullable: "YES" },
    ]);
  });

  it("T353-02 sem FK nas colunas novas (snapshot imutável)", async () => {
    const cols = await t.db.query<{ attnum: number }>(
      `select attnum from pg_attribute
        where attrelid = 'public.itens_pedido'::regclass
          and attname in ('categoria_id_snapshot', 'categoria_nome_snapshot') and not attisdropped`,
    );
    // Pré-condição: as colunas existem (sem isso "nenhuma FK" passaria por vácuo).
    expect(cols.rows).toHaveLength(2);
    const fks = await t.db.query<{ conname: string }>(
      `select conname from pg_constraint
        where conrelid = 'public.itens_pedido'::regclass and contype = 'f'
          and conkey && $1::int2[]`,
      [cols.rows.map((x) => x.attnum)],
    );
    expect(fks.rows).toEqual([]);
  });

  it("T353-03 CHECK do par: id sem nome → 23514 itens_pedido_categoria_snapshot_par_check", async () => {
    const ped = await pedidoDireto(t, c.lojaA);
    const e = await erroDe(
      t.db.query(
        `insert into public.itens_pedido (pedido_id, produto_id, nome, preco, quantidade, categoria_id_snapshot, categoria_nome_snapshot)
         values ($1, $2, 'Coca', 6.00, 1, $3, null)`,
        [ped, c.coca, c.bebidas],
      ),
    );
    expect(e?.code).toBe("23514");
    expect(e?.message).toContain("itens_pedido_categoria_snapshot_par_check");
  });

  it("T353-04 CHECK do par: nome sem id → 23514 itens_pedido_categoria_snapshot_par_check", async () => {
    const ped = await pedidoDireto(t, c.lojaA);
    const e = await erroDe(
      t.db.query(
        `insert into public.itens_pedido (pedido_id, produto_id, nome, preco, quantidade, categoria_id_snapshot, categoria_nome_snapshot)
         values ($1, $2, 'Coca', 6.00, 1, null, 'Bebidas')`,
        [ped, c.coca],
      ),
    );
    expect(e?.code).toBe("23514");
    expect(e?.message).toContain("itens_pedido_categoria_snapshot_par_check");
  });

  // ─────────────────────────────────────────────── B: RPC grava o snapshot
  it("T353-05 Coca em Bebidas → item com categoria_nome_snapshot 'Bebidas' e id de Bebidas", async () => {
    pedido1 = await chamarCriarPedido(
      t,
      c.lojaA,
      [{ produto_id: c.coca, nome: "Coca", preco: 6, quantidade: 1 }],
      6,
    );
    expect(await snapshotsDoPedido(t, pedido1)).toEqual([
      { categoria_id_snapshot: c.bebidas, categoria_nome_snapshot: "Bebidas" },
    ]);
  });

  it("T353-06 RN-V14: Coca movida para Refrigerantes → pedido 2 'Refrigerantes'; pedido 1 segue 'Bebidas'", async () => {
    await t.db.query(`update public.produtos set categoria_id = $1 where id = $2`, [c.refrigerantes, c.coca]);
    const pedido2 = await chamarCriarPedido(
      t,
      c.lojaA,
      [{ produto_id: c.coca, nome: "Coca", preco: 6, quantidade: 1 }],
      6,
    );
    expect(await snapshotsDoPedido(t, pedido2)).toEqual([
      { categoria_id_snapshot: c.refrigerantes, categoria_nome_snapshot: "Refrigerantes" },
    ]);
    expect(await snapshotsDoPedido(t, pedido1)).toEqual([
      { categoria_id_snapshot: c.bebidas, categoria_nome_snapshot: "Bebidas" },
    ]);
  });

  it("T353-07 categoria renomeada → item do pedido 1 segue 'Bebidas'", async () => {
    await t.db.query(`update public.categorias set nome = 'Bebidas geladas' where id = $1`, [c.bebidas]);
    expect(await snapshotsDoPedido(t, pedido1)).toEqual([
      { categoria_id_snapshot: c.bebidas, categoria_nome_snapshot: "Bebidas" },
    ]);
  });

  it("T353-08 payload forjado com chaves de categoria → grava a categoria REAL do produto", async () => {
    // Aqui a Coca já está em Refrigerantes (T353-06). O id forjado aponta para
    // Bebidas (outra categoria da mesma loja) para que a chave `categoria_id` do
    // payload seja distinguível da categoria real.
    const ped = await chamarCriarPedido(
      t,
      c.lojaA,
      [
        {
          produto_id: c.coca,
          nome: "Coca",
          preco: 6,
          quantidade: 1,
          categoria_id: c.bebidas,
          categoria_nome: "Forjada",
          categoria_id_snapshot: UUID_QUALQUER,
          categoria_nome_snapshot: "X",
        },
      ],
      6,
    );
    expect(await snapshotsDoPedido(t, ped)).toEqual([
      { categoria_id_snapshot: c.refrigerantes, categoria_nome_snapshot: "Refrigerantes" },
    ]);
  });

  it("T353-09 cross-loja: pedido em A com produto de B → snapshot NULL (nunca 'Bebidas B'); pedido criado", async () => {
    const ped = await chamarCriarPedido(
      t,
      c.lojaA,
      [{ produto_id: c.cocaB, nome: "Coca B", preco: 7, quantidade: 1 }],
      7,
    );
    expect(ped).toBeTruthy();
    expect(await snapshotsDoPedido(t, ped)).toEqual([
      { categoria_id_snapshot: null, categoria_nome_snapshot: null },
    ]);
  });

  it("T353-10 produto sem categoria → snapshot NULL", async () => {
    const ped = await chamarCriarPedido(
      t,
      c.lojaA,
      [{ produto_id: c.semCat, nome: "Sem Cat", preco: 9, quantidade: 1 }],
      9,
    );
    expect(await snapshotsDoPedido(t, ped)).toEqual([
      { categoria_id_snapshot: null, categoria_nome_snapshot: null },
    ]);
  });

  it("T353-11 item sem produto_id → snapshot NULL", async () => {
    const ped = await chamarCriarPedido(t, c.lojaA, [{ nome: "Avulso", preco: 5, quantidade: 1 }], 5);
    expect(await snapshotsDoPedido(t, ped)).toEqual([
      { categoria_id_snapshot: null, categoria_nome_snapshot: null },
    ]);
  });

  // ─────────────────────────────────────────────── A2: backfill
  it("T353-12 backfill preenche com a categoria ATUAL da mesma loja; NULL/cross-loja/sem categoria ficam NULL", async () => {
    const pedA = await pedidoDireto(t, c.lojaA);
    const a = await itemDireto(t, pedA, c.coca, "Coca"); // Coca hoje em Refrigerantes
    const b = await itemDireto(t, pedA, null, "Avulso");
    const cc = await itemDireto(t, pedA, c.cocaB, "Coca B"); // produto de B em pedido de A
    const d = await itemDireto(t, pedA, c.semCat, "Sem Cat");

    await reexecutarBackfill(t);

    expect(await snapshotDoItem(t, a)).toEqual({
      categoria_id_snapshot: c.refrigerantes,
      categoria_nome_snapshot: "Refrigerantes",
    });
    expect(await snapshotDoItem(t, b)).toEqual({ categoria_id_snapshot: null, categoria_nome_snapshot: null });
    expect(await snapshotDoItem(t, cc)).toEqual({ categoria_id_snapshot: null, categoria_nome_snapshot: null });
    expect(await snapshotDoItem(t, d)).toEqual({ categoria_id_snapshot: null, categoria_nome_snapshot: null });
  });

  it("T353-13 backfill não reescreve snapshot gravado e é idempotente", async () => {
    const tudo = async () =>
      (
        await t.db.query(
          `select id, categoria_id_snapshot, categoria_nome_snapshot from public.itens_pedido order by id`,
        )
      ).rows;

    await reexecutarBackfill(t);
    expect(await snapshotsDoPedido(t, pedido1)).toEqual([
      { categoria_id_snapshot: c.bebidas, categoria_nome_snapshot: "Bebidas" },
    ]);
    const antes = await tudo();
    await reexecutarBackfill(t);
    expect(await tudo()).toEqual(antes);
  });

  // ─────────────────────────────────────────────── B: assinatura, ACL e corpo
  it("T353-14 assinatura de 18 args, invoker, search_path=public, EXECUTE só service_role (guarda de regressão)", async () => {
    const r = await t.db.query<{
      args: string;
      prosecdef: boolean;
      proconfig: string[] | null;
      anon: boolean;
      auth: boolean;
      svc: boolean;
    }>(
      `select pg_get_function_identity_arguments(p.oid) as args, p.prosecdef, p.proconfig,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('service_role', p.oid, 'execute') as svc
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'criar_pedido'`,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].args).toBe(
      "p_loja_id uuid, p_nome_cliente text, p_telefone_cliente text, p_endereco_entrega jsonb, p_forma_pagamento text, p_observacoes text, p_subtotal numeric, p_taxa_entrega numeric, p_desconto numeric, p_total numeric, p_cupom_id uuid, p_cupom_codigo text, p_itens jsonb, p_tipo_entrega text, p_troco_para numeric, p_idempotency_key uuid, p_frete_a_combinar boolean, p_cliente_id uuid",
    );
    expect(r.rows[0].prosecdef).toBe(false);
    expect(r.rows[0].proconfig).toEqual(["search_path=public"]);
    expect(r.rows[0].anon).toBe(false);
    expect(r.rows[0].auth).toBe(false);
    expect(r.rows[0].svc).toBe(true);
  });

  it("T353-15 corpo literal: fora do bloco [353], prosrc = corpo de 20261003122000", async () => {
    const arquivo = readFileSync(join(MIGRATIONS, "20261003122000_rpc_criar_pedido_cliente.sql"), "utf8");
    const ini = arquivo.indexOf("as $$");
    const fim = arquivo.indexOf("$$;", ini + 5);
    expect(ini).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(ini);
    const reInsertVelho = /    insert into public\.itens_pedido \(pedido_id[\s\S]*?returning id into v_item_id;\n/;
    const corpoVelho = arquivo.slice(ini + "as $$".length, fim);
    expect(corpoVelho).toMatch(reInsertVelho);
    const velho = corpoVelho.replace(reInsertVelho, "<<INSERT>>\n");

    const prosrc = await prosrcCriarPedido(t);
    const reBloco = /    -- >>> \[353\][\s\S]*?    -- <<< \[353\]\n/;
    expect(prosrc).toMatch(reBloco);
    const novo = prosrc.replace(reBloco, "<<INSERT>>\n").replace(/^.*-- \[353\]\n/gm, "");

    expect(novo.trim()).toBe(velho.trim());
  });

  it("T353-16 bloco não lê categoria do payload e escopa produto e categoria por p_loja_id", async () => {
    const prosrc = await prosrcCriarPedido(t);
    expect(prosrc).not.toMatch(/v_item\s*->>?\s*'categoria/);
    expect(prosrc).toContain("pr.loja_id = p_loja_id");
    expect(prosrc).toContain("c.loja_id = p_loja_id");
  });
});
