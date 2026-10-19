import { describe, it, expect } from "vitest";
// Conversão máscara ↔ inteiro de CEP (issue 183), módulo puro `payloadZona.ts`.
// A montagem do payload por zona (do form de zona antigo) saiu com a issue
// 327; as conversões de CEP ficam para os editores de zona. Issue 325: leitura
// das zonas gravadas e montagem do payload das telas de CEP e de bairros.
//
// Risco central que este arquivo trava: `Number("01000000") === 1000000`
// (7 dígitos). A ida funciona porque calcularFrete normaliza o CEP do cliente
// do mesmo jeito; a VOLTA para a máscara precisa de padStart(8, "0"), senão
// uma segunda edição reexibe/regrava a faixa errada.
//
// FORA DA RESPONSABILIDADE: validação autoritativa (schemaZonasEntrega, na
// action), persistência (Server Actions), match de zona (calcularFrete).
import { lerFaixas, rotuloFaixa } from "@/lib/utils/faixasEntrega";
import {
  schemaZonasEntrega,
  TETO_BAIRROS_POR_GRUPO,
  TETO_BAIRROS_TOTAL,
  TETO_GRUPOS_BAIRRO,
} from "@/lib/validacoes/entrega";
import type { ZonaVitrine } from "@/lib/supabase/queries/entregaPagamento";
import {
  cepParaInteiro,
  cepInteiroParaMascara,
  grupoComBairro,
  lerFaixasCep,
  lerBairrosIndividuais,
  lerGruposBairro,
  montarPayloadBairros,
  montarPayloadPorBairro,
  zonasDoPayloadBairros,
  type BairroEditavel,
  montarPayloadCep,
  montarPayloadKm,
  type FaixaCepEditavel,
  type GrupoBairroEditavel,
} from "./payloadZona";

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

// CEPs genéricos de teste (faixas redondas), sem endereço de pessoa.
function zonaCep(id: string, ini: number, fim: number, taxa = 5, ativo = true): ZonaVitrine {
  return {
    id,
    nome: `CEP ${id}`,
    tipo: "faixa_cep",
    ativo,
    taxa: { taxa, pedido_minimo_gratis: null, raio_max_km: null, cep_inicio: ini, cep_fim: fim },
    bairros: [],
  };
}

function zonaBairro(id: string, nomes: string[], taxa: number | null = 6, gratis: number | null = null): ZonaVitrine {
  return {
    id,
    nome: nomes[0] ?? id,
    tipo: "bairro",
    ativo: true,
    taxa:
      taxa == null
        ? null
        : { taxa, pedido_minimo_gratis: gratis, raio_max_km: null, cep_inicio: null, cep_fim: null },
    bairros: nomes.map((nome) => ({ nome })),
  };
}

const cep = (cepInicio: string, cepFim: string, taxa = "5", gratis: string | null = null, ativo = true): FaixaCepEditavel => ({
  cepInicio,
  cepFim,
  taxa,
  gratis,
  ativo,
});

const grupo = (bairros: string[], taxa = "6", gratis: string | null = null, ativo = true): GrupoBairroEditavel => ({
  bairros,
  novoBairro: "",
  taxa,
  gratis,
  ativo,
});

describe("lerFaixasCep", () => {
  it("ordena por cep_inicio e mascara repadronizando o zero à esquerda", () => {
    const linhas = lerFaixasCep([zonaCep("b", 2000000, 2999999, 7), zonaCep("a", 1000000, 1999999, 5.5, false)]);

    expect(linhas).toEqual([
      { cepInicio: "01000-000", cepFim: "01999-999", taxa: "5.5", gratis: null, ativo: false },
      { cepInicio: "02000-000", cepFim: "02999-999", taxa: "7", gratis: null, ativo: true },
    ]);
  });

  it("ignora zona de outro tipo, sem taxa ou sem CEP", () => {
    const semTaxa = { ...zonaCep("x", 3000000, 3999999), taxa: null };
    const semCep = zonaCep("y", 4000000, 4999999);
    semCep.taxa = { ...semCep.taxa!, cep_fim: null };

    expect(lerFaixasCep([zonaBairro("z", ["Centro"]), semTaxa, semCep])).toEqual([]);
  });
});

