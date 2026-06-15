import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";
import { reconciliarAssinatura } from "@/lib/assinatura/reconciliar";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Fase RED (TDD) da issue 059 — Reconciliação de comprador sem conta.
 *
 * Quem é invocado:
 *   reconciliarAssinatura(svc, email, lojaId)  — em src/lib/assinatura/reconciliar.ts
 *   (STUB: lança "TODO: GREEN" → o teste cai vermelho na ASSERÇÃO de estado, não no import).
 *
 * Por que é RED de verdade: a função NÃO existe (stub). O teste exercita o
 * comportamento end-to-end contra o schema/RLS/trigger REAIS rodando em pglite,
 * via service_role (reconciliação é server-only, BYPASSRLS — seguranca.md §2/§9).
 * O efeito esperado (loja vira `ativa`/`cancelada`/`suspensa`; eventos órfãos
 * ganham loja_id) é a prova do critério de aceite crítico.
 *
 * Shim pglite↔supabase-js: o stub real recebe um SupabaseClient<Database>. Como
 * a issue (e o plano) chamam funções de queries/ que usam .from().select()/
 * .update()/.eq()/.is(), montamos um cliente MÍNIMO backed por pglite rodando
 * sob service_role — assim a função roda contra SQL/RLS reais, não contra mock.
 * O shim cobre só o subconjunto que reconciliar.ts + as queries (056/057) usam:
 *   from(tabela).select(cols).is(col,null).eq(col,val).ilike(col,val).order(col)
 *   from(tabela).update(patch).eq(col,val)
 *
 * Anti-falso-verde: toda checagem de "nada reconciliado" reconfere via asService
 * (BYPASSRLS) que a loja/eventos REALMENTE existem — a inércia é por regra, não
 * por dado ausente (padrão de rls_*.test.ts).
 */

const DONO = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EMAIL_DONO = "comprador@teste.local";
const EMAIL_OUTRO = "outro@teste.local";

// ─────────────────────────────────────────────────────────── shim pglite↔supabase
type Row = Record<string, unknown>;

/**
 * Constrói um SupabaseClient<Database> MÍNIMO cujas operações são traduzidas para
 * SQL rodando sob `t.asService` (service_role / BYPASSRLS). Cobre exatamente o
 * que a cadeia de reconciliação usa. Qualquer método não implementado lança —
 * forçando o GREEN a manter a cadeia dentro do contrato previsto.
 */
function makeServiceShim(t: TestDb): SupabaseClient<Database> {
  const fromImpl = (tabela: string) => {
    // ── SELECT builder
    const buildSelect = (_cols: string) => {
      const wheres: string[] = [];
      const params: unknown[] = [];
      let orderSql = "";
      const eq = (col: string, val: unknown) => {
        params.push(val);
        wheres.push(`${col} = $${params.length}`);
        return api;
      };
      const is = (col: string, val: null) => {
        wheres.push(`${col} is ${val === null ? "null" : String(val)}`);
        return api;
      };
      const ilike = (col: string, val: string) => {
        params.push(val);
        wheres.push(`${col} ilike $${params.length}`);
        return api;
      };
      const order = (col: string, opts?: { ascending?: boolean }) => {
        orderSql = ` order by ${col} ${opts?.ascending === false ? "desc" : "asc"}`;
        return api;
      };
      const run = async () => {
        const where = wheres.length ? ` where ${wheres.join(" and ")}` : "";
        const sql = `select * from public.${tabela}${where}${orderSql}`;
        const r = await t.asService((db) => db.query<Row>(sql, params));
        return { data: r.rows, error: null };
      };
      // thenable: `await query` executa
      const api = {
        eq,
        is,
        ilike,
        order,
        then: (res: (v: { data: Row[]; error: null }) => unknown) => run().then(res),
      };
      return api;
    };

    // ── UPDATE builder
    const buildUpdate = (patch: Row) => {
      const setCols = Object.keys(patch);
      const setSql = setCols.map((c, i) => `${c} = $${i + 1}`).join(", ");
      const setParams = setCols.map((c) => patch[c]);
      const wheres: string[] = [];
      const params: unknown[] = [...setParams];
      const eq = (col: string, val: unknown) => {
        params.push(val);
        wheres.push(`${col} = $${params.length}`);
        return api;
      };
      const run = async () => {
        const where = wheres.length ? ` where ${wheres.join(" and ")}` : "";
        const sql = `update public.${tabela} set ${setSql}${where}`;
        await t.asService((db) => db.query(sql, params));
        return { data: null, error: null };
      };
      const api = {
        eq,
        then: (res: (v: { data: null; error: null }) => unknown) => run().then(res),
      };
      return api;
    };

    return {
      select: (cols = "*") => buildSelect(cols),
      update: (patch: Row) => buildUpdate(patch),
    };
  };

  // Só `.from()` é usado pelas queries de billing/reconciliação.
  return { from: fromImpl } as unknown as SupabaseClient<Database>;
}

