import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) das issues 070, 071 e 072 — migrations das tabelas de cobrança
 * por assinatura própria (spec cobranca-assinatura-propria.md).
 *
 *   070 planos                    — SELECT authenticated só ativo=true; escrita deny-all;
 *                                   CHECK (preco >= 0).
 *   071 webhook_eventos_billing   — deny-all TOTAL (anon/authenticated não leem nem
 *                                   escrevem); só service_role; UNIQUE (provider, evento_id).
 *   072 pagamentos_assinatura     — SELECT escopado por dono (lojas.dono_id); escrita
 *                                   deny-all; UNIQUE (provider, provider_payment_id).
 *
 * RED esperado: enquanto as migrations 20260621090000 / 091000 / 092000 NÃO
 * existirem em supabase/migrations/, o harness pglite não cria as tabelas e
 * TODO acesso lança `relation "public.<tabela>" does not exist`. Os helpers de
 * cenário (criarCenario via service_role) já falham no beforeAll, o que derruba
 * a suíte inteira em vermelho — o RED é capturado contra essa ausência.
 *
 * Padrão anti-falso-verde (herdado de rls_cupons_pedidos.test.ts):
 *  - leitura "permitida" confirmada por NÚMERO DE LINHAS visíveis.
 *  - escrita "permitida" confirmada por LINHAS AFETADAS + reconferência via
 *    service_role (BYPASSRLS) de que a linha REALMENTE persistiu.
 *  - negação NUNCA aceita por "relation does not exist": a tabela deve existir.
 *    Negação = 0 linhas / 0 afetadas / rejeição, sempre reconferida via service.
 *
 * Quem deixa verde é a fase GREEN (executar): as 3 migrations. NENHUM código de
 * produção é escrito aqui. Ver CONTRATO no fim do arquivo.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

type Cenario = {
  lojaA: string;
  lojaB: string;
  planoAtivo: string; // plano ativo=true
  planoInativo: string; // plano ativo=false
  faturaA: string; // pagamento da loja A
  faturaB: string; // pagamento da loja B
};

async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a@teste.local'),
       ($2, 'dono-b@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B],
  );
}

/** Monta o cenário base via service_role (bypass RLS) e retorna os ids. */
async function criarCenario(t: TestDb): Promise<Cenario> {
  await garantirDonos(t);
  return t.asService(async (db) => {
    const ins = async (sql: string, params: unknown[]) => {
      const r = await db.query<{ id: string }>(sql, params);
      return r.rows[0].id;
    };

    const lojaA = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-a','Loja A',true) returning id`,
      [DONO_A],
    );
    const lojaB = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-b','Loja B',true) returning id`,
      [DONO_B],
    );

    const planoAtivo = await ins(
      `insert into public.planos (nome, preco, intervalo, ativo) values ('Plano Ativo',49.00,'mensal',true) returning id`,
      [],
    );
    const planoInativo = await ins(
      `insert into public.planos (nome, preco, intervalo, ativo) values ('Plano Retirado',99.00,'mensal',false) returning id`,
      [],
    );

    const faturaA = await ins(
      `insert into public.pagamentos_assinatura (loja_id, provider, provider_payment_id, valor, status)
         values ($1,'stripe','pi_A_001',49.00,'pago') returning id`,
      [lojaA],
    );
    const faturaB = await ins(
      `insert into public.pagamentos_assinatura (loja_id, provider, provider_payment_id, valor, status)
         values ($1,'stripe','pi_B_001',49.00,'pago') returning id`,
      [lojaB],
    );

    return { lojaA, lojaB, planoAtivo, planoInativo, faturaA, faturaB };
  });
}

// ───────────────────────────── reconferências via service (fonte de verdade)
async function existeId(t: TestDb, tabela: string, id: string): Promise<boolean> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.${tabela} where id = $1`, [id]),
  );
  return r.rows.length > 0;
}

async function existePorMarcador(
  t: TestDb,
  tabela: string,
  coluna: string,
  valor: string,
): Promise<number> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.${tabela} where ${coluna} = $1`, [valor]),
  );
  return r.rows.length;
}