describe("montarPayloadCep", () => {
  it("válido ⇒ { forma:'faixa_cep', faixas } com CEPs inteiros e moeda em número", () => {
    const r = montarPayloadCep([cep("01000-000", "01999-999", "5.5", "80"), cep("02000-000", "02999-999", "7", null, false)]);

    expect(r).toEqual({
      ok: true,
      payload: {
        forma: "faixa_cep",
        faixas: [
          { cep_inicio: 1000000, cep_fim: 1999999, taxa: 5.5, pedido_minimo_gratis: 80, ativo: true },
          { cep_inicio: 2000000, cep_fim: 2999999, taxa: 7, pedido_minimo_gratis: null, ativo: false },
        ],
      },
    });
  });

  it("lista vazia ⇒ payload vazio válido (remover tudo grava lista vazia)", () => {
    expect(montarPayloadCep([])).toEqual({ ok: true, payload: { forma: "faixa_cep", faixas: [] } });
  });

  it("CEP inicial incompleto ⇒ erro com o número e o índice da linha", () => {
    expect(montarPayloadCep([cep("01000-000", "01999-999"), cep("0200", "02999-999")])).toEqual({
      ok: false,
      erro: "Informe o CEP inicial completo da linha 2.",
      indice: 1,
    });
  });

  it("CEP final incompleto ⇒ erro com o índice", () => {
    expect(montarPayloadCep([cep("01000-000", "")])).toEqual({
      ok: false,
      erro: "Informe o CEP final completo da linha 1.",
      indice: 0,
    });
  });

  it("preço vazio ⇒ erro citando a faixa", () => {
    expect(montarPayloadCep([cep("01000-000", "01999-999", "")])).toEqual({
      ok: false,
      erro: "Informe o preço da faixa de 01000-000 a 01999-999.",
      indice: 0,
    });
  });

  it("frete grátis ligado e vazio ⇒ erro na linha", () => {
    const r = montarPayloadCep([cep("01000-000", "01999-999", "5", "")]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.indice).toBe(0);
  });

  it("faixa invertida ⇒ mensagem do zod com o índice do path", () => {
    expect(montarPayloadCep([cep("01000-000", "01999-999"), cep("03000-000", "02000-000")])).toEqual({
      ok: false,
      erro: "O CEP final deve ser maior ou igual ao CEP inicial.",
      indice: 1,
    });
  });

  it("faixas sobrepostas ⇒ mensagem do zod na que cruza", () => {
    const r = montarPayloadCep([cep("01000-000", "01999-999"), cep("01500-000", "02000-000")]);

    expect(r).toEqual({
      ok: false,
      erro: "A faixa de 01500-000 a 02000-000 cruza com a de 01000-000 a 01999-999. Ajuste uma delas.",
      indice: 1,
    });
  });

  it("preço com mais de 2 casas ⇒ erro do schema apontando o preço da linha", () => {
    const r = montarPayloadCep([cep("01000-000", "01999-999", "4.555")]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.indice).toBe(0);
      expect(r.erro).toContain("o preço da faixa de 01000-000 a 01999-999");
    }
  });

  it("acima do teto de 50 ⇒ erro sem linha", () => {
    const linhas = Array.from({ length: 51 }, (_, i) => cep(cepInteiroParaMascara(i * 1000), cepInteiroParaMascara(i * 1000 + 999)));
    const r = montarPayloadCep(linhas);
    expect(r).toEqual({ ok: false, erro: "Cadastre no máximo 50 faixas de CEP.", indice: null });
  });
});

describe("lerGruposBairro", () => {
  it("cada zona bairro com taxa vira um grupo com os nomes dos bairros", () => {
    const grupos = lerGruposBairro([
      zonaBairro("a", ["Centro", "Jardim América"], 6, 50),
      zonaBairro("b", ["Vila Nova"], 8),
      zonaBairro("c", ["Sem Taxa"], null),
      zonaCep("d", 1000000, 1999999),
    ]);

    expect(grupos).toEqual([
      { bairros: ["Centro", "Jardim América"], novoBairro: "", taxa: "6", gratis: "50", ativo: true },
      { bairros: ["Vila Nova"], novoBairro: "", taxa: "8", gratis: null, ativo: true },
    ]);
  });
});

describe("grupoComBairro — mesma normalização da vitrine", () => {
  const grupos = [{ bairros: ["Centro"] }, { bairros: ["Jardim São José"] }];

  it("acha o grupo ignorando caixa, acento e espaço", () => {
    expect(grupoComBairro(grupos, "  cêntro ")).toBe(0);
    expect(grupoComBairro(grupos, "jardim   sao jose")).toBe(1);
  });

  it("bairro novo ⇒ null", () => {
    expect(grupoComBairro(grupos, "Vila Nova")).toBeNull();
  });
});

