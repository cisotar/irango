import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) — issue 057 (crítica: SIM). Camada SQL/RLS real (pglite).
 *
 * Prova o CONTRATO de duas garantias de segurança do webhook Hotmart, ambas no
 * banco (a fonte autoritativa), antes de existir qualquer código:
 *
 *  1. `public.loja_por_email_dono(text)` — função SECURITY DEFINER (D5, migration
 *     NOVA ainda não escrita) que mapeia comprador→loja via JOIN `lojas ⋈
 *     auth.users` por email. É a única forma de ler através de `auth.users`
 *     (que não é tabela PostgREST). RED real: a função NÃO EXISTE em nenhuma
 *     migration → a query estoura "function ... does not exist".
 *
 *  2. Idempotência via `UNIQUE(evento_id)` em `webhook_eventos_hotmart` — o
 *     segundo INSERT do mesmo `evento_id` PRECISA estourar 23505 (unique_violation).
 *     É a trava atômica que impede replay reativar assinatura suspensa (RN-A3).
 *     (A tabela/constraint já existem na migration 000129 — este caso JÁ passaria;
 *     mantido como invariante de segurança que a fase GREEN não pode quebrar.)
 *
 * Anti-falso-verde: a negação por "loja não existe" é reconferida via service de
 * que o dado-base realmente existe; a idempotência é provada capturando o ERRO.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const DONO_SEM_LOJA = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const EMAIL_A = "dono-a@teste.local";
const EMAIL_B = "dono-b@teste.local";
const EMAIL_SEM_LOJA = "sem-loja@teste.local";
const EMAIL_INEXISTENTE = "ninguem@teste.local";

async function criarCenario(t: TestDb): Promise<{ lojaA: string; lojaB: string }> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, $4), ($2, $5), ($3, $6)
     on conflict (id) do nothing`,
    [DONO_A, DONO_B, DONO_SEM_LOJA, EMAIL_A, EMAIL_B, EMAIL_SEM_LOJA],
  );
  return t.asService(async (db) => {
    const a = await db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo)
       values ($1, 'loja-a', 'Loja A', true) returning id`,
      [DONO_A],
    );
    const b = await db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo)
       values ($1, 'loja-b', 'Loja B', true) returning id`,
      [DONO_B],
    );
    return { lojaA: a.rows[0].id, lojaB: b.rows[0].id };
  });
}

describe("057 loja_por_email_dono — mapeamento comprador→loja (D5, SECURITY DEFINER)", () => {
  let t: TestDb;
  let ids: { lojaA: string; lojaB: string };

  beforeAll(async () => {
    t = await createTestDb();
    ids = await criarCenario(t);
  });
  afterAll(async () => {
    await t.close();
  });

  it("[1] email de dono → retorna a loja desse dono (1 linha)", async () => {
    const r = await t.asService((db) =>
      db.query<{ id: string; dono_id: string }>(
        `select * from public.loja_por_email_dono($1)`,
        [EMAIL_A],
      ),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.lojaA);
    expect(r.rows[0].dono_id).toBe(DONO_A);
  });

  it("[2] isolamento: email do dono B → loja B (nunca a loja de A)", async () => {
    const r = await t.asService((db) =>
      db.query<{ id: string }>(`select * from public.loja_por_email_dono($1)`, [EMAIL_B]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.lojaB);
  });

  it("[3] case-insensitive: email com caixa diferente ainda casa (lower() nos dois lados)", async () => {
    const r = await t.asService((db) =>
      db.query<{ id: string }>(`select * from public.loja_por_email_dono($1)`, [
        EMAIL_A.toUpperCase(),
      ]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.lojaA);
  });

  it("[4] usuário existe mas NÃO é dono de loja → vazio (reconciliação fica p/ 059)", async () => {
    const r = await t.asService((db) =>
      db.query(`select * from public.loja_por_email_dono($1)`, [EMAIL_SEM_LOJA]),
    );
    expect(r.rows.length).toBe(0);
    // anti-falso-verde: o usuário REALMENTE existe (vazio é por não ter loja, não por email ausente)
    const u = await t.asService((db) =>
      db.query(`select 1 from auth.users where lower(email) = lower($1)`, [EMAIL_SEM_LOJA]),
    );
    expect(u.rows.length).toBe(1);
  });

  it("[5] email sem usuário nenhum → vazio (handler grava loja_id null, responde 200)", async () => {
    const r = await t.asService((db) =>
      db.query(`select * from public.loja_por_email_dono($1)`, [EMAIL_INEXISTENTE]),
    );
    expect(r.rows.length).toBe(0);
  });
});

describe("057 idempotência — UNIQUE(evento_id) é a trava de replay (RN-A3)", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("[6] segundo INSERT do MESMO evento_id estoura unique_violation (23505)", async () => {
    await t.asService((db) =>
      db.query(
        `insert into public.webhook_eventos_hotmart (evento_id, evento_tipo, payload)
         values ($1, 'PURCHASE_APPROVED', '{}'::jsonb)`,
        ["evt-replay-1"],
      ),
    );

    const segundoInsert = t.asService((db) =>
      db.query(
        `insert into public.webhook_eventos_hotmart (evento_id, evento_tipo, payload)
         values ($1, 'PURCHASE_APPROVED', '{}'::jsonb)`,
        ["evt-replay-1"],
      ),
    );

    await expect(segundoInsert).rejects.toMatchObject({ code: "23505" });

    // anti-falso-verde: existe exatamente 1 linha (o segundo não entrou)
    const n = await t.asService((db) =>
      db.query<{ c: number }>(
        `select count(*)::int as c from public.webhook_eventos_hotmart where evento_id = $1`,
        ["evt-replay-1"],
      ),
    );
    expect(n.rows[0].c).toBe(1);
  });
});
