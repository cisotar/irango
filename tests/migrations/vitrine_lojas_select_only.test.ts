import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) — issue 112 (crítica: SIM). Camada SQL real (pglite).
 *
 * Prova o CONTRATO da migration `20260702140000_vitrine_lojas_revoke_escrita.sql`
 * (ainda NÃO escrita — fase GREEN do `migrar`/`executar`):
 *
 *  A. A view pública `vitrine_lojas` é SELECT-only para anon/authenticated.
 *     Hoje ela é auto-atualizável, definer (dona=postgres) e recebeu GRANT ALL
 *     via 20260614008500 + default privileges a cada drop+create — ou seja,
 *     UPDATE/DELETE/INSERT anônimo BYPASSA a RLS de `lojas`. RED real: a
 *     escrita anônima FUNCIONA hoje.
 *
 *  B. `public.loja_por_email_dono(text)` (SECURITY DEFINER, retorna a linha
 *     INTEIRA de `lojas`: dono_id, assinatura_*, hotmart_*) só é executável
 *     por service_role. Hoje o `GRANT ALL ON ALL ROUTINES` da 008500 re-abriu
 *     EXECUTE para anon → vazamento de PII + enumeração de e-mail. RED real:
 *     a chamada anônima FUNCIONA hoje.
 *
 *  C. Guarda estática anti-reincidência (spec §3 passo 3): todo arquivo de
 *     migration que (re)cria `vitrine_lojas` exige revoke de escrita no mesmo
 *     arquivo ou em um posterior. O furo já reincidiu 3× por drop+create.
 *
 * Anti-falso-verde (padrão do repo): toda mutação negada é reconferida via
 * `asService` (o dado NÃO mudou); a negação da função é provada como negação
 * de PERMISSÃO (a função existe e funciona via service), não "não existe".
 *
 * Pré-requisito do harness (spec §3 passo 1, verificado): `createTestDb` roda
 * migrations e DEPOIS o GRANTS_SQL. O GRANTS_SQL foi ajustado (opção B do spec)
 * para não conceder escrita em views — o pior caso (GRANT amplo) continua
 * emulado pela própria migration 008500 dentro do pglite. Ver comentário em
 * tests/helpers/pglite.ts.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aa0000000112";
const LOJA_A = "11211211-2112-4112-8112-aa0000000112";
const EMAIL_A = "dono-a@teste.local";
const SLUG_A = "loja-a-112";
const NOME_A = "Loja A 112";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/**
 * Re-semeia a loja A (id fixo) antes de CADA caso. Necessário porque, no RED,
 * a vulnerabilidade é real: o UPDATE/DELETE anônimo dos casos [1]/[2] MUTA o
 * banco de verdade — sem re-seed, os casos seguintes falhariam por dado
 * ausente (causa errada) em vez de pela regra sob teste.
 */
async function semearLojaA(t: TestDb): Promise<void> {
  await t.asService(async (db) => {
    await db.query(
      `insert into public.lojas (id, dono_id, slug, nome, ativo)
       values ($1, $2, $3, $4, true)
       on conflict (id) do update set nome = excluded.nome, ativo = true`,
      [LOJA_A, DONO_A, SLUG_A, NOME_A],
    );
  });
}

