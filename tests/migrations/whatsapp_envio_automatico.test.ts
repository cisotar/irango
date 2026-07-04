import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Testes da migration `20260704120000_lojas_whatsapp_envio_automatico.sql`
 * (issue 121 — já implementada/GREEN, cobertura pós-hoc).
 *
 * A guarda estática [G3] de `vitrine_lojas_select_only.test.ts` já prova que
 * toda (re)criação de `vitrine_lojas` — incluindo esta migration — tem revoke
 * de escrita no mesmo arquivo. Este arquivo cobre o que o G3 NÃO prova:
 *
 *  [1] `lojas.whatsapp_envio_automatico` nasce `true` por DEFAULT quando o
 *      INSERT nem menciona a coluna (contrato do "lojas existentes ficam
 *      ligadas automaticamente").
 *  [2] a coluna é `NOT NULL` (INSERT explícito com NULL é rejeitado).
 *  [3] a view `vitrine_lojas` projeta `whatsapp_envio_automatico` (o checkout
 *      lê o valor via `buscarLojaPorSlug`, que lê a view — sem isso o preview
 *      client-side do toggle nunca vê o valor real da loja).
 *  [4] a view reflete `false` quando o lojista desliga o toggle (não é um
 *      valor congelado no `create view` — lê a coluna ao vivo).
 *  [5] loja INATIVA continua fora da view (a recriação não pode ter afrouxado
 *      o filtro `where ativo = true` ao trocar a lista de colunas).
 *
 * Anti-falso-verde: todo valor da view é reconferido via `asService` (fonte de
 * verdade na tabela base).
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aa0000000121";
const DONO_INATIVA = "bbbbbbbb-bbbb-bbbb-bbbb-bb0000000121";

const SLUG_A = "loja-a-whatsapp-121";
const SLUG_INATIVA = "loja-inativa-whatsapp-121";

async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a-121@teste.local'),
       ($2, 'dono-inativa-121@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_INATIVA],
  );
}

describe("121 lojas.whatsapp_envio_automatico + vitrine_lojas", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
    await garantirDonos(t);
  });
  afterAll(async () => {
    await t.close();
  });

  it("[1] INSERT sem mencionar a coluna nasce whatsapp_envio_automatico = true (DEFAULT)", async () => {
    const r = await t.asService((db) =>
      db.query<{ id: string; whatsapp_envio_automatico: boolean }>(
        `insert into public.lojas (dono_id, slug, nome, ativo)
         values ($1, $2, 'Loja A', true)
         returning id, whatsapp_envio_automatico`,
        [DONO_A, SLUG_A],
      ),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].whatsapp_envio_automatico).toBe(true);
  });

  it("[2] NOT NULL: INSERT com whatsapp_envio_automatico = NULL explícito é rejeitado", async () => {
    await expect(
      t.asService((db) =>
        db.query(
          `insert into public.lojas (dono_id, slug, nome, ativo, whatsapp_envio_automatico)
           values ($1, 'loja-null-121', 'Loja Null', true, null)`,
          [DONO_A],
        ),
      ),
    ).rejects.toMatchObject({ code: "23502" }); // not_null_violation

    // anti-falso-verde: a rejeição impediu a linha de existir
    const conf = await t.asService((db) =>
      db.query(`select 1 from public.lojas where slug = 'loja-null-121'`),
    );
    expect(conf.rows.length).toBe(0);
  });

  it("[3] vitrine_lojas projeta whatsapp_envio_automatico = true para a loja recém-criada", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ whatsapp_envio_automatico: boolean }>(
        `select whatsapp_envio_automatico from public.vitrine_lojas where slug = $1`,
        [SLUG_A],
      ),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].whatsapp_envio_automatico).toBe(true);
  });

  it("[4] lojista desliga o toggle (false) e a view reflete ao vivo, não um valor congelado", async () => {
    await t.asService((db) =>
      db.query(`update public.lojas set whatsapp_envio_automatico = false where slug = $1`, [
        SLUG_A,
      ]),
    );

    const viaView = await t.asAnon((db) =>
      db.query<{ whatsapp_envio_automatico: boolean }>(
        `select whatsapp_envio_automatico from public.vitrine_lojas where slug = $1`,
        [SLUG_A],
      ),
    );
    expect(viaView.rows[0].whatsapp_envio_automatico).toBe(false);

    // anti-falso-verde: fonte de verdade concorda
    const viaBase = await t.asService((db) =>
      db.query<{ whatsapp_envio_automatico: boolean }>(
        `select whatsapp_envio_automatico from public.lojas where slug = $1`,
        [SLUG_A],
      ),
    );
    expect(viaBase.rows[0].whatsapp_envio_automatico).toBe(false);
  });

  it("[5] loja INATIVA continua fora de vitrine_lojas após a recriação da view (filtro ativo=true intacto)", async () => {
    await t.asService((db) =>
      db.query(
        `insert into public.lojas (dono_id, slug, nome, ativo, whatsapp_envio_automatico)
         values ($1, $2, 'Loja Inativa', false, true)`,
        [DONO_INATIVA, SLUG_INATIVA],
      ),
    );

    const r = await t.asAnon((db) =>
      db.query(`select 1 from public.vitrine_lojas where slug = $1`, [SLUG_INATIVA]),
    );
    expect(r.rows.length).toBe(0);

    // anti-falso-verde: a loja inativa realmente existe (negação é por filtro, não ausência)
    const conf = await t.asService((db) =>
      db.query(`select 1 from public.lojas where slug = $1`, [SLUG_INATIVA]),
    );
    expect(conf.rows.length).toBe(1);
  });
});
