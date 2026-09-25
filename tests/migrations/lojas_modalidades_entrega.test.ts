import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) — spec `specs/modalidades-entrega-loja.md`, fatia A1 (colunas
 * de modalidade em `lojas` + CHECK + recriação de `vitrine_lojas`) e o lado
 * banco da fatia C (RLS do registro de frete combinado).
 *
 * Escrito a partir da SPEC e do plano (`plan/loop-modalidades-entrega-loja.md`,
 * tabela "Risco por fatia"), nunca do SQL — a migration
 * `*_lojas_modalidades_entrega.sql` ainda NÃO existe. Todo teste de coluna nova
 * falha hoje com "column ... does not exist", que é o RED esperado.
 *
 * O que fica provado:
 *  [1] shape: `aceita_retirada`/`aceita_entrega` boolean NOT NULL default true;
 *      `modo_frete` text NOT NULL default 'automatico'.
 *  [2] loja que não menciona as colunas nasce (true, true, 'automatico') —
 *      "loja que já existe fica com retirada e entrega ligadas e frete automático".
 *  [3] CHECK `lojas_ao_menos_uma_modalidade`: as duas desligadas é recusado, e a
 *      recusa CITA o nome do CHECK (SQLSTATE 23514 sozinho não basta: qualquer
 *      outro CHECK de `lojas` daria o mesmo código).
 *  [4] `modo_frete` fora de ('automatico','a_combinar') e NULL são recusados, a
 *      recusa cita a coluna.
 *  [5] `vitrine_lojas` projeta EXATAMENTE as 21 colunas anteriores + as 3 novas,
 *      anon lê as 3 novas ao vivo, e a view recriada MANTÉM `security_barrier`
 *      (20260920124500 ligou por ALTER VIEW; um drop+create copiado do molde
 *      20260920122000 perde a opção em silêncio).
 *  [6] RLS de `lojas`: o dono grava as modalidades da própria loja; dono de
 *      outra loja não grava (0 linhas, dado intacto).
 *  [7] RLS de `pedidos` (fatia C): lojista B não registra frete no pedido da
 *      loja A; lojista A registra no próprio — o UPDATE que a action vai emitir
 *      passa pela RLS e pelo CHECK `chk_pedidos_frete_a_combinar`.
 *
 * NOTA (issue 298): o pglite reconcede SELECT em toda tabela/view depois das
 * migrations (GRANTS_SQL), então este arquivo NÃO detecta `grant select`
 * esquecido na view recriada. Essa trava é o gate estático do plano (P3:
 * `grep -n "grant select on public.vitrine_lojas" <migration>`).
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aa0000000299";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bb0000000299";
// `lojas_dono_unico`: UMA loja por dono — cada INSERT de loja extra usa um dono novo.
const DONO_INSERT_1 = "cccccccc-cccc-cccc-cccc-cc0000000299";
const DONO_INSERT_2 = "dddddddd-dddd-dddd-dddd-dd0000000299";

const SLUG_A = "loja-a-modalidades";
const SLUG_B = "loja-b-modalidades";

/**
 * Projeção VIGENTE de `vitrine_lojas` antes desta feature — copiada da última
 * migration que recriou a view (`20260920122000_vitrine_lojas_modal_promocoes.sql`,
 * 21 colunas). 20260920124500 só fez ALTER VIEW (security_barrier) e grants.
 */
const COLUNAS_ANTERIORES = [
  "id",
  "slug",
  "nome",
  "telefone",
  "whatsapp",
  "ativo",
  "endereco_rua",
  "endereco_numero",
  "endereco_bairro",
  "endereco_cidade",
  "endereco_estado",
  "endereco_cep",
  "tema",
  "horarios",
  "timezone",
  "assinatura_status",
  "assinatura_fim_periodo",
  "taxa_entrega_fora_zona",
  "logo_url",
  "whatsapp_envio_automatico",
  "modal_promocoes",
] as const;

