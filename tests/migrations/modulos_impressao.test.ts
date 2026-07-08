import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * TDD RED — issue 127: colunas de entitlement dos módulos de impressão em `lojas`.
 * Migration alvo (ainda NÃO criada, é da fase GREEN/`executar`):
 *   supabase/migrations/20260707120000_lojas_modulos_impressao.sql
 *   ALTER TABLE lojas
 *     ADD COLUMN modulo_impressao_a4      boolean NOT NULL DEFAULT false,
 *     ADD COLUMN modulo_impressao_termica boolean NOT NULL DEFAULT false;
 *
 * Enquanto a migration não existir, o pglite não tem as colunas e os testes [1]/[2]
 * falham (erro `42703 undefined_column`). Este é o vermelho esperado.
 *
 * Contrato provado aqui (crítico = burla de billing se quebrar):
 *  [1] FAIL-CLOSED: uma `lojas` inserida sem citar as colunas nasce com AMBAS
 *      `false`. Um DEFAULT `true` (ou ausência de default) liberaria módulos pagos
 *      para toda loja — RN-M1.
 *  [2] NOT NULL: INSERT com `modulo_impressao_a4 = NULL` explícito é rejeitado
 *      (23502). Sem o NOT NULL, um NULL viraria "entitlement indefinido".
 *  [2b] NOT NULL simétrico: o mesmo para `modulo_impressao_termica`. As duas
 *      colunas são declaradas em ADD COLUMNs separados na mesma migration — um
 *      `NOT NULL` esquecido só na segunda (ex.: erro de copy-paste) passaria
 *      despercebido pelo teste [1] (DEFAULT ainda entrega `false` nas duas) e
 *      pelo [3] (view). Confirmado por simulação: removendo `NOT NULL` só de
 *      `modulo_impressao_termica` na migration, os testes [1]/[2]/[3] originais
 *      continuavam todos verdes — por isso este caso precisa de asserção própria.
 *  [3] NÃO-VAZAMENTO: a view pública `vitrine_lojas` NÃO projeta nenhuma das duas
 *      colunas (entitlement é dado interno do painel; a vitrine nunca deve expor
 *      quais módulos a loja contratou). Guarda permanente — passa em RED e GREEN.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aa0000000127";
// dono_id tem índice único em `lojas` (unique_loja_por_dono): DONO_A já ganha uma
// loja no teste [1]. O teste [2b] usa um dono PRÓPRIO para isolar a checagem de
// NOT NULL de `modulo_impressao_termica` — se reusasse DONO_A e o NOT NULL fosse
// removido por bug, o INSERT seguiria até o índice único de dono_id e rejeitaria
// com 23505 (dono duplicado), mascarando a ausência do NOT NULL sob um erro
// coincidente. Com dono isolado, a ausência do NOT NULL vira INSERT bem-sucedido
// (a asserção `rejects` falha de forma limpa), provando exatamente o que se quer.
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bb0000000127";

const SLUG_DEFAULT = "loja-modulos-default-127";
const SLUG_NULL = "loja-modulos-null-127";
const SLUG_NULL_TERMICA = "loja-modulos-null-termica-127";

async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a-127@teste.local'),
       ($2, 'dono-b-127@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B],
  );
}

describe("127 lojas.modulo_impressao_a4/termica (fail-closed) + guarda vitrine_lojas", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
    await garantirDonos(t);
  });
  afterAll(async () => {
    await t.close();
  });

  it("[1] INSERT sem citar as colunas nasce com AMBAS false (fail-closed DEFAULT)", async () => {
    const r = await t.asService((db) =>
      db.query<{
        id: string;
        modulo_impressao_a4: boolean;
        modulo_impressao_termica: boolean;
      }>(
        `insert into public.lojas (dono_id, slug, nome, ativo)
         values ($1, $2, 'Loja Módulos Default', true)
         returning id, modulo_impressao_a4, modulo_impressao_termica`,
        [DONO_A, SLUG_DEFAULT],
      ),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].modulo_impressao_a4).toBe(false);
    expect(r.rows[0].modulo_impressao_termica).toBe(false);
  });

  it("[2] NOT NULL: INSERT com modulo_impressao_a4 = NULL explícito é rejeitado (23502)", async () => {
    await expect(
      t.asService((db) =>
        db.query(
          `insert into public.lojas (dono_id, slug, nome, ativo, modulo_impressao_a4)
           values ($1, $2, 'Loja Módulos Null', true, null)`,
          [DONO_A, SLUG_NULL],
        ),
      ),
    ).rejects.toMatchObject({ code: "23502" }); // not_null_violation

    // anti-falso-verde: a rejeição impediu a linha de existir
    const conf = await t.asService((db) =>
      db.query(`select 1 from public.lojas where slug = $1`, [SLUG_NULL]),
    );
    expect(conf.rows.length).toBe(0);
  });

  it("[2b] NOT NULL simétrico: INSERT com modulo_impressao_termica = NULL explícito é rejeitado (23502)", async () => {
    await expect(
      t.asService((db) =>
        db.query(
          `insert into public.lojas (dono_id, slug, nome, ativo, modulo_impressao_termica)
           values ($1, $2, 'Loja Módulos Null Térmica', true, null)`,
          [DONO_B, SLUG_NULL_TERMICA],
        ),
      ),
    ).rejects.toMatchObject({ code: "23502" }); // not_null_violation

    // anti-falso-verde: a rejeição impediu a linha de existir
    const conf = await t.asService((db) =>
      db.query(`select 1 from public.lojas where slug = $1`, [SLUG_NULL_TERMICA]),
    );
    expect(conf.rows.length).toBe(0);
  });

  it("[3] guarda de não-vazamento: vitrine_lojas NÃO projeta as colunas de entitlement", async () => {
    // âncora anti-falso-verde: a view existe e é legível — a falha abaixo é da
    // COLUNA (entitlement fora da view), não de a view inexistir/estar sem grant.
    const ok = await t.asAnon((db) =>
      db.query(`select slug from public.vitrine_lojas limit 1`),
    );
    expect(Array.isArray(ok.rows)).toBe(true);

    await expect(
      t.asAnon((db) => db.query(`select modulo_impressao_a4 from public.vitrine_lojas`)),
    ).rejects.toMatchObject({ code: "42703" }); // undefined_column

    await expect(
      t.asAnon((db) => db.query(`select modulo_impressao_termica from public.vitrine_lojas`)),
    ).rejects.toMatchObject({ code: "42703" }); // undefined_column
  });
});
