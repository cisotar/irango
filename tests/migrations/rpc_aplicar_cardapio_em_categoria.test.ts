import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 250 — a RPC
 * `public.aplicar_cardapio_em_categoria(p_loja_id, p_cardapio_id, p_categoria_id)`.
 *
 * Spec: specs/cardapio-sazonal.md (§`public.aplicar_cardapio_em_categoria`) ·
 *       D2 · RN-09, RN-10. Issue: tasks/250-...md. Fatia crítica 5.
 *
 * O que este arquivo prova — e por que cada asserção existe:
 *
 *  T1  `p_categoria_id` nulo é recusado DE PROPÓSITO (`parametro nulo`): aplicar
 *      à "Sem categoria" usa o caminho de seleção explícita, e o mesmo parâmetro
 *      não pode ter dois significados.
 *  T2  AUTORIDADE: `lojas where id = p_loja_id and dono_id = auth.uid()`.
 *      Recusa com o fragmento LITERAL `loja alheia`.
 *      **`asService` cai aqui** — `service_role` tem BYPASSRLS, então a trava
 *      NÃO pode depender de policy: sob service_role `auth.uid()` é NULL, o
 *      exists é falso e a função fail-closes. É esse caso que prova que a
 *      defesa é o predicado explícito, e não a RLS.
 *  T3  COERÊNCIA dos pares, DEPOIS de T2 — `cardapio fora da loja` /
 *      `categoria fora da loja`. A ordem é regra: invertida, a função viraria
 *      oráculo de existência de cardápio/categoria em loja alheia
 *      (`seguranca.md` §2). Há um teste dedicado a essa PRECEDÊNCIA.
 *  T4  `insert ... select` com `on conflict do nothing` + `get diagnostics`:
 *      inclui produto `oculto` e `disponivel = false` (RN-10) e reaplicar
 *      devolve 0 sem duplicar linha.
 *  ACL `anon` é recusado por FALTA DE PRIVILÉGIO (`permission denied for
 *      function`), NÃO por RLS nem por T2 — o Postgres concede EXECUTE a PUBLIC
 *      por padrão e o projeto não tem `alter default privileges ... on
 *      functions`; sem o `revoke`, `anon` executaria com a chave do bundle.
 *      A asserção é explícita nos dois sentidos: contém "permission denied" E
 *      **não** contém "loja alheia" (se chegasse em T2, o revoke não existe).
 *
 * Lição aplicada ("SQLSTATE não basta em teste de escopo"): toda recusa afirma
 * o FRAGMENTO LITERAL da mensagem, nunca só `P0001` — uma trava de escopo passa
 * por acidente quando só se checa o código do erro.
 *
 * Anti-falso-verde: toda recusa é reconferida via `asService` (BYPASSRLS) — a
 * contagem em `cardapio_produtos` não pode ter mudado.
 *
 * Nenhum código de produção é escrito aqui. Quem deixa verde é a fase GREEN.
 */

const DONO_A = "a5000000-0000-4000-8000-000000000001";
const DONO_B = "b5000000-0000-4000-8000-000000000002";

type Cenario = {
  lojaA: string;
  lojaB: string;
  cardapioA: string;
  cardapioB: string;
  categoriaA: string;
  categoriaB: string;
  /** Os 3 produtos da categoria A: normal, oculto, indisponível (RN-10). */
  produtosCatA: string[];
  /** Produto da loja A FORA da categoria A — não pode ser vinculado. */
  produtoAForaDaCategoria: string;
};

/** Executa a RPC como um usuário logado e devolve o inteiro retornado. */
async function chamarComoDono(
  t: TestDb,
  dono: string,
  args: [string | null, string | null, string | null],
): Promise<number> {
  return t.asUser(dono, async (db) => {
    const r = await db.query<{ aplicar_cardapio_em_categoria: number }>(
      `select public.aplicar_cardapio_em_categoria($1, $2, $3) as aplicar_cardapio_em_categoria`,
      args,
    );
    return r.rows[0].aplicar_cardapio_em_categoria;
  });
}

/** Mensagem do erro levantado — nunca deixa passar silenciosamente. */
async function erroAoChamar(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("A chamada foi ACEITA — esperava-se recusa.");
}

