/**
 * Render estático da galeria (specs/galeria-imagens-loja.md, páginas 1 e 2) e
 * dos modos da `GradeImagens`. Ambiente node, sem jsdom: o que se afirma é o
 * HTML inicial (cabeçalho, contador, estado vazio, selo, "Carregar mais",
 * checkbox x botão por modo). Fila, seleção e textos de remoção são puros e
 * vivem em `estadoGaleria.test.ts`.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { GaleriaImagens, type AcoesGaleriaImagens } from "./GaleriaImagens";
import { GradeImagens, type SelecaoGrade } from "./GradeImagens";
import type { ImagemGaleria, UsoImagem } from "@/lib/actions/galeria-contrato";

const BASE = "https://exemplo.supabase.co/storage/v1/object/public/produtos/l/galeria";

function img(id: string, comMiniatura = true): ImagemGaleria {
  return {
    id,
    url: `${BASE}/${id}.webp`,
    miniatura_url: comMiniatura ? `${BASE}/mini/${id}.webp` : null,
    criado_em: "2026-10-06T12:00:00.000Z",
  };
}

const acoes: AcoesGaleriaImagens = {
  enviarImagem: vi.fn(async () => ({ ok: false as const, erro: "x" })),
  listarMais: vi.fn(async () => ({ ok: true as const, imagens: [], proximo_cursor: null })),
  consultarUso: vi.fn(async () => ({ ok: true as const, usos: [] })),
  remover: vi.fn(async () => ({ ok: false as const, erro: "x" })),
};

function galeria(over: {
  imagens?: ImagemGaleria[];
  total?: number;
  usos?: UsoImagem[];
  cursor?: { criado_em: string; id: string } | null;
} = {}): string {
  return renderToStaticMarkup(
    <GaleriaImagens
      voltarHref="/painel"
      voltarRotulo="Painel"
      imagensIniciais={over.imagens ?? []}
      cursorInicial={over.cursor ?? null}
      totalInicial={over.total ?? 0}
      usosIniciais={over.usos ?? []}
      acoes={acoes}
    />,
  );
}

describe("GaleriaImagens — cabeçalho e estado vazio", () => {
  it("vazia: título, contador '0 de 200', texto e CTA, sem 'Selecionar'", () => {
    const html = galeria();
    expect(html).toContain(">Galeria</h1>");
    expect(html).toContain("0 de 200 imagens");
    expect(html).toContain("Sua galeria está vazia.");
    // Botão do cabeçalho + CTA do estado vazio.
    expect(html.match(/Enviar imagens/g)).toHaveLength(2);
    expect(html).not.toContain("Selecionar");
    expect(html).toContain('href="/painel"');
  });

  it("input de arquivo oculto, múltiplo, só JPEG/PNG/WEBP", () => {
    const html = galeria();
    expect(html).toMatch(/<input[^>]*type="file"[^>]*multiple/);
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
  });
});

describe("GaleriaImagens — grade", () => {
  it("com imagens: contador, 'Selecionar' e uma miniatura por imagem", () => {
    const html = galeria({ imagens: [img("a"), img("b")], total: 37 });
    expect(html).toContain("37 de 200 imagens");
    expect(html).toContain(">Selecionar<");
    expect(html).not.toContain("Sua galeria está vazia.");
    expect(html).toContain(`${BASE}/mini/a.webp`);
    expect(html).toContain(`${BASE}/mini/b.webp`);
  });

  it("legada sem miniatura usa o próprio arquivo (P9)", () => {
    const html = galeria({ imagens: [img("a", false)], total: 1 });
    expect(html).toContain(`${BASE}/a.webp`);
  });

  it("selo 'Em uso' só nas imagens em produto ou na logo", () => {
    const usos: UsoImagem[] = [
      { imagem_id: "a", produtos_total: 2, produtos: [], na_logo: false },
      { imagem_id: "b", produtos_total: 0, produtos: [], na_logo: true },
      { imagem_id: "c", produtos_total: 0, produtos: [], na_logo: false },
    ];
    const html = galeria({ imagens: [img("a"), img("b"), img("c")], total: 3, usos });
    expect(html.match(/Em uso/g)).toHaveLength(2);
  });

  it("'Carregar mais' só quando há próxima página", () => {
    expect(galeria({ imagens: [img("a")], total: 41 })).not.toContain("Carregar mais");
    expect(
      galeria({
        imagens: [img("a")],
        total: 41,
        cursor: { criado_em: "2026-10-06T12:00:00.000Z", id: "a" },
      }),
    ).toContain("Carregar mais");
  });

  it("URL fora de https não vira src (fotoSegura)", () => {
    const perigosa: ImagemGaleria = {
      id: "x",
      url: "javascript:alert(1)",
      miniatura_url: null,
      criado_em: "2026-10-06T12:00:00.000Z",
    };
    const html = galeria({ imagens: [perigosa], total: 1 });
    expect(html).not.toContain("javascript:");
  });
});

describe("GradeImagens — modos", () => {
  function grade(selecao: SelecaoGrade): string {
    return renderToStaticMarkup(
      <GradeImagens
        imagens={[img("a"), img("b")]}
        emUso={new Set(["a"])}
        selecao={selecao}
        proximoCursor={null}
        listarMais={acoes.listarMais}
        onPaginaCarregada={() => {}}
      />,
    );
  }

  it("nenhuma: sem checkbox nem botão por item", () => {
    const html = grade({ modo: "nenhuma" });
    expect(html).not.toContain('role="checkbox"');
    expect(html).not.toContain("Escolher imagem");
  });

  it("multipla: um checkbox por item, marcado conforme a seleção", () => {
    const html = grade({ modo: "multipla", selecionadas: new Set(["b"]), onAlternar: () => {} });
    expect(html.match(/role="checkbox"/g)).toHaveLength(2);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Selecionar imagem 2"');
    // Alvo de toque literal (design-system §5).
    expect(html).toContain("min-h-[44px] min-w-[44px]");
  });

  it("unica: cada item é um botão que escolhe", () => {
    const html = grade({ modo: "unica", onEscolher: () => {} });
    expect(html).not.toContain('role="checkbox"');
    expect(html.match(/aria-label="Escolher imagem \d"/g)).toHaveLength(2);
  });

  it("o selo 'Em uso' aparece nos três modos", () => {
    for (const s of [
      { modo: "nenhuma" } as const,
      { modo: "multipla", selecionadas: new Set<string>(), onAlternar: () => {} } as const,
      { modo: "unica", onEscolher: () => {} } as const,
    ]) {
      expect(grade(s).match(/Em uso/g)).toHaveLength(1);
    }
  });
});
