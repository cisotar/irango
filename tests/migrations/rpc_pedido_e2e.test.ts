import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Issue 055 — Teste E2E de pedido + recálculo no servidor (TDD red-first).
 *
 * Diferente de `pedido.test.ts` (que mocka TODA a I/O e prova a ORQUESTRAÇÃO da
 * action em isolamento) e de `rpc_criar_pedido.test.ts` (que chama a RPC SQL
 * crua), aqui exercitamos o FLUXO COMPLETO: a Server Action `criarPedido` real,
 * recalculando valores a partir de PREÇOS REAIS lidos de um Postgres pglite, e
 * delegando à RPC transacional real — tudo no mesmo banco.
 *
 * Por que assim: o coração da criticidade (seguranca.md §10) é "o cliente não
 * controla o que paga". Esse recálculo VIVE NA ACTION (`src/lib/actions/pedido.ts`),
 * não na RPC — a RPC confia em p_subtotal/p_total/p_preco que a action já
 * recalculou. Um teste que só batesse na RPC com payload mentido provaria nada
 * sobre o recálculo. Então fechamos o laço: payload do "atacante" entra pela
 * action; o que sai e persiste no banco é o valor recalculado do banco.
 *
 * As QUERIES de I/O da action (`@/lib/supabase/queries/*`) e o `createServiceClient`
 * são redirecionados para o MESMO pglite via um shim mínimo do query-builder
 * supabase (só os métodos que a action usa) + um `.rpc("criar_pedido", ...)` que
 * chama a função SQL real. Nada de preço/cupom é mockado: vem do banco.
 *
 * ┌── Onde cada cenário do issue 055 é provado ────────────────────────────────┐
 * │ 1 payload atacante 0.01        → recálculo na ACTION (preço real do banco)  │
 * │ 2 item indisponível            → guard da ACTION (produto.disponivel=false) │
 * │ 3 item de outra loja           → guard da ACTION (produto.loja_id != loja)  │
 * │ 4 cupom usos_contagem +1 único → trava atômica da RPC + dedupe idempotência │
 * │ 5 snapshot imutável            → itens_pedido.nome/preco gravados pela RPC  │
 * │ 6 confirmação por token        → pedidos.token_acesso (UUID aleatório nega) │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * RED esperado HOJE: a action atual NÃO existe em fase RED? Não — 055 é uma
 * issue de TESTE sobre código de produção JÁ existente. Logo, a expectativa é
 * que estes testes possam FICAR VERDES quando a implementação está correta. O
 * RED desta fase aparece em qualquer cenário onde a implementação tiver BUG
 * (ex.: action não recalcula, RPC incrementa cupom 2×, token não isola). Cada
 * `expect` mira o COMPORTAMENTO CORRETO; um vermelho aqui denuncia regressão/bug.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shim do query-builder supabase sobre pglite. Implementa SÓ o subset que a
// action `criarPedido` e suas queries usam: from().select().eq().in().maybeSingle()
// e .rpc(). Tradução ingênua para SQL parametrizado — suficiente para o fluxo.
// ─────────────────────────────────────────────────────────────────────────────

// O `t` do pglite é atribuído no beforeAll e capturado pelo shim por closure.
let DB: TestDb;

type Filtro =
  | { tipo: "eq"; coluna: string; valor: unknown }
  | { tipo: "in"; coluna: string; valores: unknown[] };

