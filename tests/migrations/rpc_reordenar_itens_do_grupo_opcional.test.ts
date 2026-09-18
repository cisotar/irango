import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 215 — RPC
 * `public.reordenar_itens_do_grupo_opcional(p_loja_id uuid,
 * p_categoria_opcional_id uuid, p_ids uuid[]) returns integer`,
 * `SECURITY DEFINER`, exercitada em pglite com RLS real.
 * Plano: tasks/215-rpc-atomica-de-reordenacao-de-itens-do-grupo-de-opcional.md,
 * seções "Contratos de Dados", "Checklist das 7 travas" e "Cenários de teste".
 *
 * NADA de produção existe hoje: a função não está em nenhuma migration. Toda
 * chamada abaixo falha com 42883 (undefined_function). É esse o vermelho — e é
 * por isso que cada caso afirma o SQLSTATE ESPERADO, nunca só "lançou".
 *
 * ─────────────── Por que esta função é `SECURITY DEFINER` (e o que isso exige)
 * O hub admin roda sob `service_role`, onde a RLS não vale; uma função
 * `invoker` não serve aos dois chamadores (é a causa raiz do débito 211). Sob
 * DEFINER a RLS deixa de ser a autoridade — então a autoridade tem que estar no
 * CORPO da função (travas T2 e T3). Sem T2, [215-I3] e [215-I16] PASSARIAM e
 * qualquer lojista autenticado reescreveria a ordem de qualquer loja só
 * trocando o argumento `p_loja_id`.
 *
 * ─────────────── Anti-falso-verde nº1: o CÓDIGO do erro
 *   - recusa por regra de negócio → P0001 (`raise exception` do plpgsql);
 *   - recusa de EXECUTE para anon  → 42501 (`revoke all ... from public, anon`).
 * Ambos diferentes de 42883 (função inexistente).
 *
 * ─────────────── Anti-falso-verde nº2: qual TRAVA recusou
 * Vários cenários caem por mais de um caminho possível. [215-I4] e [215-I14],
 * por exemplo, também cairiam por acidente aritmético na contagem de T4 (o par
 * (loja A, grupo da B) tem 0 itens ≠ 2 ids) — e aí a trava T3, que o critério de
 * aceite exige provar, ficaria SEM prova. Por isso os casos de escopo afirmam
 * também o FRAGMENTO DA MENSAGEM que nomeia a trava, conforme o SQL literal do
 * plano (§ "Contratos de Dados"):
 *   T1 → 'lista vazia'        T2 → 'escopo negado'     T3 → 'grupo fora da loja'
 * Isso é CONTRATO para a fase GREEN, não preferência de texto.
 *
 * ─────────────── Anti-falso-verde nº3: o rollback do harness
 * `withRole` (tests/helpers/pglite.ts:141-145) faz `rollback` quando o callback
 * lança. Uma asserção de "nada mudou" no MESMO bloco passaria por causa do
 * harness, não da função. Toda releitura mora num bloco `asService` SEPARADO
 * (transação nova, BYPASSRLS = fonte de verdade), executado DEPOIS do que lançou.
 */

const DONO_A = "a5a5a5a5-0000-4000-8000-00000000000a";
const DONO_B = "b5b5b5b5-0000-4000-8000-00000000000b";
/** Usuário autenticado que não é dono de loja nenhuma — alvo de [215-I16]. */
const TERCEIRO = "c5c5c5c5-0000-4000-8000-00000000000c";
/** Id que não existe em `public.opcionais` — alvo de [215-I9]. */
const ID_FANTASMA = "dddddddd-0000-4000-8000-00000000000d";

/**
 * Baseline recriado antes de CADA teste. Bordas nasce COM EMPATE TOTAL
 * (0,0,0,0) — a normalização 0..n−1 sobre a permutação completa é o que existe
 * para matá-lo. Molhos e Sucos existem só para provar que nada vaza do par.
 */
const ORDEM_BORDAS = [0, 0, 0, 0] as const;
const ORDEM_MOLHOS = [0, 1] as const;
const ORDEM_SUCOS = [0, 1] as const;

