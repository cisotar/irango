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

// `ui/sheet` (Base UI Dialog) só monta o conteúdo do Sheet quando `open` é
// true, e o `aberto` de `TopbarPainel` nasce `useState(false)` — sem jsdom não
// há como clicar no gatilho para abrir. Stub passthrough (mesmo padrão de
// admin/page.test.tsx para `ui/card`): NÃO mocka lógica de NavPainel, só o
// wrapper de terceiro que esconderia o conteúdo do `<nav>` mobile do teste.
vi.mock("@/components/ui/sheet", () => ({
  Sheet: (p: { children?: unknown }) => p.children,
  SheetTrigger: () => null,
  SheetContent: (p: { children?: unknown }) => p.children,
  SheetHeader: (p: { children?: unknown }) => p.children,
  SheetTitle: (p: { children?: unknown }) => p.children,
}));

import { SidebarPainel, TopbarPainel, type ContextoNav } from "./NavPainel";

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

/** Mesma coisa, mas para a topbar mobile (Sheet stubado sempre "aberto"). */
function renderMobile(pathname: string, contexto?: ContextoNav): string {
  pathnameMock.mockReturnValue(pathname);
  return renderToStaticMarkup(<TopbarPainel contexto={contexto} />);
}

/** Tag de abertura do `<button data-slot="accordion-trigger">` de Configurações. */
function triggerConfiguracoes(html: string): string | undefined {
  return html.match(/<button[^>]*data-slot="accordion-trigger"[^>]*>/)?.[0];
}

function grupoConfiguracoesAberto(html: string): boolean {
  return triggerConfiguracoes(html)?.includes('aria-expanded="true"') ?? false;
}

const SUBITENS_CONFIGURACOES = [
  "/painel/configuracoes/perfil",
  "/painel/configuracoes/horarios",
  "/painel/configuracoes/entregas",
  "/painel/configuracoes/pagamentos",
  "/painel/configuracoes/tema",
  "/painel/configuracoes/assinatura",
];

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
    // Issue 194/F3: "Configurações" deixou de ser <Link> e virou gatilho de
    // sanfona (<button>) — a rota pai não tem `page.tsx` e dava 404. `links()`
    // só lê <a>, então o href do pai não pode mais aparecer.
    expect(hrefs).not.toContain("/painel/configuracoes");
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

/**
 * `rotasAusentes` — o item existe no menu do lojista e é OMITIDO sob uma base
 * que não tem a rota. Sem isso, "Cardápios" apareceria no hub admin apontando
 * para `/admin/assinantes/[lojaId]/cardapios`, que não tem `page.tsx`: link
 * nascido 404, o mesmo defeito de `/painel/configuracoes` (issue 194/F3).
 */
describe("NavPainel — rotasAusentes", () => {
  it("o lojista vê Cardápios no menu", () => {
    const html = render("/painel");
    expect(links(html).map((l) => l.href)).toContain("/painel/cardapios");
    expect(html).toContain("Cardápios");
  });

  it("acende Cardápios na própria rota e em sub-rota /painel/cardapios/[id]", () => {
    const naRaiz = links(render("/painel/cardapios")).find(
      (l) => l.href === "/painel/cardapios",
    );
    expect(naRaiz?.ativo).toBe(true);

    const emSub = links(render("/painel/cardapios/abc-123")).find(
      (l) => l.href === "/painel/cardapios",
    );
    expect(emSub?.ativo).toBe(true);
  });

  it("some sob a base admin, que não tem a rota", () => {
    const ctx: ContextoNav = {
      basePath: "/admin/assinantes/L1",
      rotasAusentes: ["cardapios"],
    };
    const hrefs = links(render("/admin/assinantes/L1", ctx)).map((l) => l.href);

    expect(hrefs).not.toContain("/admin/assinantes/L1/cardapios");
    // E some SÓ ele: o resto do menu continua inteiro.
    expect(hrefs).toContain("/admin/assinantes/L1/pedidos");
    expect(hrefs).toContain("/admin/assinantes/L1/produtos");
    expect(hrefs).toContain("/admin/assinantes/L1/cupons");
  });

  it("vale também no mobile (Sheet), que lê a MESMA ListaNav", () => {
    const ctx: ContextoNav = {
      basePath: "/admin/assinantes/L1",
      rotasAusentes: ["cardapios"],
    };
    expect(renderMobile("/admin/assinantes/L1", ctx)).not.toContain(
      "/admin/assinantes/L1/cardapios",
    );
    expect(renderMobile("/painel")).toContain("/painel/cardapios");
  });
});

