/**
 * `environment: node`, sem jsdom: aqui só dá para provar o que independe de
 * DOM — e é justamente o que importa nesta issue.
 *
 * 1. O SSR do componente é VAZIO (trava 6): `aberto` começa `false`, então o
 *    catálogo atrás dele está completo e interativo mesmo se o JS falhar.
 * 2. As travas anti-gesto que são AUSÊNCIAS (`setTimeout`, `onPointerDown`,
 *    `onTouchStart`, `onMouseDown`, um único `setAberto(true)`) são afirmadas
 *    sobre o texto-fonte do arquivo — é o mesmo grep do critério de aceite da
 *    issue 234, só que travado na suíte em vez de na disciplina de quem revisa.
 *    Sem jsdom, um `onPointerDown` reintroduzido passaria batido em tudo mais.
 */
import { readFileSync } from "node:fs";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";

import { ModalPromocoes } from "./ModalPromocoes";
import type { ProdutoModalDados } from "./ProdutoModal";

const FONTE = readFileSync(
  new URL("./ModalPromocoes.tsx", import.meta.url),
  "utf8",
);

/**
 * O MESMO arquivo sem comentário nenhum. As travas são sobre o que o código
 * FAZ: a documentação acima delas cita `setTimeout` e `onPointerDown` de
 * propósito (para explicar por que não estão lá) e não pode derrubar o teste.
 */
const CODIGO = FONTE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /^\s*\/\/.*$/gm,
  "",
);

function promo(n: number): ProdutoModalDados {
  return {
    id: `p${n}`,
    nome: `Prato ${n}`,
    descricao: null,
    foto_url: null,
    categoria_id: null,
    preco: 100,
    precoEfetivo: 80,
    temDesconto: true,
    seloDesconto: "-20%",
    descontoFim: null,
    compravel: true,
    motivoNaoCompravel: null,
  };
}

const COMUM = {
  lojaSlug: "lanches-base",
  toggleDaLoja: true,
  diaDeHojeNaLoja: "2026-09-20",
  storage: null,
  destinoFoco: createRef<HTMLElement>(),
};

describe("ModalPromocoes — nada no SSR (trava 6)", () => {
  it("com promoções e toggle ligado, o HTML do servidor é vazio", () => {
    const html = renderToStaticMarkup(
      <ModalPromocoes {...COMUM} promocoes={[promo(1), promo(2)]} />,
    );
    expect(html).toBe("");
  });

  it("sem promoção, também é vazio — e a guarda mora no filho (trava 7)", () => {
    expect(
      renderToStaticMarkup(<ModalPromocoes {...COMUM} promocoes={[]} />),
    ).toBe("");
  });

  it("toggle desligado é vazio", () => {
    expect(
      renderToStaticMarkup(
        <ModalPromocoes
          {...COMUM}
          toggleDaLoja={false}
          promocoes={[promo(1)]}
        />,
      ),
    ).toBe("");
  });
});

