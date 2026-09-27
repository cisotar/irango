import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 320 — schema da frequência de exibição, `categorias.oculta`
 * e `public.vitrine_produtos` recriada (crítica: SIM).
 *
 * Autoridade: specs/frequencia-exibicao.md §Banco, RN-2, RN-7 (a view NÃO filtra
 * período), RN-8 (`'{}'` gravável e distinto de NULL) ·
 * plan/tecnico-frequencia-exibicao.md C1 (nomes LITERAIS das constraints e da
 * policy, 20 colunas da view), D4, D5, D12, "Testes do P3" item 1.
 *
 * Escrito a partir do PLANO: `20260928130000_frequencia_produtos_categorias.sql`
 * não existe. Hoje as colunas não existem ⇒ o RED é 42703 (coluna inexistente) ou
 * asserção, nunca erro de sintaxe do teste.
 *
 * Anti-falso-verde (memória `sqlstate-nao-basta`): toda recusa afirma SQLSTATE
 * **e** o NOME da constraint na mensagem — 23514 sozinho passa por acidente com
 * qualquer outro CHECK. Toda exclusão da view é reconferida com `asService`
 * provando que a linha EXISTE na base.
 */

const DONO_A = "aaaaaaaa-aaaa-4aaa-8aaa-aa0000000320";
const DONO_B = "bbbbbbbb-bbbb-4bbb-8bbb-bb0000000320";
const DONO_I = "cccccccc-cccc-4ccc-8ccc-cc0000000320";

const COLUNAS_VITRINE_20 = [
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
  "dias_semana",
  "hora_inicio",
  "hora_fim",
  "periodo_inicio",
  "periodo_fim",
] as const;

type Tabela = "produtos" | "categorias";

type Cenario = {
  lojaA: string;
  lojaB: string;
  lojaI: string;
  catVisivel: string;
  catOculta: string;
  catB: string;
  prodSemCategoria: string;
  prodCatVisivel: string;
  prodCatOculta: string;
  prodLojaInativa: string;
  /** Alvos dos CHECKs (UPDATE). */
  alvo: Record<Tabela, string>;
};

let t: TestDb;
let c: Cenario;

type ErroPg = { code?: string; message?: string };

/** Captura o erro do bloco (que faz rollback no harness). `null` = não lançou. */
async function erroDe(p: Promise<unknown>): Promise<ErroPg | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as ErroPg;
  }
}

function esperarCheck(erro: ErroPg | null, constraint: string) {
  expect(erro, `esperava 23514 de ${constraint}, mas não lançou`).not.toBeNull();
  expect(erro?.code).toBe("23514");
  expect(erro?.message).toContain(constraint);
}

