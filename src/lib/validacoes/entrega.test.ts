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
// [326] `schemaFaixasEntrega` ainda não existe: resolvido pelo NAMESPACE para o
// RED ser "export ausente" nos testes novos, sem derrubar os antigos.
import * as validacoesEntrega from "./entrega";

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

// ---------------------------------------------------------------------------
// [326/F2] schemaFaixasEntrega — payload da tabela de faixas
// ---------------------------------------------------------------------------
// Autoridade: tasks/326-tabela-de-faixas-de-entrega.md D2 (o cliente manda SÓ
// `incremento` e, por faixa, `taxa`, `pedido_minimo_gratis` e — iteração 2 —
// `ativo`; teto, nome, tipo, loja e zona são derivados no servidor), tabela
// "Risco por fatia" F2 (`.strict()`, `valorFrete` em taxa e grátis, inc ∈ {1,2},
// 0..30 faixas).
//
// ITERAÇÃO 2 (C2' substitui C2): `ativo` VOLTA ao payload, boolean OBRIGATÓRIO.
// Invariante de PREFIXO: nenhuma faixa ativa depois de uma desligada (todas
// desligadas é válido). Os testes que diziam "`.strict()` recusa `ativo`"
// viraram o contrário.
//
// CONTRATO: src/lib/validacoes/entrega.ts
//   export const schemaFaixasEntrega (zod)
//     { incremento: 1 | 2, faixas: Array<{ taxa, pedido_minimo_gratis, ativo: boolean }> }
//     .strict() no objeto raiz E em cada faixa; chave extra é RECUSADA.
//     Refinamento: para a PRIMEIRA faixa ativa com alguma anterior desligada,
//     issue com path ["faixas", <índice dela>, "ativo"] e message
//     MENSAGEM_FAIXA_ATIVA_DEPOIS_DE_DESLIGADA.
//   export const MENSAGEM_FAIXA_ATIVA_DEPOIS_DE_DESLIGADA: string (não vazia)
type IssueZod = { path: PropertyKey[]; message: string };
type SchemaParse = {
  safeParse(v: unknown): { success: boolean; data?: unknown; error?: { issues: IssueZod[] } };
};

function schemaFaixas(): SchemaParse {
  const s = (validacoesEntrega as unknown as { schemaFaixasEntrega?: SchemaParse })
    .schemaFaixasEntrega;
  if (s == null || typeof s.safeParse !== "function") {
    throw new Error(
      "[RED 326] `src/lib/validacoes/entrega.ts` ainda não exporta `schemaFaixasEntrega` (D2, P3 do plano).",
    );
  }
  return s;
}

function mensagemBuraco(): string {
  const m = (validacoesEntrega as unknown as { MENSAGEM_FAIXA_ATIVA_DEPOIS_DE_DESLIGADA?: unknown })
    .MENSAGEM_FAIXA_ATIVA_DEPOIS_DE_DESLIGADA;
  if (typeof m !== "string" || m.trim() === "") {
    throw new Error(
      "[RED 326 it.2] `src/lib/validacoes/entrega.ts` ainda não exporta `MENSAGEM_FAIXA_ATIVA_DEPOIS_DE_DESLIGADA` (C2').",
    );
  }
  return m;
}

const faixa = (over: Record<string, unknown> = {}) => ({
  taxa: 4.5,
  pedido_minimo_gratis: null,
  ativo: true,
  ...over,
});
const payloadFaixas = (over: Record<string, unknown> = {}) => ({
  incremento: 1,
  faixas: [faixa(), faixa({ taxa: 6, pedido_minimo_gratis: 60 })],
  ...over,
});
const comAtivos = (...ativos: boolean[]) =>
  payloadFaixas({ faixas: ativos.map((ativo, i) => faixa({ taxa: 4 + i, ativo })) });

describe("[326] schemaFaixasEntrega — caminho feliz", () => {
  it("aceita incremento 1 com duas faixas (com `ativo`) e devolve exatamente o payload", () => {
    const r = schemaFaixas().safeParse(payloadFaixas());
    expect(r.success).toBe(true);
    expect(r.data).toEqual(payloadFaixas());
  });

  it("aceita incremento 2", () => {
    expect(schemaFaixas().safeParse(payloadFaixas({ incremento: 2 })).success).toBe(true);
  });

  it("aceita 0 faixas (lojista remove todas: entrega sem zona)", () => {
    expect(schemaFaixas().safeParse(payloadFaixas({ faixas: [] })).success).toBe(true);
  });

  it("aceita 30 faixas (teto)", () => {
    const faixas = Array.from({ length: 30 }, () => faixa());
    expect(schemaFaixas().safeParse(payloadFaixas({ faixas })).success).toBe(true);
  });

  it("aceita taxa 0 e grátis 0 (limite inferior)", () => {
    const r = schemaFaixas().safeParse(
      payloadFaixas({ faixas: [faixa({ taxa: 0, pedido_minimo_gratis: 0 })] }),
    );
    expect(r.success).toBe(true);
  });
});

