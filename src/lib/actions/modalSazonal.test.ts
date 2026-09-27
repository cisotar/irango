import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Server Actions do modal sazonal (issue 301; caminho RPC da issue 314).
 *
 * criar/editar gravam por UMA chamada `rpc("salvar_modal_sazonal", args)`
 * (RN-M15); ativar grava por UMA `rpc("ativar_modal_sazonal", { p_modal_id })` (RN-M16).
 *
 * Segurança coberta:
 *  - loja_id sempre de buscarLojaDoDono, NUNCA do payload (RN-11 / seguranca.md §10)
 *  - seleção vazia e mensagem null são aceitas (RN-M02)
 *  - schema .strict(): chave extra no payload é recusada antes de qualquer I/O
 *  - teto de cardinalidade nas listas: .max(50) (CWE-770)
 *  - ativar um modal desativa o anterior na mesma transação da RPC (RN-05/RN-M16)
 *  - editar modal de loja alheia é recusado (RLS / buscarLojaDoDono fail-closed)
 *
 * Molde: src/lib/actions/cupomGestao.test.ts (query-builder chainable, mocks de
 * buscarLojaDoDono, createClient/createServiceClient, next/cache).
 */

// ─────────────────────────────────── constantes de fixture
const LOJA_DONO = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LOJA_OUTRA = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const MODAL_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const MODAL_ALHEIO = "dddddddd-dddd-dddd-dddd-dddddddddddd";

// ─────────────────────────────────── captura de I/O
type Captura = {
  tabela?: string;
  rpc?: { nome: string; args: Record<string, unknown> };
  insert?: Record<string, unknown>;
  update?: Record<string, unknown>;
  filtros: Array<[string, unknown]>;
  deleteCalled: boolean;
};
let captura: Captura;
let respostaBanco: { data: unknown; error: unknown };

// Query-builder chainable mínimo (mesmo padrão de cupomGestao.test.ts).
// O CLIENT RAIZ não pode ser thenável — só a cadeia da query o é.
function makeChain() {
  const queryChain: Record<string, unknown> = {};
  const passthrough = (k: string) => {
    queryChain[k] = (...args: unknown[]) => {
      if (k === "eq") captura.filtros.push([args[0] as string, args[1]]);
      return queryChain;
    };
  };
  ["select", "eq", "single", "maybeSingle", "limit", "neq"].forEach(passthrough);
  queryChain.insert = (row: Record<string, unknown>) => {
    captura.insert = row;
    return queryChain;
  };
  queryChain.update = (row: Record<string, unknown>) => {
    captura.update = row;
    return queryChain;
  };
  queryChain.delete = () => {
    captura.deleteCalled = true;
    return queryChain;
  };
  queryChain.then = (onF: (v: unknown) => unknown) =>
    Promise.resolve(respostaBanco).then(onF);

  const client: Record<string, unknown> = {
    from: (t: string) => {
      captura.tabela = t;
      return queryChain;
    },
    rpc: (nome: string, args: Record<string, unknown>) => {
      captura.rpc = { nome, args };
      return { then: queryChain.then };
    },
  };
  return client;
}

