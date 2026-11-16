import { describe, it, expect, vi } from "vitest";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Issue 368 (fase RED) — `CartaoPublicacao` (DD6): o cartão "Status da vitrine"
 * extraído do `PerfilClient`, reusado no perfil do painel, no perfil admin e na
 * etapa revisar do assistente. Props obrigatórias: `publicado`, `bloqueio`
 * (texto D10 da 1ª pendência; `null` = pode publicar), `onDefinirPublicacao`,
 * `destinoAposPublicar`.
 *
 * O botão desabilitado é só UX: a autoridade é `definirPublicacao` /
 * `publicarLojaAdmin`, que relêem o banco. Despublicar nunca é bloqueado.
 *
 * Ambiente node, sem jsdom: asserção sobre o markup estático. Import dinâmico —
 * o componente nasce na fase GREEN.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Props = {
  publicado: boolean;
  bloqueio: string | null;
  onDefinirPublicacao: (publicar: boolean) => Promise<{ ok: true } | { ok: false; erro: string }>;
  destinoAposPublicar: string | null;
};

async function renderizar(props: Partial<Props>): Promise<string> {
  const mod = (await import("./CartaoPublicacao")) as unknown as { CartaoPublicacao: ComponentType<Props> };
  const { CartaoPublicacao } = mod;
  return renderToStaticMarkup(
    <CartaoPublicacao
      publicado={false}
      bloqueio={null}
      onDefinirPublicacao={vi.fn(async () => ({ ok: true as const }))}
      destinoAposPublicar={null}
      {...props}
    />,
  );
}

/** A tag de abertura do `<button>` cujo texto contém `rotulo`. */
function tagDoBotao(markup: string, rotulo: string): string {
  const i = markup.indexOf(rotulo);
  expect(i, `botão "${rotulo}" não encontrado`).toBeGreaterThan(-1);
  const inicio = markup.lastIndexOf("<button", i);
  expect(inicio).toBeGreaterThan(-1);
  return markup.slice(inicio, markup.indexOf(">", inicio) + 1);
}

const BLOQUEIO = "Cadastre ao menos um produto disponível antes de publicar a loja.";

describe("CartaoPublicacao (issue 368, RED)", () => {
  it("rascunho + bloqueio → 'Publicar loja' desabilitado e texto do bloqueio visível", async () => {
    const markup = await renderizar({ publicado: false, bloqueio: BLOQUEIO });
    expect(tagDoBotao(markup, "Publicar loja")).toMatch(/\sdisabled(=""|\s|>)/);
    expect(markup).toContain(BLOQUEIO);
    expect(markup).not.toContain("nome e WhatsApp e salve");
  });

  it("rascunho sem bloqueio → habilitado", async () => {
    const markup = await renderizar({ publicado: false, bloqueio: null });
    expect(tagDoBotao(markup, "Publicar loja")).not.toMatch(/\sdisabled(=""|\s|>)/);
  });

  it("publicado → 'Despublicar' habilitado mesmo com bloqueio", async () => {
    const markup = await renderizar({ publicado: true, bloqueio: BLOQUEIO });
    expect(tagDoBotao(markup, "Despublicar")).not.toMatch(/\sdisabled(=""|\s|>)/);
    expect(markup).not.toContain("Publicar loja");
  });
});
