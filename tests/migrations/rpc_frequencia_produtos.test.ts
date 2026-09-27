import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 322 — prova de BANCO de RN-5 (escrita escopada) e
 * RN-6 (grade tudo ou nada) nas duas RPCs `SECURITY INVOKER`:
 *
 *   public.aplicar_frequencia_em_produtos(p_loja_id uuid, p_ids uuid[], p_frequencia jsonb) → integer
 *   public.salvar_grade_de_dias(p_loja_id uuid, p_itens jsonb)                        → integer
 *
 * Autoridade: specs/frequencia-exibicao.md RN-5, RN-6, RN-8 ·
 * plan/tecnico-frequencia-exibicao.md C1 (tabela de travas e mensagens LITERAIS),
 * D6 (INVOKER + `p.loja_id = p_loja_id` + `row_count = cardinality`), D13 (chave
 * ausente ≠ null), "Testes do P3" item 3.
 *
 * Hoje nenhuma das duas existe ⇒ RED = 42883 (função inexistente) ou coluna
 * inexistente, nunca erro de sintaxe do teste.
 *
 * Anti-falso-verde:
 *  - toda recusa afirma SQLSTATE **e** fragmento da mensagem (memória
 *    `sqlstate-nao-basta`): "2 ids, 1 linhas afetadas" prova QUAL trava disparou;
 *  - "nada mudou" é relido num bloco `asService` SEPARADO, depois do bloco que
 *    lançou — o harness faz rollback no erro (`tests/helpers/pglite.ts`);
 *  - antes de cada caso de recusa, a linha recebe um estado CONHECIDO e não
 *    nulo, para que "não mudou" não seja confundido com "continuou null".
 */

const DONO_A = "aaaaaaaa-aaaa-4aaa-8aaa-aa0000000322";
const DONO_B = "bbbbbbbb-bbbb-4bbb-8bbb-bb0000000322";

type Cenario = { lojaA: string; lojaB: string; a1: string; a2: string; b1: string };
let t: TestDb;
let c: Cenario;

type ErroPg = { code?: string; message?: string };
async function erroDe(p: Promise<unknown>): Promise<ErroPg | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as ErroPg;
  }
}
function esperarErro(e: ErroPg | null, code: string, fragmento: string) {
  expect(e, `esperava ${code} "${fragmento}", mas não lançou`).not.toBeNull();
  expect(e?.code).toBe(code);
  expect(e?.message).toContain(fragmento);
}

type Freq = {
  dias_semana: number[] | null;
  hora_inicio: string | null;
  hora_fim: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
};

/** Estado de referência, não nulo em todos os eixos. */
const BASE: Freq = {
  dias_semana: [3],
  hora_inicio: "18:00:00",
  hora_fim: "22:00:00",
  periodo_inicio: "2026-01-01",
  periodo_fim: "2026-01-31",
};

const FREQ_OK = {
  dias_semana: [1, 2, 3, 4, 5],
  hora_inicio: "11:00",
  hora_fim: "15:00",
  periodo_inicio: "2026-12-01",
  periodo_fim: "2026-12-31",
};

async function definirBase(ids: string[], f: Freq = BASE) {
  await t.asService((s) =>
    s.query(
      `update public.produtos
          set dias_semana = $2::smallint[], hora_inicio = $3::time, hora_fim = $4::time,
              periodo_inicio = $5::date, periodo_fim = $6::date
        where id = any($1::uuid[])`,
      [ids, f.dias_semana, f.hora_inicio, f.hora_fim, f.periodo_inicio, f.periodo_fim],
    ),
  );
}

async function ler(id: string): Promise<Freq & { dias_nulo: boolean }> {
  const r = await t.asService((s) =>
    s.query<Freq & { dias_nulo: boolean }>(
      `select dias_semana, hora_inicio, hora_fim, periodo_inicio, periodo_fim,
              dias_semana is null as dias_nulo
         from public.produtos where id = $1`,
      [id],
    ),
  );
  return r.rows[0];
}

const semFlag = ({ dias_nulo: _n, ...f }: Freq & { dias_nulo: boolean }): Freq => {
  void _n;
  return f;
};

