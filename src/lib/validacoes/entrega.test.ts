import { describe, it, expect, vi } from "vitest";
// Schemas de ENTREGA (src/lib/validacoes/entrega.ts): a tabela de faixas de km
// (issue 326) e a gravação das zonas numa forma só, com versão (issues 325/328).
// Os schemas por zona (zona, taxa, bairro e o payload completo do form de zona)
// saíram com a remoção dos caminhos de escrita por zona (issue 327); as regras
// de CEP que eles cobriam reaparecem contra `schemaZonasEntrega` abaixo.
//
// FORA DA RESPONSABILIDADE: cálculo de frete (calcularFrete), match de zona
// por endereço, RLS/unicidade no banco. Aqui validamos só a forma do dado.
// Símbolos resolvidos pelo NAMESPACE (precedente 326): export ausente vira
// falha de asserção, não import quebrado.
import * as validacoesEntrega from "./entrega";

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

// ---------------------------------------------------------------------------
// [328/F3] [325/F3] schemaZonasEntrega — autoridade da action (uma forma por vez)
// ---------------------------------------------------------------------------
// Autoridade: plan/arquivo/tecnico-formas-de-frete.md §4 (regras de valor por forma) e
// §5 (contrato do zod), §8 itens 46–49.
//
// CONTRATO: src/lib/validacoes/entrega.ts
//   export const schemaZonasEntrega = z.discriminatedUnion("forma", [
//     { forma:"raio_km",   versao, incremento, faixas }   .strict().superRefine(refinarPrefixo)
//     { forma:"faixa_cep", versao, faixas:[{cep_inicio,cep_fim,taxa,pedido_minimo_gratis,ativo}] } .strict().superRefine(refinarCep)
//     { forma:"bairro",    versao, grupos:[{bairros,taxa,pedido_minimo_gratis,ativo}] }             .strict().superRefine(refinarBairros)
//   ]);  versao = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
//   Mensagens custom:
//     invertida  path ["faixas", i, "cep_fim"]   "O CEP final deve ser maior ou igual ao CEP inicial."
//     sobreposta path ["faixas", j, "cep_inicio"] "A faixa de {a} a {b} cruza com a de {c} a {d}. Ajuste uma delas."
//     grupo vazio "Adicione pelo menos um bairro a este preço."
//     repetido    "{bairro} já está em outro preço."  (normalizarBairro, a MESMA da vitrine)
//   Tetos: 30 faixas km · 50 faixas CEP · 30 grupos · 100 bairros/grupo · 300 bairros no total.
// Item 49 ([326] schemaFaixasEntrega inalterado após extrair refinarPrefixo) é
// coberto pelos describes [326] acima, que seguem passando.
function schemaZonas(): SchemaParse {
  const s = (validacoesEntrega as unknown as { schemaZonasEntrega?: SchemaParse }).schemaZonasEntrega;
  if (s == null || typeof s.safeParse !== "function") {
    throw new Error(
      "[RED 328] `src/lib/validacoes/entrega.ts` ainda não exporta `schemaZonasEntrega` (§5, P3 do plano).",
    );
  }
  return s;
}

const zKm = (over: Record<string, unknown> = {}) => ({
  forma: "raio_km",
  versao: 0,
  incremento: 1,
  faixas: [faixa(), faixa({ taxa: 6, pedido_minimo_gratis: 60 })],
  ...over,
});
const fCep = (ini: number, fim: number, over: Record<string, unknown> = {}) => ({
  cep_inicio: ini,
  cep_fim: fim,
  taxa: 5,
  pedido_minimo_gratis: null,
  ativo: true,
  ...over,
});
const zCep = (over: Record<string, unknown> = {}) => ({
  forma: "faixa_cep",
  versao: 3,
  faixas: [fCep(1000000, 1999999), fCep(2000000, 2999999, { taxa: 7 })],
  ...over,
});
const gB = (bairros: unknown[], over: Record<string, unknown> = {}) => ({
  bairros,
  taxa: 6,
  pedido_minimo_gratis: null,
  ativo: true,
  ...over,
});
const zBairro = (over: Record<string, unknown> = {}) => ({
  forma: "bairro",
  versao: 9,
  grupos: [gB(["Centro", "Vila Nova"]), gB(["Sé"], { taxa: 4 })],
  ...over,
});
const temIssue = (r: ReturnType<SchemaParse["safeParse"]>, path: PropertyKey[], msg: string | RegExp) =>
  (r.error?.issues ?? []).some(
    (i) =>
      JSON.stringify(i.path) === JSON.stringify(path) &&
      (typeof msg === "string" ? i.message === msg : msg.test(i.message)),
  );

