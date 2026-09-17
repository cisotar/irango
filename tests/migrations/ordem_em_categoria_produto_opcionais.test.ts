import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 208 — Migration 1: coluna
 * `categoria_produto_opcionais.ordem` + BACKFILL neutro (RN-13) + índice.
 * Spec: specs/opcionais-sanfona-e-ordenacao.md (v0.2.0), "Migration 1".
 *
 * NADA de produção existe hoje: não há
 * `supabase/migrations/<ts>_ordem_em_categoria_produto_opcionais.sql`. Logo:
 *  - todo SELECT/INSERT que cita `ordem` falha com 42703 (undefined_column);
 *  - `sqlDoBackfill()` lança porque o arquivo da migration não está no diretório.
 * É exatamente esse o vermelho. Quem deixa verde é a fase GREEN (`executar`).
 *
 * ─────────────────────── Por que o backfill é lido DO ARQUIVO da migration
 * O backfill roda UMA vez, no instante em que a migration é aplicada — e o
 * harness (`createTestDb`) aplica as migrations sobre um banco VAZIO, antes de
 * qualquer seed do teste. Reescrever o `update` à mão dentro do teste (padrão
 * de 073, tests/migrations/lojas_expand_billing.test.ts:256) provaria só que o
 * enunciado COPIADO funciona: ele sairia de sincronia com a migration real sem
 * ninguém notar. Aqui o teste EXTRAI o(s) `update` do próprio arquivo e o
 * executa sobre o cenário semeado — se a migration mudar o backfill, este teste
 * acompanha.
 *
 * ─────────────────────── Anti-falso-verde
 * O cenário é semeado DEPOIS das migrations, então todas as linhas nascem com
 * `ordem = 0` (o default). O teste confirma esse pré-estado (`[208-M1-2]`) antes
 * de aplicar o backfill: sem isso, um backfill que não fizesse nada passaria se
 * por acaso o valor esperado fosse 0.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Conteúdo da migration 1, localizada pelo sufixo do nome (o `<ts>` é livre). */
function arquivoDaMigration(): string {
  const nome = readdirSync(MIGRATIONS_DIR).find((f) =>
    f.endsWith("_ordem_em_categoria_produto_opcionais.sql"),
  );
  if (nome == null) {
    throw new Error(
      "RED: migration `<ts>_ordem_em_categoria_produto_opcionais.sql` não existe em supabase/migrations/",
    );
  }
  return readFileSync(join(MIGRATIONS_DIR, nome), "utf8");
}

/**
 * Os comandos de BACKFILL da migration (todo statement que começa com `update`),
 * sem comentários de linha. O `alter table` e o `create index` ficam de fora:
 * eles já rodaram no harness.
 */
function sqlDoBackfill(): string[] {
  const semComentarios = arquivoDaMigration()
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  const statements = semComentarios
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.toLowerCase().startsWith("update"));
  if (statements.length === 0) {
    throw new Error("RED: a migration não contém nenhum `update` de backfill");
  }
  return statements;
}

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

type Cenario = {
  lojaA: string;
  /** Categorias de PRODUTO. */
  catLanches: string;
  catPorcoes: string;
  /** Categorias de OPCIONAL (grupos). */
  gAdicionais: string;
  gBebidas: string;
  gMolhos: string;
};

/**
 * Loja A com 2 categorias de produto e 3 grupos de opcional cujos
 * `opcionais_categorias.ordem` forçam os DOIS critérios da RN-13:
 *   Adicionais → ordem 0            (vence por ordem)
 *   Bebidas    → ordem 1, "Bebidas" (empata em ordem, vence por nome)
 *   Molhos     → ordem 1, "Molhos"
 *
 * Associações:
 *   Lanches ⋈ {Adicionais, Bebidas, Molhos}  → backfill esperado 0, 1, 2
 *   Porções ⋈ {Bebidas, Molhos}              → backfill esperado 0, 1
 *
 * Molhos aparece nas duas: ordem 2 em Lanches e 1 em Porções. É a prova da
 * numeração INDEPENDENTE por par (loja, categoria de produto) — RN-10/RN-13.
 */