describe("montarPayloadBairros", () => {
  it("válido ⇒ { forma:'bairro', grupos } com nomes aparados e moeda em número", () => {
    const r = montarPayloadBairros([grupo(["Centro", " Vila Nova "], "6.5", "50"), grupo(["Jardim"], "8", null, false)]);

    expect(r).toEqual({
      ok: true,
      payload: {
        forma: "bairro",
        grupos: [
          { bairros: ["Centro", "Vila Nova"], taxa: 6.5, pedido_minimo_gratis: 50, ativo: true },
          { bairros: ["Jardim"], taxa: 8, pedido_minimo_gratis: null, ativo: false },
        ],
      },
    });
  });

  it("lista vazia ⇒ payload vazio válido", () => {
    expect(montarPayloadBairros([])).toEqual({ ok: true, payload: { forma: "bairro", grupos: [] } });
  });

  it("grupo sem bairro ⇒ erro com o índice do grupo", () => {
    expect(montarPayloadBairros([grupo(["Centro"]), grupo([])])).toEqual({
      ok: false,
      erro: "Adicione pelo menos um bairro a este preço.",
      indice: 1,
    });
  });

  it("preço vazio ⇒ erro com o índice do grupo", () => {
    expect(montarPayloadBairros([grupo(["Centro"], "")])).toEqual({
      ok: false,
      erro: "Informe o preço destes bairros.",
      indice: 0,
    });
  });

  it("bairro repetido em outro grupo (acento/caixa) ⇒ mensagem do zod no grupo que repete", () => {
    expect(montarPayloadBairros([grupo(["Centro"]), grupo(["Vila", " cêntro "])])).toEqual({
      ok: false,
      erro: "cêntro já está em outro preço.",
      indice: 1,
    });
  });
});

// ─── Ida e volta: banco → tela → payload aceito pelo zod da action (325) ─────
// Pega: tela que monta payload que a Server Action recusaria (CEP sem zero à
// esquerda, moeda "5.1" virando float impuro, grátis 0 virando null, etc.).
const aceitoPelaAction = (payload: object) => schemaZonasEntrega.safeParse({ ...payload, versao: 0 });

describe("ida e volta zonas gravadas → tela → payload (CEP)", () => {
  it("CEPs de 7 dígitos, taxa com centavos e grátis 0 sobrevivem e a action aceita", () => {
    const zonas = [
      { ...zonaCep("a", 1000000, 1999999, 5.1), ativo: true },
      { ...zonaCep("b", 0, 999999, 4.35, false) },
    ];
    zonas[0].taxa!.pedido_minimo_gratis = 0; // 0 é valor, não "sem grátis"

    const linhas = lerFaixasCep(zonas);
    expect(linhas[0]).toEqual({ cepInicio: "00000-000", cepFim: "00999-999", taxa: "4.35", gratis: null, ativo: false });
    expect(linhas[1].gratis).toBe("0");

    const r = montarPayloadCep(linhas);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.faixas).toEqual([
      { cep_inicio: 0, cep_fim: 999999, taxa: 4.35, pedido_minimo_gratis: null, ativo: false },
      { cep_inicio: 1000000, cep_fim: 1999999, taxa: 5.1, pedido_minimo_gratis: 0, ativo: true },
    ]);
    expect(aceitoPelaAction(r.payload).success).toBe(true);
  });

  it("faixa inativa lida do banco continua inativa no payload (não é reativada)", () => {
    const r = montarPayloadCep(lerFaixasCep([zonaCep("a", 1000000, 1999999, 5, false)]));
    expect(r.ok && r.payload.faixas[0].ativo).toBe(false);
  });

  it("todo payload ok de CEP é aceito pela action; todo erro de zod tem o índice da linha", () => {
    const validos = [
      [],
      [cep("01000-000", "01000-000")], // início = fim
      [cep("01000-000", "01999-999"), cep("02000-000", "02000-000", "0", "0")],
    ];
    for (const linhas of validos) {
      const r = montarPayloadCep(linhas);
      expect(r.ok).toBe(true);
      if (r.ok) expect(aceitoPelaAction(r.payload).success).toBe(true);
    }
    // Faixas coladas (fim de uma = início da seguinte) cruzam: o servidor recusa.
    const colada = montarPayloadCep([cep("01000-000", "01999-999"), cep("01999-999", "02999-999")]);
    expect(colada).toMatchObject({ ok: false, indice: 1 });
  });

  it("taxa negativa e grátis negativo são recusados com o índice da linha", () => {
    expect(montarPayloadCep([cep("01000-000", "01999-999"), cep("02000-000", "02999-999", "-1")])).toMatchObject({
      ok: false,
      indice: 1,
    });
    const g = montarPayloadCep([cep("01000-000", "01999-999", "5", "-3")]);
    expect(g).toMatchObject({ ok: false, indice: 0 });
    if (!g.ok) expect(g.erro).toContain("o frete grátis da faixa de 01000-000 a 01999-999");
  });

  it("preço não numérico ('abc') cai em 'Informe o preço' e não vira NaN no payload", () => {
    expect(montarPayloadCep([cep("01000-000", "01999-999", "abc")])).toEqual({
      ok: false,
      erro: "Informe o preço da faixa de 01000-000 a 01999-999.",
      indice: 0,
    });
  });

  it("vírgula decimal da máscara BR vira ponto no payload", () => {
    const r = montarPayloadCep([cep("01000-000", "01999-999", "7,5", "50,00")]);
    expect(r.ok && r.payload.faixas[0]).toMatchObject({ taxa: 7.5, pedido_minimo_gratis: 50 });
  });

  it("exatamente no teto de 50 faixas passa; a action concorda", () => {
    const linhas = Array.from({ length: 50 }, (_, i) =>
      cep(cepInteiroParaMascara(i * 1000), cepInteiroParaMascara(i * 1000 + 999)),
    );
    const r = montarPayloadCep(linhas);
    expect(r.ok).toBe(true);
    if (r.ok) expect(aceitoPelaAction(r.payload).success).toBe(true);
  });
});

