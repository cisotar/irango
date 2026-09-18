import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 215 — parte que FECHA O DÉBITO 211.
 * Conversão de `public.reordenar_opcionais_da_categoria(uuid, uuid, uuid[])` de
 * `SECURITY INVOKER` para `SECURITY DEFINER` + travas de autoridade no corpo,
 * por `create or replace` em migration nova
 * (`20260918121000_rpc_reordenar_opcionais_da_categoria_definer.sql`).
 * Plano: tasks/215-...md, seções "Decisões de Design D-C" e "Cenários de teste".
 *
 * ─────────────── Por que esta conversão fecha o 211
 * `reordenarOpcionaisDaCategoriaAdmin` (src/app/admin/assinantes/actions/
 * admin-opcionais.ts:445-524) grava hoje com N `update` sequenciais FORA de
 * transação — queda de rede no 3º de 5 deixa `ordem` duplicada. Ela grava à mão
 * porque a RPC é `invoker` e o admin roda sob `service_role`. Movendo a
 * autoridade da RLS para o corpo da função, UMA função serve os dois chamadores
 * e o loop desaparece.
 *
 * ─────────────── [211-G1] não é um `it()` deste arquivo
 * É a suíte `tests/migrations/rpc_reordenar_opcionais_da_categoria.test.ts`
 * (13 casos [208-R1..R11]) rodando contra a função DEFINER **sem nenhuma
 * asserção alterada**. Não se troca um modelo de segurança sem uma prova; a
 * prova já está escrita. Se algum daqueles casos exigir mudança de asserção, o
 * desenho está errado — parar e reportar (plano, "Arquivos a Modificar").
 *
 * ─────────────── Anti-falso-verde: qual TRAVA recusou
 * Sob `invoker`, [211-G3] e [211-G4] já caem hoje — por acidente aritmético na
 * contagem (G3) e pela RLS (G4). Asserir só `P0001` deixaria os dois VERDES
 * antes da implementação e não provaria nada sobre T2/T3. Por isso ambos
 * afirmam o FRAGMENTO DE MENSAGEM que nomeia a trava nova:
 *   T2 → 'escopo negado'      T3 → 'categoria fora da loja'
 * Isso é CONTRATO para a fase GREEN, não preferência de texto.
 *
 * ─────────────── Anti-falso-verde: o rollback do harness
 * `withRole` (tests/helpers/pglite.ts:141-145) faz `rollback` quando o callback
 * lança. Toda releitura de "nada mudou" mora num bloco `asService` SEPARADO.
 */

const DONO_A = "a7a7a7a7-0000-4000-8000-00000000000a";
const DONO_B = "b7b7b7b7-0000-4000-8000-00000000000b";

/** Baselines COM EMPATE — a normalização 0..n−1 existe para matá-los. */
const ORDEM_LANCHES = [2, 2, 0] as const;
const ORDEM_PIZZAS = [4, 4, 4, 4, 4] as const;
const ORDEM_B = [0, 1] as const;

type Cenario = {
  lojaA: string;
  lojaB: string;
  catLanches: string;
  catPizzas: string;
  catB: string;
  /** Grupos de opcional da loja A. */
  g: [string, string, string, string, string];
  /** Grupos de opcional da loja B. */
  gb: [string, string];
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
 * Loja A: Lanches ⋈ {g1,g2,g3} e Pizzas ⋈ {g1..g5} (5 associações, para a
 * falha injetada de [211-G5] cair NO MEIO). Loja B: Pizzas-B ⋈ {gb1,gb2}.
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

    const lojaA = await loja(DONO_A, "loja-a-definer-grupos", "Loja A");
    const lojaB = await loja(DONO_B, "loja-b-definer-grupos", "Loja B");

    const c: Cenario = {
      lojaA,
      lojaB,
      catLanches: await catProduto(lojaA, "Lanches", 0),
      catPizzas: await catProduto(lojaA, "Pizzas", 1),
      catB: await catProduto(lojaB, "Massas", 0),
      g: [
        await grupo(lojaA, "Molhos", 0),
        await grupo(lojaA, "Adicionais", 1),
        await grupo(lojaA, "Bebidas", 2),
        await grupo(lojaA, "Sobremesas", 3),
        await grupo(lojaA, "Bordas", 4),
      ],
      gb: [await grupo(lojaB, "Queijos", 0), await grupo(lojaB, "Sucos", 1)],
    };

    const assoc = (lojaId: string, catId: string, grupoId: string) =>
      db.query(
        `insert into public.categoria_produto_opcionais (loja_id, categoria_id, categoria_opcional_id)
         values ($1,$2,$3)`,
        [lojaId, catId, grupoId],
      );
    for (const g of c.g.slice(0, 3)) await assoc(lojaA, c.catLanches, g);
    for (const g of c.g) await assoc(lojaA, c.catPizzas, g);
    for (const g of c.gb) await assoc(lojaB, c.catB, g);

    return c;
  });
}

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

