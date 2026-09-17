import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 208 — Migration 2: RPC
 * `public.reordenar_opcionais_da_categoria(p_loja_id uuid, p_categoria_id uuid,
 * p_ids uuid[]) returns integer`, sob RLS real (pglite).
 * Spec: specs/opcionais-sanfona-e-ordenacao.md (v0.2.0), "Migration 2" + RN-4..RN-7.
 *
 * NADA de produção existe hoje: nem a coluna
 * `categoria_produto_opcionais.ordem` (migration 1), nem a função. Logo o
 * `beforeEach` (que escreve `ordem`) falha com 42703 e cada chamada abaixo
 * falharia com 42883. É esse o vermelho.
 *
 * ─────────────── Diferença estrutural para `reordenar_categorias` (issue 175)
 * Lá o escopo da permutação é a LOJA INTEIRA. Aqui é o PAR
 * (loja, categoria de produto): o mesmo grupo de opcional pode estar associado a
 * várias categorias de produto com posições diferentes (Decisão D-1 / RN-10).
 * Os casos [208-R3] e [208-R8] existem só para provar isso — uma RPC copiada de
 * 175 sem trocar o escopo passa em todos os outros e falha nesses dois.
 *
 * ─────────────── Anti-falso-verde nº1: o CÓDIGO do erro
 * "a chamada lança" é asserção inútil enquanto a função não existe (42883,
 * undefined_function). Todo caso de recusa afirma o SQLSTATE ESPERADO:
 *   - recusa por regra de negócio → P0001 (`raise exception` do plpgsql);
 *   - recusa de EXECUTE para anon → 42501 (`revoke all ... from public, anon`).
 * Ambos diferentes de 42883 e de 42703.
 *
 * ─────────────── Anti-falso-verde nº2: o rollback do harness
 * `withRole` (tests/helpers/pglite.ts) faz `rollback` quando o callback lança.
 * Uma asserção de "nada mudou" no MESMO bloco passaria por causa do harness, não
 * da função. Toda releitura mora num bloco `asService` SEPARADO (transação nova,
 * BYPASSRLS = fonte de verdade), executado DEPOIS do bloco que lançou.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/**
 * Baseline recriado antes de CADA teste. Lanches nasce COM EMPATE (2,2,0) — a
 * normalização 0..n−1 sobre a permutação completa é o que existe para matá-lo.
 */
const ORDEM_LANCHES: Record<"molhos" | "adicionais" | "bebidas", number> = {
  molhos: 2,
  adicionais: 2,
  bebidas: 0,
};
const ORDEM_PORCOES: Record<"adicionais" | "bebidas" | "sobremesas", number> = {
  adicionais: 0,
  bebidas: 1,
  sobremesas: 2,
};
const ORDEM_B: Record<"b1" | "b2", number> = { b1: 0, b2: 1 };