type Cenario = {
  lojaA: string;
  lojaB: string;
  /** Grupos (opcionais_categorias). */
  gBordas: string;
  gMolhos: string;
  gSucos: string;
  /** Itens de Bordas, na loja A. `i3` nasce com `ativo = false` (decisão D1). */
  i1: string;
  i2: string;
  i3: string;
  i4: string;
  /** Itens de Molhos, na loja A. */
  m1: string;
  m2: string;
  /** Itens de Sucos, na loja B. */
  s1: string;
  s2: string;
};

async function garantirUsuarios(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a@teste.local'),
       ($2, 'dono-b@teste.local'),
       ($3, 'terceiro@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B, TERCEIRO],
  );
}

async function semear(t: TestDb): Promise<Cenario> {
  await garantirUsuarios(t);
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
    const grupo = (lojaId: string, nome: string, ordem: number) =>
      um(
        `insert into public.opcionais_categorias (loja_id, nome, ordem) values ($1,$2,$3) returning id`,
        [lojaId, nome, ordem],
      );
    const item = (
      lojaId: string,
      grupoId: string,
      nome: string,
      preco: string,
      ativo: boolean,
      ordem: number,
    ) =>
      um(
        `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco, ativo, ordem)
         values ($1,$2,$3,$4,$5,$6) returning id`,
        [lojaId, grupoId, nome, preco, ativo, ordem],
      );

    const lojaA = await loja(DONO_A, "loja-a-itens-grupo", "Loja A");
    const lojaB = await loja(DONO_B, "loja-b-itens-grupo", "Loja B");

    const gBordas = await grupo(lojaA, "Bordas", 0);
    const gMolhos = await grupo(lojaA, "Molhos", 1);
    const gSucos = await grupo(lojaB, "Sucos", 0);

    return {
      lojaA,
      lojaB,
      gBordas,
      gMolhos,
      gSucos,
      // `i3` INATIVO de propósito: é o item que [215-I2] tenta omitir.
      i1: await item(lojaA, gBordas, "Catupiry", "6.00", true, ORDEM_BORDAS[0]),
      i2: await item(lojaA, gBordas, "Cheddar", "7.50", true, ORDEM_BORDAS[1]),
      i3: await item(lojaA, gBordas, "Chocolate", "8.00", false, ORDEM_BORDAS[2]),
      i4: await item(lojaA, gBordas, "Requeijão", "5.25", true, ORDEM_BORDAS[3]),
      m1: await item(lojaA, gMolhos, "Barbecue", "2.00", true, ORDEM_MOLHOS[0]),
      m2: await item(lojaA, gMolhos, "Alho", "2.50", true, ORDEM_MOLHOS[1]),
      s1: await item(lojaB, gSucos, "Laranja", "9.00", true, ORDEM_SUCOS[0]),
      s2: await item(lojaB, gSucos, "Uva", "9.50", true, ORDEM_SUCOS[1]),
    };
  });
}

/**
 * Chama a RPC montando o array em SQL (`array[$3,$4,...]::uuid[]`) em vez de
 * confiar na serialização de array do driver — o que está sob teste é a função.
 */
function chamarRpc(
  db: PGlite,
  lojaId: string,
  grupoId: string,
  ids: readonly string[],
): Promise<{ rows: Array<{ afetadas: number }> }> {
  const literal = ids.length
    ? `array[${ids.map((_, i) => `$${i + 3}`).join(", ")}]::uuid[]`
    : `array[]::uuid[]`;
  return db.query<{ afetadas: number }>(
    `select public.reordenar_itens_do_grupo_opcional($1::uuid, $2::uuid, ${literal}) as afetadas`,
    [lojaId, grupoId, ...ids],
  );
}

/** Variante com array MULTIDIMENSIONAL — alvo da checagem `cardinality()`. */
function chamarRpcMatriz(
  db: PGlite,
  lojaId: string,
  grupoId: string,
  linhas: readonly (readonly string[])[],
): Promise<{ rows: Array<{ afetadas: number }> }> {
  let n = 2;
  const literal = linhas
    .map((linha) => `[${linha.map(() => `$${++n}::uuid`).join(", ")}]`)
    .join(", ");
  return db.query<{ afetadas: number }>(
    `select public.reordenar_itens_do_grupo_opcional($1::uuid, $2::uuid, array[${literal}]) as afetadas`,
    [lojaId, grupoId, ...linhas.flat()],
  );
}

