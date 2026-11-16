import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";

/**
 * Fase RED (issue 332, crítica: TDD red-first) — gate de PAPEL no layout pai
 * `src/app/(painel)/painel/layout.tsx`.
 *
 * Invariante: conta sem papel "lojista" nunca dispara a auto-cura
 * (`garantirLojaDoDono`) nem renderiza o chrome do painel. O destino vem de
 * `destinoPadraoPorPapel` (admin env → "/admin"; demais → "/").
 *
 * Padrão de `bloqueavel-layout.guard.test.tsx`: chama o default export async sem
 * renderizar (environment node), `redirect` mockado LANÇA NEXT_REDIRECT.
 * `decidirAcessoBase` e `destinoPadraoPorPapel` NÃO são mockadas (fiação real).
 * Admin pela env real (`vi.stubEnv`), sem mock de `@/lib/auth/admin`.
 *
 * RED: o layout atual não lê papéis — com loja null cai em "onboarding" e chama
 * `garantirLojaDoDono`; com loja presente renderiza o chrome.
 */

const NEXT_REDIRECT = "NEXT_REDIRECT";
const redirect = vi.fn((_destino: string) => {
  throw new Error(NEXT_REDIRECT);
});
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => redirect(destino),
}));

const USER_ID = "00000000-0000-4000-8000-0000000003a1";
const userConfirmado = {
  id: USER_ID,
  email: "dono@teste.local",
  email_confirmed_at: "2026-01-02T00:00:00Z",
};
const getUser = vi.fn(async () => ({ data: { user: userConfirmado } }));
const supabaseFake = { auth: { getUser: () => getUser() } };
const createClient = vi.fn(async () => supabaseFake as unknown);
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const serviceFake = { __service: true };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceFake,
}));

const buscarLojaDoDono = vi.fn(async (_c: unknown) => null as unknown);
const garantirLojaDoDono = vi.fn(async (..._a: unknown[]) => "loja-id");
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (c: unknown) => buscarLojaDoDono(c),
  garantirLojaDoDono: (...a: unknown[]) => garantirLojaDoDono(...a),
}));

// Query nova (GREEN cria o módulo). Mock só do I/O.
const buscarPapeisDoUsuario = vi.fn(async (_c: unknown, _id: string) => [] as string[]);
vi.mock("@/lib/supabase/queries/papeis", () => ({
  buscarPapeisDoUsuario: (c: unknown, id: string) => buscarPapeisDoUsuario(c, id),
}));

// Chrome do painel: sem relevância para o gate; evita puxar componentes de UI.
// Issue 368: identidades estáveis (vi.hoisted) para achar cada peça na árvore
// devolvida pelo layout, sem renderizar.
const chrome = vi.hoisted(() => ({
  SidebarPainel: () => null,
  TopbarPainel: () => null,
  BotaoLogout: () => null,
  ChromeAssistente: (p: { children?: unknown }) => p.children ?? null,
  AvisoEnderecoLoja: () => null,
  localizarEnderecoDeNovo: async () => ({ ok: true as const }),
}));
vi.mock("@/components/painel/NavPainel", () => ({
  SidebarPainel: chrome.SidebarPainel,
  TopbarPainel: chrome.TopbarPainel,
  BotaoLogout: chrome.BotaoLogout,
}));
// Componentes e action novos da issue 368 (a fase GREEN cria os módulos).
vi.mock("@/components/painel/ChromeAssistente", () => ({
  ChromeAssistente: chrome.ChromeAssistente,
  default: chrome.ChromeAssistente,
}));
vi.mock("@/components/painel/AvisoEnderecoLoja", () => ({
  AvisoEnderecoLoja: chrome.AvisoEnderecoLoja,
  default: chrome.AvisoEnderecoLoja,
}));
vi.mock("@/lib/actions/loja", () => ({
  localizarEnderecoDeNovo: chrome.localizarEnderecoDeNovo,
}));

// Issue 368: fixture parcial nasce JÁ PUBLICADA uma vez (marcador preenchido),
// sobrescrevível pelos casos de chrome/aviso.
function fazerLoja(extra: Record<string, unknown> = {}): LojaCompleta {
  return {
    nome: "Loja Teste",
    logo_url: null,
    slug: "loja-teste",
    horarios: {},
    timezone: "America/Sao_Paulo",
    assinatura_status: "ativa",
    assinatura_fim_periodo: null,
    primeira_publicacao_em: "2026-01-01T00:00:00Z",
    ...extra,
  } as unknown as LojaCompleta;
}

