/**
 * Moldura de /minha-conta (ambiente node, sem jsdom): asserções sobre o HTML do
 * primeiro render — é ele que define "sem flash" (o padrão aberto no PC /
 * fechado no mobile vem de classes por breakpoint, não de JS pós-mount).
 * Interações (scroll suave, gaveta, destaque) ficam na verificação manual.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const nav = vi.hoisted(() => ({ pathname: "/minha-conta", query: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.query),
}));
vi.mock("@/lib/actions/cliente", () => ({ sairCliente: vi.fn(), excluirConta: vi.fn() }));

import { ShellConta } from "./ShellConta";

function render(soPerfil = false) {
  return renderToStaticMarkup(
    <ShellConta email="cliente@exemplo.test" soPerfil={soPerfil}>
      <p>conteudo</p>
    </ShellConta>,
  );
}

/** Abre a tag do elemento com o atributo dado e devolve a tag inteira. */
function tag(html: string, atributo: string): string {
  const i = html.indexOf(atributo);
  expect(i, `atributo ${atributo} ausente`).toBeGreaterThan(-1);
  const ini = html.lastIndexOf("<", i);
  return html.slice(ini, html.indexOf(">", i) + 1);
}

function kebabs(html: string): string[] {
  return [...html.matchAll(/<button[^>]*aria-controls="[^"]*"[^>]*>/g)].map((m) => m[0]);
}

beforeEach(() => {
  nav.pathname = "/minha-conta";
  nav.query = "";
});

describe("ShellConta — primeiro render (sem flash)", () => {
  it("lateral do PC: fixed na borda, largura 16rem, visível só a partir de lg", () => {
    const aside = tag(render(), 'id="lateral-conta"');
    expect(aside).toMatch(/^<aside/);
    for (const c of ["fixed", "inset-y-0", "left-0", "w-64", "hidden", "lg:flex", "bg-card", "border-r"]) {
      expect(aside).toContain(c);
    }
  });

  it("dois kebabs fixos no canto superior esquerdo, um por breakpoint, com estado inicial correto", () => {
    const [pc, mobile] = kebabs(render());
    expect(pc).toContain('aria-controls="lateral-conta"');
    expect(pc).toContain('aria-expanded="true"');
    expect(pc).toContain('aria-label="Fechar menu da conta"');
    expect(pc).toMatch(/hidden[^"]*lg:inline-flex/);

    expect(mobile).toContain('aria-controls="gaveta-conta"');
    expect(mobile).toContain('aria-expanded="false"');
    expect(mobile).toContain('aria-label="Abrir menu da conta"');
    expect(mobile).toContain("lg:hidden");

    for (const k of [pc, mobile]) {
      expect(k).toContain("fixed");
      expect(k).toContain("top-3");
      expect(k).toContain("left-3");
      expect(k).toContain("size-11");
    }
  });

  it("gaveta mobile fechada não é renderizada", () => {
    expect(render()).not.toContain('id="gaveta-conta"');
  });

  it("conteúdo é container e recebe recuo da lateral + 2.5rem no PC", () => {
    const main = tag(render(), 'id="conteudo-conta"');
    expect(main).toContain("@container");
    expect(main).toContain("lg:pl-[calc(16rem+2.5rem)]");
    expect(main).toContain("max-w-[82rem]");
    expect(main).toContain("transition-[padding]");
    expect(render()).toContain("<p>conteudo</p>");
  });
});

describe("ShellConta — conteúdo da lateral", () => {
  it("marca, e-mail, três seções na ordem, Sair e Excluir conta no rodapé", () => {
    const html = render();
    const aside = html.slice(html.indexOf('id="lateral-conta"'), html.indexOf("</aside>"));
    const ordem = ["iRango", "cliente@exemplo.test", "Dados pessoais", "Endereços", "Pedidos", "Sair", "Excluir conta"];
    const posicoes = ordem.map((t) => aside.indexOf(t));
    expect(posicoes.every((p) => p > -1)).toBe(true);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
    expect(aside).toContain("mt-auto");
  });

  it("links apontam para as âncoras da página única", () => {
    const html = render();
    expect(html).toContain('href="/minha-conta#dados-pessoais"');
    expect(html).toContain('href="/minha-conta#enderecos"');
    expect(html).toContain('href="/minha-conta#pedidos"');
  });

  it("preserva o next sanitizado nos links", () => {
    nav.query = "next=%2Floja%2Fpadaria";
    expect(render()).toContain('href="/minha-conta?next=%2Floja%2Fpadaria#pedidos"');
  });

  it("next externo é descartado (anti open-redirect)", () => {
    nav.query = "next=%2F%2Fmal.example";
    const html = render();
    expect(html).not.toContain("mal.example");
    expect(html).toContain('href="/minha-conta#pedidos"');
  });

  it("página única: primeira seção destacada no primeiro render", () => {
    expect(tag(render(), 'href="/minha-conta#dados-pessoais"')).toContain('aria-current="true"');
    expect(tag(render(), 'href="/minha-conta#pedidos"')).not.toContain("aria-current");
  });

  it("página dedicada destaca a seção equivalente", () => {
    nav.pathname = "/minha-conta/pedidos";
    const html = render();
    expect(tag(html, 'href="/minha-conta#pedidos"')).toContain('aria-current="true"');
    expect(tag(html, 'href="/minha-conta#dados-pessoais"')).not.toContain("aria-current");
  });

  it("frase sob Excluir conta varia por papel", () => {
    expect(render(false)).toContain("Seus dados e endereços serão apagados. Isso não pode ser desfeito.");
    expect(render(true)).toContain("Sua conta e o acesso ao painel continuam.");
  });
});