const authClient = makeChain();
const createClient = vi.fn(async () => authClient);
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const createServiceClient = vi.fn(() => ({ __fake: "service" }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const buscarLojaDoDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
  slugExiste: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

// Importa DEPOIS dos mocks.
import {
  criarModalSazonal,
  ativarModalSazonal,
  editarModalSazonal,
} from "./modalSazonal";

// ─────────────────────────────────── helpers de fixture
function lojaDoDono() {
  return { id: LOJA_DONO, dono_id: "dono-1", slug: "minha-loja", ativo: true };
}

/** Payload mínimo e válido para criarModalSazonal. */
function payloadCriar(over: Record<string, unknown> = {}) {
  return {
    titulo: "Cardápio de Inverno",
    exibicao_inicio: "2026-06-01T00:00:00-03:00",
    exibicao_fim: "2026-06-16T00:00:00-03:00",
    mensagem: null,
    categorias: ["00000000-0000-0000-0000-000000000001"],
    cardapios: [],
    mostrar_promocoes_junto: false,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  captura = { filtros: [], deleteCalled: false };
  respostaBanco = { data: MODAL_ID, error: null };
  buscarLojaDoDono.mockResolvedValue(lojaDoDono());
});

// ─────────────────────────────────── criarModalSazonal

describe("criarModalSazonal (Server Action)", () => {
  it("[RN-11] loja_id FORJADO no payload é ignorado — action usa o de buscarLojaDoDono", async () => {
    // O cliente injeta loja_id de outra loja; o servidor deve usar o do dono.
    const r = await criarModalSazonal({ ...payloadCriar(), loja_id: LOJA_OUTRA });
    // A action rejeita por .strict() (chave extra) OU ignora e deriva do dono.
    // Em ambos os casos, o loja_id persistido NUNCA pode ser o injetado.
    if (r.ok) {
      // Se passou o strict, a RPC deve receber o do dono, não o forjado.
      expect(captura.rpc?.args.p_loja_id).not.toBe(LOJA_OUTRA);
      expect(captura.rpc?.args.p_loja_id).toBe(LOJA_DONO);
    } else {
      // Recusado pelo .strict() antes do banco — também correto.
      expect(r.ok).toBe(false);
      expect(captura.rpc).toBeUndefined();
    }
  });

  it("[RN-11] payload válido: uma rpc com p_loja_id de buscarLojaDoDono e p_modal_id null", async () => {
    const r = await criarModalSazonal(payloadCriar());
    expect(r).toEqual({ ok: true });
    expect(captura.rpc?.nome).toBe("salvar_modal_sazonal");
    expect(captura.rpc?.args.p_loja_id).toBe(LOJA_DONO);
    expect(captura.rpc?.args.p_modal_id).toBeNull();
    expect(captura.rpc?.args.p_mostrar_promocoes_junto).toBe(false);
    expect(captura.tabela).toBeUndefined();
  });

  it("[.strict()] chave extra no payload é rejeitada antes de qualquer I/O", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await criarModalSazonal({ ...payloadCriar(), campo_desconhecido: "xss" });
    expect(r.ok).toBe(false);
    // Nenhuma escrita deve ter ocorrido.
    expect(captura.rpc).toBeUndefined();
    spy.mockRestore();
  });

  it("[CWE-770] lista de categorias acima do teto (51 itens) é rejeitada", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ids = Array.from(
      { length: 51 },
      (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    );
    const r = await criarModalSazonal(payloadCriar({ categorias: ids }));
    expect(r.ok).toBe(false);
    expect(captura.rpc).toBeUndefined();
    spy.mockRestore();
  });

  it("[CWE-770] lista de cardápios acima do teto (51 itens) é rejeitada", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ids = Array.from(
      { length: 51 },
      (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    );
    const r = await criarModalSazonal(
      payloadCriar({ categorias: [], cardapios: ids }),
    );
    expect(r.ok).toBe(false);
    expect(captura.rpc).toBeUndefined();
    spy.mockRestore();
  });

  it("[RN-M02] seleção vazia (zero categorias e zero cardápios) é aceita", async () => {
    const r = await criarModalSazonal(
      payloadCriar({ categorias: [], cardapios: [] }),
    );
    expect(r).toEqual({ ok: true });
    expect(captura.rpc?.nome).toBe("salvar_modal_sazonal");
    expect(captura.rpc?.args.p_categorias).toEqual([]);
    expect(captura.rpc?.args.p_cardapios).toEqual([]);
  });

  it("[RN-M03] payload sem a chave `mensagem` é rejeitado antes do banco", async () => {
    const semMensagem: Record<string, unknown> = payloadCriar();
    delete semMensagem.mensagem;
    const r = await criarModalSazonal(semMensagem);
    expect(r.ok).toBe(false);
    expect(captura.rpc).toBeUndefined();
  });

  it("[RN-01] título vazio é rejeitado", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await criarModalSazonal(payloadCriar({ titulo: "" }));
    expect(r.ok).toBe(false);
    expect(captura.rpc).toBeUndefined();
    spy.mockRestore();
  });
});

// ─────────────────────────────────── ativarModalSazonal

