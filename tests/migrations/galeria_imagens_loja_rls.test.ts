import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";
import {
  criarLoja,
  erroDe,
  esperarErro,
  imagem,
  imagensDa,
  novoCaminho,
  registrarImagem,
  urlStorage,
} from "../helpers/galeria";

/**
 * Fase RED (TDD) — galeria de imagens da loja, vetor de BANCO, item 1 do spec
 * (specs/galeria-imagens-loja.md §Segurança "TDD red-first" 1, §Modelos de Dados).
 *
 * Contrato sob teste (nasce em M1 `20261006120000_imagens_loja.sql`):
 *  - tabela `public.imagens_loja` com CHECKs `imagens_loja_caminho_da_loja`,
 *    `imagens_loja_miniatura_da_loja`, `imagens_loja_recorte_sem_miniatura`,
 *    CHECK de `bytes`, UNIQUE `imagens_loja_caminho_unico`, FK composta
 *    `imagens_loja_origem_fk (origem_id, loja_id) → (id, loja_id) ON DELETE CASCADE`;
 *  - RLS: 4 políticas por `lojas.dono_id = auth.uid()`; nenhuma para anon;
 *  - GRANTs: authenticated = SELECT, INSERT, DELETE + UPDATE só em
 *    `remocao_pendente_em`; anon sem escrita;
 *  - `public.caminho_storage_produtos(url text) → text`, IMMUTABLE, search_path fixo.
 *
 * Por que é RED: a tabela e a função não existem (42P01 / 42883).
 *
 * Anti-falso-verde: toda recusa afirma SQLSTATE + fragmento (nome da constraint
 * ou "row-level security"/"permission denied"), e a linha da outra loja é relida
 * pela via de serviço num bloco separado depois da tentativa.
 */

const DONO_A = "a6a1e000-0000-4000-8000-0000000000a1";
const DONO_B = "b6a1e000-0000-4000-8000-0000000000b1";

let t: TestDb;
let lojaA: string;
let lojaB: string;

beforeAll(async () => {
  t = await createTestDb();
  lojaA = await criarLoja(t, DONO_A, "galeria-rls-a");
  lojaB = await criarLoja(t, DONO_B, "galeria-rls-b");
}, 60_000);

afterAll(async () => {
  await t?.close();
});

function inserirComo(papel: "donoA" | "service" | "anon", valores: Record<string, unknown>) {
  const cols = Object.keys(valores);
  const sql = `insert into public.imagens_loja (${cols.join(", ")}) values (${cols
    .map((_, i) => `$${i + 1}`)
    .join(", ")}) returning id`;
  const params = Object.values(valores);
  const fn = (s: Parameters<Parameters<TestDb["asService"]>[0]>[0]) => s.query<{ id: string }>(sql, params);
  if (papel === "donoA") return t.asUser(DONO_A, fn);
  if (papel === "anon") return t.asAnon(fn);
  return t.asService(fn);
}