function builder(tabela: string) {
  const filtros: Filtro[] = [];

  function montarWhere(base: number): { sql: string; params: unknown[] } {
    if (filtros.length === 0) return { sql: "", params: [] };
    const params: unknown[] = [];
    const partes = filtros.map((f) => {
      if (f.tipo === "eq") {
        params.push(f.valor);
        return `${f.coluna} = $${base + params.length - 1}`;
      }
      // in
      const placeholders = f.valores.map((v) => {
        params.push(v);
        return `$${base + params.length - 1}`;
      });
      return `${f.coluna} = any(array[${placeholders.join(",")}]::uuid[])`;
    });
    return { sql: ` where ${partes.join(" and ")}`, params };
  }

  async function executar(): Promise<{ data: unknown; error: unknown }> {
    const { sql, params } = montarWhere(1);
    try {
      const r = await DB.asService((db) =>
        db.query(`select * from public.${tabela}${sql}`, params),
      );
      return { data: r.rows, error: null };
    } catch (e) {
      return { data: null, error: e };
    }
  }

  const api = {
    select() {
      return api;
    },
    eq(coluna: string, valor: unknown) {
      filtros.push({ tipo: "eq", coluna, valor });
      return api;
    },
    in(coluna: string, valores: unknown[]) {
      filtros.push({ tipo: "in", coluna, valores });
      return api;
    },
    async maybeSingle() {
      const { data, error } = await executar();
      if (error) return { data: null, error };
      const rows = data as unknown[];
      return { data: rows[0] ?? null, error: null };
    },
    // a forma `await query` (sem .single) resolve a lista
    then(
      onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) {
      return executar().then(onFulfilled, onRejected);
    },
  };
  return api;
}

const clientePglite = {
  from(tabela: string) {
    return builder(tabela);
  },
  async rpc(fn: string, args: Record<string, unknown>) {
    if (fn !== "criar_pedido") {
      return { data: null, error: { message: `rpc desconhecida: ${fn}` } };
    }
    try {
      const data = await DB.asService(async (db) => {
        const r = await db.query<{ pedido_id: string; token_acesso: string }>(
          `select * from public.criar_pedido(
             p_loja_id          => $1,
             p_nome_cliente     => $2,
             p_telefone_cliente => $3,
             p_endereco_entrega => $4::jsonb,
             p_forma_pagamento  => $5,
             p_observacoes      => $6,
             p_subtotal         => $7,
             p_taxa_entrega     => $8,
             p_desconto         => $9,
             p_total            => $10,
             p_cupom_id         => $11,
             p_cupom_codigo     => $12,
             p_itens            => $13::jsonb,
             p_tipo_entrega     => $14,
             p_troco_para       => $15,
             p_idempotency_key  => $16
           )`,
          [
            args.p_loja_id,
            args.p_nome_cliente,
            args.p_telefone_cliente ?? null,
            JSON.stringify(args.p_endereco_entrega ?? null),
            args.p_forma_pagamento,
            args.p_observacoes ?? null,
            args.p_subtotal,
            args.p_taxa_entrega,
            args.p_desconto,
            args.p_total,
            args.p_cupom_id ?? null,
            args.p_cupom_codigo ?? null,
            JSON.stringify(args.p_itens),
            args.p_tipo_entrega,
            args.p_troco_para ?? null,
            args.p_idempotency_key ?? null,
          ],
        );
        return r.rows;
      });
      return { data, error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  },
};

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => clientePglite,
}));

// A action lê via @/lib/supabase/queries/*; estas reusam o builder do shim acima
// (mesmo banco). Reimplementamos as 5 queries que a action chama, em cima do shim.
vi.mock("@/lib/supabase/queries/lojas", () => ({
  async buscarLojaParaPedido(client: typeof clientePglite, lojaId: string) {
    const { data } = await client.from("lojas").select("*").eq("id", lojaId).maybeSingle();
    return data ?? null;
  },
}));

vi.mock("@/lib/supabase/queries/produtos", () => ({
  async buscarProdutosPorIds(client: typeof clientePglite, ids: string[]) {
    if (ids.length === 0) return [];
    const { data } = await client.from("produtos").select("*").in("id", ids);
    return (data as unknown[]) ?? [];
  },
  async buscarOpcionaisPorIds() {
    return []; // estes cenários não usam opcionais
  },
  async buscarOpcionaisPorCategoria() {
    return {};
  },
}));

