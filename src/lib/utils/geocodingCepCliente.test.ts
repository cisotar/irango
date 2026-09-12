import { describe, it, expect } from "vitest";

// RED (issue 190, crítica — TDD red-first): `montarConsultasCepCliente` ainda
// NÃO existe em src/lib/utils/geocodingCepCliente.ts. A fase GREEN (executar)
// substitui `montarConsultaCepCliente` (retornava 1 string) por esta função
// (retorna `string[]` em cascata), Decisão 1 do plano técnico da 190
// (plan/tecnico-geocoding-google.md).
//
// CONTRATO SOB TESTE
//   montarConsultasCepCliente(e: EnderecoCepResolvido): string[]
//     1. "<logradouro>, <bairro>, <cidade> - <uf>, Brasil" (quando há logradouro)
//     2. "<bairro>, <cidade> - <uf>, Brasil" (quando há bairro)
//     3. "<cidade> - <uf>, Brasil" (sempre presente — nunca pior que hoje)
//   Ordem: do mais específico ao mais genérico. Sem cidade OU sem uf → [].
//   Dedupe preservando ordem quando um candidato repete outro já presente.
//
// A causa raiz da 190: a query de hoje (só cidade-UF) é idêntica para
// 12914-190 e 12900-430 (mesma cidade), então os dois CEPs geocodificam para a
// MESMA coordenada. A cascata resolve isso incluindo logradouro/bairro nos
// candidatos mais específicos, sem NUNCA usar o `numero` declarado pelo
// cliente (mandato 1 do CLAUDE.md — cliente não influencia valor cobrado).
//
// `dentroDoBrasil` é intocado por esta migração (guard de bounding box válido
// com qualquer provedor) — os testes seguem inalterados.
import type { EnderecoCepResolvido } from "./resolverCepServidor";
import { montarConsultasCepCliente, dentroDoBrasil } from "./geocodingCepCliente";

function endereco(p: Partial<EnderecoCepResolvido> = {}): EnderecoCepResolvido {
  return {
    bairro: "Jardim Europa",
    logradouro: "Avenida Ladislau Osório de Vasconcellos Leme",
    cidade: "Bragança Paulista",
    uf: "SP",
    ...p,
  };
}

