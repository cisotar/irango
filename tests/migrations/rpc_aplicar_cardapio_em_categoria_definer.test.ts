import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 269, Fase 0 — a CONVERSÃO de
 * `public.aplicar_cardapio_em_categoria` de `security invoker` para
 * `security definer` + travas T1–T7 no corpo (issue 269 · D1 · `seguranca.md` §2).
 *
 * Por que este arquivo é NOVO e não uma edição do RED da 250: o arquivo antigo
 * (`rpc_aplicar_cardapio_em_categoria.test.ts`) prova o contrato de HOJE, em que
 * `asService` é recusado por T2 **de propósito**. A inversão daquela asserção é
 * da **Fase 1** (agente `executar`), junto com a migration. Aqui fica o contrato
 * NOVO, inteiro, para que as duas fases sejam legíveis lado a lado no diff.
 *
 * O que muda de autoridade, e por que cada caso abaixo existe:
 *
 *  - Sob `invoker`, quem barra o LOJISTA em loja alheia são DUAS coisas ao mesmo
 *    tempo: a RLS de `lojas` (o `exists` de T2 não enxerga a linha) e o próprio
 *    predicado de T2. Sob `definer`, a RLS **deixa de ser avaliada dentro da
 *    função** — sobra T2 sozinha. É a realocação de autoridade do R2 da issue:
 *    se T2 estiver escrita errada, o LOJISTA passa a escrever em loja alheia, e
 *    nenhum teste de hoje pega isso. Daí o caso `asUser` (dono da loja B com
 *    `p_loja_id` da loja A) ser OBRIGATÓRIO aqui.
 *  - Sob `definer` + `grant execute to service_role`, a via de SERVIÇO (hub
 *    admin) passa a EXECUTAR — e T2 vira a **única** checagem de tenant que
 *    existe para ela, porque `service_role` tem BYPASSRLS e as policies
 *    `cardapios_escrita_propria`/`cardapio_produtos_escrita_propria` não a
 *    alcançam.
 *  - Fail-closed de T2: `auth.role()` é NULL sem JWT, e
 *    `not (NULL or false)` avalia para NULL, que o plpgsql trata como ELSE —
 *    sem `coalesce(auth.role(), '')` a T2 vira fail-**OPEN** (achado real,
 *    corrigido por `20260918130000`). Dois casos cobrem isso: chamada SEM JWT
 *    sob uma role que não é `service_role`, e claim `role` FORJADO no JWT com a
 *    role de sessão ainda sendo `authenticated`.
 *
 * Lição aplicada ("SQLSTATE não basta em teste de escopo"): toda recusa afirma o
 * FRAGMENTO LITERAL da mensagem junto com o SQLSTATE. Uma trava de escopo passa
 * por acidente quando só se checa o código do erro — `P0001` é o mesmo para
 * `loja alheia`, `cardapio fora da loja` e `categoria fora da loja`.
 *
 * Anti-falso-verde: toda recusa reconfere a CONTAGEM de `cardapio_produtos` sob
 * `asService` (BYPASSRLS), e um teste final varre a tabela inteira provando que
 * nenhuma linha cruza lojas por nenhum dos ramos.
 *
 * NENHUM código de produção é escrito aqui. A migration
 * `20260921120000_rpc_aplicar_cardapio_em_categoria_definer.sql` é da fase GREEN.
 */

const DONO_A = "a9000000-0000-4000-8000-000000000001";
const DONO_B = "b9000000-0000-4000-8000-000000000002";

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

/** Erro do Postgres como o teste precisa lê-lo: SQLSTATE **e** mensagem. */
type FalhaSql = { code: string; message: string };

/**
 * Executa `fn` e devolve o par `{ code, message }` do erro. Se a chamada for
 * ACEITA, falha alto: um "erro esperado" que não aconteceu nunca pode passar
 * silenciosamente por um `catch` vazio.
 */
async function falhaAoChamar(fn: () => Promise<unknown>): Promise<FalhaSql> {
  try {
    await fn();
  } catch (err) {
    const e = err as { code?: unknown; message?: unknown };
    return {
      code: typeof e.code === "string" ? e.code : "(sem SQLSTATE)",
      message: String(e.message ?? ""),
    };
  }
  throw new Error("A chamada foi ACEITA — esperava-se recusa.");
}

