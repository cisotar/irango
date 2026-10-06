import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — galeria de imagens × exclusão permanente de loja
 * (`excluirLoja` → `limparStorageDaLoja`, `src/app/admin/assinantes/actions.ts`).
 * specs/galeria-imagens-loja.md, página 6 e RN-G15.
 *
 * Hoje a limpeza só lista `${lojaId}/` e `${lojaId}/logo/` com `list()` sem
 * paginação (máx. 100 por chamada) e não conhece `galeria/`. Passa a:
 *  - ler `caminho` + `miniatura_caminho` de `imagens_loja` DA LOJA (.eq loja_id)
 *    ANTES do DELETE da loja (a tabela cai em cascata junto);
 *  - remover em blocos de ATÉ 100 caminhos por chamada;
 *  - descartar caminho sem o prefixo `${lojaId}/` (sob service_role o caminho é
 *    a única amarra no Storage);
 *  - manter a listagem atual como complemento;
 *  - best-effort: nunca aborta o DELETE.
 *
 * RED por asserção: `actions.ts` existe; hoje nenhuma leitura de imagens_loja
 * acontece e a pasta `galeria/` não é removida.
 */

const LOJA = "11111111-1111-1111-1111-111111111111";
const OUTRA = "22222222-2222-2222-2222-222222222222";

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
}));

type Chamada = { metodo: string; args: unknown[] };
type Op = { tabela: string; chamadas: Chamada[] };
let ops: Op[];
let sequencia: string[];
let linhasImagens: { caminho: string; miniatura_caminho: string | null }[];
let respostaImagens: () => { data: unknown; error: unknown };
const listCalls: { bucket: string; prefix: string }[] = [];
const removeCalls: { bucket: string; paths: string[] }[] = [];
let removeResponder: (bucket: string, paths: string[]) => { data: unknown; error: unknown };

const clientServico = {
  from(tabela: string) {
    const op: Op = { tabela, chamadas: [] };
    ops.push(op);
    const proxy: unknown = new Proxy(
      {},
      {
        get(_alvo, prop) {
          if (prop === "then") {
            return (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
              Promise.resolve()
                .then(() => {
                  sequencia.push(`le:${tabela}`);
                  return tabela === "imagens_loja" ? respostaImagens() : { data: [], error: null };
                })
                .then(ok, falha);
          }
          return (...args: unknown[]) => {
            op.chamadas.push({ metodo: String(prop), args });
            return proxy;
          };
        },
      },
    );
    return proxy;
  },
  storage: {
    from: (bucket: string) => ({
      list: async (prefix: string) => {
        listCalls.push({ bucket, prefix });
        return {
          data: [{ name: prefix.endsWith("/logo") ? "listada-logo.webp" : "listada.webp", id: "obj" }],
          error: null,
        };
      },
      remove: async (paths: string[]) => {
        removeCalls.push({ bucket, paths });
        return removeResponder(bucket, paths);
      },
    }),
  },
};
const createServiceClient = vi.fn(() => clientServico);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const excluirLojaPermanente = vi.fn(async () => {
  sequencia.push("delete:loja");
  return { linhasAfetadas: 1 };
});
vi.mock("@/lib/supabase/queries/adminAssinatura", () => ({
  excluirLojaPermanente: () => excluirLojaPermanente(),
  aplicarStatusAdmin: vi.fn(),
}));

import { excluirLoja } from "./actions";

function linhasDaLoja(qtd: number) {
  return Array.from({ length: qtd }, (_, i) => {
    const id = `aaaaaaaa-aaaa-aaaa-aaaa-${i.toString().padStart(12, "0")}`;
    return {
      caminho: `${LOJA}/galeria/${id}.webp`,
      miniatura_caminho: `${LOJA}/galeria/mini/${id}.webp`,
    };
  });
}

function removidosProdutos(): string[] {
  return removeCalls.filter((c) => c.bucket === "produtos").flatMap((c) => c.paths);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  ops = [];
  sequencia = [];
  listCalls.length = 0;
  removeCalls.length = 0;
  linhasImagens = linhasDaLoja(3);
  respostaImagens = () => ({ data: linhasImagens, error: null });
  removeResponder = () => ({ data: {}, error: null });
});

