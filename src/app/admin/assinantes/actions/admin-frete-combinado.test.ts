import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — spec `specs/modalidades-entrega-loja.md`, fatia C, variante
 * ADMIN (paridade hub ↔ painel, `specs/paridade-hub-admin-painel.md`). O módulo
 * `./admin-frete-combinado` ainda NÃO existe: cada teste importa a action
 * dinamicamente e falha individualmente por módulo inexistente.
 *
 * CONTRATO que o GREEN deve satisfazer
 * (`src/app/admin/assinantes/actions/admin-frete-combinado.ts`, `'use server'`):
 *
 *   registrarFreteCombinadoAdmin(lojaId: string, payload: unknown):
 *     Promise<{ ok: true } | { ok: false; erro: string }>
 *
 *   payload = { pedidoId: string (uuid), valor: number } — o MESMO schema
 *   `.strict()` da action do lojista (`registrarFreteCombinado`), para que a
 *   page admin injete `acaoFrete={registrarFreteCombinadoAdmin.bind(null, lojaId)}`
 *   com a mesma forma da do painel.
 *
 * Molde: `admin-status.ts` — validarLojaIdAdmin + zod ANTES de qualquer I/O →
 * prepararContextoAdmin FORA do try (prova de admin propaga) → leitura escopada
 * (`escopo.buscarPorId`) do subtotal/desconto → UPDATE escopado
 * (`escopo.atualizar` + filtros de D1/D2) com `count === 1` →
 * `registrarAcessoAdmin` com `acao: "pedido.frete"`.
 *
 * O `admin-loja.ts` é o REAL (o escopo por `loja_id` é o que está sob teste);
 * só o client service_role é fake. O fake é um avaliador em memória: aplica os
 * filtros encadeados sobre a linha guardada — service_role não tem RLS, então a
 * ÚNICA coisa que separa a loja A da loja B aqui é o `eq("loja_id", lojaId)`.
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
  return (l.frete_a_combinar === true) !== (l.taxa_entrega === null);
}

function criarBancoServico() {
  const tabelas: Record<string, Linha[]> = { pedidos: [] };
  const escritas: EscritaRegistrada[] = [];
  const insercoes: { tabela: string; linha: Linha }[] = [];
  const ganchos: { depoisDaLeitura?: () => void } = {};

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
    b.insert = (linha: Linha) => {
      q.op = "insert";
      q.patch = linha;
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
        insercoes.push({ tabela, linha: q.patch ?? {} });
        return { data: null, error: null };
      }
      const linhas = (tabelas[tabela] ?? []).filter((l) => q.filtros.every((f) => avaliar(l, f)));
      if (q.op === "select") {
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
      const patch = q.patch ?? {};
      if (tabela === "pedidos" && linhas.some((l) => violaCheckFrete({ ...l, ...patch }))) {
        escritas.push({ tabela, patch, filtros: [...q.filtros], afetadas: 0 });
        return {
          data: null,
          error: { code: "23514", message: 'violates check constraint "chk_pedidos_frete_a_combinar"' },
          count: null,
        };
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

  return { client: { from }, tabelas, escritas, insercoes, ganchos };
}

// ───────────────────────────────────────────── mocks de I/O
const LOJA_A = "11111111-1111-1111-1111-111111111111"; // loja da URL admin
const LOJA_B = "22222222-2222-2222-2222-222222222222"; // loja alheia
const PEDIDO = "99999999-0000-0000-0000-000000000001";
const PEDIDO_B = "99999999-0000-0000-0000-00000000000b";
const ADMIN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

let banco: ReturnType<typeof criarBancoServico>;

const createServiceClient = vi.fn(() => banco.client);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
  obterAdminUserId: () => ADMIN_ID,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

async function registrarAdmin(lojaId: string, payload: unknown) {
  const mod = await import("./admin-frete-combinado");
  return mod.registrarFreteCombinadoAdmin(lojaId, payload);
}

/** `registrarAcessoAdmin` é fire-and-forget: deixa a microtarefa do INSERT rodar. */
const drenar = () => new Promise((r) => setTimeout(r, 0));

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
    ...over,
  };
}

function pedidoGuardado(id = PEDIDO): Linha {
  const l = banco.tabelas.pedidos.find((p) => p.id === id);
  if (!l) throw new Error(`pedido ${id} não está no fake`);
  return l;
}

const escritasEmPedidos = () => banco.escritas.filter((e) => e.tabela === "pedidos");
const intacto = { taxa_entrega: null, total: 45, frete_a_combinar: true };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  banco = criarBancoServico();
  banco.tabelas.pedidos.push(pedidoRow());
  verificarAdminSaaS.mockResolvedValue(undefined);
});

