/**
 * [275] Markup de `PilulasDeDias` + a trava de fonte do critério de aceite.
 *
 * Ambiente: vitest environment=node — sem jsdom. `renderToStaticMarkup`, o
 * mesmo padrão de `FormVigencia.test.tsx`. O que um clique produz não é
 * observável aqui; o que É observável é o DOM de saída: os 7 botões, o
 * `aria-pressed` por `valor`, o alvo de 44px LITERAL, o nome completo do dia no
 * `aria-label` e o roving tabindex (uma única parada de Tab).
 *
 * A trava de fonte no fim é o critério de aceite da issue: `DIAS_DA_SEMANA` só
 * pode ser lida em `rascunhoCardapio.ts` (dona) e aqui (única desenhista).
 * Forma copiada de `rotaCardapiosInjetada.test.tsx`.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { PilulasDeDias } from "./PilulasDeDias";

function montar(props: Partial<React.ComponentProps<typeof PilulasDeDias>> = {}): string {
  return renderToStaticMarkup(
    <PilulasDeDias
      valor={[]}
      onChange={vi.fn()}
      rotulo="Dias da semana em que este cardápio aparece"
      {...props}
    />,
  );
}

describe("PilulasDeDias — as sete pílulas", () => {
  it("renderiza sete botões dentro de um role=group rotulado", () => {
    const html = montar();
    expect(html).toContain('role="group"');
    expect(html).toContain(
      'aria-label="Dias da semana em que este cardápio aparece"',
    );
    expect((html.match(/<button/g) ?? []).length).toBe(7);
  });

  it("aria-pressed segue o `valor`, e nada mais", () => {
    const html = montar({ valor: [3, 6] });
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(2);
    expect((html.match(/aria-pressed="false"/g) ?? []).length).toBe(5);
    expect(html).toContain('aria-label="quarta"');
    expect(html).toContain('aria-label="sábado"');
  });

  it("o alvo de 44px é LITERAL (min-h-11 não bate 44px com fonte a 120%)", () => {
    expect(montar()).toContain("min-h-[44px]");
    expect(montar()).toContain("min-w-[44px]");
  });

  it("cada pílula tem o nome COMPLETO do dia no aria-label", () => {
    const html = montar();
    for (const nome of [
      "domingo",
      "segunda",
      "terça",
      "quarta",
      "quinta",
      "sexta",
      "sábado",
    ]) {
      expect(html).toContain(`aria-label="${nome}"`);
    }
  });

  it("roving tabindex: o grupo é UMA parada de Tab", () => {
    const html = montar();
    expect((html.match(/tabindex="0"/gi) ?? []).length).toBe(1);
    expect((html.match(/tabindex="-1"/gi) ?? []).length).toBe(6);
  });

  it("modo não compacto: 4 colunas no mobile, 7 a partir de sm, rótulo de 3 letras", () => {
    const html = montar();
    expect(html).toContain("grid-cols-4");
    expect(html).toContain("sm:grid-cols-7");
    expect(html).toContain(">Dom<");
    expect(html).toContain(">Sáb<");
  });

  it("modo compacto: uma linha de 7 e iniciais, com a altura de 44px intacta", () => {
    const html = montar({ compacto: true });
    expect(html).toContain("grid-cols-7");
    expect(html).not.toContain("grid-cols-4");
    expect(html).toContain(">D<");
    expect(html).toContain(">T<");
    // Exceção A do desenho §8: só o eixo X cede abaixo de `sm`.
    expect(html).toContain("min-h-[44px]");
    expect(html).toContain("min-w-[40px]");
    expect(html).toContain("sm:min-w-[44px]");
  });

  it("desabilitado marca os sete botões sem esconder a agenda", () => {
    const html = montar({ valor: [6], desabilitado: true });
    expect((html.match(/disabled=""/g) ?? []).length).toBe(7);
    expect(html).toContain("disabled:opacity-60");
    expect(html).toContain(">Sáb<");
  });

  it("descritoPor vira aria-describedby do grupo", () => {
    expect(montar({ descritoPor: "erros-vigencia" })).toContain(
      'aria-describedby="erros-vigencia"',
    );
  });

  it("o estado marcado não depende só de cor (peso + borda + aria-pressed)", () => {
    const html = montar({ valor: [0] });
    expect(html).toContain("font-semibold");
    expect(html).toContain("border-primary");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// TRAVA DE FONTE — uma tabela de dias, um desenhista
// ───────────────────────────────────────────────────────────────────────────

const RAIZ = join(process.cwd(), "src");

/** Os donos legítimos: a tabela e o único componente que a desenha. */
const DONOS = new Set([
  "components/painel/rascunhoCardapio.ts",
  "components/painel/PilulasDeDias.tsx",
]);

function arquivosDeFonte(dir: string): string[] {
  return readdirSync(dir).flatMap((entrada) => {
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) return arquivosDeFonte(caminho);
    return /\.tsx?$/.test(entrada) && !/\.test\.tsx?$/.test(entrada)
      ? [caminho]
      : [];
  });
}

describe("DIAS_DA_SEMANA tem um dono e um desenhista", () => {
  const fontes = arquivosDeFonte(join(RAIZ, "components"));

  it("a varredura não está vazia (senão o teste passa por vacuidade)", () => {
    expect(fontes.length).toBeGreaterThan(10);
  });

  it("nenhum outro componente cita DIAS_DA_SEMANA", () => {
    const infratores = fontes
      .filter((caminho) => readFileSync(caminho, "utf8").includes("DIAS_DA_SEMANA"))
      .map((caminho) => relative(RAIZ, caminho).replaceAll("\\", "/"))
      .filter((caminho) => !DONOS.has(caminho));
    expect(infratores).toEqual([]);
  });
});