const SELECT_RPC = `select public.aplicar_cardapio_em_categoria($1, $2, $3) as n`;

describe("269 · RPC aplicar_cardapio_em_categoria convertida para SECURITY DEFINER", () => {
  let t: TestDb;
  let c: Cenario;

  /** A RPC como o hub admin a chama: `service_role`, sem `auth.uid()`. */
  async function chamarComoServico(
    args: [string, string, string],
  ): Promise<number> {
    return t.asService(async (db) => {
      const r = await db.query<{ n: number }>(SELECT_RPC, args);
      return r.rows[0].n;
    });
  }

  /** A RPC como o LOJISTA a chama: role `authenticated` + JWT com `sub`. */
  async function chamarComoDono(
    dono: string,
    args: [string, string, string],
  ): Promise<number> {
    return t.asUser(dono, async (db) => {
      const r = await db.query<{ n: number }>(SELECT_RPC, args);
      return r.rows[0].n;
    });
  }

  /**
   * Chamada com role de sessão arbitrária e claims ARBITRÁRIOS (inclusive
   * nenhum). O helper `pglite.ts` só expõe os três casos bem-comportados;
   * os dois casos de fail-closed de T2 precisam exatamente dos MAL
   * comportados — sem JWT, e com `role` forjado no JWT.
   */
  async function chamarCom(
    role: "anon" | "authenticated" | "service_role",
    claims: Record<string, unknown> | null,
    args: [string, string, string],
  ): Promise<number> {
    const db: PGlite = t.db;
    await db.exec("begin");
    try {
      await db.query(`set local role ${role}`);
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [
        claims ? JSON.stringify(claims) : "",
      ]);
      const r = await db.query<{ n: number }>(SELECT_RPC, args);
      await db.exec("commit");
      return r.rows[0].n;
    } catch (err) {
      await db.exec("rollback");
      throw err;
    }
  }

  async function contarVinculos(cardapioId: string): Promise<number> {
    return t.asService(async (db) => {
      const r = await db.query<{ n: number }>(
        `select count(*)::int as n from public.cardapio_produtos where cardapio_id = $1`,
        [cardapioId],
      );
      return r.rows[0].n;
    });
  }

  beforeAll(async () => {
    t = await createTestDb();

    await t.db.query(
      `insert into auth.users (id, email) values
         ($1, 'dono-a-269@teste.local'),
         ($2, 'dono-b-269@teste.local')
       on conflict (id) do nothing`,
      [DONO_A, DONO_B],
    );

    c = await t.asService(async (db) => {
      const lojas = await db.query<{ id: string; dono_id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo) values
           ($1, 'loja-a-rpc-269', 'Loja A', true),
           ($2, 'loja-b-rpc-269', 'Loja B', true)
         returning id, dono_id`,
        [DONO_A, DONO_B],
      );
      const lojaA = lojas.rows.find((l) => l.dono_id === DONO_A)!.id;
      const lojaB = lojas.rows.find((l) => l.dono_id === DONO_B)!.id;

      const categorias = await db.query<{ id: string; loja_id: string }>(
        `insert into public.categorias (loja_id, nome) values
           ($1, 'Pratos do dia A'),
           ($2, 'Pratos do dia B')
         returning id, loja_id`,
        [lojaA, lojaB],
      );

      // RN-10: a RPC inclui produto OCULTO e `disponivel = false`.
      const naCategoria = await db.query<{ id: string }>(
        `insert into public.produtos (loja_id, categoria_id, nome, preco, oculto, disponivel) values
           ($1, $2, 'Bife a role',   30.00, false, true),
           ($1, $2, 'Bife oculto',   30.00, true,  true),
           ($1, $2, 'Bife esgotado', 30.00, false, false)
         returning id`,
        [lojaA, categorias.rows.find((r) => r.loja_id === lojaA)!.id],
      );

      const fora = await db.query<{ id: string }>(
        `insert into public.produtos (loja_id, nome, preco) values ($1, 'Pastel sem categoria', 12.00)
         returning id`,
        [lojaA],
      );

      // A loja B também tem produto na categoria dela: se algum ramo vazasse,
      // haveria linha REAL para cruzar — o cenário não protege por vacuidade.
      await db.query(
        `insert into public.produtos (loja_id, categoria_id, nome, preco) values ($1, $2, 'Bife da loja B', 30.00)`,
        [lojaB, categorias.rows.find((r) => r.loja_id === lojaB)!.id],
      );

      const cardapios = await db.query<{ id: string; loja_id: string }>(
        `insert into public.cardapios (loja_id, nome, modo, dias_semana, hora_inicio, hora_fim)
         values
           ($1, 'Segunda A', 'recorrente', array[1]::smallint[], time '11:00', time '15:00'),
           ($2, 'Segunda B', 'recorrente', array[1]::smallint[], time '11:00', time '15:00')
         returning id, loja_id`,
        [lojaA, lojaB],
      );

      return {
        lojaA,
        lojaB,
        cardapioA: cardapios.rows.find((r) => r.loja_id === lojaA)!.id,
        cardapioB: cardapios.rows.find((r) => r.loja_id === lojaB)!.id,
        categoriaA: categorias.rows.find((r) => r.loja_id === lojaA)!.id,
        categoriaB: categorias.rows.find((r) => r.loja_id === lojaB)!.id,
        produtosCatA: naCategoria.rows.map((r) => r.id),
        produtoAForaDaCategoria: fora.rows[0].id,
      };
    });
  }, 120_000);

  afterAll(async () => {
    await t.close();
  });

  // ══════════════════════════════════════ A · a função é DEFINER e concede execute

  it("[D1] a função é `security definer` com `search_path` fixado em `public, pg_temp`", async () => {
    const meta = await t.asService(async (db) => {
      const r = await db.query<{ prosecdef: boolean; proconfig: string[] | null }>(
        `select p.prosecdef, p.proconfig
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'aplicar_cardapio_em_categoria'`,
      );
      return r.rows[0];
    });
    expect(meta.prosecdef).toBe(true);
    // `pg_temp` EXPLÍCITO e por ÚLTIMO: sob DEFINER, um `search_path` que
    // comece pelo schema temporário deixa o chamador sequestrar qualquer nome
    // não-qualificado do corpo.
    expect(meta.proconfig ?? []).toContain("search_path=public, pg_temp");
  });

  it("[T7/ACL] EXECUTE para `authenticated` E `service_role`; nunca para `anon` nem PUBLIC", async () => {
    const acl = await t.asService(async (db) => {
      const r = await db.query<{ entradas: string[] }>(
        `select coalesce(proacl::text[], array[]::text[]) as entradas
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'aplicar_cardapio_em_categoria'`,
      );
      return r.rows[0].entradas;
    });
    expect(acl.some((e) => e.startsWith("authenticated=X/"))).toBe(true);
    // O grant que a conversão ACRESCENTA — a via de serviço passa a executar.
    expect(acl.some((e) => e.startsWith("service_role=X/"))).toBe(true);
    // E o `revoke all ... from public, anon` continua: nenhuma entrada de anon,
    // nenhuma de PUBLIC (a que começa com `=`).
    expect(acl.some((e) => e.startsWith("anon="))).toBe(false);
    expect(acl.some((e) => e.startsWith("="))).toBe(false);
  });

  // ══════════════════════════════════ B · a via de SERVIÇO (hub admin) funciona

  it("[269] `asService` com o trio COERENTE insere os 3 produtos da categoria na loja-alvo", async () => {
    const inseridos = await chamarComoServico([c.lojaA, c.cardapioA, c.categoriaA]);
    expect(inseridos).toBe(3);

    const gravados = await t.asService(async (db) => {
      const r = await db.query<{ produto_id: string; loja_id: string }>(
        `select produto_id, loja_id from public.cardapio_produtos where cardapio_id = $1`,
        [c.cardapioA],
      );
      return r.rows;
    });
    expect(gravados.map((g) => g.produto_id).sort()).toEqual(
      [...c.produtosCatA].sort(),
    );
    // `loja_id` vem do SELECT no servidor, nunca de um valor do chamador.
    expect(gravados.every((g) => g.loja_id === c.lojaA)).toBe(true);
    // Produto da loja A FORA da categoria não entra (T5 continua escopando).
    expect(gravados.map((g) => g.produto_id)).not.toContain(
      c.produtoAForaDaCategoria,
    );
  });

  it("[269] `asService` reaplicando é idempotente: devolve 0 e não duplica linha", async () => {
    const antes = await contarVinculos(c.cardapioA);
    expect(await chamarComoServico([c.lojaA, c.cardapioA, c.categoriaA])).toBe(0);
    expect(await contarVinculos(c.cardapioA)).toBe(antes);
  });

  it("[T1] `asService` com parâmetro nulo continua recusado por `parametro nulo`", async () => {
    const falha = await falhaAoChamar(() =>
      t.asService((db) =>
        db.query(SELECT_RPC, [c.lojaA, c.cardapioA, null]),
      ),
    );
    expect(falha.code).toBe("P0001");
    expect(falha.message).toContain("parametro nulo");
  });

  // ════════════ C · T3 sob a via de serviço — o fragmento, não só o SQLSTATE

  it("[T3] `asService` com `p_cardapio_id` da loja B ⇒ SQLSTATE P0001 + `cardapio fora da loja`", async () => {
    const antes = await contarVinculos(c.cardapioB);
    const falha = await falhaAoChamar(() =>
      chamarComoServico([c.lojaA, c.cardapioB, c.categoriaA]),
    );
    expect(falha.code).toBe("P0001");
    expect(falha.message).toContain("cardapio fora da loja");
    // Não caiu em T2 por acidente: a via de serviço PASSOU por T2 e foi barrada
    // pela coerência do par — que é exatamente a trava que se quer provar.
    expect(falha.message).not.toContain("loja alheia");
    expect(await contarVinculos(c.cardapioB)).toBe(antes);
  });

  it("[T3] `asService` com `p_categoria_id` da loja B ⇒ SQLSTATE P0001 + `categoria fora da loja`", async () => {
    const antes = await contarVinculos(c.cardapioA);
    const falha = await falhaAoChamar(() =>
      chamarComoServico([c.lojaA, c.cardapioA, c.categoriaB]),
    );
    expect(falha.code).toBe("P0001");
    expect(falha.message).toContain("categoria fora da loja");
    expect(falha.message).not.toContain("loja alheia");
    expect(await contarVinculos(c.cardapioA)).toBe(antes);
  });

  it("[T3] `asService` com cardápio E categoria da loja B ⇒ `cardapio fora da loja` (ordem estável)", async () => {
    const antes = await contarVinculos(c.cardapioB);
    const falha = await falhaAoChamar(() =>
      chamarComoServico([c.lojaA, c.cardapioB, c.categoriaB]),
    );
    expect(falha.code).toBe("P0001");
    expect(falha.message).toContain("cardapio fora da loja");
    expect(await contarVinculos(c.cardapioB)).toBe(antes);
  });

  // ══════════════════════════ D · R2 — a trava do LOJISTA, relocada da RLS p/ T2

  it("[T2/R2] `asUser` dono da loja B com `p_loja_id` da loja A ⇒ P0001 + `loja alheia`", async () => {
    const antes = await contarVinculos(c.cardapioA);
    const falha = await falhaAoChamar(() =>
      chamarComoDono(DONO_B, [c.lojaA, c.cardapioA, c.categoriaA]),
    );
    // Sob DEFINER a RLS de `lojas` não é avaliada dentro da função: esta recusa
    // prova que sobrou o PREDICADO EXPLÍCITO de T2, não uma policy.
    expect(falha.code).toBe("P0001");
    expect(falha.message).toContain("loja alheia");
    expect(falha.message).not.toMatch(/permission denied/i);
    expect(await contarVinculos(c.cardapioA)).toBe(antes);
  });

  it("[T2/R2] `asUser` dono da loja B com o trio COERENTE da loja B continua funcionando", async () => {
    // A conversão não pode quebrar o caminho que hoje funciona: o dono legítimo
    // segue escrevendo na PRÓPRIA loja (1 produto na categoria B).
    expect(await chamarComoDono(DONO_B, [c.lojaB, c.cardapioB, c.categoriaB])).toBe(1);
  });

  it("[T2 · precedência sobre T3] loja alheia com ids COERENTES nela não vira oráculo de existência", async () => {
    const falhaCoerente = await falhaAoChamar(() =>
      chamarComoDono(DONO_A, [c.lojaB, c.cardapioB, c.categoriaB]),
    );
    const falhaIncoerente = await falhaAoChamar(() =>
      chamarComoDono(DONO_A, [c.lojaB, c.cardapioA, c.categoriaA]),
    );
    // Byte a byte a MESMA resposta: "existe na loja B" e "não existe" são
    // indistinguíveis de fora (`seguranca.md` §2/§14).
    expect(falhaCoerente.message).toBe(falhaIncoerente.message);
    expect(falhaCoerente.message).toContain("loja alheia");
    expect(falhaCoerente.message).not.toContain("cardapio fora da loja");
    expect(falhaIncoerente.message).not.toContain("cardapio fora da loja");
  });

  // ═════════════════════ E · fail-CLOSED de T2 — `auth.role()` NULL não autoriza

  it("[T2 fail-closed] SEM JWT sob role `authenticated` ⇒ P0001 + `loja alheia`, nada gravado", async () => {
    // `auth.uid()` é NULL (o exists é falso) e `auth.role()` é NULL. Sem o
    // `coalesce(auth.role(), '')`, `v_e_servico` seria NULL e o `if not (...)`
    // cairia no ELSE: a função AUTORIZARIA a escrita. Este é o fail-open.
    const antes = await contarVinculos(c.cardapioA);
    const falha = await falhaAoChamar(() =>
      chamarCom("authenticated", null, [c.lojaA, c.cardapioA, c.categoriaA]),
    );
    expect(falha.code).toBe("P0001");
    expect(falha.message).toContain("loja alheia");
    expect(await contarVinculos(c.cardapioA)).toBe(antes);
  });

  it("[T2 fail-closed] claim `role: service_role` FORJADO sob sessão `authenticated` não vira via de serviço", async () => {
    // O JWT é do cliente; a role de SESSÃO é o que o PostgREST assume. Sem o
    // segundo sinal (`v_role_sessao not in ('authenticated','anon')`), qualquer
    // lojista logado mandaria `role: service_role` no token e escreveria em
    // qualquer loja.
    const antes = await contarVinculos(c.cardapioB);
    const falha = await falhaAoChamar(() =>
      chamarCom(
        "authenticated",
        { sub: DONO_A, role: "service_role" },
        [c.lojaB, c.cardapioB, c.categoriaB],
      ),
    );
    expect(falha.code).toBe("P0001");
    expect(falha.message).toContain("loja alheia");
    expect(await contarVinculos(c.cardapioB)).toBe(antes);
  });

  it("[ACL] `asAnon` é recusado por FALTA DE PRIVILÉGIO: SQLSTATE 42501, nunca `loja alheia`", async () => {
    const falha = await falhaAoChamar(() =>
      t.asAnon((db) =>
        db.query(SELECT_RPC, [c.lojaA, c.cardapioA, c.categoriaA]),
      ),
    );
    expect(falha.code).toBe("42501");
    expect(falha.message).toMatch(/permission denied for function/i);
    // Se a mensagem fosse `loja alheia`, `anon` teria EXECUTE e o corpo teria
    // rodado — a conversão teria afrouxado a ACL junto com o grant novo.
    expect(falha.message).not.toContain("loja alheia");
  });

  // ══════════════════════════════════════ F · invariante global de multitenancy

  it("[invariante] nenhuma linha de `cardapio_produtos` cruza lojas, por nenhum ramo", async () => {
    const cruzadas = await t.asService(async (db) => {
      const r = await db.query<{ n: number }>(
        `select count(*)::int as n
           from public.cardapio_produtos cp
           join public.cardapios ca on ca.id = cp.cardapio_id
           join public.produtos  p  on p.id  = cp.produto_id
          where cp.loja_id <> ca.loja_id or cp.loja_id <> p.loja_id`,
      );
      return r.rows[0].n;
    });
    expect(cruzadas).toBe(0);
  });

  it("[invariante] a loja B só tem os vínculos que o DONO dela criou", async () => {
    const naLojaB = await t.asService(async (db) => {
      const r = await db.query<{ cardapio_id: string; produto_id: string }>(
        `select cardapio_id, produto_id from public.cardapio_produtos where loja_id = $1`,
        [c.lojaB],
      );
      return r.rows;
    });
    expect(naLojaB).toHaveLength(1);
    expect(naLojaB[0].cardapio_id).toBe(c.cardapioB);
    // Nenhum produto da loja A entrou na loja B por nenhum dos ramos recusados.
    expect(c.produtosCatA).not.toContain(naLojaB[0].produto_id);
  });
});
