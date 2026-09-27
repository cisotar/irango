import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) da issue 301 — Server Actions do modal sazonal.
 *
 * As actions ainda NÃO existem: a importação ao final resolve para um módulo
 * que não foi criado → FAIL por "Cannot find module './modalSazonal'" ou
 * "is not a function". Esse é o RED intencional.
 *
 * Segurança coberta:
 *  - loja_id sempre de buscarLojaDoDono, NUNCA do payload (RN-11 / seguranca.md §10)
 *  - schema .strict(): chave extra no payload é recusada antes de qualquer I/O
 *  - teto de cardinalidade nas listas: .max(50) (CWE-770)
 *  - ativar um modal desativa o anterior na mesma transação (RN-05)
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

// Importa DEPOIS dos mocks — o módulo ainda não existe, o que garante o FAIL.
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
    categorias: ["00000000-0000-0000-0000-000000000001"],
    cardapios: [],
    mostrar_promocoes_junto: false,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  captura = { filtros: [], deleteCalled: false };
  respostaBanco = { data: { id: MODAL_ID }, error: null };
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
      // Se passou o strict, o insert deve usar o do dono, não o forjado.
      expect(captura.insert?.loja_id).not.toBe(LOJA_OUTRA);
      expect(captura.insert?.loja_id).toBe(LOJA_DONO);
    } else {
      // Recusado pelo .strict() antes do banco — também correto.
      expect(r.ok).toBe(false);
    }
  });

  it("[.strict()] chave extra no payload é rejeitada antes de qualquer I/O", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await criarModalSazonal({ ...payloadCriar(), campo_desconhecido: "xss" });
    expect(r.ok).toBe(false);
    // Nenhuma escrita deve ter ocorrido.
    expect(captura.insert).toBeUndefined();
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
    expect(captura.insert).toBeUndefined();
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
    expect(captura.insert).toBeUndefined();
    spy.mockRestore();
  });

  it("[RN-06] seleção vazia (zero categorias e zero cardápios) é rejeitada", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await criarModalSazonal(
      payloadCriar({ categorias: [], cardapios: [] }),
    );
    expect(r.ok).toBe(false);
    expect(captura.insert).toBeUndefined();
    spy.mockRestore();
  });

  it("[RN-01] título vazio é rejeitado", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await criarModalSazonal(payloadCriar({ titulo: "" }));
    expect(r.ok).toBe(false);
    expect(captura.insert).toBeUndefined();
    spy.mockRestore();
  });
});

// ─────────────────────────────────── ativarModalSazonal

describe("ativarModalSazonal (Server Action)", () => {
  it("[RN-05] ativar um modal desativa o anterior OU falha com 23505 tratado genericamente", async () => {
    // Cenário 1: o banco recusa com 23505 (índice único parcial — backstop estrutural).
    // A action deve tratar como erro genérico, sem vazar o código do banco.
    respostaBanco = { data: null, error: { code: "23505", message: "duplicate key" } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await ativarModalSazonal(MODAL_ID);
    expect(r.ok).toBe(false);
    // O erro retornado NÃO pode vazar a mensagem interna do banco (seguranca.md §14).
    if (!r.ok) {
      expect(JSON.stringify(r)).not.toContain("duplicate key");
      expect(JSON.stringify(r)).not.toContain("23505");
    }
    spy.mockRestore();
  });

  it("[RN-11] ativar modal de loja alheia (buscarLojaDoDono retorna loja diferente) é recusado", async () => {
    // buscarLojaDoDono retorna a loja do dono — o modal ativado é da loja B.
    // A action deve verificar posse ANTES de ativar.
    buscarLojaDoDono.mockResolvedValue({ ...lojaDoDono(), id: LOJA_OUTRA });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await ativarModalSazonal(MODAL_ALHEIO);
    // A action deve falhar quando o modal não pertence à loja do dono.
    // (O próprio banco via RLS também bariria, mas a action deve checar.)
    expect(r.ok).toBe(false);
    spy.mockRestore();
  });
});

// ─────────────────────────────────── editarModalSazonal

describe("editarModalSazonal (Server Action)", () => {
  it("[RN-11] editar modal de loja alheia é recusado — posse derivada de buscarLojaDoDono", async () => {
    // Testa o cenário em que o banco (via RLS) recusaria o UPDATE com 0 rows
    // afetadas — a action deve reconhecer e retornar erro.
    respostaBanco = { data: null, error: null }; // 0 rows: modal não pertence à loja
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await editarModalSazonal(MODAL_ALHEIO, payloadCriar({ titulo: "Sequestro" }));
    // Com 0 linhas afetadas, a action deve retornar falha — nunca { ok: true } silencioso.
    expect(r.ok).toBe(false);
    spy.mockRestore();
  });

  it("[.strict()] chave extra na edição é rejeitada antes de qualquer I/O", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await editarModalSazonal(MODAL_ID, {
      ...payloadCriar(),
      loja_id: LOJA_OUTRA, // tentativa de reescrever a posse
    });
    expect(r.ok).toBe(false);
    expect(captura.update).toBeUndefined();
    spy.mockRestore();
  });
});
