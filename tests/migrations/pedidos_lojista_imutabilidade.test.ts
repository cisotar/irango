import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) — issue 330: restringir DELETE e colunas de identificação de
 * `pedidos` ao lojista.
 *
 * Hoje `20260614008500_grants_roles_supabase.sql` dá GRANT ALL em `pedidos` a
 * `anon`/`authenticated` (só INSERT foi revogado depois) e a policy
 * `pedidos_acesso_lojista` é FOR ALL. Com o próprio JWT o lojista apaga pedido
 * e reescreve `token_acesso`, PII do cliente, `criado_em`, `loja_id` etc.
 *
 * Correção esperada (ainda NÃO existe, fase GREEN): privilégio por coluna —
 *   revoke update, delete, truncate, trigger, references on public.pedidos
 *     from anon, authenticated;
 *   grant update (status, taxa_entrega, total, frete_a_combinar)
 *     on public.pedidos to authenticated;
 * e `pedidos_acesso_lojista` vira `pedidos_select_lojista` + `pedidos_update_lojista`.
 *
 * Anti-falso-verde:
 *  - recusa = SQLSTATE 42501 E fragmento `permission denied for table pedidos`.
 *    A RLS (WITH CHECK) e os triggers de valor/status/cliente_id também
 *    recusam com 42501; só o fragmento prova que foi o privilégio de coluna.
 *  - toda recusa é reconferida via asService (linha existe, valor intacto).
 *  - toda permissão afirma affectedRows === 1 + releitura via asService.
 */

const DONO = "33033033-0000-4000-8000-000000000001";
const OUTRO_DONO = "33033033-0000-4000-8000-000000000002";
const FRAG = "permission denied for table pedidos";

let t: TestDb;
let lojaId: string;
let lojaOutroDonoId: string;

beforeAll(async () => {
  t = await createTestDb();
  await t.db.query(
    `insert into auth.users (id, email) values ($1,'dono-330@teste.local'),($2,'outro-330@teste.local')
     on conflict (id) do nothing`,
    [DONO, OUTRO_DONO],
  );
  [lojaId, lojaOutroDonoId] = await t.asService(async (db) => {
    const a = await db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-330','Loja 330',true) returning id`,
      [DONO],
    );
    const b = await db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-330-b','Loja 330 B',true) returning id`,
      [OUTRO_DONO],
    );
    return [a.rows[0].id, b.rows[0].id];
  });
});

afterAll(async () => {
  await t.close();
});

/** Pedido pendente, entrega, frete a combinar (taxa NULL), 50 − 0 = 50. */
async function novoPedido(): Promise<string> {
  return t.asService(async (db) => {
    const r = await db.query<{ id: string }>(
      `insert into public.pedidos
         (loja_id, nome_cliente, telefone_cliente, endereco_entrega, observacoes,
          subtotal, desconto, taxa_entrega, total, forma_pagamento, cupom_codigo,
          tipo_entrega, status, frete_a_combinar, idempotency_key)
       values ($1,'Cliente 330','11900000000',
               '{"rua":"Rua Teste","numero":"1","bairro":"Centro","cidade":"Cidade","cep":"00000000"}'::jsonb,
               'sem cebola', 50, 0, null, 50, 'pix', 'CUPOM330',
               'entrega', 'pendente', true, gen_random_uuid())
       returning id`,
      [lojaId],
    );
    return r.rows[0].id;
  });
}

/** Linha inteira como texto (fonte da verdade, BYPASSRLS). */
async function lerLinha(id: string): Promise<Record<string, string | null> | undefined> {
  const r = await t.asService((db) =>
    db.query<{ linha: Record<string, string | null> }>(
      `select to_jsonb(p) as linha from public.pedidos p where id = $1`,
      [id],
    ),
  );
  return r.rows[0]?.linha;
}

type Tentativa = { affected: number | null; erro: string | null; code: string | null };

async function comoDono(sql: string, params: unknown[]): Promise<Tentativa> {
  try {
    const r = await t.asUser(DONO, (db) => db.query(sql, params));
    return { affected: r.affectedRows ?? null, erro: null, code: null };
  } catch (e) {
    const err = e as Error & { code?: string };
    return { affected: null, erro: err.message, code: err.code ?? null };
  }
}

/** Recusa por privilégio: 42501 + fragmento + linha intacta. */
async function esperarRecusa(id: string, sql: string, params: unknown[]): Promise<void> {
  const antes = await lerLinha(id);
  expect(antes).toBeDefined();
  const r = await comoDono(sql, params);
  expect(
    r.erro ?? `PASSOU sem erro (affectedRows=${r.affected}) — nada recusou`,
  ).toContain(FRAG);
  expect(r.code).toBe("42501");
  expect(await lerLinha(id)).toEqual(antes);
}

async function privTabela(role: string, priv: string): Promise<boolean> {
  const r = await t.db.query<{ ok: boolean }>(
    `select has_table_privilege($1, 'public.pedidos', $2) as ok`,
    [role, priv],
  );
  return r.rows[0].ok;
}