// ─────────────────────────────────────────────────────────── setup helpers
async function semearDono(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`,
    [DONO, EMAIL_DONO],
  );
}

/** Cria a loja do dono (nasce trial, como o cadastro 015 grava). Retorna o id. */
async function criarLojaTrial(t: TestDb): Promise<string> {
  await semearDono(t);
  return t.asService(async (db) => {
    const r = await db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo, assinatura_status)
         values ($1, 'loja-x', 'Loja X', false, 'trial') returning id`,
      [DONO],
    );
    return r.rows[0].id;
  });
}

/** Insere um evento órfão (loja_id NULL) no webhook_eventos_hotmart. */
async function inserirEventoOrfao(
  t: TestDb,
  args: {
    eventoId: string;
    tipo: string; // nome EXTERNO Hotmart (ex.: PURCHASE_APPROVED)
    email: string;
    payload?: Record<string, unknown>;
    processadoEm?: string; // ISO — controla ordem cronológica do fold
  },
): Promise<void> {
  await t.asService((db) =>
    db.query(
      `insert into public.webhook_eventos_hotmart
         (evento_id, evento_tipo, loja_id, email_comprador, payload, processado_em)
       values ($1, $2, null, $3, $4, coalesce($5::timestamptz, now()))`,
      [
        args.eventoId,
        args.tipo,
        args.email,
        JSON.stringify(args.payload ?? {}),
        args.processadoEm ?? null,
      ],
    ),
  );
}

async function lerLoja(
  t: TestDb,
  lojaId: string,
): Promise<{ assinatura_status: string; assinatura_fim_periodo: string | null }> {
  const r = await t.asService((db) =>
    db.query<{ assinatura_status: string; assinatura_fim_periodo: string | null }>(
      `select assinatura_status, assinatura_fim_periodo from public.lojas where id = $1`,
      [lojaId],
    ),
  );
  return r.rows[0];
}

/** Quantos eventos do email AINDA são órfãos (loja_id IS NULL). */
async function orfaosRestantes(t: TestDb, email: string): Promise<number> {
  const r = await t.asService((db) =>
    db.query(
      `select 1 from public.webhook_eventos_hotmart
        where loja_id is null and lower(email_comprador) = lower($1)`,
      [email],
    ),
  );
  return r.rows.length;
}

/** loja_id vinculado a um evento específico (prova de reconciliação). */
async function lojaIdDoEvento(t: TestDb, eventoId: string): Promise<string | null> {
  const r = await t.asService((db) =>
    db.query<{ loja_id: string | null }>(
      `select loja_id from public.webhook_eventos_hotmart where evento_id = $1`,
      [eventoId],
    ),
  );
  return r.rows[0]?.loja_id ?? null;
}

