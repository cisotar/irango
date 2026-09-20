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
import type { ProdutoVitrine } from "@/lib/utils/catalogoVitrine";

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

function promo(n: number): ProdutoVitrine {
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
