import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDb, type TestDb } from "../helpers/pglite";
import { criarLoja, imagensDa, registrarImagem } from "../helpers/galeria";

/**
 * Fase RED (TDD) — galeria de imagens, backfill M3 (D3, RN-G17):
 *
 *   public.importar_imagens_do_storage() → int   (linhas NOVAS inseridas)
 *   SECURITY DEFINER, search_path fixo, EXECUTE revogado de public/anon/
 *   authenticated/service_role — só o dono roda.
 *
 * Autoridade: specs/galeria-imagens-loja.md §"Testar o backfill em pglite",
 * §"Migrations e ordem de deploy" · plan/loop-galeria-imagens-loja.md DP2.
 *
 * pglite não tem o schema `storage`: o teste cria um `storage.objects` mínimo
 * DEPOIS das migrations (é assim que o guard `to_regclass` pula a chamada na
 * migration) e chama a função como dono (superuser do pglite).
 *
 * Por que é RED: a função (M3) e a tabela (M1) não existem; as migrations M3/M4
 * não existem para o teste de texto.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

const DONO_A = "a6a4e000-0000-4000-8000-0000000000a4";
const DONO_B = "b6a4e000-0000-4000-8000-0000000000b4";

let t: TestDb;
let lojaA: string;
let lojaB: string;

beforeAll(async () => {
  t = await createTestDb();
  lojaA = await criarLoja(t, DONO_A, "galeria-bf-a");
  lojaB = await criarLoja(t, DONO_B, "galeria-bf-b");
  await t.db.exec(`
    create schema if not exists storage;
    create table if not exists storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text,
      name text,
      metadata jsonb,
      created_at timestamptz default now()
    );
  `);
}, 60_000);

afterAll(async () => {
  await t?.close();
});

async function objeto(bucket: string, name: string, mimetype: string | null, createdAt?: string): Promise<void> {
  await t.db.query(
    `insert into storage.objects (bucket_id, name, metadata, created_at)
     values ($1, $2, case when $3::text is null then null else jsonb_build_object('mimetype', $3::text, 'size', 1234) end,
             coalesce($4::timestamptz, now()))`,
    [bucket, name, mimetype, createdAt ?? null],
  );
}

async function importar(): Promise<number> {
  const r = await t.db.query<{ n: number }>(`select public.importar_imagens_do_storage() as n`);
  return r.rows[0].n;
}

async function linhaPorCaminho(caminho: string) {
  const r = await t.db.query<{
    loja_id: string;
    origem_id: string | null;
    miniatura_caminho: string | null;
    remocao_pendente_em: string | null;
    criado_em: string;
  }>(
    `select loja_id, origem_id, miniatura_caminho, remocao_pendente_em, criado_em
       from public.imagens_loja where caminho = $1`,
    [caminho],
  );
  return r.rows[0];
}

async function totalImagens(): Promise<number> {
  const r = await t.db.query<{ n: number }>(`select count(*)::int as n from public.imagens_loja`);
  return r.rows[0].n;
}

// Um único lote de objetos, importado uma vez; cada `it` afirma um caso.
describe("[galeria/M3] importar_imagens_do_storage — casos do spec", () => {
  const u = () => randomUUID();
  const casos = {
    raiz: "",
    logo: "",
    raizB: "",
    lojaInexistente: "",
    prefixoNaoUuid: "",
    pixQr: "",
    pdf: "",
    semMetadata: "",
    jpeg: "",
    png: "",
  };
  const CRIADO_RAIZ = "2026-03-04T05:06:07.123+00:00";
  let recorteJaRegistrado = "";
  let idRecorte = "";
  let idOriginalDoRecorte = "";
  let primeiraExecucao = -1;
  let totalAntes = -1;

  // Preparação memoizada chamada por CADA teste (não beforeAll): sem a tabela,
  // cada teste falha com o motivo real em vez de ser pulado.
  let preparo: Promise<void> | null = null;
  const preparar = () => (preparo ??= prepararLote());

  async function prepararLote() {
    casos.raiz = `${lojaA}/${u()}.webp`;
    casos.logo = `${lojaA}/logo/${u()}.webp`;
    casos.raizB = `${lojaB}/${u()}.webp`;
    casos.lojaInexistente = `${u()}/${u()}.webp`;
    casos.prefixoNaoUuid = `fotos-antigas/${u()}.webp`;
    casos.pixQr = `${lojaA}/${u()}.png`;
    casos.pdf = `${lojaA}/${u()}.pdf`;
    casos.semMetadata = `${lojaA}/${u()}.webp`;
    casos.jpeg = `${lojaA}/${u()}.jpg`;
    casos.png = `${lojaA}/${u()}.png`;

    // Recorte que o código NOVO já registrou (com origem) antes da reimportação
    // do passo 3 do deploy: o backfill não pode sobrescrever nem duplicar.
    idOriginalDoRecorte = await registrarImagem(t, lojaA, `${lojaA}/galeria/${u()}.webp`);
    recorteJaRegistrado = `${lojaA}/${u()}.webp`;
    idRecorte = await registrarImagem(t, lojaA, recorteJaRegistrado, { origemId: idOriginalDoRecorte });

    await objeto("produtos", casos.raiz, "image/webp", CRIADO_RAIZ);
    await objeto("produtos", casos.logo, "image/webp");
    await objeto("produtos", casos.raizB, "image/webp");
    await objeto("produtos", casos.lojaInexistente, "image/webp");
    await objeto("produtos", casos.prefixoNaoUuid, "image/webp");
    await objeto("pix-qr", casos.pixQr, "image/png");
    await objeto("produtos", casos.pdf, "application/pdf");
    await objeto("produtos", casos.semMetadata, null);
    await objeto("produtos", casos.jpeg, "image/jpeg");
    await objeto("produtos", casos.png, "image/png");
    await objeto("produtos", recorteJaRegistrado, "image/webp");

    totalAntes = await totalImagens();
    primeiraExecucao = await importar();
  }

  it("foto na raiz da loja ⇒ registrada como ORIGINAL da loja, sem miniatura, não pendente", async () => {
    await preparar();
    expect(await linhaPorCaminho(casos.raiz)).toMatchObject({
      loja_id: lojaA,
      origem_id: null,
      miniatura_caminho: null,
      remocao_pendente_em: null,
    });
  });

  it("criado_em = created_at do objeto", async () => {
    await preparar();
    const r = await t.db.query<{ igual: boolean }>(
      `select i.criado_em = o.created_at as igual
         from public.imagens_loja i join storage.objects o on o.name = i.caminho and o.bucket_id = 'produtos'
        where i.caminho = $1`,
      [casos.raiz],
    );
    expect(r.rows[0]?.igual).toBe(true);
    const r2 = await t.db.query<{ igual: boolean }>(`select $1::timestamptz = $2::timestamptz as igual`, [
      (await linhaPorCaminho(casos.raiz)).criado_em,
      CRIADO_RAIZ,
    ]);
    expect(r2.rows[0].igual).toBe(true);
  });

  it("logo em `<loja>/logo/` ⇒ registrada como original da loja", async () => {
    await preparar();
    expect(await linhaPorCaminho(casos.logo)).toMatchObject({ loja_id: lojaA, origem_id: null });
  });

  it("objeto da loja B ⇒ registrado na loja B (não na A)", async () => {
    await preparar();
    expect((await linhaPorCaminho(casos.raizB))?.loja_id).toBe(lojaB);
  });

  it("jpeg e png do bucket produtos ⇒ registrados", async () => {
    await preparar();
    expect(await linhaPorCaminho(casos.jpeg)).toBeDefined();
    expect(await linhaPorCaminho(casos.png)).toBeDefined();
  });

  it.each([
    ["loja que não existe mais", "lojaInexistente"],
    ["prefixo que não é uuid (sem quebrar a função)", "prefixoNaoUuid"],
    ["bucket pix-qr", "pixQr"],
    ["mimetype não-imagem (application/pdf)", "pdf"],
    ["sem metadata/mimetype", "semMetadata"],
  ] as const)("%s ⇒ ignorado", async (_n, chave) => {
    await preparar();
    expect(await linhaPorCaminho(casos[chave])).toBeUndefined();
  });

  it("recorte já registrado pelo código novo ⇒ intacto (mesmo id, origem preservada), sem duplicata", async () => {
    await preparar();
    const r = await t.db.query<{ id: string; origem_id: string | null }>(
      `select id, origem_id from public.imagens_loja where caminho = $1`,
      [recorteJaRegistrado],
    );
    expect(r.rows).toEqual([{ id: idRecorte, origem_id: idOriginalDoRecorte }]);
  });

  it("retorno = número de linhas novas (raiz, logo, raizB, jpeg, png = 5)", async () => {
    await preparar();
    expect(primeiraExecucao).toBe(5);
    expect((await totalImagens()) - totalAntes).toBe(5);
  });

  it("segunda execução ⇒ 0 linhas novas e tabela idêntica", async () => {
    await preparar();
    const antesA = await imagensDa(t, lojaA);
    const antesB = await imagensDa(t, lojaB);

    expect(await importar()).toBe(0);

    expect(await imagensDa(t, lojaA)).toEqual(antesA);
    expect(await imagensDa(t, lojaB)).toEqual(antesB);
  });
});

describe("[galeria/M3] catálogo de importar_imagens_do_storage", () => {
  const ASSINATURA = "public.importar_imagens_do_storage()";

  it("SECURITY DEFINER com search_path fixado, retorna integer", async () => {
    const r = await t.db.query<{ prosecdef: boolean; proconfig: string[] | null; ret: string }>(
      `select prosecdef, proconfig, prorettype::regtype::text as ret from pg_proc where oid = $1::regprocedure`,
      [ASSINATURA],
    );
    expect(r.rows[0].prosecdef).toBe(true);
    expect((r.rows[0].proconfig ?? []).some((x) => x.startsWith("search_path="))).toBe(true);
    expect(r.rows[0].ret).toBe("integer");
  });

  it("EXECUTE revogado de public, anon, authenticated e service_role (só o dono roda)", async () => {
    const r = await t.db.query<Record<string, boolean>>(
      `select has_function_privilege('public', $1, 'EXECUTE') as publico,
              has_function_privilege('anon', $1, 'EXECUTE') as anon,
              has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
              has_function_privilege('service_role', $1, 'EXECUTE') as svc`,
      [ASSINATURA],
    );
    expect(r.rows[0]).toEqual({ publico: false, anon: false, auth: false, svc: false });
  });
});

// ═══════════════════════════════════════════ texto das migrations (anti-falso-verde)
// Em pglite `storage.objects` não existe na hora das migrations: uma chamada SEM
// guard quebraria `createTestDb()` aqui, mas uma chamada que simplesmente não
// existisse passaria calada. Estes testes leem o texto e exigem a chamada atrás
// do guard (DP2), como storage_bucket_produtos.test.ts faz com as policies.
function lerMigration(sufixo: string): string {
  const achados = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(`_${sufixo}.sql`));
  if (achados.length !== 1) {
    throw new Error(
      `[RED galeria] esperada exatamente 1 migration supabase/migrations/*_${sufixo}.sql; encontradas ${achados.length}.`,
    );
  }
  return readFileSync(join(MIGRATIONS_DIR, achados[0]), "utf8");
}

/** Remove comentários `-- …` de linha (o guard em comentário não vale). */
function semComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

