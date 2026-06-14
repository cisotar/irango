import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) — FIX CRÍTICO de segurança (achado da auditoria 057).
 *
 * PROBLEMA: a policy `lojas_update_proprio` concede UPDATE da LINHA inteira ao
 * dono autenticado. RLS filtra LINHA, não COLUNA — então o lojista, via
 * PostgREST direto (sem passar pela Server Action de perfil), pode reescrever
 * QUALQUER coluna da própria loja, incluindo as de billing:
 *   assinatura_status, assinatura_inicio, assinatura_fim_periodo,
 *   assinatura_atualizada_em, hotmart_subscriber_code, hotmart_plano, dono_id.
 * Isso permite AUTO-PROMOVER a assinatura (set assinatura_status='ativa') →
 * acesso grátis ao produto pago. Vazamento de autorização.
 *
 * CORREÇÃO ESPERADA (fase GREEN, NÃO escrita aqui): um trigger BEFORE UPDATE em
 * public.lojas que REJEITA mudança dessas colunas quando o autor NÃO é
 * service_role (nem superuser/migrations). O webhook Hotmart roda como
 * service_role e PRECISA continuar escrevendo billing.
 *
 * POR QUE ISTO É RED DE VERDADE (e não cosmético):
 *   A migration do trigger ainda não existe. Hoje a RLS PERMITE o dono escrever
 *   billing (ver rls_lojas.test.ts [14], que documenta exatamente esse limite).
 *   Logo, os UPDATES de billing pelo dono PASSAM hoje → estes testes, que
 *   exigem que FALHEM, ficam VERMELHOS até o trigger existir.
 *
 * ANTI-FALSO-VERDE: toda expectativa de bloqueio é reconferida via asService
 * (BYPASSRLS, fonte de verdade) de que o valor NÃO mudou; toda expectativa de
 * permissão é reconferida de que o valor REALMENTE mudou. Nunca se aceita
 * "0 linhas / sem efeito" sem reconferir a fonte de verdade.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const SLUG_A = "loja-a-billing";

async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a@teste.local'),
       ($2, 'dono-b@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B],
  );
}

