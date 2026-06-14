import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 015 — defesa em profundidade da RN-01 no BANCO (D3 do plano).
 *
 * A checagem autoritativa de "uma loja por dono" é `contarLojasDoDono` na Server
 * Action. Mas um duplo-submit em corrida pode passar pelas duas contagens antes
 * de qualquer INSERT. A barreira física é um ÍNDICE ÚNICO em `lojas(dono_id)`,
 * criado pela migration `<ts>_unique_loja_por_dono.sql` (fase GREEN).
 *
 * Por que isto é RED de verdade: a migration AINDA NÃO EXISTE. Logo, o 2º INSERT
 * com o mesmo `dono_id` HOJE passa (não há UNIQUE) — o teste [RN-01] espera que
 * ele FALHE com 23505. Antes da migration → vermelho. Depois → verde.
 *
 * Os demais testes provam o CONTRATO que a Server Action grava (consentimento +
 * trial + dono_id), persistido via service_role — espelho do que `criarLoja`
 * fará na fase GREEN.
 *
 * Anti-falso-verde (padrão de queries_lojas.test.ts): negações/erros são
 * reconferidos via service (BYPASSRLS) de que o estado real é o esperado.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const DONO_C = "cccccccc-cccc-cccc-cccc-cccccccccccc"; // sem loja — usado p/ isolar a colisão de slug

const VERSAO_TERMOS = "2026-06-13"; // constante do servidor (D8 do plano)

async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a@teste.local'),
       ($2, 'dono-b@teste.local'),
       ($3, 'dono-c@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B, DONO_C],
  );
}

describe("015 RN-01 — índice único parcial lojas(dono_id) + contrato de cadastro", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
    await garantirDonos(t);
  });
  afterAll(async () => {
    await t.close();
  });

  it("[contrato] cadastro grava dono_id + consentimento + trial via service_role", async () => {
    // Espelho do INSERT que a action faz: o SERVIDOR decide consentimento e trial,
    // o client NUNCA envia esses campos.
    const r = await t.asService((db) =>
      db.query<{
        dono_id: string;
        nome: string;
        consentimento_versao: string;
        assinatura_status: string;
        consentimento_em: string;
        assinatura_fim_periodo: string;
      }>(
        `insert into public.lojas
           (dono_id, slug, nome, consentimento_em, consentimento_versao,
            assinatura_status, assinatura_fim_periodo)
         values ($1, 'dono-a', '', now(), $2, 'trial', now() + interval '14 days')
         returning dono_id, nome, consentimento_versao, assinatura_status,
                   consentimento_em, assinatura_fim_periodo`,
        [DONO_A, VERSAO_TERMOS],
      ),
    );
    const loja = r.rows[0];
    expect(loja.dono_id).toBe(DONO_A);
    expect(loja.nome).toBe(""); // nome nasce vazio
    expect(loja.consentimento_versao).toBe(VERSAO_TERMOS);
    expect(loja.assinatura_status).toBe("trial");
    expect(loja.consentimento_em).not.toBeNull();

    // assinatura_fim_periodo ≈ now() + 14 dias (servidor decide, não o payload)
    const fim = new Date(loja.assinatura_fim_periodo).getTime();
    const esperado = Date.now() + 14 * 24 * 60 * 60 * 1000;
    const tolerancia = 60 * 60 * 1000; // 1h de folga
    expect(Math.abs(fim - esperado)).toBeLessThan(tolerancia);
  });

  it("[RN-01] 2ª loja do MESMO dono falha com unique_violation (23505)", async () => {
    // DONO_A já tem 1 loja (teste anterior). A 2ª deve ser barrada pelo índice
    // único lojas(dono_id). SEM a migration, este INSERT PASSA → RED.
    await expect(
      t.asService((db) =>
        db.query(
          `insert into public.lojas (dono_id, slug, nome) values ($1, 'dono-a-2', '')`,
          [DONO_A],
        ),
      ),
    ).rejects.toMatchObject({ code: "23505" });

    // Anti-falso-verde: confirma que DONO_A continua com exatamente 1 loja.
    const c = await t.asService((db) =>
      db.query<{ n: number }>(
        `select count(*)::int as n from public.lojas where dono_id = $1`,
        [DONO_A],
      ),
    );
    expect(c.rows[0].n).toBe(1);
  });

  it("[RN-01] dono DIFERENTE pode criar a sua loja (índice é por dono, não global)", async () => {
    // O índice não pode bloquear outro dono — só o mesmo dono_id.
    const r = await t.asService((db) =>
      db.query<{ dono_id: string }>(
        `insert into public.lojas (dono_id, slug, nome) values ($1, 'dono-b', '')
         returning dono_id`,
        [DONO_B],
      ),
    );
    expect(r.rows[0].dono_id).toBe(DONO_B);
  });

  it("[unicidade slug] slug duplicado falha com 23505 (defesa em profundidade, já existente)", async () => {
    // Pré-existente no schema (UNIQUE(slug)); aqui só firma que a corrida de slug
    // tem barreira física, complementar ao loop de sufixo da action.
    // DONO_C não tem loja → o ÚNICO motivo da falha é o slug 'dono-b' já usado.
    await expect(
      t.asService((db) =>
        db.query(
          `insert into public.lojas (dono_id, slug, nome) values ($1, 'dono-b', '')`,
          [DONO_C],
        ),
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
