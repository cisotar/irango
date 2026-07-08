import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 128 — estende o trigger `lojas_protege_billing` para
 * cobrir TAMBÉM as flags de módulo pago criadas pela issue 127:
 *   modulo_impressao_a4, modulo_impressao_termica.
 * (spec 4-impressao-pedido.md → RN-M3, backstop de banco).
 *
 * PROBLEMA: a issue 127 (20260707120000_lojas_modulos_impressao) adicionou
 * modulo_impressao_a4/modulo_impressao_termica à tabela `lojas` (entitlement de
 * módulo PAGO, boolean), mas o trigger v2 (20260621094000) só protege
 * assinatura_x/hotmart_x/dono_id/billing_provider/provider_subscription_id/plano_id.
 * Como a RLS filtra LINHA e não COLUNA, a policy lojas_update_proprio concede ao
 * dono autenticado o UPDATE da linha inteira. Sem proteger as flags de módulo, o
 * lojista faria, via PostgREST direto:
 *   UPDATE lojas SET modulo_impressao_termica = true ...
 * e auto-habilitaria um módulo PAGO sem passar pelo billing — burla de cobrança.
 *
 * CORREÇÃO (fase GREEN, NÃO escrita aqui): a migration
 *   20260707121000_lojas_protege_billing_v3_modulos.sql
 * faz CREATE OR REPLACE FUNCTION public.lojas_protege_billing() ADICIONANDO
 * modulo_impressao_a4/modulo_impressao_termica à comparação IS DISTINCT FROM. O
 * bypass de service_role/postgres/supabase_admin e as 10 colunas já protegidas
 * permanecem idênticos. NÃO recria o trigger (aponta para a função por NOME).
 *
 * POR QUE ISTO É RED DE VERDADE (sem remoção temporária de migration, diferente
 * da 074): quando o `tdd` escreve este teste, a migration v3 AINDA NÃO EXISTE. O
 * harness pglite aplica TODAS as migrations do diretório em ordem → aplica até a
 * 127 (colunas modulo_impressao_* existem) mas o trigger continua na v2, que NÃO
 * as compara → o dono autenticado CONSEGUE o UPDATE (bloqueou=false, 1 linha) →
 * os testes que exigem BLOQUEIO ([128-1], [128-2], [128-3]) ficam VERMELHOS. Ao
 * `execute` adicionar a migration v3, o harness a aplica → vira VERDE.
 *
 * ANTI-FALSO-VERDE (herdado de trigger_protege_billing_v2.test.ts): toda
 * expectativa de bloqueio é reconferida via asService (BYPASSRLS, fonte de
 * verdade) de que o valor NÃO mudou; toda expectativa de permissão é reconferida
 * de que o valor REALMENTE mudou. Nunca se aceita "0 linhas / sem efeito" sem
 * reconferir a fonte de verdade.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const SLUG_A = "loja-a-billing-v3";

async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a@teste.local'),
       ($2, 'dono-b@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B],
  );
}

type Cenario = { lojaA: string; planoCaro: string };

