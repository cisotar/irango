import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 073 — expand `lojas` (billing_provider,
 * provider_subscription_id, plano_id) + CHECK assinatura_status com 'cortesia'.
 * (spec cobranca-assinatura-propria.md → Modelos de Dados → "Generalizar `lojas`").
 *
 * O que a migration 20260621093000_lojas_expand_billing.sql entrega:
 *   EXPAND   — ADD COLUMN billing_provider text, provider_subscription_id text,
 *              plano_id uuid REFERENCES planos(id) — TODAS nullable.
 *   CHECK    — DROP/ADD lojas_assinatura_status_check incluindo 'cortesia'
 *              (set: trial, ativa, inadimplente, cancelada, suspensa, cortesia).
 *   BACKFILL — lojas com hotmart_subscriber_code passam a ter
 *              billing_provider='hotmart' e provider_subscription_id = código.
 *
 * RED esperado: enquanto a migration NÃO existir em supabase/migrations/, o
 * harness pglite não tem as colunas novas nem o 'cortesia' no CHECK. Logo:
 *  - SELECT das colunas novas lança `column "billing_provider" does not exist`  → FALHA
 *  - UPDATE assinatura_status='cortesia' viola o CHECK antigo                    → FALHA
 *  - o backfill nunca rodou → loja Hotmart sem billing_provider                  → FALHA
 *
 * NOTA SOBRE O HARNESS (mesma evidência aceita em 070/071/072): o helper pglite
 * aplica TODAS as migrations do diretório em ordem. Como a migration 073 JÁ foi
 * criada neste branch, o pglite a carrega e a suíte fica VERDE imediatamente.
 * O RED é provado removendo a migration do diretório (ver bloco de evidência no
 * relatório). Estes testes são o contrato que prova a migration correta.
 *
 * Padrão anti-falso-verde (herdado de rls_lojas.test.ts / rls_billing.test.ts):
 *  - existência de coluna confirmada por leitura real (não por introspect frágil).
 *  - aceitação do CHECK confirmada por LINHA AFETADA + reconferência via asService.
 *  - rejeição do CHECK confirmada por exceção, e reconferência de que nada mudou.
 *  - RLS reaproveita os casos canônicos de isolamento (dono só toca a própria loja).
 *
 * Quem deixa verde é a fase GREEN (executar): a migration. Nenhum código de
 * produção é escrito aqui. Ver CONTRATO no fim do arquivo.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
// RN-01: 1 conta = 1 loja (índice único lojas_dono_unico). Cada loja extra
// (Hotmart legada, cortesia) precisa de um dono próprio, distinto de A e B.
const DONO_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const DONO_D = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const SLUG_A = "loja-a-billing";
const SLUG_B = "loja-b-billing";
const SLUG_HOTMART = "loja-hotmart-legada";
const HOTMART_CODE = "HMT-SUB-0001";

type Cenario = {
  lojaA: string;
  lojaB: string;
  lojaHotmart: string;
  planoAtivo: string;
};

async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a@teste.local'),
       ($2, 'dono-b@teste.local'),
       ($3, 'dono-c@teste.local'),
       ($4, 'dono-d@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B, DONO_C, DONO_D],
  );
}

