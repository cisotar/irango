import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 175 — RPC `public.reordenar_categorias(uuid, uuid[])`
 * sob RLS real (pglite). Cobre os cenários 4 (empate) e 6 (isolamento) da issue.
 *
 * A função AINDA NÃO EXISTE: a migration
 * `supabase/migrations/20260908120000_rpc_reordenar_categorias.sql` é da fase
 * GREEN (`executar`). Logo toda chamada abaixo falha hoje com SQLSTATE 42883
 * ("function public.reordenar_categorias(uuid, uuid[]) does not exist").
 * Nenhuma linha de produção é escrita aqui.
 *
 * ─────────────────────────── Por que este arquivo, e não um mock
 * Um mock não consegue provar "nada da loja B foi escrito": ele não tem linhas.
 * Aqui as políticas `categorias_escrita_propria` / `categorias_leitura_publica`
 * (20260614002000_rls_catalogo.sql) e o SQL da função rodam de verdade.
 *
 * ─────────────────────────── Anti-falso-verde nº1: o CÓDIGO do erro
 * "a chamada lança" é uma asserção INÚTIL enquanto a função não existe — ela
 * passaria hoje pelo motivo errado (42883, undefined_function). Por isso todo
 * caso de recusa afirma o SQLSTATE ESPERADO DA FUNÇÃO:
 *   - recusa por regra de negócio  → P0001 (`raise exception` do plpgsql);
 *   - recusa de EXECUTE para anon  → 42501 (insufficient_privilege, do
 *     `revoke all ... from public, anon`).
 * Ambos são diferentes de 42883, então o RED de hoje é real e o GREEN de
 * amanhã tem que ser pelo motivo certo.
 *
 * ─────────────────────────── Anti-falso-verde nº2: o rollback do harness
 * `withRole` (tests/helpers/pglite.ts:128-146) abre `begin` e faz `rollback`
 * quando o callback LANÇA. Se a asserção de "nada mudou" ficasse no MESMO bloco
 * que espera a exceção, ela passaria por causa do rollback do harness — não por
 * causa da função. Toda releitura de `ordem` mora, portanto, num bloco
 * `asService` SEPARADO (transação nova, BYPASSRLS = fonte de verdade), executado
 * DEPOIS do bloco que lançou.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/** Baseline recriado antes de CADA teste — inclui o empate do cenário 4. */
const ORDEM_INICIAL_A: Record<"a1" | "a2" | "a3", number> = { a1: 2, a2: 2, a3: 0 };
const ORDEM_INICIAL_B: Record<"b1" | "b2", number> = { b1: 0, b2: 1 };