/** Cria loja A (dono A) + um plano "caro" via service (bypass RLS). */
async function criarCenario(t: TestDb): Promise<Cenario> {
  await garantirDonos(t);
  return t.asService(async (db) => {
    const planoCaro = (
      await db.query<{ id: string }>(
        `insert into public.planos (nome, preco, intervalo, ativo)
           values ('Plano Caro', 199.00, 'mensal', true) returning id`,
      )
    ).rows[0].id;

    const lojaA = (
      await db.query<{ id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,$2,'Loja A',true) returning id`,
        [DONO_A, SLUG_A],
      )
    ).rows[0].id;

    return { lojaA, planoCaro };
  });
}

/** Lê uma coluna da loja via service (BYPASSRLS) — fonte de verdade. */
async function colAtual<T = unknown>(t: TestDb, lojaId: string, col: string): Promise<T | null> {
  const r = await t.asService((db) =>
    db.query<Record<string, T>>(`select ${col} as v from public.lojas where id = $1`, [lojaId]),
  );
  return (r.rows[0]?.["v" as keyof typeof r.rows[number]] as T) ?? null;
}

/**
 * Tenta um UPDATE como dono A. BLOQUEADO = trigger lançou (raise exception) OU
 * 0 linhas afetadas. No estado RED (trigger v2 sem as flags de módulo), nada
 * lança e 1 linha é afetada → bloqueou=false.
 */
async function tentarUpdateComoDono(
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

describe("128 trigger v3 protege flags de módulo pago (modulo_impressao_a4, modulo_impressao_termica)", () => {
  let t: TestDb;
  let ids: Cenario;

  beforeEach(async () => {
    t = await createTestDb();
    ids = await criarCenario(t);
  });
  afterEach(async () => {
    await t.close();
  });

  // ───────── Bloqueio das flags de módulo (dono autenticado) — o RED central
  it("[128-1] dono NÃO pode ligar modulo_impressao_a4=true (bloqueado, flag intacta false)", async () => {
    expect(await colAtual<boolean>(t, ids.lojaA, "modulo_impressao_a4")).toBe(false);

    const res = await tentarUpdateComoDono(
      t,
      DONO_A,
      `update public.lojas set modulo_impressao_a4 = true where id = $1`,
      [ids.lojaA],
    );
    expect(res.bloqueou).toBe(true);
    expect(await colAtual<boolean>(t, ids.lojaA, "modulo_impressao_a4")).toBe(false);
  });

  it("[128-2] dono NÃO pode ligar modulo_impressao_termica=true (bloqueado, flag intacta false)", async () => {
    expect(await colAtual<boolean>(t, ids.lojaA, "modulo_impressao_termica")).toBe(false);

    const res = await tentarUpdateComoDono(
      t,
      DONO_A,
      `update public.lojas set modulo_impressao_termica = true where id = $1`,
      [ids.lojaA],
    );
    expect(res.bloqueou).toBe(true);
    expect(await colAtual<boolean>(t, ids.lojaA, "modulo_impressao_termica")).toBe(false);
  });

  it("[128-3] dono NÃO escapa misturando coluna legítima + flag de módulo no MESMO update", async () => {
    // Vetor de evasão: esconder a ativação do módulo pago junto de uma coluna
    // permitida (nome). O trigger bloqueia a transação inteira; nome NÃO muda e
    // a flag continua false.
    const res = await tentarUpdateComoDono(
      t,
      DONO_A,
      `update public.lojas set nome = 'Loja Hack', modulo_impressao_termica = true where id = $1`,
      [ids.lojaA],
    );
    expect(res.bloqueou).toBe(true);
    expect(await colAtual<boolean>(t, ids.lojaA, "modulo_impressao_termica")).toBe(false);
    expect(await colAtual<string>(t, ids.lojaA, "nome")).toBe("Loja A");
  });

  // ───────── Regressão: colunas já protegidas pela v1/v2 continuam bloqueadas
  it("[128-4] dono ainda NÃO pode auto-promover assinatura_status='ativa' (regressão v1/v2)", async () => {
    const res = await tentarUpdateComoDono(
      t,
      DONO_A,
      `update public.lojas set assinatura_status = 'ativa' where id = $1`,
      [ids.lojaA],
    );
    expect(res.bloqueou).toBe(true);
    expect(await colAtual<string>(t, ids.lojaA, "assinatura_status")).toBe("trial");
  });

  it("[128-5] dono ainda NÃO pode auto-vincular plano_id (regressão v2)", async () => {
    expect(await colAtual<string>(t, ids.lojaA, "plano_id")).toBeNull();

    const res = await tentarUpdateComoDono(
      t,
      DONO_A,
      `update public.lojas set plano_id = $1 where id = $2`,
      [ids.planoCaro, ids.lojaA],
    );
    expect(res.bloqueou).toBe(true);
    expect(await colAtual<string>(t, ids.lojaA, "plano_id")).toBeNull();
  });

  // ───────── Colunas legítimas continuam permitidas (não over-block)
  it("[128-6] dono PODE atualizar nome (coluna comum — 1 linha, persistiu)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`update public.lojas set nome = 'Loja A Renomeada' where id = $1`, [ids.lojaA]),
    );
    expect(r.affectedRows).toBe(1);
    expect(await colAtual<string>(t, ids.lojaA, "nome")).toBe("Loja A Renomeada");
  });

  // ───────── service_role (webhook/admin de billing) CONTINUA ligando os módulos
  it("[128-7] service_role PODE ligar modulo_impressao_a4=true (bypass — persistiu)", async () => {
    const r = await t.asService((db) =>
      db.query(`update public.lojas set modulo_impressao_a4 = true where id = $1`, [ids.lojaA]),
    );
    expect(r.affectedRows).toBe(1);
    expect(await colAtual<boolean>(t, ids.lojaA, "modulo_impressao_a4")).toBe(true);
  });

  it("[128-8] service_role PODE ligar as DUAS flags de módulo no mesmo update (bypass intacto)", async () => {
    const r = await t.asService((db) =>
      db.query(
        `update public.lojas set
            modulo_impressao_a4 = true,
            modulo_impressao_termica = true
          where id = $1`,
        [ids.lojaA],
      ),
    );
    expect(r.affectedRows).toBe(1);
    expect(await colAtual<boolean>(t, ids.lojaA, "modulo_impressao_a4")).toBe(true);
    expect(await colAtual<boolean>(t, ids.lojaA, "modulo_impressao_termica")).toBe(true);
  });

  // ───────── INSERT também protegido (fix auditoria 128) ─────────
  // O trigger v1/v2 era só BEFORE UPDATE. A policy lojas_insert_proprio concede
  // INSERT ao dono autenticado; um usuário recém-cadastrado (ainda sem loja) podia
  // POST /rest/v1/lojas com modulo_impressao_*/assinatura_status já setados —
  // nascendo com módulo pago/assinatura ativa de graça — porque o trigger não
  // cobria INSERT. DONO_B está em auth.users mas NÃO tem loja (criarCenario só cria
  // a de DONO_A) → é o "dono sem loja" que exercita o vetor de criação.
  async function contarLojasDono(userId: string): Promise<number> {
    const r = await t.asService((db) =>
      db.query<{ c: number }>(`select count(*)::int as c from public.lojas where dono_id = $1`, [userId]),
    );
    return r.rows[0].c;
  }

  it("[128-9] dono SEM loja NÃO cria loja com modulo_impressao_*=true no INSERT (bloqueado, nada persiste)", async () => {
    expect(await contarLojasDono(DONO_B)).toBe(0);
    const res = await tentarUpdateComoDono(
      t,
      DONO_B,
      `insert into public.lojas (dono_id, slug, nome, modulo_impressao_a4, modulo_impressao_termica)
         values ($1, 'loja-b-hack', 'B', true, true)`,
      [DONO_B],
    );
    expect(res.bloqueou).toBe(true);
    expect(await contarLojasDono(DONO_B)).toBe(0);
  });

  it("[128-10] dono SEM loja NÃO cria loja com assinatura_status='ativa' no INSERT (backstop cobre billing na criação)", async () => {
    const res = await tentarUpdateComoDono(
      t,
      DONO_B,
      `insert into public.lojas (dono_id, slug, nome, assinatura_status)
         values ($1, 'loja-b-status', 'B', 'ativa')`,
      [DONO_B],
    );
    expect(res.bloqueou).toBe(true);
    expect(await contarLojasDono(DONO_B)).toBe(0);
  });

  it("[128-11] dono SEM loja PODE criar loja com DEFAULTS seguros (não over-block a criação legítima)", async () => {
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`insert into public.lojas (dono_id, slug, nome) values ($1, 'loja-b-ok', 'B')`, [DONO_B]),
    );
    expect(r.affectedRows).toBe(1);
    expect(await contarLojasDono(DONO_B)).toBe(1);
  });

  it("[128-12] service_role PODE criar loja já com módulo ligado no INSERT (bypass — billing legítimo na criação)", async () => {
    const r = await t.asService((db) =>
      db.query(
        `insert into public.lojas (dono_id, slug, nome, modulo_impressao_termica)
           values ($1, 'loja-b-svc', 'B', true)`,
        [DONO_B],
      ),
    );
    expect(r.affectedRows).toBe(1);
    expect(await contarLojasDono(DONO_B)).toBe(1);
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 128:
 *
 * Migration `supabase/migrations/20260707121000_lojas_protege_billing_v3_modulos.sql`
 * (timestamp > 20260707120000), puramente aditiva:
 *
 *   create or replace function public.lojas_protege_billing()  -- só REPLACE
 *   ... mantém bypass service_role/postgres/supabase_admin ...
 *   ... mantém as 10 colunas já protegidas (assinatura_x/hotmart_x/dono_id/
 *       billing_provider/provider_subscription_id/plano_id) ...
 *   ... ADICIONA à comparação IS DISTINCT FROM:
 *         new.modulo_impressao_a4       is distinct from old.modulo_impressao_a4
 *      or new.modulo_impressao_termica  is distinct from old.modulo_impressao_termica
 *
 *   NÃO recriar o trigger lojas_protege_billing_trg (já aponta para a função por
 *   nome — CREATE OR REPLACE FUNCTION basta). Mensagem, bypass, forma (sem
 *   SECURITY DEFINER / sem set search_path) idênticos à v2 (espelhar).
 *
 * COLUNAS PROTEGIDAS ACRESCENTADAS (bloquear se autor ≠ service_role):
 *   modulo_impressao_a4, modulo_impressao_termica.
 *
 * Casos que precisam passar após a migration: [128-1]..[128-8].
 * (No estado RED atual, [128-1]/[128-2]/[128-3] falham — o dono liga a flag
 *  porque o trigger ainda é v2. [128-4]..[128-8] já passam.)
 */
