import { describe, it, expect, vi } from "vitest";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Issue 368 (fase RED) — aviso persistente D15 no layout do painel, para loja
 * já publicada alguma vez sem endereço completo ou sem par:
 *   (a) 'completar-endereco' → link "Completar endereço" para `hrefPerfil`;
 *   (b) 'localizar-de-novo'  → `<BotaoLocalizarEndereco>` (Server Action D14).
 * A loja segue no ar; o componente nunca recebe latitude/longitude
 * (seguranca.md §19) e não chama geocoder (o botão chama a Server Action).
 *
 * Ambiente node, sem jsdom: asserção sobre o markup estático. Import dinâmico —
 * o componente nasce na fase GREEN.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Props = {
  variante: "completar-endereco" | "localizar-de-novo";
  hrefPerfil: string;
  onLocalizar: () => Promise<{ ok: true } | { ok: false; erro: string }>;
};

const ROTULO = "Localizar meu endereço de novo";
const HREF = "/painel/configuracoes/perfil";

async function renderizar(variante: Props["variante"]): Promise<string> {
  const mod = (await import("./AvisoEnderecoLoja")) as unknown as { AvisoEnderecoLoja: ComponentType<Props> };
  const { AvisoEnderecoLoja } = mod;
  return renderToStaticMarkup(
    <AvisoEnderecoLoja variante={variante} hrefPerfil={HREF} onLocalizar={vi.fn(async () => ({ ok: true as const }))} />,
  );
}

describe("AvisoEnderecoLoja (issue 368, RED)", () => {
  it("'completar-endereco' → link para hrefPerfil, sem botão de localizar", async () => {
    const markup = await renderizar("completar-endereco");
    expect(markup).toContain(`href="${HREF}"`);
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain(ROTULO);
  });

  it("'localizar-de-novo' → botão com ROTULO_LOCALIZAR_DE_NOVO", async () => {
    const markup = await renderizar("localizar-de-novo");
    const i = markup.indexOf(ROTULO);
    expect(i, "rótulo do botão ausente").toBeGreaterThan(-1);
    expect(markup.lastIndexOf("<button", i), "rótulo fora de um <button>").toBeGreaterThan(-1);
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain(`href="${HREF}"`);
  });
});
