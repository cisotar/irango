/**
 * [197] Fase RED — ObservacaoItem (bloco B).
 *
 * Alvo: `src/components/vitrine/ObservacaoItem.tsx` — AINDA NÃO EXISTE. Estes
 * testes falham até a fase GREEN (`executar`) criar o componente.
 *
 * A observação é TEXTO LIVRE DO CLIENTE (`itens_pedido.observacao` — "sem
 * cebola", "ponto da carne"), hoje gravado ponta a ponta (issues 167/168) e
 * nunca renderizado nas três telas do comprador: gaveta (`Carrinho.tsx`),
 * checkout (`EtapaItens.tsx`) e confirmação (`confirmacao/page.tsx`).
 *
 * Espelha `ListaOpcionaisItem.test.tsx`: apresentacional, `null`/vazia/só
 * espaços → `return null`, `whitespace-pre-line`, texto do cliente via JSX
 * (auto-escapado pelo React) — nunca `dangerouslySetInnerHTML`.
 *
 * Ambiente: vitest environment=node, sem jsdom — `renderToStaticMarkup`.
 *
 * Contrato esperado:
 *   <ObservacaoItem observacao={string | null | undefined} className?={string} />
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ObservacaoItem } from "@/components/vitrine/ObservacaoItem";

function render(observacao: string | null | undefined): string {
  return renderToStaticMarkup(<ObservacaoItem observacao={observacao} />);
}

describe("[197] ObservacaoItem — observação presente", () => {
  it("exibe o texto da observação", () => {
    expect(render("sem cebola")).toContain("sem cebola");
  });

  it("exibe o rótulo 'Obs' junto do texto (mesmo rótulo do painel)", () => {
    expect(render("sem cebola")).toContain("Obs");
  });

  it("preserva quebras de linha com whitespace-pre-line", () => {
    const html = render("sem cebola\nponto da carne: mal passado");
    expect(html).toContain("whitespace-pre-line");
    expect(html).toContain("sem cebola");
    expect(html).toContain("ponto da carne: mal passado");
  });

  it("aplica trim nas bordas mas mantém o miolo", () => {
    expect(render("  capricha no molho  ")).toContain("capricha no molho");
  });
});

describe("[197] ObservacaoItem — vazia: nada no DOM (sem rótulo órfão)", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["string vazia", ""],
    ["só espaços", "   "],
    ["só quebras de linha", "\n\n"],
    ["espaços e quebras", " \n \t "],
  ])("observacao %s → string vazia, sem rótulo", (_rotulo, valor) => {
    expect(render(valor as string | null | undefined)).toBe("");
  });
});

describe("[197] ObservacaoItem — XSS: texto do cliente é dado, nunca markup", () => {
  it("🔴 <script> na observação sai ESCAPADO no HTML, nunca como tag executável", () => {
    const html = render("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("alert(1)");
  });

  it("<img onerror> não vira elemento no DOM", () => {
    const html = render('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    // GREEN [197]: a asserção original era `not.toContain("onerror=")`, o que
    // NENHUMA renderização fiel satisfaz — o texto do cliente contém esse
    // literal e o React escapa `<`, `>` e `"`, não o `=`. O que importa (e é o
    // que o título do teste diz) é que nada disso abre um elemento: sem `<img`,
    // o `onerror` fica dentro de um nó de TEXTO, com as aspas escapadas.
    expect(html).not.toContain('<img src=x onerror="');
    expect(html).toContain("&lt;img");
    expect(html).toContain("onerror=&quot;alert(1)&quot;&gt;");
  });

  it("aspas e < > são escapados (nada escapa para atributo)", () => {
    const html = render('" onmouseover="alert(1)');
    expect(html).not.toContain('onmouseover="alert(1)"');
  });
});
