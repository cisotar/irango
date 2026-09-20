import { describe, it, expect } from "vitest";
import { precoEfetivo, type ProdutoComDesconto } from "./precoEfetivo";

// RED da issue 223 (crítica: dinheiro). Casos literais de tasks/223 e
// specs/desconto-por-produto-e-pratos-promocionais.md (RN-02, RN-03, RN-07).

// `agora` fixo e injetado: a função é pura e NUNCA lê o relógio (fora de escopo
// da issue 223 justamente para o teste ser determinístico).
const AGORA = new Date("2026-06-14T12:00:00.000Z");
const PASSADO = "2026-06-14T11:00:00.000Z";
const FUTURO = "2026-06-14T13:00:00.000Z";
const AGORA_ISO = "2026-06-14T12:00:00.000Z"; // === AGORA, para as bordas

// Produto base: R$ 100,00 sem nenhuma promoção configurada.
function produto(over: Partial<ProdutoComDesconto> = {}): ProdutoComDesconto {
  return {
    preco: 100,
    desconto_ativo: false,
    desconto_tipo: null,
    desconto_valor: null,
    desconto_inicio: null,
    desconto_fim: null,
    ...over,
  };
}

// O Intl pt-BR separa "R$" do número com NBSP (U+00A0). Normalizar aqui evita
// que o RED/GREEN dependa de um caractere invisível — a asserção continua
// literal sobre o texto que o cliente lê.
function semNbsp(texto: string | null): string | null {
  return texto === null ? null : texto.replace(/ /g, " ");
}

describe("precoEfetivo — aritmética do desconto (RN-02)", () => {
  it("sem desconto configurado → preço cheio, sem selo", () => {
    expect(precoEfetivo(produto(), AGORA)).toEqual({
      precoEfetivo: 100,
      temDesconto: false,
      seloDesconto: null,
    });
  });

  it("R$ 100,00 com 20% → R$ 80,00 e selo -20%", () => {
    const r = precoEfetivo(
      produto({
        desconto_ativo: true,
        desconto_tipo: "percentual",
        desconto_valor: 20,
      }),
      AGORA,
    );
    expect(r.precoEfetivo).toBe(80);
    expect(r.temDesconto).toBe(true);
    expect(r.seloDesconto).toBe("-20%");
  });

  it("R$ 100,00 menos R$ 30,00 fixos → R$ 70,00 e selo -R$ 30,00", () => {
    const r = precoEfetivo(
      produto({
        desconto_ativo: true,
        desconto_tipo: "fixo",
        desconto_valor: 30,
      }),
      AGORA,
    );
    expect(r.precoEfetivo).toBe(70);
    expect(r.temDesconto).toBe(true);
    expect(semNbsp(r.seloDesconto)).toBe("-R$ 30,00");
  });

  it("arredonda a 2 casas: R$ 19,99 com 10% → R$ 17,99 (17,991 truncaria errado)", () => {
    const r = precoEfetivo(
      produto({
        preco: 19.99,
        desconto_ativo: true,
        desconto_tipo: "percentual",
        desconto_valor: 10,
      }),
      AGORA,
    );
    expect(r.precoEfetivo).toBe(17.99);
  });

  it("piso em zero: fixo de R$ 150,00 sobre R$ 100,00 → R$ 0,00, nunca negativo", () => {
    // Linha impossível (o CHECK produtos_desconto_fixo_check a recusa no banco):
    // o clamp é a TERCEIRA camada de RN-05 e existe para o dia em que ela escapar.
    const r = precoEfetivo(
      produto({
        desconto_ativo: true,
        desconto_tipo: "fixo",
        desconto_valor: 150,
      }),
      AGORA,
    );
    expect(r.precoEfetivo).toBe(0);
    expect(r.temDesconto).toBe(true);
  });

  it("piso em zero: percentual de 150% → R$ 0,00, nunca negativo", () => {
    const r = precoEfetivo(
      produto({
        desconto_ativo: true,
        desconto_tipo: "percentual",
        desconto_valor: 150,
      }),
      AGORA,
    );
    expect(r.precoEfetivo).toBe(0);
  });

  it("linha incoerente (ativo sem tipo/valor) → preço cheio, nunca NaN", () => {
    // produtos_desconto_coerente_check recusa isso no banco; a função pura não
    // pode devolver NaN se alguma linha escapar (NaN vira 'R$ NaN' na vitrine).
    const r = precoEfetivo(produto({ desconto_ativo: true }), AGORA);
    expect(r.precoEfetivo).toBe(100);
    expect(r.temDesconto).toBe(false);
    expect(r.seloDesconto).toBe(null);
  });
});