type Cenario = {
  lojaA: string;
  lojaB: string;
  /** Categorias de PRODUTO da loja A. */
  catLanches: string;
  catPorcoes: string;
  /** Categorias de OPCIONAL da loja A. */
  gMolhos: string;
  gAdicionais: string;
  gBebidas: string;
  gSobremesas: string;
  /** Loja B. */
  catB: string;
  gB1: string;
  gB2: string;
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

/**
 * Loja A: 2 categorias de produto, 4 grupos.
 *   Lanches ⋈ {Molhos, Adicionais, Bebidas}       (3 associações)
 *   Porções ⋈ {Adicionais, Bebidas, Sobremesas}   (3 associações)
 * Os dois conjuntos têm o MESMO TAMANHO de propósito: assim a checagem de
 * cardinalidade passa e quem tem que recusar [208-R3] é o filtro por
 * `categoria_id`, não a contagem.
 * Loja B: 1 categoria de produto com 2 grupos.
 */
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
    const catProduto = (lojaId: string, nome: string, ordem: number) =>
      um(
        `insert into public.categorias (loja_id, nome, ordem) values ($1,$2,$3) returning id`,
        [lojaId, nome, ordem],
      );
    const grupo = (lojaId: string, nome: string, ordem: number) =>
      um(
        `insert into public.opcionais_categorias (loja_id, nome, ordem) values ($1,$2,$3) returning id`,
        [lojaId, nome, ordem],
      );

    const lojaA = await loja(DONO_A, "loja-a-rpc-opc", "Loja A");
    const lojaB = await loja(DONO_B, "loja-b-rpc-opc", "Loja B");

    const c: Cenario = {
      lojaA,
      lojaB,
      catLanches: await catProduto(lojaA, "Lanches", 0),
      catPorcoes: await catProduto(lojaA, "Porções", 1),
      gMolhos: await grupo(lojaA, "Molhos", 0),
      gAdicionais: await grupo(lojaA, "Adicionais", 1),
      gBebidas: await grupo(lojaA, "Bebidas", 2),
      gSobremesas: await grupo(lojaA, "Sobremesas", 3),
      catB: await catProduto(lojaB, "Pizzas", 0),
      gB1: await grupo(lojaB, "Bordas", 0),
      gB2: await grupo(lojaB, "Sucos", 1),
    };

    const assoc = (lojaId: string, catId: string, grupoId: string) =>
      db.query(
        `insert into public.categoria_produto_opcionais (loja_id, categoria_id, categoria_opcional_id)
         values ($1,$2,$3)`,
        [lojaId, catId, grupoId],
      );
    await assoc(lojaA, c.catLanches, c.gMolhos);
    await assoc(lojaA, c.catLanches, c.gAdicionais);
    await assoc(lojaA, c.catLanches, c.gBebidas);
    await assoc(lojaA, c.catPorcoes, c.gAdicionais);
    await assoc(lojaA, c.catPorcoes, c.gBebidas);
    await assoc(lojaA, c.catPorcoes, c.gSobremesas);
    await assoc(lojaB, c.catB, c.gB1);
    await assoc(lojaB, c.catB, c.gB2);

    return c;
  });
}

/**
 * Chama a RPC montando o array em SQL (`array[$3,$4,...]::uuid[]`) em vez de
 * confiar na serialização de array do driver — o que está sob teste é a função.
 */
function chamarRpc(
  db: PGlite,
  lojaId: string,
  categoriaId: string,
  ids: readonly string[],
): Promise<{ rows: Array<{ afetadas: number }> }> {
  const placeholders = ids.map((_, i) => `$${i + 3}`).join(", ");
  return db.query<{ afetadas: number }>(
    `select public.reordenar_opcionais_da_categoria($1::uuid, $2::uuid, array[${placeholders}]::uuid[]) as afetadas`,
    [lojaId, categoriaId, ...ids],
  );
}

/** Variante com array MULTIDIMENSIONAL — alvo da checagem `cardinality()`. */
function chamarRpcMatriz(
  db: PGlite,
  lojaId: string,
  categoriaId: string,
  linhas: readonly (readonly string[])[],
): Promise<{ rows: Array<{ afetadas: number }> }> {
  let n = 2;
  const literal = linhas
    .map((linha) => `[${linha.map(() => `$${++n}::uuid`).join(", ")}]`)
    .join(", ");
  return db.query<{ afetadas: number }>(
    `select public.reordenar_opcionais_da_categoria($1::uuid, $2::uuid, array[${literal}]) as afetadas`,
    [lojaId, categoriaId, ...linhas.flat()],
  );
}

/** SQLSTATE da exceção lançada por `fn`, ou `null` se não lançou. */
async function sqlstateDaFalha(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? "SEM_CODE";
  }
}

