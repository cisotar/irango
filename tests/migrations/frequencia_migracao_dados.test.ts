import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 320 — migração de DADOS: todo produto
 * `visibilidade = 'cardapio'` volta a `'menu'` (permanente). Nada é convertido
 * para frequência; `cardapios`/`cardapio_produtos` ficam intactos (RN-4, S5).
 *
 * Autoridade: specs/frequencia-exibicao.md RN-4 ·
 * plan/tecnico-frequencia-exibicao.md C1 (`20260928132000_…volta_ao_menu.sql`),
 * D9 ("isolar o UPDATE torna a migração testável de verdade").
 *
 * Por que o arquivo é REEXECUTADO: no pglite o banco nasce vazio e
 * `createTestDb()` já aplica todas as migrations — `count = 0` logo depois seria
 * vácuo. O teste semeia um produto `'cardapio'` com vínculo real (o trigger
 * RN-14 exige) e roda o SQL da migration de novo sobre esse estado. Ele é
 * idempotente por contrato, então rodar duas vezes é parte da prova.
 *
 * Hoje o arquivo não existe ⇒ o RED é "migration ausente".
 */

const MIGRATION = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260928132000_frequencia_cardapio_volta_ao_menu.sql",
);

function lerMigracao(): string {
  if (!existsSync(MIGRATION)) {
    throw new Error(
      "[RED 320] `supabase/migrations/20260928132000_frequencia_cardapio_volta_ao_menu.sql` " +
        "ainda não existe (C1 do plano técnico).",
    );
  }
  return readFileSync(MIGRATION, "utf8");
}

/** O SQL sem comentários de linha: a guarda olha o que EXECUTA. */
function semComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

const DONO = "dddddddd-dddd-4ddd-8ddd-dd0000000320";

type Cenario = { lojaId: string; cardapioId: string; prodCardapio: string; prodMenu: string };

let t: TestDb;
let c: Cenario;

type FotoJuncoes = {
  vinculos: { id: string; cardapio_id: string; produto_id: string; loja_id: string; dias_semana: number[] | null }[];
  cardapios: { id: string; nome: string; ativo: boolean; modo: string; dias_semana: number[] | null }[];
};

async function fotoJuncoes(): Promise<FotoJuncoes> {
  return t.asService(async (s) => {
    const v = await s.query<FotoJuncoes["vinculos"][number]>(
      `select id, cardapio_id, produto_id, loja_id, dias_semana
         from public.cardapio_produtos order by id`,
    );
    const k = await s.query<FotoJuncoes["cardapios"][number]>(
      `select id, nome, ativo, modo, dias_semana from public.cardapios order by id`,
    );
    return { vinculos: v.rows, cardapios: k.rows };
  });
}

async function linhaProduto(id: string) {
  const r = await t.asService((s) =>
    s.query<Record<string, unknown>>(`select * from public.produtos where id = $1`, [id]),
  );
  return r.rows[0];
}

