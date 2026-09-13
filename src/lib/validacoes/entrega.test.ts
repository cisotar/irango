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
import {
  schemaZona,
  schemaTaxa,
  schemaBairro,
  schemaZonaCompleta,
} from "./entrega";

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

// ---------------------------------------------------------------------------
// issue 183 — faixa de CEP (RED)
//
// schemaTaxa é z.object (strip por padrão) e NÃO declara cep_inicio/cep_fim:
// toda faixa enviada por uma zona tipo 'faixa_cep' é descartada em silêncio no
// parse, as colunas gravam NULL e calcularFrete.ts:88 faz a zona nunca atender
// ninguém. Os casos abaixo espelham o CHECK `taxas_faixa_cep_coerente` da
// migration 20260615011000_taxas_faixa_cep.sql — o banco é a última linha de
// defesa, o schema tem que ser a primeira.
// ---------------------------------------------------------------------------

function zonaCompletaValida(over: Record<string, unknown> = {}) {
  return {
    nome: "Centro",
    tipo: "bairro",
    ativo: true,
    taxa: taxaValida(),
    bairros: [],
    ...over,
  };
}

// A faixa ainda não existe no tipo inferido de schemaTaxa; esta view mantém o
// type-check compilando para que o RED caia por ASSERÇÃO, não por import.
type FaixaParseada = {
  cep_inicio?: number | null;
  cep_fim?: number | null;
};

describe("schemaZonaCompleta — faixa de CEP preservada no parse (prova do bug)", () => {
  it("preserva taxa.cep_inicio/cep_fim em zona tipo faixa_cep", () => {
    const r = schemaZonaCompleta.safeParse(
      zonaCompletaValida({
        tipo: "faixa_cep",
        taxa: taxaValida({ cep_inicio: 1000000, cep_fim: 1099999 }),
      }),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    const faixa = r.data.taxa as FaixaParseada;
    expect(faixa.cep_inicio).toBe(1000000);
    expect(faixa.cep_fim).toBe(1099999);
  });
});

describe("schemaTaxa — compat com payload legado (sem faixa)", () => {
  it("aceita taxa de zona bairro/raio_km sem as chaves de CEP", () => {
    const r = schemaTaxa.safeParse(taxaValida());
    expect(r.success).toBe(true);
  });

  it("resolve o par ausente em null (default), não em undefined", () => {
    const r = schemaTaxa.safeParse(taxaValida());
    expect(r.success).toBe(true);
    if (!r.success) return;
    const faixa = r.data as FaixaParseada;
    expect(faixa.cep_inicio).toBeNull();
    expect(faixa.cep_fim).toBeNull();
  });
});

describe("schemaTaxa — faixa de CEP (par tudo-ou-nada e coerência)", () => {
  it("aceita o par completo e coerente", () => {
    const r = schemaTaxa.safeParse(
      taxaValida({ cep_inicio: 1000000, cep_fim: 1099999 }),
    );
    expect(r.success).toBe(true);
  });

  it("rejeita meio-par: cep_inicio sem cep_fim", () => {
    const r = schemaTaxa.safeParse(
      taxaValida({ cep_inicio: 1000000, cep_fim: null }),
    );
    expect(r.success).toBe(false);
  });

  it("rejeita meio-par: cep_fim sem cep_inicio", () => {
    const r = schemaTaxa.safeParse(
      taxaValida({ cep_inicio: null, cep_fim: 1099999 }),
    );
    expect(r.success).toBe(false);
  });

  it("rejeita faixa invertida (cep_inicio > cep_fim)", () => {
    const r = schemaTaxa.safeParse(
      taxaValida({ cep_inicio: 2000000, cep_fim: 1000000 }),
    );
    expect(r.success).toBe(false);
  });

  it("aceita faixa de um CEP só (cep_inicio === cep_fim)", () => {
    const r = schemaTaxa.safeParse(
      taxaValida({ cep_inicio: 1050000, cep_fim: 1050000 }),
    );
    expect(r.success).toBe(true);
  });

  it("rejeita CEP negativo", () => {
    const r = schemaTaxa.safeParse(
      taxaValida({ cep_inicio: -1, cep_fim: 1099999 }),
    );
    expect(r.success).toBe(false);
  });

  it("rejeita CEP acima de 99999999", () => {
    const r = schemaTaxa.safeParse(
      taxaValida({ cep_inicio: 1000000, cep_fim: 100000000 }),
    );
    expect(r.success).toBe(false);
  });

  it("rejeita CEP não-inteiro", () => {
    const r = schemaTaxa.safeParse(
      taxaValida({ cep_inicio: 1000000.5, cep_fim: 1099999 }),
    );
    expect(r.success).toBe(false);
  });

  it("rejeita CEP como string mascarada (conversão é do form, não do schema)", () => {
    const r = schemaTaxa.safeParse(
      taxaValida({ cep_inicio: "01000-000", cep_fim: "01099-999" }),
    );
    expect(r.success).toBe(false);
  });

  it("aceita CEP no limite inferior (0) e superior (99999999)", () => {
    const r = schemaTaxa.safeParse(
      taxaValida({ cep_inicio: 0, cep_fim: 99999999 }),
    );
    expect(r.success).toBe(true);
  });

  it("descarta campo desconhecido do payload de taxa (strip, não passthrough — a issue 183 nasceu de um strip que ninguém testava)", () => {
    const r = schemaTaxa.safeParse(
      taxaValida({ coluna_inventada: "malicioso" } as Record<string, unknown>),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).not.toHaveProperty("coluna_inventada");
  });
});

describe("schemaZonaCompleta — faixa condicional ao tipo da zona", () => {
  it("rejeita zona faixa_cep sem faixa (colunas gravariam NULL e a zona não atenderia ninguém)", () => {
    const r = schemaZonaCompleta.safeParse(
      zonaCompletaValida({ tipo: "faixa_cep", taxa: taxaValida() }),
    );
    expect(r.success).toBe(false);
  });

  it("rejeita zona bairro COM faixa (faixa órfã)", () => {
    const r = schemaZonaCompleta.safeParse(
      zonaCompletaValida({
        tipo: "bairro",
        taxa: taxaValida({ cep_inicio: 1000000, cep_fim: 1099999 }),
        bairros: ["Centro"],
      }),
    );
    expect(r.success).toBe(false);
  });

  it("rejeita zona raio_km COM faixa (faixa órfã)", () => {
    const r = schemaZonaCompleta.safeParse(
      zonaCompletaValida({
        tipo: "raio_km",
        taxa: taxaValida({
          raio_max_km: 8,
          cep_inicio: 1000000,
          cep_fim: 1099999,
        }),
      }),
    );
    expect(r.success).toBe(false);
  });

  it("continua aceitando zona bairro sem faixa (sem regressão)", () => {
    const r = schemaZonaCompleta.safeParse(
      zonaCompletaValida({ bairros: ["Centro"] }),
    );
    expect(r.success).toBe(true);
  });
});
