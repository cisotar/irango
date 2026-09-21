/**
 * [256] Markup da lista de cardápios. `environment: node`, sem jsdom —
 * `renderToStaticMarkup`, o mesmo padrão de `CuponsClient.test.tsx`.
 *
 * O conteúdo dos dois `AlertDialog` não é observável aqui (eles nascem
 * fechados e o clique não roda sem DOM). As frases que eles mostram estão
 * travadas em `frasesCardapio.test.ts`, que é puro — foi para isso que elas
 * saíram do JSX.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { CardapiosClient, type LinhaCardapio } from "./CardapiosClient";
import type { AcoesCardapios } from "./CardapiosClient";

function acoes(): AcoesCardapios {
  return {
    ligarDesligar: vi.fn(async () => ({ ok: true }) as const),
    remover: vi.fn(async () => ({ ok: true }) as const),
    converter: vi.fn(async () => ({ ok: true }) as const),
  };
}

function linha(over: Partial<LinhaCardapio> = {}): LinhaCardapio {
  return {
    id: "c1",
    nome: "Feijoada de sábado",
    ativo: true,
    estado: {
      tom: "verde",
      rotulo: "Aberto agora",
      rotuloAcessivel: null,
      abertoAgora: true,
    },
    descricao: "Aparece todo sábado, das 11:00 às 15:00.",
    menu: 4,
    exclusivos: 2,
    ...over,
  };
}

function montar(linhas: LinhaCardapio[]): string {
  return renderToStaticMarkup(
    <CardapiosClient cardapios={linhas} acoes={acoes()} />,
  );
}

describe("CardapiosClient", () => {
  it("mostra o rótulo de estado que o SERVIDOR derivou, sem recalcular nada", () => {
    expect(montar([linha()])).toContain("Aberto agora");
    expect(
      montar([
        linha({
          estado: {
            tom: "neutro",
            rotulo: "Abre sábado às 11:00",
            rotuloAcessivel: null,
            abertoAgora: false,
          },
        }),
      ]),
    ).toContain("Abre sábado às 11:00");
  });

  it("o aria-label completo desce para o badge quando o rótulo é abreviado", () => {
    const html = montar([
      linha({
        estado: {
          tom: "ambar",
          rotulo: "Expira em 3 dias",
          rotuloAcessivel: "Expira em 3 dias, em 23/09 às 23:59",
          abertoAgora: true,
        },
      }),
    ]);
    expect(html).toContain('aria-label="Expira em 3 dias, em 23/09 às 23:59"');
  });

  it("D16: o cardápio no ar diz ao lojista o que o cliente está vendo", () => {
    const frase = "aparecendo como seção no topo da sua loja";
    expect(montar([linha()])).toContain(frase);
    expect(
      montar([
        linha({
          ativo: false,
          estado: {
            tom: "neutro",
            rotulo: "Desligado",
            rotuloAcessivel: null,
            abertoAgora: false,
          },
        }),
      ]),
    ).not.toContain(frase);
  });

  it("a frase da janela vem de `descreverVigencia`, não do JSX", () => {
    expect(montar([linha()])).toContain(
      "Aparece todo sábado, das 11:00 às 15:00.",
    );
  });

  it("o Switch de desligar NÃO promete que os produtos voltariam a vender", () => {
    // Agulha montada em pedaços: o critério de aceite da 256 grepa o literal
    // em `src/` e exige zero ocorrência (ver `frasesCardapio.test.ts`).
    expect(montar([linha()])).not.toContain(["voltam", "a", "vender"].join(" "));
  });

  it("lista vazia não é tela em branco", () => {
    expect(montar([])).toContain("Nenhum cardápio ainda.");
  });
});
