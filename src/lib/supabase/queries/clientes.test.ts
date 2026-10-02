import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  COLUNAS_ENDERECO,
  buscarPerfilCliente,
  listarEnderecosCliente,
  registrarUltimoAcessoCliente,
  listarClientesDaLoja,
  buscarClienteDaLoja,
} from "./clientes";

/**
 * P18 — queries de clientes (issue 337). O fake registra cada cadeia PostgREST
 * (tabela + métodos + args) para provar filtro por id, ordenação e propagação
 * de erro. Dados fictícios.
 */
const ID = "11111111-1111-1111-1111-111111111111";

type Passo = { m: string; args: unknown[] };
function criarClient(resposta: { data?: unknown; error?: unknown }) {
  const cadeias: { tabela: string; passos: Passo[] }[] = [];
  const client = {
    from(tabela: string) {
      const cad = { tabela, passos: [] as Passo[] };
      cadeias.push(cad);
      const b: unknown = new Proxy(
        {},
        {
          get(_t, p) {
            if (p === "then")
              return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
                Promise.resolve({ data: resposta.data ?? null, error: resposta.error ?? null }).then(ok, ko);
            return (...args: unknown[]) => {
              cad.passos.push({ m: String(p), args });
              return b;
            };
          },
        },
      );
      return b;
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, cadeias };
}
const passo = (c: { passos: Passo[] }, m: string) => c.passos.filter((p) => p.m === m);

afterEach(() => vi.useRealTimers());

describe("buscarPerfilCliente", () => {
  it("filtra por id, lê só colunas de perfil (sem campos de outro domínio) e devolve a linha", async () => {
    const linha = { id: ID, nome: "Pessoa Teste" };
    const { client, cadeias } = criarClient({ data: linha });
    expect(await buscarPerfilCliente(client, ID)).toEqual(linha);
    expect(cadeias[0].tabela).toBe("clientes");
    expect(passo(cadeias[0], "eq")[0].args).toEqual(["id", ID]);
    const cols = String(passo(cadeias[0], "select")[0].args[0]);
    for (const c of ["id", "nome", "telefone", "data_nascimento", "aceita_marketing", "consentimento_em", "consentimento_versao", "ultimo_acesso_em"])
      expect(cols).toContain(c);
    expect(passo(cadeias[0], "maybeSingle")).toHaveLength(1);
  });
  it("sem perfil → null (não lança)", async () => {
    const { client } = criarClient({ data: null });
    expect(await buscarPerfilCliente(client, ID)).toBeNull();
  });
  it("erro do banco é propagado (callback/guard decidem; nada de null silencioso)", async () => {
    const erro = { code: "XX000", message: "falha" };
    const { client } = criarClient({ error: erro });
    await expect(buscarPerfilCliente(client, ID)).rejects.toBe(erro);
  });
});

describe("listarEnderecosCliente", () => {
  it("filtra por cliente_id e ordena padrão primeiro (padrao desc), depois criado_em asc", async () => {
    const { client, cadeias } = criarClient({ data: [{ id: "a" }] });
    await listarEnderecosCliente(client, ID);
    const c = cadeias[0];
    expect(c.tabela).toBe("clientes_enderecos");
    expect(passo(c, "eq")[0].args).toEqual(["cliente_id", ID]);
    expect(passo(c, "select")[0].args[0]).toBe(COLUNAS_ENDERECO);
    const ordens = passo(c, "order").map((p) => [p.args[0], (p.args[1] as { ascending: boolean }).ascending]);
    expect(ordens).toEqual([["padrao", false], ["criado_em", true]]);
  });
  it("data null → [] (nunca null para o chamador iterar)", async () => {
    const { client } = criarClient({ data: null });
    expect(await listarEnderecosCliente(client, ID)).toEqual([]);
  });
  it("erro propagado", async () => {
    const erro = { code: "42501" };
    const { client } = criarClient({ error: erro });
    await expect(listarEnderecosCliente(client, ID)).rejects.toBe(erro);
  });
  it("COLUNAS_ENDERECO não inclui nada além das colunas da tabela de endereço", () => {
    expect(COLUNAS_ENDERECO.split(",").map((s) => s.trim()).sort()).toEqual(
      ["id", "cliente_id", "rotulo", "cep", "rua", "numero", "bairro", "cidade", "uf", "complemento", "padrao", "criado_em"].sort(),
    );
  });
});

describe("registrarUltimoAcessoCliente", () => {
  it("atualiza SÓ ultimo_acesso_em com o instante atual em ISO, escopado por id", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-02T12:34:56.000Z"));
    const { client, cadeias } = criarClient({});
    await registrarUltimoAcessoCliente(client, ID);
    const c = cadeias[0];
    expect(c.tabela).toBe("clientes");
    expect(passo(c, "update")[0].args[0]).toEqual({ ultimo_acesso_em: "2026-10-02T12:34:56.000Z" });
    expect(passo(c, "eq")[0].args).toEqual(["id", ID]);
  });
  it("erro propagado (o chamador é quem decide ser best-effort)", async () => {
    const erro = { code: "42501" };
    const { client } = criarClient({ error: erro });
    await expect(registrarUltimoAcessoCliente(client, ID)).rejects.toBe(erro);
  });
});