vi.mock("@/lib/supabase/queries/entregaPagamento", () => ({
  async listarZonasComTaxas() {
    return []; // todos os cenários usam tipo_entrega='retirada' (frete 0)
  },
  async listarFormasPagamento(client: typeof clientePglite, lojaId: string) {
    const { data } = await client.from("formas_pagamento").select("*").eq("loja_id", lojaId);
    return (data as unknown[]) ?? [];
  },
  async buscarCupomPorCodigo(client: typeof clientePglite, lojaId: string, codigo: string) {
    const { data } = await client
      .from("cupons")
      .select("*")
      .eq("loja_id", lojaId)
      .eq("codigo", codigo)
      .maybeSingle();
    return data ?? null;
  },
}));

import { criarPedido } from "@/lib/actions/pedido";

// ─────────────────────────────────────────────────────────────── fixtures
const DONO = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

// Horário 24h em todos os dias → loja sempre aberta (isola o teste do relógio).
const HORARIO_24H = JSON.stringify({
  seg: { abre: "00:00", fecha: "23:59", ativo: true },
  ter: { abre: "00:00", fecha: "23:59", ativo: true },
  qua: { abre: "00:00", fecha: "23:59", ativo: true },
  qui: { abre: "00:00", fecha: "23:59", ativo: true },
  sex: { abre: "00:00", fecha: "23:59", ativo: true },
  sab: { abre: "00:00", fecha: "23:59", ativo: true },
  dom: { abre: "00:00", fecha: "23:59", ativo: true },
});

type Cenario = {
  lojaA: string;
  lojaB: string;
  prodDisp: string; // loja A, R$ 25,00, disponível
  prodIndisp: string; // loja A, R$ 30,00, disponivel=false
  prodLojaB: string; // loja B, R$ 40,00, disponível
  cupom: string; // loja A, fixo R$ 5,00, usos_maximos=1
};

