import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 245 — `tasks/245-trigger-do-produto-exclusivo-e-policy-publica-ajustada.md`
 * (crítica: SIM). Spec: `specs/cardapio-sazonal.md` (D14 · RN-13, RN-14).
 *
 * Escrito a partir da ISSUE e do SPEC, NUNCA do SQL: as duas migrations
 * (`20260920131000_produtos_exclusivo_trigger.sql` e
 * `20260920132000_vitrine_produtos_visibilidade_predicado.sql`) ainda NÃO
 * existem. Hoje o schema é o pós-244: `cardapios` (128000), `cardapio_produtos`
 * com FKs compostas (129000), `produtos.visibilidade` (130000) e a view
 * `public.vitrine_produtos` com 14 colunas e o predicado literal da 124000.
 *
 * ── Os dois buracos que a issue fecha ────────────────────────────────────────
 *
 *  [A] ÓRFÃO. `visibilidade = 'cardapio'` com ZERO linhas em `cardapio_produtos`
 *      é o estado que some da vitrine sem deixar rastro e que o lojista não
 *      consegue diagnosticar. Ele nasce por TRÊS portas, duas delas dentro do
 *      banco, DEPOIS de a Server Action decidir (`on delete cascade` de
 *      `cardapios` e de `produtos`). CHECK não cruza tabela e FK aponta na
 *      direção errada: a única primitiva que avalia a invariante no COMMIT — e
 *      que vale sob `BYPASSRLS` — é o CONSTRAINT TRIGGER deferido.
 *
 *  [B] RASCUNHO VAZADO. A view pública não conhece `visibilidade`: o prato de um
 *      "Cardápio de Natal" montado em setembro (cardápio `ativo = false`) é
 *      legível por `anon` em `/rest/v1/vitrine_produtos` com a anon key do
 *      bundle, mesmo que o SSR (247) o omita. Quem filtra é o banco, e é o banco
 *      que o atacante consulta.
 *
 * ── O que este arquivo prova (§"O que o RED precisa provar" da issue) ────────
 *
 *  (a) marcar `'cardapio'` SEM vínculo: o statement RESOLVE, o COMMIT REJEITA;
 *  (b) marcar + vincular na MESMA transação (nas duas ordens): resolve;
 *  (c) apagar o cardápio (cascata leva o último vínculo): rejeita e as TRÊS
 *      tabelas voltam ao estado anterior;
 *  (d) apagar o PRODUTO: resolve (não há invariante a defender);
 *  (e) RE-APONTAR o vínculo (`update cardapio_produtos set produto_id = …`):
 *      rejeita — furo que o spec não cobria (D6), porque orfana um produto sem
 *      passar por nenhum DELETE;
 *  (f) vínculo só em cardápio INATIVO: resolve — fora de temporada NÃO é órfão;
 *  (h)–(m) o predicado novo da view, com a não-regressão afirmada como
 *      CONJUNTO DE IDS antes/depois — não como "não deu erro";
 *  (n)–(p) contrato de 15 colunas na ordem fixa e `security_barrier` PRESERVADO
 *      (o `create or replace view` reseta as reloptions em silêncio se o
 *      `with (…)` as omitir — `AT_ReplaceRelOptions`).
 *
 * ── Anti-falso-verde (padrão de `rls_lojas.test.ts` / `vitrine_produtos.test.ts`) ──
 *
 *  - a falha é afirmada pelo FRAGMENTO `produto exclusivo sem cardapio` E pelo
 *    `code = "23000"` (`integrity_constraint_violation`, D8 — NÃO 23514, que é
 *    CHECK e já é usado pelos CHECKs de desconto): SQLSTATE sozinho passa por
 *    acidente, e é o fragmento que a Server Action da 255/261 vai mapear;
 *  - a falha é provada ser NO COMMIT: `chegouAoCommit` só vira `true` DEPOIS de
 *    o `await` do statement resolver. Um trigger `AFTER` não-deferido deixaria
 *    esse flag em `false` e reprovaria — é o que distingue o desenho pedido;
 *  - CADA caso roda duas vezes, `asUser(DONO_A)` e `asService`. `BYPASSRLS` não
 *    desliga trigger: é exatamente isso que prova que a trava NÃO depende de RLS
 *    (o hub admin e `criarPedido` rodam sob `service_role`, onde policy não existe);
 *  - toda exclusão da view é reconferida com `asService` mostrando que a linha
 *    EXISTE na base (negada por predicado, não por dado ausente).
 *
 * Nenhuma migration e nenhum código de produção são escritos aqui. Quem deixa
 * verde é `migrar` (131000 e 132000) + `executar` (as 15 colunas em TS).
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aa0000000245";
const DONO_I = "11111111-1111-1111-1111-110000000245";