async function semear(t: TestDb): Promise<Cenario> {
  await t.db.query(
    `insert into auth.users (id, email) values ($1, 'dono-a@teste.local')
     on conflict (id) do nothing`,
    [DONO_A],
  );
  return t.asService(async (db) => {
    const um = async (sql: string, params: unknown[]) => {
      const r = await db.query<{ id: string }>(sql, params);
      return r.rows[0].id;
    };
    const lojaA = await um(
      `insert into public.lojas (dono_id, slug, nome, ativo)
       values ($1, 'loja-a-ordem-opc', 'Loja A', true) returning id`,
      [DONO_A],
    );
    const catProduto = (nome: string, ordem: number) =>
      um(
        `insert into public.categorias (loja_id, nome, ordem) values ($1, $2, $3) returning id`,
        [lojaA, nome, ordem],
      );
    const grupo = (nome: string, ordem: number) =>
      um(
        `insert into public.opcionais_categorias (loja_id, nome, ordem)
         values ($1, $2, $3) returning id`,
        [lojaA, nome, ordem],
      );

    const c: Cenario = {
      lojaA,
      catLanches: await catProduto("Lanches", 0),
      catPorcoes: await catProduto("Porções", 1),
      gAdicionais: await grupo("Adicionais", 0),
      gBebidas: await grupo("Bebidas", 1),
      gMolhos: await grupo("Molhos", 1),
    };

    // Ordem de INSERÇÃO propositalmente embaralhada: o backfill tem que derivar
    // a posição de `opcionais_categorias.ordem`/`nome`, nunca da ordem física
    // das linhas nem do `id`.
    const assoc = (catId: string, grupoId: string) =>
      db.query(
        `insert into public.categoria_produto_opcionais (loja_id, categoria_id, categoria_opcional_id)
         values ($1, $2, $3)`,
        [lojaA, catId, grupoId],
      );
    await assoc(c.catLanches, c.gMolhos);
    await assoc(c.catLanches, c.gAdicionais);
    await assoc(c.catLanches, c.gBebidas);
    await assoc(c.catPorcoes, c.gMolhos);
    await assoc(c.catPorcoes, c.gBebidas);

    return c;
  });
}

/** `ordem` da associação (loja, categoria de produto, grupo) — via BYPASSRLS. */
async function ordemDe(
  t: TestDb,
  c: Cenario,
  catId: string,
  grupos: readonly string[],
): Promise<number[]> {
  const r = await t.asService((db) =>
    db.query<{ categoria_opcional_id: string; ordem: number }>(
      `select categoria_opcional_id, ordem
         from public.categoria_produto_opcionais
        where loja_id = $1 and categoria_id = $2`,
      [c.lojaA, catId],
    ),
  );
  const porGrupo = new Map(r.rows.map((l) => [l.categoria_opcional_id, Number(l.ordem)]));
  return grupos.map((g) => porGrupo.get(g) ?? -1);
}

