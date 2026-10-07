import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";
import { erroDe, esperarErro, registrarImagem, urlStorage } from "../helpers/galeria";

/**
 * Fase RED (TDD) da issue 001 — `lojas.logo_url` + projeção na view `vitrine_lojas`.
 *
 * Estado ATUAL: a migration `20260615013000_logo_url_lojas.sql` AINDA NÃO EXISTE.
 * Logo, no schema aplicado pelo harness (`createTestDb` aplica todas as migrations):
 *   - `public.lojas` NÃO tem a coluna `logo_url`;
 *   - a view `public.vitrine_lojas` (última versão = 006000) NÃO projeta `logo_url`;
 *   - NÃO existe o CHECK `lojas_logo_url_https_chk`.
 *
 * Consequência (o RED esperado):
 *   [1] anon NÃO encontra `logo_url` na view de loja ativa  → FALHA agora
 *       (coluna inexistente → query lança / não retorna o valor esperado).
 *   [4] o CHECK https NÃO existe → um UPDATE com `logo_url` sequer compila
 *       (coluna ausente) e, mesmo que existisse, não rejeitaria `http://`.
 * Os testes de NEGAÇÃO ([2] loja inativa fora, [3] colunas sensíveis fora) já
 * passam por herança da view 006000 — ficam registrados como guarda anti-regressão
 * para a fase GREEN, mas NÃO são o que prova o RED.
 *
 * Quem deixa verde é a fase GREEN (`executar`/`migrar`), criando a migration com:
 *   - `alter table lojas add column logo_url text;`
 *   - `add constraint lojas_logo_url_https_chk check (logo_url is null or logo_url like 'https://%')`
 *   - drop+create de `vitrine_lojas` projetando `logo_url` (última coluna), `where ativo = true`.
 * Nenhum código de produção / migration é escrito aqui.
 *
 * Padrão anti-falso-verde (herdado de rls_lojas.test.ts): cenário criado via
 * asService (BYPASSRLS); leitura pública é confirmada pela view; valor de logo
 * gravado é reconferido via asService (fonte de verdade).
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const SLUG_A = "loja-a-logo"; // ativa, tem logo https
const SLUG_INATIVA = "loja-inativa-logo"; // inativa — não pode aparecer na view

// Desde M4 (fotos_exigem_galeria) toda logo gravada precisa ser imagem registrada
// da própria loja: o cenário registra `<loja>/logo/inicial.png` e grava a URL dela.
const logoInicial = (lojaId: string) => urlStorage(`${lojaId}/logo/inicial.png`);

type Lojas = { lojaA: string; lojaInativa: string };

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
 * Cria via asService:
 *   A        ativa   (dono A) com logo_url = logoInicial(A),
 *   inativa  inativa (dono B) com logo_url = logoInicial(inativa).
 * Loja nasce sem logo; a imagem é registrada e a logo gravada em seguida (M4).
 */
async function criarCenario(t: TestDb): Promise<Lojas> {
  await garantirDonos(t);
  const ids = await t.asService(async (db) => {
    const a = await db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo)
       values ($1, $2, 'Loja A', true) returning id`,
      [DONO_A, SLUG_A],
    );
    const inativa = await db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo)
       values ($1, $2, 'Loja Inativa', false) returning id`,
      [DONO_B, SLUG_INATIVA],
    );
    return { lojaA: a.rows[0].id, lojaInativa: inativa.rows[0].id };
  });
  for (const id of [ids.lojaA, ids.lojaInativa]) {
    await registrarImagem(t, id, `${id}/logo/inicial.png`);
    await t.asService((db) =>
      db.query(`update public.lojas set logo_url = $2 where id = $1`, [id, logoInicial(id)]),
    );
  }
  return ids;
}

/** Reconfere via service o logo_url atual de uma loja — fonte de verdade. */
async function logoAtual(t: TestDb, lojaId: string): Promise<string | null> {
  const r = await t.asService((db) =>
    db.query<{ logo_url: string | null }>(`select logo_url from public.lojas where id = $1`, [
      lojaId,
    ]),
  );
  return r.rows[0]?.logo_url ?? null;
}

