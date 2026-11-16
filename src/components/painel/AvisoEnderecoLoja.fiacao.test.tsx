import { describe, it, expect, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Issue 368 (P8) — fiação e copy do aviso D15 que o teste de variantes não
 * cobre: a action chega ao botão, o texto muda por variante e nunca promete
 * despublicar. O contrato visual das variantes está em AvisoEnderecoLoja.test.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AvisoEnderecoLoja } from "./AvisoEnderecoLoja";
import { BotaoLocalizarEndereco } from "./BotaoLocalizarEndereco";

function achar(no: ReactNode, tipo: unknown): { props: Record<string, unknown> } | null {
  if (Array.isArray(no)) {
    for (const f of no) {
      const r = achar(f, tipo);
      if (r) return r;
    }
    return null;
  }
  if (!isValidElement(no)) return null;
  const el = no as { type: unknown; props: Record<string, unknown> };
  if (el.type === tipo) return el;
  return achar(el.props.children as ReactNode, tipo);
}

const onLocalizar = vi.fn(async () => ({ ok: true as const }));

describe("AvisoEnderecoLoja — fiação e copy", () => {
  it("'localizar-de-novo' repassa a MESMA action ao botão D14", () => {
    const el = AvisoEnderecoLoja({ variante: "localizar-de-novo", hrefPerfil: "/p", onLocalizar });
    expect(achar(el, BotaoLocalizarEndereco)?.props.onLocalizar).toBe(onLocalizar);
  });

  it("'completar-endereco' não monta o botão (nada de geocodar endereço incompleto)", () => {
    const el = AvisoEnderecoLoja({ variante: "completar-endereco", hrefPerfil: "/p", onLocalizar });
    expect(achar(el, BotaoLocalizarEndereco)).toBeNull();
  });

  it("copy distinta por variante; ambas dizem que a loja segue no ar", () => {
    const render = (v: "completar-endereco" | "localizar-de-novo") =>
      renderToStaticMarkup(<AvisoEnderecoLoja variante={v} hrefPerfil="/p" onLocalizar={onLocalizar} />);
    const c = render("completar-endereco");
    const l = render("localizar-de-novo");
    expect(c).toContain("Complete o endereço da loja");
    expect(l).toContain("Localize sua loja no mapa");
    expect(c).not.toContain("Localize sua loja no mapa");
    expect(l).not.toContain("Complete o endereço da loja");
    for (const m of [c, l]) {
      expect(m).toContain("Sua loja segue no ar");
      expect(m.toLowerCase()).not.toContain("despublic");
    }
  });
});