describe("[328/F3] schemaZonasEntrega — .strict() recusa chave extra em cada forma e em cada item; versao inteiro ≥ 0 obrigatório", () => {
  it.each([
    ["raio_km", zKm()],
    ["faixa_cep", zCep()],
    ["bairro", zBairro()],
  ])("%s válido ⇒ aceito e devolvido igual", (_f, payload) => {
    const r = schemaZonas().safeParse(payload);
    expect(r.success).toBe(true);
    expect(r.data).toEqual(payload);
  });

  it.each([
    ["raio_km + loja_id", zKm({ loja_id: "22222222-2222-2222-2222-222222222222" })],
    ["faixa_cep + loja_id", zCep({ loja_id: "22222222-2222-2222-2222-222222222222" })],
    ["bairro + loja_id", zBairro({ loja_id: "22222222-2222-2222-2222-222222222222" })],
    ["raio_km + grupos", zKm({ grupos: [] })],
    ["faixa_cep + incremento", zCep({ incremento: 1 })],
    ["bairro + faixas", zBairro({ faixas: [] })],
  ])("raiz %s extra ⇒ recusado", (_n, payload) => {
    expect(schemaZonas().safeParse(payload).success).toBe(false);
  });

  it.each([
    ["faixa km + tipo", zKm({ faixas: [faixa({ tipo: "bairro" })] })],
    ["faixa km + raio_max_km", zKm({ faixas: [faixa({ raio_max_km: 9 })] })],
    ["faixa CEP + nome", zCep({ faixas: [fCep(1000000, 1999999, { nome: "x" })] })],
    ["faixa CEP + tipo", zCep({ faixas: [fCep(1000000, 1999999, { tipo: "faixa_cep" })] })],
    ["faixa CEP + loja_id", zCep({ faixas: [fCep(1000000, 1999999, { loja_id: "x" })] })],
    ["grupo + nome", zBairro({ grupos: [gB(["Centro"], { nome: "Centro" })] })],
    ["grupo + tipo", zBairro({ grupos: [gB(["Centro"], { tipo: "bairro" })] })],
    ["grupo + id", zBairro({ grupos: [gB(["Centro"], { id: "33333333-3333-3333-3333-333333333333" })] })],
  ])("item %s extra ⇒ recusado", (_n, payload) => {
    expect(schemaZonas().safeParse(payload).success).toBe(false);
  });

  it.each([
    ["ausente", undefined],
    ["negativa", -1],
    ["fracionária", 1.5],
    ["string", "3"],
    ["null", null],
    ["acima de MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER + 2],
  ])("versao %s ⇒ recusado (nas três formas)", (_n, versao) => {
    for (const p of [zKm({ versao }), zCep({ versao }), zBairro({ versao })]) {
      expect(schemaZonas().safeParse(p).success).toBe(false);
    }
  });

  it("versao 0 é aceita", () => {
    expect(schemaZonas().safeParse(zCep({ versao: 0 })).success).toBe(true);
  });

  it.each([["cidade"], [""], [null], [undefined]])("forma %j ⇒ recusado", (forma) => {
    expect(schemaZonas().safeParse(zCep({ forma })).success).toBe(false);
  });

  it("raio_km mantém a invariante de prefixo (refinarPrefixo) com a mensagem do contrato", () => {
    const r = schemaZonas().safeParse(
      zKm({ faixas: [faixa({ ativo: true }), faixa({ ativo: false }), faixa({ ativo: true })] }),
    );
    expect(r.success).toBe(false);
    expect(temIssue(r, ["faixas", 2, "ativo"], mensagemBuraco())).toBe(true);
  });

  it("raio_km: 31 faixas ⇒ recusado", () => {
    expect(schemaZonas().safeParse(zKm({ faixas: Array.from({ length: 31 }, () => faixa()) })).success).toBe(false);
  });
});

describe("[325/F3] schemaZonasEntrega — faixa_cep: CEP inteiro 0..99999999, início ≤ fim, sem sobreposição, teto 50", () => {
  it.each([
    ["9 dígitos", { cep_inicio: 123456789 }],
    ["negativo", { cep_inicio: -1 }],
    ["fracionário", { cep_fim: 1999999.5 }],
    ["string", { cep_inicio: "01000000" }],
    ["null", { cep_fim: null }],
    ["ausente", { cep_inicio: undefined }],
    ["taxa 4.555", { taxa: 4.555 }],
    ["taxa negativa", { taxa: -1 }],
    ["grátis 4.555", { pedido_minimo_gratis: 4.555 }],
    ["ativo string", { ativo: "true" }],
  ])("%s ⇒ recusado", (_n, over) => {
    expect(schemaZonas().safeParse(zCep({ faixas: [fCep(1000000, 1999999, over)] })).success).toBe(false);
  });

  it("CEP 0 e 99999999 são limites aceitos; início = fim (um CEP só) é aceito", () => {
    expect(schemaZonas().safeParse(zCep({ faixas: [fCep(0, 0), fCep(99999999, 99999999)] })).success).toBe(true);
  });

  it("início > fim ⇒ recusado com a mensagem do contrato em faixas[i].cep_fim", () => {
    const r = schemaZonas().safeParse(zCep({ faixas: [fCep(1000000, 1999999), fCep(3999999, 3000000)] }));
    expect(r.success).toBe(false);
    expect(temIssue(r, ["faixas", 1, "cep_fim"], "O CEP final deve ser maior ou igual ao CEP inicial.")).toBe(true);
  });

  it.each([
    ["01000000–01999999 e 01500000–02000000", [fCep(1000000, 1999999), fCep(1500000, 2000000)]],
    ["fim de uma = início da outra", [fCep(1000000, 1999999), fCep(1999999, 2500000)]],
    ["uma contida na outra", [fCep(1000000, 3000000), fCep(1500000, 1600000)]],
    ["desligada também conta", [fCep(1000000, 1999999), fCep(1500000, 2000000, { ativo: false })]],
  ])("sobreposição (%s) ⇒ recusado com a mensagem do contrato em faixas[1].cep_inicio", (_n, faixas) => {
    const r = schemaZonas().safeParse(zCep({ faixas }));
    expect(r.success).toBe(false);
    expect(temIssue(r, ["faixas", 1, "cep_inicio"], /^A faixa de .+ a .+ cruza com a de .+ a .+\. Ajuste uma delas\.$/)).toBe(
      true,
    );
  });

  it("sobreposição fora de ordem também é recusada", () => {
    const r = schemaZonas().safeParse(zCep({ faixas: [fCep(1500000, 2000000), fCep(1000000, 1999999)] }));
    expect(r.success).toBe(false);
    expect((r.error?.issues ?? []).some((i) => /cruza com a de/.test(i.message))).toBe(true);
  });

  it("faixas encostadas (…01999999 / 02000000…) são aceitas", () => {
    expect(schemaZonas().safeParse(zCep({ faixas: [fCep(1000000, 1999999), fCep(2000000, 2999999)] })).success).toBe(
      true,
    );
  });

  const cepsSemCruzar = (n: number) =>
    Array.from({ length: n }, (_v, i) => fCep(1000000 + i * 100000, 1000000 + i * 100000 + 99999));

  it("50 faixas (teto) ⇒ aceito; 51 ⇒ recusado; lista vazia ⇒ aceito", () => {
    expect(schemaZonas().safeParse(zCep({ faixas: cepsSemCruzar(50) })).success).toBe(true);
    expect(schemaZonas().safeParse(zCep({ faixas: cepsSemCruzar(51) })).success).toBe(false);
    expect(schemaZonas().safeParse(zCep({ faixas: [] })).success).toBe(true);
  });
});

describe("[325/F3] schemaZonasEntrega — bairro: ≥ 1 bairro por grupo, sem repetição por normalizarBairro, tetos 30/100/300", () => {
  it("grupo com bairros [] ⇒ recusado com 'Adicione pelo menos um bairro a este preço.'", () => {
    const r = schemaZonas().safeParse(zBairro({ grupos: [gB(["Centro"]), gB([])] }));
    expect(r.success).toBe(false);
    expect((r.error?.issues ?? []).some((i) => i.message === "Adicione pelo menos um bairro a este preço.")).toBe(true);
  });

  it.each([
    ["vazio", ""],
    ["só espaço", "   "],
    ["não-string", 123],
    ["null", null],
    ["121 caracteres", "B".repeat(121)],
  ])("bairro %s ⇒ recusado", (_n, bairro) => {
    expect(schemaZonas().safeParse(zBairro({ grupos: [gB(["Centro", bairro])] })).success).toBe(false);
  });

  it("bairro com 120 caracteres (aparado) ⇒ aceito", () => {
    expect(schemaZonas().safeParse(zBairro({ grupos: [gB([` ${"B".repeat(120)} `])] })).success).toBe(true);
  });

  it.each([
    ["mesmo grupo, acento + espaço: 'Centro' / ' cêntro '", [gB(["Centro", " cêntro "])]],
    ["grupos diferentes, caixa: 'Vila Nova' / 'VILA NOVA'", [gB(["Vila Nova"]), gB(["VILA NOVA"])]],
    ["espaço interno: 'Jardim São José' / 'jardim   sao  jose'", [gB(["Jardim São José"]), gB(["jardim   sao  jose"])]],
    ["repetido em grupo DESLIGADO também conta", [gB(["Centro"]), gB(["centro"], { ativo: false })]],
  ])("repetido (%s) ⇒ recusado com '{bairro} já está em outro preço.'", (_n, grupos) => {
    const r = schemaZonas().safeParse(zBairro({ grupos }));
    expect(r.success).toBe(false);
    expect((r.error?.issues ?? []).some((i) => / já está em outro preço\.$/.test(i.message))).toBe(true);
  });

  it("bairros parecidos mas DIFERENTES após normalizar ('Vila Nova' / 'Vila Novo') ⇒ aceito", () => {
    expect(schemaZonas().safeParse(zBairro({ grupos: [gB(["Vila Nova"]), gB(["Vila Novo"])] })).success).toBe(true);
  });

  it.each([
    ["taxa 4.555", { taxa: 4.555 }],
    ["taxa negativa", { taxa: -1 }],
    ["taxa string", { taxa: "5" }],
    ["grátis negativo", { pedido_minimo_gratis: -1 }],
    ["ativo ausente", { ativo: undefined }],
  ])("grupo com %s ⇒ recusado", (_n, over) => {
    expect(schemaZonas().safeParse(zBairro({ grupos: [gB(["Centro"], over)] })).success).toBe(false);
  });

  const grupos = (n: number, porGrupo = 1) =>
    Array.from({ length: n }, (_v, g) => gB(Array.from({ length: porGrupo }, (_w, b) => `Bairro ${g}-${b}`)));

  it("30 grupos ⇒ aceito; 31 ⇒ recusado", () => {
    expect(schemaZonas().safeParse(zBairro({ grupos: grupos(30) })).success).toBe(true);
    expect(schemaZonas().safeParse(zBairro({ grupos: grupos(31) })).success).toBe(false);
  });

  it("grupo com 100 bairros ⇒ aceito; 101 ⇒ recusado", () => {
    expect(schemaZonas().safeParse(zBairro({ grupos: grupos(1, 100) })).success).toBe(true);
    expect(schemaZonas().safeParse(zBairro({ grupos: grupos(1, 101) })).success).toBe(false);
  });

  it("300 bairros no total ⇒ aceito; 301 ⇒ recusado (mesmo com ≤ 100 por grupo)", () => {
    expect(schemaZonas().safeParse(zBairro({ grupos: grupos(3, 100) })).success).toBe(true);
    expect(schemaZonas().safeParse(zBairro({ grupos: [...grupos(3, 100), gB(["Último"])] })).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// [325/F3] Ativação explícita da forma de frete (plan/arquivo/loop-ativar-forma-frete.md D2)
// ---------------------------------------------------------------------------
// CONTRATO: src/lib/validacoes/entrega.ts
//   export const schemaDefinirFormaFrete = z.object({ forma, versao }).strict()
//     forma ∈ 'raio_km' | 'faixa_cep' | 'bairro'; versao inteiro 0..MAX_SAFE_INTEGER
//   ehConflitoDeVersao: aceita P0001 'salvar_zonas_entrega: versao desatualizada'
//     E 'definir_forma_frete: versao desatualizada'
//   export const MENSAGEM_FORMA_SEM_ZONA: string — imperativo (copy manda agir)
//   export function resultadoDaRpcFormaFrete(rotulo, { data, error }): ResultadoZonas
//     conflito → { ok:false, conflito:true, erro: MENSAGEM_CONFLITO_ZONAS }
//     P0001 'definir_forma_frete: forma sem zona ativa' → { ok:false, erro: MENSAGEM_FORMA_SEM_ZONA }
//     outro erro / data não inteiro seguro → { ok:false, erro: MENSAGEM_ERRO_FORMA_FRETE }
//     ok → { ok:true, versao: data }
type RespostaRpc = { data: unknown; error: { code?: string; message?: string } | null };
type ResultadoZonasT = { ok: true; versao: number } | { ok: false; erro: string; conflito?: true };

const ns = validacoesEntrega as unknown as Record<string, unknown>;

function schemaDefinirForma(): SchemaParse {
  const s = ns.schemaDefinirFormaFrete as SchemaParse | undefined;
  if (s == null || typeof s.safeParse !== "function") {
    throw new Error("[RED 325/F3] `src/lib/validacoes/entrega.ts` ainda não exporta `schemaDefinirFormaFrete` (D2).");
  }
  return s;
}
function mensagemFormaSemZona(): string {
  const m = ns.MENSAGEM_FORMA_SEM_ZONA;
  if (typeof m !== "string" || m.trim() === "") {
    throw new Error("[RED 325/F3] `src/lib/validacoes/entrega.ts` ainda não exporta `MENSAGEM_FORMA_SEM_ZONA` (D2).");
  }
  return m;
}
function resultadoDaRpcFormaFrete(rotulo: string, r: RespostaRpc): ResultadoZonasT {
  const fn = ns.resultadoDaRpcFormaFrete as ((rot: string, r: RespostaRpc) => ResultadoZonasT) | undefined;
  if (typeof fn !== "function") {
    throw new Error("[RED 325/F3] `src/lib/validacoes/entrega.ts` ainda não exporta `resultadoDaRpcFormaFrete` (D2).");
  }
  return fn(rotulo, r);
}
const ehConflito = (e: RespostaRpc["error"]) =>
  (ns.ehConflitoDeVersao as (e: RespostaRpc["error"]) => boolean)(e);

describe("[325/F3] schemaDefinirFormaFrete — { forma, versao } .strict()", () => {
  it.each([["raio_km"], ["faixa_cep"], ["bairro"]])("forma %s com versao 0 ⇒ aceita e devolvida igual", (forma) => {
    const r = schemaDefinirForma().safeParse({ forma, versao: 0 });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ forma, versao: 0 });
  });

  it.each<[string, unknown]>([
    ["loja_id extra (tenant vem do servidor)", { forma: "bairro", versao: 3, loja_id: "22222222-2222-4222-8222-222222222222" }],
    ["p_loja_id extra", { forma: "bairro", versao: 3, p_loja_id: "x" }],
    ["forma fora do enum", { forma: "cidade", versao: 3 }],
    ["forma ausente", { versao: 3 }],
    ["forma null", { forma: null, versao: 3 }],
    ["versao ausente", { forma: "bairro" }],
    ["versao negativa", { forma: "bairro", versao: -1 }],
    ["versao fracionária", { forma: "bairro", versao: 1.5 }],
    ["versao string", { forma: "bairro", versao: "3" }],
    ["versao acima de MAX_SAFE_INTEGER", { forma: "bairro", versao: Number.MAX_SAFE_INTEGER + 1 }],
    ["payload null", null],
    ["payload array", [{ forma: "bairro", versao: 3 }]],
  ])("%s ⇒ recusado", (_n, payload) => {
    expect(schemaDefinirForma().safeParse(payload).success).toBe(false);
  });
});

describe("[325/F3] ehConflitoDeVersao — contrato das duas RPCs", () => {
  it("aceita P0001 'definir_forma_frete: versao desatualizada'", () => {
    expect(ehConflito({ code: "P0001", message: "definir_forma_frete: versao desatualizada" })).toBe(true);
  });

  it("continua aceitando P0001 'salvar_zonas_entrega: versao desatualizada'", () => {
    expect(ehConflito({ code: "P0001", message: "salvar_zonas_entrega: versao desatualizada" })).toBe(true);
  });

  it.each<[string, RespostaRpc["error"]]>([
    ["código diferente com o texto", { code: "42501", message: "definir_forma_frete: versao desatualizada" }],
    ["P0001 de outra recusa", { code: "P0001", message: "definir_forma_frete: forma sem zona ativa" }],
    ["P0001 sem prefixo de RPC", { code: "P0001", message: "versao desatualizada" }],
    ["sem erro", null],
  ])("%s ⇒ não é conflito", (_n, e) => {
    expect(ehConflito(e)).toBe(false);
  });
});

describe("[325/F3] MENSAGEM_FORMA_SEM_ZONA — copy no imperativo", () => {
  it("existe, fala de zona e não começa com 'Sem' nem 'Caso não'", () => {
    const m = mensagemFormaSemZona();
    expect(m).toMatch(/zona/i);
    expect(m).not.toMatch(/^\s*sem\b/i);
    expect(m).not.toMatch(/^\s*caso n[ãa]o\b/i);
    expect(m).not.toBe(validacoesEntrega.MENSAGEM_ERRO_ZONAS);
    expect(m).not.toBe(validacoesEntrega.MENSAGEM_CONFLITO_ZONAS);
  });
});

describe("[325/F3] resultadoDaRpcFormaFrete — resposta da RPC definir_forma_frete → ResultadoZonas", () => {
  it("conflito de versão ⇒ { ok:false, conflito:true, erro: MENSAGEM_CONFLITO_ZONAS }", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = resultadoDaRpcFormaFrete("teste", {
      data: null,
      error: { code: "P0001", message: "definir_forma_frete: versao desatualizada" },
    });
    expect(r).toEqual({ ok: false, conflito: true, erro: validacoesEntrega.MENSAGEM_CONFLITO_ZONAS });
    warn.mockRestore();
  });

  it("P0001 'forma sem zona ativa' ⇒ { ok:false, erro: MENSAGEM_FORMA_SEM_ZONA } sem conflito", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spyE = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = resultadoDaRpcFormaFrete("teste", {
      data: null,
      error: { code: "P0001", message: "definir_forma_frete: forma sem zona ativa" },
    });
    expect(r).toEqual({ ok: false, erro: mensagemFormaSemZona() });
    spy.mockRestore();
    spyE.mockRestore();
  });

  it.each<[string, RespostaRpc]>([
    ["P0001 'sem posse'", { data: null, error: { code: "P0001", message: "definir_forma_frete: sem posse" } }],
    ["P0001 'forma invalida'", { data: null, error: { code: "P0001", message: "definir_forma_frete: forma invalida" } }],
    ["código diferente com 'forma sem zona ativa'", { data: null, error: { code: "42501", message: "definir_forma_frete: forma sem zona ativa" } }],
    ["data string", { data: "4", error: null }],
    ["data null sem erro", { data: null, error: null }],
    ["data fracionária", { data: 4.5, error: null }],
  ])("%s ⇒ { ok:false, erro: MENSAGEM_ERRO_FORMA_FRETE } sem conflito e sem texto do banco", (_n, resposta) => {
    const spyE = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = resultadoDaRpcFormaFrete("teste", resposta);
    expect(r).toEqual({ ok: false, erro: validacoesEntrega.MENSAGEM_ERRO_FORMA_FRETE });
    spyE.mockRestore();
  });

  it("ok ⇒ { ok:true, versao: data }", () => {
    expect(resultadoDaRpcFormaFrete("teste", { data: 9, error: null })).toEqual({ ok: true, versao: 9 });
  });
});