/** Fragmento LITERAL da mensagem do `raise` (D8). É o que a 255/261 mapeia. */
const FRAGMENTO = "produto exclusivo sem cardapio";
/** `integrity_constraint_violation` — NÃO `check_violation` (23514). */
const CODIGO = "23000";

/**
 * Contrato de colunas de `public.vitrine_produtos` DEPOIS da 132000: as 14 da
 * 124000 na MESMA ORDEM + `visibilidade` como 15ª, no fim (o `create or replace
 * view` só aceita coluna nova no fim — é o gate mecânico de não-regressão).
 */
const COLUNAS_VITRINE_15 = [
  "id",
  "loja_id",
  "categoria_id",
  "nome",
  "descricao",
  "preco",
  "disponivel",
  "ordem",
  "foto_url",
  "desconto_ativo",
  "desconto_tipo",
  "desconto_valor",
  "desconto_inicio",
  "desconto_fim",
  "visibilidade",
] as const;

type Cenario = {
  lojaA: string;
  lojaI: string;
  catA: string;
  /** loja A, 'menu', visível — vira cobaia de (a), (b) e alvo de (e) */
  menuDisp: string;
  /** loja A, 'menu', disponivel = false — cobaia de (f) */
  menuEsgotado: string;
  /** loja A, 'menu', oculto = true */
  menuOculto: string;
  /** loja A → 'cardapio' vinculado a cAtivo */
  exclAtivo: string;
  /** loja A → 'cardapio' vinculado SÓ a cInativo (rascunho) */
  exclInativo: string;
  /** loja A → 'cardapio' vinculado a cVencido (ativo, prazo no passado) */
  exclAtivoForaJanela: string;
  /** loja A → 'cardapio' vinculado a cAtivo, mas oculto = true */
  exclOculto: string;
  /** loja INATIVA → 'cardapio' vinculado a cardápio ativo */
  exclLojaInativa: string;
  cAtivo: string;
  cInativo: string;
  cVencido: string;
  cLojaInativa: string;
};

type Executor = <T>(fn: (db: PGlite) => Promise<T>) => Promise<T>;