const COLUNAS_NOVAS = ["aceita_retirada", "aceita_entrega", "modo_frete"] as const;

const COLUNAS_ESPERADAS = [...COLUNAS_ANTERIORES, ...COLUNAS_NOVAS];

let t: TestDb;
let lojaA: string;

type Modalidades = { aceita_retirada: boolean; aceita_entrega: boolean; modo_frete: string };

async function lerModalidades(slug: string): Promise<Modalidades> {
  const r = await t.asService((db) =>
    db.query<Modalidades>(
      `select aceita_retirada, aceita_entrega, modo_frete from public.lojas where slug = $1`,
      [slug],
    ),
  );
  return r.rows[0];
}

/** Executa e devolve a mensagem de erro ("" se não lançou). */
async function mensagemDeErro(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (err) {
    return (err as Error).message;
  }
}

beforeAll(async () => {
  t = await createTestDb();
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a-299@teste.local'),
       ($2, 'dono-b-299@teste.local'),
       ($3, 'dono-i1-299@teste.local'),
       ($4, 'dono-i2-299@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B, DONO_INSERT_1, DONO_INSERT_2],
  );
  // Lojas criadas SEM mencionar as colunas novas — é o estado de toda loja que
  // já existe no cloud quando a migration rodar (`add column ... default`).
  lojaA = await t.asService(async (db) => {
    const a = await db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1, $2, 'Loja A', true) returning id`,
      [DONO_A, SLUG_A],
    );
    // Dono B tem a PRÓPRIA loja: o isolamento é entre dois lojistas reais.
    await db.query(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1, $2, 'Loja B', true)`,
      [DONO_B, SLUG_B],
    );
    return a.rows[0].id;
  });
});

afterAll(async () => {
  await t.close();
});

