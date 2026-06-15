import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 065 — reconciliação de user órfão.
 *
 * Contrato sob teste: a função SQL `public.garantir_loja_do_dono(p_dono_id uuid,
 * p_email text, p_versao_termos text) -> uuid` que NASCE na migration
 * `2026XXXX_auth_users_cria_loja.sql` (fase GREEN). Ela é a FONTE ÚNICA de "como
 * nasce uma loja": cria a loja do dono se não existe, com trial + consentimento
 * decididos 100% server-side, e é IDEMPOTENTE (RN-01) — chamá-la N vezes ou em
 * corrida produz exatamente 1 loja.
 *
 * Por que isto é RED de verdade (não acidente de compilação):
 *  - A função `garantir_loja_do_dono` AINDA NÃO EXISTE no banco. Toda chamada
 *    `select public.garantir_loja_do_dono(...)` falha com `42883`
 *    (undefined_function). Os testes asseram o COMPORTAMENTO esperado da função
 *    presente; antes da migration → vermelho.
 *  - Não há import de símbolo TS inexistente: o alvo é SQL, exercido via pglite.
 *    Logo o RED é por ASSERÇÃO/erro de runtime, não por type-check quebrado.
 *
 * Anti-falso-verde (padrão de unique_loja_por_dono / queries_lojas): o estado
 * real é reconferido via service_role (BYPASSRLS) após cada chamada.
 *
 * Dependências de schema já presentes (não criadas aqui):
 *  - `lojas_dono_unico` (unique index em lojas(dono_id)) — trava física da race.
 *  - CHECK `lojas.slug ~ '^[a-z0-9-]+$'` + UNIQUE(slug) — guarda final do slug.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const DONO_RACE = "dddddddd-dddd-dddd-dddd-dddddddddddd";

// Issue 068 — TOCTOU de slug. Donos da colisão de slug entre tenants distintos.
// Mesma parte local de email ('joao.silva') em domínios diferentes → mesmo
// slug-base 'joao-silva'. Sufixo de re-derivação da fn = primeiros 8 hex do
// dono_id sem hífens. Para TOCTOU_B = cccc...  → sufixo 'cccccccc' →
// slug sufixado esperado 'joao-silva-cccccccc'.
const TOCTOU_A = "1aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; // ocupa o slug-base 'joao-silva'
const TOCTOU_B = "cccccccc-cccc-cccc-cccc-cccccccccccc"; // dono SEM loja, slug colide
const TOCTOU_C = "2ccccccc-cccc-cccc-cccc-cccccccccccc"; // pré-ocupa o slug sufixado de B

const VERSAO_TERMOS = "2026-06-13"; // constante do servidor (injetada pelo app na cura)

async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'joao.silva@teste.local'),
       ($2, 'maria@teste.local'),
       ($3, 'corredor@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B, DONO_RACE],
  );
}

/** Chama a RPC como service_role (a auto-cura do guard a invoca assim). */
function chamarRpc(t: TestDb, donoId: string, email: string) {
  return t.asService((db) =>
    db.query<{ loja_id: string }>(
      `select public.garantir_loja_do_dono($1, $2, $3) as loja_id`,
      [donoId, email, VERSAO_TERMOS],
    ),
  );
}

function contarLojas(t: TestDb, donoId: string) {
  return t.asService((db) =>
    db.query<{ n: number }>(
      `select count(*)::int as n from public.lojas where dono_id = $1`,
      [donoId],
    ),
  );
}