describe("ida e volta zonas gravadas → tela → payload (bairros)", () => {
  it("grupos lidos do banco voltam como payload igual, aceito pela action", () => {
    const zonas = [
      zonaBairro("a", ["Centro", "Jardim América"], 6.1, 0),
      zonaBairro("b", ["Vila Nova"], 8, null),
    ];
    zonas[1].ativo = false;

    const r = montarPayloadBairros(lerGruposBairro(zonas));
    expect(r).toEqual({
      ok: true,
      payload: {
        forma: "bairro",
        grupos: [
          { bairros: ["Centro", "Jardim América"], taxa: 6.1, pedido_minimo_gratis: 0, ativo: true },
          { bairros: ["Vila Nova"], taxa: 8, pedido_minimo_gratis: null, ativo: false },
        ],
      },
    });
    if (r.ok) expect(aceitoPelaAction(r.payload).success).toBe(true);
  });

  it("rascunho `novoBairro` nunca vai no payload (a action é .strict())", () => {
    const g = { ...grupo(["Centro"]), novoBairro: "Digitando..." };
    const r = montarPayloadBairros([g]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(JSON.stringify(r.payload)).not.toContain("Digitando");
      expect(aceitoPelaAction(r.payload).success).toBe(true);
    }
  });

  it("taxa negativa / grátis negativo ⇒ mensagem do campo certo com o índice do grupo", () => {
    const a = montarPayloadBairros([grupo(["A"]), grupo(["B"], "-1")]);
    expect(a).toEqual({ ok: false, erro: expect.stringContaining("o preço destes bairros"), indice: 1 });
    const b = montarPayloadBairros([grupo(["A"], "5", "-2")]);
    expect(b).toEqual({ ok: false, erro: expect.stringContaining("o frete grátis destes bairros"), indice: 0 });
  });

  it("frete grátis ligado e vazio ⇒ erro no grupo", () => {
    expect(montarPayloadBairros([grupo(["A"], "5", "")])).toEqual({
      ok: false,
      erro: "Informe o valor do frete grátis destes bairros ou desligue a opção.",
      indice: 0,
    });
  });

  it("bairro repetido DENTRO do mesmo grupo também é recusado", () => {
    const r = montarPayloadBairros([grupo(["Centro", "CENTRO"])]);
    expect(r).toMatchObject({ ok: false, indice: 0 });
  });

  it("bairro só com espaços ⇒ recusado no grupo, sem payload", () => {
    expect(montarPayloadBairros([grupo(["Centro"]), grupo(["   "])])).toMatchObject({ ok: false, indice: 1 });
  });

  it("101 bairros num grupo ⇒ mensagem do teto por grupo com o índice", () => {
    const nomes = Array.from({ length: TETO_BAIRROS_POR_GRUPO + 1 }, (_, i) => `Bairro ${i}`);
    expect(montarPayloadBairros([grupo(nomes)])).toEqual({
      ok: false,
      erro: `Cadastre até ${TETO_BAIRROS_POR_GRUPO} bairros por preço, com nomes de até 120 letras.`,
      indice: 0,
    });
  });

  it("nome com mais de 120 letras ⇒ recusado no grupo", () => {
    expect(montarPayloadBairros([grupo(["x".repeat(121)])])).toMatchObject({ ok: false, indice: 0 });
  });

  it("31 grupos ⇒ erro de teto sem índice; 30 passam", () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => grupo([`B${i}`]));
    expect(montarPayloadBairros(mk(TETO_GRUPOS_BAIRRO + 1))).toEqual({
      ok: false,
      erro: `Cadastre no máximo ${TETO_GRUPOS_BAIRRO} preços por bairro.`,
      indice: null,
    });
    const ok = montarPayloadBairros(mk(TETO_GRUPOS_BAIRRO));
    expect(ok.ok).toBe(true);
  });

  it("301 bairros no total (grupos ≤ teto cada) ⇒ mensagem do teto total, sem índice", () => {
    const grupos = Array.from({ length: 4 }, (_, g) =>
      grupo(Array.from({ length: g === 3 ? 76 : 75 }, (_, i) => `B${g}-${i}`)),
    );
    expect(grupos.flatMap((g) => g.bairros).length).toBe(TETO_BAIRROS_TOTAL + 1);
    expect(montarPayloadBairros(grupos)).toEqual({
      ok: false,
      erro: `Cadastre no máximo ${TETO_BAIRROS_TOTAL} bairros.`,
      indice: null,
    });
  });
});

