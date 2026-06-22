import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 074 — estende o trigger `lojas_protege_billing` para
 * cobrir TAMBÉM as colunas novas de billing criadas pela issue 073:
 *   billing_provider, provider_subscription_id, plano_id.
 * (spec cobranca-assinatura-propria.md → §9, RN-2, RN-12).
 *
 * PROBLEMA: a issue 073 adicionou billing_provider/provider_subscription_id/
 * plano_id à tabela `lojas`, mas o trigger original (20260614004500) só protegia
 * assinatura_x/hotmart_x/dono_id. Como a RLS filtra LINHA e não COLUNA, a policy
 * lojas_update_proprio concede ao dono autenticado o UPDATE da linha inteira.
 * Sem proteger as colunas novas, o lojista faria, via PostgREST direto:
 *   UPDATE lojas SET plano_id = <plano caro> / billing_provider = NULL ...
 * e auto-promoveria/trocaria de plano sem passar pelo webhook — vazamento de
 * autorização e burla de cobrança.
 *
 * CORREÇÃO (fase GREEN, NÃO escrita aqui): a migration
 *   20260621094000_lojas_protege_billing_v2.sql
 * faz CREATE OR REPLACE FUNCTION public.lojas_protege_billing() ADICIONANDO
 * billing_provider/provider_subscription_id/plano_id à comparação IS DISTINCT
 * FROM. O bypass de service_role/postgres/supabase_admin permanece.
 *
 * POR QUE ISTO É RED DE VERDADE: sem a migration v2, o trigger original NÃO
 * compara as três colunas novas → o dono autenticado CONSEGUE escrevê-las →
 * estes testes, que exigem BLOQUEIO, ficariam VERMELHOS.
 *
 * NOTA SOBRE O HARNESS (mesma evidência aceita em 070/071/072/073): o helper
 * pglite aplica TODAS as migrations do diretório em ordem. Como a migration 074
 * JÁ existe neste branch, o pglite a carrega e a suíte fica VERDE imediatamente.
 * O RED é provado removendo temporariamente a migration v2 do diretório (ver
 * bloco de evidência no relatório). Estes testes são o contrato que prova a
 * migration correta.
 *
 * ANTI-FALSO-VERDE (herdado de lojas_protege_billing.test.ts): toda expectativa
 * de bloqueio é reconferida via asService (BYPASSRLS, fonte de verdade) de que o
 * valor NÃO mudou; toda expectativa de permissão é reconferida de que o valor
 * REALMENTE mudou. Nunca se aceita "0 linhas / sem efeito" sem reconferir a
 * fonte de verdade.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const SLUG_A = "loja-a-billing-v2";

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
 * 0 linhas afetadas. No estado RED (trigger sem as colunas novas), nada lança e
 * 1 linha é afetada → bloqueou=false.
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