/** Cria loja A (dono A) em estado de billing CONHECIDO via service (bypass RLS). */
async function criarLojaA(t: TestDb): Promise<string> {
  await garantirDonos(t);
  return t.asService(async (db) => {
    const r = await db.query<{ id: string }>(
      `insert into public.lojas
         (dono_id, slug, nome, ativo,
          assinatura_status, assinatura_inicio, assinatura_fim_periodo,
          assinatura_atualizada_em, hotmart_subscriber_code, hotmart_plano)
       values
         ($1, $2, 'Loja A', true,
          'trial', null, null,
          null, null, null)
       returning id`,
      [DONO_A, SLUG_A],
    );
    return r.rows[0].id;
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
 * Tenta um UPDATE como dono A e devolve {bloqueou, affected}. Considera-se
 * BLOQUEADO se o trigger lançar (raise exception) OU se 0 linhas forem afetadas.
 * No estado RED (sem trigger), nada lança e 1 linha é afetada → bloqueou=false.
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

describe("057 trigger protege colunas de billing de lojas (anti auto-promoção)", () => {
  let t: TestDb;
  let lojaA: string;

  beforeEach(async () => {
    t = await createTestDb();
    lojaA = await criarLojaA(t);
  });
  afterEach(async () => {
    await t.close();
  });

  // ───────────────────── Bloqueio das colunas de billing (dono) — o RED central
  it("[1] dono NÃO pode auto-promover assinatura_status='ativa' (bloqueado, valor intacto)", async () => {
    const antes = await colAtual<string>(t, lojaA, "assinatura_status");
    expect(antes).toBe("trial"); // sanity do estado inicial

    const res = await tentarUpdateComoDono(
      t,
      DONO_A,
      `update public.lojas set assinatura_status = 'ativa' where id = $1`,
      [lojaA],
    );
    expect(res.bloqueou).toBe(true);

    // Fonte de verdade: NÃO mudou.
    expect(await colAtual<string>(t, lojaA, "assinatura_status")).toBe("trial");
  });

  it("[2] dono NÃO pode mudar assinatura_fim_periodo (estender período pago)", async () => {
    const res = await tentarUpdateComoDono(
      t,
      DONO_A,
      `update public.lojas set assinatura_fim_periodo = now() + interval '10 years' where id = $1`,
      [lojaA],
    );
    expect(res.bloqueou).toBe(true);
    expect(await colAtual(t, lojaA, "assinatura_fim_periodo")).toBeNull();
  });

  it("[3] dono NÃO pode mudar assinatura_inicio", async () => {
    const res = await tentarUpdateComoDono(
      t,
      DONO_A,
      `update public.lojas set assinatura_inicio = now() where id = $1`,
      [lojaA],
    );
    expect(res.bloqueou).toBe(true);
    expect(await colAtual(t, lojaA, "assinatura_inicio")).toBeNull();
  });

  it("[4] dono NÃO pode mudar assinatura_atualizada_em", async () => {
    const res = await tentarUpdateComoDono(
      t,
      DONO_A,
      `update public.lojas set assinatura_atualizada_em = now() where id = $1`,
      [lojaA],
    );
    expect(res.bloqueou).toBe(true);
    expect(await colAtual(t, lojaA, "assinatura_atualizada_em")).toBeNull();
  });

  it("[5] dono NÃO pode forjar hotmart_subscriber_code", async () => {
    const res = await tentarUpdateComoDono(
      t,
      DONO_A,
      `update public.lojas set hotmart_subscriber_code = 'FAKE-SUB-123' where id = $1`,
      [lojaA],
    );
    expect(res.bloqueou).toBe(true);
    expect(await colAtual(t, lojaA, "hotmart_subscriber_code")).toBeNull();
  });

  it("[6] dono NÃO pode mudar hotmart_plano", async () => {
    const res = await tentarUpdateComoDono(
      t,
      DONO_A,
      `update public.lojas set hotmart_plano = 'plano-premium-gratis' where id = $1`,
      [lojaA],
    );
    expect(res.bloqueou).toBe(true);
    expect(await colAtual(t, lojaA, "hotmart_plano")).toBeNull();
  });

  it("[7] dono NÃO pode mudar dono_id (transferir/forjar propriedade)", async () => {
    const res = await tentarUpdateComoDono(
      t,
      DONO_A,
      `update public.lojas set dono_id = $1 where id = $2`,
      [DONO_B, lojaA],
    );
    expect(res.bloqueou).toBe(true);
    expect(await colAtual<string>(t, lojaA, "dono_id")).toBe(DONO_A);
  });

  it("[8] dono NÃO escapa misturando coluna legítima + billing no MESMO update", async () => {
    // Vetor de evasão: tentar 'esconder' a mudança de billing junto de uma
    // coluna permitida. O trigger deve bloquear a transação inteira; nome NÃO
    // pode mudar se o update foi rejeitado.
    const res = await tentarUpdateComoDono(
      t,
      DONO_A,
      `update public.lojas set nome = 'Loja Hack', assinatura_status = 'ativa' where id = $1`,
      [lojaA],
    );
    expect(res.bloqueou).toBe(true);
    expect(await colAtual<string>(t, lojaA, "assinatura_status")).toBe("trial");
    expect(await colAtual<string>(t, lojaA, "nome")).toBe("Loja A");
  });

  // ───────────────────── Colunas legítimas continuam permitidas (não over-block)
  it("[9] dono PODE atualizar nome (coluna legítima — 1 linha, persistiu)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`update public.lojas set nome = 'Loja A Renomeada' where id = $1`, [lojaA]),
    );
    expect(r.affectedRows).toBe(1);
    expect(await colAtual<string>(t, lojaA, "nome")).toBe("Loja A Renomeada");
  });

  it("[10] dono PODE atualizar slug", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`update public.lojas set slug = 'loja-a-novo-slug' where id = $1`, [lojaA]),
    );
    expect(r.affectedRows).toBe(1);
    expect(await colAtual<string>(t, lojaA, "slug")).toBe("loja-a-novo-slug");
  });

  it("[11] dono PODE atualizar tema (jsonb)", async () => {
    const novoTema = JSON.stringify({ primaria: "#000000", fundo: "#ffffff", destaque: "#123456" });
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`update public.lojas set tema = $1::jsonb where id = $2`, [novoTema, lojaA]),
    );
    expect(r.affectedRows).toBe(1);
    const tema = await colAtual<{ primaria: string }>(t, lojaA, "tema");
    expect(tema?.primaria).toBe("#000000");
  });

  it("[12] dono PODE atualizar horarios (jsonb)", async () => {
    const novosHorarios = JSON.stringify({
      seg: { abre: "10:00", fecha: "18:00", ativo: true },
    });
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`update public.lojas set horarios = $1::jsonb where id = $2`, [novosHorarios, lojaA]),
    );
    expect(r.affectedRows).toBe(1);
    const horarios = await colAtual<{ seg: { abre: string } }>(t, lojaA, "horarios");
    expect(horarios?.seg.abre).toBe("10:00");
  });

  // ───────────────────── service_role (webhook Hotmart) CONTINUA escrevendo billing
  it("[13] service_role PODE atualizar assinatura_status (webhook precisa — 1 linha, persistiu)", async () => {
    const r = await t.asService((db) =>
      db.query(`update public.lojas set assinatura_status = 'ativa' where id = $1`, [lojaA]),
    );
    expect(r.affectedRows).toBe(1);
    expect(await colAtual<string>(t, lojaA, "assinatura_status")).toBe("ativa");
  });

  it("[14] service_role PODE gravar o bloco completo de billing (webhook Hotmart)", async () => {
    const r = await t.asService((db) =>
      db.query(
        `update public.lojas set
            assinatura_status = 'ativa',
            assinatura_inicio = now(),
            assinatura_fim_periodo = now() + interval '30 days',
            assinatura_atualizada_em = now(),
            hotmart_subscriber_code = 'SUB-REAL-001',
            hotmart_plano = 'mensal'
          where id = $1`,
        [lojaA],
      ),
    );
    expect(r.affectedRows).toBe(1);
    expect(await colAtual<string>(t, lojaA, "assinatura_status")).toBe("ativa");
    expect(await colAtual<string>(t, lojaA, "hotmart_subscriber_code")).toBe("SUB-REAL-001");
    expect(await colAtual<string>(t, lojaA, "hotmart_plano")).toBe("mensal");
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — fix auditoria 057:
 *
 * Criar `supabase/migrations/<timestamp>_lojas_protege_billing.sql`
 * (timestamp > 20260614004000), puramente aditivo, com:
 *
 *   1) function public.lojas_protege_billing() returns trigger
 *        language plpgsql security definer  (ou invoker — ver nota)
 *      Lógica: se current_user NÃO está em ('service_role', superuser de migration)
 *      e QUALQUER das colunas protegidas mudou (new.<col> IS DISTINCT FROM old.<col>),
 *      então `raise exception` (ex.: 'colunas de billing só podem ser alteradas pelo
 *      sistema (service_role)').
 *
 *      Condição de liberação (NÃO bloquear) quando:
 *        - current_user = 'service_role'  (webhook Hotmart — testes [13][14])
 *        - current_user é o superuser/owner das migrations (pglite: 'postgres';
 *          Supabase: 'postgres'/'supabase_admin') — para migrations/backfill não
 *          quebrarem. Recomendado liberar via `pg_has_role(current_user,'service_role','member')`
 *          OU comparar current_user. Use a checagem que o harness satisfaz:
 *          o harness faz `set local role service_role`, então `current_user='service_role'`.
 *
 *   2) trigger lojas_protege_billing_trg
 *        before update on public.lojas
 *        for each row execute function public.lojas_protege_billing();
 *
 * COLUNAS PROTEGIDAS (bloquear mudança se autor ≠ service_role):
 *   assinatura_status, assinatura_inicio, assinatura_fim_periodo,
 *   assinatura_atualizada_em, hotmart_subscriber_code, hotmart_plano, dono_id
 *
 * COLUNAS LEGÍTIMAS (NUNCA bloquear): nome, slug, tema, horarios, telefone,
 *   whatsapp, ativo, endereco_*, timezone, consentimento_* etc.
 *
 * Casos que precisam passar após a migration: [1]..[14].
 *
 * NOTA de regressão: rls_lojas.test.ts [14] hoje DOCUMENTA que a RLS PERMITE o
 * dono escrever assinatura_status. Após este trigger, aquele comportamento muda
 * (passa a ser bloqueado). A fase GREEN deve ATUALIZAR rls_lojas.test.ts [14]
 * para refletir o novo invariante (o gate deixou de ser só Server Action e
 * passou a ser também o trigger no banco), evitando suite vermelha por
 * expectativa obsoleta.
 */