/** Fonte de verdade (BYPASSRLS), em transação PRÓPRIA — nunca a que lançou. */
async function ordemAtual(
  t: TestDb,
  categoriaId: string,
  grupos: readonly string[],
): Promise<number[]> {
  const r = await t.asService((db) =>
    db.query<{ categoria_opcional_id: string; ordem: number }>(
      `select categoria_opcional_id, ordem
         from public.categoria_produto_opcionais where categoria_id = $1`,
      [categoriaId],
    ),
  );
  const porGrupo = new Map(r.rows.map((l) => [l.categoria_opcional_id, Number(l.ordem)]));
  return grupos.map((g) => porGrupo.get(g) ?? -1);
}

describe("208 RPC reordenar_opcionais_da_categoria — RLS real (pglite)", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    c = await semear(t);
  });
  afterAll(async () => {
    await t.close();
  });

  /** Restaura o baseline (com o empate de Lanches) antes de cada caso. */
  beforeEach(async () => {
    await t.asService(async (db) => {
      const set = (catId: string, grupoId: string, ordem: number) =>
        db.query(
          `update public.categoria_produto_opcionais set ordem = $3
            where categoria_id = $1 and categoria_opcional_id = $2`,
          [catId, grupoId, ordem],
        );
      await set(c.catLanches, c.gMolhos, ORDEM_LANCHES.molhos);
      await set(c.catLanches, c.gAdicionais, ORDEM_LANCHES.adicionais);
      await set(c.catLanches, c.gBebidas, ORDEM_LANCHES.bebidas);
      await set(c.catPorcoes, c.gAdicionais, ORDEM_PORCOES.adicionais);
      await set(c.catPorcoes, c.gBebidas, ORDEM_PORCOES.bebidas);
      await set(c.catPorcoes, c.gSobremesas, ORDEM_PORCOES.sobremesas);
      await set(c.catB, c.gB1, ORDEM_B.b1);
      await set(c.catB, c.gB2, ORDEM_B.b2);
    });
  });

  /** Baseline completo intacto — usado como pós-condição dos casos de recusa. */
  async function esperarBaselineIntacto(): Promise<void> {
    expect(await ordemAtual(t, c.catLanches, [c.gMolhos, c.gAdicionais, c.gBebidas])).toEqual([
      ORDEM_LANCHES.molhos,
      ORDEM_LANCHES.adicionais,
      ORDEM_LANCHES.bebidas,
    ]);
    expect(
      await ordemAtual(t, c.catPorcoes, [c.gAdicionais, c.gBebidas, c.gSobremesas]),
    ).toEqual([ORDEM_PORCOES.adicionais, ORDEM_PORCOES.bebidas, ORDEM_PORCOES.sobremesas]);
    expect(await ordemAtual(t, c.catB, [c.gB1, c.gB2])).toEqual([ORDEM_B.b1, ORDEM_B.b2]);
  }

  // ───────────────────────────── R1 — p_categoria_id é de OUTRA loja
  it("[208-R1] dono A com p_categoria_id da loja B → P0001, e ZERO linhas escritas nas duas lojas", async () => {
    // Vetor real: o `categoria_id` é o único parâmetro de escopo que vem do
    // cliente (RN-5b). Aqui ele é a categoria de PRODUTO da loja B, enquanto
    // `p_loja_id` é a loja A (que a Server Action deriva de auth.uid()).
    // Contagem do par (lojaA, catB) = 0 ≠ 2 ids → raise, antes de qualquer write.
    const code = await sqlstateDaFalha(() =>
      t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaA, c.catB, [c.gB1, c.gB2])),
    );
    expect(code).toBe("P0001");

    await esperarBaselineIntacto();
  });

  // ───────────────────────────── R2 — p_loja_id alheio (SECURITY INVOKER)
  it("[208-R2] dono A passando p_loja_id E p_categoria_id da loja B → P0001, nada muda em B", async () => {
    // É o caso que prova `security invoker`: sob DEFINER a função rodaria com os
    // privilégios do criador e este UPDATE PASSARIA — o dono A reescreveria a
    // ordem da loja B só escolhendo o p_loja_id. A contagem bate (2 para 2,
    // visível via cat_prod_opc_leitura_publica, loja B ativa); quem recusa é a
    // RLS de ESCRITA: 0 linhas afetadas ≠ 2 → raise.
    const code = await sqlstateDaFalha(() =>
      t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaB, c.catB, [c.gB2, c.gB1])),
    );
    expect(code).toBe("P0001");

    await esperarBaselineIntacto();
  });

  // ───────────────────────────── R3 — ids da própria loja, de OUTRA categoria
  it("[208-R3] ids válidos da própria loja mas de OUTRA categoria de produto → P0001, nada muda", async () => {
    // Sobremesas pertence à loja A e está associada a Porções, não a Lanches.
    // Cardinalidade 3 = 3 associações em Lanches → a contagem passa. Quem recusa
    // é o `and cpo.categoria_id = p_categoria_id` do UPDATE: só Adicionais e
    // Bebidas casam → 2 ≠ 3 → raise.
    //
    // Uma RPC copiada de `reordenar_categorias` (escopo = loja inteira) passaria
    // em [208-R1], [208-R2] e nos demais, e falharia AQUI.
    const code = await sqlstateDaFalha(() =>
      t.asUser(DONO_A, (db) =>
        chamarRpc(db, c.lojaA, c.catLanches, [c.gAdicionais, c.gBebidas, c.gSobremesas]),
      ),
    );
    expect(code).toBe("P0001");

    await esperarBaselineIntacto();
  });

  // ───────────────────────────── R4 — grupo de OUTRA loja dentro de p_ids
  it("[208-R4] id de grupo da loja B dentro de p_ids do dono A → P0001, `ordem` intacta nas duas lojas", async () => {
    const code = await sqlstateDaFalha(() =>
      t.asUser(DONO_A, (db) =>
        chamarRpc(db, c.lojaA, c.catLanches, [c.gMolhos, c.gB1, c.gBebidas]),
      ),
    );
    expect(code).toBe("P0001");

    await esperarBaselineIntacto();
  });

  // ───────────────────────────── R5 — lista incompleta
  it("[208-R5] lista incompleta (2 ids para 3 associações) → P0001, e nenhuma das 3 muda", async () => {
    // Fail-closed: normalizar um SUBCONJUNTO reintroduziria o empate que a
    // feature existe para eliminar (as não enviadas manteriam a ordem antiga).
    const code = await sqlstateDaFalha(() =>
      t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaA, c.catLanches, [c.gMolhos, c.gBebidas])),
    );
    expect(code).toBe("P0001");

    await esperarBaselineIntacto();
  });

  // ───────────────────────────── R6 — duplicata
  it("[208-R6] id duplicado em p_ids → P0001, e nada muda", async () => {
    const code = await sqlstateDaFalha(() =>
      t.asUser(DONO_A, (db) =>
        chamarRpc(db, c.lojaA, c.catLanches, [c.gMolhos, c.gMolhos, c.gBebidas]),
      ),
    );
    expect(code).toBe("P0001");

    await esperarBaselineIntacto();
  });

  // ───────────────────────────── R7 — anon não executa (RN-7)
  it("[208-R7] anon NÃO tem EXECUTE na função (42501), e nada muda", async () => {
    // O Postgres concede EXECUTE a PUBLIC por padrão em função nova e o projeto
    // não tem `alter default privileges ... on functions` — sem o
    // `revoke all ... from public, anon` da migration, anon executaria a RPC
    // direto em /rest/v1/rpc/ com a anon key, que está no bundle público.
    const code = await sqlstateDaFalha(() =>
      t.asAnon((db) =>
        chamarRpc(db, c.lojaA, c.catLanches, [c.gBebidas, c.gMolhos, c.gAdicionais]),
      ),
    );
    expect(code).toBe("42501");

    await esperarBaselineIntacto();
  });

  // ───────────────────────────── R8 — caminho feliz + independência (RN-10)
  it("[208-R8] permutação completa do par → retorna 3, grava 0,1,2 e NÃO toca a outra categoria", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      chamarRpc(db, c.lojaA, c.catLanches, [c.gBebidas, c.gMolhos, c.gAdicionais]),
    );
    expect(Number(r.rows[0].afetadas)).toBe(3);

    // A ordem é a da sequência enviada, e o empate (2,2,0) morreu.
    const ordens = await ordemAtual(t, c.catLanches, [c.gBebidas, c.gMolhos, c.gAdicionais]);
    expect(ordens).toEqual([0, 1, 2]);
    expect(new Set(ordens).size).toBe(3);

    // RN-10: Adicionais e Bebidas também estão em Porções, e Porções não foi
    // tocada. Uma RPC com escopo de LOJA (cópia de 175) quebraria aqui.
    expect(
      await ordemAtual(t, c.catPorcoes, [c.gAdicionais, c.gBebidas, c.gSobremesas]),
    ).toEqual([ORDEM_PORCOES.adicionais, ORDEM_PORCOES.bebidas, ORDEM_PORCOES.sobremesas]);
    // E a loja B segue intacta.
    expect(await ordemAtual(t, c.catB, [c.gB1, c.gB2])).toEqual([ORDEM_B.b1, ORDEM_B.b2]);
  });

  // ───────────────────────────── R9 — array multidimensional (achado 20260908130000)
  it("[208-R9] array MULTIDIMENSIONAL → P0001 (cardinality), e as ordens ficam intactas", async () => {
    // `array_length(p_ids, 1)` conta SÓ a primeira dimensão: em
    // `array[[molhos,gB1],[adicionais,gB2],[bebidas,gB1]]` ela vale 3 enquanto o
    // `unnest` entrega 6. Com 3 associações em Lanches, `3 = 3` passaria a
    // checagem de permutação, o UPDATE casaria as 3 linhas de Lanches (as de B
    // caem no `where loja_id`/`categoria_id`), `row_count = 3` passaria a segunda
    // checagem — e `ordem` sairia de `ordinality` sobre 6 posições: [0, 2, 4],
    // quebrando a invariante 0..n−1. `cardinality()` conta 6 ≠ 3 → raise.
    const code = await sqlstateDaFalha(() =>
      t.asUser(DONO_A, (db) =>
        chamarRpcMatriz(db, c.lojaA, c.catLanches, [
          [c.gMolhos, c.gB1],
          [c.gAdicionais, c.gB2],
          [c.gBebidas, c.gB1],
        ]),
      ),
    );
    expect(code).toBe("P0001");

    const ordens = await ordemAtual(t, c.catLanches, [c.gMolhos, c.gAdicionais, c.gBebidas]);
    expect(ordens).toEqual([
      ORDEM_LANCHES.molhos,
      ORDEM_LANCHES.adicionais,
      ORDEM_LANCHES.bebidas,
    ]);
    // O sintoma exato do bug — não pode reaparecer.
    expect(ordens).not.toEqual([0, 2, 4]);
    expect(await ordemAtual(t, c.catB, [c.gB1, c.gB2])).toEqual([ORDEM_B.b1, ORDEM_B.b2]);
  });

  it("[208-R9b] array aninhado que É a permutação completa mantém a invariante 0..n−1", async () => {
    // Contraprova: o fix não é "recusar aninhamento", é CONTAR os elementos
    // reais. Sem esta asserção, um `array_ndims(p_ids) > 1 → raise` também
    // passaria em [208-R9].
    await t.asUser(DONO_A, (db) =>
      chamarRpcMatriz(db, c.lojaA, c.catLanches, [[c.gBebidas], [c.gMolhos], [c.gAdicionais]]),
    );

    const ordens = await ordemAtual(t, c.catLanches, [c.gBebidas, c.gMolhos, c.gAdicionais]);
    expect(ordens).toEqual([0, 1, 2]);
    expect(new Set(ordens).size).toBe(3);
  });

  // ───────────────────────────── R10 — a vitrine (anon) herda a ordem
  it("[208-R10] lida como ANON, a ordem gravada pela RPC é a que a vitrine exibe", async () => {
    // Round-trip do RN-2: grava autenticado (dono) e lê como anon sob
    // `cat_prod_opc_leitura_publica`, reproduzindo o ordenamento que
    // `agruparOpcionais` passará a usar (ordem asc, desempate por nome do grupo).
    await t.asUser(DONO_A, (db) =>
      chamarRpc(db, c.lojaA, c.catLanches, [c.gBebidas, c.gMolhos, c.gAdicionais]),
    );

    const r = await t.asAnon((db) =>
      db.query<{ categoria_opcional_id: string }>(
        `select cpo.categoria_opcional_id
           from public.categoria_produto_opcionais cpo
           join public.opcionais_categorias oc on oc.id = cpo.categoria_opcional_id
          where cpo.loja_id = $1 and cpo.categoria_id = $2
          order by cpo.ordem asc, oc.nome asc`,
        [c.lojaA, c.catLanches],
      ),
    );
    expect(r.rows.map((l) => l.categoria_opcional_id)).toEqual([
      c.gBebidas,
      c.gMolhos,
      c.gAdicionais,
    ]);
  });

  // ───────────────────────────── R11 — escreve SÓ `ordem`
  it("[208-R11] a RPC não reescreve a linha inteira: loja_id/categoria_id/categoria_opcional_id ficam", async () => {
    // Motivo documentado de usar RPC em vez de `.upsert(..., {onConflict})`:
    // upsert reescreveria a LINHA INTEIRA e um id inexistente inseriria
    // associação fantasma (cross-loja, no pior caso).
    const antes = await t.asService((db) =>
      db.query<{ n: number }>(
        `select count(*)::int as n from public.categoria_produto_opcionais`,
      ),
    );

    await t.asUser(DONO_A, (db) =>
      chamarRpc(db, c.lojaA, c.catLanches, [c.gBebidas, c.gMolhos, c.gAdicionais]),
    );

    const depois = await t.asService((db) =>
      db.query<{ n: number }>(
        `select count(*)::int as n from public.categoria_produto_opcionais`,
      ),
    );
    expect(Number(depois.rows[0].n)).toBe(Number(antes.rows[0].n));
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 208, migration 2:
 *
 * `supabase/migrations/<ts>_rpc_reordenar_opcionais_da_categoria.sql`:
 *
 *   public.reordenar_opcionais_da_categoria(
 *     p_loja_id uuid, p_categoria_id uuid, p_ids uuid[]
 *   ) returns integer
 *     language plpgsql
 *     security invoker              -- NUNCA definer: [208-R2] é o teste que cai
 *     set search_path = public
 *
 *   1) cardinality(p_ids) = 0                    → raise (P0001)
 *   2) count(*) from categoria_produto_opcionais
 *        where loja_id = p_loja_id
 *          and categoria_id = p_categoria_id
 *      <> cardinality(p_ids)                     → raise (P0001)  [R1, R5, R9]
 *      -- cardinality(), NUNCA array_length(p_ids, 1)             [R9]
 *   3) update public.categoria_produto_opcionais cpo
 *         set ordem = e.pos - 1
 *        from unnest(p_ids) with ordinality as e(id, pos)
 *       where cpo.categoria_opcional_id = e.id
 *         and cpo.loja_id = p_loja_id
 *         and cpo.categoria_id = p_categoria_id  -- escopo do PAR             [R3]
 *   4) get diagnostics row_count <> cardinality  → raise (P0001) [R2, R4, R6]
 *   5) return row_count                                          [R8]
 *
 *   revoke all on function public.reordenar_opcionais_da_categoria(uuid, uuid, uuid[])
 *     from public, anon;                                         [R7]
 *   grant execute on function ... to authenticated, service_role; [R8]
 *
 * Depende da migration 1 (coluna `ordem`) — ver
 * tests/migrations/ordem_em_categoria_produto_opcionais.test.ts.
 * Casos que precisam passar: [208-R1]..[208-R11].
 */
