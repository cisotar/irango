// [262/design §13.7] O item que a revisão do servidor recusa AGORA: a linha
// nunca some, o submit trava, e a trava mora em `podeConfirmar` — uma vez.
//
// Nada de vigência é avaliado aqui: `compravel` e `motivoNaoCompravel` chegam
// prontos de `revisarCarrinhoAction` (252), pela MESMA `avaliarVigenciaDoProduto`
// que o SSR da vitrine e `criarPedido` usam.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { LinhaRevisada } from "@/lib/actions/revisarCarrinho-contrato";
import {
  anuncioItensBloqueados,
  detectarItensBloqueados,
} from "./itensBloqueados";
import { ESTADO_INICIAL, podeConfirmar, type EstadoWizard } from "./estado";

function linha(over: Partial<LinhaRevisada> = {}): LinhaRevisada {
  return {
    produto_id: "11111111-1111-4111-8111-111111111111",
    quantidade: 1,
    preco: 100,
    precoEfetivo: 100,
    temDesconto: false,
    compravel: true,
    motivoNaoCompravel: null,
    ...over,
  };
}

const FORA_DA_JANELA = linha({
  compravel: false,
  motivoNaoCompravel: "fora_da_janela",
});
const ESGOTADA = linha({ compravel: false, motivoNaoCompravel: "esgotado" });

describe("262 detectarItensBloqueados", () => {
  it("nomeia a linha certa, pelo ÍNDICE (duas linhas do mesmo produto)", () => {
    const bloqueados = detectarItensBloqueados(
      ["Feijoada", "Sopa de cebola", "Feijoada"],
      [linha(), FORA_DA_JANELA, linha()],
    );
    expect(bloqueados).toEqual([
      { indice: 1, nome: "Sopa de cebola", motivo: "fora_da_janela" },
    ]);
  });

  it("carrega o motivo `esgotado` sem confundi-lo com a janela", () => {
    expect(detectarItensBloqueados(["Coxinha"], [ESGOTADA])[0].motivo).toBe(
      "esgotado",
    );
  });

  it("carrinho inteiro comprável ⇒ lista vazia (a etapa renderiza como antes)", () => {
    expect(detectarItensBloqueados(["A", "B"], [linha(), linha()])).toEqual([]);
  });

  it("tamanhos divergentes ⇒ NADA é afirmado (nunca risca a linha errada)", () => {
    expect(detectarItensBloqueados(["A"], [linha(), FORA_DA_JANELA])).toEqual([]);
    expect(detectarItensBloqueados([], [FORA_DA_JANELA])).toEqual([]);
  });
});

describe("262 anuncioItensBloqueados — um anúncio, não um por linha", () => {
  it("singular, plural e vazio", () => {
    expect(anuncioItensBloqueados(1)).toBe(
      "1 item não está disponível agora e precisa ser removido.",
    );
    expect(anuncioItensBloqueados(3)).toBe(
      "3 itens não estão disponíveis agora e precisam ser removidos.",
    );
    expect(anuncioItensBloqueados(0)).toBe("");
  });

  it("sem 'erro', sem 'desculpe' — não é falha do cliente (design §13.7)", () => {
    const texto = anuncioItensBloqueados(2).toLowerCase();
    expect(texto).not.toContain("erro");
    expect(texto).not.toContain("desculpe");
  });
});

describe("262 podeConfirmar — item bloqueado trava o submit", () => {
  const PRONTO: EstadoWizard = {
    ...ESTADO_INICIAL,
    tipoEntrega: "retirada",
    formaPagamento: "pix",
  };

  it("com item bloqueado → false, mesmo com o pedido inteiro preenchido", () => {
    expect(
      podeConfirmar(PRONTO, "retirada", "ocioso", undefined, true),
    ).toBe(false);
  });

  it("sem item bloqueado → o gate de sempre, inalterado (não-regressão)", () => {
    expect(podeConfirmar(PRONTO, "retirada", "ocioso")).toBe(true);
    expect(
      podeConfirmar(PRONTO, "retirada", "ocioso", undefined, false),
    ).toBe(true);
  });

  it("entrega com frete OK também trava", () => {
    const entrega: EstadoWizard = {
      ...PRONTO,
      tipoEntrega: "entrega",
      endereco: {
        cep: "01001000",
        rua: "Rua Teste",
        numero: "1",
        bairro: "Centro",
        cidade: "São Paulo",
        uf: "SP",
      },
    };
    expect(podeConfirmar(entrega, "entrega", "ok")).toBe(true);
    expect(podeConfirmar(entrega, "entrega", "ok", undefined, true)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// A trava que, sem jsdom, só o código-fonte afirma: UM caminho de submit.
// ───────────────────────────────────────────────────────────────────────────

const DIR = new URL(".", import.meta.url).pathname;
const semComentarios = (fonte: string) =>
  fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const ler = (p: string) => semComentarios(readFileSync(join(DIR, p), "utf8"));

describe("262 — a condição mora em `podeConfirmar`, nunca reimplementada", () => {
  const wizard = ler("CheckoutWizard.tsx");
  const pagamento = ler("EtapaPagamento.tsx");
  const itens = ler("EtapaItens.tsx");

  it("as DUAS árvores repassam `temItemBloqueado` ao gate único", () => {
    expect(wizard).toMatch(/podeConfirmar\([\s\S]{0,200}temItemBloqueado/);
    expect(pagamento).toMatch(/podeConfirmar\([\s\S]{0,200}temItemBloqueado/);
  });

  it("nenhum componente decide comprabilidade por conta própria", () => {
    for (const fonte of [wizard, pagamento, itens]) {
      expect(fonte).not.toContain("dentroDaJanela");
      expect(fonte).not.toContain("avaliarVigencia");
    }
  });

  it("a linha bloqueada NÃO é omitida — ela ganha o texto e o botão Remover", () => {
    expect(itens).toContain("onRemover(linhaId)");
    expect(itens).toContain("rotuloNaoCompravel(bloqueio.motivo)");
    // Alvo de toque 44px LITERAL (design-system §5: a base é 120%).
    expect(itens).toContain("min-h-[44px] min-w-[44px]");
  });

  it("o avanço da etapa 1 também trava", () => {
    expect(itens).toContain("itens.length === 0 || bloqueados.length > 0");
  });
});