// ═════════════════════════════════════════════ F1 — DELETE
describe("pedidos (330) F1 — lojista não apaga pedido", () => {
  it("dono autenticado: DELETE do próprio pedido → 42501 permission denied, pedido continua lá", async () => {
    const id = await novoPedido();
    await esperarRecusa(id, `delete from public.pedidos where id = $1`, [id]);
    const r = await t.asService((db) =>
      db.query(`select 1 from public.pedidos where id = $1`, [id]),
    );
    expect(r.rows).toHaveLength(1);
  });

  for (const role of ["authenticated", "anon"]) {
    for (const priv of ["DELETE", "TRUNCATE", "TRIGGER", "REFERENCES"]) {
      it(`has_table_privilege('${role}', pedidos, ${priv}) = false`, async () => {
        expect(await privTabela(role, priv)).toBe(false);
      });
    }
  }
});

// ═════════════════════════════════════════════ F2 — colunas imutáveis
describe("pedidos (330) F2 — lojista não reescreve colunas de identificação", () => {
  const casos: { coluna: string; expr: string; params?: () => unknown[] }[] = [
    { coluna: "token_acesso", expr: "gen_random_uuid()" },
    { coluna: "nome_cliente", expr: "'Fulano Trocado'" },
    { coluna: "telefone_cliente", expr: "'11911111111'" },
    { coluna: "endereco_entrega", expr: `'{"rua":"Outra"}'::jsonb` },
    { coluna: "observacoes", expr: "'reescrita'" },
    { coluna: "criado_em", expr: "'2000-01-01T00:00:00Z'::timestamptz" },
    // lojas_dono_unico (20260614003500) impede 2ª loja do mesmo dono: o alvo é
    // a loja de OUTRO dono. Hoje a RLS WITH CHECK recusa com outra mensagem —
    // o fragmento distingue.
    { coluna: "loja_id", expr: "$2::uuid", params: () => [lojaOutroDonoId] },
    { coluna: "forma_pagamento", expr: "'dinheiro'" },
    { coluna: "cupom_codigo", expr: "'OUTRO'" },
    { coluna: "idempotency_key", expr: "gen_random_uuid()" },
  ];

  for (const { coluna, expr, params } of casos) {
    it(`UPDATE ${coluna} → 42501 permission denied, valor original preservado`, async () => {
      const id = await novoPedido();
      await esperarRecusa(
        id,
        `update public.pedidos set ${coluna} = ${expr} where id = $1`,
        [id, ...(params?.() ?? [])],
      );
    });
  }
});

// ═════════════════════════════════════════════ F3 — escritas legítimas continuam
describe("pedidos (330) F3 — escritas legítimas continuam passando", () => {
  it("dono: update status pendente → confirmado (shape de status.ts) afeta 1 linha", async () => {
    const id = await novoPedido();
    const r = await comoDono(`update public.pedidos set status = 'confirmado' where id = $1`, [id]);
    expect(r.erro).toBeNull();
    expect(r.affected).toBe(1);
    expect((await lerLinha(id))?.status).toBe("confirmado");
  });

  it("dono: registro de frete combinado (shape de freteCombinado.ts) afeta 1 linha", async () => {
    const id = await novoPedido(); // 50, a combinar
    const r = await comoDono(
      `update public.pedidos
          set taxa_entrega = $2, total = $3, frete_a_combinar = false
        where id = $1
          and frete_a_combinar = true
          and tipo_entrega = 'entrega'
          and status <> 'cancelado'`,
      [id, 7, 57],
    );
    expect(r.erro).toBeNull();
    expect(r.affected).toBe(1);
    expect(await lerLinha(id)).toMatchObject({
      taxa_entrega: 7,
      total: 57,
      frete_a_combinar: false,
      status: "pendente",
    });
  });

  it("service_role: UPDATE de nome_cliente passa (anonimização/servidor)", async () => {
    const id = await novoPedido();
    const r = await t.asService((db) =>
      db.query(`update public.pedidos set nome_cliente = 'Cliente removido' where id = $1`, [id]),
    );
    expect(r.affectedRows).toBe(1);
    expect((await lerLinha(id))?.nome_cliente).toBe("Cliente removido");
  });
});

// ═════════════════════════════════════════════ F4 — anon sem UPDATE
describe("pedidos (330) F4 — anon não tem UPDATE em pedidos", () => {
  it("has_table_privilege('anon', pedidos, UPDATE) = false", async () => {
    expect(await privTabela("anon", "UPDATE")).toBe(false);
  });

  it("has_column_privilege('anon', pedidos, status, UPDATE) = false", async () => {
    const r = await t.db.query<{ ok: boolean }>(
      `select has_column_privilege('anon', 'public.pedidos', 'status', 'UPDATE') as ok`,
    );
    expect(r.rows[0].ok).toBe(false);
  });
});
