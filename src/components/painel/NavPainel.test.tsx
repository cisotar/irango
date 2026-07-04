/**
 * Testes de render do shell de navegação (issue 145 — parametrização por
 * `ContextoNav`). Guarda de regressão do critério central: "NavPainel sem
 * contexto mantém o painel do lojista idêntico".
 *
 * Ambiente: vitest environment=node — sem jsdom. Estratégia:
 * renderToStaticMarkup (react-dom/server), mesmo padrão do projeto
 * (AcoesStatus.test.tsx, OpcionaisClient.test.tsx). Aqui a resolução do
 * contexto acontece no CORPO do componente (construirItens/estaAtivo), então é
 * totalmente observável no HTML estático — não há limitação de evento DOM.
 *
 * `usePathname` é mockado por teste (App Router não montado sob SSR estático);
 * `useRouter` idem, só para o BotaoLogout renderizar.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const pathnameMock = vi.fn<() => string>();

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { SidebarPainel, type ContextoNav } from "./NavPainel";

/** Extrai (href, aria-current presente?) de cada <a> do HTML renderizado. */
function links(html: string): { href: string; ativo: boolean }[] {
  // `<a\s` evita casar `<aside>` (o wrapper da sidebar começa com "a").
  const anchors = html.match(/<a\s[^>]*>/g) ?? [];
  return anchors.map((a) => ({
    href: a.match(/href="([^"]*)"/)?.[1] ?? "",
    ativo: a.includes('aria-current="page"'),
  }));
}

function render(pathname: string, contexto?: ContextoNav): string {
  pathnameMock.mockReturnValue(pathname);
  return renderToStaticMarkup(<SidebarPainel contexto={contexto} />);
}

beforeEach(() => {
  pathnameMock.mockReset();
});

describe("NavPainel — default (lojista, sem contexto)", () => {
  it("renderiza os 6 itens com hrefs /painel/* e Assinatura presente", () => {
    const hrefs = links(render("/painel")).map((l) => l.href);

    expect(hrefs).toContain("/painel");
    expect(hrefs).toContain("/painel/pedidos");
    expect(hrefs).toContain("/painel/produtos");
    expect(hrefs).toContain("/painel/produtos/opcionais");
    expect(hrefs).toContain("/painel/cupons");
    expect(hrefs).toContain("/painel/configuracoes");
    // Subitens de configurações do lojista, incluindo Assinatura.
    expect(hrefs).toContain("/painel/configuracoes/assinatura");
    expect(hrefs).toContain("/painel/configuracoes/tema");
  });

  it("ativa Dashboard só em match exato de /painel", () => {
    const dash = links(render("/painel")).find((l) => l.href === "/painel");
    expect(dash?.ativo).toBe(true);

    // Numa sub-rota, /painel (raiz) NÃO fica ativo.
    const dashEmSub = links(render("/painel/pedidos")).find(
      (l) => l.href === "/painel",
    );
    expect(dashEmSub?.ativo).toBe(false);
  });

  it("ativa Pedidos por prefixo em sub-rota /painel/pedidos/[id]", () => {
    const pedidos = links(render("/painel/pedidos/abc-123")).find(
      (l) => l.href === "/painel/pedidos",
    );
    expect(pedidos?.ativo).toBe(true);
  });

  // BUG REAL ENCONTRADO (issue 145 — não corrigido aqui: fora do escopo
  // permitido, que é só este arquivo de teste). Em ListaNav (NavPainel.tsx),
  // `ativo={item.subitens ? false : ativo}` força qualquer item com subitens
  // a NUNCA acender — mesmo em match exato da própria página. Resultado:
  // visitar /painel/produtos (a listagem, não um subitem) não acende NENHUM
  // item do menu. Teste fica RED de propósito até a produção ser corrigida
  // (trocar por `estaAtivo(pathname, item.href, raiz) && !algumSubitemAtivo`
  // ou equivalente).
  it("ativa Produtos (pai com subitens) em match exato da própria página /painel/produtos", () => {
    // /painel/produtos é a própria página de listagem (rota real, não um
    // subitem) — precisa acender como qualquer outro item de match exato.
    const resultado = links(render("/painel/produtos"));
    const produtos = resultado.find((l) => l.href === "/painel/produtos");
    const opcionais = resultado.find(
      (l) => l.href === "/painel/produtos/opcionais",
    );
    expect(produtos?.ativo).toBe(true);
    expect(opcionais?.ativo).toBe(false);
  });

  it("em /painel/produtos/opcionais acende só Opcionais, não o pai Produtos", () => {
    const resultado = links(render("/painel/produtos/opcionais"));
    const produtos = resultado.find((l) => l.href === "/painel/produtos");
    const opcionais = resultado.find(
      (l) => l.href === "/painel/produtos/opcionais",
    );
    expect(opcionais?.ativo).toBe(true);
    expect(produtos?.ativo).toBe(false);
  });
});

describe("NavPainel — contexto admin", () => {
  const ctxAdmin: ContextoNav = {
    basePath: "/admin/assinantes/L1",
    ocultarAssinatura: true,
    configConsolidada: true,
  };

  it("reescreve todos os hrefs para a base admin", () => {
    const hrefs = links(render("/admin/assinantes/L1", ctxAdmin)).map(
      (l) => l.href,
    );

    expect(hrefs).toContain("/admin/assinantes/L1");
    expect(hrefs).toContain("/admin/assinantes/L1/pedidos");
    expect(hrefs).toContain("/admin/assinantes/L1/produtos");
    expect(hrefs).toContain("/admin/assinantes/L1/produtos/opcionais");
    expect(hrefs).toContain("/admin/assinantes/L1/cupons");
    expect(hrefs).toContain("/admin/assinantes/L1/configuracoes");
    // Nenhum href pode apontar para /painel.
    expect(hrefs.every((h) => h.startsWith("/admin/assinantes/L1"))).toBe(true);
  });

  it("omite Assinatura e consolida Configurações (sem subitens)", () => {
    const hrefs = links(render("/admin/assinantes/L1", ctxAdmin)).map(
      (l) => l.href,
    );

    expect(hrefs).not.toContain("/admin/assinantes/L1/configuracoes/assinatura");
    // configConsolidada: nenhum subitem de configurações.
    expect(
      hrefs.some((h) => h.startsWith("/admin/assinantes/L1/configuracoes/")),
    ).toBe(false);
    // Opcionais continua presente nos dois contextos.
    expect(hrefs).toContain("/admin/assinantes/L1/produtos/opcionais");
  });

  it("ativa o item correto sobre a base admin", () => {
    // Dashboard ativo só em match exato da base.
    const dash = links(render("/admin/assinantes/L1", ctxAdmin)).find(
      (l) => l.href === "/admin/assinantes/L1",
    );
    expect(dash?.ativo).toBe(true);

    // Sub-rota de pedidos ativa Pedidos por prefixo, sem ativar a raiz.
    const emPedido = links(
      render("/admin/assinantes/L1/pedidos/xyz", ctxAdmin),
    );
    expect(
      emPedido.find((l) => l.href === "/admin/assinantes/L1/pedidos")?.ativo,
    ).toBe(true);
    expect(
      emPedido.find((l) => l.href === "/admin/assinantes/L1")?.ativo,
    ).toBe(false);
  });
});