const RE_GUARD =
  /if\s+to_regclass\(\s*'storage\.objects'\s*\)\s+is\s+not\s+null\s+then([\s\S]*?)end\s+if/gi;
const RE_CHAMADA = /(perform|select)\s+(public\.)?importar_imagens_do_storage\s*\(\s*\)/gi;

/** Faixas [início, fim) dos blocos guardados e posições de cada chamada. */
function analisar(sql: string) {
  const limpo = semComentarios(sql);
  const faixas: Array<[number, number]> = [];
  for (const m of limpo.matchAll(RE_GUARD)) faixas.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  const chamadas: number[] = [];
  for (const m of limpo.matchAll(RE_CHAMADA)) chamadas.push(m.index ?? 0);
  const fora = chamadas.filter((p) => !faixas.some(([i, f]) => p >= i && p < f));
  return { limpo, faixas, chamadas, fora };
}

describe("[galeria/DP2] chamada do backfill sempre atrás do guard de storage.objects", () => {
  it("M3 (*_importar_imagens_do_storage.sql): define a função e a chama só dentro de `if to_regclass('storage.objects') is not null`", () => {
    const sql = lerMigration("importar_imagens_do_storage");
    const { limpo, chamadas, fora } = analisar(sql);

    expect(limpo).toMatch(/create\s+(or\s+replace\s+)?function\s+public\.importar_imagens_do_storage\s*\(\s*\)/i);
    expect(limpo).toMatch(/security\s+definer/i);
    expect(limpo).toMatch(/on\s+conflict\s*\(\s*caminho\s*\)\s*do\s+nothing/i);
    expect(chamadas.length, "M3 precisa chamar a função").toBeGreaterThanOrEqual(1);
    expect(fora, "chamada fora do guard").toEqual([]);
  });

  it("M4 (*_fotos_exigem_galeria.sql): reimporta atrás do guard ANTES de criar os triggers", () => {
    const sql = lerMigration("fotos_exigem_galeria");
    const { limpo, chamadas, fora } = analisar(sql);

    expect(chamadas.length, "M4 precisa reimportar").toBeGreaterThanOrEqual(1);
    expect(fora, "chamada fora do guard").toEqual([]);

    const primeiraTrigger = limpo.search(/create\s+(or\s+replace\s+)?trigger/i);
    expect(primeiraTrigger, "M4 cria triggers").toBeGreaterThan(-1);
    expect(Math.min(...chamadas)).toBeLessThan(primeiraTrigger);
  });
});
