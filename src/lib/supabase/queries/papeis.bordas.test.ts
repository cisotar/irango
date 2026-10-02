import { describe, it, expect, vi } from "vitest";
import { buscarPapeisDoUsuario, atribuirPapelInicial } from "./papeis";

/** Bordas das queries de papel (issue 332). Mock só do client Supabase. */
const UID = "00000000-0000-4000-8000-000000000332";

function fakeFrom(resultado: { data: unknown; error: unknown }) {
  const eq = vi.fn(() => Promise.resolve(resultado));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { select, client: { from } as never };
}
const fakeRpc = (r: { data: unknown; error: unknown }) =>
  ({ rpc: vi.fn(async () => r) }) as never;

describe("buscarPapeisDoUsuario — bordas", () => {
  it("seleciona só a coluna 'papel'", async () => {
    const f = fakeFrom({ data: [], error: null });
    await buscarPapeisDoUsuario(f.client, UID);
    expect(f.select).toHaveBeenCalledWith("papel");
  });

  it("data null sem error → [] (nunca lança nem devolve null)", async () => {
    expect(await buscarPapeisDoUsuario(fakeFrom({ data: null, error: null }).client, UID)).toEqual([]);
  });

  it("data [] → []", async () => {
    expect(await buscarPapeisDoUsuario(fakeFrom({ data: [], error: null }).client, UID)).toEqual([]);
  });

  it("linha com papel null/ausente é descartada", async () => {
    const f = fakeFrom({ data: [{ papel: null }, {}, { papel: "cliente" }], error: null });
    expect(await buscarPapeisDoUsuario(f.client, UID)).toEqual(["cliente"]);
  });

  it("propaga o MESMO error recebido (chamador decide a mensagem)", async () => {
    const err = { message: "boom", code: "42501" };
    await expect(buscarPapeisDoUsuario(fakeFrom({ data: null, error: err }).client, UID)).rejects.toBe(err);
  });
});

describe("atribuirPapelInicial — bordas", () => {
  it("data null sem error → [] (chamador trata como 'não é lojista')", async () => {
    expect(await atribuirPapelInicial(fakeRpc({ data: null, error: null }), UID, "lojista")).toEqual([]);
  });

  it("conta já-cliente: devolve o papel real, não o pedido", async () => {
    expect(await atribuirPapelInicial(fakeRpc({ data: ["cliente"], error: null }), UID, "lojista")).toEqual([
      "cliente",
    ]);
  });

  it("preserva os dois papéis", async () => {
    expect(
      await atribuirPapelInicial(fakeRpc({ data: ["lojista", "cliente"], error: null }), UID, "lojista"),
    ).toEqual(["lojista", "cliente"]);
  });

  it("propaga o MESMO error recebido", async () => {
    const err = { message: "boom", code: "XX000" };
    await expect(atribuirPapelInicial(fakeRpc({ data: null, error: err }), UID, "lojista")).rejects.toBe(err);
  });
});