describe("070/071/072 RLS das tabelas de cobrança (planos, webhook_eventos_billing, pagamentos_assinatura)", () => {
  let t: TestDb;
  let ids: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    ids = await criarCenario(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ═══════════════════════════ 070 — planos
  it("[070-1] authenticated LÊ plano ativo=true (1 linha)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(`select id from public.planos where id = $1`, [ids.planoAtivo]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.planoAtivo);
  });

  it("[070-2] authenticated NÃO lê plano ativo=false (0 linhas; existe via service)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`select id from public.planos where id = $1`, [ids.planoInativo]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "planos", ids.planoInativo)).toBe(true);
  });

  it("[070-3] anon NÃO lê plano ativo (0 linhas; existe via service)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.planos where id = $1`, [ids.planoAtivo]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "planos", ids.planoAtivo)).toBe(true);
  });

  it("[070-4] authenticated NÃO insere plano (escrita deny-all; nada persiste)", async () => {
    const MARCADOR = "Plano Forjado Auth";
    let rejeitouOuZero = false;
    try {
      const r = await t.asUser(DONO_A, (db) =>
        db.query(`insert into public.planos (nome, preco, intervalo, ativo) values ($1,9.90,'mensal',true)`, [
          MARCADOR,
        ]),
      );
      rejeitouOuZero = r.affectedRows === 0;
    } catch {
      rejeitouOuZero = true;
    }
    expect(rejeitouOuZero).toBe(true);
    expect(await existePorMarcador(t, "planos", "nome", MARCADOR)).toBe(0);
  });

  it("[070-5] anon NÃO insere plano (escrita deny-all; nada persiste)", async () => {
    const MARCADOR = "Plano Forjado Anon";
    let rejeitouOuZero = false;
    try {
      const r = await t.asAnon((db) =>
        db.query(`insert into public.planos (nome, preco, intervalo, ativo) values ($1,9.90,'mensal',true)`, [
          MARCADOR,
        ]),
      );
      rejeitouOuZero = r.affectedRows === 0;
    } catch {
      rejeitouOuZero = true;
    }
    expect(rejeitouOuZero).toBe(true);
    expect(await existePorMarcador(t, "planos", "nome", MARCADOR)).toBe(0);
  });

  it("[070-6] authenticated NÃO atualiza plano (0 afetadas; preço intacto)", async () => {
    const upd = await t.asUser(DONO_A, (db) =>
      db.query(`update public.planos set preco = 0.01 where id = $1`, [ids.planoAtivo]),
    );
    expect(upd.affectedRows).toBe(0);
    const conf = await t.asService((db) =>
      db.query<{ preco: string }>(`select preco from public.planos where id = $1`, [ids.planoAtivo]),
    );
    expect(Number(conf.rows[0].preco)).toBe(49.0);
  });

  it("[070-7] service_role insere plano (aceito; persistiu)", async () => {
    const MARCADOR = "Plano Service";
    const r = await t.asService((db) =>
      db.query(`insert into public.planos (nome, preco, intervalo, ativo) values ($1,29.90,'mensal',true)`, [
        MARCADOR,
      ]),
    );
    expect(r.affectedRows).toBe(1);
    expect(await existePorMarcador(t, "planos", "nome", MARCADOR)).toBe(1);
  });

  it("[070-8] CHECK (preco >= 0) rejeita preço negativo (service_role)", async () => {
    let rejeitou = false;
    try {
      await t.asService((db) =>
        db.query(`insert into public.planos (nome, preco, intervalo, ativo) values ('Plano Negativo',-1.00,'mensal',true)`),
      );
    } catch {
      rejeitou = true;
    }
    expect(rejeitou).toBe(true);
    expect(await existePorMarcador(t, "planos", "nome", "Plano Negativo")).toBe(0);
  });

  // ═══════════════════════════ 071 — webhook_eventos_billing (deny-all TOTAL)
  it("[071-1] anon NÃO faz SELECT (deny-all; evento existe via service)", async () => {
    const evtId = await t.asService(async (db) => {
      const r = await db.query<{ id: string }>(
        `insert into public.webhook_eventos_billing (provider, evento_id, tipo, payload)
           values ('stripe','evt_sel_anon','invoice.paid','{}'::jsonb) returning id`,
      );
      return r.rows[0].id;
    });
    const r = await t.asAnon((db) =>
      db.query(`select id from public.webhook_eventos_billing where id = $1`, [evtId]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "webhook_eventos_billing", evtId)).toBe(true);
  });

  it("[071-2] authenticated NÃO faz SELECT (deny-all)", async () => {
    const evtId = await t.asService(async (db) => {
      const r = await db.query<{ id: string }>(
        `insert into public.webhook_eventos_billing (provider, evento_id, tipo, payload)
           values ('stripe','evt_sel_auth','invoice.paid','{}'::jsonb) returning id`,
      );
      return r.rows[0].id;
    });
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`select id from public.webhook_eventos_billing where id = $1`, [evtId]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "webhook_eventos_billing", evtId)).toBe(true);
  });

  it("[071-3] anon NÃO faz INSERT (deny-all; nada persiste)", async () => {
    let rejeitouOuZero = false;
    try {
      const r = await t.asAnon((db) =>
        db.query(`insert into public.webhook_eventos_billing (provider, evento_id, tipo, payload)
                    values ('stripe','evt_anon_ins','x','{}'::jsonb)`),
      );
      rejeitouOuZero = r.affectedRows === 0;
    } catch {
      rejeitouOuZero = true;
    }
    expect(rejeitouOuZero).toBe(true);
    expect(await existePorMarcador(t, "webhook_eventos_billing", "evento_id", "evt_anon_ins")).toBe(0);
  });

  it("[071-4] authenticated NÃO faz INSERT (deny-all; nada persiste)", async () => {
    let rejeitouOuZero = false;
    try {
      const r = await t.asUser(DONO_A, (db) =>
        db.query(`insert into public.webhook_eventos_billing (provider, evento_id, tipo, payload)
                    values ('stripe','evt_auth_ins','x','{}'::jsonb)`),
      );
      rejeitouOuZero = r.affectedRows === 0;
    } catch {
      rejeitouOuZero = true;
    }
    expect(rejeitouOuZero).toBe(true);
    expect(await existePorMarcador(t, "webhook_eventos_billing", "evento_id", "evt_auth_ins")).toBe(0);
  });

  it("[071-5] authenticated NÃO faz UPDATE (0 afetadas; processado intacto)", async () => {
    const evtId = await t.asService(async (db) => {
      const r = await db.query<{ id: string }>(
        `insert into public.webhook_eventos_billing (provider, evento_id, tipo, payload, processado)
           values ('stripe','evt_upd_auth','x','{}'::jsonb,false) returning id`,
      );
      return r.rows[0].id;
    });
    const upd = await t.asUser(DONO_A, (db) =>
      db.query(`update public.webhook_eventos_billing set processado = true where id = $1`, [evtId]),
    );
    expect(upd.affectedRows).toBe(0);
    const conf = await t.asService((db) =>
      db.query<{ processado: boolean }>(`select processado from public.webhook_eventos_billing where id = $1`, [evtId]),
    );
    expect(conf.rows[0].processado).toBe(false);
  });

  it("[071-6] service_role INSERE evento (aceito; persistiu)", async () => {
    const r = await t.asService((db) =>
      db.query(`insert into public.webhook_eventos_billing (provider, evento_id, tipo, payload)
                  values ('stripe','evt_service_ok','invoice.paid','{}'::jsonb)`),
    );
    expect(r.affectedRows).toBe(1);
    expect(await existePorMarcador(t, "webhook_eventos_billing", "evento_id", "evt_service_ok")).toBe(1);
  });

  it("[071-7] 2º INSERT com mesmo (provider, evento_id) viola UNIQUE", async () => {
    await t.asService((db) =>
      db.query(`insert into public.webhook_eventos_billing (provider, evento_id, tipo, payload)
                  values ('stripe','evt_dup','invoice.paid','{}'::jsonb)`),
    );
    let violou = false;
    try {
      await t.asService((db) =>
        db.query(`insert into public.webhook_eventos_billing (provider, evento_id, tipo, payload)
                    values ('stripe','evt_dup','invoice.paid','{}'::jsonb)`),
      );
    } catch {
      violou = true;
    }
    expect(violou).toBe(true);
    // mesmo evento_id em OUTRO provider NÃO colide (UNIQUE é composto)
    const outro = await t.asService((db) =>
      db.query(`insert into public.webhook_eventos_billing (provider, evento_id, tipo, payload)
                  values ('pagarme','evt_dup','invoice.paid','{}'::jsonb)`),
    );
    expect(outro.affectedRows).toBe(1);
  });

  // ═══════════════════════════ 072 — pagamentos_assinatura (SELECT por dono)
  it("[072-1] dono A LÊ a própria fatura (1 linha)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(`select id from public.pagamentos_assinatura where id = $1`, [ids.faturaA]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.faturaA);
  });

  it("[072-2] dono B NÃO vê fatura da loja A (isolamento — 0 linhas; existe via service)", async () => {
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`select id from public.pagamentos_assinatura where id = $1`, [ids.faturaA]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "pagamentos_assinatura", ids.faturaA)).toBe(true);
  });

  it("[072-3] anon NÃO vê faturas (0 linhas; existem via service)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.pagamentos_assinatura where id = $1`, [ids.faturaA]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "pagamentos_assinatura", ids.faturaA)).toBe(true);
  });

  it("[072-4] authenticated NÃO insere fatura (escrita deny-all; nada persiste)", async () => {
    let rejeitouOuZero = false;
    try {
      const r = await t.asUser(DONO_A, (db) =>
        db.query(`insert into public.pagamentos_assinatura (loja_id, provider, provider_payment_id, valor, status)
                    values ($1,'stripe','pi_forjado_auth',0.01,'pago')`, [ids.lojaA]),
      );
      rejeitouOuZero = r.affectedRows === 0;
    } catch {
      rejeitouOuZero = true;
    }
    expect(rejeitouOuZero).toBe(true);
    expect(await existePorMarcador(t, "pagamentos_assinatura", "provider_payment_id", "pi_forjado_auth")).toBe(0);
  });

  it("[072-5] authenticated NÃO atualiza valor/status da própria fatura (0 afetadas; valor intacto)", async () => {
    const upd = await t.asUser(DONO_A, (db) =>
      db.query(`update public.pagamentos_assinatura set valor = 0.01, status = 'estornado' where id = $1`, [
        ids.faturaA,
      ]),
    );
    expect(upd.affectedRows).toBe(0);
    const conf = await t.asService((db) =>
      db.query<{ valor: string; status: string }>(
        `select valor, status from public.pagamentos_assinatura where id = $1`,
        [ids.faturaA],
      ),
    );
    expect(Number(conf.rows[0].valor)).toBe(49.0);
    expect(conf.rows[0].status).toBe("pago");
  });

  it("[072-6] service_role insere fatura (aceito; persistiu)", async () => {
    const r = await t.asService((db) =>
      db.query(`insert into public.pagamentos_assinatura (loja_id, provider, provider_payment_id, valor, status)
                  values ($1,'stripe','pi_service_ok',49.00,'pago')`, [ids.lojaA]),
    );
    expect(r.affectedRows).toBe(1);
    expect(await existePorMarcador(t, "pagamentos_assinatura", "provider_payment_id", "pi_service_ok")).toBe(1);
  });

  it("[072-7] UNIQUE (provider, provider_payment_id) bloqueia 2ª cobrança", async () => {
    await t.asService((db) =>
      db.query(`insert into public.pagamentos_assinatura (loja_id, provider, provider_payment_id, valor, status)
                  values ($1,'stripe','pi_unico',49.00,'pago')`, [ids.lojaA]),
    );
    let violou = false;
    try {
      await t.asService((db) =>
        db.query(`insert into public.pagamentos_assinatura (loja_id, provider, provider_payment_id, valor, status)
                    values ($1,'stripe','pi_unico',49.00,'pago')`, [ids.lojaA]),
      );
    } catch {
      violou = true;
    }
    expect(violou).toBe(true);
  });

  // ═══════════════════════════ Sanity do BYPASSRLS
  it("[S] service_role lê plano, evento e fatura (bypass RLS)", async () => {
    const plano = await t.asService((db) =>
      db.query(`select id from public.planos where id = $1`, [ids.planoInativo]),
    );
    expect(plano.rows.length).toBe(1);
    const fatura = await t.asService((db) =>
      db.query(`select id from public.pagamentos_assinatura where id = $1`, [ids.faturaB]),
    );
    expect(fatura.rows.length).toBe(1);
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issues 070, 071, 072:
 *
 * Criar 3 migrations puramente aditivas (tabelas novas, 0 linhas em prod):
 *
 *   supabase/migrations/20260621090000_planos.sql
 *     planos(id, nome, preco numeric(10,2) CHECK(preco>=0), intervalo CHECK IN
 *       ('mensal','anual') DEFAULT 'mensal', provider_price_id, ativo bool DEFAULT
 *       true, criado_em). ENABLE RLS.
 *     policy SELECT to authenticated USING (ativo = true).
 *     SEM policy de INSERT/UPDATE/DELETE → escrita deny-all (só service_role).
 *     Casos: [070-1..8].
 *
 *   supabase/migrations/20260621091000_webhook_eventos_billing.sql
 *     webhook_eventos_billing(id, provider NOT NULL, evento_id NOT NULL, tipo,
 *       payload jsonb, processado bool DEFAULT false, criado_em,
 *       UNIQUE(provider, evento_id)). ENABLE RLS.
 *     NENHUMA policy → deny-all total p/ anon+authenticated; só service_role.
 *     Casos: [071-1..7].
 *
 *   supabase/migrations/20260621092000_pagamentos_assinatura.sql
 *     pagamentos_assinatura(id, loja_id NOT NULL REFERENCES lojas ON DELETE CASCADE,
 *       provider NOT NULL, provider_payment_id, valor numeric(10,2) NOT NULL,
 *       status CHECK IN ('pendente','pago','falhou','estornado'), metodo,
 *       fatura_url, competencia, criado_em, UNIQUE(provider, provider_payment_id)).
 *       index por loja_id. ENABLE RLS.
 *     policy SELECT USING (EXISTS lojas onde lojas.id = loja_id AND dono_id = auth.uid()).
 *     SEM policy de escrita → INSERT/UPDATE/DELETE deny-all; só service_role.
 *     Casos: [072-1..7].
 *
 * Os GRANTs de tabela (anon/authenticated select/insert/...) já são concedidos
 * pelo GRANTS_SQL do harness pglite após aplicar as migrations — a CONTENÇÃO é a
 * RLS, exatamente como no Supabase real.
 */