async function contarVinculos(t: TestDb, cardapioId: string): Promise<number> {
  return t.asService(async (db) => {
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.cardapio_produtos where cardapio_id = $1`,
      [cardapioId],
    );
    return r.rows[0].n;
  });
}

describe("250 · RPC aplicar_cardapio_em_categoria (T1–T4 + ACL)", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();

    await t.db.query(
      `insert into auth.users (id, email) values
         ($1, 'dono-a-250@teste.local'),
         ($2, 'dono-b-250@teste.local')
       on conflict (id) do nothing`,
      [DONO_A, DONO_B],
    );

    c = await t.asService(async (db) => {
      const lojas = await db.query<{ id: string; dono_id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo) values
           ($1, 'loja-a-rpc-250', 'Loja A', true),
           ($2, 'loja-b-rpc-250', 'Loja B', true)
         returning id, dono_id`,
        [DONO_A, DONO_B],
      );
      const lojaA = lojas.rows.find((l) => l.dono_id === DONO_A)!.id;
      const lojaB = lojas.rows.find((l) => l.dono_id === DONO_B)!.id;

      const categorias = await db.query<{ id: string; loja_id: string }>(
        `insert into public.categorias (loja_id, nome) values
           ($1, 'Inverno A'),
           ($2, 'Inverno B')
         returning id, loja_id`,
        [lojaA, lojaB],
      );
      const categoriaA = categorias.rows.find((r) => r.loja_id === lojaA)!.id;
      const categoriaB = categorias.rows.find((r) => r.loja_id === lojaB)!.id;

      // RN-10: a RPC inclui produto OCULTO e `disponivel = false`. Participar de
      // um cardápio é ortogonal a esses dois eixos — os três entram.
      const naCategoria = await db.query<{ id: string }>(
        `insert into public.produtos (loja_id, categoria_id, nome, preco, oculto, disponivel) values
           ($1, $2, 'Sopa de cebola', 30.00, false, true),
           ($1, $2, 'Sopa oculta',    30.00, true,  true),
           ($1, $2, 'Sopa esgotada',  30.00, false, false)
         returning id`,
        [lojaA, categoriaA],
      );

      const fora = await db.query<{ id: string }>(
        `insert into public.produtos (loja_id, nome, preco) values ($1, 'Pastel sem categoria', 12.00)
         returning id`,
        [lojaA],
      );

      const cardapios = await db.query<{ id: string; loja_id: string }>(
        `insert into public.cardapios (loja_id, nome, modo, dias_semana, hora_inicio, hora_fim)
         values
           ($1, 'Inverno A', 'recorrente', array[6]::smallint[], time '11:00', time '15:00'),
           ($2, 'Inverno B', 'recorrente', array[6]::smallint[], time '11:00', time '15:00')
         returning id, loja_id`,
        [lojaA, lojaB],
      );

      return {
        lojaA,
        lojaB,
        cardapioA: cardapios.rows.find((r) => r.loja_id === lojaA)!.id,
        cardapioB: cardapios.rows.find((r) => r.loja_id === lojaB)!.id,
        categoriaA,
        categoriaB,
        produtosCatA: naCategoria.rows.map((r) => r.id),
        produtoAForaDaCategoria: fora.rows[0].id,
      };
    });
  });

  afterAll(async () => {
    await t.close();
  });

  // ══════════════════════════════════════════════════ T4 · caminho feliz (RN-10)

  it("[T4/RN-10] o dono aplica à categoria inteira: 3 vínculos, incluindo oculto e indisponível", async () => {
    const inseridos = await chamarComoDono(t, DONO_A, [c.lojaA, c.cardapioA, c.categoriaA]);
    expect(inseridos).toBe(3);

    const gravados = await t.asService(async (db) => {
      const r = await db.query<{ produto_id: string; loja_id: string }>(
        `select produto_id, loja_id from public.cardapio_produtos where cardapio_id = $1`,
        [c.cardapioA],
      );
      return r.rows;
    });
    expect(gravados.map((g) => g.produto_id).sort()).toEqual([...c.produtosCatA].sort());
    // Nenhum valor do cliente entra numa coluna: `loja_id` é o do SELECT servidor.
    expect(gravados.every((g) => g.loja_id === c.lojaA)).toBe(true);
    // Produto da loja A FORA da categoria não entra.
    expect(gravados.map((g) => g.produto_id)).not.toContain(c.produtoAForaDaCategoria);
  });

  it("[T4/RN-10] reaplicar é idempotente: a segunda chamada devolve 0 e não duplica linha", async () => {
    const antes = await contarVinculos(t, c.cardapioA);
    const inseridos = await chamarComoDono(t, DONO_A, [c.lojaA, c.cardapioA, c.categoriaA]);
    expect(inseridos).toBe(0);
    expect(await contarVinculos(t, c.cardapioA)).toBe(antes);
  });

  // ═══════════════════════════════════════════════════════════ T1 · parâmetro nulo

  it("[T1] p_categoria_id nulo é recusado com o fragmento `parametro nulo`", async () => {
    const msg = await erroAoChamar(() =>
      chamarComoDono(t, DONO_A, [c.lojaA, c.cardapioA, null]),
    );
    expect(msg).toContain("parametro nulo");
  });

  it("[T1] p_loja_id ou p_cardapio_id nulos também caem em `parametro nulo`", async () => {
    for (const args of [
      [null, c.cardapioA, c.categoriaA],
      [c.lojaA, null, c.categoriaA],
    ] as Array<[string | null, string | null, string | null]>) {
      const msg = await erroAoChamar(() => chamarComoDono(t, DONO_A, args));
      expect(msg).toContain("parametro nulo");
    }
  });

  // ══════════════════════════════════════════════════════════════ T2 · autoridade

  it("[T2] dono A com p_loja_id da loja B ⇒ fragmento LITERAL `loja alheia`, nada gravado", async () => {
    const antesB = await contarVinculos(t, c.cardapioB);
    const msg = await erroAoChamar(() =>
      chamarComoDono(t, DONO_A, [c.lojaB, c.cardapioB, c.categoriaB]),
    );
    expect(msg).toContain("loja alheia");
    expect(await contarVinculos(t, c.cardapioB)).toBe(antesB);
  });

  it("[T2 · precedência sobre T3] loja alheia com cardápio e categoria que EXISTEM nela: a mensagem é `loja alheia`, nunca revela coerência", async () => {
    // Se T3 rodasse antes de T2, a função responderia coisas diferentes para
    // "cardápio existe na loja B" e "cardápio não existe" — oráculo de
    // existência em loja alheia (`seguranca.md` §2).
    const msgCoerente = await erroAoChamar(() =>
      chamarComoDono(t, DONO_A, [c.lojaB, c.cardapioB, c.categoriaB]),
    );
    const msgIncoerente = await erroAoChamar(() =>
      chamarComoDono(t, DONO_A, [c.lojaB, c.cardapioA, c.categoriaA]),
    );
    expect(msgCoerente).toContain("loja alheia");
    expect(msgIncoerente).toContain("loja alheia");
    expect(msgCoerente).not.toContain("cardapio fora da loja");
    expect(msgIncoerente).not.toContain("cardapio fora da loja");
    expect(msgIncoerente).not.toContain("categoria fora da loja");
  });

  it("[T2 · service_role] asService é recusado por T2 (`loja alheia`) — a trava NÃO é policy, e BYPASSRLS não ajuda", async () => {
    const antes = await contarVinculos(t, c.cardapioB);
    const msg = await erroAoChamar(() =>
      t.asService(async (db) =>
        db.query(`select public.aplicar_cardapio_em_categoria($1, $2, $3)`, [
          c.lojaB,
          c.cardapioB,
          c.categoriaB,
        ]),
      ),
    );
    // `auth.uid()` é NULL sob service_role ⇒ o EXISTS explícito de T2 é falso.
    expect(msg).toContain("loja alheia");
    // E não foi recusado por privilégio: prova que chegou em T2, não na ACL.
    expect(msg).not.toMatch(/permission denied/i);
    expect(await contarVinculos(t, c.cardapioB)).toBe(antes);
  });

  // ═══════════════════════════════════════════════════════ T3 · coerência dos pares

  it("[T3] p_cardapio_id da loja B (loja própria em p_loja_id) ⇒ `cardapio fora da loja`", async () => {
    const antes = await contarVinculos(t, c.cardapioB);
    const msg = await erroAoChamar(() =>
      chamarComoDono(t, DONO_A, [c.lojaA, c.cardapioB, c.categoriaA]),
    );
    expect(msg).toContain("cardapio fora da loja");
    expect(await contarVinculos(t, c.cardapioB)).toBe(antes);
  });

  it("[T3] p_categoria_id da loja B (loja e cardápio próprios) ⇒ `categoria fora da loja`", async () => {
    const antes = await contarVinculos(t, c.cardapioA);
    const msg = await erroAoChamar(() =>
      chamarComoDono(t, DONO_A, [c.lojaA, c.cardapioA, c.categoriaB]),
    );
    expect(msg).toContain("categoria fora da loja");
    expect(await contarVinculos(t, c.cardapioA)).toBe(antes);
  });

  // ════════════════════════════════════════════════════════════════════════ ACL

  it("[ACL] anon é recusado por FALTA DE PRIVILÉGIO, não por RLS nem por T2", async () => {
    const msg = await erroAoChamar(() =>
      t.asAnon(async (db) =>
        db.query(`select public.aplicar_cardapio_em_categoria($1, $2, $3)`, [
          c.lojaA,
          c.cardapioA,
          c.categoriaA,
        ]),
      ),
    );
    expect(msg).toMatch(/permission denied for function/i);
    // Se a mensagem fosse `loja alheia`, o EXECUTE de PUBLIC continuaria lá.
    expect(msg).not.toContain("loja alheia");
  });

  it("[ACL] o catálogo confirma: EXECUTE para `authenticated`, nunca para `anon`/PUBLIC/`service_role`", async () => {
    const acl = await t.asService(async (db) => {
      const r = await db.query<{ entradas: string[] }>(
        `select coalesce(proacl::text[], array[]::text[]) as entradas
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'aplicar_cardapio_em_categoria'`,
      );
      return r.rows[0].entradas;
    });
    // `authenticated=X/...` presente; NENHUMA entrada para `anon` e NENHUMA
    // entrada de PUBLIC (a que começa com `=`).
    expect(acl.some((e) => e.startsWith("authenticated=X/"))).toBe(true);
    expect(acl.some((e) => e.startsWith("anon="))).toBe(false);
    expect(acl.some((e) => e.startsWith("="))).toBe(false);
    // NOTA (achado do RED): `service_role` CONTINUA com EXECUTE, herdado do
    // `alter default privileges ... grant all on routines to ... service_role`
    // de 20260614008500 — que o `revoke ... from public, anon` não alcança.
    // É exatamente por isso que a trava da via de serviço TEM de ser o
    // predicado explícito de T2 (teste acima), e não a ACL nem uma policy.
    expect(acl.some((e) => e.startsWith("service_role=X/"))).toBe(true);
  });
});
