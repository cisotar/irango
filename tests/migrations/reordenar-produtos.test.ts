import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 293 — RPC
 * `public.reordenar_produtos(p_loja_id uuid, p_categoria_id uuid, p_ids uuid[])
 *  returns integer`, sob RLS real (pglite).
 * Issue: tasks/293-drag-and-drop-para-ordenar-produtos-no-painel.md
 * Plano: plan/loop-refat-linha-de-produto.md, "Fatia B — PR 2", passo 9.
 *
 * NADA de produção existe hoje: a função não foi escrita (é o passo 10,
 * `executar`). Logo TODA chamada abaixo falha com 42883 (undefined_function).
 * Esse primeiro vermelho é GROSSO e IGUAL para os 7 casos — e é esperado: o
 * valor do red-first aqui não é a granularidade do primeiro erro, é que estes
 * testes nascem da especificação da issue e não de um SQL que o autor já viu.
 * Os casos só se separam conforme a RPC é escrita, e é aí que [293-R2],
 * [293-R6] e [293-R7] provam o que realmente importa.
 *
 * ─────────────── Molde estrutural: `reordenar_opcionais_da_categoria` (208)
 * `tests/migrations/rpc_reordenar_opcionais_da_categoria.test.ts` +
 * `supabase/migrations/20260917121000_rpc_reordenar_opcionais_da_categoria.sql`.
 * O escopo da permutação é o PAR (loja, categoria) — não a loja inteira, como
 * em `reordenar_categorias` (175). O que muda aqui: o par tem um grupo cuja
 * categoria é NULL ("Sem categoria"), e NULL não casa por `=` (ver [293-R6]).
 *
 * ─────────────── Anti-falso-verde nº1: o CÓDIGO e o TEXTO do erro
 * "a chamada lança" é asserção inútil enquanto a função não existe (42883).
 * Todo caso de recusa afirma o SQLSTATE P0001 (`raise exception` do plpgsql),
 * diferente de 42883 e de 42703. Onde a issue fixa a mensagem, o teste afirma o
 * FRAGMENTO LITERAL com os números reais interpolados —
 * `'reordenar_produtos: % ids, % linhas afetadas'` — porque uma trava de escopo
 * passa por acidente aritmético quando as cardinalidades coincidem.
 *
 * ─────────────── Anti-falso-verde nº2: cardinalidades DISTINTAS
 * Loja A/Lanches tem 3 produtos, loja A/"Sem categoria" tem 2, loja B/Pizzas
 * tem 5. Nenhum número se repete entre os grupos: nenhuma contagem bate por
 * coincidência.
 *
 * ─────────────── Anti-falso-verde nº3: o rollback do harness
 * `withRole` (tests/helpers/pglite.ts) faz `rollback` quando o callback lança.
 * Uma releitura no MESMO bloco passaria por causa do harness, não da função.
 * Toda releitura mora num bloco `asService` SEPARADO (transação nova,
 * BYPASSRLS = fonte de verdade), executado DEPOIS do bloco que lançou.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/**
 * Baseline recriado antes de CADA caso. Lanches e "Sem categoria" nascem COM
 * EMPATE de `ordem` — a normalização 0..n−1 sobre a permutação completa é o que
 * existe para matá-lo. Loja B nasce já normalizada, para que qualquer escrita
 * indevida nela seja visível.
 */
const ORDEM_LANCHES: Record<"a1" | "a2" | "a3", number> = { a1: 5, a2: 5, a3: 1 };
const ORDEM_SEM_CAT: Record<"s1" | "s2", number> = { s1: 3, s2: 3 };
const ORDEM_B: readonly number[] = [0, 1, 2, 3, 4];

type Cenario = {
  lojaA: string;
  lojaB: string;
  /** Loja A — categoria "Lanches": 3 produtos. */
  catLanches: string;
  pA1: string;
  pA2: string;
  pA3: string;
  /** Loja A — grupo `categoria_id IS NULL` ("Sem categoria"): 2 produtos. */
  pSem1: string;
  pSem2: string;
  /** Loja B — categoria "Pizzas": 5 produtos. */
  catPizzas: string;
  pB: string[];
};

async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a@teste.local'),
       ($2, 'dono-b@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B],
  );
}

