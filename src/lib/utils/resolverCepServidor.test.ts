import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// RED (issue 185, crítica — TDD red-first): este módulo ainda NÃO existe.
// A fase GREEN (executar) faz `git mv src/lib/utils/reconciliarBairroCep.ts
// src/lib/utils/resolverCepServidor.ts` e substitui
// `reconciliarBairroCep`/`ResultadoReconciliacao` por
// `resolverCepServidor`/`EnderecoCepResolvido` (Decisão D2c do Plano Técnico).
// `reconciliarBairroCep` e `reconciliarBairroCep.test.ts` são REMOVIDOS no
// mesmo commit — sem callers, seriam dead code.
//
// Contrato:
//   resolverCepServidor(cep: string): Promise<EnderecoCepResolvido | null>
//   EnderecoCepResolvido = { bairro: string|null; logradouro: string|null;
//                            cidade: string; uf: string }
//   null = FAIL-CLOSED (rede, timeout 3s, {erro:true}, HTTP não-ok, resposta
//   sem localidade/uf). NUNCA lança, NUNCA cai em dado declarado pelo cliente.
//
// UMA ida ao ViaCEP serve o bairro canônico (§10-A, issue 064) E a consulta de
// geocoding (issue 185) — é o que mantém o teto de chamadas externas.
import { resolverCepServidor } from "./resolverCepServidor";

function viaCepOk(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// Corpo típico do ViaCEP para o CEP reproduzido na issue 185 (bairro fictício:
// o teste não depende do valor real, só do repasse fiel).
const CORPO_12914190 = {
  cep: "12914-190",
  logradouro: "Avenida Ladislau Osório de Vasconcellos Leme",
  bairro: "Jardim Europa",
  localidade: "Bragança Paulista",
  uf: "SP",
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolverCepServidor — [185] resolução canônica do CEP no servidor", () => {
  it("sucesso → devolve bairro, logradouro, cidade e uf do ViaCEP", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(viaCepOk(CORPO_12914190));

    const r = await resolverCepServidor("12914-190");

    expect(r).toEqual({
      bairro: "Jardim Europa",
      logradouro: "Avenida Ladislau Osório de Vasconcellos Leme",
      cidade: "Bragança Paulista",
      uf: "SP",
    });
  });

  it("consulta o ViaCEP só com os 8 DÍGITOS (máscara é apresentação)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(viaCepOk(CORPO_12914190));

    await resolverCepServidor("12914-190");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0]?.[0]);
    expect(url).toContain("viacep.com.br");
    expect(url).toContain("12914190");
    expect(url).not.toContain("12914-190");
  });

  it("uma ÚNICA chamada ao ViaCEP por resolução (teto §Teto do plano)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(viaCepOk(CORPO_12914190));

    await resolverCepServidor("12914-190");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("passa AbortSignal (timeout de 3s preservado do reconciliarBairroCep)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(viaCepOk(CORPO_12914190));

    await resolverCepServidor("12914-190");

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeDefined();
  });

  // ── CEP geral: sem bairro, mas cidade/uf presentes → resolvido mesmo assim ──
  it("ViaCEP sem bairro (CEP geral) → bairro null, cidade/uf preservadas", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      viaCepOk({ logradouro: "", bairro: "", localidade: "Campinas", uf: "SP" }),
    );

    const r = await resolverCepServidor("13000-000");

    // Comportamento de HOJE preservado (zona tipo='bairro' não casa), mas a
    // resolução geográfica continua utilizável para o geocoding.
    expect(r).toEqual({
      bairro: null,
      logradouro: null,
      cidade: "Campinas",
      uf: "SP",
    });
  });

  it("ViaCEP sem logradouro → logradouro null (não quebra a resolução)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      viaCepOk({ bairro: "Centro", localidade: "Campinas", uf: "SP" }),
    );

    const r = await resolverCepServidor("13000-000");

    expect(r?.logradouro).toBeNull();
    expect(r?.cidade).toBe("Campinas");
  });

  // ── FAIL-CLOSED: sem cidade/uf não há âncora geográfica → null ─────────────

  it("FAIL-CLOSED: resposta sem localidade → null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      viaCepOk({ bairro: "Centro", uf: "SP" }),
    );

    await expect(resolverCepServidor("01001-000")).resolves.toBeNull();
  });

  it("FAIL-CLOSED: resposta sem uf → null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      viaCepOk({ bairro: "Centro", localidade: "São Paulo" }),
    );

    await expect(resolverCepServidor("01001-000")).resolves.toBeNull();
  });

  it("FAIL-CLOSED: CEP inexistente (ViaCEP { erro:true }) → null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(viaCepOk({ erro: true }));

    await expect(resolverCepServidor("00000-000")).resolves.toBeNull();
  });

  it("FAIL-CLOSED: HTTP não-ok (500) → null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("erro", { status: 500 }),
    );

    await expect(resolverCepServidor("01001-000")).resolves.toBeNull();
  });

  it("FAIL-CLOSED: erro de rede → null", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resolverCepServidor("01001-000")).resolves.toBeNull();
  });

  it("FAIL-CLOSED: timeout/abort → null", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resolverCepServidor("01001-000")).resolves.toBeNull();
  });

  it("FAIL-CLOSED: JSON inválido → null sem propagar exceção", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("}{ não é json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resolverCepServidor("01001-000")).resolves.toBeNull();
  });

  it("nunca propaga exceção — erro de I/O vira null", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resolverCepServidor("01001-000")).resolves.toBeNull();
  });

  // ── §14/§21: o erro logado é genérico, nunca carrega o endereço do cliente ──
  it("log de erro não contém o CEP nem o endereço do cliente (§14/§21)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const erroSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await resolverCepServidor("12914-190");

    const logado = erroSpy.mock.calls.map((c) => c.map(String).join(" ")).join(" | ");
    expect(logado).not.toContain("12914");
    expect(logado).not.toContain("Bragança");
  });
});
