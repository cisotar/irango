import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Issue 329 (crítica: SIM) — isolamento do ATALHO para `saiu_entrega` sob RLS
 * real (spec `specs/status-pedido-clicavel-e-latencia.md`, Segurança →
 * "Edição de pedido de outra loja"; RN-SC2 + RN-SC4).
 *
 * TRAVA — verde esperado desde já: a v1 não tem migration, a RLS
 * `pedidos_acesso_lojista` não muda. O teste prova que o predicado que a action
 * nova manda ao banco em UMA ida —
 *
 *   update pedidos set status = 'saiu_entrega'
 *    where id = $1 and status in (origensPermitidas('saiu_entrega'))
 *
 * — sob `asUser(donoA)`:
 *   - no pedido da loja B, em QUALQUER origem permitida, afeta 0 linhas e o
 *     status de B lido por `asService` fica intacto (RLS, não "dado ausente");
 *   - no pedido da PRÓPRIA loja já `entregue`, afeta 0 linhas e fica intacto
 *     (o atalho não reabre terminal);
 *   - controle positivo: no pedido pendente da própria loja afeta 1 linha — a
 *     negação acima é da RLS/predicado, não de um predicado que nunca casa.
 *
 * Afirma contagem de linhas E leitura via `asService` em todo caso, nunca só
 * ausência de erro.
 *
 * `ORIGENS_SAIU` é literal de propósito (é a tabela da RN-SC2, não a função):
 * a derivação por `origensPermitidas` é provada em `acoesStatusPedido.test.ts` e
 * a forma do UPDATE em `src/lib/actions/status.test.ts`.
 */

const DONO_A = "a3290000-0000-4000-8000-000000000001";
const DONO_B = "b3290000-0000-4000-8000-000000000002";

const ORIGENS_SAIU = ["pendente", "confirmado", "em_preparo"] as const;

const UPDATE_ATALHO = `update public.pedidos set status = 'saiu_entrega'
   where id = $1 and status in ($2, $3, $4)
   returning id`;

describe("329 — atalho para saiu_entrega: isolamento entre lojas e terminal (pglite, RLS real)", () => {
  let t: TestDb;
  let pedidoB: string;
  let pedidoAEntregue: string;
  let pedidoAPendente: string;

  async function statusDe(id: string): Promise<string | undefined> {
    const r = await t.asService((db) =>
      db.query<{ status: string }>(`select status from public.pedidos where id = $1`, [id]),
    );
    return r.rows[0]?.status;
  }

  async function atalhoComo(dono: string, pedidoId: string) {
    return t.asUser(dono, (db) =>
      db.query<{ id: string }>(UPDATE_ATALHO, [pedidoId, ...ORIGENS_SAIU]),
    );
  }

  beforeAll(async () => {
    t = await createTestDb();
    await t.db.query(
      `insert into auth.users (id, email) values
         ($1, 'dono-a-329@teste.local'),
         ($2, 'dono-b-329@teste.local')
       on conflict (id) do nothing`,
      [DONO_A, DONO_B],
    );
    await t.asService(async (db) => {
      const lojas = await db.query<{ id: string; dono_id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo) values
           ($1, 'loja-a-329', 'Loja A', true),
           ($2, 'loja-b-329', 'Loja B', true)
         returning id, dono_id`,
        [DONO_A, DONO_B],
      );
      const lojaA = lojas.rows.find((l) => l.dono_id === DONO_A)!.id;
      const lojaB = lojas.rows.find((l) => l.dono_id === DONO_B)!.id;

      const inserir = async (lojaId: string, status: string) => {
        const r = await db.query<{ id: string }>(
          `insert into public.pedidos (loja_id, nome_cliente, subtotal, total, status)
             values ($1, 'Cliente 329', 40.00, 40.00, $2) returning id`,
          [lojaId, status],
        );
        return r.rows[0].id;
      };
      pedidoB = await inserir(lojaB, "pendente");
      pedidoAEntregue = await inserir(lojaA, "entregue");
      pedidoAPendente = await inserir(lojaA, "pendente");
    });
  }, 120_000);

  afterAll(async () => {
    await t.close();
  });

  it.each(ORIGENS_SAIU)(
    "dono A NÃO aplica o atalho no pedido da loja B em '%s' → 0 linhas; asService lê B intacto",
    async (origem) => {
      await t.asService((db) =>
        db.query(`update public.pedidos set status = $1 where id = $2`, [origem, pedidoB]),
      );
      expect(await statusDe(pedidoB)).toBe(origem); // anti-falso-verde: a linha existe

      const r = await atalhoComo(DONO_A, pedidoB);

      expect(r.affectedRows).toBe(0);
      expect(r.rows).toHaveLength(0);
      expect(await statusDe(pedidoB)).toBe(origem);
    },
  );

  it("dono A NÃO aplica o atalho no PRÓPRIO pedido já entregue → 0 linhas; asService lê 'entregue'", async () => {
    expect(await statusDe(pedidoAEntregue)).toBe("entregue");

    const r = await atalhoComo(DONO_A, pedidoAEntregue);

    expect(r.affectedRows).toBe(0);
    expect(r.rows).toHaveLength(0);
    expect(await statusDe(pedidoAEntregue)).toBe("entregue");
  });

  it("controle positivo: dono A aplica o atalho no PRÓPRIO pedido pendente → 1 linha; asService lê 'saiu_entrega'", async () => {
    const r = await atalhoComo(DONO_A, pedidoAPendente);

    expect(r.affectedRows).toBe(1);
    expect(r.rows).toEqual([{ id: pedidoAPendente }]);
    expect(await statusDe(pedidoAPendente)).toBe("saiu_entrega");
  });

  it("dono B continua dono do próprio pedido: o atalho dele em B afeta 1 linha (a negação a A é por loja)", async () => {
    await t.asService((db) =>
      db.query(`update public.pedidos set status = 'confirmado' where id = $1`, [pedidoB]),
    );

    const r = await atalhoComo(DONO_B, pedidoB);

    expect(r.affectedRows).toBe(1);
    expect(await statusDe(pedidoB)).toBe("saiu_entrega");
  });
});
