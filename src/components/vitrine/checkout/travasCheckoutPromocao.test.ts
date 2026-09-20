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
    expect(wizard).toContain("enviar({ revisaoConfirmada: true })");
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
