import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// RED (issue 180-B / achado 1 da auditoria de segurança, crítico — TDD
// red-first): o CONTRATO deste módulo MUDA.
//
// ── O DANO EM DINHEIRO QUE ESTE ARQUIVO TRAVA ────────────────────────────────
// Hoje `resolverCepServidor` devolve `null` para TRÊS coisas distintas:
//   (a) HTTP não-ok       → o canal ViaCEP está caído          (falha NOSSA/deles)
//   (b) `{ erro: true }`  → o CEP NÃO EXISTE                   (fato sobre o CLIENTE)
//   (c) exceção de rede   → o canal ViaCEP está caído          (falha NOSSA/deles)
// A jusante, `geocodificarCepResolvido` mapeia esse `null` único para
// `motivo: "transitorio"` → `classificarFrete` → `a_combinar` → `taxa_entrega`
// NULL. Resultado: um comprador fora do raio da loja digita um CEP de formato
// válido que NÃO EXISTE (o schema só valida `^\d{5}-?\d{3}$`) e fecha o pedido
// com frete ZERO, furando inclusive a recusa "Entrega não disponível".
//
// A invariante: o caminho "frete a combinar" só pode ser alcançado por falha
// GENUÍNA do serviço externo. INPUT DO CLIENTE nunca zera o frete.
//
// ── CONTRATO NOVO (a fase GREEN implementa) ──────────────────────────────────
//   export type ResolucaoCep =
//     | { endereco: EnderecoCepResolvido }
//     | { endereco: null; motivo: "nao_encontrado" | "transitorio" };
//
//   export function resolverCepServidor(cep: string): Promise<ResolucaoCep>
//
//   body.erro === true ............... nao_encontrado (fato sobre o endereço)
//   !resp.ok | timeout | throw ....... transitorio    (falha do canal)
//   200 sem localidade/uf ............ transitorio    (resposta malformada do
//                                      canal; não é afirmação de que o CEP não
//                                      existe — o ViaCEP diria `erro:true`)
//
// NUNCA lança, NUNCA cai em dado declarado pelo cliente: a política
// fail-closed continua idêntica, o que muda é que a CAUSA deixa de se perder.
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
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      viaCepOk(CORPO_12914190),
    );

    const r = await resolverCepServidor("12914-190");

    // [180-B/achado 1] o endereço passou a vir EMBRULHADO em `{ endereco }` —
    // é o embrulho que abre espaço para o `motivo` no caso de ausência.
    expect(r).toEqual({
      endereco: {
        bairro: "Jardim Europa",
        logradouro: "Avenida Ladislau Osório de Vasconcellos Leme",
        cidade: "Bragança Paulista",
        uf: "SP",
      },
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
      viaCepOk({
        logradouro: "",
        bairro: "",
        localidade: "Campinas",
        uf: "SP",
      }),
    );

    const r = await resolverCepServidor("13000-000");

    // Comportamento de HOJE preservado (zona tipo='bairro' não casa), mas a
    // resolução geográfica continua utilizável para o geocoding.
    expect(r).toEqual({
      endereco: {
        bairro: null,
        logradouro: null,
        cidade: "Campinas",
        uf: "SP",
      },
    });
  });

  it("ViaCEP sem logradouro → logradouro null (não quebra a resolução)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      viaCepOk({ bairro: "Centro", localidade: "Campinas", uf: "SP" }),
    );

    const r = await resolverCepServidor("13000-000");

    expect(r).toEqual({
      endereco: {
        bairro: "Centro",
        logradouro: null,
        cidade: "Campinas",
        uf: "SP",
      },
    });
  });

  // ── O TESTE CENTRAL DO ACHADO 1 ────────────────────────────────────────────
  // Separa o FATO sobre o endereço do cliente da FALHA do canal. É esta
  // distinção que impede um CEP inventado de virar frete grátis lá na frente.

  it("[achado 1] CEP inexistente (ViaCEP { erro:true }) → motivo 'nao_encontrado', NÃO 'transitorio'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      viaCepOk({ erro: true }),
    );

    // O ViaCEP respondeu 200 e AFIRMOU: este CEP não existe. Isso é um fato
    // sobre o endereço digitado pelo cliente, não uma indisponibilidade do
    // canal — e por isso NÃO pode alcançar o caminho "a combinar".
    await expect(resolverCepServidor("00000-000")).resolves.toEqual({
      endereco: null,
      motivo: "nao_encontrado",
    });
  });

  it("[achado 1] CEP inexistente com `erro` string ('true', formato novo do ViaCEP) → nao_encontrado", async () => {
    // O ViaCEP passou a responder `"erro": "true"` (string) em parte das rotas.
    // O código atual (`if (body.erro)`) já trata ambos como falsy/truthy; o
    // teste trava que a CLASSIFICAÇÃO também não depende do tipo.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      viaCepOk({ erro: "true" }),
    );

    await expect(resolverCepServidor("00000-000")).resolves.toEqual({
      endereco: null,
      motivo: "nao_encontrado",
    });
  });

  // ── FAIL-CLOSED de CANAL: continua transitório (a-combinar legítimo) ───────

  it("[achado 1] HTTP não-ok (500) → motivo 'transitorio' (canal caído, não é culpa do CEP)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("erro", { status: 500 }),
    );

    await expect(resolverCepServidor("01001-000")).resolves.toEqual({
      endereco: null,
      motivo: "transitorio",
    });
  });

  it("[achado 1] erro de rede → motivo 'transitorio'", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("ECONNREFUSED"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resolverCepServidor("01001-000")).resolves.toEqual({
      endereco: null,
      motivo: "transitorio",
    });
  });

  it("[achado 1] timeout/abort → motivo 'transitorio'", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resolverCepServidor("01001-000")).resolves.toEqual({
      endereco: null,
      motivo: "transitorio",
    });
  });

  it("[achado 1] JSON inválido → 'transitorio' sem propagar exceção", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("}{ não é json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resolverCepServidor("01001-000")).resolves.toEqual({
      endereco: null,
      motivo: "transitorio",
    });
  });

  // 200 SEM localidade/uf NÃO é o ViaCEP afirmando que o CEP não existe (ele
  // diria `erro:true`): é resposta malformada do canal → transitorio. Tratar
  // como `nao_encontrado` faria uma degradação do ViaCEP virar cobrança de
  // fallback num endereço que talvez esteja dentro do raio.
  it("FAIL-CLOSED: resposta sem localidade → 'transitorio' (canal malformado)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      viaCepOk({ bairro: "Centro", uf: "SP" }),
    );

    await expect(resolverCepServidor("01001-000")).resolves.toEqual({
      endereco: null,
      motivo: "transitorio",
    });
  });

  it("FAIL-CLOSED: resposta sem uf → 'transitorio' (canal malformado)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      viaCepOk({ bairro: "Centro", localidade: "São Paulo" }),
    );

    await expect(resolverCepServidor("01001-000")).resolves.toEqual({
      endereco: null,
      motivo: "transitorio",
    });
  });

  it("nunca propaga exceção — erro de I/O vira resolução sem endereço", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resolverCepServidor("01001-000")).resolves.toEqual({
      endereco: null,
      motivo: "transitorio",
    });
  });

  // ── §14/§21: o erro logado é genérico, nunca carrega o endereço do cliente ──
  it("log de erro não contém o CEP nem o endereço do cliente (§14/§21)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("ECONNREFUSED"),
    );
    const erroSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await resolverCepServidor("12914-190");

    const logado = erroSpy.mock.calls
      .map((c) => c.map(String).join(" "))
      .join(" | ");
    expect(logado).not.toContain("12914");
    expect(logado).not.toContain("Bragança");
  });
});