async function criarCenario(t: TestDb): Promise<Cenario> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a-245@teste.local'),
       ($2, 'dono-i-245@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_I],
  );

  return t.asService(async (db) => {
    const lojas = await db.query<{ id: string; slug: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo) values
         ($1, 'loja-a-245', 'Loja A 245', true),
         ($2, 'loja-i-245', 'Loja I 245', false)
       returning id, slug`,
      [DONO_A, DONO_I],
    );
    const lojaA = lojas.rows.find((l) => l.slug === "loja-a-245")!.id;
    const lojaI = lojas.rows.find((l) => l.slug === "loja-i-245")!.id;

    const cat = await db.query<{ id: string }>(
      `insert into public.categorias (loja_id, nome, ordem) values ($1, 'Pratos', 0) returning id`,
      [lojaA],
    );
    const catA = cat.rows[0].id;

    // TODOS nascem 'menu' (o default da 130000): é o estado de produção hoje
    // (176/176) e é dele que sai o conjunto de ids do (h).
    const prodsA = await db.query<{ id: string; nome: string }>(
      `insert into public.produtos
         (loja_id, categoria_id, nome, preco, disponivel, oculto, ordem)
       values
         ($1, $2, 'Menu disponivel',      10.00, true,  false, 0),
         ($1, $2, 'Menu esgotado',        11.00, false, false, 1),
         ($1, $2, 'Menu oculto',          12.00, true,  true,  2),
         ($1, $2, 'Excl ativo',           13.00, true,  false, 3),
         ($1, $2, 'Excl inativo',         14.00, true,  false, 4),
         ($1, $2, 'Excl fora da janela',  15.00, true,  false, 5),
         ($1, $2, 'Excl oculto',          16.00, true,  true,  6)
       returning id, nome`,
      [lojaA, catA],
    );
    const pA = (nome: string) => prodsA.rows.find((p) => p.nome === nome)!.id;

    const prodsI = await db.query<{ id: string }>(
      `insert into public.produtos (loja_id, nome, preco, disponivel, oculto, ordem)
         values ($1, 'Excl loja inativa', 17.00, true, false, 0)
       returning id`,
      [lojaI],
    );

    const cardsA = await db.query<{ id: string; nome: string }>(
      `insert into public.cardapios (loja_id, nome, ativo, modo, dias_semana, prazo_inicio, prazo_fim, prazo_preset)
       values
         ($1, 'Cardapio ativo',   true,  'recorrente', array[0,1,2,3,4,5,6]::smallint[], null, null, null),
         ($1, 'Cardapio inativo', false, 'recorrente', array[0,1,2,3,4,5,6]::smallint[], null, null, null),
         ($1, 'Cardapio vencido', true,  'prazo_fixo', null, $2::timestamptz, $3::timestamptz, 'customizado')
       returning id, nome`,
      [lojaA, "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"],
    );
    const cA = (nome: string) => cardsA.rows.find((c) => c.nome === nome)!.id;

    const cardI = await db.query<{ id: string }>(
      `insert into public.cardapios (loja_id, nome, ativo, modo, dias_semana)
         values ($1, 'Cardapio da loja inativa', true, 'recorrente', array[0,1,2,3,4,5,6]::smallint[])
       returning id`,
      [lojaI],
    );

    return {
      lojaA,
      lojaI,
      catA,
      menuDisp: pA("Menu disponivel"),
      menuEsgotado: pA("Menu esgotado"),
      menuOculto: pA("Menu oculto"),
      exclAtivo: pA("Excl ativo"),
      exclInativo: pA("Excl inativo"),
      exclAtivoForaJanela: pA("Excl fora da janela"),
      exclOculto: pA("Excl oculto"),
      exclLojaInativa: prodsI.rows[0].id,
      cAtivo: cA("Cardapio ativo"),
      cInativo: cA("Cardapio inativo"),
      cVencido: cA("Cardapio vencido"),
      cLojaInativa: cardI.rows[0].id,
    };
  });
}

/**
 * Fase 2 do cenário: vincula E marca os cinco exclusivos na MESMA transação.
 * É o caso (b) servindo de fixture — se o trigger recusasse o caminho legítimo
 * (criar produto e vínculo juntos), TODO o resto do arquivo cairia aqui.
 */
async function marcarExclusivos(t: TestDb, c: Cenario): Promise<void> {
  await t.asService(async (db) => {
    await db.query(
      `insert into public.cardapio_produtos (loja_id, cardapio_id, produto_id) values
         ($1, $2, $3), ($1, $4, $5), ($1, $6, $7), ($1, $2, $8),
         ($9, $10, $11)`,
      [
        c.lojaA,
        c.cAtivo,
        c.exclAtivo,
        c.cInativo,
        c.exclInativo,
        c.cVencido,
        c.exclAtivoForaJanela,
        c.exclOculto,
        c.lojaI,
        c.cLojaInativa,
        c.exclLojaInativa,
      ],
    );
    await db.query(
      `update public.produtos set visibilidade = 'cardapio' where id = any($1::uuid[])`,
      [
        [c.exclAtivo, c.exclInativo, c.exclAtivoForaJanela, c.exclOculto, c.exclLojaInativa],
      ],
    );
  });
}

type Resultado = {
  /** `true` só se o STATEMENT resolveu — prova que a falha é no COMMIT. */
  chegouAoCommit: boolean;
  erro: (Error & { code?: string }) | null;
};

/** Roda `sql` dentro de uma transação do executor e reporta onde a falha caiu. */
async function rodar(exec: Executor, sql: (db: PGlite) => Promise<unknown>): Promise<Resultado> {
  let chegouAoCommit = false;
  let erro: (Error & { code?: string }) | null = null;
  try {
    await exec(async (db) => {
      await sql(db);
      chegouAoCommit = true;
    });
  } catch (e) {
    erro = e as Error & { code?: string };
  }
  return { chegouAoCommit, erro };
}

function esperaRecusaNoCommit(r: Resultado): void {
  // 1. o statement passou (trigger DEFERIDO, não AFTER simples)
  expect(r.chegouAoCommit).toBe(true);
  // 2. o COMMIT caiu, com o código E o fragmento — SQLSTATE sozinho não basta
  expect(r.erro).not.toBeNull();
  expect(r.erro!.code).toBe(CODIGO);
  expect(r.erro!.message).toContain(FRAGMENTO);
}

async function visibilidadeDe(t: TestDb, id: string): Promise<string | null> {
  const r = await t.asService((db) =>
    db.query<{ visibilidade: string }>(`select visibilidade from public.produtos where id = $1`, [
      id,
    ]),
  );
  return r.rows[0]?.visibilidade ?? null;
}

async function existeNaBase(t: TestDb, id: string): Promise<boolean> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.produtos where id = $1`, [id]),
  );
  return r.rows.length > 0;
}

