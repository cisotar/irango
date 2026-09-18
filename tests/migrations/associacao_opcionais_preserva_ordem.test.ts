import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, type TestDb } from "../helpers/pglite";
import { planejarAssociacaoOpcionais } from "../../src/lib/utils/associacao-opcionais";

/**
 * Fase RED (TDD) da issue 208 — RN-12: salvar a ASSOCIAÇÃO (checkbox) não pode
 * zerar a `ordem` dos grupos que permanecem.
 *
 * Hoje `salvarAssociacaoOpcionais` (src/lib/actions/opcional.ts:316-341) faz
 * `delete` do conjunto inteiro da categoria + `insert` da seleção. Com a coluna
 * `ordem` da migration 1, isso apagaria a ordem A CADA CLIQUE de checkbox — as
 * linhas renasceriam todas em `ordem = 0` (o default).
 *
 * ─────────────────────── O que este arquivo põe sob contrato
 * O cálculo do novo conjunto vira uma FUNÇÃO PURA compartilhada,
 * `planejarAssociacaoOpcionais` em `src/lib/utils/associacao-opcionais.ts`, para
 * que a via do lojista (`salvarAssociacaoOpcionais`) e a via admin
 * (`salvarAssociacaoOpcionaisAdmin`) usem a MESMA regra — a issue exige
 * explicitamente "não duplicar" (tasks/208, bloco RN-12).
 *
 * O módulo NÃO existe: o import acima falha hoje e derruba o arquivo inteiro.
 * É esse o vermelho. Nenhuma linha de produção é escrita aqui.
 *
 * ─────────────────────── Por que em pglite e não só em node
 * A função é pura, mas a garantia da RN-12 é sobre o ESTADO FINAL DA TABELA sob
 * as constraints reais: `unique (categoria_id, categoria_opcional_id)`, as FKs
 * compostas mesma-loja e a policy `cat_prod_opc_escrita_propria`. O teste aplica
 * o plano como o DONO (RLS ligada), exatamente como a Server Action fará, e só
 * então lê a `ordem` pela fonte de verdade.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

type Cenario = {
  lojaA: string;
  catLanches: string;
  gMolhos: string;
  gAdicionais: string;
  gBebidas: string;
  gSobremesas: string;
};

/** Lanches já REORDENADO: Bebidas 0, Molhos 1, Adicionais 2. Sobremesas fora. */
const ORDEM_INICIAL: Record<"bebidas" | "molhos" | "adicionais", number> = {
  bebidas: 0,
  molhos: 1,
  adicionais: 2,
};

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
       values ($1, 'loja-a-assoc-opc', 'Loja A', true) returning id`,
      [DONO_A],
    );
    const grupo = (nome: string, ordem: number) =>
      um(
        `insert into public.opcionais_categorias (loja_id, nome, ordem) values ($1,$2,$3) returning id`,
        [lojaA, nome, ordem],
      );
    const c: Cenario = {
      lojaA,
      catLanches: await um(
        `insert into public.categorias (loja_id, nome, ordem) values ($1,'Lanches',0) returning id`,
        [lojaA],
      ),
      gMolhos: await grupo("Molhos", 0),
      gAdicionais: await grupo("Adicionais", 1),
      gBebidas: await grupo("Bebidas", 2),
      gSobremesas: await grupo("Sobremesas", 3),
    };
    return c;
  });
}

/** Recria o estado "já reordenado" de Lanches antes de cada caso. */
async function restaurarBaseline(t: TestDb, c: Cenario): Promise<void> {
  await t.asService(async (db) => {
    await db.query(
      `delete from public.categoria_produto_opcionais where categoria_id = $1`,
      [c.catLanches],
    );
    const assoc = (grupoId: string, ordem: number) =>
      db.query(
        `insert into public.categoria_produto_opcionais
           (loja_id, categoria_id, categoria_opcional_id, ordem)
         values ($1,$2,$3,$4)`,
        [c.lojaA, c.catLanches, grupoId, ordem],
      );
    await assoc(c.gBebidas, ORDEM_INICIAL.bebidas);
    await assoc(c.gMolhos, ORDEM_INICIAL.molhos);
    await assoc(c.gAdicionais, ORDEM_INICIAL.adicionais);
  });
}

/**
 * Executa o plano da função pura como o DONO (RLS ligada), no formato que a
 * Server Action usará: um delete escopado dos removidos + um insert dos novos.
 * Os que permanecem não são tocados — é assim que a `ordem` sobrevive.
 */
async function aplicarPlano(
  db: PGlite,
  c: Cenario,
  plano: ReturnType<typeof planejarAssociacaoOpcionais>,
): Promise<void> {
  for (const grupoId of plano.remover) {
    await db.query(
      `delete from public.categoria_produto_opcionais
        where loja_id = $1 and categoria_id = $2 and categoria_opcional_id = $3`,
      [c.lojaA, c.catLanches, grupoId],
    );
  }
  for (const linha of plano.inserir) {
    await db.query(
      `insert into public.categoria_produto_opcionais
         (loja_id, categoria_id, categoria_opcional_id, ordem)
       values ($1,$2,$3,$4)`,
      [c.lojaA, c.catLanches, linha.categoria_opcional_id, linha.ordem],
    );
  }
}

/** As associações atuais da categoria, como a action as lerá antes de planejar. */
async function atuais(
  t: TestDb,
  c: Cenario,
): Promise<Array<{ categoria_opcional_id: string; ordem: number }>> {
  const r = await t.asService((db) =>
    db.query<{ categoria_opcional_id: string; ordem: number }>(
      `select categoria_opcional_id, ordem from public.categoria_produto_opcionais
        where loja_id = $1 and categoria_id = $2 order by ordem asc`,
      [c.lojaA, c.catLanches],
    ),
  );
  return r.rows.map((l) => ({
    categoria_opcional_id: l.categoria_opcional_id,
    ordem: Number(l.ordem),
  }));
}

/** Ids da categoria na ordem em que a vitrine os mostrará. */
async function sequenciaNaVitrine(t: TestDb, c: Cenario): Promise<string[]> {
  const r = await t.asService((db) =>
    db.query<{ categoria_opcional_id: string }>(
      `select cpo.categoria_opcional_id
         from public.categoria_produto_opcionais cpo
         join public.opcionais_categorias oc on oc.id = cpo.categoria_opcional_id
        where cpo.loja_id = $1 and cpo.categoria_id = $2
        order by cpo.ordem asc, oc.nome asc`,
      [c.lojaA, c.catLanches],
    ),
  );
  return r.rows.map((l) => l.categoria_opcional_id);
}

describe("208 RN-12 — salvar a associação preserva a ordem dos grupos que permanecem", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    c = await semear(t);
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await restaurarBaseline(t, c);
  });

  // ───────────────────────── A1 — marcar um grupo novo
  it("[208-A1] marcar um grupo novo preserva a ordem dos 3 antigos e põe o novo no FIM", async () => {
    const antes = await atuais(t, c);
    const plano = planejarAssociacaoOpcionais(antes, [
      c.gBebidas,
      c.gMolhos,
      c.gAdicionais,
      c.gSobremesas,
    ]);
    // Nenhum grupo saiu: a action não pode deletar o que permanece (é esse
    // `delete` de tudo que hoje apagaria a ordem).
    expect(plano.remover).toEqual([]);
    expect(plano.inserir).toEqual([{ categoria_opcional_id: c.gSobremesas, ordem: 3 }]);

    await t.asUser(DONO_A, (db) => aplicarPlano(db, c, plano));

    expect(await sequenciaNaVitrine(t, c)).toEqual([
      c.gBebidas,
      c.gMolhos,
      c.gAdicionais,
      c.gSobremesas,
    ]);
    const depois = new Map((await atuais(t, c)).map((l) => [l.categoria_opcional_id, l.ordem]));
    expect(depois.get(c.gBebidas)).toBe(ORDEM_INICIAL.bebidas);
    expect(depois.get(c.gMolhos)).toBe(ORDEM_INICIAL.molhos);
    expect(depois.get(c.gAdicionais)).toBe(ORDEM_INICIAL.adicionais);
    expect(depois.get(c.gSobremesas)).toBe(3);
  });

  // ───────────────────────── A2 — desmarcar um do meio e marcar outro
  it("[208-A2] desmarcar o do meio e marcar um novo: os que ficam mantêm a ordem RELATIVA, o novo vai pro fim", async () => {
    const antes = await atuais(t, c);
    // Bebidas(0) e Adicionais(2) ficam; Molhos(1) sai; Sobremesas entra.
    const plano = planejarAssociacaoOpcionais(antes, [
      c.gBebidas,
      c.gAdicionais,
      c.gSobremesas,
    ]);
    expect(plano.remover).toEqual([c.gMolhos]);
    // O novo entra em max(ordem dos que ficam) + 1 = 3 — nunca disputando
    // posição com quem já estava.
    expect(plano.inserir).toEqual([{ categoria_opcional_id: c.gSobremesas, ordem: 3 }]);

    await t.asUser(DONO_A, (db) => aplicarPlano(db, c, plano));

    expect(await sequenciaNaVitrine(t, c)).toEqual([c.gBebidas, c.gAdicionais, c.gSobremesas]);
    const depois = new Map((await atuais(t, c)).map((l) => [l.categoria_opcional_id, l.ordem]));
    expect(depois.get(c.gBebidas)).toBe(ORDEM_INICIAL.bebidas);
    expect(depois.get(c.gAdicionais)).toBe(ORDEM_INICIAL.adicionais);
    expect(depois.has(c.gMolhos)).toBe(false);
  });

  // ───────────────────────── A3 — desmarcar tudo
  it("[208-A3] desmarcar todos remove as 3 associações e não insere nada", async () => {
    const plano = planejarAssociacaoOpcionais(await atuais(t, c), []);
    expect(new Set(plano.remover)).toEqual(new Set([c.gBebidas, c.gMolhos, c.gAdicionais]));
    expect(plano.inserir).toEqual([]);

    await t.asUser(DONO_A, (db) => aplicarPlano(db, c, plano));
    expect(await sequenciaNaVitrine(t, c)).toEqual([]);
  });

  // ───────────────────────── A4 — primeira associação da categoria
  it("[208-A4] categoria sem nenhuma associação: os marcados entram a partir de 0, na ordem recebida", async () => {
    await t.asService((db) =>
      db.query(`delete from public.categoria_produto_opcionais where categoria_id = $1`, [
        c.catLanches,
      ]),
    );

    const plano = planejarAssociacaoOpcionais([], [c.gMolhos, c.gBebidas]);
    expect(plano.remover).toEqual([]);
    expect(plano.inserir).toEqual([
      { categoria_opcional_id: c.gMolhos, ordem: 0 },
      { categoria_opcional_id: c.gBebidas, ordem: 1 },
    ]);

    await t.asUser(DONO_A, (db) => aplicarPlano(db, c, plano));
    expect(await sequenciaNaVitrine(t, c)).toEqual([c.gMolhos, c.gBebidas]);
  });

  // ───────────────────────── A5 — salvar sem mudar nada é NO-OP
  it("[208-A5] salvar a mesma seleção é no-op: nada a remover, nada a inserir, ordem idêntica", async () => {
    // O caso mais comum do painel (re-salvar sem mexer) é o que mais doeria com
    // o delete+insert de hoje: a ordem seria zerada sem nenhuma mudança real.
    const antes = await atuais(t, c);
    const plano = planejarAssociacaoOpcionais(antes, [
      c.gBebidas,
      c.gMolhos,
      c.gAdicionais,
    ]);
    expect(plano.remover).toEqual([]);
    expect(plano.inserir).toEqual([]);

    await t.asUser(DONO_A, (db) => aplicarPlano(db, c, plano));
    expect(await atuais(t, c)).toEqual(antes);
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 208, RN-12:
 *
 * Criar `src/lib/utils/associacao-opcionais.ts`:
 *
 *   export type AssociacaoOpcionalAtual = {
 *     categoria_opcional_id: string;
 *     ordem: number;
 *   };
 *   export type PlanoAssociacaoOpcionais = {
 *     remover: string[];   // categoria_opcional_id associados que saíram
 *     inserir: Array<{ categoria_opcional_id: string; ordem: number }>;
 *   };
 *   export function planejarAssociacaoOpcionais(
 *     atuais: readonly AssociacaoOpcionalAtual[],
 *     marcados: readonly string[],
 *   ): PlanoAssociacaoOpcionais;
 *
 *   - quem permanece NÃO aparece no plano: a linha não é tocada e a `ordem`
 *     sobrevive por construção                                   [A1, A2, A5]
 *   - `remover` = atuais \ marcados                               [A2, A3]
 *   - `inserir` = marcados \ atuais, na ordem em que vieram, com
 *     ordem = max(ordem dos que permanecem) + 1, + 2, …           [A1, A2]
 *   - sem nenhum que permaneça, a numeração começa em 0           [A4]
 *
 * E usar essa função nas DUAS vias, sem duplicar a regra:
 *   - src/lib/actions/opcional.ts :: salvarAssociacaoOpcionais
 *     (substituindo o `delete` + `insert` do conjunto inteiro, linhas 316-341)
 *   - src/app/admin/assinantes/actions/admin-opcionais.ts ::
 *     salvarAssociacaoOpcionaisAdmin
 *
 * Depende da migration 1 (coluna `ordem`).
 */
