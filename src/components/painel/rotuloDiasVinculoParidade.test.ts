/**
 * [278 → 323] TRAVA DE PARIDADE — `VinculoDoProduto.rotuloDias` é OBRIGATÓRIO
 * (`contrato-lote.ts`) exatamente porque o risco documentado ali é um dos DOIS
 * MUNDOS (painel do lojista e hub admin) esquecer de derivá-lo. `rotuloDias`
 * não tem teste de comportamento próprio — é uma string pronta, redigida por
 * `rotuloDiasDoItem` (coberta em `descreverVigencia.test.ts`) — então o único
 * bug de verdade que resta é DIVERGÊNCIA: um dos dois `page.tsx` compor
 * `rotuloDias` por uma função diferente, ou inline, ou esquecer de compor.
 *
 * Sem jsdom, um clique não observa isso; a trava é por LEITURA DE FONTE, forma
 * de `rotaCardapiosInjetada.test.tsx` — o mesmo padrão já usado neste projeto
 * para "os dois mundos não podem divergir silenciosamente".
 *
 * Se algum dos dois `page.tsx` passar a escrever
 * `rotuloDias: v.dias_semana ? algumaOutraCoisa(v.dias_semana) : ...` (uma
 * segunda fórmula) ou remover a chamada, este teste cai — antes de o painel ou
 * o hub admin renderizarem um chip mudo ou com dias errados.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(process.cwd(), "src");

const PAGE_LOJISTA = join(
  RAIZ,
  "app/(painel)/painel/(bloqueavel)/produtos/page.tsx",
);
const PAGE_ADMIN = join(RAIZ, "app/admin/assinantes/[lojaId]/produtos/page.tsx");

function ler(caminho: string): string {
  return readFileSync(caminho, "utf8");
}

/**
 * [323/D11] O chip de VÍNCULO saiu da tela: o cardápio virou função morta e
 * os dois `page.tsx` deixaram de compor `rotuloDias`. A trava de paridade
 * continua — agora sobre o que substituiu o chip: a projeção de FREQUÊNCIA,
 * que os dois mundos têm de montar pela MESMA chamada, com o fuso da loja.
 */
const CHAMADA = "projetarFrequenciasDoPainel(";
const ARGUMENTOS = /projetarFrequenciasDoPainel\(\s*produtos,\s*categorias,\s*agora,\s*loja\.timezone,?\s*\)/;

describe("frequência do painel — os dois mundos não divergem (323)", () => {
  it("os dois arquivos existem (senão o teste passa por vacuidade)", () => {
    expect(() => ler(PAGE_LOJISTA)).not.toThrow();
    expect(() => ler(PAGE_ADMIN)).not.toThrow();
  });

  it("os DOIS `page.tsx` importam `projetarFrequenciasDoPainel` de `frequenciaPainel`", () => {
    for (const caminho of [PAGE_LOJISTA, PAGE_ADMIN]) {
      expect(ler(caminho)).toMatch(
        /import\s*\{[^}]*\bprojetarFrequenciasDoPainel\b[^}]*\}\s*from\s*["']@\/lib\/utils\/frequenciaPainel["']/,
      );
    }
  });

  it("os DOIS chamam a projeção UMA vez, com os MESMOS argumentos", () => {
    for (const caminho of [PAGE_LOJISTA, PAGE_ADMIN]) {
      const codigo = ler(caminho);
      expect(codigo.split(CHAMADA)).toHaveLength(2);
      expect(codigo).toMatch(ARGUMENTOS);
      expect(codigo).toMatch(/frequencias=\{frequencias\}/);
    }
  });

  it("nenhum dos dois compõe mais `rotuloDias` de vínculo de cardápio", () => {
    for (const caminho of [PAGE_LOJISTA, PAGE_ADMIN]) {
      const codigo = ler(caminho);
      expect(codigo).not.toContain("rotuloDias:");
      expect(codigo).not.toContain("rotuloDiasDoItem");
    }
  });
});