type Cenario = {
  lojaA: string;
  lojaB: string;
  a1: string;
  a2: string;
  a3: string;
  b1: string;
  b2: string;
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

/** Loja A (3 categorias) e loja B (2 categorias), ambas ATIVAS. */
async function semear(t: TestDb): Promise<Cenario> {
  await garantirDonos(t);
  return t.asService(async (db) => {
    const um = async (sql: string, params: unknown[]) => {
      const r = await db.query<{ id: string }>(sql, params);
      return r.rows[0].id;
    };
    const lojaA = await um(
      `insert into public.lojas (dono_id, slug, nome, ativo)
       values ($1, 'loja-a', 'Loja A', true) returning id`,
      [DONO_A],
    );
    const lojaB = await um(
      `insert into public.lojas (dono_id, slug, nome, ativo)
       values ($1, 'loja-b', 'Loja B', true) returning id`,
      [DONO_B],
    );
    const cat = (lojaId: string, nome: string, ordem: number) =>
      um(
        `insert into public.categorias (loja_id, nome, ordem)
         values ($1, $2, $3) returning id`,
        [lojaId, nome, ordem],
      );
    return {
      lojaA,
      lojaB,
      a1: await cat(lojaA, "Pizzas", ORDEM_INICIAL_A.a1),
      a2: await cat(lojaA, "Bebidas", ORDEM_INICIAL_A.a2),
      a3: await cat(lojaA, "Sobremesas", ORDEM_INICIAL_A.a3),
      b1: await cat(lojaB, "Lanches", ORDEM_INICIAL_B.b1),
      b2: await cat(lojaB, "Sucos", ORDEM_INICIAL_B.b2),
    };
  });
}

/**
 * Chama a RPC montando o array em SQL (`array[$2,$3,...]::uuid[]`) em vez de
 * confiar na serialização de array do driver — o que está sob teste é a função,
 * não o binding do pglite. Os placeholders vêm de índices, nunca de dado.
 */
function chamarRpc(
  db: PGlite,
  lojaId: string,
  ids: readonly string[],
): Promise<{ rows: Array<{ afetadas: number }> }> {
  const placeholders = ids.map((_, i) => `$${i + 2}`).join(", ");
  return db.query<{ afetadas: number }>(
    `select public.reordenar_categorias($1::uuid, array[${placeholders}]::uuid[]) as afetadas`,
    [lojaId, ...ids],
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
async function ordemAtual(t: TestDb, ids: readonly string[]): Promise<number[]> {
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  const r = await t.asService((db) =>
    db.query<{ id: string; ordem: number }>(
      `select id, ordem from public.categorias where id in (${placeholders})`,
      [...ids],
    ),
  );
  const porId = new Map(r.rows.map((l) => [l.id, l.ordem]));
  return ids.map((id) => porId.get(id) ?? -1);
}

describe("175 RPC reordenar_categorias — RLS real (pglite)", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    c = await semear(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // Restaura o baseline (com o EMPATE de A) antes de cada caso, para que
  // "nada mudou" seja uma afirmação exata e independente da ordem dos testes.
  beforeEach(async () => {
    await t.asService(async (db) => {
      await db.query(`update public.categorias set ordem = $2 where id = $1`, [
        c.a1,
        ORDEM_INICIAL_A.a1,
      ]);
      await db.query(`update public.categorias set ordem = $2 where id = $1`, [
        c.a2,
        ORDEM_INICIAL_A.a2,
      ]);
      await db.query(`update public.categorias set ordem = $2 where id = $1`, [
        c.a3,
        ORDEM_INICIAL_A.a3,
      ]);
      await db.query(`update public.categorias set ordem = $2 where id = $1`, [
        c.b1,
        ORDEM_INICIAL_B.b1,
      ]);
      await db.query(`update public.categorias set ordem = $2 where id = $1`, [
        c.b2,
        ORDEM_INICIAL_B.b2,
      ]);
    });
  });

  // ───────────────────────────────────────────── R1 — cenário 6 (isolamento)
  it("[R1] id de categoria da loja B no array do dono A → P0001, e NADA muda em A nem em B", async () => {
    // A permutação tem o tamanho certo (3 ids para 3 categorias em A), então a
    // contagem passa; quem recusa é o `row_count` do UPDATE escopado por
    // `loja_id = p_loja_id` — b1 não casa, 2 <> 3 → raise → rollback atômico.
    const code = await sqlstateDaFalha(() =>
      t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaA, [c.a1, c.b1, c.a3])),
    );
    expect(code).toBe("P0001");

    // Bloco SEPARADO (o de cima já sofreu rollback do harness): a fonte de
    // verdade tem que mostrar o baseline intacto nas DUAS lojas.
    expect(await ordemAtual(t, [c.a1, c.a2, c.a3])).toEqual([
      ORDEM_INICIAL_A.a1,
      ORDEM_INICIAL_A.a2,
      ORDEM_INICIAL_A.a3,
    ]);
    expect(await ordemAtual(t, [c.b1, c.b2])).toEqual([
      ORDEM_INICIAL_B.b1,
      ORDEM_INICIAL_B.b2,
    ]);
  });

  // ───────────────────────────────────────────── R2 — cenário 6b (loja alheia)
  it("[R2] dono A passando p_loja_id da loja B → P0001, e nenhuma linha de B muda", async () => {
    // A contagem `where loja_id = lojaB` é visível a A (categorias_leitura_publica,
    // loja B ativa) e bate: 2 ids para 2 categorias. A recusa vem da RLS de
    // ESCRITA — o UPDATE afeta 0 linhas, 0 <> 2 → raise.
    const code = await sqlstateDaFalha(() =>
      t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaB, [c.b2, c.b1])),
    );
    expect(code).toBe("P0001");

    expect(await ordemAtual(t, [c.b1, c.b2])).toEqual([
      ORDEM_INICIAL_B.b1,
      ORDEM_INICIAL_B.b2,
    ]);
  });

  // ───────────────────────────────────────────── R3 — cenário 4 (empate)
  it("[R3] empate pré-existente (2,2,0) vira 0..n−1 sem empate, na sequência enviada", async () => {
    // Este é o cenário 4 da issue: normalizar sobre a lista COMPLETA mata o
    // empate de graça. Ordem enviada [a2, a3, a1] → ordem 0, 1, 2.
    await t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaA, [c.a2, c.a3, c.a1]));

    const ordens = await ordemAtual(t, [c.a2, c.a3, c.a1]);
    expect(ordens).toEqual([0, 1, 2]);
    // Sem empate: 3 categorias, 3 valores distintos.
    expect(new Set(ordens).size).toBe(3);
  });

  // ───────────────────────────────────────────── R4 — lista incompleta
  it("[R4] lista incompleta (2 ids para 3 categorias) → P0001, e nenhuma das 3 muda", async () => {
    // Fail-closed por design: normalizar um SUBCONJUNTO reintroduziria o empate
    // que esta feature existe para eliminar.
    const code = await sqlstateDaFalha(() =>
      t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaA, [c.a1, c.a2])),
    );
    expect(code).toBe("P0001");

    expect(await ordemAtual(t, [c.a1, c.a2, c.a3])).toEqual([
      ORDEM_INICIAL_A.a1,
      ORDEM_INICIAL_A.a2,
      ORDEM_INICIAL_A.a3,
    ]);
  });

  // ───────────────────────────────────────────── R5 — duplicata
  it("[R5] id duplicado no array → P0001, e nada muda", async () => {
    // [a1, a1, a3] tem cardinalidade 3 (passa a contagem) mas o UPDATE atinge
    // só 2 linhas distintas → 2 <> 3 → raise.
    const code = await sqlstateDaFalha(() =>
      t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaA, [c.a1, c.a1, c.a3])),
    );
    expect(code).toBe("P0001");

    expect(await ordemAtual(t, [c.a1, c.a2, c.a3])).toEqual([
      ORDEM_INICIAL_A.a1,
      ORDEM_INICIAL_A.a2,
      ORDEM_INICIAL_A.a3,
    ]);
  });

  // ───────────────────────────────────────────── R6 — caminho feliz
  it("[R6] permutação completa do próprio dono → retorna 3 e grava 0,1,2 na sequência enviada", async () => {
    const r = await t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaA, [c.a3, c.a1, c.a2]));
    expect(Number(r.rows[0].afetadas)).toBe(3);

    expect(await ordemAtual(t, [c.a3, c.a1, c.a2])).toEqual([0, 1, 2]);
    // Anti-falso-verde: a loja B não é tocada por uma operação da loja A.
    expect(await ordemAtual(t, [c.b1, c.b2])).toEqual([
      ORDEM_INICIAL_B.b1,
      ORDEM_INICIAL_B.b2,
    ]);
  });

  // ───────────────────────────────────────────── R7 — anon não executa
  it("[R7] anon NÃO tem EXECUTE na função (42501), e nada muda", async () => {
    // O Postgres concede EXECUTE a PUBLIC por padrão em função nova e o projeto
    // não tem `alter default privileges ... on functions` — sem o
    // `revoke all ... from public, anon` da migration, anon executaria.
    // 42501 = insufficient_privilege. Hoje isto é 42883 (função inexistente),
    // que é justamente o RED.
    const code = await sqlstateDaFalha(() =>
      t.asAnon((db) => chamarRpc(db, c.lojaA, [c.a2, c.a3, c.a1])),
    );
    expect(code).toBe("42501");

    expect(await ordemAtual(t, [c.a1, c.a2, c.a3])).toEqual([
      ORDEM_INICIAL_A.a1,
      ORDEM_INICIAL_A.a2,
      ORDEM_INICIAL_A.a3,
    ]);
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 175, camada de banco:
 *
 * Criar `supabase/migrations/20260908120000_rpc_reordenar_categorias.sql` com:
 *
 *   public.reordenar_categorias(p_loja_id uuid, p_ids uuid[]) returns integer
 *     language plpgsql
 *     security invoker            -- NÃO definer: categorias_escrita_propria
 *     set search_path = public       continua valendo dentro da função
 *
 *   1) lista vazia                        → raise exception (P0001)
 *   2) count(*) where loja_id = p_loja_id <> array_length(p_ids,1)
 *                                         → raise exception (P0001)   [R4]
 *   3) update ... set ordem = e.pos - 1
 *        from unnest(p_ids) with ordinality as e(id, pos)
 *       where c.id = e.id and c.loja_id = p_loja_id                    [R3, R6]
 *   4) get diagnostics row_count <> enviadas
 *                                         → raise exception (P0001)   [R1, R2, R5]
 *   5) return row_count
 *
 *   revoke all on function public.reordenar_categorias(uuid, uuid[])
 *     from public, anon;                                               [R7]
 *   grant execute on function public.reordenar_categorias(uuid, uuid[])
 *     to authenticated, service_role;                                  [R3, R6]
 *
 * Nenhuma tabela, coluna, índice ou policy nova. `categorias.ordem` e o índice
 * `categorias_loja_ordem` já existem; `categorias_escrita_propria` já cobre o
 * UPDATE.
 *
 * Casos que precisam passar após a migration: [R1]..[R7].
 */