describe("001 lojas.logo_url + vitrine_lojas (TDD red-first)", () => {
  let t: TestDb;
  let ids: Lojas;

  beforeAll(async () => {
    t = await createTestDb();
    ids = await criarCenario(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ───────────────────── [1] view projeta logo_url de loja ATIVA (o RED principal)
  it("[1] vitrine_lojas projeta logo_url da loja ATIVA (1 linha, valor https)", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string; logo_url: string | null }>(
        `select id, logo_url from public.vitrine_lojas where slug = $1`,
        [SLUG_A],
      ),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.lojaA);
    expect(r.rows[0].logo_url).toBe(logoInicial(ids.lojaA));
  });

  // ───────────────────── [2] loja INATIVA não aparece (filtro ativo=true)
  it("[2] vitrine_lojas NÃO retorna loja inativa (0 linhas)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.vitrine_lojas where slug = $1`, [SLUG_INATIVA]),
    );
    expect(r.rows.length).toBe(0);
    // Anti-falso-verde: a loja inativa REALMENTE existe (negação é por filtro).
    const conf = await t.asService((db) =>
      db.query(`select 1 from public.lojas where slug = $1`, [SLUG_INATIVA]),
    );
    expect(conf.rows.length).toBe(1);
  });

  // ───────────────────── [3] view NÃO expõe colunas sensíveis, MAS expõe logo_url
  it("[3] vitrine_lojas expõe logo_url e NÃO expõe dono_id/hotmart_*", async () => {
    const r = await t.asAnon((db) =>
      db.query<Record<string, unknown>>(`select * from public.vitrine_lojas where slug = $1`, [
        SLUG_A,
      ]),
    );
    expect(r.rows.length).toBe(1);
    const chaves = Object.keys(r.rows[0]);
    // Coluna pública nova DEVE estar presente.
    expect(chaves).toContain("logo_url");
    // Colunas sensíveis NUNCA podem aparecer.
    expect(chaves).not.toContain("dono_id");
    expect(chaves).not.toContain("hotmart_subscriber_code");
    expect(chaves).not.toContain("hotmart_plano");
    // Colunas públicas pré-existentes preservadas (a recriação não pode regredir a view).
    expect(chaves).toContain("id");
    expect(chaves).toContain("slug");
    expect(chaves).toContain("assinatura_status");
    expect(chaves).toContain("taxa_entrega_fora_zona");
  });

  // ───────────────────── [4] CHECK https — rejeita não-https, aceita https/NULL
  // Desde M4 da galeria (20261006123000_fotos_exigem_galeria.sql, DP1 estrito) o
  // trigger BEFORE `lojas_logo_na_galeria_trg` recusa antes do CHECK toda URL
  // que não seja de imagem registrada da loja. Os casos [4a]/[4b] afirmam essa
  // recusa E provam o CHECK isolado, com o trigger desligado na sessão dona.
  async function semTriggerDaGaleria<T>(fn: () => Promise<T>): Promise<T> {
    await t.db.exec("alter table public.lojas disable trigger lojas_logo_na_galeria_trg");
    try {
      return await fn();
    } finally {
      await t.db.exec("alter table public.lojas enable trigger lojas_logo_na_galeria_trg");
    }
  }

  function gravarLogo(valor: string) {
    return t.asService((db) =>
      db.query(`update public.lojas set logo_url = $1 where id = $2`, [valor, ids.lojaA]),
    );
  }

  it.each([
    ["[4a]", "http://x.com/l.png"],
    ["[4b]", "javascript:alert(1)"],
  ])("%s logo_url %s ⇒ trigger da galeria recusa; com o trigger desligado, o CHECK recusa; valor intacto", async (_id, valor) => {
    const antes = await logoAtual(t, ids.lojaA);

    esperarErro(await erroDe(gravarLogo(valor)), "P0001", "imagem_fora_da_galeria");
    expect(await logoAtual(t, ids.lojaA)).toBe(antes);

    const semTrigger = await semTriggerDaGaleria(() => erroDe(gravarLogo(valor)));
    esperarErro(semTrigger, "23514", "lojas_logo_url_https_chk");
    expect(await logoAtual(t, ids.lojaA)).toBe(antes);
  });

  it("[4c] CHECK ACEITA logo_url https:// de imagem registrada (persistido)", async () => {
    const caminho = `${ids.lojaA}/logo/nova.webp`;
    await registrarImagem(t, ids.lojaA, caminho);
    const novo = urlStorage(caminho);
    const r = await gravarLogo(novo);
    expect(r.affectedRows).toBe(1);
    expect(await logoAtual(t, ids.lojaA)).toBe(novo);
  });

  it("[4d] CHECK ACEITA logo_url NULL (loja sem logo)", async () => {
    const r = await t.asService((db) =>
      db.query(`update public.lojas set logo_url = null where id = $1`, [ids.lojaA]),
    );
    expect(r.affectedRows).toBe(1);
    expect(await logoAtual(t, ids.lojaA)).toBe(null);
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar/migrar) — issue 001:
 *
 * Criar `supabase/migrations/20260615013000_logo_url_lojas.sql` (timestamp >
 * 20260615012000), aditivo:
 *
 *   alter table public.lojas add column if not exists logo_url text;
 *   alter table public.lojas add constraint lojas_logo_url_https_chk
 *     check (logo_url is null or logo_url like 'https://%');
 *   drop view if exists public.vitrine_lojas;
 *   create view public.vitrine_lojas with (security_invoker = false) as
 *     select <17 colunas da 006000>, logo_url
 *     from public.lojas where ativo = true;
 *   grant select on public.vitrine_lojas to anon, authenticated;
 *
 * Casos que precisam passar após a migration: [1], [2], [3], [4a], [4b], [4c], [4d].
 * (O beforeAll/criarCenario também passa a funcionar — hoje ele falha porque a
 *  coluna `logo_url` não existe no INSERT.)
 */