/** Retrato das TRÊS tabelas — é o que o caso (c) confere após o rollback. */
type Retrato = {
  cardapios: string[];
  vinculos: string[];
  produtos: string[];
  visibilidades: string;
};

async function retrato(t: TestDb, c: Cenario): Promise<Retrato> {
  return t.asService(async (db) => {
    const cardapios = await db.query<{ id: string }>(
      `select id from public.cardapios where loja_id = any($1::uuid[]) order by id`,
      [[c.lojaA, c.lojaI]],
    );
    const vinculos = await db.query<{ k: string }>(
      `select cardapio_id || '/' || produto_id as k from public.cardapio_produtos
        where loja_id = any($1::uuid[]) order by k`,
      [[c.lojaA, c.lojaI]],
    );
    const produtos = await db.query<{ id: string }>(
      `select id from public.produtos where loja_id = any($1::uuid[]) order by id`,
      [[c.lojaA, c.lojaI]],
    );
    const vis = await db.query<{ v: string }>(
      `select id || '=' || visibilidade as v from public.produtos
        where loja_id = any($1::uuid[]) order by id`,
      [[c.lojaA, c.lojaI]],
    );
    return {
      cardapios: cardapios.rows.map((r) => r.id),
      vinculos: vinculos.rows.map((r) => r.k),
      produtos: produtos.rows.map((r) => r.id),
      visibilidades: vis.rows.map((r) => r.v).join(","),
    };
  });
}

/** ids que `anon` enxerga na projeção pública, escopado às lojas do cenário. */
async function idsNaVitrine(t: TestDb, c: Cenario): Promise<string[]> {
  const r = await t.asAnon((db) =>
    db.query<{ id: string }>(
      `select id from public.vitrine_produtos where loja_id = any($1::uuid[])`,
      [[c.lojaA, c.lojaI]],
    ),
  );
  return r.rows.map((x) => x.id).sort();
}

