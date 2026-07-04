import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

/**
 * Fase RED (issue 149, crítica: TDD red-first) — hub `/admin`.
 *
 * Prova o GATE FAIL-CLOSED e a fiação dos cards do Server Component
 * `src/app/admin/page.tsx` (que ainda NÃO existe → import quebra o RED legítimo).
 *
 * O gate é 100% servidor (`seguranca.md` §7, RN-13): a page só pode montar os
 * cards DEPOIS que `verificarAdminSaaS()` provar a identidade do dono do SaaS.
 * Qualquer falha (não-admin, sessão inválida, env `SAAS_ADMIN_USER_ID` ausente)
 * → `redirect("/painel")`, sem vazar nada de admin.
 *
 * Padrão de teste espelha `assinantes/[lojaId]/pedidos/[id]/page.test.tsx`
 * (invoca o default export async e inspeciona o elemento retornado, ambiente
 * `node` sem jsdom) e o mock de guard/navigation de `isolamento-admin.test.ts`.
 */

// ── Guard de identidade (o ÚNICO gate). Default: admin aprovado. ──────────────
const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
}));

// ── redirect() LANÇA a sentinela NEXT_REDIRECT (comportamento real do Next). ──
// Se a page engolisse o NEXT_REDIRECT num catch largo, o teste (b)/(c) falharia:
// esperamos que a chamada da page REJEITE, provando que o redirect propagou.
const NEXT_REDIRECT = "NEXT_REDIRECT";
const redirect = vi.fn((_destino: string) => {
  throw new Error(NEXT_REDIRECT);
});
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => redirect(destino),
}));

// ── next/link mockado com type identificável para o walker de href. ──────────
type LinkProps = { href: string; children?: unknown };
const LinkMock = (props: LinkProps) => props.children;
vi.mock("next/link", () => ({ default: (props: LinkProps) => LinkMock(props) }));

// ── shadcn card + lucide: passthrough (não editar components/ui à mão). ──────
vi.mock("@/components/ui/card", () => ({
  Card: (p: { children?: unknown }) => p.children,
  CardHeader: (p: { children?: unknown }) => p.children,
  CardTitle: (p: { children?: unknown }) => p.children,
  CardDescription: (p: { children?: unknown }) => p.children,
  CardContent: (p: { children?: unknown }) => p.children,
}));
vi.mock("lucide-react", () => ({
  Store: () => null,
  Users: () => null,
}));

// Import APÓS os vi.mock(). A page ainda não existe → RED por import inexistente.
import AdminHubPage from "./page";

/**
 * Coleta recursivamente os `href` de todos os elementos cujo type é o LinkMock,
 * varrendo a árvore de elementos React retornada pela page (sem renderizar).
 */
function coletarHrefs(no: unknown, acc: string[] = []): string[] {
  if (no == null || typeof no !== "object") return acc;
  if (Array.isArray(no)) {
    for (const filho of no) coletarHrefs(filho, acc);
    return acc;
  }
  const el = no as ReactElement & { type?: unknown; props?: Record<string, unknown> };
  if (el.props) {
    const props = el.props as { href?: unknown; children?: unknown };
    // LinkMock devolve seus children (não é element com type próprio); por isso
    // identificamos o Link pela presença de `href` string em qualquer elemento.
    if (typeof props.href === "string") acc.push(props.href);
    if ("children" in props) coletarHrefs(props.children, acc);
  }
  return acc;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  verificarAdminSaaS.mockResolvedValue(undefined);
});

describe("hub /admin — gate fail-closed + fiação dos cards (RED)", () => {
  it("(1) admin aprovado → page renderiza, NÃO redireciona, e liga os dois cards", async () => {
    const elemento = await AdminHubPage();

    // Gate passou: nenhum redirect.
    expect(redirect).not.toHaveBeenCalled();

    // Cards ligados: /painel (Minha loja) e /admin/assinantes (Clientes).
    const hrefs = coletarHrefs(elemento);
    expect(hrefs).toContain("/painel");
    expect(hrefs).toContain("/admin/assinantes");
  });

  it("(2) não-admin (verificarAdminSaaS lança) → redirect('/painel'), nenhum card renderizado", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));

    // A page deve REJEITAR (o NEXT_REDIRECT propaga; não é engolido).
    await expect(AdminHubPage()).rejects.toThrow(NEXT_REDIRECT);

    // Fail-closed: redirect para /painel, e só para lá.
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/painel");
  });

  it("(3) env ausente (verificarAdminSaaS lança) → mesmo redirect fail-closed p/ /painel", async () => {
    // SAAS_ADMIN_USER_ID ausente faz verificarAdminSaaS lançar (fail-closed D-5).
    verificarAdminSaaS.mockRejectedValueOnce(
      new Error("SAAS_ADMIN_USER_ID não configurado → acesso negado"),
    );

    await expect(AdminHubPage()).rejects.toThrow(NEXT_REDIRECT);
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/painel");
  });

  it("(4) o NEXT_REDIRECT NÃO é engolido: a rejeição da page é a sentinela do redirect", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));

    // Se um catch largo envolvesse o corpo inteiro e engolisse o redirect,
    // a page resolveria (ou lançaria outro erro) e este expect falharia.
    await expect(AdminHubPage()).rejects.toThrow(NEXT_REDIRECT);
    expect(redirect).toHaveBeenCalledWith("/painel");
  });
});