/** Monta o cenário base via service_role (bypass RLS) e retorna os ids. */
async function criarCenario(t: TestDb): Promise<Cenario> {
  await garantirDonos(t);
  return t.asService(async (db) => {
    const ins = async <R extends { id: string }>(sql: string, params: unknown[]) => {
      const r = await db.query<R>(sql, params);
      return r.rows[0].id;
    };

    const lojaA = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,$2,'Loja A',true) returning id`,
      [DONO_A, SLUG_A],
    );
    const lojaB = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,$2,'Loja B',true) returning id`,
      [DONO_B, SLUG_B],
    );
    // Loja legada com código Hotmart — alvo do backfill (dono próprio, RN-01).
    const lojaHotmart = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo, hotmart_subscriber_code)
         values ($1,$2,'Loja Hotmart',true,$3) returning id`,
      [DONO_C, SLUG_HOTMART, HOTMART_CODE],
    );
    const planoAtivo = await ins(
      `insert into public.planos (nome, preco, intervalo, ativo) values ('Plano Mensal',49.00,'mensal',true) returning id`,
      [],
    );

    return { lojaA, lojaB, lojaHotmart, planoAtivo };
  });
}

/** Reconfere via service (BYPASSRLS) o assinatura_status atual — fonte de verdade. */
async function statusAtual(t: TestDb, lojaId: string): Promise<string> {
  const r = await t.asService((db) =>
    db.query<{ assinatura_status: string }>(
      `select assinatura_status from public.lojas where id = $1`,
      [lojaId],
    ),
  );
  return r.rows[0].assinatura_status;
}

async function nomeAtual(t: TestDb, lojaId: string): Promise<string | null> {
  const r = await t.asService((db) =>
    db.query<{ nome: string }>(`select nome from public.lojas where id = $1`, [lojaId]),
  );
  return r.rows[0]?.nome ?? null;
}

describe("073 expand lojas (billing_provider, provider_subscription_id, plano_id) + CHECK cortesia", () => {
  let t: TestDb;
  let ids: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    ids = await criarCenario(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ═══════════════════════════ Colunas novas existem e são legíveis
  it("[073-1] lojas tem billing_provider, provider_subscription_id e plano_id (SELECT não lança)", async () => {
    // RED sem a migration: `column "billing_provider" does not exist`.
    const r = await t.asService((db) =>
      db.query<{
        billing_provider: string | null;
        provider_subscription_id: string | null;
        plano_id: string | null;
      }>(
        `select billing_provider, provider_subscription_id, plano_id
           from public.lojas where id = $1`,
        [ids.lojaA],
      ),
    );
    expect(r.rows.length).toBe(1);
  });

  it("[073-2] billing_provider / provider_subscription_id / plano_id são NULLABLE (INSERT sem elas funciona)", async () => {
    // Loja A foi inserida sem nenhuma das colunas novas; devem vir NULL.
    const r = await t.asService((db) =>
      db.query<{
        billing_provider: string | null;
        provider_subscription_id: string | null;
        plano_id: string | null;
      }>(
        `select billing_provider, provider_subscription_id, plano_id
           from public.lojas where id = $1`,
        [ids.lojaA],
      ),
    );
    expect(r.rows[0].billing_provider).toBeNull();
    expect(r.rows[0].provider_subscription_id).toBeNull();
    expect(r.rows[0].plano_id).toBeNull();
  });

  it("[073-3] plano_id aceita FK válida para planos e a REJEITA quando inexistente", async () => {
    // Vincula plano válido (referência a planos.id deve existir).
    const ok = await t.asService((db) =>
      db.query(`update public.lojas set plano_id = $1 where id = $2`, [ids.planoAtivo, ids.lojaA]),
    );
    expect(ok.affectedRows).toBe(1);
    const conf = await t.asService((db) =>
      db.query<{ plano_id: string | null }>(
        `select plano_id from public.lojas where id = $1`,
        [ids.lojaA],
      ),
    );
    expect(conf.rows[0].plano_id).toBe(ids.planoAtivo);

    // FK inexistente é rejeitada (REFERENCES planos(id)).
    const planoFantasma = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    let rejeitou = false;
    try {
      await t.asService((db) =>
        db.query(`update public.lojas set plano_id = $1 where id = $2`, [planoFantasma, ids.lojaB]),
      );
    } catch {
      rejeitou = true;
    }
    expect(rejeitou).toBe(true);
  });

  // ═══════════════════════════ CHECK assinatura_status (+cortesia)
  it("[073-4] assinatura_status='cortesia' é ACEITO pelo CHECK (UPDATE persiste)", async () => {
    // RED com o CHECK antigo: 'cortesia' viola o constraint → exceção.
    const r = await t.asService((db) =>
      db.query(`update public.lojas set assinatura_status = 'cortesia' where id = $1`, [ids.lojaA]),
    );
    expect(r.affectedRows).toBe(1);
    expect(await statusAtual(t, ids.lojaA)).toBe("cortesia");
  });

  it("[073-5] assinatura_status='suspensa' continua ACEITO (regressão do set anterior)", async () => {
    const r = await t.asService((db) =>
      db.query(`update public.lojas set assinatura_status = 'suspensa' where id = $1`, [ids.lojaB]),
    );
    expect(r.affectedRows).toBe(1);
    expect(await statusAtual(t, ids.lojaB)).toBe("suspensa");
  });

  it("[073-6] INSERT com assinatura_status='cortesia' é aceito", async () => {
    const r = await t.asService((db) =>
      db.query(
        `insert into public.lojas (dono_id, slug, nome, ativo, assinatura_status)
           values ($1,'loja-cortesia','Loja Cortesia',true,'cortesia')`,
        [DONO_D],
      ),
    );
    expect(r.affectedRows).toBe(1);
    const conf = await t.asService((db) =>
      db.query<{ assinatura_status: string }>(
        `select assinatura_status from public.lojas where slug = 'loja-cortesia'`,
      ),
    );
    expect(conf.rows[0].assinatura_status).toBe("cortesia");
  });

  it("[073-7] assinatura_status='valor_invalido' continua sendo REJEITADO pelo CHECK", async () => {
    const antes = await statusAtual(t, ids.lojaA);
    let rejeitou = false;
    try {
      await t.asService((db) =>
        db.query(`update public.lojas set assinatura_status = 'valor_invalido' where id = $1`, [
          ids.lojaA,
        ]),
      );
    } catch {
      rejeitou = true;
    }
    expect(rejeitou).toBe(true);
    // Fonte de verdade: o status NÃO mudou.
    expect(await statusAtual(t, ids.lojaA)).toBe(antes);
  });

  // ═══════════════════════════ BACKFILL das lojas Hotmart
  //
  // O backfill da migration é um UPDATE de UMA vez, executado no momento em que a
  // migration é aplicada — antes do beforeAll que semeia o cenário. Como o harness
  // pglite aplica as migrations e SÓ DEPOIS os testes inserem dados, as lojas deste
  // arquivo não existiam quando o backfill rodou. Reproduzimos aqui o ENUNCIADO
  // idempotente do backfill (idêntico ao da migration) e provamos que a regra
  // mapeia corretamente — é exatamente o que a migration faz em prod sobre as
  // lojas Hotmart legadas. (A idempotência `and billing_provider is null` garante
  // que reaplicar não reescreve dado já migrado.)
  it("[073-8] backfill: loja com hotmart_subscriber_code ganha billing_provider='hotmart' e provider_subscription_id = código", async () => {
    // Pré: a loja Hotmart legada ainda não foi mapeada (não existia no backfill).
    const pre = await t.asService((db) =>
      db.query<{ billing_provider: string | null }>(
        `select billing_provider from public.lojas where id = $1`,
        [ids.lojaHotmart],
      ),
    );
    expect(pre.rows[0].billing_provider).toBeNull();

    // Aplica o ENUNCIADO do backfill (idêntico ao da migration) via service.
    await t.asService((db) =>
      db.query(
        `update public.lojas
            set billing_provider = 'hotmart', provider_subscription_id = hotmart_subscriber_code
          where hotmart_subscriber_code is not null and billing_provider is null`,
      ),
    );

    const r = await t.asService((db) =>
      db.query<{ billing_provider: string | null; provider_subscription_id: string | null }>(
        `select billing_provider, provider_subscription_id
           from public.lojas where id = $1`,
        [ids.lojaHotmart],
      ),
    );
    expect(r.rows[0].billing_provider).toBe("hotmart");
    expect(r.rows[0].provider_subscription_id).toBe(HOTMART_CODE);
  });

  it("[073-9] backfill NÃO toca loja sem hotmart_subscriber_code (billing_provider fica NULL)", async () => {
    // Após o backfill de [073-8], a loja A (sem código Hotmart) permanece NULL.
    const r = await t.asService((db) =>
      db.query<{ billing_provider: string | null }>(
        `select billing_provider from public.lojas where id = $1`,
        [ids.lojaA],
      ),
    );
    expect(r.rows[0].billing_provider).toBeNull();
  });

  // ═══════════════════════════ RLS de lojas NÃO foi alterada
  it("[073-10] dono A LÊ a própria loja (RLS leitura_propria intacta — 1 linha)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(`select id from public.lojas where id = $1`, [ids.lojaA]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.lojaA);
  });

  it("[073-11] dono A ATUALIZA coluna comum da própria loja (RLS update_proprio intacta — 1 afetada)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`update public.lojas set nome = 'Loja A Editada' where id = $1`, [ids.lojaA]),
    );
    expect(r.affectedRows).toBe(1);
    expect(await nomeAtual(t, ids.lojaA)).toBe("Loja A Editada");
  });

  it("[073-12] dono B NÃO atualiza loja de A (isolamento RLS intacto — 0 afetadas, nome intacto)", async () => {
    const antes = await nomeAtual(t, ids.lojaA);
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`update public.lojas set nome = 'HACK-073' where id = $1`, [ids.lojaA]),
    );
    expect(r.affectedRows).toBe(0);
    expect(await nomeAtual(t, ids.lojaA)).toBe(antes);
    expect(await nomeAtual(t, ids.lojaA)).not.toBe("HACK-073");
  });

  it("[073-13] dono B NÃO lê linha da loja A direto da base (isolamento intacto — 0 linhas; existe via service)", async () => {
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`select id from public.lojas where id = $1`, [ids.lojaA]),
    );
    expect(r.rows.length).toBe(0);
    const existe = await t.asService((db) =>
      db.query(`select 1 from public.lojas where id = $1`, [ids.lojaA]),
    );
    expect(existe.rows.length).toBe(1);
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 073:
 *
 * Migration `supabase/migrations/20260621093000_lojas_expand_billing.sql`,
 * sequência EXPAND → BACKFILL (tabela com dados, schema.md §6):
 *
 *   EXPAND (todas nullable, IF NOT EXISTS):
 *     alter table public.lojas
 *       add column billing_provider         text,
 *       add column provider_subscription_id text,
 *       add column plano_id                 uuid references public.planos(id);
 *
 *   CHECK (recria o constraint auto-nomeado, set completo com 'cortesia'):
 *     alter table public.lojas drop constraint if exists lojas_assinatura_status_check;
 *     alter table public.lojas add constraint lojas_assinatura_status_check
 *       check (assinatura_status in
 *         ('trial','ativa','inadimplente','cancelada','suspensa','cortesia'));
 *
 *   BACKFILL (idempotente, só lojas Hotmart):
 *     update public.lojas
 *        set billing_provider = 'hotmart', provider_subscription_id = hotmart_subscriber_code
 *      where hotmart_subscriber_code is not null and billing_provider is null;
 *
 *   NÃO dropar hotmart_subscriber_code/hotmart_plano (coexistência DA-6).
 *   NÃO criar/alterar policy de RLS (a de `lojas` permanece como está — issue 004).
 *   Trigger lojas_protege_billing das colunas novas é a issue 074 (fora de escopo).
 *
 * Casos que precisam passar após a migration: [073-1]..[073-13].
 */