type Falha = { code: string; message: string };

/** SQLSTATE + mensagem da exceção lançada por `fn` (nunca `null` — ver abaixo). */
async function falhaDe(fn: () => Promise<unknown>): Promise<Falha> {
  try {
    await fn();
    return { code: "NAO_LANCOU", message: "a chamada foi aceita" };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return { code: e.code ?? "SEM_CODE", message: e.message ?? "" };
  }
}

/** Fonte de verdade (BYPASSRLS), em transação PRÓPRIA — nunca a que lançou. */
async function ordemDe(t: TestDb, ids: readonly string[]): Promise<number[]> {
  const r = await t.asService((db) =>
    db.query<{ id: string; ordem: number }>(
      `select id, ordem from public.opcionais where id = any($1::uuid[])`,
      [ids],
    ),
  );
  const porId = new Map(r.rows.map((l) => [l.id, Number(l.ordem)]));
  return ids.map((id) => porId.get(id) ?? -1);
}

describe("215 RPC reordenar_itens_do_grupo_opcional — definer + RLS real (pglite)", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    c = await semear(t);
  });
  afterAll(async () => {
    await t.close();
  });

  /** Restaura o baseline (com o empate total de Bordas) antes de cada caso. */
  beforeEach(async () => {
    await t.asService(async (db) => {
      const set = (id: string, ordem: number) =>
        db.query(`update public.opcionais set ordem = $2 where id = $1`, [id, ordem]);
      await set(c.i1, ORDEM_BORDAS[0]);
      await set(c.i2, ORDEM_BORDAS[1]);
      await set(c.i3, ORDEM_BORDAS[2]);
      await set(c.i4, ORDEM_BORDAS[3]);
      await set(c.m1, ORDEM_MOLHOS[0]);
      await set(c.m2, ORDEM_MOLHOS[1]);
      await set(c.s1, ORDEM_SUCOS[0]);
      await set(c.s2, ORDEM_SUCOS[1]);
    });
  });

  /** Baseline completo intacto — pós-condição de TODO caso de recusa. */
  async function esperarBaselineIntacto(): Promise<void> {
    expect(await ordemDe(t, [c.i1, c.i2, c.i3, c.i4])).toEqual([...ORDEM_BORDAS]);
    expect(await ordemDe(t, [c.m1, c.m2])).toEqual([...ORDEM_MOLHOS]);
    expect(await ordemDe(t, [c.s1, c.s2])).toEqual([...ORDEM_SUCOS]);
  }

  // ───────────────────────────── I1 — caminho feliz do lojista (T5)
  it("[215-I1] dono A, permutação completa de Bordas (inclui o INATIVO) → retorna 4 e grava 0,1,2,3", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      chamarRpc(db, c.lojaA, c.gBordas, [c.i4, c.i1, c.i3, c.i2]),
    );
    expect(Number(r.rows[0].afetadas)).toBe(4);

    // A ordem é a da sequência enviada, e o empate total (0,0,0,0) morreu.
    const ordens = await ordemDe(t, [c.i4, c.i1, c.i3, c.i2]);
    expect(ordens).toEqual([0, 1, 2, 3]);
    expect(new Set(ordens).size).toBe(4);

    // Nada vazou para fora do par (loja, grupo).
    expect(await ordemDe(t, [c.m1, c.m2])).toEqual([...ORDEM_MOLHOS]);
    expect(await ordemDe(t, [c.s1, c.s2])).toEqual([...ORDEM_SUCOS]);
  });

  // ───────────────────────────── I2 — decisão D1: a permutação é do par INTEIRO
  it("[215-I2] dono A omite o item ativo=false (3 ids para 4 itens) → P0001, baseline intacto", async () => {
    // Prova a decisão D1 do usuário: o escopo da permutação inclui os INATIVOS.
    // Uma função que filtrasse `ativo = true` passaria em quase todos os outros
    // casos e falharia AQUI — este `it()` é a única coisa que a impede.
    const f = await falhaDe(() =>
      t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaA, c.gBordas, [c.i4, c.i1, c.i2])),
    );
    expect(f.code).toBe("P0001");

    await esperarBaselineIntacto();
  });

  // ───────────────────────────── I3 — TRAVA T2 (a que substitui a RLS perdida)
  it("[215-I3] dono A passando p_loja_id da loja B → P0001 'escopo negado', loja B intacta", async () => {
    // O CASO CENTRAL DA ISSUE. Tudo aqui é coerente do ponto de vista de dados:
    // p_loja_id = B, grupo de B, ids de B, cardinalidade certa. Sob DEFINER sem
    // a trava T2 este UPDATE PASSARIA — o dono A reescreveria a ordem da loja B
    // só trocando um argumento. Quem tem que recusar é o corpo da função.
    const f = await falhaDe(() =>
      t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaB, c.gSucos, [c.s2, c.s1])),
    );
    expect(f.code).toBe("P0001");
    // Sem esta linha o caso ficaria satisfeito por qualquer outra recusa.
    expect(f.message).toMatch(/escopo negado/);

    await esperarBaselineIntacto();
  });

  // ───────────────────────────── I4 — TRAVA T3 sob service_role (critério de aceite)
  it("[215-I4] asService com p_loja_id = A e grupo da loja B → P0001 'grupo fora da loja'", async () => {
    // A recusa exigida pelo critério de aceite: `p_loja_id` INCOERENTE mesmo sob
    // `service_role`. Sob service_role a via admin é legitimamente autorizada em
    // QUALQUER loja (T2 passa), então a única coisa que pode recusar é T3.
    //
    // A asserção de mensagem é o que torna o caso LETAL: sem ela, a contagem de
    // T4 (par (loja A, grupo Sucos) = 0 itens ≠ 2 ids) já derrubaria por acidente
    // aritmético e a trava T3 ficaria sem prova nenhuma — exatamente a
    // alternativa (a) que a decisão D-B rejeita.
    const f = await falhaDe(() =>
      t.asService((db) => chamarRpc(db, c.lojaA, c.gSucos, [c.s2, c.s1])),
    );
    expect(f.code).toBe("P0001");
    expect(f.message).toMatch(/grupo fora da loja/);

    await esperarBaselineIntacto();
  });

  // ───────────────────────────── I5 — a via admin FUNCIONA (sem isso o 211 não fecha)
  it("[215-I5] asService com p_loja_id = B e permutação completa de Sucos → retorna 2 e grava 0,1", async () => {
    // Ninguém é "dono" da loja B do ponto de vista de auth.uid() aqui (o claim
    // não tem `sub`). Se a autoridade fosse só `dono_id = auth.uid()`, o admin
    // não conseguiria reordenar nada e o débito 211 continuaria aberto.
    const r = await t.asService((db) => chamarRpc(db, c.lojaB, c.gSucos, [c.s2, c.s1]));
    expect(Number(r.rows[0].afetadas)).toBe(2);

    expect(await ordemDe(t, [c.s2, c.s1])).toEqual([0, 1]);
    // E a loja A não foi tocada.
    expect(await ordemDe(t, [c.i1, c.i2, c.i3, c.i4])).toEqual([...ORDEM_BORDAS]);
  });

  // ───────────────────────────── I6 — ATOMICIDADE (critério de aceite)
  it("[215-I6] falha injetada NO MEIO da permutação não deixa posição parcial gravada", async () => {
    // A prova que o loop de N `update` do admin (débito 211) nunca pôde dar: um
    // trigger derruba a 3ª posição (ordem = 2) DEPOIS que as duas primeiras já
    // foram calculadas. Sendo um statement único e transacional, as 4 posições
    // têm que voltar EXATAMENTE ao baseline.
    await t.db.exec(`
      create function public._tdd215_bloqueia_ordem_2() returns trigger
        language plpgsql as $$
      begin
        if new.ordem = 2 then
          raise exception 'tdd215: falha injetada no meio da permutacao';
        end if;
        return new;
      end $$;
      create trigger _tdd215_bloqueia before update on public.opcionais
        for each row execute function public._tdd215_bloqueia_ordem_2();
    `);
    try {
      const f = await falhaDe(() =>
        t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaA, c.gBordas, [c.i4, c.i1, c.i3, c.i2])),
      );
      expect(f.code).toBe("P0001");
      // Confirma que a falha veio do trigger (ou seja: o UPDATE chegou a rodar),
      // e não de uma trava que recusou antes de escrever. Sem isto, a função
      // inexistente "passaria" na asserção de estado.
      expect(f.message).toMatch(/falha injetada no meio da permutacao/);
    } finally {
      await t.db.exec(`
        drop trigger if exists _tdd215_bloqueia on public.opcionais;
        drop function if exists public._tdd215_bloqueia_ordem_2();
      `);
    }

    // Releitura em bloco asService SEPARADO (o de cima sofreu rollback do harness).
    expect(await ordemDe(t, [c.i1, c.i2, c.i3, c.i4])).toEqual([...ORDEM_BORDAS]);
  });

  // ───────────────────────────── I7 — permutação incompleta (T4)
  it("[215-I7] permutação incompleta (2 ids para 4 itens) → P0001, e nenhuma das 4 muda", async () => {
    // Fail-closed: normalizar um SUBCONJUNTO reintroduziria o empate que a
    // feature existe para eliminar (as não enviadas manteriam a ordem antiga).
    const f = await falhaDe(() =>
      t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaA, c.gBordas, [c.i4, c.i1])),
    );
    expect(f.code).toBe("P0001");

    await esperarBaselineIntacto();
  });

  // ───────────────────────────── I8 — id de outra loja dentro de p_ids (T6)
  it("[215-I8] id de item da loja B dentro de p_ids, cardinalidade batendo → P0001 nas duas lojas", async () => {
    const f = await falhaDe(() =>
      t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaA, c.gBordas, [c.i1, c.i2, c.s1, c.i4])),
    );
    expect(f.code).toBe("P0001");

    await esperarBaselineIntacto();
  });

  // ───────────────────────────── I9 — id inexistente (T6)
  it("[215-I9] id inexistente no lugar de um real, cardinalidade batendo → P0001, baseline intacto", async () => {
    const f = await falhaDe(() =>
      t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaA, c.gBordas, [c.i1, c.i2, ID_FANTASMA, c.i4])),
    );
    expect(f.code).toBe("P0001");

    await esperarBaselineIntacto();
  });

  // ───────────────────────────── I10 — duplicata (T6)
  it("[215-I10] id duplicado em p_ids → P0001, e nada muda", async () => {
    const f = await falhaDe(() =>
      t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaA, c.gBordas, [c.i1, c.i1, c.i3, c.i4])),
    );
    expect(f.code).toBe("P0001");

    await esperarBaselineIntacto();
  });

  // ───────────────────────────── I11 — lista vazia (T1)
  it("[215-I11] array vazio → P0001 'lista vazia', baseline intacto", async () => {
    const f = await falhaDe(() => t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaA, c.gBordas, [])));
    expect(f.code).toBe("P0001");
    expect(f.message).toMatch(/lista vazia/);

    await esperarBaselineIntacto();
  });

  // ───────────────────────────── I12 — array multidimensional (T1, achado 20260908130000)
  it("[215-I12] array MULTIDIMENSIONAL → P0001 (cardinality), e `ordem` NÃO vira 0,2,4,6", async () => {
    // `array_length(p_ids, 1)` conta SÓ a primeira dimensão: em
    // array[[i1,s1],[i2,s2],[i3,s1],[i4,s2]] ela vale 4 enquanto o `unnest`
    // entrega 8. Com 4 itens em Bordas, `4 = 4` passaria a checagem de
    // permutação, o UPDATE casaria as 4 linhas de Bordas (as de B caem no
    // `where loja_id`), `row_count = 4` passaria a segunda checagem — e `ordem`
    // sairia de `ordinality` sobre 8 posições: [0,2,4,6], quebrando a invariante
    // 0..n−1. `cardinality()` conta 8 ≠ 4 → raise.
    const f = await falhaDe(() =>
      t.asUser(DONO_A, (db) =>
        chamarRpcMatriz(db, c.lojaA, c.gBordas, [
          [c.i1, c.s1],
          [c.i2, c.s2],
          [c.i3, c.s1],
          [c.i4, c.s2],
        ]),
      ),
    );
    expect(f.code).toBe("P0001");

    const ordens = await ordemDe(t, [c.i1, c.i2, c.i3, c.i4]);
    expect(ordens).toEqual([...ORDEM_BORDAS]);
    // O sintoma exato do bug corrigido por 20260908130000 — não pode reaparecer.
    expect(ordens).not.toEqual([0, 2, 4, 6]);
    expect(await ordemDe(t, [c.s1, c.s2])).toEqual([...ORDEM_SUCOS]);
  });

  it("[215-I12b] array aninhado que É a permutação completa mantém a invariante 0..n−1", async () => {
    // Contraprova: o fix não é "recusar aninhamento", é CONTAR os elementos
    // reais. Sem esta asserção, um `array_ndims(p_ids) > 1 → raise` também
    // passaria em [215-I12].
    await t.asUser(DONO_A, (db) =>
      chamarRpcMatriz(db, c.lojaA, c.gBordas, [[c.i4], [c.i1], [c.i3], [c.i2]]),
    );

    const ordens = await ordemDe(t, [c.i4, c.i1, c.i3, c.i2]);
    expect(ordens).toEqual([0, 1, 2, 3]);
    expect(new Set(ordens).size).toBe(4);
  });

  // ───────────────────────────── I13 — anon não executa (T7)
  it("[215-I13] anon NÃO tem EXECUTE na função (42501), e nada muda", async () => {
    // Mais crítico aqui do que na função de grupos: sob DEFINER, um EXECUTE
    // sobrando para `anon` seria escrita cross-tenant com a anon key do bundle
    // público, sem nenhuma segunda rede.
    const f = await falhaDe(() =>
      t.asAnon((db) => chamarRpc(db, c.lojaA, c.gBordas, [c.i4, c.i1, c.i3, c.i2])),
    );
    expect(f.code).toBe("42501");

    await esperarBaselineIntacto();
  });

  // ───────────────────────────── I14 — T3 no caminho do lojista
  it("[215-I14] dono A com p_loja_id = A (sua) e grupo da loja B → P0001 'grupo fora da loja'", async () => {
    // O segundo parâmetro de escopo é o único que vem do cliente. Aqui T2 passa
    // (A é dono de A) e quem tem que recusar é T3.
    const f = await falhaDe(() =>
      t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaA, c.gSucos, [c.s2, c.s1])),
    );
    expect(f.code).toBe("P0001");
    expect(f.message).toMatch(/grupo fora da loja/);

    await esperarBaselineIntacto();
  });

  // ───────────────────────────── I15 — escreve SÓ `ordem` (T5)
  it("[215-I15] a RPC não reescreve a linha: nome, preco, ativo, loja_id e atualizado_em ficam", async () => {
    // Motivo documentado de RPC em vez de `.upsert()`: upsert reescreveria a
    // LINHA INTEIRA (incluindo `preco`) e um id inexistente inseriria item
    // fantasma.
    type Linha = {
      id: string;
      nome: string;
      preco: string;
      ativo: boolean;
      categoria_opcional_id: string;
      loja_id: string;
      atualizado_em: string;
    };
    const snapshot = () =>
      t.asService(async (db) => {
        const linhas = await db.query<Linha>(
          `select id, nome, preco, ativo, categoria_opcional_id, loja_id, atualizado_em
             from public.opcionais order by id`,
        );
        const total = await db.query<{ n: number }>(
          `select count(*)::int as n from public.opcionais`,
        );
        return { linhas: linhas.rows, n: Number(total.rows[0].n) };
      });

    const antes = await snapshot();
    await t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaA, c.gBordas, [c.i4, c.i1, c.i3, c.i2]));
    const depois = await snapshot();

    expect(depois.n).toBe(antes.n);
    expect(depois.linhas).toEqual(antes.linhas);
    // ...e ainda assim a ordem mudou (senão o caso seria vácuo).
    expect(await ordemDe(t, [c.i4, c.i1, c.i3, c.i2])).toEqual([0, 1, 2, 3]);
  });

  // ───────────────────────────── I16 — TRAVA T2 para quem não é dono de nada
  it("[215-I16] usuário autenticado sem loja nenhuma → P0001 'escopo negado', baseline intacto", async () => {
    // Permutação completa e coerente: se T2 não existisse, sob DEFINER este
    // UPDATE passaria e um usuário qualquer reordenaria a loja A.
    const f = await falhaDe(() =>
      t.asUser(TERCEIRO, (db) => chamarRpc(db, c.lojaA, c.gBordas, [c.i4, c.i1, c.i3, c.i2])),
    );
    expect(f.code).toBe("P0001");
    expect(f.message).toMatch(/escopo negado/);

    await esperarBaselineIntacto();
  });

  // ───────────────────────────── I17 — "0,1,3 ordena igual a 0,1,2" (decisão D1)
  it("[215-I17] lida como ANON, a vitrine vê os ATIVOS na sequência gravada (ordem 0,1,3)", async () => {
    // O inativo ocupa a posição 2 e não é renderizado; os ativos continuam em
    // 0,1,3 — que ordena exatamente como 0,1,2. É isto que torna aceitável
    // incluir os inativos na permutação (decisão D1).
    await t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaA, c.gBordas, [c.i4, c.i1, c.i3, c.i2]));

    const r = await t.asAnon((db) =>
      db.query<{ id: string; ordem: number }>(
        `select id, ordem from public.opcionais
          where categoria_opcional_id = $1 order by ordem asc`,
        [c.gBordas],
      ),
    );
    expect(r.rows.map((l) => l.id)).toEqual([c.i4, c.i1, c.i2]);
    expect(r.rows.map((l) => Number(l.ordem))).toEqual([0, 1, 3]);
  });
});