const CHILDREN = { __tag: "children-sentinela" } as unknown as ReactNode;

async function importarLayout(): Promise<(props: { children: ReactNode }) => Promise<unknown>> {
  const mod = (await import("./layout")) as {
    default: (props: { children: ReactNode }) => Promise<unknown>;
  };
  return mod.default;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("SAAS_ADMIN_USER_ID", "00000000-0000-4000-8000-0000000003ff"); // ≠ USER_ID
  getUser.mockResolvedValue({ data: { user: userConfirmado } });
  createClient.mockResolvedValue(supabaseFake as unknown);
  buscarLojaDoDono.mockResolvedValue(null);
  buscarPapeisDoUsuario.mockResolvedValue([]);
  garantirLojaDoDono.mockResolvedValue("loja-id");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("painel/layout — gate de papel (issue 332, RED)", () => {
  it("[332-20] confirmado, sem loja, papeis [] → sem auto-cura, redirect '/'", async () => {
    const Layout = await importarLayout();

    await expect(Layout({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);

    expect(garantirLojaDoDono).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("[332-21] ['cliente'] com loja → não renderiza o chrome, redirect '/', sem auto-cura", async () => {
    buscarLojaDoDono.mockResolvedValue(fazerLoja());
    buscarPapeisDoUsuario.mockResolvedValue(["cliente"]);
    const Layout = await importarLayout();

    await expect(Layout({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);

    expect(redirect).toHaveBeenCalledWith("/minha-conta");
    expect(garantirLojaDoDono).not.toHaveBeenCalled();
  });

  it("[332-22] admin (env) sem 'lojista' → redirect '/admin', sem auto-cura", async () => {
    vi.stubEnv("SAAS_ADMIN_USER_ID", USER_ID);
    buscarPapeisDoUsuario.mockResolvedValue([]);
    const Layout = await importarLayout();

    await expect(Layout({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);

    expect(redirect).toHaveBeenCalledWith("/admin");
    expect(garantirLojaDoDono).not.toHaveBeenCalled();
  });

  it("[332-23] ['lojista'] sem loja → garantirLojaDoDono 1x com user.id do getUser, redirect '/painel'", async () => {
    buscarPapeisDoUsuario.mockResolvedValue(["lojista"]);
    const Layout = await importarLayout();

    await expect(Layout({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);

    expect(garantirLojaDoDono).toHaveBeenCalledTimes(1);
    expect(garantirLojaDoDono.mock.calls[0][0]).toBe(serviceFake);
    expect(garantirLojaDoDono.mock.calls[0][1]).toBe(USER_ID);
    expect(redirect).toHaveBeenCalledWith("/painel");
  });

  it("[332-24] leitura dos papéis lança → '/login?erro=sessao', sem auto-cura", async () => {
    buscarPapeisDoUsuario.mockRejectedValue(new Error("falha de leitura"));
    const Layout = await importarLayout();

    await expect(Layout({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);

    expect(redirect).toHaveBeenCalledWith("/login?erro=sessao");
    expect(garantirLojaDoDono).not.toHaveBeenCalled();
  });

  it("[332-24b] leitura dos papéis usa o user.id autoritativo do getUser", async () => {
    buscarLojaDoDono.mockResolvedValue(fazerLoja());
    buscarPapeisDoUsuario.mockResolvedValue(["lojista"]);
    const Layout = await importarLayout();

    await Layout({ children: CHILDREN });

    expect(buscarPapeisDoUsuario).toHaveBeenCalledWith(supabaseFake, USER_ID);
    expect(redirect).not.toHaveBeenCalled();
  });
});

// ── Issue 368 (RED) — chrome por estado (D4) e aviso persistente (D15) ──────────
const ENDERECO_COMPLETO = {
  endereco_cep: "01310-100",
  endereco_rua: "Avenida Paulista",
  endereco_numero: "1000",
  endereco_bairro: "Bela Vista",
  endereco_cidade: "São Paulo",
  endereco_estado: "SP",
};
const COM_PAR = { latitude: -23.56, longitude: -46.65 };
const SEM_PAR = { latitude: null, longitude: null };

type No = { type?: unknown; props?: Record<string, unknown> };

/** Todos os elementos React alcançáveis pela árvore devolvida (sem renderizar). */
function elementos(no: unknown, acc: No[] = []): No[] {
  if (Array.isArray(no)) {
    for (const n of no) elementos(n, acc);
    return acc;
  }
  if (no == null || typeof no !== "object") return acc;
  const el = no as No;
  acc.push(el);
  if (el.props) elementos(el.props.children, acc);
  return acc;
}
const doTipo = (arvore: unknown, tipo: unknown) => elementos(arvore).filter((e) => e.type === tipo);

describe("painel/layout — chrome por estado e aviso de endereço (issue 368, RED)", () => {
  beforeEach(() => {
    buscarPapeisDoUsuario.mockResolvedValue(["lojista"]);
  });

  async function renderizarCom(extra: Record<string, unknown>) {
    buscarLojaDoDono.mockResolvedValue(fazerLoja(extra));
    const Layout = await importarLayout();
    const arvore = await Layout({ children: CHILDREN });
    expect(redirect).not.toHaveBeenCalled();
    return arvore;
  }

  it("marcador nulo → ChromeAssistente, sem SidebarPainel/TopbarPainel", async () => {
    const arvore = await renderizarCom({ primeira_publicacao_em: null });
    expect(doTipo(arvore, chrome.ChromeAssistente)).toHaveLength(1);
    expect(doTipo(arvore, chrome.SidebarPainel)).toHaveLength(0);
    expect(doTipo(arvore, chrome.TopbarPainel)).toHaveLength(0);
    const [ca] = doTipo(arvore, chrome.ChromeAssistente);
    expect(ca.props?.nomeLoja).toBe("Loja Teste");
  });

  it("marcador preenchido → SidebarPainel + TopbarPainel", async () => {
    const arvore = await renderizarCom({ ...ENDERECO_COMPLETO, ...COM_PAR });
    expect(doTipo(arvore, chrome.SidebarPainel)).toHaveLength(1);
    expect(doTipo(arvore, chrome.TopbarPainel)).toHaveLength(1);
    expect(doTipo(arvore, chrome.ChromeAssistente)).toHaveLength(0);
  });

  it("publicada, endereço completo sem par → AvisoEnderecoLoja variante 'localizar-de-novo'", async () => {
    const arvore = await renderizarCom({ ...ENDERECO_COMPLETO, ...SEM_PAR });
    const avisos = doTipo(arvore, chrome.AvisoEnderecoLoja);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].props?.variante).toBe("localizar-de-novo");
    expect(avisos[0].props?.onLocalizar).toBe(chrome.localizarEnderecoDeNovo);
  });

  it("publicada, endereço incompleto → variante 'completar-endereco'", async () => {
    const arvore = await renderizarCom({ ...ENDERECO_COMPLETO, endereco_numero: null, ...COM_PAR });
    const avisos = doTipo(arvore, chrome.AvisoEnderecoLoja);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].props?.variante).toBe("completar-endereco");
    expect(avisos[0].props?.hrefPerfil).toBe("/painel/configuracoes/perfil");
  });

  it("publicada completa com par → sem aviso", async () => {
    const arvore = await renderizarCom({ ...ENDERECO_COMPLETO, ...COM_PAR });
    expect(doTipo(arvore, chrome.AvisoEnderecoLoja)).toHaveLength(0);
  });

  it("marcador nulo e sem endereço → sem aviso", async () => {
    const arvore = await renderizarCom({ primeira_publicacao_em: null, ...SEM_PAR });
    expect(doTipo(arvore, chrome.AvisoEnderecoLoja)).toHaveLength(0);
  });

  it("AvisoEnderecoLoja não recebe latitude nem longitude", async () => {
    const arvore = await renderizarCom({ ...ENDERECO_COMPLETO, latitude: -23.56, longitude: null });
    const avisos = doTipo(arvore, chrome.AvisoEnderecoLoja);
    expect(avisos).toHaveLength(1);
    const props = JSON.stringify(Object.keys(avisos[0].props ?? {}));
    expect(props).not.toMatch(/latitude|longitude|-23\.56/);
    expect(JSON.stringify(avisos[0].props ?? {})).not.toContain("-23.56");
  });
});
