import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 004 — RLS de `lojas`.
 *
 * Estado ATUAL: a tabela `public.lojas` já tem RLS habilitada pela 001
 * (`alter table ... enable row level security`) e ZERO policies → deny-all.
 * A migration de policies (`<timestamp>_rls_lojas.sql`) AINDA NÃO EXISTE.
 *
 * Consequência (o RED esperado): com deny-all, anon/authenticated não leem
 * NEM escrevem NADA de `lojas`. Logo:
 *  - anon NÃO lê loja ativa (deveria ler)           → FALHA agora
 *  - dono NÃO lê a própria loja (ativa ou inativa)  → FALHA agora
 *  - dono NÃO atualiza/insere a própria loja        → FALHA agora
 *  - os testes de NEGAÇÃO (B não mexe em A, anon não escreve, WITH CHECK)
 *    passam até por excesso de deny-all — não são o que prova o RED, mas
 *    ficam registrados para a fase GREEN não regredir.
 *
 * Quem deixa verde é a fase GREEN (`executar`), escrevendo a migration com as
 * 5 policies de seguranca.md §2 (+ WITH CHECK no update_proprio, ver plano).
 * Nenhum código de produção é escrito aqui.
 *
 * Padrão anti-falso-verde (herdado de schema_inicial.test.ts):
 *  - escrita "permitida" é confirmada por LINHAS AFETADAS + reconferência via
 *    asService (BYPASSRLS) de que o dado REALMENTE mudou/persistiu.
 *  - negação NUNCA é aceita por "relation does not exist": a tabela existe.
 *    Negação = 0 linhas afetadas / 0 linhas visíveis / rejeição de WITH CHECK,
 *    sempre reconferido via asService.
 */

// IDs fixos para asserts determinísticos.
const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const SLUG_A = "loja-a-ativa";
const SLUG_A2 = "loja-a-inativa";
const SLUG_B = "loja-b-ativa";

type Lojas = { lojaA: string; lojaA2: string; lojaB: string };

/** Cria os dois donos em auth.users via superuser (service_role não tem grant em auth). */
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
 * Cria o cenário base via asService (bypass RLS): A ativa, A2 inativa (mesmo dono A),
 * B ativa (dono B). Retorna os ids.
 */
async function criarCenario(t: TestDb): Promise<Lojas> {
  await garantirDonos(t);
  return t.asService(async (db) => {
    const a = await db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo)
       values ($1, $2, 'Loja A', true) returning id`,
      [DONO_A, SLUG_A],
    );
    const a2 = await db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo)
       values ($1, $2, 'Loja A2', false) returning id`,
      [DONO_A, SLUG_A2],
    );
    const b = await db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo)
       values ($1, $2, 'Loja B', true) returning id`,
      [DONO_B, SLUG_B],
    );
    return { lojaA: a.rows[0].id, lojaA2: a2.rows[0].id, lojaB: b.rows[0].id };
  });
}

/** Reconfere via service (BYPASSRLS) o nome atual de uma loja — fonte de verdade. */
async function nomeAtual(t: TestDb, lojaId: string): Promise<string | null> {
  const r = await t.asService((db) =>
    db.query<{ nome: string }>(`select nome from public.lojas where id = $1`, [lojaId]),
  );
  return r.rows[0]?.nome ?? null;
}

/** Reconfere via service o dono atual de uma loja. */
async function donoAtual(t: TestDb, lojaId: string): Promise<string | null> {
  const r = await t.asService((db) =>
    db.query<{ dono_id: string }>(`select dono_id from public.lojas where id = $1`, [lojaId]),
  );
  return r.rows[0]?.dono_id ?? null;
}

/** Reconfere via service se uma loja com dado slug existe. */
async function existeSlug(t: TestDb, slug: string): Promise<boolean> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.lojas where slug = $1`, [slug]),
  );
  return r.rows.length > 0;
}

