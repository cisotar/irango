import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Issue 368 (P8) — indicador de progresso. Regras: etapa atual vem do pathname
 * (fallback na 1ª), só etapa com pendência ganha "Falta" (nunca "concluída"),
 * todas as etapas são links (navegação livre).
 */

const usePathname = vi.fn(() => "/painel/primeiros-passos/perfil");
vi.mock("next/navigation", () => ({ usePathname: () => usePathname() }));

import { ProgressoAssistente } from "./ProgressoAssistente";
import { ETAPAS_ASSISTENTE, rotaDaEtapa } from "@/lib/utils/primeirosPassos";

function renderizar(pathname: string, pendentes: Parameters<typeof ProgressoAssistente>[0]["pendentes"] = []) {
  usePathname.mockReturnValue(pathname);
  return renderToStaticMarkup(<ProgressoAssistente pendentes={pendentes} />);
}

/** A lista é renderizada 2x (mobile e desktop); conta ocorrências. */
const conta = (m: string, trecho: string) => m.split(trecho).length - 1;

beforeEach(() => usePathname.mockReset());

describe("ProgressoAssistente", () => {
  it("'Etapa N de 7' acompanha o pathname de cada etapa", () => {
    ETAPAS_ASSISTENTE.forEach((e, i) => {
      const m = renderizar(rotaDaEtapa(e.etapa));
      expect(m).toContain(`Etapa ${i + 1} de 7`);
      expect(m).toContain(`> · ${e.rotulo}<`);
    });
  });

  it("pathname fora das etapas (ex.: entrada do assistente) cai na etapa 1", () => {
    expect(renderizar("/painel/primeiros-passos")).toContain("Etapa 1 de 7");
    expect(renderizar("/qualquer/coisa")).toContain("Etapa 1 de 7");
  });

  it("barra: preenche até a etapa atual inclusive", () => {
    const m = renderizar(rotaDaEtapa("pagamentos")); // índice 3
    expect(conta(m, "h-1.5 rounded-full bg-primary")).toBe(4);
    expect(conta(m, "h-1.5 rounded-full bg-muted")).toBe(3);
  });

  it("aria-current='step' só na etapa atual (uma vez por lista) e 'você está aqui' só no mobile", () => {
    const m = renderizar(rotaDaEtapa("produtos"));
    expect(conta(m, 'aria-current="step"')).toBe(2);
    expect(conta(m, "você está aqui")).toBe(1);
    const i = m.indexOf('aria-current="step"');
    const trecho = m.slice(m.lastIndexOf("<a", i), m.indexOf("</a>", i));
    expect(trecho).toContain(rotaDaEtapa("produtos"));
  });

  it("selo 'Falta' só nas etapas pendentes; sem pendência nenhum selo e nenhum 'concluída'", () => {
    const m = renderizar(rotaDaEtapa("perfil"), ["perfil", "produtos"]);
    expect(conta(m, "Falta")).toBe(4); // 2 etapas x 2 listas
    const sem = renderizar(rotaDaEtapa("perfil"), []);
    expect(sem).not.toContain("Falta");
    expect(sem.toLowerCase()).not.toContain("conclu");
  });

  it("o selo fica dentro do link da etapa pendente, não de outra", () => {
    const m = renderizar(rotaDaEtapa("perfil"), ["pagamentos"]);
    const link = (etapa: string) => {
      const i = m.indexOf(`href="${rotaDaEtapa(etapa as never)}"`);
      return m.slice(i, m.indexOf("</a>", i));
    };
    expect(link("pagamentos")).toContain("Falta");
    expect(link("perfil")).not.toContain("Falta");
    expect(link("revisar")).not.toContain("Falta");
  });

  it("todas as 7 etapas são links (navegação livre) e só 'opcionais' diz 'pode pular'", () => {
    const m = renderizar(rotaDaEtapa("perfil"));
    for (const e of ETAPAS_ASSISTENTE) {
      expect(m).toContain(`href="${rotaDaEtapa(e.etapa)}"`);
    }
    expect(conta(m, "pode pular")).toBe(2); // opcionais, nas 2 listas
  });
});