describe("245 · trigger do produto exclusivo (RN-14) + predicado de vitrine_produtos com visibilidade (D14)", () => {
  let t: TestDb;
  let c: Cenario;
  /** Conjunto que `anon` via ANTES de qualquer exclusivo existir (tudo 'menu'). */
  let idsAntes: string[];
  /** O mesmo conjunto pelo predicado LITERAL da 124000, via `asService`. */
  let idsPredicadoAntigo: string[];

  beforeAll(async () => {
    t = await createTestDb();
    c = await criarCenario(t);

    // Captura ANTES de marcar qualquer exclusivo: este é o estado de produção
    // de hoje (176/176 em 'menu') e a base da não-regressão de (h).
    idsAntes = await idsNaVitrine(t, c);
    const literal = await t.asService((db) =>
      db.query<{ id: string }>(
        `select id from public.produtos
          where loja_id = any($1::uuid[])
            and oculto = false
            and public.loja_esta_ativa(loja_id)`,
        [[c.lojaA, c.lojaI]],
      ),
    );
    idsPredicadoAntigo = literal.rows.map((x) => x.id).sort();

    await marcarExclusivos(t, c);
  });

  afterAll(async () => {
    await t.close();
  });

  // ══════════════════════════════════════════════════ o trigger, nos dois roles
  //
  // `asService` tem BYPASSRLS. Se um caso passar sob `asUser` e falhar sob
  // `asService`, a trava está em RLS (ou numa policy) e não no trigger — e o hub
  // admin/`criarPedido` continuariam criando órfãos. É por isso que cada caso
  // roda duas vezes.
  const papeis: [string, (t: TestDb) => Executor][] = [
    ["asUser(DONO_A)", (t) => (fn) => t.asUser(DONO_A, fn)],
    ["asService", (t) => (fn) => t.asService(fn)],
  ];

  for (const [nome, mk] of papeis) {
    describe(`sob ${nome}`, () => {
      it(`[a/${nome}] marcar 'cardapio' SEM vínculo: statement resolve, COMMIT recusa (23000 + fragmento)`, async () => {
        try {
          const r = await rodar(mk(t), (db) =>
            db.query(`update public.produtos set visibilidade = 'cardapio' where id = $1`, [
              c.menuDisp,
            ]),
          );
          esperaRecusaNoCommit(r);

          // A transação inteira caiu: o produto continua no menu.
          expect(await visibilidadeDe(t, c.menuDisp)).toBe("menu");
        } finally {
          // REPARO: enquanto o trigger não existe, o update ACIMA COMMITA e
          // deixa `menuDisp` órfão. Sem este finally, o vazamento faria os casos
          // seguintes (e o conjunto de ids de [h]) falharem pelo motivo ERRADO —
          // e um RED que falha pelo motivo errado não prova nada.
          await devolverAoMenu(t, c.menuDisp);
        }
      });

      it(`[b/${nome}] marcar + vincular na MESMA transação passa — nas DUAS ordens`, async () => {
        // O caminho legítimo da Server Action (255/261). Se o trigger não fosse
        // DEFERIDO, a ordem "update antes do insert" quebraria aqui.
        try {
        const primeiroUpdate = await rodar(mk(t), async (db) => {
          await db.query(`update public.produtos set visibilidade = 'cardapio' where id = $1`, [
            c.menuDisp,
          ]);
          await db.query(
            `insert into public.cardapio_produtos (loja_id, cardapio_id, produto_id)
               values ($1, $2, $3)`,
            [c.lojaA, c.cAtivo, c.menuDisp],
          );
        });
        expect(primeiroUpdate.erro).toBeNull();
        expect(await visibilidadeDe(t, c.menuDisp)).toBe("cardapio");
        await devolverAoMenu(t, c.menuDisp);

        const primeiroInsert = await rodar(mk(t), async (db) => {
          await db.query(
            `insert into public.cardapio_produtos (loja_id, cardapio_id, produto_id)
               values ($1, $2, $3)`,
            [c.lojaA, c.cAtivo, c.menuDisp],
          );
          await db.query(`update public.produtos set visibilidade = 'cardapio' where id = $1`, [
            c.menuDisp,
          ]);
        });
        expect(primeiroInsert.erro).toBeNull();
        expect(await visibilidadeDe(t, c.menuDisp)).toBe("cardapio");
        } finally {
          await devolverAoMenu(t, c.menuDisp);
        }
      });

      it(`[c/${nome}] apagar o cardápio orfana por CASCATA: recusa, e as TRÊS tabelas voltam ao que eram`, async () => {
        // Trio DESCARTÁVEL (cardápio + produto exclusivo + vínculo): enquanto o
        // trigger não existe, o delete abaixo COMMITA de verdade. Sacrificar o
        // `cAtivo` do cenário faria os casos seguintes caírem por FK, não pela
        // invariante. O `retrato` cobre as lojas inteiras, então o trio entra
        // na conferência das três tabelas do mesmo jeito.
        const trio = await criarTrio(t, c, `c-${nome}`);
        try {
          const antes = await retrato(t, c);

          const r = await rodar(mk(t), (db) =>
            db.query(`delete from public.cardapios where id = $1`, [trio.cardapio]),
          );
          esperaRecusaNoCommit(r);

          // O critério de aceite exige as TRÊS conferidas, não só `produtos`:
          // a cascata de `cardapios` → `cardapio_produtos` tem de ter sido
          // desfeita junto, senão o rollback foi parcial (ou o erro veio de
          // outro lugar).
          const depois = await retrato(t, c);
          expect(depois.cardapios).toEqual(antes.cardapios);
          expect(depois.vinculos).toEqual(antes.vinculos);
          expect(depois.produtos).toEqual(antes.produtos);
          expect(depois.visibilidades).toEqual(antes.visibilidades);
          expect(await visibilidadeDe(t, trio.produto)).toBe("cardapio");
        } finally {
          await limparTrio(t, trio);
        }
      });

      it(`[d/${nome}] apagar o PRÓPRIO produto passa (não há invariante a defender)`, async () => {
        // `on delete cascade` de `produtos` leva o vínculo junto e dispara a
        // ponta 2; no COMMIT o produto não existe mais, então o EXISTS é falso.
        // É o caso do hard delete de loja pelo hub admin, em escala.
        const trio = await criarTrio(t, c, `d-${nome}`);
        try {
          const r = await rodar(mk(t), (db) =>
            db.query(`delete from public.produtos where id = $1`, [trio.produto]),
          );
          expect(r.erro).toBeNull();
          expect(await existeNaBase(t, trio.produto)).toBe(false);

          const vinculos = await t.asService((db) =>
            db.query(`select 1 from public.cardapio_produtos where produto_id = $1`, [
              trio.produto,
            ]),
          );
          expect(vinculos.rows).toHaveLength(0);
        } finally {
          await limparTrio(t, trio);
        }
      });

      it(`[e/${nome}] RE-APONTAR o vínculo orfana sem nenhum DELETE: recusa (D6, furo fora do spec)`, async () => {
        // `update cardapio_produtos set produto_id = outro` é permitido pela RLS
        // do dono e pelo `unique (cardapio_id, produto_id)`, e deixa o produto
        // antigo sem vínculo. Uma ponta que só escutasse DELETE passaria aqui.
        const trio = await criarTrio(t, c, `e-${nome}`);
        try {
          const antes = await retrato(t, c);

          const r = await rodar(mk(t), (db) =>
            db.query(`update public.cardapio_produtos set produto_id = $1 where produto_id = $2`, [
              c.menuDisp,
              trio.produto,
            ]),
          );
          esperaRecusaNoCommit(r);

          const depois = await retrato(t, c);
          expect(depois.vinculos).toEqual(antes.vinculos);
          expect(depois.visibilidades).toEqual(antes.visibilidades);
        } finally {
          // sem trigger o re-apontamento COMMITA: desfaz o vínculo que caiu em
          // `menuDisp` antes de devolver o trio.
          await devolverAoMenu(t, c.menuDisp);
          await limparTrio(t, trio);
        }
      });

      it(`[f/${nome}] vínculo só em cardápio INATIVO passa — fora de temporada NÃO é órfão (RN-14)`, async () => {
        try {
          const r = await rodar(mk(t), async (db) => {
            await db.query(
              `insert into public.cardapio_produtos (loja_id, cardapio_id, produto_id)
                 values ($1, $2, $3)`,
              [c.lojaA, c.cInativo, c.menuEsgotado],
            );
            await db.query(`update public.produtos set visibilidade = 'cardapio' where id = $1`, [
              c.menuEsgotado,
            ]);
          });
          expect(r.erro).toBeNull();
          expect(await visibilidadeDe(t, c.menuEsgotado)).toBe("cardapio");
        } finally {
          await devolverAoMenu(t, c.menuEsgotado);
        }
      });
    });
  }

  /**
   * Devolve o produto ao menu E remove os vínculos na MESMA transação — a ordem
   * inversa (apagar vínculo de um produto ainda 'cardapio') seria recusada pelo
   * próprio trigger que estamos testando.
   */
  async function devolverAoMenu(t: TestDb, produtoId: string): Promise<void> {
    await t.asService(async (db) => {
      await db.query(`update public.produtos set visibilidade = 'menu' where id = $1`, [produtoId]);
      await db.query(`delete from public.cardapio_produtos where produto_id = $1`, [produtoId]);
    });
  }

  /**
   * Cardápio ATIVO + produto exclusivo + vínculo, todos descartáveis, criados
   * na MESMA transação (o caminho legítimo de (b)). Cada caso destrutivo usa o
   * seu, para que o RED — em que a operação proibida ainda COMMITA — não
   * destrua o cenário compartilhado e faça os casos seguintes falharem por FK
   * em vez de pela invariante.
   */
  async function criarTrio(
    t: TestDb,
    c: Cenario,
    sufixo: string,
  ): Promise<{ cardapio: string; produto: string }> {
    return t.asService(async (db) => {
      const card = await db.query<{ id: string }>(
        `insert into public.cardapios (loja_id, nome, ativo, modo, dias_semana)
           values ($1, $2, true, 'recorrente', array[0,1,2,3,4,5,6]::smallint[])
         returning id`,
        [c.lojaA, `Descartavel ${sufixo}`],
      );
      const prod = await db.query<{ id: string }>(
        `insert into public.produtos (loja_id, categoria_id, nome, preco, disponivel, oculto, ordem)
           values ($1, $2, $3, 9.00, true, false, 99) returning id`,
        [c.lojaA, c.catA, `Descartavel ${sufixo}`],
      );
      await db.query(
        `insert into public.cardapio_produtos (loja_id, cardapio_id, produto_id) values ($1, $2, $3)`,
        [c.lojaA, card.rows[0].id, prod.rows[0].id],
      );
      await db.query(`update public.produtos set visibilidade = 'cardapio' where id = $1`, [
        prod.rows[0].id,
      ]);
      return { cardapio: card.rows[0].id, produto: prod.rows[0].id };
    });
  }

  /** Desfaz o trio numa transação só — 'menu' PRIMEIRO, senão o próprio trigger recusa. */
  async function limparTrio(
    t: TestDb,
    trio: { cardapio: string; produto: string },
  ): Promise<void> {
    await t.asService(async (db) => {
      await db.query(`update public.produtos set visibilidade = 'menu' where id = $1`, [
        trio.produto,
      ]);
      await db.query(
        `delete from public.cardapio_produtos where produto_id = $1 or cardapio_id = $2`,
        [trio.produto, trio.cardapio],
      );
      await db.query(`delete from public.produtos where id = $1`, [trio.produto]);
      await db.query(`delete from public.cardapios where id = $1`, [trio.cardapio]);
    });
  }

  // ═══════════════════════════════════════ o predicado novo da view (anon/D14)

  it("[h] não-regressão por CONJUNTO DE IDS: o que a view devolvia com tudo em 'menu' só PERDE o rascunho", async () => {
    // Antes: com 100% dos produtos em 'menu' (produção hoje), a view devolve
    // exatamente o predicado literal da 124000.
    expect(idsAntes).toEqual(idsPredicadoAntigo);
    expect(idsAntes.length).toBeGreaterThan(0); // não passa por vácuo

    // Depois de marcar os exclusivos: o disjunto só RESTRINGE. Quem sai é
    // `exclInativo` (rascunho) e mais ninguém.
    const idsDepois = await idsNaVitrine(t, c);
    expect(idsDepois).toEqual(idsAntes.filter((id) => id !== c.exclInativo));

    // E os dois exclusivos com cardápio ATIVO continuam dentro, nomeadamente.
    expect(idsDepois).toContain(c.exclAtivo);
    expect(idsDepois).toContain(c.exclAtivoForaJanela);
  });

  it("[i] 'cardapio' com vínculo só em cardápio INATIVO fica FORA da view (existe na base)", async () => {
    const ids = await idsNaVitrine(t, c);
    expect(ids).not.toContain(c.exclInativo);
    expect(await existeNaBase(t, c.exclInativo)).toBe(true);

    // E o nome/preço do rascunho não saem por nenhuma coluna: 0 linhas.
    const direto = await t.asAnon((db) =>
      db.query(`select nome, preco from public.vitrine_produtos where id = $1`, [c.exclInativo]),
    );
    expect(direto.rows).toHaveLength(0);
  });

  it("[j] 'cardapio' de cardápio ATIVO mas com prazo VENCIDO fica DENTRO — a view não é a janela (RN-06)", async () => {
    // A view filtra "tem algum cardápio LIGADO", nunca "está aberto agora".
    // Quem esconde/marca fora da janela é `projetarCatalogoVitrine` (247),
    // função pura em TS. Pôr a janela no SQL é o erro que esta asserção trava.
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(`select id from public.vitrine_produtos where id = $1`, [
        c.exclAtivoForaJanela,
      ]),
    );
    expect(r.rows.map((x) => x.id)).toEqual([c.exclAtivoForaJanela]);
  });

  it("[k] oculto e loja inativa continuam ganhando de tudo — os AND antigos não foram enfraquecidos", async () => {
    const ids = await idsNaVitrine(t, c);
    // 'cardapio' + cardápio ativo, mas oculto = true
    expect(ids).not.toContain(c.exclOculto);
    // 'cardapio' + cardápio ativo, mas loja inativa
    expect(ids).not.toContain(c.exclLojaInativa);
    // 'menu' + oculto = true (inalterado desde a 124000)
    expect(ids).not.toContain(c.menuOculto);

    expect(await existeNaBase(t, c.exclOculto)).toBe(true);
    expect(await existeNaBase(t, c.exclLojaInativa)).toBe(true);
  });

  it("[l] a view é AO VIVO: ativar o cardápio traz o rascunho no request seguinte; desativar tira", async () => {
    try {
      await t.asService((db) =>
        db.query(`update public.cardapios set ativo = true where id = $1`, [c.cInativo]),
      );
      expect(await idsNaVitrine(t, c)).toContain(c.exclInativo);
    } finally {
      await t.asService((db) =>
        db.query(`update public.cardapios set ativo = false where id = $1`, [c.cInativo]),
      );
    }
    expect(await idsNaVitrine(t, c)).not.toContain(c.exclInativo);
  });

  it("[m] ÓRFÃO pré-existente (trigger desabilitado na fixture) fica FORA: a view falha FECHADA", async () => {
    // O trigger não retroage. Se alguém tiver usado o SQL editor antes do push,
    // ou se um dia ele for desabilitado, a view tem de ESCONDER o órfão — não
    // mostrá-lo sem cardápio. Fixture via `t.db` (superuser/owner da tabela).
    const orfao = await t.asService(async (db) => {
      const p = await db.query<{ id: string }>(
        `insert into public.produtos (loja_id, categoria_id, nome, preco, disponivel, oculto, ordem)
           values ($1, $2, 'Orfao pre-existente', 8.00, true, false, 98) returning id`,
        [c.lojaA, c.catA],
      );
      return p.rows[0].id;
    });

    await t.db.exec(
      `alter table public.produtos disable trigger produtos_exclusivo_tem_cardapio`,
    );
    try {
      await t.asService((db) =>
        db.query(`update public.produtos set visibilidade = 'cardapio' where id = $1`, [orfao]),
      );
    } finally {
      await t.db.exec(
        `alter table public.produtos enable trigger produtos_exclusivo_tem_cardapio`,
      );
    }

    // anti-falso-verde: o órfão EXISTE, está 'cardapio' e não tem vínculo.
    expect(await visibilidadeDe(t, orfao)).toBe("cardapio");
    const vinc = await t.asService((db) =>
      db.query(`select 1 from public.cardapio_produtos where produto_id = $1`, [orfao]),
    );
    expect(vinc.rows).toHaveLength(0);

    expect(await idsNaVitrine(t, c)).not.toContain(orfao);

    await t.asService((db) =>
      db.query(`update public.produtos set visibilidade = 'menu' where id = $1`, [orfao]),
    );
  });

  // ══════════════════════════════════ contrato de colunas e reloptions da view

  it("[n] a view expõe 15 colunas: as 14 da 124000 na MESMA ordem + visibilidade no fim", async () => {
    const r = await t.db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'vitrine_produtos'
        order by ordinal_position`,
    );
    expect(r.rows.map((x) => x.column_name)).toEqual([...COLUNAS_VITRINE_15]);
  });

  it("[n2] anon lê a 15ª coluna e ela traz o valor real do produto", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string; visibilidade: string }>(
        `select id, visibilidade from public.vitrine_produtos where id = any($1::uuid[])`,
        [[c.menuDisp, c.exclAtivo]],
      ),
    );
    const porId = new Map(r.rows.map((x) => [x.id, x.visibilidade]));
    expect(porId.get(c.menuDisp)).toBe("menu");
    expect(porId.get(c.exclAtivo)).toBe("cardapio");
  });

  it("[o] security_barrier CONTINUA ligado após o create or replace (AT_ReplaceRelOptions)", async () => {
    // `create or replace view` executa AT_ReplaceRelOptions: SUBSTITUI todo o
    // conjunto de reloptions pelo que a instrução declara. Omitir
    // `security_barrier = true` no `with (…)` a reseta EM SILÊNCIO, desfazendo a
    // 124500 sem nenhum erro. Asserção direta no catálogo, além do [7a]/[7c]
    // comportamental de `vitrine_produtos.test.ts`.
    const r = await t.db.query<{ reloptions: string[] | null }>(
      `select c.reloptions from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'vitrine_produtos'`,
    );
    expect(r.rows[0].reloptions ?? []).toContain("security_barrier=true");
    expect(r.rows[0].reloptions ?? []).toContain("security_invoker=false");
  });

  it("[p] a view segue SELECT-only para anon após a recriação (grants não podem ter renascido)", async () => {
    for (const role of ["anon", "authenticated"]) {
      const proibidos: string[] = [];
      for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "TRIGGER", "REFERENCES"]) {
        const r = await t.db.query<{ ok: boolean }>(
          `select has_table_privilege($1, 'public.vitrine_produtos', $2) as ok`,
          [role, priv],
        );
        if (r.rows[0].ok) proibidos.push(priv);
      }
      expect({ role, proibidos }).toEqual({ role, proibidos: [] });
    }
  });
});
