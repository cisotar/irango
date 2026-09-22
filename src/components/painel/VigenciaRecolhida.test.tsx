/**
 * [288/D1] A vigência recolhida no topo do detalhe do cardápio.
 *
 * Ambiente: vitest environment=node — sem jsdom. `renderToStaticMarkup`, o
 * mesmo padrão de `FormVigencia.test.tsx`. O que se observa aqui é o SSR: a
 * seção nasce FECHADA e o resumo do servidor já está na tela antes de qualquer
 * clique.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { VigenciaRecolhida } from "./VigenciaRecolhida";

const RESUMO = "Aparece de segunda a sexta, das 11:00 às 15:00.";

function montar(): string {
  return renderToStaticMarkup(
    <VigenciaRecolhida
      resumo={RESUMO}
      cardapio={null}
      timezone="America/Sao_Paulo"
      fusoRotulo="America/Sao_Paulo (GMT-3)"
      agoraLocal="2026-09-22T13:04"
      linhaAgora="Agora (ter, 22/09, 13:04): APARECENDO"
      salvar={vi.fn(async () => ({ ok: true }) as const)}
      voltarHref="/qualquer/cardapios"
    />,
  );
}

describe("VigenciaRecolhida — nasce fechada, com o resumo do servidor", () => {
  it("o gatilho existe e está FECHADO no SSR", () => {
    const html = montar();
    expect(html).toContain("Quando este cardápio aparece");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('aria-expanded="true"');
  });

  it("o resumo de UMA linha vem do servidor e já é legível fechada", () => {
    expect(montar()).toContain(RESUMO);
  });

  it("o gatilho respeita o alvo de 44px literal (design §5)", () => {
    expect(montar()).toContain("min-h-[44px]");
  });

  it("o bloco é um card branco — design §10.2 regra 4", () => {
    expect(montar()).toContain('data-slot="card"');
  });

  it("o FormVigencia entra INTEIRO e inalterado dentro da sanfona", () => {
    // `keepMounted`: o conteúdo existe no DOM fechado, então o form continua
    // sendo o mesmo componente — não uma segunda redação de vigência.
    const html = montar();
    expect(html).toContain("Dias da semana");
  });
});