// ─────────────────────────────────────────────────────────────── [1] shape
describe("A1 · lojas — shape das colunas de modalidade", () => {
  it("[1a] aceita_retirada e aceita_entrega: boolean NOT NULL DEFAULT true", async () => {
    const r = await t.db.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = 'lojas'
          and column_name in ('aceita_retirada', 'aceita_entrega')
        order by column_name`,
    );
    expect(r.rows).toEqual([
      { column_name: "aceita_entrega", data_type: "boolean", is_nullable: "NO", column_default: "true" },
      { column_name: "aceita_retirada", data_type: "boolean", is_nullable: "NO", column_default: "true" },
    ]);
  });

  it("[1b] modo_frete: text NOT NULL DEFAULT 'automatico'", async () => {
    const r = await t.db.query<{ data_type: string; is_nullable: string; column_default: string | null }>(
      `select data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = 'lojas' and column_name = 'modo_frete'`,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(r.rows[0].column_default).toMatch(/'automatico'/);
  });
});

// ──────────────────────────────────────────────── [2] default em loja existente
describe("A1 · lojas — loja que já existe mantém o comportamento de hoje", () => {
  it("[2] loja criada sem mencionar as colunas fica (retirada ON, entrega ON, automatico)", async () => {
    expect(await lerModalidades(SLUG_A)).toEqual({
      aceita_retirada: true,
      aceita_entrega: true,
      modo_frete: "automatico",
    });
  });
});

// ─────────────────────────────────── [3] CHECK lojas_ao_menos_uma_modalidade
describe("A1 · lojas — CHECK lojas_ao_menos_uma_modalidade", () => {
  it("[3a] UPDATE com retirada E entrega desligadas é recusado e a recusa CITA o CHECK", async () => {
    const msg = await mensagemDeErro(() =>
      t.asService((db) =>
        db.query(
          `update public.lojas set aceita_retirada = false, aceita_entrega = false where slug = $1`,
          [SLUG_A],
        ),
      ),
    );
    // Fragmento do nome do CHECK, não só o SQLSTATE: o 23514 de outro CHECK de
    // `lojas` passaria por acidente numa asserção só de código.
    expect(msg).toMatch(/lojas_ao_menos_uma_modalidade/);

    // anti-falso-verde: a linha não mudou.
    expect(await lerModalidades(SLUG_A)).toMatchObject({
      aceita_retirada: true,
      aceita_entrega: true,
    });
  });

  it("[3b] INSERT de loja com as duas desligadas é recusado citando o CHECK; nada é gravado", async () => {
    const msg = await mensagemDeErro(() =>
      t.asService((db) =>
        db.query(
          `insert into public.lojas (dono_id, slug, nome, ativo, aceita_retirada, aceita_entrega)
           values ($1, 'loja-sem-modalidade-299', 'Sem modalidade', true, false, false)`,
          [DONO_INSERT_1],
        ),
      ),
    );
    expect(msg).toMatch(/lojas_ao_menos_uma_modalidade/);

    const conf = await t.asService((db) =>
      db.query(`select 1 from public.lojas where slug = 'loja-sem-modalidade-299'`),
    );
    expect(conf.rows).toHaveLength(0);
  });

  it("[3c] só retirada (entrega desligada) é aceito", async () => {
    await t.asService((db) =>
      db.query(
        `update public.lojas set aceita_retirada = true, aceita_entrega = false where slug = $1`,
        [SLUG_A],
      ),
    );
    expect(await lerModalidades(SLUG_A)).toMatchObject({
      aceita_retirada: true,
      aceita_entrega: false,
    });
  });

  it("[3d] só entrega (retirada desligada) é aceito", async () => {
    await t.asService((db) =>
      db.query(
        `update public.lojas set aceita_retirada = false, aceita_entrega = true where slug = $1`,
        [SLUG_A],
      ),
    );
    expect(await lerModalidades(SLUG_A)).toMatchObject({
      aceita_retirada: false,
      aceita_entrega: true,
    });
    // devolve ao default para os casos seguintes
    await t.asService((db) =>
      db.query(
        `update public.lojas set aceita_retirada = true, aceita_entrega = true where slug = $1`,
        [SLUG_A],
      ),
    );
  });
});

// ───────────────────────────────────────────────────── [4] domínio de modo_frete
describe("A1 · lojas — domínio de modo_frete", () => {
  it("[4a] modo_frete = 'x' é recusado e a recusa cita modo_frete; linha intacta", async () => {
    const msg = await mensagemDeErro(() =>
      t.asService((db) =>
        db.query(`update public.lojas set modo_frete = 'x' where slug = $1`, [SLUG_A]),
      ),
    );
    expect(msg).toMatch(/check constraint/i);
    expect(msg).toMatch(/modo_frete/);
    expect((await lerModalidades(SLUG_A)).modo_frete).toBe("automatico");
  });

  it("[4b] modo_frete NULL é recusado (NOT NULL) citando a coluna", async () => {
    const msg = await mensagemDeErro(() =>
      t.asService((db) =>
        db.query(`update public.lojas set modo_frete = null where slug = $1`, [SLUG_A]),
      ),
    );
    expect(msg).toMatch(/modo_frete/);
    expect(msg).toMatch(/null/i);
  });

  it("[4c] 'a_combinar' e 'automatico' são aceitos", async () => {
    await t.asService((db) =>
      db.query(`update public.lojas set modo_frete = 'a_combinar' where slug = $1`, [SLUG_A]),
    );
    expect((await lerModalidades(SLUG_A)).modo_frete).toBe("a_combinar");

    await t.asService((db) =>
      db.query(`update public.lojas set modo_frete = 'automatico' where slug = $1`, [SLUG_A]),
    );
    expect((await lerModalidades(SLUG_A)).modo_frete).toBe("automatico");
  });

  it("[4d] INSERT com modo_frete = 'a_combinar' explícito é aceito", async () => {
    const r = await t.asService((db) =>
      db.query<Modalidades>(
        `insert into public.lojas (dono_id, slug, nome, ativo, modo_frete)
         values ($1, 'loja-a-combinar-299', 'A combinar', true, 'a_combinar')
         returning aceita_retirada, aceita_entrega, modo_frete`,
        [DONO_INSERT_2],
      ),
    );
    expect(r.rows[0]).toEqual({
      aceita_retirada: true,
      aceita_entrega: true,
      modo_frete: "a_combinar",
    });
  });
});

// ─────────────────────────────────────────────── [5] vitrine_lojas recriada
describe("A1 · vitrine_lojas — projeção e opções da view recriada", () => {
  it("[5a] projeta EXATAMENTE as 21 colunas anteriores + aceita_retirada, aceita_entrega, modo_frete", async () => {
    const r = await t.db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'vitrine_lojas'
        order by ordinal_position`,
    );
    const atuais = r.rows.map((x) => x.column_name);

    // Faltante aparece NOMEADA no output de falha (coluna a menos derruba a vitrine).
    const faltantes = COLUNAS_ANTERIORES.filter((c) => !atuais.includes(c));
    expect({ faltantes }).toEqual({ faltantes: [] });

    const novasAusentes = COLUNAS_NOVAS.filter((c) => !atuais.includes(c));
    expect({ novasAusentes }).toEqual({ novasAusentes: [] });

    // Nada além disso: sem `select *` acidental (dono_id, hotmart_*, coords...).
    expect([...atuais].sort()).toEqual([...COLUNAS_ESPERADAS].sort());
  });

  it("[5b] anon lê as 3 colunas novas pela view, com o valor AO VIVO da tabela", async () => {
    await t.asService((db) =>
      db.query(
        `update public.lojas set aceita_retirada = false, aceita_entrega = true, modo_frete = 'a_combinar'
          where slug = $1`,
        [SLUG_A],
      ),
    );
    const r = await t.asAnon((db) =>
      db.query<Modalidades>(
        `select aceita_retirada, aceita_entrega, modo_frete from public.vitrine_lojas where slug = $1`,
        [SLUG_A],
      ),
    );
    expect(r.rows).toEqual([
      { aceita_retirada: false, aceita_entrega: true, modo_frete: "a_combinar" },
    ]);

    await t.asService((db) =>
      db.query(
        `update public.lojas set aceita_retirada = true, aceita_entrega = true, modo_frete = 'automatico'
          where slug = $1`,
        [SLUG_A],
      ),
    );
  });

  it("[5c] a view recriada MANTÉM security_barrier = true (20260920124500)", async () => {
    // Já é verdade hoje; vira vermelho se a migration nova fizer drop+create
    // copiando o molde 20260920122000 (anterior à 124500) sem reaplicar a opção.
    const r = await t.db.query<{ reloptions: string[] | null }>(
      `select c.reloptions from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'vitrine_lojas'`,
    );
    expect(r.rows[0].reloptions ?? []).toContain("security_barrier=true");
  });
});

