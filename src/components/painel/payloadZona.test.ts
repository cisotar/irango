import { describe, it, expect } from "vitest";
// RED (issue 183) — o módulo puro de montagem do payload de zona ainda NÃO
// existe na forma final; há só um STUB TDD em ./payloadZona (lança
// "TODO: GREEN"), para o type-check compilar e a falha cair por ASSERÇÃO.
//
// RESPONSABILIDADE: converter o estado do FormZona (strings de input) no
// payload que `schemaZonaCompleta` valida. É onde vive a conversão
// máscara ↔ inteiro de CEP e a disciplina de zerar por tipo de zona.
//
// Risco central que este arquivo trava: `Number("01000000") === 1000000`
// (7 dígitos). A ida funciona porque calcularFrete normaliza o CEP do cliente
// do mesmo jeito; a VOLTA para a máscara precisa de padStart(8, "0"), senão
// uma segunda edição da zona reexibe/regrava a faixa errada.
//
// FORA DA RESPONSABILIDADE: validação (schemaZonaCompleta), persistência
// (Server Actions), match de zona (calcularFrete).
import {
  cepParaInteiro,
  cepInteiroParaMascara,
  montarPayloadZona,
  type EntradaPayloadZona,
} from "./payloadZona";

function entrada(over: Partial<EntradaPayloadZona> = {}): EntradaPayloadZona {
  return {
    nome: "Centro",
    tipo: "faixa_cep",
    ativo: true,
    taxa: "8,00",
    pedidoMinimoGratis: "",
    raioMaxKm: "",
    cepInicio: "01000-000",
    cepFim: "01099-999",
    bairros: [],
    ...over,
  };
}

type PayloadComFaixa = {
  tipo: string;
  taxa: {
    taxa: number;
    cep_inicio: number | null;
    cep_fim: number | null;
    raio_max_km: number | null;
  };
  bairros: string[];
};

describe("cepParaInteiro", () => {
  it("converte máscara com zero à esquerda para inteiro de 7 dígitos", () => {
    expect(cepParaInteiro("01000-000")).toBe(1000000);
  });

  it("converte CEP sem zero à esquerda", () => {
    expect(cepParaInteiro("20000-000")).toBe(20000000);
  });

  it("aceita CEP sem máscara", () => {
    expect(cepParaInteiro("01099999")).toBe(1099999);
  });

  it("retorna null para CEP vazio", () => {
    expect(cepParaInteiro("")).toBeNull();
  });

  it("retorna null para CEP incompleto (menos de 8 dígitos)", () => {
    expect(cepParaInteiro("0100")).toBeNull();
  });

  it("retorna null para CEP com mais de 8 dígitos", () => {
    expect(cepParaInteiro("010000000")).toBeNull();
  });
});

describe("cepInteiroParaMascara — round-trip preserva o zero à esquerda", () => {
  it("repadroniza para 8 dígitos antes de mascarar", () => {
    expect(cepInteiroParaMascara(1000000)).toBe("01000-000");
  });

  it("mascara CEP de 8 dígitos sem alterar", () => {
    expect(cepInteiroParaMascara(20000000)).toBe("20000-000");
  });

  it("round-trip máscara → inteiro → máscara é idempotente", () => {
    const original = "01099-999";
    const ida = cepParaInteiro(original);
    expect(cepInteiroParaMascara(ida)).toBe(original);
  });

  it("devolve string vazia para null (zona sem faixa)", () => {
    expect(cepInteiroParaMascara(null)).toBe("");
  });
});

describe("montarPayloadZona — faixa por tipo de zona", () => {
  it("monta a faixa quando tipo é faixa_cep", () => {
    const p = montarPayloadZona(entrada()) as PayloadComFaixa;
    expect(p.taxa.cep_inicio).toBe(1000000);
    expect(p.taxa.cep_fim).toBe(1099999);
  });

  it("zera a faixa quando tipo é bairro (troca de tipo na edição)", () => {
    const p = montarPayloadZona(
      entrada({ tipo: "bairro", bairros: ["Centro"] }),
    ) as PayloadComFaixa;
    expect(p.taxa.cep_inicio).toBeNull();
    expect(p.taxa.cep_fim).toBeNull();
  });

  it("zera a faixa quando tipo é raio_km (troca de tipo na edição)", () => {
    const p = montarPayloadZona(
      entrada({ tipo: "raio_km", raioMaxKm: "8" }),
    ) as PayloadComFaixa;
    expect(p.taxa.cep_inicio).toBeNull();
    expect(p.taxa.cep_fim).toBeNull();
    expect(p.taxa.raio_max_km).toBe(8);
  });

  it("deixa a faixa null quando o CEP está incompleto (schema reprova depois)", () => {
    const p = montarPayloadZona(
      entrada({ cepInicio: "0100", cepFim: "" }),
    ) as PayloadComFaixa;
    expect(p.taxa.cep_inicio).toBeNull();
    expect(p.taxa.cep_fim).toBeNull();
  });
});