// ═════════════════════════════════════════════ caminho feliz + escopo
describe("registrarFreteCombinadoAdmin — grava escopado na loja-alvo", () => {
  it("subtotal 50, desconto 5 (do banco), valor 7 → UPDATE exato { taxa_entrega: 7, total: 52, frete_a_combinar: false }, escopado por loja_id", async () => {
    const r = await registrarAdmin(LOJA_A, { pedidoId: PEDIDO, valor: 7 });

    expect(r).toMatchObject({ ok: true });
    const [upd] = escritasEmPedidos();
    expect(upd.patch).toEqual({ taxa_entrega: 7, total: 52, frete_a_combinar: false });
    expect(upd.filtros).toContainEqual({ col: "loja_id", op: "eq", val: LOJA_A });
    expect(upd.filtros).toContainEqual({ col: "id", op: "eq", val: PEDIDO });
    expect(pedidoGuardado()).toMatchObject({ taxa_entrega: 7, total: 52, frete_a_combinar: false });
    expect(verificarAdminSaaS).toHaveBeenCalledTimes(1);
  });

  it("recalcula de subtotal − desconto do BANCO (total legado 999 ignorado)", async () => {
    banco.tabelas.pedidos[0] = pedidoRow({ total: 999 });
    await registrarAdmin(LOJA_A, { pedidoId: PEDIDO, valor: 7 });
    expect(pedidoGuardado()).toMatchObject({ total: 52, taxa_entrega: 7 });
  });

  it("valor 0 aceito (frete grátis concedido)", async () => {
    const r = await registrarAdmin(LOJA_A, { pedidoId: PEDIDO, valor: 0 });
    expect(r).toMatchObject({ ok: true });
    expect(pedidoGuardado()).toMatchObject({ taxa_entrega: 0, total: 45, frete_a_combinar: false });
  });

  it("registra log de acesso admin: acao 'pedido.frete', loja-alvo e o pedido", async () => {
    await registrarAdmin(LOJA_A, { pedidoId: PEDIDO, valor: 7 });
    await drenar();
    const logs = banco.insercoes.filter((i) => i.tabela === "admin_acessos");
    expect(logs).toHaveLength(1);
    expect(logs[0].linha).toMatchObject({
      admin_user_id: ADMIN_ID,
      loja_id: LOJA_A,
      acao: "pedido.frete",
      entidade_id: PEDIDO,
    });
  });

  it("CROSS-LOJA: lojaId da URL = A, pedido da loja B → recusa por escopo; pedido B intacto", async () => {
    banco.tabelas.pedidos.push(pedidoRow({ id: PEDIDO_B, loja_id: LOJA_B }));
    const r = await registrarAdmin(LOJA_A, { pedidoId: PEDIDO_B, valor: 7 });
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(pedidoGuardado(PEDIDO_B)).toMatchObject(intacto);
    expect(escritasEmPedidos().every((e) => e.afetadas === 0)).toBe(true);
  });
});

// ═════════════════════════════════════════════ fail-closed antes de elevar
describe("registrarFreteCombinadoAdmin — validação e prova de admin ANTES de elevar", () => {
  it("admin NÃO provado → exceção PROPAGA, service_role nunca criado, zero escrita", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("Acesso negado."));
    await expect(registrarAdmin(LOJA_A, { pedidoId: PEDIDO, valor: 7 })).rejects.toThrow(
      "Acesso negado.",
    );
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(pedidoGuardado()).toMatchObject(intacto);
  });

  it("lojaId não-UUID → recusa sem elevar", async () => {
    const r = await registrarAdmin("nao-e-uuid", { pedidoId: PEDIDO, valor: 7 });
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it.each([
    ["desconto extra", { pedidoId: PEDIDO, valor: 7, desconto: 0 }],
    ["total extra", { pedidoId: PEDIDO, valor: 7, total: 7 }],
    ["loja_id extra", { pedidoId: PEDIDO, valor: 7, loja_id: LOJA_B }],
  ])("%s → recusa (.strict()) sem elevar nem escrever", async (_nome, payload) => {
    const r = await registrarAdmin(LOJA_A, payload);
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(pedidoGuardado()).toMatchObject(intacto);
  });

  it.each([
    ["negativo −1", -1],
    ["acima do teto 1000,01", 1000.01],
    ["fora de centavo 7,005", 7.005],
  ])("valor %s → recusa sem elevar", async (_nome, valor) => {
    const r = await registrarAdmin(LOJA_A, { pedidoId: PEDIDO, valor });
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════ mesmas travas do lojista
describe("registrarFreteCombinadoAdmin — mesmas condições do pedido (D1/D2)", () => {
  it("frete_a_combinar = false → recusa, linha intacta", async () => {
    banco.tabelas.pedidos[0] = pedidoRow({ frete_a_combinar: false, taxa_entrega: 5, total: 50 });
    const r = await registrarAdmin(LOJA_A, { pedidoId: PEDIDO, valor: 7 });
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(pedidoGuardado()).toMatchObject({ taxa_entrega: 5, total: 50, frete_a_combinar: false });
  });

  it("tipo_entrega = 'retirada' → recusa, linha intacta", async () => {
    banco.tabelas.pedidos[0] = pedidoRow({ tipo_entrega: "retirada" });
    const r = await registrarAdmin(LOJA_A, { pedidoId: PEDIDO, valor: 7 });
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(pedidoGuardado()).toMatchObject(intacto);
  });

  it("status = 'cancelado' → recusa, linha intacta", async () => {
    banco.tabelas.pedidos[0] = pedidoRow({ status: "cancelado" });
    const r = await registrarAdmin(LOJA_A, { pedidoId: PEDIDO, valor: 7 });
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(pedidoGuardado()).toMatchObject(intacto);
  });

  it("SEGUNDO registro → recusa, o primeiro valor fica (D1)", async () => {
    expect(await registrarAdmin(LOJA_A, { pedidoId: PEDIDO, valor: 7 })).toMatchObject({ ok: true });
    const r = await registrarAdmin(LOJA_A, { pedidoId: PEDIDO, valor: 9 });
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(pedidoGuardado()).toMatchObject({ taxa_entrega: 7, total: 52, frete_a_combinar: false });
  });

  it("CORRIDA entre a leitura e o UPDATE → recusa (filtro no UPDATE, count 0)", async () => {
    banco.ganchos.depoisDaLeitura = () => {
      Object.assign(pedidoGuardado(), { frete_a_combinar: false, taxa_entrega: 3, total: 48 });
      banco.ganchos.depoisDaLeitura = undefined;
    };
    const r = await registrarAdmin(LOJA_A, { pedidoId: PEDIDO, valor: 7 });
    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(pedidoGuardado()).toMatchObject({ taxa_entrega: 3, total: 48, frete_a_combinar: false });
  });
});
