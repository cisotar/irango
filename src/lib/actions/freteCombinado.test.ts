import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — spec `specs/modalidades-entrega-loja.md`, fatia C (registro
 * do frete combinado pelo LOJISTA). O módulo `./freteCombinado` ainda NÃO
 * existe: cada teste importa a action dinamicamente e falha individualmente
 * com "Failed to load url ./freteCombinado" (ou a asserção, depois do GREEN).
 *
 * CONTRATO que o GREEN deve satisfazer (`src/lib/actions/freteCombinado.ts`,
 * `'use server'`):
 *
 *   registrarFreteCombinado(payload: unknown):
 *     Promise<{ ok: true } | { ok: false; erro: string }>
 *
 *   payload = { pedidoId: string (uuid), valor: number }  — zod `.strict()`.
 *
 * Por que PAYLOAD-OBJETO e não `(pedidoId, valor)` posicional (o plano P4 diz
 * posicional): a prova exigida pela tabela de risco é "payload com
 * `desconto`/`total` extra → recusa (`.strict()`)". Com argumentos posicionais
 * não existe campo extra a recusar — o teste seria impossível. O objeto também
 * dá a MESMA forma às duas ações (`acaoFrete(payload)`; a admin via
 * `.bind(null, lojaId)`).
 *
 * Regras (spec + D1/D2/D3):
 *  - `total = subtotal − desconto + valor`, com subtotal e desconto LIDOS DO
 *    BANCO (nunca do form); UPDATE grava EXATAMENTE
 *    `{ taxa_entrega, total, frete_a_combinar: false }`.
 *  - valor ∈ [0, 1000], `multipleOf(0.01)`; 0 = frete grátis concedido.
 *  - só pedido `frete_a_combinar = true`, `tipo_entrega = 'entrega'`,
 *    `status <> 'cancelado'` — os três como FILTRO DO UPDATE (TOCTOU: a leitura
 *    não basta), linha não atualizada = recusa.
 *  - D1: segundo registro no mesmo pedido é recusado.
 *  - client AUTENTICADO (RLS `pedidos_acesso_lojista`), nunca service_role.
 *
 * O fake de banco abaixo é um avaliador em memória: aplica RLS por dono e os
 * filtros que a action encadear (`eq`/`neq`/`in`/`is`/`not`/`match`/`filter`)
 * sobre a linha GUARDADA, e emula o CHECK `chk_pedidos_frete_a_combinar`. Assim
 * o teste prova o COMPORTAMENTO (qual linha muda e para quê), sem amarrar a
 * ordem exata da cadeia.
 */

// ───────────────────────────────────────────── fake de banco (avaliador em memória)
type Linha = Record<string, unknown>;
type Filtro = { col: string; op: string; val: unknown };
type EscritaRegistrada = { tabela: string; patch: Linha; filtros: Filtro[]; afetadas: number };