describe("004 RLS de lojas + vitrine_lojas (correção auditoria)", () => {
  let t: TestDb;
  let ids: Lojas;

  beforeAll(async () => {
    t = await createTestDb();
    ids = await criarCenario(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ───────────────────────────── Leitura pública (view vitrine_lojas)
  it("[1] anon LÊ loja ativa pelo slug via vitrine_lojas (1 linha)", async () => {
    // Correção de auditoria: o SELECT público saiu da tabela base. anon lê a
    // vitrine pela view de projeção pública.
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(`select id from public.vitrine_lojas where slug = $1`, [SLUG_A]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.lojaA);
  });

  it("[1b] vitrine_lojas NÃO expõe colunas sensíveis ao anon", async () => {
    // A view projeta só colunas públicas: dono_id/hotmart_subscriber_code/
    // assinatura_status NÃO podem sequer existir no resultado.
    const r = await t.asAnon((db) =>
      db.query<Record<string, unknown>>(`select * from public.vitrine_lojas where slug = $1`, [
        SLUG_A,
      ]),
    );
    expect(r.rows.length).toBe(1);
    const chaves = Object.keys(r.rows[0]);
    expect(chaves).not.toContain("dono_id");
    expect(chaves).not.toContain("hotmart_subscriber_code");
    expect(chaves).not.toContain("hotmart_plano");
    expect(chaves).not.toContain("assinatura_status");
    expect(chaves).not.toContain("assinatura_inicio");
    expect(chaves).not.toContain("assinatura_fim_periodo");
    expect(chaves).not.toContain("assinatura_atualizada_em");
    expect(chaves).not.toContain("consentimento_em");
    expect(chaves).not.toContain("consentimento_versao");
    // E confirma que as colunas públicas esperadas ESTÃO presentes.
    expect(chaves).toContain("id");
    expect(chaves).toContain("slug");
    expect(chaves).toContain("nome");
  });

  it("[1c] anon NÃO lê linhas de loja ATIVA direto da tabela base (0 linhas)", async () => {
    // Sem `lojas_leitura_publica` na base, o SELECT público foi removido.
    const r = await t.asAnon((db) => db.query(`select id from public.lojas where ativo = true`));
    expect(r.rows.length).toBe(0);
    // Anti-falso-verde: a loja ativa REALMENTE existe (negação é por policy).
    expect(await existeSlug(t, SLUG_A)).toBe(true);
  });

  it("[1d] anon NÃO lê coluna sensível da tabela base (0 linhas / negado)", async () => {
    // hotmart_subscriber_code nunca pode vazar pela base.
    let rejeitou = false;
    let linhas = -1;
    try {
      const r = await t.asAnon((db) =>
        db.query(`select hotmart_subscriber_code from public.lojas where slug = $1`, [SLUG_A]),
      );
      linhas = r.rows.length;
    } catch {
      rejeitou = true;
    }
    expect(rejeitou || linhas === 0).toBe(true);
  });

  it("[2] anon NÃO lê loja inativa via vitrine_lojas (0 linhas)", async () => {
    // A view filtra ativo=true; loja inativa não aparece (só o dono vê na base).
    const r = await t.asAnon((db) =>
      db.query(`select id from public.vitrine_lojas where slug = $1`, [SLUG_A2]),
    );
    expect(r.rows.length).toBe(0);
    // Confirma que a linha EXISTE (negação é por filtro, não por ausência de dado).
    expect(await existeSlug(t, SLUG_A2)).toBe(true);
  });

  // ───────────────────────────── Leitura própria (lojas_leitura_propria)
  it("[3] dono A lê a PRÓPRIA loja mesmo INATIVA (1 linha)", async () => {
    // RED: deny-all → 0. GREEN: lojas_leitura_propria (auth.uid()=dono_id) → 1.
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(`select id from public.lojas where id = $1`, [ids.lojaA2]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.lojaA2);
  });

  it("[4] dono A lê a própria loja ATIVA (1 linha)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(`select id from public.lojas where id = $1`, [ids.lojaA]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.lojaA);
  });

  it("[5] dono B NÃO vê a loja A2 INATIVA de A (isolamento — 0 linhas)", async () => {
    // B só enxergaria A2 se houvesse vazamento entre lojas. A2 é inativa: nem público.
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`select id from public.lojas where id = $1`, [ids.lojaA2]),
    );
    expect(r.rows.length).toBe(0);
  });

  // ───────────────────────────── Update próprio (lojas_update_proprio)
  it("[6] dono A ATUALIZA a própria loja (1 linha afetada + persistiu)", async () => {
    // RED: deny-all → 0 linhas afetadas, nome não muda. GREEN: 1 linha, nome muda.
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`update public.lojas set nome = 'Loja A Renomeada' where id = $1`, [ids.lojaA]),
    );
    expect(r.affectedRows).toBe(1);
    expect(await nomeAtual(t, ids.lojaA)).toBe("Loja A Renomeada");
  });

  it("[7] dono B NÃO atualiza loja de A (0 linhas afetadas, nome intacto)", async () => {
    const antes = await nomeAtual(t, ids.lojaA);
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`update public.lojas set nome = 'HACK' where id = $1`, [ids.lojaA]),
    );
    expect(r.affectedRows).toBe(0);
    expect(await nomeAtual(t, ids.lojaA)).toBe(antes);
    expect(await nomeAtual(t, ids.lojaA)).not.toBe("HACK");
  });

  it("[8] anon NÃO atualiza loja ativa (0 linhas, nome intacto)", async () => {
    // Sem SELECT público na base nem policy de UPDATE pública: anon não escreve.
    const antes = await nomeAtual(t, ids.lojaA);
    const r = await t.asAnon((db) =>
      db.query(`update public.lojas set nome = 'ANON-HACK' where id = $1`, [ids.lojaA]),
    );
    expect(r.affectedRows).toBe(0);
    expect(await nomeAtual(t, ids.lojaA)).toBe(antes);
  });

  it("[9] UPDATE NÃO transfere a loja: trocar dono_id é rejeitado (WITH CHECK)", async () => {
    // dono A tenta set dono_id = B na própria loja. USING passa (linha é de A),
    // mas o WITH CHECK adicional (linha resultante deve ter dono_id = auth.uid())
    // deve recusar. RED: deny-all já recusa (motivo errado). GREEN: WITH CHECK recusa.
    let rejeitou = false;
    let affected = -1;
    try {
      const r = await t.asUser(DONO_A, (db) =>
        db.query(`update public.lojas set dono_id = $1 where id = $2`, [DONO_B, ids.lojaA]),
      );
      affected = r.affectedRows ?? 0;
    } catch {
      rejeitou = true;
    }
    // Ou lançou (WITH CHECK violation) ou afetou 0 linhas. Nunca 1.
    expect(rejeitou || affected === 0).toBe(true);
    // Fonte de verdade: a loja A continua sendo de A.
    expect(await donoAtual(t, ids.lojaA)).toBe(DONO_A);
  });

  // ───────────────────────────── Delete próprio (lojas_delete_proprio)
  it("[10] dono B NÃO deleta loja de A (0 linhas, loja A ainda existe)", async () => {
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`delete from public.lojas where id = $1`, [ids.lojaA]),
    );
    expect(r.affectedRows).toBe(0);
    expect(await existeSlug(t, SLUG_A)).toBe(true);
  });

  // ───────────────────────────── Insert próprio (lojas_insert_proprio)
  it("[11] dono A INSERE loja com dono_id = auth.uid() (aceito, persistiu)", async () => {
    // RED: deny-all → INSERT recusado, nada persiste. GREEN: WITH CHECK passa, 1 linha.
    const slug = "loja-a-nova";
    let inseriu = false;
    try {
      await t.asUser(DONO_A, (db) =>
        db.query(`insert into public.lojas (dono_id, slug, nome) values ($1, $2, 'A Nova')`, [
          DONO_A,
          slug,
        ]),
      );
      inseriu = true;
    } catch {
      inseriu = false;
    }
    expect(inseriu).toBe(true);
    expect(await existeSlug(t, slug)).toBe(true);
  });

  it("[12] dono B NÃO insere loja forjando dono_id = A (WITH CHECK, nada persiste)", async () => {
    const slug = "loja-forjada";
    let rejeitou = false;
    try {
      await t.asUser(DONO_B, (db) =>
        db.query(`insert into public.lojas (dono_id, slug, nome) values ($1, $2, 'Forjada')`, [
          DONO_A, // forja dono de outro usuário
          slug,
        ]),
      );
    } catch {
      rejeitou = true;
    }
    // Rejeição esperada por WITH CHECK; e NADA pode ter persistido.
    expect(rejeitou).toBe(true);
    expect(await existeSlug(t, slug)).toBe(false);
  });

  it("[13] anon NÃO insere loja (nada persiste)", async () => {
    const slug = "loja-anon";
    let rejeitou = false;
    try {
      await t.asAnon((db) =>
        db.query(`insert into public.lojas (dono_id, slug, nome) values ($1, $2, 'Anon')`, [
          DONO_A,
          slug,
        ]),
      );
    } catch {
      rejeitou = true;
    }
    expect(rejeitou).toBe(true);
    expect(await existeSlug(t, slug)).toBe(false);
  });

  // ───────────────────────────── Limite documentado da RLS (gate é Server Action)
  it("[14] DOCUMENTA O LIMITE: a RLS PERMITE o dono escrever assinatura_status", async () => {
    // INTENCIONAL — NÃO é bug. A RLS do Postgres filtra LINHA, não COLUNA.
    // lojas_update_proprio concede UPDATE da linha ao dono; nada na RLS impede
    // o dono de tocar assinatura_status/hotmart_*/consentimento_* via UPDATE direto.
    //
    // A proteção dessas colunas é garantida FORA da RLS, na Server Action de perfil
    // (issue 030/015), que escreve apenas uma ALLOWLIST de colunas — sem assinatura_*,
    // hotmart_*, consentimento_*. Este teste documenta o limite da RLS, não um bug.
    //
    // RED: deny-all ainda recusa (0 linhas). GREEN: lojas_update_proprio PERMITE (1 linha).
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`update public.lojas set assinatura_status = 'ativa' where id = $1`, [ids.lojaA]),
    );
    expect(r.affectedRows).toBe(1);
    const conf = await t.asService((db) =>
      db.query<{ assinatura_status: string }>(
        `select assinatura_status from public.lojas where id = $1`,
        [ids.lojaA],
      ),
    );
    expect(conf.rows[0].assinatura_status).toBe("ativa");
  });

  // ───────────────────────────── Sanity do BYPASSRLS
  it("[15] service_role lê loja inativa e atualiza qualquer loja (bypass RLS)", async () => {
    const lido = await t.asService((db) =>
      db.query<{ id: string }>(`select id from public.lojas where id = $1`, [ids.lojaA2]),
    );
    expect(lido.rows.length).toBe(1);

    const upd = await t.asService((db) =>
      db.query(`update public.lojas set nome = 'Via Service' where id = $1`, [ids.lojaB]),
    );
    expect(upd.affectedRows).toBe(1);
    expect(await nomeAtual(t, ids.lojaB)).toBe("Via Service");
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 004:
 *
 * Criar `supabase/migrations/<timestamp>_rls_lojas.sql` (timestamp > 20260614000129),
 * puramente aditivo (RLS já habilitada na 001), com 5 policies de seguranca.md §2:
 *
 *   lojas_leitura_publica  SELECT USING (ativo = true)
 *   lojas_leitura_propria  SELECT USING (auth.uid() = dono_id)
 *   lojas_insert_proprio   INSERT WITH CHECK (auth.uid() = dono_id)
 *   lojas_update_proprio   UPDATE USING (auth.uid() = dono_id)
 *                                 WITH CHECK (auth.uid() = dono_id)  ← divergência intencional
 *                                 vs. seguranca.md (que só tem USING); impede transferir
 *                                 a loja trocando dono_id no UPDATE (teste [9]).
 *   lojas_delete_proprio   DELETE USING (auth.uid() = dono_id)
 *
 * Casos que precisam passar após a migration: [1]..[15].
 * O teste [14] DEVE permanecer verde com a RLS PERMITINDO escrever assinatura_status —
 * documenta o limite (gate de colunas é Server Action, issue 030), não é regressão.
 */
