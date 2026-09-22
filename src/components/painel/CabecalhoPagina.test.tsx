/**
 * `CabecalhoPagina` — o bloco único de `design-system.md` §10.2, regra 5.
 *
 * Ambiente sem jsdom: `renderToStaticMarkup`, o mesmo padrão de
 * `CardapiosClient.test.tsx`. O que se observa aqui é o markup: o destino do
 * voltar, o título como `h1` e o slot de ações na mesma linha do título.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { CabecalhoPagina } from "./CabecalhoPagina";

describe("CabecalhoPagina", () => {
  it("o voltar aponta para o href injetado, nunca para uma rota fixa", () => {
    const html = renderToStaticMarkup(
      <CabecalhoPagina
        voltarHref="/admin/assinantes/abc/cardapios"
        voltarRotulo="Voltar para cardápios"
        titulo="Cardápio do dia"
      />,
    );
    expect(html).toContain('href="/admin/assinantes/abc/cardapios"');
    expect(html).toContain("Voltar para cardápios");
    expect(html).not.toContain('href="/painel');
  });

  it("o título sai como h1", () => {
    const html = renderToStaticMarkup(
      <CabecalhoPagina
        voltarHref="/painel/cardapios"
        voltarRotulo="Voltar"
        titulo="Cardápio do dia"
      />,
    );
    expect(html).toMatch(/<h1[^>]*>Cardápio do dia<\/h1>/);
  });

  it("selo e ações entram no slot, junto do título", () => {
    const html = renderToStaticMarkup(
      <CabecalhoPagina
        voltarHref="/painel/cardapios"
        voltarRotulo="Voltar"
        titulo="Cardápio do dia"
      >
        <span>Aparecendo agora</span>
      </CabecalhoPagina>,
    );
    const depoisDoTitulo = html.slice(html.indexOf("</h1>"));
    expect(depoisDoTitulo).toContain("Aparecendo agora");
  });
});
