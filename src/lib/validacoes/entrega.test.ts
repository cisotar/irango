import { describe, it, expect } from "vitest";
// RED: os schemas de ENTREGA ainda NÃO existem na forma final — a fase GREEN
// (executar) implementa src/lib/validacoes/entrega.ts. Há apenas STUB TDD
// (z.never()) para o type-check compilar e a falha cair por ASSERÇÃO.
//
// RESPONSABILIDADE (FormZona/FormTaxa + Server Actions de entrega):
// validar a FORMA da config de entrega do lojista antes de persistir.
//   schemaZona   → zonas_entrega: nome (obrigatório), tipo enum
//                  'bairro'|'raio_km'|'faixa_cep', ativo (boolean)
//   schemaTaxa   → taxas_entrega: taxa (>=0, máx 2 casas),
//                  pedido_minimo_gratis (null OU >=0),
//                  raio_max_km (null OU > 0 — relevante p/ tipo raio_km)
//   schemaBairro → bairros_zona: nome (obrigatório)
//
// FORA DA RESPONSABILIDADE: cálculo de frete (calcularFrete), match de zona
// por endereço, RLS/unicidade no banco. Aqui validamos só a forma do dado.
import { schemaZona, schemaTaxa, schemaBairro } from "./entrega";

function zonaValida(over: Record<string, unknown> = {}) {
  return {
    nome: "Centro",
    tipo: "bairro",
    ativo: true,
    ...over,
  };
}

function taxaValida(over: Record<string, unknown> = {}) {
  return {
    taxa: 5.5,
    pedido_minimo_gratis: null,
    raio_max_km: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// schemaZona
// ---------------------------------------------------------------------------
describe("schemaZona — caminho feliz", () => {
  it("aceita uma zona válida do tipo bairro", () => {
    const r = schemaZona.safeParse(zonaValida());
    expect(r.success).toBe(true);
  });

  it("aceita tipo raio_km", () => {
    const r = schemaZona.safeParse(zonaValida({ tipo: "raio_km" }));
    expect(r.success).toBe(true);
  });

  it("aceita tipo faixa_cep", () => {
    const r = schemaZona.safeParse(zonaValida({ tipo: "faixa_cep" }));
    expect(r.success).toBe(true);
  });
});

describe("schemaZona — nome", () => {
  it("rejeita nome vazio", () => {
    const r = schemaZona.safeParse(zonaValida({ nome: "" }));
    expect(r.success).toBe(false);
  });

  it("rejeita nome só de espaços", () => {
    const r = schemaZona.safeParse(zonaValida({ nome: "   " }));
    expect(r.success).toBe(false);
  });
});

describe("schemaZona — tipo (enum)", () => {
  it("rejeita tipo fora do enum ('cidade')", () => {
    const r = schemaZona.safeParse(zonaValida({ tipo: "cidade" }));
    expect(r.success).toBe(false);
  });
});

describe("schemaZona — ativo", () => {
  it("rejeita ativo não-boolean (string 'true')", () => {
    const r = schemaZona.safeParse(zonaValida({ ativo: "true" }));
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// schemaTaxa
// ---------------------------------------------------------------------------
describe("schemaTaxa — caminho feliz", () => {
  it("aceita taxa válida com campos opcionais null", () => {
    const r = schemaTaxa.safeParse(taxaValida());
    expect(r.success).toBe(true);
  });

  it("aceita taxa 0 (frete grátis fixo)", () => {
    const r = schemaTaxa.safeParse(taxaValida({ taxa: 0 }));
    expect(r.success).toBe(true);
  });

  it("aceita pedido_minimo_gratis >= 0", () => {
    const r = schemaTaxa.safeParse(taxaValida({ pedido_minimo_gratis: 50 }));
    expect(r.success).toBe(true);
  });

  it("aceita raio_max_km > 0", () => {
    const r = schemaTaxa.safeParse(taxaValida({ raio_max_km: 8.5 }));
    expect(r.success).toBe(true);
  });
});

describe("schemaTaxa — taxa (dinheiro)", () => {
  // CRÍTICO: taxa negativa abriria valor de entrega que reduz o total.
  it("rejeita taxa negativa", () => {
    const r = schemaTaxa.safeParse(taxaValida({ taxa: -1 }));
    expect(r.success).toBe(false);
  });

  it("rejeita taxa com mais de 2 casas decimais (5.555)", () => {
    const r = schemaTaxa.safeParse(taxaValida({ taxa: 5.555 }));
    expect(r.success).toBe(false);
  });
});

describe("schemaTaxa — pedido_minimo_gratis", () => {
  it("rejeita pedido_minimo_gratis negativo", () => {
    const r = schemaTaxa.safeParse(taxaValida({ pedido_minimo_gratis: -10 }));
    expect(r.success).toBe(false);
  });

  it("aceita pedido_minimo_gratis 0", () => {
    const r = schemaTaxa.safeParse(taxaValida({ pedido_minimo_gratis: 0 }));
    expect(r.success).toBe(true);
  });
});

describe("schemaTaxa — raio_max_km", () => {
  // raio_max_km null = sem limite de raio (campo é nullable no schema).
  it("rejeita raio_max_km 0 (deve ser > 0 quando presente)", () => {
    const r = schemaTaxa.safeParse(taxaValida({ raio_max_km: 0 }));
    expect(r.success).toBe(false);
  });

  it("rejeita raio_max_km negativo", () => {
    const r = schemaTaxa.safeParse(taxaValida({ raio_max_km: -3 }));
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// schemaBairro
// ---------------------------------------------------------------------------
describe("schemaBairro — nome", () => {
  it("aceita um nome de bairro válido", () => {
    const r = schemaBairro.safeParse({ nome: "Jardim das Flores" });
    expect(r.success).toBe(true);
  });

  it("rejeita nome vazio", () => {
    const r = schemaBairro.safeParse({ nome: "" });
    expect(r.success).toBe(false);
  });

  it("rejeita nome só de espaços", () => {
    const r = schemaBairro.safeParse({ nome: "   " });
    expect(r.success).toBe(false);
  });
});
