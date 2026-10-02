import { describe, it, expect, vi } from "vitest";

/**
 * Fase RED (TDD) da issue 332 — `src/lib/supabase/queries/papeis.ts`.
 *
 * Contrato (plan/tecnico-identidade-cliente.md §3; seguranca.md §14 — propaga error):
 *   import "server-only";
 *   buscarPapeisDoUsuario(client, usuarioId): Promise<Papel[]>
 *     → from("papeis_usuario").select("papel").eq("usuario_id", usuarioId); filtra com ehPapel
 *   atribuirPapelInicial(svc, usuarioId, papel): Promise<Papel[]>
 *     → rpc("atribuir_papel_inicial", { p_usuario_id, p_papel }); filtra com ehPapel
 *
 * RED: o módulo ainda não existe; import dinâmico por caso (sem stub de produção).
 * Mock só do I/O (client Supabase).
 */

type Mod = {
  buscarPapeisDoUsuario: (c: unknown, id: string) => Promise<string[]>;
  atribuirPapelInicial: (c: unknown, id: string, papel: string) => Promise<string[]>;
};

async function carregar(): Promise<Mod> {
  return (await import("./papeis")) as unknown as Mod;
}

const UID = "00000000-0000-4000-8000-000000000332";

function fakeRpc(resultado: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => resultado);
  return { rpc, client: { rpc } };
}

/** Builder encadeável: from().select().eq() → thenable com o resultado. */
function fakeFrom(resultado: { data: unknown; error: unknown }) {
  const eq = vi.fn(() => Promise.resolve(resultado));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from, select, eq, client: { from } };
}

describe("atribuirPapelInicial (issue 332)", () => {
  it("[332-18a] chama rpc('atribuir_papel_inicial', { p_usuario_id, p_papel }) e devolve os papéis", async () => {
    const { atribuirPapelInicial } = await carregar();
    const f = fakeRpc({ data: ["lojista"], error: null });

    const r = await atribuirPapelInicial(f.client, UID, "lojista");

    expect(f.rpc).toHaveBeenCalledTimes(1);
    expect(f.rpc).toHaveBeenCalledWith("atribuir_papel_inicial", {
      p_usuario_id: UID,
      p_papel: "lojista",
    });
    expect(r).toEqual(["lojista"]);
  });

  it("[332-18b] propaga error (rejeita)", async () => {
    const { atribuirPapelInicial } = await carregar();
    const f = fakeRpc({ data: null, error: { message: "falha", code: "XX000" } });
    await expect(atribuirPapelInicial(f.client, UID, "lojista")).rejects.toBeTruthy();
  });

  it("[332-18c] descarta valores desconhecidos ('admin', '', null)", async () => {
    const { atribuirPapelInicial } = await carregar();
    const f = fakeRpc({ data: ["admin", "cliente", "", null, "LOJISTA"], error: null });
    expect(await atribuirPapelInicial(f.client, UID, "cliente")).toEqual(["cliente"]);
  });
});

describe("buscarPapeisDoUsuario (issue 332)", () => {
  it("[332-19a] lê papeis_usuario filtrando por usuario_id e devolve os papéis", async () => {
    const { buscarPapeisDoUsuario } = await carregar();
    const f = fakeFrom({ data: [{ papel: "lojista" }, { papel: "cliente" }], error: null });

    const r = await buscarPapeisDoUsuario(f.client, UID);

    expect(f.from).toHaveBeenCalledWith("papeis_usuario");
    expect(f.eq).toHaveBeenCalledWith("usuario_id", UID);
    expect([...r].sort()).toEqual(["cliente", "lojista"]);
  });

  it("[332-19b] propaga error (rejeita)", async () => {
    const { buscarPapeisDoUsuario } = await carregar();
    const f = fakeFrom({ data: null, error: { message: "falha", code: "42501" } });
    await expect(buscarPapeisDoUsuario(f.client, UID)).rejects.toBeTruthy();
  });

  it("[332-19c] descarta valores desconhecidos", async () => {
    const { buscarPapeisDoUsuario } = await carregar();
    const f = fakeFrom({ data: [{ papel: "admin" }, { papel: "lojista" }], error: null });
    expect(await buscarPapeisDoUsuario(f.client, UID)).toEqual(["lojista"]);
  });
});