async function criarCenario(db: TestDb): Promise<Cenario> {
  await db.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a-320@teste.local'), ($2, 'dono-b-320@teste.local'), ($3, 'dono-i-320@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B, DONO_I],
  );
  return db.asService(async (s) => {
    const lojas = await s.query<{ id: string; slug: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo) values
         ($1, 'loja-a-320', 'Loja A 320', true),
         ($2, 'loja-b-320', 'Loja B 320', true),
         ($3, 'loja-i-320', 'Loja Inativa 320', false)
       returning id, slug`,
      [DONO_A, DONO_B, DONO_I],
    );
    const loja = (slug: string) => lojas.rows.find((l) => l.slug === slug)!.id;
    const lojaA = loja("loja-a-320");
    const lojaB = loja("loja-b-320");
    const lojaI = loja("loja-i-320");

    const cats = await s.query<{ id: string; nome: string }>(
      `insert into public.categorias (loja_id, nome, ordem) values
         ($1, 'Visivel', 0), ($1, 'Oculta', 1), ($1, 'Alvo check', 2), ($2, 'Cat B', 0)
       returning id, nome`,
      [lojaA, lojaB],
    );
    const cat = (nome: string) => cats.rows.find((x) => x.nome === nome)!.id;

    const prods = await s.query<{ id: string; nome: string }>(
      `insert into public.produtos (loja_id, categoria_id, nome, preco, disponivel, oculto, ordem) values
         ($1, null, 'Sem categoria', 10, true, false, 0),
         ($1, $2,   'Da visivel',    10, true, false, 1),
         ($1, $3,   'Da oculta',     10, true, false, 2),
         ($1, null, 'Alvo check',    10, true, false, 3),
         ($4, null, 'Da inativa',    10, true, false, 0)
       returning id, nome`,
      [lojaA, cat("Visivel"), cat("Oculta"), lojaI],
    );
    const prod = (nome: string) => prods.rows.find((x) => x.nome === nome)!.id;

    return {
      lojaA,
      lojaB,
      lojaI,
      catVisivel: cat("Visivel"),
      catOculta: cat("Oculta"),
      catB: cat("Cat B"),
      prodSemCategoria: prod("Sem categoria"),
      prodCatVisivel: prod("Da visivel"),
      prodCatOculta: prod("Da oculta"),
      prodLojaInativa: prod("Da inativa"),
      alvo: { produtos: prod("Alvo check"), categorias: cat("Alvo check") },
    };
  });
}

/** Marca/desmarca a categoria "Oculta". Hoje lança 42703 (coluna ausente). */
async function definirOculta(id: string, oculta: boolean) {
  await t.asService((s) => s.query(`update public.categorias set oculta = $2 where id = $1`, [id, oculta]));
}

async function idsNaVitrine(como: (fn: (db: PGlite) => Promise<string[]>) => Promise<string[]>, lojaId: string) {
  return como(async (db) => {
    const r = await db.query<{ id: string }>(
      `select id from public.vitrine_produtos where loja_id = $1`,
      [lojaId],
    );
    return r.rows.map((x) => x.id);
  });
}

beforeAll(async () => {
  t = await createTestDb();
  c = await criarCenario(t);
}, 60_000);

afterAll(async () => {
  await t?.close();
});

// ═══════════════════════════════════════════════════════════════ [c] CHECKs
const INSERT_BASE: Record<Tabela, string> = {
  produtos: `insert into public.produtos (loja_id, nome, preco, dias_semana, hora_inicio, hora_fim, periodo_inicio, periodo_fim)
             values ($1, 'Check', 10, $2::smallint[], $3::time, $4::time, $5::date, $6::date) returning id`,
  categorias: `insert into public.categorias (loja_id, nome, dias_semana, hora_inicio, hora_fim, periodo_inicio, periodo_fim)
               values ($1, 'Check', $2::smallint[], $3::time, $4::time, $5::date, $6::date) returning id`,
};

type Freq = {
  dias: string | null;
  hi: string | null;
  hf: string | null;
  pi: string | null;
  pf: string | null;
};
const F = (over: Partial<Freq> = {}): Freq => ({ dias: null, hi: null, hf: null, pi: null, pf: null, ...over });

function inserir(tabela: Tabela, f: Freq) {
  return t.asService((s) =>
    s.query<{ id: string }>(INSERT_BASE[tabela], [c.lojaA, f.dias, f.hi, f.hf, f.pi, f.pf]),
  );
}

function atualizar(tabela: Tabela, f: Freq) {
  return t.asService((s) =>
    s.query(
      `update public.${tabela}
          set dias_semana = $2::smallint[], hora_inicio = $3::time, hora_fim = $4::time,
              periodo_inicio = $5::date, periodo_fim = $6::date
        where id = $1`,
      [c.alvo[tabela], f.dias, f.hi, f.hf, f.pi, f.pf],
    ),
  );
}

const RECUSAS: [string, Freq, string][] = [
  ["hora_fim sem hora_inicio", F({ hf: "15:00" }), "hora_par"],
  ["hora_inicio sem hora_fim", F({ hi: "11:00" }), "hora_par"],
  ["hora 15:00/11:00", F({ hi: "15:00", hf: "11:00" }), "hora_ordem"],
  ["hora 11:00/11:00", F({ hi: "11:00", hf: "11:00" }), "hora_ordem"],
  ["periodo_fim < periodo_inicio", F({ pi: "2026-12-31", pf: "2026-12-01" }), "periodo_ordem"],
  ["dia 7", F({ dias: "{7}" }), "dias_semana_dominio"],
  ["dia -1", F({ dias: "{-1}" }), "dias_semana_dominio"],
];

const ACEITOS: [string, Freq][] = [
  ["os 5 null (permanente)", F()],
  ["período de um dia (fim = início)", F({ pi: "2026-12-24", pf: "2026-12-24" })],
  ["meio-aberto só início", F({ pi: "2026-12-01" })],
  ["meio-aberto só fim", F({ pf: "2026-12-31" })],
  [
    "frequência completa válida",
    F({ dias: "{1,2,3,4,5}", hi: "11:00", hf: "15:00", pi: "2026-12-01", pf: "2026-12-31" }),
  ],
];

for (const tabela of ["produtos", "categorias"] as const) {
  describe(`[c] ${tabela}: CHECKs de coerência (23514 + nome da constraint)`, () => {
    for (const [nome, f, sufixo] of RECUSAS) {
      it(`INSERT ${nome} ⇒ 23514 + ${tabela}_${sufixo}`, async () => {
        esperarCheck(await erroDe(inserir(tabela, f)), `${tabela}_${sufixo}`);
      });
      it(`UPDATE ${nome} ⇒ 23514 + ${tabela}_${sufixo}`, async () => {
        esperarCheck(await erroDe(atualizar(tabela, f)), `${tabela}_${sufixo}`);
      });
    }

    for (const [nome, f] of ACEITOS) {
      it(`aceita ${nome} (INSERT e UPDATE)`, async () => {
        expect(await erroDe(inserir(tabela, f))).toBeNull();
        expect(await erroDe(atualizar(tabela, f))).toBeNull();
      });
    }

    it("RN-8: '{}' é aceito e relido como [] (não NULL), cardinality 0", async () => {
      const ins = await inserir(tabela, F({ dias: "{}" }));
      const id = ins.rows[0].id;
      const r = await t.asService((s) =>
        s.query<{ dias_semana: number[] | null; eh_nulo: boolean; card: number }>(
          `select dias_semana, dias_semana is null as eh_nulo, cardinality(dias_semana) as card
             from public.${tabela} where id = $1`,
          [id],
        ),
      );
      expect(r.rows[0].eh_nulo).toBe(false);
      expect(r.rows[0].card).toBe(0);
      expect(r.rows[0].dias_semana).toEqual([]);
      expect(r.rows[0].dias_semana).not.toBeNull();
    });
  });
}

// ═══════════════════════════════════════════════════════════ [o] categorias.oculta
describe("[o] categorias.oculta boolean not null default false", () => {
  it("nasce false numa linha inserida sem ela", async () => {
    const r = await t.asService((s) =>
      s.query<{ oculta: boolean }>(
        `insert into public.categorias (loja_id, nome) values ($1, 'Nova') returning oculta`,
        [c.lojaA],
      ),
    );
    expect(r.rows[0].oculta).toBe(false);
  });

  it("oculta = null ⇒ 23502 nomeando a coluna", async () => {
    const e = await erroDe(
      t.asService((s) => s.query(`update public.categorias set oculta = null where id = $1`, [c.catVisivel])),
    );
    expect(e?.code).toBe("23502");
    expect(e?.message).toContain("oculta");
  });
});

// ══════════════════════════════════════════════════ [e] a view NÃO filtra período
describe("[e] RN-7 mora no TS (D12): a view não filtra período", () => {
  it("produto com periodo_fim no passado continua na view para anon", async () => {
    const id = await t.asService(async (s) => {
      const r = await s.query<{ id: string }>(
        `insert into public.produtos (loja_id, nome, preco, periodo_inicio, periodo_fim)
         values ($1, 'Panetone 2020', 30, '2020-12-01', '2020-12-31') returning id`,
        [c.lojaA],
      );
      return r.rows[0].id;
    });
    const naView = await idsNaVitrine(t.asAnon, c.lojaA);
    expect(naView).toContain(id);
  });
});

// ═════════════════════════════════════════════ [v] vitrine_produtos recriada
describe("[v] vitrine_produtos exclui produto de categoria oculta", () => {
  it("[v1] anon: some o produto da categoria oculta; ficam sem categoria e categoria visível", async () => {
    await definirOculta(c.catOculta, true);

    const naView = await idsNaVitrine(t.asAnon, c.lojaA);
    expect(naView).not.toContain(c.prodCatOculta);
    expect(naView).toContain(c.prodSemCategoria);
    expect(naView).toContain(c.prodCatVisivel);

    // anti-falso-verde: a linha EXISTE na base.
    const base = await t.asService((s) =>
      s.query(`select 1 from public.produtos where id = $1`, [c.prodCatOculta]),
    );
    expect(base.rows).toHaveLength(1);
  });

  it("[v2] produto de loja inativa fora da view (a base tem a linha)", async () => {
    const naView = await idsNaVitrine(t.asAnon, c.lojaI);
    expect(naView).not.toContain(c.prodLojaInativa);
    const base = await t.asService((s) =>
      s.query(`select 1 from public.produtos where id = $1`, [c.prodLojaInativa]),
    );
    expect(base.rows).toHaveLength(1);
  });

  it("[v3] o DONO logado lendo a view também não vê o produto da categoria oculta (definer)", async () => {
    await definirOculta(c.catOculta, true);
    const naView = await idsNaVitrine((fn) => t.asUser(DONO_A, fn), c.lojaA);
    expect(naView).not.toContain(c.prodCatOculta);
    expect(naView).toContain(c.prodCatVisivel);
  });

  it("[v4] ao vivo: oculta=true tira, oculta=false devolve na leitura seguinte", async () => {
    await definirOculta(c.catOculta, true);
    expect(await idsNaVitrine(t.asAnon, c.lojaA)).not.toContain(c.prodCatOculta);

    await definirOculta(c.catOculta, false);
    expect(await idsNaVitrine(t.asAnon, c.lojaA)).toContain(c.prodCatOculta);

    await definirOculta(c.catOculta, true); // devolve o estado do cenário
  });

  it("[v5] a view expõe as 20 colunas na ordem do C1 (15 antigas + 5 de frequência no fim)", async () => {
    const r = await t.db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'vitrine_produtos'
        order by ordinal_position`,
    );
    expect(r.rows.map((x) => x.column_name)).toEqual([...COLUNAS_VITRINE_20]);
  });

  it("[v6] reloptions: security_barrier=true e security_invoker=false preservados", async () => {
    const r = await t.db.query<{ reloptions: string[] | null }>(
      `select reloptions from pg_class where oid = 'public.vitrine_produtos'::regclass`,
    );
    const opts = r.rows[0].reloptions ?? [];
    expect(opts).toContain("security_barrier=true");
    expect(opts).toContain("security_invoker=false");
  });

  it("[v7] anon/authenticated só com SELECT na view", async () => {
    for (const papel of ["anon", "authenticated"]) {
      const r = await t.db.query<Record<string, boolean>>(
        `select has_table_privilege($1, 'public.vitrine_produtos', 'SELECT') as sel,
                has_table_privilege($1, 'public.vitrine_produtos', 'INSERT') as ins,
                has_table_privilege($1, 'public.vitrine_produtos', 'UPDATE') as upd,
                has_table_privilege($1, 'public.vitrine_produtos', 'DELETE') as del`,
        [papel],
      );
      expect(r.rows[0], papel).toEqual({ sel: true, ins: false, upd: false, del: false });
    }
  });

  it("[v8] anon lê as 5 colunas de frequência com o valor real do produto", async () => {
    await t.asService((s) =>
      s.query(
        `update public.produtos
            set dias_semana = '{0,6}', hora_inicio = '11:00', hora_fim = '15:00',
                periodo_inicio = '2026-12-01', periodo_fim = '2026-12-31'
          where id = $1`,
        [c.prodCatVisivel],
      ),
    );
    const r = await t.asAnon((db) =>
      db.query<Record<string, unknown>>(
        `select dias_semana, hora_inicio, hora_fim, periodo_inicio, periodo_fim
           from public.vitrine_produtos where id = $1`,
        [c.prodCatVisivel],
      ),
    );
    expect(r.rows[0]).toEqual({
      dias_semana: [0, 6],
      hora_inicio: "11:00:00",
      hora_fim: "15:00:00",
      periodo_inicio: "2026-12-01",
      periodo_fim: "2026-12-31",
    });
  });
});