describe("NavPainel — contexto admin", () => {
  const ctxAdmin: ContextoNav = { basePath: "/admin/assinantes/L1" };

  it("reescreve todos os hrefs para a base admin", () => {
    const hrefs = links(render("/admin/assinantes/L1", ctxAdmin)).map(
      (l) => l.href,
    );

    expect(hrefs).toContain("/admin/assinantes/L1");
    expect(hrefs).toContain("/admin/assinantes/L1/pedidos");
    expect(hrefs).toContain("/admin/assinantes/L1/produtos");
    expect(hrefs).toContain("/admin/assinantes/L1/produtos/opcionais");
    expect(hrefs).toContain("/admin/assinantes/L1/cupons");
    // Issue 194/F3: o pai "Configurações" é <button>, não <a> — ver o teste
    // equivalente do lojista.
    expect(hrefs).not.toContain("/admin/assinantes/L1/configuracoes");
    // Nenhum href pode apontar para /painel.
    expect(hrefs.every((h) => h.startsWith("/admin/assinantes/L1"))).toBe(true);
  });

  it("renderiza os 6 sub-itens de Configurações sob a base admin, incluindo Assinatura", () => {
    const hrefs = links(render("/admin/assinantes/L1", ctxAdmin)).map(
      (l) => l.href,
    );

    expect(hrefs).toContain("/admin/assinantes/L1/configuracoes/perfil");
    expect(hrefs).toContain("/admin/assinantes/L1/configuracoes/horarios");
    expect(hrefs).toContain("/admin/assinantes/L1/configuracoes/entregas");
    expect(hrefs).toContain("/admin/assinantes/L1/configuracoes/pagamentos");
    expect(hrefs).toContain("/admin/assinantes/L1/configuracoes/tema");
    expect(hrefs).toContain("/admin/assinantes/L1/configuracoes/assinatura");
    // Exatamente 6 sub-itens sob configuracoes/ — paridade com o lojista.
    expect(
      hrefs.filter((h) => h.startsWith("/admin/assinantes/L1/configuracoes/"))
        .length,
    ).toBe(6);
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

// Issue 194 — cobertura que o `executar` deixou pendente ao ajustar só o
// mínimo para reverdecer a suíte após trocar o pai de Configurações de <Link>
// para AccordionTrigger. Ver mockups/sidebar-painel.md (contrato §1 F3-F10).

describe("NavPainel — F3: gatilho de Configurações é <button>, não <a>", () => {
  it("o pai 'Configurações' é um <button data-slot='accordion-trigger'>, prova direta de que o 404 morreu", () => {
    const html = render("/painel");
    // Prova POSITIVA (não só ausência em `links()`): existe um <button> real
    // envolvendo o texto "Configurações" — é o que resolve o 404 de
    // `/painel/configuracoes` (rota sem page.tsx), porque deixa de navegar.
    expect(html).toMatch(
      /<button[^>]*data-slot="accordion-trigger"[^>]*>[\s\S]*?Configurações[\s\S]*?<\/button>/,
    );
  });

  it("o mesmo vale no contexto admin, sobre a base /admin/assinantes/L1", () => {
    const html = render("/admin/assinantes/L1", {
      basePath: "/admin/assinantes/L1",
    });
    expect(html).toMatch(
      /<button[^>]*data-slot="accordion-trigger"[^>]*>[\s\S]*?Configurações[\s\S]*?<\/button>/,
    );
  });
});

describe("NavPainel — F3: o grupo Configurações abre sozinho pela rota ativa", () => {
  it.each(SUBITENS_CONFIGURACOES)(
    "abre (aria-expanded=true) quando a rota ativa é %s",
    (pathname) => {
      const html = render(pathname);
      expect(grupoConfiguracoesAberto(html)).toBe(true);
    },
  );

  it.each(["/painel", "/painel/pedidos", "/painel/produtos", "/painel/cupons"])(
    "fica fechado (aria-expanded=false) quando a rota ativa é %s",
    (pathname) => {
      const html = render(pathname);
      expect(grupoConfiguracoesAberto(html)).toBe(false);
    },
  );

  it("abre também no contexto admin quando a rota ativa é um subitem", () => {
    const ctx: ContextoNav = { basePath: "/admin/assinantes/L1" };
    const aberto = render("/admin/assinantes/L1/configuracoes/tema", ctx);
    const fechado = render("/admin/assinantes/L1/pedidos", ctx);
    expect(grupoConfiguracoesAberto(aberto)).toBe(true);
    expect(grupoConfiguracoesAberto(fechado)).toBe(false);
  });
});

describe("NavPainel — rodapé: voltarHref/voltarRotulo (botão 'voltar ao hub admin')", () => {
  it("contexto default (lojista, sem voltarHref) não renderiza nenhum link de volta", () => {
    const html = render("/painel");
    // ArrowLeft só é usado pelo link de volta — ausência da classe do ícone
    // prova que nada renderizou, não só que o texto de um rótulo específico
    // está ausente.
    expect(html).not.toContain("lucide-arrow-left");
  });

  it("com voltarHref + voltarRotulo, renderiza o link com href e rótulo passados", () => {
    const html = render("/painel", {
      voltarHref: "/admin",
      voltarRotulo: "Voltar ao hub admin",
    });
    expect(html).toMatch(
      /<a[^>]*href="\/admin"[^>]*>[\s\S]*?lucide-arrow-left[\s\S]*?Voltar ao hub admin<\/a>/,
    );
  });

  it("com voltarHref sem voltarRotulo, cai no rótulo default 'Voltar'", () => {
    const html = render("/painel", { voltarHref: "/admin" });
    expect(html).toMatch(/<a[^>]*href="\/admin"[^>]*>[\s\S]*?>Voltar<\/a>/);
  });
});

describe("NavPainel — F8: aria-label='Menu do painel' nos dois <nav>", () => {
  it("desktop (SidebarPainel) tem o aria-label", () => {
    const html = render("/painel");
    expect(html).toContain('<nav aria-label="Menu do painel"');
  });

  it("mobile (TopbarPainel/Sheet) tem o aria-label", () => {
    const html = renderMobile("/painel");
    expect(html).toContain('<nav aria-label="Menu do painel"');
  });
});

describe("NavPainel — F3/F4: ícone em cada um dos 6 subitens de Configurações", () => {
  it.each(SUBITENS_CONFIGURACOES)(
    "subitem %s tem <svg> logo após o link — não é só texto",
    (href) => {
      const html = render(href);
      const escapado = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(html).toMatch(new RegExp(`<a[^>]*href="${escapado}"[^>]*>\\s*<svg`));
    },
  );
});

describe("NavPainel — 6 subitens de Configurações em ambos os contextos", () => {
  it("exatamente 6 sub-itens sob configuracoes/ no contexto default (lojista)", () => {
    const hrefs = links(render("/painel")).map((l) => l.href);
    expect(
      hrefs.filter((h) => h.startsWith("/painel/configuracoes/")).length,
    ).toBe(6);
  });

  it("exatamente 6 sub-itens sob configuracoes/ no contexto admin (basePath diferente)", () => {
    const ctx: ContextoNav = { basePath: "/admin/assinantes/L1" };
    const hrefs = links(render("/admin/assinantes/L1", ctx)).map(
      (l) => l.href,
    );
    expect(
      hrefs.filter((h) => h.startsWith("/admin/assinantes/L1/configuracoes/"))
        .length,
    ).toBe(6);
  });
});