describe("208 migration 1 — categoria_produto_opcionais.ordem + backfill (RN-13)", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    c = await semear(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ───────────────────────────────────── M1-1 — a coluna existe e é not null 0
  it("[208-M1-1] a coluna `ordem` existe, é NOT NULL e tem default 0", async () => {
    // Leitura real em vez de introspecção frágil: se a coluna não existir, o
    // SELECT lança 42703 — o RED de hoje.
    const r = await t.asService((db) =>
      db.query<{ ordem: number }>(
        `select ordem from public.categoria_produto_opcionais
          where loja_id = $1 and categoria_id = $2 and categoria_opcional_id = $3`,
        [c.lojaA, c.catLanches, c.gMolhos],
      ),
    );
    expect(Number(r.rows[0].ordem)).toBe(0);

    // NOT NULL: gravar null tem que ser recusado (23502).
    let code: string | null = null;
    try {
      await t.asService((db) =>
        db.query(
          `update public.categoria_produto_opcionais set ordem = null
            where loja_id = $1 and categoria_id = $2`,
          [c.lojaA, c.catLanches],
        ),
      );
    } catch (err) {
      code = (err as { code?: string }).code ?? "SEM_CODE";
    }
    expect(code).toBe("23502");
  });

  // ───────────────────────────────────── M1-2 — pré-estado (anti-falso-verde)
  it("[208-M1-2] antes do backfill, as linhas semeadas estão todas em ordem = 0", async () => {
    // Sem esta asserção, um backfill que não fizesse NADA passaria em qualquer
    // caso cuja posição esperada fosse 0.
    expect(await ordemDe(t, c, c.catLanches, [c.gAdicionais, c.gBebidas, c.gMolhos])).toEqual([
      0, 0, 0,
    ]);
    expect(await ordemDe(t, c, c.catPorcoes, [c.gBebidas, c.gMolhos])).toEqual([0, 0]);
  });

  // ───────────────────────────────────── M1-3 — RN-13: 3 grupos viram 0, 1, 2
  it("[208-M1-3] backfill dá 0,1,2 seguindo opcionais_categorias.ordem com desempate por nome", async () => {
    for (const sql of sqlDoBackfill()) {
      await t.asService((db) => db.query(sql));
    }

    // Adicionais (ordem 0) → 0; Bebidas e Molhos empatam em ordem 1 e o nome
    // decide: "Bebidas" → 1, "Molhos" → 2.
    expect(await ordemDe(t, c, c.catLanches, [c.gAdicionais, c.gBebidas, c.gMolhos])).toEqual([
      0, 1, 2,
    ]);
  });

  // ───────────────────────────────────── M1-4 — RN-10: numeração independente
  it("[208-M1-4] duas categorias de produto que compartilham um grupo recebem numeração independente", async () => {
    // Depende do backfill aplicado em [208-M1-3] (mesmo describe, ordem de
    // declaração). Porções tem só Bebidas e Molhos → 0 e 1. Molhos, que em
    // Lanches ficou em 2, aqui é 1: a `ordem` é do PAR (loja, categoria de
    // produto), nunca da loja inteira.
    expect(await ordemDe(t, c, c.catPorcoes, [c.gBebidas, c.gMolhos])).toEqual([0, 1]);

    const emLanches = await ordemDe(t, c, c.catLanches, [c.gMolhos]);
    const emPorcoes = await ordemDe(t, c, c.catPorcoes, [c.gMolhos]);
    expect(emLanches).toEqual([2]);
    expect(emPorcoes).toEqual([1]);
    expect(emLanches).not.toEqual(emPorcoes);
  });

  // ───────────────────────────────────── M1-5 — sem política RLS nova
  it("[208-M1-5] a coluna entra sob as políticas existentes: o dono escreve `ordem`, anon não", async () => {
    // A issue afirma que NENHUMA policy nova é necessária
    // (cat_prod_opc_escrita_propria já cobre). Isto é conferido, não presumido.
    const afetadas = await t.asUser(DONO_A, async (db) => {
      const r = await db.query(
        `update public.categoria_produto_opcionais set ordem = 7
          where loja_id = $1 and categoria_id = $2 and categoria_opcional_id = $3`,
        [c.lojaA, c.catLanches, c.gMolhos],
      );
      return r.affectedRows ?? 0;
    });
    expect(afetadas).toBe(1);
    expect(await ordemDe(t, c, c.catLanches, [c.gMolhos])).toEqual([7]);

    // anon: a policy de escrita não o alcança → 0 linhas, valor intacto.
    const afetadasAnon = await t.asAnon(async (db) => {
      const r = await db.query(
        `update public.categoria_produto_opcionais set ordem = 99
          where loja_id = $1 and categoria_id = $2`,
        [c.lojaA, c.catLanches],
      );
      return r.affectedRows ?? 0;
    });
    expect(afetadasAnon).toBe(0);
    expect(await ordemDe(t, c, c.catLanches, [c.gMolhos])).toEqual([7]);
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 208, migration 1:
 *
 * `supabase/migrations/<ts>_ordem_em_categoria_produto_opcionais.sql`
 *   1) alter table public.categoria_produto_opcionais
 *        add column ordem int not null default 0;                    [M1-1]
 *   2) BACKFILL num statement que COMECE com `update` (o teste extrai todos os
 *      `update` do arquivo e os executa):                            [M1-3, M1-4]
 *        update public.categoria_produto_opcionais cpo
 *           set ordem = pos
 *          from (select cpo2.id,
 *                       row_number() over (partition by cpo2.loja_id, cpo2.categoria_id
 *                                          order by oc.ordem, oc.nome) - 1 as pos
 *                  from public.categoria_produto_opcionais cpo2
 *                  join public.opcionais_categorias oc
 *                    on oc.id = cpo2.categoria_opcional_id) s
 *         where cpo.id = s.id;
 *      (a forma exata é livre; o contrato é o RESULTADO das asserções)
 *   3) create index on public.categoria_produto_opcionais (loja_id, categoria_id, ordem);
 *   4) NENHUMA policy nova — cat_prod_opc_escrita_propria/leitura_publica já
 *      cobrem a coluna.                                              [M1-5]
 */