// ═══════════════════════════════════ [p1] policy categorias_leitura_publica
describe("[p1] categoria oculta não sai em /rest/v1/categorias para anon", () => {
  const idsCategorias = (como: (fn: (db: PGlite) => Promise<string[]>) => Promise<string[]>) =>
    como(async (db) => {
      const r = await db.query<{ id: string }>(
        `select id from public.categorias where loja_id = $1`,
        [c.lojaA],
      );
      return r.rows.map((x) => x.id);
    });

  it("anon não vê a oculta e vê a visível", async () => {
    await definirOculta(c.catOculta, true);
    const ids = await idsCategorias(t.asAnon);
    expect(ids).not.toContain(c.catOculta);
    expect(ids).toContain(c.catVisivel);
  });

  it("o dono A vê a própria categoria oculta (policy de escrita própria)", async () => {
    await definirOculta(c.catOculta, true);
    const ids = await idsCategorias((fn) => t.asUser(DONO_A, fn));
    expect(ids).toContain(c.catOculta);
  });

  it("o dono B NÃO vê a categoria oculta da loja A", async () => {
    await definirOculta(c.catOculta, true);
    const ids = await idsCategorias((fn) => t.asUser(DONO_B, fn));
    expect(ids).not.toContain(c.catOculta);
    expect(ids).toContain(c.catVisivel); // a visível segue pública (anti-falso-verde)
  });
});
