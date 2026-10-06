import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — processamento de remoções pendentes da galeria
 * (`src/lib/actions/galeria-pendentes.ts`, módulo NEUTRO: sem `'use server'`,
 * para não virar Server Action exposta; usado pelo lojista com o client
 * autenticado e pelo admin com o service client).
 *
 * RED hoje: o módulo ainda não existe; o import falha na coleta.
 *
 * Contrato fixado por este teste (decisão da fase RED, ver relatório):
 *   processarRemocoesPendentes(client, lojaId): Promise<void>
 *     1. rpc("limpar_recortes_sem_uso", { p_loja_id: lojaId }) — a varredura de
 *        garantia (RN-G21) que devolve, com teto de 50, os caminhos de TODAS as
 *        linhas pendentes da loja (as que o trigger AFTER de M4 marcou no save e
 *        as que sobraram de falha anterior do Storage);
 *     2. descarta (e loga) todo caminho sem o prefixo `${lojaId}/` (trava de
 *        `caminhoDaLoja`; sob service_role é a única amarra no Storage);
 *     3. storage.from("produtos").remove(caminhos da loja);
 *     4. só se o Storage confirmou: DELETE em imagens_loja escopado por
 *        `loja_id` e restrito às linhas pendentes desses caminhos;
 *     5. best-effort: NUNCA rejeita — falha vai para console.error e é
 *        retentada na próxima ação da loja (RN-G10, RN-G20).
 */

import { processarRemocoesPendentes } from "./galeria-pendentes";

const LOJA = "11111111-1111-1111-1111-111111111111";
const OUTRA = "22222222-2222-2222-2222-222222222222";

type Chamada = { metodo: string; args: unknown[] };
type Op = { tabela: string; chamadas: Chamada[] };
type Resposta = { data: unknown; error: unknown };

let ops: Op[];
let rpcs: { nome: string; args: unknown }[];
let removes: { bucket: string; caminhos: string[] }[];
let respostaRpc: Resposta | (() => never);
let respostaRemove: Resposta;
let respostaTabela: Resposta;

function thenavel(resolver: () => Resposta, gravar?: (c: Chamada) => void): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_alvo, prop) {
        if (prop === "then") {
          return (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
            Promise.resolve()
              .then(resolver)
              .then(ok, falha);
        }
        return (...args: unknown[]) => {
          gravar?.({ metodo: String(prop), args });
          return proxy;
        };
      },
    },
  );
  return proxy;
}

function criarClient() {
  return {
    from(tabela: string) {
      const op: Op = { tabela, chamadas: [] };
      ops.push(op);
      return thenavel(
        () => respostaTabela,
        (c) => op.chamadas.push(c),
      );
    },
    rpc(nome: string, args: unknown) {
      rpcs.push({ nome, args });
      return thenavel(() => {
        if (typeof respostaRpc === "function") return respostaRpc();
        return respostaRpc;
      });
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (caminhos: string[]) => {
          removes.push({ bucket, caminhos });
          return respostaRemove;
        },
      }),
    },
  };
}

function deletesEmImagens(): Op[] {
  return ops.filter(
    (o) => o.tabela === "imagens_loja" && o.chamadas.some((c) => c.metodo === "delete"),
  );
}
function caminhosRemovidos(): string[] {
  return removes.flatMap((r) => r.caminhos);
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  ops = [];
  rpcs = [];
  removes = [];
  respostaRpc = { data: [], error: null };
  respostaRemove = { data: [], error: null };
  respostaTabela = { data: null, error: null };
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

const rodar = (lojaId = LOJA) =>
  processarRemocoesPendentes(criarClient() as never, lojaId);

describe("processarRemocoesPendentes — varredura + Storage + DELETE", () => {
  it("chama limpar_recortes_sem_uso com p_loja_id EXATO da loja informada", async () => {
    await rodar();
    expect(rpcs).toEqual([{ nome: "limpar_recortes_sem_uso", args: { p_loja_id: LOJA } }]);
  });

  it("remove do bucket produtos exatamente os caminhos devolvidos e apaga as linhas pendentes da loja", async () => {
    const caminhos = [`${LOJA}/a.webp`, `${LOJA}/logo/b.webp`, `${LOJA}/galeria/mini/c.webp`];
    respostaRpc = { data: caminhos, error: null };

    await rodar();

    expect(removes.every((r) => r.bucket === "produtos")).toBe(true);
    expect([...caminhosRemovidos()].sort()).toEqual([...caminhos].sort());

    const dels = deletesEmImagens();
    expect(dels).toHaveLength(1);
    const del = dels[0];
    expect(
      del.chamadas.some((c) => c.metodo === "eq" && c.args[0] === "loja_id" && c.args[1] === LOJA),
    ).toBe(true);
    // o DELETE só alcança linhas PENDENTES (nunca uma linha viva com o mesmo caminho)
    expect(del.chamadas.some((c) => c.args[0] === "remocao_pendente_em")).toBe(true);
    // e só os caminhos que o Storage acabou de apagar
    const inCaminho = del.chamadas.find((c) => c.metodo === "in" && c.args[0] === "caminho");
    expect(inCaminho).toBeDefined();
    expect([...(inCaminho?.args[1] as string[])].sort()).toEqual([...caminhos].sort());
  });

  it("caminho alheio devolvido pela RPC é descartado, logado e NUNCA chega ao remove nem ao DELETE", async () => {
    respostaRpc = {
      data: [`${LOJA}/a.webp`, `${OUTRA}/x.webp`, `${LOJA}/../${OUTRA}/y.webp`],
      error: null,
    };

    await rodar();

    expect(caminhosRemovidos()).toEqual([`${LOJA}/a.webp`]);
    expect(JSON.stringify(ops)).not.toContain(OUTRA);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("nenhum pendente → nenhum remove, nenhum DELETE", async () => {
    respostaRpc = { data: [], error: null };
    await rodar();
    expect(caminhosRemovidos()).toEqual([]);
    expect(deletesEmImagens()).toHaveLength(0);
  });

  it("só caminhos alheios → nenhum remove, nenhum DELETE", async () => {
    respostaRpc = { data: [`${OUTRA}/x.webp`], error: null };
    await rodar();
    expect(caminhosRemovidos()).toEqual([]);
    expect(deletesEmImagens()).toHaveLength(0);
  });

  it("falha do Storage → linhas ficam pendentes (sem DELETE), resolve e loga", async () => {
    respostaRpc = { data: [`${LOJA}/a.webp`], error: null };
    respostaRemove = { data: null, error: { message: "storage fora do ar" } };

    await expect(rodar()).resolves.toBeUndefined();
    expect(deletesEmImagens()).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("erro da RPC → resolve, sem remove, loga", async () => {
    respostaRpc = { data: null, error: { message: "limpar_recortes_sem_uso: sem posse da loja", code: "42501" } };
    await expect(rodar()).resolves.toBeUndefined();
    expect(caminhosRemovidos()).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("exceção de rede na RPC → NUNCA rejeita (best-effort)", async () => {
    respostaRpc = () => {
      throw new Error("conexão perdida");
    };
    await expect(rodar()).resolves.toBeUndefined();
    expect(caminhosRemovidos()).toEqual([]);
  });

  it("falha do DELETE depois do Storage → resolve e loga (retentativa idempotente)", async () => {
    respostaRpc = { data: [`${LOJA}/a.webp`], error: null };
    respostaTabela = { data: null, error: { message: "falha no delete" } };
    await expect(rodar()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});