type Papel = "donoA" | "service" | "anon";
function como<T>(papel: Papel, fn: Parameters<TestDb["asService"]>[0]): Promise<T> {
  if (papel === "donoA") return t.asUser(DONO_A, fn) as Promise<T>;
  if (papel === "anon") return t.asAnon(fn) as Promise<T>;
  return t.asService(fn) as Promise<T>;
}

async function aplicar(papel: Papel, lojaId: string, ids: string[] | null, freq: unknown): Promise<number> {
  const r = await como<{ rows: { n: number }[] }>(papel, (s) =>
    s.query<{ n: number }>(
      `select public.aplicar_frequencia_em_produtos($1::uuid, $2::uuid[], $3::jsonb) as n`,
      [lojaId, ids, freq === undefined ? null : JSON.stringify(freq)],
    ),
  );
  return r.rows[0].n;
}

async function grade(papel: Papel, lojaId: string, itens: unknown): Promise<number> {
  const r = await como<{ rows: { n: number }[] }>(papel, (s) =>
    s.query<{ n: number }>(`select public.salvar_grade_de_dias($1::uuid, $2::jsonb) as n`, [
      lojaId,
      JSON.stringify(itens),
    ]),
  );
  return r.rows[0].n;
}

beforeAll(async () => {
  t = await createTestDb();
  await t.db.query(
    `insert into auth.users (id, email) values ($1, 'dono-a-322@teste.local'), ($2, 'dono-b-322@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B],
  );
  c = await t.asService(async (s) => {
    const lojas = await s.query<{ id: string; slug: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo) values
         ($1, 'loja-a-322', 'Loja A 322', true), ($2, 'loja-b-322', 'Loja B 322', true)
       returning id, slug`,
      [DONO_A, DONO_B],
    );
    const lojaA = lojas.rows.find((l) => l.slug === "loja-a-322")!.id;
    const lojaB = lojas.rows.find((l) => l.slug === "loja-b-322")!.id;
    const prods = await s.query<{ id: string; nome: string }>(
      `insert into public.produtos (loja_id, nome, preco) values
         ($1, 'a1', 10), ($1, 'a2', 10), ($2, 'b1', 10)
       returning id, nome`,
      [lojaA, lojaB],
    );
    const p = (n: string) => prods.rows.find((x) => x.nome === n)!.id;
    return { lojaA, lojaB, a1: p("a1"), a2: p("a2"), b1: p("b1") };
  });
}, 60_000);

afterAll(async () => {
  await t?.close();
});