describe("precoEfetivo — vigência (RN-03: início inclusivo, fim exclusivo)", () => {
  const promo = {
    desconto_ativo: true,
    desconto_tipo: "percentual",
    desconto_valor: 20,
  } satisfies Partial<ProdutoComDesconto>;

  it("dentro do prazo (início no passado, fim no futuro) → vigente", () => {
    const r = precoEfetivo(
      produto({ ...promo, desconto_inicio: PASSADO, desconto_fim: FUTURO }),
      AGORA,
    );
    expect(r.precoEfetivo).toBe(80);
    expect(r.temDesconto).toBe(true);
  });

  it("ainda não começou (início no futuro) → preço cheio, sem selo", () => {
    const r = precoEfetivo(produto({ ...promo, desconto_inicio: FUTURO }), AGORA);
    expect(r.precoEfetivo).toBe(100);
    expect(r.temDesconto).toBe(false);
    expect(r.seloDesconto).toBe(null);
  });

  it("já terminou (fim no passado) → preço cheio, sem selo", () => {
    const r = precoEfetivo(produto({ ...promo, desconto_fim: PASSADO }), AGORA);
    expect(r.precoEfetivo).toBe(100);
    expect(r.temDesconto).toBe(false);
    expect(r.seloDesconto).toBe(null);
  });

  it("desconto_inicio === agora → VIGENTE (início inclusivo)", () => {
    const r = precoEfetivo(
      produto({ ...promo, desconto_inicio: AGORA_ISO }),
      AGORA,
    );
    expect(r.precoEfetivo).toBe(80);
    expect(r.temDesconto).toBe(true);
  });

  it("desconto_fim === agora → NÃO vigente (fim exclusivo, como validarUsoCupom)", () => {
    const r = precoEfetivo(produto({ ...promo, desconto_fim: AGORA_ISO }), AGORA);
    expect(r.precoEfetivo).toBe(100);
    expect(r.temDesconto).toBe(false);
    expect(r.seloDesconto).toBe(null);
  });

  it("sem prazo nenhum (início e fim null) → vigente até desligar (D1)", () => {
    const r = precoEfetivo(produto(promo), AGORA);
    expect(r.temDesconto).toBe(true);
  });

  it("desconto_ativo = false com prazo vigente → preço cheio (RN-07)", () => {
    const r = precoEfetivo(
      produto({
        ...promo,
        desconto_ativo: false,
        desconto_inicio: PASSADO,
        desconto_fim: FUTURO,
      }),
      AGORA,
    );
    expect(r.precoEfetivo).toBe(100);
    expect(r.temDesconto).toBe(false);
    expect(r.seloDesconto).toBe(null);
  });
  describe("falha FECHADA em dado ilegível (achado do auditar na 223)", () => {
    it("desconto_inicio ilegível ⇒ preço cheio, nunca vigente por acidente", () => {
      const r = precoEfetivo(
        produto({
          desconto_ativo: true,
          desconto_tipo: "percentual",
          desconto_valor: 20,
          desconto_inicio: "amanhã",
        }),
        AGORA,
      );
      expect(r).toEqual({ precoEfetivo: 100, temDesconto: false, seloDesconto: null });
    });

    it("desconto_fim ilegível ⇒ preço cheio — toda comparação com NaN é false", () => {
      const r = precoEfetivo(
        produto({
          desconto_ativo: true,
          desconto_tipo: "fixo",
          desconto_valor: 30,
          desconto_fim: "",
        }),
        AGORA,
      );
      expect(r).toEqual({ precoEfetivo: 100, temDesconto: false, seloDesconto: null });
    });

    it("agora ilegível ⇒ preço cheio, e não toda promoção configurada virando vigente", () => {
      const r = precoEfetivo(
        produto({
          desconto_ativo: true,
          desconto_tipo: "percentual",
          desconto_valor: 20,
          desconto_inicio: PASSADO,
          desconto_fim: FUTURO,
        }),
        new Date("nao-e-data"),
      );
      expect(r).toEqual({ precoEfetivo: 100, temDesconto: false, seloDesconto: null });
    });

    it("preco nulo LANÇA — produto de graça com selo é pior que erro", () => {
      expect(() =>
        precoEfetivo(
          produto({
            preco: null as unknown as number,
            desconto_ativo: true,
            desconto_tipo: "percentual",
            desconto_valor: 20,
          }),
          AGORA,
        ),
      ).toThrow(/preco invalido/);
    });

    it("desconto fixo negativo, se escapar do CHECK, NÃO sobe o preço", () => {
      const r = precoEfetivo(
        produto({
          desconto_ativo: true,
          desconto_tipo: "fixo",
          desconto_valor: -50,
        }),
        AGORA,
      );
      expect(r.precoEfetivo).toBe(100);
    });
  });
});
