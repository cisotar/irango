/**
 * [256] As duas frases de RN-03 e a saída oferecida pela recusa da remoção.
 * Puras, afirmadas byte a byte — é para isso que elas saíram do `.tsx`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  frasesDoImpacto,
  fraseExclusivos,
  fraseMenu,
  rotuloConverter,
} from "./frasesCardapio";

describe("frases de impacto (RN-03, D14)", () => {
  it("o que SOME vem antes do que FICA", () => {
    expect(frasesDoImpacto(4, 2)).toEqual([
      "2 produtos são exclusivos deste cardápio e vão sumir da vitrine.",
      "4 produtos do menu continuam aparecendo e vendendo normalmente.",
    ]);
  });

  it("singulariza as duas", () => {
    expect(fraseExclusivos(1)).toBe(
      "1 produto é exclusivo deste cardápio e vai sumir da vitrine.",
    );
    expect(fraseMenu(1)).toBe(
      "1 produto do menu continua aparecendo e vendendo normalmente.",
    );
  });

  it("zero não vira frase — não há nada a avisar", () => {
    expect(fraseExclusivos(0)).toBeNull();
    expect(fraseMenu(0)).toBeNull();
    expect(frasesDoImpacto(0, 0)).toEqual([]);
  });

  it("a saída a um clique diz o número", () => {
    expect(rotuloConverter(1)).toBe("Converter 1 produto para o menu");
    expect(rotuloConverter(3)).toBe("Converter os 3 produtos para o menu");
  });
});

/**
 * Trava de FONTE, porque é o único jeito sem jsdom: nenhuma frase do painel
 * pode prometer que os produtos voltariam a ser vendidos ao religar o
 * cardápio. É FALSO para o produto exclusivo (RN-03) e é a meia-verdade que o
 * lojista só descobriria olhando a vitrine.
 *
 * A agulha é MONTADA em pedaços de propósito: o critério de aceite da 256 é
 * `grep -rn "<a promessa>" src/` NÃO devolver nada, e um teste que a escreve
 * por extenso reprovaria o próprio critério que ele protege.
 */
describe("trava de fonte (critério de aceite da 256)", () => {
  const RAIZ = join(import.meta.dirname, "..", "..");

  const ARQUIVOS = [
    "components/painel/FormVigencia.tsx",
    "components/painel/PreviewVigencia.tsx",
    "components/painel/frasesCardapio.ts",
    "components/painel/rascunhoCardapio.ts",
    "app/(painel)/painel/(bloqueavel)/cardapios/CardapiosClient.tsx",
    "app/(painel)/painel/(bloqueavel)/cardapios/page.tsx",
  ];

  /**
   * O CÓDIGO, sem comentário. Os próprios comentários destes arquivos citam as
   * frases proibidas para explicar por que são proibidas — sem tirá-los, a
   * trava dispararia contra a documentação da trava.
   */
  function fonte(caminho: string): string {
    return readFileSync(join(RAIZ, caminho), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  }

  const PROMESSA_PROIBIDA = ["voltam", "a", "vender"].join(" ");

  it("nenhuma tela de cardápio promete que os produtos voltariam a vender", () => {
    for (const caminho of ARQUIVOS) {
      expect(fonte(caminho)).not.toContain(PROMESSA_PROIBIDA);
    }
  });

  it("alvo de toque é o valor LITERAL, nunca a classe semântica do Tailwind", () => {
    // Mesmo motivo da agulha montada acima: o critério de aceite grepa estes
    // dois literais na rota e eles não podem existir nem num comentário.
    const CLASSE_PROIBIDA = ["min", "h", "11"].join("-");
    const TAMANHO_PROIBIDO = `size="${["icon", "sm"].join("-")}"`;
    for (const caminho of ARQUIVOS) {
      const texto = fonte(caminho);
      expect(texto).not.toContain(CLASSE_PROIBIDA);
      expect(texto).not.toContain(TAMANHO_PROIBIDO);
    }
    // E os dois que têm controle de toque usam a régua literal.
    expect(fonte("components/painel/FormVigencia.tsx")).toContain(
      "min-h-[44px] min-w-[44px]",
    );
    expect(
      fonte("app/(painel)/painel/(bloqueavel)/cardapios/CardapiosClient.tsx"),
    ).toContain("min-h-[44px] min-w-[44px]");
  });

  it("`PreviewVigencia` não faz conta de data: nem `Date`, nem `Intl`, nem `fusoLoja`", () => {
    const texto = fonte("components/painel/PreviewVigencia.tsx");
    expect(texto).not.toContain("fusoLoja");
    expect(texto).not.toContain("new Date");
    expect(texto).not.toContain("Intl.");
  });

  it("a lista não monta relógio no browser — o estado é do request", () => {
    const texto = fonte(
      "app/(painel)/painel/(bloqueavel)/cardapios/CardapiosClient.tsx",
    );
    expect(texto).not.toContain("setInterval");
    expect(texto).not.toContain("new Date");
    expect(
      fonte("app/(painel)/painel/(bloqueavel)/cardapios/page.tsx"),
    ).toContain('export const dynamic = "force-dynamic"');
  });
});