type Falha = { code: string; message: string };

async function falhaDe(fn: () => Promise<unknown>): Promise<Falha> {
  try {
    await fn();
    return { code: "NAO_LANCOU", message: "a chamada foi aceita" };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return { code: e.code ?? "SEM_CODE", message: e.message ?? "" };
  }
}

/**
 * Igual a `asUser`/`asAnon`/`asService` (pglite.ts:141-153), mas SEM amarrar o
 * `role` SQL efetivo ao claim `role` do JWT — achado do teste de mutação
 * manual da 215 (auditoria pós-implementação): mutar T2 para
 * `v_e_servico := auth.role() = 'service_role'` (removendo a 2ª conjunção)
 * deixa toda esta suíte verde, porque `asService`/`asUser`/`asAnon` sempre
 * mandam os dois sinais JUNTOS. Este helper forja a DIVERGÊNCIA entre eles — o
 * cenário de forja/pool que a decisão D-A (plano da 215, alternativa (c)) diz
 * que só aconteceria "num cenário de forja, onde o correto é negar".
 */
async function comSessaoEClaimDivergentes<T>(
  t: TestDb,
  roleSql: "anon" | "authenticated",
  claims: Record<string, unknown>,
  fn: (db: PGlite) => Promise<T>,
): Promise<T> {
  await t.db.exec("begin");
  try {
    await t.db.query(`set local role ${roleSql}`);
    await t.db.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(claims),
    ]);
    const result = await fn(t.db);
    await t.db.exec("commit");
    return result;
  } catch (err) {
    await t.db.exec("rollback");
    throw err;
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

describe("211/215 reordenar_opcionais_da_categoria convertida para SECURITY DEFINER", () => {
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
    await t.asService(async (db) => {
      const set = (catId: string, grupoId: string, ordem: number) =>
        db.query(
          `update public.categoria_produto_opcionais set ordem = $3
            where categoria_id = $1 and categoria_opcional_id = $2`,
          [catId, grupoId, ordem],
        );
      for (let i = 0; i < 3; i++) await set(c.catLanches, c.g[i], ORDEM_LANCHES[i]);
      for (let i = 0; i < 5; i++) await set(c.catPizzas, c.g[i], ORDEM_PIZZAS[i]);
      for (let i = 0; i < 2; i++) await set(c.catB, c.gb[i], ORDEM_B[i]);
    });
  });

  async function esperarBaselineIntacto(): Promise<void> {
    expect(await ordemAtual(t, c.catLanches, c.g.slice(0, 3))).toEqual([...ORDEM_LANCHES]);
    expect(await ordemAtual(t, c.catPizzas, c.g)).toEqual([...ORDEM_PIZZAS]);
    expect(await ordemAtual(t, c.catB, c.gb)).toEqual([...ORDEM_B]);
  }

  // ───────────────────────────── G2 — a via admin passa a funcionar pela RPC
  it("[211-G2] asService com permutação completa do par → retorna n e grava 0..n−1", async () => {
    // É o caminho que `reordenarOpcionaisDaCategoriaAdmin` passa a usar no lugar
    // do loop de N `update`. Já verde sob `invoker` (service_role tem BYPASSRLS):
    // vale como REDE DE PROTEÇÃO da conversão, não como vermelho.
    const ordemNova = [c.g[2], c.g[0], c.g[1]];
    const r = await t.asService((db) => chamarRpc(db, c.lojaA, c.catLanches, ordemNova));
    expect(Number(r.rows[0].afetadas)).toBe(3);

    const ordens = await ordemAtual(t, c.catLanches, ordemNova);
    expect(ordens).toEqual([0, 1, 2]);
    expect(new Set(ordens).size).toBe(3); // o empate (2,2,0) morreu
    // Pizzas compartilha os MESMOS grupos e não foi tocada (escopo do par).
    expect(await ordemAtual(t, c.catPizzas, c.g)).toEqual([...ORDEM_PIZZAS]);
    expect(await ordemAtual(t, c.catB, c.gb)).toEqual([...ORDEM_B]);
  });

  // ───────────────────────────── G3 — TRAVA T3 sob service_role
  it("[211-G3] asService com p_loja_id = A e categoria de produto da loja B → P0001 'categoria fora da loja'", async () => {
    // Sob `service_role` a via admin é legitimamente autorizada em QUALQUER loja
    // (T2 passa), então "recusar p_loja_id de outra loja" só existe como
    // COERÊNCIA — e a coerência tem que ser uma LINHA do corpo, não um efeito
    // colateral da contagem. Sem a asserção de mensagem este caso já estaria
    // verde hoje (par (loja A, catB) = 0 associações ≠ 2 ids) e a trava T3
    // ficaria sem prova — a alternativa (a) que a decisão D-B rejeita.
    const f = await falhaDe(() => t.asService((db) => chamarRpc(db, c.lojaA, c.catB, c.gb)));
    expect(f.code).toBe("P0001");
    expect(f.message).toMatch(/categoria fora da loja/);

    await esperarBaselineIntacto();
  });

  // ───────────────────────────── G4 — TRAVA T2 no lugar da RLS
  it("[211-G4] dono A com p_loja_id da loja B → P0001 'escopo negado' (T2, não mais a RLS)", async () => {
    // Antigo [208-R2], agora sob outro mecanismo. Sob DEFINER a RLS não é mais
    // avaliada dentro da função: se T2 não existir, este UPDATE PASSA e o dono A
    // reescreve a ordem da loja B. A asserção de mensagem é o que distingue
    // "recusou pela trava nova" de "recusou pela RLS que estamos removendo".
    const f = await falhaDe(() =>
      t.asUser(DONO_A, (db) => chamarRpc(db, c.lojaB, c.catB, [c.gb[1], c.gb[0]])),
    );
    expect(f.code).toBe("P0001");
    expect(f.message).toMatch(/escopo negado/);

    await esperarBaselineIntacto();
  });

  it("[211-G4b] a função está declarada SECURITY DEFINER (acrescentado pelo tdd)", async () => {
    // Prova estrutural direta da conversão, complementar a [211-G4]: sem ela, a
    // única evidência de que a função virou DEFINER seria indireta. `prosecdef`
    // é o flag do catálogo.
    const r = await t.asService((db) =>
      db.query<{ prosecdef: boolean }>(
        `select p.prosecdef
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'reordenar_opcionais_da_categoria'`,
      ),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].prosecdef).toBe(true);
  });

  // ───────────────────────────── G4c (achado do teste de mutação manual, pós-215)
  it("[211-G4c] SESSÃO SQL 'authenticated' com claim role FORJADO 'service_role' → T2 recusa pela via do dono", async () => {
    // Espelho de [215-I18] para a função de GRUPOS. Divergência deliberada
    // entre os dois sinais de T2 (só possível chamando `set local role` +
    // `set_config('request.jwt.claims', ...)` DIRETO, nunca via asService/
    // asUser/asAnon): role SQL efetivo 'authenticated', claim 'service_role'.
    // Sem a 2ª conjunção de v_e_servico, T2 trataria isto como via de serviço
    // e passaria sem checar dono_id — dono A não é dono da loja B.
    const f = await falhaDe(() =>
      comSessaoEClaimDivergentes(
        t,
        "authenticated",
        { sub: DONO_A, role: "service_role" },
        (db) => chamarRpc(db, c.lojaB, c.catB, [c.gb[1], c.gb[0]]),
      ),
    );
    expect(f.code).toBe("P0001");
    expect(f.message).toMatch(/escopo negado/);

    await esperarBaselineIntacto();
  });

  // ───────────────────────────── G5 — ATOMICIDADE (o critério de aceite do 211)
  it("[211-G5] falha injetada na 3ª de 5 posições não deixa NENHUMA posição parcial", async () => {
    // Literalmente o débito 211: com N `update` sequenciais fora de transação,
    // as posições 0 e 1 ficariam gravadas e as demais antigas → `ordem`
    // duplicada e vitrine não determinística. Com um statement único, zero.
    await t.db.exec(`
      create function public._tdd211_bloqueia_ordem_2() returns trigger
        language plpgsql as $$
      begin
        if new.ordem = 2 then
          raise exception 'tdd211: falha injetada na terceira posicao';
        end if;
        return new;
      end $$;
      create trigger _tdd211_bloqueia before update on public.categoria_produto_opcionais
        for each row execute function public._tdd211_bloqueia_ordem_2();
    `);
    try {
      const f = await falhaDe(() =>
        t.asService((db) =>
          chamarRpc(db, c.lojaA, c.catPizzas, [c.g[4], c.g[3], c.g[2], c.g[1], c.g[0]]),
        ),
      );
      expect(f.code).toBe("P0001");
      // Confirma que a falha veio do trigger (o UPDATE chegou a rodar) e não de
      // uma trava que recusou antes de escrever — senão a asserção de estado
      // abaixo seria satisfeita por vacuidade.
      expect(f.message).toMatch(/falha injetada na terceira posicao/);
    } finally {
      await t.db.exec(`
        drop trigger if exists _tdd211_bloqueia on public.categoria_produto_opcionais;
        drop function if exists public._tdd211_bloqueia_ordem_2();
      `);
    }

    // Releitura em bloco asService SEPARADO (o de cima sofreu rollback).
    expect(await ordemAtual(t, c.catPizzas, c.g)).toEqual([...ORDEM_PIZZAS]);
  });
});