describe("065 — garantir_loja_do_dono (reconciliação de user órfão, fase RED)", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
    await garantirDonos(t);
  });
  afterAll(async () => {
    await t.close();
  });

  it("[cria] user órfão sem loja → fn cria loja com trial + consentimento + ativo=false", async () => {
    const r = await chamarRpc(t, DONO_A, "joao.silva@teste.local");
    const lojaId = r.rows[0].loja_id;
    expect(lojaId).toBeTruthy();

    // Anti-falso-verde: relê a linha real e confere o contrato server-side.
    const loja = await t.asService((db) =>
      db.query<{
        id: string;
        dono_id: string;
        nome: string;
        slug: string;
        ativo: boolean;
        consentimento_versao: string;
        consentimento_em: string | null;
        assinatura_status: string;
        assinatura_fim_periodo: string | null;
      }>(
        `select id, dono_id, nome, slug, ativo, consentimento_versao,
                consentimento_em, assinatura_status, assinatura_fim_periodo
           from public.lojas where dono_id = $1`,
        [DONO_A],
      ),
    );
    const l = loja.rows[0];
    expect(l.id).toBe(lojaId); // a fn retorna o id da loja criada
    expect(l.dono_id).toBe(DONO_A);
    expect(l.nome).toBe(""); // nome nasce vazio (lojista preenche no perfil)
    expect(l.ativo).toBe(false); // loja curada nasce INATIVA (seguranca.md §17)
    expect(l.consentimento_versao).toBe(VERSAO_TERMOS); // versão vinda do app
    expect(l.consentimento_em).not.toBeNull(); // consentimento decidido no servidor
    expect(l.assinatura_status).toBe("trial");

    // trial ≈ now() + 14 dias — decidido pelo servidor, nunca pelo cliente.
    expect(l.assinatura_fim_periodo).not.toBeNull();
    const fim = new Date(l.assinatura_fim_periodo as string).getTime();
    const esperado = Date.now() + 14 * 24 * 60 * 60 * 1000;
    expect(Math.abs(fim - esperado)).toBeLessThan(60 * 60 * 1000); // 1h de folga
  });

  it("[slug] slug derivado do email é válido pela regex lojas_slug_formato", async () => {
    // A parte local 'joao.silva' tem '.' (inválido p/ o CHECK '^[a-z0-9-]+$').
    // A fn deve sanitizar para um slug que PASSE no CHECK (senão o INSERT falharia).
    const r = await t.asService((db) =>
      db.query<{ slug: string }>(
        `select slug from public.lojas where dono_id = $1`,
        [DONO_A],
      ),
    );
    const slug = r.rows[0].slug;
    expect(slug).toMatch(/^[a-z0-9-]+$/); // mesma regra do CHECK do banco
    expect(slug.length).toBeGreaterThan(0);
  });

  it("[RN-01 idempotente] chamar 2x o MESMO dono → ainda 1 loja, mesmo id", async () => {
    // DONO_B ainda não tem loja. 1ª chamada cria, 2ª é no-op idempotente.
    const r1 = await chamarRpc(t, DONO_B, "maria@teste.local");
    const id1 = r1.rows[0].loja_id;
    expect(id1).toBeTruthy();

    const r2 = await chamarRpc(t, DONO_B, "maria@teste.local");
    const id2 = r2.rows[0].loja_id;

    // A 2ª chamada NÃO cria loja nova e retorna o MESMO id (idempotência total).
    expect(id2).toBe(id1);

    const c = await contarLojas(t, DONO_B);
    expect(c.rows[0].n).toBe(1); // jamais duplica (RN-01)
  });

  it("[RN-01 race] duas chamadas concorrentes do mesmo órfão → 1 loja", async () => {
    // DONO_RACE sem loja. Dispara as duas chamadas em paralelo (dois logins
    // simultâneos). O índice único lojas(dono_id) + ON CONFLICT garante que a 2ª
    // inserção é no-op; ambas terminam com a MESMA loja. Nunca 2 lojas, nunca
    // exceção propagada (a fn trata 23505 como idempotente).
    const [a, b] = await Promise.all([
      chamarRpc(t, DONO_RACE, "corredor@teste.local"),
      chamarRpc(t, DONO_RACE, "corredor@teste.local"),
    ]);

    expect(a.rows[0].loja_id).toBeTruthy();
    expect(b.rows[0].loja_id).toBeTruthy();
    expect(a.rows[0].loja_id).toBe(b.rows[0].loja_id); // mesma loja nas duas pontas

    const c = await contarLojas(t, DONO_RACE);
    expect(c.rows[0].n).toBe(1); // exatamente 1 loja apesar da corrida
  });

  it("[068 TOCTOU] colisão de slug entre donos distintos → fn ainda retorna loja válida de B (não NULL)", async () => {
    // DB isolado: não interferir no estado compartilhado dos casos da 065.
    const u = await createTestDb();
    try {
      await u.db.query(
        `insert into auth.users (id, email) values
           ($1, 'joao.silva@a.local'),
           ($2, 'joao.silva@b.local'),
           ($3, 'ocupante@c.local')
         on conflict (id) do nothing`,
        [TOCTOU_A, TOCTOU_B, TOCTOU_C],
      );

      // Dono A cria sua loja → ocupa o slug-base 'joao-silva'.
      const ra = await chamarRpc(u, TOCTOU_A, "joao.silva@a.local");
      const slugA = await u.asService((db) =>
        db.query<{ slug: string }>(
          `select slug from public.lojas where dono_id = $1`,
          [TOCTOU_A],
        ),
      );
      expect(slugA.rows[0].slug).toBe("joao-silva");

      // Pré-ocupa o slug SUFIXADO que B vai derivar ('joao-silva-cccccccc'),
      // forçando o INSERT de B a violar o índice único de slug DEPOIS do EXISTS
      // ter sufixado — exatamente a janela TOCTOU. Inserção direta via service.
      await u.asService((db) =>
        db.query(
          `insert into public.lojas (
             dono_id, nome, slug, ativo,
             consentimento_em, consentimento_versao,
             assinatura_status, assinatura_fim_periodo
           ) values ($1, '', 'joao-silva-cccccccc', false, now(), $2, 'trial', now() + interval '14 days')`,
          [TOCTOU_C, VERSAO_TERMOS],
        ),
      );

      // Ação: cura de B. Slug-base 'joao-silva' já existe → fn sufixa para
      // 'joao-silva-cccccccc', que TAMBÉM já existe → INSERT viola UNIQUE(slug)
      // → cai no EXCEPTION WHEN unique_violation → re-SELECT por dono_id de B
      // (que não tem loja) → v_id NULL. RED: contrato "nunca NULL" quebrado.
      const rb = await chamarRpc(u, TOCTOU_B, "joao.silva@b.local");
      const lojaIdB = rb.rows[0].loja_id;

      // (1) Contrato central: B recebe uma loja válida, não NULL.
      expect(lojaIdB).toBeTruthy();

      // (2) Estado real: exatamente 1 loja para B, com id == retorno, slug
      // válido pela regex do CHECK e DISTINTO do slug de A.
      const lojaB = await u.asService((db) =>
        db.query<{
          id: string;
          slug: string;
          ativo: boolean;
          assinatura_status: string;
          consentimento_em: string | null;
        }>(
          `select id, slug, ativo, assinatura_status, consentimento_em
             from public.lojas where dono_id = $1`,
          [TOCTOU_B],
        ),
      );
      expect(lojaB.rows).toHaveLength(1);
      const lb = lojaB.rows[0];
      expect(lb.id).toBe(lojaIdB);
      expect(lb.slug).toMatch(/^[a-z0-9-]+$/);
      expect(lb.slug).not.toBe("joao-silva"); // distinto do slug de A
      // Contrato server-side intacto na loja curada de B.
      expect(lb.ativo).toBe(false);
      expect(lb.assinatura_status).toBe("trial");
      expect(lb.consentimento_em).not.toBeNull();

      // (3) Idempotência por dono_id preservada: 2ª chamada de B → mesmo id, ainda 1 loja.
      const rb2 = await chamarRpc(u, TOCTOU_B, "joao.silva@b.local");
      expect(rb2.rows[0].loja_id).toBe(lojaIdB);
      const cb = await contarLojas(u, TOCTOU_B);
      expect(cb.rows[0].n).toBe(1);

      // Sanidade: a loja de A não foi afetada.
      expect(ra.rows[0].loja_id).toBeTruthy();
    } finally {
      await u.close();
    }
  });
});