beforeAll(async () => {
  t = await createTestDb();
  await t.db.query(
    `insert into auth.users (id, email) values ($1, 'dono-migracao-320@teste.local') on conflict (id) do nothing`,
    [DONO],
  );
  c = await t.asService(async (s) => {
    const loja = await s.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1, 'loja-mig-320', 'Loja Mig 320', true) returning id`,
      [DONO],
    );
    const lojaId = loja.rows[0].id;
    const card = await s.query<{ id: string }>(
      `insert into public.cardapios (loja_id, nome, ativo, modo, dias_semana)
       values ($1, 'Especiais do Dia', true, 'recorrente', array[0,1,2,3,4,5,6]::smallint[]) returning id`,
      [lojaId],
    );
    const prods = await s.query<{ id: string; nome: string }>(
      `insert into public.produtos (loja_id, nome, preco, disponivel, oculto, ordem) values
         ($1, 'Feijoada exclusiva', 45, true, false, 0),
         ($1, 'Coca do menu',       10, true, false, 1)
       returning id, nome`,
      [lojaId],
    );
    const p = (n: string) => prods.rows.find((x) => x.nome === n)!.id;
    return { lojaId, cardapioId: card.rows[0].id, prodCardapio: p("Feijoada exclusiva"), prodMenu: p("Coca do menu") };
  });
  // Marca + vincula na MESMA transação (o trigger RN-14 é deferido ao COMMIT).
  await t.asService(async (s) => {
    await s.query(
      `insert into public.cardapio_produtos (loja_id, cardapio_id, produto_id, dias_semana)
       values ($1, $2, $3, array[3,6]::smallint[])`,
      [c.lojaId, c.cardapioId, c.prodCardapio],
    );
    await s.query(`update public.produtos set visibilidade = 'cardapio' where id = $1`, [c.prodCardapio]);
  });
}, 60_000);

afterAll(async () => {
  await t?.close();
});

describe("[320/RN-4] produtos 'cardapio' voltam a 'menu', nada é convertido", () => {
  it("pré-condição: o cenário TEM um produto 'cardapio' com vínculo (senão o teste seria vácuo)", async () => {
    const r = await t.asService((s) =>
      s.query<{ n: number }>(`select count(*)::int as n from public.produtos where visibilidade = 'cardapio'`),
    );
    expect(r.rows[0].n).toBe(1);
  });

  it("aplicar a migration: 0 'cardapio', junções idênticas, 5 colunas de frequência null, menu intacto", async () => {
    const sql = lerMigracao();
    const antesJuncoes = await fotoJuncoes();
    const antesMenu = await linhaProduto(c.prodMenu);
    expect(antesJuncoes.vinculos).toHaveLength(1);

    await t.db.exec(sql);

    const r = await t.asService((s) =>
      s.query<{ n: number }>(`select count(*)::int as n from public.produtos where visibilidade = 'cardapio'`),
    );
    expect(r.rows[0].n).toBe(0);

    // cardapio_produtos e cardapios byte a byte (ids, produto_id, cardapio_id, dias_semana).
    expect(await fotoJuncoes()).toEqual(antesJuncoes);

    const migrado = await linhaProduto(c.prodCardapio);
    expect(migrado.visibilidade).toBe("menu");
    // RN-4: nada virou frequência — as 5 colunas continuam NULL (não '{}').
    expect({
      dias_semana: migrado.dias_semana,
      hora_inicio: migrado.hora_inicio,
      hora_fim: migrado.hora_fim,
      periodo_inicio: migrado.periodo_inicio,
      periodo_fim: migrado.periodo_fim,
    }).toEqual({
      dias_semana: null,
      hora_inicio: null,
      hora_fim: null,
      periodo_inicio: null,
      periodo_fim: null,
    });

    // O produto que já era 'menu' não muda em nada (exceto o que o trigger de
    // `atualizado_em` faria se fosse tocado — e ele NÃO deve ser tocado).
    expect(await linhaProduto(c.prodMenu)).toEqual(antesMenu);
  });

  it("reexecutar a migration não lança e não muda nada (idempotente)", async () => {
    const sql = lerMigracao();
    const antesJuncoes = await fotoJuncoes();
    const antesProd = await linhaProduto(c.prodCardapio);
    const antesMenu = await linhaProduto(c.prodMenu);

    await expect(t.db.exec(sql)).resolves.toBeDefined();

    expect(await fotoJuncoes()).toEqual(antesJuncoes);
    expect(await linhaProduto(c.prodCardapio)).toEqual(antesProd);
    expect(await linhaProduto(c.prodMenu)).toEqual(antesMenu);
  });

  it("guarda estática: o SQL executável não contém delete/drop/truncate", () => {
    const executavel = semComentarios(lerMigracao());
    expect(executavel).not.toMatch(/\b(delete|drop|truncate)\b/i);
    expect(executavel).toMatch(/update\s+public\.produtos/i);
  });
});