// ─────────────────────────────────────────── [6] RLS de lojas para as modalidades
describe("A2 · RLS de lojas — o salvar das modalidades pelo lojista", () => {
  it("[6a] dono A grava as modalidades da PRÓPRIA loja (1 linha)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(
        `update public.lojas set aceita_retirada = true, aceita_entrega = false, modo_frete = 'a_combinar'
          where id = $1`,
        [lojaA],
      ),
    );
    expect(r.affectedRows ?? 0).toBe(1);
    expect(await lerModalidades(SLUG_A)).toEqual({
      aceita_retirada: true,
      aceita_entrega: false,
      modo_frete: "a_combinar",
    });
    await t.asService((db) =>
      db.query(
        `update public.lojas set aceita_retirada = true, aceita_entrega = true, modo_frete = 'automatico'
          where id = $1`,
        [lojaA],
      ),
    );
  });

  it("[6b] dono B NÃO grava as modalidades da loja A (0 linhas, dado intacto)", async () => {
    const r = await t.asUser(DONO_B, (db) =>
      db.query(
        `update public.lojas set aceita_entrega = false, modo_frete = 'a_combinar' where id = $1`,
        [lojaA],
      ),
    );
    expect(r.affectedRows ?? 0).toBe(0);
    expect(await lerModalidades(SLUG_A)).toEqual({
      aceita_retirada: true,
      aceita_entrega: true,
      modo_frete: "automatico",
    });
  });
});

