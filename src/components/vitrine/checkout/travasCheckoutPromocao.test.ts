// [237/238] As travas que, sem jsdom, só o CÓDIGO-FONTE pode afirmar.
//
// Precedente: `superficiesPromocao.test.tsx`, que também lê os arquivos para
// provar invariantes de estrutura que nenhum render estático alcança (um botão
// AUSENTE do DOM só é provável olhando quem o renderiza).

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR_CHECKOUT = new URL(".", import.meta.url).pathname;

/** Comentários explicam a trava — e citam o que ela proíbe. A asserção é
 *  sobre o CÓDIGO, então eles saem antes. */
function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

const ler = (p: string) =>
  semComentarios(readFileSync(join(DIR_CHECKOUT, p), "utf8"));

const wizard = ler("CheckoutWizard.tsx");
const pagamento = ler("EtapaPagamento.tsx");
const resumo = ler("ResumoValores.tsx");
const estado = ler("estado.ts");
const hook = semComentarios(
  readFileSync(
    join(DIR_CHECKOUT, "..", "..", "..", "hooks", "useRevisaoCarrinho.ts"),
    "utf8",
  ),
);

describe("[238/M9 trava 1] o CTA de envio SAI DO DOM na reconfirmação", () => {
  it("wizard mobile: o botão é renderizado sob `!revisao.pendente`", () => {
    expect(pagamento).toContain("{!revisao.pendente && (");
  });

  it("coluna sticky desktop: o botão é renderizado sob `!revisaoPendente`", () => {
    expect(wizard).toContain("{!revisaoPendente && (");
  });
});

describe("[238/M9 trava 2] o gate mora em `podeConfirmar`, uma vez", () => {
  it("as DUAS árvores chamam `podeConfirmar` com o estado da revisão", () => {
    expect(pagamento).toMatch(/podeConfirmar\([\s\S]{0,120}revisao/);
    expect(wizard).toMatch(/podeConfirmar\([\s\S]{0,160}revisaoDoGate/);
  });

  it("nenhum componente reimplementa a condição da revisão", () => {
    for (const fonte of [pagamento, wizard]) {
      expect(fonte).not.toMatch(/pendente\s*&&\s*!.*confirmada/);
    }
  });
});

describe("[238/RN-12-a] `promocaoExibida` sai de UM lugar só", () => {
  it("nenhum componente monta o campo à mão — só `estado.ts`", () => {
    const arquivos = readdirSync(DIR_CHECKOUT).filter(
      (f) => f.endsWith(".tsx") && !f.includes(".test."),
    );
    for (const f of arquivos) {
      expect(ler(f)).not.toContain("promocaoExibida");
    }
    expect(estado).toContain("promocaoExibida");
  });

  it("o segundo clique é um ARGUMENTO do envio, não uma prop lida tarde", () => {
    expect(wizard).toContain("enviar({ indicesReconfirmados: indices })");
  });

  it("[auditar 4] a limpeza da flag é POR LINHA, nunca global", () => {
    expect(estado).toContain("indicesReconfirmados.includes(indice)");
    expect(estado).not.toContain("!revisaoConfirmada");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Correções do `auditar` — o diálogo NUNCA abre com dado velho.
describe("[auditar 1] a reconfirmação só abre com revisão FRESCA", () => {
  it("nenhum `.finally()` abre o diálogo haja o que houver", () => {
    expect(wizard).not.toContain(".finally(");
  });

  it("a decisão vem do módulo puro, e o `falhou` só toasta", () => {
    expect(wizard).toContain("decidirReconfirmacao(");
    expect(wizard).toContain("MSG_REVISAO_FALHOU");
    // `aoRevisaoNecessaria` não abre nada: quem abre é o efeito, com o estado
    // fresco. Nenhum `setReconfirmacao({` dentro do `.then` da revisão.
    expect(wizard).toMatch(/\.then\(\(r\) => \{[\s\S]*?\}\);/);
    const then = wizard.slice(
      wizard.indexOf(".then((r) => {"),
      wizard.indexOf("}, [revisar,"),
    );
    expect(then).not.toContain("setReconfirmacao({");
  });

  it("a comparação de preços usa a revisão FRESCA, não a última que voltou", () => {
    expect(wizard).toContain("revisaoFresca");
    expect(wizard).not.toMatch(/detectarMudancasDePreco\(\s*linhasExibidas,\s*revisao\.itens/);
  });

  it("lista vazia não abre diálogo: o efeito sai na chave sem mudança", () => {
    expect(wizard).toContain("if (chave === CHAVE_SEM_MUDANCA) return;");
  });

  it("o diálogo renderiza o conteúdo CONGELADO na abertura", () => {
    expect(wizard).toContain("itens={reconfirmacao?.itens ?? []}");
    expect(wizard).toContain("novoTotal={reconfirmacao?.total ?? totalPreview}");
  });
});

describe("[auditar 2] o resumo exibe o subtotal do SERVIDOR", () => {
  it("o subtotal local só é fallback de revisão ausente", () => {
    expect(wizard).toContain(
      "const subtotalExibido = revisaoFresca?.subtotal ?? subtotalPreview;",
    );
    // Nenhuma tela recebe mais o subtotal calculado dos preços do carrinho.
    expect(wizard).not.toContain("subtotal={subtotalPreview}");
  });

  it("o total continua saindo da fórmula única", () => {
    expect(wizard).toContain("totalPreviewEstimado(\n    subtotalExibido,");
    expect(pagamento).toContain("totalPreviewEstimado(subtotal, desconto, frete)");
  });

  it("preço que SOBE aciona a reconfirmação sem depender da recusa do servidor", () => {
    expect(wizard).toMatch(/chaveMudancas\(mudancas\.subiram\)/);
    expect(wizard).toContain("setReconfirmacao({ itens: mudancas.subiram");
  });
});

describe("[auditar 3] a revisão automática tem debounce e balde próprio", () => {
  it("o hook agenda por `ATRASO_REVISAO_MS`, não dispara na hora", () => {
    expect(hook).toContain("setTimeout(");
    expect(hook).toContain("ATRASO_REVISAO_MS");
    expect(hook).toContain("clearTimeout(id)");
  });

  it("a dedupe do efeito inclui o cupom (chaveRevisao)", () => {
    expect(hook).toContain("chaveRevisao(itens, codigoCupom)");
    expect(hook).toContain("if (ultimaRef.current === chaveAtual) return;");
  });
});

describe("[237/M4] o resumo ramifica só sobre o ESTADO do cupom", () => {
  it("nunca compara `baseElegivel` com `subtotal`", () => {
    expect(resumo).not.toContain("baseElegivel");
  });

  it("toda a copy do cupom vem do módulo puro", () => {
    expect(resumo).toContain('from "@/lib/utils/copiaCupom"');
    expect(resumo).not.toContain("Não acumula com promoção");
  });
});