// ═══════════════════════════════════════════ aplicar_frequencia_em_produtos
describe("[322] aplicar_frequencia_em_produtos", () => {
  it("[a1] dono A, p_loja_id A, [a1,a2] ⇒ 2 e grava os 5 eixos", async () => {
    await definirBase([c.a1, c.a2]);
    expect(await aplicar("donoA", c.lojaA, [c.a1, c.a2], FREQ_OK)).toBe(2);

    for (const id of [c.a1, c.a2]) {
      expect(semFlag(await ler(id))).toEqual({
        dias_semana: [1, 2, 3, 4, 5],
        hora_inicio: "11:00:00",
        hora_fim: "15:00:00",
        periodo_inicio: "2026-12-01",
        periodo_fim: "2026-12-31",
      });
    }
  });

  it("[a2] dono A com [a1,b1] ⇒ P0001 '2 ids, 1 linhas afetadas'; a1 E b1 intactos", async () => {
    await definirBase([c.a1, c.b1]);
    esperarErro(
      await erroDe(aplicar("donoA", c.lojaA, [c.a1, c.b1], FREQ_OK)),
      "P0001",
      "aplicar_frequencia_em_produtos: 2 ids, 1 linhas afetadas",
    );
    expect(semFlag(await ler(c.a1))).toEqual(BASE);
    expect(semFlag(await ler(c.b1))).toEqual(BASE);
  });

  it("[a3] dono A com p_loja_id B e [b1] ⇒ P0001 '1 ids, 0 linhas afetadas' (a RLS zera); b1 intacto", async () => {
    await definirBase([c.b1]);
    esperarErro(
      await erroDe(aplicar("donoA", c.lojaB, [c.b1], FREQ_OK)),
      "P0001",
      "aplicar_frequencia_em_produtos: 1 ids, 0 linhas afetadas",
    );
    expect(semFlag(await ler(c.b1))).toEqual(BASE);
  });

  it("[a4] service_role, p_loja_id A, [a1,b1] ⇒ P0001 'linhas afetadas' (o filtro vale sem RLS); nada muda", async () => {
    await definirBase([c.a1, c.b1]);
    esperarErro(
      await erroDe(aplicar("service", c.lojaA, [c.a1, c.b1], FREQ_OK)),
      "P0001",
      "aplicar_frequencia_em_produtos: 2 ids, 1 linhas afetadas",
    );
    expect(semFlag(await ler(c.a1))).toEqual(BASE);
    expect(semFlag(await ler(c.b1))).toEqual(BASE);
  });

  it("[a5] service_role, p_loja_id A, [a1] ⇒ 1", async () => {
    await definirBase([c.a1]);
    expect(await aplicar("service", c.lojaA, [c.a1], FREQ_OK)).toBe(1);
    expect((await ler(c.a1)).dias_semana).toEqual([1, 2, 3, 4, 5]);
  });

  describe("[a6] travas de forma (P0001 + mensagem literal), nada gravado", () => {
    it("lista vazia ⇒ 'lista vazia'", async () => {
      await definirBase([c.a1]);
      esperarErro(
        await erroDe(aplicar("donoA", c.lojaA, [], FREQ_OK)),
        "P0001",
        "aplicar_frequencia_em_produtos: lista vazia",
      );
      esperarErro(
        await erroDe(aplicar("donoA", c.lojaA, null, FREQ_OK)),
        "P0001",
        "aplicar_frequencia_em_produtos: lista vazia",
      );
      expect(semFlag(await ler(c.a1))).toEqual(BASE);
    });

    it("ids repetidos ⇒ 'ids repetidos'", async () => {
      await definirBase([c.a1]);
      esperarErro(
        await erroDe(aplicar("donoA", c.lojaA, [c.a1, c.a1], FREQ_OK)),
        "P0001",
        "aplicar_frequencia_em_produtos: ids repetidos",
      );
      expect(semFlag(await ler(c.a1))).toEqual(BASE);
    });

    it("201 ids ⇒ 'lista acima do teto'", async () => {
      const ids = [c.a1, ...Array.from({ length: 200 }, () => randomUUID())];
      esperarErro(
        await erroDe(aplicar("donoA", c.lojaA, ids, FREQ_OK)),
        "P0001",
        "aplicar_frequencia_em_produtos: lista acima do teto",
      );
    });

    it("p_frequencia null ou array ⇒ 'frequencia invalida'", async () => {
      await definirBase([c.a1]);
      esperarErro(
        await erroDe(aplicar("donoA", c.lojaA, [c.a1], undefined)),
        "P0001",
        "aplicar_frequencia_em_produtos: frequencia invalida",
      );
      esperarErro(
        await erroDe(aplicar("donoA", c.lojaA, [c.a1], [FREQ_OK])),
        "P0001",
        "aplicar_frequencia_em_produtos: frequencia invalida",
      );
      expect(semFlag(await ler(c.a1))).toEqual(BASE);
    });

    it("D13: p_frequencia SEM a chave dias_semana ⇒ 'frequencia invalida' e a1 NÃO vira NULL", async () => {
      await definirBase([c.a1]);
      const { dias_semana: _d, ...semDias } = FREQ_OK;
      void _d;
      esperarErro(
        await erroDe(aplicar("donoA", c.lojaA, [c.a1], semDias)),
        "P0001",
        "aplicar_frequencia_em_produtos: frequencia invalida",
      );
      const depois = await ler(c.a1);
      expect(depois.dias_nulo).toBe(false);
      expect(semFlag(depois)).toEqual(BASE);
    });
  });

  it("[a7] hora 15:00/11:00 ⇒ 23514 + produtos_hora_ordem, nada gravado", async () => {
    await definirBase([c.a1, c.a2]);
    esperarErro(
      await erroDe(
        aplicar("donoA", c.lojaA, [c.a1, c.a2], { ...FREQ_OK, hora_inicio: "15:00", hora_fim: "11:00" }),
      ),
      "23514",
      "produtos_hora_ordem",
    );
    expect(semFlag(await ler(c.a1))).toEqual(BASE);
    expect(semFlag(await ler(c.a2))).toEqual(BASE);
  });

  it("[a8] anon ⇒ 42501 nomeando a função", async () => {
    esperarErro(
      await erroDe(aplicar("anon", c.lojaA, [c.a1], FREQ_OK)),
      "42501",
      "aplicar_frequencia_em_produtos",
    );
  });

  it("[a9] RN-8: dias [] ⇒ gravado '{}' (não NULL); null sobre '{}' ⇒ NULL", async () => {
    await definirBase([c.a1]);
    expect(await aplicar("donoA", c.lojaA, [c.a1], { ...FREQ_OK, dias_semana: [] })).toBe(1);
    const vazio = await ler(c.a1);
    expect(vazio.dias_semana).toEqual([]);
    expect(vazio.dias_nulo).toBe(false);

    expect(await aplicar("donoA", c.lojaA, [c.a1], { ...FREQ_OK, dias_semana: null })).toBe(1);
    const nulo = await ler(c.a1);
    expect(nulo.dias_semana).toBeNull();
    expect(nulo.dias_nulo).toBe(true);
  });
});

