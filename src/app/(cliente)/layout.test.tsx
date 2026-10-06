/**
 * A largura estreita (`max-w-sm`, centralizada) saiu do grupo `(cliente)` e
 * desceu para `/conta/*`: login, cadastro, recuperar e completar continuam com
 * o mesmo card centralizado; `/minha-conta/*` ganha a largura da tela.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import ClienteLayout from "./layout";
import ContaLayout from "./conta/layout";

describe("layout do grupo (cliente)", () => {
  it("só fundo neutro e altura mínima: sem max-w-sm nem centralização", () => {
    const html = renderToStaticMarkup(<ClienteLayout>x</ClienteLayout>);
    expect(html).toContain("min-h-dvh");
    expect(html).toContain("bg-fundo");
    expect(html).not.toContain("max-w-sm");
    expect(html).not.toContain("justify-center");
    expect(html).not.toContain("<main");
  });
});

describe("layout de /conta/*", () => {
  it("mantém o card centralizado e estreito de antes", () => {
    const html = renderToStaticMarkup(<ContaLayout>x</ContaLayout>);
    expect(html).toBe(
      '<div class="flex min-h-dvh flex-col items-center justify-center px-4 py-8"><main class="w-full max-w-sm">x</main></div>',
    );
  });
});
