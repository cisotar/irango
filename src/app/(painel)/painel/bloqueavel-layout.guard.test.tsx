import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";

/**
 * Fase RED (issue 142, crítica: TDD red-first — gate de assinatura POSICIONAL).
 *
 * Prova o comportamento do NOVO layout aninhado
 * `src/app/(painel)/painel/(bloqueavel)/layout.tsx` (ainda NÃO existe → o import
 * dinâmico rejeita: RED por ausência do alvo, no padrão de `admin/page.test.tsx`,
 * que trata "componente ainda não criado → RED legítimo"). Vira VERDE quando a
 * fase GREEN criar o layout.
 *
 * O que este layout DEVE fazer (spec §"Layout do grupo bloqueável"):
 *   - refazer o I/O mínimo (createClient → getUser → buscarLojaDoDono, fail-closed);
 *   - rodar `decidirAssinatura(loja, agora)` — função PURA da 140, aqui usada REAL
 *     (não mockada) para provar a fiação ponta-a-ponta;
 *   - se bloqueado → `redirect("/painel/assinatura-bloqueada")`;
 *   - senão → retornar `children` CRU (o chrome vem do layout pai).
 *
 * Padrão de invocação: chama o default export async e inspeciona o retorno SEM
 * renderizar (ambiente `node`, sem jsdom), igual a `pedidos/[id]/page.test.tsx` e
 * `admin/page.test.tsx`. `redirect` mockado LANÇA a sentinela NEXT_REDIRECT
 * (comportamento real do Next): o caminho bloqueado deve REJEITAR, provando que o
 * redirect propagou e o layout não renderizou `children`.
 *
 * NOTA para a fase GREEN: este arquivo mora em `painel/` (raiz), NÃO cria o dir
 * `(bloqueavel)/` — o guard estrutural da 141 (`route-group.guard.test.ts`)
 * continua íntegro. O import aponta para `./(bloqueavel)/layout`, resolvido assim
 * que o layout for criado.
 */

// ── redirect() LANÇA NEXT_REDIRECT (real do Next): bloqueio/fail-closed REJEITAM ──
const NEXT_REDIRECT = "NEXT_REDIRECT";
const redirect = vi.fn((_destino: string) => {
  throw new Error(NEXT_REDIRECT);
});
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => redirect(destino),
}));

// ── Supabase server client + getUser autoritativo (server-side, nunca do browser) ─
const userConfirmado = {
  id: "user-uuid",
  email: "dono@loja.com",
  email_confirmed_at: "2026-01-02T00:00:00Z",
};
const getUser = vi.fn(async () => ({ data: { user: userConfirmado } }));
const supabaseFake = { auth: { getUser: () => getUser() } };
const createClient = vi.fn(async () => supabaseFake as unknown);
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

// ── buscarLojaDoDono: 2ª leitura sob RLS por dono_id (reuso da query). ────────────
const buscarLojaDoDono = vi.fn(async (_c: unknown) => null as unknown);
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (c: unknown) => buscarLojaDoDono(c),
}));

// `decidirAssinatura` NÃO é mockada — fonte real (140, já verde). O RED/GREEN prova
// a fiação loja→decisão→redirect, não a fórmula (que já tem teste unitário próprio).

function fazerLoja(status: string, fim: string | null): LojaCompleta {
  return {
    assinatura_status: status,
    assinatura_fim_periodo: fim,
  } as unknown as LojaCompleta;
}

// Sentinela de children: provamos que o caminho LIBERADO devolve o children (cru),
// sem redirect e sem envolvê-lo em chrome (Sidebar/Topbar são do layout pai).
const CHILDREN = { __tag: "children-sentinela" } as unknown as ReactNode;

/** Import dinâmico do alvo — rejeita enquanto o layout não existir (RED honesto). */
async function importarLayout(): Promise<
  (props: { children: ReactNode }) => Promise<unknown>
> {
  const mod = (await import("./(bloqueavel)/layout")) as {
    default: (props: { children: ReactNode }) => Promise<unknown>;
  };
  return mod.default;
}

/** true se a sentinela de children é alcançável no nó retornado (cru ou em fragment). */
function contemSentinela(no: unknown): boolean {
  if (no === CHILDREN) return true;
  if (no == null || typeof no !== "object") return false;
  const props = (no as { props?: { children?: unknown } }).props;
  return props ? contemSentinela(props.children) : false;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  getUser.mockResolvedValue({ data: { user: userConfirmado } });
  createClient.mockResolvedValue(supabaseFake as unknown);
});

describe("(bloqueavel)/layout — gate de assinatura posicional (RED)", () => {
  it("(1) BLOQUEADO: loja 'suspensa' → redirect('/painel/assinatura-bloqueada') e REJEITA", async () => {
    buscarLojaDoDono.mockResolvedValueOnce(fazerLoja("suspensa", null));
    const Layout = await importarLayout();

    // O NEXT_REDIRECT propaga (não pode ser engolido por catch largo).
    await expect(Layout({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);

    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/painel/assinatura-bloqueada");
  });

  it("(2) BLOQUEADO: 'trial' com fim no passado (sempre expirado) → mesmo bloqueio", async () => {
    // fim fixo no passado remoto → independente do `new Date()` interno do layout.
    buscarLojaDoDono.mockResolvedValueOnce(fazerLoja("trial", "2000-01-01T00:00:00Z"));
    const Layout = await importarLayout();

    await expect(Layout({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);
    expect(redirect).toHaveBeenCalledWith("/painel/assinatura-bloqueada");
  });

  it("(3) LIBERADO: loja 'ativa' → NÃO redireciona e devolve children cru", async () => {
    buscarLojaDoDono.mockResolvedValueOnce(fazerLoja("ativa", null));
    const Layout = await importarLayout();

    const out = await Layout({ children: CHILDREN });

    expect(redirect).not.toHaveBeenCalled();
    expect(contemSentinela(out)).toBe(true);
  });

  it("(4) FAIL-CLOSED: erro de I/O de sessão → redirect('/login?erro=sessao'), REJEITA", async () => {
    createClient.mockRejectedValueOnce(new Error("supabase indisponível"));
    const Layout = await importarLayout();

    await expect(Layout({ children: CHILDREN })).rejects.toThrow(NEXT_REDIRECT);
    expect(redirect).toHaveBeenCalledWith("/login?erro=sessao");
  });
});