async function semear(t: TestDb): Promise<Cenario> {
  await garantirDonos(t);
  return t.asService(async (db) => {
    const um = async (sql: string, params: unknown[]) => {
      const r = await db.query<{ id: string }>(sql, params);
      return r.rows[0].id;
    };
    const loja = (dono: string, slug: string, nome: string) =>
      um(
        `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,$2,$3,true) returning id`,
        [dono, slug, nome],
      );
    const categoria = (lojaId: string, nome: string, ordem: number) =>
      um(
        `insert into public.categorias (loja_id, nome, ordem) values ($1,$2,$3) returning id`,
        [lojaId, nome, ordem],
      );
    const produto = (
      lojaId: string,
      categoriaId: string | null,
      nome: string,
      ordem: number,
    ) =>
      um(
        `insert into public.produtos (loja_id, categoria_id, nome, preco, ordem)
         values ($1, $2::uuid, $3, 10.00, $4) returning id`,
        [lojaId, categoriaId, nome, ordem],
      );

    const lojaA = await loja(DONO_A, "loja-a-reord-prod", "Loja A");
    const lojaB = await loja(DONO_B, "loja-b-reord-prod", "Loja B");
    const catLanches = await categoria(lojaA, "Lanches", 0);
    const catPizzas = await categoria(lojaB, "Pizzas", 0);

    const pB: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      pB.push(await produto(lojaB, catPizzas, `Pizza ${i + 1}`, i));
    }

    return {
      lojaA,
      lojaB,
      catLanches,
      pA1: await produto(lojaA, catLanches, "X-Burguer", ORDEM_LANCHES.a1),
      pA2: await produto(lojaA, catLanches, "X-Salada", ORDEM_LANCHES.a2),
      pA3: await produto(lojaA, catLanches, "X-Bacon", ORDEM_LANCHES.a3),
      pSem1: await produto(lojaA, null, "Água", ORDEM_SEM_CAT.s1),
      pSem2: await produto(lojaA, null, "Refrigerante", ORDEM_SEM_CAT.s2),
      catPizzas,
      pB,
    } satisfies Cenario;
  });
}

/**
 * Chama a RPC montando o array em SQL (`array[$3,...]::uuid[]`) em vez de
 * confiar na serialização de array do driver — o que está sob teste é a função.
 * `categoriaId` null vira `null::uuid`, que é o caso "Sem categoria".
 */
function chamarRpc(
  db: PGlite,
  lojaId: string,
  categoriaId: string | null,
  ids: readonly string[],
): Promise<{ rows: Array<{ afetadas: number }> }> {
  const placeholders = ids.map((_, i) => `$${i + 3}`).join(", ");
  const arrayLiteral =
    ids.length === 0 ? `array[]::uuid[]` : `array[${placeholders}]::uuid[]`;
  return db.query<{ afetadas: number }>(
    `select public.reordenar_produtos($1::uuid, $2::uuid, ${arrayLiteral}) as afetadas`,
    [lojaId, categoriaId, ...ids],
  );
}

/** Variante com `p_ids` literalmente NULL — distinta do array vazio. */
function chamarRpcComIdsNull(
  db: PGlite,
  lojaId: string,
  categoriaId: string | null,
): Promise<{ rows: Array<{ afetadas: number }> }> {
  return db.query<{ afetadas: number }>(
    `select public.reordenar_produtos($1::uuid, $2::uuid, null::uuid[]) as afetadas`,
    [lojaId, categoriaId],
  );
}

type Falha = { code: string; message: string };

/** SQLSTATE + mensagem da exceção lançada por `fn` (ou falha o teste se não lançou). */
async function falhaDe(fn: () => Promise<unknown>): Promise<Falha> {
  try {
    await fn();
    return { code: "NAO_LANCOU", message: "" };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return { code: e.code ?? "SEM_CODE", message: e.message ?? "" };
  }
}

/** Fonte de verdade (BYPASSRLS), em transação PRÓPRIA — nunca a que lançou. */
async function ordemDe(t: TestDb, ids: readonly string[]): Promise<number[]> {
  const r = await t.asService((db) =>
    db.query<{ id: string; ordem: number }>(
      `select id, ordem from public.produtos where id = any($1::uuid[])`,
      [`{${ids.join(",")}}`],
    ),
  );
  const porId = new Map(r.rows.map((l) => [l.id, Number(l.ordem)]));
  return ids.map((id) => porId.get(id) ?? -1);
}

