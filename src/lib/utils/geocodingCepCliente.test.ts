import { describe, it, expect } from "vitest";

// RED (issue 185, crítica — TDD red-first): este módulo ainda NÃO existe.
// A fase GREEN (executar) cria src/lib/utils/geocodingCepCliente.ts com duas
// funções PURAS (sem I/O, sem server-only), conforme a Decisão D1 do Plano
// Técnico da issue 185:
//
//   montarConsultaCepCliente(e: EnderecoCepResolvido): string | null
//     → "<cidade> - <uf>, Brasil" — SEMPRE só cidade+UF. null quando falta
//       cidade ou uf — fail-closed: sem âncora geográfica, NÃO se monta
//       consulta de consolo.
//
// RED da correção de #185 (decisão do usuário): o BAIRRO sai da consulta de
// geocoding. Motivo: o CEP real 12914-190 resolve no ViaCEP para o bairro
// "Jardim Sevilha", que NÃO existe no OSM/Nominatim para Bragança Paulista —
// a consulta bairro+cidade+UF volta VAZIA mesmo com a cidade existindo, e o
// frete por raio vira "indisponível". Para DISTÂNCIA, o centroide da cidade
// basta. O bairro segue chegando ao lojista pelo outro caminho (exibição em
// FormEndereco/buscarCep e mensagem de WhatsApp) — inalterado por isto.
//     → O CEP NUNCA entra na consulta (é o token comprovadamente envenenador:
//       q=12914-190 resolveu para uma estrada na República Tcheca).
//
//   dentroDoBrasil(latitude, longitude): boolean
//     → bounding box lat ∈ [-34, 6], lng ∈ [-74, -34] (defesa em profundidade
//       D1: um par fora da caixa vira nao_encontrado, nunca distância absurda).
//
// Type-only import: apagado em runtime, não cria dependência de módulo.
import type { EnderecoCepResolvido } from "./resolverCepServidor";
import { montarConsultaCepCliente, dentroDoBrasil } from "./geocodingCepCliente";

function endereco(p: Partial<EnderecoCepResolvido> = {}): EnderecoCepResolvido {
  return {
    bairro: "Jardim Europa",
    logradouro: "Avenida Ladislau Osório de Vasconcellos Leme",
    cidade: "Bragança Paulista",
    uf: "SP",
    ...p,
  };
}

