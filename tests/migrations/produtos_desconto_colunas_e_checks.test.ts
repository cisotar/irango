import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 219 — colunas de desconto em `public.produtos` + os
 * cinco CHECKs (spec `desconto-por-produto-e-pratos-promocionais.md`,
 * RN-01, RN-03, RN-04, RN-05, RN-06/D10, RN-07).
 *
 * Escrito a partir da ISSUE e do SPEC, nunca do SQL. O que precisa ficar provado:
 *
 *  1. os cinco CHECKs recusam configuração monetária incoerente — e a asserção
 *     afirma o NOME LITERAL da constraint, não só o SQLSTATE 23514. Trava de
 *     escopo passa por acidente aritmético: `23514` sozinho não distingue
 *     "recusou pelo motivo certo" de "recusou por outra regra qualquer";
 *  2. lojista A é recusado ao escrever desconto em produto da loja B, com
 *     FRAGMENTO da mensagem afirmado (ou, quando a RLS filtra a linha antes de
 *     qualquer WITH CHECK, com 0 linhas afetadas + reconferência via service);
 *  3. linhas existentes de `produtos` continuam válidas: nascem
 *     `desconto_ativo = false` com os quatro campos NULL.
 *
 * Anti-falso-verde (padrão de rls_lojas.test.ts / queries_lojas.test.ts):
 *  - negação NUNCA é aceita por "column does not exist": se a coluna sumir, o
 *    teste de constraint exige o nome da constraint na mensagem e falha;
 *  - toda escrita "permitida" e toda negação são reconferidas via asService
 *    (BYPASSRLS) contra o estado real da linha.
 *
 * Nenhum código de produção é escrito aqui. Quem deixa verde é `executar`.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const PRECO = "100.00";

type Cenario = { lojaA: string; lojaB: string; produtoA: string; produtoB: string };

async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a@teste.local'),
       ($2, 'dono-b@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B],
  );
}