describe("limparStorageDaLoja — caminhos registrados em imagens_loja (RN-G15)", () => {
  it("lê caminho + miniatura_caminho de imagens_loja DA LOJA antes do DELETE da loja", async () => {
    const r = await excluirLoja(LOJA);
    expect(r.ok).toBe(true);

    const leitura = ops.find((o) => o.tabela === "imagens_loja");
    expect(leitura).toBeDefined();
    const select = leitura?.chamadas.find((c) => c.metodo === "select");
    expect(String(select?.args[0])).toContain("caminho");
    expect(String(select?.args[0])).toContain("miniatura_caminho");
    expect(
      leitura?.chamadas.some((c) => c.metodo === "eq" && c.args[0] === "loja_id" && c.args[1] === LOJA),
    ).toBe(true);

    const iLe = sequencia.indexOf("le:imagens_loja");
    expect(iLe).toBeGreaterThanOrEqual(0);
    expect(sequencia.indexOf("delete:loja")).toBeGreaterThan(iLe);
  });

  it("remove todos os caminhos e miniaturas registrados (inclusive a pasta galeria/)", async () => {
    await excluirLoja(LOJA);
    const removidos = removidosProdutos();
    for (const l of linhasImagens) {
      expect(removidos).toContain(l.caminho);
      expect(removidos).toContain(l.miniatura_caminho);
    }
  });

  it("230 caminhos → blocos de ATÉ 100 por chamada, todos removidos", async () => {
    linhasImagens = linhasDaLoja(115);
    await excluirLoja(LOJA);

    const chamadasProdutos = removeCalls.filter((c) => c.bucket === "produtos");
    for (const c of chamadasProdutos) expect(c.paths.length).toBeLessThanOrEqual(100);
    const removidos = new Set(removidosProdutos());
    for (const l of linhasImagens) {
      expect(removidos.has(l.caminho)).toBe(true);
      expect(removidos.has(l.miniatura_caminho as string)).toBe(true);
    }
    expect(chamadasProdutos.length).toBeGreaterThanOrEqual(3);
  });

  it("miniatura null não vira caminho 'null'", async () => {
    linhasImagens = [{ caminho: `${LOJA}/legada.webp`, miniatura_caminho: null }];
    await excluirLoja(LOJA);
    const removidos = removidosProdutos();
    expect(removidos).toContain(`${LOJA}/legada.webp`);
    expect(removidos.some((p) => p == null || p === "null")).toBe(false);
  });

  it("ATAQUE: caminho registrado sem o prefixo da loja é descartado (nunca chega ao remove)", async () => {
    linhasImagens = [
      { caminho: `${LOJA}/galeria/ok.webp`, miniatura_caminho: null },
      { caminho: `${OUTRA}/galeria/alheia.webp`, miniatura_caminho: `${OUTRA}/galeria/mini/alheia.webp` },
      { caminho: `${LOJA}/../${OUTRA}/x.webp`, miniatura_caminho: null },
    ];
    await excluirLoja(LOJA);
    expect(removidosProdutos()).toContain(`${LOJA}/galeria/ok.webp`);
    expect(JSON.stringify(removeCalls)).not.toContain(OUTRA);
  });

  it("mantém a listagem atual como complemento (raiz e logo/)", async () => {
    await excluirLoja(LOJA);
    expect(listCalls).toContainEqual({ bucket: "produtos", prefix: LOJA });
    expect(listCalls).toContainEqual({ bucket: "produtos", prefix: `${LOJA}/logo` });
    const removidos = removidosProdutos();
    expect(removidos).toContain(`${LOJA}/listada.webp`);
    expect(removidos).toContain(`${LOJA}/logo/listada-logo.webp`);
    // e os registrados também
    expect(removidos).toContain(linhasImagens[0].caminho);
  });

  it("best-effort: leitura de imagens_loja falha → a loja AINDA é excluída", async () => {
    respostaImagens = () => ({ data: null, error: { message: "tabela indisponível" } });
    const r = await excluirLoja(LOJA);
    expect(r.ok).toBe(true);
    expect(excluirLojaPermanente).toHaveBeenCalledTimes(1);
    expect(ops.some((o) => o.tabela === "imagens_loja")).toBe(true);
  });

  it("best-effort: remove de um bloco falha → os demais blocos seguem e a loja é excluída", async () => {
    linhasImagens = linhasDaLoja(115);
    let primeira = true;
    removeResponder = (bucket) => {
      if (bucket === "produtos" && primeira) {
        primeira = false;
        return { data: null, error: { message: "storage fora do ar" } };
      }
      return { data: {}, error: null };
    };
    const r = await excluirLoja(LOJA);
    expect(r.ok).toBe(true);
    expect(excluirLojaPermanente).toHaveBeenCalledTimes(1);
    expect(removeCalls.filter((c) => c.bucket === "produtos").length).toBeGreaterThanOrEqual(3);
  });
});