describe("074 trigger v2 protege colunas NOVAS de billing (billing_provider, provider_subscription_id, plano_id)", () => {
  let t: TestDb;
  let ids: Cenario;

  beforeEach(async () => {
    t = await createTestDb();
    ids = await criarCenario(t);
  });
  afterEach(async () => {
    await t.close();
  });

  // ───────── Bloqueio das colunas NOVAS de billing (dono autenticado) — o RED central
  it("[074-1] dono NÃO pode escrever billing_provider='hacker' (bloqueado, valor intacto NULL)", async () => {
    expect(await colAtual<string>(t, ids.lojaA, "billing_provider")).toBeNull();

    const res = await tentarUpdateComoDono(
      t,
      DONO_A,
      `update public.lojas set billing_provider = 'hacker' where id = $1`,
      [ids.lojaA],
    );
    expect(res.bloqueou).toBe(true);
    expect(await colAtual<string>(t, ids.lojaA, "billing_provider")).toBeNull();
  });

  it("[074-2] dono NÃO pode escrever provider_subscription_id='hacker' (bloqueado, valor intacto)", async () => {
    expect(await colAtual<string>(t, ids.lojaA, "provider_subscription_id")).toBeNull();

    const res = await tentarUpdateComoDono(
      t,
      DONO_A,
      `update public.lojas set provider_subscription_id = 'hacker' where id = $1`,
      [ids.lojaA],
    );
    expect(res.bloqueou).toBe(true);
    expect(await colAtual<string>(t, ids.lojaA, "provider_subscription_id")).toBeNull();
  });

  it("[074-3] dono NÃO pode auto-vincular plano_id (bloqueado, valor intacto NULL)", async () => {
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

  it("[074-4] dono NÃO escapa misturando coluna legítima + billing novo no MESMO update", async () => {
    // Vetor de evasão: esconder a mudança de billing junto de uma coluna
    // permitida. O trigger bloqueia a transação inteira; nome NÃO pode mudar.
    const res = await tentarUpdateComoDono(
      t,
      DONO_A,
      `update public.lojas set nome = 'Loja Hack', billing_provider = 'hacker' where id = $1`,
      [ids.lojaA],
    );
    expect(res.bloqueou).toBe(true);
    expect(await colAtual<string>(t, ids.lojaA, "billing_provider")).toBeNull();
    expect(await colAtual<string>(t, ids.lojaA, "nome")).toBe("Loja A");
  });

  // ───────── Regressão: colunas já protegidas pela v1 continuam bloqueadas
  it("[074-5] dono ainda NÃO pode auto-promover assinatura_status='ativa' (regressão v1)", async () => {
    const res = await tentarUpdateComoDono(
      t,
      DONO_A,
      `update public.lojas set assinatura_status = 'ativa' where id = $1`,
      [ids.lojaA],
    );
    expect(res.bloqueou).toBe(true);
    expect(await colAtual<string>(t, ids.lojaA, "assinatura_status")).toBe("trial");
  });

  // ───────── Colunas legítimas continuam permitidas (não over-block)
  it("[074-6] dono PODE atualizar nome (coluna comum — 1 linha, persistiu)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`update public.lojas set nome = 'Loja A Renomeada' where id = $1`, [ids.lojaA]),
    );
    expect(r.affectedRows).toBe(1);
    expect(await colAtual<string>(t, ids.lojaA, "nome")).toBe("Loja A Renomeada");
  });

  // ───────── service_role (webhook de billing) CONTINUA escrevendo billing novo
  it("[074-7] service_role PODE escrever billing_provider='asaas' (webhook precisa — persistiu)", async () => {
    const r = await t.asService((db) =>
      db.query(`update public.lojas set billing_provider = 'asaas' where id = $1`, [ids.lojaA]),
    );
    expect(r.affectedRows).toBe(1);
    expect(await colAtual<string>(t, ids.lojaA, "billing_provider")).toBe("asaas");
  });

  it("[074-8] service_role PODE gravar o bloco completo de billing novo (provider + subscription + plano)", async () => {
    const r = await t.asService((db) =>
      db.query(
        `update public.lojas set
            billing_provider = 'asaas',
            provider_subscription_id = 'sub_real_001',
            plano_id = $1
          where id = $2`,
        [ids.planoCaro, ids.lojaA],
      ),
    );
    expect(r.affectedRows).toBe(1);
    expect(await colAtual<string>(t, ids.lojaA, "billing_provider")).toBe("asaas");
    expect(await colAtual<string>(t, ids.lojaA, "provider_subscription_id")).toBe("sub_real_001");
    expect(await colAtual<string>(t, ids.lojaA, "plano_id")).toBe(ids.planoCaro);
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 074:
 *
 * Migration `supabase/migrations/20260621094000_lojas_protege_billing_v2.sql`
 * (timestamp > 20260621093000), puramente aditiva:
 *
 *   create or replace function public.lojas_protege_billing()  -- só REPLACE
 *   ... mantém bypass service_role/postgres/supabase_admin ...
 *   ... mantém assinatura_x/hotmart_x/dono_id ...
 *   ... ADICIONA à comparação IS DISTINCT FROM:
 *         new.billing_provider          is distinct from old.billing_provider
 *      or new.provider_subscription_id  is distinct from old.provider_subscription_id
 *      or new.plano_id                  is distinct from old.plano_id
 *
 *   NÃO recriar o trigger lojas_protege_billing_trg (já aponta para a função
 *   por nome — CREATE OR REPLACE FUNCTION basta).
 *
 * COLUNAS PROTEGIDAS ACRESCENTADAS (bloquear se autor ≠ service_role):
 *   billing_provider, provider_subscription_id, plano_id.
 *
 * Casos que precisam passar após a migration: [074-1]..[074-8].
 */
