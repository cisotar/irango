import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * REGRESSÃO (pentester ÁREA 3) — `consentimento_versao` / `consentimento_em`
 * devem ser SOMENTE-SERVIDOR no NÍVEL DO BANCO, não só no código.
 *
 * ESTADO ATUAL (RED): o trigger `lojas_protege_billing` (v3,
 * 20260707121000_lojas_protege_billing_v3_modulos.sql) protege billing/identidade
 * + módulos, mas NÃO cobre `consentimento_versao` / `consentimento_em`. A doc
 * (references/seguranca.md §, linha ~494) reconhece: essas duas colunas "só a
 * constante [CAMPOS_LOJA_SOMENTE_SERVIDOR] protege". Como a policy RLS
 * `lojas_update_proprio` concede ao dono autenticado o UPDATE da LINHA INTEIRA, e
 * a anon key + o JWT do lojista permitem falar com o PostgREST DIRETO (sem passar
 * por nenhuma Server Action / allowlist de código), o lojista reescreve o próprio
 * registro de consentimento LGPD:
 *     PATCH /rest/v1/lojas?id=eq.<propria>  { "consentimento_versao": "FORJADO",
 *                                             "consentimento_em": "2000-01-01" }
 * Vetor CONFIRMADO empiricamente no pglite (bloqueou=false, affected=1,
 * versao=FORJADO). Viola o mandato "o banco (RLS/trigger) é a última linha" —
 * a allowlist de código não é a última linha porque o cliente tem a anon key.
 *
 * Impacto: integridade / não-repúdio do registro de consentimento (prova legal
 * LGPD deixa de ser confiável — o titular pode alterá-la).
 *
 * GREEN (fix, NÃO neste arquivo): estender o trigger `lojas_protege_billing` para
 * também comparar `consentimento_versao` / `consentimento_em` (IS DISTINCT FROM no
 * UPDATE; IS NOT NULL/DEFAULT no INSERT por autor não-sistema), mantendo o bypass
 * de service_role/postgres/supabase_admin (garantir_loja_do_dono continua gravando
 * o consentimento na criação legítima).
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SLUG_A = "loja-consent-a";

async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1,'dono-a@teste.local'), ($2,'dono-b@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B],
  );
}

/** Loja de A com consentimento inicial gravado pelo servidor (fonte de verdade). */
async function criarLojaA(t: TestDb): Promise<string> {
  await garantirDonos(t);
  return t.asService(async (db) => {
    const r = await db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo, consentimento_versao, consentimento_em)
         values ($1,$2,'Loja A',true,'1.0','2026-01-01T00:00:00Z') returning id`,
      [DONO_A, SLUG_A],
    );
    return r.rows[0].id;
  });
}

async function colAtual<T = unknown>(t: TestDb, lojaId: string, col: string): Promise<T | null> {
  const r = await t.asService((db) =>
    db.query<Record<string, T>>(`select ${col} as v from public.lojas where id=$1`, [lojaId]),
  );
  return (r.rows[0]?.["v" as keyof (typeof r.rows)[number]] as T) ?? null;
}

/** BLOQUEADO = trigger lançou OU 0 linhas afetadas. */
async function tentarComoDono(
  t: TestDb,
  userId: string,
  sql: string,
  params: unknown[],
): Promise<{ bloqueou: boolean; affected: number }> {
  try {
    const r = await t.asUser(userId, (db) => db.query(sql, params));
    const affected = r.affectedRows ?? 0;
    return { bloqueou: affected === 0, affected };
  } catch {
    return { bloqueou: true, affected: 0 };
  }
}

describe("consentimento_* é somente-servidor no banco (backstop de trigger)", () => {
  let t: TestDb;
  let lojaA: string;

  beforeEach(async () => {
    t = await createTestDb();
    lojaA = await criarLojaA(t);
  });
  afterEach(async () => t.close());

  it("[C-1] dono NÃO pode reescrever consentimento_versao via UPDATE direto (bloqueado, intacto)", async () => {
    expect(await colAtual<string>(t, lojaA, "consentimento_versao")).toBe("1.0");

    const res = await tentarComoDono(
      t,
      DONO_A,
      `update public.lojas set consentimento_versao='FORJADO' where id=$1`,
      [lojaA],
    );

    expect(res.bloqueou).toBe(true);
    expect(await colAtual<string>(t, lojaA, "consentimento_versao")).toBe("1.0");
  });

  it("[C-2] dono NÃO pode backdatar consentimento_em via UPDATE direto (bloqueado, intacto)", async () => {
    const res = await tentarComoDono(
      t,
      DONO_A,
      `update public.lojas set consentimento_em='2000-01-01T00:00:00Z' where id=$1`,
      [lojaA],
    );

    expect(res.bloqueou).toBe(true);
    expect(await colAtual<string>(t, lojaA, "consentimento_em")).toBe("2026-01-01 00:00:00+00");
  });

  it("[C-3] dono NÃO escapa escondendo consentimento junto de coluna legítima (nome)", async () => {
    const res = await tentarComoDono(
      t,
      DONO_A,
      `update public.lojas set nome='Renomeada', consentimento_versao='FORJADO' where id=$1`,
      [lojaA],
    );

    expect(res.bloqueou).toBe(true);
    expect(await colAtual<string>(t, lojaA, "consentimento_versao")).toBe("1.0");
    expect(await colAtual<string>(t, lojaA, "nome")).toBe("Loja A");
  });

  it("[C-4] dono SEM loja NÃO forja consentimento_versao no INSERT de criação", async () => {
    const res = await tentarComoDono(
      t,
      DONO_B,
      `insert into public.lojas (dono_id, slug, nome, consentimento_versao)
         values ($1,'loja-b-consent','B','FORJADO')`,
      [DONO_B],
    );

    expect(res.bloqueou).toBe(true);
    const c = await t.asService((db) =>
      db.query<{ n: number }>(`select count(*)::int n from public.lojas where dono_id=$1`, [DONO_B]),
    );
    expect(c.rows[0].n).toBe(0);
  });

  it("[C-5] service_role AINDA grava consentimento (não over-block do caminho legítimo)", async () => {
    const r = await t.asService((db) =>
      db.query(`update public.lojas set consentimento_versao='2.0' where id=$1`, [lojaA]),
    );
    expect(r.affectedRows).toBe(1);
    expect(await colAtual<string>(t, lojaA, "consentimento_versao")).toBe("2.0");
  });
});