/**
 * CONTRATO PARA A FASE GREEN — issue 215, migration 1:
 *
 * `supabase/migrations/20260918120000_rpc_reordenar_itens_do_grupo_opcional.sql`
 *
 *   public.reordenar_itens_do_grupo_opcional(
 *     p_loja_id uuid, p_categoria_opcional_id uuid, p_ids uuid[]
 *   ) returns integer
 *     language plpgsql
 *     security definer            -- exigido por [215-I5] (via admin)
 *     set search_path = public
 *
 *   T1 cardinality(p_ids) = 0  → raise 'lista vazia'        (P0001) [I11, I12]
 *      -- cardinality(), NUNCA array_length(p_ids, 1)               [I12, I12b]
 *   T2 not (v_e_servico or exists(lojas l where l.id = p_loja_id
 *                                 and l.dono_id = auth.uid()))
 *                              → raise 'escopo negado'      (P0001) [I3, I16]
 *      -- v_e_servico := auth.role() = 'service_role'
 *      --                and current_setting('role', true)
 *      --                    not in ('authenticated','anon')        [I5]
 *   T3 not exists(opcionais_categorias oc where oc.id = p_categoria_opcional_id
 *                 and oc.loja_id = p_loja_id)
 *                              → raise 'grupo fora da loja' (P0001) [I4, I14]
 *      -- roda DEPOIS de T2 e ANTES da contagem, e vale sob service_role
 *   T4 count(*) from opcionais where loja_id = p_loja_id
 *        and categoria_opcional_id = p_categoria_opcional_id  -- SEM filtro de
 *        `ativo`: a permutação é do par INTEIRO                     [I2]
 *      <> cardinality(p_ids)   → raise (P0001)                      [I7]
 *   T5 update public.opcionais o set ordem = e.pos - 1
 *        from unnest(p_ids) with ordinality as e(id, pos)
 *       where o.id = e.id and o.loja_id = p_loja_id
 *         and o.categoria_opcional_id = p_categoria_opcional_id     [I1, I15]
 *   T6 get diagnostics row_count <> cardinality → raise (P0001) [I8, I9, I10]
 *      -- statement único ⇒ atomicidade                             [I6]
 *   return row_count                                                [I1, I5]
 *
 *   T7 revoke all on function ...(uuid, uuid, uuid[]) from public, anon;  [I13]
 *      grant execute on function ... to authenticated, service_role;      [I5]
 *
 * Os FRAGMENTOS DE MENSAGEM ('lista vazia', 'escopo negado', 'grupo fora da
 * loja') são contrato: [215-I3], [215-I4], [215-I14] e [215-I16] afirmam qual
 * trava recusou, não só que houve recusa. Mensagem de erro nunca chega à UI
 * (a action devolve `ERRO_ORDEM` genérico) — ela é só o rótulo da trava.
 *
 * Casos que precisam passar: [215-I1]..[215-I17].
 */
