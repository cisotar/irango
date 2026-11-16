import { describe, it, expect } from "vitest";

/**
 * Issue 368 — `carregarProntidaoPublicacao(client, loja)`: única
 * fonte das contagens do gate D7 (DD2, DD3, DD4).
 *
 *   produtos:         select("id", { count: "exact", head: true })
 *                       .eq("loja_id", loja.id).eq("disponivel", true).eq("oculto", false)
 *   formas_pagamento: select("id", { count: "exact", head: true }).eq("loja_id", loja.id)
 *   Promise.all; error → throw; count null → 0 (fail-closed: recusa publicar).
 *
 * Escopo: a RLS de leitura pública expõe produtos/formas de QUALQUER loja ativa
 * ao client autenticado, e o admin usa service_role (sem RLS). O fake abaixo é
 * um banco em memória que filtra por TODO `.eq` recebido — sem `eq("loja_id")`
 * explícito, as linhas da loja vizinha entram na contagem.
 */

type Linha = Record<string, unknown>;
type Chamada = { tabela: string; colunas: string; opcoes: unknown; filtros: Array<[string, unknown]> };

function fakeClient(tabelas: Record<string, Linha[]>, falhaEm?: string, countNulo = false) {
  const chamadas: Chamada[] = [];
  const client = {
    from(tabela: string) {
      return {
        select(colunas: string, opcoes?: unknown) {
          const chamada: Chamada = { tabela, colunas, opcoes, filtros: [] };
          chamadas.push(chamada);
          const consulta = {
            eq(col: string, valor: unknown) {
              chamada.filtros.push([col, valor]);
              return consulta;
            },
            then(resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) {
              if (falhaEm === tabela) {
                return Promise.resolve({ data: null, count: null, error: { message: "falha simulada" } }).then(
                  resolve,
                  reject,
                );
              }
              const linhas = (tabelas[tabela] ?? []).filter((l) => chamada.filtros.every(([c, v]) => l[c] === v));
              return Promise.resolve({ data: null, count: countNulo ? null : linhas.length, error: null }).then(
                resolve,
                reject,
              );
            },
          };
          return consulta;
        },
      };
    },
  };
  return { client, chamadas };
}

const LOJA_A = {
  id: "loja-a",
  nome: "Loja A",
  whatsapp: "5511999999999",
  endereco_cep: "01310-100",
  endereco_rua: "Avenida Paulista",
  endereco_numero: "1000",
  endereco_bairro: "Bela Vista",
  endereco_cidade: "São Paulo",
  endereco_estado: "SP",
  latitude: -23.56,
  longitude: -46.65,
};

type Carregar = (c: unknown, loja: typeof LOJA_A) => Promise<Record<string, unknown>>;
async function carregar(): Promise<Carregar> {
  const mod = (await import("./publicacao")) as unknown as { carregarProntidaoPublicacao: Carregar };
  return mod.carregarProntidaoPublicacao;
}

const produto = (loja_id: string, extra: Linha = {}) => ({ loja_id, disponivel: true, oculto: false, ...extra });

describe("carregarProntidaoPublicacao (issue 368)", () => {
  it("produtos: eq('loja_id', loja.id), disponivel=true, oculto=false, count exact head", async () => {
    const { client, chamadas } = fakeClient({
      produtos: [
        produto("loja-a"),
        produto("loja-a", { disponivel: false }),
        produto("loja-a", { oculto: true }),
      ],
      formas_pagamento: [],
    });
    const estado = await (await carregar())(client, LOJA_A);
    const c = chamadas.find((x) => x.tabela === "produtos");
    expect(c).toBeDefined();
    expect(c!.opcoes).toEqual({ count: "exact", head: true });
    expect(c!.filtros).toEqual(
      expect.arrayContaining([
        ["loja_id", "loja-a"],
        ["disponivel", true],
        ["oculto", false],
      ]),
    );
    expect(estado.produtosDisponiveis).toBe(1);
  });

  it("formas: eq('loja_id', loja.id), count exact head", async () => {
    const { client, chamadas } = fakeClient({
      produtos: [],
      formas_pagamento: [{ loja_id: "loja-a" }, { loja_id: "loja-a" }],
    });
    const estado = await (await carregar())(client, LOJA_A);
    const c = chamadas.find((x) => x.tabela === "formas_pagamento");
    expect(c).toBeDefined();
    expect(c!.opcoes).toEqual({ count: "exact", head: true });
    expect(c!.filtros).toContainEqual(["loja_id", "loja-a"]);
    expect(estado.formasPagamento).toBe(2);
  });

  it("loja B com produtos visíveis ao mesmo client não conta para a loja A", async () => {
    const { client } = fakeClient({
      produtos: [produto("loja-b"), produto("loja-b")],
      formas_pagamento: [{ loja_id: "loja-b" }],
    });
    const estado = await (await carregar())(client, LOJA_A);
    expect(estado.produtosDisponiveis).toBe(0);
    expect(estado.formasPagamento).toBe(0);
  });

  it("devolve o estado da loja junto das contagens (EstadoProntidao)", async () => {
    const { client } = fakeClient({ produtos: [produto("loja-a")], formas_pagamento: [{ loja_id: "loja-a" }] });
    const estado = await (await carregar())(client, LOJA_A);
    expect(estado).toEqual(
      expect.objectContaining({
        nome: "Loja A",
        whatsapp: "5511999999999",
        endereco_estado: "SP",
        latitude: -23.56,
        longitude: -46.65,
        produtosDisponiveis: 1,
        formasPagamento: 1,
      }),
    );
  });

  it("count null → 0", async () => {
    const { client } = fakeClient({ produtos: [produto("loja-a")], formas_pagamento: [{ loja_id: "loja-a" }] }, undefined, true);
    const estado = await (await carregar())(client, LOJA_A);
    expect(estado.produtosDisponiveis).toBe(0);
    expect(estado.formasPagamento).toBe(0);
  });

  it("erro do banco lança", async () => {
    const fn = await carregar();
    await expect(fn(fakeClient({ produtos: [] }, "produtos").client, LOJA_A)).rejects.toBeTruthy();
    await expect(fn(fakeClient({ produtos: [] }, "formas_pagamento").client, LOJA_A)).rejects.toBeTruthy();
  });
});