/**
 * CONTRATO PARA A FASE GREEN — issue 215, migration 2 (fecha o 211):
 *
 * `supabase/migrations/20260918121000_rpc_reordenar_opcionais_da_categoria_definer.sql`
 *
 *   `create or replace` de public.reordenar_opcionais_da_categoria(
 *      p_loja_id uuid, p_categoria_id uuid, p_ids uuid[]) returns integer
 *   — MESMO nome, parâmetros, tipos e retorno (`create or replace` não pode
 *     mudá-los). O arquivo 20260917121000 NÃO é editado: ele já está aplicado.
 *
 *   trocar `security invoker` por `security definer`                 [G4b]
 *   + as mesmas declarações v_role_sessao / v_e_servico da migration 1
 *   + T2 ANTES da contagem:
 *       not (v_e_servico or exists(lojas l where l.id = p_loja_id
 *                                  and l.dono_id = auth.uid()))
 *         → raise 'reordenar_opcionais_da_categoria: escopo negado'  [G4]
 *   + T3 contra public.categorias (categoria de PRODUTO):
 *       not exists(categorias c where c.id = p_categoria_id
 *                  and c.loja_id = p_loja_id)
 *         → raise 'reordenar_opcionais_da_categoria: categoria fora da loja'
 *                                                                    [G3]
 *   + resto do corpo IDÊNTICO ao de hoje (cardinality, contagem do par,
 *     update único com ordinality-1, get diagnostics)                [G2, G5]
 *   + revoke/grant repetidos por idempotência.
 *
 *   Comentário de topo obrigatório explicando que esta migration REVOGA a
 *   afirmação do cabeçalho de 20260917121000 ("SECURITY INVOKER, nunca
 *   DEFINER") e por quê.
 *
 * GATE: esta suíte verde E `rpc_reordenar_opcionais_da_categoria.test.ts`
 * (13 casos) verde SEM NENHUMA ASSERÇÃO ALTERADA — é o [211-G1].
 */
