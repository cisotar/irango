import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

import { listarFaturasDaLojaAdmin, type FaturaAssinatura } from "./pagamentosAssinatura";

/**
 * Isolamento cross-loja de `listarFaturasDaLojaAdmin` (issue 150) — variante
 * ADMIN de `listarFaturasDaLoja` que roda sob service_role (BYPASSA RLS).
 *
 * Invariante de segurança provada (escrita PRIMEIRO / red): sob service_role a
 * RLS `pagamentos_assinatura` NÃO filtra — o `.eq("loja_id", lojaId)` é a ÚNICA
 * barreira de isolamento. Sem ele, o `select("*")` vazaria faturas de TODAS as
 * lojas (valor monetário/estratégia de cobrança de terceiros).
 *
 * LETALIDADE: o builder-espião aplica os `.eq` CAPTURADOS ao dataset semeado
 * (faturas de A e B). Se a implementação omitir `.eq("loja_id", ...)`, o
 * terminal devolve A+B e o `toEqual([...só A])` falha.
 */

const LOJA_A = "11111111-1111-1111-1111-111111111111";
const LOJA_B = "22222222-2222-2222-2222-222222222222";
const LOJA_SEM_FATURAS = "33333333-3333-3333-3333-333333333333";

/** Preenche as colunas de `pagamentos_assinatura` não relevantes ao teste. */
function fatura(
  over: Partial<FaturaAssinatura> & { id: string; loja_id: string; criado_em: string },
): FaturaAssinatura {
  return {
    competencia: null,
    fatura_url: null,
    metodo: null,
    provider: "hotmart",
    provider_payment_id: null,
    status: "aprovada",
    valor: 49.9,
    ...over,
  };
}

// Dataset já ordenado por `criado_em` desc (como o Postgres devolveria), para o
// slice de `limite` do builder-espião casar a ordem esperada.
const faturaA1 = fatura({ id: "a1", loja_id: LOJA_A, criado_em: "2026-03-01T00:00:00Z" });
const faturaA2 = fatura({ id: "a2", loja_id: LOJA_A, criado_em: "2026-02-01T00:00:00Z" });
const faturaA3 = fatura({ id: "a3", loja_id: LOJA_A, criado_em: "2026-01-01T00:00:00Z" });
const faturaB1 = fatura({ id: "b1", loja_id: LOJA_B, criado_em: "2026-02-15T00:00:00Z" });

const DATASET: FaturaAssinatura[] = [faturaA1, faturaB1, faturaA2, faturaA3];

// ── Query builder encadeável e espionável (padrão isolamento-admin.test.ts) ───
type Captura = {
  tabela: string | null;
  selects: string[];
  eqs: { coluna: string; valor: unknown }[];
  orders: { coluna: string; opts: unknown }[];
  limits: number[];
};

let cap: Captura;
let terminalError: unknown;

function criarBuilder(tabela: string): Record<string, unknown> {
  cap.tabela = tabela;
  const builder: Record<string, unknown> = {
    select(cols: string) {
      cap.selects.push(cols);
      return builder;
    },
    eq(coluna: string, valor: unknown) {
      cap.eqs.push({ coluna, valor });
      return builder;
    },
    order(coluna: string, opts: unknown) {
      cap.orders.push({ coluna, opts });
      return builder;
    },
    limit(n: number) {
      cap.limits.push(n);
      return builder;
    },
    then(resolve: (v: { data: unknown; error: unknown }) => unknown) {
      if (terminalError) {
        return Promise.resolve({ data: null, error: terminalError }).then(resolve);
      }
      // Aplica os .eq capturados ao dataset — É o que prova o isolamento.
      let linhas = DATASET;
      for (const { coluna, valor } of cap.eqs) {
        linhas = linhas.filter((l) => (l as Record<string, unknown>)[coluna] === valor);
      }
      const limite = cap.limits.at(-1);
      if (typeof limite === "number") linhas = linhas.slice(0, limite);
      return Promise.resolve({ data: linhas, error: null }).then(resolve);
    },
  };
  return builder;
}

const from = vi.fn((t: string) => criarBuilder(t));
const svc = { from } as unknown as SupabaseClient<Database>;

beforeEach(() => {
  vi.clearAllMocks();
  cap = { tabela: null, selects: [], eqs: [], orders: [], limits: [] };
  terminalError = null;
});

describe("listarFaturasDaLojaAdmin — isolamento cross-loja (.eq loja_id)", () => {
  it("retorna SÓ as faturas da loja pedida (A), nunca as de B", async () => {
    const faturas = await listarFaturasDaLojaAdmin(svc, LOJA_A);

    expect(faturas).toEqual([faturaA1, faturaA2, faturaA3]);
    expect(faturas).not.toContain(faturaB1);
  });

  it("emite o `.eq(\"loja_id\", lojaId)` — barreira autoritativa sob service_role", async () => {
    await listarFaturasDaLojaAdmin(svc, LOJA_A);

    expect(cap.tabela).toBe("pagamentos_assinatura");
    expect(cap.eqs).toContainEqual({ coluna: "loja_id", valor: LOJA_A });
    expect(cap.eqs).not.toContainEqual({ coluna: "loja_id", valor: LOJA_B });
  });

  it("escopa por B → devolve só as de B", async () => {
    const faturas = await listarFaturasDaLojaAdmin(svc, LOJA_B);

    expect(faturas).toEqual([faturaB1]);
  });
});

describe("listarFaturasDaLojaAdmin — ordenação e limite", () => {
  it("ordena por `criado_em` desc", async () => {
    await listarFaturasDaLojaAdmin(svc, LOJA_A);

    expect(cap.orders).toContainEqual({
      coluna: "criado_em",
      opts: { ascending: false },
    });
  });

  it("aplica o limite padrão de 24 quando omitido", async () => {
    await listarFaturasDaLojaAdmin(svc, LOJA_A);

    expect(cap.limits).toContain(24);
  });

  it("respeita o limite explícito", async () => {
    const faturas = await listarFaturasDaLojaAdmin(svc, LOJA_A, 2);

    expect(cap.limits).toContain(2);
    expect(faturas).toEqual([faturaA1, faturaA2]);
  });
});

describe("listarFaturasDaLojaAdmin — bordas", () => {
  it("loja sem faturas → [] (passthrough data ?? [])", async () => {
    const faturas = await listarFaturasDaLojaAdmin(svc, LOJA_SEM_FATURAS);

    expect(faturas).toEqual([]);
  });

  it("propaga o `error` do PostgREST (não mascara)", async () => {
    terminalError = { message: "boom", code: "42501" };

    await expect(listarFaturasDaLojaAdmin(svc, LOJA_A)).rejects.toEqual({
      message: "boom",
      code: "42501",
    });
  });

  it("`lojaId` inválido (não-UUID) → [] SEM tocar o banco (guard z.guid, evita 22P02)", async () => {
    const faturas = await listarFaturasDaLojaAdmin(svc, "nao-e-uuid");

    expect(faturas).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("`lojaId` vazio (string vazia) → [] SEM tocar o banco", async () => {
    const faturas = await listarFaturasDaLojaAdmin(svc, "");

    expect(faturas).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
});
