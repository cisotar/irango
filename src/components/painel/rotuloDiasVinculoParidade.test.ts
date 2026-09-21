/**
 * [278] TRAVA DE PARIDADE — `VinculoDoProduto.rotuloDias` é OBRIGATÓRIO
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

/** A composição EXATA que os dois mundos precisam compartilhar. */
const CHAMADA = "rotuloDias: rotuloDiasDoItem(v.dias_semana)";

describe("rotuloDias de VinculoDoProduto — os dois mundos não divergem", () => {
  it("os dois arquivos existem (senão o teste passa por vacuidade)", () => {
    expect(() => ler(PAGE_LOJISTA)).not.toThrow();
    expect(() => ler(PAGE_ADMIN)).not.toThrow();
  });

  it("os DOIS `page.tsx` importam `rotuloDiasDoItem` de `descreverVigencia`", () => {
    for (const caminho of [PAGE_LOJISTA, PAGE_ADMIN]) {
      const codigo = ler(caminho);
      expect(codigo).toMatch(
        /import\s*\{[^}]*\brotuloDiasDoItem\b[^}]*\}\s*from\s*["']@\/lib\/utils\/descreverVigencia["']/,
      );
    }
  });

  it("os DOIS compõem `rotuloDias` com a MESMA chamada, byte a byte", () => {
    const noLojista = ler(PAGE_LOJISTA);
    const noAdmin = ler(PAGE_ADMIN);
    expect(noLojista).toContain(CHAMADA);
    expect(noAdmin).toContain(CHAMADA);
  });

  it("nenhum dos dois compõe `rotuloDias` por uma segunda via (ternário, template, etc.)", () => {
    // A linha que atribui `rotuloDias:` dentro da montagem de `VinculoDoProduto`
    // (não a declaração do TIPO em `contrato-lote.ts`, que não entra aqui) tem
    // de ser, em AMBOS, exatamente a chamada — nunca uma expressão maior que
    // embrulhe um fallback ou uma segunda formatação.
    for (const caminho of [PAGE_LOJISTA, PAGE_ADMIN]) {
      const linhas = ler(caminho)
        .split("\n")
        .filter((linha) => linha.includes("rotuloDias:"));
      expect(linhas).toHaveLength(1);
      expect(linhas[0].trim().replace(/,$/, "")).toBe(CHAMADA);
    }
  });
});