describe("293 RPC reordenar_produtos — RLS real (pglite)", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    c = await semear(t);
  });
  afterAll(async () => {
    await t.close();
  });

  /** Restaura o baseline (com os dois empates) antes de cada caso. */
  beforeEach(async () => {
    await t.asService(async (db) => {
      const set = (id: string, ordem: number) =>
        db.query(`update public.produtos set ordem = $2 where id = $1`, [id, ordem]);
      await set(c.pA1, ORDEM_LANCHES.a1);
      await set(c.pA2, ORDEM_LANCHES.a2);
      await set(c.pA3, ORDEM_LANCHES.a3);
      await set(c.pSem1, ORDEM_SEM_CAT.s1);
      await set(c.pSem2, ORDEM_SEM_CAT.s2);
      for (let i = 0; i < c.pB.length; i += 1) await set(c.pB[i], ORDEM_B[i]);
    });
  });

  /** Baseline completo intacto — pós-condição de TODO caso de recusa. */
  async function esperarBaselineIntacto(): Promise<void> {
    expect(await ordemDe(t, [c.pA1, c.pA2, c.pA3])).toEqual([
      ORDEM_LANCHES.a1,
      ORDEM_LANCHES.a2,
      ORDEM_LANCHES.a3,
    ]);
    expect(await ordemDe(t, [c.pSem1, c.pSem2])).toEqual([
      ORDEM_SEM_CAT.s1,
      ORDEM_SEM_CAT.s2,
    ]);
    expect(await ordemDe(t, c.pB)).toEqual([...ORDEM_B]);
  }

  // ─────────────────────── R1 (a) — permutação válida
  it("[293-R1] permutação completa da categoria → retorna 3, grava 0,1,2 e não toca o resto", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      chamarRpc(db, c.lojaA, c.catLanches, [c.pA3, c.pA1, c.pA2]),
    );
    expect(Number(r.rows[0].afetadas)).toBe(3);

    // A ordem é a da sequência enviada, derivada no servidor (ordinality - 1):
    // o cliente nunca manda valores de `ordem`. O empate (5,5,1) morreu.
    const ordens = await ordemDe(t, [c.pA3, c.pA1, c.pA2]);
    expect(ordens).toEqual([0, 1, 2]);
    expect(new Set(ordens).size).toBe(3);

    // O grupo sem categoria da MESMA loja e a loja B seguem intactos.
    expect(await ordemDe(t, [c.pSem1, c.pSem2])).toEqual([
      ORDEM_SEM_CAT.s1,
      ORDEM_SEM_CAT.s2,
    ]);
    expect(await ordemDe(t, c.pB)).toEqual([...ORDEM_B]);
  });

  // ─────────────────────── R2 (b) — id de OUTRA loja dentro de p_ids
  it("[293-R2] id da loja B dentro de p_ids do dono A → 'reordenar_produtos: 3 ids, 2 linhas afetadas', nada escrito nas duas lojas", async () => {
    // Cardinalidade enviada = 3 = nº de produtos do par (lojaA, Lanches), então
    // a checagem de permutação PASSA e quem tem que recusar é o escopo do
    // UPDATE: só pA1 e pA2 casam `loja_id`/`categoria_id` → row_count 2 ≠ 3.
    //
    // Por que o FRAGMENTO LITERAL, e não só o SQLSTATE: uma RPC que casasse
    // apenas por `id` atualizaria as 3 linhas (2 de A + 1 de B), row_count = 3,
    // e devolveria sucesso — P0001 sozinho não distingue isso. Os números na
    // mensagem (3 ids, 2 afetadas) só existem se o escopo tiver sido aplicado.
    // E as cardinalidades dos grupos são distintas (3 / 2 / 5) para que nenhuma
    // contagem bata por acidente aritmético.
    const f = await falhaDe(() =>
      t.asUser(DONO_A, (db) =>
        chamarRpc(db, c.lojaA, c.catLanches, [c.pA1, c.pA2, c.pB[0]]),
      ),
    );
    expect(f.code).toBe("P0001");
    expect(f.message).toContain("reordenar_produtos: 3 ids, 2 linhas afetadas");

    // A transação inteira caiu: escrita parcial é impossível, nas DUAS lojas.
    await esperarBaselineIntacto();
  });

  // ─────────────────────── R3 (c) — lista incompleta
  it("[293-R3] lista incompleta (2 ids para 3 produtos da categoria) → P0001, e nenhum dos 3 muda", async () => {
    // Fail-closed: normalizar um SUBCONJUNTO reintroduziria o empate que a
    // feature existe para eliminar (os não enviados manteriam a ordem antiga).
    // A issue fixa o texto só da mensagem de row_count, então aqui o contrato é
    // SQLSTATE + o prefixo do nome da função — a GREEN escolhe o resto do texto.
    const f = await falhaDe(() =>
      t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaA, c.catLanches, [c.pA1, c.pA3])),
    );
    expect(f.code).toBe("P0001");
    expect(f.message).toContain("reordenar_produtos:");

    await esperarBaselineIntacto();
  });

  // ─────────────────────── R4 (d) — id duplicado
  it("[293-R4] id duplicado em p_ids → 'reordenar_produtos: 3 ids, 2 linhas afetadas', e nada muda", async () => {
    // cardinality = 3 = 3 produtos no par → a checagem de permutação passa. O
    // UPDATE ... FROM unnest casa pA1 UMA vez (posição indeterminada) e pA2
    // uma vez: 2 linhas ≠ 3 ids. pA3 ficaria com a ordem velha — o sintoma que
    // o row_count existe para matar.
    const f = await falhaDe(() =>
      t.asUser(DONO_A, (db) =>
        chamarRpc(db, c.lojaA, c.catLanches, [c.pA1, c.pA1, c.pA2]),
      ),
    );
    expect(f.code).toBe("P0001");
    expect(f.message).toContain("reordenar_produtos: 3 ids, 2 linhas afetadas");

    await esperarBaselineIntacto();
  });

  // ─────────────────────── R5a (e) — p_ids VAZIO
  it("[293-R5a] p_ids vazio → P0001, e nada muda", async () => {
    // `cardinality()`, nunca `array_length(p_ids, 1)`: array_length de array
    // vazio é NULL, e toda comparação com NULL vira NULL — nem raise, nem
    // update, silêncio. Com 3 produtos no par, um `0 <> 3` sem coalesce
    // também recusaria; o caso que só `cardinality()+coalesce` pega é o R5b.
    const f = await falhaDe(() =>
      t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaA, c.catLanches, [])),
    );
    expect(f.code).toBe("P0001");
    expect(f.message).toContain("reordenar_produtos:");

    await esperarBaselineIntacto();
  });

  // ─────────────────────── R5b (e) — p_ids NULL (caso SEPARADO do vazio)
  it("[293-R5b] p_ids NULL → P0001, e nada muda", async () => {
    // Sem `coalesce(cardinality(p_ids), 0)`, `v_enviadas` é NULL: `NULL = 0` é
    // NULL (não dispara o raise), `v_no_par <> NULL` é NULL (não dispara o
    // segundo), o `unnest(null)` não produz linha nenhuma, row_count = 0 e
    // `0 <> NULL` é NULL — a função retornaria em silêncio. É o falso-verde que
    // este caso existe para fechar, e é por isso que ele é um teste separado do
    // R5a e não um segundo `expect` dentro dele.
    const f = await falhaDe(() =>
      t.asUser(DONO_A, (db) => chamarRpcComIdsNull(db, c.lojaA, c.catLanches)),
    );
    expect(f.code).toBe("P0001");
    expect(f.message).toContain("reordenar_produtos:");

    await esperarBaselineIntacto();
  });

  // ─────────────────────── R6 (f) — o grupo `categoria_id IS NULL`
  it("[293-R6] grupo 'Sem categoria' (p_categoria_id NULL) reordena: retorna 2 e grava 0,1", async () => {
    // O WRINKLE da issue. `categoria_id = p_categoria_id` com os dois NULL é
    // NULL, não `true`: a contagem do par daria 0 ≠ 2 → raise indevido, e o
    // UPDATE não casaria nada. Só `is not distinct from` nas DUAS pontas (a
    // contagem e o WHERE do UPDATE) faz este caso passar.
    //
    // Uma RPC clonada de `reordenar_opcionais_da_categoria` sem essa troca
    // passa em TODOS os outros casos e falha exatamente aqui.
    const r = await t.asUser(DONO_A, (db) =>
      chamarRpc(db, c.lojaA, null, [c.pSem2, c.pSem1]),
    );
    expect(Number(r.rows[0].afetadas)).toBe(2);

    const ordens = await ordemDe(t, [c.pSem2, c.pSem1]);
    expect(ordens).toEqual([0, 1]);
    expect(new Set(ordens).size).toBe(2);

    // E o grupo COM categoria da mesma loja não foi arrastado junto: um WHERE
    // que ignorasse `categoria_id` quando ele é NULL pegaria os 5 produtos da
    // loja A inteira.
    expect(await ordemDe(t, [c.pA1, c.pA2, c.pA3])).toEqual([
      ORDEM_LANCHES.a1,
      ORDEM_LANCHES.a2,
      ORDEM_LANCHES.a3,
    ]);
    expect(await ordemDe(t, c.pB)).toEqual([...ORDEM_B]);
  });

  // ─────────────────────── R7 (g) — dono alheio: a RLS não deixa ver a linha
  it("[293-R7] dono B reordenando a categoria da loja A → P0001, e a loja A fica intacta", async () => {
    // Esta é a razão de `security invoker` e nunca `definer`: `p_loja_id` é um
    // parâmetro escolhido pelo chamador. Sob DEFINER, o dono B reescreveria a
    // ordem da loja A só trocando o argumento. Sob INVOKER, a policy
    // `produtos_escrita_propria` (20260614002000_rls_catalogo.sql:74) continua
    // valendo DENTRO da função: nem o SELECT de contagem nem o UPDATE enxergam
    // as linhas da loja A.
    //
    // Qual das duas travas dispara depende da GREEN (a contagem sob RLS dá 0,
    // então o raise de permutação tende a vir primeiro; se a GREEN contar por
    // outro caminho, cai no raise de row_count). As duas são fail-closed e
    // corretas — por isso o contrato aqui é P0001 + loja A intacta, sem fixar
    // qual mensagem. O que NÃO pode acontecer é escrita.
    const f = await falhaDe(() =>
      t.asUser(DONO_B, (db) =>
        chamarRpc(db, c.lojaA, c.catLanches, [c.pA3, c.pA2, c.pA1]),
      ),
    );
    expect(f.code).toBe("P0001");
    expect(f.message).toContain("reordenar_produtos:");

    await esperarBaselineIntacto();
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 293, migration nova:
 *
 * `supabase/migrations/<ts>_rpc_reordenar_produtos.sql`:
 *
 *   public.reordenar_produtos(
 *     p_loja_id uuid, p_categoria_id uuid, p_ids uuid[]
 *   ) returns integer
 *     language plpgsql
 *     security invoker               -- NUNCA definer: p_loja_id vem do chamador [R7]
 *     set search_path = public
 *
 *   1) v_enviadas := coalesce(cardinality(p_ids), 0)      -- nunca array_length [R5a/R5b]
 *      v_enviadas = 0                               → raise (P0001)  [R5a, R5b]
 *   2) select count(*) into v_no_par from public.produtos
 *        where loja_id = p_loja_id
 *          and categoria_id is not distinct from p_categoria_id   -- NULL = grupo [R6]
 *      v_no_par <> v_enviadas                       → raise (P0001) [R3, R7]
 *   3) update public.produtos p
 *         set ordem = e.pos - 1                     -- derivada no SERVIDOR    [R1]
 *        from unnest(p_ids) with ordinality as e(id, pos)
 *       where p.id = e.id
 *         and p.loja_id = p_loja_id                 -- escopo explícito além da RLS
 *         and p.categoria_id is not distinct from p_categoria_id  [R2, R6]
 *   4) get diagnostics v_afetadas = row_count
 *      v_afetadas <> v_enviadas → raise exception
 *        'reordenar_produtos: % ids, % linhas afetadas', v_enviadas, v_afetadas;
 *      -- FRAGMENTO LITERAL afirmado por [R2] e [R4]: mudar o texto quebra o RED
 *   5) return v_afetadas                                                      [R1, R6]
 *
 *   Espelhando as três RPCs irmãs (20260908120000, 20260917121000,
 *   20260918120000) e o item 3 do plano:
 *     revoke all on function public.reordenar_produtos(uuid, uuid, uuid[])
 *       from public, anon;
 *     grant execute on function ... to authenticated, service_role;
 *   + bloco de ROLLBACK no cabeçalho da migration.
 *
 * Schema confirmado ao escrever este teste (20260614000129_schema_inicial.sql:69):
 *   public.produtos(id uuid pk, loja_id uuid not null, categoria_id uuid NULLABLE
 *   (on delete set null), nome, preco, disponivel, ordem int not null default 0, …).
 *   NÃO há unique em (categoria_id, ordem); o empate de `ordem` é possível hoje e
 *   é o que a normalização 0..n−1 elimina.
 *
 * Casos que precisam passar: [293-R1]..[293-R7] (7 casos, R5 contado como dois).
 */