function avaliar(linha: Linha, f: Filtro): boolean {
  const v = linha[f.col];
  switch (f.op) {
    case "eq":
      return v === f.val;
    case "neq":
      return v !== f.val;
    case "is":
      return v === f.val;
    case "in":
      return (f.val as unknown[]).includes(v);
    case "not.eq":
      return v !== f.val;
    case "not.is":
      return v !== f.val;
    case "not.in": {
      const lista = Array.isArray(f.val)
        ? f.val
        : String(f.val).replace(/[()"]/g, "").split(",").map((s) => s.trim());
      return !lista.includes(v);
    }
    default:
      throw new Error(`fake: operador de filtro não suportado: ${f.op}`);
  }
}

function violaCheckFrete(l: Linha): boolean {
  // chk_pedidos_frete_a_combinar: a combinar ⟺ taxa_entrega IS NULL
  return (l.frete_a_combinar === true) !== (l.taxa_entrega === null);
}

function criarBanco(opts: { dono: string | null }) {
  const tabelas: Record<string, Linha[]> = { pedidos: [], lojas: [] };
  const escritas: EscritaRegistrada[] = [];
  const leituras: { tabela: string; filtros: Filtro[] }[] = [];
  /** Gancho de corrida: roda DEPOIS de uma leitura em `pedidos`. */
  const ganchos: { depoisDaLeitura?: () => void } = {};

  const visivel = (tabela: string, l: Linha) => {
    if (opts.dono === null) return true; // service_role: sem RLS
    if (tabela === "lojas") return l.dono_id === opts.dono;
    if (tabela === "pedidos")
      return tabelas.lojas.some((lj) => lj.id === l.loja_id && lj.dono_id === opts.dono);
    return true;
  };

  function from(tabela: string) {
    const q = {
      op: "select" as "select" | "update" | "insert",
      patch: undefined as Linha | undefined,
      filtros: [] as Filtro[],
      unica: null as null | "single" | "maybeSingle",
      retornar: false,
      contar: false,
    };
    const b: Record<string, unknown> = {};
    const push = (col: string, op: string, val: unknown) => {
      q.filtros.push({ col, op, val });
      return b;
    };
    b.select = () => {
      if (q.op !== "select") q.retornar = true;
      return b;
    };
    b.update = (patch: Linha, o?: { count?: string }) => {
      q.op = "update";
      q.patch = patch;
      q.contar = o?.count === "exact";
      return b;
    };
    b.insert = (patch: Linha) => {
      q.op = "insert";
      q.patch = patch;
      return b;
    };
    b.eq = (c: string, v: unknown) => push(c, "eq", v);
    b.neq = (c: string, v: unknown) => push(c, "neq", v);
    b.is = (c: string, v: unknown) => push(c, "is", v);
    b.in = (c: string, v: unknown[]) => push(c, "in", v);
    b.not = (c: string, op: string, v: unknown) => push(c, `not.${op}`, v);
    b.filter = (c: string, op: string, v: unknown) => push(c, op, v);
    b.match = (m: Linha) => {
      for (const [c, v] of Object.entries(m)) push(c, "eq", v);
      return b;
    };
    b.limit = () => b;
    b.order = () => b;
    b.single = () => {
      q.unica = "single";
      return b;
    };
    b.maybeSingle = () => {
      q.unica = "maybeSingle";
      return b;
    };
    b.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(() => executar())
        .then(ok, erro);

    function executar() {
      if (q.op === "insert") {
        escritas.push({ tabela, patch: q.patch ?? {}, filtros: [], afetadas: 1 });
        return { data: null, error: null };
      }
      const linhas = (tabelas[tabela] ?? []).filter(
        (l) => visivel(tabela, l) && q.filtros.every((f) => avaliar(l, f)),
      );
      if (q.op === "select") {
        leituras.push({ tabela, filtros: [...q.filtros] });
        const copia = linhas.map((l) => ({ ...l }));
        if (tabela === "pedidos") ganchos.depoisDaLeitura?.();
        if (q.unica === "single") {
          return copia.length === 1
            ? { data: copia[0], error: null }
            : { data: null, error: { code: "PGRST116", message: "0 rows" } };
        }
        if (q.unica === "maybeSingle") return { data: copia[0] ?? null, error: null };
        return { data: copia, error: null };
      }
      // update
      const patch = q.patch ?? {};
      for (const l of linhas) {
        if (violaCheckFrete({ ...l, ...patch }) && tabela === "pedidos") {
          escritas.push({ tabela, patch, filtros: [...q.filtros], afetadas: 0 });
          return {
            data: null,
            error: {
              code: "23514",
              message: 'violates check constraint "chk_pedidos_frete_a_combinar"',
            },
            count: null,
          };
        }
      }
      for (const l of linhas) Object.assign(l, patch);
      escritas.push({ tabela, patch, filtros: [...q.filtros], afetadas: linhas.length });
      return {
        data: q.retornar ? linhas.map((l) => ({ ...l })) : null,
        error: null,
        count: q.contar ? linhas.length : null,
      };
    }
    return b;
  }

  const client = {
    from,
    auth: {
      getUser: async () => ({
        data: { user: opts.dono ? { id: opts.dono } : null },
        error: null,
      }),
    },
  };
  return { client, tabelas, escritas, leituras, ganchos };
}

// ───────────────────────────────────────────── mocks de I/O
const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const LOJA_A = "11111111-1111-1111-1111-111111111111";
const LOJA_B = "22222222-2222-2222-2222-222222222222";
const PEDIDO = "99999999-0000-0000-0000-000000000001";
const PEDIDO_B = "99999999-0000-0000-0000-00000000000b";

let banco: ReturnType<typeof criarBanco>;

const createClient = vi.fn(async () => banco.client);
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

// A action do lojista NUNCA pode elevar para service_role (bypass de RLS).
const createServiceClient = vi.fn(() => {
  throw new Error("service_role proibido na action do lojista");
});
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

/** Import dinâmico: o módulo ainda não existe (RED por arquivo inexistente, por teste). */
async function registrar(payload: unknown) {
  const mod = await import("./freteCombinado");
  return mod.registrarFreteCombinado(payload);
}

function pedidoRow(over: Linha = {}): Linha {
  return {
    id: PEDIDO,
    loja_id: LOJA_A,
    subtotal: 50,
    desconto: 5,
    taxa_entrega: null,
    total: 45,
    frete_a_combinar: true,
    tipo_entrega: "entrega",
    status: "pendente",
    cupom_codigo: "CINCO",
    ...over,
  };
}

function pedidoGuardado(id = PEDIDO): Linha {
  const l = banco.tabelas.pedidos.find((p) => p.id === id);
  if (!l) throw new Error(`pedido ${id} não está no fake`);
  return l;
}

function escritasEmPedidos() {
  return banco.escritas.filter((e) => e.tabela === "pedidos");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  banco = criarBanco({ dono: DONO_A });
  banco.tabelas.lojas.push(
    { id: LOJA_A, dono_id: DONO_A, slug: "loja-a" },
    { id: LOJA_B, dono_id: DONO_B, slug: "loja-b" },
  );
  banco.tabelas.pedidos.push(pedidoRow());
});

// ═════════════════════════════════════════════ recálculo autoritativo do total
describe("registrarFreteCombinado — total recalculado no servidor", () => {
  it("subtotal 50, desconto 5 (do banco), valor 7 → UPDATE exato { taxa_entrega: 7, total: 52, frete_a_combinar: false }", async () => {
    const r = await registrar({ pedidoId: PEDIDO, valor: 7 });

    expect(r).toMatchObject({ ok: true });
    const escritas = escritasEmPedidos();
    expect(escritas).toHaveLength(1);
    // Exato: desconto, subtotal, status etc. NUNCA fazem parte do patch.
    expect(escritas[0].patch).toEqual({ taxa_entrega: 7, total: 52, frete_a_combinar: false });
    expect(pedidoGuardado()).toMatchObject({ taxa_entrega: 7, total: 52, frete_a_combinar: false });
  });

  it("recalcula de subtotal − desconto, NÃO soma o valor ao total gravado (total legado 999 é ignorado)", async () => {
    // Se a action fizesse `total + valor`, daria 1006; 45 + 7 = 52 coincidiria
    // com a fórmula certa por acidente aritmético — daí o total divergente.
    banco.tabelas.pedidos[0] = pedidoRow({ total: 999 });
    await registrar({ pedidoId: PEDIDO, valor: 7 });
    expect(pedidoGuardado()).toMatchObject({ total: 52, taxa_entrega: 7 });
  });

  it("aritmética de centavos: 12,30 − 1,23 + 4,56 = 15,63 (não 15,629999…)", async () => {
    banco.tabelas.pedidos[0] = pedidoRow({ subtotal: 12.3, desconto: 1.23, total: 11.07 });
    await registrar({ pedidoId: PEDIDO, valor: 4.56 });
    expect(pedidoGuardado().total).toBe(15.63);
  });

  it("valor 0 é aceito (frete grátis concedido): taxa 0, total 45, frete_a_combinar false", async () => {
    const r = await registrar({ pedidoId: PEDIDO, valor: 0 });
    expect(r).toMatchObject({ ok: true });
    expect(pedidoGuardado()).toMatchObject({ taxa_entrega: 0, total: 45, frete_a_combinar: false });
  });

  it("valor 1000 (o teto, D3) é aceito", async () => {
    const r = await registrar({ pedidoId: PEDIDO, valor: 1000 });
    expect(r).toMatchObject({ ok: true });
    expect(pedidoGuardado()).toMatchObject({ taxa_entrega: 1000, total: 1045 });
  });

  it("usa o client AUTENTICADO (createClient), nunca service_role", async () => {
    await registrar({ pedidoId: PEDIDO, valor: 7 });
    expect(createClient).toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════ borda zod (antes de qualquer I/O)
describe("registrarFreteCombinado — payload validado antes de qualquer I/O", () => {
  it.each([
    ["desconto extra", { pedidoId: PEDIDO, valor: 7, desconto: 0 }],
    ["total extra", { pedidoId: PEDIDO, valor: 7, total: 7 }],
    ["subtotal extra", { pedidoId: PEDIDO, valor: 7, subtotal: 1 }],
    ["frete_a_combinar extra", { pedidoId: PEDIDO, valor: 7, frete_a_combinar: false }],
  ])("%s → recusa (.strict()), sem tocar no banco", async (_nome, payload) => {
    const r = await registrar(payload);
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(createClient).not.toHaveBeenCalled();
    expect(escritasEmPedidos()).toHaveLength(0);
    expect(pedidoGuardado()).toMatchObject({ taxa_entrega: null, total: 45, frete_a_combinar: true });
  });

  it.each([
    ["negativo −1", -1],
    ["acima do teto 1000,01", 1000.01],
    ["fora de centavo 7,005", 7.005],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["string '7'", "7"],
  ])("valor %s → recusa, sem tocar no banco", async (_nome, valor) => {
    const r = await registrar({ pedidoId: PEDIDO, valor });
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(createClient).not.toHaveBeenCalled();
    expect(escritasEmPedidos()).toHaveLength(0);
  });

  it("pedidoId que não é UUID → recusa sem I/O", async () => {
    const r = await registrar({ pedidoId: "nao-e-uuid", valor: 7 });
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(createClient).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════ condições do pedido (D1/D2)
describe("registrarFreteCombinado — só pedido de entrega, a combinar e não cancelado", () => {
  it("pedido com frete_a_combinar = false (frete calculado pelo sistema) → recusa, linha intacta", async () => {
    banco.tabelas.pedidos[0] = pedidoRow({ frete_a_combinar: false, taxa_entrega: 5, total: 50 });
    const r = await registrar({ pedidoId: PEDIDO, valor: 7 });
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(pedidoGuardado()).toMatchObject({ taxa_entrega: 5, total: 50, frete_a_combinar: false });
  });

  it("tipo_entrega = 'retirada' → recusa, linha intacta (mesmo com frete_a_combinar true forjado)", async () => {
    banco.tabelas.pedidos[0] = pedidoRow({ tipo_entrega: "retirada" });
    const r = await registrar({ pedidoId: PEDIDO, valor: 7 });
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(pedidoGuardado()).toMatchObject({ taxa_entrega: null, total: 45, frete_a_combinar: true });
  });

  it("status = 'cancelado' → recusa, linha intacta (D2)", async () => {
    banco.tabelas.pedidos[0] = pedidoRow({ status: "cancelado" });
    const r = await registrar({ pedidoId: PEDIDO, valor: 7 });
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(pedidoGuardado()).toMatchObject({ taxa_entrega: null, total: 45, frete_a_combinar: true });
  });

  it("status = 'entregue' é aceito (D2: qualquer status exceto cancelado)", async () => {
    banco.tabelas.pedidos[0] = pedidoRow({ status: "entregue" });
    const r = await registrar({ pedidoId: PEDIDO, valor: 7 });
    expect(r).toMatchObject({ ok: true });
    expect(pedidoGuardado()).toMatchObject({ taxa_entrega: 7, total: 52 });
  });

  it("SEGUNDO registro no mesmo pedido → recusa, o primeiro valor fica (D1: frete trava)", async () => {
    expect(await registrar({ pedidoId: PEDIDO, valor: 7 })).toMatchObject({ ok: true });
    const r = await registrar({ pedidoId: PEDIDO, valor: 9 });
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(pedidoGuardado()).toMatchObject({ taxa_entrega: 7, total: 52, frete_a_combinar: false });
  });

  it("CORRIDA: a leitura viu 'a combinar', mas outro registro gravou antes do UPDATE → recusa (filtro NO UPDATE)", async () => {
    // Simula o registro concorrente entre o SELECT e o UPDATE desta action.
    // Só um UPDATE filtrado por frete_a_combinar = true resiste a isso; um
    // gate apenas na leitura sobrescreveria o frete já registrado (viola D1).
    banco.ganchos.depoisDaLeitura = () => {
      Object.assign(pedidoGuardado(), { frete_a_combinar: false, taxa_entrega: 3, total: 48 });
      banco.ganchos.depoisDaLeitura = undefined;
    };
    const r = await registrar({ pedidoId: PEDIDO, valor: 7 });
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(pedidoGuardado()).toMatchObject({ taxa_entrega: 3, total: 48, frete_a_combinar: false });
  });

  it("pedido inexistente → recusa sem escrita efetiva", async () => {
    const r = await registrar({ pedidoId: "99999999-0000-0000-0000-0000000000ff", valor: 7 });
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(escritasEmPedidos().every((e) => e.afetadas === 0)).toBe(true);
  });
});

// ═════════════════════════════════════════════ escopo por loja (RLS)
describe("registrarFreteCombinado — escopo por loja via RLS", () => {
  it("lojista A tentando o pedido da loja B → recusa; pedido da loja B intacto", async () => {
    banco.tabelas.pedidos.push(pedidoRow({ id: PEDIDO_B, loja_id: LOJA_B }));
    const r = await registrar({ pedidoId: PEDIDO_B, valor: 7 });
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(pedidoGuardado(PEDIDO_B)).toMatchObject({
      taxa_entrega: null,
      total: 45,
      frete_a_combinar: true,
    });
    expect(escritasEmPedidos().every((e) => e.afetadas === 0)).toBe(true);
  });

  it("erro do banco no UPDATE → { ok:false } com mensagem genérica (sem vazar detalhe)", async () => {
    // Força a violação do CHECK: linha com taxa já numérica e frete ainda true
    // não existe no banco real; aqui serve para provar que `error` vira recusa.
    banco.tabelas.pedidos[0] = pedidoRow();
    const original = banco.client.from;
    banco.client.from = (tabela: string) => {
      const b = original(tabela) as Record<string, unknown>;
      const update = b.update as (p: Linha, o?: unknown) => unknown;
      b.update = (p: Linha, o?: unknown) => update({ ...p, frete_a_combinar: true }, o);
      return b as ReturnType<typeof original>;
    };
    const r = await registrar({ pedidoId: PEDIDO, valor: 7 });
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    if (!r.ok) expect(r.erro).not.toMatch(/chk_|constraint|23514/);
  });
});