describe("ativarModalSazonal (Server Action)", () => {
  it("[RN-M16] sucesso: uma rpc('ativar_modal_sazonal', { p_modal_id }) e nenhum .from", async () => {
    respostaBanco = { data: null, error: null }; // a RPC devolve void
    const r = await ativarModalSazonal(MODAL_ID);
    expect(r).toEqual({ ok: true });
    expect(captura.rpc).toEqual({ nome: "ativar_modal_sazonal", args: { p_modal_id: MODAL_ID } });
    expect(captura.tabela).toBeUndefined();
    expect(captura.update).toBeUndefined();
  });

  it("[RN-05] 23505 (índice único parcial, corrida) vira erro genérico sem vazar o código", async () => {
    respostaBanco = { data: null, error: { code: "23505", message: "duplicate key" } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await ativarModalSazonal(MODAL_ID);
    expect(r.ok).toBe(false);
    // O erro retornado NÃO pode vazar a mensagem interna do banco (seguranca.md §14).
    expect(JSON.stringify(r)).not.toContain("duplicate key");
    expect(JSON.stringify(r)).not.toContain("23505");
    spy.mockRestore();
  });

  it("[RN-11] modal de loja alheia: a RPC recusa (modal inexistente) e a action devolve erro genérico", async () => {
    respostaBanco = {
      data: null,
      error: { code: "P0001", message: "modal_sazonal: modal inexistente" },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await ativarModalSazonal(MODAL_ALHEIO);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("modal_sazonal");
    // O id vai para a RPC, que confere a posse contra auth.uid(); nada de loja_id do cliente.
    expect(captura.rpc).toEqual({ nome: "ativar_modal_sazonal", args: { p_modal_id: MODAL_ALHEIO } });
    expect(captura.tabela).toBeUndefined();
    spy.mockRestore();
  });

  it("[RN-11] sem loja do dono: recusa antes da RPC", async () => {
    buscarLojaDoDono.mockResolvedValue(null);
    const r = await ativarModalSazonal(MODAL_ID);
    expect(r).toEqual({ ok: false, erro: "Loja não encontrada." });
    expect(captura.rpc).toBeUndefined();
  });

  it("[RN-M10] id que não é uuid: recusa antes de client e RPC", async () => {
    const r = await ativarModalSazonal("nao-e-uuid");
    expect(r.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
    expect(captura.rpc).toBeUndefined();
  });
});

// ─────────────────────────────────── editarModalSazonal

describe("editarModalSazonal (Server Action)", () => {
  it("[RN-11] editar modal de loja alheia é recusado — posse derivada de buscarLojaDoDono", async () => {
    // A RPC recusa modal de outra loja (S4, mesma mensagem de id inexistente).
    respostaBanco = {
      data: null,
      error: { code: "P0001", message: "modal_sazonal: modal inexistente" },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await editarModalSazonal(MODAL_ALHEIO, payloadCriar({ titulo: "Sequestro" }));
    // Recusa — nunca { ok: true } silencioso, e o detalhe do banco não vaza.
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("modal inexistente");
    expect(captura.rpc?.args.p_loja_id).toBe(LOJA_DONO);
    expect(captura.rpc?.args.p_modal_id).toBe(MODAL_ALHEIO);
    spy.mockRestore();
  });

  it("[RN-11] RPC sem id de retorno (0 linhas) é recusa, nunca sucesso silencioso", async () => {
    respostaBanco = { data: null, error: null };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await editarModalSazonal(MODAL_ALHEIO, payloadCriar());
    expect(r.ok).toBe(false);
    spy.mockRestore();
  });

  it("[RN-M10] id de rota lixo é rejeitado antes de qualquer I/O", async () => {
    const r = await editarModalSazonal("1 or 1=1", payloadCriar());
    expect(r.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
    expect(captura.rpc).toBeUndefined();
  });

  it("[.strict()] chave extra na edição é rejeitada antes de qualquer I/O", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await editarModalSazonal(MODAL_ID, {
      ...payloadCriar(),
      loja_id: LOJA_OUTRA, // tentativa de reescrever a posse
    });
    expect(r.ok).toBe(false);
    expect(captura.rpc).toBeUndefined();
    spy.mockRestore();
  });
});
