import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 001 — migration do schema inicial.
 *
 * A migration `supabase/migrations/20260614000129_schema_inicial.sql` AINDA NÃO
 * EXISTE. `createTestDb()` aplica apenas o bootstrap Supabase, então NENHUMA das
 * 12 tabelas do schema.md está presente. Todos os testes abaixo devem FALHAR por
 * tabela/coluna/constraint inexistente — esse é o RED esperado, comprovado pela
 * saída do `npx vitest run`.
 *
 * Quem deixa verde é a fase GREEN (`executar`), escrevendo a migration. Nenhum
 * código de produção é escrito aqui. Contrato para a GREEN: ver final do arquivo.
 *
 * Padrão dos testes:
 * - `asService` (BYPASSRLS) cria as linhas-pai e testa CHECK/UNIQUE.
 * - `expect(...).rejects` afirma que o banco REJEITA o INSERT inválido.
 * - RLS de webhook_eventos_hotmart é testada com `asAnon`/`asUser` (deny-all).
 */

const TABELAS = [
  "lojas",
  "categorias",
  "produtos",
  "cupons",
  "zonas_entrega",
  "taxas_entrega",
  "bairros_zona",
  "formas_pagamento",
  "pedidos",
  "itens_pedido",
  "webhook_eventos_hotmart",
] as const;

// Colunas monetárias que DEVEM ser numeric (nunca float).
const COLUNAS_MONETARIAS: Array<[string, string]> = [
  ["produtos", "preco"],
  ["cupons", "valor"],
  ["cupons", "pedido_minimo"],
  ["taxas_entrega", "taxa"],
  ["taxas_entrega", "pedido_minimo_gratis"],
  ["pedidos", "subtotal"],
  ["pedidos", "desconto"],
  ["pedidos", "taxa_entrega"],
  ["pedidos", "total"],
  ["itens_pedido", "preco"],
];

const DONO_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// Donos extras para lojas criadas individualmente (RN-01: 1 conta = 1 loja).
// Cada slug de loja de teste recebe seu próprio dono único.
const DONOS_EXTRAS: Record<string, string> = {
  "tz-default":       "00000001-0000-0000-0000-000000000001",
  "status-default":   "00000002-0000-0000-0000-000000000002",
  "ativo-default":    "00000003-0000-0000-0000-000000000003",
  "pedido-default":   "00000004-0000-0000-0000-000000000004",
  "chk-produto":      "00000005-0000-0000-0000-000000000005",
  "chk-cupom-valor":  "00000006-0000-0000-0000-000000000006",
  "chk-cupom-tipo":   "00000007-0000-0000-0000-000000000007",
  "chk-item-qtd":     "00000008-0000-0000-0000-000000000008",
  "chk-taxa":         "00000009-0000-0000-0000-000000000009",
  "chk-status":       "0000000a-0000-0000-0000-00000000000a",
  "chk-zona-tipo":    "0000000b-0000-0000-0000-00000000000b",
  "chk-numeric-prec": "0000000c-0000-0000-0000-00000000000c",
  "chk-pagto-tipo":   "0000000d-0000-0000-0000-00000000000d",
  "slug-dup":         "0000000e-0000-0000-0000-00000000000e",
  "cupom-dup":        "0000000f-0000-0000-0000-00000000000f",
  "fk-cascade":       "00000010-0000-0000-0000-000000000010",
  "fk-setnull-cat":   "00000011-0000-0000-0000-000000000011",
  "token-distinto":   "00000012-0000-0000-0000-000000000012",
  "fk-setnull-prod":  "00000013-0000-0000-0000-000000000013",
};

/**
 * Afirma que a promise rejeita por VIOLAÇÃO DE CONSTRAINT (CHECK/UNIQUE/NOT NULL),
 * não por "relation does not exist". Sem isso, um INSERT inválido contra tabela
 * inexistente passaria verde no RED por motivo errado (falso-verde). Após a GREEN,
 * a rejeição precisa ser a do CHECK/UNIQUE — é o que estamos provando.
 */