// ───────────────────────────────── [7] RLS de pedidos para o registro de frete (C)
describe("C · RLS de pedidos — registro de frete combinado", () => {
  async function pedidoACombinar(loja: string): Promise<string> {
    return t.asService(async (db) => {
      const r = await db.query<{ id: string }>(
        `insert into public.pedidos
           (loja_id, nome_cliente, subtotal, desconto, taxa_entrega, total, forma_pagamento,
            status, tipo_entrega, frete_a_combinar, endereco_entrega)
         values ($1, 'Cliente', 50, 5, null, 45, 'pix', 'pendente', 'entrega', true, $2::jsonb)
         returning id`,
        [loja, JSON.stringify({ cep: "01000-000", rua: "R", numero: "1", bairro: "Centro" })],
      );
      return r.rows[0].id;
    });
  }

  async function lerPedido(id: string) {
    const r = await t.asService((db) =>
      db.query<{ taxa_entrega: number | null; total: number; frete_a_combinar: boolean }>(
        `select taxa_entrega, total, frete_a_combinar from public.pedidos where id = $1`,
        [id],
      ),
    );
    return r.rows[0];
  }

  // O UPDATE que `registrarFreteCombinado` emite: patch de 3 colunas + os filtros
  // de D1/D2 (frete ainda a combinar, entrega, não cancelado).
  const UPDATE_REGISTRO = `
    update public.pedidos
       set taxa_entrega = 7, total = 52, frete_a_combinar = false
     where id = $1 and frete_a_combinar = true and tipo_entrega = 'entrega' and status <> 'cancelado'`;

  it("[7a] lojista B NÃO registra frete no pedido da loja A (0 linhas, pedido intacto)", async () => {
    const id = await pedidoACombinar(lojaA);
    const r = await t.asUser(DONO_B, (db) => db.query(UPDATE_REGISTRO, [id]));
    expect(r.affectedRows ?? 0).toBe(0);
    expect(await lerPedido(id)).toEqual({ taxa_entrega: null, total: 45, frete_a_combinar: true });
  });

  it("[7b] lojista A registra no PRÓPRIO pedido: passa pela RLS e pelo chk_pedidos_frete_a_combinar", async () => {
    const id = await pedidoACombinar(lojaA);
    const r = await t.asUser(DONO_A, (db) => db.query(UPDATE_REGISTRO, [id]));
    expect(r.affectedRows ?? 0).toBe(1);
    expect(await lerPedido(id)).toEqual({ taxa_entrega: 7, total: 52, frete_a_combinar: false });
  });

  it("[7c] segundo registro no mesmo pedido não casa linha (D1: frete trava)", async () => {
    const id = await pedidoACombinar(lojaA);
    await t.asUser(DONO_A, (db) => db.query(UPDATE_REGISTRO, [id]));
    const r = await t.asUser(DONO_A, (db) =>
      db.query(
        `update public.pedidos set taxa_entrega = 9, total = 54, frete_a_combinar = false
          where id = $1 and frete_a_combinar = true and tipo_entrega = 'entrega' and status <> 'cancelado'`,
        [id],
      ),
    );
    expect(r.affectedRows ?? 0).toBe(0);
    expect(await lerPedido(id)).toEqual({ taxa_entrega: 7, total: 52, frete_a_combinar: false });
  });

  it("[7d] lojista B também não enxerga o pedido da loja A (leitura do subtotal/desconto)", async () => {
    const id = await pedidoACombinar(lojaA);
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`select subtotal, desconto from public.pedidos where id = $1`, [id]),
    );
    expect(r.rows).toHaveLength(0);
  });
});