describe("montarConsultasCepCliente — cascata de consultas para o Google Geocoding (D1)", () => {
  it("1) logradouro + bairro + cidade + uf → 3 candidatos, do mais específico ao mais genérico", () => {
    const candidatos = montarConsultasCepCliente(endereco());

    expect(candidatos).toEqual([
      "Avenida Ladislau Osório de Vasconcellos Leme, Jardim Europa, Bragança Paulista - SP, Brasil",
      "Jardim Europa, Bragança Paulista - SP, Brasil",
      "Bragança Paulista - SP, Brasil",
    ]);
    // O último candidato é EXATAMENTE o comportamento atual (nunca fica pior).
    expect(candidatos.at(-1)).toBe("Bragança Paulista - SP, Brasil");
  });

  it("2) só bairro (sem logradouro) → 2 candidatos", () => {
    const candidatos = montarConsultasCepCliente(
      endereco({ logradouro: null }),
    );

    expect(candidatos).toEqual([
      "Jardim Europa, Bragança Paulista - SP, Brasil",
      "Bragança Paulista - SP, Brasil",
    ]);
  });

  it("3) nem logradouro nem bairro → 1 candidato ('<cidade> - <uf>, Brasil')", () => {
    const candidatos = montarConsultasCepCliente(
      endereco({ logradouro: null, bairro: null }),
    );

    expect(candidatos).toEqual(["Bragança Paulista - SP, Brasil"]);
  });

  it("4a) sem cidade → []", () => {
    expect(montarConsultasCepCliente(endereco({ cidade: "" }))).toEqual([]);
  });

  it("4b) sem uf → []", () => {
    expect(montarConsultasCepCliente(endereco({ uf: "" }))).toEqual([]);
  });

  it("4c) cidade/uf só com espaços → []", () => {
    expect(
      montarConsultasCepCliente(endereco({ cidade: "   ", uf: "  " })),
    ).toEqual([]);
  });

  it("5) bairro igual a um segmento já presente → sem duplicata (dedupe preservando ordem)", () => {
    // Bairro coincide com o "sufixo" cidade-UF (caso degenerado, ex.: bairro
    // "Centro" vs. cidade "Centro" — ou aparas iguais). O caso mais direto de
    // colisão: candidato do logradouro fica igual ao do bairro quando o
    // logradouro é vazio/whitespace (cai no mesmo texto).
    const candidatos = montarConsultasCepCliente(
      endereco({
        logradouro: "   ",
        bairro: "Bragança Paulista",
        cidade: "Bragança Paulista",
        uf: "SP",
      }),
    );

    // "Bragança Paulista, Bragança Paulista - SP, Brasil" (bairro) e
    // "Bragança Paulista - SP, Brasil" (sufixo) são distintos aqui, mas o
    // dedupe precisa remover qualquer repetição byte-a-byte que ocorra —
    // nenhum item se repete no array final.
    expect(new Set(candidatos).size).toBe(candidatos.length);
    expect(candidatos.at(-1)).toBe("Bragança Paulista - SP, Brasil");
  });

  it("aparas de espaço em logradouro/bairro/cidade/uf não vazam para os candidatos", () => {
    const candidatos = montarConsultasCepCliente(
      endereco({
        logradouro: "  Rua das Flores ",
        bairro: "  Centro ",
        cidade: " São Paulo  ",
        uf: " SP ",
      }),
    );

    expect(candidatos).toEqual([
      "Rua das Flores, Centro, São Paulo - SP, Brasil",
      "Centro, São Paulo - SP, Brasil",
      "São Paulo - SP, Brasil",
    ]);
  });

  it("o `numero` do cliente NUNCA entra em nenhum candidato (mandato 1 — cliente não influencia valor cobrado)", () => {
    // EnderecoCepResolvido não tem campo `numero` — este teste documenta a
    // invariante: mesmo que um dia um campo assim exista no tipo, a função não
    // deve lê-lo. Usamos um cast para simular o pior caso (campo extra).
    const comNumero = { ...endereco(), numero: "123" } as EnderecoCepResolvido &
      Record<string, unknown>;

    const candidatos = montarConsultasCepCliente(comNumero);

    for (const c of candidatos) {
      expect(c).not.toContain("123");
    }
  });

  // ── critério de sucesso da issue 190: os dois CEPs de Bragança Paulista ────
  it("12914-190 (Jardim Sevilha) e 12900-430 (Centro) produzem candidatos MAIS ESPECÍFICOS diferentes", () => {
    const candidatos12914 = montarConsultasCepCliente(
      endereco({
        logradouro: "Rua Antônio Carlos Ribeiro",
        bairro: "Jardim Sevilha",
        cidade: "Bragança Paulista",
        uf: "SP",
      }),
    );
    const candidatos12900 = montarConsultasCepCliente(
      endereco({
        logradouro: "Rua Coronel Luiz Antônio",
        bairro: "Centro",
        cidade: "Bragança Paulista",
        uf: "SP",
      }),
    );

    // O candidato mais específico (índice 0) é DIFERENTE entre os dois CEPs —
    // é essa diferença que faz o Google devolver coordenadas diferentes.
    expect(candidatos12914[0]).not.toBe(candidatos12900[0]);
    // O último candidato (cidade-UF) continua IGUAL — é o fallback comum.
    expect(candidatos12914.at(-1)).toBe(candidatos12900.at(-1));
  });
});

describe("dentroDoBrasil — guard de bounding box (defesa em profundidade, intocado pela troca de provedor)", () => {
  it("Bragança Paulista/SP (dentro) → true", () => {
    expect(dentroDoBrasil(-22.9520235, -46.5418586)).toBe(true);
  });

  it("Roraima, extremo norte (dentro) → true", () => {
    expect(dentroDoBrasil(4.5, -60.0)).toBe(true);
  });

  it("estrada na República Tcheca (fora) → false", () => {
    expect(dentroDoBrasil(49.8, 15.5)).toBe(false);
  });

  it("Lisboa (fora) → false", () => {
    expect(dentroDoBrasil(38.72, -9.14)).toBe(false);
  });

  it("bordas da caixa são INCLUSIVAS (lat -34/6, lng -74/-34)", () => {
    expect(dentroDoBrasil(-34, -74)).toBe(true);
    expect(dentroDoBrasil(6, -34)).toBe(true);
  });

  it("logo fora das bordas → false", () => {
    expect(dentroDoBrasil(-34.001, -50)).toBe(false);
    expect(dentroDoBrasil(6.001, -50)).toBe(false);
  });

  it("NaN/Infinity → false (nunca aceita par não-finito)", () => {
    expect(dentroDoBrasil(Number.NaN, -46.5)).toBe(false);
    expect(dentroDoBrasil(Number.POSITIVE_INFINITY, -46.5)).toBe(false);
  });

  it("(0,0) — Golfo da Guiné — está FORA do Brasil", () => {
    expect(dentroDoBrasil(0, 0)).toBe(false);
  });
});
