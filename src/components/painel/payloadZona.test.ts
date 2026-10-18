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
import type { ZonaVitrine } from "@/lib/supabase/queries/entregaPagamento";
import {
  cepParaInteiro,
  cepInteiroParaMascara,
  grupoComBairro,
  lerFaixasCep,
  lerGruposBairro,
  montarPayloadBairros,
  montarPayloadCep,
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