// ─────────────────────────────────────────────────────────── testes
describe("059 reconciliação de comprador sem conta — efeito end-to-end (service_role)", () => {
  let t: TestDb;
  let svc: SupabaseClient<Database>;

  beforeEach(async () => {
    t = await createTestDb();
    svc = makeServiceShim(t);
  });
  afterEach(async () => {
    await t.close();
  });

  it("[1] CAMINHO FELIZ: evento órfão PURCHASE_APPROVED p/ o email do dono → loja vira 'ativa' com fim_periodo, e o evento ganha loja_id", async () => {
    const lojaId = await criarLojaTrial(t);
    await inserirEventoOrfao(t, {
      eventoId: "evt-compra-1",
      tipo: "PURCHASE_APPROVED",
      email: EMAIL_DONO,
      payload: { data: { purchase: { date_next_charge: "2026-12-01T00:00:00Z" } } },
    });

    await reconciliarAssinatura(svc, EMAIL_DONO, lojaId);

    const loja = await lerLoja(t, lojaId);
    expect(loja.assinatura_status).toBe("ativa");
    expect(loja.assinatura_fim_periodo).not.toBeNull();
    // evento saiu de "órfão": loja_id vinculado à loja do dono
    expect(await lojaIdDoEvento(t, "evt-compra-1")).toBe(lojaId);
    expect(await orfaosRestantes(t, EMAIL_DONO)).toBe(0);
  });

  it("[2] EMAIL DIFERENTE: evento órfão é de OUTRO email → nada reconciliado, loja segue 'trial' e o evento continua órfão", async () => {
    const lojaId = await criarLojaTrial(t);
    await inserirEventoOrfao(t, {
      eventoId: "evt-outro-1",
      tipo: "PURCHASE_APPROVED",
      email: EMAIL_OUTRO, // ≠ email do dono autenticado
    });

    await reconciliarAssinatura(svc, EMAIL_DONO, lojaId);

    expect((await lerLoja(t, lojaId)).assinatura_status).toBe("trial");
    // anti-falso-verde: o evento de outro email REALMENTE existe e segue órfão
    expect(await lojaIdDoEvento(t, "evt-outro-1")).toBeNull();
    expect(await orfaosRestantes(t, EMAIL_OUTRO)).toBe(1);
  });

  it("[3] IDEMPOTÊNCIA: rodar 2x → mesmo estado final, sem duplicar nem regredir (2ª vez é no-op: já não há órfão)", async () => {
    const lojaId = await criarLojaTrial(t);
    await inserirEventoOrfao(t, {
      eventoId: "evt-idem-1",
      tipo: "PURCHASE_APPROVED",
      email: EMAIL_DONO,
    });

    await reconciliarAssinatura(svc, EMAIL_DONO, lojaId);
    const apos1 = await lerLoja(t, lojaId);
    expect(apos1.assinatura_status).toBe("ativa");
    expect(await orfaosRestantes(t, EMAIL_DONO)).toBe(0);

    // 2ª rodada: a busca de órfãos retorna [] → no-op; estado não regride.
    await reconciliarAssinatura(svc, EMAIL_DONO, lojaId);
    const apos2 = await lerLoja(t, lojaId);
    expect(apos2.assinatura_status).toBe("ativa");
    expect(apos2.assinatura_fim_periodo).toBe(apos1.assinatura_fim_periodo);
    expect(await orfaosRestantes(t, EMAIL_DONO)).toBe(0);
  });

  it("[4] ORDEM (compra + cancelamento órfãos): fold cronológico consolida o ESTADO FINAL = 'cancelada' (não evento-a-evento bagunçado)", async () => {
    const lojaId = await criarLojaTrial(t);
    await inserirEventoOrfao(t, {
      eventoId: "evt-compra-2",
      tipo: "PURCHASE_APPROVED",
      email: EMAIL_DONO,
      processadoEm: "2026-06-01T10:00:00Z",
    });
    await inserirEventoOrfao(t, {
      eventoId: "evt-cancel-2",
      tipo: "SUBSCRIPTION_CANCELLATION",
      email: EMAIL_DONO,
      processadoEm: "2026-06-05T10:00:00Z", // mais recente
    });

    await reconciliarAssinatura(svc, EMAIL_DONO, lojaId);

    expect((await lerLoja(t, lojaId)).assinatura_status).toBe("cancelada");
    // ambos vinculados; nenhum órfão sobra
    expect(await lojaIdDoEvento(t, "evt-compra-2")).toBe(lojaId);
    expect(await lojaIdDoEvento(t, "evt-cancel-2")).toBe(lojaId);
    expect(await orfaosRestantes(t, EMAIL_DONO)).toBe(0);
  });

  it("[5] REEMBOLSO órfão: loja vira 'suspensa' (trial NÃO vence billing real — corte imediato, RN-A4)", async () => {
    const lojaId = await criarLojaTrial(t);
    await inserirEventoOrfao(t, {
      eventoId: "evt-reembolso-1",
      tipo: "PURCHASE_REFUNDED",
      email: EMAIL_DONO,
    });

    await reconciliarAssinatura(svc, EMAIL_DONO, lojaId);

    expect((await lerLoja(t, lojaId)).assinatura_status).toBe("suspensa");
    expect(await orfaosRestantes(t, EMAIL_DONO)).toBe(0);
  });

  it("[6] SEM ÓRFÃO: nenhum evento p/ o email → no-op, loja segue 'trial'", async () => {
    const lojaId = await criarLojaTrial(t);

    await reconciliarAssinatura(svc, EMAIL_DONO, lojaId);

    expect((await lerLoja(t, lojaId)).assinatura_status).toBe("trial");
  });

  it("[7] CASING: webhook grava email em lower(trim); reconciliar com casing variado normaliza e casa", async () => {
    // O webhook (057, route.ts) já grava email_comprador em lower(trim) — o evento
    // órfão nasce normalizado. A reconciliação recebe o email autenticado com casing
    // qualquer e normaliza p/ match EXATO (FIX 1 CRÍTICA: nada de ilike/wildcard).
    const lojaId = await criarLojaTrial(t);
    await inserirEventoOrfao(t, {
      eventoId: "evt-casing-1",
      tipo: "PURCHASE_APPROVED",
      email: EMAIL_DONO, // como o webhook grava: lower(trim)
    });

    await reconciliarAssinatura(svc, "Comprador@Teste.LOCAL  ", lojaId); // casing+espaço

    expect((await lerLoja(t, lojaId)).assinatura_status).toBe("ativa");
    expect(await lojaIdDoEvento(t, "evt-casing-1")).toBe(lojaId);
    expect(await orfaosRestantes(t, EMAIL_DONO)).toBe(0);
  });

  it("[8] FIX 1 CRÍTICA — injeção de wildcard LIKE: atacante 'vic_im' NÃO casa órfão da vítima 'victim'", async () => {
    // A vítima comprou e gerou um evento órfão p/ victim@x.local. O atacante cadastra
    // com vic_im@x.local — sob `ilike`, o `_` é wildcard e casaria 'victim@x.local',
    // roubando a assinatura. Com match EXATO normalizado, NÃO casa.
    const VITIMA = "victim@x.local";
    const ATACANTE = "vic_im@x.local";

    // loja do ATACANTE em trial (é ele quem está reconciliando)
    const lojaAtacante = await criarLojaTrial(t);
    // evento órfão da VÍTIMA (como o webhook gravaria: lower(trim))
    await inserirEventoOrfao(t, {
      eventoId: "evt-vitima-1",
      tipo: "PURCHASE_APPROVED",
      email: VITIMA,
    });

    await reconciliarAssinatura(svc, ATACANTE, lojaAtacante);

    // atacante NÃO herda a assinatura — segue trial
    expect((await lerLoja(t, lojaAtacante)).assinatura_status).toBe("trial");
    // o evento da vítima continua órfão (loja_id NULL) — intacto p/ a vítima real
    expect(await lojaIdDoEvento(t, "evt-vitima-1")).toBeNull();
    expect(await orfaosRestantes(t, VITIMA)).toBe(1);
  });

  it("[9] FIX 3 MÉDIA — fail-closed: 2 órfãos com subscriber_code distinto → nenhuma escrita (loja segue trial)", async () => {
    const lojaId = await criarLojaTrial(t);
    await inserirEventoOrfao(t, {
      eventoId: "evt-sub-A",
      tipo: "PURCHASE_APPROVED",
      email: EMAIL_DONO,
      payload: { data: { subscription: { subscriber_code: "SUB-AAA" } } },
      processadoEm: "2026-06-01T10:00:00Z",
    });
    await inserirEventoOrfao(t, {
      eventoId: "evt-sub-B",
      tipo: "PURCHASE_APPROVED",
      email: EMAIL_DONO,
      payload: { data: { subscription: { subscriber_code: "SUB-BBB" } } },
      processadoEm: "2026-06-02T10:00:00Z",
    });

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await reconciliarAssinatura(svc, EMAIL_DONO, lojaId);
    spy.mockRestore();

    // estado ambíguo → NÃO aplica: loja segue trial e os órfãos permanecem órfãos
    expect((await lerLoja(t, lojaId)).assinatura_status).toBe("trial");
    expect(await lojaIdDoEvento(t, "evt-sub-A")).toBeNull();
    expect(await lojaIdDoEvento(t, "evt-sub-B")).toBeNull();
    expect(await orfaosRestantes(t, EMAIL_DONO)).toBe(2);
  });
});
