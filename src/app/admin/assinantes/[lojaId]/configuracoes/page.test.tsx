import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Teste do índice `/admin/assinantes/[lojaId]/configuracoes` (issue 154).
 *
 * A page consolidada foi aposentada: agora é redirect-only para a aba-default
 * (Perfil). Prova que a page:
 *   - emite `redirect` (307 Temporary) para `.../configuracoes/perfil`;
 *   - NUNCA usa `permanentRedirect` (308) — o namespace `.../configuracoes/*`
 *     segue vivo, a delegação à 1ª aba não deve ser cacheada para sempre;
 *   - propaga a sentinela `NEXT_REDIRECT` (não engole num catch largo);
 *   - não carrega dado algum (é pura navegação — sem mock de loader).
 *
 * Padrão espelha `src/app/admin/page.test.tsx`: mocka `next/navigation`, faz
 * `redirect` lançar `NEXT_REDIRECT` (comportamento real do Next), invoca o
 * default export async e afirma `rejects.toThrow(NEXT_REDIRECT)` + o destino.
 * Ambiente `node`.
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";
const NEXT_REDIRECT = "NEXT_REDIRECT";

// `redirect` LANÇA a sentinela (comportamento real do Next); `permanentRedirect`
// é espiada para provar que NUNCA é usada (garante 307, não 308).
const redirect = vi.fn((_destino: string) => {
  throw new Error(NEXT_REDIRECT);
});
const permanentRedirect = vi.fn((_destino: string) => {
  throw new Error(NEXT_REDIRECT);
});
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => redirect(destino),
  permanentRedirect: (destino: string) => permanentRedirect(destino),
}));

// Import APÓS o vi.mock().
import ConfiguracaoIndexPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("índice /admin/assinantes/[lojaId]/configuracoes — redirect para a aba Perfil", () => {
  it("redireciona (307) para .../configuracoes/perfil e propaga o NEXT_REDIRECT", async () => {
    await expect(
      ConfiguracaoIndexPage({ params: Promise.resolve({ lojaId: LOJA_ID }) }),
    ).rejects.toThrow(NEXT_REDIRECT);

    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith(
      `/admin/assinantes/${LOJA_ID}/configuracoes/perfil`,
    );
  });

  it("nunca usa permanentRedirect (308): a delegação à aba-default é temporária", async () => {
    await expect(
      ConfiguracaoIndexPage({ params: Promise.resolve({ lojaId: LOJA_ID }) }),
    ).rejects.toThrow(NEXT_REDIRECT);

    expect(permanentRedirect).not.toHaveBeenCalled();
  });
});