/** Loja A (dono A) e loja B (dono B), cada uma com um produto de R$ 100,00. */
async function criarCenario(t: TestDb): Promise<Cenario> {
  await garantirDonos(t);
  return t.asService(async (db) => {
    const lojas = await db.query<{ id: string; dono_id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo) values
         ($1, 'loja-a-desconto', 'Loja A', true),
         ($2, 'loja-b-desconto', 'Loja B', true)
       returning id, dono_id`,
      [DONO_A, DONO_B],
    );
    const lojaA = lojas.rows.find((l) => l.dono_id === DONO_A)!.id;
    const lojaB = lojas.rows.find((l) => l.dono_id === DONO_B)!.id;

    const produtos = await db.query<{ id: string; loja_id: string }>(
      `insert into public.produtos (loja_id, nome, preco) values
         ($1, 'Feijoada A', $3),
         ($2, 'Feijoada B', $3)
       returning id, loja_id`,
      [lojaA, lojaB, PRECO],
    );
    return {
      lojaA,
      lojaB,
      produtoA: produtos.rows.find((p) => p.loja_id === lojaA)!.id,
      produtoB: produtos.rows.find((p) => p.loja_id === lojaB)!.id,
    };
  });
}

/**
 * Roda a escrita como service_role (BYPASSRLS) e devolve a mensagem de erro.
 * Cada chamada é uma transação própria: `withRole` faz rollback ao falhar, e
 * duas escritas falhas no mesmo bloco abortariam a transação.
 */
async function erroDe(t: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await t.asService(async (db) => db.query(sql, params));
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error(`Esperava recusa do banco, mas a escrita PASSOU: ${sql}`);
}

/** Escrita que DEVE ser aceita — devolve a linha gravada, relida via service. */
async function gravar(t: TestDb, sql: string, params: unknown[] = []): Promise<void> {
  await t.asService(async (db) => db.query(sql, params));
}

describe("219 · produtos: colunas de desconto e os cinco CHECKs", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    c = await criarCenario(t);
  });

  afterAll(async () => {
    await t.close();
  });

  // ───────────────────────────────────────────────── colunas e linhas legadas

  it("[RN-07] linha existente nasce desconto_ativo = false com os quatro campos NULL", async () => {
    const linha = await t.asService(async (db) =>
      db.query<{
        desconto_ativo: boolean;
        desconto_tipo: string | null;
        desconto_valor: string | null;
        desconto_inicio: string | null;
        desconto_fim: string | null;
      }>(
        `select desconto_ativo, desconto_tipo, desconto_valor, desconto_inicio, desconto_fim
           from public.produtos where id = $1`,
        [c.produtoA],
      ),
    );
    expect(linha.rows).toHaveLength(1);
    expect(linha.rows[0]).toEqual({
      desconto_ativo: false,
      desconto_tipo: null,
      desconto_valor: null,
      desconto_inicio: null,
      desconto_fim: null,
    });
  });

  it("desconto_ativo é NOT NULL — a coluna não aceita ficar indefinida", async () => {
    const msg = await erroDe(
      t,
      `update public.produtos set desconto_ativo = null where id = $1`,
      [c.produtoA],
    );
    expect(msg).toMatch(/desconto_ativo/);
    expect(msg).toMatch(/null/i);
  });

  // ─────────────────────────────────────────── CHECK 1 · produtos_desconto_tipo_check

  it("[RN-01] tipo fora de ('percentual','fixo') é recusado por produtos_desconto_tipo_check", async () => {
    const msg = await erroDe(
      t,
      `update public.produtos
          set desconto_tipo = 'meio-a-meio', desconto_valor = 10.00
        where id = $1`,
      [c.produtoA],
    );
    expect(msg).toContain("produtos_desconto_tipo_check");
  });

  it("[RN-01] tipo NULL é aceito (desconto não configurado)", async () => {
    await gravar(
      t,
      `update public.produtos
          set desconto_ativo = false, desconto_tipo = null, desconto_valor = null
        where id = $1`,
      [c.produtoA],
    );
  });

  // ───────────────────────────────────── CHECK 2 · produtos_desconto_coerente_check

  it("[RN-07] ativo sem tipo e sem valor é recusado por produtos_desconto_coerente_check", async () => {
    const msg = await erroDe(
      t,
      `update public.produtos
          set desconto_ativo = true, desconto_tipo = null, desconto_valor = null
        where id = $1`,
      [c.produtoA],
    );
    expect(msg).toContain("produtos_desconto_coerente_check");
  });

  it("[RN-07] ativo com tipo mas sem valor é recusado por produtos_desconto_coerente_check", async () => {
    const msg = await erroDe(
      t,
      `update public.produtos
          set desconto_ativo = true, desconto_tipo = 'percentual', desconto_valor = null
        where id = $1`,
      [c.produtoA],
    );
    expect(msg).toContain("produtos_desconto_coerente_check");
  });

  it("[RN-07] DESLIGADO preserva tipo, valor e prazo — a coerência só é exigida quando ativo", async () => {
    await gravar(
      t,
      `update public.produtos
          set desconto_ativo = false,
              desconto_tipo  = 'percentual',
              desconto_valor = 20.00,
              desconto_inicio = timestamptz '2026-01-01 00:00+00',
              desconto_fim    = timestamptz '2026-02-01 00:00+00'
        where id = $1`,
      [c.produtoA],
    );
    const linha = await t.asService(async (db) =>
      db.query<{ desconto_ativo: boolean; desconto_tipo: string; desconto_valor: string }>(
        `select desconto_ativo, desconto_tipo, desconto_valor from public.produtos where id = $1`,
        [c.produtoA],
      ),
    );
    expect(linha.rows[0].desconto_ativo).toBe(false);
    expect(linha.rows[0].desconto_tipo).toBe("percentual");
    expect(Number(linha.rows[0].desconto_valor)).toBe(20);
  });

  // ──────────────────────────────── CHECK 3 · produtos_desconto_percentual_check

  it("[RN-04] percentual 101 é recusado por produtos_desconto_percentual_check", async () => {
    const msg = await erroDe(
      t,
      `update public.produtos
          set desconto_ativo = true, desconto_tipo = 'percentual', desconto_valor = 101.00
        where id = $1`,
      [c.produtoA],
    );
    expect(msg).toContain("produtos_desconto_percentual_check");
  });

  it("[RN-04] percentual 0 é recusado por produtos_desconto_percentual_check (intervalo aberto em 0)", async () => {
    const msg = await erroDe(
      t,
      `update public.produtos
          set desconto_ativo = true, desconto_tipo = 'percentual', desconto_valor = 0.00
        where id = $1`,
      [c.produtoA],
    );
    expect(msg).toContain("produtos_desconto_percentual_check");
  });

  it("[RN-04] percentual 100 é aceito (limite fechado em 100)", async () => {
    await gravar(
      t,
      `update public.produtos
          set desconto_ativo = true, desconto_tipo = 'percentual', desconto_valor = 100.00,
              desconto_inicio = null, desconto_fim = null
        where id = $1`,
      [c.produtoA],
    );
  });

  // ───────────────────────────────────── CHECK 4 · produtos_desconto_fixo_check

  it("[RN-05/RN-06/D10] desconto fixo MAIOR que o preço é recusado por produtos_desconto_fixo_check", async () => {
    const msg = await erroDe(
      t,
      `update public.produtos
          set desconto_ativo = true, desconto_tipo = 'fixo', desconto_valor = 100.01
        where id = $1`,
      [c.produtoA],
    );
    expect(msg).toContain("produtos_desconto_fixo_check");
  });

  it("[RN-06/D10] baixar o PREÇO abaixo do desconto fixo já gravado é recusado (cross-column)", async () => {
    await gravar(
      t,
      `update public.produtos
          set desconto_ativo = true, desconto_tipo = 'fixo', desconto_valor = 30.00,
              desconto_inicio = null, desconto_fim = null
        where id = $1`,
      [c.produtoA],
    );
    // Feijoada a 100,00 com desconto fixo de 30,00; lojista tenta baixar o preço
    // para 25,00. D10: a gravação é RECUSADA — o sistema não corrige sozinho.
    const msg = await erroDe(t, `update public.produtos set preco = 25.00 where id = $1`, [
      c.produtoA,
    ]);
    expect(msg).toContain("produtos_desconto_fixo_check");

    const linha = await t.asService(async (db) =>
      db.query<{ preco: string }>(`select preco from public.produtos where id = $1`, [c.produtoA]),
    );
    expect(Number(linha.rows[0].preco)).toBe(100);
  });

  it("[RN-05] desconto fixo NEGATIVO é recusado por produtos_desconto_fixo_check", async () => {
    const msg = await erroDe(
      t,
      `update public.produtos
          set desconto_ativo = true, desconto_tipo = 'fixo', desconto_valor = -50.00
        where id = $1`,
      [c.produtoA],
    );
    expect(msg).toContain("produtos_desconto_fixo_check");
  });

  it("[RN-05] desconto fixo ZERO é recusado por produtos_desconto_fixo_check", async () => {
    const msg = await erroDe(
      t,
      `update public.produtos
          set desconto_ativo = true, desconto_tipo = 'fixo', desconto_valor = 0
        where id = $1`,
      [c.produtoA],
    );
    expect(msg).toContain("produtos_desconto_fixo_check");
  });

  it("[RN-05] desconto fixo IGUAL ao preço é aceito (limite fechado)", async () => {
    await gravar(
      t,
      `update public.produtos
          set desconto_ativo = true, desconto_tipo = 'fixo', desconto_valor = 100.00
        where id = $1`,
      [c.produtoA],
    );
  });

  // ──────────────────────────────────── CHECK 5 · produtos_desconto_prazo_check

  it("[RN-03] desconto_fim IGUAL ao início é recusado por produtos_desconto_prazo_check", async () => {
    const msg = await erroDe(
      t,
      `update public.produtos
          set desconto_inicio = timestamptz '2026-03-01 12:00+00',
              desconto_fim    = timestamptz '2026-03-01 12:00+00'
        where id = $1`,
      [c.produtoA],
    );
    expect(msg).toContain("produtos_desconto_prazo_check");
  });

  it("[RN-03] desconto_fim ANTES do início é recusado por produtos_desconto_prazo_check", async () => {
    const msg = await erroDe(
      t,
      `update public.produtos
          set desconto_inicio = timestamptz '2026-03-02 12:00+00',
              desconto_fim    = timestamptz '2026-03-01 12:00+00'
        where id = $1`,
      [c.produtoA],
    );
    expect(msg).toContain("produtos_desconto_prazo_check");
  });

  it("[RN-03] prazo pela metade (só início, ou só fim) é aceito — sem prazo = vigente até desligar", async () => {
    await gravar(
      t,
      `update public.produtos
          set desconto_inicio = timestamptz '2026-03-01 12:00+00', desconto_fim = null
        where id = $1`,
      [c.produtoA],
    );
    await gravar(
      t,
      `update public.produtos
          set desconto_inicio = null, desconto_fim = timestamptz '2026-03-01 12:00+00'
        where id = $1`,
      [c.produtoA],
    );
    await gravar(
      t,
      `update public.produtos set desconto_inicio = null, desconto_fim = null where id = $1`,
      [c.produtoA],
    );
  });

  // ───────────────────────────────────────── escopo cross-loja (fatia crítica 6)

  it("lojista A NÃO liga desconto em produto da loja B — 0 linhas e a linha de B não muda", async () => {
    const afetadas = await t.asUser(DONO_A, async (db) => {
      const r = await db.query(
        `update public.produtos
            set desconto_ativo = true, desconto_tipo = 'percentual', desconto_valor = 90.00
          where id = $1
          returning id`,
        [c.produtoB],
      );
      return r.rows.length;
    });
    expect(afetadas).toBe(0);

    const b = await t.asService(async (db) =>
      db.query<{ desconto_ativo: boolean; desconto_valor: string | null }>(
        `select desconto_ativo, desconto_valor from public.produtos where id = $1`,
        [c.produtoB],
      ),
    );
    expect(b.rows[0].desconto_ativo).toBe(false);
    expect(b.rows[0].desconto_valor).toBeNull();
  });

  it("lojista A NÃO insere produto com desconto na loja B — mensagem nomeia a RLS de produtos", async () => {
    let msg = "";
    try {
      await t.asUser(DONO_A, async (db) =>
        db.query(
          `insert into public.produtos
             (loja_id, nome, preco, desconto_ativo, desconto_tipo, desconto_valor)
           values ($1, 'Invasao', 50.00, true, 'percentual', 50.00)`,
          [c.lojaB],
        ),
      );
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toMatch(/row-level security policy/i);
    expect(msg).toContain("produtos");

    const contagem = await t.asService(async (db) =>
      db.query<{ n: string }>(
        `select count(*)::text as n from public.produtos where loja_id = $1`,
        [c.lojaB],
      ),
    );
    expect(Number(contagem.rows[0].n)).toBe(1);
  });

  it("lojista A não enxerga a configuração de desconto de produto da loja B pelo painel", async () => {
    await gravar(
      t,
      `update public.produtos
          set desconto_ativo = true, desconto_tipo = 'percentual', desconto_valor = 15.00
        where id = $1`,
      [c.produtoB],
    );
    // Sem cláusula de escopo na consulta: quem tem de negar é a RLS, não o WHERE
    // do próprio teste. Com `and loja_id in (...)` o caso passaria mesmo com a
    // leitura escancarada.
    const vistas = await t.asUser(DONO_A, async (db) => {
      const r = await db.query(
        `select desconto_ativo, desconto_tipo, desconto_valor
           from public.produtos where id = $1`,
        [c.produtoB],
      );
      return r.rows.length;
    });
    expect(vistas).toBe(0);
  });
});