async function semear(t: TestDb): Promise<Cenario> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1,'dono-a@e2e.local'), ($2,'dono-b@e2e.local')
     on conflict (id) do nothing`,
    [DONO, DONO_B],
  );

  return t.asService(async (db) => {
    const ins = async (sql: string, params: unknown[]) =>
      (await db.query<{ id: string }>(sql, params)).rows[0].id;

    const lojaA = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo, horarios, assinatura_status)
         values ($1,'loja-a-e2e','Loja A',true,$2::jsonb,'ativa') returning id`,
      [DONO, HORARIO_24H],
    );
    const lojaB = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo, horarios, assinatura_status)
         values ($1,'loja-b-e2e','Loja B',true,$2::jsonb,'ativa') returning id`,
      [DONO_B, HORARIO_24H],
    );

    // Forma de pagamento pix em ambas as lojas (a action exige forma ∈ configuradas).
    await db.query(`insert into public.formas_pagamento (loja_id, tipo) values ($1,'pix'),($2,'pix')`, [
      lojaA,
      lojaB,
    ]);

    const prodDisp = await ins(
      `insert into public.produtos (loja_id, nome, preco, disponivel) values ($1,'Pizza',25.00,true) returning id`,
      [lojaA],
    );
    const prodIndisp = await ins(
      `insert into public.produtos (loja_id, nome, preco, disponivel) values ($1,'Esgotado',30.00,false) returning id`,
      [lojaA],
    );
    const prodLojaB = await ins(
      `insert into public.produtos (loja_id, nome, preco, disponivel) values ($1,'Burguer B',40.00,true) returning id`,
      [lojaB],
    );
    const cupom = await ins(
      `insert into public.cupons (loja_id, codigo, tipo, valor, pedido_minimo, usos_maximos, usos_contagem, ativo)
         values ($1,'CINCO','fixo',5.00,0,1,0,true) returning id`,
      [lojaA],
    );

    return { lojaA, lojaB, prodDisp, prodIndisp, prodLojaB, cupom };
  });
}

/** Lê um pedido cru pelo id (via service, ignora RLS). */
async function lerPedido(t: TestDb, id: string) {
  return t.asService(async (db) =>
    (
      await db.query<{
        subtotal: string;
        desconto: string;
        taxa_entrega: string;
        total: string;
        token_acesso: string;
        cupom_codigo: string | null;
      }>(
        `select subtotal, desconto, taxa_entrega, total, token_acesso, cupom_codigo
           from public.pedidos where id = $1`,
        [id],
      )
    ).rows[0],
  );
}

describe("055 E2E criarPedido — recálculo no servidor (action real + RPC real, pglite)", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    DB = t; // o shim do client usa esta referência por closure
    c = await semear(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ─────────────────────────────────────────── [1] payload "atacante" 0.01
  it("[1] payload com total/preço 0.01 → servidor recalcula do banco e IGNORA o valor do cliente", async () => {
    // O atacante manda quantidade 2 de um produto de R$25 mas com sinais de
    // querer pagar 0.01. O schema .strict() nem deixa campos monetários entrarem;
    // mandamos só intenção. O subtotal/total persistido DEVE vir do preço real.
    const r = await criarPedido({
      loja_id: c.lojaA,
      nome_cliente: "Atacante",
      forma_pagamento: "pix",
      tipo_entrega: "retirada",
      itens: [{ produto_id: c.prodDisp, quantidade: 2 }],
    });

    expect("pedidoId" in r).toBe(true);
    if (!("pedidoId" in r)) return;

    const ped = await lerPedido(t, r.pedidoId);
    // 25,00 × 2 = 50,00 — recalculado do banco; jamais 0.01.
    expect(Number(ped.subtotal)).toBe(50.0);
    expect(Number(ped.taxa_entrega)).toBe(0); // retirada
    expect(Number(ped.total)).toBe(50.0);
    expect(Number(ped.total)).not.toBe(0.01);
  });

  // ─────────────────────────────────────────── [2] item indisponível
  it("[2] item com disponivel=false → pedido recusado, nada persiste", async () => {
    const antes = await t.asService((db) =>
      db.query<{ n: string }>(`select count(*)::int n from public.pedidos where loja_id=$1`, [c.lojaA]),
    );

    const r = await criarPedido({
      loja_id: c.lojaA,
      nome_cliente: "Cliente",
      forma_pagamento: "pix",
      tipo_entrega: "retirada",
      itens: [{ produto_id: c.prodIndisp, quantidade: 1 }],
    });

    expect("erro" in r).toBe(true);

    const depois = await t.asService((db) =>
      db.query<{ n: string }>(`select count(*)::int n from public.pedidos where loja_id=$1`, [c.lojaA]),
    );
    expect(depois.rows[0].n).toBe(antes.rows[0].n); // nenhum pedido criado
  });

  // ─────────────────────────────────────────── [3] item de outra loja
  it("[3] item pertencente a OUTRA loja → pedido recusado (anti cross-loja)", async () => {
    const r = await criarPedido({
      loja_id: c.lojaA, // pedido para a loja A...
      nome_cliente: "Cliente",
      forma_pagamento: "pix",
      tipo_entrega: "retirada",
      itens: [{ produto_id: c.prodLojaB, quantidade: 1 }], // ...mas o item é da loja B
    });

    expect("erro" in r).toBe(true);

    const n = await t.asService((db) =>
      db.query<{ n: string }>(
        `select count(*)::int n from public.itens_pedido where produto_id=$1`,
        [c.prodLojaB],
      ),
    );
    expect(Number(n.rows[0].n)).toBe(0); // o item da loja B nunca virou linha
  });

  // ─────────────────────────────────────────── [4] cupom: usos_contagem +1 único
  it("[4] cupom válido em duplo-envio (mesma idempotency_key) → usos_contagem incrementa EXATAMENTE 1", async () => {
    const idem = "dddddddd-0000-0000-0000-000000000001";

    const payload = {
      loja_id: c.lojaA,
      nome_cliente: "Cupom Cliente",
      forma_pagamento: "pix",
      tipo_entrega: "retirada" as const,
      codigo_cupom: "CINCO",
      idempotency_key: idem,
      itens: [{ produto_id: c.prodDisp, quantidade: 1 }], // 25,00
    };

    const r1 = await criarPedido(payload);
    const r2 = await criarPedido(payload); // duplo-submit idêntico

    expect("pedidoId" in r1).toBe(true);
    expect("pedidoId" in r2).toBe(true);
    if (!("pedidoId" in r1) || !("pedidoId" in r2)) return;

    // dedupe: o 2º envio retorna o MESMO pedido (idempotência), não cria outro.
    expect(r2.pedidoId).toBe(r1.pedidoId);

    // o cupom foi consumido UMA vez só (não 2) — sem condição de corrida.
    const cupom = await t.asService((db) =>
      db.query<{ usos_contagem: number }>(`select usos_contagem from public.cupons where id=$1`, [
        c.cupom,
      ]),
    );
    expect(cupom.rows[0].usos_contagem).toBe(1);

    // o pedido aplicou os R$5 de desconto: total = 25 − 5 = 20.
    const ped = await lerPedido(t, r1.pedidoId);
    expect(Number(ped.desconto)).toBe(5.0);
    expect(Number(ped.total)).toBe(20.0);
    expect(ped.cupom_codigo).toBe("CINCO");
  });

  // ─────────────────────────────────────────── [5] snapshot imutável
  it("[5] alterar nome/preço do produto APÓS o pedido → itens_pedido mantém o snapshot original", async () => {
    const r = await criarPedido({
      loja_id: c.lojaA,
      nome_cliente: "Snapshot Cliente",
      forma_pagamento: "pix",
      tipo_entrega: "retirada",
      itens: [{ produto_id: c.prodDisp, quantidade: 1 }],
    });
    expect("pedidoId" in r).toBe(true);
    if (!("pedidoId" in r)) return;

    const antes = await t.asService((db) =>
      db.query<{ nome: string; preco: string }>(
        `select nome, preco from public.itens_pedido where pedido_id=$1`,
        [r.pedidoId],
      ),
    );
    expect(antes.rows[0].nome).toBe("Pizza");
    expect(Number(antes.rows[0].preco)).toBe(25.0);

    // o lojista renomeia e reprecifica o produto DEPOIS do pedido
    await t.asService((db) =>
      db.query(`update public.produtos set nome='Pizza Gigante', preco=99.00 where id=$1`, [
        c.prodDisp,
      ]),
    );

    const depois = await t.asService((db) =>
      db.query<{ nome: string; preco: string }>(
        `select nome, preco from public.itens_pedido where pedido_id=$1`,
        [r.pedidoId],
      ),
    );
    // snapshot NÃO acompanha a mudança — histórico do pedido é imutável.
    expect(depois.rows[0].nome).toBe("Pizza");
    expect(Number(depois.rows[0].preco)).toBe(25.0);
  });

  // ─────────────────────────────────────────── [6] confirmação por token
  it("[6] confirmação: id + token_acesso correto encontra o pedido; UUID aleatório NÃO", async () => {
    const r = await criarPedido({
      loja_id: c.lojaA,
      nome_cliente: "Token Cliente",
      forma_pagamento: "pix",
      tipo_entrega: "retirada",
      itens: [{ produto_id: c.prodDisp, quantidade: 1 }],
    });
    expect("pedidoId" in r).toBe(true);
    if (!("pedidoId" in r)) return;

    expect(r.token_acesso).toBeTruthy();

    // leitura com id + token correto → 1 linha
    const certo = await t.asService((db) =>
      db.query<{ n: string }>(
        `select count(*)::int n from public.pedidos where id=$1 and token_acesso=$2`,
        [r.pedidoId, r.token_acesso],
      ),
    );
    expect(Number(certo.rows[0].n)).toBe(1);

    // mesmo id, token aleatório (errado) → 0 linhas (token é a "senha" do pedido)
    const tokenAleatorio = "99999999-9999-9999-9999-999999999999";
    const errado = await t.asService((db) =>
      db.query<{ n: string }>(
        `select count(*)::int n from public.pedidos where id=$1 and token_acesso=$2`,
        [r.pedidoId, tokenAleatorio],
      ),
    );
    expect(Number(errado.rows[0].n)).toBe(0);
  });
});