describe("112 vitrine_lojas SELECT-only (revoke de escrita anônima)", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
    await t.db.query(
      `insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`,
      [DONO_A, EMAIL_A],
    );
  });
  beforeEach(async () => {
    await semearLojaA(t);
  });
  afterAll(async () => {
    await t.close();
  });

  it("[1] anon NÃO atualiza via vitrine_lojas (42501); nome intacto via service", async () => {
    await expect(
      t.asAnon((db) =>
        db.query(`update public.vitrine_lojas set nome = 'HACKED' where slug = $1`, [SLUG_A]),
      ),
    ).rejects.toMatchObject({ code: "42501" });

    // anti-falso-verde: a base `lojas` NÃO mudou
    const r = await t.asService((db) =>
      db.query<{ nome: string }>(`select nome from public.lojas where slug = $1`, [SLUG_A]),
    );
    expect(r.rows[0].nome).toBe(NOME_A);
  });

  it("[2] anon NÃO deleta via vitrine_lojas (42501); loja ainda existe via service", async () => {
    await expect(
      t.asAnon((db) => db.query(`delete from public.vitrine_lojas where slug = $1`, [SLUG_A])),
    ).rejects.toMatchObject({ code: "42501" });

    // anti-falso-verde: a loja (e sua cascata) sobreviveu
    const r = await t.asService((db) =>
      db.query<{ id: string }>(`select id from public.lojas where slug = $1`, [SLUG_A]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(LOJA_A);
  });

  it("[3] anon NÃO insere via vitrine_lojas (42501); nada persistiu via service", async () => {
    await expect(
      t.asAnon((db) =>
        db.query(
          `insert into public.vitrine_lojas (slug, nome, ativo)
           values ('loja-invasora-112', 'Invasora', true)`,
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });

    // anti-falso-verde: nenhuma linha entrou na base
    const r = await t.asService((db) =>
      db.query(`select 1 from public.lojas where slug = 'loja-invasora-112'`),
    );
    expect(r.rows.length).toBe(0);
  });

  it("[4] anon LÊ vitrine_lojas where ativo=true (leitura pública NÃO regride)", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ slug: string; nome: string }>(
        `select slug, nome from public.vitrine_lojas where ativo = true`,
      ),
    );
    expect(r.rows.map((x) => x.slug)).toContain(SLUG_A);
    expect(r.rows.find((x) => x.slug === SLUG_A)?.nome).toBe(NOME_A);
  });

  it("[5] anon NÃO executa loja_por_email_dono (42501); função existe e funciona via service", async () => {
    await expect(
      t.asAnon((db) => db.query(`select * from public.loja_por_email_dono($1)`, [EMAIL_A])),
    ).rejects.toMatchObject({ code: "42501" });

    // anti-falso-verde: a negação acima é de PERMISSÃO, não "função inexistente" —
    // a função existe no catálogo e retorna a linha quando chamada por service_role.
    const existe = await t.asService((db) =>
      db.query<{ fn: string | null }>(
        `select to_regprocedure('public.loja_por_email_dono(text)')::text as fn`,
      ),
    );
    expect(existe.rows[0].fn).not.toBeNull();

    const r = await t.asService((db) =>
      db.query<{ id: string; dono_id: string }>(
        `select * from public.loja_por_email_dono($1)`,
        [EMAIL_A],
      ),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(LOJA_A);
    expect(r.rows[0].dono_id).toBe(DONO_A);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Guarda estática anti-reincidência (spec §3 passo 3): quem (re)cria a view
// vitrine_lojas DEVE revogar escrita no mesmo arquivo ou em um posterior.
// O furo reincidiu 3× (005000, 006000, 013000) porque drop+create faz a view
// renascer com GRANT ALL via default privileges da 008500.
// ─────────────────────────────────────────────────────────────────────────────

type ArquivoMigration = { nome: string; conteudo: string };

const normaliza = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

/**
 * 265: o scanner passa a ser PARAMETRIZADO pelo nome da view — `vitrine_produtos`
 * nasce sob a mesma regra de §19 ("toda view definer pública é SELECT-only") e
 * copiar a função seria criar uma segunda fonte da mesma trava.
 * O default `"vitrine_lojas"` preserva os chamadores existentes.
 *
 * Duas formas de revoke são aceitas, ambas satisfazendo §19:
 *  - `revoke insert, update, delete on public.<view>` (o que a 20260702140000 fez);
 *  - `revoke all on public.<view>` (o que a migration A da 265 faz, junto do
 *    `grant select` — forma mais forte, cobre TRUNCATE/TRIGGER/REFERENCES).
 */
const criaVitrine = (c: string, nomeView = "vitrine_lojas") =>
  // 245: `create OR REPLACE view` também é recriação — a 20260920132000 recria
  // `vitrine_produtos` por essa forma, e sem reconhecê-la a recriação ficaria
  // INVISÍVEL à guarda que exige o revoke.
  new RegExp(`create (or replace )?view public\\.${nomeView}`).test(normaliza(c));
const revogaEscritaVitrine = (c: string, nomeView = "vitrine_lojas") => {
  const n = normaliza(c);
  return (
    n.includes(`revoke insert, update, delete on public.${nomeView}`) ||
    n.includes(`revoke all on public.${nomeView}`)
  );
};

/** Arquivos que criam a view SEM revoke de escrita no próprio arquivo ou em posterior. */
function violacoesRevokeVitrine(arquivos: ArquivoMigration[], nomeView = "vitrine_lojas"): string[] {
  const ordenados = [...arquivos].sort((a, b) => a.nome.localeCompare(b.nome));
  return ordenados
    .filter(
      (a, i) =>
        criaVitrine(a.conteudo, nomeView) &&
        !ordenados
          .slice(i)
          .some((posterior) => revogaEscritaVitrine(posterior.conteudo, nomeView)),
    )
    .map((a) => a.nome);
}

/** Arquivos de migration que (re)criam a view — usado para travar o vácuo. */
function criadorasDeVitrine(arquivos: ArquivoMigration[], nomeView: string): string[] {
  return arquivos.filter((a) => criaVitrine(a.conteudo, nomeView)).map((a) => a.nome);
}

function migrationsReais(): ArquivoMigration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((nome) => ({ nome, conteudo: readFileSync(join(MIGRATIONS_DIR, nome), "utf8") }));
}

describe("112/265 guarda estática — create view de vitrine exige revoke de escrita", () => {
  // RED sintético (fixtures — nunca muta migrations reais): prova que o scanner
  // DETECTA a omissão antes de confiarmos no verde do estado real do repo.
  it("[G1] scanner detecta drop+create SEM revoke posterior (fixture sintética)", () => {
    const fixture: ArquivoMigration[] = [
      {
        nome: "20990101000000_recria_view.sql",
        conteudo: `drop view if exists public.vitrine_lojas;
                   create view public.vitrine_lojas as select 1;
                   grant select on public.vitrine_lojas to anon, authenticated;`,
      },
      { nome: "20990102000000_outra_coisa.sql", conteudo: "select 1;" },
    ];
    expect(violacoesRevokeVitrine(fixture)).toEqual(["20990101000000_recria_view.sql"]);
  });

  it("[G2] scanner aceita revoke no MESMO arquivo ou em POSTERIOR (fixture sintética)", () => {
    const mesmaArquivo: ArquivoMigration[] = [
      {
        nome: "20990101000000_recria_view.sql",
        conteudo: `create view public.vitrine_lojas as select 1;
                   revoke insert, update, delete on public.vitrine_lojas from anon, authenticated;`,
      },
    ];
    expect(violacoesRevokeVitrine(mesmaArquivo)).toEqual([]);

    const arquivoPosterior: ArquivoMigration[] = [
      {
        nome: "20990101000000_recria_view.sql",
        conteudo: "create view public.vitrine_lojas as select 1;",
      },
      {
        nome: "20990102000000_revoke.sql",
        conteudo:
          "revoke insert, update, delete on public.vitrine_lojas from anon, authenticated;",
      },
    ];
    expect(violacoesRevokeVitrine(arquivoPosterior)).toEqual([]);

    // 265: `revoke all` é a forma que a migration A usa (mais forte que
    // insert/update/delete — cobre TRUNCATE/TRIGGER/REFERENCES). O scanner tem
    // de aceitá-la, ou a migration correta seria reportada como violação.
    const revokeAll: ArquivoMigration[] = [
      {
        nome: "20990101000000_cria_view.sql",
        conteudo: `create view public.vitrine_produtos as select 1;
                   revoke all on public.vitrine_produtos from anon, authenticated;
                   grant select on public.vitrine_produtos to anon, authenticated;`,
      },
    ];
    expect(violacoesRevokeVitrine(revokeAll, "vitrine_produtos")).toEqual([]);

    // ...e tem de FLAGRAR a criação sem revoke nenhum para a view nova.
    const semRevoke: ArquivoMigration[] = [
      {
        nome: "20990101000000_cria_view.sql",
        conteudo: `create view public.vitrine_produtos as select 1;
                   grant select on public.vitrine_produtos to anon, authenticated;`,
      },
    ];
    expect(violacoesRevokeVitrine(semRevoke, "vitrine_produtos")).toEqual([
      "20990101000000_cria_view.sql",
    ]);
  });

  it("[G3] estado real do repo: toda (re)criação de vitrine_lojas tem revoke posterior", () => {
    // RED hoje: 001500/005000/006000/013000 criam a view e NENHUMA migration
    // contém o revoke — a fase GREEN (20260702140000) zera esta lista.
    expect(violacoesRevokeVitrine(migrationsReais())).toEqual([]);
  });

  // ── 265 (fase RED) ────────────────────────────────────────────────────────
  // `vitrine_produtos` (migration A da 265) é a SEGUNDA view definer pública do
  // projeto e cai sob a mesma regra de seguranca.md §19. Duas asserções, porque
  // "nenhuma violação" sozinha ficaria VERDE POR VÁCUO enquanto a view não
  // existe: primeiro exigimos que ALGUMA migration a crie, depois que toda
  // criação tenha revoke de escrita no próprio arquivo ou em posterior.
  it("[G4] vitrine_produtos: existe migration que a cria E toda criação tem revoke (265)", () => {
    const reais = migrationsReais();
    expect(criadorasDeVitrine(reais, "vitrine_produtos")).not.toEqual([]);
    expect(violacoesRevokeVitrine(reais, "vitrine_produtos")).toEqual([]);
  });

  // ── 245 (fase RED) ────────────────────────────────────────────────────────
  // A 132000 recria `vitrine_produtos` com `create OR REPLACE view` (D1: preserva
  // grants e OID, e recusa mudar as 14 colunas existentes). O scanner de hoje só
  // casa `create view`, então essa recriação é INVISÍVEL para a guarda estática —
  // exatamente a forma que a issue 245 vai usar. Fixture sintética: nunca muta
  // migration real.
  //
  // NOTA para o `executar`: a regex passa a ser
  // `create (or replace )?view public.<view>`. Conferido que isso NÃO quebra o
  // [G3]: as recriações de `vitrine_lojas` posteriores ao revoke da 20260702140000
  // (20260704120000 e 20260920122000) trazem `revoke` no próprio arquivo, e a
  // 20260920124500 ainda emite `revoke all on public.vitrine_lojas`.
  it("[G5] scanner reconhece `create or replace view` (fixture sintética) — 245", () => {
    const semRevoke: ArquivoMigration[] = [
      {
        nome: "20990101000000_or_replace_sem_revoke.sql",
        conteudo: `create or replace view public.vitrine_produtos
                     with (security_invoker = false, security_barrier = true)
                   as select 1;`,
      },
    ];
    expect(violacoesRevokeVitrine(semRevoke, "vitrine_produtos")).toEqual([
      "20990101000000_or_replace_sem_revoke.sql",
    ]);

    const comRevoke: ArquivoMigration[] = [
      {
        nome: "20990101000000_or_replace_com_revoke.sql",
        conteudo: `create or replace view public.vitrine_produtos as select 1;
                   revoke all on public.vitrine_produtos from anon, authenticated;
                   grant select on public.vitrine_produtos to anon, authenticated;`,
      },
    ];
    expect(violacoesRevokeVitrine(comRevoke, "vitrine_produtos")).toEqual([]);

    // E `criadorasDeVitrine` tem de CONTAR a recriação por `or replace`, senão
    // o [G4] ficaria verde por vácuo caso a 124000 um dia vire `or replace`.
    expect(criadorasDeVitrine(comRevoke, "vitrine_produtos")).toEqual([
      "20990101000000_or_replace_com_revoke.sql",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fase RED (TDD) — issue 114 (hardening pós-112). Asserts de CATÁLOGO
// (has_table_privilege / has_function_privilege), não de comportamento:
// TRUNCATE/TRIGGER numa view falham com "is not a table" independente de ACL —
// só o catálogo distingue "negado por revoke" de "impossível por natureza".
//
// Contrato da migration `20260702150000_revoke_grants_residuais.sql`
// (ainda NÃO escrita — fase GREEN do `executar`):
//
//  [T1] vitrine_lojas: revoke all + grant select → anon/authenticated com
//       exatamente SELECT. RED hoje: TRUNCATE/TRIGGER/REFERENCES ainda true
//       (herdados do GRANT ALL da 20260614008500, renascidos via default
//       privileges no último drop+create da view; a 20260702140000 só revogou
//       insert/update/delete).
//  [T2] default privileges SELECT-only: tabela FUTURA criada por postgres não
//       re-granta resíduo a anon (sonda criada DEPOIS do GRANTS_SQL do harness,
//       então só pg_default_acl explica o que ela herdar). RED hoje: os defaults
//       da 008500 ainda carregam TRUNCATE/TRIGGER/REFERENCES.
//  [T3] DO-block guardado por to_regprocedure revoga EXECUTE de
//       rls_auto_enable() quando ela existe (emulada por stub — a real vive só
//       no cloud, fora do histórico de migrations) e o ARQUIVO é reaplicável
//       (2ª execução sem erro = idempotência provada). RED hoje: o arquivo não
//       existe → nada revoga → EXECUTE do stub segue true → falha por asserção.
// ─────────────────────────────────────────────────────────────────────────────

const MIGRATION_114 = join(MIGRATIONS_DIR, "20260702150000_revoke_grants_residuais.sql");
const ROLES_API = ["anon", "authenticated"] as const;
const PRIVS_PROIBIDOS = ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "TRIGGER", "REFERENCES"] as const;

describe("114 grants residuais (revoke all + defaults select-only)", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  /** Mede ACL no catálogo como postgres — has_* recebe o role como argumento. */
  async function privilegioTabela(role: string, relacao: string, priv: string): Promise<boolean> {
    const r = await t.db.query<{ ok: boolean }>(
      `select has_table_privilege($1, $2, $3) as ok`,
      [role, relacao, priv],
    );
    return r.rows[0].ok;
  }

  async function executaFuncao(role: string, assinatura: string): Promise<boolean> {
    const r = await t.db.query<{ ok: boolean }>(
      `select has_function_privilege($1, $2, 'execute') as ok`,
      [role, assinatura],
    );
    return r.rows[0].ok;
  }

  /** Snapshot legível no output de falha: privilégios proibidos ainda concedidos. */
  async function proibidosConcedidos(role: string, relacao: string): Promise<string[]> {
    const concedidos: string[] = [];
    for (const priv of PRIVS_PROIBIDOS) {
      if (await privilegioTabela(role, relacao, priv)) concedidos.push(priv);
    }
    return concedidos;
  }

  it("[T1] vitrine_lojas: anon/authenticated com exatamente SELECT no catálogo", async () => {
    for (const role of ROLES_API) {
      // leitura pública não regride
      expect({
        role,
        select: await privilegioTabela(role, "public.vitrine_lojas", "SELECT"),
      }).toEqual({ role, select: true });

      // nenhum privilégio além de SELECT — RED hoje: TRUNCATE/TRIGGER/REFERENCES
      expect({
        role,
        proibidos: await proibidosConcedidos(role, "public.vitrine_lojas"),
      }).toEqual({ role, proibidos: [] });
    }
  });

  it("[T2] sonda anti-re-grant: tabela futura criada por postgres herda SÓ SELECT para anon", async () => {
    await t.db.exec(`create table public._sonda_114_test (id int)`);
    try {
      expect({
        select: await privilegioTabela("anon", "public._sonda_114_test", "SELECT"),
      }).toEqual({ select: true });

      // prova que pg_default_acl foi zerado além de SELECT — RED hoje
      expect({
        proibidos: await proibidosConcedidos("anon", "public._sonda_114_test"),
      }).toEqual({ proibidos: [] });
    } finally {
      await t.db.exec(`drop table public._sonda_114_test`);
    }
  });

  it("[T3] rls_auto_enable(): migration aplicada 2x (idempotente) revoga EXECUTE quando a função existe", async () => {
    // STUB TDD — emula a função cloud-only (existe só no projeto remoto, fora do
    // histórico de migrations; o dump remote_schema veio vazio). Implementação
    // real do revoke é da fase GREEN. Função recém-criada nasce com EXECUTE
    // implícito de PUBLIC — o sanity abaixo garante que o assert final não é trivial.
    await t.db.exec(
      `create or replace function public.rls_auto_enable() returns event_trigger
       language plpgsql security definer as $$ begin end $$`,
    );
    expect(await executaFuncao("anon", "public.rls_auto_enable()")).toBe(true);

    // Aplica o ARQUIVO da migration DUAS vezes, cada uma em transação: prova
    // (1) idempotência dos 3 blocos e (2) que o DO-block guardado por
    // to_regprocedure revoga de verdade quando a função existe (emula o cloud).
    // RED hoje: o arquivo ainda não existe → nada é revogado.
    if (existsSync(MIGRATION_114)) {
      const sql = readFileSync(MIGRATION_114, "utf8");
      for (let aplicacao = 0; aplicacao < 2; aplicacao++) {
        await t.db.exec("begin");
        try {
          await t.db.exec(sql);
          await t.db.exec("commit");
        } catch (err) {
          await t.db.exec("rollback");
          throw err;
        }
      }
    }

    for (const role of ROLES_API) {
      expect({
        role,
        execute: await executaFuncao(role, "public.rls_auto_enable()"),
      }).toEqual({ role, execute: false });
    }
  });
});