describe("[326] schemaFaixasEntrega — .strict(): servidor deriva, cliente não manda (D2)", () => {
  it.each([
    ["raio_max_km", { raio_max_km: 99 }],
    ["nome", { nome: "Frete grátis" }],
    ["zona_id", { zona_id: "33333333-3333-3333-3333-333333333333" }],
    ["loja_id", { loja_id: "22222222-2222-2222-2222-222222222222" }],
    ["tipo", { tipo: "bairro" }],
  ])("faixa com `%s` extra ⇒ recusado", (_chave, extra) => {
    const r = schemaFaixas().safeParse(payloadFaixas({ faixas: [faixa(extra)] }));
    expect(r.success).toBe(false);
  });

  it.each([
    ["loja_id", { loja_id: "22222222-2222-2222-2222-222222222222" }],
    ["zona_id", { zona_id: "33333333-3333-3333-3333-333333333333" }],
    ["raio_max_km", { raio_max_km: 10 }],
    ["nome", { nome: "x" }],
  ])("raiz com `%s` extra ⇒ recusado", (_chave, extra) => {
    const r = schemaFaixas().safeParse(payloadFaixas(extra));
    expect(r.success).toBe(false);
  });
});

describe("[326 it.2] schemaFaixasEntrega — `ativo` por faixa (C2'): obrigatório e boolean", () => {
  it("`ativo` false é ACEITO e preservado no parse (antes, .strict() recusava a chave)", () => {
    const entrada = payloadFaixas({ faixas: [faixa(), faixa({ taxa: 6, ativo: false })] });
    const r = schemaFaixas().safeParse(entrada);
    expect(r.success).toBe(true);
    expect(r.data).toEqual(entrada);
  });

  it("faixa SEM `ativo` ⇒ recusado (obrigatório; não vira true por default)", () => {
    const semAtivo = { taxa: 4.5, pedido_minimo_gratis: null };
    const r = schemaFaixas().safeParse(payloadFaixas({ faixas: [faixa(), semAtivo] }));
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => JSON.stringify(i.path) === JSON.stringify(["faixas", 1, "ativo"]))).toBe(
      true,
    );
  });

  it.each([
    ["string 'true'", "true"],
    ["string 'false'", "false"],
    ["número 1", 1],
    ["número 0", 0],
    ["null", null],
  ])("`ativo` %s ⇒ recusado (sem coerção)", (_n, ativo) => {
    const r = schemaFaixas().safeParse(payloadFaixas({ faixas: [faixa(), faixa({ ativo })] }));
    expect(r.success).toBe(false);
  });
});

describe("[326 it.2] schemaFaixasEntrega — invariante de PREFIXO: nenhuma ativa depois de desligada (C2')", () => {
  it.each([
    ["[t,t,f,f]", [true, true, false, false]],
    ["[f,f] (todas desligadas)", [false, false]],
    ["[t]", [true]],
    ["[f]", [false]],
    ["[t,t,t]", [true, true, true]],
  ])("%s ⇒ aceito", (_n, ativos) => {
    const r = schemaFaixas().safeParse(comAtivos(...ativos));
    expect(r.success).toBe(true);
    expect(r.data).toEqual(comAtivos(...ativos));
  });

  it.each([
    ["[t,f,t]", [true, false, true], 2],
    ["[f,t]", [false, true], 1],
    ["[t,t,f,f,t]", [true, true, false, false, true], 4],
    ["[t,f,t,t] (aponta a PRIMEIRA ativa depois do buraco)", [true, false, true, true], 2],
  ])("%s ⇒ recusado; issue em faixas[<1ª ativa depois do buraco>].ativo com a mensagem do contrato", (_n, ativos, indice) => {
    const msg = mensagemBuraco();
    const r = schemaFaixas().safeParse(comAtivos(...ativos));
    expect(r.success).toBe(false);
    const issues = r.error?.issues ?? [];
    expect(issues).toContainEqual(expect.objectContaining({ path: ["faixas", indice, "ativo"], message: msg }));
  });
});

describe("[326] schemaFaixasEntrega — valorFrete em taxa e em pedido_minimo_gratis", () => {
  it.each([
    ["taxa negativa", { taxa: -1 }],
    ["taxa 4.555 (não é centavo)", { taxa: 4.555 }],
    ["taxa string", { taxa: "4.50" }],
    ["taxa null", { taxa: null }],
    ["taxa ausente", { taxa: undefined }],
    ["grátis negativo", { pedido_minimo_gratis: -10 }],
    ["grátis 50.005 (não é centavo)", { pedido_minimo_gratis: 50.005 }],
    ["grátis string", { pedido_minimo_gratis: "60" }],
    ["taxa negativa em faixa DESLIGADA", { taxa: -1, ativo: false }],
  ])("%s ⇒ recusado", (_nome, over) => {
    const r = schemaFaixas().safeParse(payloadFaixas({ faixas: [faixa(), faixa(over)] }));
    expect(r.success).toBe(false);
  });

  it("grátis null é aceito (faixa sem frete grátis)", () => {
    const r = schemaFaixas().safeParse(
      payloadFaixas({ faixas: [faixa({ pedido_minimo_gratis: null })] }),
    );
    expect(r.success).toBe(true);
  });
});

describe("[326] schemaFaixasEntrega — incremento ∈ {1, 2} e 0..30 faixas", () => {
  it.each([[0], [3], [1.5], ["1"], [null], [-1]])("incremento %j ⇒ recusado", (inc) => {
    expect(schemaFaixas().safeParse(payloadFaixas({ incremento: inc })).success).toBe(false);
  });

  it("31 faixas ⇒ recusado", () => {
    const faixas = Array.from({ length: 31 }, () => faixa());
    expect(schemaFaixas().safeParse(payloadFaixas({ faixas })).success).toBe(false);
  });

  it("faixas não-array ⇒ recusado", () => {
    expect(schemaFaixas().safeParse(payloadFaixas({ faixas: faixa() })).success).toBe(false);
  });
});