describe("ida e volta zonas gravadas → tela → payload (km)", () => {
  const zonaKm = (i: number, inc: 1 | 2, taxa: number, ativo = true, gratis: number | null = null): ZonaVitrine => ({
    id: `k${i}`,
    nome: rotuloFaixa(i, inc),
    tipo: "raio_km",
    ativo,
    taxa: { taxa, pedido_minimo_gratis: gratis, raio_max_km: (i + 1) * inc, cep_inicio: null, cep_fim: null },
    bairros: [],
  });

  it("faixas lidas do formato gravado voltam como payload de km aceito pela action", () => {
    const leitura = lerFaixas([zonaKm(0, 2, 4), zonaKm(1, 2, 6.5, true, 80), zonaKm(2, 2, 9, false)]);
    expect(leitura.modo).toBe("faixas");

    const r = montarPayloadKm(
      leitura.incremento,
      leitura.faixas.map((f) => ({
        taxa: String(f.taxa),
        gratis: f.pedido_minimo_gratis == null ? null : String(f.pedido_minimo_gratis),
        ativo: f.ativo,
      })),
    );
    expect(r).toEqual({
      ok: true,
      payload: {
        incremento: 2,
        faixas: [
          { taxa: 4, pedido_minimo_gratis: null, ativo: true },
          { taxa: 6.5, pedido_minimo_gratis: 80, ativo: true },
          { taxa: 9, pedido_minimo_gratis: null, ativo: false },
        ],
      },
    });
    if (r.ok) expect(aceitoPelaAction({ forma: "raio_km", ...r.payload }).success).toBe(true);
  });

  it("faixa ativa depois de desligada ⇒ mensagem de prefixo com o índice da faixa", () => {
    const r = montarPayloadKm(1, [
      { taxa: "4", gratis: null, ativo: true },
      { taxa: "5", gratis: null, ativo: false },
      { taxa: "6", gratis: null, ativo: true },
    ]);
    expect(r).toMatchObject({ ok: false, indice: 2 });
  });
});