// ═════════════════════════════════════════════════════ salvar_grade_de_dias
describe("[322/RN-6] salvar_grade_de_dias", () => {
  it("[g1] [{a1,[1,2]},{a2,null}] ⇒ 2; hora e período de a1 PRESERVADOS (grade só toca dias)", async () => {
    await definirBase([c.a1, c.a2]);
    expect(
      await grade("donoA", c.lojaA, [
        { produto_id: c.a1, dias_semana: [1, 2] },
        { produto_id: c.a2, dias_semana: null },
      ]),
    ).toBe(2);
    expect(semFlag(await ler(c.a1))).toEqual({ ...BASE, dias_semana: [1, 2] });
    expect(semFlag(await ler(c.a2))).toEqual({ ...BASE, dias_semana: null });
  });

  it("[g2] tudo ou nada: [{a1,[1]},{a2,[7]}] ⇒ 23514 + produtos_dias_semana_dominio; a1 NÃO gravado", async () => {
    await definirBase([c.a1, c.a2]);
    esperarErro(
      await erroDe(
        grade("donoA", c.lojaA, [
          { produto_id: c.a1, dias_semana: [1] },
          { produto_id: c.a2, dias_semana: [7] },
        ]),
      ),
      "23514",
      "produtos_dias_semana_dominio",
    );
    expect(semFlag(await ler(c.a1))).toEqual(BASE);
    expect(semFlag(await ler(c.a2))).toEqual(BASE);
  });

  it("[g3] dono A com [{a1},{b1}] ⇒ P0001 '2 itens, 1 linhas afetadas'; a1 e b1 intactos", async () => {
    await definirBase([c.a1, c.b1]);
    esperarErro(
      await erroDe(
        grade("donoA", c.lojaA, [
          { produto_id: c.a1, dias_semana: [1] },
          { produto_id: c.b1, dias_semana: [2] },
        ]),
      ),
      "P0001",
      "salvar_grade_de_dias: 2 itens, 1 linhas afetadas",
    );
    expect(semFlag(await ler(c.a1))).toEqual(BASE);
    expect(semFlag(await ler(c.b1))).toEqual(BASE);
  });

  describe("[g4] travas de forma, nada gravado", () => {
    it("produto_id repetido ou ausente ⇒ 'ids repetidos ou ausentes'", async () => {
      await definirBase([c.a1]);
      esperarErro(
        await erroDe(
          grade("donoA", c.lojaA, [
            { produto_id: c.a1, dias_semana: [1] },
            { produto_id: c.a1, dias_semana: [2] },
          ]),
        ),
        "P0001",
        "salvar_grade_de_dias: ids repetidos ou ausentes",
      );
      esperarErro(
        await erroDe(grade("donoA", c.lojaA, [{ produto_id: null, dias_semana: [1] }])),
        "P0001",
        "salvar_grade_de_dias: ids repetidos ou ausentes",
      );
      expect(semFlag(await ler(c.a1))).toEqual(BASE);
    });

    it("[] ou objeto ⇒ 'lista vazia'", async () => {
      esperarErro(await erroDe(grade("donoA", c.lojaA, [])), "P0001", "salvar_grade_de_dias: lista vazia");
      esperarErro(
        await erroDe(grade("donoA", c.lojaA, { produto_id: c.a1, dias_semana: [1] })),
        "P0001",
        "salvar_grade_de_dias: lista vazia",
      );
    });

    it("201 itens ⇒ 'lista acima do teto'", async () => {
      const itens = Array.from({ length: 201 }, () => ({ produto_id: randomUUID(), dias_semana: [1] }));
      esperarErro(
        await erroDe(grade("donoA", c.lojaA, itens)),
        "P0001",
        "salvar_grade_de_dias: lista acima do teto",
      );
    });

    it("D13: elemento sem a chave dias_semana ⇒ 'item incompleto', nada gravado", async () => {
      await definirBase([c.a1, c.a2]);
      esperarErro(
        await erroDe(
          grade("donoA", c.lojaA, [
            { produto_id: c.a1, dias_semana: [1] },
            { produto_id: c.a2 },
          ]),
        ),
        "P0001",
        "salvar_grade_de_dias: item incompleto",
      );
      expect(semFlag(await ler(c.a1))).toEqual(BASE);
      const a2 = await ler(c.a2);
      expect(a2.dias_nulo).toBe(false);
      expect(semFlag(a2)).toEqual(BASE);
    });
  });

  it("[g5] service_role p_loja_id A com b1 ⇒ P0001 'linhas afetadas'; anon ⇒ 42501", async () => {
    await definirBase([c.b1]);
    esperarErro(
      await erroDe(grade("service", c.lojaA, [{ produto_id: c.b1, dias_semana: [1] }])),
      "P0001",
      "salvar_grade_de_dias: 1 itens, 0 linhas afetadas",
    );
    expect(semFlag(await ler(c.b1))).toEqual(BASE);
    esperarErro(
      await erroDe(grade("anon", c.lojaA, [{ produto_id: c.a1, dias_semana: [1] }])),
      "42501",
      "salvar_grade_de_dias",
    );
  });

  it("[g6] RN-8: [{a1,[]},{a2,[0,6]}] ⇒ 2; a1 relido [] (não NULL)", async () => {
    await definirBase([c.a1, c.a2]);
    expect(
      await grade("donoA", c.lojaA, [
        { produto_id: c.a1, dias_semana: [] },
        { produto_id: c.a2, dias_semana: [0, 6] },
      ]),
    ).toBe(2);
    const a1 = await ler(c.a1);
    expect(a1.dias_semana).toEqual([]);
    expect(a1.dias_nulo).toBe(false);
    expect((await ler(c.a2)).dias_semana).toEqual([0, 6]);
  });
});