// ── 346: RPCs da base de clientes do lojista ──────────────────────────────────

function criarClientRpc(resposta: { data?: unknown; error?: unknown }) {
  const chamadas: { fn: string; args: unknown }[] = [];
  const client = {
    rpc(fn: string, args: unknown) {
      chamadas.push({ fn, args });
      return Promise.resolve({ data: resposta.data ?? null, error: resposta.error ?? null });
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, chamadas };
}

describe("listarClientesDaLoja (346)", () => {
  it("repassa limite/offset sem p_mes quando mes ausente e devolve as linhas", async () => {
    const linhas = [{ cliente_id: ID, nome: "Pessoa Teste" }];
    const { client, chamadas } = criarClientRpc({ data: linhas });
    expect(await listarClientesDaLoja(client, { limite: 50, offset: 100 })).toEqual(linhas);
    expect(chamadas).toEqual([{ fn: "clientes_da_loja", args: { p_limite: 50, p_offset: 100 } }]);
  });
  it("repassa p_mes quando informado", async () => {
    const { client, chamadas } = criarClientRpc({ data: [] });
    await listarClientesDaLoja(client, { mes: 3, limite: 50, offset: 0 });
    expect(chamadas[0].args).toEqual({ p_mes: 3, p_limite: 50, p_offset: 0 });
  });
  it("data null → []", async () => {
    const { client } = criarClientRpc({});
    expect(await listarClientesDaLoja(client, { limite: 50, offset: 0 })).toEqual([]);
  });
  it("propaga o error", async () => {
    const erro = { code: "42501", message: "x" };
    const { client } = criarClientRpc({ error: erro });
    await expect(listarClientesDaLoja(client, { limite: 50, offset: 0 })).rejects.toBe(erro);
  });
});

describe("buscarClienteDaLoja (346)", () => {
  it("chama cliente_da_loja com o id e devolve a primeira linha", async () => {
    const linha = { cliente_id: ID, nome: "Pessoa Teste" };
    const { client, chamadas } = criarClientRpc({ data: [linha] });
    expect(await buscarClienteDaLoja(client, ID)).toEqual(linha);
    expect(chamadas).toEqual([{ fn: "cliente_da_loja", args: { p_cliente_id: ID } }]);
  });
  it("sem linha → null", async () => {
    const { client } = criarClientRpc({ data: [] });
    expect(await buscarClienteDaLoja(client, ID)).toBeNull();
  });
  it("propaga o error", async () => {
    const erro = { code: "XX000", message: "x" };
    const { client } = criarClientRpc({ error: erro });
    await expect(buscarClienteDaLoja(client, ID)).rejects.toBe(erro);
  });
});