describe("ModalPromocoes — as travas que são ausências (RN-17)", () => {
  it("não escuta gesto bruto: nenhum pointerdown/touchstart/mousedown", () => {
    expect(CODIGO).not.toMatch(/onPointerDown|onTouchStart|onMouseDown/);
    expect(CODIGO).not.toMatch(/addEventListener/);
  });

  it("zero `setTimeout`/`setInterval`: a decisão é na montagem ou não é", () => {
    expect(CODIGO).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
  });

  it("existe exatamente UM `setAberto(true)` no arquivo", () => {
    expect(CODIGO.match(/setAberto\(true\)/g)).toHaveLength(1);
  });

  it("o único `setAberto(true)` está num `useEffect` de deps `[]`", () => {
    const efeito = /useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[\]\);/.exec(CODIGO);
    expect(efeito).not.toBeNull();
    expect(efeito?.[1]).toContain("setAberto(true)");
  });

  it("marca como visto ANTES de abrir, não no fechamento (trava 4)", () => {
    expect(CODIGO.indexOf("marcarVisualizado(")).toBeLessThan(
      CODIGO.indexOf("setAberto(true)"),
    );
    // `fechar()` só fecha — não grava nada.
    expect(CODIGO).toContain("const fechar = () => setAberto(false);");
  });

  it("não navega e não mexe no carrinho: nenhuma rota, nenhum `useCarrinho`", () => {
    expect(CODIGO).not.toMatch(/useRouter|next\/link|useCarrinho|href=/);
  });

  it("os dois CTAs e o ✕ passam pelo MESMO `fechar` (trava 5)", () => {
    expect(CODIGO.match(/onClick=\{fechar\}/g)).toHaveLength(3);
    expect(CODIGO.match(/setAberto\(false\)/g)).toHaveLength(1);
  });

  it("alvo de toque em valor literal, nunca `min-h-11` (base de fonte 120%)", () => {
    expect(CODIGO).toContain("min-h-[52px]");
    expect(CODIGO).toContain("min-h-[44px]");
    expect(CODIGO).toContain("min-w-[44px]");
    expect(CODIGO).not.toMatch(/min-h-11|size="icon-sm"/);
  });

  it("todo interativo tem foco visível", () => {
    const interativos = CODIGO.match(/<button/g) ?? [];
    expect(interativos.length).toBeGreaterThan(0);
    expect(CODIGO.match(/focus-visible:outline-3/g)).toHaveLength(
      interativos.length,
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// [289] As linhas de prato passaram a ABRIR O DETALHE.
//
// Por que árvore por TEXTO-FONTE e não por `renderToStaticMarkup`: a trava 6
// diz que o SSR deste componente é VAZIO (`aberto` começa `false` e só a
// hidratação muda), e os testes acima provam exatamente isso. Sem jsdom não há
// hidratação — então o corpo do modal não existe em HTML nenhum que esta suíte
// consiga produzir, e a estrutura é afirmada sobre o código, como já se faz com
// as travas que são ausências. Foco, sequenciamento e a abertura do
// `ProdutoModal` NÃO são observáveis aqui: são verificação manual (spec,
// §Testabilidade).
// ═════════════════════════════════════════════════════════════════════════════

describe("ModalPromocoes — cada prato listado abre o detalhe (RN-1)", () => {
  it("a linha do prato é um `<button type=\"button\">`", () => {
    expect(CODIGO).toMatch(/<li key=\{produto\.id\}>\s*<button\s+type="button"/);
  });

  it("o clique registra o pendente e passa pelo MESMO `fechar` (trava 5/RN-3)", () => {
    expect(CODIGO).toMatch(/onClick=\{\(\) => escolher\(produto\)\}/);
    const escolher = /const escolher = \([\s\S]*?\n  \};/.exec(CODIGO);
    expect(escolher).not.toBeNull();
    expect(escolher?.[0]).toContain("setPendente(produto)");
    expect(escolher?.[0]).toContain("fechar()");
    // Continua havendo UM só caminho de fechamento no arquivo inteiro.
    expect(CODIGO.match(/setAberto\(false\)/g)).toHaveLength(1);
  });

  it("a abertura do detalhe é sequenciada no `onOpenChangeComplete(false)` (RN-5)", () => {
    const bloco = /onOpenChangeComplete=\{\(open\) => \{([\s\S]*?)\n      \}\}/.exec(
      CODIGO,
    );
    expect(bloco).not.toBeNull();
    // Sai cedo enquanto ABRINDO e quando não há prato pendente.
    expect(bloco?.[1]).toContain("if (open || !pendente) return;");
    expect(bloco?.[1]).toContain('abrirProdutoEmFoco(pendente, "promocoes")');
    // E é o ÚNICO lugar do arquivo que põe produto em foco.
    expect(CODIGO.match(/abrirProdutoEmFoco\(/g)).toHaveLength(1);
  });

  it("com prato pendente o modal NÃO move o foco (`false` = do nothing, RN-6)", () => {
    expect(CODIGO).toContain("finalFocus={pendente ? false : destinoFoco}");
  });

  it("não monta payload de carrinho: `temDesconto` não é escrito aqui (RN-4)", () => {
    // O único montador é `confirmarAdicao`, em `SecaoCatalogo` — é ele que
    // alimenta `promocaoExibida` no pedido (238/RN-12-a).
    expect(CODIGO).not.toMatch(/temDesconto:\s*true|adicionar\(/);
    // E existe UMA instância de `ProdutoModal` na vitrine (em `SecaoCatalogo`);
    // aqui o módulo entra SÓ como tipo — apagado na compilação, nunca montado.
    // `ProdutoModal\b` não casa `ProdutoModalDados`: a única ocorrência é o
    // caminho do `import type`.
    expect(CODIGO.match(/ProdutoModal\b/g) ?? []).toHaveLength(1);
    expect(CODIGO).toMatch(/^import type \{[^}]*\} from "[^"]*ProdutoModal";$/m);
  });

  it("alvo de toque do prato em valor LITERAL ≥44px (RN-10)", () => {
    const botaoPrato = /<button\s+type="button"\s+onClick=\{\(\) => escolher\(produto\)\}[\s\S]*?>/.exec(
      CODIGO,
    );
    expect(botaoPrato).not.toBeNull();
    expect(botaoPrato?.[0]).toContain("min-h-[44px]");
    expect(botaoPrato?.[0]).not.toMatch(/min-h-11/);
    expect(botaoPrato?.[0]).toContain("focus-visible:outline-3");
  });

  it("o rótulo acessível traz o preço PROMOCIONAL, não o cheio (233/RN-10)", () => {
    expect(CODIGO).toMatch(
      /aria-label=\{`Ver detalhes de \$\{produto\.nome\}, \$\{rotuloPrecoAcessivel\(produto\)\}`\}/,
    );
  });

  it('a linha "e mais N pratos em promoção" continua NÃO interativa', () => {
    const resumo = /restantes > 0 \? \(([\s\S]*?)\) : null/.exec(CODIGO);
    expect(resumo).not.toBeNull();
    expect(resumo?.[1]).not.toMatch(/<button|onClick|role=/);
  });

  it("os dois CTAs do rodapé continuam lá, no mesmo `fechar` (trava 5)", () => {
    expect(CODIGO).toContain("Ver promoções");
    expect(CODIGO).toContain("Continuar vendo o cardápio");
    expect(CODIGO.match(/onClick=\{fechar\}/g)).toHaveLength(3); // ✕ + 2 CTAs
  });

  it("o novo alvo NÃO trouxe handler de gesto bruto (RN-11)", () => {
    expect(CODIGO).not.toMatch(/pointerdown|touchstart|mousedown/i);
  });
});
