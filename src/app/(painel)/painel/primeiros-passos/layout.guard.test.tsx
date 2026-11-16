import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";

/**
 * Fase RED (issue 368, crítica) — guard do assistente de primeiros passos
 * `src/app/(painel)/painel/primeiros-passos/layout.tsx` + `guard.ts`
 * (`exigirAssistente`).
 *
 * Contrato (plano técnico, "Nomes fixos"):
 *   - leitura única: createClient → getUser → buscarLojaDoDono →
 *     carregarProntidaoPublicacao; qualquer erro, user null ou loja null →
 *     redirect("/login?erro=sessao") (redirect fora do try);
 *   - decidirPrimeirosPassos(loja) === "concluido" → redirect("/painel");
 *   - NÃO aplica decidirAssinatura (D5): loja bloqueada nunca publicada entra.
 *
 * Padrão de `bloqueavel-layout.guard.test.tsx`: chama o default export async sem
 * renderizar; `redirect` mockado LANÇA NEXT_REDIRECT. `decidirPrimeirosPassos`
 * é real (fiação). Só o I/O é mockado. Import dinâmico: rejeita enquanto o
 * layout não existir (RED por ausência do alvo).
 */

const NEXT_REDIRECT = "NEXT_REDIRECT";
const redirect = vi.fn((_destino: string) => {
  throw new Error(NEXT_REDIRECT);
});
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => redirect(destino),
  usePathname: () => "/painel/primeiros-passos/perfil",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const userConfirmado = { id: "user-uuid", email: "dono@teste.local", email_confirmed_at: "2026-01-02T00:00:00Z" };
const getUser = vi.fn(async () => ({ data: { user: userConfirmado as unknown } }));
const supabaseFake = { auth: { getUser: () => getUser() } };
const createClient = vi.fn(async () => supabaseFake as unknown);
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

const buscarLojaDoDono = vi.fn(async (_c: unknown) => null as unknown);
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (c: unknown) => buscarLojaDoDono(c),
}));

const carregarProntidaoPublicacao = vi.fn(async (_c: unknown, loja: Record<string, unknown>) => ({
  ...loja,
  produtosDisponiveis: 0,
  formasPagamento: 0,
}));
vi.mock("@/lib/supabase/queries/publicacao", () => ({
  carregarProntidaoPublicacao: (c: unknown, l: Record<string, unknown>) => carregarProntidaoPublicacao(c, l),
}));

// UI do assistente: irrelevante para o guard.
vi.mock("./ProgressoAssistente", () => ({ ProgressoAssistente: () => null, default: () => null }));
vi.mock("./NavegacaoEtapas", () => ({ NavegacaoEtapas: () => null, default: () => null }));

function fazerLoja(extra: Record<string, unknown> = {}): LojaCompleta {
  return {
    id: "loja-368",
    nome: "Loja Nova",
    whatsapp: null,
    logo_url: null,
    assinatura_status: "ativa",
    assinatura_fim_periodo: null,
    primeira_publicacao_em: null,
    endereco_cep: null,
    endereco_rua: null,
    endereco_numero: null,
    endereco_bairro: null,
    endereco_cidade: null,
    endereco_estado: null,
    latitude: null,
    longitude: null,
    ...extra,
  } as unknown as LojaCompleta;
}

const CHILDREN = { __tag: "children-sentinela" } as unknown as ReactNode;

async function importarLayout(): Promise<(props: { children: ReactNode }) => Promise<unknown>> {
  const mod = (await import("./layout")) as { default: (props: { children: ReactNode }) => Promise<unknown> };
  return mod.default;
}

function contemSentinela(no: unknown): boolean {
  if (no === CHILDREN) return true;
  if (Array.isArray(no)) return no.some(contemSentinela);
  if (no == null || typeof no !== "object") return false;
  const props = (no as { props?: { children?: unknown } }).props;
  return props ? contemSentinela(props.children) : false;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  getUser.mockResolvedValue({ data: { user: userConfirmado } });
  createClient.mockResolvedValue(supabaseFake as unknown);
  buscarLojaDoDono.mockResolvedValue(fazerLoja());
});

describe("primeiros-passos/layout — guard do assistente (issue 368, RED)", () => {
  it("marcador nulo → renderiza children, sem redirect", async () => {
    const Layout = await importarLayout();
    const out = await Layout({ children: CHILDREN });
    expect(redirect).not.toHaveBeenCalled();
    expect(contemSentinela(out)).toBe(true);
    expect(carregarProntidaoPublicacao).toHaveBeenCalledWith(supabaseFake, expect.objectContaining({ id: "loja-368" }));
  });

  it("marcador preenchido → redirect('/painel') e REJEITA", async () => {
    buscarLojaDoDono.mockResolvedValue(fazerLoja({ primeira_publicacao_em: "2026-01-01T00:00:00Z" }));
    const Layout = await importarLayout();
    await expect(Layout({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/painel");
  });

  it("marcador nulo + assinatura 'suspensa' → renderiza (D5)", async () => {
    buscarLojaDoDono.mockResolvedValue(fazerLoja({ assinatura_status: "suspensa" }));
    const Layout = await importarLayout();
    const out = await Layout({ children: CHILDREN });
    expect(redirect).not.toHaveBeenCalled();
    expect(contemSentinela(out)).toBe(true);
  });

  it("getUser lança → '/login?erro=sessao'", async () => {
    getUser.mockRejectedValue(new Error("auth"));
    const Layout = await importarLayout();
    await expect(Layout({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);
    expect(redirect).toHaveBeenCalledWith("/login?erro=sessao");
  });

  it("buscarLojaDoDono lança → '/login?erro=sessao'", async () => {
    buscarLojaDoDono.mockRejectedValue(new Error("db"));
    const Layout = await importarLayout();
    await expect(Layout({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);
    expect(redirect).toHaveBeenCalledWith("/login?erro=sessao");
  });

  it("contagem de prontidão lança → '/login?erro=sessao'", async () => {
    carregarProntidaoPublicacao.mockRejectedValueOnce(new Error("count"));
    const Layout = await importarLayout();
    await expect(Layout({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);
    expect(redirect).toHaveBeenCalledWith("/login?erro=sessao");
  });

  it("loja null → '/login?erro=sessao'", async () => {
    buscarLojaDoDono.mockResolvedValue(null);
    const Layout = await importarLayout();
    await expect(Layout({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);
    expect(redirect).toHaveBeenCalledWith("/login?erro=sessao");
    expect(redirect).not.toHaveBeenCalledWith("/painel");
  });
});