// ═══════════════════════════════════════════════════════════════ catálogo
describe("[322/D6] catálogo das duas funções", () => {
  const ASSINATURAS = [
    "public.aplicar_frequencia_em_produtos(uuid, uuid[], jsonb)",
    "public.salvar_grade_de_dias(uuid, jsonb)",
  ];

  it("SECURITY INVOKER (prosecdef = false) e search_path fixado", async () => {
    for (const assinatura of ASSINATURAS) {
      const r = await t.db.query<{ prosecdef: boolean; proconfig: string[] | null }>(
        `select prosecdef, proconfig from pg_proc where oid = $1::regprocedure`,
        [assinatura],
      );
      expect(r.rows[0].prosecdef, assinatura).toBe(false);
      expect((r.rows[0].proconfig ?? []).some((x) => x.startsWith("search_path=")), assinatura).toBe(true);
    }
  });

  it("EXECUTE: anon não; authenticated e service_role sim", async () => {
    for (const assinatura of ASSINATURAS) {
      const r = await t.db.query<Record<string, boolean>>(
        `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
                has_function_privilege('service_role', $1, 'EXECUTE') as svc`,
        [assinatura],
      );
      expect(r.rows[0], assinatura).toEqual({ anon: false, auth: true, svc: true });
    }
  });
});