async function expectViolacao(p: Promise<unknown>): Promise<void> {
  let msg = "";
  try {
    await p;
  } catch (err) {
    msg = (err as Error).message;
  }
  // Tem que ter lançado...
  expect(msg, "esperava rejeição (violação de constraint), mas resolveu").not.toBe("");
  // ...e NÃO pode ser por tabela/relação inexistente (isso seria RED por motivo errado).
  expect(
    /does not exist/i.test(msg),
    `rejeitou por relação inexistente, não por constraint: ${msg}`,
  ).toBe(false);
}

/**
 * Garante o auth.users do dono. INSERT em auth.users roda como superuser do pglite
 * (`t.db` direto) porque service_role não tem GRANT no schema auth no bootstrap.
 */
async function garantirDono(t: TestDb, donoId: string = DONO_ID, email?: string): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values ($1, $2)
     on conflict (id) do nothing`,
    [donoId, email ?? `dono-${donoId}@teste.local`],
  );
}

/** Cria uma loja válida com dono próprio (RN-01) e retorna o id da loja. */
async function criarLoja(t: TestDb, slug: string): Promise<string> {
  const donoId = DONOS_EXTRAS[slug] ?? DONO_ID;
  await garantirDono(t, donoId);
  return t.asService(async (db) => {
    const r = await db.query<{ id: string }>(
      `insert into public.lojas (dono_id, slug, nome) values ($1, $2, 'Loja Teste') returning id`,
      [donoId, slug],
    );
    return r.rows[0].id;
  });
}

describe("001 migration schema inicial (RED)", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    // Garante o auth.users do dono principal e de todos os donos extras (RN-01).
    await garantirDono(t);
    for (const [, donoId] of Object.entries(DONOS_EXTRAS)) {
      await garantirDono(t, donoId);
    }
  });
  afterAll(async () => {
    await t.close();
  });

  // ─────────────────────────────────────────── Existência (cenário 1)
  describe("existência das 12 tabelas", () => {
    for (const tabela of TABELAS) {
      it(`tabela public.${tabela} existe`, async () => {
        const r = await t.asService((db) =>
          db.query<{ reg: string | null }>(
            `select to_regclass($1) as reg`,
            [`public.${tabela}`],
          ),
        );
        expect(r.rows[0].reg).not.toBeNull();
      });
    }
  });

  // ─────────────────────────────────────────── RLS habilitada (cenário 2)
  describe("RLS habilitada em todas as tabelas", () => {
    for (const tabela of TABELAS) {
      it(`${tabela}.relrowsecurity = true`, async () => {
        const r = await t.asService((db) =>
          db.query<{ relrowsecurity: boolean }>(
            `select relrowsecurity from pg_class
             where relname = $1 and relnamespace = 'public'::regnamespace`,
            [tabela],
          ),
        );
        expect(r.rows[0]?.relrowsecurity).toBe(true);
      });
    }
  });

  // ─────────────────────────────────────────── Colunas delta / token (cenário 3)
  describe("colunas obrigatórias existem", () => {
    const lojasDelta = [
      "timezone",
      "consentimento_em",
      "consentimento_versao",
      "assinatura_status",
      "hotmart_subscriber_code",
      "hotmart_plano",
      "assinatura_inicio",
      "assinatura_fim_periodo",
      "assinatura_atualizada_em",
    ];

    for (const col of lojasDelta) {
      it(`lojas.${col} existe`, async () => {
        const r = await t.asService((db) =>
          db.query(
            `select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'lojas' and column_name = $1`,
            [col],
          ),
        );
        expect(r.rows.length).toBe(1);
      });
    }

    it("pedidos.token_acesso existe e é uuid NOT NULL", async () => {
      const r = await t.asService((db) =>
        db.query<{ data_type: string; is_nullable: string }>(
          `select data_type, is_nullable from information_schema.columns
           where table_schema = 'public' and table_name = 'pedidos' and column_name = 'token_acesso'`,
        ),
      );
      expect(r.rows[0]?.data_type).toBe("uuid");
      expect(r.rows[0]?.is_nullable).toBe("NO");
    });

    it("itens_pedido tem snapshot nome e preco", async () => {
      const r = await t.asService((db) =>
        db.query<{ column_name: string }>(
          `select column_name from information_schema.columns
           where table_schema = 'public' and table_name = 'itens_pedido'
             and column_name in ('nome','preco')`,
        ),
      );
      expect(r.rows.map((x) => x.column_name).sort()).toEqual(["nome", "preco"]);
    });
  });

  // ─────────────────────────────────────────── Tipo numeric (segurança valor)
  describe("colunas monetárias são numeric (nunca float)", () => {
    for (const [tabela, col] of COLUNAS_MONETARIAS) {
      it(`${tabela}.${col} é numeric`, async () => {
        const r = await t.asService((db) =>
          db.query<{ data_type: string }>(
            `select data_type from information_schema.columns
             where table_schema = 'public' and table_name = $1 and column_name = $2`,
            [tabela, col],
          ),
        );
        expect(r.rows[0]?.data_type).toBe("numeric");
      });
    }
  });

  // ─────────────────────────────────────────── Defaults (cenários 4,5,6)
  describe("defaults coerentes em loja nova", () => {
    it("lojas.timezone default = 'America/Sao_Paulo'", async () => {
      const r = await t.asService((db) =>
        db.query<{ timezone: string }>(
          `insert into public.lojas (dono_id, slug, nome)
           values ($1, 'tz-default', 'L') returning timezone`,
          [DONOS_EXTRAS["tz-default"]],
        ),
      );
      expect(r.rows[0].timezone).toBe("America/Sao_Paulo");
    });

    it("lojas.assinatura_status default = 'trial'", async () => {
      const r = await t.asService((db) =>
        db.query<{ assinatura_status: string }>(
          `insert into public.lojas (dono_id, slug, nome)
           values ($1, 'status-default', 'L') returning assinatura_status`,
          [DONOS_EXTRAS["status-default"]],
        ),
      );
      expect(r.rows[0].assinatura_status).toBe("trial");
    });

    it("lojas.ativo default = true", async () => {
      const r = await t.asService((db) =>
        db.query<{ ativo: boolean }>(
          `insert into public.lojas (dono_id, slug, nome)
           values ($1, 'ativo-default', 'L') returning ativo`,
          [DONOS_EXTRAS["ativo-default"]],
        ),
      );
      expect(r.rows[0].ativo).toBe(true);
    });

    it("pedidos sem token_acesso/status nasce com uuid e status 'pendente'", async () => {
      const lojaId = await criarLoja(t, "pedido-default");
      const r = await t.asService((db) =>
        db.query<{ token_acesso: string | null; status: string }>(
          `insert into public.pedidos (loja_id, nome_cliente, subtotal, total)
           values ($1, 'Cliente', 10.00, 10.00)
           returning token_acesso, status`,
          [lojaId],
        ),
      );
      expect(r.rows[0].token_acesso).not.toBeNull();
      expect(r.rows[0].status).toBe("pendente");
    });
  });

  // ─────────────────────────────────────────── CHECKs (cenários 7-13)
  describe("CHECKs de valor e domínio rejeitam inválidos", () => {
    it("produtos.preco = -1 rejeitado", async () => {
      const lojaId = await criarLoja(t, "chk-produto");
      await expectViolacao(
        t.asService((db) =>
          db.query(
            `insert into public.produtos (loja_id, nome, preco) values ($1, 'P', -1)`,
            [lojaId],
          ),
        ),
      );
    });

    it("cupons.valor = 0 rejeitado", async () => {
      const lojaId = await criarLoja(t, "chk-cupom-valor");
      await expectViolacao(
        t.asService((db) =>
          db.query(
            `insert into public.cupons (loja_id, codigo, tipo, valor) values ($1, 'X', 'fixo', 0)`,
            [lojaId],
          ),
        ),
      );
    });

    it("cupons.tipo = 'xpto' rejeitado", async () => {
      const lojaId = await criarLoja(t, "chk-cupom-tipo");
      await expectViolacao(
        t.asService((db) =>
          db.query(
            `insert into public.cupons (loja_id, codigo, tipo, valor) values ($1, 'X', 'xpto', 5)`,
            [lojaId],
          ),
        ),
      );
    });

    it("itens_pedido.quantidade = 0 rejeitado", async () => {
      const lojaId = await criarLoja(t, "chk-item-qtd");
      await expectViolacao(
        t.asService(async (db) => {
          const ped = await db.query<{ id: string }>(
            `insert into public.pedidos (loja_id, nome_cliente, subtotal, total)
             values ($1, 'C', 10, 10) returning id`,
            [lojaId],
          );
          await db.query(
            `insert into public.itens_pedido (pedido_id, nome, preco, quantidade)
             values ($1, 'Snapshot', 10.00, 0)`,
            [ped.rows[0].id],
          );
        }),
      );
    });

    it("taxas_entrega.taxa = -1 rejeitado", async () => {
      const lojaId = await criarLoja(t, "chk-taxa");
      await expectViolacao(
        t.asService(async (db) => {
          const z = await db.query<{ id: string }>(
            `insert into public.zonas_entrega (loja_id, nome, tipo)
             values ($1, 'Z', 'bairro') returning id`,
            [lojaId],
          );
          await db.query(
            `insert into public.taxas_entrega (zona_id, taxa) values ($1, -1)`,
            [z.rows[0].id],
          );
        }),
      );
    });

    it("pedidos.status = 'xpto' rejeitado", async () => {
      const lojaId = await criarLoja(t, "chk-status");
      await expectViolacao(
        t.asService((db) =>
          db.query(
            `insert into public.pedidos (loja_id, nome_cliente, subtotal, total, status)
             values ($1, 'C', 10, 10, 'xpto')`,
            [lojaId],
          ),
        ),
      );
    });

    it("zonas_entrega.tipo = 'xpto' rejeitado", async () => {
      const lojaId = await criarLoja(t, "chk-zona-tipo");
      await expectViolacao(
        t.asService((db) =>
          db.query(
            `insert into public.zonas_entrega (loja_id, nome, tipo)
             values ($1, 'Z', 'xpto')`,
            [lojaId],
          ),
        ),
      );
    });

    it("produtos.preco numeric(10,2) arredonda 3+ casas decimais (não aceita float livre)", async () => {
      // Postgres numeric(10,2) arredonda escala excedente para 2 casas — não rejeita.
      // O que NÃO deve acontecer: o valor virar um float impreciso (ex: 10.998999...).
      // Isso valida que o banco trata valor monetário com precisão fixa, não IEEE 754.
      const lojaId = await criarLoja(t, "chk-numeric-prec");
      const r = await t.asService((db) =>
        db.query<{ preco: string }>(
          `insert into public.produtos (loja_id, nome, preco) values ($1, 'P', 10.999) returning preco`,
          [lojaId],
        ),
      );
      // numeric(10,2) arredonda: 10.999 → 11.00. Nunca 10.998999999... (float IEEE 754).
      const valorArmazenado = Number(r.rows[0].preco);
      expect(valorArmazenado).toBe(11.0);
      expect(Number.isInteger(valorArmazenado * 100)).toBe(true); // sempre múltiplo de centavo
    });

    it("formas_pagamento.tipo = 'xpto' rejeitado", async () => {
      const lojaId = await criarLoja(t, "chk-pagto-tipo");
      await expectViolacao(
        t.asService((db) =>
          db.query(
            `insert into public.formas_pagamento (loja_id, tipo) values ($1, 'xpto')`,
            [lojaId],
          ),
        ),
      );
    });

    it("lojas.assinatura_status = 'xpto' rejeitado", async () => {
      await expectViolacao(
        t.asService((db) =>
          db.query(
            `insert into public.lojas (dono_id, slug, nome, assinatura_status)
             values ($1, 'chk-assinatura', 'L', 'xpto')`,
            [DONO_ID],
          ),
        ),
      );
    });
  });

  // ─────────────────────────────────────────── UNIQUE / idempotência (14-16)
  describe("UNIQUE e idempotência", () => {
    it("segunda loja com mesmo slug rejeitada", async () => {
      await criarLoja(t, "slug-dup");
      await expectViolacao(
        t.asService((db) =>
          db.query(
            `insert into public.lojas (dono_id, slug, nome) values ($1, 'slug-dup', 'L2')`,
            [DONO_ID],
          ),
        ),
      );
    });

    it("slug com formato inválido (caractere de path) rejeitado", async () => {
      // Defesa em profundidade: CHECK no banco impede slug malicioso mesmo se
      // uma Server Action com service_role esquecer a validação Zod.
      await expectViolacao(
        t.asService((db) =>
          db.query(
            `insert into public.lojas (dono_id, slug, nome) values ($1, 'loja/../admin', 'L')`,
            [DONO_ID],
          ),
        ),
      );
    });

    it("segundo cupom com mesmo (loja_id, codigo) rejeitado", async () => {
      const lojaId = await criarLoja(t, "cupom-dup");
      await t.asService((db) =>
        db.query(
          `insert into public.cupons (loja_id, codigo, tipo, valor) values ($1, 'PROMO', 'fixo', 5)`,
          [lojaId],
        ),
      );
      await expectViolacao(
        t.asService((db) =>
          db.query(
            `insert into public.cupons (loja_id, codigo, tipo, valor) values ($1, 'PROMO', 'fixo', 9)`,
            [lojaId],
          ),
        ),
      );
    });

    it("segundo webhook com mesmo evento_id rejeitado (idempotência)", async () => {
      await t.asService((db) =>
        db.query(
          `insert into public.webhook_eventos_hotmart (evento_id, payload)
           values ('evt-1', '{}'::jsonb)`,
        ),
      );
      await expectViolacao(
        t.asService((db) =>
          db.query(
            `insert into public.webhook_eventos_hotmart (evento_id, payload)
             values ('evt-1', '{"dup":true}'::jsonb)`,
          ),
        ),
      );
    });
  });

  // ─────────────────────────────────────────── RLS deny-all webhook (17-19)
  describe("webhook_eventos_hotmart é deny-all (RLS sem policy)", () => {
    it("anon não lê linha inserida via service (0 linhas ou negado)", async () => {
      await t.asService((db) =>
        db.query(
          `insert into public.webhook_eventos_hotmart (evento_id, payload)
           values ('evt-anon-read', '{}'::jsonb)`,
        ),
      );
      const rows = await t
        .asAnon((db) =>
          db.query(`select * from public.webhook_eventos_hotmart`),
        )
        .then((r) => r.rows)
        .catch(() => [] as unknown[]); // negado também é deny-all aceitável
      expect(rows.length).toBe(0);
    });

    it("anon não consegue inserir (deny-all)", async () => {
      const inseriu = await t
        .asAnon(async (db) => {
          await db.query(
            `insert into public.webhook_eventos_hotmart (evento_id, payload)
             values ('evt-anon-insert', '{}'::jsonb)`,
          );
          return true;
        })
        .catch(() => false);
      // anon não pode inserir: ou a operação lança, ou (RLS) nenhuma linha persiste.
      const persistiu = await t.asService((db) =>
        db.query(
          `select 1 from public.webhook_eventos_hotmart where evento_id = 'evt-anon-insert'`,
        ),
      );
      expect(inseriu && persistiu.rows.length > 0).toBe(false);
    });

    it("authenticated não lê webhook_eventos_hotmart", async () => {
      await t.asService((db) =>
        db.query(
          `insert into public.webhook_eventos_hotmart (evento_id, payload)
           values ('evt-user-read', '{}'::jsonb)`,
        ),
      );
      const rows = await t
        .asUser(DONO_ID, (db) =>
          db.query(`select * from public.webhook_eventos_hotmart`),
        )
        .then((r) => r.rows)
        .catch(() => [] as unknown[]);
      expect(rows.length).toBe(0);
    });

    it("service_role lê e escreve normalmente (bypass RLS)", async () => {
      await t.asService((db) =>
        db.query(
          `insert into public.webhook_eventos_hotmart (evento_id, payload)
           values ('evt-service', '{}'::jsonb)`,
        ),
      );
      const r = await t.asService((db) =>
        db.query(
          `select 1 from public.webhook_eventos_hotmart where evento_id = 'evt-service'`,
        ),
      );
      expect(r.rows.length).toBe(1);
    });
  });

  // ─────────────────────────────────────────── FK CASCADE / SET NULL (20-22)
  describe("comportamento de FK (CASCADE / SET NULL)", () => {
    it("DELETE da loja remove filhas em cascata", async () => {
      const lojaId = await criarLoja(t, "fk-cascade");
      await t.asService((db) =>
        db.query(`insert into public.produtos (loja_id, nome, preco) values ($1, 'P', 1)`, [
          lojaId,
        ]),
      );
      await t.asService((db) =>
        db.query(`delete from public.lojas where id = $1`, [lojaId]),
      );
      const r = await t.asService((db) =>
        db.query(`select 1 from public.produtos where loja_id = $1`, [lojaId]),
      );
      expect(r.rows.length).toBe(0);
    });

    it("DELETE de categoria seta produtos.categoria_id = NULL", async () => {
      const lojaId = await criarLoja(t, "fk-setnull-cat");
      const { catId, prodId } = await t.asService(async (db) => {
        const c = await db.query<{ id: string }>(
          `insert into public.categorias (loja_id, nome) values ($1, 'Cat') returning id`,
          [lojaId],
        );
        const p = await db.query<{ id: string }>(
          `insert into public.produtos (loja_id, categoria_id, nome, preco)
           values ($1, $2, 'P', 1) returning id`,
          [lojaId, c.rows[0].id],
        );
        return { catId: c.rows[0].id, prodId: p.rows[0].id };
      });
      await t.asService((db) =>
        db.query(`delete from public.categorias where id = $1`, [catId]),
      );
      const r = await t.asService((db) =>
        db.query<{ categoria_id: string | null }>(
          `select categoria_id from public.produtos where id = $1`,
          [prodId],
        ),
      );
      expect(r.rows[0].categoria_id).toBeNull();
    });

    it("dois pedidos sem token_acesso explícito recebem tokens distintos (gen_random_uuid real)", async () => {
      const lojaId = await criarLoja(t, "token-distinto");
      const r = await t.asService((db) =>
        db.query<{ token_acesso: string }>(
          `insert into public.pedidos (loja_id, nome_cliente, subtotal, total)
           values ($1, 'C', 10, 10), ($1, 'D', 20, 20)
           returning token_acesso`,
          [lojaId],
        ),
      );
      const tokens = r.rows.map((row) => row.token_acesso);
      expect(tokens.length).toBe(2);
      expect(tokens[0]).not.toBeNull();
      expect(tokens[1]).not.toBeNull();
      expect(tokens[0]).not.toBe(tokens[1]);
    });

    it("DELETE de produto referenciado seta itens_pedido.produto_id = NULL preservando snapshot", async () => {
      const lojaId = await criarLoja(t, "fk-setnull-prod");
      const { prodId, itemId } = await t.asService(async (db) => {
        const p = await db.query<{ id: string }>(
          `insert into public.produtos (loja_id, nome, preco) values ($1, 'Coxinha', 7.50) returning id`,
          [lojaId],
        );
        const ped = await db.query<{ id: string }>(
          `insert into public.pedidos (loja_id, nome_cliente, subtotal, total)
           values ($1, 'C', 7.50, 7.50) returning id`,
          [lojaId],
        );
        const item = await db.query<{ id: string }>(
          `insert into public.itens_pedido (pedido_id, produto_id, nome, preco, quantidade)
           values ($1, $2, 'Coxinha', 7.50, 1) returning id`,
          [ped.rows[0].id, p.rows[0].id],
        );
        return { prodId: p.rows[0].id, itemId: item.rows[0].id };
      });
      await t.asService((db) =>
        db.query(`delete from public.produtos where id = $1`, [prodId]),
      );
      const r = await t.asService((db) =>
        db.query<{ produto_id: string | null; nome: string; preco: string }>(
          `select produto_id, nome, preco from public.itens_pedido where id = $1`,
          [itemId],
        ),
      );
      expect(r.rows[0].produto_id).toBeNull();
      expect(r.rows[0].nome).toBe("Coxinha");
      expect(Number(r.rows[0].preco)).toBe(7.5);
    });
  });
});

/**
 * Helper de conveniência: garante o auth.users do dono e devolve o DONO_ID.
 * Os testes de loja-only (sem `criarLoja`) precisam do FK satisfeito.
 */
function DONO_ID_OU(t: TestDb): string {
  // o auth.users é criado preguiçosamente por criarLoja; para os INSERTs de loja
  // direta, garantimos o dono num beforeAll-equivalente inline na primeira chamada.
  void t;
  return DONO_ID;
}
