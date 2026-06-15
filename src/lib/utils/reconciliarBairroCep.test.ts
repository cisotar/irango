import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// RED (issue 064, crítica): este módulo ainda NÃO existe. A fase GREEN (executar)
// cria src/lib/utils/reconciliarBairroCep.ts — função de I/O isolada que consulta
// ViaCEP NO SERVIDOR e devolve o bairro canônico (do CEP, fonte de confiança),
// nunca o bairro declarado pelo cliente. NÃO confiar no cliente para o seletor
// de zona (plano D1/D3/D4 + seguranca.md §10/§14).
import { reconciliarBairroCep } from "./reconciliarBairroCep";

// ---------------------------------------------------------------------------
// ViaCEP é I/O externa: mockamos `fetch` global. Cada teste controla a resposta
// (corpo, erro de rede, timeout/abort). O contrato sob teste é o COMPORTAMENTO
// observável da fn, não o detalhe de implementação do fetch.
// ---------------------------------------------------------------------------

function viaCepOk(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reconciliarBairroCep — [064] reconciliação CEP↔bairro (fonte de confiança)", () => {
  // CASO 1 — divergência: bairro declarado é descartado, prevalece o do CEP.
  // Critério de aceite central: cliente declara "Jardim Barato" (zona barata)
  // mas o CEP real é de "Centro" (zona cara) → o seletor de zona vira "Centro".
  it("usa o bairro do CEP (canônico) quando diverge do bairro declarado", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      viaCepOk({ cep: "01001-000", bairro: "Centro", localidade: "São Paulo" }),
    );

    const r = await reconciliarBairroCep("01001-000", "Jardim Barato");

    expect(r.reconciliado).toBe(true);
    // bairro canônico vem do CEP, NUNCA do declarado pelo cliente.
    expect(r.bairroCanonico).toBe("Centro");
    expect(r.bairroCanonico).not.toBe("Jardim Barato");
  });

  // CASO 3 — bairro do CEP confere com o declarado: reconciliado, sem surpresa.
  it("retorna reconciliado:true com o bairro do CEP quando ele casa o declarado", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      viaCepOk({ cep: "01001-000", bairro: "Sé", localidade: "São Paulo" }),
    );

    const r = await reconciliarBairroCep("01001-000", "Sé");

    expect(r.reconciliado).toBe(true);
    expect(r.bairroCanonico).toBe("Sé");
  });

  // CASO 2a — ViaCEP fora do ar / erro de rede: FAIL-CLOSED.
  // A fn NÃO pode estourar exceção que vaze, NEM devolver o bairro declarado
  // (reabriria o vetor de subpagamento). Sinaliza não-reconciliável.
  it("FAIL-CLOSED: ViaCEP indisponível (erro de rede) → reconciliado:false, nunca o bairro declarado", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const r = await reconciliarBairroCep("01001-000", "Jardim Barato");

    expect(r.reconciliado).toBe(false);
    // o seletor de zona NÃO pode cair no bairro barato declarado pelo cliente.
    expect(r.bairroCanonico).not.toBe("Jardim Barato");
  });

  // CASO 2b — timeout / abort (AbortController): também FAIL-CLOSED.
  it("FAIL-CLOSED: timeout/abort do ViaCEP → reconciliado:false", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );

    const r = await reconciliarBairroCep("01001-000", "Jardim Barato");

    expect(r.reconciliado).toBe(false);
  });

  // CASO 2c — CEP inexistente: ViaCEP responde 200 com { erro: true }.
  // Trata como não-reconciliável (mesma fail-policy), não como "bairro vazio ok".
  it("FAIL-CLOSED: CEP inexistente (ViaCEP { erro:true }) → reconciliado:false", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(viaCepOk({ erro: true }));

    const r = await reconciliarBairroCep("00000-000", "Jardim Barato");

    expect(r.reconciliado).toBe(false);
    expect(r.bairroCanonico).not.toBe("Jardim Barato");
  });

  // CASO 2d — HTTP não-ok (ex.: 500) também é fail-closed.
  it("FAIL-CLOSED: ViaCEP responde HTTP 500 → reconciliado:false", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("erro", { status: 500 }),
    );

    const r = await reconciliarBairroCep("01001-000", "Jardim Barato");

    expect(r.reconciliado).toBe(false);
  });

  // A fn nunca propaga exceção: erro vira sinal de retorno (plano §Tratamento de erro).
  it("não lança — erro de I/O vira retorno reconciliado:false", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("boom"));
    await expect(
      reconciliarBairroCep("01001-000", "Jardim Barato"),
    ).resolves.toBeDefined();
  });
});