describe("montarConsultaCepCliente — consulta textual para o Nominatim (D1c)", () => {
  it("COM bairro presente → '<cidade> - <uf>, Brasil', o bairro é IGNORADO", () => {
    const consulta = montarConsultaCepCliente(endereco());
    expect(consulta).toBe("Bragança Paulista - SP, Brasil");
    expect(consulta).not.toContain("Jardim Europa");
  });

  it("CEP 12914-190 (o caso que motivou a issue): bairro inexistente no OSM não entra na consulta", () => {
    // ViaCEP devolve "Jardim Sevilha"; esse bairro NÃO existe no Nominatim para
    // Bragança Paulista, e a consulta bairro+cidade+UF volta vazia. Só a âncora
    // cidade+UF resolve — é o que a consulta deve conter.
    const consulta = montarConsultaCepCliente(
      endereco({
        bairro: "Jardim Sevilha",
        logradouro: "Rua Antônio Carlos Ribeiro",
        cidade: "Bragança Paulista",
        uf: "SP",
      }),
    );
    expect(consulta).toBe("Bragança Paulista - SP, Brasil");
    expect(consulta).not.toContain("Sevilha");
  });

  it("sem bairro (CEP geral, ViaCEP devolve null) → '<cidade> - <uf>, Brasil'", () => {
    // Degradação embutida NUMA ÚNICA string (D1): sem o token de bairro, os
    // tokens âncora cidade/UF ainda resolvem — sem uma segunda chamada.
    expect(montarConsultaCepCliente(endereco({ bairro: null }))).toBe(
      "Bragança Paulista - SP, Brasil",
    );
  });

  it("bairro só com espaços em branco → mesma consulta (bairro é irrelevante)", () => {
    expect(montarConsultaCepCliente(endereco({ bairro: "   " }))).toBe(
      "Bragança Paulista - SP, Brasil",
    );
  });

  it("aparas de espaço em cidade/uf não vazam para a consulta", () => {
    expect(
      montarConsultaCepCliente(
        endereco({ bairro: "  Centro ", cidade: " São Paulo  ", uf: " SP " }),
      ),
    ).toBe("São Paulo - SP, Brasil");
  });

  // ── Fail-closed: sem âncora geográfica NÃO se monta consulta ───────────────

  it("cidade vazia → null (fail-closed, nunca consulta só com bairro)", () => {
    expect(montarConsultaCepCliente(endereco({ cidade: "" }))).toBeNull();
  });

  it("cidade só com espaços → null", () => {
    expect(montarConsultaCepCliente(endereco({ cidade: "   " }))).toBeNull();
  });

  it("uf vazia → null", () => {
    expect(montarConsultaCepCliente(endereco({ uf: "" }))).toBeNull();
  });

  it("uf só com espaços → null", () => {
    expect(montarConsultaCepCliente(endereco({ uf: "  " }))).toBeNull();
  });

  // ── O CEP nunca entra na consulta (causa raiz da 185) ─────────────────────

  it("a consulta NUNCA contém dígitos de CEP, mesmo com logradouro numerado", () => {
    // logradouro NÃO entra na consulta (D1: token com maior chance de não existir
    // no OSM). Nenhum dígito deve sobrar na string final.
    const consulta = montarConsultaCepCliente(
      endereco({ logradouro: "Rua 15 de Novembro, 12914-190" }),
    );
    expect(consulta).toBe("Bragança Paulista - SP, Brasil");
    expect(consulta).not.toMatch(/\d/);
  });
});

describe("dentroDoBrasil — guard de bounding box (defesa em profundidade D1)", () => {
  it("Bragança Paulista/SP (dentro) → true", () => {
    expect(dentroDoBrasil(-22.9520235, -46.5418586)).toBe(true);
  });

  it("Roraima, extremo norte (dentro) → true", () => {
    expect(dentroDoBrasil(4.5, -60.0)).toBe(true);
  });

  it("estrada na República Tcheca (o resultado do bug) → false", () => {
    // Foi exatamente esse tipo de par que virou distância astronômica.
    expect(dentroDoBrasil(49.8, 15.5)).toBe(false);
  });

  it("Lisboa (fora) → false", () => {
    expect(dentroDoBrasil(38.72, -9.14)).toBe(false);
  });

  it("Nova York (longitude fora da caixa) → false", () => {
    expect(dentroDoBrasil(40.71, -74.01)).toBe(false);
  });

  it("bordas da caixa são INCLUSIVAS (lat -34/6, lng -74/-34)", () => {
    expect(dentroDoBrasil(-34, -74)).toBe(true);
    expect(dentroDoBrasil(6, -34)).toBe(true);
  });

  it("logo fora das bordas → false", () => {
    expect(dentroDoBrasil(-34.001, -50)).toBe(false);
    expect(dentroDoBrasil(6.001, -50)).toBe(false);
    expect(dentroDoBrasil(-20, -74.001)).toBe(false);
    expect(dentroDoBrasil(-20, -33.999)).toBe(false);
  });

  it("NaN/Infinity → false (nunca aceita par não-finito)", () => {
    expect(dentroDoBrasil(Number.NaN, -46.5)).toBe(false);
    expect(dentroDoBrasil(-22.9, Number.NaN)).toBe(false);
    expect(dentroDoBrasil(Number.POSITIVE_INFINITY, -46.5)).toBe(false);
  });

  it("(0,0) — Golfo da Guiné — está FORA do Brasil", () => {
    // Guard contra o modo de falha "coords zeradas passam por válidas".
    expect(dentroDoBrasil(0, 0)).toBe(false);
  });
});