// ══════════════════════════════════════════════════════════ isolamento por loja
describe("[galeria/1] RLS de imagens_loja — lojista A não alcança linha de B", () => {
  it("A lê só as próprias linhas: a de B não aparece nem por id", async () => {
    const idA = await registrarImagem(t, lojaA, novoCaminho(lojaA, "galeria"));
    const idB = await registrarImagem(t, lojaB, novoCaminho(lojaB, "galeria"));

    const todas = await t.asUser(DONO_A, (s) => s.query<{ id: string; loja_id: string }>(`select id, loja_id from public.imagens_loja`));
    const ids = todas.rows.map((r) => r.id);
    expect(ids).toContain(idA);
    expect(ids).not.toContain(idB);
    expect(todas.rows.every((r) => r.loja_id === lojaA)).toBe(true);

    const porId = await t.asUser(DONO_A, (s) => s.query(`select id from public.imagens_loja where id = $1`, [idB]));
    expect(porId.rows).toHaveLength(0);
  });

  it("A insere na própria loja (caminho na própria pasta) ⇒ aceito", async () => {
    const caminho = novoCaminho(lojaA, "galeria");
    const r = await inserirComo("donoA", { loja_id: lojaA, caminho });
    expect(r.rows).toHaveLength(1);
    expect((await imagem(t, r.rows[0].id))?.caminho).toBe(caminho);
  });

  it("A insere linha com loja_id de B (caminho na pasta de B, CHECK ok) ⇒ 42501 row-level security; nada gravado em B", async () => {
    const antes = await imagensDa(t, lojaB);
    const caminho = novoCaminho(lojaB, "galeria");

    esperarErro(await erroDe(inserirComo("donoA", { loja_id: lojaB, caminho })), "42501", "row-level security");

    expect(await imagensDa(t, lojaB)).toEqual(antes);
  });

  it("A marca remocao_pendente_em numa linha de B ⇒ 0 linhas afetadas; linha de B intacta", async () => {
    const idB = await registrarImagem(t, lojaB, novoCaminho(lojaB, "galeria"));
    const antes = await imagem(t, idB);

    const r = await t.asUser(DONO_A, (s) =>
      s.query(`update public.imagens_loja set remocao_pendente_em = now() where id = $1`, [idB]),
    );
    expect(r.affectedRows ?? 0).toBe(0);

    expect(await imagem(t, idB)).toEqual(antes);
    expect(antes?.remocao_pendente_em).toBeNull();
  });

  it("A apaga linha de B ⇒ 0 linhas afetadas; linha de B continua existindo", async () => {
    const idB = await registrarImagem(t, lojaB, novoCaminho(lojaB, "galeria"));
    const antes = await imagem(t, idB);

    const r = await t.asUser(DONO_A, (s) => s.query(`delete from public.imagens_loja where id = $1`, [idB]));
    expect(r.affectedRows ?? 0).toBe(0);

    expect(await imagem(t, idB)).toEqual(antes);
  });

  it("A marca remocao_pendente_em na PRÓPRIA linha ⇒ aceito (grant de coluna)", async () => {
    const idA = await registrarImagem(t, lojaA, novoCaminho(lojaA, "galeria"));

    await t.asUser(DONO_A, (s) =>
      s.query(`update public.imagens_loja set remocao_pendente_em = now() where id = $1`, [idA]),
    );
    expect((await imagem(t, idA))?.remocao_pendente_em).not.toBeNull();
  });

  it("A apaga a PRÓPRIA linha ⇒ aceito", async () => {
    const idA = await registrarImagem(t, lojaA, novoCaminho(lojaA, "galeria"));
    const r = await t.asUser(DONO_A, (s) => s.query(`delete from public.imagens_loja where id = $1`, [idA]));
    expect(r.affectedRows).toBe(1);
    expect(await imagem(t, idA)).toBeUndefined();
  });

  const colunasProibidas: Array<[string, (a: string, b: string, original: string) => unknown]> = [
    ["caminho", (a) => novoCaminho(a, "galeria")],
    ["loja_id", (_a, b) => b],
    ["origem_id", (_a, _b, original) => original],
    ["miniatura_caminho", (a) => novoCaminho(a, "galeria/mini")],
    ["bytes", () => 1234],
    ["criado_em", () => "2020-01-01T00:00:00Z"],
  ];

  it.each(colunasProibidas)(
    "A atualiza `%s` na PRÓPRIA linha ⇒ 42501 permission denied (UPDATE só em remocao_pendente_em); linha intacta",
    async (coluna, valor) => {
      const original = await registrarImagem(t, lojaA, novoCaminho(lojaA, "galeria"));
      const idA = await registrarImagem(t, lojaA, novoCaminho(lojaA, "galeria"));
      const antes = await imagem(t, idA);

      esperarErro(
        await erroDe(
          t.asUser(DONO_A, (s) =>
            s.query(`update public.imagens_loja set ${coluna} = $2 where id = $1`, [idA, valor(lojaA, lojaB, original)]),
          ),
        ),
        "42501",
        "permission denied",
      );

      expect(await imagem(t, idA)).toEqual(antes);
    },
  );

  it("grants: authenticated tem SELECT/INSERT/DELETE, UPDATE só na coluna remocao_pendente_em", async () => {
    const r = await t.db.query<Record<string, boolean>>(
      `select has_table_privilege('authenticated', 'public.imagens_loja', 'SELECT') as sel,
              has_table_privilege('authenticated', 'public.imagens_loja', 'INSERT') as ins,
              has_table_privilege('authenticated', 'public.imagens_loja', 'DELETE') as del,
              has_table_privilege('authenticated', 'public.imagens_loja', 'UPDATE') as upd_tabela,
              has_column_privilege('authenticated', 'public.imagens_loja', 'remocao_pendente_em', 'UPDATE') as upd_pendente,
              has_column_privilege('authenticated', 'public.imagens_loja', 'caminho', 'UPDATE') as upd_caminho,
              has_column_privilege('authenticated', 'public.imagens_loja', 'loja_id', 'UPDATE') as upd_loja`,
    );
    expect(r.rows[0]).toEqual({
      sel: true,
      ins: true,
      del: true,
      upd_tabela: false,
      upd_pendente: true,
      upd_caminho: false,
      upd_loja: false,
    });
  });

  it("catálogo: RLS ligada e exatamente as 4 políticas do spec", async () => {
    const rls = await t.db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where oid = 'public.imagens_loja'::regclass`,
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);

    const pol = await t.db.query<{ policyname: string; cmd: string }>(
      `select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'imagens_loja' order by policyname`,
    );
    expect(pol.rows).toEqual([
      { policyname: "imagens_loja_delete_propria", cmd: "DELETE" },
      { policyname: "imagens_loja_insert_propria", cmd: "INSERT" },
      { policyname: "imagens_loja_leitura_propria", cmd: "SELECT" },
      { policyname: "imagens_loja_update_propria", cmd: "UPDATE" },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════ anon
describe("[galeria/1] anon não alcança imagens_loja", () => {
  it("anon não lê nenhuma linha (há linhas de A e B)", async () => {
    await registrarImagem(t, lojaA, novoCaminho(lojaA, "galeria"));
    await registrarImagem(t, lojaB, novoCaminho(lojaB, "galeria"));

    // Sem política para anon: 0 linhas (o harness reconcede SELECT depois das
    // migrations) ou 42501 (sem o grant). Qualquer linha devolvida é vazamento.
    let linhas = 0;
    try {
      const r = await t.asAnon((s) => s.query(`select id from public.imagens_loja`));
      linhas = r.rows.length;
    } catch (e) {
      expect((e as { code?: string }).code, (e as Error).message).toBe("42501");
    }
    expect(linhas).toBe(0);
  });

  it("anon sem privilégio de escrita (REVOKE ALL explícito)", async () => {
    const r = await t.db.query<Record<string, boolean>>(
      `select has_table_privilege('anon', 'public.imagens_loja', 'INSERT') as ins,
              has_table_privilege('anon', 'public.imagens_loja', 'UPDATE') as upd,
              has_table_privilege('anon', 'public.imagens_loja', 'DELETE') as del`,
    );
    expect(r.rows[0]).toEqual({ ins: false, upd: false, del: false });
  });

  it("anon tenta inserir ⇒ 42501 permission denied; nada gravado", async () => {
    const antes = await imagensDa(t, lojaA);
    esperarErro(
      await erroDe(inserirComo("anon", { loja_id: lojaA, caminho: novoCaminho(lojaA, "galeria") })),
      "42501",
      "permission denied",
    );
    expect(await imagensDa(t, lojaA)).toEqual(antes);
  });
});

// ═══════════════════════════════════════════════════════════ CHECKs e FK composta
describe("[galeria/1] CHECKs de caminho e FK composta valem até pela via de serviço", () => {
  const recusasCaminho: Array<[string, (a: string, b: string) => string]> = [
    ["caminho na pasta de B", (_a, b) => novoCaminho(b, "galeria")],
    ["caminho com `..` saindo para B", (a, b) => `${a}/../${b}/x.webp`],
    ["caminho com `..` dentro da própria pasta", (a) => `${a}/galeria/../x.webp`],
    ["caminho prefixado pelo bucket (`produtos/<loja>/…`)", (a) => `produtos/${a}/x.webp`],
    ["caminho = id da loja sem barra", (a) => `${a}x.webp`],
  ];

  it.each(recusasCaminho)("%s ⇒ 23514 imagens_loja_caminho_da_loja", async (_n, montar) => {
    const antes = await imagensDa(t, lojaA);
    esperarErro(
      await erroDe(inserirComo("service", { loja_id: lojaA, caminho: montar(lojaA, lojaB) })),
      "23514",
      "imagens_loja_caminho_da_loja",
    );
    expect(await imagensDa(t, lojaA)).toEqual(antes);
  });

  it("dono A com caminho na pasta de B (loja_id = A) ⇒ 23514 imagens_loja_caminho_da_loja (CHECK, não RLS)", async () => {
    esperarErro(
      await erroDe(inserirComo("donoA", { loja_id: lojaA, caminho: novoCaminho(lojaB, "galeria") })),
      "23514",
      "imagens_loja_caminho_da_loja",
    );
  });

  const recusasMiniatura: Array<[string, (a: string, b: string) => string]> = [
    ["miniatura na pasta de B", (_a, b) => novoCaminho(b, "galeria/mini")],
    ["miniatura com `..`", (a, b) => `${a}/galeria/mini/../../../${b}/m.webp`],
  ];

  it.each(recusasMiniatura)("%s ⇒ 23514 imagens_loja_miniatura_da_loja", async (_n, montar) => {
    esperarErro(
      await erroDe(
        inserirComo("service", {
          loja_id: lojaA,
          caminho: novoCaminho(lojaA, "galeria"),
          miniatura_caminho: montar(lojaA, lojaB),
        }),
      ),
      "23514",
      "imagens_loja_miniatura_da_loja",
    );
  });

  it("original com miniatura na própria pasta ⇒ aceita", async () => {
    const r = await inserirComo("service", {
      loja_id: lojaA,
      caminho: novoCaminho(lojaA, "galeria"),
      miniatura_caminho: novoCaminho(lojaA, "galeria/mini"),
    });
    expect(r.rows).toHaveLength(1);
  });

  it("recorte (origem_id preenchido) com miniatura ⇒ 23514 imagens_loja_recorte_sem_miniatura", async () => {
    const original = await registrarImagem(t, lojaA, novoCaminho(lojaA, "galeria"));
    esperarErro(
      await erroDe(
        inserirComo("service", {
          loja_id: lojaA,
          origem_id: original,
          caminho: novoCaminho(lojaA),
          miniatura_caminho: novoCaminho(lojaA, "galeria/mini"),
        }),
      ),
      "23514",
      "imagens_loja_recorte_sem_miniatura",
    );
  });

  it("recorte da própria original ⇒ aceito", async () => {
    const original = await registrarImagem(t, lojaA, novoCaminho(lojaA, "galeria"));
    const r = await inserirComo("donoA", { loja_id: lojaA, origem_id: original, caminho: novoCaminho(lojaA) });
    expect((await imagem(t, r.rows[0].id))?.origem_id).toBe(original);
  });

  it("dono A cria recorte com origem_id de uma original de B ⇒ 23503 imagens_loja_origem_fk; original de B intacta", async () => {
    const originalB = await registrarImagem(t, lojaB, novoCaminho(lojaB, "galeria"));
    const antesB = await imagensDa(t, lojaB);

    esperarErro(
      await erroDe(inserirComo("donoA", { loja_id: lojaA, origem_id: originalB, caminho: novoCaminho(lojaA) })),
      "23503",
      "imagens_loja_origem_fk",
    );
    expect(await imagensDa(t, lojaB)).toEqual(antesB);
  });

  it("via de serviço também não amarra recorte de A a original de B ⇒ 23503 imagens_loja_origem_fk", async () => {
    const originalB = await registrarImagem(t, lojaB, novoCaminho(lojaB, "galeria"));
    esperarErro(
      await erroDe(inserirComo("service", { loja_id: lojaA, origem_id: originalB, caminho: novoCaminho(lojaA) })),
      "23503",
      "imagens_loja_origem_fk",
    );
  });

  it("caminho repetido ⇒ 23505 imagens_loja_caminho_unico", async () => {
    const caminho = novoCaminho(lojaA, "galeria");
    await registrarImagem(t, lojaA, caminho);
    esperarErro(
      await erroDe(inserirComo("service", { loja_id: lojaA, caminho })),
      "23505",
      "imagens_loja_caminho_unico",
    );
  });

  it.each([[0], [2097153], [-1]])("bytes = %s ⇒ 23514 (CHECK 1..2097152)", async (bytes) => {
    esperarErro(
      await erroDe(inserirComo("service", { loja_id: lojaA, caminho: novoCaminho(lojaA, "galeria"), bytes })),
      "23514",
      "bytes",
    );
  });

  it.each([[1], [2097152]])("bytes = %s (borda) ⇒ aceito", async (bytes) => {
    const r = await inserirComo("service", { loja_id: lojaA, caminho: novoCaminho(lojaA, "galeria"), bytes });
    expect(r.rows).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════ cascata
describe("[galeria/1] cascata", () => {
  it("apagar a original apaga as cópias (FK composta ON DELETE CASCADE); outra original intacta", async () => {
    const original = await registrarImagem(t, lojaA, novoCaminho(lojaA, "galeria"));
    const c1 = await registrarImagem(t, lojaA, novoCaminho(lojaA), { origemId: original });
    const c2 = await registrarImagem(t, lojaA, novoCaminho(lojaA, "logo"), { origemId: original });
    const outra = await registrarImagem(t, lojaA, novoCaminho(lojaA, "galeria"));

    await t.asService((s) => s.query(`delete from public.imagens_loja where id = $1`, [original]));

    expect(await imagem(t, c1)).toBeUndefined();
    expect(await imagem(t, c2)).toBeUndefined();
    expect(await imagem(t, outra)).toBeDefined();
  });

  it("apagar a loja apaga todas as linhas dela; as de outra loja ficam", async () => {
    const DONO_C = "c6a1e000-0000-4000-8000-0000000000c1";
    const lojaC = await criarLoja(t, DONO_C, "galeria-rls-c");
    const o = await registrarImagem(t, lojaC, novoCaminho(lojaC, "galeria"));
    await registrarImagem(t, lojaC, novoCaminho(lojaC), { origemId: o });
    const antesB = await imagensDa(t, lojaB);
    expect(await imagensDa(t, lojaC)).toHaveLength(2);

    await t.asService((s) => s.query(`delete from public.lojas where id = $1`, [lojaC]));

    const r = await t.asService((s) =>
      s.query<{ n: number }>(`select count(*)::int as n from public.imagens_loja where loja_id = $1`, [lojaC]),
    );
    expect(r.rows[0].n).toBe(0);
    expect(await imagensDa(t, lojaB)).toEqual(antesB);
  });
});

// ═══════════════════════════════════════════════════ caminho_storage_produtos
describe("[galeria/M1] caminho_storage_produtos(url) — fonte única URL ↔ caminho", () => {
  async function extrair(url: string | null): Promise<string | null> {
    const r = await t.db.query<{ c: string | null }>(`select public.caminho_storage_produtos($1) as c`, [url]);
    return r.rows[0].c;
  }

  it("URL pública do bucket produtos ⇒ caminho relativo ao bucket (raiz da loja)", async () => {
    const caminho = `${lojaA}/3f0c1d2e-0000-4000-8000-000000000001.webp`;
    expect(await extrair(urlStorage(caminho))).toBe(caminho);
  });

  it("URL de logo e de galeria/mini ⇒ caminho com subpastas", async () => {
    expect(await extrair(urlStorage(`${lojaA}/logo/x.webp`))).toBe(`${lojaA}/logo/x.webp`);
    expect(await extrair(urlStorage(`${lojaA}/galeria/mini/y.webp`))).toBe(`${lojaA}/galeria/mini/y.webp`);
  });

  it("outro host com o mesmo caminho ⇒ mesmo caminho (o host é responsabilidade do zod, limite documentado)", async () => {
    expect(await extrair(`https://outro-host.example/storage/v1/object/public/produtos/${lojaA}/z.webp`)).toBe(
      `${lojaA}/z.webp`,
    );
  });

  const foraDoFormato: Array<[string, string | null]> = [
    ["NULL", null],
    ["URL fora do Storage", "https://exemplo.com/foto.webp"],
    ["outro bucket (pix-qr)", `https://exemplo.supabase.co/storage/v1/object/public/pix-qr/${"x"}/qr.png`],
    ["URL assinada (object/sign)", `https://exemplo.supabase.co/storage/v1/object/sign/produtos/${"x"}/a.webp`],
    ["texto que não é URL", "javascript:alert(1)"],
  ];

  it.each(foraDoFormato)("%s ⇒ NULL", async (_n, url) => {
    expect(await extrair(url)).toBeNull();
  });

  it("catálogo: IMMUTABLE e search_path fixado", async () => {
    const r = await t.db.query<{ provolatile: string; proconfig: string[] | null }>(
      `select provolatile, proconfig from pg_proc where oid = 'public.caminho_storage_produtos(text)'::regprocedure`,
    );
    expect(r.rows[0].provolatile).toBe("i");
    expect((r.rows[0].proconfig ?? []).some((x) => x.startsWith("search_path="))).toBe(true);
  });
});