describe("frete por bairro (uma linha por bairro) → mesmo payload de grupos", () => {
  const linha = (nome: string, taxa = "6", gratis: string | null = null, ativo = true): BairroEditavel => ({
    nome,
    taxa,
    gratis,
    ativo,
  });

  it("lê uma linha por bairro com o preço do grupo dele", () => {
    const zonas = [zonaBairro("a", ["Centro", "Jardim"], 6, 50), zonaBairro("b", ["Vila Nova"], 8)];
    zonas[1].ativo = false;
    expect(lerBairrosIndividuais(zonas)).toEqual([
      linha("Centro", "6", "50"),
      linha("Jardim", "6", "50"),
      linha("Vila Nova", "8", null, false),
    ]);
  });

  it("junta bairros de preço, grátis e ativo iguais num grupo, na ordem da 1ª linha", () => {
    const r = montarPayloadPorBairro([
      linha("Centro", "6"),
      linha("Vila Nova", "8"),
      linha("Jardim", "6"),
      linha("Bela Vista", "6", "50"),
      linha("Morro", "6", null, false),
    ]);
    expect(r).toEqual({
      ok: true,
      payload: {
        forma: "bairro",
        grupos: [
          { bairros: ["Centro", "Jardim"], taxa: 6, pedido_minimo_gratis: null, ativo: true },
          { bairros: ["Vila Nova"], taxa: 8, pedido_minimo_gratis: null, ativo: true },
          { bairros: ["Bela Vista"], taxa: 6, pedido_minimo_gratis: 50, ativo: true },
          { bairros: ["Morro"], taxa: 6, pedido_minimo_gratis: null, ativo: false },
        ],
      },
    });
    if (r.ok) expect(aceitoPelaAction(r.payload).success).toBe(true);
  });

  it("ida e volta: zonas → linhas → payload igual ao da aba por preço", () => {
    const zonas = [zonaBairro("a", ["Centro", "Jardim"], 6.1, 0), zonaBairro("b", ["Vila Nova"], 8)];
    expect(montarPayloadPorBairro(lerBairrosIndividuais(zonas))).toEqual(
      montarPayloadBairros(lerGruposBairro(zonas)),
    );
  });

  it("payload salvo → zonas → a outra aba abre com os mesmos bairros e preços", () => {
    const r = montarPayloadPorBairro([linha("Centro", "6"), linha("Vila Nova", "8", "40", false)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const zonas = zonasDoPayloadBairros(r.payload);
    expect(montarPayloadBairros(lerGruposBairro(zonas))).toEqual(r);
    expect(montarPayloadPorBairro(lerBairrosIndividuais(zonas))).toEqual(r);
  });

  it("bairro repetido (caixa e acento não contam) aponta a linha e cita a primeira", () => {
    const r = montarPayloadPorBairro([linha("São José"), linha("Centro"), linha("sao  jose")]);
    expect(r).toEqual({ ok: false, erro: "sao jose já está na linha 1.", indice: 2 });
  });

  it("nome vazio, frete vazio e grátis ligado vazio apontam a linha", () => {
    expect(montarPayloadPorBairro([linha("A"), linha("  ")])).toMatchObject({ ok: false, indice: 1 });
    expect(montarPayloadPorBairro([linha("A", "")])).toEqual({
      ok: false,
      erro: "Informe o frete deste bairro.",
      indice: 0,
    });
    expect(montarPayloadPorBairro([linha("A", "5", "")])).toMatchObject({ ok: false, indice: 0 });
  });

  it("frete negativo aponta a linha do bairro, não o grupo", () => {
    const r = montarPayloadPorBairro([linha("A", "5"), linha("B", "-1"), linha("C", "-1")]);
    expect(r).toEqual({ ok: false, erro: expect.stringContaining("o frete deste bairro"), indice: 1 });
  });

  it("mais de 100 bairros com o mesmo preço abrem outro grupo com o mesmo preço", () => {
    const linhas = Array.from({ length: TETO_BAIRROS_POR_GRUPO + 1 }, (_, i) => linha(`Bairro ${i}`));
    const r = montarPayloadPorBairro(linhas);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.grupos.map((g) => g.bairros.length)).toEqual([TETO_BAIRROS_POR_GRUPO, 1]);
      expect(aceitoPelaAction(r.payload).success).toBe(true);
    }
  });

  it("mais preços diferentes que o teto ⇒ erro sem linha", () => {
    const linhas = Array.from({ length: TETO_GRUPOS_BAIRRO + 1 }, (_, i) => linha(`Bairro ${i}`, String(i + 1)));
    expect(montarPayloadPorBairro(linhas)).toEqual({
      ok: false,
      erro: `Use no máximo ${TETO_GRUPOS_BAIRRO} preços diferentes.`,
      indice: null,
    });
  });

  it("mais bairros que o teto total ⇒ erro sem linha", () => {
    const linhas = Array.from({ length: TETO_BAIRROS_TOTAL + 1 }, (_, i) => linha(`Bairro ${i}`));
    expect(montarPayloadPorBairro(linhas)).toMatchObject({ ok: false, indice: null });
  });
});
